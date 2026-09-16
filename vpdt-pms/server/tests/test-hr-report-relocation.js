// server/tests/test-hr-report-relocation.js
//
// Regression test cho việc dời "📊 Báo Cáo" (Nhân Sự) từ 1 view LỒNG bên trong Hồ Sơ Nhân Sự ra module
// con RIÊNG, ngang hàng Hồ Sơ Nhân Sự/Hợp Đồng Lao Động (9/2026, theo phản hồi người dùng — báo cáo phải
// nằm ở CẤP module Nhân Sự, không lồng trong Hồ Sơ Nhân Sự). Dùng REAL clicks (page.click()) — bài học
// từ vụ Nghiệp Vụ click không phản hồi (bindCspDelegation thiếu đăng ký root #hrReportSection mới) chỉ
// lộ ra khi test click thật, không lộ khi gọi hàm trực tiếp qua page.evaluate().
//
// Dùng testHarness.js's mock backend (KHÔNG có route /api/hr-profile/* thật — dedicated router riêng,
// cần DB SQL Server thật, xem test-hr-profile.js/test-hr-profile-position-history.js cho phần đó) — bài
// test này CHỈ xác minh tầng điều hướng/quyền/CSP delegation phía client, không xác minh số liệu báo cáo.
//
// Chạy: node server/tests/test-hr-report-relocation.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual
} = require('./testHarness');

const PORT = 8995;
// Đủ CẢ 2 quyền hrProfileManage LẪN hrContractManage -> thấy được "Báo Cáo" (hrpfCanViewReports()).
const HR_FULL = { username: 'hr_full', name: 'Nhân Sự Đầy Đủ', dept: 'Nhân Sự', perms: { hrProfileManage: true, hrContractManage: true }, active: true };
// CHỈ hrProfileManage (thiếu hrContractManage) -> KHÔNG thấy "Báo Cáo", vẫn thấy "Hồ Sơ Nhân Sự".
const HR_PROFILE_ONLY = { username: 'hr_profile_only', name: 'Chỉ Quản Lý Hồ Sơ', dept: 'Nhân Sự', perms: { hrProfileManage: true }, active: true };

const state = createMockState({ users: [HR_FULL, HR_PROFILE_ONLY] });

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
    await run.run('Đủ 2 quyền (hrProfileManage + hrContractManage): nút "📊 Báo Cáo" hiện trong dropdown Nhân Sự', async () => {
      await loginAs(page, HR_FULL);
      const reportBtnVisible = await page.evaluate(() => !document.getElementById('btnHrReportNav').classList.contains('hidden'));
      assert(reportBtnVisible, 'btnHrReportNav phải hiện khi đủ CẢ 2 quyền hrProfileManage+hrContractManage');
    });

    await run.run('"📊 Báo Cáo" phải nằm CUỐI CÙNG trong dropdown Nhân Sự (sau "💰 Lương", theo phản hồi người dùng)', async () => {
      const lastChildId = await page.evaluate(() => document.getElementById('hrDropdownPanel').lastElementChild.id);
      assertEqual(lastChildId, 'btnHrReportNav', 'btnHrReportNav phải là phần tử cuối cùng trong #hrDropdownPanel');
    });

    await run.run('Real click "📊 Báo Cáo": chuyển đúng sang #hrReportSection, ẨN hẳn #hrProfileSection/#hrContractSection', async () => {
      await page.click('#btnHrTab');
      await page.waitForTimeout(100);
      await page.click('#btnHrReportNav');
      await page.waitForTimeout(200);

      const reportSectionVisible = await page.evaluate(() => !document.getElementById('hrReportSection').classList.contains('hidden'));
      const profileSectionHidden = await page.evaluate(() => document.getElementById('hrProfileSection').classList.contains('hidden'));
      const contractSectionHidden = await page.evaluate(() => document.getElementById('hrContractSection').classList.contains('hidden'));
      assert(reportSectionVisible, 'Real click phải hiện đúng #hrReportSection');
      assert(profileSectionHidden, '#hrProfileSection phải ẨN khi đang ở tab Báo Cáo');
      assert(contractSectionHidden, '#hrContractSection phải ẨN khi đang ở tab Báo Cáo');
    });

    await run.run('#hrReportSection có gốc CSP riêng: real click "🔍 Xem Báo Cáo" phải THỰC SỰ gọi loadHrpfReports() (không im lặng)', async () => {
      // Bẫy lỗi "1 gốc CSP thiếu -> mọi thao tác im lặng không chạy" (đúng lỗi thật đã gặp ở
      // hrLifecycleSection/hrpfDetailModal trước đây) — đo qua đúng dấu hiệu: #hrpfReportBody đổi nội
      // dung sau khi bấm (dù API mock 404, hàm vẫn PHẢI được gọi và ghi lỗi vào #hrpfReportBody).
      await page.evaluate(() => { document.getElementById('hrpfReportBody').innerHTML = '__CHƯA_BẤM__'; });
      await page.click('[data-op="loadHrpfReports"]');
      await page.waitForTimeout(300);
      const bodyHtml = await page.evaluate(() => document.getElementById('hrpfReportBody').innerHTML);
      assert(!bodyHtml.includes('__CHƯA_BẤM__'), 'Nút "🔍 Xem Báo Cáo" phải thực sự kích hoạt loadHrpfReports() qua real click (CSP delegation #hrReportSection phải hoạt động)');
    });

    await run.run('Real click "🪪 Hồ Sơ Nhân Sự": KHÔNG còn nút/khối "📊 Báo Cáo" lồng bên trong nữa (đã dời hẳn ra ngoài)', async () => {
      await page.click('#btnHrTab');
      await page.waitForTimeout(100);
      await page.click('#btnHrProfileNav');
      await page.waitForTimeout(200);

      const hasOldReportBtn = await page.$('#btnHrpfViewReports');
      const hasOldReportView = await page.$('#hrpfViewReports');
      assert(!hasOldReportBtn, 'KHÔNG được còn nút btnHrpfViewReports lồng trong Hồ Sơ Nhân Sự (đã dời ra module riêng)');
      assert(!hasOldReportView, 'KHÔNG được còn khối #hrpfViewReports lồng trong Hồ Sơ Nhân Sự (đã dời ra module riêng)');
    });

    await run.run('CHỈ hrProfileManage (thiếu hrContractManage): KHÔNG thấy "📊 Báo Cáo", vẫn thấy "🪪 Hồ Sơ Nhân Sự"', async () => {
      await loginAs(page, HR_PROFILE_ONLY);
      const reportBtnVisible = await page.evaluate(() => !document.getElementById('btnHrReportNav').classList.contains('hidden'));
      const profileBtnVisible = await page.evaluate(() => !document.getElementById('btnHrProfileNav').classList.contains('hidden'));
      assert(!reportBtnVisible, 'btnHrReportNav PHẢI ẩn khi thiếu hrContractManage (chỉ có hrProfileManage)');
      assert(profileBtnVisible, 'btnHrProfileNav vẫn phải hiện bình thường (không phụ thuộc hrContractManage)');
    });

    await run.run('CHỈ hrProfileManage: real click thẳng switchTab("hrReport") vẫn bị server-side-mirror chặn (alert 403), không vào được', async () => {
      await page.evaluate(() => { window.__alerts = []; });
      await page.evaluate(() => switchTab('hrReport'));
      await page.waitForTimeout(100);
      const alerts = await page.evaluate(() => window.__alerts);
      const reportSectionVisible = await page.evaluate(() => !document.getElementById('hrReportSection').classList.contains('hidden'));
      assert(alerts.some(a => a.includes('Báo Cáo Nhân Sự')), 'Phải báo đúng lý do chặn khi cố vào thẳng tab hrReport thiếu quyền');
      assertEqual(reportSectionVisible, false, 'KHÔNG được vào được #hrReportSection khi thiếu quyền');
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
