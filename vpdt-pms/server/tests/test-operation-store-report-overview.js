// server/tests/test-operation-store-report-overview.js
//
// VHST-7 (7/7 — item cuối chuỗi cải tiến "Vận Hành > 🏬 Siêu Thị" đợt này): "Trong báo cáo phải có một
// báo cáo tổng quan về TẤT CẢ các công việc đang thực hiện, trạng thái liên quan, chậm, tiến độ, chạm
// nghiệm thu, nghiệm thu, hoàn thành và xuất được ra file excel để xem tổng thể".
//
// Test khối "📋 Tổng Quan Toàn Bộ Công Việc" mới ở tab Báo Cáo (public/js/module-vanhanh.js):
//   - buildOperationStoreReportComputed()          — danh sách hồ sơ đã lọc 3 filter cấp hồ sơ có sẵn.
//   - buildOperationStoreReportOverviewRows()       — làm PHẲNG thành 1 dòng/công việc, ÁP DỤNG thêm 2
//     filter cấp công việc MỚI (Trạng Thái Công Việc/Trạng Thái Hạn) — nguồn DUY NHẤT cho CẢ hiển thị
//     (renderOperationStoreReportOverview()) LẪN xuất Excel (exportOperationStoreReportOverview()).
//
// Kịch bản: 2 hồ sơ KHÁC NHAU (1 Mở mới + 1 Sửa chữa), mỗi hồ sơ có công việc ở CÁC trạng thái/trạng thái
// hạn khác nhau — xác nhận bảng tổng quan gộp ĐÚNG công việc từ NHIỀU hồ sơ (không chỉ 1), nhãn hiển thị
// đúng cho từng tổ hợp trạng thái công việc x trạng thái hạn, lọc theo từng filter thu hẹp ĐÚNG cả bảng
// trên màn hình LẪN file xuất, và Ngày Nghiệm Thu lấy đúng mốc history 'ACCEPTED' gần nhất.
//
// Chạy: node server/tests/test-operation-store-report-overview.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual, assertIncludes
} = require('./testHarness');

const PORT = 8988;

function isoDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const VIEWER = { username: 'ov_viewer', name: 'Người Xem Báo Cáo', dept: 'Vận Hành', perms: { operationRecordManageAll: true }, active: true };

const RECORD_OPEN = { id: 9001, code: 'MMST-9001', storeName: 'Siêu Thị Tổng Quan A', dept: 'Vận Hành', creator: 'ov_viewer', estimateStatus: 'APPROVED' };
const RECORD_REPAIR = { id: 9002, code: 'SCST-9002', title: 'Sửa Chữa Tổng Quan B', dept: 'Vận Hành', creator: 'ov_viewer', estimateStatus: 'APPROVED' };

// 5 công việc trải đủ tổ hợp trạng thái công việc x trạng thái hạn, trải trên CẢ 2 hồ sơ (đúng yêu cầu
// "TẤT CẢ các công việc đang thực hiện" — không chỉ 1 hồ sơ):
//   w1 (record OPEN):   CHUA_BAT_DAU   + hạn đã qua   -> QUA_HAN_CHUA_BAT_DAU  ("chậm")
//   w2 (record OPEN):   DANG_THUC_HIEN + hạn còn xa   -> DUNG_TIEN_DO         ("tiến độ")
//   w3 (record OPEN):   DANG_NGHIEM_THU + hạn đã qua  -> QUA_HAN_CHUA_XONG    ("chờ nghiệm thu" + chậm)
//   w4 (record REPAIR): DA_NGHIEM_THU  + hạn đã qua RẤT lâu -> HOAN_THANH (KHÔNG bị gắn cờ quá hạn)
//   w5 (record REPAIR): CHUA_BAT_DAU   + hạn còn xa   -> DUNG_TIEN_DO
const WORK_ITEMS = [
  {
    id: 8001, title: 'W1 - Chưa bắt đầu, đã quá hạn', sourceType: 'OPERATION_STORE_OPENING', sourceId: 9001,
    parentWorkItemId: null, status: 'CHUA_BAT_DAU', deadline: isoDateOffset(-5), startDate: '',
    assignedTo: ['ov_viewer'], assignedToName: ['Người Xem Báo Cáo'], acceptorUsername: null, acceptorName: null,
    history: []
  },
  {
    id: 8002, title: 'W2 - Đang thực hiện, đúng tiến độ', sourceType: 'OPERATION_STORE_OPENING', sourceId: 9001,
    parentWorkItemId: null, status: 'DANG_THUC_HIEN', deadline: isoDateOffset(10), startDate: isoDateOffset(-2),
    assignedTo: ['ov_viewer'], assignedToName: ['Người Xem Báo Cáo'], acceptorUsername: null, acceptorName: null,
    history: [{ action: 'STATUS_DANG_THUC_HIEN', by: 'ov_viewer', byName: 'Người Xem Báo Cáo', time: '01/09/2026, 08:00:00' }]
  },
  {
    id: 8003, title: 'W3 - Đang nghiệm thu, đã quá hạn', sourceType: 'OPERATION_STORE_OPENING', sourceId: 9001,
    parentWorkItemId: null, status: 'DANG_NGHIEM_THU', deadline: isoDateOffset(-3), startDate: isoDateOffset(-8),
    assignedTo: ['ov_viewer'], assignedToName: ['Người Xem Báo Cáo'], acceptorUsername: 'ov_viewer', acceptorName: 'Người Xem Báo Cáo',
    completedAt: '05/09/2026, 09:00:00', history: [{ action: 'STATUS_DANG_NGHIEM_THU', by: 'ov_viewer', byName: 'Người Xem Báo Cáo', time: '05/09/2026, 09:00:00' }]
  },
  {
    id: 8004, title: 'W4 - Đã nghiệm thu', sourceType: 'OPERATION_REPAIR', sourceId: 9002,
    parentWorkItemId: null, status: 'DA_NGHIEM_THU', deadline: isoDateOffset(-30), startDate: isoDateOffset(-40),
    assignedTo: ['ov_viewer'], assignedToName: ['Người Xem Báo Cáo'], acceptorUsername: 'ov_viewer', acceptorName: 'Người Xem Báo Cáo',
    acceptedBy: 'ov_viewer', acceptedByName: 'Người Xem Báo Cáo', acceptanceNote: 'Đạt yêu cầu',
    history: [
      { action: 'STATUS_DANG_NGHIEM_THU', by: 'ov_viewer', byName: 'Người Xem Báo Cáo', time: '10/08/2026, 09:00:00' },
      { action: 'ACCEPTED', by: 'ov_viewer', byName: 'Người Xem Báo Cáo', time: '12/08/2026, 14:30:00', note: 'Đạt yêu cầu' }
    ]
  },
  {
    id: 8005, title: 'W5 - Chưa bắt đầu, còn hạn', sourceType: 'OPERATION_REPAIR', sourceId: 9002,
    parentWorkItemId: null, status: 'CHUA_BAT_DAU', deadline: isoDateOffset(10), startDate: '',
    assignedTo: [], assignedToName: [], acceptorUsername: null, acceptorName: null, history: []
  }
];

async function loginAs(page, user) {
  await page.evaluate(async (u) => {
    window.__resetCapture();
    await proceedAfterAuth(u);
  }, user);
}

async function main() {
  const state = createMockState({
    depts: ['Vận Hành'],
    users: [VIEWER],
    operationStoreOpenings: [RECORD_OPEN],
    operationRepairs: [RECORD_REPAIR],
    operationWorkItems: WORK_ITEMS
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  // Helper: đọc lại "computed" bảng Tổng Quan hiện đang hiển thị (đã render) — trả về mảng {code, title,
  // statusLabel, deadlineStatusLabel, acceptedAt,...} đọc trực tiếp DOM (đúng những gì người dùng thấy).
  async function readOverviewTableRows() {
    return page.evaluate(() => {
      const tbody = document.getElementById('operationWorkItemOverviewTableBody');
      return Array.from(tbody.querySelectorAll('tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()));
    });
  }
  async function resetItemFilters() {
    await page.evaluate(() => {
      document.getElementById('opReportItemFilterStatus').value = '';
      document.getElementById('opReportItemFilterDeadlineStatus').value = '';
      document.getElementById('opReportFilterKind').value = '';
      document.getElementById('opReportFilterProgress').value = '';
      document.getElementById('opReportFilterKeyword').value = '';
    });
  }

  try {
    await loginAs(page, VIEWER);
    await resetItemFilters();

    await run.run('Không lọc gì: bảng Tổng Quan gộp ĐỦ 5 công việc từ CẢ 2 hồ sơ khác nhau (không chỉ 1 hồ sơ)', async () => {
      await page.evaluate(() => renderOperationStoreReport());
      const rows = await readOverviewTableRows();
      assertEqual(rows.length, 5, 'Phải liệt kê đủ 5 công việc (3 của hồ sơ Mở mới + 2 của hồ sơ Sửa chữa)');
      const codes = new Set(rows.map(r => r[0]));
      assert(codes.has('MMST-9001'), 'Phải có công việc thuộc hồ sơ Mở mới MMST-9001');
      assert(codes.has('SCST-9002'), 'Phải có công việc thuộc hồ sơ Sửa chữa SCST-9002');
      const count = await page.evaluate(() => document.getElementById('operationWorkItemOverviewCount').innerText);
      assertIncludes(count, '5', 'Ô đếm tổng số công việc phải hiện đúng 5');
    });

    await run.run('Nhãn Trạng Thái Công Việc/Trạng Thái Hạn hiển thị đúng cho từng công việc (mirror computeOperationWorkItemDeadlineStatus)', async () => {
      await page.evaluate(() => renderOperationStoreReport());
      const rows = await readOverviewTableRows();
      const byTitle = {};
      rows.forEach(r => { byTitle[r[2]] = r; }); // cột 2 = Tên Công Việc
      assertIncludes(byTitle['W1 - Chưa bắt đầu, đã quá hạn'][5], 'Chưa bắt đầu', 'W1: cột Trạng Thái Công Việc phải là "Chưa bắt đầu"');
      assertIncludes(byTitle['W1 - Chưa bắt đầu, đã quá hạn'][6], 'Quá hạn', 'W1: cột Trạng Thái Hạn phải báo "Quá hạn — Chưa bắt đầu"');
      assertIncludes(byTitle['W2 - Đang thực hiện, đúng tiến độ'][5], 'Đang thực hiện', 'W2: cột Trạng Thái Công Việc phải là "Đang thực hiện"');
      assertIncludes(byTitle['W2 - Đang thực hiện, đúng tiến độ'][6], 'Đúng tiến độ', 'W2: chưa tới hạn -> "Đúng tiến độ"');
      assertIncludes(byTitle['W3 - Đang nghiệm thu, đã quá hạn'][5], 'Đang nghiệm thu', 'W3: cột Trạng Thái Công Việc phải là "Đang nghiệm thu" (chờ nghiệm thu)');
      assertIncludes(byTitle['W3 - Đang nghiệm thu, đã quá hạn'][6], 'Quá hạn', 'W3: đã quá hạn deadline nhưng chưa nghiệm thu xong -> vẫn "Quá hạn — Chưa hoàn thành"');
      assertIncludes(byTitle['W4 - Đã nghiệm thu'][5], 'Đã nghiệm thu', 'W4: cột Trạng Thái Công Việc phải là "Đã nghiệm thu"');
      assertIncludes(byTitle['W4 - Đã nghiệm thu'][6], 'Hoàn thành', 'W4: ĐÃ nghiệm thu -> "Hoàn thành", KHÔNG bị gắn cờ quá hạn dù deadline đã qua rất lâu');
      assertIncludes(byTitle['W4 - Đã nghiệm thu'][9], '12/08/2026', 'W4: cột Ngày Nghiệm Thu phải lấy đúng mốc history action ACCEPTED gần nhất');
      assertEqual(byTitle['W5 - Chưa bắt đầu, còn hạn'][6].includes('Quá hạn'), false, 'W5: còn hạn -> KHÔNG được gắn cờ "Quá hạn"');
    });

    await run.run('Lọc theo Trạng Thái Công Việc = "Đã nghiệm thu" -> chỉ còn ĐÚNG 1 dòng (W4), cả bảng lẫn export đều khớp', async () => {
      await page.evaluate(() => { document.getElementById('opReportItemFilterStatus').value = 'DA_NGHIEM_THU'; renderOperationStoreReport(); });
      const rows = await readOverviewTableRows();
      assertEqual(rows.length, 1, 'Chỉ còn đúng 1 công việc DA_NGHIEM_THU');
      assertEqual(rows[0][2], 'W4 - Đã nghiệm thu', 'Đúng công việc W4');

      const result = await page.evaluate(async () => {
        let captured = null;
        const orig = window.downloadXlsxFromServer;
        window.downloadXlsxFromServer = async (fileName, sheetName, columns, xrows) => { captured = { fileName, sheetName, columns, rows: xrows }; };
        try { await exportOperationStoreReportOverview(); } finally { window.downloadXlsxFromServer = orig; }
        return captured;
      });
      assertEqual(result.rows.length, 1, 'File xuất phải khớp ĐÚNG bảng đang lọc trên màn hình (1 dòng)');
      assertEqual(result.rows[0].title, 'W4 - Đã nghiệm thu', 'Dòng xuất phải đúng W4');
      await page.evaluate(() => { document.getElementById('opReportItemFilterStatus').value = ''; });
    });

    await run.run('Lọc theo Trạng Thái Hạn = "Quá hạn — Chưa hoàn thành" -> chỉ còn W3 (đang nghiệm thu nhưng đã quá hạn)', async () => {
      await page.evaluate(() => { document.getElementById('opReportItemFilterDeadlineStatus').value = 'QUA_HAN_CHUA_XONG'; renderOperationStoreReport(); });
      const rows = await readOverviewTableRows();
      assertEqual(rows.length, 1, 'Chỉ còn đúng 1 công việc QUA_HAN_CHUA_XONG');
      assertEqual(rows[0][2], 'W3 - Đang nghiệm thu, đã quá hạn', 'Đúng công việc W3');
      await page.evaluate(() => { document.getElementById('opReportItemFilterDeadlineStatus').value = ''; });
    });

    await run.run('Xuất Excel không lọc gì: đủ cột theo thiết kế + đủ 5 dòng + không có alert lỗi', async () => {
      await page.evaluate(() => renderOperationStoreReport());
      const result = await page.evaluate(async () => {
        let captured = null;
        const orig = window.downloadXlsxFromServer;
        window.downloadXlsxFromServer = async (fileName, sheetName, columns, xrows) => { captured = { fileName, sheetName, columns, rows: xrows }; };
        try { await exportOperationStoreReportOverview(); } finally { window.downloadXlsxFromServer = orig; }
        return { captured, alerts: window.__alerts };
      });
      assert(result.captured, 'Phải thực sự gọi downloadXlsxFromServer()');
      assertEqual(result.captured.sheetName, 'Tổng Quan Công Việc', 'Tên sheet phải đúng');
      const headers = result.captured.columns.map(c => c.header);
      ['Mã Hồ Sơ', 'Tên Hồ Sơ', 'Tên Công Việc', 'Người Thực Hiện', 'Người Nghiệm Thu',
        'Trạng Thái Công Việc', 'Trạng Thái Hạn', 'Ngày Bắt Đầu', 'Hạn Chót', 'Ngày Nghiệm Thu'].forEach(h => {
        assert(headers.includes(h), `Phải có cột "${h}"`);
      });
      assertEqual(result.captured.rows.length, 5, 'Phải xuất đủ 5 dòng (khớp đúng bảng đang xem, không lọc gì)');
      assertEqual(result.alerts.length, 0, 'Xuất Excel thành công không được có alert lỗi nào');
    });

    await run.run('Không có công việc nào phù hợp (lọc rỗng) -> báo alert, KHÔNG gọi downloadXlsxFromServer()', async () => {
      const result = await page.evaluate(async () => {
        document.getElementById('opReportItemFilterStatus').value = 'CHUA_BAT_DAU';
        document.getElementById('opReportItemFilterDeadlineStatus').value = 'HOAN_THANH'; // không tổ hợp nào khớp
        renderOperationStoreReport();
        let called = false;
        const orig = window.downloadXlsxFromServer;
        window.downloadXlsxFromServer = async () => { called = true; };
        try { await exportOperationStoreReportOverview(); } finally { window.downloadXlsxFromServer = orig; }
        document.getElementById('opReportItemFilterStatus').value = '';
        document.getElementById('opReportItemFilterDeadlineStatus').value = '';
        return { called, alerts: window.__alerts };
      });
      assertEqual(result.called, false, 'KHÔNG được gọi downloadXlsxFromServer() khi không có dòng nào phù hợp');
      assert(result.alerts.some(a => a.includes('Không có công việc nào phù hợp')), 'Phải báo alert rõ ràng cho người dùng');
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
