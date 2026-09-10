// server/tests/test-operation-order-multifile-batch.js
//
// Vận Hành > Đặt Hàng: upload NHIỀU file PDF cùng lúc (voFile giờ có multiple) rẽ nhánh sang
// handleOperationOrderMultiFilePdfUpload() — mỗi file tự parse + tự tạo NGAY 1 đơn hàng riêng, không cần
// rà soát tay (khác nhánh 1 file, vẫn giữ nguyên hành vi cũ: tự điền form, chờ người dùng tự bấm gửi).
// Số Đơn NCC (poNumber) trùng chỉ SKIP đúng 1 file đó (không chặn cả đợt) — dùng chung mẫu Chromium thật
// (Playwright) + PDF thật của demo-operation-order-pdf-autofill.js (KHÔNG giả lập bước đọc/parse PDF).
//
// Chạy: node server/tests/test-operation-order-multifile-batch.js
const path = require('path');
const fs = require('fs');
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8996;
const SAMPLE_PDF = '/root/.claude/uploads/92486df7-a010-5b7a-a5ae-6b624f39c073/5b98f22e-120HT_PO.pdf';

const CREATOR = { username: 'vh_po_multi', name: 'Người Lập Đơn Hàng (Multi)', dept: 'Vận Hành', perms: { operationOrderCreate: true }, active: true };

const state = createMockState({ depts: ['Vận Hành'], users: [CREATOR] });

async function main() {
  if (!fs.existsSync(SAMPLE_PDF)) throw new Error(`Không tìm thấy file PDF mẫu: ${SAMPLE_PDF}`);
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, CREATOR);
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('ORDERS'); });
    await page.waitForSelector('#operationOrderForm', { state: 'visible' });

    await run.run('Chọn ĐÚNG 1 file PDF: vẫn giữ hành vi cũ — tự điền form, KHÔNG tự tạo đơn', async () => {
      await page.setInputFiles('#voFile', SAMPLE_PDF);
      await page.waitForFunction(() => {
        const el = document.getElementById('voPdfParseStatus');
        return el && !el.classList.contains('hidden') && /✅|⚠️/.test(el.innerText);
      }, { timeout: 15000 });
      const state1 = await page.evaluate(() => ({
        count: DB.operationOrders.length,
        titleFilled: document.getElementById('voTitle').value,
        alerts: window.__alerts.length
      }));
      assertEqual(state1.count, 0, 'Chọn 1 file KHÔNG được tự tạo đơn hàng — chỉ tự điền form chờ người dùng tự bấm gửi');
      assert(!!state1.titleFilled, 'Form phải được tự điền (Tiêu Đề) từ file PDF vừa chọn (hành vi cũ)');
      assertEqual(state1.alerts, 0, 'Chọn 1 file KHÔNG được tự bật alert nào (khác hẳn nhánh nhiều file)');
    });

    await run.run('Reset form trước khi sang kịch bản nhiều file (dọn sạch trạng thái khoá PDF của kịch bản trước)', async () => {
      await page.evaluate(() => { resetOperationOrderForm(); });
      const cnt = await page.evaluate(() => DB.operationOrders.length);
      assertEqual(cnt, 0, 'Reset form không tự tạo đơn hàng nào');
    });

    await run.run('Chọn 2 file PDF CÙNG LÚC (multiple, cùng 1 file mẫu lặp lại 2 lần) -> tự tạo 1 đơn ĐẦU, SKIP đơn SAU do trùng Số Đơn NCC — không chặn cả đợt', async () => {
      await page.evaluate(() => window.__resetCapture());
      await page.setInputFiles('#voFile', [SAMPLE_PDF, SAMPLE_PDF]);
      // handleOperationOrderMultiFilePdfUpload() chạy tuần tự 2 file rồi mới alert() tóm tắt cuối cùng —
      // chờ tới khi có alert thay vì chờ 1 field DOM cụ thể (form đã bị reset sau khi xong đợt).
      await page.waitForFunction(() => window.__alerts && window.__alerts.length > 0, { timeout: 20000 });
      const result = await page.evaluate(() => ({
        count: DB.operationOrders.length,
        alert: window.__alerts[0],
        codes: DB.operationOrders.map(o => o.code),
        poNumbers: DB.operationOrders.map(o => o.poNumber)
      }));
      assertEqual(result.count, 1, 'Chỉ 1/2 file được tạo thành công (file thứ 2 trùng Số Đơn NCC với file thứ 1 vừa tạo xong trong CÙNG đợt)');
      assert(result.alert.includes('Đã tạo 1/2 đơn hàng'), `Alert tóm tắt phải nêu đúng số lượng tạo thành công (thực tế: "${result.alert}")`);
      assert(result.alert.includes('Bỏ qua 1 file'), `Alert tóm tắt phải nêu rõ có 1 file bị bỏ qua (thực tế: "${result.alert}")`);
      assert(/[Tt]rùng.*[Ss]ố đơn NCC|Số đơn NCC.*tồn tại/.test(result.alert), `Lý do bỏ qua phải nêu rõ trùng Số Đơn NCC (thực tế: "${result.alert}")`);
    });

    await run.run('Sau đợt nhiều file: form đã reset về trạng thái sạch (mã mới, không còn khoá PDF cũ)', async () => {
      const formState = await page.evaluate(() => ({
        voTitle: document.getElementById('voTitle').value,
        voFileChipEmpty: document.getElementById('voFileChip').innerHTML.trim() === '',
        statusHidden: document.getElementById('voPdfParseStatus').classList.contains('hidden')
      }));
      assertEqual(formState.voTitle, '', 'Form phải reset sạch (Tiêu Đề rỗng) sau khi xong đợt nhiều file');
      assert(formState.statusHidden, 'Khối trạng thái đọc PDF phải ẩn lại sau khi xong đợt');
    });

    run.summary();
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
