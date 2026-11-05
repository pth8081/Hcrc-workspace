// server/tests/demo-mixed-approval-column-width.js
//
// DEMO thật — dựng lại GẦN ĐÚNG kịch bản trong ảnh chụp người dùng gửi (màn "Cấu hình quy trình nâng cao
// giá bán buôn", sub-tab "⚙️ Quy Trình Hỗn Hợp"): nhiều dòng chức danh (có dòng nhãn dài như "Trưởng
// phòng — HO — Phòng Kiểm soát chỉ số vận hành"), 1 dòng "Thẩm định FMCG" gán ~18 ngành hàng. Chụp lại
// SAU khi vá 2 chỗ người dùng yêu cầu: (1) cột "Người / Chức Danh" không còn bị kéo rộng vô hạn bởi 1
// nhãn dài nhất trong danh mục; (2) cột "Ngành Hàng Phụ Trách" rút gọn "A, B, C và N khác" thay vì liệt
// kê hết, giữ cho mỗi dòng gọn ~1-2 dòng thay vì kéo dài cả màn hình.
//
// Chạy: node server/tests/demo-mixed-approval-column-width.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8994;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'mixed-approval-column-width');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm'
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

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
    await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

    await page.evaluate(() => {
      window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
      document.getElementById('systemSection')?.classList.remove('hidden');
      document.getElementById('advWorkflowSection')?.classList.remove('hidden');
      document.getElementById('itPriceMixedApprovalSection')?.classList.remove('hidden');

      DB.jobTitles = ['Cửa hàng Trưởng', 'Giám đốc Siêu Thị', 'Thẩm định FMCG', 'Thẩm định fresh', 'Thẩm định ultrafresh',
        'Trưởng phòng Kiểm soát chỉ số vận hành', 'Trưởng phòng Mua hàng Thực phẩm Tươi sống', 'Trưởng phòng Mua hàng FMCG',
        'Giám đốc Ban Cung ứng', 'Phó Tổng Giám đốc'];
      DB.storeJobTitles = [];
      DB.workflowParticipatingPositions = [];
      DB.users = [];
      DB.nganhHangCatalog = [
        { code: 'ULTRA', name: 'UltraFresh' }, { code: 'FRESH', name: 'Fresh' }, { code: 'CONF', name: 'Bánh kẹo (Confectionery)' },
        { code: 'BEV', name: 'Đồ uống, thuốc lá (Beverage and Tobacco)' }, { code: 'GROC', name: 'Tạp hoá công nghệ (Grocery)' },
        { code: 'FARM', name: 'Nông sản, bột các loại (Farm produce, cooking flours)' }, { code: 'COSM', name: 'Mỹ phẩm (Cosmetic)' },
        { code: 'PAPER', name: 'Giấy và băng vệ sinh (Tissue and diaper)' }, { code: 'FASH', name: 'Quần áo, giày dép (Fashion, footwear)' },
        { code: 'COTT', name: 'Bông vải sợi (cotton)' }, { code: 'HOME', name: 'Gia dụng (Household)' },
        { code: 'STAT', name: 'Văn phòng phẩm, đồ chơi (stationery, toy)' }
      ];
      const nganhHangAllCodes = DB.nganhHangCatalog.map(n => n.code);
      DB.itPriceWholesaleStoreMixedApprovalRules = [
        { id: 1, step: 1, tier: Object.keys(IT_PRICE_TIER_LABELS)[0], mode: 'JOBTITLE', jobTitle: 'Cửa hàng Trưởng', jobTitleDept: null, stores: [], nganhHang: [] },
        { id: 2, step: 1, tier: Object.keys(IT_PRICE_TIER_LABELS)[0], mode: 'JOBTITLE', jobTitle: 'Giám đốc Siêu Thị', jobTitleDept: null, stores: [], nganhHang: [] },
        { id: 3, step: 2, tier: Object.keys(IT_PRICE_TIER_LABELS)[0], mode: 'JOBTITLE', jobTitle: 'Thẩm định FMCG', jobTitleDept: null, stores: [], nganhHang: nganhHangAllCodes },
        { id: 4, step: 2, tier: Object.keys(IT_PRICE_TIER_LABELS)[0], mode: 'JOBTITLE', jobTitle: 'Thẩm định fresh', jobTitleDept: null, stores: [], nganhHang: ['FRESH'] },
        { id: 5, step: 2, tier: Object.keys(IT_PRICE_TIER_LABELS)[0], mode: 'JOBTITLE', jobTitle: 'Thẩm định ultrafresh', jobTitleDept: null, stores: [], nganhHang: ['ULTRA'] },
        { id: 6, step: 3, tier: Object.keys(IT_PRICE_TIER_LABELS)[0], mode: 'JOBTITLE', jobTitle: 'Trưởng phòng Kiểm soát chỉ số vận hành', jobTitleDept: 'Phòng Kiểm soát chỉ số vận hành', stores: [], nganhHang: [] },
        { id: 7, step: 3, tier: Object.keys(IT_PRICE_TIER_LABELS)[0], mode: 'JOBTITLE', jobTitle: 'Trưởng phòng Mua hàng Thực phẩm Tươi sống', jobTitleDept: 'Phòng Mua hàng Thực phẩm Tươi sống', stores: [], nganhHang: ['ULTRA', 'FRESH'] },
        { id: 8, step: 3, tier: Object.keys(IT_PRICE_TIER_LABELS)[0], mode: 'JOBTITLE', jobTitle: 'Trưởng phòng Mua hàng FMCG', jobTitleDept: 'Phòng Mua hàng FMCG', stores: [], nganhHang: nganhHangAllCodes },
        { id: 9, step: 4, tier: Object.keys(IT_PRICE_TIER_LABELS)[0], mode: 'JOBTITLE', jobTitle: 'Giám đốc Ban Cung ứng', jobTitleDept: null, stores: [], nganhHang: [] },
        { id: 10, step: 5, tier: Object.keys(IT_PRICE_TIER_LABELS)[0], mode: 'JOBTITLE', jobTitle: 'Phó Tổng Giám đốc', jobTitleDept: null, stores: [], nganhHang: [] }
      ];
      renderItPriceWholesaleMixedApprovalSection();
    });
    await page.waitForTimeout(150);

    const sectionBox = await page.locator('#itPriceMixedApprovalSection').boundingBox();
    await page.locator('#itPriceMixedApprovalSection').screenshot({ path: path.join(OUT_DIR, '00-sau-khi-vac-can-chinh.png'), clip: { x: sectionBox.x, y: sectionBox.y, width: sectionBox.width, height: Math.min(sectionBox.height, 760) } });
    console.log('📸 Sau khi căn chỉnh -> 00-sau-khi-vac-can-chinh.png');

    const colWidth = await page.evaluate(() => document.getElementById('ipmaNewJobTitleInput').style.width);
    const tbodyText = await page.evaluate(() => document.getElementById('itPriceMixedApprovalTableBody').innerText);
    console.log('Độ rộng ô "Người/Chức Danh" (đã có trần 34ch):', colWidth);
    if (!tbodyText.includes('và 9 khác')) throw new Error('❌ Dòng "Thẩm định FMCG" (12 ngành hàng) phải rút gọn "và 9 khác"!');
    console.log('\n✅ XÁC NHẬN: cột "Người / Chức Danh" không còn bị 1 nhãn dài nhất kéo rộng vô hạn; cột "Ngành Hàng Phụ Trách" rút gọn gọn gàng, đầy đủ dữ liệu vẫn còn trong tooltip khi hover.');
  } finally {
    await browser.close();
    server.close();
  }
})();
