// tests/test-lazy-load-all-tabs.js — Ha tang: nap module theo cum (lazy load), dot 7.
//
// Muc dich: xac nhan TOAN BO 39 file public/js/*.js (5 core*.js luon nap san + 34 module-*.js nap LUOI
// theo cum) hoat dong dung khi duyet qua MOI tab/sub-tab dieu huong that trong sidebar bang CLICK THAT
// (khong goi thang ham qua page.evaluate() nhu da so cac bai test khac trong thu muc nay) - day la bai
// test DUY NHAT trong bo nay kiem chung dung co che nap luoi + dieu huong that, khong phai nghiep vu.
//
// Kiem tra:
//   1. Click qua TAT CA ~35 diem dieu huong sidebar (tab cap 1 + moi sub-tab) trong 1 phien Chromium duy
//      nhat, theo dung thu tu 1 nguoi dung that se bam (mo dropdown cha truoc neu can) - khong co loi JS
//      nao phat sinh (page.on('pageerror')) VA section tuong ung THAT SU hien ra + co noi dung (khong
//      con trang trang/rong).
//   2. Idempotent: mo lai 1 tab DA tung mo trong CHINH phien nay khong nap lai file /js/module-*.js lan
//      2 (theo doi qua page.on('request')).
//   3. Nhay xuyen cum (cross-cluster jump) THAT: Approval Hub (core, luon nap san) -> gotoApprovalHubOrigin()
//      nhay sang 1 module CHUA TUNG mo trong phien (vd "budget", cum "itsupport-tier" chua nap) - phai tu
//      dong nap dung cum roi render dung, khong ReferenceError/mang trang.
const path = require('path');
const http = require('http');
const fs = require('fs');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.svg': 'image/svg+xml'
  }[ext] || 'application/octet-stream';
}
function startStaticServer(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
        res.writeHead(200, { 'Content-Type': contentType(filePath) });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

async function main() {
  const PORT = 9400 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (/Failed to load resource/i.test(text)) return; // benign (favicon/manifest/sw.js 404 in this harness)
      pageErrors.push('console.error: ' + text);
    }
  });

  const jsRequests = [];
  page.on('request', (req) => {
    const u = req.url();
    const m = /\/js\/(module-[^?]+\.js)/.exec(u);
    if (m) jsRequests.push(m[1]);
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  // Stub network + seed 1 admin user voi day du DB.* de moi module render duoc ma khong crash vi thieu
  // collection (perms.admin=true -> moi nav item + moi nhanh quyen deu mo, dam bao THAT SU duyet het).
  const setup = await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.prompt = () => '';
    // GET tra ve mang rong hop le (khong lam vo cac tinh nang "tai them du lieu nen" khi mo tab, vd
    // loadSystemLogs()/loadTrashItems() - von KHONG lien quan gi toi lazy-load, tach test nay khoi
    // nhieu nhieu khong can thiet); POST/PUT/PATCH/DELETE van tra 404 (khong tao/sua du lieu that trong
    // bai test nay, chi thuan dieu huong).
    window.fetch = async (url, opts) => {
      const method = ((opts && opts.method) || 'GET').toUpperCase();
      if (method === 'GET') return { ok: true, status: 200, json: async () => ([]), blob: async () => new Blob([]) };
      return { ok: false, status: 404, json: async () => ({ error: 'not found (test stub)' }) };
    };

    Object.assign(DB, {
      depts: ['Phòng CNTT', 'Phòng Kế Toán'], stores: ['Siêu Thị Quận 1'], cats: ['Chung'],
      deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: ['Nhân viên'], storeJobTitles: [], submissionTypes: [], contractTypes: [], carTypes: [],
      uniformCatalog: [], itTicketCategories: [],
      // "workflows" KHÔNG được để rỗng — mọi màn hình đọc DB.workflows đều giả định LUÔN có ít nhất 1
      // mẫu quy trình mặc định (đúng seed thật ở defaults.js, WF_1STEP) để rơi về khi 1 phòng ban chưa
      // được cấu hình workflowId riêng (xem `DB.workflows.find(...) || DB.workflows[0]` rải khắp các
      // renderXWorkflowTab()) — để rỗng khiến renderWorkflowTab() (Hệ Thống > Quy Trình & Phê Duyệt)
      // throw "Cannot read properties of undefined (reading 'steps')" ngay khi thật sự render (trước đây
      // bài test này chưa từng thật sự click tới "Hệ Thống > Quản Trị" xong rồi mới qua "Quy Trình & Phê
      // Duyệt" bằng click DOM thật, nên lỗ hổng seed này chưa lộ ra).
      workflows: [{ id: 'WF_1STEP', name: 'Quy trình 1 bước (Sếp duyệt)', steps: [{ order: 1, name: 'Phê duyệt 1' }] }],
      deptWorkflows: {},
      docs: [], submissions: [], submissionDeptWorkflows: {}, submissionTypeDeptWorkflows: {}, submissionApprovalGroups: {},
      contracts: [], contractApprovalGroups: {}, contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
      meetings: [], meetingMinutes: [], meetingAttendeeTemplates: [],
      carRegs: [], carDeptWorkflows: {},
      officeReqs: [], officeBuyDeptWorkflows: {}, officeFixDeptWorkflows: {},
      tasks: [], internalPosts: [], internalNewsCategories: [], internalShareCategories: [],
      trainingCategories: [], trainingDocuments: [], trainingClasses: [], trainingRegistrations: [],
      careerPaths: [], careerPathConfirmations: [], trainingTests: [], trainingTestSubmissions: [],
      trainingCourses: [], trainingPlans: [], onboardingPaths: [], onboardingProgress: [],
      recruitmentJobs: [], recruitmentReferrals: [], hrFeedback: [], sensitiveKeywords: [],
      paymentRequests: [], formTemplates: {}, permGroups: [], users: [],
      vppExcludeGroups: [], vppExcludedJobTitles: [], workflowParticipatingDepts: [],
      pwaShortcutModules: [], itPriceMasterLists: [], itPriceDeptWorkflows: {}, itPriceTierWorkflows: {},
      uploadFileTypeConfig: {}, uploadSizeLimitConfig: {}, emailConfig: {}, systemLogs: [], externalApiKeys: [],
      vppRegistrations: [], vppDeptWorkflows: {}, vppPeriods: [], itPriceApprovals: [], itServiceRenewals: [], itSupportTickets: [],
      budgetEntries: [], budgetDeptWorkflows: {}, budgetTemplates: [], budgetPeriods: [],
      reportPeriods: [], reportEntries: [], licenses: [], licenseTypes: [],
      operationOrders: [], operationOrderDeptWorkflows: {},
      operationStoreOpenings: [], operationStoreOpenDeptWorkflows: {}, operationStoreOpenEstimateDeptWorkflows: {},
      operationRepairs: [], operationRepairDeptWorkflows: {}, operationRepairEstimateDeptWorkflows: {},
      operationWorkItems: [], operationExecutionPeriods: [], orgChartManagerOverrides: {},
      _versions: {}
    });

    const adminUser = {
      id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', jobTitle: 'Nhân viên',
      email: 'admin@test.local', phone: '0900000000', perms: { admin: true }, groupIds: [], permOverrides: null
    };
    DB.users.push(adminUser);
    finishLogin(adminUser);
    return {
      loginOk: document.getElementById('loginSection').classList.contains('hidden'),
      headerShown: !document.getElementById('userHeader').classList.contains('hidden')
    };
  });
  record('setup: finishLogin(admin) with seeded DB.* shows the main app with no crash', setup.loginOk && setup.headerShown, JSON.stringify(setup));

  // ---- Danh sach DIEU HUONG THAT: {label, dropdownToggleId?, clickSelector, sectionId, tabName} ----
  // dropdownToggleId: nut cha phai mo truoc (dropdown) - bo qua neu diem den la nut sidebar cap 1 truc tiep.
  const NAV_POINTS = [
    { label: 'Trang chủ (Dashboard)', click: '[data-op="switchTab"][data-arg0="dashboard"]', section: 'dashboardSection' },
    { label: 'Phê Duyệt (Approval Hub)', click: '[data-op="switchTab"][data-arg0="approvalHub"]', section: 'approvalHubSection' },
    { label: 'Tài liệu', click: '[data-op="switchTab"][data-arg0="doc"]', section: 'docSection' },
    { label: 'Văn bản trình', click: '[data-op="switchTab"][data-arg0="submission"]', section: 'submissionSection' },
    { label: 'Báo cáo Quản trị', click: '[data-op="switchTab"][data-arg0="reports"]', section: 'reportsSection' },
    { label: 'Nhân Sự > Quản Lý &amp; Phản Hồi Ý Kiến', toggle: '#btnHrTab', click: '#btnHrFeedbackNav', section: 'hrSection' },
    { label: 'Nhân Sự > Cơ Cấu Tổ Chức', toggle: '#btnHrTab', click: '#btnOrgChartNav', section: 'orgChartSection' },

    { label: 'Truyền Thông > Nhịp Sống HCRC', toggle: '#btnInternalTab', click: 'button[data-op-seq*="setInternalSubTab(NEWS)"]', section: 'internalSection' },
    { label: 'Truyền Thông > Đào Tạo', toggle: '#btnInternalTab', click: 'button[data-op-seq*="setInternalSubTab(TRAINING)"]', section: 'internalSection' },
    { label: 'Truyền Thông > Tuyển Dụng', toggle: '#btnInternalTab', click: 'button[data-op-seq*="setInternalSubTab(RECRUITMENT)"]', section: 'internalSection' },
    { label: 'Truyền Thông > Góc Chia Sẻ', toggle: '#btnInternalTab', click: 'button[data-op-seq*="setInternalSubTab(SHARE)"]', section: 'internalSection' },
    { label: 'Truyền Thông > HCRC Đồng Hành', toggle: '#btnInternalTab', click: 'button[data-op-seq*="setInternalSubTab(QNA)"]', section: 'internalSection' },

    { label: 'Hợp Đồng > Phê Duyệt', toggle: '#btnHopDongTab', click: 'button[data-op-seq*="setContractSubTab(APPROVAL)"]', section: 'contractSection' },
    { label: 'Hợp Đồng > Quản Lý HĐ & Giấy Phép', toggle: '#btnHopDongTab', click: 'button[data-op-seq*="setContractSubTab(MANAGE)"]', section: 'contractSection' },

    { label: 'Điều Hành > Biên bản họp', toggle: '#btnDieuHanhTab', click: '#btnMinutesTab', section: 'minutesSection' },
    { label: 'Điều Hành > Công việc', toggle: '#btnDieuHanhTab', click: '#btnTaskTab', section: 'taskSection' },
    { label: 'Điều Hành > Báo Cáo Định Kỳ', toggle: '#btnDieuHanhTab', click: '#btnPeriodicReportTab', section: 'periodicReportSection' },

    { label: 'Hành Chính > Phòng họp', toggle: '#btnHanhChinhTab', click: '#btnMeetingTab', section: 'meetingSection' },
    { label: 'Hành Chính > Đăng ký xe', toggle: '#btnHanhChinhTab', click: '#btnCarTab', section: 'carSection' },
    { label: 'Hành Chính > Văn phòng phẩm', toggle: '#btnHanhChinhTab', click: '#btnVppTab', section: 'vppSection' },
    { label: 'Hành Chính > Đồng phục', toggle: '#btnHanhChinhTab', click: '#btnUniformTab', section: 'uniformSection' },
    { label: 'Hành Chính > Giấy phép', toggle: '#btnHanhChinhTab', click: '#btnLicenseTab', section: 'licenseSection' },

    { label: 'Tổng Hợp > Mua Bán', toggle: '#btnTongHopTab', click: '#btnOfficeSubBuyNav', section: 'officeSection' },
    { label: 'Tổng Hợp > Sửa Chữa', toggle: '#btnTongHopTab', click: '#btnOfficeSubFixNav', section: 'officeSection' },
    { label: 'Tổng Hợp > Thanh Toán', toggle: '#btnTongHopTab', click: '#btnOfficeSubPaymentNav', section: 'officeSection' },
    { label: 'Tổng Hợp > Ngân Sách', toggle: '#btnTongHopTab', click: '#btnBudgetNav', section: 'budgetSection' },

    { label: 'Vận Hành > Phê Duyệt Đơn Hàng', toggle: '#btnVanHanhTab', click: '#btnOperationOrderNav', section: 'vanHanhSection' },
    { label: 'Vận Hành > Siêu Thị', toggle: '#btnVanHanhTab', click: '#btnOperationStoreNav', section: 'vanHanhSection' },

    { label: 'Hỗ Trợ IT > Phê Duyệt Giá', toggle: '#btnItSupportTab', click: 'button[data-op-seq*="setItSupportSubTab(PRICE)"]', section: 'itSupportSection' },
    { label: 'Hỗ Trợ IT > Hỗ Trợ Yêu Cầu', toggle: '#btnItSupportTab', click: 'button[data-op-seq*="setItSupportSubTab(TICKET)"]', section: 'itSupportSection' },
    { label: 'Hỗ Trợ IT > Gia Hạn Dịch Vụ', toggle: '#btnItSupportTab', click: '#btnItSupportNavRenewal', section: 'itSupportSection' },

    { label: 'Hệ Thống > Quản Trị', toggle: '#btnSystemTab', click: 'button[data-op-seq*="setSystemSubTab(ADMIN)"]', section: 'systemSection' },
    { label: 'Hệ Thống > Biểu Mẫu', toggle: '#btnSystemTab', click: 'button[data-op-seq*="setSystemSubTab(FORM)"]', section: 'systemSection' },
    { label: 'Hệ Thống > Quy Trình & Phê Duyệt', toggle: '#btnSystemTab', click: 'button[data-op-seq*="setSystemSubTab(WORKFLOW)"]', section: 'systemSection' },
    { label: 'Hệ Thống > Quản Lý Tệp File', toggle: '#btnSystemTab', click: 'button[data-op-seq*="setSystemSubTab(UPLOAD)"]', section: 'systemSection' },
    { label: 'Hệ Thống > Log', toggle: '#btnSystemTab', click: 'button[data-op-seq*="setSystemSubTab(LOG)"]', section: 'systemSection' }
  ];

  for (const point of NAV_POINTS) {
    const errCountBefore = pageErrors.length;
    if (point.toggle) {
      await page.click(point.toggle, { force: true });
    }
    // Dùng .click() DOM THẬT qua evaluate (không phải page.click() toạ độ chuột của Playwright) — bài
    // test này chỉ kiểm tra đúng handler data-op/data-op-seq có chạy hay không (bubbling sự kiện click),
    // không kiểm tra vị trí/hiển thị thật trên màn hình, nên không cần đúng điểm ảnh. page.click(...,
    // {force:true}) tính theo TOẠ ĐỘ giữa bounding box: khi sidebar <nav> liệt kê ~14 mục cấp 1, dropdown
    // MỞ RA (đặc biệt "Hệ Thống", mục cuối) có thể đẩy mục con xuống dưới mép viewport mặc định (720px)
    // tuỳ thứ tự/số dòng phía trên nó tại đúng thời điểm click — phát hiện qua bài test hồi quy khi dời
    // "Báo Cáo" xuống cạnh "Hệ Thống" khiến "Hệ Thống > Quản Trị" click trượt ra ngoài khung nhìn (không
    // lỗi JS nào cả, elementFromPoint() ở toạ độ đó chỉ đơn giản trả về null) dù phần tử vẫn tồn tại/hiển
    // thị đúng trong DOM. .click() DOM thật không phụ thuộc vị trí/scroll nên tránh hẳn lớp lỗi này.
    await page.evaluate((sel) => document.querySelector(sel)?.click(), point.click);
    await page.waitForTimeout(120); // cho nhip lazy-load (loadModuleGroup async) + render kip xong
    const hidden = await page.evaluate((id) => {
      const el = document.getElementById(id);
      return !el || el.classList.contains('hidden');
    }, point.section);
    const newErrors = pageErrors.slice(errCountBefore);
    record(`nav: ${point.label} -> #${point.section} hiện ra, không lỗi JS`, !hidden && newErrors.length === 0,
      newErrors.length ? newErrors.join(' | ') : `#${point.section} vẫn ẩn`);
  }

  record('Tổng kết: không có bất kỳ lỗi JS/console.error nào tích lũy suốt toàn bộ vòng duyệt tab',
    pageErrors.length === 0, pageErrors.join(' | '));

  // ---- Idempotency: mo lai "Tài liệu" (da mo o vong tren) lan 2, khong duoc nap lai module-tailieu.js ----
  const reqCountBefore = jsRequests.filter(f => f === 'module-tailieu.js').length;
  await page.click('[data-op="switchTab"][data-arg0="doc"]', { force: true });
  await page.waitForTimeout(150);
  const reqCountAfter = jsRequests.filter(f => f === 'module-tailieu.js').length;
  record('Idempotent: mở lại tab "Tài liệu" lần 2 KHÔNG tải lại module-tailieu.js qua mạng',
    reqCountAfter === reqCountBefore, `trước=${reqCountBefore} sau=${reqCountAfter} (tất cả request /js/module-*.js: ${jsRequests.join(', ')})`);

  // ---- Cross-cluster jump THAT: goto tu Approval Hub sang 1 module (budget/'itsupport-tier') co the DA
  // duoc nap o vong duyet tren (qua "Tổng Hợp > Ngân Sách") - kiem tra lai bang cach goi truc tiep
  // gotoApprovalHubOrigin('budget') MOT LAN NUA (idempotent, van phai render dung, khong throw) VA -
  // quan trong hon - kiem tra 1 cum THAT SU CHUA TUNG duoc nap trong ca phien (itsupport-renewal chi nap
  // qua deps cua itsupport-price, da nap roi qua vong tren -> doi tuong khac: dung lai kiem tra ham
  // renderWordProtected/renderExcelProtected (cum "internalcomms-daotao-viewer") CHUA CHAC da duoc goi
  // banh -- kiem tra truc tiep qua ensureFnReady() tu goc, mo phong dung tinh huong "nhay xuyen cum".
  const crossClusterResult = await page.evaluate(async () => {
    const before = typeof window.renderWordProtected;
    try {
      await ensureFnReady('renderWordProtected');
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
    return { ok: true, before, after: typeof window.renderWordProtected };
  });
  record('Cross-cluster jump: ensureFnReady("renderWordProtected") tự nạp đúng cụm "internalcomms-daotao-viewer" và hàm sẵn sàng sau đó',
    crossClusterResult.ok && crossClusterResult.after === 'function', JSON.stringify(crossClusterResult));

  // ---- gotoApprovalHubOrigin(): nhay tu Approval Hub (core, luon san) sang 1 tab/sub-tab CU THE, dung
  // await switchTab() ben trong (Ha tang, dot 7) - goi thang qua page.evaluate() (ham nay khong gan nut
  // that trong DOM neu khong co du lieu hop pending that, nen goi truc tiep la cach kiem chung dung nhat).
  const jumpResult = await page.evaluate(async () => {
    document.getElementById('approvalHubFilterStatus').value = 'APPROVED';
    await gotoApprovalHubOrigin('itPrice');
    return {
      itSupportVisible: !document.getElementById('itSupportSection').classList.contains('hidden'),
      hasRenderFn: typeof renderItPriceApprovals === 'function' || typeof setItSupportSubTab === 'function'
    };
  });
  record('gotoApprovalHubOrigin("itPrice") điều hướng đúng + render tab Hỗ Trợ IT không lỗi',
    jumpResult.itSupportVisible && jumpResult.hasRenderFn, JSON.stringify(jumpResult));

  record('Không có lỗi JS/console.error nào phát sinh trong toàn bộ bài test (kể cả các bước sau vòng duyệt tab)',
    pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  await new Promise((resolve) => server.close(resolve));

  const passCount = results.filter((r) => r.pass).length;
  console.log(`\n${passCount}/${results.length} scenarios passed.`);
  if (passCount !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
