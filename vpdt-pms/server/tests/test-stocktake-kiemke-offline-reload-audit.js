// tests/test-stocktake-kiemke-offline-reload-audit.js — AUDIT TẠM: F5/reload trang THẬT (page.reload(),
// không phải gọi lại hàm JS) trong lúc ĐANG offline, cho Kiểm Kê.
//
// KHÁC testHarness.js's launchPage(): harness đó tiêm window.fetch/confirm/__apiDispatch qua page.evaluate()
// NGAY SAU page.goto() — mọi override đó BỊ XOÁ SẠCH khi page.reload() (chạy lại document mới từ đầu).
// File này tự dựng 1 harness RIÊNG dùng page.route('**/api/**') (SỐNG SÓT qua reload trong cùng 1 Page,
// đúng kỹ thuật đã dùng ở test-partner-api-config-f5-reload-persistence.js) nối THẲNG vào CHÍNH
// createDispatcher(state) của testHarness.js (tái dùng đúng business logic thật, không tự đoán lại), và
// addInitScript() cho window.alert/confirm (sống qua mọi lần tải lại) — mô phỏng ĐÚNG luồng đăng nhập
// thật của ứng dụng (GET /api/auth/me lúc tải trang -> proceedAfterAuth(), xem tryRestoreSession()/core.js)
// thay vì bỏ qua bước đó như các test Kiểm Kê khác.
//
// Mô phỏng "mất mạng": route.abort() cho MỌI request /api/** khi cờ `networkDown` đang bật — khớp đúng
// `err instanceof TypeError` mà code ứng dụng dùng để phân biệt lỗi mạng (xem các test offline khác).
// Chạy: node tests/test-stocktake-kiemke-offline-reload-audit.js
'use strict';

async function main() {
  const { startStaticServer, createMockState, createDispatcher, assert, assertEqual, createRunner } = require('./testHarness');
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');

  const PORT = 8985;
  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const USER = {
    id: 1, username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1, jobTitle: 'NV',
    perms: { kiemKeGomMaDo: true, kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true }, active: true,
    totpEnabled: false, email: 'nv1@test.local', phone: '0900000001', groupIds: [], permOverrides: null, mustChangePassword: false
  };
  const THONG_KE_SESSION = { id: 9002, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [USER],
    shelfLocations: [SHELF_A1],
    stocktakeSessions: [THONG_KE_SESSION],
    stocktakeUserAccess: [{ id: 1, username: 'nv1', dept: DEPT1, shelfLocationId: 10, canGomMa: true, canKiemDem: true, canKiemSoat: true }],
    stocktakeCounts: []
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  state.__mockSystemInventoryRows = [{ maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 }];
  const dispatch = createDispatcher(state);

  const server = await startStaticServer(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  // serviceWorkers: 'block' — CÙNG lý do đã ghi ở test-partner-api-config-f5-reload-persistence.js: sw.js
  // tự fetch() lại /api/* bên TRONG tiến trình Service Worker riêng, page.route() không bắt được fetch đó.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();

  const run = createRunner();
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const t = msg.text();
    if (t.includes('Mock chưa hỗ trợ route: POST /api/data/users')) return;
    // 404 tải tài nguyên tĩnh phụ (favicon/vendor...) không liên quan tới luồng Kiểm Kê đang audit — bỏ qua
    // ĐÚNG như các test khác đã làm với noise đã biết trước, không phải nuốt lỗi tuỳ tiện.
    if (t.includes('Failed to load resource')) return;
    jsErrors.push('[console.error] ' + t);
  });

  let loggedInUsername = null;
  let networkDown = false; // bật = mô phỏng THIẾT BỊ MẤT MẠNG HOÀN TOÀN (kể cả /api/auth/me) — route.abort() mọi /api/**

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch (e) { return route.continue(); }
    const method = req.method();
    const pathName = u.pathname;

    if (networkDown) return route.abort('internetdisconnected');

    if (pathName === '/api/auth/me' && method === 'GET') {
      if (!loggedInUsername) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Chưa đăng nhập' }) });
      const user = state.users.find((x) => x.username === loggedInUsername);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
    }
    if (pathName === '/api/auth/login' && method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const user = state.users.find((x) => x.username === body.username);
      if (!user) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Tài khoản hoặc mật khẩu không chính xác!' }) });
      loggedInUsername = user.username;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
    }
    if (pathName === '/api/auth/logout' && method === 'POST') {
      loggedInUsername = null;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    // Mọi route khác — đi qua ĐÚNG dispatcher thật của testHarness.js (business logic thật, không tự đoán).
    const bodyStr = req.postData() || null;
    const result = await dispatch(method, pathName + (u.search || ''), bodyStr, loggedInUsername);
    return route.fulfill({ status: result.status, contentType: 'application/json', body: JSON.stringify(result.body) });
  });

  // alert/confirm/prompt stub — addInitScript() SỐNG QUA MỌI LẦN reload (khác page.evaluate() một lần của
  // testHarness.js's launchPage()), cùng tinh thần stub đã dùng ở đó.
  await page.addInitScript(() => {
    window.__alerts = [];
    window.alert = (msg) => { window.__alerts.push(String(msg)); };
    window.confirm = () => true;
    window.prompt = () => '';
  });

  // Hạ tầng: nạp module theo cụm + khung HTML lazy-load theo tab — CÙNG lý do/khuôn testHarness.js's
  // launchPage() (xem chú thích đầy đủ ở đó): nạp sẵn ngay từ đầu để switchTab() sau này luôn đồng bộ,
  // không rơi vào nhánh "chưa nạp module/fragment" khi gọi switchTab() thẳng qua console thay vì click
  // nút điều hướng thật (vốn tự chờ load xong). PHẢI lặp lại ở ĐÂY (không tái dùng launchPage() được, vì
  // file này cần page.route()/addInitScript() sống qua reload — launchPage() dùng exposeFunction + 1 lần
  // evaluate() không sống qua reload) và lặp lại SAU MỖI LẦN page.goto()/reload() (tài nguyên JS module
  // vẫn y hệt, nhưng trạng thái "đã nạp cụm nào" sống trong chính document mới, mất khi tải lại).
  async function eagerLoadAllModulesAndFragments() {
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map((k) => loadModuleGroup(k))));
    await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map((k) => loadTabSectionHtml(k))));
  }

  try {
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
    await eagerLoadAllModulesAndFragments();

    await run.run('Chuẩn bị: chưa đăng nhập -> hiện màn Đăng Nhập thật (không phải proceedAfterAuth() tiêm tay)', async () => {
      const loginVisible = await page.evaluate(() => !document.getElementById('loginSection').classList.contains('hidden'));
      assert(loginVisible, 'Màn Đăng Nhập phải hiện ra vì chưa có phiên nào');
    });

    await page.fill('#txtUser', 'nv1');
    await page.fill('#txtPass', 'anything'); // mock không kiểm mật khẩu thật, chỉ cần khớp username
    await page.click('#btnLogin');
    await page.waitForFunction(() => typeof DB !== 'undefined' && DB.users && DB.users.length > 0, { timeout: 15000 });
    await page.waitForTimeout(150);

    await run.run('Đăng nhập THẬT qua form (POST /api/auth/login thật) thành công, vào được giao diện chính', async () => {
      const loginHidden = await page.evaluate(() => document.getElementById('loginSection').classList.contains('hidden'));
      assert(loginHidden, 'Màn Đăng Nhập phải ẩn đi sau khi đăng nhập thành công');
    });

    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(250); // prefetchKkSessionInfoForShelves() chạy ngầm, cache sẵn session info cho A1
    await page.selectOption('#kkKiemDemShelfSelect', '10');
    await page.waitForTimeout(200);

    await run.run('Chuẩn bị (còn mạng): chọn A1 thành công, đã cache session info + danh sách quầy kệ cho offline sau này', async () => {
      const hidden = await page.evaluate(() => document.getElementById('kkKiemDemScanBox').classList.contains('hidden'));
      assert(!hidden, 'Ô quét phải mở (còn mạng, A1 hợp lệ)');
    });

    // ===== MẤT MẠNG HOÀN TOÀN (kể cả /api/auth/me) =====
    networkDown = true;
    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(250);

    await run.run('1a) Quét SP001 lúc offline -> vào hàng đợi kkPendingScans + IndexedDB, hiện badge ⏳', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingScans.length);
      assertEqual(pendingLen, 1, 'Phải có đúng 1 lượt quét trong hàng đợi offline (biến JS)');
      const listText = await page.evaluate(() => document.getElementById('kkKiemDemListBody').textContent);
      assert(listText.includes('SP001') && listText.includes('⏳'), `Phải hiện SP001 kèm badge ⏳, thực tế: ${listText}`);
    });

    // ===== F5 THẬT trong lúc VẪN ĐANG MẤT MẠNG (kể cả /api/auth/me) =====
    await page.reload({ waitUntil: 'load' }).catch((e) => { throw new Error('page.reload() lúc offline bị lỗi: ' + e.message); });
    await eagerLoadAllModulesAndFragments();
    await page.waitForTimeout(400);

    await run.run('1b) F5 lúc ĐANG offline: dữ liệu đã quét (kkPendingScans) có CÒN TRONG IndexedDB không (đọc trực tiếp DB, không qua biến JS app — kiểm tra ĐỘ BỀN dữ liệu thật)', async () => {
      const rows = await page.evaluate(() => new Promise((resolve) => {
        const req = indexedDB.open('hcrcShelfOfflineDb', 4);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kkPendingScans')) return resolve([]);
          const tx = db.transaction('kkPendingScans', 'readonly');
          const getAllReq = tx.objectStore('kkPendingScans').getAll();
          getAllReq.onsuccess = () => resolve(getAllReq.result || []);
          getAllReq.onerror = () => resolve(['__error__']);
        };
        req.onerror = () => resolve(['__open_error__']);
      }));
      console.log(`   [ghi nhận thực tế] IndexedDB kkPendingScans sau F5 lúc offline: ${JSON.stringify(rows)}`);
      assertEqual(rows.length, 1, 'Dữ liệu quét offline PHẢI còn nguyên trong IndexedDB sau F5 (bền, không phụ thuộc biến JS trong bộ nhớ)');
      assertEqual(rows[0].maHang, 'SP001', 'Đúng mã hàng đã quét trước khi F5');
    });

    await run.run('1c) BUG/KHÔNG BUG: F5 lúc offline -> ứng dụng có cho XEM LẠI dữ liệu vừa quét ngay không, hay bị đẩy về màn Đăng Nhập (không vào được app để xem hàng đợi) vì tryRestoreSession() cần GET /api/auth/me (cần mạng)?', async () => {
      const loginVisible = await page.evaluate(() => !document.getElementById('loginSection')?.classList.contains('hidden'));
      const kiemKeVisible = await page.evaluate(() => !document.getElementById('kiemKeSection')?.classList.contains('hidden'));
      console.log(`   [ghi nhận thực tế] Sau F5 lúc offline: màn Đăng Nhập đang hiện? ${loginVisible} | màn Kiểm Kê đang hiện? ${kiemKeVisible}`);
      if (loginVisible) {
        console.log('   => XÁC NHẬN: F5 lúc offline đẩy người dùng VỀ MÀN ĐĂNG NHẬP (tryRestoreSession() ở core.js gọi GET /api/auth/me, lỗi mạng -> catch -> hideBootSplash() + hiện #loginSection) — dữ liệu hàng đợi KHÔNG MẤT (xem 1b) nhưng người dùng KHÔNG THỂ xem/tiếp tục thao tác (kể cả xem lại danh sách đã quét) cho tới khi có mạng VÀ đăng nhập lại được (POST /api/auth/login CŨNG cần mạng) — đây là 1 giới hạn kiến trúc thật (không phải lỗi phần mềm kiểu crash), nhưng ngược lại với kỳ vọng "làm việc offlineđượcmà không cần làm gì thêm" nếu người dùng/nhân viên vô tình làm mới trang hoặc trình duyệt/app tự kill tab nền lúc đang ở khu vực sóng yếu.');
      } else if (kiemKeVisible) {
        console.log('   => Không phát hiện vấn đề: ứng dụng vẫn ở nguyên màn Kiểm Kê sau F5 dù offline (phiên được khôi phục không cần mạng).');
      }
    });

    // ===== CÓ MẠNG LẠI (nhưng CHƯA đăng nhập lại nếu 1c xác nhận bị đẩy về màn Đăng Nhập) =====
    networkDown = false;
    await page.waitForTimeout(300);
    await run.run('1d) Có mạng lại: kiểm tra lại trạng thái màn hình NGAY (chưa làm gì thêm) — tự phục hồi hay vẫn kẹt ở màn Đăng Nhập chờ người dùng tự đăng nhập lại?', async () => {
      const loginVisible = await page.evaluate(() => !document.getElementById('loginSection')?.classList.contains('hidden'));
      console.log(`   [ghi nhận thực tế] Có mạng lại, CHƯA tự F5/đăng nhập gì thêm: màn Đăng Nhập đang hiện? ${loginVisible}`);
    });

    const stillOnLogin = await page.evaluate(() => !document.getElementById('loginSection')?.classList.contains('hidden'));
    if (stillOnLogin) {
      // "Tài khoản đã nhớ" (initRememberedLoginUser(), core.js) có thể đang hiện thay ô gõ Tên đăng nhập
      // (localStorage nhớ lượt đăng nhập THÀNH CÔNG trước F5) — bấm "Tài khoản khác" để lộ lại ô gõ bình
      // thường, giữ kịch bản test tường minh/không phụ thuộc trạng thái "nhớ" ngẫu nhiên.
      const rememberedVisible = await page.evaluate(() => !document.getElementById('loginRememberedUserWrap')?.classList.contains('hidden'));
      if (rememberedVisible) await page.click('#btnSwitchLoginUser');
      await page.fill('#txtUser', 'nv1');
      await page.fill('#txtPass', 'anything');
      await page.click('#btnLogin');
      await page.waitForFunction(() => typeof DB !== 'undefined' && DB.users && DB.users.length > 0, { timeout: 15000 });
      await page.waitForTimeout(200);
    }

    await run.run('1e) Sau khi đăng nhập lại (hoặc đã sẵn trong app): vào lại Tab Kiểm Đếm, chọn A1 -> dữ liệu đã quét offline trước F5 PHẢI hiện lại đúng và tự đồng bộ lên server (KHÔNG mất, KHÔNG trùng)', async () => {
      await page.evaluate(() => switchTab('kiemKe'));
      await page.waitForTimeout(150);
      await page.click('#btnKkSubKiemDem');
      await page.waitForTimeout(250);
      await page.selectOption('#kkKiemDemShelfSelect', '10');
      await page.waitForTimeout(250);
      await page.evaluate(() => trySyncPendingKkScans());
      await page.waitForTimeout(350);
      const listText = await page.evaluate(() => document.getElementById('kkKiemDemListBody').textContent);
      assert(listText.includes('SP001'), `SP001 phải hiện lại đúng sau khi đăng nhập lại + chọn A1, thực tế: ${listText}`);
      const pendingLen = await page.evaluate(() => kkOfflinePendingScans.length);
      assertEqual(pendingLen, 0, 'Hàng đợi phải tự đồng bộ hết (SP001 đã lên server), không cần người dùng làm gì thêm ngoài chọn lại quầy kệ');
      const serverRow = (state.stocktakeCounts || []).find((c) => c.maHang === 'SP001' && c.shelfLocationId === 10);
      assert(serverRow && serverRow.slKiemDem === 1, `Server phải nhận đúng đúng 1 lần (không trùng do F5 nhiều lần), thực tế: ${JSON.stringify(serverRow)}`);
    });

    await run.run('6) Không có lỗi JS/console lạ nào (ngoài 404 tài nguyên tĩnh đã biết) trong toàn bộ luồng F5-khi-offline', async () => {
      assert(jsErrors.length === 0, 'Lỗi JS: ' + jsErrors.join(' | '));
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
