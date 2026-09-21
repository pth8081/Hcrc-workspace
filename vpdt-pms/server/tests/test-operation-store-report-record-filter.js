// server/tests/test-operation-store-report-record-filter.js
//
// Báo Cáo QLDA (Vận Hành, trước đây gọi "Siêu Thị") — bộ lọc mới "Hồ Sơ" (theo yêu cầu người dùng "Phần
// báo cáo của QLDA bạn bổ sung lọc theo hồ sơ"), khác hẳn "Từ Khóa" (chỉ tìm GẦN ĐÚNG theo mã/tên, có
// thể khớp nhiều hồ sơ) — chọn ĐÚNG 1 hồ sơ để xem riêng toàn bộ báo cáo (bảng rollup cấp hồ sơ LẪN khối
// "Tổng Quan Toàn Bộ Công Việc"). Kiểm populateOpReportFilterRecordOptions()/buildOperationStoreReportComputed()
// (public/js/module-vanhanh.js).
//
// Chạy: node server/tests/test-operation-store-report-record-filter.js
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8989;

const VIEWER = { username: 'rf_viewer', name: 'Người Xem Báo Cáo', dept: 'Vận Hành', perms: { operationRecordManageAll: true }, active: true };
const RECORD_OPEN = { id: 9101, code: 'MMST-9101', storeName: 'Siêu Thị Lọc A', dept: 'Vận Hành', creator: 'rf_viewer', estimateStatus: 'APPROVED' };
const RECORD_REPAIR = { id: 9102, code: 'SCST-9102', title: 'Sửa Chữa Lọc B', dept: 'Vận Hành', creator: 'rf_viewer', estimateStatus: 'APPROVED' };
const WORK_ITEMS = [
  { id: 8101, title: 'CV Hồ Sơ A', sourceType: 'OPERATION_STORE_OPENING', sourceId: 9101, parentWorkItemId: null, status: 'CHUA_BAT_DAU', deadline: '', startDate: '', assignedTo: [], assignedToName: [], acceptorUsername: null, acceptorName: null, history: [] },
  { id: 8102, title: 'CV Hồ Sơ B', sourceType: 'OPERATION_REPAIR', sourceId: 9102, parentWorkItemId: null, status: 'CHUA_BAT_DAU', deadline: '', startDate: '', assignedTo: [], assignedToName: [], acceptorUsername: null, acceptorName: null, history: [] }
];

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function main() {
  const state = createMockState({
    depts: ['Vận Hành'], users: [VIEWER],
    operationStoreOpenings: [RECORD_OPEN], operationRepairs: [RECORD_REPAIR], operationWorkItems: WORK_ITEMS
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  async function resetFilters() {
    await page.evaluate(() => {
      document.getElementById('opReportFilterKind').value = '';
      document.getElementById('opReportFilterRecord').value = '';
      document.getElementById('opReportFilterProgress').value = '';
      document.getElementById('opReportFilterKeyword').value = '';
    });
  }
  async function readMainTableCodes() {
    return page.evaluate(() => Array.from(document.querySelectorAll('#operationStoreReportTableBody tr'))
      .map(tr => tr.querySelector('td')?.innerText.trim()).filter(Boolean));
  }
  async function readOverviewCodes() {
    return page.evaluate(() => Array.from(document.querySelectorAll('#operationWorkItemOverviewTableBody tr'))
      .map(tr => tr.querySelector('td')?.innerText.trim()).filter(Boolean));
  }

  try {
    await loginAs(page, VIEWER);
    await resetFilters();

    await run.run('populateOpReportFilterRecordOptions(): dropdown "Hồ Sơ" liệt kê đủ 2 hồ sơ (Mở mới + Sửa chữa)', async () => {
      await page.evaluate(() => renderOperationStoreReport());
      const options = await page.evaluate(() => Array.from(document.getElementById('opReportFilterRecord').options).map(o => o.textContent));
      assert(options.some(t => t.includes('MMST-9101')), 'Phải có hồ sơ Mở mới MMST-9101');
      assert(options.some(t => t.includes('SCST-9102')), 'Phải có hồ sơ Sửa chữa SCST-9102');
    });

    await run.run('Chưa chọn Hồ Sơ: bảng chính + Tổng Quan hiện đủ CẢ 2 hồ sơ', async () => {
      await page.evaluate(() => renderOperationStoreReport());
      const mainCodes = await readMainTableCodes();
      const overviewCodes = await readOverviewCodes();
      assertEqual(mainCodes.length, 2, 'Bảng chính phải có 2 dòng (2 hồ sơ)');
      assert(overviewCodes.includes('MMST-9101') && overviewCodes.includes('SCST-9102'), 'Tổng Quan phải gộp công việc từ cả 2 hồ sơ');
    });

    await run.run('Chọn ĐÚNG 1 Hồ Sơ (MMST-9101): bảng chính + Tổng Quan CHỈ còn đúng hồ sơ đó', async () => {
      await page.evaluate(() => { document.getElementById('opReportFilterRecord').value = 'operationStoreOpenings::9101'; renderOperationStoreReport(); });
      const mainCodes = await readMainTableCodes();
      const overviewCodes = await readOverviewCodes();
      assertEqual(mainCodes.length, 1, 'Bảng chính chỉ còn đúng 1 hồ sơ được chọn');
      assertEqual(mainCodes[0], 'MMST-9101');
      assert(overviewCodes.every(c => c === 'MMST-9101'), 'Tổng Quan chỉ còn công việc của đúng hồ sơ được chọn');
      assert(!overviewCodes.includes('SCST-9102'), 'KHÔNG được lẫn công việc của hồ sơ khác');
    });

    await run.run('Đổi "Loại Hồ Sơ" sang Sửa chữa: dropdown "Hồ Sơ" tự thu hẹp, chỉ còn hồ sơ Sửa chữa', async () => {
      await page.evaluate(() => { document.getElementById('opReportFilterRecord').value = ''; document.getElementById('opReportFilterKind').value = 'operationRepairs'; renderOperationStoreReport(); });
      const options = await page.evaluate(() => Array.from(document.getElementById('opReportFilterRecord').options).map(o => o.textContent));
      assert(!options.some(t => t.includes('MMST-9101')), 'Đã đổi Loại Hồ Sơ sang Sửa chữa -> KHÔNG còn hồ sơ Mở mới trong danh sách chọn');
      assert(options.some(t => t.includes('SCST-9102')), 'Vẫn còn hồ sơ Sửa chữa');
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
