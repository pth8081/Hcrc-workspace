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
const GD_HOIAN = { username: 'gd_hoian', name: 'Trần Thị Hội An', dept: 'Siêu Thị Hội An', perms: { uniformStoreManage: true }, active: true };
const NV_HOIAN = { username: 'nv_hoian', name: 'Lê Văn Nhân Viên', dept: 'Siêu Thị Hội An', perms: {}, active: true };
const GD_DANANG = { username: 'gd_danang', name: 'Phạm Thị Đà Nẵng', dept: 'Siêu Thị Đà Nẵng', perms: { uniformStoreManage: true }, active: true };
const EMP_NOPERM = { username: 'emp_noperm', name: 'Người Không Quyền', dept: 'Hành Chính', perms: {}, active: true };

const state = createMockState({
  depts: ['Hành Chính'],
  stores: STORES,
  users: [HC, GD_HOIAN, NV_HOIAN, GD_DANANG, EMP_NOPERM]
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
        updateUniformIssueItemField(0, 'name', 'Áo đồng phục nam');
        updateUniformIssueItemField(0, 'size', 'L');
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
        updateUniformIssueItemField(0, 'name', 'Áo đồng phục nam');
        updateUniformIssueItemField(0, 'size', 'L');
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
        document.getElementById('uniformAdjEmpItemName').value = 'Áo đồng phục nam';
        document.getElementById('uniformAdjEmpSize').value = 'L';
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
        document.getElementById('uniformAdjEmpItemName').value = 'Áo đồng phục nam';
        document.getElementById('uniformAdjEmpSize').value = 'L';
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
        document.getElementById('uniformAdjEmpItemName').value = 'Áo đồng phục nam';
        document.getElementById('uniformAdjEmpSize').value = 'L';
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
