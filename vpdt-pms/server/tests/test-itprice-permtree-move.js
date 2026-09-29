#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression test (10/2026, theo yêu cầu người dùng "Job2"): 4 checkbox quyền
// Phê Duyệt Giá đã DỜI vị trí trong cây phân quyền (public/fragments/
// systemSection.html):
//   - pItPriceProposeCreateWholesale + pItPriceEmergencyRejectApproveWholesale:
//     "15. Hỗ Trợ IT" -> "22. Vận Hành"
//   - pItPriceProposeCreateRetail + pItPriceEmergencyRejectApproveRetail:
//     "15. Hỗ Trợ IT" -> "26. Mua Hàng — Phê Duyệt Giá" (mục MỚI)
//
// Test này lái THẬT qua form Người Dùng (resetUserForm/saveUser, đúng khuôn
// test-admin-users-permgroups.js) để xác nhận: (1) checkbox nằm ĐÚNG vị trí
// DOM mới, KHÔNG còn ở "15. Hỗ Trợ IT"; (2) tick checkbox ở vị trí mới vẫn
// lưu đúng vào DB.users[].perms (collectPermsFromForm() không phụ thuộc vị
// trí DOM); (3) badge đếm quyền của "22. Vận Hành"/"26. Mua Hàng — Phê Duyệt
// Giá" tăng đúng khi tick.
//
// Run: node server/tests/test-itprice-permtree-move.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8994;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.startsWith('/js/') || urlPath.startsWith('/fragments/')) {
        const PUBLIC_DIR = path.join(__dirname, '..', 'public');
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          const ct = urlPath.startsWith('/js/') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
          res.writeHead(200, { 'Content-Type': ct });
          res.end(data);
        });
      }
      fs.readFile(INDEX_HTML_PATH, (err, data) => {
        if (err) { res.writeHead(500); res.end(String(err)); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  if (pass) console.log(`PASS: ${name}`);
  else console.log(`FAIL: ${name}${detail ? ' -- ' + detail : ''}`);
}
async function scenario(name, fn) {
  try { await fn(); } catch (e) { record(name, false, 'threw: ' + (e && e.message ? e.message : String(e))); }
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));
  await page.waitForTimeout(150);

  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

    DB.depts = ['Hỗ Trợ IT', 'Vận Hành', 'Mua Hàng'];
    DB.stores = [];
    DB.positionTypes = [{ key: 'HO', label: 'HO (Văn phòng)', builtin: true }, { key: 'STORE', label: 'Siêu Thị', builtin: true }];
    DB.deptAbbrs = {};
    DB.deptGroups = [];
    DB.hrProcesses = [];
    DB.cats = [];
    DB.jobTitles = ['Nhân viên'];
    DB.submissionTypes = []; DB.contractTypes = []; DB.carTypes = [];
    DB.users = [{ id: 1, username: 'admin', name: 'Quản Trị Viên', email: 'admin@hcrc.local', phone: '0900000000',
      posType: 'HO', dept: 'Hỗ Trợ IT', jobTitle: null, perms: { admin: true }, groupIds: [], permOverrides: null }];
    DB.permGroups = [];
    DB.vppExcludeGroups = [];
    DB.vppExcludedJobTitles = [];
    DB.workflowParticipatingDepts = [];
    DB.workflowParticipatingDeptGroups = [];
    finishLogin(DB.users[0]);
  });

  // ---- (1) vị trí DOM: checkbox WHOLESALE phải nằm trong node "22. Vận Hành", KHÔNG còn ở "15. Hỗ Trợ IT" ----
  const domCheck = await page.evaluate(() => {
    function nodeHeaderText(el) {
      const node = el.closest('details.perm-tree-node');
      return node ? node.querySelector('summary')?.innerText || '' : null;
    }
    const wsPropose = document.getElementById('pItPriceProposeCreateWholesale');
    const wsEmergency = document.getElementById('pItPriceEmergencyRejectApproveWholesale');
    const rtPropose = document.getElementById('pItPriceProposeCreateRetail');
    const rtEmergency = document.getElementById('pItPriceEmergencyRejectApproveRetail');
    return {
      wsProposeHeader: wsPropose ? nodeHeaderText(wsPropose) : null,
      wsEmergencyHeader: wsEmergency ? nodeHeaderText(wsEmergency) : null,
      rtProposeHeader: rtPropose ? nodeHeaderText(rtPropose) : null,
      rtEmergencyHeader: rtEmergency ? nodeHeaderText(rtEmergency) : null,
      itSupportNodeText: Array.from(document.querySelectorAll('details.perm-tree-node')).find(n => /15\. Hỗ Trợ IT/.test(n.querySelector('summary')?.innerText || ''))?.innerText || '',
    };
  });
  record('(1) Checkbox Đề Xuất/Khẩn Cấp Bán Buôn nằm ĐÚNG trong node "22. Vận Hành"',
    /22\. Vận Hành/.test(domCheck.wsProposeHeader || '') && /22\. Vận Hành/.test(domCheck.wsEmergencyHeader || ''),
    JSON.stringify(domCheck));
  record('(1) Checkbox Đề Xuất/Khẩn Cấp Bán Lẻ nằm ĐÚNG trong node "26. Mua Hàng — Phê Duyệt Giá"',
    /26\. Mua Hàng/.test(domCheck.rtProposeHeader || '') && /26\. Mua Hàng/.test(domCheck.rtEmergencyHeader || ''),
    JSON.stringify(domCheck));
  record('(1) Node "15. Hỗ Trợ IT" KHÔNG còn chứa 4 checkbox Phê Duyệt Giá đã dời đi',
    !/Đề xuất duyệt giá|Phê duyệt từ chối khẩn cấp/.test(domCheck.itSupportNodeText || ''),
    domCheck.itSupportNodeText);

  // ---- (2) tick checkbox WHOLESALE ở vị trí mới ("22. Vận Hành") -> saveUser() lưu đúng vào DB.users ----
  await scenario('(2) Tạo user tick 2 quyền Bán Buôn (vị trí mới) -> DB.users lưu đúng, KHÔNG dính quyền Bán Lẻ', async () => {
    const r = await page.evaluate(async () => {
      resetUserForm();
      document.getElementById('uUsername').value = 'nv.wholesale';
      document.getElementById('uPassword').value = 'Passw0rd!23';
      document.getElementById('uFullName').value = 'NV Bán Buôn';
      document.getElementById('uEmail').value = 'wholesale@hcrc.local';
      document.getElementById('uPhone').value = '0911111111';
      document.getElementById('uDept').value = 'Vận Hành';
      const cb1 = document.getElementById('pItPriceProposeCreateWholesale');
      const cb2 = document.getElementById('pItPriceEmergencyRejectApproveWholesale');
      cb1.checked = true; cb1.dispatchEvent(new Event('change', { bubbles: true }));
      cb2.checked = true; cb2.dispatchEvent(new Event('change', { bubbles: true }));
      window.__alerts.length = 0;
      await saveUser({ preventDefault() {} });
      const created = DB.users.find(u => u.username === 'nv.wholesale');
      return { alerts: window.__alerts.slice(), created: created ? created.perms : null };
    });
    record('(2) Tạo user tick 2 quyền Bán Buôn (vị trí mới) -> DB.users lưu đúng, KHÔNG dính quyền Bán Lẻ',
      !!r.created && r.created.itPriceProposeCreateWholesale === true && r.created.itPriceEmergencyRejectApproveWholesale === true
      && !r.created.itPriceProposeCreateRetail && !r.created.itPriceEmergencyRejectApproveRetail,
      JSON.stringify(r));
  });

  // ---- (3) tick checkbox RETAIL ở vị trí mới ("26. Mua Hàng — Phê Duyệt Giá") -> saveUser() lưu đúng ----
  await scenario('(3) Tạo user tick 2 quyền Bán Lẻ (vị trí mới) -> DB.users lưu đúng, KHÔNG dính quyền Bán Buôn', async () => {
    const r = await page.evaluate(async () => {
      resetUserForm();
      document.getElementById('uUsername').value = 'nv.retail';
      document.getElementById('uPassword').value = 'Passw0rd!23';
      document.getElementById('uFullName').value = 'NV Bán Lẻ';
      document.getElementById('uEmail').value = 'retail@hcrc.local';
      document.getElementById('uPhone').value = '0922222222';
      document.getElementById('uDept').value = 'Mua Hàng';
      const cb1 = document.getElementById('pItPriceProposeCreateRetail');
      const cb2 = document.getElementById('pItPriceEmergencyRejectApproveRetail');
      cb1.checked = true; cb1.dispatchEvent(new Event('change', { bubbles: true }));
      cb2.checked = true; cb2.dispatchEvent(new Event('change', { bubbles: true }));
      window.__alerts.length = 0;
      await saveUser({ preventDefault() {} });
      const created = DB.users.find(u => u.username === 'nv.retail');
      return { alerts: window.__alerts.slice(), created: created ? created.perms : null };
    });
    record('(3) Tạo user tick 2 quyền Bán Lẻ (vị trí mới) -> DB.users lưu đúng, KHÔNG dính quyền Bán Buôn',
      !!r.created && r.created.itPriceProposeCreateRetail === true && r.created.itPriceEmergencyRejectApproveRetail === true
      && !r.created.itPriceProposeCreateWholesale && !r.created.itPriceEmergencyRejectApproveWholesale,
      JSON.stringify(r));
  });

  // ---- (4) badge đếm quyền tự cập nhật đúng khi tick (dùng chung logic generic theo class .perm-tree-node) ----
  await scenario('(4) Badge đếm quyền của "22. Vận Hành" và "26. Mua Hàng — Phê Duyệt Giá" tự tăng khi tick (không cần sửa code riêng)', async () => {
    const r = await page.evaluate(() => {
      resetUserForm();
      const cbWs = document.getElementById('pItPriceProposeCreateWholesale');
      cbWs.checked = true; cbWs.dispatchEvent(new Event('change', { bubbles: true }));
      const cbRt = document.getElementById('pItPriceProposeCreateRetail');
      cbRt.checked = true; cbRt.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof refreshPermTreeBadges === 'function') refreshPermTreeBadges();
      const vanHanhBadge = document.getElementById('permTreeBadge_vanHanh')?.textContent || '';
      const muaHangItPriceBadge = document.getElementById('permTreeBadge_muahangItPrice')?.textContent || '';
      return { vanHanhBadge, muaHangItPriceBadge };
    });
    const vhGranted = parseInt((r.vanHanhBadge || '0/0').split('/')[0], 10);
    const mhGranted = parseInt((r.muaHangItPriceBadge || '0/0').split('/')[0], 10);
    record('(4) Badge đếm quyền của "22. Vận Hành" và "26. Mua Hàng — Phê Duyệt Giá" tự tăng khi tick (không cần sửa code riêng)',
      vhGranted >= 1 && mhGranted >= 1, JSON.stringify(r));
  });

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.pass).length;
  console.log(`\n==== ${results.length - failed}/${results.length} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  process.exitCode = failed ? 1 : 0;
})().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
