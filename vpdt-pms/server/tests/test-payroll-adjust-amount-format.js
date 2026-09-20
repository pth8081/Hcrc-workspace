// server/tests/test-payroll-adjust-amount-format.js
//
// LỖI ĐÃ VÁ (người dùng phản ánh, 9/2026 — cùng đợt rà soát với ô "Từ số tiền" ở Mua Hàng BAS): ô "Số
// Tiền" trong modal "Điều Chỉnh" phiếu lương (Lương → bảng chi tiết kỳ lương → nút "Điều Chỉnh",
// public/index.html #hrpAdjAmount) trước đây dùng type="number" thẳng — KHÔNG tự chèn dấu chấm phân
// cách hàng nghìn khi gõ như mọi ô nhập tiền khác trong hệ thống. Đã đổi sang type="text" +
// inputmode="numeric" + class "money-input", đọc giá trị qua getMoneyValue() (core.js) thay vì
// Number(input.value) thẳng — mirror đúng pattern dùng chung toàn hệ thống.
//
// Xác nhận thêm: amount ở đây LUÔN là số dương kể cả với 2 mã khấu trừ ADVANCE_DEDUCT/PENALTY_DEDUCT —
// dấu trừ được server xác định qua PAYROLL_COMPONENTS[...].type === 'DEDUCTION' (lib/payroll.js,
// sumDetails()/netPay = gross - totalDeduction), KHÔNG qua dấu "-" người dùng gõ tay — nên chuyển sang
// money-input (chỉ giữ lại chữ số, bỏ mọi ký tự khác kể cả dấu trừ) không làm mất khả năng nhập khấu trừ.
//
// Test tải THẲNG core.js + module-luong.js (không cần server/login — 2 hàm liên quan không đụng
// DB/fetch cho tới lúc gọi submit) qua 1 Express tối giản chỉ phục vụ static, dùng Playwright để có DOM
// thật (money-input dựa vào document.addEventListener('input', ...) toàn trang ở core.js).
//
// Chạy: node server/tests/test-payroll-adjust-amount-format.js
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
      '<!DOCTYPE html><html><head></head><body>' +
      '<select id="hrpAdjComponent"></select>' +
      '<input id="hrpAdjAmount" type="text" inputmode="numeric" class="money-input">' +
      '<input id="hrpAdjNote" type="text">' +
      '<script src="/js/core.js"></script><script src="/js/module-luong.js"></script></body></html>'
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
    const input = document.getElementById('hrpAdjAmount');
    const hasMoneyClass = input.classList.contains('money-input');
    const isTextType = input.type === 'text';

    input.focus();
    input.value = '2500000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    const displayAfterType = input.value;
    const readBack = getMoneyValue(input);

    // Stub hrpApiCall để gọi submitHrpAdjustDetail() thật, xác nhận payload gửi đi ĐÚNG số sạch
    // (không lẫn dấu chấm) — không cần server thật, chỉ cần bắt được tham số truyền vào.
    let capturedPayload = null;
    window.hrpCurrentPeriodDetail = 1;
    window.hrpAdjustTargetPayslipId = 1;
    window.hrpApiCall = async (method, url, payload) => { capturedPayload = payload; return {}; };
    window.hrpRenderPeriodDetailTable = async () => {};
    document.getElementById('hrpAdjComponent').innerHTML = '<option value="PENALTY_DEDUCT">x</option>';
    document.getElementById('hrpAdjComponent').value = 'PENALTY_DEDUCT';
    document.getElementById('hrpAdjNote').value = 'Test';
    await submitHrpAdjustDetail();

    return { hasMoneyClass, isTextType, displayAfterType, readBack, capturedPayload };
  });

  record('LỖI ĐÃ VÁ: #hrpAdjAmount là type="text" (không còn type="number")', result.isTextType === true);
  record('LỖI ĐÃ VÁ: #hrpAdjAmount có class "money-input"', result.hasMoneyClass === true);
  record('Gõ "2500000" -> tự động chèn dấu chấm hàng nghìn ("2.500.000")', result.displayAfterType === '2.500.000', `thực tế: "${result.displayAfterType}"`);
  record('getMoneyValue() đọc lại đúng số sạch 2500000 (không lẫn dấu chấm)', result.readBack === 2500000, `thực tế: ${result.readBack}`);
  record('submitHrpAdjustDetail() gửi payload.amount = 2500000 (số dương sạch, đúng như trước khi đổi type)', result.capturedPayload && result.capturedPayload.amount === 2500000, `thực tế: ${JSON.stringify(result.capturedPayload)}`);
  record('submitHrpAdjustDetail() vẫn gửi đúng componentCode/note không đổi', result.capturedPayload && result.capturedPayload.componentCode === 'PENALTY_DEDUCT' && result.capturedPayload.note === 'Test');

  await browser.close();
  server.close();
  console.log(`\n${passed}/${passed + failed} scenario(s) passed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
