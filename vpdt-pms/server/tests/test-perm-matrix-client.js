#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression suite: Ma Trận Phân Quyền — client-side (10/2026), xem
// public/js/module-admin-permgroups.js (khối "MA TRẬN PHÂN QUYỀN" ở cuối file)
// + public/js/core.js::getEffectiveReportExtraKeys().
//
// Test THUẦN CLIENT qua Playwright (cùng khuôn tests/test-admin-users-permgroups.js
// — sandbox này không có SQL Server thật): serve public/index.html tĩnh, stub
// window.fetch/alert/confirm, hand-seed DB.users/DB.permGroups, gọi thẳng các hàm
// flattenPermsForMatrix()/collectPermMatrixColumns()/buildPermMatrixRowChanges()/
// onPermMatrixImportFileChange()/confirmPermMatrixImport() như UI thật gọi qua data-op.
//
// Phủ đúng các điểm THIẾT KẾ cốt lõi cần xác minh:
//   - cột ma trận SINH ĐỘNG theo dữ liệu thật (không hard-code), loại khoá nào có
//     giá trị KHÔNG PHẢI boolean ở BẤT KỲ ai/nhóm nào.
//   - import Người Dùng: đổi perms + NhomPhanQuyen (groupIds) + BaoCao_MucBoSung
//     (reportExtraKeys) đúng, dòng không tìm thấy/trùng bị loại khỏi preview.
//   - import Nhóm Phân Quyền: đổi quyền nhóm CASCADE ngay cho mọi thành viên hiện có
//     (giữ permOverrides riêng), giống savePermGroup().
//   - tài khoản "admin" gốc bị bỏ qua khi import Người Dùng.
//   - getEffectiveReportExtraKeys() gộp đúng quyền riêng + quyền của mọi nhóm.
//
// Run: node server/tests/test-perm-matrix-client.js
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
  // (a) collectPermMatrixColumns(): cột sinh động, loại khoá có giá trị KHÔNG
  //     PHẢI boolean ở BẤT KỲ ai (VD approverAuthLevel là chuỗi, docDownload là {all,depts}).
  // ==========================================================================
  await scenario('(a) collectPermMatrixColumns() chỉ lấy khoá boolean-only, loại khoá lẫn kiểu khác', async () => {
    const r = await page.evaluate(() => {
      const permsList = [
        { admin: true, contractApprove: false, approverAuthLevel: 'PIN', docDownload: { all: true, depts: [] } },
        { admin: false, contractApprove: true, approverAuthLevel: 'NONE', docDownload: { all: false, depts: ['Kế Toán'] } },
      ];
      return collectPermMatrixColumns(permsList);
    });
    record('(a) có đúng "admin" và "contractApprove" (boolean ở mọi người)',
      r.includes('admin') && r.includes('contractApprove'), JSON.stringify(r));
    record('(a) KHÔNG có "approverAuthLevel" (chuỗi enum, không phải boolean)',
      !r.includes('approverAuthLevel'), JSON.stringify(r));
    record('(a) CÓ "docDownload.all" (phần boolean của quyền phạm vi vẫn xuất được, theo thiết kế)',
      r.includes('docDownload.all'), JSON.stringify(r));
    record('(a) KHÔNG có "docDownload.depts" (mảng, không phải boolean — phần phạm vi cụ thể vẫn phải sửa tay)',
      !r.includes('docDownload.depts'), JSON.stringify(r));
  });

  await scenario('(a2) flattenPermsForMatrix() phẳng hoá đúng dot-path lồng nhau (moduleAccess.*)', async () => {
    const r = await page.evaluate(() => {
      return flattenPermsForMatrix({ admin: true, moduleAccess: { hanhchinh: { car: true, room: false } } });
    });
    record('(a2) flatten đúng "moduleAccess.hanhchinh.car"/"moduleAccess.hanhchinh.room"',
      r['moduleAccess.hanhchinh.car'] === true && r['moduleAccess.hanhchinh.room'] === false && r.admin === true,
      JSON.stringify(r));
  });

  // ==========================================================================
  // (b) buildPermMatrixRowChanges(): diff đúng perms/groupIds/reportExtraKeys.
  // ==========================================================================
  await scenario('(b) buildPermMatrixRowChanges() phát hiện đúng thay đổi quyền + nhóm + báo cáo bổ sung', async () => {
    const r = await page.evaluate(() => {
      DB.permGroups = [{ id: 'grp_A', name: 'Nhóm A', perms: {} }, { id: 'grp_B', name: 'Nhóm B', perms: {} }];
      const user = { username: 'nv01', perms: { admin: false, contractApprove: false }, groupIds: ['grp_A'], reportExtraKeys: [] };
      const row = { Q_admin: 'TRUE', Q_contractApprove: 'FALSE', NhomPhanQuyen: 'Nhóm A;Nhóm B', BaoCao_MucBoSung: 'HANHCHINH_CAR' };
      const diff = buildPermMatrixRowChanges('users', user, row);
      return diff;
    });
    record('(b) phát hiện đúng 3 thay đổi (admin, Nhóm Phân Quyền, Báo Cáo bổ sung)',
      r.changes.length === 3, JSON.stringify(r));
    // contractApprove vắng mặt (không phải false tường minh) trong newPerms là ĐÚNG THIẾT KẾ, không phải
    // lỗi — diffPerms()/isEmptyPermValue() (core.js, dùng chung với saveUser()) cố tình KHÔNG ghi "false"
    // thành override khi nhóm không có field đó, để nhóm bật quyền này lên sau này vẫn tự thừa hưởng
    // được (không bị khoá cứng false vĩnh viễn) — !newPerms.contractApprove vẫn đúng "false" theo nghĩa.
    record('(b) newPerms.admin = true, contractApprove vẫn "không bật" (không đổi) — vắng mặt = false theo diffPerms()',
      r.newPerms.admin === true && !r.newPerms.contractApprove, JSON.stringify(r.newPerms));
    record('(b) newGroupIds gồm cả 2 nhóm (grp_A, grp_B)',
      JSON.stringify(r.newGroupIds.slice().sort()) === JSON.stringify(['grp_A', 'grp_B']), JSON.stringify(r.newGroupIds));
    record('(b) newReportExtraKeys = ["HANHCHINH_CAR"]',
      JSON.stringify(r.newReportExtraKeys) === JSON.stringify(['HANHCHINH_CAR']), JSON.stringify(r.newReportExtraKeys));
  });

  await scenario('(b2) buildPermMatrixRowChanges() không báo thay đổi gì khi dữ liệu y hệt hiện tại', async () => {
    const r = await page.evaluate(() => {
      const group = { name: 'Nhóm A', perms: { admin: true }, reportExtraKeys: ['X'] };
      const row = { Q_admin: 'TRUE', BaoCao_MucBoSung: 'X' };
      return buildPermMatrixRowChanges('groups', group, row);
    });
    record('(b2) không có thay đổi nào khi giá trị Excel khớp đúng dữ liệu hiện tại',
      r.changes.length === 0, JSON.stringify(r));
  });

  // ==========================================================================
  // (c) Import Người Dùng end-to-end: đọc file (mock route) -> preview -> confirm.
  // ==========================================================================
  await scenario('(c) Import Người Dùng: áp dụng đúng, bỏ qua dòng không tìm thấy, KHÔNG đổi "admin" gốc', async () => {
    const r = await page.evaluate(async () => {
      DB.permGroups = [{ id: 'grp_A', name: 'Nhóm A', perms: { paymentManage: true }, reportExtraKeys: [] }];
      DB.users = [
        { id: 1, username: 'admin', name: 'Admin', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.a', name: 'Nhân Viên A', perms: { admin: false }, groupIds: [], permOverrides: null, active: true, reportExtraKeys: [] },
      ];
      window.__fetchHandlers['POST /api/admin/perm-matrix/import-xlsx'] = () => ({
        status: 200,
        body: {
          rows: [
            { Username: 'admin', Q_admin: 'FALSE' }, // cố tình đổi admin -> phải bị BỎ QUA khi áp dụng
            { Username: 'nv.a', Q_admin: 'TRUE', NhomPhanQuyen: 'Nhóm A' },
            { Username: 'khong.ton.tai', Q_admin: 'TRUE' }, // không tìm thấy -> phải bị loại
          ],
        },
      });
      window.__fetchHandlers['POST /api/data/users'] = () => ({ status: 200, body: { ok: true, version: '2' } });

      // Giả 1 <input type=file>, gọi thẳng handler như data-op-change thật sẽ gọi (event giả với target.files/value).
      let fileInputValue = 'fake.xlsx';
      const fakeEvt = { target: { files: [{ name: 'fake.xlsx' }], set value(v) { fileInputValue = v; }, get value() { return fileInputValue; } } };
      await onPermMatrixImportFileChange(fakeEvt, 'users');

      const previewBefore = permMatrixImportRows.map(it => ({ identifier: it.identifier, found: it.found, include: it.include }));
      await confirmPermMatrixImport();

      const savedCall = window.__fetchCalls.find(c => c.url === '/api/data/users' && c.method === 'POST');
      const adminAfter = DB.users.find(u => u.username === 'admin');
      const nvAAfter = DB.users.find(u => u.username === 'nv.a');
      return { previewBefore, savedCall, adminAfter, nvAAfter, alerts: window.__alerts.slice() };
    });
    record('(c) preview: dòng "admin" và dòng không tồn tại KHÔNG được include mặc định',
      r.previewBefore.find(x => x.identifier === 'admin')?.include === false &&
      r.previewBefore.find(x => x.identifier === 'khong.ton.tai')?.found === false &&
      r.previewBefore.find(x => x.identifier === 'khong.ton.tai')?.include === false,
      JSON.stringify(r.previewBefore));
    record('(c) preview: dòng "nv.a" hợp lệ được include mặc định',
      r.previewBefore.find(x => x.identifier === 'nv.a')?.include === true, JSON.stringify(r.previewBefore));
    record('(c) tài khoản "admin" gốc KHÔNG bị đổi quyền qua Ma Trận (vẫn admin:true)',
      r.adminAfter && r.adminAfter.perms.admin === true, JSON.stringify(r.adminAfter));
    record('(c) "nv.a" được áp dụng đúng: admin=true + gán vào Nhóm A (kéo theo paymentManage=true)',
      r.nvAAfter && r.nvAAfter.perms.admin === true && r.nvAAfter.perms.paymentManage === true &&
      JSON.stringify(r.nvAAfter.groupIds) === JSON.stringify(['grp_A']),
      JSON.stringify(r.nvAAfter));
    record('(c) đã POST /api/data/users để lưu thật (không chỉ sửa DB.users trên bộ nhớ)',
      !!r.savedCall, JSON.stringify(r.savedCall));
  });

  // ==========================================================================
  // (d) Import Nhóm Phân Quyền: sửa quyền nhóm CASCADE ngay cho mọi thành viên hiện có.
  // ==========================================================================
  await scenario('(d) Import Nhóm Phân Quyền: sửa quyền nhóm cascade ngay cho thành viên, gọi syncStorage cả 2 collection', async () => {
    const r = await page.evaluate(async () => {
      DB.permGroups = [{ id: 'grp_B', name: 'Nhóm B', perms: { contractApprove: false }, reportExtraKeys: [] }];
      DB.users = [
        { id: 10, username: 'member1', name: 'Thành Viên 1', perms: { contractApprove: false }, groupIds: ['grp_B'], permOverrides: null, active: true },
        { id: 11, username: 'other', name: 'Không Thuộc Nhóm', perms: { contractApprove: false }, groupIds: [], permOverrides: null, active: true },
      ];
      window.__fetchHandlers['POST /api/admin/perm-matrix/import-xlsx'] = () => ({
        status: 200,
        body: { rows: [{ TenNhom: 'Nhóm B', Q_contractApprove: 'TRUE' }] },
      });
      window.__fetchHandlers['POST /api/data/permGroups'] = () => ({ status: 200, body: { ok: true, version: '2' } });
      window.__fetchHandlers['POST /api/data/users'] = () => ({ status: 200, body: { ok: true, version: '2' } });

      let fileInputValue = 'fake2.xlsx';
      const fakeEvt = { target: { files: [{ name: 'fake2.xlsx' }], set value(v) { fileInputValue = v; }, get value() { return fileInputValue; } } };
      await onPermMatrixImportFileChange(fakeEvt, 'groups');
      await confirmPermMatrixImport();

      return {
        groupAfter: DB.permGroups.find(g => g.id === 'grp_B'),
        member1After: DB.users.find(u => u.username === 'member1'),
        otherAfter: DB.users.find(u => u.username === 'other'),
        calledUsersSync: window.__fetchCalls.some(c => c.url === '/api/data/users' && c.method === 'POST'),
        calledGroupsSync: window.__fetchCalls.some(c => c.url === '/api/data/permGroups' && c.method === 'POST'),
      };
    });
    record('(d) quyền của nhóm được cập nhật (contractApprove=true)',
      r.groupAfter && r.groupAfter.perms.contractApprove === true, JSON.stringify(r.groupAfter));
    record('(d) THÀNH VIÊN của nhóm được cascade NGAY (contractApprove=true) không cần sửa tay',
      r.member1After && r.member1After.perms.contractApprove === true, JSON.stringify(r.member1After));
    record('(d) người KHÔNG thuộc nhóm không bị ảnh hưởng',
      r.otherAfter && r.otherAfter.perms.contractApprove === false, JSON.stringify(r.otherAfter));
    record('(d) đã gọi syncStorage lưu CẢ permGroups LẪN users (vì có cascade)',
      r.calledUsersSync && r.calledGroupsSync, JSON.stringify(r));
  });

  // ==========================================================================
  // (e) getEffectiveReportExtraKeys(): gộp đúng quyền riêng + quyền của mọi nhóm.
  // ==========================================================================
  await scenario('(e) getEffectiveReportExtraKeys() gộp đúng reportExtraKeys riêng + của nhóm, không trùng lặp', async () => {
    const r = await page.evaluate(() => {
      DB.permGroups = [
        { id: 'g1', name: 'G1', perms: {}, reportExtraKeys: ['A', 'B'] },
        { id: 'g2', name: 'G2', perms: {}, reportExtraKeys: ['B', 'C'] },
      ];
      const user = { reportExtraKeys: ['D'], groupIds: ['g1', 'g2'] };
      return getEffectiveReportExtraKeys(user).slice().sort();
    });
    record('(e) kết quả = A,B,C,D (gộp, khử trùng)', JSON.stringify(r) === JSON.stringify(['A', 'B', 'C', 'D']), JSON.stringify(r));
  });

  // ==========================================================================
  // (f) Nhãn tiếng Việt cho cột ma trận (10/2026, theo yêu cầu người dùng "đổi tên cột thành tiếng
  //     Việt ứng với hệ thống đang hiển thị") — permMatrixColumnHeader()/resolvePermMatrixColumnKey()
  //     phải là NGHỊCH ĐẢO của nhau cho khoá CÓ nhãn lẫn khoá KHÔNG có nhãn (quyền cũ/hiếm), và
  //     downloadPermMatrixUsers() phải xuất đúng header tiếng Việt thay vì "Q_<khoá>" thô.
  // ==========================================================================
  await scenario('(f) permMatrixColumnHeader()/resolvePermMatrixColumnKey() là nghịch đảo của nhau', async () => {
    const r = await page.evaluate(() => {
      const mappedKey = 'admin'; // chắc chắn có trong PERM_KEY_VN_LABELS
      const mappedHeader = permMatrixColumnHeader(mappedKey);
      const unmappedKey = 'khoaQuyenBiaDatKhongTonTai123';
      const unmappedHeader = permMatrixColumnHeader(unmappedKey);
      return {
        mappedHeader,
        mappedHeaderIsVietnamese: mappedHeader !== 'Q_admin' && !mappedHeader.startsWith('Q_'),
        mappedRoundTrip: resolvePermMatrixColumnKey(mappedHeader),
        unmappedHeader,
        unmappedHeaderIsRawFallback: unmappedHeader === 'Q_' + unmappedKey,
        unmappedRoundTrip: resolvePermMatrixColumnKey(unmappedHeader),
        legacyRawHeaderStillResolves: resolvePermMatrixColumnKey('Q_contractApprove'),
        nonPermColumnResolvesToNull: resolvePermMatrixColumnKey('Username'),
      };
    });
    record('(f) khoá có nhãn -> header là văn bản tiếng Việt thật (không phải "Q_admin" thô)',
      r.mappedHeaderIsVietnamese, JSON.stringify(r));
    record('(f) khoá có nhãn: permMatrixColumnHeader() rồi resolvePermMatrixColumnKey() quay lại đúng khoá gốc',
      r.mappedRoundTrip === 'admin', JSON.stringify(r));
    record('(f) khoá KHÔNG có nhãn (quyền lạ/cũ) -> vẫn fallback về đúng dạng "Q_<khoá>" cũ',
      r.unmappedHeaderIsRawFallback, JSON.stringify(r));
    record('(f) khoá không có nhãn vẫn round-trip đúng qua nhánh fallback "Q_"',
      r.unmappedRoundTrip === 'khoaQuyenBiaDatKhongTonTai123', JSON.stringify(r));
    record('(f) tương thích ngược: file cũ còn header "Q_<khoá>" thô (bản trước khi có nhãn) vẫn đọc được',
      r.legacyRawHeaderStillResolves === 'contractApprove', JSON.stringify(r));
    record('(f) cột không phải quyền (VD "Username") -> trả về null, không bị hiểu nhầm thành 1 khoá quyền',
      r.nonPermColumnResolvesToNull === null, JSON.stringify(r));
  });

  await scenario('(f2) downloadPermMatrixUsers() xuất Excel với header cột quyền là tiếng Việt thật', async () => {
    const r = await page.evaluate(async () => {
      DB.permGroups = [];
      DB.users = [
        { id: 1, username: 'admin', name: 'Admin', perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 2, username: 'nv.b', name: 'Nhân Viên B', perms: { admin: false, contractApprove: true }, groupIds: [], permOverrides: null, active: true, reportExtraKeys: [] },
      ];
      let captured = null;
      const orig = window.downloadXlsxFromServer;
      window.downloadXlsxFromServer = (fileName, sheetName, columns) => { captured = { fileName, sheetName, columns }; };
      try { downloadPermMatrixUsers(); } finally { window.downloadXlsxFromServer = orig; }
      const adminCol = captured.columns.find(c => c.key === 'Q_admin');
      const contractApproveCol = captured.columns.find(c => c.key === 'Q_contractApprove');
      return {
        adminHeader: adminCol && adminCol.header,
        contractApproveHeader: contractApproveCol && contractApproveCol.header,
      };
    });
    record('(f2) cột Q_admin xuất ra header tiếng Việt đúng nhãn tĩnh (permMatrixColumnHeader("admin"))',
      r.adminHeader && r.adminHeader !== 'Q_admin', JSON.stringify(r));
    record('(f2) cột Q_contractApprove xuất ra header tiếng Việt (chứa "Duyệt hợp đồng")',
      r.contractApproveHeader && r.contractApproveHeader.includes('Duyệt hợp đồng'), JSON.stringify(r));
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
