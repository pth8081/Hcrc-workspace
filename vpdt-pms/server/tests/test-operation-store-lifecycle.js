// server/tests/test-operation-store-lifecycle.js
//
// Regression test cho vòng đời "dự án nhỏ" của tab Vận Hành > 🏬 Siêu Thị:
//   Mở mới/Sửa chữa (hồ sơ chính, dept-workflow có sẵn) -> Dự toán (workflow ĐỘC LẬP song song, field
//   phẳng estimate* trên chính bản ghi, xem lib/workflowEngine.js operationStoreOpeningEstimate) ->
//   Kỳ Thực Hiện (mỗi hồ sơ có danh sách kỳ riêng, phải "Bắt Đầu" mới chọn được để tạo việc gốc) ->
//   Thực hiện (cây công việc đa cấp dbo.OperationWorkItems, mock qua state.operationWorkItems — CHỈ
//   toàn quyền HOẶC đúng người phụ trách (assignedTo) mới cập nhật được) -> Nghiệm thu (CHỈ toàn quyền
//   HOẶC đúng người được CHỈ ĐỊNH (acceptorUsername) mới nghiệm thu được; Nghiệm thu đổi trạng thái / Bổ
//   sung KHÔNG đổi trạng thái) -> cha tự cập nhật khi mọi con đã nghiệm thu
//   (recordActions.computeParentWorkItemStatus, mirror ở testHarness.js
//   syncOperationWorkItemAncestorsInState()).
//
// 3 quyền TÁCH RIÊNG cho 3 giai đoạn (operationEstimateCreate/operationExecutionManage/
// operationAcceptanceManage) — bài test xác nhận cả state-machine LẪN việc mỗi quyền chỉ làm được
// đúng việc của mình (không lẫn quyền), CỘNG THÊM ràng buộc mới: người không giữ quyền rộng nhưng được
// gán/chỉ định trực tiếp trên MỘT việc cụ thể cũng thao tác được ĐÚNG việc đó (không phải việc khác).
//
// Chạy: node server/tests/test-operation-store-lifecycle.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual, assertIncludes
} = require('./testHarness');

const PORT = 8986;

// ===================== Seed dữ liệu =====================
const CREATOR = { username: 'vh_creator', name: 'Người Tạo Hồ Sơ', dept: 'Vận Hành', perms: { operationStoreOpenCreate: true }, active: true };
const ESTIMATOR = { username: 'vh_estimator', name: 'Người Lập Dự Toán', dept: 'Vận Hành', perms: { operationEstimateCreate: true }, active: true };
const ESTIMATE_APPROVER = { username: 'vh_est_approver', name: 'Người Duyệt Dự Toán', dept: 'Ban Giám Đốc', perms: {}, active: true };
const EXECUTOR = { username: 'vh_executor', name: 'Người Thực Hiện', dept: 'Vận Hành', perms: { operationExecutionManage: true }, active: true };
const ACCEPTOR = { username: 'vh_acceptor', name: 'Người Nghiệm Thu', dept: 'Vận Hành', perms: { operationAcceptanceManage: true }, active: true };
const NOPERM = { username: 'vh_noperm', name: 'Người Không Quyền', dept: 'Vận Hành', perms: {}, active: true };
const WORKER = { username: 'vh_worker', name: 'Kỹ Thuật Viên Được Gán', dept: 'Vận Hành', perms: {}, active: true };
const DESIGNATED_ACCEPTOR = { username: 'vh_designated_acceptor', name: 'Người Được Chỉ Định Nghiệm Thu', dept: 'Vận Hành', perms: {}, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Vận Hành', perms: { admin: true }, active: true, totpEnabled: true };

const state = createMockState({
  depts: ['Vận Hành', 'Ban Giám Đốc'],
  users: [CREATOR, ESTIMATOR, ESTIMATE_APPROVER, EXECUTOR, ACCEPTOR, NOPERM, WORKER, DESIGNATED_ACCEPTOR, ADMIN],
  workflows: [{ id: 'WF_ESTIMATE_STORE', steps: [{ order: 1, name: 'Ban Giám Đốc duyệt dự toán' }] }],
  operationStoreOpenEstimateDeptWorkflows: {
    'Vận Hành': { workflowId: 'WF_ESTIMATE_STORE', approvers: { 1: ['vh_est_approver'] } }
  }
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
  let periodId = null;
  let rootWorkItemId = null;
  let child1Id = null;
  let child2Id = null;

  try {
    // ===== 1) Tạo hồ sơ Mở mới siêu thị =====
    await run.run('operationStoreOpenCreate tạo hồ sơ Mở mới siêu thị — estimateStatus mặc định DRAFT', async () => {
      await loginAs(page, CREATOR);
      const result = await page.evaluate(async () => {
        const res = await callCreateAction('operationStoreOpenings', {
          storeName: 'Siêu thị Test Quận 9', address: '123 Đường Test', area: 200,
          estimatedBudget: 5000000000, expectedOpenDate: '', personInCharge: 'Nguyễn Văn A', note: ''
        });
        DB.operationStoreOpenings.push(res.item);
        return res.item;
      });
      recordId = result.id;
      assert(recordId, 'Phải trả về id hồ sơ mới');
      assertEqual(result.estimateStatus, 'DRAFT', 'estimateStatus mặc định phải là DRAFT');
      assertEqual(result.estimateItems.length, 0, 'estimateItems phải rỗng lúc mới tạo');
    });

    // ===== 2) Chặn tạo công việc Thực hiện khi Dự toán CHƯA duyệt =====
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
      assert(!result.ok, 'Phải bị chặn khi dự toán chưa duyệt xong');
      assertIncludes(result.message, 'chưa được phê duyệt', 'Thông báo lỗi phải nêu rõ lý do');
    });

    // ===== 3) Người không có operationEstimateCreate không lập được dự toán =====
    await run.run('Người không có operationEstimateCreate bị chặn khi gửi dự toán', async () => {
      await loginAs(page, NOPERM);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationStoreOpenings', id, 'estimate/submit', {
            items: [{ name: 'Hạng mục A', unit: 'Bộ', qty: 2, unitPrice: 1000000 }]
          });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, recordId);
      assert(!result.ok, 'Phải bị chặn vì thiếu quyền operationEstimateCreate');
      assertIncludes(result.message, 'quyền', 'Thông báo lỗi phải nêu thiếu quyền');
    });

    // ===== 4) Lập & gửi dự toán =====
    await run.run('operationEstimateCreate lập & gửi dự toán — tự tính tổng tiền, chuyển PENDING', async () => {
      await loginAs(page, ESTIMATOR);
      const result = await page.evaluate(async (id) => {
        const res = await callRecordAction('operationStoreOpenings', id, 'estimate/submit', {
          items: [
            { name: 'Kệ trưng bày', unit: 'Bộ', qty: 10, unitPrice: 2000000, note: '' },
            { name: 'Hệ thống điện', unit: 'Gói', qty: 1, unitPrice: 50000000, note: '' }
          ]
        });
        const idx = DB.operationStoreOpenings.findIndex(x => x.id === id);
        DB.operationStoreOpenings[idx] = res.item;
        return res.item;
      }, recordId);
      assertEqual(result.estimateStatus, 'PENDING', 'estimateStatus phải chuyển PENDING sau khi gửi');
      assertEqual(result.estimateCurrentStep, 1, 'estimateCurrentStep phải là 1');
      assertEqual(result.estimateTotalAmount, 70000000, 'Tổng dự toán phải tự tính đúng (10*2tr + 1*50tr)');
      assertEqual(result.estimateItems.length, 2, 'Phải lưu đủ 2 hạng mục hợp lệ');
    });

    // ===== 5) Duyệt dự toán =====
    await run.run('Ban Giám Đốc duyệt dự toán — estimateStatus chuyển APPROVED, mở khoá Thực hiện', async () => {
      await loginAs(page, ESTIMATE_APPROVER);
      const result = await page.evaluate(async (id) => {
        const res = await callWorkflowAction('operationStoreOpeningEstimate', id, 'approve', { comment: '' });
        const idx = DB.operationStoreOpenings.findIndex(x => x.id === id);
        DB.operationStoreOpenings[idx] = res.item;
        return { item: res.item, transition: res.transition };
      }, recordId);
      assertEqual(result.item.estimateStatus, 'APPROVED', 'estimateStatus phải chuyển APPROVED');
      assertEqual(result.transition.type, 'COMPLETED', 'Duyệt xong bước cuối phải trả transition COMPLETED');
    });

    // ===== 6) Người không có operationExecutionManage không tạo được Kỳ Thực Hiện =====
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

    // ===== 7) Tạo Kỳ Thực Hiện — mặc định CHUA_BAT_DAU =====
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

    // ===== 8) Chặn tạo công việc gốc khi kỳ CHƯA bắt đầu =====
    await run.run('Chặn tạo công việc gốc khi Kỳ Thực Hiện đang CHUA_BAT_DAU', async () => {
      await loginAs(page, EXECUTOR);
      const result = await page.evaluate(async ({ id, pid }) => {
        try {
          await callRecordCreate('operationWorkItems', {
            sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: null, title: 'Việc gốc quá sớm', periodId: pid
          });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, { id: recordId, pid: periodId });
      assert(!result.ok, 'Phải bị chặn vì kỳ chưa bắt đầu');
      assertIncludes(result.message, 'chưa bắt đầu', 'Thông báo lỗi phải nêu rõ kỳ chưa bắt đầu');
    });

    // ===== 9) Người không có operationExecutionManage không Bắt Đầu Kỳ được =====
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

    // ===== 10) Bắt Đầu Kỳ — chuyển DANG_THUC_HIEN =====
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

    // ===== 11) Tạo cây công việc gốc (đúng kỳ) + 2 việc con (gán người phụ trách/người nghiệm thu chỉ định) =====
    await run.run('Tạo cây công việc gốc + 2 việc con — gán assignedTo/acceptorUsername, việc con KẾ THỪA đúng periodId của cha (không tin payload)', async () => {
      await loginAs(page, EXECUTOR);
      const result = await page.evaluate(async ({ id, pid, workerUsername, workerName, acceptorUsername, acceptorName }) => {
        const rootRes = await callRecordCreate('operationWorkItems', {
          sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: null,
          title: 'Thi công nội thất', description: '', assignedTo: null, assignedToName: null, deadline: '', periodId: pid
        });
        DB.operationWorkItems.push(rootRes.item);
        // child1: gán assignedTo=WORKER + acceptorUsername=DESIGNATED_ACCEPTOR, cố tình gửi periodId GIẢ
        // (9999999) để xác nhận server KHÔNG tin, luôn kế thừa đúng periodId của cha.
        const child1Res = await callRecordCreate('operationWorkItems', {
          sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: rootRes.item.id,
          title: 'Lắp đèn', description: '', assignedTo: workerUsername, assignedToName: workerName,
          acceptorUsername, acceptorName, deadline: '', periodId: 9999999
        });
        DB.operationWorkItems.push(child1Res.item);
        const child2Res = await callRecordCreate('operationWorkItems', {
          sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: rootRes.item.id,
          title: 'Sơn tường', description: '', assignedTo: null, assignedToName: null, deadline: ''
        });
        DB.operationWorkItems.push(child2Res.item);
        return { root: rootRes.item, child1: child1Res.item, child2: child2Res.item };
      }, { id: recordId, pid: periodId, workerUsername: WORKER.username, workerName: WORKER.name, acceptorUsername: DESIGNATED_ACCEPTOR.username, acceptorName: DESIGNATED_ACCEPTOR.name });
      rootWorkItemId = result.root.id;
      child1Id = result.child1.id;
      child2Id = result.child2.id;
      assertEqual(result.root.status, 'CHUA_BAT_DAU', 'Việc gốc mới tạo phải ở trạng thái CHUA_BAT_DAU');
      assertEqual(result.root.periodId, periodId, 'Việc gốc phải gắn đúng periodId đã chọn');
      assertEqual(result.child1.parentWorkItemId, rootWorkItemId, 'Việc con phải gắn đúng parentWorkItemId');
      assertEqual(result.child1.periodId, periodId, 'Việc con phải KẾ THỪA đúng periodId của cha, không dùng periodId giả từ payload');
      assertEqual(result.child1.assignedTo, WORKER.username, 'Việc con 1 phải gán đúng người phụ trách');
      assertEqual(result.child1.acceptorUsername, DESIGNATED_ACCEPTOR.username, 'Việc con 1 phải gán đúng người nghiệm thu chỉ định');
    });

    // ===== 12) Chặn cập nhật trực tiếp việc CÓ CON =====
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

    // ===== 13) Người không có quyền VÀ không phải người phụ trách bị chặn cập nhật =====
    await run.run('Người không có operationExecutionManage và KHÔNG phải người phụ trách bị chặn cập nhật tiến độ', async () => {
      await loginAs(page, NOPERM);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_THUC_HIEN' });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, child1Id);
      assert(!result.ok, 'Phải bị chặn vì thiếu quyền operationExecutionManage và không phải người phụ trách');
    });

    // ===== 14) Người phụ trách (không có quyền rộng) tự cập nhật ĐÚNG việc của mình =====
    await run.run('WORKER (assignedTo, không có operationExecutionManage) tự cập nhật ĐÚNG việc mình phụ trách', async () => {
      await loginAs(page, WORKER);
      const result = await page.evaluate(async (id) => {
        const r = await callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_THUC_HIEN' });
        const idx = DB.operationWorkItems.findIndex(x => x.id === id);
        DB.operationWorkItems[idx] = r.item;
        return r.item;
      }, child1Id);
      assertEqual(result.status, 'DANG_THUC_HIEN', 'WORKER phải tự cập nhật được đúng việc mình phụ trách');
    });

    // ===== 15) Người phụ trách KHÔNG cập nhật được việc KHÁC (không phải của mình) =====
    await run.run('WORKER bị chặn cập nhật việc KHÁC (không phải mình phụ trách)', async () => {
      await loginAs(page, WORKER);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_THUC_HIEN' });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, child2Id);
      assert(!result.ok, 'Phải bị chặn vì WORKER không phải người phụ trách của việc con 2');
    });

    // ===== 16) Toàn quyền (EXECUTOR) vẫn cập nhật được MỌI việc, kể cả việc con 2 không giao cho mình =====
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

    // ===== 17) WORKER (chủ việc con 1) nộp nốt việc của mình lên "Đang nghiệm thu" =====
    await run.run('WORKER nộp nghiệm thu đúng việc mình phụ trách (DANG_THUC_HIEN -> DANG_NGHIEM_THU)', async () => {
      await loginAs(page, WORKER);
      const result = await page.evaluate(async (id) => {
        const r = await callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_NGHIEM_THU' });
        const idx = DB.operationWorkItems.findIndex(x => x.id === id);
        DB.operationWorkItems[idx] = r.item;
        return r.item;
      }, child1Id);
      assertEqual(result.status, 'DANG_NGHIEM_THU', 'Việc con 1 phải ở trạng thái Đang nghiệm thu');
    });

    // ===== 18) "Bổ sung" (REQUEST_INFO) chỉ ghi lý do, KHÔNG đổi trạng thái =====
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

    // ===== 19) Nghiệm thu/Bổ sung bắt buộc phải có lý do =====
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

    // ===== 20) Người không có quyền VÀ không phải người được chỉ định bị chặn nghiệm thu =====
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

    // ===== 21) Người được CHỈ ĐỊNH (không có quyền rộng) nghiệm thu ĐÚNG việc của mình =====
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

    // ===== 22) Người được chỉ định của việc con 1 KHÔNG nghiệm thu được việc con 2 (không phải của mình) =====
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

    // ===== 23) Toàn quyền (ACCEPTOR) nghiệm thu nốt việc con 2 — cha TỰ ĐỘNG chuyển Đã nghiệm thu =====
    await run.run('Toàn quyền (operationAcceptanceManage) nghiệm thu nốt việc con 2 — cha tự động cập nhật Đã nghiệm thu (hết việc con dở)', async () => {
      await loginAs(page, ACCEPTOR);
      const result = await page.evaluate(async ({ c2, rootId }) => {
        const r = await callRecordAction('operationWorkItems', c2, 'accept', { action: 'ACCEPT', reason: 'Đạt yêu cầu' });
        const idx = DB.operationWorkItems.findIndex(x => x.id === c2);
        DB.operationWorkItems[idx] = r.item;
        // Server tự đồng bộ trạng thái cha (syncOperationWorkItemAncestors) — trong mock việc này chạy
        // NGAY trong action handler (xem testHarness.js), nhưng client index.html cũng tự chạy
        // syncOperationWorkItemAncestorsClient() để cập nhật NGAY không cần tải lại — gọi lại đúng hàm đó.
        syncOperationWorkItemAncestorsClient(r.item.parentWorkItemId);
        const root = DB.operationWorkItems.find(x => x.id === rootId);
        return { child2: r.item, root };
      }, { c2: child2Id, rootId: rootWorkItemId });
      assertEqual(result.child2.status, 'DA_NGHIEM_THU', 'Việc con 2 phải chuyển Đã nghiệm thu');
      assertEqual(result.root.status, 'DA_NGHIEM_THU', 'Việc cha phải TỰ ĐỘNG chuyển Đã nghiệm thu khi hết việc con dở');
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
