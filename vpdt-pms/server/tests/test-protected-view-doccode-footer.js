// server/tests/test-protected-view-doccode-footer.js
//
// Mã hồ sơ nối tiếp dòng "Hệ thống văn phòng số Công ty HCRC" (11/2026, yêu cầu người dùng): watermark
// Khung Xem Bảo Vệ (module-tailieu.js::buildProtectedViewWatermarkText()) VÀ watermark đóng dấu vào file
// PDF thật khi tải (routes/download.js::resolveDownloadWatermarkText()) đều nối thêm mã hồ sơ khi có.
//
// Phủ:
//   [1] Server: resolveDownloadWatermarkText() — allowlist ký tự mã hồ sơ, rỗng/undefined/ký tự lạ ->
//       KHÔNG nối gì (an toàn), mã hợp lệ -> nối đúng định dạng " - <mã>".
//   [2] Client (browser thật, testHarness.js): attachmentDownloadUrl() đính kèm &code=... đúng khi có
//       docCode, KHÔNG đính kèm khi không có (giữ nguyên hành vi cũ — không phá vỡ bất kỳ URL nào khác).
//   [3] Client (browser thật): openFileProtectedView({docCode}) truyền ĐÚNG chuỗi đã nối vào
//       window.renderPdfProtected() (watermark thật của Khung Xem PDF) — spy lại renderPdfProtected để
//       xác nhận không cần render PDF thật.
//
// Chạy: node server/tests/test-protected-view-doccode-footer.js
'use strict';
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');
const downloadRoutes = require('../routes/download');

const PORT = 8991;
let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { console.log(`PASS: ${name}`); passed++; }
  else { console.log(`FAIL: ${name}`); failed++; }
}

const USER = { username: 'demo_user', name: 'Người Dùng Demo', dept: 'Vận Hành', perms: {}, active: true };

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

(async () => {
  // ===================== [1] Server: resolveDownloadWatermarkText() =====================
  check('Server: mã hợp lệ (chữ+số+gạch ngang) -> nối đúng " - <mã>"',
    downloadRoutes.resolveDownloadWatermarkText('HCRC-HD-2026-00042') === 'Hệ thống văn phòng số Công ty HCRC - HCRC-HD-2026-00042');
  check('Server: rỗng -> KHÔNG nối gì (giữ nguyên watermark gốc)',
    downloadRoutes.resolveDownloadWatermarkText('') === 'Hệ thống văn phòng số Công ty HCRC');
  check('Server: undefined -> KHÔNG nối gì',
    downloadRoutes.resolveDownloadWatermarkText(undefined) === 'Hệ thống văn phòng số Công ty HCRC');
  check('Server: chứa khoảng trắng -> bị coi KHÔNG hợp lệ, KHÔNG nối (phòng tràn watermark)',
    downloadRoutes.resolveDownloadWatermarkText('ma co khoang trang') === 'Hệ thống văn phòng số Công ty HCRC');
  check('Server: chứa ký tự đặc biệt (thử chèn script/ký tự lạ) -> bị lọc, KHÔNG nối',
    downloadRoutes.resolveDownloadWatermarkText('<script>alert(1)</script>') === 'Hệ thống văn phòng số Công ty HCRC');
  check('Server: mã có dấu chấm/gạch dưới -> vẫn hợp lệ, nối đúng',
    downloadRoutes.resolveDownloadWatermarkText('HD_2026.042') === 'Hệ thống văn phòng số Công ty HCRC - HD_2026.042');
  check('Server: mã quá dài (>60 ký tự) -> bị cắt về 60 ký tự trước khi kiểm, không ném lỗi',
    downloadRoutes.resolveDownloadWatermarkText('A'.repeat(100)) === `Hệ thống văn phòng số Công ty HCRC - ${'A'.repeat(60)}`);

  // ===================== [2] + [3] Client thật (browser) =====================
  const state = createMockState({ depts: ['Vận Hành'], users: [USER] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  try {
    await loginAs(page, USER);

    const urlNoCode = await page.evaluate(() => attachmentDownloadUrl('/uploads/abc.pdf', null, 'abc.pdf'));
    check('Client: attachmentDownloadUrl() KHÔNG có docCode -> URL không có &code= (hành vi cũ giữ nguyên)',
      !urlNoCode.includes('code='));

    const urlWithCode = await page.evaluate(() => attachmentDownloadUrl('/uploads/abc.pdf', null, 'abc.pdf', 'HCRC-HD-2026-00042'));
    check('Client: attachmentDownloadUrl() CÓ docCode -> URL có &code=<mã đã encode>',
      urlWithCode.includes('code=HCRC-HD-2026-00042'));

    // Spy renderPdfProtected thật (không render PDF thật, chỉ ghi lại tham số watermarkText được truyền
    // vào) — xác nhận openFileProtectedView() tính ĐÚNG watermark cuối cùng qua
    // buildProtectedViewWatermarkText(docCode) rồi mới gọi hàm vẽ.
    const capturedNoCode = await page.evaluate(() => {
      window.__capturedWatermark = null;
      const original = window.renderPdfProtected;
      window.renderPdfProtected = (container, fileSrc, watermarkText) => { window.__capturedWatermark = watermarkText; };
      openFileProtectedView({ title: 'Test', fileSrc: '/uploads/fake.pdf', fileType: 'pdf', fileName: 'fake.pdf' });
      window.renderPdfProtected = original;
      return window.__capturedWatermark;
    });
    check('Client: openFileProtectedView() KHÔNG truyền docCode -> watermark CHỈ tên hệ thống (hành vi cũ)',
      capturedNoCode === 'Hệ thống văn phòng số Công ty HCRC');

    const capturedWithCode = await page.evaluate(() => {
      window.__capturedWatermark = null;
      const original = window.renderPdfProtected;
      window.renderPdfProtected = (container, fileSrc, watermarkText) => { window.__capturedWatermark = watermarkText; };
      openFileProtectedView({ title: 'Test', docCode: 'HCRC-HD-2026-00042', fileSrc: '/uploads/fake.pdf', fileType: 'pdf', fileName: 'fake.pdf' });
      window.renderPdfProtected = original;
      return window.__capturedWatermark;
    });
    check('Client: openFileProtectedView({docCode}) -> watermark nối ĐÚNG mã hồ sơ',
      capturedWithCode === 'Hệ thống văn phòng số Công ty HCRC - HCRC-HD-2026-00042');

  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
