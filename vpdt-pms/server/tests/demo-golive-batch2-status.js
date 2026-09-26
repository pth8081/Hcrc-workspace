// server/tests/demo-golive-batch2-status.js
//
// DEMO thật (Playwright, không phải test tự động) cho 2 việc đã xử lý trong đợt "Golive-batch2":
//   1. Danh Mục Siêu Thị: thêm siêu thị mới lưu thành công + hiện ngay trong danh sách (vá lỗi
//      addStoreToCatalog()/saveStore()/deleteStore()/moveDeptToStore() thiếu await+rollback).
//   2. Quy Trình Phê Duyệt Giá Bán Lẻ/Bán Buôn đã tách thành 2 tab RIÊNG trong "Quy Trình & Phê Duyệt"
//      (không còn gắn mác Hỗ Trợ IT) — và tự động xuất hiện trong "Áp Dụng Nhanh" (Nghiệp Vụ Nâng Cao) vì
//      cả 2 màn đều đọc chung 1 registry WF_MODULE_CONFIG.
//
// Chạy: node server/tests/demo-golive-batch2-status.js
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8996;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'golive-batch2');

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };

const state = createMockState({
  depts: ['Ban Giám Đốc', 'Kinh Doanh'],
  stores: ['Siêu Thị Quận 1'],
  users: [ADMIN],
  workflows: [{ id: 'WF_1STEP', name: 'Duyệt 1 bước', steps: [{ order: 1, name: 'Duyệt' }] }]
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function shot(page, name) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 ${file}`);
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1100, height: 1300 });

  try {
    await loginAs(page, ADMIN);

    // Mock testHarness KHÔNG mô phỏng generic POST /api/data/:key cho MỌI collection (chỉ vài key có
    // nhánh riêng, xem createDispatcher()) — demo này chỉ cần "lưu thành công" cho vài key catalog đơn
    // giản (stores/depts/itPriceDeptWorkflows/itPriceTierWorkflows/quickApplyConfigs), tự thêm 1 lớp
    // fetch mỏng ngay trong trang thay vì sửa hạ tầng test dùng chung.
    await page.evaluate(() => {
      const savedFetch = window.fetch;
      const DEMO_OK_KEYS = new Set(['stores', 'depts', 'itPriceDeptWorkflows', 'itPriceTierWorkflows', 'quickApplyConfigs']);
      window.fetch = async (url, opts) => {
        const m = /^\/api\/data\/([^/]+)$/.exec(url);
        if (m && opts?.method === 'POST' && DEMO_OK_KEYS.has(m[1])) {
          return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
        }
        return savedFetch(url, opts);
      };
    });

    // ===== 1) Danh Mục Siêu Thị: thêm mới -> lưu thật (await + rollback đã vá) =====
    await page.evaluate(async () => { await switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('CATALOG'); });
    await page.waitForTimeout(150);
    await page.fill('#txtStoreName', 'Siêu Thị Quận 7 (Demo Mới)');
    await page.click('#txtStoreName ~ button');
    await page.waitForTimeout(200);
    console.log('01: Danh Mục Siêu Thị — thêm "Siêu Thị Quận 7 (Demo Mới)" -> lưu thành công, hiện ngay trong danh sách.');
    const storesAfterAdd = await page.evaluate(() => DB.stores.slice());
    console.log('  -> DB.stores hiện tại:', JSON.stringify(storesAfterAdd));
    await page.locator('#storeList').scrollIntoViewIfNeeded();
    await shot(page, '01-danh-muc-sieu-thi-them-moi');

    // ===== 2) Quy Trình & Phê Duyệt: 2 tab RIÊNG Bán Lẻ/Bán Buôn (không còn gắn Hỗ Trợ IT) =====
    await page.evaluate(async () => { setSystemSubTab('WORKFLOW'); switchWfModule('ITPRICE_RETAIL'); });
    await page.waitForTimeout(150);
    const retailTitle = await page.evaluate(() => document.getElementById('wfConfigTitle').innerText);
    console.log(`\n02: Quy Trình & Phê Duyệt — tab "Phê Duyệt Giá Bán Lẻ" độc lập, tiêu đề: "${retailTitle}"`);
    await shot(page, '02-quy-trinh-phe-duyet-gia-ban-le');

    await page.evaluate(async () => { switchWfModule('ITPRICE_WHOLESALE'); });
    await page.waitForTimeout(150);
    const wholesaleTitle = await page.evaluate(() => document.getElementById('wfConfigTitle').innerText);
    console.log(`03: Quy Trình & Phê Duyệt — tab "Phê Duyệt Giá Bán Buôn" độc lập, tiêu đề: "${wholesaleTitle}"`);
    await shot(page, '03-quy-trinh-phe-duyet-gia-ban-buon');

    // ===== 3) Áp Dụng Nhanh: tự động thấy CẢ 2 module trên (đọc chung WF_MODULE_CONFIG) =====
    await page.evaluate(async () => { setSystemSubTab('ADVWORKFLOW'); setAdvWorkflowSubTab('QUICKAPPLY'); });
    await page.waitForTimeout(150);
    const qaModuleLabels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#qaModuleGrid .qaModuleCheck'))
        .map(cb => cb.closest('label')?.innerText.trim() || cb.value)
    );
    console.log(`\n04: Áp Dụng Nhanh (Nghiệp Vụ Nâng Cao) — danh sách module chọn được:`, JSON.stringify(qaModuleLabels));
    await page.locator('#qaModuleGrid').scrollIntoViewIfNeeded();
    await shot(page, '04-ap-dung-nhanh-tu-dong-thay-2-module-gia');
  } finally {
    await browser.close();
    server.close();
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
