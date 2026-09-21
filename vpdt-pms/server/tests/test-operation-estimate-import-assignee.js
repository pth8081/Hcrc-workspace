// server/tests/test-operation-estimate-import-assignee.js
//
// Mục 4 kế hoạch 10/2026: cặp Tải Mẫu/Nhập THẬT của "Danh Mục Đầu Tư" (Vận Hành > Siêu Thị) trước đây
// thiếu trắng cột "Người Phụ Trách" — đã vá phần ĐỌC file ở lib/operationImport.js (xem
// tests/test-operation-danhmuc-dautu-units.js, 4 kịch bản mới). File này kiểm phần CÒN LẠI, riêng phía
// CLIENT (module-vanhanh.js confirmOperationEstimateImport()) — bước quan trọng nhất: username đọc từ
// Excel phải map đúng vào field `assignedToUsernames` (KHÔNG phải `assignedTo`) vì renderPeopleMultiSelect()
// (picker chọn người phụ trách trên mỗi dòng, xem openOperationEstimateModal()) đọc đúng field này để
// pre-check — nếu gán sai tên field, người phụ trách import về sẽ "biến mất" ngay khi mở lại modal dù
// dữ liệu tưởng đã gộp xong.
//
// Bỏ qua bước tải file thật qua route (đã có Playwright/unit test riêng cho phần đọc file) — seed thẳng
// operationEstimateImportPreviewItems (biến top-level cùng scope, module-vanhanh.js đã nạp sẵn từ đầu,
// không phải cụm nạp lười) rồi gọi thẳng confirmOperationEstimateImport(), đúng những gì hàm đó thực sự
// nhận được sau khi đọc file xong.
//
// Chạy: node server/tests/test-operation-estimate-import-assignee.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8993;
const CREATOR = {
  username: 'vh_creator_import', name: 'Người Tạo Hồ Sơ', dept: 'Vận Hành',
  perms: { operationStoreOpenCreate: true, operationRecordManageAll: true }, active: true
};
const NV_A = { username: 'nv_a', name: 'Nguyễn Văn A', dept: 'Vận Hành', perms: {}, active: true };
const NV_B = { username: 'nv_b', name: 'Trần Thị B', dept: 'Vận Hành', perms: {}, active: true };
const NV_NGHI_VIEC = { username: 'nv_nghi_viec', name: 'Đã Nghỉ Việc', dept: 'Vận Hành', perms: {}, active: false };
const state = createMockState({ depts: ['Vận Hành'], users: [CREATOR, NV_A, NV_B, NV_NGHI_VIEC] });

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  let recordId = null;

  try {
    await run.run('Setup: login + tạo hồ sơ operationStoreOpenings + mở modal Danh Mục Đầu Tư', async () => {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, CREATOR);
      recordId = await page.evaluate(async () => {
        const res = await callCreateAction('operationStoreOpenings', {
          storeName: 'Siêu thị nhập Excel (test)', address: '123 Test', area: 200,
          approvedBudget: 5000000000, expectedOpenDate: '', personInCharge: '', note: ''
        });
        DB.operationStoreOpenings.push(res.item);
        return res.item.id;
      });
      await page.evaluate((id) => { openOperationEstimateModal('operationStoreOpenings', id); }, recordId);
      await page.waitForTimeout(100);
      assert(recordId, 'Phải tạo được hồ sơ');
    });

    await run.run('confirmOperationEstimateImport(): username hợp lệ (active) -> map đúng vào assignedToUsernames + assignedToNames', async () => {
      const result = await page.evaluate(() => {
        operationEstimateImportPreviewItems = [{
          _idx: 0, include: true, content: 'Kệ trưng bày', description: '', amount: 1000000, note: '',
          assignedTo: ['nv_a', 'nv_b'], duplicateInFile: false, duplicateExisting: false
        }];
        confirmOperationEstimateImport();
        const item = operationEstimateItems.find((it) => it.content === 'Kệ trưng bày');
        return {
          assignedToUsernames: item?.assignedToUsernames, assignedToNames: item?.assignedToNames,
          statusText: document.getElementById('operationEstimateImportStatus').innerText
        };
      });
      assertEqual(JSON.stringify(result.assignedToUsernames), JSON.stringify(['nv_a', 'nv_b']), 'Phải map đúng field assignedToUsernames (không phải assignedTo) để khớp renderPeopleMultiSelect()');
      assertEqual(JSON.stringify(result.assignedToNames), JSON.stringify(['Nguyễn Văn A', 'Trần Thị B']), 'assignedToNames phải resolve đúng tên hiển thị');
      assert(!/không tồn tại/.test(result.statusText), 'Cả 2 username đều hợp lệ -> không được có cảnh báo username lạ');
    });

    await run.run('confirmOperationEstimateImport(): username KHÔNG active (đã nghỉ việc) -> bị BỎ QUA, có cảnh báo, không chặn cả dòng', async () => {
      const result = await page.evaluate(() => {
        operationEstimateImportPreviewItems = [{
          _idx: 0, include: true, content: 'Sơn tường', description: '', amount: 500000, note: '',
          assignedTo: ['nv_a', 'nv_nghi_viec'], duplicateInFile: false, duplicateExisting: false
        }];
        confirmOperationEstimateImport();
        const item = operationEstimateItems.find((it) => it.content === 'Sơn tường');
        return {
          assignedToUsernames: item?.assignedToUsernames,
          statusText: document.getElementById('operationEstimateImportStatus').innerText
        };
      });
      assertEqual(JSON.stringify(result.assignedToUsernames), JSON.stringify(['nv_a']), 'Chỉ giữ lại username active, bỏ qua người đã nghỉ việc');
      assert(/nv_nghi_viec/.test(result.statusText) && /không tồn tại/.test(result.statusText), 'Phải cảnh báo rõ đúng username bị bỏ qua');
    });

    await run.run('confirmOperationEstimateImport(): username lạ hoàn toàn (không có trong DB.users) -> mảng rỗng, KHÔNG throw, dòng vẫn được gộp', async () => {
      const result = await page.evaluate(() => {
        operationEstimateImportPreviewItems = [{
          _idx: 0, include: true, content: 'Đèn LED', description: '', amount: 200000, note: '',
          assignedTo: ['username_khong_ton_tai'], duplicateInFile: false, duplicateExisting: false
        }];
        confirmOperationEstimateImport();
        const item = operationEstimateItems.find((it) => it.content === 'Đèn LED');
        return { found: !!item, assignedToUsernames: item?.assignedToUsernames };
      });
      assert(result.found, 'Dòng vẫn phải được gộp vào bảng dù Người Phụ Trách không hợp lệ');
      assertEqual(JSON.stringify(result.assignedToUsernames), JSON.stringify([]));
    });

    await run.run('Picker renderPeopleMultiSelect() đọc đúng assignedToUsernames vừa gộp -> checkbox "nv_a" đã pre-check ngay trong bảng (chưa cần Lưu Danh Mục Đầu Tư)', async () => {
      // KHÔNG gọi lại openOperationEstimateModal() ở đây: hàm đó nạp lại operationEstimateItems từ
      // o.estimateItems (dữ liệu ĐÃ LƯU trên hồ sơ) — trong khi phần vừa gộp qua confirmOperationEstimateImport()
      // mới chỉ nằm ở bộ nhớ tạm phía client (đợi bấm "💾 Lưu Danh Mục Đầu Tư"), mở lại modal lúc này đúng ra
      // PHẢI mất vì chưa lưu, không phải lỗi. Kiểm tra ngay trên bảng hiện tại — confirmOperationEstimateImport()
      // đã tự gọi renderOperationEstimateItemsTable(true) ở cuối nên picker đã có sẵn trong DOM.
      const checked = await page.evaluate(() => {
        // "Kệ trưng bày" luôn là dòng đầu (idx 0) vì gộp vào cuối bảng trước 2 dòng còn lại thêm sau.
        const idx = operationEstimateItems.findIndex((it) => it.content === 'Kệ trưng bày');
        return [...document.querySelectorAll(`#estimateAssigneePicker_${idx} input.estimate-assignee:checked`)].map((cb) => cb.value);
      });
      assertEqual(JSON.stringify(checked.sort()), JSON.stringify(['nv_a', 'nv_b']), 'Picker phải tự pre-check đúng 2 người vừa nhập từ Excel — xác nhận field name khớp đúng, không "biến mất" khỏi bảng');
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
