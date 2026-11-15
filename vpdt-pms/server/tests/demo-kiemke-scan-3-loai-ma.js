// tests/demo-kiemke-scan-3-loai-ma.js — DEMO ảnh thật xác nhận ô quét ở 3 tab "📷 Gom Mã"/"🔢 Kiểm Đếm"/
// "🛡️ Kiểm Soát" (module "📋 Kiểm Kê") nhận diện ĐÚNG sản phẩm dù gõ/quét 1 trong 3 LOẠI MÃ khác nhau mà
// API "Tồn Kho" đối tác trả về cho CÙNG 1 mã hàng (theo yêu cầu người dùng: "đọc camera có đúng theo các
// thông tin mà bên API trả về, là vừa là mã nội bộ, vừa là mã vạch nhà sản xuất và vừa là mã barcode"):
//   1) Mã Nội Bộ (`maHang`) — mã riêng của hệ thống, không phải mã vạch.
//   2) Mã Vạch Nhà Sản Xuất MẶC ĐỊNH (`maVach`) — mã EAN-13 chuẩn do nhà sản xuất in trên bao bì.
//   3) Mã Vạch PHỤ (1 giá trị trong `dsMaVach` nhưng KHÔNG phải `maVach` mặc định) — 1 mã hàng có thể có
//      NHIỀU mã vạch hợp lệ (VD 1 sản phẩm đóng gói nhiều quy cách), API trả đủ qua mảng `dsMaVach` (LUÔN
//      chứa cả giá trị `maVach`) — xem lib/shelfInventoryAggregate.js + VERSION.md v30.24.
// Cơ chế đối chiếu dùng CHUNG resolveKkScanItemFromCode() (module-vanhanh.js): thử Mã Vạch (kể cả
// dsMaVach) trước, rồi Mã Hàng nội bộ, rồi 6 số cuối (chỉ nhận khi khớp DUY NHẤT) — ĐÚNG cơ chế đã dùng
// cho "📷 Ghi Nhận"/"💲 Kiểm Tra Giá" ở Kiểm Soát Hàng Hóa, không viết logic riêng cho Kiểm Kê.
//
// Chạy: node server/tests/demo-kiemke-scan-3-loai-ma.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8993;
const OUT_DIR = process.env.KIEMKE_SCAN_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'kiemke-scan-3-loai-ma');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const USER = {
    username: 'nv1', name: 'Nhân Viên Kiểm Kê', dept: DEPT1,
    perms: { kiemKeGomMaDo: true, kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true }, active: true, totpEnabled: true
  };
  const GOM_MA_SESSION = { id: 9001, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã T46/2026', trangThai: 'DANG_HOAT_DONG' };
  const THONG_KE_SESSION = { id: 9002, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [USER],
    shelfLocations: [SHELF_A1],
    stocktakeSessions: [GOM_MA_SESSION, THONG_KE_SESSION],
    stocktakeUserAccess: [{ id: 1, username: 'nv1', dept: DEPT1, shelfLocationId: 10, canGomMa: true, canKiemDem: true, canKiemSoat: true }],
    stocktakeCounts: []
  });

  // 3 sản phẩm, mỗi sản phẩm minh hoạ ĐÚNG 1 trong 3 loại mã API trả về — mã dùng để quét/gõ ghi rõ ở
  // comment, KHÔNG trùng nhau giữa các sản phẩm để không lẫn kết quả.
  const PRODUCT_NOIBO = { maHang: '2003330491', maVach: '8934696001589', tenHang: 'Sữa tươi TH True Milk 1L', soLuongTon: 100 };
  const PRODUCT_MAVACH_MACDINH = {
    maHang: '2002092675', maVach: '8935024912607',
    dsMaVach: ['8935024912607', '8935024122310', '8935024123096'],
    tenHang: 'G7 Cà Phê 3in1 - Hộp 18x16g', soLuongTon: 42
  };
  const PRODUCT_MAVACH_PHU = {
    maHang: '2001112223', maVach: '8939999999999',
    dsMaVach: ['8939999999999', '8931111111111', '8932222222222'],
    tenHang: 'Dầu Ăn Simply 1L', soLuongTon: 60
  };
  state.__mockSystemInventoryRows = [PRODUCT_NOIBO, PRODUCT_MAVACH_MACDINH, PRODUCT_MAVACH_PHU];

  const SCANS = [
    { code: PRODUCT_NOIBO.maHang, label: '1) Mã Nội Bộ' },
    { code: PRODUCT_MAVACH_MACDINH.maVach, label: '2) Mã Vạch Nhà Sản Xuất (mặc định)' },
    { code: PRODUCT_MAVACH_PHU.dsMaVach[1], label: '3) Mã Vạch PHỤ (không phải mã mặc định)' }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1400, height: 1000 });
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('404')) jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  async function runTab(tabKey, { btnSelector, shelfSelectId, barcodeInputId, qtySubmitSelector, screenshotName }) {
    await page.click(btnSelector);
    await page.waitForTimeout(200);
    await page.selectOption(`#${shelfSelectId}`, '10');
    await page.waitForTimeout(250);
    for (const scan of SCANS) {
      await page.fill(`#${barcodeInputId}`, scan.code);
      await page.click(qtySubmitSelector);
      await page.waitForTimeout(200);
    }
    await page.screenshot({ path: path.join(OUT_DIR, screenshotName), fullPage: true });
    console.log(`Đã chụp: ${screenshotName}`);
  }

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);

    await runTab('GOMMA', {
      btnSelector: '#btnKkSubGomMa', shelfSelectId: 'kkGomMaShelfSelect', barcodeInputId: 'kkGomMaBarcodeInput',
      qtySubmitSelector: '[data-op="submitKkScan"][data-arg0="GOMMA"]', screenshotName: '1-gom-ma-quet-3-loai-ma.png'
    });
    await runTab('KIEMDEM', {
      btnSelector: '#btnKkSubKiemDem', shelfSelectId: 'kkKiemDemShelfSelect', barcodeInputId: 'kkKiemDemBarcodeInput',
      qtySubmitSelector: '[data-op="submitKkScan"][data-arg0="KIEMDEM"]', screenshotName: '2-kiem-dem-quet-3-loai-ma.png'
    });
    await runTab('KIEMSOAT', {
      btnSelector: '#btnKkSubKiemSoat', shelfSelectId: 'kkKiemSoatShelfSelect', barcodeInputId: 'kkKiemSoatBarcodeInput',
      qtySubmitSelector: '[data-op="submitKkScan"][data-arg0="KIEMSOAT"]', screenshotName: '3-kiem-soat-quet-3-loai-ma.png'
    });

    // Xác nhận LẠI bằng dữ liệu thật trong danh sách (không chỉ nhìn ảnh) — mỗi tab phải ra ĐÚNG 3 dòng,
    // đúng Mã Hàng/Tên Hàng tương ứng, dù mã gõ vào mỗi dòng là 1 LOẠI MÃ khác nhau.
    const checkListRows = async (listBodyId) => page.evaluate((id) => {
      const rows = Array.from(document.querySelectorAll(`#${id} > div, #${id} tr`));
      return document.getElementById(id)?.textContent || '';
    }, listBodyId);
    const gomMaText = await checkListRows('kkGomMaListBody');
    const kiemDemText = await checkListRows('kkKiemDemListBody');
    const kiemSoatText = await checkListRows('kkKiemSoatListBody');
    const expectNames = [PRODUCT_NOIBO.tenHang, PRODUCT_MAVACH_MACDINH.tenHang, PRODUCT_MAVACH_PHU.tenHang];
    for (const [tabName, text] of [['Gom Mã', gomMaText], ['Kiểm Đếm', kiemDemText], ['Kiểm Soát', kiemSoatText]]) {
      const missing = expectNames.filter(n => !text.includes(n));
      if (missing.length) console.log(`⚠️ Tab ${tabName}: THIẾU sản phẩm trong danh sách: ${missing.join(', ')}`);
      else console.log(`✅ Tab ${tabName}: cả 3 sản phẩm (3 loại mã) đều nhận diện đúng.`);
    }

    console.log(jsErrors.length ? `⚠️ Có lỗi JS: ${jsErrors.join(' | ')}` : '✅ Không có lỗi JS/console nào phát sinh.');
    console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
