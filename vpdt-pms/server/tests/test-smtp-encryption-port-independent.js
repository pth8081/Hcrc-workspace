#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression: "Mã Hoá Kết Nối" (Port 25/587/465 + 3 nút Không mã hoá/TLS/SSL) ở màn
// Quản Trị > Cấu Hình Email (public/fragments/systemSection.html, logic ở public/js/core.js).
//
// Bug thật (10/2026, người dùng báo — ảnh chụp màn hình "chọn TLS ở port 465 bị lỗi, bạn đang khoá
// cứng nút này"): bản trước đây có 2 cơ chế tự ép ĐỒNG THỜI theo cả 2 CHIỀU —
//   (1) setSmtpEncryption(mode) (bấm 1 trong 3 nút) tự nhảy Port sang giá trị chuẩn của mode đó.
//   (2) syncSmtpEncryptionFromPort() (gõ tay vào ô Port) tự nhảy lại Mã Hoá Kết Nối sang kiểu chuẩn
//       khớp Port vừa gõ.
// Ghép 2 chiều ép buộc lại khiến KHÔNG CÓ cách nào đạt được 1 cặp Port+Mã Hoá KHÁC chuẩn (VD Postfix
// nội bộ của người dùng lắng nghe TLS/STARTTLS ngay trên port 465 thay vì 587 mặc định) — mọi thao tác
// đều bị hệ thống tự "sửa lại" về đúng 1 trong 3 cặp chuẩn (25↔NONE/587↔STARTTLS/465↔SSL), không có lối
// thoát để chọn cặp phù hợp với máy chủ THẬT của họ.
//
// ĐÃ VÁ: gỡ bỏ HẲN cơ chế ép buộc 2 chiều — setSmtpEncryption() giờ CHỈ đổi trạng thái nút/giá trị ô ẩn
// cfgSmtpEncryption, KHÔNG động vào Port; xoá hẳn syncSmtpEncryptionFromPort() + data-op-change trên ô
// Port. 5 nút preset Loại Email Gateway (setEmailGatewayPreset()) KHÔNG đổi gì (vẫn tự điền sẵn đúng cặp
// gợi ý ban đầu, set Port RỒI mới gọi setSmtpEncryption() — không phụ thuộc cơ chế vừa gỡ).
//
// Chạy: node server/tests/test-smtp-encryption-port-independent.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const INDEX_HTML_PATH = path.join(PUBLIC_DIR, 'index.html');
const PORT = 8997;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.startsWith('/js/') || urlPath.startsWith('/fragments/')) {
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          const contentType = urlPath.startsWith('/js/') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(data);
        });
      }
      fs.readFile(INDEX_HTML_PATH, (err, data) => {
        if (err) { res.writeHead(500); res.end(String(err)); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => loadTabSectionHtml('system'));

  // A) Bấm nút TLS trong khi Port đang là 465 (1 trong 3 giá trị "chuẩn") -> Port PHẢI giữ nguyên 465,
  // không bị tự nhảy về 587 — đúng kịch bản bug thật người dùng báo (Postfix của họ nghe port 465).
  const afterClickTls = await page.evaluate(() => {
    document.getElementById('cfgSmtpPort').value = 465;
    setSmtpEncryption('SSL'); // set trạng thái ban đầu khác, rồi mới bấm TLS để chắc chắn đang đổi thật
    setSmtpEncryption('STARTTLS');
    return {
      port: document.getElementById('cfgSmtpPort').value,
      encryption: document.getElementById('cfgSmtpEncryption').value,
      activeBtnClass: document.getElementById('encBtn_STARTTLS').className
    };
  });
  record('Bấm nút "TLS" khi Port=465 -> Port GIỮ NGUYÊN 465 (không còn bị tự nhảy về 587)',
    afterClickTls.port === '465', JSON.stringify(afterClickTls));
  record('Bấm nút "TLS" khi Port=465 -> Mã Hoá Kết Nối đổi đúng thành STARTTLS',
    afterClickTls.encryption === 'STARTTLS', JSON.stringify(afterClickTls));
  record('Bấm nút "TLS" -> nút TLS hiện trạng thái đang chọn (viền vàng)',
    afterClickTls.activeBtnClass.includes('border-amber-600'), JSON.stringify(afterClickTls));

  // B) Gõ tay Port=587 (1 trong 3 giá trị "chuẩn") trong khi Mã Hoá Kết Nối đang là SSL -> Mã Hoá Kết
  // Nối PHẢI giữ nguyên SSL, không bị tự nhảy về STARTTLS (chiều ngược lại của cùng cơ chế đã gỡ).
  const afterTypePort = await page.evaluate(() => {
    setSmtpEncryption('SSL');
    const portEl = document.getElementById('cfgSmtpPort');
    portEl.value = 587;
    portEl.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      port: document.getElementById('cfgSmtpPort').value,
      encryption: document.getElementById('cfgSmtpEncryption').value
    };
  });
  record('Gõ tay Port=587 khi Mã Hoá đang là SSL -> Mã Hoá Kết Nối GIỮ NGUYÊN SSL (không còn bị tự nhảy về STARTTLS)',
    afterTypePort.encryption === 'SSL' && afterTypePort.port === '587', JSON.stringify(afterTypePort));

  // C) Cặp "Port 465 + STARTTLS" (không chuẩn nhưng hợp lệ cho máy chủ của người dùng) giờ ĐẠT ĐƯỢC qua
  // đúng 2 bước thao tác thật (gõ Port rồi bấm nút) — trước đây KHÔNG thể đạt được qua bất kỳ thứ tự
  // thao tác nào vì luôn bị 1 trong 2 chiều ép buộc kéo về cặp chuẩn.
  const nonStandardCombo = await page.evaluate(() => {
    document.getElementById('cfgSmtpPort').value = 465;
    setSmtpEncryption('STARTTLS');
    return {
      port: document.getElementById('cfgSmtpPort').value,
      encryption: document.getElementById('cfgSmtpEncryption').value
    };
  });
  record('Đạt được cặp KHÔNG chuẩn "Port 465 + TLS(STARTTLS)" qua thao tác thật — chính cặp người dùng cần nhưng bản cũ không cho chọn được',
    nonStandardCombo.port === '465' && nonStandardCombo.encryption === 'STARTTLS', JSON.stringify(nonStandardCombo));

  // D) 5 nút preset Loại Email Gateway KHÔNG bị ảnh hưởng — vẫn tự điền đúng cặp Port+Mã Hoá gợi ý ban
  // đầu như trước (preset tự set Port RỒI MỚI gọi setSmtpEncryption(), không phụ thuộc cơ chế vừa gỡ).
  const presetResults = await page.evaluate(() => {
    const out = {};
    setEmailGatewayPreset('GMAIL');
    out.gmail = { port: document.getElementById('cfgSmtpPort').value, enc: document.getElementById('cfgSmtpEncryption').value };
    setEmailGatewayPreset('EXCHANGE');
    out.exchange = { port: document.getElementById('cfgSmtpPort').value, enc: document.getElementById('cfgSmtpEncryption').value };
    setEmailGatewayPreset('POSTFIX');
    out.postfix = { port: document.getElementById('cfgSmtpPort').value, enc: document.getElementById('cfgSmtpEncryption').value };
    return out;
  });
  record('Preset "Gmail" vẫn tự điền đúng Port 465 + SSL', presetResults.gmail.port === '465' && presetResults.gmail.enc === 'SSL', JSON.stringify(presetResults));
  record('Preset "Exchange" vẫn tự điền đúng Port 587 + STARTTLS', presetResults.exchange.port === '587' && presetResults.exchange.enc === 'STARTTLS', JSON.stringify(presetResults));
  record('Preset "Postfix" vẫn tự điền đúng Port 465 + SSL', presetResults.postfix.port === '465' && presetResults.postfix.enc === 'SSL', JSON.stringify(presetResults));

  record('KHÔNG có lỗi JS (pageerror) nào phát sinh trong toàn bộ bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenario(s) passed.`);
  if (failed.length) {
    console.log(`\n${failed.length} FAILED:`);
    failed.forEach(f => console.log(' - ' + f.name));
    process.exit(1);
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
