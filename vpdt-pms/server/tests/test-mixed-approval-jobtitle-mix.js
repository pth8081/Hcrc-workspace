'use strict';
// server/tests/test-mixed-approval-jobtitle-mix.js
//
// Regression cho tính năng "lọc hỗn hợp chức danh HO lẫn Siêu Thị" ở ô "Người / Chức Danh" (Kiểu "Chức
// danh") của sub-tab "⚙️ Quy Trình Hỗn Hợp" (Hệ Thống) — theo yêu cầu người dùng nguyên văn: "phần chức
// danh thì bạn cho lọc cả chức danh ở HO (kiểu lọc hỗn hợp)", đúng kịch bản "Bước 3 duyệt bởi Phó TGĐ ở
// HO" cho đơn Siêu Thị >100tr. Trước đây ô này CHỈ gợi ý được DB.storeJobTitles — giờ gộp thêm
// DB.jobTitles (HO), nhãn gợi ý gắn hậu tố " — HO"/" — Siêu Thị" để phân biệt khi 2 danh mục trùng tên,
// parse ngược đúng chuỗi gốc (không hậu tố) khi lưu — xem module-workflow.js
// mixedApprovalJobTitleOptions()/mixedApprovalResolveJobTitleInput()/mixedApprovalJobTitleSourceBadgeHTML().
//
// Cùng hạ tầng test với tests/test-muahang-permtree.js: serve public/index.html tĩnh, mở Chromium
// (Playwright) thật, KHÔNG cần backend/DB thật (test thuần cấu hình/round-trip JS phía client).
//
// Chạy: node server/tests/test-mixed-approval-jobtitle-mix.js

const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8970;

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
  let jsErrors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => jsErrors.push(String(e)));

    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
    await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

    results = await page.evaluate(async () => {
      const results = [];
      function check(name, cond, detail) { results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') }); }

      // Seed 2 danh mục chức danh riêng biệt, KHÔNG trùng tên + 1 cặp trùng tên để kiểm tra phân biệt nguồn.
      DB.jobTitles = ['Phó Tổng Giám Đốc', 'Trưởng phòng', 'Trùng Tên'];
      DB.storeJobTitles = [{ label: 'Giám Đốc siêu thị' }, { label: 'Phó Giám Đốc siêu thị' }, { label: 'Trùng Tên' }];
      DB.users = [];
      DB.operationOrderStoreMixedApprovalRules = [];

      // LỖI ĐÃ VÁ (đợt audit chuyên sâu cụm "Hệ Thống/Admin/Cấu Hình", mức Cao): addMixedApprovalRule()/
      // deleteMixedApprovalRule() nay là async, await syncStorage() thật + rollback nếu server từ chối
      // (trước đây "bắn và quên", không await) — cần stub fetch trả 200 để lượt lưu coi như thành công,
      // nếu không rollback sẽ xoá dòng vừa thêm trước khi các assertion dưới chạy tới.
      window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });

      // ---------- mixedApprovalJobTitleOptions(): gộp đủ cả 2 danh mục, gắn đúng hậu tố nguồn ----------
      const opts = mixedApprovalJobTitleOptions();
      check('mixedApprovalJobTitleOptions(): có đủ 3 mục HO (hậu tố " — HO")',
        ['Phó Tổng Giám Đốc — HO', 'Trưởng phòng — HO', 'Trùng Tên — HO'].every(l => opts.includes(l)), JSON.stringify(opts));
      check('mixedApprovalJobTitleOptions(): có đủ 3 mục Siêu Thị (hậu tố " — Siêu Thị")',
        ['Giám Đốc siêu thị — Siêu Thị', 'Phó Giám Đốc siêu thị — Siêu Thị', 'Trùng Tên — Siêu Thị'].every(l => opts.includes(l)), JSON.stringify(opts));
      check('mixedApprovalJobTitleOptions(): tổng đúng 6 mục (3 HO + 3 Siêu Thị)', opts.length === 6, JSON.stringify(opts));

      // ---------- mixedApprovalResolveJobTitleInput(): parse ngược đúng, validate đúng nguồn ----------
      check('resolveJobTitleInput: chọn "Phó Tổng Giám Đốc — HO" -> trả về ĐÚNG chuỗi gốc "Phó Tổng Giám Đốc" (không hậu tố)',
        mixedApprovalResolveJobTitleInput('Phó Tổng Giám Đốc — HO') === 'Phó Tổng Giám Đốc');
      check('resolveJobTitleInput: chọn "Giám Đốc siêu thị — Siêu Thị" -> trả về ĐÚNG "Giám Đốc siêu thị"',
        mixedApprovalResolveJobTitleInput('Giám Đốc siêu thị — Siêu Thị') === 'Giám Đốc siêu thị');
      check('resolveJobTitleInput: "Trùng Tên — HO" và "Trùng Tên — Siêu Thị" đều hợp lệ (phân biệt đúng nguồn, không lẫn)',
        mixedApprovalResolveJobTitleInput('Trùng Tên — HO') === 'Trùng Tên' && mixedApprovalResolveJobTitleInput('Trùng Tên — Siêu Thị') === 'Trùng Tên');
      check('resolveJobTitleInput: gõ tự do không có hậu tố -> null (bắt buộc chọn từ gợi ý)',
        mixedApprovalResolveJobTitleInput('Phó Tổng Giám Đốc') === null);
      check('resolveJobTitleInput: hậu tố đúng nhưng chức danh KHÔNG có trong danh mục tương ứng -> null',
        mixedApprovalResolveJobTitleInput('Chức Danh Không Tồn Tại — HO') === null);
      check('resolveJobTitleInput: chuỗi rỗng/undefined -> null, không throw', mixedApprovalResolveJobTitleInput('') === null && mixedApprovalResolveJobTitleInput(undefined) === null);

      // ---------- mixedApprovalJobTitleSourceBadgeHTML(): badge đúng nguồn cho dòng đã lưu ----------
      check('sourceBadge: chức danh HO -> badge "🏢 HO"', mixedApprovalJobTitleSourceBadgeHTML('Phó Tổng Giám Đốc').includes('HO'));
      check('sourceBadge: chức danh Siêu Thị -> badge "🏬 Siêu Thị"', mixedApprovalJobTitleSourceBadgeHTML('Giám Đốc siêu thị').includes('Siêu Thị'));
      check('sourceBadge: chức danh trùng tên cả 2 danh mục -> ưu tiên hiện Siêu Thị (đã lưu, chỉ 1 badge tham khảo)',
        mixedApprovalJobTitleSourceBadgeHTML('Trùng Tên').includes('Siêu Thị'));

      // ---------- addMixedApprovalRule(): end-to-end qua đúng DOM thật của sub-tab ----------
      document.getElementById('mixedApprovalSection')?.classList.remove('hidden');
      renderMixedApprovalSection();
      document.getElementById('maNewStep').value = '3';
      document.getElementById('maNewMode').value = 'JOBTITLE';
      onMixedApprovalNewModeChange();
      document.getElementById('maNewJobTitleInput').value = 'Phó Tổng Giám Đốc — HO';
      await addMixedApprovalRule();
      const rules = DB.operationOrderStoreMixedApprovalRules || [];
      check('addMixedApprovalRule(): thêm được dòng Bước 3, chức danh HO "Phó Tổng Giám Đốc" (KHÔNG còn hậu tố "— HO")',
        rules.length === 1 && rules[0].step === 3 && rules[0].mode === 'JOBTITLE' && rules[0].jobTitle === 'Phó Tổng Giám Đốc',
        JSON.stringify(rules));
      check('addMixedApprovalRule(): reset lại input sau khi thêm thành công',
        document.getElementById('maNewJobTitleInput').value === '');
      const tbodyHTML = document.getElementById('mixedApprovalTableBody')?.innerHTML || '';
      check('Bảng hiển thị đúng chức danh vừa thêm kèm badge nguồn "🏢 HO"',
        tbodyHTML.includes('Phó Tổng Giám Đốc') && tbodyHTML.includes('HO'));

      // ---------- Từ chối khi gõ tự do không chọn từ gợi ý ----------
      let alertMsg = null;
      const origAlert = window.alert;
      window.alert = (msg) => { alertMsg = msg; };
      document.getElementById('maNewJobTitleInput').value = 'Chức Danh Bịa Đặt';
      await addMixedApprovalRule();
      window.alert = origAlert;
      check('addMixedApprovalRule(): gõ tự do không khớp gợi ý -> bị chặn (alert), KHÔNG thêm dòng mới',
        !!alertMsg && (DB.operationOrderStoreMixedApprovalRules || []).length === 1, alertMsg);

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
