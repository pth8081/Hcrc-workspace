// tests/test-stocktake-period-create-both-types.js — Playwright THẬT cho tính năng MỚI (12/2026, theo
// yêu cầu người dùng: "Tạo kiểm kê tôi muốn chọn được cả kiểm kê và gom mã để tạo cho nhanh và hai kỳ
// vẫn kết thúc riêng, kết thúc thì sẽ kết thúc tổng và áp dụng cho all st/ch thuộc kỳ kiểm kê đó (ko kết
// thúc riêng lẻ từng zt/ch bạn nhé)") ở Tab 1 "Kỳ Kiểm Kê": checkbox "Tạo đồng thời cả 2 loại (Kiểm Kê +
// Gom Mã)" — tick vào thì submitCreateKkPeriod() tạo CẢ 2 loại kỳ cùng lúc cho (các) siêu thị đã chọn,
// loại ĐANG CHỌN ở ô "Loại:" giữ nguyên Tên Kỳ gõ tay, loại còn lại tự thêm hậu tố " - <Nhãn Loại>".
// 2 việc PHẢI xác nhận kỹ (lý do chính viết test riêng, không gộp vào test-stocktake-period-multiselect.js
// đã có): (1) 2 loại kỳ PHẢI là 2 batchId HOÀN TOÀN RIÊNG — đóng kỳ loại này KHÔNG được kéo theo đóng
// loại kia (closeSessionBatch() cascade theo batchId, lib/stocktakeEngine.js); (2) "Đóng Kỳ"/kết thúc
// VẪN áp dụng cho CẢ NHÓM siêu thị cùng 1 loại kỳ (tính năng "đóng tổng, không đóng lẻ từng ST/CH" đã có
// từ trước — xác nhận KHÔNG bị phá vỡ bởi thay đổi này).
// Chạy: node server/tests/test-stocktake-period-create-both-types.js
'use strict';
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8995;

async function selectSdd(page, inputId, dropdownId, label) {
  await page.click(`#${inputId}`);
  await page.waitForTimeout(80);
  await page.click(`#${dropdownId} div[data-sdd-idx]:text-is(${JSON.stringify(label)})`);
}

(async () => {
  const ADMIN = { username: 'admin', name: 'Admin', dept: 'Siêu thị A', perms: { admin: true }, active: true, totpEnabled: true };
  const STORES = ['Siêu thị A', 'Siêu thị B'];
  const state = createMockState({ depts: STORES, stores: STORES, users: [ADMIN], stocktakeSessions: [] });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  page.on('dialog', (dialog) => dialog.accept());
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('kiemKe'); });
    await page.waitForTimeout(200);

    // ===== 1) Mở hộp Tạo Kỳ Mới, tick "Tạo đồng thời cả 2 loại", chọn CẢ A+B, tên "Kiểm Kê Q4/2026" =====
    await page.click('#btnKkPeriodOpenCreate');
    await page.waitForTimeout(250);
    assert.strictEqual(await page.isVisible('#kkNewCreateBothLoai'), true, 'LỖI: phải có checkbox "Tạo đồng thời cả 2 loại"');
    // Mặc định Loại = Gom Mã (kkNewLoaiKySelected reset về GOM_MA mỗi lần mở hộp) — đổi sang Kiểm Kê để
    // xác nhận ĐÚNG loại đang chọn giữ nguyên tên gõ tay, loại còn lại (Gom Mã) mới bị thêm hậu tố.
    await selectSdd(page, 'kkNewLoaiKyInput', 'kkNewLoaiKyDropdown', 'Loại: Kiểm Kê');
    await page.click('#kkNewCreateBothLoai');
    await page.waitForTimeout(250);
    await page.click('[data-op="selectAllKkNewStores"]');
    await page.waitForTimeout(100);
    await page.fill('#kkNewTenKy', 'Kiểm Kê Q4/2026');
    await page.click('[data-op="submitCreateKkPeriod"]');
    await page.waitForTimeout(400);
    console.log('PASS: Mở hộp, tick "Tạo đồng thời cả 2 loại", chọn 2 siêu thị, bấm Tạo không lỗi JS tức thời');

    // ===== 2) Xác nhận ĐỦ 4 bản ghi được tạo: (A, THONG_KE), (A, GOM_MA), (B, THONG_KE), (B, GOM_MA) =====
    // state sống trong tiến trình Node của chính test này (createMockState() ngay trên) — đọc THẲNG
    // không cần page.evaluate() (mock dispatch chạy qua page.exposeFunction('__apiDispatch', ...) gọi
    // ngược lại đúng closure `state` này mỗi lần page gọi fetch(), xem launchPage()/createDispatcher()).
    const sessions = state.stocktakeSessions || [];
    assert.strictEqual(sessions.length, 4, `LỖI: phải tạo đủ 4 bản ghi (2 siêu thị × 2 loại kỳ), có ${sessions.length}`);
    const find = (dept, loaiKy) => sessions.find(s => s.dept === dept && s.loaiKy === loaiKy);
    const aTK = find('Siêu thị A', 'THONG_KE'), aGM = find('Siêu thị A', 'GOM_MA');
    const bTK = find('Siêu thị B', 'THONG_KE'), bGM = find('Siêu thị B', 'GOM_MA');
    assert.ok(aTK && aGM && bTK && bGM, 'LỖI: thiếu 1 trong 4 tổ hợp (siêu thị × loại kỳ)');
    console.log('PASS: Tạo đủ 4 bản ghi — mỗi siêu thị đã chọn có CẢ 2 loại kỳ (Kiểm Kê + Gom Mã)');

    // ===== 3) Tên kỳ: loại ĐANG CHỌN (Kiểm Kê) giữ nguyên tên gõ tay, loại còn lại (Gom Mã) có hậu tố =====
    assert.strictEqual(aTK.tenKy, 'Kiểm Kê Q4/2026', 'LỖI: loại đang chọn (Kiểm Kê) phải giữ NGUYÊN tên gõ tay');
    assert.strictEqual(aGM.tenKy, 'Kiểm Kê Q4/2026 - Gom Mã', 'LỖI: loại còn lại (Gom Mã) phải tự thêm hậu tố " - Gom Mã"');
    assert.strictEqual(bTK.tenKy, 'Kiểm Kê Q4/2026');
    assert.strictEqual(bGM.tenKy, 'Kiểm Kê Q4/2026 - Gom Mã');
    console.log('PASS: Tên kỳ đúng quy ước "tự thêm hậu tố" — loại đang chọn giữ nguyên, loại còn lại thêm " - <Nhãn Loại>"');

    // ===== 4) 2 loại kỳ PHẢI có batchId HOÀN TOÀN KHÁC NHAU (không lẫn giữa Kiểm Kê và Gom Mã) =====
    assert.ok(aTK.batchId && bTK.batchId, 'LỖI: 2 siêu thị Kiểm Kê phải có batchId (tạo cùng lúc nhiều siêu thị)');
    assert.ok(aGM.batchId && bGM.batchId, 'LỖI: 2 siêu thị Gom Mã phải có batchId (tạo cùng lúc nhiều siêu thị)');
    assert.strictEqual(aTK.batchId, bTK.batchId, 'LỖI: 2 kỳ Kiểm Kê (A, B) phải CÙNG batchId để cascade Kích Hoạt/Đóng Kỳ cho nhau');
    assert.strictEqual(aGM.batchId, bGM.batchId, 'LỖI: 2 kỳ Gom Mã (A, B) phải CÙNG batchId để cascade Kích Hoạt/Đóng Kỳ cho nhau');
    assert.notStrictEqual(aTK.batchId, aGM.batchId, 'LỖI NGHIÊM TRỌNG: batchId của Kiểm Kê và Gom Mã KHÔNG được trùng nhau — nếu trùng, đóng kỳ loại này sẽ vô tình kéo theo đóng luôn loại kia (trái yêu cầu "hai kỳ vẫn kết thúc riêng")');
    console.log('PASS: Kiểm Kê và Gom Mã có batchId HOÀN TOÀN TÁCH BIỆT — đúng yêu cầu "hai kỳ vẫn kết thúc riêng"');

    // ===== 5) Kích Hoạt rồi Đóng Kỳ loại Kiểm Kê (bấm ở DÒNG A) -> áp dụng cho CẢ A và B (đóng tổng,
    // không đóng lẻ — tính năng đã có từ trước), NHƯNG 2 kỳ Gom Mã (A, B) PHẢI VẪN CÒN Đang hoạt động/
    // Nháp, KHÔNG bị đóng theo. =====
    await page.evaluate(async (id) => { await fetch(`/api/stocktake/sessions/${id}/activate`, { method: 'POST' }); }, aTK.id);
    await page.evaluate(async (id) => { await fetch(`/api/stocktake/sessions/${id}/close`, { method: 'POST' }); }, aTK.id);
    await page.waitForTimeout(100);
    const after = state.stocktakeSessions || [];
    const aTK2 = after.find(s => s.id === aTK.id), bTK2 = after.find(s => s.id === bTK.id);
    const aGM2 = after.find(s => s.id === aGM.id), bGM2 = after.find(s => s.id === bGM.id);
    assert.strictEqual(aTK2.trangThai, 'DA_CHOT', 'LỖI: kỳ Kiểm Kê A (vừa bấm Đóng Kỳ) phải Đã chốt');
    assert.strictEqual(bTK2.trangThai, 'DA_CHOT', 'LỖI: kỳ Kiểm Kê B ("anh em" cùng batchId) phải TỰ ĐỘNG Đã chốt theo — đóng tổng, không đóng lẻ');
    assert.strictEqual(aGM2.trangThai, 'NHAP', 'LỖI NGHIÊM TRỌNG: kỳ Gom Mã A KHÔNG được bị đóng theo khi đóng kỳ Kiểm Kê — 2 loại phải kết thúc HOÀN TOÀN RIÊNG');
    assert.strictEqual(bGM2.trangThai, 'NHAP', 'LỖI NGHIÊM TRỌNG: kỳ Gom Mã B KHÔNG được bị đóng theo khi đóng kỳ Kiểm Kê — 2 loại phải kết thúc HOÀN TOÀN RIÊNG');
    console.log('PASS: Đóng Kỳ Kiểm Kê áp dụng cho CẢ NHÓM siêu thị cùng loại (đóng tổng, không đóng lẻ) — và KHÔNG kéo theo đóng kỳ Gom Mã (2 loại kết thúc hoàn toàn riêng)');

    assert.strictEqual(jsErrors.length, 0, 'LỖI: có lỗi JS phát sinh: ' + jsErrors.join('\n'));
    console.log('PASS: Không có lỗi JS (pageerror) nào trong suốt quá trình thao tác THẬT');

    console.log('\n==== 6/6 scenario(s) passed ====');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error('FAIL:', err); process.exit(1); });
