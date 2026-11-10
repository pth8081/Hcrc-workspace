// server/tests/demo-shelf-recon-past-stock.js
//
// DEMO thật (Playwright) cho cột mới "Trên Kệ Quá Khứ" ở màn "📊 Đối Chiếu" (11/2026, theo yêu cầu người
// dùng kèm ảnh chụp: "tôi muốn thêm cột trên kệ quá khứ để hiện các mã đã đưa lên kệ trước đây để có thể
// theo dõi/báo cáo sau này, nếu chỉ hôm nay sẽ không hiện kệ đã scan trước"). Mô phỏng đúng 3 trường hợp:
//   - SP001: CHỈ scan hôm nay (như cũ) -> Trên Kệ Hôm Nay=10, Trên Kệ Quá Khứ=0.
//   - SP002: CHỈ scan quá khứ (3 ngày trước, chưa scan lại hôm nay) -> ĐÂY là mã mà bản CŨ sẽ KHÔNG hiện
//     dòng nào (vì server lọc "chỉ mã scan hôm nay") -> SAU khi vá: Trên Kệ Hôm Nay=0, Trên Kệ Quá Khứ=20.
//   - SP003: scan CẢ hôm nay (5) và quá khứ (15, lô/lần quét cũ hơn, record riêng) -> Trên Kệ Hôm Nay=5,
//     Trên Kệ Quá Khứ=15 — và "Kết Quả" (Khớp/Lệch) PHẢI vẫn chỉ so Trên Kệ Hôm Nay vs Tồn Kho Hệ Thống
//     (theo xác nhận của người dùng qua AskUserQuestion: "Vẫn chỉ so Hôm Nay"), KHÔNG cộng thêm Quá Khứ.
//
// Chạy: node server/tests/demo-shelf-recon-past-stock.js
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8996;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-recon-past-stock');

const USER = { username: 'nv1', name: 'Nguyễn Thị Hàng', dept: 'Siêu thị Quận 1', perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true };

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({ depts: [], stores: ['Siêu thị Quận 1'], users: [USER] });
  state.__mockSystemInventoryRows = [
    { maHang: 'SP001', tenHang: 'Bánh quy HCRC 200g', soLuongTon: 10 },
    { maHang: 'SP002', tenHang: 'Sữa tươi HCRC 1L', soLuongTon: 20 },
    { maHang: 'SP003', tenHang: 'Nước suối Lavie 500ml', soLuongTon: 5 }
  ];
  const today = new Date().toISOString();
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  state.shelfRecords = [
    // SP001 — chỉ scan hôm nay.
    { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationLabel: 'KA1 — Kệ bánh kẹo', maHang: 'SP001', tenHang: 'Bánh quy HCRC 200g', quantity: 10, expiryDate: '', note: '', createdAt: today, lastScannedAt: today },
    // SP002 — CHỈ scan quá khứ (3 ngày trước), KHÔNG scan lại hôm nay — chính kịch bản người dùng nêu.
    { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationLabel: 'KA1 — Kệ bánh kẹo', maHang: 'SP002', tenHang: 'Sữa tươi HCRC 1L', quantity: 20, expiryDate: '', note: '', createdAt: threeDaysAgo, lastScannedAt: threeDaysAgo },
    // SP003 — 2 record RIÊNG (lô khác nhau): 1 quét hôm nay (5), 1 quét quá khứ (15, chưa quét lại).
    { id: 3, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationLabel: 'KA1 — Kệ bánh kẹo', maHang: 'SP003', tenHang: 'Nước suối Lavie 500ml', quantity: 5, expiryDate: '2026-12-01', note: '', createdAt: today, lastScannedAt: today },
    { id: 4, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationLabel: 'KA1 — Kệ bánh kẹo', maHang: 'SP003', tenHang: 'Nước suối Lavie 500ml', quantity: 15, expiryDate: '2026-06-01', note: '', createdAt: threeDaysAgo, lastScannedAt: threeDaysAgo }
  ];
  state.shelfLocations = [{ id: 1, dept: 'Siêu thị Quận 1', code: 'KA1', name: 'Kệ bánh kẹo', active: true }];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 800 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.click('#btnVhShelfSubRecon');
    await page.waitForTimeout(300);

    await shot(page, '#vanHanhShelfWrap', '01-doi-chieu-co-cot-tren-ke-qua-khu.png');

    const readRow = async (maHang) => page.evaluate((mh) => {
      const tr = Array.from(document.querySelectorAll('#vhShelfReconBody tr')).find(r => r.children[0]?.textContent.trim() === mh);
      if (!tr) return null;
      return {
        tonKhoHeThong: tr.children[2].textContent.trim(),
        trenKeHomNay: tr.children[3].textContent.trim(),
        trenKeQuaKhu: tr.children[4].textContent.trim(),
        ketQua: tr.children[5].textContent.trim()
      };
    }, maHang);

    const sp001 = await readRow('SP001');
    const sp002 = await readRow('SP002');
    const sp003 = await readRow('SP003');
    console.log('SP001 (chỉ scan hôm nay):', sp001);
    console.log('SP002 (chỉ scan quá khứ — bản CŨ sẽ KHÔNG hiện dòng này):', sp002);
    console.log('SP003 (scan cả hôm nay + quá khứ):', sp003);

    // SP002 PHẢI hiện ra (đây chính là bug người dùng báo — bản cũ sẽ trả null ở đây).
    assert.ok(sp002, 'LỖI: SP002 (chỉ scan quá khứ, chưa scan lại hôm nay) KHÔNG hiện trên bảng Đối Chiếu — đúng bug người dùng báo, chưa được vá');
    assert.strictEqual(sp002.trenKeHomNay, '0', 'LỖI: SP002 Trên Kệ Hôm Nay phải là 0 (không scan hôm nay)');
    assert.strictEqual(sp002.trenKeQuaKhu, '20', 'LỖI: SP002 Trên Kệ Quá Khứ phải là 20');
    assert.ok(sp002.ketQua.includes('Lệch'), 'LỖI: SP002 Kết Quả phải Lệch (Hôm Nay=0 vs Tồn Kho Hệ Thống=20, KHÔNG cộng Quá Khứ)');

    assert.strictEqual(sp001.trenKeHomNay, '10', 'LỖI: SP001 Trên Kệ Hôm Nay phải là 10');
    assert.strictEqual(sp001.trenKeQuaKhu, '0', 'LỖI: SP001 Trên Kệ Quá Khứ phải là 0 (chỉ scan hôm nay)');
    assert.ok(sp001.ketQua.includes('Khớp'), 'LỖI: SP001 Kết Quả phải Khớp (10=10)');

    assert.strictEqual(sp003.trenKeHomNay, '5', 'LỖI: SP003 Trên Kệ Hôm Nay phải là 5 (chỉ record hôm nay)');
    assert.strictEqual(sp003.trenKeQuaKhu, '15', 'LỖI: SP003 Trên Kệ Quá Khứ phải là 15 (record quá khứ riêng)');
    assert.ok(sp003.ketQua.includes('Khớp'), 'LỖI: SP003 Kết Quả phải Khớp (Hôm Nay=5=Tồn Kho Hệ Thống=5, KHÔNG cộng 15 Quá Khứ vào)');

    console.log('\n✅ Demo xác nhận: cột "Trên Kệ Quá Khứ" hiện đúng mã CHỈ scan trong quá khứ (SP002, đúng bug người dùng báo), và "Kết Quả" vẫn CHỈ so Hôm Nay (không bị Quá Khứ ảnh hưởng).');
  } finally {
    await browser.close();
    server.close();
  }
})();
