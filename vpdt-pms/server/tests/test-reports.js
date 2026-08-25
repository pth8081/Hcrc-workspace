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
      { id: 1, code: 'HD-001', dept: 'Phòng Kế Toán', approvalStatus: 'APPROVED', amount: 100000000, endDate: '2027-01-01', createdAt: '2026-03-01T09:00:00' }, // active
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
      await page.evaluate(() => setReportsSubTab('contract'));
      const html = await page.evaluate(() => document.getElementById('reportsContent').innerHTML);
      assert(html.includes('100.000.000 VNĐ') && html.includes('50.000.000 VNĐ'), 'contract tab should show the same active/expired value breakdown as Tổng Hợp');
    });

    await run('Văn Phòng Tổng Hợp report tab computes dự toán by subtype (Mua sắm/Sửa chữa/Đầu tư), PENDING excluded', async () => {
      await page.evaluate(() => setReportsSubTab('office'));
      // Scope the assertion to the "dự toán" extra-metrics snippet specifically (not the raw records
      // table further down, which legitimately lists VP-003's own amount as a regular row value).
      const extraHTML = await page.evaluate(() => {
        const records = REPORT_MODULE_CONFIGS.office.getRecords('', document.getElementById('reportsFromDate').value, document.getElementById('reportsToDate').value);
        return renderOfficeReportExtra(records);
      });
      assert(extraHTML.includes('20.000.000'), 'expected Mua sắm dự toán 20.000.000 in the extra-metrics HTML');
      assert(extraHTML.includes('5.000.000'), 'expected Sửa chữa dự toán 5.000.000 in the extra-metrics HTML');
      assert(!extraHTML.includes('99.999.999'), 'PENDING office request amount should not be counted into dự toán (Đầu tư should read 0)');
    });

    await run('Công Việc report tab computes the on-time completion rate from DONE tasks with a deadline', async () => {
      await page.evaluate(() => setReportsSubTab('task'));
      const extraHTML = await page.evaluate(() => {
        const records = REPORT_MODULE_CONFIGS.task.getRecords('', document.getElementById('reportsFromDate').value, document.getElementById('reportsToDate').value);
        return renderTaskReportExtra(records);
      });
      // t1 is the only DONE task with a deadline and has no history entries, so it counts as NOT
      // completed-on-time by this metric's definition (0/1, matching lib code's history-based check).
      assert(extraHTML.includes('0/1 công việc có hạn hoàn thành đúng hạn'), `expected "0/1 công việc có hạn hoàn thành đúng hạn" in HTML, got: ${extraHTML}`);
    });

    await run('Tra Cứu Chi Tiết (contract tab): column picker + text filter narrow the results table', async () => {
      await page.evaluate(() => setReportsSubTab('contract'));
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
      await page.evaluate(() => { setReportsSubTab('SUMMARY'); window.__xlsxExports.length = 0; });
      await page.evaluate(() => exportReportsSummaryExcel());
      await page.waitForFunction(() => window.__xlsxExports.length > 0);
      const body = await page.evaluate(() => window.__xlsxExports[0]);
      assertEqual(body.sheetName, 'Báo Cáo Quản Trị', 'summary export sheet name mismatch');
      const rowFor = (label) => body.rows.find((r) => r.label === label);
      assertEqual(rowFor('Giá trị Hợp đồng còn hiệu lực (VNĐ)').value, 100000000, 'exported active contract value mismatch');
      assertEqual(rowFor('Giá trị Hợp đồng đã hết hạn (VNĐ)').value, 50000000, 'exported expired contract value mismatch');
      assertEqual(rowFor('Dự toán Văn phòng - Mua sắm (VNĐ)').value, 20000000, 'exported Mua sắm dự toán mismatch');
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
