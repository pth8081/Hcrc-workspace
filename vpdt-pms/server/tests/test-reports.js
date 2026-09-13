// tests/test-reports.js — Báo Cáo module (key 'reports'): per-module report template rendering
// (Contract/Office/Task extra metrics), the Tổng Hợp (aggregate) multi-dimensional dashboard, the
// "Tra Cứu Chi Tiết" column-picker/filter, and Excel export (detail + summary).
//
// Run: node server/tests/test-reports.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8994;

function seedReportData() {
  // All createdAt values fall inside the 2026-01-01..2026-12-31 filter window used by every scenario
  // below. Amounts are chosen to be easy to eyeball in assertions once combined.
  return {
    contracts: [
      { id: 1, code: 'HD-001', dept: 'Phòng Kế Toán', approvalStatus: 'APPROVED', amount: 100000000, endDate: '2027-01-01', createdAt: '2026-03-01T09:00:00', customData: { shipmentTrackingCode: 'ABC123' } }, // active
      { id: 2, code: 'HD-002', dept: 'Phòng Kế Toán', approvalStatus: 'APPROVED', amount: 50000000, endDate: '2025-01-01', createdAt: '2026-03-02T09:00:00' }, // expired
      { id: 3, code: 'HD-003', dept: 'Phòng CNTT', approvalStatus: 'PENDING', amount: 30000000, endDate: '2027-01-01', createdAt: '2026-03-03T09:00:00' } // not counted (not APPROVED)
    ],
    officeReqs: [
      { id: 1, code: 'VP-001', dept: 'Phòng Kế Toán', status: 'APPROVED', subType: 'MUA_BAN', amount: 20000000, createdAt: '2026-03-01T09:00:00' },
      { id: 2, code: 'VP-002', dept: 'Phòng CNTT', status: 'APPROVED', subType: 'SUA_CHUA', amount: 5000000, createdAt: '2026-03-02T09:00:00' },
      { id: 3, code: 'VP-003', dept: 'Phòng CNTT', status: 'PENDING', subType: 'DAU_TU', amount: 99999999, createdAt: '2026-03-03T09:00:00' } // not counted
    ],
    tasks: [
      { id: 1, title: 'Việc đã xong', status: 'DONE', sourceType: 'MANUAL', deadline: '2026-01-01', createdAt: '2026-03-01T09:00:00' },
      { id: 2, title: 'Việc quá hạn', status: 'TODO', sourceType: 'SUBMISSION', deadline: '2026-01-01', createdAt: '2026-03-02T09:00:00' }, // overdue
      { id: 3, title: 'Việc đang làm', status: 'DOING', sourceType: 'MEETING_MINUTES', deadline: '2099-01-01', createdAt: '2026-03-03T09:00:00' }
    ],
    docs: [
      { id: 1, dept: 'Phòng Kế Toán', status: 'APPROVED', createdAt: '2026-03-01T09:00:00' },
      { id: 2, dept: 'Phòng CNTT', status: 'PENDING', createdAt: '2026-03-02T09:00:00' }
    ],
    submissions: [
      { id: 1, dept: 'Phòng Kế Toán', status: 'APPROVED', createdAt: '2026-03-01T09:00:00' },
      { id: 2, dept: 'Phòng CNTT', status: 'REJECTED', createdAt: '2026-03-02T09:00:00' }
    ],
    carRegs: [
      { id: 1, dept: 'Phòng Kế Toán', status: 'APPROVED', km: 120, createdAt: '2026-03-01T09:00:00' },
      { id: 2, dept: 'Phòng CNTT', status: 'PENDING', km: 50, createdAt: '2026-03-02T09:00:00' }
    ],
    meetings: [
      { id: 1, dept: 'Phòng Kế Toán', status: 'APPROVED', createdAt: '2026-03-01T09:00:00' },
      { id: 2, dept: 'Phòng CNTT', status: 'CANCELLED', createdAt: '2026-03-02T09:00:00' }
    ],
    meetingMinutes: [
      { id: 1, dept: 'Phòng Kế Toán', createdAt: '2026-03-01T09:00:00' }
    ],
    vppRegistrations: [], uniformIssuances: [] // not exercised by these scenarios, seeded empty for safety
  };
}

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    const viewer = makeUser({ username: 'ketoan.trg', name: 'Trưởng Phòng Kế Toán', dept: 'Phòng Kế Toán', perms: { canViewReports: true } });
    const noAccess = makeUser({ username: 'nv.thuong', name: 'Nhân Viên Thường', dept: 'Phòng CNTT', perms: {} });

    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((data) => { Object.assign(DB, data); }, seedReportData());
    await page.evaluate((users) => { DB.users = users; }, [viewer, noAccess]);

    await run('a user without canViewReports/admin is blocked from the Báo Cáo tab', async () => {
      await page.evaluate((u) => finishLogin(u), noAccess);
      await page.evaluate(() => { window.__alerts.length = 0; });
      await page.evaluate(() => switchTab('reports'));
      const sectionHidden = await page.evaluate(() => document.getElementById('reportsSection').classList.contains('hidden'));
      assert(sectionHidden, 'reports section should stay hidden for a user without access');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('không có quyền truy cập Module Báo cáo')), `expected access-denied alert, got ${JSON.stringify(alerts)}`);
    });

    await page.evaluate((u) => finishLogin(u), viewer);
    await page.evaluate(() => {
      switchTab('reports');
      document.getElementById('reportsFromDate').value = '2026-01-01';
      document.getElementById('reportsToDate').value = '2026-12-31';
      document.getElementById('reportsDeptFilter').value = '';
      renderReports();
    });

    await run('Tổng Hợp shows correct record-count totals across modules (no dept filter)', async () => {
      const html = await page.evaluate(() => document.getElementById('reportsContent').innerHTML);
      // overviewItems: doc=2, submission=2, car=2, office=3, contract=3, meeting=2, minutes=1, task=3
      assert(html.includes('>2<') , 'expected a "2" total somewhere in the overview cards');
      const stats = await page.evaluate(() => ({
        doc: computeApprovalStats(DB.docs, '', '2026-01-01', '2026-12-31').total,
        sub: computeApprovalStats(DB.submissions, '', '2026-01-01', '2026-12-31').total,
        car: computeApprovalStats(DB.carRegs, '', '2026-01-01', '2026-12-31').total,
        office: computeApprovalStats(DB.officeReqs, '', '2026-01-01', '2026-12-31').total,
        contracts: DB.contracts.length,
        meetings: DB.meetings.length,
        minutes: DB.meetingMinutes.length,
        tasks: DB.tasks.length
      }));
      assertEqual(stats.doc, 2, 'doc total mismatch'); assertEqual(stats.sub, 2, 'submission total mismatch');
      assertEqual(stats.car, 2, 'car total mismatch'); assertEqual(stats.office, 3, 'office total mismatch');
      assertEqual(stats.contracts, 3, 'contract total mismatch'); assertEqual(stats.meetings, 2, 'meeting total mismatch');
      assertEqual(stats.minutes, 1, 'minutes total mismatch'); assertEqual(stats.tasks, 3, 'task total mismatch');
      assert(html.includes('1 quá hạn'), `expected "1 quá hạn" (1 overdue task) in the Tổng Hợp HTML, got a snippet without it`);
    });

    await run('Tổng Hợp finance block computes active/expired contract value and office dự toán correctly (APPROVED-only)', async () => {
      const html = await page.evaluate(() => document.getElementById('reportsContent').innerHTML);
      // active contract value = HD-001 (100,000,000); expired = HD-002 (50,000,000); HD-003 excluded (PENDING)
      assert(html.includes('100.000.000 VNĐ'), `expected active contract value 100.000.000 VNĐ in HTML`);
      assert(html.includes('50.000.000 VNĐ'), `expected expired contract value 50.000.000 VNĐ in HTML`);
      // office dự toán: Mua sắm 20,000,000 (VP-001 APPROVED); Sửa chữa 5,000,000 (VP-002 APPROVED); Đầu tư 0 (VP-003 is PENDING, excluded)
      assert(html.includes('20.000.000'), 'expected Mua sắm dự toán 20.000.000 in HTML');
      assert(html.includes('5.000.000'), 'expected Sửa chữa dự toán 5.000.000 in HTML');
    });

    await run('dept filter narrows Tổng Hợp totals to just Phòng CNTT', async () => {
      await page.evaluate(() => { document.getElementById('reportsDeptFilter').value = 'Phòng CNTT'; renderReports(); });
      const stats = await page.evaluate(() => ({
        doc: computeApprovalStats(DB.docs, 'Phòng CNTT', '2026-01-01', '2026-12-31').total,
        contracts: DB.contracts.filter((c) => c.dept === 'Phòng CNTT' && isInDateRange(c.createdAt, '2026-01-01', '2026-12-31')).length
      }));
      assertEqual(stats.doc, 1, 'CNTT doc total mismatch');
      assertEqual(stats.contracts, 1, 'CNTT contract total mismatch');
      await page.evaluate(() => { document.getElementById('reportsDeptFilter').value = ''; renderReports(); });
    });

    await run('Hợp Đồng report tab shows correct APPROVED/PENDING status breakdown', async () => {
      await page.evaluate(() => selectReportsNavL1('contract'));
      const html = await page.evaluate(() => document.getElementById('reportsContent').innerHTML);
      assert(html.includes('100.000.000 VNĐ') && html.includes('50.000.000 VNĐ'), 'contract tab should show the same active/expired value breakdown as Tổng Hợp');
    });

    await run('Văn Phòng Tổng Hợp report tab computes dự toán by subtype (Mua sắm/Sửa chữa/Đầu tư), PENDING excluded', async () => {
      await page.evaluate(() => selectReportsNavL1('office'));
      // Scope the assertion to the "dự toán" extra-metrics snippet specifically (not the raw records
      // table further down, which legitimately lists VP-003's own amount as a regular row value).
      const extraHTML = await page.evaluate(async () => {
        const records = await REPORT_MODULE_CONFIGS.office.getRecords('', document.getElementById('reportsFromDate').value, document.getElementById('reportsToDate').value);
        return renderOfficeReportExtra(records);
      });
      assert(extraHTML.includes('20.000.000'), 'expected Mua sắm dự toán 20.000.000 in the extra-metrics HTML');
      assert(extraHTML.includes('5.000.000'), 'expected Sửa chữa dự toán 5.000.000 in the extra-metrics HTML');
      assert(!extraHTML.includes('99.999.999'), 'PENDING office request amount should not be counted into dự toán (Đầu tư should read 0)');
    });

    await run('Công Việc report tab computes the on-time completion rate from DONE tasks with a deadline', async () => {
      await page.evaluate(() => selectReportsNavL1('task'));
      const extraHTML = await page.evaluate(async () => {
        const records = await REPORT_MODULE_CONFIGS.task.getRecords('', document.getElementById('reportsFromDate').value, document.getElementById('reportsToDate').value);
        return renderTaskReportExtra(records);
      });
      // t1 is the only DONE task with a deadline and has no history entries, so it counts as NOT
      // completed-on-time by this metric's definition (0/1, matching lib code's history-based check).
      assert(extraHTML.includes('0/1 công việc có hạn hoàn thành đúng hạn'), `expected "0/1 công việc có hạn hoàn thành đúng hạn" in HTML, got: ${extraHTML}`);
    });

    await run('Tra Cứu Chi Tiết (contract tab): column picker + text filter narrow the results table', async () => {
      await page.evaluate(() => selectReportsNavL1('contract'));
      const columnKeys = await page.evaluate(() => reportDetailContext.columns.map((c) => c.key));
      assert(columnKeys.includes('code'), 'expected a "code" column to be inferred for contracts');
      assert(columnKeys.includes('__status'), 'expected a "__status" column for the approval status');
      assert(columnKeys.includes('dept'), 'expected a "dept" column');

      // Default selection is the first 6 columns — make sure "code" and "dept" are explicitly selected
      // so the filter/assert below is meaningful regardless of column ordering.
      await page.evaluate(() => { onReportDetailColumnToggle('contract', 'code', true); onReportDetailColumnToggle('contract', 'dept', true); });
      await page.evaluate(() => { onReportDetailFilterInput.__test = true; });
      await page.evaluate(() => {
        document.getElementById('rdf_contract___status') && (document.getElementById('rdf_contract___status').value = 'APPROVED');
      });
      // Drive the real filter-change handler the way the <select onchange> would, for the __status column.
      await page.evaluate(() => onReportDetailFilterInput('contract', '__status', 'select'));
      const html = await page.evaluate(() => document.getElementById('reportDetailResultsWrap').innerHTML);
      assert(html.includes('HD-001') && html.includes('HD-002'), 'APPROVED filter should keep HD-001 and HD-002');
      assert(!html.includes('HD-003'), 'APPROVED filter should exclude the PENDING HD-003');
    });

    // RPT-02: customData (trường tuỳ biến do Biểu Mẫu tạo, VD "shipmentTrackingCode") trước đây bị loại
    // hoàn toàn khỏi Tra Cứu Chi Tiết vì typeof là 'object' — giờ phải tự tách ra thành cột riêng.
    await run('Tra Cứu Chi Tiết (contract tab): trường customData (Biểu Mẫu tuỳ biến) hiện đúng thành cột riêng', async () => {
      const columnKeys = await page.evaluate(() => reportDetailContext.columns.map((c) => c.key));
      assert(columnKeys.includes('customData.shipmentTrackingCode'), `expected a "customData.shipmentTrackingCode" column, got: ${columnKeys.join(', ')}`);
      await page.evaluate(() => onReportDetailColumnToggle('contract', 'customData.shipmentTrackingCode', true));
      const html = await page.evaluate(() => document.getElementById('reportDetailResultsWrap').innerHTML);
      assert(html.includes('ABC123'), 'expected the customData value "ABC123" to render in the detail table');
    });

    await run('Excel export (detail, contract tab) sends the selected columns and filtered rows', async () => {
      await page.evaluate(() => { window.__xlsxExports.length = 0; });
      await page.evaluate(() => exportReportDetailExcel('contract'));
      const exportsList = await page.evaluate(() => window.__xlsxExports.slice());
      assertEqual(exportsList.length, 1, 'expected exactly 1 xlsx export call');
      const body = exportsList[0];
      assert(body.columns.some((c) => c.key === 'code'), 'export columns should include "code"');
      assertEqual(body.rows.length, 2, 'export should contain the 2 APPROVED contracts still active from the filter above');
    });

    await run('Excel export (Tổng Hợp summary) sends the full administrative metrics sheet', async () => {
      await page.evaluate(() => { selectReportsNavL1('SUMMARY'); window.__xlsxExports.length = 0; });
      await page.evaluate(() => exportReportsSummaryExcel());
      await page.waitForFunction(() => window.__xlsxExports.length > 0);
      const body = await page.evaluate(() => window.__xlsxExports[0]);
      assertEqual(body.sheetName, 'Báo Cáo Quản Trị', 'summary export sheet name mismatch');
      const rowFor = (label) => body.rows.find((r) => r.label === label);
      assertEqual(rowFor('Giá trị Hợp đồng còn hiệu lực (VNĐ)').value, 100000000, 'exported active contract value mismatch');
      assertEqual(rowFor('Giá trị Hợp đồng đã hết hạn (VNĐ)').value, 50000000, 'exported expired contract value mismatch');
      assertEqual(rowFor('Dự toán Văn phòng - Mua sắm (VNĐ)').value, 20000000, 'exported Mua sắm dự toán mismatch');
    });

    // ===== Đồng Phục: bộ lọc chọn NHIỀU siêu thị + dòng "Tổng Cộng (đã chọn)" + khối "Tổng Cộng TẤT
    // CẢ Siêu Thị" — seed riêng ở CUỐI file (chạy sau mọi assertion Tổng Hợp/Excel ở trên, tránh ảnh
    // hưởng ngược các phép tính tổng hợp đã kiểm tra xong).
    await page.evaluate(() => {
      Object.assign(DB, {
        stores: ['Siêu Thị A', 'Siêu Thị B'],
        uniformPeriods: [{
          id: 1, name: 'Đợt 1', approvalStatus: 'APPROVED',
          allocations: [
            { id: 11, dept: 'Siêu Thị A', status: 'CONFIRMED', items: [{ name: 'Áo đồng phục nam', size: 'L', qty: 20 }] },
            { id: 12, dept: 'Siêu Thị B', status: 'CONFIRMED', items: [{ name: 'Áo đồng phục nam', size: 'L', qty: 15 }] }
          ]
        }],
        uniformIssuances: [
          { id: 21, dept: 'Siêu Thị A', employeeName: 'NV A', createdAt: '2026-03-01T09:00:00', items: [{ name: 'Áo đồng phục nam', size: 'L', qty: 5 }] },
          { id: 22, dept: 'Siêu Thị B', employeeName: 'NV B', createdAt: '2026-03-01T09:00:00', items: [{ name: 'Áo đồng phục nam', size: 'L', qty: 3 }] }
        ],
        uniformStockAdjustments: [], uniformTransfers: []
      });
      selectReportsNavL1('hanhchinh');
      selectReportsNavL2('uniform');
    });

    await run('Đồng Phục: mặc định (chọn hết) hiện đúng tồn kho từng siêu thị + dòng Tổng Cộng (đã chọn)', async () => {
      const html = await page.evaluate(() => document.getElementById('reportsContent').innerHTML);
      assert(html.includes('Siêu Thị A') && html.includes('Siêu Thị B'), 'phải hiện cả 2 siêu thị có allocation');
      assert(!html.includes('Tổng Cộng TẤT CẢ Siêu Thị'), 'mặc định chọn hết KHÔNG cần hiện khối tổng-tất-cả riêng (đã trùng với đã chọn)');
      const footerText = await page.evaluate(() => document.querySelector('#reportsContent tfoot')?.textContent || '');
      assert(footerText.includes('2 siêu thị đã chọn'), `dòng Tổng Cộng phải ghi đúng số siêu thị đã chọn, got: ${footerText}`);
      assert(footerText.includes('35') && footerText.includes('8') && footerText.includes('27'), `dòng Tổng Cộng phải đúng 35 đã nhận / 8 đã cấp / 27 tồn, got: ${footerText}`);
    });

    await run('Đồng Phục: bỏ chọn Siêu Thị B (bấm checkbox thật) -> bảng chỉ còn A, khối Tổng-Tất-Cả xuất hiện đúng số', async () => {
      await page.click('input.uniform-report-store-cb[data-arg0="Siêu Thị B"]');
      await page.waitForTimeout(80);
      const html = await page.evaluate(() => document.getElementById('reportsContent').innerHTML);
      assert(html.includes('Siêu Thị A'), 'vẫn phải hiện Siêu Thị A (còn được chọn)');
      const stockTableHTML = await page.evaluate(() => document.querySelectorAll('#reportsContent table')[0]?.innerHTML || '');
      assert(!stockTableHTML.includes('Siêu Thị B'), 'bảng tồn kho KHÔNG được còn dòng Siêu Thị B sau khi bỏ chọn');
      const footerText = await page.evaluate(() => document.querySelector('#reportsContent tfoot')?.textContent || '');
      assert(footerText.includes('1 siêu thị đã chọn'), `dòng Tổng Cộng phải còn đúng 1 siêu thị, got: ${footerText}`);
      assert(footerText.includes('20') && footerText.includes('5') && footerText.includes('15'), `dòng Tổng Cộng (chỉ A) phải đúng 20/5/15, got: ${footerText}`);
      assert(html.includes('Tổng Cộng TẤT CẢ Siêu Thị'), 'đã lọc còn 1 siêu thị -> phải hiện khối Tổng Cộng TẤT CẢ Siêu Thị (bao gồm cả B)');
      const grandBlockText = await page.evaluate(() => document.querySelector('#reportsContent .bg-indigo-50')?.textContent || '');
      assert(grandBlockText.includes('35') && grandBlockText.includes('8') && grandBlockText.includes('27'), `khối Tổng Cộng TẤT CẢ phải đúng 35/8/27 (A+B gộp lại), got: ${grandBlockText}`);
    });

    await run('Đồng Phục: "Bỏ Chọn Hết" -> báo trống, "Chọn Tất Cả" khôi phục lại', async () => {
      await page.click('button[data-op="setAllUniformReportStores"][data-arg0="false"]');
      await page.waitForTimeout(80);
      let html = await page.evaluate(() => document.getElementById('reportsContent').innerHTML);
      assert(html.includes('cho nhóm siêu thị đã chọn'), 'bỏ chọn hết phải báo rõ "không có dữ liệu cho nhóm đã chọn" (không tự coi là chọn hết)');

      await page.click('button[data-op="setAllUniformReportStores"][data-arg0="true"]');
      await page.waitForTimeout(80);
      html = await page.evaluate(() => document.getElementById('reportsContent').innerHTML);
      assert(html.includes('Siêu Thị A') && html.includes('Siêu Thị B'), '"Chọn Tất Cả" phải khôi phục lại đủ dữ liệu như ban đầu');
    });

    // ===== Gap-fill (rà soát "module còn thiếu trong Báo Cáo"): Nhân Sự (HCRC Đồng Hành +
    // Onboarding/Offboarding) + Vận Hành (Đơn Hàng/Mở Mới/Sửa Chữa) — seed riêng ở CUỐI file, cùng lý do
    // Đồng Phục ở trên (không ảnh hưởng ngược các assertion Tổng Hợp/Excel đã chạy xong).
    await page.evaluate(() => {
      Object.assign(DB, {
        hrFeedback: [
          { id: 101, dept: 'Phòng Kế Toán', status: 'PENDING', category: 'SALARY', createdAt: '2026-03-01T09:00:00' },
          { id: 102, dept: 'Phòng CNTT', status: 'ANSWERED', category: 'POLICY', createdAt: '2026-03-02T09:00:00' },
          { id: 103, dept: 'Phòng CNTT', status: 'ANSWERED', category: 'BENEFITS', createdAt: '2026-03-03T09:00:00' }
        ],
        hrProcesses: [
          { id: 201, dept: 'Phòng Kế Toán', processType: 'ONBOARDING', status: 'IN_PROGRESS', createdAt: '2026-03-01T09:00:00' },
          { id: 202, dept: 'Phòng CNTT', processType: 'OFFBOARDING', status: 'COMPLETED', createdAt: '2026-03-02T09:00:00' },
          { id: 203, dept: 'Phòng CNTT', processType: 'ONBOARDING', status: 'CANCELLED', createdAt: '2026-03-03T09:00:00' }
        ],
        operationOrders: [
          { id: 301, dept: 'Phòng Kế Toán', status: 'PENDING', orderLocationType: 'HO', amount: 5000000, createdAt: '2026-03-01T09:00:00' },
          { id: 302, dept: 'Phòng CNTT', status: 'AWAITING_RECEIPT', orderLocationType: 'HO', amount: 8000000, createdAt: '2026-03-02T09:00:00' },
          { id: 303, dept: 'Phòng CNTT', status: 'RECEIVED', orderLocationType: 'HO', amount: 3000000, createdAt: '2026-03-03T09:00:00' }
        ],
        operationStoreOpenings: [
          { id: 401, dept: 'Phòng Kế Toán', estimateStatus: 'DRAFT', createdAt: '2026-03-01T09:00:00' },
          { id: 402, dept: 'Phòng CNTT', estimateStatus: 'APPROVED', createdAt: '2026-03-02T09:00:00' }
        ],
        operationRepairs: [
          { id: 501, dept: 'Phòng CNTT', estimateStatus: 'PENDING', createdAt: '2026-03-01T09:00:00' }
        ]
      });
    });

    await run('Nav Báo Cáo: "Nhân Sự"/"Vận Hành" xuất hiện đúng với đủ module con', async () => {
      const nav = await page.evaluate(() => REPORT_NAV_TREE.map((n) => ({ key: n.key, children: (n.children || []).map((c) => c.key) })));
      const hrNode = nav.find((n) => n.key === 'hr');
      const vanHanhNode = nav.find((n) => n.key === 'vanHanh');
      assert(hrNode && JSON.stringify(hrNode.children) === JSON.stringify(['hr', 'hrLifecycle']), `node "hr" phải có đúng 2 con [hr, hrLifecycle], got: ${JSON.stringify(hrNode)}`);
      assert(vanHanhNode && JSON.stringify(vanHanhNode.children) === JSON.stringify(['vanHanh', 'operationStoreOpen', 'operationRepair']), `node "vanHanh" phải có đúng 3 con, got: ${JSON.stringify(vanHanhNode)}`);
    });

    await run('Báo Cáo HCRC Đồng Hành: đếm đúng PENDING/ANSWERED, không lộ nội dung câu hỏi ngoài phạm vi', async () => {
      await page.evaluate(() => { selectReportsNavL1('hr'); selectReportsNavL2('hr'); });
      const html = await page.evaluate(() => document.getElementById('reportsContent').innerHTML);
      assert(html.includes('>3<'), `expected tổng 3 câu hỏi trong khoảng lọc, snippet: ${html.slice(0, 400)}`);
      const stats = await page.evaluate(async () => {
        const records = await REPORT_MODULE_CONFIGS.hr.getRecords('', '2026-01-01', '2026-12-31');
        return { total: records.length, pending: records.filter((r) => r.status === 'PENDING').length, answered: records.filter((r) => r.status === 'ANSWERED').length };
      });
      assertEqual(stats.total, 3, 'hrFeedback total mismatch'); assertEqual(stats.pending, 1, 'PENDING count mismatch'); assertEqual(stats.answered, 2, 'ANSWERED count mismatch');
    });

    await run('Báo Cáo Onboarding/Offboarding: đếm đúng IN_PROGRESS/COMPLETED/CANCELLED + lọc theo phòng ban', async () => {
      await page.evaluate(() => selectReportsNavL2('hrLifecycle'));
      const stats = await page.evaluate(async () => {
        const all = await REPORT_MODULE_CONFIGS.hrLifecycle.getRecords('', '2026-01-01', '2026-12-31');
        const cntt = await REPORT_MODULE_CONFIGS.hrLifecycle.getRecords('Phòng CNTT', '2026-01-01', '2026-12-31');
        return { total: all.length, cntt: cntt.length };
      });
      assertEqual(stats.total, 3, 'hrProcesses total mismatch'); assertEqual(stats.cntt, 2, 'hrProcesses CNTT-only mismatch (should be COMPLETED+CANCELLED)');
    });

    await run('Báo Cáo Vận Hành: 3 luồng Đơn Hàng/Mở Mới/Sửa Chữa đếm đúng độc lập nhau', async () => {
      await page.evaluate(() => { selectReportsNavL1('vanHanh'); selectReportsNavL2('vanHanh'); });
      // getRecords() của 3 collection Vận Hành giờ ASYNC (Bước 7e — fetchReportRecords() gọi
      // /api/reports/:collection, mock harness không có route này nên tự rơi về fallback lọc
      // DB.<collection> cũ, vẫn đúng số liệu) — phải await, không .filter() thẳng lên Promise nữa.
      const stats = await page.evaluate(async () => {
        const orders = await REPORT_MODULE_CONFIGS.vanHanh.getRecords('', '2026-01-01', '2026-12-31');
        const storeOpen = await REPORT_MODULE_CONFIGS.operationStoreOpen.getRecords('', '2026-01-01', '2026-12-31');
        const repair = await REPORT_MODULE_CONFIGS.operationRepair.getRecords('', '2026-01-01', '2026-12-31');
        return {
          orders: orders.length,
          storeOpen: storeOpen.length,
          repair: repair.length,
          ordersAwaiting: orders.filter((r) => r.status === 'AWAITING_RECEIPT').length,
          storeOpenApproved: storeOpen.filter((r) => r.estimateStatus === 'APPROVED').length
        };
      });
      assertEqual(stats.orders, 3, 'operationOrders total mismatch'); assertEqual(stats.storeOpen, 2, 'operationStoreOpenings total mismatch'); assertEqual(stats.repair, 1, 'operationRepairs total mismatch');
      assertEqual(stats.ordersAwaiting, 1, 'AWAITING_RECEIPT count mismatch'); assertEqual(stats.storeOpenApproved, 1, 'estimateStatus APPROVED count mismatch');
    });

    assertEqual(pageErrors.length, 0, `unexpected uncaught page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-reports.js');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
