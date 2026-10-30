// tests/test-shelf-kehang-offline.js — "📋 Kiểm Soát Hàng Hóa" > Ghi Nhận Trên Kệ, Phần D/E (11/2026):
// quét mã vạch camera + offline-first. 2 nhóm test:
//  1) Node trực tiếp (không Playwright) — logic server lib/createValidation.js: clientRecordId chống
//     tạo trùng khi đồng bộ lại (DUPLICATE_OFFLINE_SYNC), chỉ dedupe TRONG CÙNG dept (không rò rỉ chéo
//     siêu thị), vẫn giữ nguyên toàn bộ chặn store-spoofing cũ (shelfLocationId phải đúng dept).
//  2) Playwright thật (IndexedDB THẬT trong Chromium, không mock) — các hàm offline-first phía client ở
//     module-vanhanh.js: ensureShelfOfflineReady() tự xoá cache khi đổi dept, cacheShelfLocationsOffline()/
//     effectiveShelfLocations() fallback đúng lúc "mất mạng" (DB.shelfLocations rỗng), queueShelfRecordOffline()/
//     trySyncPendingShelfRecords() giữ/xoá đúng hàng đợi (kể cả nhánh DUPLICATE_OFFLINE_SYNC coi là
//     thành công). KHÔNG dùng _mock-backend.js cho POST /api/create (mock đó chưa hỗ trợ shelfRecords,
//     xem ghi chú tại __mockHandleCreate) — tự thay window.callCreateAction bằng hàm giả lập NGAY TRONG
//     page.evaluate() cho đúng 2 kịch bản cần (thành công/DUPLICATE_OFFLINE_SYNC), không đụng gì tới
//     _mock-backend.js/testHarness.js dùng chung cho các test khác.
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');
const { CreateError, validateAndPrepareCreate } = require('../lib/createValidation');

function userOf(dept, perms) {
  return { username: 'u1', name: 'User 1', dept, perms: perms || {} };
}
function shelfLoc(dept, id, code) {
  return { id, dept, code, name: `Quầy ${code}`, active: true };
}

async function nodeDirectTests(run) {
  await run.run('shelfRecords: clientRecordId trùng TRONG CÙNG dept -> 409 DUPLICATE_OFFLINE_SYNC (coi là đã đồng bộ, không tạo bản ghi mới)', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfRecordCreate: true });
    const appData = { shelfLocations: [shelfLoc('Siêu thị Quận 1', 1, 'A1')] };
    const existing = [{ dept: 'Siêu thị Quận 1', clientRecordId: 'cr-abc-123' }];
    let caught = null;
    try {
      validateAndPrepareCreate('shelfRecords',
        { shelfLocationId: 1, productName: 'Coca-Cola', quantity: 10, clientRecordId: 'cr-abc-123' },
        user, existing, appData);
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 409 && caught.message === 'DUPLICATE_OFFLINE_SYNC',
      `phải là CreateError 409 'DUPLICATE_OFFLINE_SYNC', thực tế: ${caught}`);
  });

  await run.run('shelfRecords: clientRecordId KHÔNG trùng -> tạo OK, record.clientRecordId được lưu lại', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfRecordCreate: true });
    const appData = { shelfLocations: [shelfLoc('Siêu thị Quận 1', 1, 'A1')] };
    const record = validateAndPrepareCreate('shelfRecords',
      { shelfLocationId: 1, productName: 'Coca-Cola', quantity: 10, clientRecordId: 'cr-new-456' },
      user, [], appData);
    assertEqual(record.clientRecordId, 'cr-new-456', 'clientRecordId phải được lưu vào record');
    assertEqual(record.dept, 'Siêu thị Quận 1', 'dept vẫn phải = user.dept (forceOwnDept, không đổi hành vi cũ)');
  });

  await run.run('shelfRecords: cùng clientRecordId nhưng dept KHÁC -> KHÔNG bị chặn trùng (dedupe chỉ trong cùng dept, không rò rỉ chéo siêu thị)', async () => {
    const user = userOf('Siêu thị Quận 7', { shelfRecordCreate: true });
    const appData = { shelfLocations: [shelfLoc('Siêu thị Quận 7', 2, 'B1')] };
    const existing = [{ dept: 'Siêu thị Quận 1', clientRecordId: 'cr-abc-123' }]; // của siêu thị KHÁC
    const record = validateAndPrepareCreate('shelfRecords',
      { shelfLocationId: 2, productName: 'Sting', quantity: 5, clientRecordId: 'cr-abc-123' },
      user, existing, appData);
    assertEqual(record.dept, 'Siêu thị Quận 7', 'phải tạo được bình thường, không bị ăn nhầm dup-check của siêu thị khác');
  });

  await run.run('shelfRecords: KHÔNG gửi clientRecordId (client cũ/không offline) -> vẫn tạo OK như trước (không bắt buộc field mới)', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfRecordCreate: true });
    const appData = { shelfLocations: [shelfLoc('Siêu thị Quận 1', 1, 'A1')] };
    const record = validateAndPrepareCreate('shelfRecords',
      { shelfLocationId: 1, productName: 'Coca-Cola', quantity: 10 }, user, [], appData);
    assertEqual(record.clientRecordId, '', 'không gửi thì mặc định chuỗi rỗng, không throw/undefined');
  });

  await run.run('shelfRecords: clientRecordId KHÔNG được dùng để né chặn store-spoofing shelfLocationId (quầy kệ siêu thị khác vẫn bị chặn 400)', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfRecordCreate: true });
    const appData = { shelfLocations: [shelfLoc('Siêu thị Quận 7', 9, 'X9')] }; // quầy của siêu thị KHÁC
    let caught = null;
    try {
      validateAndPrepareCreate('shelfRecords',
        { shelfLocationId: 9, productName: 'Hack', quantity: 1, clientRecordId: 'cr-hack' }, user, [], appData);
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 400, `phải vẫn bị chặn 400 như Phase 1, thực tế: ${caught}`);
  });
}

async function playwrightTests(run) {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8997;
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: 'Siêu thị Quận 1',
    perms: { shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true
  };
  const state = createMockState({ depts: ['Siêu thị Quận 1', 'Siêu thị Quận 7'], users: [USER] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    // DB.shelfLocations/shelfRecords không có trong seed mock chung (xem ghi chú đầu file) — tự gán
    // thẳng vào DB client (đủ cho mục đích test các hàm offline-first phía client, không đụng server).
    await page.evaluate(() => {
      DB.shelfLocations = [{ id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Nước giải khát', active: true }];
      DB.shelfRecords = [];
    });

    await run.run('ensureShelfOfflineReady(): cache được quầy kệ + xoá sạch khi ĐỔI dept (store-spoofing offline)', async () => {
      await page.evaluate(() => ensureShelfOfflineReady());
      await page.evaluate(() => cacheShelfLocationsOffline());
      const beforeLen = await page.evaluate(() => shelfOfflineLocationsCache.length);
      assert(beforeLen === 1, `phải cache được 1 quầy kệ, thực tế: ${beforeLen}`);
      // Đổi dept tài khoản (mô phỏng đổi ca/đổi siêu thị trên cùng máy) rồi gọi lại — phải XOÁ SẠCH cache cũ.
      await page.evaluate(() => { currentUser.dept = 'Siêu thị Quận 7'; });
      await page.evaluate(() => ensureShelfOfflineReady());
      const afterLen = await page.evaluate(() => shelfOfflineLocationsCache.length);
      assertEqual(afterLen, 0, 'đổi dept phải xoá sạch cache quầy kệ của siêu thị cũ');
      await page.evaluate(() => { currentUser.dept = 'Siêu thị Quận 1'; });
      await page.evaluate(() => ensureShelfOfflineReady());
      await page.evaluate(() => cacheShelfLocationsOffline());
    });

    await run.run('effectiveShelfLocations(): fallback sang cache offline khi DB.shelfLocations rỗng (mất mạng, mở lại app)', async () => {
      const onlineResult = await page.evaluate(() => effectiveShelfLocations().length);
      assertEqual(onlineResult, 1, 'còn online (DB.shelfLocations có dữ liệu) -> dùng DB.shelfLocations');
      const offlineResult = await page.evaluate(() => {
        const saved = DB.shelfLocations;
        DB.shelfLocations = [];
        const n = effectiveShelfLocations().length;
        DB.shelfLocations = saved;
        return n;
      });
      assertEqual(offlineResult, 1, 'DB.shelfLocations rỗng -> phải fallback sang shelfOfflineLocationsCache');
    });

    await run.run('queueShelfRecordOffline()/trySyncPendingShelfRecords(): hàng đợi được xoá khi đồng bộ THÀNH CÔNG', async () => {
      await page.evaluate(async () => {
        await queueShelfRecordOffline(
          { shelfLocationId: 1, productName: 'Coca-Cola', maVach: '', quantity: 10, expiryDate: '', note: '', customData: {}, clientRecordId: 'cr-sync-ok' },
          { code: 'A1', name: 'Nước giải khát' });
      });
      const queuedLen = await page.evaluate(() => shelfOfflinePendingCache.length);
      assertEqual(queuedLen, 1, 'phải có 1 bản ghi trong hàng đợi sau queueShelfRecordOffline()');
      await page.evaluate(() => {
        window.__origCallCreateAction = window.callCreateAction;
        window.callCreateAction = async (moduleKey, payload) => ({ ok: true, item: Object.assign({ id: 999, dept: currentUser.dept }, payload) });
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      });
      await page.evaluate(() => trySyncPendingShelfRecords());
      const afterLen = await page.evaluate(() => shelfOfflinePendingCache.length);
      assertEqual(afterLen, 0, 'đồng bộ thành công phải xoá khỏi hàng đợi');
      const dbLen = await page.evaluate(() => DB.shelfRecords.length);
      assert(dbLen >= 1, 'bản ghi đồng bộ xong phải được thêm vào DB.shelfRecords');
    });

    await run.run('trySyncPendingShelfRecords(): nhận DUPLICATE_OFFLINE_SYNC vẫn coi là THÀNH CÔNG (xoá khỏi hàng đợi, không lặp vô hạn/không báo lỗi)', async () => {
      await page.evaluate(async () => {
        await queueShelfRecordOffline(
          { shelfLocationId: 1, productName: 'Sting', maVach: '', quantity: 5, expiryDate: '', note: '', customData: {}, clientRecordId: 'cr-dup-case' },
          { code: 'A1', name: 'Nước giải khát' });
        window.callCreateAction = async () => { throw new Error('DUPLICATE_OFFLINE_SYNC'); };
      });
      await page.evaluate(() => trySyncPendingShelfRecords());
      const len = await page.evaluate(() => shelfOfflinePendingCache.length);
      assertEqual(len, 0, 'DUPLICATE_OFFLINE_SYNC phải được coi là đã đồng bộ xong, xoá khỏi hàng đợi');
    });

    await run.run('trySyncPendingShelfRecords(): lỗi MẠNG thật (TypeError) -> GIỮ LẠI trong hàng đợi, không mất dữ liệu', async () => {
      await page.evaluate(async () => {
        await queueShelfRecordOffline(
          { shelfLocationId: 1, productName: 'Mì Hảo Hảo', maVach: '', quantity: 8, expiryDate: '', note: '', customData: {}, clientRecordId: 'cr-still-offline' },
          { code: 'A1', name: 'Nước giải khát' });
        window.callCreateAction = async () => { throw new TypeError('Failed to fetch'); };
      });
      await page.evaluate(() => trySyncPendingShelfRecords());
      const len = await page.evaluate(() => shelfOfflinePendingCache.length);
      assertEqual(len, 1, 'lỗi mạng thật thì KHÔNG được xoá khỏi hàng đợi — còn offline, phải thử lại sau');
      await page.evaluate(() => { window.callCreateAction = window.__origCallCreateAction; delete window.__origCallCreateAction; });
    });
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  const run = createRunner();
  await nodeDirectTests(run);
  await playwrightTests(run);
  run.summary();
}

main().catch((err) => { console.error(err); process.exit(1); });
