#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression suite: "Sửa Nhanh Trên Web" (Ma Trận Phân Quyền tick trực tiếp) + Gán/Gỡ Nhóm Phân Quyền
// hàng loạt từ danh sách Người Dùng (10/2026, theo yêu cầu người dùng: "phải vào từng module mở ra...
// có cách chọn dạng bảng nhanh hơn không") — xem public/js/module-admin-permgroups.js (2 khối cuối
// file: "SỬA NHANH TRÊN WEB" + "GÁN/GỠ NHÓM PHÂN QUYỀN HÀNG LOẠT").
//
// Test THUẦN CLIENT qua Playwright (cùng khuôn tests/test-perm-matrix-client.js — sandbox này không có
// SQL Server thật): serve public/index.html tĩnh, stub window.fetch/alert/confirm, hand-seed
// DB.users/DB.permGroups, gọi thẳng các hàm togglePermMatrixQuickEdit()/savePmQuickEdit()/
// applyUserBulkGroupAction() như UI thật gọi qua data-op — CÓ thao tác trên DOM thật, khác các test
// buildPermMatrixRowChanges() thuần logic đã có.
//
// Phủ đúng các điểm THIẾT KẾ cốt lõi cần xác minh:
//   - Sửa Nhanh Trên Web: bảng chỉ hiện đúng cột của 1 "khối" đang chọn, tick đúng ô -> lưu đúng, tài
//     khoản "admin" gốc không có checkbox (không sửa được).
//   - Sửa Nhanh Trên Web (Nhóm): sửa quyền nhóm CASCADE ngay cho thành viên, giống hệt đường Excel.
//   - Không có thay đổi nào thì không gọi lưu, không báo "đã lưu".
//   - Bulk gán/gỡ Nhóm: chọn người qua Ô TÌM-KIẾM-GÕ-CHỌN-NHIỀU-NGƯỜI (userBulkPeoplePicker,
//     renderMultiSelectDropdown(), 10/2026 — thay hẳn checkbox từng dòng cũ) -> ADD/REMOVE đúng,
//     permOverrides reset đúng luật savePermGroup(), người không được chọn không bị ảnh hưởng, tài
//     khoản "admin" gốc không nằm trong danh sách ứng viên chọn được.
//   - LỖI ĐÃ VÁ (10/2026, phản ánh người dùng): lựa chọn người dùng giờ KHÔNG bị mất khi renderUsers()
//     chạy lại (đổi trang/lọc bảng Người Dùng bên dưới) — khác hẳn checkbox-theo-trang cũ.
//
// Run: node server/tests/test-perm-matrix-quickedit-and-bulk-group.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8996;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.startsWith('/js/')) {
        const PUBLIC_DIR = path.join(__dirname, '..', 'public');
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
          res.end(data);
        });
      }
      if (urlPath.startsWith('/fragments/')) {
        const PUBLIC_DIR = path.join(__dirname, '..', 'public');
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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
  try {
    await fn();
  } catch (e) {
    record(name, false, 'threw: ' + (e && e.message ? e.message : String(e)));
  }
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

  const setup = await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.__fetchCalls = [];
    window.__fetchHandlers = {};
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      let bodyParsed = null;
      try { bodyParsed = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) { /* ignore */ }
      window.__fetchCalls.push({ url: String(url), method, body: bodyParsed });
      const key = `${method} ${url}`;
      const handler = window.__fetchHandlers[key] || window.__fetchHandlers[url];
      const result = handler ? handler() : { status: 200, body: {} };
      const status = result.status || 200;
      return { ok: status >= 200 && status < 300, status, json: async () => result.body || {} };
    };
    window.__fetchHandlers['POST /api/data/users'] = () => ({ status: 200, body: { ok: true, version: '2' } });
    window.__fetchHandlers['POST /api/data/permGroups'] = () => ({ status: 200, body: { ok: true, version: '2' } });

    DB.depts = ['Kế Toán', 'Kinh Doanh'];
    DB.stores = [];
    DB.jobTitles = [];
    DB.users = [];
    DB.permGroups = [];

    DB.users.push({
      id: 1, username: 'admin', name: 'Quản Trị Viên', email: 'admin@hcrc.local', phone: '090',
      posType: 'HO', dept: 'Kinh Doanh', jobTitle: null, perms: { admin: true }, groupIds: [], permOverrides: null, active: true,
    });
    finishLogin(DB.users[0]);
    return { ok: true };
  });
  record('setup: finishLogin(admin) runs cleanly', setup.ok);

  // ==========================================================================
  // (A) SỬA NHANH TRÊN WEB
  // ==========================================================================
  await scenario('(a) togglePermMatrixQuickEdit(): mở bảng, chọn 1 khối quyền, tick đúng theo perms hiện có, admin bị khoá ô', async () => {
    const r = await page.evaluate(() => {
      window.__alerts.length = 0;
      DB.permGroups = [];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.a', name: 'Nhân Viên A', perms: { admin: false, licenseApprove: true }, groupIds: [], permOverrides: null, active: true, reportExtraKeys: [] },
      ];
      togglePermMatrixQuickEdit(); // mở (tự chọn khối mặc định — sẽ ghi đè lại đúng khối cần test ngay dưới)
      const wrapHiddenAfterOpen = document.getElementById('permMatrixQuickEditWrap').classList.contains('hidden');
      // Chọn đúng khối chứa "licenseApprove" (permMatrixColumnGroup('licenseApprove')) — gán thẳng
      // biến + gọi lại render tay (KHÔNG qua onPmQuickEditGroupChange(), hàm đó đọc NGƯỢC lại giá trị từ
      // <select> DOM nên sẽ ghi đè mất giá trị vừa gán tay ở đây).
      pmQuickEditKind = 'users';
      const targetGroup = permMatrixColumnGroup('licenseApprove');
      pmQuickEditGroupKey = targetGroup;
      renderPmQuickEditGroupSelect();
      renderPmQuickEditTable();
      const wrapHidden = wrapHiddenAfterOpen;
      const adminCb = document.querySelector(`input[data-pm-quick-cell][data-entity="admin"][data-key="licenseApprove"]`);
      const nvCb = document.querySelector(`input[data-pm-quick-cell][data-entity="nv.a"][data-key="licenseApprove"]`);
      return {
        wrapHidden, targetGroup,
        adminDisabled: adminCb ? adminCb.disabled : null,
        nvChecked: nvCb ? nvCb.checked : null,
        headerText: document.getElementById('pmQuickEditTableHead').textContent,
      };
    });
    record('(a) bảng Sửa Nhanh hiện ra (không còn hidden)', r.wrapHidden === false, JSON.stringify(r));
    record('(a) ô "admin" bị disabled (không sửa được qua bảng này)', r.adminDisabled === true, JSON.stringify(r));
    record('(a) ô "nv.a" phản ánh ĐÚNG perms.licenseApprove=true hiện có (đã tick sẵn)', r.nvChecked === true, JSON.stringify(r));
    record('(a) header bảng có chứa nhãn tiếng Việt của quyền (không phải "Q_licenseApprove" thô)',
      r.headerText.includes('Duyệt Giấy Phép'), JSON.stringify(r));
  });

  await scenario('(b) savePmQuickEdit(): tick đổi 1 ô -> lưu đúng, không đụng quyền khác, gọi POST /api/data/users', async () => {
    const r = await page.evaluate(async () => {
      window.__fetchCalls.length = 0;
      DB.permGroups = [];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.a', name: 'Nhân Viên A', perms: { admin: false, licenseApprove: false, paymentManage: true }, groupIds: [], permOverrides: null, active: true, reportExtraKeys: [] },
      ];
      pmQuickEditKind = 'users';
      pmQuickEditGroupKey = permMatrixColumnGroup('licenseApprove');
      renderPmQuickEditGroupSelect();
      renderPmQuickEditTable();
      const cb = document.querySelector(`input[data-pm-quick-cell][data-entity="nv.a"][data-key="licenseApprove"]`);
      cb.checked = true; // tick lên (trước đó false)
      await savePmQuickEdit();
      const nvAfter = DB.users.find(u => u.username === 'nv.a');
      return {
        nvAfter,
        savedCall: window.__fetchCalls.find(c => c.url === '/api/data/users' && c.method === 'POST'),
        alerts: window.__alerts.slice(),
      };
    });
    record('(b) licenseApprove đã bật đúng như tick', r.nvAfter && r.nvAfter.perms.licenseApprove === true, JSON.stringify(r.nvAfter));
    record('(b) paymentManage (KHÔNG thuộc khối đang sửa) giữ nguyên true, không bị đụng tới',
      r.nvAfter && r.nvAfter.perms.paymentManage === true, JSON.stringify(r.nvAfter));
    record('(b) đã POST /api/data/users để lưu thật', !!r.savedCall, JSON.stringify(r.savedCall));
    record('(b) có alert báo đã lưu thành công', r.alerts.some(a => a.includes('Đã lưu')), JSON.stringify(r.alerts));
  });

  await scenario('(c) savePmQuickEdit(): không đổi gì -> báo "Không có thay đổi", KHÔNG gọi lưu', async () => {
    const r = await page.evaluate(async () => {
      window.__fetchCalls.length = 0;
      window.__alerts.length = 0;
      DB.permGroups = [];
      DB.users = [
        { id: 2, username: 'nv.b', name: 'Nhân Viên B', perms: { admin: false, licenseApprove: true }, groupIds: [], permOverrides: null, active: true, reportExtraKeys: [] },
      ];
      pmQuickEditKind = 'users';
      pmQuickEditGroupKey = permMatrixColumnGroup('licenseApprove');
      renderPmQuickEditTable(); // KHÔNG tick gì thêm — giữ nguyên trạng thái đã tick sẵn theo perms hiện có
      await savePmQuickEdit();
      return {
        alerts: window.__alerts.slice(),
        savedCall: window.__fetchCalls.find(c => c.url === '/api/data/users' && c.method === 'POST'),
      };
    });
    record('(c) báo "Không có thay đổi nào để lưu."', r.alerts.some(a => a.includes('Không có thay đổi')), JSON.stringify(r.alerts));
    record('(c) KHÔNG gọi POST /api/data/users (không có gì để lưu)', !r.savedCall, JSON.stringify(r.savedCall));
  });

  await scenario('(d) savePmQuickEdit() kind="groups": sửa quyền nhóm CASCADE ngay cho thành viên (giống đường Excel)', async () => {
    const r = await page.evaluate(async () => {
      window.__fetchCalls.length = 0;
      DB.permGroups = [{ id: 'grp_Q', name: 'Nhóm Quick', perms: { licenseApprove: false }, reportExtraKeys: [] }];
      DB.users = [
        { id: 10, username: 'member.q', name: 'Thành Viên Q', perms: { licenseApprove: false }, groupIds: ['grp_Q'], permOverrides: null, active: true },
        { id: 11, username: 'other.q', name: 'Không Thuộc Nhóm', perms: { licenseApprove: false }, groupIds: [], permOverrides: null, active: true },
      ];
      pmQuickEditKind = 'groups';
      pmQuickEditGroupKey = permMatrixColumnGroup('licenseApprove');
      renderPmQuickEditTable();
      const cb = document.querySelector(`input[data-pm-quick-cell][data-entity="Nhóm Quick"][data-key="licenseApprove"]`);
      cb.checked = true;
      await savePmQuickEdit();
      return {
        groupAfter: DB.permGroups.find(g => g.id === 'grp_Q'),
        memberAfter: DB.users.find(u => u.username === 'member.q'),
        otherAfter: DB.users.find(u => u.username === 'other.q'),
        calledUsersSync: window.__fetchCalls.some(c => c.url === '/api/data/users' && c.method === 'POST'),
        calledGroupsSync: window.__fetchCalls.some(c => c.url === '/api/data/permGroups' && c.method === 'POST'),
      };
    });
    record('(d) quyền nhóm được cập nhật', r.groupAfter && r.groupAfter.perms.licenseApprove === true, JSON.stringify(r.groupAfter));
    record('(d) thành viên của nhóm được cascade NGAY', r.memberAfter && r.memberAfter.perms.licenseApprove === true, JSON.stringify(r.memberAfter));
    record('(d) người KHÔNG thuộc nhóm không bị ảnh hưởng', r.otherAfter && r.otherAfter.perms.licenseApprove === false, JSON.stringify(r.otherAfter));
    record('(d) đã lưu CẢ permGroups LẪN users (vì có cascade)', r.calledUsersSync && r.calledGroupsSync, JSON.stringify(r));
  });

  // ==========================================================================
  // (A2) Ô CHỌN NGƯỜI/NHÓM DẠNG DROPDOWN TÌM-KIẾM-CHỌN-NHIỀU (10/2026, thay ô gõ chữ lọc cũ)
  // ==========================================================================
  await scenario('(d2) renderPmQuickEditPicker() + chọn người cụ thể qua ô tìm-kiếm-chọn-nhiều -> bảng Sửa Nhanh chỉ còn đúng người đã chọn', async () => {
    const r = await page.evaluate(() => {
      DB.permGroups = [];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.k', name: 'Nhân Viên K', dept: 'Kinh Doanh', perms: { admin: false, licenseApprove: true }, groupIds: [], permOverrides: null, active: true, reportExtraKeys: [] },
        { id: 3, username: 'nv.l', name: 'Nhân Viên L', dept: 'Kinh Doanh', perms: { admin: false, licenseApprove: false }, groupIds: [], permOverrides: null, active: true, reportExtraKeys: [] },
      ];
      pmQuickEditKind = 'users';
      pmQuickEditGroupKey = permMatrixColumnGroup('licenseApprove');
      renderPmQuickEditGroupSelect();
      renderPmQuickEditPicker();
      renderPmQuickEditTable();
      const rowCountBeforeSelect = document.querySelectorAll('#pmQuickEditTableBody tr').length;
      const pickerItems = document.getElementById('pmQuickEditPicker')._gmsItems || [];
      gmsAdd('pmQuickEditPicker', 'nv.k');
      const bodyText = document.getElementById('pmQuickEditTableBody').textContent;
      const rowCountAfterSelect = document.querySelectorAll('#pmQuickEditTableBody tr').length;
      return {
        rowCountBeforeSelect, rowCountAfterSelect, bodyText,
        pickerHasAdmin: pickerItems.some(it => it.value === 'admin'),
        status: document.getElementById('pmQuickEditStatus').textContent,
      };
    });
    record('(d2) chưa chọn ai -> bảng hiện cả 3 người (kể cả admin), giống hệt hành vi cũ không có bộ lọc', r.rowCountBeforeSelect === 3, JSON.stringify(r));
    record('(d2) ô chọn KHÔNG có "admin" trong danh sách ứng viên (admin luôn khoá, không cần chọn)', r.pickerHasAdmin === false, JSON.stringify(r));
    record('(d2) chọn đúng 1 người -> bảng chỉ còn đúng 1 dòng', r.rowCountAfterSelect === 1, JSON.stringify(r));
    record('(d2) dòng còn lại đúng là nv.k, KHÔNG còn nv.l', r.bodyText.includes('nv.k') && !r.bodyText.includes('nv.l'), r.bodyText);
    record('(d2) dòng trạng thái báo đang thu hẹp theo lựa chọn', r.status.includes('thu hẹp'), r.status);
  });

  await scenario('(d3) togglePmQuickEditColumn(): bấm ✓/✗ đầu cột -> tick/bỏ-tick quyền đó cho TOÀN BỘ người đang hiện trong bảng cùng lúc, bỏ qua ô "admin" đang khoá', async () => {
    const r = await page.evaluate(() => {
      DB.permGroups = [];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.m', name: 'Nhân Viên M', dept: 'Kinh Doanh', perms: { admin: false, licenseApprove: false }, groupIds: [], permOverrides: null, active: true, reportExtraKeys: [] },
        { id: 3, username: 'nv.n', name: 'Nhân Viên N', dept: 'Kinh Doanh', perms: { admin: false, licenseApprove: false }, groupIds: [], permOverrides: null, active: true, reportExtraKeys: [] },
      ];
      pmQuickEditKind = 'users';
      pmQuickEditGroupKey = permMatrixColumnGroup('licenseApprove');
      renderPmQuickEditGroupSelect();
      renderPmQuickEditPicker();
      renderPmQuickEditTable();
      const cb = (u) => document.querySelector(`input[data-pm-quick-cell][data-entity="${u}"][data-key="licenseApprove"]`);
      const beforeAllUnchecked = !cb('nv.m').checked && !cb('nv.n').checked;
      togglePmQuickEditColumn('licenseApprove'); // bật cả cột (đang toàn bộ chưa tick)
      const afterFirstToggle = { m: cb('nv.m').checked, n: cb('nv.n').checked, adminDisabled: cb('admin').disabled, adminChecked: cb('admin').checked };
      togglePmQuickEditColumn('licenseApprove'); // bấm lại (đang toàn bộ đã tick) -> tắt cả cột
      const afterSecondToggle = { m: cb('nv.m').checked, n: cb('nv.n').checked };
      return { beforeAllUnchecked, afterFirstToggle, afterSecondToggle };
    });
    record('(d3) trước khi bấm, cả 2 người đều chưa tick (đúng perms gốc)', r.beforeAllUnchecked === true, JSON.stringify(r));
    record('(d3) bấm 1 lần -> tick HẾT cho cả nv.m lẫn nv.n chỉ bằng 1 click', r.afterFirstToggle.m === true && r.afterFirstToggle.n === true, JSON.stringify(r));
    record('(d3) ô "admin" vẫn khoá và KHÔNG bị tick (toggle hàng loạt bỏ qua ô đã disabled)', r.afterFirstToggle.adminDisabled === true && r.afterFirstToggle.adminChecked === false, JSON.stringify(r));
    record('(d3) bấm lần 2 (đang toàn bộ đã tick) -> bỏ tick HẾT', r.afterSecondToggle.m === false && r.afterSecondToggle.n === false, JSON.stringify(r));
  });

  await scenario('(d4) setPmQuickEditKind(): đổi Người Dùng <-> Nhóm Phân Quyền xoá lựa chọn đang có ở ô chọn (2 tập giá trị khác nhau)', async () => {
    const r = await page.evaluate(() => {
      DB.permGroups = [{ id: 'grp_z', name: 'Nhóm Z', perms: { licenseApprove: false }, reportExtraKeys: [] }];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.o', name: 'Nhân Viên O', dept: 'Kinh Doanh', perms: { admin: false, licenseApprove: false }, groupIds: [], permOverrides: null, active: true, reportExtraKeys: [] },
      ];
      pmQuickEditKind = 'users';
      pmQuickEditGroupKey = permMatrixColumnGroup('licenseApprove');
      renderPmQuickEditGroupSelect();
      renderPmQuickEditPicker();
      renderPmQuickEditTable();
      gmsAdd('pmQuickEditPicker', 'nv.o');
      const selectedBeforeSwitch = getMultiSelectValues('pmQuickEditPicker');
      setPmQuickEditKind('groups');
      const selectedAfterSwitch = getMultiSelectValues('pmQuickEditPicker');
      return { selectedBeforeSwitch, selectedAfterSwitch };
    });
    record('(d4) trước khi đổi, đã chọn đúng nv.o', JSON.stringify(r.selectedBeforeSwitch) === JSON.stringify(['nv.o']), JSON.stringify(r));
    record('(d4) đổi sang Nhóm Phân Quyền -> lựa chọn cũ (nv.o, không thuộc tập giá trị nhóm) bị loại bỏ', !r.selectedAfterSwitch.includes('nv.o'), JSON.stringify(r));
  });

  // ==========================================================================
  // (B) GÁN/GỠ NHÓM PHÂN QUYỀN HÀNG LOẠT TỪ DANH SÁCH NGƯỜI DÙNG
  // ==========================================================================
  await scenario('(e) renderUserBulkPeoplePicker(): admin KHÔNG nằm trong danh sách ứng viên chọn được, người thường thì có', async () => {
    const r = await page.evaluate(() => {
      DB.permGroups = [];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.c', name: 'Nhân Viên C', dept: 'Kinh Doanh', perms: { admin: false }, groupIds: [], permOverrides: null, active: true },
      ];
      renderUsers();
      const items = document.getElementById('userBulkPeoplePicker')._gmsItems || [];
      return {
        adminIsCandidate: items.some(it => it.value === 'admin'),
        nvIsCandidate: items.some(it => it.value === 'nv.c'),
      };
    });
    record('(e) "admin" KHÔNG nằm trong danh sách chọn được', r.adminIsCandidate === false, JSON.stringify(r));
    record('(e) người thường CÓ trong danh sách chọn được', r.nvIsCandidate === true, JSON.stringify(r));
  });

  await scenario('(f) applyUserBulkGroupAction("ADD"): gán nhiều người cùng lúc vào 1 nhóm, người không chọn không bị ảnh hưởng', async () => {
    const r = await page.evaluate(async () => {
      window.__fetchCalls.length = 0;
      window.__alerts.length = 0;
      DB.permGroups = [{ id: 'grp_bulk', name: 'Nhóm Bulk', perms: { paymentManage: true }, reportExtraKeys: [] }];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.d', name: 'Nhân Viên D', dept: 'Kinh Doanh', perms: {}, groupIds: [], permOverrides: null, active: true },
        { id: 3, username: 'nv.e', name: 'Nhân Viên E', dept: 'Kinh Doanh', perms: {}, groupIds: [], permOverrides: null, active: true },
        { id: 4, username: 'nv.f', name: 'Nhân Viên F (không chọn)', dept: 'Kinh Doanh', perms: {}, groupIds: [], permOverrides: null, active: true },
      ];
      renderUsers();
      // Chọn người qua ô tìm-kiếm-gõ-chọn-nhiều-người (gmsAdd() — cùng hàm data-op="gmsAdd" gọi khi bấm
      // 1 dòng gợi ý trong dropdown thật), KHÔNG còn tick checkbox trong bảng.
      gmsAdd('userBulkPeoplePicker', 'nv.d');
      gmsAdd('userBulkPeoplePicker', 'nv.e');
      document.getElementById('userBulkGroupSelect').value = 'grp_bulk';
      await applyUserBulkGroupAction('ADD');
      return {
        nvD: DB.users.find(u => u.username === 'nv.d'),
        nvE: DB.users.find(u => u.username === 'nv.e'),
        nvF: DB.users.find(u => u.username === 'nv.f'),
        savedCall: window.__fetchCalls.find(c => c.url === '/api/data/users' && c.method === 'POST'),
        alerts: window.__alerts.slice(),
      };
    });
    record('(f) nv.d được gán vào nhóm + nhận quyền paymentManage', r.nvD && r.nvD.groupIds.includes('grp_bulk') && r.nvD.perms.paymentManage === true, JSON.stringify(r.nvD));
    record('(f) nv.e được gán vào nhóm + nhận quyền paymentManage', r.nvE && r.nvE.groupIds.includes('grp_bulk') && r.nvE.perms.paymentManage === true, JSON.stringify(r.nvE));
    record('(f) nv.f (KHÔNG được chọn) hoàn toàn không bị ảnh hưởng', r.nvF && !r.nvF.groupIds.includes('grp_bulk') && !r.nvF.perms.paymentManage, JSON.stringify(r.nvF));
    record('(f) đã POST /api/data/users lưu thật', !!r.savedCall, JSON.stringify(r.savedCall));
    record('(f) có alert báo đã gán thành công', r.alerts.some(a => a.includes('Đã gán')), JSON.stringify(r.alerts));
  });

  await scenario('(g) applyUserBulkGroupAction("REMOVE"): gỡ nhiều người khỏi nhóm, reset permOverrides đúng luật savePermGroup()', async () => {
    const r = await page.evaluate(async () => {
      window.__fetchCalls.length = 0;
      DB.permGroups = [{ id: 'grp_rm', name: 'Nhóm Remove', perms: { paymentManage: true }, reportExtraKeys: [] }];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.g', name: 'Nhân Viên G', dept: 'Kinh Doanh', perms: { paymentManage: true }, groupIds: ['grp_rm'], permOverrides: { carDispatch: true }, active: true },
      ];
      renderUsers();
      gmsAdd('userBulkPeoplePicker', 'nv.g');
      document.getElementById('userBulkGroupSelect').value = 'grp_rm';
      await applyUserBulkGroupAction('REMOVE');
      return { nvG: DB.users.find(u => u.username === 'nv.g') };
    });
    record('(g) nv.g đã bị gỡ khỏi nhóm', r.nvG && !r.nvG.groupIds.includes('grp_rm'), JSON.stringify(r.nvG));
    record('(g) permOverrides reset về null (đúng luật đổi tập nhóm của savePermGroup())', r.nvG && r.nvG.permOverrides === null, JSON.stringify(r.nvG));
  });

  await scenario('(h) applyUserBulkGroupAction(): chưa chọn ai -> báo lỗi, KHÔNG gọi lưu', async () => {
    const r = await page.evaluate(async () => {
      window.__fetchCalls.length = 0;
      window.__alerts.length = 0;
      DB.permGroups = [{ id: 'grp_x', name: 'Nhóm X', perms: {}, reportExtraKeys: [] }];
      DB.users = [{ id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true }];
      renderUsers();
      await applyUserBulkGroupAction('ADD');
      return { alerts: window.__alerts.slice(), savedCall: window.__fetchCalls.find(c => c.url === '/api/data/users') };
    });
    record('(h) báo "Chưa chọn người dùng nào."', r.alerts.some(a => a.includes('Chưa chọn người dùng')), JSON.stringify(r.alerts));
    record('(h) KHÔNG gọi lưu', !r.savedCall, JSON.stringify(r.savedCall));
  });

  await scenario('(i) LỖI ĐÃ VÁ: renderUsers() chạy lại (đổi trang/lọc bảng) KHÔNG còn làm mất lựa chọn người dùng đang chọn ở ô tìm-kiếm', async () => {
    const r = await page.evaluate(() => {
      DB.permGroups = [];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.h', name: 'Nhân Viên H', dept: 'Kinh Doanh', perms: {}, groupIds: [], permOverrides: null, active: true },
      ];
      renderUsers();
      gmsAdd('userBulkPeoplePicker', 'nv.h');
      const barVisibleAfterSelect = !document.getElementById('userBulkActionBar').classList.contains('hidden');
      renderUsers(); // render lại (VD đổi trang/lọc bảng Người Dùng) — KHÔNG được mất lựa chọn đang có
      const stillSelected = getMultiSelectValues('userBulkPeoplePicker');
      const barVisibleAfterRerender = !document.getElementById('userBulkActionBar').classList.contains('hidden');
      return { barVisibleAfterSelect, stillSelected, barVisibleAfterRerender };
    });
    record('(i) thanh hành động hiện ra khi có người được chọn', r.barVisibleAfterSelect === true, JSON.stringify(r));
    record('(i) renderUsers() lại vẫn GIỮ NGUYÊN người đã chọn (nv.h)', Array.isArray(r.stillSelected) && r.stillSelected.includes('nv.h'), JSON.stringify(r));
    record('(i) thanh hành động vẫn hiện sau khi renderUsers() lại', r.barVisibleAfterRerender === true, JSON.stringify(r));
  });

  await scenario('(j) chọn nhiều người liên tiếp qua ô tìm-kiếm -> đếm đúng số lượng, bỏ chọn 1 người thì đếm giảm đúng', async () => {
    const r = await page.evaluate(() => {
      DB.permGroups = [];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.i', name: 'Nhân Viên I', dept: 'Kinh Doanh', perms: {}, groupIds: [], permOverrides: null, active: true },
        { id: 3, username: 'nv.j', name: 'Nhân Viên J', dept: 'Kinh Doanh', perms: {}, groupIds: [], permOverrides: null, active: true },
      ];
      renderUsers();
      gmsAdd('userBulkPeoplePicker', 'nv.i');
      gmsAdd('userBulkPeoplePicker', 'nv.j');
      const countAfterTwo = document.getElementById('userBulkSelectedCount').innerText;
      gmsRemove('userBulkPeoplePicker', 'nv.i');
      const countAfterRemoveOne = document.getElementById('userBulkSelectedCount').innerText;
      const remaining = getMultiSelectValues('userBulkPeoplePicker');
      return { countAfterTwo, countAfterRemoveOne, remaining };
    });
    record('(j) đếm đúng số lượng đã chọn (2)', r.countAfterTwo === '2', JSON.stringify(r));
    record('(j) bỏ chọn 1 người -> đếm giảm còn 1', r.countAfterRemoveOne === '1', JSON.stringify(r));
    record('(j) người còn lại đúng là nv.j', JSON.stringify(r.remaining) === JSON.stringify(['nv.j']), JSON.stringify(r));
  });

  await browser.close();
  server.close();

  const failedCount = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failedCount} passed, ${failedCount} failed`);
  process.exit(failedCount > 0 ? 1 : 0);
})().catch(err => {
  console.error('Lỗi không mong muốn:', err);
  process.exit(1);
});
