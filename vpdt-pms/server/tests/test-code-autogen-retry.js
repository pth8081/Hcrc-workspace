// tests/test-code-autogen-retry.js — Yêu cầu 4 (đợt "4 yêu cầu 1 khối"): server tự retry khi trùng mã
// tự sinh, KHÔNG còn ném 409 ngay cho người dùng. Kiểm thử 2 TẦNG riêng biệt, khớp đúng nơi thực sự có
// thể gặp trùng mã trong app thật:
//   1) lib/createValidation.js validateAndPrepareCreate() — điểm chặn ĐẦU TIÊN (trước khi tới DB), test
//      trực tiếp bằng dữ liệu thuần trong bộ nhớ (không cần DB, giống tests/_mockBackend.js).
//   2) lib/recordStore.js insertRecord() — lớp UNIQUE INDEX ở CSDL (2601/2627), test bằng cách MOCK
//      module '../db' (không có SQL Server thật trong sandbox — xem tests/testHarness.js) để mô phỏng
//      trung thực hành vi ràng buộc UNIQUE thật (PK_Records theo Id, UX_Records_Collection_Code theo
//      Collection+Code) và xác nhận đúng luồng tự sinh mã mới + đọc lại real-time.
'use strict';
const assert = require('assert');
const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.message}`); fail++; }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.message}`); fail++; }
}

// ============================================================
// TẦNG 1 — validateAndPrepareCreate() (lib/createValidation.js)
// ============================================================
console.log('\n[1/2] validateAndPrepareCreate() — regenerate mã trùng TRƯỚC khi tới DB');
{
  const { validateAndPrepareCreate } = require('../lib/createValidation');
  const user = { username: 'u1', name: 'Nguyễn Văn A', dept: 'Phòng Công Nghệ Thông Tin', perms: { itSupportCreate: true, admin: true } };

  check('tạo mới với code CHƯA trùng -> giữ nguyên y hệt code client gửi', () => {
    const rec = validateAndPrepareCreate('itSupportTickets', {
      title: 'Test 1', description: 'Mô tả', category: 'OTHER', code: 'HCRC-CNTT-ITHT-001'
    }, user, [], {}, []);
    assert.strictEqual(rec.code, 'HCRC-CNTT-ITHT-001');
  });

  check('code TRÙNG với bản ghi ĐANG SỐNG (có số cuối) -> tự tăng lên số kế tiếp, KHÔNG ném lỗi', () => {
    const existing = [{ id: 1, code: 'HCRC-CNTT-ITHT-001' }];
    const rec = validateAndPrepareCreate('itSupportTickets', {
      title: 'Test 2', description: 'Mô tả', category: 'OTHER', code: 'HCRC-CNTT-ITHT-001'
    }, user, existing, {}, []);
    assert.strictEqual(rec.code, 'HCRC-CNTT-ITHT-002');
  });

  check('code TRÙNG với bản ghi ĐÃ XOÁ (trashedItems) -> vẫn tự tăng, không ném lỗi "đã từng dùng"', () => {
    const trashed = [{ code: 'HCRC-CNTT-ITHT-001' }];
    const rec = validateAndPrepareCreate('itSupportTickets', {
      title: 'Test 3', description: 'Mô tả', category: 'OTHER', code: 'HCRC-CNTT-ITHT-001'
    }, user, [], {}, trashed);
    assert.strictEqual(rec.code, 'HCRC-CNTT-ITHT-002');
  });

  check('lấy đúng SỐ LỚN NHẤT từng có +1 (không phải đếm số lượng còn lại)', () => {
    // Bản ghi mới trùng ĐÚNG "003" (số lớn nhất hiện có) phải nhảy lên 004, dù collection chỉ có 2 bản
    // ghi sống (002 đã "biến mất" ở giữa dãy — mô phỏng đã bị xoá) — KHÔNG được tính theo "còn 2 bản ghi
    // -> lên 003" (003 đang tồn tại, sẽ trùng ngay).
    const existing = [{ id: 1, code: 'HCRC-CNTT-ITHT-001' }, { id: 3, code: 'HCRC-CNTT-ITHT-003' }];
    const rec = validateAndPrepareCreate('itSupportTickets', {
      title: 'Test 4', description: 'Mô tả', category: 'OTHER', code: 'HCRC-CNTT-ITHT-003'
    }, user, existing, {}, []);
    assert.strictEqual(rec.code, 'HCRC-CNTT-ITHT-004');
  });

  check('computeNextSeqForPrefix() (lib/recordStore.js, dùng CHUNG bởi insertRecord()): số lớn nhất +1, đếm cả live lẫn trash', () => {
    const { computeNextSeqForPrefix } = require('../lib/recordStore');
    const combined = [{ code: 'HCRC-CNTT-ITHT-001' }, { code: 'HCRC-CNTT-ITHT-005' }, { code: 'HCRC-KHAC-ITHT-099' }];
    assert.strictEqual(computeNextSeqForPrefix(combined, 'HCRC-CNTT-ITHT-'), 6);
    assert.strictEqual(computeNextSeqForPrefix(combined, 'HCRC-KHAC-ITHT-'), 100);
    assert.strictEqual(computeNextSeqForPrefix([], 'HCRC-CNTT-ITHT-'), 1);
  });

  check('code trùng NHƯNG không có chữ số ở cuối -> vẫn ném 409 như cũ (không đoán mò)', () => {
    const existing = [{ id: 1, code: 'MACODINH' }];
    assert.throws(() => {
      validateAndPrepareCreate('itSupportTickets', {
        title: 'Test 5', description: 'Mô tả', category: 'OTHER', code: 'MACODINH'
      }, user, existing, {}, []);
    }, /đã tồn tại/);
  });

  check('giữ nguyên độ rộng padding gốc (VD "003" -> "004", không phải "4")', () => {
    const existing = [{ id: 1, code: 'HCRC-CNTT-ITHT-003' }];
    const rec = validateAndPrepareCreate('itSupportTickets', {
      title: 'Test 6', description: 'Mô tả', category: 'OTHER', code: 'HCRC-CNTT-ITHT-003'
    }, user, existing, {}, []);
    assert.strictEqual(rec.code, 'HCRC-CNTT-ITHT-004');
  });

  // Mô phỏng ĐÚNG kịch bản "2 request tạo liên tiếp cùng code cố định qua route thật" — dùng lại
  // handleCreate() của tests/_mockBackend.js (require thẳng validateAndPrepareCreate(), collection thật
  // trong bộ nhớ — cùng cách routes/create.js gọi ở app thật) để xác nhận CẢ 2 request đều thành công,
  // không request nào nhận lỗi 409.
  check('2 request TẠO LIÊN TIẾP cùng code cố định (race mô phỏng) -> cả 2 thành công, code KHÁC nhau', () => {
    const collection = [];
    const payload = () => ({ title: 'Ticket', description: 'Mô tả', category: 'OTHER', code: 'HCRC-CNTT-ITHT-999' });
    const rec1 = validateAndPrepareCreate('itSupportTickets', payload(), user, collection, {}, []);
    collection.unshift(rec1);
    const rec2 = validateAndPrepareCreate('itSupportTickets', payload(), user, collection, {}, []);
    collection.unshift(rec2);
    assert.strictEqual(rec1.code, 'HCRC-CNTT-ITHT-999');
    assert.strictEqual(rec2.code, 'HCRC-CNTT-ITHT-1000');
    assert.notStrictEqual(rec1.code, rec2.code);
  });
}

// ============================================================
// TẦNG 2 — insertRecord() (lib/recordStore.js) qua UNIQUE INDEX ở CSDL (mock '../db')
// ============================================================
console.log('\n[2/2] insertRecord() — retry khi đụng UNIQUE INDEX thật (mock SQL Server)');

// Mô phỏng đúng 2 ràng buộc UNIQUE thật ở sql/schema.sql: PK_Records (Collection, Id) và
// UX_Records_Collection_Code (Collection, Code khi Code khác NULL) — "rows" đóng vai trò dbo.Records.
// dedicatedTables (tuỳ chọn, {TableName: [{Id, Code, Payload}]}) mô phỏng THÊM các bảng riêng Bước 7
// (dbo.Docs/dbo.Submissions/...) — insertRecord('docs'/'submissions'/..., ...) giờ tự route sang
// insertDedicatedRecord() (xem lib/recordStore.js DEDICATED_TABLES), sinh câu lệnh
// "INSERT INTO dbo.<Table> (...)" / "SELECT Payload FROM dbo.<Table> ORDER BY..." khác hẳn dbo.Records
// (không có cột Collection) — PHẢI mô phỏng riêng để không lộ "Mock chưa hỗ trợ câu lệnh".
function buildFakeDbModule(rows, dedicatedTables = {}) {
  function makeError(constraintName) {
    const err = new Error(`Violation of ${constraintName.startsWith('PK') ? 'PRIMARY KEY' : 'UNIQUE KEY'} constraint '${constraintName}'. Cannot insert duplicate key.`);
    err.number = 2627;
    return err;
  }
  const fakePool = {
    request() {
      const inputs = {};
      const reqObj = {
        input(name, _type, value) { inputs[name] = value; return reqObj; },
        async query(text) {
          if (/INSERT INTO dbo\.Records/.test(text)) {
            if (rows.some(r => r.Collection === inputs.collection && r.Id === inputs.id)) {
              throw makeError('PK_Records');
            }
            if (inputs.code != null && rows.some(r => r.Collection === inputs.collection && r.Code === inputs.code)) {
              throw makeError('UX_Records_Collection_Code');
            }
            rows.push({ Collection: inputs.collection, Id: inputs.id, Code: inputs.code, Payload: inputs.payload });
            return { recordset: [] };
          }
          if (/SELECT Payload FROM dbo\.Records WHERE Collection = @collection ORDER BY/.test(text)) {
            const rs = rows.filter(r => r.Collection === inputs.collection).map(r => ({ Payload: r.Payload }));
            return { recordset: rs };
          }
          let m;
          if ((m = /^INSERT INTO dbo\.(\w+) \(/.exec(text))) {
            const tableName = m[1];
            const tRows = dedicatedTables[tableName] || (dedicatedTables[tableName] = []);
            if (tRows.some(r => r.Id === inputs.id)) throw makeError(`PK_${tableName}`);
            if (inputs.code != null && tRows.some(r => r.Code === inputs.code)) throw makeError(`UX_${tableName}_Code`);
            tRows.push({ Id: inputs.id, Code: inputs.code ?? null, Payload: inputs.payload });
            return { recordset: [] };
          }
          if ((m = /^SELECT Payload FROM dbo\.(\w+) ORDER BY CreatedAt DESC, Id DESC$/.exec(text))) {
            const tRows = dedicatedTables[m[1]] || [];
            return { recordset: tRows.map(r => ({ Payload: r.Payload })) };
          }
          throw new Error('Mock chưa hỗ trợ câu lệnh: ' + text);
        }
      };
      return reqObj;
    }
  };
  return {
    sql: { NVarChar: () => null, BigInt: 'BigInt', MAX: 'MAX', Int: 'Int', Bit: 'Bit', Date: 'Date', Transaction: class {}, Request: class {} },
    getPool: async () => fakePool
  };
}

async function withMockedDb(rows, fn, dedicatedTables = {}) {
  const dbPath = require.resolve('../db');
  const recordStorePath = require.resolve('../lib/recordStore');
  // Xoá cache của CẢ '../db' lẫn 'lib/recordStore' (nếu 1 test trước đã require thật) để nạp lại sạch
  // với mock lần này — mỗi lần gọi withMockedDb() dùng 1 bộ "rows" độc lập.
  delete require.cache[dbPath];
  delete require.cache[recordStorePath];
  const fakeModule = new Module(dbPath, null);
  fakeModule.exports = buildFakeDbModule(rows, dedicatedTables);
  fakeModule.loaded = true;
  require.cache[dbPath] = fakeModule;
  const recordStore = require('../lib/recordStore');
  try {
    await fn(recordStore);
  } finally {
    delete require.cache[dbPath];
    delete require.cache[recordStorePath];
  }
}

(async () => {
  // 'submissions' đã chuyển sang bảng riêng dbo.Submissions (Bước 7) — insertRecord('submissions', ...)
  // giờ tự route sang insertDedicatedRecord(), sinh "INSERT INTO dbo.Submissions (...)" thay vì
  // "INSERT INTO dbo.Records (...)" — dùng dedicatedTables (KHÔNG có cột Collection) thay vì rows.
  await checkAsync('insertRecord(): 2 lần chèn liên tiếp cùng code cố định qua "route thật" (SQL mock, bảng riêng dbo.Submissions) -> cả 2 thành công, code tự tăng, không lỗi 409', async () => {
    const dedicatedTables = {};
    await withMockedDb([], async (recordStore) => {
      const rec1 = { id: 1001, code: 'HCRC-CNTT-VBT-050', title: 'A' };
      const saved1 = await recordStore.insertRecord('submissions', rec1);
      assert.strictEqual(saved1.code, 'HCRC-CNTT-VBT-050');

      // record 2 CỐ TÌNH gửi lên ĐÚNG code cố định trùng với record 1 (mô phỏng client stale/2 người tạo
      // gần như đồng thời) — id KHÁC (không đụng PK) nhưng Code đụng UX_Submissions_Code thật.
      const rec2 = { id: 1002, code: 'HCRC-CNTT-VBT-050', title: 'B' };
      const saved2 = await recordStore.insertRecord('submissions', rec2);
      assert.strictEqual(saved2.code, 'HCRC-CNTT-VBT-051');
      assert.notStrictEqual(saved1.code, saved2.code);
    }, dedicatedTables);
  });

  await checkAsync('insertRecord(): trùng Id (PK_Docs, bảng riêng dbo.Docs) -> tự sinh Id khác, KHÔNG đụng gì tới Code', async () => {
    const dedicatedTables = { Docs: [{ Id: 5000, Code: 'DOC-1', Payload: '{}' }] };
    await withMockedDb([], async (recordStore) => {
      const rec = { id: 5000, code: 'DOC-2', title: 'Trùng Id' };
      const saved = await recordStore.insertRecord('docs', rec);
      assert.notStrictEqual(saved.id, 5000);
      assert.strictEqual(saved.code, 'DOC-2');
    }, dedicatedTables);
  });

  await checkAsync('insertRecord(): code trùng KHÔNG có chữ số cuối -> ném 409 ngay, không retry mù', async () => {
    const rows = [{ Collection: 'carRegs', Id: 1, Code: 'KHONGCOSO', Payload: '{}' }];
    await withMockedDb(rows, async (recordStore) => {
      const rec = { id: 2, code: 'KHONGCOSO', title: 'X' };
      await assert.rejects(
        () => recordStore.insertRecord('carRegs', rec),
        (err) => err.status === 409 && /đã tồn tại/.test(err.message) && !/tự động sinh/.test(err.message)
      );
    });
  });

  await checkAsync('insertRecord(): vẫn trùng sau khi hết vòng lặp retry -> 409 kèm rõ "đã thử tự động sinh mã mới nhưng vẫn trùng"', async () => {
    const rows = [];
    const dbPath = require.resolve('../db');
    const recordStorePath = require.resolve('../lib/recordStore');
    delete require.cache[dbPath];
    delete require.cache[recordStorePath];
    // Mock ĐẶC BIỆT: INSERT luôn báo trùng Code (bất kể code là gì) để ép chạy hết 5 lần thử — mô phỏng
    // 1 "kẻ ganh đua" liên tục chiếm mất đúng số kế tiếp ngay trước khi ta kịp ghi (race thật liên tục).
    // 'submissions' -> bảng riêng dbo.Submissions (Bước 7) — mock lỗi KHÔNG chứa "PK_Submissions" nên
    // insertDedicatedRecord() hiểu đúng đây là trùng Code (không phải trùng Id) và tự sinh mã mới thử lại.
    const fakePool = {
      request() {
        const inputs = {};
        const reqObj = {
          input(name, _t, value) { inputs[name] = value; return reqObj; },
          async query(text) {
            if (/^INSERT INTO dbo\.\w+ \(/.test(text)) {
              const err = new Error(`Violation of UNIQUE KEY constraint 'UX_Submissions_Code'.`);
              err.number = 2627;
              throw err;
            }
            if (/^SELECT Payload FROM dbo\.\w+ ORDER BY CreatedAt DESC, Id DESC$/.test(text)) {
              return { recordset: [] };
            }
            throw new Error('Mock chưa hỗ trợ: ' + text);
          }
        };
        return reqObj;
      }
    };
    const fakeModule = new Module(dbPath, null);
    fakeModule.exports = { sql: { NVarChar: () => null, BigInt: 'BigInt', MAX: 'MAX', Int: 'Int', Bit: 'Bit', Date: 'Date' }, getPool: async () => fakePool };
    fakeModule.loaded = true;
    require.cache[dbPath] = fakeModule;
    const recordStore = require('../lib/recordStore');
    try {
      const rec = { id: 1, code: 'HCRC-CNTT-VBT-001', title: 'Y' };
      await assert.rejects(
        () => recordStore.insertRecord('submissions', rec),
        (err) => err.status === 409 && /vẫn trùng/.test(err.message)
      );
    } finally {
      delete require.cache[dbPath];
      delete require.cache[recordStorePath];
    }
  });

  console.log(`\n=== test-code-autogen-retry.js: ${pass} pass, ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
})();
