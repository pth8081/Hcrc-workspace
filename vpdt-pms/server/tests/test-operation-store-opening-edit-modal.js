// server/tests/test-operation-store-opening-edit-modal.js
//
// Regression test Playwright THẬT (bấm nút thật qua DOM, KHÔNG gọi hàm JS trực tiếp — cùng khuôn
// test-operation-repair-edit-modal-and-title.js) cho yêu cầu QA mới (11/2026, kèm ảnh chụp "Đề xuất mở
// mới siêu thị: N02 Beriver... Bạn chỉ có quyền xem thông tin hồ sơ này"): thêm nút "✏️ Sửa Đề Xuất"/
// "🚫 Hủy Đề Xuất" cho "Mở Mới" (operationStoreOpenings), đối xứng với "Sửa Chữa" đã có.
//
// Chạy: node server/tests/test-operation-store-opening-edit-modal.js
'use strict';
const path = require('path');
const os = require('os');
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual
} = require('./testHarness');

const PORT = 8996;
const SHOTS_DIR = path.join(os.tmpdir(), 'operation-store-opening-edit-shots');
try { require('fs').mkdirSync(SHOTS_DIR, { recursive: true }); } catch (_) { /* ignore */ }

const MANAGER = {
  username: 'vh_mgr_vsoedit', name: 'Quản Lý Vận Hành (Test)', dept: 'Vận Hành',
  perms: { operationStoreOpenCreate: true, operationRecordManageAll: true }, active: true
};
const state = createMockState({ depts: ['Vận Hành'], users: [MANAGER] });

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  let vsoId = null;

  try {
    await run.run('Setup: login + tạo đề xuất Mở Mới', async () => {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, MANAGER);
      vsoId = await page.evaluate(async () => {
        const res = await callCreateAction('operationStoreOpenings', {
          storeName: 'N02 Beriver', address: '390 Nguyễn Văn Cừ', area: 500,
          approvedBudget: '5000000000', expectedOpenDate: '2027-01-01', personInCharge: '', note: ''
        });
        return res.item.id;
      });
      assert(vsoId, 'Phải tạo được đề xuất Mở Mới');
    });

    await run.run('Modal chi tiết PHẢI hiện nút "✏️ Sửa Đề Xuất"/"🚫 Hủy Đề Xuất" (trước fix: chỉ có "Bạn chỉ có quyền xem thông tin hồ sơ này")', async () => {
      await page.evaluate((id) => { openOperationProcessModal('operationStoreOpenings', id); }, vsoId);
      await page.waitForTimeout(80);
      const hasButtons = await page.evaluate(() => ({
        edit: !!document.querySelector('#operationProcessModal button[data-op="openEditOperationStoreOpeningModal"]'),
        cancel: !!document.querySelector('#operationProcessModal button[data-op="cancelOperationStoreOpeningClient"]')
      }));
      assert(hasButtons.edit, 'Phải có nút "✏️ Sửa Đề Xuất" cho operationStoreOpenings');
      assert(hasButtons.cancel, 'Phải có nút "🚫 Hủy Đề Xuất" cho operationStoreOpenings');
      await page.screenshot({ path: path.join(SHOTS_DIR, '1-process-modal-buttons.png'), fullPage: true });
    });

    await run.run('Bấm THẬT "✏️ Sửa Đề Xuất" -> modal mở + điền sẵn đúng dữ liệu hiện có', async () => {
      await page.click('#operationProcessModal button[data-op="openEditOperationStoreOpeningModal"]');
      await page.waitForTimeout(80);
      const opened = await page.evaluate(() => !document.getElementById('editOperationStoreOpeningModal').classList.contains('hidden'));
      assert(opened, 'Modal "Sửa Đề Xuất Mở Mới" phải mở ra khi bấm nút "✏️ Sửa Đề Xuất"');
      const vals = await page.evaluate(() => ({
        storeName: document.getElementById('editVsoStoreName').value,
        address: document.getElementById('editVsoAddress').value
      }));
      assertEqual(vals.storeName, 'N02 Beriver', 'Ô "Tên Siêu Thị Dự Kiến" phải điền sẵn đúng giá trị hiện có');
      assertEqual(vals.address, '390 Nguyễn Văn Cừ', 'Ô "Địa Điểm Dự Kiến" phải điền sẵn đúng giá trị hiện có');
      await page.screenshot({ path: path.join(SHOTS_DIR, '2-edit-modal-open.png') });
    });

    await run.run('Bấm THẬT "💾 Lưu Thay Đổi" sau khi sửa Tên Siêu Thị -> lưu đúng + modal tự đóng', async () => {
      await page.fill('#editVsoStoreName', 'N02 Beriver (đã sửa)');
      await page.click('button[data-op="submitEditOperationStoreOpening"]');
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(SHOTS_DIR, '3-after-save.png'), fullPage: true });
      const check = await page.evaluate((id) => {
        const item = (DB.operationStoreOpenings || []).find(x => x.id === id);
        return {
          storeName: item ? item.storeName : null,
          modalHidden: document.getElementById('editOperationStoreOpeningModal').classList.contains('hidden')
        };
      }, vsoId);
      assertEqual(check.storeName, 'N02 Beriver (đã sửa)', 'Tên Siêu Thị phải được lưu đúng sau khi bấm "💾 Lưu Thay Đổi" THẬT');
      assert(check.modalHidden, 'Modal phải tự đóng sau khi lưu thành công');
    });

    await run.run('Có công việc triển khai -> field định danh/ngân sách bị KHOÁ, chỉ Người Phụ Trách/Ghi Chú sửa được', async () => {
      // Phải đẩy work item vào CẢ 2 nơi: state.operationWorkItems (phía Node, mock server dùng để tính
      // hasWorkItems thật khi xử lý POST update) VÀ DB.operationWorkItems (phía trang, client dùng để
      // khoá field trên UI) — đẩy thiếu 1 trong 2 khiến client/server lệch nhận định hasWorkItems.
      const workItem = { id: 9001, sourceType: 'OPERATION_STORE_OPENING', sourceId: vsoId, status: 'CHUA_BAT_DAU', title: 'CV test khoá field' };
      state.operationWorkItems.push(workItem);
      await page.evaluate((wi) => {
        DB.operationWorkItems = DB.operationWorkItems || [];
        DB.operationWorkItems.push(wi);
      }, workItem);
      await page.evaluate((id) => { openEditOperationStoreOpeningModal(id); }, vsoId);
      await page.waitForTimeout(80);
      const locked = await page.evaluate(() => ({
        storeName: document.getElementById('editVsoStoreName').disabled,
        area: document.getElementById('editVsoArea').disabled,
        budget: document.getElementById('editVsoApprovedBudget').disabled,
        openDate: document.getElementById('editVsoOpenDate').disabled,
        noteNoticeShown: !document.getElementById('editVsoLockedNote').classList.contains('hidden')
      }));
      assert(locked.storeName && locked.area && locked.budget && locked.openDate, 'Tên Siêu Thị/Diện Tích/Ngân Sách/Ngày Dự Kiến Khai Trương phải bị khoá khi đã có công việc triển khai');
      assert(locked.noteNoticeShown, 'Phải hiện cảnh báo "đã có công việc triển khai" khi mở modal');
      await page.fill('#editVsoNote', 'Ghi chú cập nhật dù đã có công việc');
      await page.click('button[data-op="submitEditOperationStoreOpening"]');
      await page.waitForTimeout(200);
      const check = await page.evaluate((id) => (DB.operationStoreOpenings || []).find(x => x.id === id), vsoId);
      assertEqual(check.note, 'Ghi chú cập nhật dù đã có công việc', 'Ghi Chú vẫn phải sửa được dù đã có công việc triển khai');
      assertEqual(check.storeName, 'N02 Beriver (đã sửa)', 'Tên Siêu Thị phải GIỮ NGUYÊN (không bị đổi) khi field đang khoá');
      await page.screenshot({ path: path.join(SHOTS_DIR, '4-locked-fields.png'), fullPage: true });
    });

    await run.run('Bấm THẬT "🚫 Hủy Đề Xuất" -> modal xác nhận hiện ra, bấm "Đồng Ý" -> status chuyển CANCELLED', async () => {
      await page.evaluate((id) => { openOperationProcessModal('operationStoreOpenings', id); }, vsoId);
      await page.waitForTimeout(80);
      await page.click('#operationProcessModal button[data-op="cancelOperationStoreOpeningClient"]');
      await page.waitForTimeout(80);
      const confirmShown = await page.evaluate(() => !document.getElementById('genericConfirmModal').classList.contains('hidden'));
      assert(confirmShown, 'Phải hiện modal xác nhận "Đồng Ý/Hủy" trước khi hủy thật (không hủy ngay khi vừa bấm)');
      await page.evaluate(() => { runConfirmedAction(); });
      await page.waitForTimeout(200);
      const item = await page.evaluate((id) => (DB.operationStoreOpenings || []).find(x => x.id === id), vsoId);
      assertEqual(item.status, 'CANCELLED', 'Trạng thái phải chuyển "Đã hủy" sau khi xác nhận "Đồng Ý"');
      await page.screenshot({ path: path.join(SHOTS_DIR, '5-cancelled.png'), fullPage: true });
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
  console.log(`(Ảnh chụp màn hình lưu tại: ${SHOTS_DIR})`);
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
