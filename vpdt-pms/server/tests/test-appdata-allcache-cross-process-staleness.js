// server/tests/test-appdata-allcache-cross-process-staleness.js
//
// LỖI THẬT đã vá (11/2026, người dùng báo "hay bị" — lưu phân quyền xong (cả Sửa 1 Người Dùng lẫn Nhóm
// Phân Quyền) ấn F5 thấy mất luôn thay đổi vừa lưu): server chạy PM2 CLUSTER MODE nhiều tiến trình
// (ecosystem.config.js, instances: 'max') — getAllAppDataWithVersionsCached() (dùng cho GET /api/data,
// nơi F5 tải lại dữ liệu) TRƯỚC ĐÂY chỉ dựa vào TTL (vài giây) + thông báo process.send() giữa các tiến
// trình để xoá cache — nếu request F5 rơi vào 1 tiến trình KHÁC với tiến trình vừa xử lý lượt lưu, VÀ
// thông báo process.send() đó (cơ chế BEST-EFFORT) chưa tới/không tới tiến trình đó, nó vẫn trả về cache
// CŨ (tối đa bằng TTL, mặc định 3s) dù CSDL đã có dữ liệu mới.
//
// Test này mô phỏng ĐÚNG kịch bản 2 TIẾN TRÌNH KHÁC NHAU cùng trỏ vào 1 CSDL (bảng AppData giả lập dùng
// chung) nhưng KHÔNG CHIA SẺ bộ nhớ trong tiến trình (mỗi "tiến trình" là 1 bản require() RIÊNG của
// lib/appData.js, module cache bị xoá giữa 2 lần require để mỗi bản có closure `allDataCache` ĐỘC LẬP,
// đúng bản chất PM2 cluster) — và CỐ Ý tắt hẳn process.send()/process.on('message') (giả lập tình huống
// thông báo liên tiến trình "không tới", đúng kịch bản tệ nhất) để xác nhận bản vá KHÔNG còn phụ thuộc
// cơ chế đó: dù IPC hoàn toàn không hoạt động, tiến trình B vẫn PHẢI thấy đúng dữ liệu MỚI ngay lập tức.
//
// Chạy: node server/tests/test-appdata-allcache-cross-process-staleness.js
'use strict';
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
}

// Bảng dbo.AppData giả lập DÙNG CHUNG giữa "2 tiến trình" (mô phỏng đúng 1 SQL Server thật dùng chung) —
// đây là điểm MẤU CHỐT khác với 2 closure `allDataCache` riêng biệt ở mỗi "tiến trình".
const TABLE = new Map();
TABLE.set('users', { DataValue: JSON.stringify([{ id: 1, username: 'admin', perms: { admin: true } }]), UpdatedAt: new Date('2026-01-01T00:00:00.000Z') });

class FakeRequest {
  constructor() { this.inputs = {}; }
  input(name, _type, value) { this.inputs[name] = value; return this; }
  async query(text) {
    const t = text.replace(/\s+/g, ' ').trim();
    if (/^SELECT MAX\(UpdatedAt\) AS maxUpdatedAt FROM dbo\.AppData$/.test(t)) {
      let max = null;
      for (const row of TABLE.values()) { if (!max || row.UpdatedAt > max) max = row.UpdatedAt; }
      return { recordset: [{ maxUpdatedAt: max }] };
    }
    if (/^SELECT DataKey, DataValue, UpdatedAt FROM dbo\.AppData$/.test(t)) {
      return { recordset: [...TABLE.entries()].map(([k, v]) => ({ DataKey: k, DataValue: v.DataValue, UpdatedAt: v.UpdatedAt })) };
    }
    if (/^SELECT DataValue FROM dbo\.AppData WITH \(UPDLOCK, HOLDLOCK\) WHERE DataKey = @k$/.test(t)) {
      const row = TABLE.get(this.inputs.k);
      return { recordset: row ? [{ DataValue: row.DataValue }] : [] };
    }
    if (/^UPDATE dbo\.AppData SET DataValue = @v, UpdatedAt = SYSUTCDATETIME\(\) WHERE DataKey = @k$/.test(t)) {
      TABLE.set(this.inputs.k, { DataValue: this.inputs.v, UpdatedAt: new Date() });
      return { recordset: [] };
    }
    throw new Error('Câu query không mong đợi trong bản giả lập: ' + t);
  }
}
class FakeTransaction {
  async begin() {}
  async commit() {}
  async rollback() {}
}

function loadFreshAppDataModuleAsNewProcess() {
  // Xoá cache require() của lib/appData.js (và db.js stub) để lần require() tiếp theo chạy lại TOÀN BỘ
  // thân module từ đầu — tạo ra 1 bản ĐỘC LẬP với closure `allDataCache`/`cache` riêng, mô phỏng đúng 1
  // tiến trình PM2 cluster KHÁC (không chia sẻ bộ nhớ trong tiến trình với bản trước).
  const appDataPath = require.resolve('../lib/appData');
  delete require.cache[appDataPath];
  // CỐ Ý KHÔNG stub process.send/process.on — hoặc nói đúng hơn: vô hiệu hoá hẳn để mô phỏng kịch bản
  // TỆ NHẤT "thông báo liên tiến trình không bao giờ tới" — nếu bản vá chỉ dựa vào process.send() thì
  // test này PHẢI fail; bản vá thật (MAX(UpdatedAt) tự xác nhận lại) thì KHÔNG cần tới cơ chế này.
  stubModule('db', { getPool: async () => ({ request: () => new FakeRequest() }), sql: { NVarChar: () => ({}), MAX: 'MAX', Transaction: FakeTransaction, Request: FakeRequest } });
  return require('../lib/appData');
}

async function main() {
  const originalProcessSend = process.send;
  const originalProcessOn = process.on;
  // Vô hiệu hoá hẳn process.send (typeof check trong cacheInvalidate() sẽ thấy "undefined", bỏ qua
  // nhánh gửi IPC) — và chặn process.on('message', ...) không cho module mới đăng ký listener nào (dù
  // listener đó cũng vô hại, chặn hẳn cho chắc, đúng tinh thần "giả lập IPC hoàn toàn không hoạt động").
  process.send = undefined;
  process.on = function (event, ...rest) {
    if (event === 'message') return process; // nuốt đăng ký, không gắn listener thật nào
    return originalProcessOn.call(process, event, ...rest);
  };

  try {
    // "Tiến trình A" (vd tiến trình xử lý request LƯU).
    const appDataA = loadFreshAppDataModuleAsNewProcess();
    // "Tiến trình B" (vd tiến trình nhận request F5 SAU ĐÓ) — module RIÊNG, closure RIÊNG, cùng bảng
    // TABLE (CSDL) dùng chung ở trên.
    const appDataB = loadFreshAppDataModuleAsNewProcess();

    // Tiến trình B mở app lúc đầu — GET /api/data lần đầu, nạp allDataCache của B với dữ liệu BAN ĐẦU.
    const beforeB = await appDataB.getAllAppDataWithVersionsCached();
    assert.strictEqual(beforeB.data.users[0].perms.admin, true, 'dữ liệu ban đầu phải đúng seed');
    assert.strictEqual(beforeB.data.users.length, 1, 'ban đầu chỉ có 1 user (admin)');

    // Tiến trình A xử lý lượt LƯU (patch-mode, dùng withLockedAppDataValue — ĐÚNG cơ chế routes/data.js
    // dùng cho "Sửa 1 Người Dùng"/syncUsersWithPermGroupsChange() dùng cho "Nhóm Phân Quyền").
    await appDataA.withLockedAppDataValue('users', async (freshUsers) => {
      return [...freshUsers, { id: 2, username: 'nv1', perms: { shelfRecordCreate: true } }];
    });
    // process.send bị vô hiệu hoá ở trên -> appDataA.cacheInvalidate() (gọi NGẦM bên trong
    // withLockedAppDataValue) KHÔNG hề gửi được thông báo gì sang tiến trình B — đúng kịch bản tệ nhất.

    // Tiến trình B nhận request F5 NGAY SAU ĐÓ (trong vòng TTL 3s, KHÔNG đợi hết TTL) — PHẢI thấy dữ
    // liệu MỚI (2 user), KHÔNG được trả về cache CŨ (1 user) dù KHÔNG hề nhận được thông báo IPC nào.
    const afterB = await appDataB.getAllAppDataWithVersionsCached();
    assert.strictEqual(afterB.data.users.length, 2, 'LỖI (bug tái hiện): tiến trình B vẫn trả cache CŨ (1 user) dù CSDL đã có 2 user — đúng lỗi "F5 mất thay đổi vừa lưu" người dùng báo cáo');
    assert.strictEqual(afterB.data.users.find(u => u.username === 'nv1')?.perms?.shelfRecordCreate, true, 'user mới lưu phải hiện ĐÚNG field vừa đổi, không phải bản cũ');

    console.log('\n✅ Xác nhận: getAllAppDataWithVersionsCached() giờ LUÔN thấy đúng dữ liệu mới nhất ở MỌI tiến trình ngay sau khi lưu, kể cả khi thông báo IPC liên tiến trình (process.send) hoàn toàn không hoạt động — không còn phụ thuộc cơ chế best-effort đó để đúng/sai nữa.');
  } finally {
    process.send = originalProcessSend;
    process.on = originalProcessOn;
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e && e.stack || e); process.exit(1); });
