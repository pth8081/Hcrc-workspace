// server/tests/test-muahang-tier-amount-format.js
//
// LỖI ĐÃ VÁ (người dùng phản ánh, 9/2026): ô "Từ số tiền" của bậc thang điều khoản chiết khấu (Mua Hàng
// > BAS, module-muahang.js::mhRenderTierRows()) thiếu class "money-input" — KHÔNG tự chèn dấu chấm phân
// cách hàng nghìn khi gõ như MỌI ô nhập tiền khác trong hệ thống (VD unitPrice/amount ở Vận Hành,
// voDiscountAmount...), gõ số lớn (VD 500000000) rất khó đọc/dễ gõ nhầm số 0. Đã thêm class "money-input"
// + dùng formatMoneyDisplay() (core.js) khi render, và mhUpdateTierField() lưu số THẬT ngay lúc gõ (mirror
// updateOperationOrderItemField() ở module-vanhanh.js) thay vì lưu nguyên chuỗi có thể lẫn dấu chấm.
//
// Test tải THẲNG core.js + module-muahang.js (không cần server/login — 2 hàm liên quan không đụng
// DB/fetch) qua 1 Express tối giản chỉ phục vụ static, dùng Playwright để có DOM thật (money-input dựa
// vào document.addEventListener('input', ...) toàn trang ở core.js).
//
// Chạy: node server/tests/test-muahang-tier-amount-format.js
'use strict';
const path = require('path');

async function main() {
  const express = require(path.join(__dirname, '..', 'node_modules', 'express'));
  const securityHeaders = require(path.join(__dirname, '..', 'lib', 'securityHeaders'));
  const PUBLIC_DIR = path.join(__dirname, '..', 'public');

  const app = express();
  app.use(securityHeaders);
  app.get('/', (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8').send(
      '<!DOCTYPE html><html><head></head><body><div id="mhTierRowsWrap"></div>' +
      '<script src="/js/core.js"></script><script src="/js/module-muahang.js"></script></body></html>'
    );
  });
  app.use(express.static(PUBLIC_DIR));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;

  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });

  let passed = 0, failed = 0;
  function record(name, ok, detail) {
    if (ok) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.error(`  ❌ ${name}${detail ? '\n     ' + detail : ''}`); }
  }

  const result = await page.evaluate(async () => {
    // Render 1 bậc có sẵn fromAmount lớn (mô phỏng mở form Sửa 1 điều khoản đã có dữ liệu).
    mhTierRows = [{ fromAmount: 500000000, ratePct: '5' }];
    mhRenderTierRows();
    const input = document.querySelector('#mhTierRowsWrap input[data-arg1="fromAmount"]');
    const hasMoneyClass = input.classList.contains('money-input');
    const initialDisplay = input.value;

    // Gõ thêm 1 số vào cuối (giả lập double sự kiện input thật của trình duyệt: set value trước, dispatch sau).
    input.focus();
    input.value = input.value + '5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    const afterTypeDisplay = input.value;
    const storedFromAmount = mhTierRows[0].fromAmount;

    // Trường hợp rỗng (thêm bậc mới) không được hiện "NaN"/lỗi gì.
    mhTierRows = [{ fromAmount: '', ratePct: '' }];
    mhRenderTierRows();
    const emptyInput = document.querySelector('#mhTierRowsWrap input[data-arg1="fromAmount"]');
    const emptyDisplay = emptyInput.value;

    return { hasMoneyClass, initialDisplay, afterTypeDisplay, storedFromAmount, emptyDisplay };
  });

  record('LỖI ĐÃ VÁ: input "Từ số tiền" có class "money-input" (trước đây thiếu hẳn)', result.hasMoneyClass === true);
  record('LỖI ĐÃ VÁ: giá trị hiển thị NGAY LÚC RENDER (mở form Sửa) đã có dấu chấm phân cách hàng nghìn', result.initialDisplay === '500.000.000', `thực tế: "${result.initialDisplay}"`);
  record('Gõ thêm ký tự -> vẫn tự động chèn lại dấu chấm đúng vị trí (listener money-input chung của core.js hoạt động)', /^[\d.]+$/.test(result.afterTypeDisplay) && result.afterTypeDisplay.includes('.'), `thực tế: "${result.afterTypeDisplay}"`);
  record('LỖI ĐÃ VÁ: giá trị lưu trong state (mhTierRows) là SỐ THẬT sạch (không lẫn dấu chấm), không phải chuỗi hiển thị', typeof result.storedFromAmount === 'number' && Number.isFinite(result.storedFromAmount), `thực tế: ${JSON.stringify(result.storedFromAmount)}`);
  record('Bậc thang trống (mới thêm) -> input rỗng, không hiện "NaN" hay ký tự lạ', result.emptyDisplay === '', `thực tế: "${result.emptyDisplay}"`);

  await browser.close();
  server.close();
  console.log(`\n${passed}/${passed + failed} scenario(s) passed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
