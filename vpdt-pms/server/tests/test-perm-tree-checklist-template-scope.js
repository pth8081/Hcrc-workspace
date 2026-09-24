#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression test: Phân Quyền > khối "✅ 23. Checklist Đánh Giá Siêu Thị" — 2 widget MỚI (10/2026, yêu
// cầu người dùng) gắn kèm quyền "📊 Xem Báo Cáo Checklist" và "✅ Đánh Giá Checklist (Tự Đánh Giá)": mỗi
// quyền giờ có thêm phạm vi THEO MẪU checklist (checklistReportViewScope/checklistStoreSelfExecuteScope,
// {all,depts} — depts chứa templateId dạng chuỗi, xem lib/checklist.js), cùng khuôn widget tìm-kiếm-gõ-
// chọn như "Phạm Vi Kiểm Soát" (checklistAuditScope) đã có, chỉ đổi nguồn dữ liệu sang
// DB.checklistTemplates thay vì DB.stores.
//
// Kiểm tra:
//   1. checklistTemplateScopeItems('REPORT'/'SELF') liệt kê đúng — REPORT: mọi mẫu (cả 2 loại QA/Trừ
//      Điểm); SELF: CHỈ mẫu templateType==='STORE_SELF' (theo xác nhận người dùng, tránh chọn nhầm mẫu
//      Kiểm Soát không áp dụng được).
//   2. render/set/toggle*ScopeCheckboxes() hoạt động đúng khuôn widget renderMultiSelectDropdown() (chip
//      + tìm kiếm, không còn checkbox lưới), scopeFromMultiSelectDropdown() đọc lại đúng {all,depts}.
//   3. computePermTreeNodeCount()/refreshPermTreeBadges(): badge khối "checklist" đếm đúng khi có mẫu đã
//      chọn ở 1 trong 2 widget mới (container id đúng quy ước "<ALL id không 'All'>DeptContainer").
//   4. populatePermsForm()/collectPermsFromForm() round-trip qua đúng 2 field Scope mới.
//   5. LEGACY (quan trọng nhất — chống regression âm thầm): perms có checklistReportView/
//      checklistStoreSelfExecute=true nhưng CHƯA từng có field Scope (tài khoản/nhóm cũ trước 10/2026) —
//      populatePermsForm() phải tự hiện "ALL" đã tick, để 1 lượt lưu KHÔNG chạm gì tới 2 khối này vẫn giữ
//      nguyên {all:true} (không vô tình khoá quyền đang có của người dùng cũ).
//
// Playwright thật, load thẳng public/index.html thật (KHÔNG mock DOM) — cùng hạ tầng
// tests/test-perm-tree-store-scope-widget.js / tests/test-muahang-permtree.js.
//
// Run: node server/tests/test-perm-tree-checklist-template-scope.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8998;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found: ' + urlPath); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const TEMPLATES = [
  { id: 1, templateName: 'Tự Đánh Giá Vệ Sinh', templateType: 'STORE_SELF', templateKind: 'QA' },
  { id: 2, templateName: 'Kiểm Soát VSATTP', templateType: 'CONTROL_AUDIT', templateKind: 'DEDUCTION' },
  { id: 3, templateName: 'Tự Đánh Giá An Toàn', templateType: 'STORE_SELF', templateKind: 'QA' }
];

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let results;
  let jsErrors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => jsErrors.push(String(e)));
    page.on('dialog', d => d.dismiss().catch(() => {}));

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
    await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));
    await page.waitForTimeout(150);

    // Trang chưa đăng nhập nên DB rỗng — gán tay danh mục mẫu checklist cần cho widget.
    await page.evaluate((templates) => { window.DB = window.DB || {}; DB.checklistTemplates = templates; }, TEMPLATES);

    results = await page.evaluate((templates) => {
      const results = [];
      function check(name, cond, detail) { results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') }); }

      // ---------- 1. checklistTemplateScopeItems() ----------
      const reportItems = checklistTemplateScopeItems('REPORT');
      const selfItems = checklistTemplateScopeItems('SELF');
      check('checklistTemplateScopeItems("REPORT") liệt kê CẢ 3 mẫu (cả 2 loại QA/Trừ Điểm)',
        reportItems.length === 3 && reportItems.every(it => templates.some(t => String(t.id) === it.value)),
        JSON.stringify(reportItems));
      check('checklistTemplateScopeItems("SELF") CHỈ liệt kê mẫu templateType===STORE_SELF (id 1,3 — không có id 2 Kiểm Soát)',
        selfItems.length === 2 && selfItems.every(it => it.value === '1' || it.value === '3'),
        JSON.stringify(selfItems));
      check('Nhãn có kèm loại mẫu (VD "(QA)"/"(Trừ Điểm)")', reportItems.some(it => it.label.includes('(QA)')) && reportItems.some(it => it.label.includes('(Trừ Điểm)')), JSON.stringify(reportItems));

      // ---------- 2. Container tồn tại đúng quy ước "<ALL id không 'All'>DeptContainer" ----------
      check('#pChecklistReportViewScopeDeptContainer có mặt trong DOM', !!document.getElementById('pChecklistReportViewScopeDeptContainer'));
      check('#pChecklistStoreSelfExecuteScopeDeptContainer có mặt trong DOM', !!document.getElementById('pChecklistStoreSelfExecuteScopeDeptContainer'));
      check('#pChecklistReportViewScopeAll (checkbox ALL) có mặt', !!document.getElementById('pChecklistReportViewScopeAll'));
      check('#pChecklistStoreSelfExecuteScopeAll (checkbox ALL) có mặt', !!document.getElementById('pChecklistStoreSelfExecuteScopeAll'));

      // ---------- 3. render*/set*/scopeFromMultiSelectDropdown() ----------
      renderChecklistReportViewScopeCheckboxes();
      renderChecklistStoreSelfExecuteScopeCheckboxes();
      const reportEl = document.getElementById('pChecklistReportViewScopeDeptContainer');
      const selfEl = document.getElementById('pChecklistStoreSelfExecuteScopeDeptContainer');
      check('render*(): container Xem Báo Cáo là widget tìm-kiếm-gõ-chọn (không phải checkbox lưới)',
        !reportEl.querySelector('input[type="checkbox"]') && !!reportEl.querySelector('[data-pms-search]'));
      check('render*(): container Tự Đánh Giá là widget tìm-kiếm-gõ-chọn (không phải checkbox lưới)',
        !selfEl.querySelector('input[type="checkbox"]') && !!selfEl.querySelector('[data-pms-search]'));

      setChecklistReportViewScopeCheckboxes(['1', '2']);
      setChecklistStoreSelfExecuteScopeCheckboxes(['3']);
      const reportVals = getMultiSelectValues('pChecklistReportViewScopeDeptContainer');
      const selfVals = getMultiSelectValues('pChecklistStoreSelfExecuteScopeDeptContainer');
      check('set*(): đổ đúng danh sách templateId đã lưu lên widget Xem Báo Cáo', JSON.stringify(reportVals.sort()) === JSON.stringify(['1', '2']), JSON.stringify(reportVals));
      check('set*(): đổ đúng danh sách templateId đã lưu lên widget Tự Đánh Giá', JSON.stringify(selfVals) === JSON.stringify(['3']), JSON.stringify(selfVals));

      document.getElementById('pChecklistReportViewScopeAll').checked = false;
      document.getElementById('pChecklistStoreSelfExecuteScopeAll').checked = true;
      const reportScope = scopeFromMultiSelectDropdown('pChecklistReportViewScopeAll', 'pChecklistReportViewScopeDeptContainer');
      const selfScope = scopeFromMultiSelectDropdown('pChecklistStoreSelfExecuteScopeAll', 'pChecklistStoreSelfExecuteScopeDeptContainer');
      check('scopeFromMultiSelectDropdown() đọc đúng {all:false, depts:[1,2]} cho Xem Báo Cáo',
        reportScope.all === false && JSON.stringify(reportScope.depts.sort()) === JSON.stringify(['1', '2']), JSON.stringify(reportScope));
      check('scopeFromMultiSelectDropdown() đọc đúng {all:true, depts:[3]} cho Tự Đánh Giá',
        selfScope.all === true && JSON.stringify(selfScope.depts) === JSON.stringify(['3']), JSON.stringify(selfScope));

      // ---------- 4. toggle*ScopeGroup() ("ALL") làm mờ + khoá widget ----------
      document.getElementById('pChecklistReportViewScopeAll').checked = true;
      toggleChecklistReportViewScopeGroup();
      const reportDisabled = reportEl.classList.contains('opacity-40') && reportEl.classList.contains('pointer-events-none');
      check('toggleChecklistReportViewScopeGroup(): tick ALL phải làm mờ + khoá widget', reportDisabled);
      document.getElementById('pChecklistReportViewScopeAll').checked = false;
      toggleChecklistReportViewScopeGroup();
      check('toggleChecklistReportViewScopeGroup(): bỏ tick ALL phải trả lại widget hoạt động bình thường',
        !reportEl.classList.contains('opacity-40') && !reportEl.classList.contains('pointer-events-none'));

      // ---------- 5. Badge tự đếm đúng ----------
      refreshPermTreeBadges();
      const badge = document.getElementById('permTreeBadge_checklist')?.textContent || '';
      const granted = parseInt(badge.split('/')[0], 10);
      check('Badge khối "23. Checklist" đếm >0 mục đã cấp (2 widget mới có mẫu đã chọn)', granted > 0, badge);

      // ---------- 6. populatePermsForm()/collectPermsFromForm() round-trip (Scope tường minh) ----------
      const explicitPerms = {
        checklistTemplateManage: false,
        checklistReportView: true,
        checklistReportViewScope: { all: false, depts: ['2'] },
        checklistStoreSelfExecute: true,
        checklistStoreSelfExecuteScope: { all: false, depts: ['1', '3'] },
        checklistAuditScope: { all: false, depts: [] }
      };
      populatePermsForm(explicitPerms);
      check('populatePermsForm() (Scope tường minh): "ALL" Xem Báo Cáo phải BỎ tick (all:false đã lưu)',
        document.getElementById('pChecklistReportViewScopeAll').checked === false);
      check('populatePermsForm() (Scope tường minh): widget Xem Báo Cáo phải đúng ["2"]',
        JSON.stringify(getMultiSelectValues('pChecklistReportViewScopeDeptContainer')) === JSON.stringify(['2']));
      check('populatePermsForm() (Scope tường minh): widget Tự Đánh Giá phải đúng ["1","3"]',
        JSON.stringify(getMultiSelectValues('pChecklistStoreSelfExecuteScopeDeptContainer').sort()) === JSON.stringify(['1', '3']));

      const collected1 = collectPermsFromForm();
      check('collectPermsFromForm() round-trip đúng checklistReportViewScope', JSON.stringify(collected1.checklistReportViewScope) === JSON.stringify({ all: false, depts: ['2'] }), JSON.stringify(collected1.checklistReportViewScope));
      check('collectPermsFromForm() round-trip đúng checklistStoreSelfExecuteScope',
        collected1.checklistStoreSelfExecuteScope.all === false && JSON.stringify(collected1.checklistStoreSelfExecuteScope.depts.sort()) === JSON.stringify(['1', '3']),
        JSON.stringify(collected1.checklistStoreSelfExecuteScope));

      // ---------- 7. LEGACY — quan trọng nhất: chưa từng có field Scope -> populatePermsForm() phải mặc
      // định "ALL" đã tick (giữ nguyên hành vi cũ), KHÔNG được hiện như thể đã bị khoá hết quyền. ----------
      const legacyPerms = {
        checklistTemplateManage: false,
        checklistReportView: true, // cờ phẳng cũ — KHÔNG có checklistReportViewScope
        checklistStoreSelfExecute: true, // cờ phẳng cũ — KHÔNG có checklistStoreSelfExecuteScope
        checklistAuditScope: { all: false, depts: [] }
      };
      populatePermsForm(legacyPerms);
      check('LEGACY: "ALL" Xem Báo Cáo phải TỰ ĐỘNG tick (checklistReportView=true, chưa từng có Scope)',
        document.getElementById('pChecklistReportViewScopeAll').checked === true);
      check('LEGACY: "ALL" Tự Đánh Giá phải TỰ ĐỘNG tick (checklistStoreSelfExecute=true, chưa từng có Scope)',
        document.getElementById('pChecklistStoreSelfExecuteScopeAll').checked === true);

      // Nếu admin lưu NGAY (không đụng gì tới 2 khối này) sau khi mở form 1 tài khoản cũ, kết quả ghi ra
      // PHẢI tương đương {all:true} — không được vô tình khoá quyền đang có.
      const collected2 = collectPermsFromForm();
      check('LEGACY: lưu lại KHÔNG đụng gì -> ghi ra checklistReportViewScope.all=true (không khoá nhầm quyền cũ)',
        collected2.checklistReportViewScope.all === true, JSON.stringify(collected2.checklistReportViewScope));
      check('LEGACY: lưu lại KHÔNG đụng gì -> ghi ra checklistStoreSelfExecuteScope.all=true (không khoá nhầm quyền cũ)',
        collected2.checklistStoreSelfExecuteScope.all === true, JSON.stringify(collected2.checklistStoreSelfExecuteScope));

      // ---------- 8. defaultNewUserPerms(): người dùng HOÀN TOÀN MỚI mặc định KHÔNG có quyền nào ----------
      const fresh = defaultNewUserPerms();
      check('defaultNewUserPerms(): checklistReportViewScope mặc định {all:false, depts:[]}',
        fresh.checklistReportViewScope && fresh.checklistReportViewScope.all === false && (fresh.checklistReportViewScope.depts || []).length === 0,
        JSON.stringify(fresh.checklistReportViewScope));
      check('defaultNewUserPerms(): checklistStoreSelfExecuteScope mặc định {all:false, depts:[]}',
        fresh.checklistStoreSelfExecuteScope && fresh.checklistStoreSelfExecuteScope.all === false && (fresh.checklistStoreSelfExecuteScope.depts || []).length === 0,
        JSON.stringify(fresh.checklistStoreSelfExecuteScope));

      return { results };
    }, TEMPLATES);
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

main().catch(err => { console.error(err); process.exit(1); });
