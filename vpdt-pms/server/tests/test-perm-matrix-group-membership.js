#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression suite: khối ảo "Nhóm Phân Quyền (Thành Viên)" ở Ma Trận Phân Quyền (11/2026, theo yêu cầu
// người dùng kèm ảnh chụp Sửa Nhanh Trên Web: "chỗ ma trận phân quyền này thêm phần người dùng thì chọn
// được nhóm phân quyền đã được định nghĩa rồi... import và export bằng file excel để gán nhiều người vào
// các nhóm đã tạo") — xem public/js/module-admin-permgroups.js:
//   - pmQuickEditAllGroupNames()/pmQuickEditColumnsForGroup()/pmQuickEditCellChecked(): khối ảo
//     PM_QUICK_EDIT_GROUPS_BLOCK chỉ hiện ở chế độ Người Dùng, mỗi "cột" là 1 Nhóm Phân Quyền đã tạo.
//   - savePmQuickEdit(): tick/bỏ tick -> dựng lại cột "NhomPhanQuyen" (danh sách tên cách nhau ';') rồi
//     tái dùng NGUYÊN buildPermMatrixRowChanges() để cascade quyền nền đúng luật cũ (mergeGroupsBasePerms/
//     diffPerms/mergePerms) — KHÔNG viết lại logic cascade 1 lần nữa.
//   - buildPermMatrixGroupMembershipSheet(): sheet Excel riêng, 1 cột Y/N/nhóm (tiền tố "Nhóm: ").
//   - buildPermMatrixRowChanges(): đọc lại cột "Nhóm: X" (ưu tiên hơn "NhomPhanQuyen" cũ nếu CẢ 2 cùng có
//     mặt) — xác nhận KHÔNG phá vỡ đường Excel "NhomPhanQuyen" cũ khi sheet mới không có trong file.
//
// Run: node server/tests/test-perm-matrix-group-membership.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8997;

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
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' });
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
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));
  await page.waitForTimeout(150);

  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.__fetchCalls = [];
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      let bodyParsed = null;
      try { bodyParsed = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) { /* ignore */ }
      window.__fetchCalls.push({ url: String(url), method, body: bodyParsed });
      return { ok: true, status: 200, json: async () => ({ ok: true, version: '2' }) };
    };
    DB.depts = ['Phòng Kế Toán'];
    DB.stores = [];
    DB.jobTitles = [];
    DB.users = [{ id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true }];
    DB.permGroups = [];
    finishLogin(DB.users[0]);
  });

  await scenario('(a) pmQuickEditAllGroupNames(): khối ảo "Nhóm Phân Quyền (Thành Viên)" chỉ hiện ở chế độ Người Dùng và khi có ít nhất 1 nhóm', async () => {
    const r = await page.evaluate(() => {
      DB.permGroups = [{ id: 'g1', name: 'Nhóm Kế Toán', perms: { licenseApprove: true }, reportExtraKeys: [] }];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.a', name: 'Nhân Viên A', perms: { admin: false }, groupIds: [], permOverrides: null, active: true }
      ];
      pmQuickEditKind = 'users';
      const namesUsers = pmQuickEditAllGroupNames();
      pmQuickEditKind = 'groups';
      const namesGroups = pmQuickEditAllGroupNames();
      pmQuickEditKind = 'users';
      DB.permGroups = [];
      const namesNoGroups = pmQuickEditAllGroupNames();
      return { namesUsers, namesGroups, namesNoGroups };
    });
    record('(a) chế độ Người Dùng + có nhóm -> khối ảo đứng ĐẦU danh sách', r.namesUsers[0] === 'Nhóm Phân Quyền (Thành Viên)', JSON.stringify(r));
    record('(a) chế độ Nhóm Phân Quyền -> KHÔNG có khối ảo (1 nhóm không thể là thành viên của nhóm khác)', !r.namesGroups.includes('Nhóm Phân Quyền (Thành Viên)'), JSON.stringify(r));
    record('(a) chưa có Nhóm Phân Quyền nào -> KHÔNG hiện khối ảo', !r.namesNoGroups.includes('Nhóm Phân Quyền (Thành Viên)'), JSON.stringify(r));
  });

  await scenario('(b) Chọn khối ảo -> mỗi cột là 1 Nhóm Phân Quyền đã tạo, tick đúng theo groupIds hiện có, admin bị khoá ô', async () => {
    const r = await page.evaluate(() => {
      DB.permGroups = [
        { id: 'g1', name: 'Nhóm Kế Toán', perms: {}, reportExtraKeys: [] },
        { id: 'g2', name: 'Nhóm Kho Vận', perms: {}, reportExtraKeys: [] }
      ];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.a', name: 'Nhân Viên A', perms: { admin: false }, groupIds: ['g1'], permOverrides: null, active: true, reportExtraKeys: [] }
      ];
      pmQuickEditKind = 'users';
      pmQuickEditGroupKey = 'Nhóm Phân Quyền (Thành Viên)';
      renderPmQuickEditGroupSelect();
      renderPmQuickEditTable();
      const headerText = document.getElementById('pmQuickEditTableHead').textContent;
      const adminCbG1 = document.querySelector('input[data-pm-quick-cell][data-entity="admin"]');
      const nvCbG1 = document.querySelector('input[data-pm-quick-cell][data-entity="nv.a"][data-key="__pmgroup__g1"]');
      const nvCbG2 = document.querySelector('input[data-pm-quick-cell][data-entity="nv.a"][data-key="__pmgroup__g2"]');
      return {
        headerHasG1: headerText.includes('Nhóm Kế Toán'),
        headerHasG2: headerText.includes('Nhóm Kho Vận'),
        adminDisabled: adminCbG1 ? adminCbG1.disabled : null,
        nvG1Checked: nvCbG1 ? nvCbG1.checked : null,
        nvG2Checked: nvCbG2 ? nvCbG2.checked : null
      };
    });
    record('(b) header hiện đúng tên 2 Nhóm Phân Quyền đã tạo (không phải khoá nội bộ)', r.headerHasG1 && r.headerHasG2, JSON.stringify(r));
    record('(b) ô "admin" bị khoá (không sửa được)', r.adminDisabled === true, JSON.stringify(r));
    record('(b) nv.a đang thuộc "Nhóm Kế Toán" -> ô tương ứng đã tick sẵn', r.nvG1Checked === true, JSON.stringify(r));
    record('(b) nv.a KHÔNG thuộc "Nhóm Kho Vận" -> ô tương ứng KHÔNG tick', r.nvG2Checked === false, JSON.stringify(r));
  });

  await scenario('(c) savePmQuickEdit(): tick thêm 1 nhóm cho người -> groupIds + quyền nền cascade đúng, người khác không bị ảnh hưởng', async () => {
    const r = await page.evaluate(async () => {
      window.__fetchCalls.length = 0;
      DB.permGroups = [
        { id: 'g1', name: 'Nhóm Kế Toán', perms: { licenseApprove: true }, reportExtraKeys: [] },
        { id: 'g2', name: 'Nhóm Kho Vận', perms: { paymentManage: true }, reportExtraKeys: [] }
      ];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.a', name: 'Nhân Viên A', perms: { admin: false }, groupIds: [], permOverrides: null, active: true, reportExtraKeys: [] },
        { id: 3, username: 'nv.b', name: 'Nhân Viên B', perms: { admin: false }, groupIds: [], permOverrides: null, active: true, reportExtraKeys: [] }
      ];
      pmQuickEditKind = 'users';
      pmQuickEditGroupKey = 'Nhóm Phân Quyền (Thành Viên)';
      renderPmQuickEditTable();
      const cb = document.querySelector('input[data-pm-quick-cell][data-entity="nv.a"][data-key="__pmgroup__g2"]');
      cb.checked = true;
      await savePmQuickEdit();
      const nvAAfter = DB.users.find(u => u.username === 'nv.a');
      const nvBAfter = DB.users.find(u => u.username === 'nv.b');
      return {
        nvAGroupIds: nvAAfter.groupIds,
        nvAPaymentManage: nvAAfter.perms.paymentManage,
        nvBGroupIds: nvBAfter.groupIds,
        savedUsers: window.__fetchCalls.some(c => c.url === '/api/data/users' && c.method === 'POST')
      };
    });
    record('(c) nv.a được thêm vào "Nhóm Kho Vận" (groupIds có "g2")', r.nvAGroupIds.includes('g2'), JSON.stringify(r));
    record('(c) quyền nền của nhóm mới được cascade ngay (paymentManage=true)', r.nvAPaymentManage === true, JSON.stringify(r));
    record('(c) nv.b (không tick gì) hoàn toàn không bị ảnh hưởng', r.nvBGroupIds.length === 0, JSON.stringify(r));
    record('(c) đã lưu thật qua POST /api/data/users', r.savedUsers, JSON.stringify(r));
  });

  await scenario('(d) savePmQuickEdit(): bỏ tick -> gỡ khỏi nhóm; KHÔNG tự thu hồi quyền hiện có (giữ nguyên làm quyền cá nhân — khớp ĐÚNG hành vi applyUserBulkGroupAction()/buildPermMatrixRowChanges() hiện có khi gỡ hết nhóm, không phải bug)', async () => {
    const r = await page.evaluate(async () => {
      window.__fetchCalls.length = 0;
      DB.permGroups = [{ id: 'g1', name: 'Nhóm Kế Toán', perms: { licenseApprove: true }, reportExtraKeys: [] }];
      DB.users = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.c', name: 'Nhân Viên C', perms: { admin: false, licenseApprove: true }, groupIds: ['g1'], permOverrides: null, active: true, reportExtraKeys: [] }
      ];
      pmQuickEditKind = 'users';
      pmQuickEditGroupKey = 'Nhóm Phân Quyền (Thành Viên)';
      renderPmQuickEditTable();
      const cb = document.querySelector('input[data-pm-quick-cell][data-entity="nv.c"][data-key="__pmgroup__g1"]');
      cb.checked = false;
      await savePmQuickEdit();
      const nvCAfter = DB.users.find(u => u.username === 'nv.c');
      return { groupIds: nvCAfter.groupIds, licenseApprove: nvCAfter.perms.licenseApprove };
    });
    record('(d) nv.c bị gỡ khỏi "Nhóm Kế Toán" (groupIds rỗng)', r.groupIds.length === 0, JSON.stringify(r));
    // Không có nhóm nào -> groupBase=null -> buildPermMatrixRowChanges() GIỮ NGUYÊN formPerms làm newPerms
    // (không có nền nào để diff/revoke) — ĐÚNG khớp hành vi applyUserBulkGroupAction() hiện có (REMOVE hết
    // nhóm vẫn giữ nguyên u.perms, chỉ reset permOverrides) — không phải bug, chỉ gỡ GROUPID, quyền hiện
    // có trở thành quyền cá nhân độc lập, muốn tắt hẳn phải tự tắt tay qua khối quyền thường/Sửa Người Dùng.
    record('(d) quyền hiện có KHÔNG tự mất khi gỡ hết nhóm (giữ nguyên làm quyền cá nhân, khớp applyUserBulkGroupAction())', r.licenseApprove === true, JSON.stringify(r));
  });

  await scenario('(e) buildPermMatrixGroupMembershipSheet(): sheet Y/N đúng groupIds hiện có, trả về null khi chưa có Nhóm Phân Quyền nào', async () => {
    const r = await page.evaluate(() => {
      DB.permGroups = [
        { id: 'g2', name: 'Nhóm B', perms: {}, reportExtraKeys: [] },
        { id: 'g1', name: 'Nhóm A', perms: {}, reportExtraKeys: [] }
      ];
      DB.users = [
        { id: 1, username: 'nv.x', name: 'NV X', dept: 'Phòng Kế Toán', groupIds: ['g1'], perms: {} },
        { id: 2, username: 'nv.y', name: 'NV Y', dept: 'Phòng Kế Toán', groupIds: [], perms: {} }
      ];
      const sheet = buildPermMatrixGroupMembershipSheet();
      DB.permGroups = [];
      const sheetEmpty = buildPermMatrixGroupMembershipSheet();
      return { sheet, sheetEmpty };
    });
    record('(e) tên sheet = khối ảo', r.sheet.sheetName === 'Nhóm Phân Quyền (Thành Viên)', JSON.stringify(r.sheet.sheetName));
    record('(e) cột sắp theo bảng chữ cái tên nhóm (Nhóm A trước Nhóm B dù id ngược lại)',
      r.sheet.columns.some((c, i) => c.header === 'Nhóm: Nhóm A' && r.sheet.columns[i + 1].header === 'Nhóm: Nhóm B'), JSON.stringify(r.sheet.columns));
    const rowX = r.sheet.rows.find(row => row.Username === 'nv.x');
    const rowY = r.sheet.rows.find(row => row.Username === 'nv.y');
    record('(e) nv.x (thuộc Nhóm A) -> cột "Nhóm: Nhóm A"=Y, "Nhóm: Nhóm B"=N', rowX['Nhóm: Nhóm A'] === 'Y' && rowX['Nhóm: Nhóm B'] === 'N', JSON.stringify(rowX));
    record('(e) nv.y (không thuộc nhóm nào) -> cả 2 cột đều N', rowY['Nhóm: Nhóm A'] === 'N' && rowY['Nhóm: Nhóm B'] === 'N', JSON.stringify(rowY));
    record('(e) chưa có Nhóm Phân Quyền nào -> trả về null (không xuất sheet rỗng vô nghĩa)', r.sheetEmpty === null, JSON.stringify(r.sheetEmpty));
  });

  await scenario('(f) buildPermMatrixRowChanges(): đọc cột "Nhóm: X" Y/N -> tính đúng newGroupIds + cascade, ƯU TIÊN hơn cột "NhomPhanQuyen" cũ nếu cả 2 cùng có mặt', async () => {
    const r = await page.evaluate(() => {
      DB.permGroups = [
        { id: 'g1', name: 'Nhóm A', perms: { licenseApprove: true }, reportExtraKeys: [] },
        { id: 'g2', name: 'Nhóm B', perms: { paymentManage: true }, reportExtraKeys: [] }
      ];
      const target = { username: 'nv.z', groupIds: ['g1'], perms: {}, permOverrides: null };
      // Hàng Excel từ sheet MỚI: tick "Nhóm B", bỏ tick "Nhóm A" — CÒN cột "NhomPhanQuyen" cũ (nếu admin
      // giữ lại sheet khối-quyền khác trong CÙNG file) vẫn ghi "Nhóm A" (CHƯA kịp sửa tay cột đó) — phải
      // ưu tiên cột "Nhóm: X" mới, không được lẫn lộn với cột cũ.
      const row = { 'Nhóm: Nhóm A': 'N', 'Nhóm: Nhóm B': 'Y', NhomPhanQuyen: 'Nhóm A' };
      const diff = buildPermMatrixRowChanges('users', target, row);
      return { newGroupIds: diff.newGroupIds, newPerms: diff.newPerms, changes: diff.changes };
    });
    record('(f) newGroupIds = ["g2"] (ưu tiên cột "Nhóm: X" mới, bỏ qua NhomPhanQuyen cũ)', JSON.stringify(r.newGroupIds) === JSON.stringify(['g2']), JSON.stringify(r));
    record('(f) quyền nền cascade đúng theo Nhóm B (paymentManage=true, licenseApprove mất)', r.newPerms.paymentManage === true && !r.newPerms.licenseApprove, JSON.stringify(r.newPerms));
    record('(f) có ghi nhận thay đổi "Nhóm Phân Quyền" trong preview', r.changes.some(c => c.label === 'Nhóm Phân Quyền'), JSON.stringify(r.changes));
  });

  await scenario('(g) buildPermMatrixRowChanges(): KHÔNG có cột "Nhóm: X" nào (file cũ/sheet khối-quyền thường) -> vẫn dùng "NhomPhanQuyen" như trước (tương thích ngược)', async () => {
    const r = await page.evaluate(() => {
      DB.permGroups = [{ id: 'g1', name: 'Nhóm A', perms: { licenseApprove: true }, reportExtraKeys: [] }];
      const target = { username: 'nv.w', groupIds: [], perms: {}, permOverrides: null };
      const row = { Q_licenseApprove: 'N', NhomPhanQuyen: 'Nhóm A' };
      const diff = buildPermMatrixRowChanges('users', target, row);
      return { newGroupIds: diff.newGroupIds };
    });
    record('(g) vẫn đọc đúng "NhomPhanQuyen" khi không có cột "Nhóm: X" nào trong dòng', JSON.stringify(r.newGroupIds) === JSON.stringify(['g1']), JSON.stringify(r));
  });

  record('Không có lỗi JS (pageerror) nào phát sinh trong toàn bộ test', jsErrors.length === 0, JSON.stringify(jsErrors));

  await browser.close();
  await server.close();

  const failed = results.filter(r => !r.pass).length;
  console.log(failed ? `\n${results.length - failed}/${results.length} scenario(s) passed, ${failed} FAILED` : `\n==== ${results.length}/${results.length} scenario(s) passed ====`);
  if (failed) process.exitCode = 1;
})();
