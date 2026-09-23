// server/tests/test-error-log-capture.js
//
// Unit test THUẦN NODE (không Playwright/DB thật) cho lib/errorLogCapture.js — cơ chế "Nhật Ký Lỗi Hệ
// Thống" (10/2026): bọc console.error()/console.warn() toàn cục + bắt uncaughtException/
// unhandledRejection, ghi thêm vào dbo.ErrorLogs (lib/errorLogStore.js) mà không cần sửa 175+ lời gọi
// console.error() rải rác khắp lib/routes/.
//
// Không dùng testHarness.js (Playwright, driven bởi mock DB trong trang) vì đây là hành vi THUẦN
// SERVER-SIDE (console/process global) — thay vào đó stub thẳng require.cache của lib/errorLogStore.js
// (module thật require('../db') -> mssql, không kết nối được trong sandbox không có SQL Server) để bắt
// đúng những gì captureErrorLog() gọi, không cần DB thật.
//
// Chạy: node server/tests/test-error-log-capture.js
const assert = require('assert');

const ERROR_LOG_STORE_PATH = require.resolve('../lib/errorLogStore');
const CAPTURE_PATH = require.resolve('../lib/errorLogCapture');

const REAL_CONSOLE_ERROR = console.error;
const REAL_CONSOLE_WARN = console.warn;

let insertedCalls;
function stubErrorLogStore(impl) {
  insertedCalls = [];
  require.cache[ERROR_LOG_STORE_PATH] = {
    id: ERROR_LOG_STORE_PATH,
    filename: ERROR_LOG_STORE_PATH,
    loaded: true,
    exports: {
      insertErrorLog: async (entry) => {
        insertedCalls.push(entry);
        if (impl) return impl(entry);
        return { id: 1, ...entry };
      }
    }
  };
}

// installErrorLogCapture() thay THẲNG console.error/console.warn (đọc console.error HIỆN TẠI làm
// "originalConsoleError" rồi ghi đè) + đăng ký process.on() listener — KHÔNG "gỡ" lại được sau khi cài.
// Mỗi kịch bản dưới đây PHẢI reset console.error/console.warn về ĐÚNG bản gốc thật (REAL_CONSOLE_ERROR/
// REAL_CONSOLE_WARN) TRƯỚC KHI gọi freshInstall() — nếu không, lần cài SAU sẽ vô tình bọc CHỒNG lên bản
// đã bọc của lần TRƯỚC (originalConsoleError của lần sau trở thành console.error đã-bị-bọc của lần
// trước, không phải console.error thật) và đếm log bị nhân đôi/sai — cùng 1 gotcha cho console.warn.
function freshInstall(opts) {
  console.error = REAL_CONSOLE_ERROR;
  console.warn = REAL_CONSOLE_WARN;
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
  delete require.cache[CAPTURE_PATH];
  const { installErrorLogCapture } = require(CAPTURE_PATH);
  return installErrorLogCapture(opts);
}

function cleanup() {
  console.error = REAL_CONSOLE_ERROR;
  console.warn = REAL_CONSOLE_WARN;
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
}

let passed = 0, failed = 0;
async function runAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}`);
    console.log(`  -> ${err && err.stack || err}`);
    failed++;
  } finally {
    cleanup();
  }
}

async function main() {
  await runAsync('console.error() vẫn in ra console THẬT (không bị nuốt mất) + ghi thêm vào ErrorLogs', async () => {
    stubErrorLogStore();
    freshInstall();
    console.error('Lỗi test', 'chi tiết thêm'); // gọi qua bản ĐÃ BỊ BỌC (installErrorLogCapture vừa thay console.error)
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(insertedCalls.length, 1, 'Phải ghi đúng 1 dòng vào ErrorLogs');
    assert.strictEqual(insertedCalls[0].level, 'ERROR');
    assert.ok(insertedCalls[0].message.includes('Lỗi test') && insertedCalls[0].message.includes('chi tiết thêm'), 'message phải chứa đủ nội dung đã log');
  });

  await runAsync('console.warn() ghi vào ErrorLogs với level WARNING (khác console.error)', async () => {
    stubErrorLogStore();
    freshInstall();
    console.warn('Cảnh báo test');
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(insertedCalls.length, 1);
    assert.strictEqual(insertedCalls[0].level, 'WARNING');
  });

  await runAsync('Error object truyền vào console.error() -> stack được trích ra đúng cho ErrorLogs.stack', async () => {
    stubErrorLogStore();
    freshInstall();
    const err = new Error('Lỗi có stack thật');
    console.error('Ngữ cảnh:', err);
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(insertedCalls.length, 1);
    assert.ok(insertedCalls[0].stack && insertedCalls[0].stack.includes('Lỗi có stack thật'), 'stack phải được trích từ Error object trong args');
    assert.ok(insertedCalls[0].message.includes('Ngữ cảnh:') && insertedCalls[0].message.includes('Lỗi có stack thật'));
  });

  await runAsync('CHỐNG ĐỆ QUY: insertErrorLog() bản thân ném lỗi liên tục (mô phỏng CSDL mất kết nối) -> KHÔNG lặp vô hạn, chỉ đúng 1 lần thử ghi', async () => {
    // Mô phỏng đúng kịch bản nguy hiểm nhất: CSDL đang là nguyên nhân gây lỗi khi chính insertErrorLog()
    // được gọi để GHI một lỗi khác. Nếu captureErrorLog() lỡ dùng console.error ĐÃ BỊ BỌC (thay vì
    // originalConsoleError) ở bất kỳ đâu trong đường xử lý insert thất bại, sẽ tự gọi lại chính nó ->
    // insertErrorLog() thất bại nữa -> lặp vô hạn (test này sẽ TREO/timeout nếu thực sự xảy ra, tự nó là
    // 1 phép thử đáng tin cậy). Đúng 1 lần gọi insertErrorLog() từ ĐÚNG 1 lần gọi console.error() ban đầu
    // là bằng chứng không có đệ quy nào xảy ra.
    stubErrorLogStore(async () => { throw new Error('Mất kết nối CSDL (mô phỏng)'); });
    freshInstall();
    console.error('Kích hoạt 1 lỗi ban đầu');
    await new Promise(r => setTimeout(r, 200));
    assert.strictEqual(insertedCalls.length, 1, 'Chỉ đúng 1 lần THỬ ghi log từ 1 lần gọi console.error() ban đầu — không lặp lại dù insertErrorLog() luôn thất bại');
  });

  await runAsync('uncaughtException: ghi log kèm stack, rồi THOÁT tiến trình (exit(1)) — không "sống tiếp"', async () => {
    stubErrorLogStore();
    let exitCode = null;
    freshInstall({ exit: (code) => { exitCode = code; } });
    const err = new Error('Lỗi không lường trước');
    process.emit('uncaughtException', err);
    await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(exitCode, 1, 'Phải gọi exit(1) sau khi ghi log xong — giữ nguyên hành vi crash-restart mặc định của pm2 (xác nhận với người dùng khi thiết kế tính năng này)');
    assert.strictEqual(insertedCalls.length, 1);
    assert.strictEqual(insertedCalls[0].level, 'ERROR');
    assert.ok(insertedCalls[0].stack && insertedCalls[0].stack.includes('Lỗi không lường trước'));
  });

  await runAsync('unhandledRejection: reason không phải Error object (VD reject bằng chuỗi) vẫn ghi log + thoát đúng', async () => {
    stubErrorLogStore();
    let exitCode = null;
    freshInstall({ exit: (code) => { exitCode = code; } });
    process.emit('unhandledRejection', 'chuỗi lý do reject, không phải Error');
    await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(exitCode, 1);
    assert.strictEqual(insertedCalls.length, 1);
    assert.ok(insertedCalls[0].message.includes('chuỗi lý do reject'));
  });

  await runAsync('insertErrorLog() TREO (không bao giờ resolve, VD CSDL không phản hồi) — vẫn exit(1) trong vòng ~3s, không treo vô hạn', async () => {
    stubErrorLogStore(() => new Promise(() => {})); // Promise không bao giờ resolve/reject.
    let exitCode = null;
    freshInstall({ exit: (code) => { exitCode = code; } });
    const start = Date.now();
    process.emit('uncaughtException', new Error('DB treo'));
    // Chờ hơn 3s (giới hạn cứng trong captureErrorLog()) 1 chút để chắc chắn timeout đã kích hoạt.
    await new Promise(r => setTimeout(r, 3300));
    const elapsed = Date.now() - start;
    assert.strictEqual(exitCode, 1, 'Vẫn phải exit(1) dù insertErrorLog() không bao giờ resolve');
    assert.ok(elapsed < 3600, `Không được treo quá lâu (đo được ${elapsed}ms) — giới hạn cứng 3s phải có hiệu lực`);
  });

  console.log('');
  console.log(`==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
