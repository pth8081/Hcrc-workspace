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
// applyUserBulkGroupAction() như UI thật gọi qua data-op — CÓ thao tác trên DOM thật (checkbox trong
// bảng render), khác các test buildPermMatrixRowChanges() thuần logic đã có.
//
// Phủ đúng các điểm THIẾT KẾ cốt lõi cần xác minh:
//   - Sửa Nhanh Trên Web: bảng chỉ hiện đúng cột của 1 "khối" đang chọn, tick đúng ô -> lưu đúng, tài
//     khoản "admin" gốc không có checkbox (không sửa được).
//   - Sửa Nhanh Trên Web (Nhóm): sửa quyền nhóm CASCADE ngay cho thành viên, giống hệt đường Excel.
//   - Không có thay đổi nào thì không gọi lưu, không báo "đã lưu".
//   - Bulk gán/gỡ Nhóm: chọn nhiều dòng -> ADD/REMOVE đúng, permOverrides reset đúng luật savePermGroup(),
//     người không được chọn không bị ảnh hưởng, tài khoản "admin" không có checkbox chọn.
//   - renderUsers() reset lại trạng thái chọn hàng loạt sau mỗi lần render lại (đổi trang/lọc).
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
        { id: 2, username: 'nv.a', name: 'Nhân Viên A', perms: { admin: false, contractApprove: true }, groupIds: [], permOverrides: null, active: true, reportExtraKeys: [] },
      ];
      togglePermMatrixQuickEdit(); // mở (tự chọn khối mặc định — sẽ ghi đè lại đúng khối cần test ngay dưới)
      const wrapHiddenAfterOpen = document.getElementById('permMatrixQuickEditWrap').classList.contains('hidden');
      // Chọn đúng khối chứa "contractApprove" (permMatrixColumnGroup('contractApprove')) — gán thẳng
      // biến + gọi lại render tay (KHÔNG qua onPmQuickEditGroupChange(), hàm đó đọc NGƯỢC lại giá trị từ
      // <select> DOM nên sẽ ghi đè mất giá trị vừa gán tay ở đây).
      pmQuickEditKind = 'users';
      const targetGroup = permMatrixColumnGroup('contractApprove');
      pmQuickEditGroupKey = targetGroup;
      renderPmQuickEditGroupSelect();
      renderPmQuickEditTable();
      const wrapHidden = wrapHiddenAfterOpen;
      const adminCb = document.querySelector(`input[data-pm-quick-cell][data-entity="admin"][data-key="contractApprove"]`);
      const nvCb = document.querySelector(`input[data-pm-quick-cell][data-entity="nv.a"][data-key="contractApprove"]`);
      return {
        wrapHidden, targetGroup,
        adminDisabled: adminCb ? adminCb.disabled : null,
        nvChecked: nvCb ? nvCb.checked : null,
        headerText: document.getElementById('pmQuickEditTableHead').textContent,
      };
    });
    record('(a) bảng Sửa Nhanh hiện ra (không còn hidden)', r.wrapHidden === false, JSON.stringify(r));
    record('(a) ô "admin" bị disabled (không sửa được qua bảng này)', r.adminDisabled === true, JSON.stringify(r));
    record('(a) ô "nv.a" phản ánh ĐÚNG perms.contractApprove=true hiện có (đã tick sẵn)', r.nvChecked === true, JSON.stringify(r));
    record('(a) header bảng có chứa nhãn tiếng Việt của quyền (không phải "Q_contractApprove" thô)',
      r.headerText.includes('Duyệt hợp đồng'), JSON.stringify(r));
  });

  await scenario('(b) savePmQuickEdit(): tick đổi 1 ô -> lưu đúng, không đụng quyền khác, gọi POST /api/data/users', async () => {
    const r = await page.evaluate(async () => {
      window.__fetchCalls.length = 0;
      DB.permGroups = [];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.a', name: 'Nhân Viên A', perms: { admin: false, contractApprove: false, paymentManage: true }, groupIds: [], permOverrides: null, active: true, reportExtraKeys: [] },
      ];
      pmQuickEditKind = 'users';
      pmQuickEditGroupKey = permMatrixColumnGroup('contractApprove');
      renderPmQuickEditGroupSelect();
      renderPmQuickEditTable();
      const cb = document.querySelector(`input[data-pm-quick-cell][data-entity="nv.a"][data-key="contractApprove"]`);
      cb.checked = true; // tick lên (trước đó false)
      await savePmQuickEdit();
      const nvAfter = DB.users.find(u => u.username === 'nv.a');
      return {
        nvAfter,
        savedCall: window.__fetchCalls.find(c => c.url === '/api/data/users' && c.method === 'POST'),
        alerts: window.__alerts.slice(),
      };
    });
    record('(b) contractApprove đã bật đúng như tick', r.nvAfter && r.nvAfter.perms.contractApprove === true, JSON.stringify(r.nvAfter));
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
        { id: 2, username: 'nv.b', name: 'Nhân Viên B', perms: { admin: false, contractApprove: true }, groupIds: [], permOverrides: null, active: true, reportExtraKeys: [] },
      ];
      pmQuickEditKind = 'users';
      pmQuickEditGroupKey = permMatrixColumnGroup('contractApprove');
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
      DB.permGroups = [{ id: 'grp_Q', name: 'Nhóm Quick', perms: { contractApprove: false }, reportExtraKeys: [] }];
      DB.users = [
        { id: 10, username: 'member.q', name: 'Thành Viên Q', perms: { contractApprove: false }, groupIds: ['grp_Q'], permOverrides: null, active: true },
        { id: 11, username: 'other.q', name: 'Không Thuộc Nhóm', perms: { contractApprove: false }, groupIds: [], permOverrides: null, active: true },
      ];
      pmQuickEditKind = 'groups';
      pmQuickEditGroupKey = permMatrixColumnGroup('contractApprove');
      renderPmQuickEditTable();
      const cb = document.querySelector(`input[data-pm-quick-cell][data-entity="Nhóm Quick"][data-key="contractApprove"]`);
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
    record('(d) quyền nhóm được cập nhật', r.groupAfter && r.groupAfter.perms.contractApprove === true, JSON.stringify(r.groupAfter));
    record('(d) thành viên của nhóm được cascade NGAY', r.memberAfter && r.memberAfter.perms.contractApprove === true, JSON.stringify(r.memberAfter));
    record('(d) người KHÔNG thuộc nhóm không bị ảnh hưởng', r.otherAfter && r.otherAfter.perms.contractApprove === false, JSON.stringify(r.otherAfter));
    record('(d) đã lưu CẢ permGroups LẪN users (vì có cascade)', r.calledUsersSync && r.calledGroupsSync, JSON.stringify(r));
  });

  // ==========================================================================
  // (B) GÁN/GỠ NHÓM PHÂN QUYỀN HÀNG LOẠT TỪ DANH SÁCH NGƯỜI DÙNG
  // ==========================================================================
  await scenario('(e) renderUsers(): admin KHÔNG có checkbox chọn hàng loạt, người thường thì có', async () => {
    const r = await page.evaluate(() => {
      DB.permGroups = [];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.c', name: 'Nhân Viên C', dept: 'Kinh Doanh', perms: { admin: false }, groupIds: [], permOverrides: null, active: true },
      ];
      renderUsers();
      return {
        adminHasCb: !!document.querySelector('#userRow_1 .user-bulk-select-cb'),
        nvHasCb: !!document.querySelector('#userRow_2 .user-bulk-select-cb'),
      };
    });
    record('(e) dòng "admin" KHÔNG có checkbox chọn hàng loạt', r.adminHasCb === false, JSON.stringify(r));
    record('(e) dòng người thường CÓ checkbox chọn hàng loạt', r.nvHasCb === true, JSON.stringify(r));
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
      document.querySelector('#userRow_2 .user-bulk-select-cb').checked = true;
      document.querySelector('#userRow_3 .user-bulk-select-cb').checked = true;
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
      document.querySelector('#userRow_2 .user-bulk-select-cb').checked = true;
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

  await scenario('(i) renderUsers() reset lại thanh hành động + bỏ tick "Chọn tất cả" mỗi lần render lại', async () => {
    const r = await page.evaluate(() => {
      DB.permGroups = [];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.h', name: 'Nhân Viên H', dept: 'Kinh Doanh', perms: {}, groupIds: [], permOverrides: null, active: true },
      ];
      renderUsers();
      document.querySelector('#userRow_2 .user-bulk-select-cb').checked = true;
      onUserBulkSelectChange();
      const barVisibleAfterTick = !document.getElementById('userBulkActionBar').classList.contains('hidden');
      renderUsers(); // render lại (VD đổi trang/lọc) — phải reset về ẩn
      const barHiddenAfterRerender = document.getElementById('userBulkActionBar').classList.contains('hidden');
      return { barVisibleAfterTick, barHiddenAfterRerender };
    });
    record('(i) thanh hành động hiện ra khi có tick', r.barVisibleAfterTick === true, JSON.stringify(r));
    record('(i) renderUsers() lại thì thanh hành động ẩn về lại (không giữ trạng thái ảo)', r.barHiddenAfterRerender === true, JSON.stringify(r));
  });

  await scenario('(j) toggleUserBulkSelectAll(): tick "Chọn tất cả" chọn hết mọi dòng đang hiển thị', async () => {
    const r = await page.evaluate(() => {
      DB.permGroups = [];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.i', name: 'Nhân Viên I', dept: 'Kinh Doanh', perms: {}, groupIds: [], permOverrides: null, active: true },
        { id: 3, username: 'nv.j', name: 'Nhân Viên J', dept: 'Kinh Doanh', perms: {}, groupIds: [], permOverrides: null, active: true },
      ];
      renderUsers();
      document.getElementById('userBulkSelectAll').checked = true;
      toggleUserBulkSelectAll();
      const allChecked = [...document.querySelectorAll('.user-bulk-select-cb')].every(cb => cb.checked);
      const count = document.getElementById('userBulkSelectedCount').innerText;
      return { allChecked, count };
    });
    record('(j) mọi dòng (trừ admin, không có checkbox) đều được tick', r.allChecked === true, JSON.stringify(r));
    record('(j) đếm đúng số lượng đã chọn (2)', r.count === '2', JSON.stringify(r));
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
