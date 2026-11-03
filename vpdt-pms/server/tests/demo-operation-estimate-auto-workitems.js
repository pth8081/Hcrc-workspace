// server/tests/demo-operation-estimate-auto-workitems.js
//
// DEMO thật (không phải bộ hồi quy tự động) — chụp ảnh tính năng MỚI theo yêu cầu người dùng (11/2026):
//   1) Lập Danh Mục Đầu Tư (hạng mục lớn + hạng mục con) với Người Phụ Trách, bấm Lưu.
//   2) Mở Thực Hiện của ĐÚNG hồ sơ đó — xác nhận Công Việc Gốc + Công Việc Con được TỰ ĐỘNG tạo, kế thừa
//      đúng Người Phụ Trách, Nghiệm Thu mặc định = chính người đó.
//   3) Đăng nhập là người phụ trách (KHÔNG phải toàn quyền hồ sơ) — tự "🔁 Giao Lại" công việc cho 1 nhân
//      viên khác thực hiện.
//   4) Xác nhận: Người Thực Hiện đã đổi, nhưng Nghiệm Thu (tab "Nghiệm thu") KHÔNG đổi — vẫn giữ nguyên
//      người phụ trách gốc, đúng yêu cầu.
// Dùng testHarness.js (Chromium thật mở public/index.html thật, backend mock mirror ĐÚNG
// lib/recordActions.js — xem buildAutoWorkItemsFromEstimate()/reassignOperationWorkItem()).
//
// Chạy: node server/tests/demo-operation-estimate-auto-workitems.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8994;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'operation-estimate-auto-workitems');

const MANAGER = { username: 'qlvh_demo', name: 'Trưởng Phòng Vận Hành', dept: 'Vận Hành', perms: { operationRecordManageAll: true }, active: true };
const OWNER = { username: 'nv_phutrach', name: 'Nguyễn Văn Phụ Trách', dept: 'Vận Hành', perms: {}, active: true };
const STAFF = { username: 'nv_thuchien', name: 'Trần Thị Thực Hiện', dept: 'Vận Hành', perms: {}, active: true };

const RECORD = {
  id: 8001, code: 'MMST-8001', storeName: 'Siêu Thị Demo Long Biên', dept: 'Vận Hành', creator: 'qlvh_demo',
  estimateStatus: 'DRAFT', estimateItems: []
};

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}
async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
  await page.waitForTimeout(150);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({
    depts: ['Vận Hành'], users: [MANAGER, OWNER, STAFF],
    operationStoreOpenings: [RECORD]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 900 });

  try {
    // ===== 1) Đăng nhập Trưởng Phòng (toàn quyền hồ sơ) — lập Danh Mục Đầu Tư =====
    await loginAs(page, MANAGER);
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('OPEN'); });
    await page.waitForTimeout(150);
    await page.evaluate(() => { openOperationEstimateModal('operationStoreOpenings', 8001); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      // openOperationEstimateModal() TỰ thêm sẵn 1 dòng danh mục lớn rỗng ở idx 0 khi hồ sơ chưa có hạng
      // mục nào (xem dòng "if (editable && estimateIsFullManager && operationEstimateItems.length === 0)"
      // trong hàm đó) — KHÔNG tự gọi addOperationEstimateItemRow() thêm nữa kẻo tạo dư 1 dòng rỗng.
      addOperationEstimateChildRow(0); // idx 1 — danh mục con
      updateOperationEstimateItemField(0, 'content', 'Setup khu trưng bày tầng 1');
      updateOperationEstimateItemField(1, 'content', 'Lắp đặt kệ trưng bày');
      updateOperationEstimateItemField(1, 'amount', 25000000);
      // updateOperationEstimateItemField() CHỦ ĐÍCH không vẽ lại bảng (giữ con trỏ khi gõ tay thật) —
      // demo gọi hàm trực tiếp (không gõ qua input DOM thật) nên cần tự vẽ lại 1 lần để ảnh chụp phản ánh
      // đúng dữ liệu vừa gán, TRƯỚC khi gán Người Phụ Trách (vẽ lại bảng sẽ dựng lại picker rỗng).
      renderOperationEstimateItemsTable(true);
      // Gán Người Phụ Trách cho danh mục LỚN — sau cùng (render lại toàn bảng ở trên sẽ xoá mất lựa chọn
      // nếu gán trước).
      pmsAdd('estimateAssigneePicker_0', 'nv_phutrach');
    });
    await page.waitForTimeout(150);
    await shot(page, '#operationEstimateModal', '01-danh-muc-dau-tu-truoc-khi-luu.png');

    // Bấm Lưu Danh Mục Đầu Tư — gọi route estimate/submit thật, kích hoạt auto-creation.
    await page.evaluate(() => { submitOperationEstimateForApproval(); });
    await page.waitForTimeout(300);
    await page.evaluate(() => closeOperationEstimateModal());

    // ===== 2) Mở Thực Hiện — xác nhận Công Việc Gốc + Con đã TỰ ĐỘNG được tạo =====
    await page.evaluate(() => { openOperationWorkItemModal('operationStoreOpenings', 8001, 'EXECUTION'); });
    await page.waitForTimeout(200);
    await shot(page, '#operationWorkItemModal', '02-thuc-hien-tu-dong-tao-cong-viec.png');

    // ===== 3) Đăng nhập là CHÍNH người phụ trách (KHÔNG toàn quyền) — tự "Giao Lại" cho nhân viên khác =====
    await loginAs(page, OWNER);
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('OPEN'); });
    await page.waitForTimeout(150);
    await page.evaluate(() => { openOperationWorkItemModal('operationStoreOpenings', 8001, 'EXECUTION'); });
    await page.waitForTimeout(200);
    const rootId = await page.evaluate(() => (DB.operationWorkItems || []).find(w => w.parentWorkItemId == null && w.sourceId === 8001)?.id);
    await page.evaluate((id) => { openOperationWorkItemReassignModal(id); }, rootId);
    await page.waitForTimeout(150);
    await shot(page, '#operationWorkItemReassignModal', '03-mo-modal-giao-lai.png');
    // Ô chọn mặc định giữ sẵn người đang gán (nv_phutrach) — ở đây minh hoạ "giao hẳn" cho 1 nhân viên
    // khác (gỡ người cũ + thêm người mới); người dùng thật có thể giữ cả 2 nếu muốn (ô hỗ trợ nhiều người).
    await page.evaluate(() => {
      pmsRemove('owiReassignAssignedToPicker', 'nv_phutrach');
      pmsAdd('owiReassignAssignedToPicker', 'nv_thuchien');
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => { submitOperationWorkItemReassign(); });
    await page.waitForTimeout(250);
    await shot(page, '#operationWorkItemModal', '04-sau-khi-giao-lai-cho-nhan-vien.png');

    // ===== 4) Tab Nghiệm thu — xác nhận Người Nghiệm Thu KHÔNG đổi (vẫn là người phụ trách gốc) =====
    await page.evaluate(() => { closeOperationWorkItemModal(); openOperationWorkItemModal('operationStoreOpenings', 8001, 'ACCEPTANCE'); });
    await page.waitForTimeout(200);
    await shot(page, '#operationWorkItemModal', '05-nghiem-thu-giu-nguyen-nguoi-phu-trach.png');
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n✅ Demo hoàn tất — ảnh chụp ở:', OUT_DIR);
})().catch(err => { console.error(err); process.exit(1); });
