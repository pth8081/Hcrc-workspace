'use strict';
// server/tests/test-mixed-approval-column-width.js
//
// Regression cho 2 chỗ căn chỉnh người dùng yêu cầu (11/2026, kèm ảnh chụp màn "Cấu hình quy trình nâng
// cao giá bán buôn và đặt hàng siêu thị"): "độ rộng ở cột người phê duyệt đang quá rộng" + "khó thao tác
// khi quy trình dài xuống dưới" — cả 2 đều ở sub-tab "⚙️ Quy Trình Hỗn Hợp" (module-workflow.js):
//
//   1. widenSddInputToLongestOption() trước đây KHÔNG CÓ TRẦN — 1 nhãn chức danh/người DÀI NHẤT trong
//      TOÀN BỘ danh mục tự kéo rộng ô input (maNewJobTitleInput/maNewPersonInput/ipma*), mà bảng dùng
//      layout mặc định (không table-fixed) nên kéo rộng LUÔN CẢ CỘT "Người / Chức Danh" của toàn bộ
//      bảng dù hầu hết dòng dữ liệu thật ngắn gọn. Nay có trần 34ch.
//   2. storesLabel/nganhHangLabel (renderMixedApprovalSection()/renderItPriceWholesaleMixedApprovalSection())
//      trước đây liệt kê ĐẦY ĐỦ mọi mục đã gán — dòng gán nhiều Siêu Thị/Ngành Hàng (ảnh chụp cho thấy 1
//      dòng liệt kê ~20 ngành hàng) kéo DÀI cả màn hình theo chiều dọc. Nay rút gọn qua
//      mixedApprovalTruncatedList() thành "A, B, C và N khác" (đầy đủ vẫn còn trong tooltip `title`).
//
// Cùng hạ tầng test với tests/test-mixed-approval-jobtitle-mix.js: serve public/index.html tĩnh, mở
// Chromium (Playwright) thật, KHÔNG cần backend/DB thật.
//
// Chạy: node server/tests/test-mixed-approval-column-width.js

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

      window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });

      // ========================================================================
      // 1. mixedApprovalTruncatedList() — hàm thuần, test trực tiếp trước khi test tích hợp qua render.
      // ========================================================================
      const few = mixedApprovalTruncatedList(['A', 'B'].map(escapeHtml), 'A, B');
      check('mixedApprovalTruncatedList(): <= maxShow (mặc định 3) -> giữ NGUYÊN, không cắt, không thêm "và N khác"',
        few === 'A, B', few);

      const many = mixedApprovalTruncatedList(['A', 'B', 'C', 'D', 'E'].map(escapeHtml), 'A, B, C, D, E');
      check('mixedApprovalTruncatedList(): > maxShow -> CHỈ hiện 3 mục đầu + "và 2 khác"',
        many.startsWith('A, B, C') && many.includes('và 2 khác'), many);
      check('mixedApprovalTruncatedList(): "và N khác" có title= chứa ĐẦY ĐỦ danh sách gốc (không mất dữ liệu)',
        many.includes('title="A, B, C, D, E"'), many);
      check('mixedApprovalTruncatedList(): KHÔNG hiện trực tiếp mục D/E ngoài phần title (đã thật sự rút gọn)',
        !many.includes('>D<') && !many.includes('>E<'), many);

      // ========================================================================
      // 2. widenSddInputToLongestOption() — có trần 34ch, không còn bị 1 nhãn cực dài kéo rộng vô hạn.
      // ========================================================================
      document.getElementById('mixedApprovalSection')?.classList.remove('hidden');
      DB.jobTitles = ['Trưởng Phòng Kiểm Soát Chỉ Số Vận Hành Toàn Hệ Thống Khu Vực Miền Bắc']; // ~68 ký tự, kèm hậu tố " — HO" còn dài hơn.
      DB.storeJobTitles = [];
      DB.workflowParticipatingPositions = [];
      DB.users = [];
      DB.operationOrderStoreMixedApprovalRules = [];
      renderMixedApprovalSection();
      const wideInputCh = parseFloat(document.getElementById('maNewJobTitleInput').style.width);
      check('widenSddInputToLongestOption(): nhãn CỰC DÀI (~68 ký tự + hậu tố) -> ô input bị CHẶN TRẦN ở ĐÚNG 34ch, không rộng hơn',
        wideInputCh === 34, document.getElementById('maNewJobTitleInput').style.width);

      DB.jobTitles = ['Thủ Kho']; // ngắn, dưới trần -> vẫn co theo đúng độ dài thật (không bị ép luôn về trần).
      renderMixedApprovalSection();
      const shortInputCh = parseFloat(document.getElementById('maNewJobTitleInput').style.width);
      check('widenSddInputToLongestOption(): nhãn NGẮN -> ô input co lại theo đúng độ dài thật (REGRESSION, không bị ép cứng về trần)',
        shortInputCh < 34 && shortInputCh >= 24, document.getElementById('maNewJobTitleInput').style.width);

      // ========================================================================
      // 3. Tích hợp qua renderMixedApprovalSection() thật (Đặt Hàng Siêu Thị) — storesLabel rút gọn khi
      //    có nhiều siêu thị ngoại lệ, dòng ÍT siêu thị vẫn hiện đầy đủ (không bị cắt oan).
      // ========================================================================
      DB.stores = ['Siêu Thị A', 'Siêu Thị B', 'Siêu Thị C', 'Siêu Thị D', 'Siêu Thị E'];
      DB.operationOrderStoreMixedApprovalRules = [
        { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Thủ Kho', jobTitleDept: null, stores: ['Siêu Thị A', 'Siêu Thị B', 'Siêu Thị C', 'Siêu Thị D', 'Siêu Thị E'] },
        { id: 2, step: 1, mode: 'JOBTITLE', jobTitle: 'Thủ Kho', jobTitleDept: null, stores: ['Siêu Thị A', 'Siêu Thị B'] }
      ];
      renderMixedApprovalSection();
      const tbodyHtml = document.getElementById('mixedApprovalTableBody').innerHTML;
      check('renderMixedApprovalSection(): dòng 5 siêu thị -> cột "Siêu Thị Phụ Trách" RÚT GỌN "và 2 khác" (không liệt kê hết 5 dòng)',
        tbodyHtml.includes('và 2 khác'), tbodyHtml.length > 4000 ? '(quá dài, không in)' : tbodyHtml);
      check('renderMixedApprovalSection(): tooltip title chứa ĐẦY ĐỦ 5 siêu thị gốc, không mất dữ liệu',
        tbodyHtml.includes('Siêu Thị A, Siêu Thị B, Siêu Thị C, Siêu Thị D, Siêu Thị E'), tbodyHtml.length > 4000 ? '(quá dài, không in)' : tbodyHtml);
      check('renderMixedApprovalSection(): dòng CHỈ 2 siêu thị (<= maxShow) -> hiện ĐẦY ĐỦ, không bị cắt oan',
        tbodyHtml.includes('Siêu Thị A, Siêu Thị B </span>') || tbodyHtml.includes('Siêu Thị A, Siêu Thị B </td>') || /Siêu Thị A, Siêu Thị B(?!,)/.test(tbodyHtml),
        tbodyHtml.length > 4000 ? '(quá dài, không in)' : tbodyHtml);

      // ========================================================================
      // 4. Tích hợp qua renderItPriceWholesaleMixedApprovalSection() thật (Giá Bán Buôn) — nganhHangLabel
      //    rút gọn khi gán nhiều ngành hàng, kể cả khi lẫn 1 mã đã xoá khỏi danh mục (badge đỏ).
      // ========================================================================
      document.getElementById('itPriceMixedApprovalSection')?.classList.remove('hidden');
      DB.nganhHangCatalog = [
        { code: 'FRESH', name: 'Hàng Tươi Sống' }, { code: 'ULTRA', name: 'UltraFresh' },
        { code: 'CONF', name: 'Bánh Kẹo' }, { code: 'BEV', name: 'Đồ Uống' }, { code: 'GROC', name: 'Tạp Hoá' }
      ];
      DB.itPriceWholesaleStoreMixedApprovalRules = [{
        id: 1, step: 1, tier: Object.keys(IT_PRICE_TIER_LABELS)[0], mode: 'JOBTITLE', jobTitle: 'Thủ Kho', jobTitleDept: null,
        stores: [], nganhHang: ['FRESH', 'ULTRA', 'CONF', 'BEV', 'MATXOA']
      }];
      renderItPriceWholesaleMixedApprovalSection();
      const ipTbodyHtml = document.getElementById('itPriceMixedApprovalTableBody').innerHTML;
      check('renderItPriceWholesaleMixedApprovalSection(): dòng 5 ngành hàng -> cột "Ngành Hàng Phụ Trách" RÚT GỌN "và 2 khác"',
        ipTbodyHtml.includes('và 2 khác'), ipTbodyHtml.length > 4000 ? '(quá dài, không in)' : ipTbodyHtml);
      check('renderItPriceWholesaleMixedApprovalSection(): mã "MATXOA" đã xoá khỏi danh mục vẫn còn nguyên trong tooltip title (không mất cảnh báo)',
        ipTbodyHtml.includes('MATXOA'), ipTbodyHtml.length > 4000 ? '(quá dài, không in)' : ipTbodyHtml);

      return results;
    });
  } finally {
    await browser.close();
    server.close();
  }

  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.pass) { pass++; console.log(`PASS: ${r.name}`); }
    else { fail++; console.log(`FAIL: ${r.name}\n  -> ${r.detail}`); }
  }
  if (jsErrors.length) {
    fail++;
    console.log(`FAIL: không có lỗi JS chưa bắt (pageerror)\n  -> ${jsErrors.join('; ')}`);
  } else {
    pass++;
    console.log('PASS: không có lỗi JS chưa bắt (pageerror) nào phát sinh');
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
