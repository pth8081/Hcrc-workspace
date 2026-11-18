// tests/test-stocktake-kiemke-batch-activate-boundary.js — Playwright THẬT, VIẾT MỚI (audit chéo trước
// merge nhánh claude/chao-ban-oo5ijl) — CHƯA có test nào cho "Kích Hoạt Kỳ hàng loạt theo nhóm siêu thị"
// (activateSessionBatch(), lib/stocktakeEngine.js) ở bộ test hiện có (đã grep xác nhận trước khi viết).
//
// Kịch bản (đóng vai Admin thao tác THẬT qua UI — gõ tìm-chọn từng siêu thị, bấm nút):
//   1) Tạo 1 kỳ "Gom Mã" RIÊNG LẺ cho siêu thị X trước (KHÔNG cùng batch — mô phỏng 1 đợt tạo kỳ cũ,
//      sớm hơn, độc lập) — đây là "kỳ thứ 4" mà việc Kích Hoạt hàng loạt SAU NÀY tuyệt đối không được
//      động tới.
//   2) Tạo 1 kỳ "Kiểm Kê" (THONG_KE) CÙNG LÚC cho 3 siêu thị X, Y, Z qua ô chọn nhiều (multi-select) —
//      client tự sinh batchId CHUNG cho cả 3.
//   3) Bấm "▶ Kích Hoạt" ở ĐÚNG 1 trong 3 (siêu thị X) -> phải tự kích hoạt LUÔN cả Y, Z (cùng batchId).
//   4) Xác nhận kỳ "Gom Mã" riêng lẻ tạo ở bước 1 (CÙNG siêu thị X, nhưng batchId KHÁC, tạo SỚM HƠN)
//      KHÔNG bị kích hoạt theo — vẫn còn "📝 Nháp" y nguyên (không bị "kích hoạt nhầm" qua khi server chỉ
//      lọc theo batchId, không lọc kèm dept — đây chính là ranh giới cần xác nhận).
async function main() {
  const { createRunner, assert, assertEqual, startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8952;
  const X = 'CH Bến Thành';
  const Y = 'CH Tân Định';
  const Z = 'CH Đa Kao';
  const ADMIN = { username: 'admin.batch', name: 'Admin Batch', dept: 'HO', perms: { admin: true }, active: true, totpEnabled: true };

  const state = createMockState({
    depts: [X, Y, Z, 'HO'], stores: [X, Y, Z],
    users: [ADMIN]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const KNOWN_HARNESS_NOISE = 'Mock chỉ hỗ trợ patch-mode';
  const jsErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (msg.text().includes(KNOWN_HARNESS_NOISE)) return;
    jsErrors.push('[console.error] ' + msg.text());
  });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  // Helper: mở form "+ Tạo Kỳ Mới" từ đầu (đóng lại nếu đang mở sẵn, tránh dính state cũ).
  async function openCreateBox() {
    const boxHidden = await page.evaluate(() => document.getElementById('kkPeriodCreateBox').classList.contains('hidden'));
    if (boxHidden) await page.click('#btnKkPeriodOpenCreate');
    await page.waitForTimeout(100);
  }
  // Helper: thêm 1 siêu thị vào ô multi-select "kkNewStoresMultiSelect" bằng gõ-tìm-rồi-click (THAO TÁC
  // THẬT, không gọi thẳng gmsAdd()).
  async function addStoreToMultiSelect(storeName) {
    await page.fill('#kkNewStoresMultiSelect [data-pms-search]', storeName);
    await page.waitForTimeout(80);
    await page.click(`#kkNewStoresMultiSelect [data-pms-dropdown] div:text-is("${storeName}")`);
    await page.waitForTimeout(80);
  }
  // Helper: chọn "Loại Kỳ" — ô #kkNewLoaiKyInput là sdd* NHƯNG readonly (chỉ 2 lựa chọn cố định, bắt
  // buộc bấm-chọn, không gõ tay được) -> click mở gợi ý rồi click đúng dòng nhãn, KHÔNG dùng page.fill().
  async function selectKkNewLoaiKy(label) {
    await page.click('#kkNewLoaiKyInput');
    await page.waitForTimeout(80);
    await page.click(`#kkNewLoaiKyDropdown div:text-is("${label}")`);
    await page.waitForTimeout(80);
  }

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);

    // ===== Bước 1: tạo kỳ "Gom Mã" riêng lẻ, SỚM HƠN, cho siêu thị X (không cùng batch) =====
    await run.run('[6] Tạo kỳ Gom Mã riêng lẻ cho X (đợt TRƯỚC, không phải batch) qua UI thật', async () => {
      await page.fill('#kkPeriodDeptInput', X);
      await page.waitForTimeout(150);
      await openCreateBox();
      await selectKkNewLoaiKy('Loại: Gom Mã');
      await page.waitForTimeout(150);
      await page.fill('#kkNewTenKy', 'Gom Mã cũ - đợt trước (KHÔNG thuộc batch sau)');
      await addStoreToMultiSelect(X);
      const selected = await page.evaluate(() => (document.getElementById('kkNewStoresMultiSelect')._gmsSelected ? [...document.getElementById('kkNewStoresMultiSelect')._gmsSelected] : []));
      assert(selected.includes(X), `Phải chọn được ${X} ở ô multi-select, thực tế: ${selected.join(',')}`);
      await page.click('#btnSubmitKkPeriod');
      await page.waitForTimeout(300);
      const text = await page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
      assert(text.includes('Gom Mã cũ'), `Phải thấy kỳ Gom Mã cũ vừa tạo trong danh sách, thực tế: ${text}`);
      assert(text.includes('Nháp'), `Kỳ vừa tạo phải ở trạng thái Nháp, thực tế: ${text}`);
    });

    // ===== Bước 2: tạo kỳ "Kiểm Kê" (THONG_KE) CÙNG LÚC cho X, Y, Z (1 batch) =====
    await run.run('[6] Tạo kỳ Kiểm Kê CÙNG LÚC cho 3 siêu thị X/Y/Z (1 batch) qua ô chọn nhiều thật', async () => {
      await openCreateBox();
      await selectKkNewLoaiKy('Loại: Kiểm Kê');
      await page.waitForTimeout(200); // renderKkNewStoresPicker() tự load lại /sessions/open-depts?loaiKy=THONG_KE
      await page.fill('#kkNewTenKy', 'Kiểm Kê Đợt Lớn - 3 siêu thị cùng lúc');
      for (const s of [X, Y, Z]) await addStoreToMultiSelect(s);
      const selected = await page.evaluate(() => [...document.getElementById('kkNewStoresMultiSelect')._gmsSelected]);
      assertEqual(selected.length, 3, `Phải chọn đúng 3 siêu thị, thực tế: ${selected.join(',')}`);
      await page.click('#btnSubmitKkPeriod');
      await page.waitForTimeout(500);
    });

    await run.run('[6] Cả 3 kỳ Kiểm Kê (X/Y/Z) đều đã tạo, cùng ở trạng thái Nháp, kỳ Gom Mã cũ của X vẫn còn nguyên', async () => {
      for (const s of [X, Y, Z]) {
        await page.fill('#kkPeriodDeptInput', s);
        await page.waitForTimeout(150);
        const text = await page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
        assert(text.includes('Kiểm Kê Đợt Lớn'), `Siêu thị ${s} phải có kỳ "Kiểm Kê Đợt Lớn" vừa tạo, thực tế: ${text}`);
      }
      // X còn kỳ Gom Mã cũ Nháp (tạo ở Bước 1, batch khác).
      await page.fill('#kkPeriodDeptInput', X);
      await page.waitForTimeout(150);
      const textX = await page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
      assert(textX.includes('Gom Mã cũ'), `Siêu thị X phải vẫn còn kỳ Gom Mã cũ, thực tế: ${textX}`);
    });

    // ===== Bước 3: bấm "▶ Kích Hoạt" ở ĐÚNG 1 siêu thị (X) trong batch =====
    let activatedIdX, activatedIdY, activatedIdZ, draftGomMaIdX;
    await run.run('[6] Bấm Kích Hoạt ở siêu thị X (1 trong 3 của batch) -> alert xác nhận đã kích hoạt thêm 2 siêu thị', async () => {
      await page.fill('#kkPeriodDeptInput', X);
      await page.waitForTimeout(150);
      await page.evaluate(() => { window.__alerts = []; });
      // Tìm đúng nút Kích Hoạt của dòng "Kiểm Kê Đợt Lớn" (không phải dòng Gom Mã cũ — dòng đó không có
      // nút Kích Hoạt vì KHÔNG phải trạng thái liên quan tới batch, nhưng để chắc chắn bấm đúng dòng, lọc
      // theo text của dòng cha chứa đúng tên kỳ).
      const btnArg = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('#kkPeriodListBody > div'));
        const card = cards.find(c => c.textContent.includes('Kiểm Kê Đợt Lớn'));
        const btn = card && card.querySelector('button[data-op="activateKkPeriod"]');
        return btn ? btn.getAttribute('data-arg0') : null;
      });
      assert(btnArg, 'Phải tìm thấy nút Kích Hoạt cho đúng dòng "Kiểm Kê Đợt Lớn" của siêu thị X');
      activatedIdX = btnArg;
      await page.click(`button[data-op="activateKkPeriod"][data-arg0="${btnArg}"]`);
      await page.waitForTimeout(400);
      const alerts = await page.evaluate(() => window.__alerts || []);
      assert(alerts.some(a => a.includes('kích hoạt thêm 2 siêu thị')), `Phải có alert báo kích hoạt thêm 2 siêu thị cùng batch, thực tế: ${JSON.stringify(alerts)}`);
    });

    await run.run('[6] Siêu thị Y và Z cũng TỰ ĐỘNG chuyển sang "Đang hoạt động" (kích hoạt kèm theo batch)', async () => {
      for (const s of [Y, Z]) {
        await page.fill('#kkPeriodDeptInput', s);
        await page.waitForTimeout(150);
        const text = await page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
        assert(text.includes('Kiểm Kê Đợt Lớn') && text.includes('Đang hoạt động'), `Siêu thị ${s} phải có kỳ "Kiểm Kê Đợt Lớn" ở trạng thái Đang hoạt động, thực tế: ${text}`);
      }
    });

    await run.run('[6] RANH GIỚI QUAN TRỌNG: kỳ Gom Mã cũ của X (batch KHÁC, tạo SỚM HƠN) KHÔNG bị kích hoạt theo — vẫn "📝 Nháp"', async () => {
      await page.fill('#kkPeriodDeptInput', X);
      await page.waitForTimeout(150);
      await page.click('#btnKkPeriodFilterGomMa');
      await page.waitForTimeout(150);
      const text = await page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
      assert(text.includes('Gom Mã cũ'), `Phải vẫn thấy kỳ Gom Mã cũ ở danh sách, thực tế: ${text}`);
      assert(!text.includes('Đang hoạt động'), `Kỳ Gom Mã cũ (batch KHÁC, tạo trước) KHÔNG được bị kích hoạt theo batch sau — phải vẫn Nháp, thực tế: ${text}`);
      assert(text.includes('Nháp'), `Kỳ Gom Mã cũ phải vẫn ở trạng thái Nháp, thực tế: ${text}`);
      await page.click('#btnKkPeriodFilterAll');
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
