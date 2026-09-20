'use strict';
// Regression test cho module mới "📘 Nghiệp Vụ" (public/js/module-nghiepvu.js) — màn tài liệu tham
// khảo trực quan (sơ đồ quy trình + diễn giải), KHÔNG tạo/lưu hồ sơ riêng, mở cho MỌI tài khoản đã đăng
// nhập (xem canAccessNghiepVuModule() ở core.js). Mirror khuôn test-forms-nav-groups.js (Playwright +
// static server tối thiểu, lặp trực tiếp qua NGHIEP_VU_NAV/NGHIEP_VU_DOCS đọc từ trang thật thay vì
// hard-code danh sách key, để test luôn khớp dữ liệu hiện tại khi thêm module mới sau này).
//
// Kịch bản:
//   1. canAccessNghiepVuModule(): mở cho user thường lẫn admin, đóng khi không có currentUser.
//   2. switchTab('nghiepVu') hiện đúng #nghiepVuSection, ẩn các section khác, render nav + nội dung.
//   3. Toàn vẹn dữ liệu: mọi item trong NGHIEP_VU_NAV (trừ 'daotao') phải có entry trong NGHIEP_VU_DOCS
//      — không mục nào bị bỏ sót âm thầm (đúng tinh thần "auto cập nhật" đã thống nhất với người dùng).
//   4. Lặp qua TOÀN BỘ item thật: setNVActiveKey(key) render tiêu đề + sơ đồ SVG không lỗi.
//   5. Đào Tạo: lặp qua toàn bộ 6 khu vực (NGHIEP_VU_DAOTAO_AREAS), mỗi khu vực render sơ đồ riêng.
//   6. Cơ chế cảnh báo thiếu tài liệu: xoá tạm 1 entry khỏi NGHIEP_VU_DOCS -> phải hiện đúng cảnh báo
//      "⚠️ Chưa có tài liệu nghiệp vụ" thay vì lỗi trắng trang hoặc im lặng thiếu sót.
//
// Run: node server/tests/test-nghiepvu.js

const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8959;

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
  let pageErrors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(msg.text()); });

    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
    // Ha tang: nap lười KHUNG HTML theo tab (v23.11, core.js::TAB_SECTION_FRAGMENT/loadTabSectionHtml) — mirror dòng trên, cùng lý do (xem _harness.js).
    await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

    results = await page.evaluate(async () => {
      const results = [];
      function check(name, cond, detail) {
        results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') });
      }

      window.alert = () => {};
      window.confirm = () => true;

      const normalUser = { username: 'nv1', name: 'Nhân Viên', dept: 'Phòng Hành Chính', perms: {} };
      // PHÁT HIỆN theo yêu cầu người dùng (10/2026): mỗi mục Nghiệp Vụ giờ chỉ hiện theo đúng quyền
      // module THẬT tương ứng (xem canViewNVItem()/NV_KEY_ACCESS_FN ở module-nghiepvu.js) — user này
      // dùng để lặp qua TOÀN BỘ item kiểm tra render nội dung (mục 4-5 bên dưới), không phải để test
      // permission-gating (đã test riêng ở mục 1), nên cấp thẳng nghiepVuViewAll để không bị lọc mất.
      const adminUser = { username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng Hành Chính', perms: { admin: true, nghiepVuViewAll: true } };

      // ---------- 1) Quyền truy cập: mở mặc định cho mọi tài khoản đã đăng nhập ----------
      check('canAccessNghiepVuModule: user thường được vào (mở mặc định)',
        canAccessNghiepVuModule(normalUser) === true);
      check('canAccessNghiepVuModule: admin được vào',
        canAccessNghiepVuModule(adminUser) === true);
      check('canAccessNghiepVuModule: không có user -> false',
        canAccessNghiepVuModule(null) === false);

      // ---------- 2) switchTab('nghiepVu') hiện đúng section, ẩn các section khác ----------
      currentUser = adminUser;
      Object.assign(DB, {
        depts: ['Phòng Hành Chính'], cats: [], stores: [], jobTitles: ['Nhân Viên'],
        submissionTypes: [], contractTypes: [], carTypes: [], licenseTypes: [], itTicketCategories: [],
        trainingCategories: [], formTemplates: {}, systemLogs: [], users: []
      });
      await switchTab('nghiepVu');
      const section = document.getElementById('nghiepVuSection');
      check('switchTab(nghiepVu): #nghiepVuSection hiện ra (không còn class hidden)',
        !!section && !section.classList.contains('hidden'));
      const docSection = document.getElementById('docSection');
      check('switchTab(nghiepVu): section khác (ví dụ #docSection) vẫn ẩn',
        !!docSection && docSection.classList.contains('hidden'));
      check('switchTab(nghiepVu): nav trái render đủ nhóm (NGHIEP_VU_NAV)',
        document.querySelectorAll('#nghiepVuRoot .nv-item').length === NGHIEP_VU_NAV.reduce((s, g) => s + g.items.length, 0));

      // ---------- 3) Toàn vẹn dữ liệu: mọi item thật (trừ daotao) phải có entry NGHIEP_VU_DOCS ----------
      const allItems = NGHIEP_VU_NAV.flatMap(g => g.items);
      const missing = allItems.filter(it => it.key !== 'daotao' && !NGHIEP_VU_DOCS[it.key]).map(it => it.key);
      check('Mọi item trong NGHIEP_VU_NAV (trừ daotao) đều có entry NGHIEP_VU_DOCS tương ứng',
        missing.length === 0, JSON.stringify(missing));

      // ---------- 4) Lặp toàn bộ item thật: render tiêu đề + sơ đồ SVG không lỗi ----------
      for (const it of allItems) {
        if (it.key === 'daotao') continue;
        setNVActiveKey(it.key);
        const main = document.getElementById('nghiepVuMain');
        const hasSvg = !!main && main.querySelector('svg') !== null;
        check(`[${it.key}] render sơ đồ SVG không lỗi`, hasSvg, main ? main.innerHTML.slice(0, 150) : 'NO MAIN');
        const doc = NGHIEP_VU_DOCS[it.key];
        const titleOk = !!main && main.textContent.includes(doc.title);
        check(`[${it.key}] tiêu đề hiển thị đúng ("${doc.title}")`, titleOk);
      }

      // ---------- 5) Đào Tạo: lặp toàn bộ 6 khu vực ----------
      setNVActiveKey('daotao');
      for (const area of NGHIEP_VU_DAOTAO_AREAS) {
        setNVDaotaoArea(area.key);
        const main = document.getElementById('nghiepVuMain');
        const hasSvg = !!main && main.querySelector('svg') !== null;
        check(`[daotao/${area.key}] render sơ đồ SVG không lỗi`, hasSvg);
        check(`[daotao/${area.key}] hiển thị đúng tên khu vực ("${area.label}")`,
          !!main && main.textContent.includes(area.label));
      }

      // ---------- 6) Cơ chế cảnh báo thiếu tài liệu — xoá tạm 1 entry rồi phục hồi ----------
      const probeKey = 'doc';
      const saved = NGHIEP_VU_DOCS[probeKey];
      delete NGHIEP_VU_DOCS[probeKey];
      setNVActiveKey(probeKey);
      const mainAfterDelete = document.getElementById('nghiepVuMain');
      check('Item bị xoá khỏi registry -> hiện đúng cảnh báo "Chưa có tài liệu nghiệp vụ"',
        !!mainAfterDelete && mainAfterDelete.innerHTML.includes('Chưa có tài liệu nghiệp vụ'),
        mainAfterDelete ? mainAfterDelete.innerHTML.slice(0, 200) : 'NO MAIN');
      NGHIEP_VU_DOCS[probeKey] = saved;
      setNVActiveKey(probeKey);
      const mainRestored = document.getElementById('nghiepVuMain');
      check('Phục hồi entry -> render lại bình thường (không còn cảnh báo)',
        !!mainRestored && !mainRestored.innerHTML.includes('Chưa có tài liệu nghiệp vụ') && mainRestored.querySelector('svg') !== null);

      // ---------- 7) "Sơ Đồ Kiến Trúc Hệ Thống" (systemArchitecture) — CHỈ admin xem được, kể cả khi
      // non-admin có nghiepVuViewAll/nghiepVuExtraKeys (khác mọi mục khác, xem NV_ADMIN_ONLY_KEYS) ----------
      check('canViewNVItem: admin xem được systemArchitecture',
        (() => { currentUser = adminUser; return canViewNVItem('systemArchitecture'); })());
      const nonAdminNoGrant = { username: 'nv2', name: 'Nhân Viên 2', dept: 'Phòng Hành Chính', perms: {} };
      currentUser = nonAdminNoGrant;
      check('canViewNVItem: non-admin KHÔNG có quyền mở rộng -> KHÔNG xem được systemArchitecture',
        canViewNVItem('systemArchitecture') === false);
      const nonAdminViewAll = { username: 'nv3', name: 'Nhân Viên 3', dept: 'Phòng Hành Chính', perms: { nghiepVuViewAll: true } };
      currentUser = nonAdminViewAll;
      check('canViewNVItem: non-admin dù có "Xem Toàn Bộ Mục Nghiệp Vụ" (nghiepVuViewAll) vẫn KHÔNG xem được systemArchitecture',
        canViewNVItem('systemArchitecture') === false);
      check('canViewNVItem: non-admin có nghiepVuViewAll vẫn xem được mục thường khác (VD "doc")',
        canViewNVItem('doc') === true);
      const nonAdminExtraKey = { username: 'nv4', name: 'Nhân Viên 4', dept: 'Phòng Hành Chính', perms: {}, nghiepVuExtraKeys: ['systemArchitecture'] };
      currentUser = nonAdminExtraKey;
      check('canViewNVItem: non-admin dù được mở riêng qua nghiepVuExtraKeys vẫn KHÔNG xem được systemArchitecture',
        canViewNVItem('systemArchitecture') === false);

      // Nav trái: non-admin không thấy nhóm "Hệ Thống"/mục "Sơ Đồ Kiến Trúc Hệ Thống" trong danh sách hiện ra.
      currentUser = nonAdminNoGrant;
      const visibleForNonAdmin = visibleNVGroups();
      check('visibleNVGroups(): non-admin KHÔNG thấy nhóm "Hệ Thống" trong nav',
        !visibleForNonAdmin.some(g => g.items.some(it => it.key === 'systemArchitecture')));

      // Ngay cả khi cố tình gọi setNVActiveKey('systemArchitecture') trực tiếp (bỏ qua nav), render
      // lại tự rơi về mục đầu tiên NGƯỜI ĐÓ được xem (cùng cơ chế bảo vệ renderNghiepVuModule() đã áp
      // dụng cho mọi mục bị gác quyền khác, không phải cơ chế riêng mới cho mục này).
      await switchTab('nghiepVu');
      setNVActiveKey('systemArchitecture');
      const mainAfterForcedKey = document.getElementById('nghiepVuMain');
      check('setNVActiveKey("systemArchitecture") bởi non-admin -> KHÔNG render nội dung kiến trúc hệ thống',
        !!mainAfterForcedKey && !mainAfterForcedKey.textContent.includes('Sơ Đồ Kiến Trúc Hệ Thống'),
        mainAfterForcedKey ? mainAfterForcedKey.textContent.slice(0, 150) : 'NO MAIN');

      // ---------- 8) LỖI ĐÃ VÁ (rà soát chuyên sâu theo yêu cầu người dùng, 9/2026): mục "muaHang" (Mua
      // Hàng > BAS) thiếu hẳn entry trong NV_KEY_ACCESS_FN — canViewNVItem() cũ fallback về `true`
      // (hiện MẶC ĐỊNH cho mọi người) khi không tìm thấy hàm tương ứng, nên ai cũng xem được tài liệu
      // nghiệp vụ BAS dù không có bất kỳ quyền Mua Hàng nào. Đã nối muaHang -> canAccessPurchasingModule
      // (core.js, đã có sẵn logic gộp cả 5 quyền rebate*). ----------
      const noPurchasingPermUser = { username: 'nv5', name: 'Nhân Viên 5', dept: 'Phòng Hành Chính', perms: {} };
      currentUser = noPurchasingPermUser;
      check('LỖI ĐÃ VÁ: canViewNVItem("muaHang") = false cho user KHÔNG có bất kỳ quyền Mua Hàng nào',
        canViewNVItem('muaHang') === false);
      const visibleForNoPurchasing = visibleNVGroups();
      check('LỖI ĐÃ VÁ: visibleNVGroups() KHÔNG hiện nhóm "Mua Hàng" cho user không có quyền',
        !visibleForNoPurchasing.some(g => g.items.some(it => it.key === 'muaHang')));

      const purchasingReportUser = { username: 'nv6', name: 'Nhân Viên 6', dept: 'Phòng Mua Hàng', perms: { rebateViewReport: true } };
      currentUser = purchasingReportUser;
      check('canViewNVItem("muaHang") = true cho user có rebateViewReport (1 trong 5 quyền Mua Hàng)',
        canViewNVItem('muaHang') === true);

      // ---------- 9) Cứng hoá fallback: key KHÔNG có trong NV_KEY_ACCESS_FN phải fail-CLOSED (false),
      // không fail-open (true) — lớp phòng thủ chung cho MỌI module mới sau này lỡ quên nối quyền, không
      // chỉ riêng "muaHang" ở mục 8. ----------
      currentUser = { username: 'nv7', name: 'Nhân Viên 7', dept: 'Phòng Hành Chính', perms: { admin: false } };
      check('LỖI ĐÃ VÁ: key HOÀN TOÀN không có trong NV_KEY_ACCESS_FN -> canViewNVItem() fail-CLOSED (false), không fail-open',
        canViewNVItem('__khongTonTaiKeyNao__') === false);

      currentUser = adminUser;

      return results;
    });
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}${r.pass ? '' : ' -- ' + r.detail}`));
  if (pageErrors.length) {
    console.log('\n--- Page errors captured (informational, not counted as failure) ---');
    pageErrors.forEach(e => console.log(e));
  }
  console.log(`\n==== ${results.length - failed.length}/${results.length} scenario(s) passed ====`);
  if (failed.length > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
