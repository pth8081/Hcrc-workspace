// server/tests/test-uniform.js
//
// Regression test cho module Đồng Phục (key 'uniform', con của Hành Chính):
//   - Kỳ Cấp Phát (uniformPeriods) do Hành Chính (uniformManage) tạo, phân bổ theo Danh Mục Siêu Thị
//     (DB.stores — TÁCH RIÊNG khỏi DB.depts, xem đầu file public/index.html quanh dòng ~19452 và
//     lib/createValidation.js CREATE_MODULE_CONFIGS.uniformPeriods).
//   - Xác Nhận/Cấp Phát (Giám Đốc Siêu Thị — uniformStoreManage): confirm-allocation rồi cấp cho nhân
//     viên (uniformIssuances), trừ thẳng vào "Kho" TÍNH ĐỘNG (computeUniformStock()/computeUniformStockClient()),
//     không lưu bảng tồn kho riêng.
//   - Kho: xem-only cho người không có uniformManage/uniformStoreManage.
//
// Chạy: node server/tests/test-uniform.js
const path = require('path');
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual, assertIncludes
} = require('./testHarness');

const PORT = 8981;

// ===================== Seed dữ liệu =====================
const STORES = ['Siêu Thị Hội An', 'Siêu Thị Đà Nẵng'];

const HC = { username: 'hc1', name: 'Nguyễn Văn Hành Chính', dept: 'Hành Chính', perms: { uniformManage: true }, active: true };
// APPROVER (Phase 2) — quyền uniformApprove TÁCH RIÊNG khỏi uniformManage (Hành Chính TẠO kỳ không có
// nghĩa được TỰ DUYỆT kỳ của chính mình — cùng tinh thần tách vai trò như mọi luồng duyệt khác trong hệ
// thống), xem canApproveUniform() ở lib/recordActions.js.
const APPROVER = { username: 'approver1', name: 'Người Duyệt Đồng Phục', dept: 'Hành Chính', perms: { uniformApprove: true }, active: true };
const GD_HOIAN = { username: 'gd_hoian', name: 'Trần Thị Hội An', dept: 'Siêu Thị Hội An', perms: { uniformStoreManage: true }, active: true };
const NV_HOIAN = { username: 'nv_hoian', name: 'Lê Văn Nhân Viên', dept: 'Siêu Thị Hội An', perms: {}, active: true };
const GD_DANANG = { username: 'gd_danang', name: 'Phạm Thị Đà Nẵng', dept: 'Siêu Thị Đà Nẵng', perms: { uniformStoreManage: true }, active: true };
const EMP_NOPERM = { username: 'emp_noperm', name: 'Người Không Quyền', dept: 'Hành Chính', perms: {}, active: true };

const state = createMockState({
  depts: ['Hành Chính'],
  stores: STORES,
  users: [HC, APPROVER, GD_HOIAN, NV_HOIAN, GD_DANANG, EMP_NOPERM],
  // Danh Mục Đồng Phục — mới thêm (xem sanitizeUniformItems() ở lib/createValidation.js): tạo kỳ cấp
  // phát giờ bắt buộc CHỌN tên+size từ đúng danh mục này, không còn gõ tự do.
  uniformCatalog: [{ id: 1, name: 'Áo đồng phục nam', sizes: ['S', 'M', 'L', 'XL'] }]
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

  try {
    // ===== 1) Happy path: Hành Chính tạo kỳ cấp phát cho 2 siêu thị =====
    await run.run('Hành Chính tạo kỳ cấp phát đồng phục cho nhiều siêu thị (happy path)', async () => {
      await loginAs(page, HC);
      const result = await page.evaluate(async () => {
        switchTab('uniform');
        setUniformSubTab('PERIODS');
        document.getElementById('uniformPeriodName').value = 'Đợt hè 2026';
        document.getElementById('uniformPeriodNote').value = 'Phát đồng phục hè';
        addUniformAllocationBlock();
        updateUniformAllocDept(0, 'Siêu Thị Hội An');
        updateUniformAllocItemField(0, 0, 'name', 'Áo đồng phục nam');
        updateUniformAllocItemField(0, 0, 'size', 'L');
        updateUniformAllocItemField(0, 0, 'qty', '20');
        addUniformAllocationBlock();
        updateUniformAllocDept(1, 'Siêu Thị Đà Nẵng');
        updateUniformAllocItemField(1, 0, 'name', 'Áo đồng phục nam');
        updateUniformAllocItemField(1, 0, 'size', 'L');
        updateUniformAllocItemField(1, 0, 'qty', '15');
        await submitUniformPeriod();
        const p = DB.uniformPeriods.find(x => x.name === 'Đợt hè 2026');
        return {
          alerts: window.__alerts,
          found: !!p,
          allocCount: p ? p.allocations.length : 0,
          statuses: p ? p.allocations.map(a => a.status) : [],
          hoiAnQty: p ? p.allocations.find(a => a.dept === 'Siêu Thị Hội An').items[0].qty : null
        };
      });
      assert(result.found, 'Kỳ cấp phát vừa tạo phải xuất hiện trong DB.uniformPeriods');
      assertEqual(result.allocCount, 2, 'Phải có đúng 2 dòng phân bổ (2 siêu thị)');
      assert(result.statuses.every(s => s === 'PENDING_CONFIRM'), `Mọi phân bổ mới tạo phải ở trạng thái PENDING_CONFIRM, thực tế: ${result.statuses}`);
      assertEqual(result.hoiAnQty, 20, 'Số lượng phân bổ cho Hội An phải đúng 20');
      assertIncludes(result.alerts, 'Đã tạo kỳ cấp phát đồng phục', 'Phải có thông báo tạo kỳ thành công');
    });

    // ===== 2) Validation: không chọn siêu thị nào để phân bổ =====
    await run.run('Validation: tạo kỳ cấp phát không có dòng phân bổ nào bị chặn', async () => {
      const before = await page.evaluate(() => DB.uniformPeriods.length);
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        setUniformSubTab('PERIODS'); // resetUniformPeriodForm() -> uniformAllocBlocks = []
        document.getElementById('uniformPeriodName').value = 'Kỳ thiếu phân bổ';
        await submitUniformPeriod();
        return { alerts: window.__alerts, count: DB.uniformPeriods.length };
      });
      assertIncludes(result.alerts, 'Vui lòng thêm ít nhất 1 siêu thị', 'Phải cảnh báo thiếu dòng phân bổ');
      assertEqual(result.count, before, 'Không được tạo thêm kỳ cấp phát nào khi validation thất bại');
    });

    // ===== 3) Permission: người không có uniformManage không tạo được kỳ cấp phát (server tự chặn) =====
    await run.run('Permission: người không có quyền uniformManage bị server chặn khi tạo kỳ cấp phát', async () => {
      await loginAs(page, EMP_NOPERM);
      const before = await page.evaluate(() => DB.uniformPeriods.length);
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        switchTab('dashboard'); // emp_noperm không có uniformManage/uniformStoreManage -> không vào được tab uniform, nhưng hàm submit vẫn gọi trực tiếp được để kiểm tra server tự xác minh lại quyền
        document.getElementById('uniformPeriodName').value = 'Kỳ trái phép';
        addUniformAllocationBlock();
        updateUniformAllocDept(0, 'Siêu Thị Hội An');
        updateUniformAllocItemField(0, 0, 'name', 'Áo test');
        updateUniformAllocItemField(0, 0, 'qty', '1');
        await submitUniformPeriod();
        return { alerts: window.__alerts, count: DB.uniformPeriods.length };
      });
      assertIncludes(result.alerts, 'Bạn không có quyền tạo kỳ cấp phát đồng phục', 'Server phải trả lỗi 403 với thông báo đúng');
      assertEqual(result.count, before, 'Không được tạo kỳ cấp phát khi không có quyền');
    });

    // ===== 3b) Phase 2: kỳ mới tạo mặc định PENDING_APPROVAL, chặn xác nhận cho tới khi được duyệt =====
    await run.run('Phase 2: kỳ chưa được duyệt (PENDING_APPROVAL) thì Giám Đốc Siêu Thị chưa xác nhận được', async () => {
      await loginAs(page, GD_HOIAN);
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        const p = DB.uniformPeriods.find(x => x.name === 'Đợt hè 2026');
        const alloc = p.allocations.find(a => a.dept === 'Siêu Thị Hội An');
        try {
          await callRecordAction('uniformPeriods', p.id, 'confirm-allocation', { allocationId: alloc.id });
          return { errorMsg: null, approvalStatus: p.approvalStatus };
        } catch (err) {
          return { errorMsg: err.message, approvalStatus: p.approvalStatus };
        }
      });
      assertEqual(result.approvalStatus, 'PENDING_APPROVAL', 'Kỳ mới tạo phải mặc định PENDING_APPROVAL');
      assertIncludes(result.errorMsg, 'chưa được duyệt', 'Server phải chặn xác nhận khi kỳ chưa được duyệt');
    });

    // ===== 3c) uniformManage được GỘP năng lực uniformApprove — Hành Chính tự duyệt được kỳ mình tạo
    // (quyết định người dùng thực tế: quy trình tách vai trò ban đầu gây kẹt kỳ khi không ai được cấp
    // riêng uniformApprove sau khi tính năng ra mắt — xem canApproveUniform() ở lib/recordActions.js) =====
    await run.run('uniformManage được gộp năng lực uniformApprove — Hành Chính tự duyệt kỳ mình tạo (happy path)', async () => {
      await loginAs(page, HC);
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        const p = DB.uniformPeriods.find(x => x.name === 'Đợt hè 2026');
        const r = await callRecordAction('uniformPeriods', p.id, 'approve', {});
        const idx = DB.uniformPeriods.findIndex(x => x.id === p.id);
        DB.uniformPeriods[idx] = r.item;
        return { approvalStatus: r.item.approvalStatus, approvedByName: r.item.approvedByName };
      });
      assertEqual(result.approvalStatus, 'APPROVED', 'Kỳ phải chuyển APPROVED sau khi Hành Chính (uniformManage) tự duyệt');
      assertEqual(result.approvedByName, HC.name, 'Phải ghi nhận đúng người duyệt');
    });

    // ===== 3c-2) Người hoàn toàn không có quyền (không admin/uniformManage/uniformApprove) vẫn bị chặn =====
    await run.run('Người không có quyền nào thì không duyệt được kỳ cấp phát', async () => {
      await loginAs(page, EMP_NOPERM);
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        const p = DB.uniformPeriods.find(x => x.name === 'Đợt hè 2026');
        try {
          await callRecordAction('uniformPeriods', p.id, 'reject', { reason: 'test' });
          return { errorMsg: null };
        } catch (err) {
          return { errorMsg: err.message };
        }
      });
      assertIncludes(result.errorMsg, 'Bạn không có quyền duyệt', 'Server phải chặn người không có quyền duyệt kỳ cấp phát');
    });

    // ===== 3d) Phase 2: người có uniformApprove RIÊNG (không kèm uniformManage) vẫn duyệt được kỳ —
    // tạo thêm 1 kỳ mới (kỳ "Đợt hè 2026" ở trên đã bị HC duyệt hết ở bước 3c) =====
    await run.run('Chuẩn bị: Hành Chính tạo thêm 1 kỳ cấp phát nữa cho kịch bản APPROVER riêng', async () => {
      await loginAs(page, HC);
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        setUniformSubTab('PERIODS');
        document.getElementById('uniformPeriodName').value = 'Đợt hè Đà Nẵng';
        addUniformAllocationBlock();
        updateUniformAllocDept(0, 'Siêu Thị Đà Nẵng');
        updateUniformAllocItemField(0, 0, 'name', 'Áo đồng phục nam');
        updateUniformAllocItemField(0, 0, 'size', 'L');
        updateUniformAllocItemField(0, 0, 'qty', '10');
        await submitUniformPeriod();
        const p = DB.uniformPeriods.find(x => x.name === 'Đợt hè Đà Nẵng');
        return { found: !!p };
      });
      assert(result.found, 'Kỳ "Đợt hè Đà Nẵng" phải được tạo thành công');
    });

    await run.run('Phase 2: uniformApprove duyệt kỳ cấp phát (happy path)', async () => {
      await loginAs(page, APPROVER);
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        const p = DB.uniformPeriods.find(x => x.name === 'Đợt hè Đà Nẵng');
        const r = await callRecordAction('uniformPeriods', p.id, 'approve', {});
        const idx = DB.uniformPeriods.findIndex(x => x.id === p.id);
        DB.uniformPeriods[idx] = r.item;
        return { approvalStatus: r.item.approvalStatus, approvedByName: r.item.approvedByName };
      });
      assertEqual(result.approvalStatus, 'APPROVED', 'Kỳ phải chuyển APPROVED sau khi duyệt');
      assertEqual(result.approvedByName, APPROVER.name, 'Phải ghi nhận đúng người duyệt');
    });

    // ===== 3e) Phase 2: duyệt lại 1 kỳ đã duyệt bị chặn (409, không phải luồng nhiều bước) =====
    await run.run('Phase 2: duyệt lại kỳ đã APPROVED bị chặn', async () => {
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        const p = DB.uniformPeriods.find(x => x.name === 'Đợt hè 2026');
        try {
          await callRecordAction('uniformPeriods', p.id, 'approve', {});
          return { errorMsg: null };
        } catch (err) {
          return { errorMsg: err.message };
        }
      });
      assertIncludes(result.errorMsg, 'đã được xử lý duyệt', 'Không được duyệt lại 1 kỳ đã xử lý xong');
    });

    // ===== 4) Giám Đốc Siêu Thị Hội An xác nhận đã nhận phân bổ của mình =====
    await run.run('Giám Đốc Siêu Thị xác nhận nhận đồng phục (confirm-allocation) — happy path', async () => {
      await loginAs(page, GD_HOIAN);
      const result = await page.evaluate(async () => {
        switchTab('uniform');
        setUniformSubTab('STORE');
        const p = DB.uniformPeriods.find(x => x.name === 'Đợt hè 2026');
        const alloc = p.allocations.find(a => a.dept === 'Siêu Thị Hội An');
        confirmUniformAllocationAction(p.id, alloc.id);
        await window.__confirmPending();
        const updated = DB.uniformPeriods.find(x => x.id === p.id).allocations.find(a => a.dept === 'Siêu Thị Hội An');
        return { status: updated.status, confirmedByName: updated.confirmedByName, alerts: window.__alerts };
      });
      assertEqual(result.status, 'CONFIRMED', 'Trạng thái phân bổ Hội An phải chuyển thành CONFIRMED');
      assertEqual(result.confirmedByName, GD_HOIAN.name, 'Phải ghi nhận đúng người xác nhận');
    });

    // ===== 5) Nhân viên (không có uniformStoreManage) không xác nhận được phân bổ =====
    await run.run('Permission: nhân viên không có uniformStoreManage bị chặn khi xác nhận phân bổ', async () => {
      await loginAs(page, NV_HOIAN);
      const result = await page.evaluate(async () => {
        switchTab('uniform');
        const p = DB.uniformPeriods.find(x => x.name === 'Đợt hè 2026');
        const alloc = p.allocations.find(a => a.dept === 'Siêu Thị Đà Nẵng'); // vẫn đang PENDING_CONFIRM
        confirmUniformAllocationAction(p.id, alloc.id);
        await window.__confirmPending();
        return { alerts: window.__alerts };
      });
      assertIncludes(result.alerts, 'Bạn không có quyền xác nhận nhận đồng phục', 'Server phải chặn người không có quyền uniformStoreManage');
    });

    // ===== 6) Giám Đốc Siêu Thị Đà Nẵng xác nhận phần của mình (chuẩn bị tồn kho cho các bước sau) =====
    await run.run('Giám Đốc Siêu Thị Đà Nẵng xác nhận phân bổ của siêu thị mình', async () => {
      await loginAs(page, GD_DANANG);
      const result = await page.evaluate(async () => {
        switchTab('uniform');
        setUniformSubTab('STORE');
        const p = DB.uniformPeriods.find(x => x.name === 'Đợt hè 2026');
        const alloc = p.allocations.find(a => a.dept === 'Siêu Thị Đà Nẵng');
        confirmUniformAllocationAction(p.id, alloc.id);
        await window.__confirmPending();
        const updated = DB.uniformPeriods.find(x => x.id === p.id).allocations.find(a => a.dept === 'Siêu Thị Đà Nẵng');
        return { status: updated.status };
      });
      assertEqual(result.status, 'CONFIRMED', 'Trạng thái phân bổ Đà Nẵng phải chuyển thành CONFIRMED');
    });

    // ===== 7) Giám Đốc Siêu Thị Hội An cấp đồng phục cho nhân viên (happy path, trừ tồn kho) =====
    await run.run('Giám Đốc Siêu Thị cấp đồng phục cho nhân viên — trừ đúng vào Kho tính động', async () => {
      await loginAs(page, GD_HOIAN);
      const result = await page.evaluate(async () => {
        switchTab('uniform');
        setUniformSubTab('STORE');
        document.getElementById('uniformIssueEmployee').value = 'Lê Văn Nhân Viên (nv_hoian)';
        resolveUniformEmployeeInput('uniformIssueEmployee', 'uniformIssueEmployeeUsername');
        document.getElementById('uniformIssueCode').value = 'CP001';
        updateUniformIssueItemNameSize(0, 'Áo đồng phục nam|||L');
        updateUniformIssueItemField(0, 'qty', '5');
        await submitUniformIssuance();
        const stock = computeUniformStockClient('Siêu Thị Hội An');
        const row = stock.get('Áo đồng phục nam|||L');
        return {
          alerts: window.__alerts,
          issuanceCount: DB.uniformIssuances.filter(x => x.dept === 'Siêu Thị Hội An').length,
          allocated: row.allocated, issued: row.issued, stockLeft: row.stock
        };
      });
      assertIncludes(result.alerts, 'Đã cấp đồng phục cho nhân viên', 'Phải có thông báo cấp phát thành công');
      assertEqual(result.issuanceCount, 1, 'Phải có đúng 1 phiếu cấp phát cho Hội An');
      assertEqual(result.allocated, 20, 'Tồn kho phân bổ (allocated) phải giữ đúng 20');
      assertEqual(result.issued, 5, 'Số đã cấp (issued) phải đúng 5');
      assertEqual(result.stockLeft, 15, 'Tồn kho còn lại phải là 20 - 5 = 15');
    });

    // ===== 8) Cấp vượt quá tồn kho phải bị chặn =====
    await run.run('Cấp đồng phục vượt quá tồn kho hiện có bị chặn (409)', async () => {
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        resetUniformIssueForm();
        document.getElementById('uniformIssueEmployee').value = 'Lê Văn Nhân Viên (nv_hoian)';
        resolveUniformEmployeeInput('uniformIssueEmployee', 'uniformIssueEmployeeUsername');
        updateUniformIssueItemNameSize(0, 'Áo đồng phục nam|||L');
        updateUniformIssueItemField(0, 'qty', '999');
        await submitUniformIssuance();
        return {
          alerts: window.__alerts,
          issuanceCount: DB.uniformIssuances.filter(x => x.dept === 'Siêu Thị Hội An').length
        };
      });
      assertIncludes(result.alerts, 'Không đủ tồn kho', 'Phải báo lỗi không đủ tồn kho');
      assertEqual(result.issuanceCount, 1, 'Không được tạo thêm phiếu cấp phát nào khi vượt tồn kho');
    });

    // ===== 9) Kho: người không có quyền quản lý chỉ được XEM, không vào được Kỳ Cấp Phát/Xác Nhận =====
    await run.run('Kho: nhân viên không có quyền chỉ xem tồn kho (view-only), không vào được tab quản lý', async () => {
      await loginAs(page, NV_HOIAN);
      const result = await page.evaluate(() => {
        switchTab('uniform');
        setUniformSubTab('PERIODS'); // không có uniformManage/uniformStoreManage -> phải tự chuyển về STOCK
        const subTabAfterPeriods = activeUniformSubTab;
        setUniformSubTab('STORE'); // không có uniformStoreManage -> cũng phải tự chuyển về STOCK
        const subTabAfterStore = activeUniformSubTab;
        const stock = computeUniformStockClient('Siêu Thị Hội An');
        const row = stock.get('Áo đồng phục nam|||L');
        return { subTabAfterPeriods, subTabAfterStore, stockLeft: row.stock };
      });
      assertEqual(result.subTabAfterPeriods, 'STOCK', 'Không có quyền uniformManage thì không được ở lại tab Kỳ Cấp Phát');
      assertEqual(result.subTabAfterStore, 'STOCK', 'Không có quyền uniformStoreManage thì không được ở lại tab Xác Nhận/Cấp Phát');
      assertEqual(result.stockLeft, 15, 'Nhân viên vẫn phải xem được đúng số tồn kho hiện tại của siêu thị mình (15)');
    });

    // ===== 10) Báo Hỏng từ kho (happy path) — allocated=20, issued=5, stock=15 trước khi báo hỏng =====
    await run.run('Giám Đốc Siêu Thị báo Hỏng từ kho — trừ đúng vào tồn, không đụng issued', async () => {
      await loginAs(page, GD_HOIAN);
      const result = await page.evaluate(async () => {
        switchTab('uniform');
        setUniformSubTab('STORE');
        document.getElementById('uniformAdjStockItemName').value = 'Áo đồng phục nam';
        document.getElementById('uniformAdjStockSize').value = 'L';
        document.getElementById('uniformAdjStockQty').value = '2';
        document.querySelector('input[name="uniformAdjStockOutcome"][value="HONG"]').checked = true;
        document.getElementById('uniformAdjStockReason').value = 'Ố vàng, rách chỉ';
        await submitUniformStockAdjustment('STOCK');
        const stock = computeUniformStockClient('Siêu Thị Hội An');
        const row = stock.get('Áo đồng phục nam|||L');
        return { alerts: window.__alerts, adjCount: DB.uniformStockAdjustments.length, hong: row.hong, huy: row.huy, issued: row.issued, stockLeft: row.stock };
      });
      assertIncludes(result.alerts, 'Đã ghi nhận thao tác', 'Phải có thông báo ghi nhận thành công');
      assertEqual(result.adjCount, 1, 'Phải có đúng 1 bản ghi điều chỉnh');
      assertEqual(result.hong, 2, 'Số lượng Hỏng phải đúng 2');
      assertEqual(result.issued, 5, 'issued (tổng đã cấp cộng dồn) không được đổi khi báo hỏng từ kho');
      assertEqual(result.stockLeft, 13, 'Tồn kho phải giảm còn 20 - 5 - 2 = 13');
    });

    // ===== 11) Báo Hủy từ kho (happy path) =====
    await run.run('Giám Đốc Siêu Thị báo Hủy không sử dụng từ kho — trừ đúng vào tồn', async () => {
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        document.getElementById('uniformAdjStockItemName').value = 'Áo đồng phục nam';
        document.getElementById('uniformAdjStockSize').value = 'L';
        document.getElementById('uniformAdjStockQty').value = '1';
        document.querySelector('input[name="uniformAdjStockOutcome"][value="HUY"]').checked = true;
        document.getElementById('uniformAdjStockReason').value = 'Lỗi sản xuất, không dùng được';
        await submitUniformStockAdjustment('STOCK');
        const stock = computeUniformStockClient('Siêu Thị Hội An');
        const row = stock.get('Áo đồng phục nam|||L');
        return { alerts: window.__alerts, huy: row.huy, stockLeft: row.stock };
      });
      assertIncludes(result.alerts, 'Đã ghi nhận thao tác', 'Phải có thông báo ghi nhận thành công');
      assertEqual(result.huy, 1, 'Số lượng Hủy phải đúng 1');
      assertEqual(result.stockLeft, 12, 'Tồn kho phải giảm còn 13 - 1 = 12');
    });

    // ===== 12) Validation: thiếu lý do bị server chặn (mandatory) =====
    await run.run('Validation: báo Hỏng/Hủy thiếu lý do bị server chặn', async () => {
      const before = await page.evaluate(() => DB.uniformStockAdjustments.length);
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        try {
          await callCreateUniformStockAdjustment({ source: 'STOCK', outcome: 'HONG', itemName: 'Áo đồng phục nam', size: 'L', qty: 1, reason: '' });
          return { errorMsg: null };
        } catch (err) {
          return { errorMsg: err.message };
        }
      });
      assertIncludes(result.errorMsg, 'Vui lòng nhập lý do', 'Server phải báo lỗi thiếu lý do (bắt buộc)');
      const after = await page.evaluate(() => DB.uniformStockAdjustments.length);
      assertEqual(after, before, 'Không được tạo bản ghi nào khi thiếu lý do');
    });

    // ===== 13) Validation: báo Hỏng vượt quá tồn kho hiện có bị chặn =====
    await run.run('Validation: báo Hỏng vượt quá tồn kho hiện có bị chặn (409)', async () => {
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        document.getElementById('uniformAdjStockItemName').value = 'Áo đồng phục nam';
        document.getElementById('uniformAdjStockSize').value = 'L';
        document.getElementById('uniformAdjStockQty').value = '999';
        document.querySelector('input[name="uniformAdjStockOutcome"][value="HONG"]').checked = true;
        document.getElementById('uniformAdjStockReason').value = 'Test vượt tồn';
        await submitUniformStockAdjustment('STOCK');
        return { alerts: window.__alerts };
      });
      assertIncludes(result.alerts, 'Không đủ tồn kho', 'Phải báo lỗi không đủ tồn kho khi báo hỏng vượt quá số hiện có');
    });

    // ===== 14) Thu hồi từ nhân viên, outcome = Về Tồn Kho (happy path) =====
    await run.run('Thu hồi từ nhân viên — outcome Về Tồn Kho — cộng lại vào tồn, giữ nguyên issued', async () => {
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        resetUniformAdjustForms();
        document.getElementById('uniformAdjEmpEmployee').value = 'Lê Văn Nhân Viên (nv_hoian)';
        resolveUniformEmployeeInput('uniformAdjEmpEmployee', 'uniformAdjEmpEmployeeUsername');
        renderUniformAdjEmpItemOptions();
        document.getElementById('uniformAdjEmpItemSize').value = 'Áo đồng phục nam|||L';
        onUniformAdjEmpItemSizeChange();
        document.getElementById('uniformAdjEmpQty').value = '2';
        document.querySelector('input[name="uniformAdjEmpOutcome"][value="TON"]').checked = true;
        document.getElementById('uniformAdjEmpReason').value = 'Nhân viên đổi size';
        await submitUniformStockAdjustment('EMPLOYEE');
        const stock = computeUniformStockClient('Siêu Thị Hội An');
        const row = stock.get('Áo đồng phục nam|||L');
        return { alerts: window.__alerts, issued: row.issued, recalled: row.recalled, stockLeft: row.stock };
      });
      assertIncludes(result.alerts, 'Đã ghi nhận thao tác', 'Phải có thông báo ghi nhận thành công');
      assertEqual(result.issued, 5, 'issued (tổng đã cấp cộng dồn) không được đổi khi thu hồi');
      assertEqual(result.recalled, 2, 'recalled phải đúng 2');
      assertEqual(result.stockLeft, 14, 'Tồn kho phải tăng lại: 12 - (5-2) - 2(hỏng) - 1(hủy) = 14');
    });

    // ===== 15) Thu hồi từ nhân viên, outcome = Hỏng — KHÔNG cộng lại vào tồn =====
    await run.run('Thu hồi từ nhân viên — outcome Hỏng — không cộng lại vào tồn, cộng vào Hỏng', async () => {
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        document.getElementById('uniformAdjEmpEmployee').value = 'Lê Văn Nhân Viên (nv_hoian)';
        resolveUniformEmployeeInput('uniformAdjEmpEmployee', 'uniformAdjEmpEmployeeUsername');
        renderUniformAdjEmpItemOptions();
        document.getElementById('uniformAdjEmpItemSize').value = 'Áo đồng phục nam|||L';
        onUniformAdjEmpItemSizeChange();
        document.getElementById('uniformAdjEmpQty').value = '1';
        document.querySelector('input[name="uniformAdjEmpOutcome"][value="HONG"]').checked = true;
        document.getElementById('uniformAdjEmpReason').value = 'Phát hiện rách khi thu hồi';
        await submitUniformStockAdjustment('EMPLOYEE');
        const stock = computeUniformStockClient('Siêu Thị Hội An');
        const row = stock.get('Áo đồng phục nam|||L');
        return { alerts: window.__alerts, hong: row.hong, recalled: row.recalled, stockLeft: row.stock };
      });
      assertIncludes(result.alerts, 'Đã ghi nhận thao tác', 'Phải có thông báo ghi nhận thành công');
      assertEqual(result.hong, 3, 'Hỏng phải cộng dồn thành 2 (từ kho) + 1 (thu hồi) = 3');
      assertEqual(result.recalled, 3, 'recalled phải cộng dồn thành 2 + 1 = 3');
      assertEqual(result.stockLeft, 14, 'Tồn kho GIỮ NGUYÊN 14 vì hàng thu hồi hỏng không quay lại tồn: 20-(5-3)-3-1=14');
    });

    // ===== 16) Validation: thu hồi vượt quá số nhân viên đang giữ bị chặn =====
    await run.run('Validation: thu hồi vượt quá số nhân viên đang giữ bị chặn (409)', async () => {
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        document.getElementById('uniformAdjEmpEmployee').value = 'Lê Văn Nhân Viên (nv_hoian)';
        resolveUniformEmployeeInput('uniformAdjEmpEmployee', 'uniformAdjEmpEmployeeUsername');
        renderUniformAdjEmpItemOptions();
        document.getElementById('uniformAdjEmpItemSize').value = 'Áo đồng phục nam|||L';
        onUniformAdjEmpItemSizeChange();
        document.getElementById('uniformAdjEmpQty').value = '999';
        document.querySelector('input[name="uniformAdjEmpOutcome"][value="TON"]').checked = true;
        document.getElementById('uniformAdjEmpReason').value = 'Test vượt số đang giữ';
        await submitUniformStockAdjustment('EMPLOYEE');
        return { alerts: window.__alerts };
      });
      assertIncludes(result.alerts, 'chỉ đang giữ', 'Phải báo lỗi nhân viên chỉ đang giữ số lượng ít hơn yêu cầu thu hồi');
    });

    // ===== 17) Cross-store: không thu hồi được của nhân viên siêu thị khác =====
    await run.run('Permission: không thu hồi được của nhân viên thuộc siêu thị khác', async () => {
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        try {
          await callCreateUniformStockAdjustment({ source: 'EMPLOYEE', outcome: 'TON', itemName: 'Áo đồng phục nam', size: 'L', qty: 1, reason: 'test khác siêu thị', employeeUsername: 'gd_danang' });
          return { errorMsg: null };
        } catch (err) {
          return { errorMsg: err.message };
        }
      });
      assertIncludes(result.errorMsg, 'Chỉ thu hồi được của nhân viên thuộc siêu thị của bạn', 'Server phải chặn thu hồi của nhân viên khác siêu thị');
    });

    // ===== 18) Permission: nhân viên thường không có uniformStoreManage bị chặn =====
    await run.run('Permission: nhân viên không có uniformStoreManage bị chặn khi báo Hỏng/Hủy/Thu hồi', async () => {
      await loginAs(page, NV_HOIAN);
      const result = await page.evaluate(async () => {
        try {
          await callCreateUniformStockAdjustment({ source: 'STOCK', outcome: 'HONG', itemName: 'Áo đồng phục nam', size: 'L', qty: 1, reason: 'test' });
          return { errorMsg: null };
        } catch (err) {
          return { errorMsg: err.message };
        }
      });
      assertIncludes(result.errorMsg, 'Bạn không có quyền thao tác này', 'Server phải chặn người không có quyền uniformStoreManage');
    });

    // ===== 19) Permission: Hành Chính (chỉ uniformManage, KHÔNG uniformStoreManage) cũng bị chặn =====
    await run.run('Permission: Hành Chính (chỉ uniformManage) không tự ý báo Hỏng/Hủy/Thu hồi kho siêu thị được', async () => {
      await loginAs(page, HC);
      const result = await page.evaluate(async () => {
        try {
          await callCreateUniformStockAdjustment({ source: 'STOCK', outcome: 'HONG', itemName: 'Áo đồng phục nam', size: 'L', qty: 1, reason: 'test' });
          return { errorMsg: null };
        } catch (err) {
          return { errorMsg: err.message };
        }
      });
      assertIncludes(result.errorMsg, 'Bạn không có quyền thao tác này', 'Chỉ Giám Đốc Siêu Thị (uniformStoreManage) mới thao tác được, kể cả Hành Chính (uniformManage) cũng không được');
    });

    // ===== 20) Kho: view-only vẫn thấy đúng số Hỏng/Hủy/Tồn cuối cùng =====
    await run.run('Kho: view-only thấy đúng số Hỏng/Hủy/Tồn sau toàn bộ thao tác', async () => {
      await loginAs(page, NV_HOIAN);
      const result = await page.evaluate(() => {
        const stock = computeUniformStockClient('Siêu Thị Hội An');
        const row = stock.get('Áo đồng phục nam|||L');
        return { hong: row.hong, huy: row.huy, recalled: row.recalled, issued: row.issued, allocated: row.allocated, stock: row.stock };
      });
      assertEqual(result.allocated, 20, 'allocated phải giữ nguyên 20');
      assertEqual(result.issued, 5, 'issued phải giữ nguyên 5 (tổng cộng dồn đã cấp)');
      assertEqual(result.recalled, 3, 'recalled phải đúng 3');
      assertEqual(result.hong, 3, 'hong phải đúng 3');
      assertEqual(result.huy, 1, 'huy phải đúng 1');
      assertEqual(result.stock, 14, 'stock cuối cùng phải đúng 14');
    });

    // ===== 21) Đồng Phục Nhân Viên Đang Giữ — nút Báo Mất trên bảng thao tác nhanh =====
    await run.run('Đang Giữ: nút Báo Mất trừ đúng vào Mất, không cộng lại tồn kho', async () => {
      await loginAs(page, GD_HOIAN);
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        renderUniformHoldingsTable();
        const idx = uniformHoldingsCache.findIndex(h => h.employeeUsername === 'nv_hoian' && h.name === 'Áo đồng phục nam' && h.size === 'L');
        openUniformHoldingActionModal(idx, 'MAT');
        document.getElementById('uniformHoldingActionQty').value = '1';
        document.getElementById('uniformHoldingActionReason').value = 'Nhân viên báo mất áo';
        await window.__confirmPending();
        const stock = computeUniformStockClient('Siêu Thị Hội An');
        const row = stock.get('Áo đồng phục nam|||L');
        return { alerts: window.__alerts, foundIdx: idx, heldBefore: uniformHoldingsCache[idx]?.held, mat: row.mat, recalled: row.recalled, stockLeft: row.stock };
      });
      assert(result.foundIdx !== -1, 'Phải tìm thấy dòng holding của nv_hoian trong bảng Đang Giữ');
      assertIncludes(result.alerts, 'Đã ghi nhận thao tác', 'Phải có thông báo ghi nhận thành công');
      assertEqual(result.mat, 1, 'Mất phải đúng 1');
      assertEqual(result.recalled, 4, 'recalled phải cộng dồn thêm 1 (thao tác Mất cũng tính là thu hồi khỏi nhân viên): 3 + 1 = 4');
      // Món đã Mất KHÔNG quay lại tồn khả dụng — nhưng cũng không bị trừ THÊM lần nữa: nó đã bị loại khỏi
      // tồn kho ngay từ lúc issued (giống hệt cách outcome Hỏng ở kịch bản #15 cũng giữ nguyên tồn kho).
      assertEqual(result.stockLeft, 14, 'Tồn kho GIỮ NGUYÊN 14 — món đã Mất đã bị loại khỏi tồn từ lúc cấp phát, không trừ thêm lần nữa');
    });

    // ===== 22) Validation: mặt hàng KHÔNG có trong Danh Mục Đồng Phục bị chặn khi tạo kỳ cấp phát =====
    await run.run('Validation: mặt hàng ngoài Danh Mục Đồng Phục bị chặn khi tạo kỳ cấp phát', async () => {
      await loginAs(page, HC);
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        try {
          await callCreateAction('uniformPeriods', {
            name: 'Kỳ mặt hàng lạ',
            allocations: [{ dept: 'Siêu Thị Hội An', items: [{ name: 'Mũ bảo hiểm', size: '', qty: 5 }] }]
          });
          return { errorMsg: null };
        } catch (err) {
          return { errorMsg: err.message };
        }
      });
      assertIncludes(result.errorMsg, 'không có trong Danh Mục Đồng Phục', 'Server phải chặn mặt hàng không có trong danh mục');
    });

    // ===== 23) Validation: size không thuộc mặt hàng đã chọn bị chặn khi tạo kỳ cấp phát =====
    await run.run('Validation: size không thuộc mặt hàng đã chọn bị chặn khi tạo kỳ cấp phát', async () => {
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        try {
          await callCreateAction('uniformPeriods', {
            name: 'Kỳ size sai',
            allocations: [{ dept: 'Siêu Thị Hội An', items: [{ name: 'Áo đồng phục nam', size: 'XXXL', qty: 5 }] }]
          });
          return { errorMsg: null };
        } catch (err) {
          return { errorMsg: err.message };
        }
      });
      assertIncludes(result.errorMsg, 'không hợp lệ cho', 'Server phải chặn size không thuộc mặt hàng đã chọn');
    });

    // ===== 24) Tách Kho Mới/Cũ: HC tạo + tự duyệt (uniformManage gộp uniformApprove) kỳ mới, GD Hội An
    // xác nhận, cấp phát, thu hồi TỐT rồi cấp tiếp — kiểm tra newStock/usedStock đúng chính sách ưu
    // tiên xài "đã sử dụng" trước (computeUniformStockBreakdownClient(), xem lib/recordActions.js
    // computeUniformStockBreakdown()) =====
    await run.run('Chuẩn bị: HC tạo + tự duyệt kỳ riêng cho kịch bản tách kho Mới/Cũ', async () => {
      await loginAs(page, HC);
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        setUniformSubTab('PERIODS');
        document.getElementById('uniformPeriodName').value = 'Kỳ Test Mới Cũ';
        addUniformAllocationBlock();
        updateUniformAllocDept(0, 'Siêu Thị Hội An');
        updateUniformAllocItemField(0, 0, 'name', 'Áo đồng phục nam');
        updateUniformAllocItemField(0, 0, 'size', 'M');
        updateUniformAllocItemField(0, 0, 'qty', '10');
        await submitUniformPeriod();
        const p = DB.uniformPeriods.find(x => x.name === 'Kỳ Test Mới Cũ');
        const r = await callRecordAction('uniformPeriods', p.id, 'approve', {});
        const idx = DB.uniformPeriods.findIndex(x => x.id === p.id);
        DB.uniformPeriods[idx] = r.item;
        return { approvalStatus: r.item.approvalStatus };
      });
      assertEqual(result.approvalStatus, 'APPROVED', 'HC (uniformManage) phải tự duyệt được kỳ mới này');
    });

    await run.run('Tách Kho Mới/Cũ: sau khi xác nhận, toàn bộ 10 áo phải là "Mới"', async () => {
      await loginAs(page, GD_HOIAN);
      const result = await page.evaluate(async () => {
        switchTab('uniform');
        setUniformSubTab('STORE');
        const p = DB.uniformPeriods.find(x => x.name === 'Kỳ Test Mới Cũ');
        const alloc = p.allocations.find(a => a.dept === 'Siêu Thị Hội An');
        confirmUniformAllocationAction(p.id, alloc.id);
        await window.__confirmPending();
        const breakdown = computeUniformStockBreakdownClient('Siêu Thị Hội An');
        const pool = breakdown.get('Áo đồng phục nam|||M');
        const stock = computeUniformStockClient('Siêu Thị Hội An').get('Áo đồng phục nam|||M');
        return { newStock: pool.newStock, usedStock: pool.usedStock, totalStock: stock.stock };
      });
      assertEqual(result.newStock, 10, 'newStock phải bằng đúng 10 (chưa cấp cho ai)');
      assertEqual(result.usedStock, 0, 'usedStock phải bằng 0 (chưa có hàng thu hồi)');
      assertEqual(result.totalStock, 10, 'newStock + usedStock phải khớp đúng tổng tồn kho (computeUniformStockClient)');
    });

    await run.run('Tách Kho Mới/Cũ: cấp 4 cái đầu tiên phải trừ vào newStock (chưa có hàng cũ)', async () => {
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        resetUniformIssueForm();
        document.getElementById('uniformIssueEmployee').value = 'Lê Văn Nhân Viên (nv_hoian)';
        resolveUniformEmployeeInput('uniformIssueEmployee', 'uniformIssueEmployeeUsername');
        updateUniformIssueItemNameSize(0, 'Áo đồng phục nam|||M');
        updateUniformIssueItemField(0, 'qty', '4');
        await submitUniformIssuance();
        const breakdown = computeUniformStockBreakdownClient('Siêu Thị Hội An');
        const pool = breakdown.get('Áo đồng phục nam|||M');
        return { alerts: window.__alerts, newStock: pool.newStock, usedStock: pool.usedStock };
      });
      assertIncludes(result.alerts, 'Đã cấp đồng phục cho nhân viên', 'Phải cấp phát thành công');
      assertEqual(result.newStock, 6, 'newStock phải giảm còn 6 (10 - 4)');
      assertEqual(result.usedStock, 0, 'usedStock vẫn phải bằng 0');
    });

    await run.run('Tách Kho Mới/Cũ: thu hồi TỐT 3 cái phải cộng vào usedStock, không đụng newStock', async () => {
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        resetUniformAdjustForms();
        document.getElementById('uniformAdjEmpEmployee').value = 'Lê Văn Nhân Viên (nv_hoian)';
        resolveUniformEmployeeInput('uniformAdjEmpEmployee', 'uniformAdjEmpEmployeeUsername');
        renderUniformAdjEmpItemOptions();
        document.getElementById('uniformAdjEmpItemSize').value = 'Áo đồng phục nam|||M';
        onUniformAdjEmpItemSizeChange();
        document.getElementById('uniformAdjEmpQty').value = '3';
        document.querySelector('input[name="uniformAdjEmpOutcome"][value="TON"]').checked = true;
        document.getElementById('uniformAdjEmpReason').value = 'test tách kho mới cũ';
        await submitUniformStockAdjustment('EMPLOYEE');
        const breakdown = computeUniformStockBreakdownClient('Siêu Thị Hội An');
        const pool = breakdown.get('Áo đồng phục nam|||M');
        return { alerts: window.__alerts, newStock: pool.newStock, usedStock: pool.usedStock };
      });
      assertIncludes(result.alerts, 'Đã ghi nhận thao tác', 'Phải ghi nhận thu hồi thành công');
      assertEqual(result.newStock, 6, 'newStock phải giữ nguyên 6 (thu hồi không tạo hàng mới)');
      assertEqual(result.usedStock, 3, 'usedStock phải tăng lên 3 (hàng đã qua sử dụng, còn tốt)');
    });

    await run.run('Tách Kho Mới/Cũ: cấp 5 cái tiếp theo phải ƯU TIÊN xài hết usedStock (3) trước khi đụng newStock', async () => {
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        resetUniformIssueForm();
        document.getElementById('uniformIssueEmployee').value = 'Lê Văn Nhân Viên (nv_hoian)';
        resolveUniformEmployeeInput('uniformIssueEmployee', 'uniformIssueEmployeeUsername');
        updateUniformIssueItemNameSize(0, 'Áo đồng phục nam|||M');
        updateUniformIssueItemField(0, 'qty', '5');
        await submitUniformIssuance();
        const breakdown = computeUniformStockBreakdownClient('Siêu Thị Hội An');
        const pool = breakdown.get('Áo đồng phục nam|||M');
        const stock = computeUniformStockClient('Siêu Thị Hội An').get('Áo đồng phục nam|||M');
        return { alerts: window.__alerts, newStock: pool.newStock, usedStock: pool.usedStock, totalStock: stock.stock };
      });
      assertIncludes(result.alerts, 'Đã cấp đồng phục cho nhân viên', 'Phải cấp phát thành công');
      // 5 cần cấp: 3 lấy từ usedStock (còn 0), 2 còn lại lấy từ newStock (6 -> 4)
      assertEqual(result.usedStock, 0, 'usedStock phải về 0 (đã dùng hết 3 hàng cũ trước)');
      assertEqual(result.newStock, 4, 'newStock phải còn 4 (6 - 2, phần vượt quá usedStock)');
      assertEqual(result.totalStock, 4, 'Tổng tồn kho phải khớp newStock + usedStock = 4');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-uniform.js:', err);
  process.exitCode = 1;
});
