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
//   F) LỖI ĐÃ VÁ (phát hiện khi chụp ảnh demo, cùng đợt): setOperationStoreSubTab() (module-vanhanh.js)
//      TRƯỚC ĐÂY ghi đè toàn bộ className của nút tab con — XOÁ MẤT class "hidden" mà
//      updateOperationStoreSubTabVisibility() vừa tick ngay trước đó trong setVanHanhSubTab('STORE') —
//      khiến TOÀN BỘ gác quyền ở mục A/B phía trên vô hiệu hoá ngay khi người dùng thực sự bấm vào tab
//      "🏬 Siêu Thị" trên giao diện thật (dù hàm canAccessOperationSubTab() tính đúng). Test DOM thật,
//      qua đúng luồng người dùng bấm (switchTab -> setVanHanhSubTab('STORE')), không gọi tắt hàm con.
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

// ===== Fixture cho 3 LỖI ĐÃ VÁ ở mục G/H/I (phát hiện 11/2026, demo "menu ẩn nhưng vẫn xem được") =====
// G) setOperationStoreSubTab('ESTIMATE') từng vẽ đủ dữ liệu ngân sách dù checkbox "vanHanhEstimate" đã
// bị tắt riêng (xem demo.js ở scratchpad đợt vá — RECORD_G mirror ĐÚNG shape record đã dùng để demo lỗi
// thật cho người dùng, 2 field approvedBudget/estimateTotalAmount là dữ liệu "nhạy cảm" bị lộ).
const ESTIMATE_BLOCKED_VIEWER = {
  username: 'opviewer_g', name: 'NV Xem Dự Toán Bị Chặn', dept: 'Vận Hành',
  perms: { operationRecordViewAll: true, moduleAccess: { vanHanhEstimate: false } }
};
const RECORD_G = {
  id: 9201, code: 'MMST-9201', storeName: 'Siêu Thị Quận 1', dept: 'Siêu thị A', creator: 'giamdoc_a',
  status: 'APPROVED', estimateStatus: 'APPROVED', approvedBudget: 850000000, estimateTotalAmount: 812000000,
  estimateItems: [], history: []
};
// H) switchTab('itSupport') từng thiếu hẳn khối chặn (bất kỳ ai gọi tay cũng vào được), VÀ
// setItSupportSubTab() từng giữ nguyên subTab bị cấm (không fallback null) khi cả 3 checkbox con đều
// tắt — khiến renderItPriceApprovals() vẫn chạy dù module cha "itSupport" đã bị khoá hẳn.
// Giữ module cha "itSupport" MỞ (mặc định, không set false) — mục đích CHỈ bắt lỗi resolver
// setItSupportSubTab() tự nó (không nhờ guard switchTab() chặn hộ), đúng khuôn "stuck-fallback" (xem
// resolveAccessibleInternalSubTab() cùng đợt vá). Guard switchTab('itSupport') (Gap 1) đã có test riêng
// implicit qua việc hàm KHÔNG bị block ở đây dù gọi switchTab('itSupport') trực tiếp.
const ITSUPPORT_BLOCKED_USER = {
  username: 'itviewer_h', name: 'NV Bị Khoá Hỗ Trợ IT', dept: 'Vận Hành',
  perms: { moduleAccess: { itSupportPrice: false, itSupportTicket: false, itSupportRenewal: false } }
};
const ITPRICE_RECORD_H = {
  id: 9301, code: 'BL-9301', priceType: 'RETAIL', status: 'PENDING', creator: 'nv_h',
  productName: 'MAT HANG BI KHOA H', history: []
};
// I) resolveAccessibleInternalSubTab() từng giữ nguyên subTab bị cấm (`|| subTab`) khi cả 5 checkbox
// con (internalNews/internalTraining/internalRecruitment/internalShare/internalQna) đều tắt.
const INTERNAL_BLOCKED_USER = {
  username: 'internalviewer_i', name: 'NV Bị Khoá Truyền Thông', dept: 'Vận Hành',
  perms: { moduleAccess: { internalNews: false, internalTraining: false, internalRecruitment: false, internalShare: false, internalQna: false } }
};
const INTERNAL_POST_I = {
  id: 9401, type: 'NEWS', title: 'TIN BI KHOA I', content: 'noi dung', creator: 'nv_i', createdAt: new Date().toISOString(), likes: [], comments: [], seenBy: []
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
    users: [ASSIGNEE_ONLY, ACCEPTOR_ONLY, FULL_MANAGER, REPORT_VIEWER, ESTIMATE_BLOCKED_VIEWER, ITSUPPORT_BLOCKED_USER, INTERNAL_BLOCKED_USER],
    operationWorkItems: [WORK_ITEM],
    operationStoreOpenings: [RECORD_G],
    itPriceApprovals: [ITPRICE_RECORD_H],
    internalPosts: [INTERNAL_POST_I]
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

    await run.run('F) LỖI ĐÃ VÁ: setOperationStoreSubTab() không còn xoá mất class "hidden" của nút Báo Cáo', async () => {
      // Đúng luồng người dùng thật: đăng nhập (chưa có quyền quản lý rộng/giao việc gì) -> bấm vào tab
      // "Vận Hành" -> bấm vào tab con "🏬 Siêu Thị" — KHÔNG gọi tắt canAccessOperationSubTab()/
      // updateOperationStoreSubTabVisibility() trực tiếp, để bắt đúng lỗi "tính đúng nhưng DOM sai".
      const noAccessUser = { username: 'novhstore', name: 'NV Không Liên Quan', dept: 'Vận Hành', perms: {} };
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, noAccessUser);
      await page.evaluate(() => { switchTab('vanHanh'); });
      await page.evaluate(() => { setVanHanhSubTab('STORE'); });
      const hiddenAfter = await page.evaluate(() => document.getElementById('btnOpStoreSubReport').className.includes('hidden'));
      assert(hiddenAfter, 'Nút "📊 Báo Cáo" PHẢI còn ẩn SAU KHI bấm vào tab con "Siêu Thị" — trước fix, setOperationStoreSubTab() ghi đè mất class "hidden" ngay bước này, khiến nút hiện ra dù không ai có quyền.');
    });

    await run.run('G) LỖI ĐÃ VÁ: setOperationStoreSubTab("ESTIMATE") không còn vẽ dữ liệu ngân sách khi "vanHanhEstimate" bị tắt', async () => {
      // Đúng luồng người dùng thật (không gọi tắt canAccessOperationSubTab()): bấm Vận Hành -> Siêu Thị
      // -> (giả lập bấm "🔍 Xem"/mở đề xuất) gọi setOperationStoreSubTab('ESTIMATE') — đây CHÍNH XÁC là
      // hàm demo đã chứng minh lộ dữ liệu ngân sách của 2 hồ sơ khác phòng ban cho người dùng xác nhận.
      await loginAs(page, ESTIMATE_BLOCKED_VIEWER);
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); });
      const btnHidden = await page.evaluate(() => document.getElementById('btnOpStoreSubEstimate').className.includes('hidden'));
      assert(btnHidden, 'Nút "📂 Dự Toán" phải ẩn (operationRecordViewAll không ghi đè được checkbox Mục 0 "vanHanhEstimate" đã tắt riêng)');
      await page.evaluate(() => { setOperationStoreSubTab('ESTIMATE'); });
      const leaked = await page.evaluate(() => {
        const tbody = document.getElementById('operationEstimateTableBody');
        return { rowCount: tbody ? tbody.querySelectorAll('tr').length : -1, text: tbody ? tbody.innerText : '' };
      });
      assertEqual(leaked.rowCount, 0, `Bảng Dự Toán PHẢI rỗng (0 dòng) khi gọi setOperationStoreSubTab("ESTIMATE") sau khi tắt "vanHanhEstimate" — TRƯỚC ĐÂY vẫn vẽ đủ dữ liệu ngân sách hồ sơ MMST-9201 dù nút điều hướng đã ẩn đúng (lỗi thật đã demo cho người dùng). Nội dung bảng hiện tại: ${leaked.text}`);
      assert(!leaked.text.includes('MMST-9201'), 'Nội dung bảng Dự Toán KHÔNG được chứa mã hồ sơ đã bị khoá quyền xem (MMST-9201)');
    });

    await run.run('H) LỖI ĐÃ VÁ: setItSupportSubTab() không còn kẹt ở tab đã bị khoá khi tắt hết 3 checkbox con', async () => {
      // Module cha "itSupport" vẫn MỞ (không bị chặn bởi guard switchTab('itSupport') mới thêm) — bắt
      // đúng lỗi NẰM TRONG resolver của setItSupportSubTab() (trước đây `fallback ? fallback[0] : subTab`
      // giữ nguyên tab PRICE bị cấm khi cả 3 sibling đều false, vẫn gọi renderItPriceApprovals()).
      await loginAs(page, ITSUPPORT_BLOCKED_USER);
      await page.evaluate(() => { switchTab('itSupport'); });
      const alerts = await page.evaluate(() => window.__alerts || []);
      assertEqual(alerts.length, 0, `switchTab("itSupport") KHÔNG được chặn bằng alert ở kịch bản này (module cha vẫn mở, chỉ 3 tab con bị tắt) — alerts: ${JSON.stringify(alerts)}`);
      const state = await page.evaluate(() => {
        const sentinel = '__SENTINEL_H__';
        document.getElementById('itPriceTableBody').innerHTML = `<tr><td>${sentinel}</td></tr>`;
        setItSupportSubTab('PRICE');
        const tbody = document.getElementById('itPriceTableBody');
        return {
          activeTab: activeItSupportSubTab,
          priceWrapHidden: document.getElementById('itSubPrice').classList.contains('hidden'),
          sentinelStillThere: tbody.innerHTML.includes(sentinel)
        };
      });
      assertEqual(state.activeTab, null, `activeItSupportSubTab PHẢI là null khi cả 3 checkbox con đều bị tắt — TRƯỚC ĐÂY giữ nguyên "PRICE" (fallback về subTab cũ) khiến nhánh render bên dưới vẫn chạy. Giá trị thực tế: ${state.activeTab}`);
      assert(state.priceWrapHidden, 'Khung "🏷️ Phê Duyệt Giá" phải ẩn khi không còn sub-tab nào được phép');
      assert(state.sentinelStillThere, 'renderItPriceApprovals() KHÔNG được gọi lại (nội dung sentinel test phải còn nguyên) — TRƯỚC ĐÂY vẫn gọi render dù subTab đã bị khoá, nạp đè lên bằng dữ liệu hồ sơ BL-9301 thật.');
    });

    await run.run('I) LỖI ĐÃ VÁ: resolveAccessibleInternalSubTab() không còn kẹt ở tab đã bị khoá khi tắt hết 5 checkbox con', async () => {
      await loginAs(page, INTERNAL_BLOCKED_USER);
      await page.evaluate(() => { switchTab('internal'); });
      const state = await page.evaluate(() => {
        setInternalSubTab('NEWS');
        const container = document.getElementById('internalPostsContainer');
        return { activeSubTab: activeInternalSubTab, containerText: container ? container.innerText : '' };
      });
      assertEqual(state.activeSubTab, null, `activeInternalSubTab PHẢI là null khi cả 5 checkbox con (NEWS/TRAINING/RECRUITMENT/SHARE/QNA) đều bị tắt — TRƯỚC ĐÂY giữ nguyên "NEWS" (\`|| subTab\`), khiến renderInternalPosts() vẫn vẽ bài đăng thuộc tab đã khoá. Giá trị thực tế: ${state.activeSubTab}`);
      assert(!state.containerText.includes('TIN BI KHOA I'), 'Nội dung khu vực bài đăng KHÔNG được chứa tiêu đề bài đăng đã bị khoá quyền xem (TIN BI KHOA I)');
    });

  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
