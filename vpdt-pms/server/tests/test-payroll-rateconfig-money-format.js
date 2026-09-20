// server/tests/test-payroll-rateconfig-money-format.js
//
// LỖI ĐÃ VÁ (người dùng phản ánh, 9/2026 — cùng đợt rà soát money-input với hrpAdjAmount): 3 ô số tiền
// VNĐ trong "⚠️ Cấu Hình Tỷ Lệ" (Lương → Cấu Hình Tỷ Lệ): "Trần đóng BHXH", "Giảm trừ bản thân", "Giảm
// trừ/người phụ thuộc" (public/index.html #hrpRcBhxhCap/#hrpRcPersonalDeduction/#hrpRcDependentDeduction)
// trước đây dùng type="number" thẳng — KHÔNG tự chèn dấu chấm hàng nghìn, và cũng KHÔNG hiện đúng định
// dạng ngay lúc mở modal (chỉ điền số thô). Đã đổi sang money-input + formatMoneyDisplay() lúc điền/
// getMoneyValue() lúc đọc — 9 ô còn lại trong CÙNG modal (% BHXH/BHYT/BHTN, ngày công chuẩn, giờ chuẩn,
// hệ số OT) CỐ Ý giữ nguyên type="number" vì là phần trăm/số ngày/hệ số thập phân, không phải tiền VNĐ.
//
// Test tải THẲNG core.js + module-luong.js qua 1 Express tối giản, dùng Playwright để có DOM thật.
//
// Chạy: node server/tests/test-payroll-rateconfig-money-format.js
'use strict';
const path = require('path');

async function main() {
  const express = require(path.join(__dirname, '..', 'node_modules', 'express'));
  const securityHeaders = require(path.join(__dirname, '..', 'lib', 'securityHeaders'));
  const PUBLIC_DIR = path.join(__dirname, '..', 'public');

  const app = express();
  app.use(securityHeaders);
  app.get('/', (req, res) => {
    const rcFields = [
      'hrpRcBhxhPercent', 'hrpRcBhytPercent', 'hrpRcBhtnPercent',
      'hrpRcBhxhCap', 'hrpRcPersonalDeduction', 'hrpRcDependentDeduction',
      'hrpRcStandardWorkDaysHo', 'hrpRcStandardWorkDaysStore', 'hrpRcStandardHoursPerDay',
      'hrpRcOtMultiplierNormal', 'hrpRcOtMultiplierWeekend', 'hrpRcOtMultiplierHoliday'
    ];
    const inputsHtml = rcFields.map((id) => `<input id="${id}" type="text" inputmode="numeric" class="money-input">`).join('');
    res.set('Content-Type', 'text/html; charset=utf-8').send(
      `<!DOCTYPE html><html><head></head><body>${inputsHtml}<script src="/js/core.js"></script><script src="/js/module-luong.js"></script></body></html>`
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
    window.hrpApiCall = async (method, url) => ({
      config: {
        bhxhPercent: 8, bhytPercent: 1.5, bhtnPercent: 1,
        bhxhCap: 36000000, personalDeduction: 11000000, dependentDeduction: 4400000,
        standardWorkDaysHo: 22, standardWorkDaysStore: 26, standardHoursPerDay: 8,
        otMultiplierNormal: 1.5, otMultiplierWeekend: 2, otMultiplierHoliday: 3
      }
    });
    await openHrpRateConfigModal();

    const bhxhCapDisplay = document.getElementById('hrpRcBhxhCap').value;
    const personalDeductionDisplay = document.getElementById('hrpRcPersonalDeduction').value;
    const dependentDeductionDisplay = document.getElementById('hrpRcDependentDeduction').value;
    const hasMoneyClassBhxhCap = document.getElementById('hrpRcBhxhCap').classList.contains('money-input');

    // Percent/day-count fields must be left untouched (plain numeric value, no thousand-separator).
    const bhxhPercentDisplay = document.getElementById('hrpRcBhxhPercent').value;

    // Gõ thêm vào ô Giảm trừ bản thân -> tự chèn lại dấu chấm đúng.
    const personalInput = document.getElementById('hrpRcPersonalDeduction');
    personalInput.focus();
    personalInput.value = '12000000';
    personalInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    const personalAfterType = personalInput.value;

    let capturedPayload = null;
    window.hrpApiCall = async (method, url, payload) => { capturedPayload = payload; return { config: {} }; };
    await submitHrpRateConfig();

    return {
      bhxhCapDisplay, personalDeductionDisplay, dependentDeductionDisplay, hasMoneyClassBhxhCap,
      bhxhPercentDisplay, personalAfterType, capturedPayload
    };
  });

  record('LỖI ĐÃ VÁ: mở modal hiện đúng "36.000.000" cho Trần đóng BHXH (không phải "36000000" thô)', result.bhxhCapDisplay === '36.000.000', `thực tế: "${result.bhxhCapDisplay}"`);
  record('LỖI ĐÃ VÁ: "Giảm trừ bản thân" hiện đúng "11.000.000"', result.personalDeductionDisplay === '11.000.000', `thực tế: "${result.personalDeductionDisplay}"`);
  record('LỖI ĐÃ VÁ: "Giảm trừ/người phụ thuộc" hiện đúng "4.400.000"', result.dependentDeductionDisplay === '4.400.000', `thực tế: "${result.dependentDeductionDisplay}"`);
  record('#hrpRcBhxhCap có class "money-input"', result.hasMoneyClassBhxhCap === true);
  record('% BHXH (không phải tiền) vẫn hiện số thô "8", không bị đụng vào', result.bhxhPercentDisplay === '8', `thực tế: "${result.bhxhPercentDisplay}"`);
  record('Gõ lại "Giảm trừ bản thân" -> tự chèn dấu chấm "12.000.000"', result.personalAfterType === '12.000.000', `thực tế: "${result.personalAfterType}"`);
  record('submitHrpRateConfig() gửi đúng số sạch bhxhCap=36000000/personalDeduction=12000000/dependentDeduction=4400000', result.capturedPayload && result.capturedPayload.bhxhCap === 36000000 && result.capturedPayload.personalDeduction === 12000000 && result.capturedPayload.dependentDeduction === 4400000, `thực tế: ${JSON.stringify(result.capturedPayload)}`);

  await browser.close();
  server.close();
  console.log(`\n${passed}/${passed + failed} scenario(s) passed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
