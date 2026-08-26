// server/tests/test-uniform-phase2.js
//
// Regression test cho PHASE 2 của module Đồng Phục (tiếp nối tests/test-uniform.js, vốn đã cover đầy đủ
// luồng Phase 1 + cổng duyệt kỳ cấp phát mới — approve/reject/pending-block — ở các kịch bản 3b-3e).
// File này tập trung vào các phần MỚI của Phase 2 chưa có trong test-uniform.js:
//   - SKU tự sinh (Mã Đồng Phục): sinh 1 lần cho (mặt hàng,size), TÁI SỬ DỤNG ở siêu thị/kỳ khác.
//   - 3 nút thao tác nhanh (Thu Hồi/Báo Hỏng/Báo Mất) trên bảng "Đang Giữ" — cùng hiệu lực với form đầy
//     đủ cũ (buildUniformStockAdjustment không đổi, chỉ khác đường gọi từ giao diện).
//   - Chi tiết theo kỳ (drill-down) ở Kho Đồng Phục — tính client-side từ DB.uniformPeriods.
//   - Điều Chuyển Kho Giữa Các Siêu Thị (uniformTransfers): yêu cầu/duyệt/từ chối, khoá kép lúc duyệt.
//   - Tổng Quan (Dashboard): phạm vi xem theo vai trò.
//   - Danh Mục Đồng Phục: uniformManage (không chỉ admin) giờ cũng sửa được.
//
// Chạy: node server/tests/test-uniform-phase2.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual, assertIncludes
} = require('./testHarness');

const PORT = 8982;

// ===================== Seed dữ liệu =====================
const STORES = ['Siêu Thị A', 'Siêu Thị B'];

const HC = { username: 'hc1', name: 'Nguyễn Văn Hành Chính', dept: 'Hành Chính', perms: { uniformManage: true }, active: true };
const APPROVER = { username: 'approver1', name: 'Người Duyệt Đồng Phục', dept: 'Hành Chính', perms: { uniformApprove: true }, active: true };
const GD_A = { username: 'gd_a', name: 'Giám Đốc Siêu Thị A', dept: 'Siêu Thị A', perms: { uniformStoreManage: true }, active: true };
const GD_B = { username: 'gd_b', name: 'Giám Đốc Siêu Thị B', dept: 'Siêu Thị B', perms: { uniformStoreManage: true }, active: true };
const NV_A = { username: 'nv_a', name: 'Nhân Viên Siêu Thị A', dept: 'Siêu Thị A', perms: {}, active: true };
const EMP_NOPERM = { username: 'emp_noperm', name: 'Người Không Quyền', dept: 'Hành Chính', perms: {}, active: true };

const state = createMockState({
  depts: ['Hành Chính'],
  stores: STORES,
  users: [HC, APPROVER, GD_A, GD_B, NV_A, EMP_NOPERM],
  uniformCatalog: [
    { id: 1, name: 'Áo đồng phục nam', sizes: ['L', 'XL'] },
    { id: 2, name: 'Quần đồng phục', sizes: ['32'] }
  ]
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
    let periodId, allocAId, allocBId;

    // ===== 1) HC tạo kỳ cấp phát cho 2 siêu thị (nền cho mọi kịch bản Phase 2 bên dưới) =====
    await run.run('Chuẩn bị: HC tạo kỳ cấp phát cho Siêu Thị A + B', async () => {
      await loginAs(page, HC);
      const result = await page.evaluate(async () => {
        switchTab('uniform');
        setUniformSubTab('PERIODS');
        document.getElementById('uniformPeriodName').value = 'Kỳ Phase 2';
        addUniformAllocationBlock();
        updateUniformAllocDept(0, 'Siêu Thị A');
        updateUniformAllocItemField(0, 0, 'name', 'Áo đồng phục nam');
        updateUniformAllocItemField(0, 0, 'size', 'L');
        updateUniformAllocItemField(0, 0, 'qty', '20');
        addUniformAllocationBlock();
        updateUniformAllocDept(1, 'Siêu Thị B');
        updateUniformAllocItemField(1, 0, 'name', 'Áo đồng phục nam');
        updateUniformAllocItemField(1, 0, 'size', 'L');
        updateUniformAllocItemField(1, 0, 'qty', '15');
        await submitUniformPeriod();
        const p = DB.uniformPeriods.find(x => x.name === 'Kỳ Phase 2');
        return { id: p.id, allocA: p.allocations.find(a => a.dept === 'Siêu Thị A').id, allocB: p.allocations.find(a => a.dept === 'Siêu Thị B').id };
      });
      periodId = result.id; allocAId = result.allocA; allocBId = result.allocB;
      assert(periodId, 'Phải tạo được kỳ cấp phát');
    });

    await run.run('Chuẩn bị: APPROVER duyệt kỳ', async () => {
      await loginAs(page, APPROVER);
      await page.evaluate(async (id) => {
        const r = await callRecordAction('uniformPeriods', id, 'approve', {});
        const idx = DB.uniformPeriods.findIndex(x => x.id === id);
        DB.uniformPeriods[idx] = r.item;
      }, periodId);
      const status = await page.evaluate((id) => DB.uniformPeriods.find(x => x.id === id).approvalStatus, periodId);
      assertEqual(status, 'APPROVED', 'Kỳ phải APPROVED trước khi 2 siêu thị xác nhận');
    });

    // ===== 2) SKU tự sinh — Giám Đốc A xác nhận trước, sinh SKU mới =====
    await run.run('SKU: Giám Đốc Siêu Thị A xác nhận đầu tiên -> tự sinh SKU cho (Áo đồng phục nam, L)', async () => {
      await loginAs(page, GD_A);
      const result = await page.evaluate(async ({ id, allocId }) => {
        const r = await callRecordAction('uniformPeriods', id, 'confirm-allocation', { allocationId: allocId });
        const idx = DB.uniformPeriods.findIndex(x => x.id === id);
        DB.uniformPeriods[idx] = r.item;
        if (r.uniformCatalog) DB.uniformCatalog = r.uniformCatalog; // xem confirmUniformAllocationAction()
        return DB.uniformCatalog.find(c => c.name === 'Áo đồng phục nam')?.codesBySize?.L;
      }, { id: periodId, allocId: allocAId });
      assert(result, 'Phải sinh được mã SKU cho (Áo đồng phục nam, L)');
      assertIncludes(result, 'AODONGPHUCNAM-L-', 'Mã SKU phải đúng định dạng {viết-tắt}-{size}-{số thứ tự}');
    });

    // ===== 3) SKU tự sinh — Giám Đốc B xác nhận sau, TÁI SỬ DỤNG đúng mã cũ (không sinh mã mới) =====
    await run.run('SKU: Giám Đốc Siêu Thị B xác nhận sau -> tái sử dụng ĐÚNG mã đã sinh, không tạo mã khác', async () => {
      const codeBefore = await page.evaluate(() => DB.uniformCatalog.find(c => c.name === 'Áo đồng phục nam').codesBySize.L);
      await loginAs(page, GD_B);
      const result = await page.evaluate(async ({ id, allocId }) => {
        const r = await callRecordAction('uniformPeriods', id, 'confirm-allocation', { allocationId: allocId });
        const idx = DB.uniformPeriods.findIndex(x => x.id === id);
        DB.uniformPeriods[idx] = r.item;
        if (r.uniformCatalog) DB.uniformCatalog = r.uniformCatalog;
        return DB.uniformCatalog.find(c => c.name === 'Áo đồng phục nam')?.codesBySize?.L;
      }, { id: periodId, allocId: allocBId });
      assertEqual(result, codeBefore, 'Siêu thị B xác nhận sau phải dùng LẠI đúng mã SKU đã sinh ở Siêu Thị A, không sinh mã mới');
    });

    // ===== 4) Chi tiết theo kỳ (drill-down) — tính đúng từ DB.uniformPeriods đã tải =====
    await run.run('Drill-down: Chi tiết theo kỳ trả đúng SL đã CONFIRMED cho từng siêu thị', async () => {
      const result = await page.evaluate(() => ({
        a: uniformPeriodBreakdownFor('Siêu Thị A', 'Áo đồng phục nam', 'L'),
        b: uniformPeriodBreakdownFor('Siêu Thị B', 'Áo đồng phục nam', 'L')
      }));
      assertEqual(result.a.length, 1, 'Siêu Thị A phải có đúng 1 dòng kỳ cấp phát trong breakdown');
      assertEqual(result.a[0].qty, 20, 'SL breakdown của Siêu Thị A phải đúng 20');
      assertEqual(result.a[0].periodName, 'Kỳ Phase 2', 'Tên kỳ trong breakdown phải đúng');
      assertEqual(result.b[0].qty, 15, 'SL breakdown của Siêu Thị B phải đúng 15');
    });

    // ===== 5) Giám Đốc A cấp 5 áo cho nhân viên (để lại tồn = 15) =====
    await run.run('Chuẩn bị: Giám Đốc A cấp 5 áo cho nhân viên (tồn kho A còn 15)', async () => {
      await loginAs(page, GD_A);
      await page.evaluate(async () => {
        switchTab('uniform');
        setUniformSubTab('STORE');
        document.getElementById('uniformIssueEmployee').value = 'Nhân Viên Siêu Thị A (nv_a)';
        resolveUniformEmployeeInput('uniformIssueEmployee', 'uniformIssueEmployeeUsername');
        updateUniformIssueItemNameSize(0, 'Áo đồng phục nam|||L');
        updateUniformIssueItemField(0, 'qty', '5');
        await submitUniformIssuance();
      });
      const stock = await page.evaluate(() => computeUniformStockClient('Siêu Thị A').get('Áo đồng phục nam|||L').stock);
      assertEqual(stock, 15, 'Tồn kho A phải còn 20 - 5 = 15');
    });

    // ===== 6) 3 nút thao tác nhanh — Thu Hồi (TON) qua nút bảng "Đang Giữ" =====
    await run.run('Nút nhanh: "Thu Hồi" (TON) trên bảng Đang Giữ cộng lại đúng vào tồn kho', async () => {
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        renderUniformHoldingsTable();
        const idx = uniformHoldingsCache.findIndex(h => h.employeeUsername === 'nv_a' && h.name === 'Áo đồng phục nam' && h.size === 'L');
        openUniformHoldingActionModal(idx, 'TON');
        document.getElementById('uniformHoldingActionQty').value = '2';
        document.getElementById('uniformHoldingActionReason').value = 'Đổi size khác';
        await window.__confirmPending();
        return { alerts: window.__alerts, adj: DB.uniformStockAdjustments[0] };
      });
      assertIncludes(result.alerts, 'Đã ghi nhận thao tác', 'Nút Thu Hồi phải thành công');
      assertEqual(result.adj.source, 'EMPLOYEE', 'Nút nhanh phải tạo bản ghi source=EMPLOYEE giống form đầy đủ');
      assertEqual(result.adj.outcome, 'TON', 'Nút Thu Hồi phải tạo outcome=TON');
      const stock = await page.evaluate(() => computeUniformStockClient('Siêu Thị A').get('Áo đồng phục nam|||L').stock);
      assertEqual(stock, 17, 'Tồn kho phải tăng lại 15 + 2 = 17 sau khi Thu Hồi Về Tồn Kho');
    });

    // ===== 7) 3 nút thao tác nhanh — Báo Hỏng (HONG) qua nút bảng "Đang Giữ" =====
    await run.run('Nút nhanh: "Báo Hỏng" (HONG) trên bảng Đang Giữ không cộng lại vào tồn kho', async () => {
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        renderUniformHoldingsTable();
        const idx = uniformHoldingsCache.findIndex(h => h.employeeUsername === 'nv_a' && h.name === 'Áo đồng phục nam' && h.size === 'L');
        openUniformHoldingActionModal(idx, 'HONG');
        document.getElementById('uniformHoldingActionQty').value = '1';
        document.getElementById('uniformHoldingActionReason').value = 'Rách khi thu hồi';
        await window.__confirmPending();
        return { alerts: window.__alerts, adj: DB.uniformStockAdjustments[0] };
      });
      assertIncludes(result.alerts, 'Đã ghi nhận thao tác', 'Nút Báo Hỏng phải thành công');
      assertEqual(result.adj.outcome, 'HONG', 'Nút Báo Hỏng phải tạo outcome=HONG');
      const stock = await page.evaluate(() => computeUniformStockClient('Siêu Thị A').get('Áo đồng phục nam|||L').stock);
      assertEqual(stock, 17, 'Tồn kho GIỮ NGUYÊN 17 — Hỏng lúc thu hồi không quay lại tồn (đã trừ từ lúc issued)');
    });

    // ===== 8) Điều Chuyển Kho — yêu cầu vượt quá tồn kho hiện có bị chặn =====
    await run.run('Điều Chuyển: yêu cầu vượt quá tồn kho nguồn hiện có bị chặn', async () => {
      const result = await page.evaluate(async () => {
        try {
          await callCreateUniformTransfer({ targetDept: 'Siêu Thị B', itemName: 'Áo đồng phục nam', size: 'L', qty: 999, reason: 'Test vượt tồn' });
          return { errorMsg: null };
        } catch (err) {
          return { errorMsg: err.message };
        }
      });
      assertIncludes(result.errorMsg, 'Không đủ tồn kho', 'Server phải chặn yêu cầu điều chuyển vượt tồn kho nguồn');
    });

    // ===== 9) Điều Chuyển Kho — yêu cầu hợp lệ (happy path) =====
    let transferId;
    await run.run('Điều Chuyển: Giám Đốc A yêu cầu điều chuyển 5 áo sang Siêu Thị B (happy path)', async () => {
      const result = await page.evaluate(async () => {
        const r = await callCreateUniformTransfer({ targetDept: 'Siêu Thị B', itemName: 'Áo đồng phục nam', size: 'L', qty: 5, reason: 'Siêu Thị B thiếu hàng' });
        DB.uniformTransfers.unshift(r.item);
        return r.item;
      });
      transferId = result.id;
      assertEqual(result.status, 'PENDING_APPROVAL', 'Yêu cầu điều chuyển mới phải ở trạng thái PENDING_APPROVAL');
      assertEqual(result.sourceDept, 'Siêu Thị A', 'Nguồn phải luôn là siêu thị của người yêu cầu');
    });

    // ===== 10) Điều Chuyển Kho — người không có uniformApprove không duyệt được =====
    await run.run('Điều Chuyển: Giám Đốc B (không có uniformApprove) không duyệt được yêu cầu', async () => {
      await loginAs(page, GD_B);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('uniformTransfers', id, 'approve', {});
          return { errorMsg: null };
        } catch (err) {
          return { errorMsg: err.message };
        }
      }, transferId);
      assertIncludes(result.errorMsg, 'Bạn không có quyền duyệt', 'Server phải chặn Giám Đốc Siêu Thị tự duyệt điều chuyển của mình');
    });

    // ===== 11) Điều Chuyển Kho — duyệt thành công, dời tồn kho ĐÚNG cả 2 siêu thị =====
    await run.run('Điều Chuyển: APPROVER duyệt -> tồn kho A giảm 5, tồn kho B tăng 5', async () => {
      const before = await page.evaluate(() => ({
        a: computeUniformStockClient('Siêu Thị A').get('Áo đồng phục nam|||L').stock,
        b: computeUniformStockClient('Siêu Thị B').get('Áo đồng phục nam|||L').stock
      }));
      await loginAs(page, APPROVER);
      const result = await page.evaluate(async (id) => {
        const r = await callRecordAction('uniformTransfers', id, 'approve', {});
        const idx = DB.uniformTransfers.findIndex(x => x.id === id);
        DB.uniformTransfers[idx] = r.item;
        return r.item;
      }, transferId);
      assertEqual(result.status, 'APPROVED', 'Điều chuyển phải chuyển APPROVED sau khi duyệt');
      const after = await page.evaluate(() => ({
        a: computeUniformStockClient('Siêu Thị A').get('Áo đồng phục nam|||L').stock,
        b: computeUniformStockClient('Siêu Thị B').get('Áo đồng phục nam|||L').stock
      }));
      assertEqual(after.a, before.a - 5, 'Tồn kho nguồn (A) phải giảm đúng 5');
      assertEqual(after.b, before.b + 5, 'Tồn kho đích (B) phải tăng đúng 5');
    });

    // ===== 12) Điều Chuyển Kho — duyệt lại 1 yêu cầu đã APPROVED bị chặn (terminal) =====
    await run.run('Điều Chuyển: duyệt lại yêu cầu đã APPROVED bị chặn', async () => {
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('uniformTransfers', id, 'approve', {});
          return { errorMsg: null };
        } catch (err) {
          return { errorMsg: err.message };
        }
      }, transferId);
      assertIncludes(result.errorMsg, 'đã được xử lý trước đó', 'Không được xử lý lại 1 yêu cầu điều chuyển đã xong');
    });

    // ===== 13) Điều Chuyển Kho — từ chối là TERMINAL (không thể duyệt lại sau khi từ chối) =====
    let rejectedTransferId;
    await run.run('Điều Chuyển: APPROVER từ chối 1 yêu cầu khác -> REJECTED terminal', async () => {
      await loginAs(page, GD_A);
      const created = await page.evaluate(async () => {
        const r = await callCreateUniformTransfer({ targetDept: 'Siêu Thị B', itemName: 'Áo đồng phục nam', size: 'L', qty: 1, reason: 'Test từ chối' });
        DB.uniformTransfers.unshift(r.item);
        return r.item;
      });
      rejectedTransferId = created.id;

      await loginAs(page, APPROVER);
      const rejected = await page.evaluate(async (id) => {
        const r = await callRecordAction('uniformTransfers', id, 'reject', { reason: 'Siêu Thị B không còn thiếu hàng nữa' });
        const idx = DB.uniformTransfers.findIndex(x => x.id === id);
        DB.uniformTransfers[idx] = r.item;
        return r.item;
      }, rejectedTransferId);
      assertEqual(rejected.status, 'REJECTED', 'Yêu cầu phải chuyển REJECTED');

      const secondAttempt = await page.evaluate(async (id) => {
        try {
          await callRecordAction('uniformTransfers', id, 'approve', {});
          return { errorMsg: null };
        } catch (err) {
          return { errorMsg: err.message };
        }
      }, rejectedTransferId);
      assertIncludes(secondAttempt.errorMsg, 'đã được xử lý trước đó', 'Yêu cầu đã REJECTED không bao giờ duyệt được nữa (terminal)');
    });

    // ===== 14) Điều Chuyển Kho — khoá kép không deadlock (2 điều chuyển NGƯỢC CHIỀU cùng 2 siêu thị) =====
    await run.run('Điều Chuyển: 2 yêu cầu ngược chiều (A->B và B->A) cùng 2 siêu thị đều duyệt được, không deadlock', async () => {
      await loginAs(page, GD_A);
      const reqAtoB = await page.evaluate(async () => {
        const r = await callCreateUniformTransfer({ targetDept: 'Siêu Thị B', itemName: 'Áo đồng phục nam', size: 'L', qty: 1, reason: 'A->B' });
        DB.uniformTransfers.unshift(r.item);
        return r.item;
      });

      await loginAs(page, GD_B);
      const reqBtoA = await page.evaluate(async () => {
        const r = await callCreateUniformTransfer({ targetDept: 'Siêu Thị A', itemName: 'Áo đồng phục nam', size: 'L', qty: 1, reason: 'B->A' });
        DB.uniformTransfers.unshift(r.item);
        return r.item;
      });

      await loginAs(page, APPROVER);
      // Gọi "gần như đồng thời" (Promise.all) — mock không có SQL Server thật để dựng lại race thật sự,
      // nhưng ít nhất xác nhận dispatcher xử lý được 2 yêu cầu chồng khoá nhau mà không treo/lỗi lẫn nhau
      // (đúng tinh thần "sequential test is fine" mà yêu cầu đã chấp nhận — xem báo cáo cuối).
      const results = await page.evaluate(async ({ idA, idB }) => {
        const [rA, rB] = await Promise.all([
          callRecordAction('uniformTransfers', idA, 'approve', {}),
          callRecordAction('uniformTransfers', idB, 'approve', {})
        ]);
        const iA = DB.uniformTransfers.findIndex(x => x.id === idA);
        DB.uniformTransfers[iA] = rA.item;
        const iB = DB.uniformTransfers.findIndex(x => x.id === idB);
        DB.uniformTransfers[iB] = rB.item;
        return { a: rA.item.status, b: rB.item.status };
      }, { idA: reqAtoB.id, idB: reqBtoA.id });

      assertEqual(results.a, 'APPROVED', 'Điều chuyển A->B phải duyệt thành công');
      assertEqual(results.b, 'APPROVED', 'Điều chuyển B->A phải duyệt thành công');
      // 2 điều chuyển 1 chiều nhau, cùng SL -> tồn kho ròng mỗi siêu thị KHÔNG đổi so với trước bước này.
      const stockA = await page.evaluate(() => computeUniformStockClient('Siêu Thị A').get('Áo đồng phục nam|||L').stock);
      const stockB = await page.evaluate(() => computeUniformStockClient('Siêu Thị B').get('Áo đồng phục nam|||L').stock);
      assert(Number.isFinite(stockA) && Number.isFinite(stockB), 'Tồn kho 2 siêu thị vẫn phải tính được bình thường sau 2 lượt duyệt chồng khoá');
    });

    // ===== 15) Tổng Quan (Dashboard) — Giám Đốc Siêu Thị chỉ thấy đúng số của siêu thị mình =====
    await run.run('Dashboard: Giám Đốc Siêu Thị A chỉ thấy tổng của Siêu Thị A, không thấy bảng theo siêu thị', async () => {
      await loginAs(page, GD_A);
      const result = await page.evaluate(() => {
        switchTab('uniform');
        setUniformSubTab('DASHBOARD');
        const expectedStock = computeUniformStockClient('Siêu Thị A').get('Áo đồng phục nam|||L').stock;
        return {
          statStock: document.getElementById('uniformDashStatStock').textContent,
          expectedStock,
          storeWrapHidden: document.getElementById('uniformDashByStoreWrap').classList.contains('hidden')
        };
      });
      assertEqual(Number(result.statStock.replace(/\D/g, '') || result.statStock), result.expectedStock, 'Dashboard của Giám Đốc phải khớp đúng tồn kho SIÊU THỊ MÌNH');
      assert(result.storeWrapHidden, 'Giám Đốc Siêu Thị không được thấy bảng "Theo Siêu Thị" (chỉ dành cho uniformManage/admin)');
    });

    await run.run('Dashboard: Hành Chính (uniformManage) thấy TỔNG GỘP mọi siêu thị + bảng theo siêu thị', async () => {
      await loginAs(page, HC);
      const result = await page.evaluate(() => {
        switchTab('uniform');
        setUniformSubTab('DASHBOARD');
        const stockA = computeUniformStockClient('Siêu Thị A').get('Áo đồng phục nam|||L').stock;
        const stockB = computeUniformStockClient('Siêu Thị B').get('Áo đồng phục nam|||L').stock;
        return {
          statStock: document.getElementById('uniformDashStatStock').textContent,
          expectedTotal: stockA + stockB,
          storeWrapHidden: document.getElementById('uniformDashByStoreWrap').classList.contains('hidden'),
          storeRowCount: document.querySelectorAll('#uniformDashByStoreBody tr').length
        };
      });
      assertEqual(Number(result.statStock.replace(/\./g, '')), result.expectedTotal, 'Dashboard của Hành Chính phải khớp TỔNG tồn kho MỌI siêu thị');
      assert(!result.storeWrapHidden, 'Hành Chính (uniformManage) phải thấy bảng "Theo Siêu Thị"');
      assert(result.storeRowCount >= 2, 'Bảng theo siêu thị phải liệt kê ít nhất 2 siêu thị (A và B)');
    });

    // ===== 16) Danh Mục Đồng Phục — uniformManage (không phải admin) giờ cũng sửa được =====
    await run.run('Danh Mục: Hành Chính (uniformManage, KHÔNG admin) thêm được mặt hàng mới vào Danh Mục Đồng Phục', async () => {
      await loginAs(page, HC);
      const result = await page.evaluate(async () => {
        switchTab('uniform');
        setUniformSubTab('PERIODS');
        document.getElementById('uniformCatalogName').value = 'Mũ đồng phục';
        document.getElementById('uniformCatalogSizes').value = 'Freesize';
        saveUniformCatalogItem();
        // syncStorage() chạy bất đồng bộ (fire-and-forget) — đợi 1 tick microtask để request mock kịp
        // xử lý xong trước khi kiểm tra state.uniformCatalog phía server mock.
        await new Promise(r => setTimeout(r, 50));
        return DB.uniformCatalog.some(c => c.name === 'Mũ đồng phục');
      });
      assert(result, 'Hành Chính (uniformManage) phải thêm được mặt hàng mới vào Danh Mục Đồng Phục');
    });

    await run.run('Danh Mục: người không có quyền (không admin, không uniformManage) bị chặn ghi Danh Mục Đồng Phục', async () => {
      await loginAs(page, EMP_NOPERM);
      const result = await page.evaluate(async () => {
        const res = await fetch('/api/data/uniformCatalog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([{ id: 999, name: 'Hack', sizes: ['X'] }])
        });
        const body = await res.json().catch(() => ({}));
        return { status: res.status, error: body.error };
      });
      assertEqual(result.status, 403, 'Server phải trả 403 cho người không có quyền sửa Danh Mục Đồng Phục');
      assertIncludes(result.error, 'Chỉ Quản Trị Viên', 'Thông báo lỗi phải đúng nội dung gate hiện có');
    });

    // ===== 17) Truy cập module — người CHỈ có uniformApprove (không uniformManage/uniformStoreManage)
    // vẫn vào được module VÀ tới được cả 2 tab cần để duyệt (Kỳ Cấp Phát + Xác Nhận/Cấp Phát) =====
    await run.run('Truy cập: người chỉ có uniformApprove vẫn vào được module và tới được tab Kỳ Cấp Phát + Xác Nhận/Cấp Phát', async () => {
      await loginAs(page, APPROVER);
      const result = await page.evaluate(() => {
        const canAccess = canAccessUniformModule(currentUser);
        switchTab('uniform');
        setUniformSubTab('PERIODS');
        const periodsSubTab = activeUniformSubTab;
        const createFormHidden = document.getElementById('uniformCreatePeriodBlock').classList.contains('hidden');
        setUniformSubTab('STORE');
        const storeSubTab = activeUniformSubTab;
        return { canAccess, periodsSubTab, storeSubTab, createFormHidden };
      });
      assert(result.canAccess, 'canAccessUniformModule() phải cho phép người chỉ có uniformApprove vào module');
      assertEqual(result.periodsSubTab, 'PERIODS', 'Approver phải tới được tab Kỳ Cấp Phát (để duyệt/từ chối)');
      assert(result.createFormHidden, 'Approver KHÔNG có uniformManage thì không được thấy form "Tạo Kỳ Cấp Phát"');
      assertEqual(result.storeSubTab, 'STORE', 'Approver phải tới được tab Xác Nhận/Cấp Phát (để duyệt/từ chối điều chuyển kho)');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-uniform-phase2.js:', err);
  process.exitCode = 1;
});
