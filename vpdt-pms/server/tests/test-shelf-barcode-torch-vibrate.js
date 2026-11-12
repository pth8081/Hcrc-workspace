// tests/test-shelf-barcode-torch-vibrate.js — "📋 Kiểm Soát Hàng Hóa" (11/2026, theo yêu cầu người dùng
// "xử lý giống scan & checkout" — đối chiếu cơ chế quét mã của BRG Scan & Checkout trên iPhone, phần "4.
// Điều khiển khi quét": "Máy rung nhẹ khi đọc được mã, nếu thiết bị hỗ trợ" + "Nút đèn flash chỉ hiện khi
// camera hỗ trợ. Safari iPhone thường không hỗ trợ đèn flash qua trình duyệt, nên nút này có thể không
// có.") — module-vanhanh.js: vibrateShelfBarcodeSuccess(), setupShelfBarcodeTorchButton(),
// toggleShelfBarcodeTorch(), và việc closeShelfBarcodeModal() reset lại trạng thái nút đèn flash.
//
// Playwright thật + static server thật (cùng khuôn test-shelf-mobile-and-offline-inventory.js) — KHÔNG mở
// camera thật (navigator.mediaDevices.getUserMedia không có camera phần cứng trong môi trường test) nên
// giả lập trực tiếp `shelfBarcodeStream`/`MediaStreamTrack` (getCapabilities/applyConstraints) thay vì gọi
// openShelfBarcodeModalCore() thật — các hàm đang kiểm đều đọc thẳng biến toàn cục này, không cần
// getUserMedia thật mới gọi được.
//
// Chạy: node server/tests/test-shelf-barcode-torch-vibrate.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const run = createRunner();
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8984;
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
    // Modal cần đang "mở" (bỏ class hidden) để đo được layout nút thật — không cần camera thật chạy bên trong.
    await page.evaluate(() => { document.getElementById('shelfBarcodeModal').classList.remove('hidden'); });

    await run.run('Mặc định (chưa có stream nào) — setupShelfBarcodeTorchButton() KHÔNG hiện nút đèn flash', async () => {
      const hidden = await page.evaluate(() => {
        shelfBarcodeStream = null;
        setupShelfBarcodeTorchButton();
        return document.getElementById('shelfBarcodeTorchBtn').classList.contains('hidden');
      });
      assert(hidden === true, 'Nút đèn flash phải ẨN khi không có stream nào (mirror trạng thái Safari iPhone không hỗ trợ torch)');
    });

    await run.run('Camera KHÔNG hỗ trợ torch (getCapabilities().torch=false/undefined) — nút đèn flash vẫn ẨN (đúng mô tả: "Safari iPhone thường không hỗ trợ đèn flash qua trình duyệt, nên nút này có thể không có")', async () => {
      const hidden = await page.evaluate(() => {
        shelfBarcodeStream = { getVideoTracks: () => [{ getCapabilities: () => ({}) }] };
        setupShelfBarcodeTorchButton();
        return document.getElementById('shelfBarcodeTorchBtn').classList.contains('hidden');
      });
      assert(hidden === true, 'Nút đèn flash phải ẨN khi camera không báo hỗ trợ torch');
    });

    await run.run('Camera CÓ hỗ trợ torch (getCapabilities().torch=true) — nút đèn flash HIỆN RA', async () => {
      const shown = await page.evaluate(() => {
        shelfBarcodeStream = {
          getVideoTracks: () => [{
            getCapabilities: () => ({ torch: true }),
            applyConstraints: async () => {}
          }]
        };
        setupShelfBarcodeTorchButton();
        return !document.getElementById('shelfBarcodeTorchBtn').classList.contains('hidden');
      });
      assert(shown === true, 'Nút đèn flash phải HIỆN khi camera báo hỗ trợ torch (VD 1 số máy Android)');
    });

    await run.run('Bấm nút đèn flash (toggleShelfBarcodeTorch) -> gọi applyConstraints({advanced:[{torch:true}]}) + đổi màu nút sang "đang bật"', async () => {
      const out = await page.evaluate(async () => {
        let capturedConstraints = null;
        shelfBarcodeStream = {
          getVideoTracks: () => [{
            getCapabilities: () => ({ torch: true }),
            applyConstraints: async (c) => { capturedConstraints = c; }
          }]
        };
        shelfBarcodeTorchOn = false;
        setupShelfBarcodeTorchButton();
        await toggleShelfBarcodeTorch();
        const btn = document.getElementById('shelfBarcodeTorchBtn');
        return {
          capturedConstraints,
          torchOn: shelfBarcodeTorchOn,
          btnClasses: [...btn.classList]
        };
      });
      assertEqual(JSON.stringify(out.capturedConstraints), JSON.stringify({ advanced: [{ torch: true }] }), 'Phải gọi applyConstraints với torch:true ở lượt bấm ĐẦU TIÊN');
      assert(out.torchOn === true, 'shelfBarcodeTorchOn phải chuyển thành true sau khi bật thành công');
      assert(out.btnClasses.includes('bg-amber-500'), `Nút phải đổi màu "đang bật" (bg-amber-500) — class thực tế: ${out.btnClasses.join(' ')}`);
    });

    await run.run('Bấm nút đèn flash LẦN 2 -> tắt lại (torch:false) + đổi màu nút về mặc định', async () => {
      const out = await page.evaluate(async () => {
        let capturedConstraints = null;
        shelfBarcodeStream = {
          getVideoTracks: () => [{
            getCapabilities: () => ({ torch: true }),
            applyConstraints: async (c) => { capturedConstraints = c; }
          }]
        };
        await toggleShelfBarcodeTorch(); // tắt lại (đang bật từ bước trước, state shelfBarcodeTorchOn giữ nguyên qua các lượt evaluate())
        const btn = document.getElementById('shelfBarcodeTorchBtn');
        return { capturedConstraints, torchOn: shelfBarcodeTorchOn, btnClasses: [...btn.classList] };
      });
      assertEqual(JSON.stringify(out.capturedConstraints), JSON.stringify({ advanced: [{ torch: false }] }), 'Phải gọi applyConstraints với torch:false ở lượt bấm THỨ 2');
      assert(out.torchOn === false, 'shelfBarcodeTorchOn phải chuyển lại thành false');
      assert(!out.btnClasses.includes('bg-amber-500') && out.btnClasses.includes('bg-black/55'), `Nút phải trở về màu mặc định — class thực tế: ${out.btnClasses.join(' ')}`);
    });

    await run.run('applyConstraints() ném lỗi (thiết bị báo hỗ trợ nhưng bật thật thất bại) -> KHÔNG crash, KHÔNG đổi trạng thái', async () => {
      const out = await page.evaluate(async () => {
        shelfBarcodeStream = {
          getVideoTracks: () => [{
            getCapabilities: () => ({ torch: true }),
            applyConstraints: async () => { throw new Error('Giả lập lỗi phần cứng'); }
          }]
        };
        shelfBarcodeTorchOn = false;
        let threw = false;
        try { await toggleShelfBarcodeTorch(); } catch (err) { threw = true; }
        return { threw, torchOn: shelfBarcodeTorchOn };
      });
      assert(out.threw === false, 'toggleShelfBarcodeTorch() phải TỰ bắt lỗi applyConstraints(), không ném ra ngoài làm crash luồng quét');
      assert(out.torchOn === false, 'Trạng thái torch KHÔNG được đổi khi applyConstraints() thất bại');
    });

    await run.run('closeShelfBarcodeModal() reset lại nút đèn flash về ẨN + màu mặc định (dọn sạch cho lượt quét kế tiếp)', async () => {
      const out = await page.evaluate(async () => {
        shelfBarcodeStream = {
          getTracks: () => [],
          getVideoTracks: () => [{
            getCapabilities: () => ({ torch: true }),
            applyConstraints: async () => {}
          }]
        };
        setupShelfBarcodeTorchButton();
        await toggleShelfBarcodeTorch(); // bật đèn
        closeShelfBarcodeModal();
        const btn = document.getElementById('shelfBarcodeTorchBtn');
        return { hidden: btn.classList.contains('hidden'), btnClasses: [...btn.classList], torchOn: shelfBarcodeTorchOn };
      });
      assert(out.hidden === true, 'Nút đèn flash phải ẨN lại sau khi đóng modal');
      assert(!out.btnClasses.includes('bg-amber-500'), `Màu "đang bật" phải được xoá khi đóng modal — class thực tế: ${out.btnClasses.join(' ')}`);
      assert(out.torchOn === false, 'shelfBarcodeTorchOn phải reset về false khi đóng modal');
      // Mở lại modal (đã bị ẩn ở closeShelfBarcodeModal()) cho bước test tiếp theo đo layout nếu cần.
      await page.evaluate(() => { document.getElementById('shelfBarcodeModal').classList.remove('hidden'); });
    });

    // ===== Rung nhẹ khi bắt được mã (navigator.vibrate) =====
    await run.run('onShelfBarcodeDecoded(): gọi navigator.vibrate(100) nếu thiết bị hỗ trợ (chế độ Ghi Nhận)', async () => {
      const out = await page.evaluate(() => {
        let capturedArg = null;
        const orig = navigator.vibrate;
        navigator.vibrate = (ms) => { capturedArg = ms; return true; };
        shelfBarcodeModalMode = 'RECORD';
        shelfBarcodeStream = { getTracks: () => [] };
        onShelfBarcodeDecoded('8938505970012');
        navigator.vibrate = orig;
        return { capturedArg, srSku: document.getElementById('srSku').value };
      });
      assertEqual(out.capturedArg, 100, 'Phải gọi navigator.vibrate(100) khi bắt được mã (chế độ Ghi Nhận)');
      assertEqual(out.srSku, '8938505970012', 'Vẫn điền đúng mã vào #srSku như hành vi cũ (không bị đổi do thêm rung)');
    });

    await run.run('onShelfBarcodeDecoded(): thiết bị KHÔNG hỗ trợ navigator.vibrate -> KHÔNG crash (bỏ qua êm)', async () => {
      const out = await page.evaluate(() => {
        const orig = navigator.vibrate;
        // @ts-ignore — giả lập trình duyệt không hỗ trợ API này (xoá hẳn, không phải trả về false)
        delete navigator.vibrate;
        let threw = false;
        shelfBarcodeModalMode = 'RECORD';
        shelfBarcodeStream = { getTracks: () => [] };
        try { onShelfBarcodeDecoded('8938505970099'); } catch (err) { threw = true; }
        navigator.vibrate = orig;
        return { threw };
      });
      assert(out.threw === false, 'onShelfBarcodeDecoded() KHÔNG được ném lỗi khi navigator.vibrate không tồn tại trên thiết bị');
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
