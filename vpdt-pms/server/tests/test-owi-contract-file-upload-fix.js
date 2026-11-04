// tests/test-owi-contract-file-upload-fix.js — người dùng báo lỗi (ảnh chụp thật, 11/2026): bấm "📤 Tải
// Tệp Lên" ở modal "💰 Giá Trị Hợp Đồng" (operationWorkItemContractModal) không tải được file lên.
//
// Nguyên nhân: <input type="file" ... data-op-change="onOwiContractFileChange"> THIẾU data-arg-el="0"
// (mọi input file khác dùng data-op-change + nhận tham số element đều có data-arg-el="0", xem
// onEditVrFileAttachmentChange làm mẫu) — cspCollectArgs() (core.js) không tìm thấy data-arg* nào nên
// gọi onOwiContractFileChange() với 0 tham số, "inputEl" bên trong luôn là undefined, "inputEl.files"
// ném TypeError NGAY DÒNG ĐẦU TIÊN — người dùng chọn file xong không thấy phản hồi gì (lỗi âm thầm,
// không alert). Playwright THẬT: setInputFiles() trên đúng input, click thật, kiểm tra chip + state.
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');
const path = require('path');
const fs = require('fs');

async function main() {
  const run = createRunner();
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8992;
  const USER = {
    username: 'vh1', name: 'Người Vận Hành', dept: 'Phòng Setup và XDCB',
    perms: { operationStoreOpenCreate: true, operationRecordManageAll: true }, active: true, totpEnabled: true
  };
  const WORK_ITEM_ID = 501;
  // Seed trực tiếp state.operationWorkItems (phía "server" mock, đọc bởi actionHandlers['operationWorkItems:contract']
  // — xem sourceRecordForWorkItem()/tests/testHarness.js) CÙNG LÚC với 1 operationStoreOpenings khớp
  // sourceId — tránh phải lái trọn vẹn luồng UI "Danh Mục Đầu Tư -> tự sinh Công Việc" (đã có test riêng,
  // tests/test-operation-workitem-contract-c2.js/demo-contract-value-redesign.js) chỉ để setup cho đúng 1
  // bài test tập trung vào lỗi upload tệp.
  const SOURCE_ID = 1;
  const state = createMockState({
    depts: ['Phòng Setup và XDCB'], users: [USER],
    operationStoreOpenings: [{ id: SOURCE_ID, dept: 'Phòng Setup và XDCB', storeName: 'Siêu thị test upload', creator: 'vh1', creatorName: 'Người Vận Hành', estimateItems: [] }],
    operationWorkItems: [{
      id: WORK_ITEM_ID, title: 'Cải tạo', sourceType: 'operationStoreOpenings', sourceId: SOURCE_ID, kind: 'EXECUTION',
      contractValue: null, contractAttachments: [], assignedTo: ['vh1'], assignedToName: ['Người Vận Hành'], parentWorkItemId: null
    }]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(String(err && err.stack || err)));

  const tmpFile = path.join(require('os').tmpdir(), 'owi-contract-test-file.pdf');
  fs.writeFileSync(tmpFile, '%PDF-1.4 fake content for test');

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.waitForTimeout(400); // ổn định các lượt tải dữ liệu nền sau đăng nhập trước khi thao tác

    const workItemId = WORK_ITEM_ID;
    await run.run('Setup: xác nhận Công Việc đã nạp vào DB.operationWorkItems qua GET /api/data (seed sẵn ở state mock)', async () => {
      const found = await page.evaluate((id) => (DB.operationWorkItems || []).find(w => w.id === id), workItemId);
      assert(found, 'DB.operationWorkItems phải có đúng work item đã seed qua createMockState()');
    });

    await run.run('Mở modal "💰 Giá trị hợp đồng" + chọn file THẬT qua input (setInputFiles) -> chip hiện ra, KHÔNG lỗi JS', async () => {
      await page.evaluate((id) => { openOperationWorkItemContractModal(id); }, workItemId);
      await page.waitForTimeout(100);
      const modalVisible = await page.evaluate(() => !document.getElementById('operationWorkItemContractModal').classList.contains('hidden'));
      assert(modalVisible, 'modal phải mở ra');

      const fileInputSelector = '#operationWorkItemContractModal input[type="file"]';
      await page.setInputFiles(fileInputSelector, tmpFile);
      await page.waitForTimeout(300); // chờ uploadFileToServer() (mock fetch) xử lý xong

      const chipHtml = await page.evaluate(() => document.getElementById('owiContractFileChip').innerHTML);
      assert(chipHtml.includes('owi-contract-test-file.pdf'), `Phải hiện chip tên file đã tải lên, thực tế: ${chipHtml}`);
    });

    await run.run('Lưu modal THẬT -> contractAttachments lưu đúng tệp vừa tải', async () => {
      await page.fill('#owiContractValue', '123000000');
      await page.click('[data-op="submitOperationWorkItemContract"]');
      await page.waitForTimeout(150);
      const saved = await page.evaluate((id) => (DB.operationWorkItems.find(w => w.id === id) || {}).contractAttachments, workItemId);
      assert(Array.isArray(saved) && saved.length === 1 && saved[0].fileName === 'owi-contract-test-file.pdf',
        `Phải lưu đúng 1 tệp đính kèm, thực tế: ${JSON.stringify(saved)}`);
    });

    await run.run('Không có lỗi JS (pageerror) nào phát sinh trong suốt quá trình tải tệp THẬT', async () => {
      assertEqual(jsErrors.length, 0, `Có lỗi JS: ${JSON.stringify(jsErrors)}`);
    });
  } finally {
    await browser.close();
    server.close();
    fs.unlinkSync(tmpFile);
  }

  run.summary();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
