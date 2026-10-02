// server/tests/test-muc0-module-access-tree.js
//
// "Mục 0: Quyền Truy Cập Module" — mở rộng thành cây 3-4 tầng (module -> tab con -> tab cháu, 10/2026,
// yêu cầu người dùng "phân quyền vào giao diện slide bar, tab bên trong từng menu con theo dạng hình
// cây", demo xác nhận với module Truyền Thông Nội Bộ). Test chạy qua trình duyệt thật (Playwright, nạp
// NGUYÊN VẸN public/index.html + public/js/core.js — không mock lại logic phân quyền) để gọi trực tiếp
// các hàm thật: hasModuleAccess()/canAccessOperationSubTab()/canAccessInternalSubTab()/
// canAccessTrainingLmsTab()/canAccessPaymentModule()/renderModuleAccessCheckboxes().
//
// Bao gồm:
//   A) LỖI ĐÃ VÁ (báo cáo người dùng gốc): cấp quyền "Công Việc" (EXECUTION, chỉ qua gán/chỉ định 1
//      công việc, KHÔNG có quyền quản lý hồ sơ rộng) / "Nghiệm Thu" (ACCEPTANCE) không còn kéo theo
//      thấy được tab "📊 Báo Cáo" (canAccessOperationSubTab 'REPORT' tách khỏi OR-logic của 'STORE').
//   B) Checkbox Mục 0 MỚI (vanHanhReport/vanHanhEstimate/vanHanhExecution/vanHanhAcceptance) là lớp gác
//      CỨNG — admin tắt riêng thì NGAY CẢ người có quyền quản lý hồ sơ rộng (operationRecordManageAll)
//      cũng không còn thấy tab đó.
//   C) hasModuleAccess() cascade đa tầng (generalize từ "chỉ 1 cấp cha" sang vòng lặp tổ tiên) — tắt
//      "internal" khoá luôn cả "internalTraining" LẪN 9 tab cháu LMS (trainingLmsDashboard/...).
//   D) canAccessPaymentModule()/canManagePaymentRequestsClient(): entry 'payment' MỚI trong
//      BUSINESS_MODULES — mặc định vẫn vào được (không ảnh hưởng ai), tắt riêng qua Mục 0 là chặn hẳn.
//   E) renderModuleAccessCheckboxes() đệ quy: cây render ra đủ checkbox ở MỌI tầng (không chỉ 2 tầng
//      cứng như bản cũ) — kiểm tra DOM thật có đủ id pModuleAccess_<key> cho 1 tab cháu sâu nhất.
//
// Chạy: node server/tests/test-muc0-module-access-tree.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual
} = require('./testHarness');

const PORT = 8989;

// Người chỉ được GÁN/CHỈ ĐỊNH trên 1 công việc cụ thể — KHÔNG giữ bất kỳ quyền quản lý hồ sơ rộng nào
// (operationStoreOpenCreate/operationRepairCreate/operationRecordManageAll/operationRecordViewAll/admin).
// Đây CHÍNH XÁC là người dùng user báo cáo: "được cấp quyền Công Việc/Nghiệm Thu lại thấy được cả Báo Cáo".
const ASSIGNEE_ONLY = { username: 'assignee1', name: 'NV Được Giao Việc', dept: 'Vận Hành', perms: {} };
const ACCEPTOR_ONLY = { username: 'acceptor1', name: 'NV Nghiệm Thu', dept: 'Vận Hành', perms: {} };
const FULL_MANAGER = { username: 'manager1', name: 'Quản Lý Vận Hành', dept: 'Vận Hành', perms: { operationRecordManageAll: true } };
const REPORT_VIEWER = { username: 'repviewer1', name: 'NV Xem Báo Cáo', dept: 'Vận Hành', perms: { operationStoreReportView: true } };

const WORK_ITEM = {
  id: 1, title: 'Việc test', sourceType: 'OPERATION_STORE_OPENING', sourceId: 1,
  parentWorkItemId: null, status: 'DANG_THUC_HIEN', deadline: '', startDate: '',
  assignedTo: ['assignee1'], assignedToName: ['NV Được Giao Việc'],
  acceptorUsername: 'acceptor1', acceptorName: 'NV Nghiệm Thu', history: []
};

async function loginAs(page, user) {
  await page.evaluate(async (u) => {
    window.__resetCapture();
    await proceedAfterAuth(u);
  }, user);
}

async function main() {
  const state = createMockState({
    depts: ['Vận Hành'],
    users: [ASSIGNEE_ONLY, ACCEPTOR_ONLY, FULL_MANAGER, REPORT_VIEWER],
    operationWorkItems: [WORK_ITEM]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await loginAs(page, ASSIGNEE_ONLY);
    await page.evaluate((items) => { DB.operationWorkItems = items; }, [WORK_ITEM]);

    await run.run('A) LỖI ĐÃ VÁ: người CHỈ được gán 1 công việc (EXECUTION) KHÔNG còn thấy tab Báo Cáo', async () => {
      const canSeeExecution = await page.evaluate((u) => canAccessOperationSubTab(u, 'EXECUTION'), ASSIGNEE_ONLY);
      assert(canSeeExecution, 'Vẫn phải thấy tab Công Việc (đúng thiết kế — người được gán việc)');
      const canSeeReport = await page.evaluate((u) => canAccessOperationSubTab(u, 'REPORT'), ASSIGNEE_ONLY);
      assert(!canSeeReport, 'KHÔNG được thấy tab Báo Cáo — đây chính là lỗi người dùng báo cáo');
    });

    await run.run('A) LỖI ĐÃ VÁ: người CHỈ là acceptor (ACCEPTANCE) 1 công việc cũng KHÔNG thấy tab Báo Cáo', async () => {
      const canSeeAcceptance = await page.evaluate((u) => canAccessOperationSubTab(u, 'ACCEPTANCE'), ACCEPTOR_ONLY);
      assert(canSeeAcceptance, 'Vẫn phải thấy tab Nghiệm Thu (đúng thiết kế — người được chỉ định nghiệm thu)');
      const canSeeReport = await page.evaluate((u) => canAccessOperationSubTab(u, 'REPORT'), ACCEPTOR_ONLY);
      assert(!canSeeReport, 'KHÔNG được thấy tab Báo Cáo');
    });

    await run.run('A) Đối chứng: quản lý CÓ operationRecordManageAll vẫn thấy đủ Báo Cáo (không chặn oan)', async () => {
      const canSeeReport = await page.evaluate((u) => canAccessOperationSubTab(u, 'REPORT'), FULL_MANAGER);
      assert(canSeeReport, 'Quản lý toàn quyền hồ sơ phải thấy Báo Cáo');
    });

    await run.run('A) Quyền operationStoreReportView riêng (không cần quyền quản lý) cũng thấy Báo Cáo', async () => {
      const canSeeReport = await page.evaluate((u) => canAccessOperationSubTab(u, 'REPORT'), REPORT_VIEWER);
      assert(canSeeReport, 'operationStoreReportView phải đủ để thấy Báo Cáo (checkbox đã có sẵn từ trước, nay mới được nối đúng)');
    });

    await run.run('B) Mục 0 hard-gate: tắt riêng vanHanhReport -> quản lý toàn quyền CŨNG không còn thấy Báo Cáo', async () => {
      const managerWithGateOff = { ...FULL_MANAGER, perms: { ...FULL_MANAGER.perms, moduleAccess: { vanHanhReport: false } } };
      const canSeeReport = await page.evaluate((u) => canAccessOperationSubTab(u, 'REPORT'), managerWithGateOff);
      assert(!canSeeReport, 'moduleAccess.vanHanhReport=false PHẢI chặn ngay cả operationRecordManageAll — đúng yêu cầu "có quyền ở module cũng không thấy"');
      // Tab khác (EXECUTION) KHÔNG bị ảnh hưởng — mỗi checkbox tab độc lập.
      const canSeeExecution = await page.evaluate((u) => canAccessOperationSubTab(u, 'EXECUTION'), managerWithGateOff);
      assert(canSeeExecution, 'Tắt riêng vanHanhReport KHÔNG được ảnh hưởng tới tab Công Việc khác');
    });

    await run.run('B) Mục 0 hard-gate: tắt vanHanh (module cha) -> cascade khoá luôn vanHanhReport', async () => {
      const managerParentOff = { ...FULL_MANAGER, perms: { ...FULL_MANAGER.perms, moduleAccess: { vanHanh: false } } };
      const canSeeReport = await page.evaluate((u) => canAccessOperationSubTab(u, 'REPORT'), managerParentOff);
      assert(!canSeeReport, 'Tắt module cha "vanHanh" phải khoá luôn tab con "vanHanhReport" (cascade)');
    });

    await run.run('C) hasModuleAccess() cascade đa tầng: tắt "internal" khoá luôn tab cháu LMS sâu nhất', async () => {
      const user = { username: 'u1', perms: { moduleAccess: { internal: false } } };
      const direct = await page.evaluate((u) => hasModuleAccess(u, 'internalTraining'), user);
      const grandchild = await page.evaluate((u) => hasModuleAccess(u, 'trainingLmsDashboard'), user);
      assert(!direct, 'internal=false phải khoá tab con internalTraining');
      assert(!grandchild, 'internal=false phải khoá CẢ tab cháu trainingLmsDashboard (3 tầng: internal -> internalTraining -> trainingLmsDashboard)');
    });

    await run.run('C) hasModuleAccess() cascade đa tầng: chỉ tắt "internalTraining" (không tắt internal) vẫn khoá tab cháu, KHÔNG ảnh hưởng tab con khác', async () => {
      const user = { username: 'u2', perms: { moduleAccess: { internalTraining: false } } };
      const grandchild = await page.evaluate((u) => hasModuleAccess(u, 'trainingLmsDashboard'), user);
      const siblingTab = await page.evaluate((u) => hasModuleAccess(u, 'internalNews'), user);
      assert(!grandchild, 'internalTraining=false phải khoá tab cháu trainingLmsDashboard');
      assert(siblingTab, 'Tắt internalTraining KHÔNG được ảnh hưởng tab con khác (internalNews)');
    });

    await run.run('C) canAccessTrainingLmsTab()/canAccessInternalSubTab(): wire đúng key cho từng tab', async () => {
      const userAllOpen = { username: 'u3', perms: {} };
      const allNews = await page.evaluate((u) => canAccessInternalSubTab(u, 'NEWS'), userAllOpen);
      assert(allNews, 'Mặc định (chưa cấu hình gì) mọi tab con phải mở — không ảnh hưởng hành vi hiện tại');
      const userNewsOff = { username: 'u4', perms: { moduleAccess: { internalNews: false } } };
      const newsOff = await page.evaluate((u) => canAccessInternalSubTab(u, 'NEWS'), userNewsOff);
      const shareStillOn = await page.evaluate((u) => canAccessInternalSubTab(u, 'SHARE'), userNewsOff);
      assert(!newsOff, 'internalNews=false phải chặn tab NEWS');
      assert(shareStillOn, 'Tắt riêng NEWS không ảnh hưởng tab SHARE');
      const userTestsOff = { username: 'u5', perms: { moduleAccess: { trainingLmsTests: false } } };
      const testsOff = await page.evaluate((u) => canAccessTrainingLmsTab(u, 'TESTS'), userTestsOff);
      assert(!testsOff, 'trainingLmsTests=false phải chặn đúng tab TESTS');
    });

    await run.run('D) canAccessPaymentModule(): entry "payment" MỚI mặc định mở (không ảnh hưởng ai)', async () => {
      const userDefault = { username: 'pay1', perms: { paymentManage: true } };
      const can = await page.evaluate((u) => { DB.paymentDeptWorkflows = {}; DB.paymentRequests = []; return canAccessPaymentModule(u); }, userDefault);
      assert(can, 'paymentManage vẫn phải vào được module Thanh Toán như trước (mặc định mở)');
    });

    await run.run('D) canAccessPaymentModule(): admin tắt riêng moduleAccess.payment -> chặn hẳn dù có paymentManage', async () => {
      const userBlocked = { username: 'pay2', perms: { paymentManage: true, moduleAccess: { payment: false } } };
      const can = await page.evaluate((u) => { DB.paymentDeptWorkflows = {}; DB.paymentRequests = []; return canAccessPaymentModule(u); }, userBlocked);
      assert(!can, 'moduleAccess.payment=false phải chặn hẳn, kể cả có paymentManage — đúng yêu cầu "có quyền ở module cũng không thấy"');
    });

    await run.run('D) canManagePaymentRequestsClient(): giữ ĐÚNG cùng điều kiện với canAccessPaymentModule()', async () => {
      const userBlocked = { username: 'pay3', perms: { paymentManage: true, moduleAccess: { payment: false } } };
      const can = await page.evaluate((u) => canManagePaymentRequestsClient(u), userBlocked);
      assert(!can, 'canManagePaymentRequestsClient() cũng phải bị chặn — tránh thẻ Approval Hub vẫn lộ ra');
    });

    await run.run('E) renderModuleAccessCheckboxes() đệ quy: DOM thật dựng đủ checkbox tới tab cháu sâu nhất', async () => {
      const ids = await page.evaluate(() => {
        const el = document.createElement('div');
        el.id = '__muc0TestContainer';
        document.body.appendChild(el);
        renderModuleAccessCheckboxes('__muc0TestContainer', 'tModuleAccess');
        const found = {
          module: !!document.getElementById('tModuleAccess_internal'),
          tabCon: !!document.getElementById('tModuleAccess_internalTraining'),
          tabChau: !!document.getElementById('tModuleAccess_trainingLmsDashboard'),
          vanHanhReport: !!document.getElementById('tModuleAccess_vanHanhReport'),
          payment: !!document.getElementById('tModuleAccess_payment')
        };
        el.remove();
        return found;
      });
      assert(ids.module, 'Phải có checkbox module gốc "internal"');
      assert(ids.tabCon, 'Phải có checkbox tab con "internalTraining" (cấp 2)');
      assert(ids.tabChau, 'Phải có checkbox tab cháu "trainingLmsDashboard" (cấp 3) — TRƯỚC ĐÂY bản render cũ CHỈ vẽ 2 tầng, cấp 3 sẽ hoàn toàn vắng mặt nếu bug tái diễn');
      assert(ids.vanHanhReport, 'Phải có checkbox "vanHanhReport" (fix trực tiếp lỗi Vận Hành)');
      assert(ids.payment, 'Phải có checkbox "payment" (module trước đây vắng mặt khỏi Mục 0)');
    });

  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
