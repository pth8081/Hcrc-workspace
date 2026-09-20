'use strict';
// server/tests/test-mixed-approval-delete-warning-ui.js
//
// 3 PHÁT HIỆN ĐÃ VÁ (đợt audit chuyên sâu 12 cụm) ở phía CLIENT của "🏬 Quy Trình Đặt Hàng Siêu Thị":
//  1. (mức Trung bình) Xoá 1 dòng cấu hình KHÔNG cảnh báo gì khi đó là dòng CUỐI CÙNG của 1 bước —
//     bước đó lập tức không còn ai duyệt (đơn treo, chỉ admin duyệt được) mà admin không hay; cũng không
//     cảnh báo khi xoá dòng MẶC ĐỊNH duy nhất (chỉ còn dòng ngoại lệ -> siêu thị ngoài danh sách khai
//     mất người duyệt). Kèm "xem trước số người khớp" mỗi dòng trên bảng (0 người = cấu hình chết).
//  2. (mức Cao) resolveOperationOrderStoreMixedApprovalRuleUsernamesClient() thiếu lọc tài khoản đã
//     khoá/nghỉ việc (u.active === false) — mirror bản vá phía server (lib/workflowEngine.js).
//  3. (mức Trung bình) resolveOperationOrderWorkflowConfigForItemClient() trả null khi MỨC giá trị chưa
//     được cấu hình mẫu quy trình, trong khi server vẫn dựng WF mặc định 1 bước rồi tra người duyệt từ
//     Quy Trình Đặt Hàng Siêu Thị -> người duyệt hợp lệ không thấy nút "Xử lý / Duyệt", đơn "tàng hình"
//     với chính người được quyền duyệt nó.
//
// Cùng hạ tầng với tests/test-mixed-approval-jobtitle-mix.js: serve public/index.html tĩnh, mở Chromium
// (Playwright) thật, KHÔNG cần backend/DB thật.
//
// Chạy: node server/tests/test-mixed-approval-delete-warning-ui.js

const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8971;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let results;
  const jsErrors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => jsErrors.push(String(e)));

    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
    await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

    results = await page.evaluate(async () => {
      const results = [];
      function check(name, cond, detail) { results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') }); }

      // Không có backend thật — chặn mọi lượt ghi/log để không rơi vào nhánh lỗi mạng.
      window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' });
      window.currentUser = { username: 'admin', name: 'Admin', perms: { admin: true } };

      DB.stores = ['Siêu Thị Q1', 'Siêu Thị Q3'];
      DB.jobTitles = ['Phó Tổng Giám Đốc'];
      DB.storeJobTitles = [{ label: 'Giám Đốc siêu thị' }, { label: 'Phó Giám Đốc siêu thị' }];
      DB.workflows = [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }];
      DB.users = [
        { username: 'gd.q1', name: 'GĐ Q1', jobTitle: 'Giám Đốc siêu thị', dept: 'Siêu Thị Q1', active: true, perms: {} },
        { username: 'gd.nghi', name: 'GĐ Đã Nghỉ', jobTitle: 'Giám Đốc siêu thị', dept: 'Siêu Thị Q1', active: false, perms: {} },
        { username: 'ptgd', name: 'Phó TGĐ', jobTitle: 'Phó Tổng Giám Đốc', dept: 'Ban Giám Đốc', active: true, perms: {} },
        { username: 'ptgd.nghi', name: 'Phó TGĐ Cũ', jobTitle: 'Phó Tổng Giám Đốc', dept: 'Ban Giám Đốc', active: false, perms: {} }
      ];

      // ---------- (2) Mirror client: LỌC tài khoản đã khoá/nghỉ việc ----------
      DB.operationOrderStoreMixedApprovalRules = [
        { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc siêu thị', username: null, stores: [] },
        { id: 2, step: 1, mode: 'PERSON', jobTitle: null, username: 'ptgd.nghi', stores: [] }
      ];
      const approvers = computeOperationOrderStoreMixedApproversClient('Siêu Thị Q1', [1]);
      check('Mirror client: dòng JOBTITLE bỏ qua người đã nghỉ việc (chỉ còn gd.q1)',
        approvers[1].includes('gd.q1') && !approvers[1].includes('gd.nghi'), JSON.stringify(approvers));
      check('Mirror client: dòng PERSON trỏ tài khoản đã khoá -> bỏ qua hẳn',
        !approvers[1].includes('ptgd.nghi'), JSON.stringify(approvers));

      // ---------- (3) Mức chưa cấu hình mẫu quy trình: KHÔNG còn trả null cho đơn Siêu Thị ----------
      DB.operationOrderStoreTierWorkflows = {};   // chưa cấu hình mức nào
      DB.operationOrderHOTierWorkflows = {};
      const storeOrder = { orderLocationType: 'STORE', dept: 'Siêu Thị Q1', amount: 5000000 };
      const cfg = resolveOperationOrderWorkflowConfigForItemClient(storeOrder);
      check('Mức STORE chưa cấu hình -> client KHÔNG trả null nữa (mirror WF mặc định 1 bước của server)',
        !!cfg, JSON.stringify(cfg));
      check('Mức STORE chưa cấu hình -> approvers bước 1 vẫn tra đúng từ Quy Trình Đặt Hàng Siêu Thị (gd.q1)',
        !!cfg && (cfg.approvers?.[1] || []).includes('gd.q1'), JSON.stringify(cfg));
      check('Vẫn giữ cờ tierConfigMissing để danh sách hiện cảnh báo "⚠️ Chưa cấu hình duyệt"',
        !!cfg && cfg.tierConfigMissing === true, JSON.stringify(cfg));
      check('Người duyệt hợp lệ được isApproverForDeptWorkflow() công nhận (trước đây null -> false, mất nút Duyệt)',
        isApproverForDeptWorkflow(cfg, 'gd.q1') === true);
      check('Đơn HO ở mức chưa cấu hình -> vẫn trả null như cũ (không có nguồn người duyệt nào khác)',
        resolveOperationOrderWorkflowConfigForItemClient({ orderLocationType: 'HO', dept: 'Phòng Vận Hành', amount: 5000000 }) === null);

      DB.operationOrderStoreTierWorkflows = { LT10M: { workflowId: 'WF_1STEP' } };
      const cfg2 = resolveOperationOrderWorkflowConfigForItemClient(storeOrder);
      check('Mức ĐÃ cấu hình -> giữ nguyên hành vi cũ (workflowId đúng, không gắn cờ thiếu cấu hình)',
        cfg2 && cfg2.workflowId === 'WF_1STEP' && !cfg2.tierConfigMissing, JSON.stringify(cfg2));

      // ---------- (1) Cảnh báo khi xoá dòng cấu hình ----------
      document.getElementById('mixedApprovalSection')?.classList.remove('hidden');

      let confirmMsg = null;
      const origConfirm = window.confirm;
      const setConfirm = (answer) => { window.confirm = (msg) => { confirmMsg = msg; return answer; }; };

      // a) Bước có 2 dòng -> xoá 1 dòng: câu hỏi trung tính như cũ.
      DB.operationOrderStoreMixedApprovalRules = [
        { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc siêu thị', username: null, stores: [] },
        { id: 2, step: 1, mode: 'JOBTITLE', jobTitle: 'Phó Giám Đốc siêu thị', username: null, stores: [] }
      ];
      renderMixedApprovalSection();
      confirmMsg = null; setConfirm(true);
      deleteMixedApprovalRule(2);
      check('Bước còn dòng khác sau khi xoá -> KHÔNG cảnh báo thừa (giữ câu hỏi trung tính)',
        typeof confirmMsg === 'string' && !confirmMsg.includes('CẢNH BÁO'), confirmMsg);

      // b) Dòng CUỐI CÙNG của bước -> cảnh báo rõ ràng "sẽ không còn ai duyệt".
      confirmMsg = null; setConfirm(false);
      deleteMixedApprovalRule(1);
      check('LỖI ĐÃ VÁ: xoá dòng DUY NHẤT của Bước 1 -> cảnh báo rõ "Bước 1 sẽ KHÔNG CÒN AI DUYỆT"',
        typeof confirmMsg === 'string' && confirmMsg.includes('CẢNH BÁO') && confirmMsg.includes('Bước 1') && /KHÔNG CÒN AI DUYỆT/i.test(confirmMsg),
        confirmMsg);
      check('Bấm "Huỷ" ở cảnh báo -> KHÔNG xoá dòng nào',
        (DB.operationOrderStoreMixedApprovalRules || []).length === 1);

      // c) Xoá dòng MẶC ĐỊNH duy nhất, còn lại toàn dòng NGOẠI LỆ -> cảnh báo riêng.
      DB.operationOrderStoreMixedApprovalRules = [
        { id: 1, step: 2, mode: 'JOBTITLE', jobTitle: 'Giám Đốc siêu thị', username: null, stores: [] },
        { id: 2, step: 2, mode: 'JOBTITLE', jobTitle: 'Phó Giám Đốc siêu thị', username: null, stores: ['Siêu Thị Q3'] }
      ];
      renderMixedApprovalSection();
      confirmMsg = null; setConfirm(false);
      deleteMixedApprovalRule(1);
      check('LỖI ĐÃ VÁ: xoá dòng MẶC ĐỊNH duy nhất của bước -> cảnh báo "chỉ còn dòng NGOẠI LỆ"',
        typeof confirmMsg === 'string' && confirmMsg.includes('CẢNH BÁO') && /NGOẠI LỆ/.test(confirmMsg), confirmMsg);

      // d) Xoá thật sự (đồng ý) vẫn hoạt động như cũ.
      confirmMsg = null; setConfirm(true);
      deleteMixedApprovalRule(2);
      check('Đồng ý xoá -> dòng bị xoá thật', !(DB.operationOrderStoreMixedApprovalRules || []).some(r => r.id === 2));
      window.confirm = origConfirm;

      // ---------- Xem trước số người khớp mỗi dòng ----------
      DB.operationOrderStoreMixedApprovalRules = [
        { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc siêu thị', username: null, stores: [] },
        { id: 2, step: 2, mode: 'JOBTITLE', jobTitle: 'Chức Danh Chưa Ai Giữ', username: null, stores: [] }
      ];
      renderMixedApprovalSection();
      const tbodyHTML = document.getElementById('mixedApprovalTableBody')?.innerHTML || '';
      check('Bảng hiện số người đang khớp mỗi dòng (chỉ đếm tài khoản còn hoạt động: 1 người, không tính GĐ đã nghỉ)',
        tbodyHTML.includes('1 người'), tbodyHTML.slice(0, 400));
      check('Dòng không ai khớp -> hiện cảnh báo "0 người khớp"', tbodyHTML.includes('0 người khớp'), tbodyHTML.slice(0, 400));
      check('mixedApprovalRuleMatchCount(): PERSON trỏ tài khoản đã khoá -> 0',
        mixedApprovalRuleMatchCount({ mode: 'PERSON', username: 'ptgd.nghi' }) === 0);

      return { results };
    });
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.results.filter(r => !r.pass);
  results.results.forEach(r => console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
  if (jsErrors.length) console.log('JS errors (uncaught exceptions):', jsErrors);
  console.log(`\n${results.results.length - failed.length}/${results.results.length} passed.`);
  if (failed.length || jsErrors.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
