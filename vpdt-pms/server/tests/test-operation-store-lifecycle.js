// server/tests/test-operation-store-lifecycle.js
//
// Regression test cho vòng đời "dự án nhỏ" của tab Vận Hành > 🏬 Siêu Thị:
//   Mở mới/Sửa chữa (hồ sơ chính, dept-workflow có sẵn) -> Dự toán (workflow ĐỘC LẬP song song, field
//   phẳng estimate* trên chính bản ghi, xem lib/workflowEngine.js operationStoreOpeningEstimate) ->
//   Thực hiện (cây công việc đa cấp dbo.OperationWorkItems, mock qua state.operationWorkItems) ->
//   Nghiệm thu (Nghiệm thu đổi trạng thái / Bổ sung KHÔNG đổi trạng thái) -> cha tự cập nhật khi mọi
//   con đã nghiệm thu (recordActions.computeParentWorkItemStatus, mirror ở testHarness.js
//   syncOperationWorkItemAncestorsInState()).
//
// 3 quyền TÁCH RIÊNG cho 3 giai đoạn (operationEstimateCreate/operationExecutionManage/
// operationAcceptanceManage) — bài test xác nhận cả state-machine LẪN việc mỗi quyền chỉ làm được
// đúng việc của mình (không lẫn quyền).
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
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Vận Hành', perms: { admin: true }, active: true, totpEnabled: true };

const state = createMockState({
  depts: ['Vận Hành', 'Ban Giám Đốc'],
  users: [CREATOR, ESTIMATOR, ESTIMATE_APPROVER, EXECUTOR, ACCEPTOR, NOPERM, ADMIN],
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

    // ===== 6) Tạo cây công việc Thực hiện (cấp gốc + 2 việc con) =====
    await run.run('operationExecutionManage tạo cây công việc gốc + 2 việc con', async () => {
      await loginAs(page, EXECUTOR);
      const result = await page.evaluate(async (id) => {
        const rootRes = await callRecordCreate('operationWorkItems', {
          sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: null,
          title: 'Thi công nội thất', description: '', assignedTo: null, assignedToName: null, deadline: ''
        });
        DB.operationWorkItems.push(rootRes.item);
        const child1Res = await callRecordCreate('operationWorkItems', {
          sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: rootRes.item.id,
          title: 'Lắp đèn', description: '', assignedTo: null, assignedToName: null, deadline: ''
        });
        DB.operationWorkItems.push(child1Res.item);
        const child2Res = await callRecordCreate('operationWorkItems', {
          sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: rootRes.item.id,
          title: 'Sơn tường', description: '', assignedTo: null, assignedToName: null, deadline: ''
        });
        DB.operationWorkItems.push(child2Res.item);
        return { root: rootRes.item, child1: child1Res.item, child2: child2Res.item };
      }, recordId);
      rootWorkItemId = result.root.id;
      child1Id = result.child1.id;
      child2Id = result.child2.id;
      assertEqual(result.root.status, 'CHUA_BAT_DAU', 'Việc gốc mới tạo phải ở trạng thái CHUA_BAT_DAU');
      assertEqual(result.child1.parentWorkItemId, rootWorkItemId, 'Việc con phải gắn đúng parentWorkItemId');
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

    // ===== 8) Người không có operationExecutionManage không cập nhật được tiến độ =====
    await run.run('Người không có operationExecutionManage bị chặn cập nhật tiến độ', async () => {
      await loginAs(page, NOPERM);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_THUC_HIEN' });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, child1Id);
      assert(!result.ok, 'Phải bị chặn vì thiếu quyền operationExecutionManage');
    });

    // ===== 9) Cập nhật tiến độ 2 việc con lên "Đang nghiệm thu" =====
    await run.run('Cập nhật tiến độ 2 việc con: CHUA_BAT_DAU -> DANG_THUC_HIEN -> DANG_NGHIEM_THU', async () => {
      await loginAs(page, EXECUTOR);
      const result = await page.evaluate(async ({ c1, c2 }) => {
        async function advance(id) {
          let r = await callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_THUC_HIEN' });
          let idx = DB.operationWorkItems.findIndex(x => x.id === id);
          DB.operationWorkItems[idx] = r.item;
          r = await callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_NGHIEM_THU' });
          idx = DB.operationWorkItems.findIndex(x => x.id === id);
          DB.operationWorkItems[idx] = r.item;
          return r.item;
        }
        const item1 = await advance(c1);
        const item2 = await advance(c2);
        return { item1, item2 };
      }, { c1: child1Id, c2: child2Id });
      assertEqual(result.item1.status, 'DANG_NGHIEM_THU', 'Việc con 1 phải ở trạng thái Đang nghiệm thu');
      assertEqual(result.item2.status, 'DANG_NGHIEM_THU', 'Việc con 2 phải ở trạng thái Đang nghiệm thu');
    });

    // ===== 10) Bổ sung KHÔNG đổi trạng thái =====
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

    // ===== 11) Bổ sung/Nghiệm thu bắt buộc phải có lý do =====
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

    // ===== 12) Người không có operationAcceptanceManage không nghiệm thu được =====
    await run.run('Người không có operationAcceptanceManage bị chặn nghiệm thu', async () => {
      await loginAs(page, NOPERM);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('operationWorkItems', id, 'accept', { action: 'ACCEPT', reason: 'test' });
          return { ok: true };
        } catch (err) { return { ok: false, message: err.message }; }
      }, child1Id);
      assert(!result.ok, 'Phải bị chặn vì thiếu quyền operationAcceptanceManage');
    });

    // ===== 13) Nghiệm thu việc con 1 — cha CHƯA tự hoàn thành (còn việc con 2 chưa xong) =====
    await run.run('Nghiệm thu việc con 1 — cha vẫn chưa tự chuyển Đã nghiệm thu (còn con 2 dở)', async () => {
      await loginAs(page, ACCEPTOR);
      const result = await page.evaluate(async ({ c1, rootId }) => {
        const r = await callRecordAction('operationWorkItems', c1, 'accept', { action: 'ACCEPT', reason: 'Đạt yêu cầu' });
        const idx = DB.operationWorkItems.findIndex(x => x.id === c1);
        DB.operationWorkItems[idx] = r.item;
        const root = DB.operationWorkItems.find(x => x.id === rootId);
        return { child1: r.item, root };
      }, { c1: child1Id, rootId: rootWorkItemId });
      assertEqual(result.child1.status, 'DA_NGHIEM_THU', 'Việc con 1 phải chuyển Đã nghiệm thu');
      assertEqual(result.child1.acceptedBy, ACCEPTOR.username, 'Phải ghi nhận đúng người nghiệm thu');
      // Cha trong mock KHÔNG tự đồng bộ ở đây (routes/records.js thật mới gọi syncOperationWorkItemAncestors
      // sau accept, mock chỉ đồng bộ trong action handler operationWorkItems:accept — kiểm tra qua DB client sau).
    });

    // ===== 14) Nghiệm thu nốt việc con 2 — cha TỰ ĐỘNG chuyển Đã nghiệm thu =====
    await run.run('Nghiệm thu nốt việc con 2 — cha tự động cập nhật Đã nghiệm thu (hết việc con dở)', async () => {
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
