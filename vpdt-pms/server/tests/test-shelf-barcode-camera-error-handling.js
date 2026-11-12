// tests/test-shelf-barcode-camera-error-handling.js — "📋 Kiểm Soát Hàng Hóa" (11/2026, theo tài liệu +
// code mẫu người dùng gửi, rút từ ứng dụng nội bộ khác "BRG Scan & Checkout" — người dùng yêu cầu chỉ ra
// khác biệt rồi xử lý luôn) — module-vanhanh.js: openShelfBarcodeModalCore() + closeShelfBarcodeModal().
//
// 4 khác biệt đã vá so với bản trước, kiểm ở đây:
//   1. Kiểm tra window.isSecureContext TRƯỚC khi thử mở camera — báo rõ "không an toàn/HTTPS" thay vì để
//      getUserMedia() ném lỗi mơ hồ.
//   2. Phân loại lỗi getUserMedia() theo err.name: NotAllowedError/SecurityError -> thông báo CỤ THỂ "bị
//      chặn quyền, vào Cài Đặt bật lại" (khác hẳn thông báo chung chung cũ); NotFoundError/
//      OverconstrainedError -> "không có camera phù hợp"; còn lại -> thông báo chung kèm err.message.
//   3. closeShelfBarcodeModal() dọn sạch video.srcObject về null (trước đây chỉ dừng track, không gỡ
//      tham chiếu).
//   4. Tự đóng modal (tắt camera) khi document.hidden chuyển true (chuyển app/khoá màn hình) qua listener
//      visibilitychange — gỡ đúng listener khi đóng modal (không tích luỹ qua nhiều lượt mở).
//
// Playwright thật + static server thật (cùng khuôn test-shelf-mobile-and-offline-inventory.js) — giả lập
// navigator.mediaDevices.getUserMedia TRẢ VỀ/NÉM LỖI theo từng kịch bản, không cần camera phần cứng thật.
//
// Chạy: node server/tests/test-shelf-barcode-camera-error-handling.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const run = createRunner();
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8985;
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: 'Siêu thị Quận 1',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true
  };
  const state = createMockState({ depts: ['Siêu thị Quận 1'], users: [USER] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('SHELF'); setVanHanhShelfSubTab('RECORD'); });

    await run.run('window.isSecureContext = false -> báo rõ "không an toàn/HTTPS", KHÔNG gọi getUserMedia()', async () => {
      const out = await page.evaluate(async () => {
        let getUserMediaCalled = false;
        const origIsSecure = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
        Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
        const origGUM = navigator.mediaDevices.getUserMedia;
        navigator.mediaDevices.getUserMedia = async () => { getUserMediaCalled = true; return origGUM.call(navigator.mediaDevices, {}); };
        document.getElementById('shelfBarcodeModal').classList.add('hidden');
        await openShelfBarcodeModalCore();
        const text = document.getElementById('shelfBarcodeStatus').textContent;
        navigator.mediaDevices.getUserMedia = origGUM;
        if (origIsSecure) Object.defineProperty(window, 'isSecureContext', origIsSecure);
        closeShelfBarcodeModal();
        return { text, getUserMediaCalled };
      });
      assert(!out.getUserMediaCalled, 'KHÔNG được gọi getUserMedia() khi isSecureContext=false (chặn sớm)');
      assert(/HTTPS|an toàn/.test(out.text), `Thông báo phải nhắc tới HTTPS/an toàn, thực tế: "${out.text}"`);
    });

    await run.run('getUserMedia() ném NotAllowedError -> thông báo CỤ THỂ "bị chặn quyền, vào Cài Đặt" (khác thông báo chung chung)', async () => {
      const out = await page.evaluate(async () => {
        const origGUM = navigator.mediaDevices.getUserMedia;
        navigator.mediaDevices.getUserMedia = async () => { const e = new Error('Permission denied'); e.name = 'NotAllowedError'; throw e; };
        document.getElementById('shelfBarcodeModal').classList.add('hidden');
        await openShelfBarcodeModalCore();
        const text = document.getElementById('shelfBarcodeStatus').textContent;
        navigator.mediaDevices.getUserMedia = origGUM;
        closeShelfBarcodeModal();
        return { text };
      });
      assert(/Cài Đặt|chặn quyền camera/.test(out.text), `Thông báo phải hướng dẫn vào Cài Đặt bật lại quyền, thực tế: "${out.text}"`);
    });

    await run.run('getUserMedia() ném NotFoundError -> thông báo "không có camera phù hợp" (khác thông báo chung chung)', async () => {
      const out = await page.evaluate(async () => {
        const origGUM = navigator.mediaDevices.getUserMedia;
        navigator.mediaDevices.getUserMedia = async () => { const e = new Error('no device'); e.name = 'NotFoundError'; throw e; };
        document.getElementById('shelfBarcodeModal').classList.add('hidden');
        await openShelfBarcodeModalCore();
        const text = document.getElementById('shelfBarcodeStatus').textContent;
        navigator.mediaDevices.getUserMedia = origGUM;
        closeShelfBarcodeModal();
        return { text };
      });
      assert(/Không tìm thấy camera/.test(out.text), `Thông báo phải nói rõ không tìm thấy camera, thực tế: "${out.text}"`);
    });

    await run.run('getUserMedia() ném lỗi KHÁC (không rõ loại) -> vẫn hiện thông báo chung kèm message gốc (không crash)', async () => {
      const out = await page.evaluate(async () => {
        const origGUM = navigator.mediaDevices.getUserMedia;
        navigator.mediaDevices.getUserMedia = async () => { throw new Error('Lỗi lạ bất kỳ'); };
        document.getElementById('shelfBarcodeModal').classList.add('hidden');
        await openShelfBarcodeModalCore();
        const text = document.getElementById('shelfBarcodeStatus').textContent;
        navigator.mediaDevices.getUserMedia = origGUM;
        closeShelfBarcodeModal();
        return { text };
      });
      assert(out.text.includes('Lỗi lạ bất kỳ'), `Thông báo chung phải vẫn chứa message gốc, thực tế: "${out.text}"`);
    });

    await run.run('closeShelfBarcodeModal() dọn sạch video.srcObject về null', async () => {
      const out = await page.evaluate(async () => {
        // navigator.mediaDevices.getUserMedia() thật đòi hỏi camera phần cứng (không có trong môi trường
        // test) — dùng canvas.captureStream() để có 1 MediaStream THẬT (đúng kiểu dữ liệu srcObject chấp
        // nhận, trình duyệt từ chối gán 1 object thường/giả lập) mà không cần camera thật.
        const canvas = document.createElement('canvas');
        canvas.width = 2; canvas.height = 2;
        const fakeStream = canvas.captureStream();
        shelfBarcodeStream = fakeStream;
        const video = document.getElementById('shelfBarcodeVideo');
        video.srcObject = fakeStream;
        closeShelfBarcodeModal();
        return { srcObjectAfter: video.srcObject };
      });
      assert(out.srcObjectAfter === null, `video.srcObject phải về null sau khi đóng modal, thực tế: ${out.srcObjectAfter}`);
    });

    await run.run('document.hidden chuyển true (visibilitychange) trong lúc modal đang mở -> tự đóng modal + tắt track camera', async () => {
      const out = await page.evaluate(async () => {
        let trackStopped = false;
        const canvas = document.createElement('canvas');
        canvas.width = 2; canvas.height = 2;
        const fakeStream = canvas.captureStream();
        const track = fakeStream.getVideoTracks()[0];
        const origStop = track.stop.bind(track);
        track.stop = () => { trackStopped = true; origStop(); };
        const origGUM = navigator.mediaDevices.getUserMedia;
        navigator.mediaDevices.getUserMedia = async () => fakeStream;
        // video.play() trên MediaStream từ canvas.captureStream() có thể TREO VÔ THỜI HẠN trong Chromium
        // headless (không có GPU/compositor thật) — đã gặp đúng kiểu treo này ở test ZXing trước đây
        // (xem chú thích lịch sử tại tests/test-shelf-barcode-zxing-hints.js). openShelfBarcodeModalCore()
        // đã tự bọc try/catch quanh await video.play() nên override thành resolve ngay là an toàn, không
        // ảnh hưởng gì tới điều đang cần kiểm (đóng modal theo visibilitychange).
        const origPlay = HTMLVideoElement.prototype.play;
        HTMLVideoElement.prototype.play = function () { return Promise.resolve(); };
        document.getElementById('shelfBarcodeModal').classList.add('hidden');
        await openShelfBarcodeModalCore();
        HTMLVideoElement.prototype.play = origPlay;
        const openedHidden = document.getElementById('shelfBarcodeModal').classList.contains('hidden');
        // Giả lập chuyển app/khoá màn hình: document.hidden thật là getter read-only trên most browser,
        // nên override qua defineProperty tạm thời rồi tự phát sự kiện visibilitychange.
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        const hiddenAfter = document.getElementById('shelfBarcodeModal').classList.contains('hidden');
        delete document.hidden; // trả lại getter gốc của trình duyệt
        navigator.mediaDevices.getUserMedia = origGUM;
        return { openedHidden, hiddenAfter, trackStopped, streamNulled: shelfBarcodeStream === null };
      });
      assert(out.openedHidden === false, 'Modal phải đang MỞ trước khi giả lập chuyển app');
      assert(out.hiddenAfter === true, 'Modal phải TỰ ĐÓNG khi document.hidden chuyển true');
      assert(out.trackStopped, 'Track camera phải được dừng khi tự đóng do visibilitychange');
      assert(out.streamNulled, 'shelfBarcodeStream phải về null sau khi tự đóng');
    });

    await run.run('Mở modal LẦN 2 không tích luỹ listener visibilitychange cũ (đóng modal lần 1 trước đó đã gỡ đúng listener)', async () => {
      const out = await page.evaluate(async () => {
        let closeCount = 0;
        const origClose = window.closeShelfBarcodeModal;
        window.closeShelfBarcodeModal = (...args) => { closeCount++; return origClose.apply(null, args); };
        const makeFakeStream = () => { const c = document.createElement('canvas'); c.width = 2; c.height = 2; return c.captureStream(); };
        const origGUM = navigator.mediaDevices.getUserMedia;
        navigator.mediaDevices.getUserMedia = async () => makeFakeStream();
        // Cùng lý do override play() như kịch bản trên — tránh treo page.evaluate() vô thời hạn.
        const origPlay = HTMLVideoElement.prototype.play;
        HTMLVideoElement.prototype.play = function () { return Promise.resolve(); };

        document.getElementById('shelfBarcodeModal').classList.add('hidden');
        await openShelfBarcodeModalCore(); // lượt mở 1
        window.closeShelfBarcodeModal();   // đóng tay (gỡ listener lượt 1)
        await openShelfBarcodeModalCore(); // lượt mở 2 (đăng ký listener MỚI)
        HTMLVideoElement.prototype.play = origPlay;

        closeCount = 0; // chỉ đếm số lần gọi do visibilitychange gây ra, không tính các lần gọi tay ở trên
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.hidden;
        navigator.mediaDevices.getUserMedia = origGUM;
        window.closeShelfBarcodeModal = origClose;
        return { closeCount };
      });
      assertEqual(out.closeCount, 1, `visibilitychange chỉ được gọi closeShelfBarcodeModal() ĐÚNG 1 LẦN (không tích luỹ listener cũ từ lượt mở trước), thực tế: ${out.closeCount}`);
    });

    await run.run('Không có lỗi console.error/pageerror nào trong suốt bài test', async () => {
      assertEqual(jsErrors.length, 0, `phải 0 lỗi, thực tế: ${JSON.stringify(jsErrors)}`);
    });
  } finally {
    await browser.close();
    server.close();
  }
  run.summary();
}

main().catch(err => { console.error(err); process.exit(1); });
