// tests/test-recordstore-renamefieldvalue-dedicated.js — Regression cho lỗi THẬT phát hiện trên
// production (11/2026): bấm "✏️ Sửa Mã NV" (đổi employeeCode) báo "Đã có lỗi xảy ra" — log server thật
// cho thấy "Invalid column name 'Code'." khi cascadeEmployeeCodeRename() gọi
// renameFieldValueInCollection('leaveBalances', ...) (và 5 collection hasCode:false khác: leaveRequests,
// shiftRoster, shiftSwapRequests, attendanceRecords, hrProcesses).
//
// NGUYÊN NHÂN: renameFieldValueInCollection() (lib/recordStore.js) viết cứng
// "SELECT Id, Payload, Code FROM ${table} WITH (UPDLOCK, HOLDLOCK)" — bảng nào có cfg.hasCode=false
// (VD dbo.LeaveBalances, xem sql/schema.sql) THẬT SỰ KHÔNG CÓ cột "Code" -> SQL Server ném lỗi parse
// NGAY LẬP TỨC (trước khi lọc theo điều kiện nào), bất kể collection đó có khớp dòng nào hay không.
// Đây là lỗi tồn tại SẴN trong hàm dùng chung (không riêng employeeCode) — chỉ chưa bị lộ ra vì trước
// "✏️ Sửa Mã NV" (v30.73), chưa có cascade nào từng gọi renameFieldValueInCollection() trên 1 bảng
// hasCode:false (DEPT_FIELD_COLLECTIONS/STORE_FIELD_COLLECTIONS tình cờ chỉ đụng toàn bảng hasCode:true,
// trừ operationExecutionPeriods — khả năng cao chưa ai đổi tên phòng ban nào khớp dữ liệu bảng đó từ khi
// thêm vào, nên chưa lộ ra).
//
// ĐÃ VÁ (lib/recordStore.js dòng ~1446): đổi thành
// `SELECT Id, Payload, ${cfg.hasCode ? 'Code' : 'NULL AS Code'} FROM ...` — đúng khuôn ĐÃ CÓ SẴN ở
// moveDedicatedRecordToTrash() (dòng ~897), chỉ là renameFieldValueInCollection() bị bỏ sót lúc viết.
//
// Test này KHÔNG stub renameFieldValueInCollection() như các test cascade khác (sẽ không bao giờ bắt
// được lỗi SQL-string này) — mock THẲNG module '../db' (mssql) để mô phỏng trung thực: bảng hasCode:false
// ném lỗi "Invalid column name 'Code'" nếu câu SELECT/UPDATE lỡ tham chiếu cột "Code" thật (đúng hành vi
// SQL Server thật), cùng khuôn withMockedDb() đã có ở tests/test-code-autogen-retry.js.
'use strict';
const assert = require('assert');
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

// schemas: { TableName: { hasCode: bool, rows: [{Id, Code, Payload, ...extractedCols}] } }
function buildFakeDbModule(schemas) {
  function invalidColumnError(colName) {
    const err = new Error(`Invalid column name '${colName}'.`);
    err.number = 207; // mã lỗi thật của SQL Server cho "Invalid column name"
    return err;
  }
  const fakePool = {
    request() {
      const inputs = {};
      const reqObj = {
        input(name, _type, value) { inputs[name] = value; return reqObj; },
        async query(text) {
          let m;
          // SELECT Id, Payload, Code|NULL AS Code FROM dbo.<Table> WITH (UPDLOCK, HOLDLOCK)
          if ((m = /^SELECT Id, Payload, (Code|NULL AS Code) FROM dbo\.(\w+) WITH \(UPDLOCK, HOLDLOCK\)$/.exec(text))) {
            const [, codeExpr, tableName] = m;
            const schema = schemas[tableName];
            if (!schema) throw new Error('Mock thiếu schema cho bảng: ' + tableName);
            if (codeExpr === 'Code' && !schema.hasCode) throw invalidColumnError('Code');
            return { recordset: schema.rows.map(r => ({ ...r, Code: schema.hasCode ? r.Code : null })) };
          }
          // UPDATE dbo.<Table> SET Payload = @payload[, Code = @code][, <Col> = @<param>] WHERE Id = @id
          if ((m = /^UPDATE dbo\.(\w+) SET (.+) WHERE Id = @id$/.exec(text))) {
            const tableName = m[1];
            const schema = schemas[tableName];
            if (!schema) throw new Error('Mock thiếu schema cho bảng: ' + tableName);
            if (/\bCode = @code\b/.test(m[2]) && !schema.hasCode) throw invalidColumnError('Code');
            const row = schema.rows.find(r => r.Id === inputs.id);
            if (!row) throw new Error('Mock: không tìm thấy Id để UPDATE: ' + inputs.id);
            row.Payload = inputs.payload;
            if (schema.hasCode && inputs.code !== undefined) row.Code = inputs.code;
            for (const colName of Object.keys(inputs)) {
              if (colName === 'id' || colName === 'payload' || colName === 'code') continue;
              // input name khớp đúng tên cột viết thường (bindExtractedColumns dùng param = tên cột lowercase)
              const matchCol = Object.keys(row).find(k => k.toLowerCase() === colName.toLowerCase());
              if (matchCol) row[matchCol] = inputs[colName];
            }
            return { recordset: [] };
          }
          throw new Error('Mock chưa hỗ trợ câu lệnh: ' + text);
        }
      };
      return reqObj;
    }
  };
  return {
    sql: {
      NVarChar: () => null, BigInt: 'BigInt', MAX: 'MAX', Int: 'Int', Bit: 'Bit', Date: 'Date', SmallInt: 'SmallInt', TinyInt: 'TinyInt',
      Transaction: class { constructor() {} async begin() {} async commit() {} async rollback() {} },
      Request: class { constructor() { return fakePool.request(); } }
    },
    getPool: async () => fakePool
  };
}

async function withMockedDb(schemas, fn) {
  const dbPath = require.resolve('../db');
  const recordStorePath = require.resolve('../lib/recordStore');
  delete require.cache[dbPath];
  delete require.cache[recordStorePath];
  const fakeModule = new Module(dbPath, null);
  fakeModule.exports = buildFakeDbModule(schemas);
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
  console.log('\n[renameFieldValueInCollection] Bảng hasCode:FALSE (VD LeaveBalances) — KHÔNG được đụng cột Code');
  await checkAsync('hasCode:false — đổi field thành công, không ném "Invalid column name \'Code\'"', async () => {
    const schemas = {
      LeaveBalances: {
        hasCode: false,
        rows: [
          { Id: 1, Payload: JSON.stringify({ id: 1, employeeCode: 'BL 3900', year: 2026 }), EmployeeCode: 'BL 3900', Year: 2026 },
          { Id: 2, Payload: JSON.stringify({ id: 2, employeeCode: 'NV0099', year: 2026 }), EmployeeCode: 'NV0099', Year: 2026 }
        ]
      }
    };
    await withMockedDb(schemas, async (recordStore) => {
      const changed = await recordStore.renameFieldValueInCollection('leaveBalances', (item) => {
        if (item.employeeCode !== 'BL 3900') return item;
        return { ...item, employeeCode: 'BL3900' };
      });
      assert.strictEqual(changed, 1);
      const updatedPayload = JSON.parse(schemas.LeaveBalances.rows[0].Payload);
      assert.strictEqual(updatedPayload.employeeCode, 'BL3900');
      assert.strictEqual(schemas.LeaveBalances.rows[0].EmployeeCode, 'BL 3900', 'EmployeeCode không nằm trong fields cascade của test này — không bị đụng (chỉ Payload đổi)');
    });
  });

  await checkAsync('hasCode:false — 0 dòng khớp vẫn chạy được (không ném lỗi SELECT ngay cả khi không có gì để đổi)', async () => {
    const schemas = {
      ShiftSwapRequests: {
        hasCode: false,
        rows: [{ Id: 10, Payload: JSON.stringify({ id: 10, requesterEmployeeCode: 'NV01', targetEmployeeCode: 'NV02' }) }]
      }
    };
    await withMockedDb(schemas, async (recordStore) => {
      const changed = await recordStore.renameFieldValueInCollection('shiftSwapRequests', (item) => item);
      assert.strictEqual(changed, 0);
    });
  });

  console.log('\n[renameFieldValueInCollection] Bảng hasCode:TRUE (VD Payslips) — vẫn cập nhật đúng cột Code khi payload.code đổi theo');
  await checkAsync('hasCode:true — Code cột SQL vẫn đồng bộ đúng theo payload.code mới', async () => {
    const schemas = {
      Payslips: {
        hasCode: true,
        rows: [{ Id: 1, Code: 'PL-P1-BL 3900', Payload: JSON.stringify({ id: 1, code: 'PL-P1-BL 3900', employeeCode: 'BL 3900' }) }]
      }
    };
    await withMockedDb(schemas, async (recordStore) => {
      const changed = await recordStore.renameFieldValueInCollection('payslips', (item) => ({ ...item, employeeCode: 'BL3900' }));
      assert.strictEqual(changed, 1);
      const updatedPayload = JSON.parse(schemas.Payslips.rows[0].Payload);
      assert.strictEqual(updatedPayload.employeeCode, 'BL3900');
      // Code cũ (gắn mã cũ trong lịch sử) KHÔNG đổi vì mutateFn ở test này không đổi payload.code —
      // đúng triết lý "không đụng chuỗi mã đã sinh sẵn trong lịch sử" đã áp dụng ở cascadeEmployeeCodeRename().
      assert.strictEqual(schemas.Payslips.rows[0].Code, 'PL-P1-BL 3900');
    });
  });

  console.log(`\n=== test-recordstore-renamefieldvalue-dedicated.js: ${pass} pass, ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
})();
