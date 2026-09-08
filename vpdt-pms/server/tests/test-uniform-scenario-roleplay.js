// server/tests/test-uniform-scenario-roleplay.js
//
// Đóng vai đầy đủ kịch bản nghiệp vụ người dùng yêu cầu cho module Đồng Phục, bấm THẬT qua DOM
// (page.click()/page.fill()), không evaluate tắt qua logic nghiệp vụ ở các bước chính:
//   1) Quản lý Hành Chính (HC) tạo kỳ cấp phát đồng phục cho Siêu Thị A.
//   2) HC duyệt kỳ cấp phát.
//   3) Giám đốc Siêu Thị A (GD_A) xác nhận đã nhận đồng phục (nhập kho ST A).
//   4) GD_A cấp phát đồng phục cho 1 nhân viên (NV_A).
//   5) NV_A tự xác nhận đã nhận đồng phục (qua "👕 Đồng Phục Của Tôi" trong Hồ Sơ Cá Nhân — không cần
//      quyền đặc biệt nào, đúng luồng tự phục vụ thật của hệ thống).
//   6) GD_A tạo yêu cầu điều chuyển kho từ Siêu Thị A sang Siêu Thị B.
//   7) HC (Quản lý Hành Chính) xác nhận (duyệt) điều chuyển kho — ĐÚNG người duyệt thật trong hệ thống
//      (không phải Giám Đốc Siêu Thị B, xem lib/recordActions.js canApproveUniformTransfer()). Mô hình
//      "hàng đang vận chuyển": kho Siêu Thị A (nguồn) giảm NGAY lúc HC duyệt, kho Siêu Thị B (đích) CHƯA
//      tăng.
//   8) Giám Đốc Siêu Thị B (đích) tự bấm "Xác nhận đã nhận" (receiveUniformTransfer()) — CHỈ lúc này kho
//      Siêu Thị B mới thật sự tăng. Bổ sung theo yêu cầu người dùng sau đợt test lần đầu (trước đó hệ
//      thống chuyển tồn kho ngay lúc HC duyệt, không có bước GĐ ST đích xác nhận riêng).
//
// Xen kẽ các bước trên là các phép thử BẢO MẬT/PHÂN QUYỀN (đúng yêu cầu "không có lỗ hổng bảo mật"):
//   - Nhân viên không có quyền không tạo được kỳ cấp phát.
//   - Giám Đốc Siêu Thị B không xác nhận được phân bổ của Siêu Thị A (khác siêu thị).
//   - Người khác (không phải chính nhân viên được cấp) không tự xác nhận nhận đồng phục thay được.
//   - Giám Đốc Siêu Thị B (không có uniformApprove) không tự duyệt được yêu cầu điều chuyển của mình.
//   - GET /api/data: mỗi vai trò chỉ thấy đúng phạm vi dữ liệu Đồng Phục của mình (HC thấy hết, GD một
//     siêu thị chỉ thấy siêu thị mình + các điều chuyển liên quan, người ngoài cuộc không thấy gì).
//
// Chạy: node server/tests/test-uniform-scenario-roleplay.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual, assertIncludes
} = require('./testHarness');

const PORT = 8983;

const STORES = ['Siêu Thị A', 'Siêu Thị B'];

const HC = { username: 'hc_rp', name: 'Trần Thị Hành Chính', dept: 'Hành Chính', perms: { uniformManage: true }, active: true };
const GD_A = { username: 'gd_a_rp', name: 'Nguyễn Văn A (GĐ Siêu Thị A)', dept: 'Siêu Thị A', perms: { uniformStoreManage: true }, active: true };
const GD_B = { username: 'gd_b_rp', name: 'Lê Thị B (GĐ Siêu Thị B)', dept: 'Siêu Thị B', perms: { uniformStoreManage: true }, active: true };
const NV_A = { username: 'nv_a_rp', name: 'Phạm Văn Nhân Viên A', dept: 'Siêu Thị A', perms: {}, active: true };
const NV_B = { username: 'nv_b_rp', name: 'Hoàng Thị Nhân Viên B', dept: 'Siêu Thị B', perms: {}, active: true };
const OUTSIDER = { username: 'outsider_rp', name: 'Người Ngoài Cuộc', dept: 'Hành Chính', perms: {}, active: true };

const state = createMockState({
  depts: ['Hành Chính'],
  stores: STORES,
  users: [HC, GD_A, GD_B, NV_A, NV_B, OUTSIDER],
  uniformCatalog: [{ id: 1, name: 'Áo đồng phục nam', sizes: ['L'] }]
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
    // ===== 0) Bảo mật: nhân viên không có quyền không tạo được kỳ cấp phát =====
    await run.run('Bảo mật: Nhân viên (không có uniformManage) KHÔNG tạo được kỳ cấp phát', async () => {
      await loginAs(page, NV_A);
      const result = await page.evaluate(async () => {
        try {
          await callCreateAction('uniformPeriods', { name: 'Kỳ hack', allocations: [{ dept: 'Siêu Thị A', items: [{ name: 'Áo đồng phục nam', size: 'L', qty: 1 }] }] });
          return { errorMsg: null };
        } catch (err) {
          return { errorMsg: err.message };
        }
      });
      assertIncludes(result.errorMsg, 'Bạn không có quyền', 'Server phải chặn nhân viên thường tạo kỳ cấp phát');
    });

    // ===== 1) HC tạo kỳ cấp phát cho Siêu Thị A (DOM thật) =====
    let periodId, allocAId;
    await run.run('1) Quản lý Hành Chính tạo kỳ cấp phát 20 áo (L) cho Siêu Thị A (bấm THẬT)', async () => {
      await loginAs(page, HC);
      const result = await page.evaluate(async () => {
        switchTab('uniform');
        setUniformSubTab('PERIODS');
        document.getElementById('uniformPeriodName').value = 'Kỳ Cấp Phát Đóng Vai';
        addUniformAllocationBlock();
        updateUniformAllocDept(0, 'Siêu Thị A');
        updateUniformAllocItemField(0, 0, 'name', 'Áo đồng phục nam');
        updateUniformAllocItemField(0, 0, 'size', 'L');
        updateUniformAllocItemField(0, 0, 'qty', '20');
        await submitUniformPeriod();
        const p = DB.uniformPeriods.find(x => x.name === 'Kỳ Cấp Phát Đóng Vai');
        return { id: p ? p.id : null, allocA: p ? p.allocations.find(a => a.dept === 'Siêu Thị A').id : null };
      });
      periodId = result.id; allocAId = result.allocA;
      assert(periodId, 'HC phải tạo được kỳ cấp phát');
    });

    // ===== 2) HC duyệt kỳ (bấm nút "Duyệt" thật trên danh sách) =====
    await run.run('2) Quản lý Hành Chính duyệt kỳ cấp phát (bấm nút thật)', async () => {
      await page.evaluate(() => { renderUniformPeriodsList(); });
      await page.click(`button[data-op="approveUniformPeriodAction"][data-arg0="${periodId}"]`);
      // approveUniformPeriodAction() mở showConfirmModal() (modal xác nhận tuỳ biến của hệ thống, KHÔNG
      // phải window.confirm() gốc) — bấm nút "✔️ Duyệt" chỉ MỞ modal, phải "bấm" tiếp nút "Đồng Ý" trong
      // modal đó (window.__confirmPending(), do testHarness lộ ra) thì onConfirm() mới thực sự chạy.
      await page.evaluate(() => window.__confirmPending());
      await page.waitForTimeout(120);
      const status = await page.evaluate((id) => DB.uniformPeriods.find(x => x.id === id).approvalStatus, periodId);
      assertEqual(status, 'APPROVED', 'Kỳ phải chuyển APPROVED sau khi HC bấm Duyệt');
    });

    // ===== 3) Bảo mật: GD Siêu Thị B KHÔNG xác nhận được phân bổ của Siêu Thị A =====
    await run.run('Bảo mật: Giám Đốc Siêu Thị B KHÔNG xác nhận được phân bổ của Siêu Thị A (khác siêu thị)', async () => {
      await loginAs(page, GD_B);
      const result = await page.evaluate(async ({ id, allocId }) => {
        try {
          await callRecordAction('uniformPeriods', id, 'confirm-allocation', { allocationId: allocId });
          return { errorMsg: null };
        } catch (err) {
          return { errorMsg: err.message };
        }
      }, { id: periodId, allocId: allocAId });
      assert(result.errorMsg, 'Server phải chặn Giám Đốc siêu thị khác xác nhận phân bổ không thuộc siêu thị mình');
    });

    // ===== 4) Giám Đốc Siêu Thị A xác nhận nhận đồng phục (nhập kho ST A, bấm THẬT) =====
    await run.run('3) Giám Đốc Siêu Thị A xác nhận ĐÃ NHẬN đồng phục -> nhập kho ST A (bấm THẬT)', async () => {
      await loginAs(page, GD_A);
      await page.evaluate(() => { switchTab('uniform'); setUniformSubTab('STORE'); });
      await page.click(`button[data-op="confirmUniformAllocationAction"][data-arg0="${periodId}"][data-arg1="${allocAId}"]`);
      await page.evaluate(() => window.__confirmPending());
      await page.waitForTimeout(150);
      const stock = await page.evaluate(() => computeUniformStockClient('Siêu Thị A').get('Áo đồng phục nam|||L').stock);
      assertEqual(stock, 20, 'Tồn kho Siêu Thị A phải đúng 20 sau khi GD Siêu Thị A xác nhận nhận hàng');
    });

    // ===== 5) Giám Đốc Siêu Thị A cấp phát 5 áo cho nhân viên NV_A (form thật) =====
    await run.run('4) Giám Đốc Siêu Thị A cấp phát 5 áo cho nhân viên NV_A (điền form + bấm THẬT)', async () => {
      const result = await page.evaluate(async () => {
        setUniformSubTab('STORE');
        document.getElementById('uniformIssueEmployee').value = 'Phạm Văn Nhân Viên A (nv_a_rp)';
        resolveUniformEmployeeInput('uniformIssueEmployee', 'uniformIssueEmployeeUsername');
        updateUniformIssueItemNameSize(0, 'Áo đồng phục nam|||L');
        updateUniformIssueItemField(0, 'qty', '5');
        await submitUniformIssuance();
        const issuance = DB.uniformIssuances.find(x => x.employeeUsername === 'nv_a_rp');
        return { id: issuance ? issuance.id : null, ackStatus: issuance ? issuance.ackStatus : null };
      });
      assert(result.id, 'Giám Đốc Siêu Thị A phải cấp phát được đồng phục cho nhân viên');
      assertEqual(result.ackStatus, 'PENDING_ACK', 'Bản ghi cấp phát mới phải ở trạng thái CHỜ nhân viên xác nhận');
      const stock = await page.evaluate(() => computeUniformStockClient('Siêu Thị A').get('Áo đồng phục nam|||L').stock);
      assertEqual(stock, 15, 'Tồn kho Siêu Thị A phải còn 20 - 5 = 15 sau khi cấp phát');
    });

    // ===== 6) Bảo mật: người KHÁC (không phải chính nhân viên) không tự xác nhận nhận thay được =====
    await run.run('Bảo mật: nhân viên siêu thị B KHÔNG tự xác nhận nhận thay đồng phục của nhân viên A được', async () => {
      const issuanceId = await page.evaluate(() => DB.uniformIssuances.find(x => x.employeeUsername === 'nv_a_rp').id);
      await loginAs(page, NV_B);
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('uniformIssuances', id, 'acknowledge', {});
          return { errorMsg: null };
        } catch (err) {
          return { errorMsg: err.message };
        }
      }, issuanceId);
      assert(result.errorMsg, 'Server phải chặn người khác tự xác nhận nhận đồng phục thay nhân viên A');
    });

    // ===== 7) Nhân viên A tự xác nhận đã nhận đồng phục — qua "👕 Đồng Phục Của Tôi" trong Hồ Sơ Cá
    // Nhân (đúng luồng tự phục vụ thật, không cần bất kỳ quyền đặc biệt nào — bấm THẬT) =====
    await run.run('5) Nhân viên A tự xác nhận ĐÃ NHẬN đồng phục qua "👕 Đồng Phục Của Tôi" (bấm THẬT)', async () => {
      await loginAs(page, NV_A);
      // setProfileSubTab('UNIFORM') tự nạp module-dongphuc.js bất đồng bộ (loadModuleGroup, fire-and-
      // forget) — await thẳng loadModuleGroup() trước để chắc chắn renderMyUniformIssuancesTable() đã
      // định nghĩa VÀ đã chạy xong trước khi tìm nút, tránh race điều kiện thay vì đoán 1 mốc chờ cố định.
      await page.evaluate(async () => {
        openProfileModal();
        await loadModuleGroup('dongphuc');
        setProfileSubTab('UNIFORM');
        renderMyUniformIssuancesTable();
      });
      await page.click('button[data-op="acknowledgeUniformIssuanceAction"]');
      await page.waitForTimeout(150);
      const ackStatus = await page.evaluate(() => DB.uniformIssuances.find(x => x.employeeUsername === 'nv_a_rp').ackStatus);
      assertEqual(ackStatus, 'ACKNOWLEDGED', 'Nhân viên A tự bấm xác nhận xong thì bản ghi cấp phát phải chuyển ACKNOWLEDGED');
      // Đóng lại Hồ Sơ Cá Nhân — nếu không, overlay của modal còn che các bước bấm nút sau này (không
      // phải lỗi sản phẩm, chỉ là quên đóng modal trong kịch bản test khi chuyển sang vai trò khác).
      await page.evaluate(() => { closeProfileModal(); });
    });

    // ===== 8) Giám Đốc Siêu Thị A tạo yêu cầu điều chuyển kho A -> B (form thật) =====
    let transferId;
    await run.run('6) Giám Đốc Siêu Thị A yêu cầu điều chuyển 5 áo sang Siêu Thị B (điền form + bấm THẬT)', async () => {
      await loginAs(page, GD_A);
      await page.evaluate(() => { switchTab('uniform'); setUniformSubTab('STORE'); });
      const result = await page.evaluate(async () => {
        document.getElementById('uniformTransferTargetDept').value = 'Siêu Thị B';
        document.getElementById('uniformTransferItemSize').value = 'Áo đồng phục nam|||L';
        document.getElementById('uniformTransferQty').value = '5';
        document.getElementById('uniformTransferReason').value = 'Siêu Thị B thiếu hàng, chuyển bớt từ Siêu Thị A';
        await submitUniformTransfer();
        const t = DB.uniformTransfers.find(x => x.sourceDept === 'Siêu Thị A' && x.targetDept === 'Siêu Thị B' && x.status === 'PENDING_APPROVAL');
        return t ? t.id : null;
      });
      transferId = result;
      assert(transferId, 'Giám Đốc Siêu Thị A phải tạo được yêu cầu điều chuyển kho');
    });

    // ===== 9) Bảo mật: Giám Đốc Siêu Thị B KHÔNG tự duyệt được yêu cầu điều chuyển đến kho mình =====
    await run.run('Bảo mật: Giám Đốc Siêu Thị B (không có uniformApprove) KHÔNG tự duyệt được điều chuyển đến kho mình', async () => {
      await loginAs(page, GD_B);
      await page.evaluate(() => { switchTab('uniform'); setUniformSubTab('STORE'); });
      const result = await page.evaluate(async (id) => {
        try {
          await callRecordAction('uniformTransfers', id, 'approve', {});
          return { errorMsg: null };
        } catch (err) {
          return { errorMsg: err.message };
        }
      }, transferId);
      assertIncludes(result.errorMsg, 'Bạn không có quyền duyệt', 'Giám Đốc Siêu Thị đích không được tự duyệt điều chuyển hàng vào kho mình');
    });

    // ===== 10) Quản lý Hành Chính duyệt điều chuyển kho (ĐÚNG người duyệt thật, bấm THẬT) =====
    await run.run('7) Quản lý Hành Chính duyệt điều chuyển kho (bấm nút "Duyệt" thật)', async () => {
      await loginAs(page, HC);
      await page.evaluate(() => { switchTab('uniform'); setUniformSubTab('STORE'); });
      const before = await page.evaluate(() => ({
        a: computeUniformStockClient('Siêu Thị A').get('Áo đồng phục nam|||L').stock,
        b: computeUniformStockClient('Siêu Thị B').get('Áo đồng phục nam|||L')?.stock || 0
      }));
      await page.click(`button[data-op="approveUniformTransferAction"][data-arg0="${transferId}"]`);
      await page.evaluate(() => window.__confirmPending());
      await page.waitForTimeout(150);
      const status = await page.evaluate((id) => DB.uniformTransfers.find(x => x.id === id).status, transferId);
      assertEqual(status, 'APPROVED', 'Điều chuyển phải chuyển APPROVED sau khi HC bấm Duyệt (chưa RECEIVED)');

      // ===== 8) Mô hình "hàng đang vận chuyển" (theo yêu cầu người dùng bổ sung sau đó): kho Siêu Thị A
      // (nguồn) giảm NGAY khi HC duyệt, nhưng kho Siêu Thị B (đích) CHƯA tăng — chỉ tăng khi Giám Đốc
      // Siêu Thị B tự bấm "Xác nhận đã nhận" (kiểm tra ở bước 9 bên dưới). =====
      const after = await page.evaluate(() => ({
        a: computeUniformStockClient('Siêu Thị A').get('Áo đồng phục nam|||L').stock,
        b: computeUniformStockClient('Siêu Thị B').get('Áo đồng phục nam|||L')?.stock || 0
      }));
      assertEqual(after.a, before.a - 5, 'Tồn kho Siêu Thị A (nguồn) phải giảm đúng 5 ngay khi HC duyệt');
      assertEqual(after.b, before.b, 'Tồn kho Siêu Thị B (đích) CHƯA tăng ngay khi HC duyệt — chỉ tăng sau khi GĐ Siêu Thị B tự xác nhận đã nhận');
    });

    // ===== 9) Giám Đốc Siêu Thị B tự xác nhận ĐÃ NHẬN hàng điều chuyển (bấm nút thật) -> kho B mới thật sự tăng =====
    await run.run('8) Giám Đốc Siêu Thị B xác nhận ĐÃ NHẬN hàng điều chuyển -> nhập kho ST B (bấm THẬT)', async () => {
      await loginAs(page, GD_B);
      await page.evaluate(() => { switchTab('uniform'); setUniformSubTab('STORE'); });
      const before = await page.evaluate(() => computeUniformStockClient('Siêu Thị B').get('Áo đồng phục nam|||L')?.stock || 0);
      await page.click(`button[data-op="receiveUniformTransferAction"][data-arg0="${transferId}"]`);
      await page.evaluate(() => window.__confirmPending());
      await page.waitForTimeout(150);
      const result = await page.evaluate((id) => {
        const t = DB.uniformTransfers.find(x => x.id === id);
        return { status: t.status, stockB: computeUniformStockClient('Siêu Thị B').get('Áo đồng phục nam|||L').stock };
      }, transferId);
      assertEqual(result.status, 'RECEIVED', 'Điều chuyển phải chuyển RECEIVED sau khi GĐ ST B xác nhận đã nhận');
      assertEqual(result.stockB, before + 5, 'Tồn kho Siêu Thị B (đích) phải tăng đúng 5 SAU KHI GĐ ST B tự xác nhận đã nhận');
    });

    // ===== 11) Bảo mật GET /api/data: mỗi vai trò chỉ thấy đúng phạm vi Đồng Phục của mình =====
    await run.run('Bảo mật: HC (uniformManage) thấy TOÀN BỘ kỳ cấp phát/cấp phát/điều chuyển qua GET /api/data', async () => {
      await loginAs(page, HC); // currentUser đang là GD_B (đích) từ bước xác nhận nhận hàng trước đó
      const result = await page.evaluate(async (id) => {
        const res = await fetch('/api/data');
        const data = await res.json();
        return {
          seesPeriod: (data.uniformPeriods || []).some(p => p.id === id.periodId),
          seesTransfer: (data.uniformTransfers || []).some(t => t.id === id.transferId)
        };
      }, { periodId, transferId });
      assert(result.seesPeriod && result.seesTransfer, 'HC (uniformManage) phải thấy đầy đủ dữ liệu Đồng Phục mọi siêu thị');
    });

    await run.run('Bảo mật: Giám Đốc Siêu Thị B thấy điều chuyển liên quan tới mình (đích), nhưng KHÔNG thấy cấp phát nội bộ của Siêu Thị A', async () => {
      await loginAs(page, GD_B);
      const result = await page.evaluate(async (id) => {
        const res = await fetch('/api/data');
        const data = await res.json();
        return {
          seesTransfer: (data.uniformTransfers || []).some(t => t.id === id.transferId),
          seesIssuance: (data.uniformIssuances || []).some(iss => iss.employeeUsername === 'nv_a_rp')
        };
      }, { transferId });
      assert(result.seesTransfer, 'Giám Đốc Siêu Thị B phải thấy được điều chuyển có liên quan tới siêu thị mình (dù không duyệt được)');
      assert(!result.seesIssuance, 'Giám Đốc Siêu Thị B KHÔNG được thấy bản ghi cấp phát nội bộ của Siêu Thị A (khác siêu thị)');
    });

    await run.run('Bảo mật: Người ngoài cuộc (không quyền, khác phòng ban/siêu thị) KHÔNG thấy bất kỳ dữ liệu Đồng Phục nào', async () => {
      await loginAs(page, OUTSIDER);
      const result = await page.evaluate(async () => {
        const res = await fetch('/api/data');
        const data = await res.json();
        return {
          periods: (data.uniformPeriods || []).length,
          issuances: (data.uniformIssuances || []).length,
          transfers: (data.uniformTransfers || []).length
        };
      });
      assertEqual(result.periods, 0, 'Người ngoài cuộc không được thấy bất kỳ kỳ cấp phát nào');
      assertEqual(result.issuances, 0, 'Người ngoài cuộc không được thấy bất kỳ bản ghi cấp phát nào');
      assertEqual(result.transfers, 0, 'Người ngoài cuộc không được thấy bất kỳ điều chuyển kho nào');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-uniform-scenario-roleplay.js:', err);
  process.exitCode = 1;
});
