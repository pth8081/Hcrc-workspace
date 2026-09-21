// server/tests/test-login-cache-first-render.js
//
// LỚP 1 (task #133 — tối ưu tốc độ sau đăng nhập, đợt rà soát chuyên sâu vòng 2): lần đăng nhập KẾ TIẾP
// của ĐÚNG tài khoản (trên MÁY này, cùng bản code đang chạy, cache chưa quá cũ) phải hiện giao diện
// NGAY bằng snapshot DB.* đã lưu ở lần trước — KHÔNG đợi mạng — trong lúc dữ liệu THẬT tải ngầm phía
// sau rồi mới âm thầm cập nhật lại. Test bằng cách chặn (page.route) đúng GET /api/data, trả lời có độ
// trễ CÓ CHỦ Ý để phân biệt rõ "giao diện hiện trước khi mạng trả lời" (lớp 1 hoạt động đúng) khỏi
// "vẫn phải chờ mạng" (hành vi cũ, chỉ còn áp dụng cho lần đăng nhập đầu/cache không hợp lệ).
//
// Gọi thẳng proceedAfterAuth(user) qua page.evaluate() (bỏ qua form đăng nhập UI) — đúng khuôn các test
// Playwright khác trong bộ này gọi thẳng finishLogin()/hàm module core, tập trung vào ĐÚNG luồng đang
// vá thay vì luồng đăng nhập bằng mật khẩu (đã có test riêng ở test-auth-login.js).
//
// Chạy: node server/tests/test-login-cache-first-render.js
'use strict';
const path = require('path');
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8991;

// _mock-backend.js (xem tests/_harness.js) monkey-patch HẲN window.fetch NGAY TRONG TRANG (không qua
// network layer thật của trình duyệt) — page.route() của Playwright vì vậy KHÔNG can thiệp được (mọi
// request kiểu này không bao giờ chạm tới CDP network layer). Phải chặn ở đúng lớp đó: bọc thêm 1 lớp
// quanh window.fetch NGAY TRONG TRANG, luôn bọc từ bản GỐC (lưu 1 lần duy nhất) để không chồng lớp qua
// nhiều lượt gọi trong cùng 1 file test.
function routeApiDataOnce(page, { delayMs, body }) {
  return page.evaluate(({ delayMs, body }) => {
    if (!window.__mockFetchOriginal) window.__mockFetchOriginal = window.fetch;
    const orig = window.__mockFetchOriginal;
    window.fetch = async function (url, opts) {
      const u = typeof url === 'string' ? url : String((url && url.url) || url);
      const method = ((opts && opts.method) || 'GET').toUpperCase();
      if (u === '/api/data' && method === 'GET') {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
      }
      return orig(url, opts);
    };
  }, { delayMs, body });
}

async function main() {
  const { server, browser, page } = await setup(PORT);
  const run = makeRunner();
  const user = makeUser({ username: 'u.cache', name: 'Người Dùng Cache' });

  try {
    await run.run('Lần đăng nhập ĐẦU TIÊN (chưa có cache trên máy này): vẫn phải chờ /api/data trả lời xong mới vào giao diện (hành vi cũ, không đổi)', async () => {
      await page.evaluate(() => localStorage.clear());
      const seed1 = { ...baseCatalogSeed(), depts: ['Phòng Gốc'] };
      await routeApiDataOnce(page, { delayMs: 250, body: seed1 });

      const t0 = Date.now();
      await page.evaluate((u) => { window.__pa = proceedAfterAuth(u); }, user);
      // Ngay sau khi GỌI (chưa await xong) — vì initDatabase() đang chờ fetch (250ms), dataReady phải
      // CHƯA true (đúng hành vi cũ: lần đầu không có gì để hiện tạm, phải chờ mạng).
      await page.waitForTimeout(30);
      const readyBeforeFetch = await page.evaluate(() => dataReady);
      assert(readyBeforeFetch === false, 'lần đăng nhập đầu: KHÔNG được vào giao diện trước khi /api/data trả lời');

      await page.evaluate(() => window.__pa); // chờ proceedAfterAuth() thật sự xong
      const elapsed = Date.now() - t0;
      assert(elapsed >= 240, `phải chờ đủ ~250ms của lượt fetch đầu (đo được ${elapsed}ms)`);
      const state = await page.evaluate(() => ({ dataReady, dataFresh, depts: DB.depts.slice() }));
      assert(state.dataReady === true && state.dataFresh === true, 'sau khi fetch xong: dataReady và dataFresh đều phải true');
      assertEqual(state.depts.join(','), 'Phòng Gốc', 'DB.depts phải khớp đúng dữ liệu vừa tải');

      const cached = await page.evaluate((username) => !!localStorage.getItem('vpdt_db_cache_' + username), user.username);
      assert(cached, 'sau khi tải THẬT thành công, phải lưu lại cache DB.* cho tài khoản này');
    });

    await run.run('Lần đăng nhập THỨ 2 (đã có cache của ĐÚNG tài khoản): vào giao diện NGAY LẬP TỨC (trước khi mạng trả lời), rồi tự cập nhật lại khi tải ngầm xong', async () => {
      await page.evaluate(() => { logout(); });
      const seed2 = { ...baseCatalogSeed(), depts: ['Phòng MỚI (đã đồng bộ)'] };
      await routeApiDataOnce(page, { delayMs: 400, body: seed2 });

      const t0 = Date.now();
      await page.evaluate((u) => { window.__pa2 = proceedAfterAuth(u); }, user);
      await page.waitForTimeout(50); // còn rất xa 400ms của lượt fetch nền
      const immediateState = await page.evaluate(() => ({
        dataReady, dataFresh,
        depts: DB.depts.slice(),
        loginHidden: document.getElementById('loginSection').classList.contains('hidden'),
        syncIndicatorVisible: !document.getElementById('dataSyncIndicator').classList.contains('hidden')
      }));
      const elapsedImmediate = Date.now() - t0;
      assert(elapsedImmediate < 380, `phải vào giao diện RẤT NHANH, không đợi hết 400ms của mạng (đo được ${elapsedImmediate}ms)`);
      assert(immediateState.dataReady === true, 'phải dataReady=true NGAY LẬP TỨC nhờ cache, không cần chờ mạng');
      assert(immediateState.loginHidden === true, 'màn đăng nhập phải đã ẩn, giao diện chính đã lộ ra');
      assert(immediateState.dataFresh === false, 'dataFresh phải CÒN false — dữ liệu đang hiện là bản cache, chưa phải bản thật mới nhất');
      assertEqual(immediateState.depts.join(','), 'Phòng Gốc', 'giao diện đang hiện ĐÚNG dữ liệu CACHE (từ lượt đăng nhập trước), chưa phải dữ liệu mới');
      assert(immediateState.syncIndicatorVisible === true, 'chỉ báo "đang đồng bộ" phải đang HIỆN trong lúc tải ngầm');

      // proceedAfterAuth() CỐ Ý không await loadFreshDataInBackground() (chạy nền, không chặn hàm gọi) —
      // window.__pa2 đã resolve từ lâu, phải tự đợi dataFresh chuyển true (poll) thay vì await promise đó.
      await page.waitForFunction(() => dataFresh === true, { timeout: 3000 });
      const finalState = await page.evaluate(() => ({
        dataFresh, depts: DB.depts.slice(),
        syncIndicatorVisible: !document.getElementById('dataSyncIndicator').classList.contains('hidden')
      }));
      assert(finalState.dataFresh === true, 'sau khi tải ngầm xong, dataFresh phải chuyển true');
      assertEqual(finalState.depts.join(','), 'Phòng MỚI (đã đồng bộ)', 'DB.depts phải được thay bằng đúng dữ liệu MỚI tải ngầm được, không còn là bản cache cũ');
      assert(finalState.syncIndicatorVisible === false, 'chỉ báo "đang đồng bộ" phải tự ẩn đi sau khi tải xong');
    });

    await run.run('Cache SAI bản code (assetVersion khác bản đang chạy) bị BỎ QUA — vẫn phải chờ tải như lần đăng nhập đầu', async () => {
      await page.evaluate(() => { logout(); });
      await page.evaluate((username) => {
        const raw = localStorage.getItem('vpdt_db_cache_' + username);
        const snap = JSON.parse(raw);
        snap.assetVersion = '__PHIEN_BAN_CU_KHONG_KHOP__';
        localStorage.setItem('vpdt_db_cache_' + username, JSON.stringify(snap));
      }, user.username);
      const seed3 = { ...baseCatalogSeed(), depts: ['Phòng Sau Khi Đổi Bản'] };
      await routeApiDataOnce(page, { delayMs: 200, body: seed3 });

      await page.evaluate((u) => { window.__pa3 = proceedAfterAuth(u); }, user);
      await page.waitForTimeout(30);
      const readyBeforeFetch = await page.evaluate(() => dataReady);
      assert(readyBeforeFetch === false, 'cache khác bản code phải bị coi như KHÔNG có cache — không được vào giao diện sớm');
      await page.evaluate(() => window.__pa3);
      const state = await page.evaluate(() => ({ dataReady, depts: DB.depts.slice() }));
      assert(state.dataReady === true, 'sau khi chờ xong vẫn phải vào được giao diện bình thường');
      assertEqual(state.depts.join(','), 'Phòng Sau Khi Đổi Bản', 'phải là dữ liệu MỚI tải, không lẫn cache cũ khác bản');
    });

    await run.run('Cache QUÁ CŨ (savedAt vượt 7 ngày) bị BỎ QUA — vẫn phải chờ tải như lần đăng nhập đầu', async () => {
      await page.evaluate(() => { logout(); });
      await page.evaluate((username) => {
        const raw = localStorage.getItem('vpdt_db_cache_' + username);
        const snap = JSON.parse(raw);
        snap.savedAt = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 ngày trước — vượt hạn 7 ngày
        localStorage.setItem('vpdt_db_cache_' + username, JSON.stringify(snap));
      }, user.username);
      const seed4 = { ...baseCatalogSeed(), depts: ['Phòng Sau Khi Cache Hết Hạn'] };
      await routeApiDataOnce(page, { delayMs: 200, body: seed4 });

      await page.evaluate((u) => { window.__pa4 = proceedAfterAuth(u); }, user);
      await page.waitForTimeout(30);
      const readyBeforeFetch = await page.evaluate(() => dataReady);
      assert(readyBeforeFetch === false, 'cache quá hạn phải bị coi như KHÔNG có cache — không được vào giao diện sớm');
      await page.evaluate(() => window.__pa4);
      const state = await page.evaluate(() => ({ dataReady, depts: DB.depts.slice() }));
      assert(state.dataReady === true, 'sau khi chờ xong vẫn phải vào được giao diện bình thường');
      assertEqual(state.depts.join(','), 'Phòng Sau Khi Cache Hết Hạn', 'phải là dữ liệu MỚI tải, không lẫn cache đã hết hạn');
    });

    await run.run('Tài khoản KHÁC (chưa từng có cache): vẫn phải chờ tải bình thường dù máy đã có cache của tài khoản khác', async () => {
      await page.evaluate(() => { logout(); });
      const otherUser = makeUser({ username: 'u.other', name: 'Người Khác' });
      const seed5 = { ...baseCatalogSeed(), depts: ['Phòng Của Người Khác'] };
      await routeApiDataOnce(page, { delayMs: 200, body: seed5 });

      await page.evaluate((u) => { window.__pa5 = proceedAfterAuth(u); }, otherUser);
      await page.waitForTimeout(30);
      const readyBeforeFetch = await page.evaluate(() => dataReady);
      assert(readyBeforeFetch === false, 'tài khoản chưa từng có cache riêng phải chờ tải bình thường, không được "mượn" cache của tài khoản khác');
      await page.evaluate(() => window.__pa5);
    });

    run.summarize('test-login-cache-first-render');
  } finally {
    await teardown({ server, browser });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
