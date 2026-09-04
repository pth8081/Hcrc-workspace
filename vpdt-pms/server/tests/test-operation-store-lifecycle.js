// server/tests/test-operation-store-lifecycle.js
//
// Regression test cho vòng đời "dự án nhỏ" của tab Vận Hành > 🏬 Siêu Thị, cập nhật TOÀN DIỆN theo đợt
// "Chi Phí Phê Duyệt, Danh Mục Đầu Tư, Thực Hiện linh hoạt":
//   Mở mới/Sửa chữa (hồ sơ chính) -> Danh mục đầu tư (trước đây "Dự toán", workflow duyệt riêng ĐÃ BỎ ở
//   Mục H — lưu là APPROVED ngay, không ai khác cần duyệt) -> Kỳ Thực Hiện (KHÔNG CÒN bắt buộc chọn khi
//   tạo công việc gốc — Mục B) -> Thực hiện (cây công việc đa cấp dbo.OperationWorkItems, mock qua
//   state.operationWorkItems — CHỈ toàn quyền HOẶC đúng NGƯỜI PHỤ TRÁCH (assignedTo[], nay có thể NHIỀU
//   người — Mục E) mới cập nhật tiến độ được) -> Nghiệm thu (CHỈ toàn quyền HOẶC đúng người được CHỈ
//   ĐỊNH (acceptorUsername) mới nghiệm thu được; Nghiệm thu đổi trạng thái / Bổ sung KHÔNG đổi trạng
//   thái, completedAt tự set lúc chuyển "Đang nghiệm thu" — Mục D) -> cha tự cập nhật khi mọi con đã
//   nghiệm thu (recordActions.computeParentWorkItemStatus).
//
// Mục C: "Người Phụ Trách" hồ sơ (personInCharge) giờ là tài khoản hệ thống THẬT (không còn tên tự do)
// — mở quyền SỬA công việc (không tạo/xoá) cho đúng người này dù không có operationExecutionManage
// (Mục E, assertCanManageOperationWorkItem()).
//
// Chạy: node server/tests/test-operation-store-lifecycle.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual, assertIncludes
} = require('./testHarness');

const PORT = 8986;

// ===================== Seed dữ liệu =====================
const CREATOR = { username: 'vh_creator', name: 'Người Tạo Hồ Sơ', dept: 'Vận Hành', perms: { operationStoreOpenCreate: true, operationRepairCreate: true }, active: true };
const ESTIMATOR = { username: 'vh_estimator', name: 'Người Lập Danh Mục Đầu Tư', dept: 'Vận Hành', perms: { operationEstimateCreate: true }, active: true };
const EXECUTOR = { username: 'vh_executor', name: 'Người Thực Hiện', dept: 'Vận Hành', perms: { operationExecutionManage: true }, active: true };
const ACCEPTOR = { username: 'vh_acceptor', name: 'Người Nghiệm Thu', dept: 'Vận Hành', perms: { operationAcceptanceManage: true }, active: true };
const NOPERM = { username: 'vh_noperm', name: 'Người Không Quyền', dept: 'Vận Hành', perms: {}, active: true };
const WORKER = { username: 'vh_worker', name: 'Kỹ Thuật Viên A', dept: 'Vận Hành', perms: {}, active: true };
const WORKER2 = { username: 'vh_worker2', name: 'Kỹ Thuật Viên B', dept: 'Vận Hành', perms: {}, active: true };
const DESIGNATED_ACCEPTOR = { username: 'vh_designated_acceptor', name: 'Người Được Chỉ Định Nghiệm Thu', dept: 'Vận Hành', perms: {}, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Vận Hành', perms: { admin: true }, active: true, totpEnabled: true };
const USE_CONFIRMER = { username: 'vh_use_confirmer', name: 'Người Xác Nhận Đưa Vào Sử Dụng', dept: 'Vận Hành', perms: { operationUseConfirm: true }, active: true };
// Mục C/E: "Người Phụ Trách" hồ sơ — tài khoản THẬT, KHÔNG có operationExecutionManage — chỉ được mở
// quyền SỬA công việc thuộc ĐÚNG hồ sơ mà họ là personInCharge (không tạo/xoá được).
const PERSON_IN_CHARGE = { username: 'vh_pic', name: 'Trưởng Dự Án Phụ Trách', dept: 'Vận Hành', perms: {}, active: true };
const INACTIVE_USER = { username: 'vh_inactive', name: 'Tài Khoản Đã Khoá', dept: 'Vận Hành', perms: {}, active: false };

const state = createMockState({
  depts: ['Vận Hành', 'Ban Giám Đốc'],
  users: [CREATOR, ESTIMATOR, EXECUTOR, ACCEPTOR, NOPERM, WORKER, WORKER2, DESIGNATED_ACCEPTOR, ADMIN, USE_CONFIRMER, PERSON_IN_CHARGE, INACTIVE_USER]
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => {
    window.__resetCapture();
    await proceedAfterAuth(u);
  }, user);
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  let recordId = null;
  let repairRecordId = null;
  let periodId = null;
  let rootWorkItemId = null;
  let child1Id = null;
  let child2Id = null;

  try {
    // ===== 1) Tạo hồ sơ Mở mới siêu thị — Mục H: status APPROVED NGAY, không ai khác cần duyệt =====
    await run.run('operationStoreOpenCreate tạo hồ sơ Mở mới — status APPROVED ngay (Mục H), estimateStatus DRAFT, personInCharge resolve đúng account', async () => {
      await loginAs(page, CREATOR);
      const result = await page.evaluate(async (picUsername) => {
        const res = await callCreateAction('operationStoreOpenings', {
          storeName: 'Siêu thị Test Quận 9', address: '123 Đường Test', area: 200,
          estimatedBudget: 100000000, expectedOpenDate: '', personInCharge: picUsername, note: ''
        });
        DB.operationStoreOpenings.push(res.item);
        return res.item;
      }, PERSON_IN_CHARGE.username);
      recordId = result.id;
      assert(recordId, 'Phải trả về id hồ sơ mới');
      assertEqual(result.status, 'APPROVED', 'Mục H: hồ sơ phải tự APPROVED ngay lúc tạo, không cần ai duyệt');
      assertEqual(result.estimateStatus, 'DRAFT', 'estimateStatus mặc định phải là DRAFT');
      assertEqual(result.estimateItems.length, 0, 'estimateItems phải rỗng lúc mới tạo');
      assertEqual(result.personInCharge, PERSON_IN_CHARGE.username, 'personInCharge phải lưu đúng username đã resolve');
      assertEqual(result.personInChargeName, PERSON_IN_CHARGE.name, 'personInChargeName phải snapshot đúng tên hiển thị');
    });

    // ===== 1b) personInCharge không khớp tài khoản active nào -> 400 =====
    await run.run('personInCharge không khớp tài khoản active nào bị từ chối (400)', async () => {
      await loginAs(page, CREATOR);
      const result = await page.evaluate(async () => {
        try {
          await callCreateAction('operationStoreOpenings', {
            storeName: 'Siêu thị lỗi', address: 'X', area: 1, estimatedBudget: 1, expectedOpenDate: '', personInCharge: 'khong_ton_tai', note: ''
          });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      });
      assert(!result.ok, 'Phải bị chặn vì personInCharge không khớp tài khoản active nào');
      assertIncludes(result.message, 'Không tìm thấy', 'Thông báo lỗi phải nêu rõ không tìm thấy tài khoản');
    });

    // ===== 1c) Lập hồ sơ Sửa Chữa Siêu Thị — personInCharge field MỚI hoàn toàn (Mục C) =====
    await run.run('operationRepairCreate tạo hồ sơ Sửa Chữa — personInCharge field MỚI hoạt động đúng (Mục C)', async () => {
      await loginAs(page, CREATOR);
      const result = await page.evaluate(async (picUsername) => {
        const res = await callCreateAction('operationRepairs', {
          storeName: 'Siêu thị Sửa Chữa Test', title: 'Sửa hệ thống điện', amount: 20000000,
          supplier: 'Công ty Điện X', personInCharge: picUsername, description: 'Hư hỏng hệ thống điện khu kho'
        });
        DB.operationRepairs.push(res.item);
        return res.item;
      }, PERSON_IN_CHARGE.username);
      repairRecordId = result.id;
      assert(repairRecordId, 'Phải trả về id hồ sơ sửa chữa mới');
      assertEqual(result.status, 'APPROVED', 'Mục H: hồ sơ sửa chữa cũng tự APPROVED ngay lúc tạo');
      assertEqual(result.personInCharge, PERSON_IN_CHARGE.username, 'personInCharge (field mới) phải lưu đúng username');
      assertEqual(result.personInChargeName, PERSON_IN_CHARGE.name, 'personInChargeName phải snapshot đúng tên');
    });

    // ===== 2) Chặn tạo công việc Thực hiện khi Danh mục đầu tư CHƯA lưu (estimateStatus != APPROVED) =====
    await run.run('Chặn tạo công việc Thực hiện khi estimateStatus chưa APPROVED', async () => {
      await loginAs(page, EXECUTOR);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordCreate('operationWorkItems', {
            sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: null, title: 'Việc quá sớm'
          });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, recordId);
      assert(!result.ok, 'Phải bị chặn khi danh mục đầu tư chưa lưu xong');
      assertIncludes(result.message, 'chưa được phê duyệt', 'Thông báo lỗi phải nêu rõ lý do (message kỹ thuật giữ nguyên)');
    });

    // ===== 3) Người không có operationEstimateCreate không lập được Danh mục đầu tư =====
    await run.run('Người không có operationEstimateCreate bị chặn khi lưu Danh mục đầu tư', async () => {
      await loginAs(page, NOPERM);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationStoreOpenings', id, 'estimate/submit', {
            items: [{ content: 'Hạng mục A', description: '', amount: 1000000, note: '' }]
          });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, recordId);
      assert(!result.ok, 'Phải bị chặn vì thiếu quyền operationEstimateCreate');
      assertIncludes(result.message, 'quyền', 'Thông báo lỗi phải nêu thiếu quyền');
    });

    // ===== 4) Lập & lưu Danh mục đầu tư (Mục F cấu trúc mới + Mục H auto-APPROVED) =====
    await run.run('operationEstimateCreate lưu Danh mục đầu tư — cấu trúc {content,description,amount,note}, tự APPROVED NGAY (Mục H, không PENDING)', async () => {
      await loginAs(page, ESTIMATOR);
      const result = await page.evaluate(async (id) => {
        const res = await callRecordAction('operationStoreOpenings', id, 'estimate/submit', {
          items: [
            { content: 'Kệ trưng bày', description: 'Kệ inox 2 tầng', amount: 20000000, note: '' },
            { content: 'Hệ thống điện', description: '', amount: 50000000, note: 'Bao gồm nhân công' },
            { content: '', description: 'Dòng rỗng phải bị lọc bỏ', amount: 999, note: '' }
          ]
        });
        const idx = DB.operationStoreOpenings.findIndex(x => x.id === id);
        DB.operationStoreOpenings[idx] = res.item;
        return res.item;
      }, recordId);
      assertEqual(result.estimateStatus, 'APPROVED', 'Mục H: estimateStatus phải đi thẳng APPROVED, không qua PENDING');
      assertEqual(result.estimateCurrentStep, 0, 'estimateCurrentStep phải reset 0 (không còn bước duyệt)');
      assertEqual(result.estimateItems.length, 2, 'Dòng content rỗng phải bị lọc bỏ, chỉ còn 2 hạng mục hợp lệ');
      assertEqual(result.estimateTotalAmount, 70000000, 'Tổng Danh mục đầu tư phải tự tính đúng (20tr + 50tr)');
      assertEqual(result.estimateItems[0].content, 'Kệ trưng bày', 'Field content phải lưu đúng (không phải name)');
    });

    // ===== 4b) Tương thích ngược: hồ sơ CŨ có estimateItems dạng {name,...} — client load fallback content =====
    await run.run('Tương thích ngược: openOperationEstimateModal() load hồ sơ CŨ (field name) fallback đúng content', async () => {
      await loginAs(page, ESTIMATOR);
      const loaded = await page.evaluate(() => {
        const legacyRecord = {
          id: 999999001, code: 'MM-LEGACY', dept: 'Vận Hành', creatorName: 'Test',
          storeName: 'Hồ sơ cũ', estimateStatus: 'DRAFT', estimateHistory: [],
          estimateItems: [{ name: 'Hạng mục cũ', unit: 'Cái', qty: 2, unitPrice: 500000, amount: 1000000, note: 'Ghi chú cũ' }],
          estimatedBudget: 5000000
        };
        DB.operationStoreOpenings.push(legacyRecord);
        openOperationEstimateModal('operationStoreOpenings', legacyRecord.id);
        const items = JSON.parse(JSON.stringify(operationEstimateItems));
        closeOperationEstimateModal();
        DB.operationStoreOpenings = DB.operationStoreOpenings.filter(x => x.id !== legacyRecord.id);
        return items;
      });
      assertEqual(loaded.length, 1, 'Phải load đúng 1 dòng từ hồ sơ cũ');
      assertEqual(loaded[0].content, 'Hạng mục cũ', 'content phải fallback từ field "name" cũ (it.content ?? it.name)');
      assertEqual(loaded[0].amount, 1000000, 'amount phải giữ nguyên giá trị cũ');
    });

    // ===== 5) Kỳ Thực Hiện — Mục B: giờ KHÔNG BẮT BUỘC =====
    await run.run('Người không có operationExecutionManage bị chặn tạo Kỳ Thực Hiện', async () => {
      await loginAs(page, NOPERM);
      const result = await page.evaluate(async (id) => {
        try {
          await callCreateAction('operationExecutionPeriods', { sourceType: 'OPERATION_STORE_OPENING', sourceId: id, name: 'Đợt 1' });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, recordId);
      assert(!result.ok, 'Phải bị chặn vì thiếu quyền operationExecutionManage');
      assertIncludes(result.message, 'quyền', 'Thông báo lỗi phải nêu thiếu quyền');
    });

    await run.run('Mục B: tạo công việc GỐC KHÔNG chọn Kỳ Thực Hiện — thành công, periodId/periodName = null', async () => {
      await loginAs(page, EXECUTOR);
      const result = await page.evaluate(async (id) => {
        const res = await callRecordCreate('operationWorkItems', {
          sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: null,
          title: 'Việc gốc không thuộc kỳ nào', description: '', deadline: ''
        });
        DB.operationWorkItems.push(res.item);
        return res.item;
      }, recordId);
      assert(result.id, 'Phải tạo được công việc gốc dù không chọn Kỳ Thực Hiện');
      assertEqual(result.periodId, null, 'periodId phải là null khi không chọn kỳ');
      assertEqual(result.periodName, null, 'periodName phải là null khi không chọn kỳ');
      assertEqual(result.status, 'CHUA_BAT_DAU', 'status vẫn khởi tạo bình thường');
      // Dọn ngay việc này (chỉ dùng để xác nhận hành vi Mục B) — không để CHUA_BAT_DAU lơ lửng dưới
      // recordId, sẽ chặn nhầm bước "Xác Nhận Đưa Vào Sử Dụng" ở Phần B cuối bài test (đòi TOÀN BỘ cây
      // công việc của hồ sơ đã Đã nghiệm thu).
      await page.evaluate((id) => { DB.operationWorkItems = DB.operationWorkItems.filter(w => w.id !== id); }, result.id);
      await page.evaluate(async (id) => { await callRecordAction('operationWorkItems', id, 'delete', {}); }, result.id);
    });

    await run.run('operationExecutionManage tạo Kỳ Thực Hiện — mặc định trạng thái CHUA_BAT_DAU', async () => {
      await loginAs(page, EXECUTOR);
      const result = await page.evaluate(async (id) => {
        const res = await callCreateAction('operationExecutionPeriods', { sourceType: 'OPERATION_STORE_OPENING', sourceId: id, name: 'Đợt 1 - Thi công nội thất' });
        DB.operationExecutionPeriods.push(res.item);
        return res.item;
      }, recordId);
      periodId = result.id;
      assert(periodId, 'Phải trả về id kỳ mới');
      assertEqual(result.status, 'CHUA_BAT_DAU', 'Kỳ mới tạo phải ở trạng thái CHUA_BAT_DAU');
    });

    await run.run('CÓ chọn Kỳ Thực Hiện nhưng kỳ đang CHUA_BAT_DAU vẫn bị chặn (chỉ optional khi KHÔNG chọn, không nới luật khi có chọn)', async () => {
      await loginAs(page, EXECUTOR);
      const result = await page.evaluate(async ({ id, pid }) => {
        try {
          await callRecordCreate('operationWorkItems', {
            sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: null, title: 'Việc gốc quá sớm', periodId: pid
          });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, { id: recordId, pid: periodId });
      assert(!result.ok, 'Phải bị chặn vì kỳ đã chọn chưa bắt đầu');
      assertIncludes(result.message, 'chưa bắt đầu', 'Thông báo lỗi phải nêu rõ kỳ chưa bắt đầu');
    });

    await run.run('Người không có operationExecutionManage bị chặn Bắt Đầu Kỳ', async () => {
      await loginAs(page, NOPERM);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationExecutionPeriods', id, 'start', {});
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, periodId);
      assert(!result.ok, 'Phải bị chặn vì thiếu quyền operationExecutionManage');
    });

    await run.run('operationExecutionManage bắt đầu Kỳ Thực Hiện — chuyển DANG_THUC_HIEN', async () => {
      await loginAs(page, EXECUTOR);
      const result = await page.evaluate(async (id) => {
        const res = await callRecordAction('operationExecutionPeriods', id, 'start', {});
        const idx = DB.operationExecutionPeriods.findIndex(x => x.id === id);
        DB.operationExecutionPeriods[idx] = res.item;
        return res.item;
      }, periodId);
      assertEqual(result.status, 'DANG_THUC_HIEN', 'Kỳ phải chuyển DANG_THUC_HIEN sau khi bắt đầu');
    });

    // ===== 6) Tạo cây công việc gốc (đúng kỳ) + 2 việc con — Mục E: assignedTo[] NHIỀU người + Mục D
    //          acceptanceMode DELAYED =====
    await run.run('Tạo cây công việc gốc + 2 việc con — assignedTo[] NHIỀU người, acceptanceMode DELAYED, việc con KẾ THỪA đúng periodId của cha', async () => {
      await loginAs(page, EXECUTOR);
      const result = await page.evaluate(async ({ id, pid, w1, w2, acceptorUsername, acceptorName }) => {
        const rootRes = await callRecordCreate('operationWorkItems', {
          sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: null,
          title: 'Thi công nội thất', description: '', assignedTo: [], deadline: '', periodId: pid
        });
        DB.operationWorkItems.push(rootRes.item);
        // child1: NHIỀU người phụ trách (w1+w2) + acceptorUsername + Nghiệm thu SAU 3 ngày — cố tình gửi
        // periodId GIẢ (9999999) để xác nhận server KHÔNG tin, luôn kế thừa đúng periodId của cha.
        const child1Res = await callRecordCreate('operationWorkItems', {
          sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: rootRes.item.id,
          title: 'Lắp đèn', description: '', assignedTo: [w1, w2],
          acceptorUsername, acceptorName, deadline: '', periodId: 9999999,
          acceptanceMode: 'DELAYED', acceptanceDelayDays: 3
        });
        DB.operationWorkItems.push(child1Res.item);
        const child2Res = await callRecordCreate('operationWorkItems', {
          sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: rootRes.item.id,
          title: 'Sơn tường', description: '', assignedTo: [], deadline: ''
        });
        DB.operationWorkItems.push(child2Res.item);
        return { root: rootRes.item, child1: child1Res.item, child2: child2Res.item };
      }, { id: recordId, pid: periodId, w1: WORKER.username, w2: WORKER2.username, acceptorUsername: DESIGNATED_ACCEPTOR.username, acceptorName: DESIGNATED_ACCEPTOR.name });
      rootWorkItemId = result.root.id;
      child1Id = result.child1.id;
      child2Id = result.child2.id;
      assertEqual(result.root.status, 'CHUA_BAT_DAU', 'Việc gốc mới tạo phải ở trạng thái CHUA_BAT_DAU');
      assertEqual(result.root.periodId, periodId, 'Việc gốc phải gắn đúng periodId đã chọn');
      assertEqual(result.child1.parentWorkItemId, rootWorkItemId, 'Việc con phải gắn đúng parentWorkItemId');
      assertEqual(result.child1.periodId, periodId, 'Việc con phải KẾ THỪA đúng periodId của cha, không dùng periodId giả từ payload');
      assertEqual(result.child1.assignedTo.length, 2, 'Việc con 1 phải có ĐÚNG 2 người phụ trách (Mục E)');
      assert(result.child1.assignedTo.includes(WORKER.username) && result.child1.assignedTo.includes(WORKER2.username), 'assignedTo phải chứa đúng cả 2 username');
      assertEqual(result.child1.assignedToName.length, 2, 'assignedToName phải cùng số lượng, song song thứ tự với assignedTo');
      assertEqual(result.child1.acceptorUsername, DESIGNATED_ACCEPTOR.username, 'Việc con 1 phải gán đúng người nghiệm thu chỉ định');
      assertEqual(result.child1.acceptanceMode, 'DELAYED', 'acceptanceMode phải lưu đúng DELAYED');
      assertEqual(result.child1.acceptanceDelayDays, 3, 'acceptanceDelayDays phải lưu đúng 3');
      assertEqual(result.child2.acceptanceMode, 'IMMEDIATE', 'Mặc định acceptanceMode phải là IMMEDIATE khi không chọn');
      assertEqual(result.child2.acceptanceDelayDays, null, 'acceptanceDelayDays phải null khi IMMEDIATE');
    });

    // ===== 6b) acceptanceMode DELAYED bắt buộc acceptanceDelayDays nguyên dương =====
    await run.run('acceptanceMode DELAYED thiếu/sai acceptanceDelayDays bị từ chối', async () => {
      await loginAs(page, EXECUTOR);
      const result = await page.evaluate(async ({ id, rootId }) => {
        try {
          await callRecordCreate('operationWorkItems', {
            sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: rootId,
            title: 'Việc lỗi acceptance', acceptanceMode: 'DELAYED', acceptanceDelayDays: 0
          });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, { id: recordId, rootId: rootWorkItemId });
      assert(!result.ok, 'Phải bị chặn vì acceptanceDelayDays không hợp lệ (0)');
      assertIncludes(result.message, 'ngày nghiệm thu', 'Thông báo lỗi phải nêu rõ số ngày nghiệm thu không hợp lệ');
    });

    // ===== 6c) resolveOperationAssignedTo từ chối username không khớp tài khoản active =====
    await run.run('assignedTo chứa username không khớp tài khoản active bị từ chối', async () => {
      await loginAs(page, EXECUTOR);
      const result = await page.evaluate(async ({ id, rootId }) => {
        try {
          await callRecordCreate('operationWorkItems', {
            sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: rootId,
            title: 'Việc gán sai người', assignedTo: ['vh_inactive']
          });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, { id: recordId, rootId: rootWorkItemId });
      assert(!result.ok, 'Phải bị chặn vì assignedTo chứa tài khoản đã khoá (INACTIVE_USER)');
      assertIncludes(result.message, 'Không tìm thấy', 'Thông báo lỗi phải nêu rõ không tìm thấy tài khoản người phụ trách');
    });

    // ===== 7) Chặn cập nhật trực tiếp việc CÓ CON =====
    await run.run('Chặn cập nhật tiến độ trực tiếp cho công việc CÓ việc con', async () => {
      await loginAs(page, EXECUTOR);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_THUC_HIEN' });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, rootWorkItemId);
      assert(!result.ok, 'Phải bị chặn vì việc gốc có việc con');
      assertIncludes(result.message, 'việc con', 'Thông báo lỗi phải nêu lý do có việc con');
    });

    // ===== 8) Người không có quyền VÀ không nằm trong assignedTo[] bị chặn cập nhật =====
    await run.run('Người không có operationExecutionManage và KHÔNG nằm trong assignedTo[] bị chặn cập nhật tiến độ', async () => {
      await loginAs(page, NOPERM);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_THUC_HIEN' });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, child1Id);
      assert(!result.ok, 'Phải bị chặn vì thiếu quyền operationExecutionManage và không thuộc assignedTo[]');
    });

    // ===== 9) Mục E: CẢ 2 người trong assignedTo[] đều tự cập nhật được (không cần quyền rộng) =====
    await run.run('WORKER (1 trong 2 người assignedTo[], không có operationExecutionManage) tự cập nhật ĐÚNG việc mình phụ trách', async () => {
      await loginAs(page, WORKER);
      const result = await page.evaluate(async (id) => {
        const r = await callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_THUC_HIEN' });
        const idx = DB.operationWorkItems.findIndex(x => x.id === id);
        DB.operationWorkItems[idx] = r.item;
        return r.item;
      }, child1Id);
      assertEqual(result.status, 'DANG_THUC_HIEN', 'WORKER phải tự cập nhật được (nằm trong assignedTo[])');
    });

    await run.run('WORKER2 (người THỨ 2 trong assignedTo[] của CÙNG việc) cũng tự cập nhật được — nộp nghiệm thu, completedAt tự set (Mục D)', async () => {
      await loginAs(page, WORKER2);
      const result = await page.evaluate(async (id) => {
        const r = await callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_NGHIEM_THU' });
        const idx = DB.operationWorkItems.findIndex(x => x.id === id);
        DB.operationWorkItems[idx] = r.item;
        return r.item;
      }, child1Id);
      assertEqual(result.status, 'DANG_NGHIEM_THU', 'WORKER2 (người thứ 2 trong assignedTo[]) cũng phải cập nhật được đúng việc này');
      assert(result.completedAt, 'Mục D: completedAt phải tự set khi chuyển DANG_NGHIEM_THU');
    });

    // ===== 10) Người phụ trách KHÔNG cập nhật được việc KHÁC (không thuộc assignedTo[] của việc đó) =====
    await run.run('WORKER bị chặn cập nhật việc KHÁC (assignedTo rỗng, không phải mình phụ trách)', async () => {
      await loginAs(page, WORKER);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_THUC_HIEN' });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, child2Id);
      assert(!result.ok, 'Phải bị chặn vì WORKER không thuộc assignedTo[] của việc con 2 (assignedTo rỗng)');
    });

    // ===== 11) Toàn quyền (EXECUTOR) vẫn cập nhật được MỌI việc =====
    await run.run('Toàn quyền (operationExecutionManage) vẫn cập nhật được mọi việc — đưa việc con 2 lên Đang nghiệm thu', async () => {
      await loginAs(page, EXECUTOR);
      const result = await page.evaluate(async (id) => {
        let r = await callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_THUC_HIEN' });
        let idx = DB.operationWorkItems.findIndex(x => x.id === id);
        DB.operationWorkItems[idx] = r.item;
        r = await callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_NGHIEM_THU' });
        idx = DB.operationWorkItems.findIndex(x => x.id === id);
        DB.operationWorkItems[idx] = r.item;
        return r.item;
      }, child2Id);
      assertEqual(result.status, 'DANG_NGHIEM_THU', 'Việc con 2 phải ở trạng thái Đang nghiệm thu (toàn quyền thao tác được)');
    });

    // ===== 12) "Bổ sung" (REQUEST_INFO) chỉ ghi lý do, KHÔNG đổi trạng thái =====
    await run.run('"Bổ sung" (REQUEST_INFO) chỉ ghi lý do, KHÔNG đổi trạng thái công việc', async () => {
      await loginAs(page, ACCEPTOR);
      const result = await page.evaluate(async (id) => {
        const r = await callRecordAction('operationWorkItems', id, 'accept', { action: 'REQUEST_INFO', reason: 'Chưa đúng màu sơn, làm lại' });
        const idx = DB.operationWorkItems.findIndex(x => x.id === id);
        DB.operationWorkItems[idx] = r.item;
        return r.item;
      }, child1Id);
      assertEqual(result.status, 'DANG_NGHIEM_THU', 'Trạng thái phải GIỮ NGUYÊN Đang nghiệm thu sau khi Bổ sung');
      const lastEntry = result.history[result.history.length - 1];
      assertEqual(lastEntry.action, 'REQUEST_INFO', 'Lịch sử phải ghi nhận hành động REQUEST_INFO');
      assertEqual(lastEntry.note, 'Chưa đúng màu sơn, làm lại', 'Lịch sử phải lưu đúng lý do');
    });

    // ===== 13) Nghiệm thu/Bổ sung bắt buộc phải có lý do =====
    await run.run('Nghiệm thu/Bổ sung bắt buộc phải nhập lý do', async () => {
      await loginAs(page, ACCEPTOR);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationWorkItems', id, 'accept', { action: 'ACCEPT', reason: '' });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, child1Id);
      assert(!result.ok, 'Phải bị chặn khi không nhập lý do');
      assertIncludes(result.message, 'lý do', 'Thông báo lỗi phải nêu rõ cần lý do');
    });

    // ===== 14) Người không có quyền VÀ không phải người được chỉ định bị chặn nghiệm thu =====
    await run.run('Người không có operationAcceptanceManage và KHÔNG phải người được chỉ định bị chặn nghiệm thu', async () => {
      await loginAs(page, NOPERM);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationWorkItems', id, 'accept', { action: 'ACCEPT', reason: 'test' });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, child1Id);
      assert(!result.ok, 'Phải bị chặn vì thiếu quyền operationAcceptanceManage và không phải người được chỉ định');
    });

    // ===== 15) Người được CHỈ ĐỊNH (không có quyền rộng) nghiệm thu ĐÚNG việc của mình =====
    await run.run('DESIGNATED_ACCEPTOR (acceptorUsername, không có operationAcceptanceManage) nghiệm thu ĐÚNG việc được chỉ định — cha CHƯA tự chuyển vì còn con 2 dở', async () => {
      await loginAs(page, DESIGNATED_ACCEPTOR);
      const result = await page.evaluate(async ({ c1, rootId }) => {
        const r = await callRecordAction('operationWorkItems', c1, 'accept', { action: 'ACCEPT', reason: 'Đạt yêu cầu' });
        const idx = DB.operationWorkItems.findIndex(x => x.id === c1);
        DB.operationWorkItems[idx] = r.item;
        const root = DB.operationWorkItems.find(x => x.id === rootId);
        return { child1: r.item, root };
      }, { c1: child1Id, rootId: rootWorkItemId });
      assertEqual(result.child1.status, 'DA_NGHIEM_THU', 'Việc con 1 phải chuyển Đã nghiệm thu');
      assertEqual(result.child1.acceptedBy, DESIGNATED_ACCEPTOR.username, 'Phải ghi nhận đúng người nghiệm thu (DESIGNATED_ACCEPTOR)');
    });

    // ===== 16) Người được chỉ định của việc con 1 KHÔNG nghiệm thu được việc con 2 (không phải của mình) =====
    await run.run('DESIGNATED_ACCEPTOR bị chặn nghiệm thu việc KHÁC (không được chỉ định trên việc đó)', async () => {
      await loginAs(page, DESIGNATED_ACCEPTOR);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationWorkItems', id, 'accept', { action: 'ACCEPT', reason: 'Đạt yêu cầu' });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, child2Id);
      assert(!result.ok, 'Phải bị chặn vì DESIGNATED_ACCEPTOR không được chỉ định trên việc con 2');
    });

    // ===== 17) Toàn quyền (ACCEPTOR) nghiệm thu nốt việc con 2 — cha TỰ ĐỘNG chuyển Đã nghiệm thu =====
    await run.run('Toàn quyền (operationAcceptanceManage) nghiệm thu nốt việc con 2 — cha tự động cập nhật Đã nghiệm thu (hết việc con dở)', async () => {
      await loginAs(page, ACCEPTOR);
      const result = await page.evaluate(async ({ c2, rootId }) => {
        const r = await callRecordAction('operationWorkItems', c2, 'accept', { action: 'ACCEPT', reason: 'Đạt yêu cầu' });
        const idx = DB.operationWorkItems.findIndex(x => x.id === c2);
        DB.operationWorkItems[idx] = r.item;
        syncOperationWorkItemAncestorsClient(r.item.parentWorkItemId);
        const root = DB.operationWorkItems.find(x => x.id === rootId);
        return { child2: r.item, root };
      }, { c2: child2Id, rootId: rootWorkItemId });
      assertEqual(result.child2.status, 'DA_NGHIEM_THU', 'Việc con 2 phải chuyển Đã nghiệm thu');
      assertEqual(result.root.status, 'DA_NGHIEM_THU', 'Việc cha phải TỰ ĐỘNG chuyển Đã nghiệm thu khi hết việc con dở');
    });

    // ===== Phần A: Quyền SỬA công việc theo "Người Phụ Trách" hồ sơ gốc (Mục E) =====
    let editItemId = null;
    await run.run('EXECUTOR tạo việc gốc mới để test Sửa + quyền theo Người Phụ Trách + Xác nhận đưa vào sử dụng', async () => {
      await loginAs(page, EXECUTOR);
      const result = await page.evaluate(async ({ id, pid }) => {
        const res = await callRecordCreate('operationWorkItems', {
          sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: null,
          title: 'Việc gốc test Sửa', description: 'Mô tả ban đầu', assignedTo: [],
          acceptorUsername: null, acceptorName: null, deadline: '', periodId: pid
        });
        DB.operationWorkItems.push(res.item);
        return res.item;
      }, { id: recordId, pid: periodId });
      editItemId = result.id;
      assert(editItemId, 'Phải tạo được việc gốc mới');
    });

    await run.run('Người không có operationExecutionManage VÀ không phải personInCharge hồ sơ bị chặn Sửa công việc', async () => {
      await loginAs(page, NOPERM);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationWorkItems', id, 'edit', { title: 'Việc bị sửa trộm' });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, editItemId);
      assert(!result.ok, 'Phải bị chặn vì không có quyền operationExecutionManage và không phải personInCharge');
    });

    await run.run('Mục E: PERSON_IN_CHARGE (personInCharge của hồ sơ, KHÔNG có operationExecutionManage) SỬA được công việc thuộc ĐÚNG hồ sơ đó', async () => {
      await loginAs(page, PERSON_IN_CHARGE);
      const result = await page.evaluate(async (id) => {
        const r = await callRecordAction('operationWorkItems', id, 'edit', {
          title: 'Việc gốc sửa bởi Người Phụ Trách', description: 'Sửa bởi PIC', assignedTo: [], deadline: ''
        });
        const idx = DB.operationWorkItems.findIndex(x => x.id === id);
        DB.operationWorkItems[idx] = r.item;
        return r.item;
      }, editItemId);
      assertEqual(result.title, 'Việc gốc sửa bởi Người Phụ Trách', 'PERSON_IN_CHARGE phải sửa được title dù không có operationExecutionManage');
    });

    await run.run('Mục E: PERSON_IN_CHARGE KHÔNG tạo được công việc (chỉ mở quyền SỬA, không mở tạo/xoá)', async () => {
      await loginAs(page, PERSON_IN_CHARGE);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordCreate('operationWorkItems', { sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: null, title: 'PIC cố tạo việc mới' });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, recordId);
      assert(!result.ok, 'PERSON_IN_CHARGE KHÔNG được tạo công việc mới (đúng phạm vi hẹp đã chốt)');
    });

    await run.run('Mục E: PERSON_IN_CHARGE KHÔNG xoá được công việc (chỉ mở quyền SỬA, không mở tạo/xoá)', async () => {
      await loginAs(page, PERSON_IN_CHARGE);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationWorkItems', id, 'delete', {});
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, editItemId);
      assert(!result.ok, 'PERSON_IN_CHARGE KHÔNG được xoá công việc (đúng phạm vi hẹp đã chốt)');
    });

    await run.run('Mục E: PERSON_IN_CHARGE KHÔNG sửa được công việc thuộc hồ sơ KHÁC (nơi họ không phải personInCharge)', async () => {
      // Tạo 1 hồ sơ sửa chữa + việc gốc RIÊNG với personInCharge khác (CREATOR không phải PERSON_IN_CHARGE
      // của hồ sơ này) để xác nhận phạm vi quyền CHỈ đúng 1 hồ sơ, không lan sang hồ sơ khác.
      // repairRecordId (hồ sơ sửa chữa) CŨNG có personInCharge = PERSON_IN_CHARGE ở seed test 1c — đổi
      // sang 1 hồ sơ MỚI có personInCharge KHÁC (CREATOR) để test đúng phạm vi cách ly.
      await loginAs(page, CREATOR);
      const newRepairId = await page.evaluate(async () => {
        const newRepair = await callCreateAction('operationRepairs', {
          storeName: 'Siêu thị Sửa Chữa Khác', title: 'Việc khác', amount: 1000000,
          supplier: '', personInCharge: 'vh_creator', description: ''
        });
        DB.operationRepairs.push(newRepair.item);
        return newRepair.item.id;
      });
      await loginAs(page, ESTIMATOR);
      await page.evaluate(async (id) => {
        // Mục H: estimate/submit tự đưa estimateStatus thẳng APPROVED (không cần ai duyệt thêm) — cập
        // nhật lại đúng bản ghi trả về, không cần can thiệp thủ công.
        const estRes = await callRecordAction('operationRepairs', id, 'estimate/submit', { items: [{ content: 'X', amount: 100, description: '', note: '' }] });
        const estIdx = DB.operationRepairs.findIndex(x => x.id === id);
        DB.operationRepairs[estIdx] = estRes.item;
      }, newRepairId);
      await loginAs(page, EXECUTOR);
      const otherWorkItemId = await page.evaluate(async (id) => {
        const wi = await callRecordCreate('operationWorkItems', {
          sourceType: 'OPERATION_REPAIR', sourceId: id, parentWorkItemId: null, title: 'Việc hồ sơ khác'
        });
        DB.operationWorkItems.push(wi.item);
        return wi.item.id;
      }, newRepairId);
      await loginAs(page, PERSON_IN_CHARGE);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationWorkItems', id, 'edit', { title: 'PIC cố sửa việc hồ sơ khác' });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, otherWorkItemId);
      assert(!result.ok, 'PERSON_IN_CHARGE KHÔNG được sửa công việc của hồ sơ mà họ KHÔNG phải personInCharge');
    });

    await run.run('EXECUTOR (toàn quyền) Sửa công việc — cập nhật title/mô tả/assignedTo[]/người nghiệm thu/hạn/acceptanceMode, KHÔNG đổi periodId/status', async () => {
      await loginAs(page, EXECUTOR);
      const result = await page.evaluate(async ({ id, w1, acceptorUsername, acceptorName }) => {
        const r = await callRecordAction('operationWorkItems', id, 'edit', {
          title: 'Việc gốc ĐÃ SỬA', description: 'Mô tả đã cập nhật',
          assignedTo: [w1],
          acceptorUsername, acceptorName, deadline: '2026-12-31',
          acceptanceMode: 'DELAYED', acceptanceDelayDays: 5
        });
        const idx = DB.operationWorkItems.findIndex(x => x.id === id);
        DB.operationWorkItems[idx] = r.item;
        return r.item;
      }, { id: editItemId, w1: WORKER.username, acceptorUsername: ACCEPTOR.username, acceptorName: ACCEPTOR.name });
      assertEqual(result.title, 'Việc gốc ĐÃ SỬA', 'Title phải được cập nhật');
      assertEqual(result.description, 'Mô tả đã cập nhật', 'Mô tả phải được cập nhật');
      assertEqual(result.assignedTo.length, 1, 'assignedTo[] phải cập nhật đúng 1 người');
      assertEqual(result.assignedTo[0], WORKER.username, 'Người phụ trách phải được cập nhật đúng');
      assertEqual(result.acceptorUsername, ACCEPTOR.username, 'Người nghiệm thu chỉ định phải được cập nhật');
      assertEqual(result.deadline, '2026-12-31', 'Hạn phải được cập nhật');
      assertEqual(result.acceptanceMode, 'DELAYED', 'acceptanceMode phải được cập nhật');
      assertEqual(result.acceptanceDelayDays, 5, 'acceptanceDelayDays phải được cập nhật');
      assertEqual(result.periodId, periodId, 'periodId KHÔNG được đổi khi sửa');
      assertEqual(result.status, 'CHUA_BAT_DAU', 'status KHÔNG được đổi khi sửa');
    });

    // ===== Phần B: Xác nhận đưa vào sử dụng =====
    await run.run('Chặn Xác nhận đưa vào sử dụng khi còn việc chưa nghiệm thu xong', async () => {
      await loginAs(page, USE_CONFIRMER);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationStoreOpenings', id, 'confirm-use', {});
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, recordId);
      assert(!result.ok, 'Phải bị chặn vì việc gốc test Sửa vẫn còn CHUA_BAT_DAU');
    });

    await run.run('Người không có operationUseConfirm bị chặn Xác nhận đưa vào sử dụng (dù có operationExecutionManage)', async () => {
      await loginAs(page, EXECUTOR);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationStoreOpenings', id, 'confirm-use', {});
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, recordId);
      assert(!result.ok, 'Phải bị chặn vì thiếu quyền operationUseConfirm riêng');
    });

    await run.run('Hoàn tất việc gốc test Sửa (Bắt Đầu -> Nộp Nghiệm Thu -> Nghiệm Thu) để đủ điều kiện xác nhận', async () => {
      await loginAs(page, EXECUTOR);
      await page.evaluate(async (id) => {
        const r1 = await callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_THUC_HIEN' });
        const idx1 = DB.operationWorkItems.findIndex(x => x.id === id);
        DB.operationWorkItems[idx1] = r1.item;
        const r2 = await callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_NGHIEM_THU' });
        const idx2 = DB.operationWorkItems.findIndex(x => x.id === id);
        DB.operationWorkItems[idx2] = r2.item;
      }, editItemId);
      await loginAs(page, ACCEPTOR);
      const result = await page.evaluate(async (id) => {
        const r = await callRecordAction('operationWorkItems', id, 'accept', { action: 'ACCEPT', reason: 'Đạt yêu cầu' });
        const idx = DB.operationWorkItems.findIndex(x => x.id === id);
        DB.operationWorkItems[idx] = r.item;
        return r.item;
      }, editItemId);
      assertEqual(result.status, 'DA_NGHIEM_THU', 'Việc gốc test Sửa phải chuyển Đã nghiệm thu');
    });

    await run.run('USE_CONFIRMER (quyền operationUseConfirm riêng, KHÔNG phải toàn quyền) Xác nhận đưa vào sử dụng thành công khi toàn bộ cây đã nghiệm thu', async () => {
      await loginAs(page, USE_CONFIRMER);
      const result = await page.evaluate(async (id) => {
        const r = await callRecordAction('operationStoreOpenings', id, 'confirm-use', {});
        const idx = DB.operationStoreOpenings.findIndex(x => x.id === id);
        DB.operationStoreOpenings[idx] = r.item;
        return r.item;
      }, recordId);
      assertEqual(result.useConfirmStatus, 'CONFIRMED', 'useConfirmStatus phải chuyển CONFIRMED');
      assertEqual(result.useConfirmBy, USE_CONFIRMER.username, 'Phải ghi nhận đúng người xác nhận');
    });

    await run.run('Chặn xác nhận đưa vào sử dụng LẦN 2 (đã CONFIRMED trước đó)', async () => {
      await loginAs(page, USE_CONFIRMER);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationStoreOpenings', id, 'confirm-use', {});
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, recordId);
      assert(!result.ok, 'Phải bị chặn vì hồ sơ đã được xác nhận đưa vào sử dụng trước đó');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exitCode = 1;
});
