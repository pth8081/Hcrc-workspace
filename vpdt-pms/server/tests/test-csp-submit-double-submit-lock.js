// server/tests/test-csp-submit-double-submit-lock.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): nhánh data-op-submit trong bindCspDelegation() (core.js)
// trước đây gọi THẲNG fn(e), không hề dùng lại khoá chống double-submit runCspOp() (đã có sẵn từ đợt rà
// soát upload 10/2026 nhưng CHỈ áp cho data-op/data-op-input/data-op-change). Bấm Enter 2 lần liên tiếp
// hoặc double-click nút "Gửi" trong lúc hàm submit đang await (VD submitOperationOrder() — module-vanhanh.js
// — còn đang chờ uploadFileToServer()/callCreateAction(), có thể mất vài giây) vẫn gửi request thứ 2
// TRƯỚC khi request đầu xong, tạo trùng bản ghi. Nay nhánh submit dùng lại ĐÚNG runCspOp() (khoá theo
// chính phần tử <form>, tự mở lại khi promise resolve/reject) — sửa 1 lần ở core.js, có tác dụng cho CẢ
// 25 form data-op-submit trong hệ thống (operationOrderForm là 1 trong số đó), không phải vá riêng lẻ
// từng form.
//
// Bài test này KHÔNG cần đăng nhập/seed DB — bindCspDelegation()/runCspOp() không đụng gì tới DB/currentUser,
// core.js nạp EAGER (index.html) nên các hàm này có sẵn trên window ngay khi trang tải xong. Test tạo 1
// <form data-op-submit="..."> tổng hợp, gắn 1 hàm giả trả về Promise CÓ THỂ điều khiển thời điểm
// resolve, rồi bắn nhiều sự kiện submit liên tiếp để xác nhận hàm chỉ được gọi 1 lần trong lúc promise
// đầu còn treo, và gọi lại được bình thường sau khi promise đó xong.
//
// Chạy: node server/tests/test-csp-submit-double-submit-lock.js
'use strict';
const path = require('path');

async function main() {
  const express = require(path.join(__dirname, '..', 'node_modules', 'express'));
  const securityHeaders = require(path.join(__dirname, '..', 'lib', 'securityHeaders'));
  const PUBLIC_DIR = path.join(__dirname, '..', 'public');

  const app = express();
  app.use(securityHeaders);
  // Trang tối giản CHỈ nạp core.js thật (không cần index.html đầy đủ/login) — bindCspDelegation()/
  // runCspOp()/cspDispatchOp() là hàm top-level thuần, không phụ thuộc DB/currentUser lúc định nghĩa.
  app.get('/', (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8').send(
      '<!DOCTYPE html><html><head></head><body><div id="testRoot"></div><script src="/js/core.js"></script></body></html>'
    );
  });
  app.use(express.static(PUBLIC_DIR));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;

  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String((err && err.message) || err)));

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });

  let passed = 0, failed = 0;
  function record(name, ok, detail) {
    if (ok) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.error(`  ❌ ${name}${detail ? '\n     ' + detail : ''}`); }
  }

  const result = await page.evaluate(async () => {
    document.getElementById('testRoot').innerHTML = `
      <form id="testSubmitForm" data-op-submit="__testSubmitFn">
        <button type="submit">Gửi</button>
      </form>`;
    let callCount = 0;
    const pendingResolvers = [];
    window.__testSubmitFn = (e) => {
      e.preventDefault();
      callCount++;
      return new Promise((resolve) => { pendingResolvers.push(resolve); });
    };
    bindCspDelegation('testRoot');
    const form = document.getElementById('testSubmitForm');

    // Bắn 3 lượt submit "liên tiếp thật nhanh" TRƯỚC khi promise đầu resolve (mô phỏng double-click/Enter
    // 2 lần trong lúc submitOperationOrder() còn đang await upload/create).
    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 50));
    const callsWhilePending = callCount;
    const lockedWhilePending = form.dataset.opInFlight === '1';

    // Mở khoá (resolve promise đầu) -> chờ 1 nhịp -> submit lại phải gọi được (không bị khoá vĩnh viễn).
    pendingResolvers.forEach((r) => r());
    await new Promise((r) => setTimeout(r, 50));
    const lockedAfterResolve = form.dataset.opInFlight === '1';

    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 50));
    const callsAfterReopen = callCount;
    pendingResolvers.forEach((r) => r());

    return { callsWhilePending, lockedWhilePending, lockedAfterResolve, callsAfterReopen };
  });

  record('LỖI ĐÃ VÁ: bắn 3 submit liên tiếp trong lúc promise đầu còn treo -> chỉ gọi hàm ĐÚNG 1 lần', result.callsWhilePending === 1, `thực tế: ${result.callsWhilePending}`);
  record('Form bị khoá data-op-in-flight="1" trong lúc promise còn treo', result.lockedWhilePending === true);
  record('Khoá tự mở lại (xoá data-op-in-flight) ngay sau khi promise resolve', result.lockedAfterResolve === false);
  record('Submit lại SAU khi khoá mở -> gọi được bình thường (không bị khoá vĩnh viễn)', result.callsAfterReopen === 2, `thực tế: ${result.callsAfterReopen}`);
  // Lọc bỏ lỗi KHÔNG LIÊN QUAN tới bindCspDelegation()/runCspOp() — tryRestoreSession()/CAPTCHA init
  // (core.js) tự chạy khi tải trang, gọi document.getElementById('loginSection') vốn không tồn tại trên
  // trang tối giản của bài test này (không phải index.html đầy đủ) -> ném lỗi vô hại, KHÔNG phải điều bài
  // test này xác minh (chỉ cần không có lỗi nào phát sinh TỪ chính logic submit/khoá double-submit).
  const unrelatedErrors = pageErrors.filter((e) => !e.includes("reading 'classList'"));
  record('Không có lỗi JS liên quan tới logic submit/khoá double-submit', unrelatedErrors.length === 0, unrelatedErrors.join('; '));

  await browser.close();
  server.close();
  console.log(`\n${passed}/${passed + failed} scenario(s) passed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
