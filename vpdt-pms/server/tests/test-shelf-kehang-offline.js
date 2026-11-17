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
const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual } = require('./testHarness');
const { CreateError, validateAndPrepareCreate } = require('../lib/createValidation');

function userOf(dept, perms) {
  return { username: 'u1', name: 'User 1', dept, perms: perms || {} };
}
function shelfLoc(dept, id, code) {
  return { id, dept, code, name: `Quầy ${code}`, active: true };
}

async function nodeDirectTests(run) {
  // LỖI ĐÃ VÁ (11/2026, báo cáo người dùng thật — IT test offline "Ghi Nhận" ở chỗ sóng yếu/chập chờn: có
  // mạng lại nhưng KHÔNG tự đồng bộ): nhịp tự thử đồng bộ 20 giây (__kkOfflineHeartbeatAdded, thêm 12/2026
  // CHO Kiểm Kê) bỏ sót trySyncPendingShelfRecords() — hàng đợi Ghi Nhận chỉ còn trông chờ sự kiện "online"
  // của trình duyệt (không đáng tin cậy ở mạng chập chờn, đúng tình huống nhịp 20 giây sinh ra để xử lý).
  // Test TĨNH (đọc thẳng mã nguồn) thay vì mô phỏng bộ đếm giờ thật — giữ ĐỦ 3 hàm luôn cùng 1 chỗ đăng ký,
  // không cần Playwright/mock setInterval (xem chú thích đầy đủ tại dòng setInterval, module-vanhanh.js).
  await run.run('setInterval() nhịp 20s offline phải gọi ĐỦ cả 3 hàm đồng bộ (Ghi Nhận + Gom Mã/Kiểm Đếm + Xác Nhận), không bỏ sót Ghi Nhận', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'module-vanhanh.js'), 'utf8');
    const m = src.match(/__kkOfflineHeartbeatAdded[\s\S]{0,300}?setInterval\(\(\) => \{([\s\S]*?)\}, 20000\)/);
    assert(m, 'phải tìm thấy đúng khối đăng ký nhịp 20 giây (__kkOfflineHeartbeatAdded)');
    const body = m[1];
    assert(body.includes('trySyncPendingShelfRecords()'), `nhịp 20 giây thiếu trySyncPendingShelfRecords() — hàng đợi Ghi Nhận sẽ kẹt khi sự kiện "online" không bắn ra: ${body}`);
    assert(body.includes('trySyncPendingKkScans()'), 'không được làm mất hàm Gom Mã/Kiểm Đếm đã có sẵn');
    assert(body.includes('trySyncPendingKkConfirms()'), 'không được làm mất hàm Xác Nhận đã có sẵn');
  });

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
  const SHELF_LOCATION = { id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Nước giải khát', active: true };
  const state = createMockState({ depts: ['Siêu thị Quận 1', 'Siêu thị Quận 7'], users: [USER], shelfLocations: [SHELF_LOCATION] });
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

    await run.run('queueShelfRecordOffline()/trySyncPendingShelfRecords(): hàng đợi được xoá khi đồng bộ THÀNH CÔNG (đi qua ĐÚNG route /records/upsert thật, có shelfLocations server-side)', async () => {
      await page.evaluate(async () => {
        await queueShelfRecordOffline(
          { shelfLocationId: 1, productName: 'Coca-Cola', maHang: 'SKU-SYNC-OK', maVach: '', quantity: 10, expiryDate: '', note: '', customData: {}, clientRecordId: 'cr-sync-ok' },
          { code: 'A1', name: 'Nước giải khát' });
      });
      const queuedLen = await page.evaluate(() => shelfOfflinePendingCache.length);
      assertEqual(queuedLen, 1, 'phải có 1 bản ghi trong hàng đợi sau queueShelfRecordOffline()');
      await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }); });
      await page.evaluate(() => trySyncPendingShelfRecords());
      const afterLen = await page.evaluate(() => shelfOfflinePendingCache.length);
      assertEqual(afterLen, 0, 'đồng bộ thành công (route /records/upsert thật) phải xoá khỏi hàng đợi');
      const dbLen = await page.evaluate(() => DB.shelfRecords.length);
      assert(dbLen >= 1, 'bản ghi đồng bộ xong phải được thêm vào DB.shelfRecords');
    });

    await run.run('trySyncPendingShelfRecords(): retry CÙNG lô (mất response, offline-sync gửi lại nguyên payload cũ) -> idempotent, KHÔNG tạo dòng thứ 2 (thay thế hẳn cơ chế DUPLICATE_OFFLINE_SYNC cũ, nay đi qua lô-matching của chính route upsert)', async () => {
      const before = await page.evaluate(() => DB.shelfRecords.length);
      await page.evaluate(async () => {
        // 2 clientRecordId KHÁC nhau (2 lượt scan offline riêng biệt, VD kiểm 2 lần cùng buổi mất mạng)
        // nhưng CÙNG lô thật (dept+shelfLocationId+maHang+expiryDate) — route upsert dedupe theo LÔ, không
        // theo clientRecordId (đã bỏ hẳn cơ chế dedupe theo clientRecordId của route generic cũ), nên đây
        // mới là kịch bản thật cần test, không phải retry-y-hệt-1-request.
        await queueShelfRecordOffline(
          { shelfLocationId: 1, productName: 'Sting', maHang: 'SKU-DUP-CASE', maVach: '', quantity: 5, expiryDate: '', note: '', customData: {}, clientRecordId: 'cr-dup-case-1' },
          { code: 'A1', name: 'Nước giải khát' });
        await queueShelfRecordOffline(
          { shelfLocationId: 1, productName: 'Sting', maHang: 'SKU-DUP-CASE', maVach: '', quantity: 5, expiryDate: '', note: '', customData: {}, clientRecordId: 'cr-dup-case-2' },
          { code: 'A1', name: 'Nước giải khát' });
      });
      const queuedLen = await page.evaluate(() => shelfOfflinePendingCache.length);
      assertEqual(queuedLen, 2, 'phải có 2 bản ghi giống nhau trong hàng đợi (mô phỏng gửi lại)');
      await page.evaluate(() => trySyncPendingShelfRecords());
      const afterLen = await page.evaluate(() => shelfOfflinePendingCache.length);
      assertEqual(afterLen, 0, 'cả 2 lượt gửi (giống nhau) đều phải được server chấp nhận, xoá khỏi hàng đợi');
      const after = await page.evaluate(() => DB.shelfRecords.filter(r => r.maHang === 'SKU-DUP-CASE').length);
      assertEqual(after, 1, `2 lượt gửi CÙNG lô (idempotent qua upsert) chỉ phải tạo ĐÚNG 1 dòng, không phải 2, thực tế: ${after}`);
      assertEqual(await page.evaluate(() => DB.shelfRecords.length), before + 1, 'tổng số bản ghi chỉ tăng đúng 1');
    });

    await run.run('trySyncPendingShelfRecords(): lỗi MẠNG thật (TypeError) -> GIỮ LẠI trong hàng đợi, không mất dữ liệu', async () => {
      await page.evaluate(async () => {
        await queueShelfRecordOffline(
          { shelfLocationId: 1, productName: 'Mì Hảo Hảo', maHang: 'SKU-STILL-OFFLINE', maVach: '', quantity: 8, expiryDate: '', note: '', customData: {}, clientRecordId: 'cr-still-offline' },
          { code: 'A1', name: 'Nước giải khát' });
        window.__origFetch = window.fetch;
        window.fetch = async () => { throw new TypeError('Failed to fetch'); };
      });
      await page.evaluate(() => trySyncPendingShelfRecords());
      const len = await page.evaluate(() => shelfOfflinePendingCache.length);
      assertEqual(len, 1, 'lỗi mạng thật thì KHÔNG được xoá khỏi hàng đợi — còn offline, phải thử lại sau');
      await page.evaluate(() => { window.fetch = window.__origFetch; delete window.__origFetch; });
    });

    // queueShelfRecordOffline()/trySyncPendingShelfRecords() + storeOverrideDept (11/2026, theo yêu cầu
    // người dùng — "nếu theo đúng logic offline thì tôi vẫn lưu được, sau đó tự đồng bộ ngược lên" lúc
    // đang bật "🔑 Chọn Siêu Thị Bất Kỳ"): TRƯỚC ĐÂY chặn hẳn lưu tạm trong tình huống này — nay phải lưu
    // được + CHỤP LẠI đúng siêu thị đang chọn tạm, gửi lại kèm ĐÚNG header X-Shelf-Store-Override đó khi
    // đồng bộ (KHÔNG dùng shelfStoreOverrideDept đang chọn ở phiên hiện tại, có thể đã đổi/khác từ lúc
    // queue tới giờ — xem assert thứ 2 dưới đây, cố tình đổi override SANG SIÊU THỊ KHÁC trước khi đồng
    // bộ để chứng minh rec.storeOverrideDept lưu lúc queue mới là giá trị được dùng, không phải biến
    // sống hiện tại). Dùng spy thay window.fetch (cùng kỹ thuật scenario TypeError ngay trên) để bắt lại
    // đúng header mỗi request gửi đi, không cần sửa gì thêm ở testHarness.js dùng chung.
    await run.run('queueShelfRecordOffline()/trySyncPendingShelfRecords(): có storeOverrideDept -> gửi kèm ĐÚNG header X-Shelf-Store-Override đã CHỤP LẠI lúc lưu tạm (không phải override hiện tại); KHÔNG có override -> không gửi header', async () => {
      // Dọn sạch hàng đợi trước (scenario TypeError ngay trên CỐ Ý để lại đúng 1 bản ghi kẹt trong hàng
      // đợi — không liên quan gì tới scenario này, chỉ dọn cho gọn để đếm request chính xác).
      await page.evaluate(async () => {
        const db = await openShelfOfflineDb();
        for (const rec of shelfOfflinePendingCache.slice()) {
          await shelfOfflineTx(db, 'pendingRecords', 'readwrite', s => s.delete(rec.clientRecordId));
        }
        shelfOfflinePendingCache = [];
      });
      await page.evaluate(async () => {
        // (a) KHÔNG override — hành vi cũ không đổi.
        await queueShelfRecordOffline(
          { shelfLocationId: 1, productName: 'Bánh Oreo', maHang: 'SKU-NO-OVERRIDE', maVach: '', quantity: 3, expiryDate: '', note: '', customData: {}, clientRecordId: 'cr-no-override' },
          { code: 'A1', name: 'Nước giải khát' }, null);
        // (b) CÓ override lúc queue — "Siêu thị Quận 7".
        await queueShelfRecordOffline(
          { shelfLocationId: 2, productName: 'Snack Oishi', maHang: 'SKU-WITH-OVERRIDE', maVach: '', quantity: 4, expiryDate: '', note: '', customData: {}, clientRecordId: 'cr-with-override' },
          { code: 'B1', name: 'Bánh kẹo' }, 'Siêu thị Quận 7');
      });
      // Đổi override hiện tại sang 1 giá trị KHÁC hẳn trước khi đồng bộ — chứng minh sync dùng đúng giá
      // trị đã lưu trên từng bản ghi, không phải biến shelfStoreOverrideDept sống tại thời điểm đồng bộ.
      await page.evaluate(() => { shelfStoreOverrideDept = 'Siêu thị Quận 1'; });
      await page.evaluate(() => {
        window.__origFetch2 = window.fetch;
        window.__capturedHeaders = [];
        window.fetch = async (url, opts) => {
          window.__capturedHeaders.push({ url, override: (opts && opts.headers && opts.headers['X-Shelf-Store-Override']) || null });
          return { ok: true, status: 200, json: async () => ({ item: { id: Date.now(), ...JSON.parse(opts.body) }, wasUpdate: false }) };
        };
      });
      await page.evaluate(() => trySyncPendingShelfRecords());
      const captured = await page.evaluate(() => window.__capturedHeaders);
      await page.evaluate(() => { window.fetch = window.__origFetch2; delete window.__origFetch2; delete window.__capturedHeaders; shelfStoreOverrideDept = ''; });
      assertEqual(captured.length, 2, `phải gửi đúng 2 request (1 không override, 1 có override), thực tế: ${captured.length}`);
      assertEqual(captured[0].override, null, 'bản ghi KHÔNG override lúc queue -> KHÔNG được gửi kèm header');
      assertEqual(captured[1].override, encodeURIComponent('Siêu thị Quận 7'), 'bản ghi CÓ override lúc queue -> phải gửi header đúng giá trị đã CHỤP LẠI lúc đó (không phải "Siêu thị Quận 1" vừa đổi)');
      assertEqual(await page.evaluate(() => shelfOfflinePendingCache.length), 0, 'cả 2 đồng bộ thành công -> hàng đợi phải trống');
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
