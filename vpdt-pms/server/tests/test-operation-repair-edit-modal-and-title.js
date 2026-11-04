// server/tests/test-operation-repair-edit-modal-and-title.js
//
// Regression test Playwright THẬT (bấm nút thật qua DOM, KHÔNG gọi hàm JS trực tiếp — cùng khuôn
// test-operation-vhst-uibugfix.js) cho 2 lỗi người dùng báo (11/2026, kèm ảnh chụp):
//
//   1) "Ảnh 1 tô ấn nút lưu và hủy ko khả dụng ỏ phần sửa chữa" — modal "✏️ Sửa Đề Xuất Sửa Chữa"
//      (#editOperationRepairModal, module-vanhanh.js) là 1 <div> độc lập cấp cao, CHƯA TỪNG được đăng ký
//      ở forEach(bindOperationDelegation) — nút mở modal vẫn chạy (nằm trong #operationProcessModal đã
//      bind), nhưng "💾 Lưu Thay Đổi"/"✕ Hủy Bỏ" BÊN TRONG modal hoàn toàn không phản hồi khi bấm thật.
//      Cùng lớp lỗi đã vá ở VHST-5 ("🔗 Liên kết") và "🔁 Giao Lại" (xem test-operation-vhst-uibugfix.js).
//
//   2) "tiêu đề đặt cho hồ sơ phải được tạo ngay danh mục đầu tư như không lấy được tiêu đề lớn" — cột
//      "Siêu Thị / Nội Dung" ở Danh Mục Đầu Tư/Thực Hiện/Nghiệm Thu (và tiêu đề các modal liên quan) với
//      hồ sơ Sửa Chữa (operationRepairs) chỉ hiện "Nội Dung Sửa Chữa" (o.title), thiếu hẳn tên Siêu Thị
//      (o.storeName) — trong khi màn "📋 Danh Sách Đề Xuất Sửa Chữa Siêu Thị" gốc LUÔN hiện cả 2. Root
//      cause: OPERATION_KIND_META.operationRepairs.titleField chỉ trả o.title.
//
// Chạy: node server/tests/test-operation-repair-edit-modal-and-title.js
'use strict';
const path = require('path');
const os = require('os');
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual
} = require('./testHarness');

const PORT = 8995;
const SHOTS_DIR = path.join(os.tmpdir(), 'operation-repair-edit-shots');
try { require('fs').mkdirSync(SHOTS_DIR, { recursive: true }); } catch (_) { /* ignore */ }

const MANAGER = {
  username: 'vh_mgr_repairedit', name: 'Quản Lý Vận Hành (Test)', dept: 'Vận Hành',
  perms: { operationRepairCreate: true, operationRecordManageAll: true }, active: true
};
const state = createMockState({ depts: ['Vận Hành'], users: [MANAGER] });

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  let repairId = null;

  try {
    await run.run('Setup: login + tạo đề xuất Sửa Chữa (storeName + title tách biệt)', async () => {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, MANAGER);
      repairId = await page.evaluate(async () => {
        const res = await callCreateAction('operationRepairs', {
          storeName: 'Hải Dương', title: 'SC 2026', approvedBudget: '3202633716',
          supplier: '', personInCharge: '', description: ''
        });
        return res.item.id;
      });
      assert(repairId, 'Phải tạo được đề xuất Sửa Chữa');
    });

    // ===================== 1) Lỗi hiển thị "Siêu Thị / Nội Dung" thiếu tên Siêu Thị =====================
    await run.run('LỖI ĐÃ VÁ: cột "Siêu Thị / Nội Dung" ở Danh Mục Đầu Tư PHẢI hiện CẢ tên Siêu Thị LẪN Nội Dung (trước fix: chỉ hiện Nội Dung)', async () => {
      await page.evaluate(() => { setVanHanhSubTab('ESTIMATE'); renderOperationEstimateList(); });
      await page.waitForTimeout(80);
      const cellText = await page.evaluate((id) => {
        const btn = document.querySelector(`#operationEstimateTableBody button[data-id="${id}"]`);
        return btn ? btn.closest('tr').children[2].textContent : null;
      }, repairId);
      assert(cellText, 'Phải tìm thấy dòng hồ sơ vừa tạo trong bảng Danh Mục Đầu Tư');
      assert(cellText.includes('Hải Dương'), `Cột "Siêu Thị / Nội Dung" phải chứa tên Siêu Thị "Hải Dương" (trước fix sẽ KHÔNG có) — thực tế: "${cellText}"`);
      assert(cellText.includes('SC 2026'), `Cột "Siêu Thị / Nội Dung" vẫn phải giữ Nội Dung "SC 2026" — thực tế: "${cellText}"`);
      await page.screenshot({ path: path.join(SHOTS_DIR, '1-estimate-list-title.png'), fullPage: true });
    });

    await run.run('LỖI ĐÃ VÁ: tiêu đề modal "📁 Danh Mục Đầu Tư" PHẢI hiện cả Siêu Thị lẫn Nội Dung', async () => {
      await page.evaluate((id) => { openOperationEstimateModal('operationRepairs', id); }, repairId);
      await page.waitForTimeout(80);
      const titleText = await page.evaluate(() => document.getElementById('operationEstimateModalTitle').innerText);
      assert(titleText.includes('Hải Dương') && titleText.includes('SC 2026'), `Tiêu đề modal phải có cả "Hải Dương" và "SC 2026" — thực tế: "${titleText}"`);
      await page.evaluate(() => { closeOperationEstimateModal(); });
    });

    // ===================== 2) Modal "✏️ Sửa Đề Xuất Sửa Chữa" — nút Lưu/Hủy dùng được thật =====================
    await run.run('Mở modal "✏️ Sửa Đề Xuất Sửa Chữa" (bấm nút THẬT từ #operationProcessModal) -> modal phải mở + đọc đúng dữ liệu hiện có', async () => {
      await page.evaluate((id) => { openOperationProcessModal('operationRepairs', id); }, repairId);
      await page.waitForTimeout(80);
      await page.click('#operationProcessModal button[data-op="openEditOperationRepairModal"]');
      await page.waitForTimeout(80);
      const opened = await page.evaluate(() => !document.getElementById('editOperationRepairModal').classList.contains('hidden'));
      assert(opened, 'Modal "Sửa Đề Xuất Sửa Chữa" phải mở ra khi bấm nút "✏️ Sửa Đề Xuất"');
      const currentTitle = await page.evaluate(() => document.getElementById('editVrTitle').value);
      assertEqual(currentTitle, 'SC 2026', 'Ô "Nội Dung Sửa Chữa" phải điền sẵn đúng giá trị hiện có');
      await page.screenshot({ path: path.join(SHOTS_DIR, '2-edit-modal-open.png') });
    });

    await run.run('LỖI ĐÃ VÁ (DOM thật, bấm THẬT): sửa Nội Dung + bấm "💾 Lưu Thay Đổi" -> PHẢI lưu đúng + modal PHẢI tự đóng (trước fix: cả 2 đều KHÔNG xảy ra, nút "chết")', async () => {
      await page.fill('#editVrTitle', 'SC 2026 - Đã sửa');
      await page.click('button[data-op="submitEditOperationRepair"]');
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(SHOTS_DIR, '3-after-save.png'), fullPage: true });

      const check = await page.evaluate((id) => {
        const item = (DB.operationRepairs || []).find(x => x.id === id);
        return {
          title: item ? item.title : null,
          modalHidden: document.getElementById('editOperationRepairModal').classList.contains('hidden')
        };
      }, repairId);
      assertEqual(check.title, 'SC 2026 - Đã sửa', 'Nội Dung Sửa Chữa phải được lưu đúng sau khi bấm "💾 Lưu Thay Đổi" THẬT (nếu giữ nguyên: nút vẫn "chết", bug CSP-delegation TÁI PHÁT)');
      assert(check.modalHidden, 'Modal phải tự đóng sau khi lưu thành công (nếu vẫn mở: nút "💾 Lưu Thay Đổi" vẫn "chết")');
    });

    await run.run('LỖI ĐÃ VÁ (DOM thật, bấm THẬT): mở lại modal, bấm "✕ Hủy Bỏ" -> modal PHẢI tự đóng, KHÔNG lưu gì (trước fix: nút "chết", modal đứng yên)', async () => {
      await page.evaluate((id) => { openEditOperationRepairModal(id); }, repairId);
      await page.waitForTimeout(80);
      await page.fill('#editVrTitle', 'Nội dung KHÔNG được lưu');
      await page.click('#editOperationRepairModal button[data-op="closeEditOperationRepairModal"]');
      await page.waitForTimeout(100);
      const check = await page.evaluate((id) => {
        const item = (DB.operationRepairs || []).find(x => x.id === id);
        return {
          title: item ? item.title : null,
          modalHidden: document.getElementById('editOperationRepairModal').classList.contains('hidden')
        };
      }, repairId);
      assert(check.modalHidden, 'Modal phải tự đóng khi bấm "✕ Hủy Bỏ" THẬT (nếu vẫn mở: nút vẫn "chết")');
      assertEqual(check.title, 'SC 2026 - Đã sửa', 'Hủy Bỏ KHÔNG được lưu giá trị vừa gõ (phải giữ nguyên giá trị đã lưu ở bước trước)');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
  console.log(`(Ảnh chụp màn hình lưu tại: ${SHOTS_DIR})`);
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
