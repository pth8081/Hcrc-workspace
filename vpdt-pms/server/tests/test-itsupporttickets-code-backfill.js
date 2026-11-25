// server/tests/test-itsupporttickets-code-backfill.js
//
// Test cho scripts/backfill-itsupporttickets-code.js (11/2026, theo yêu cầu TRỰC TIẾP người dùng kèm ảnh
// chụp thật — ticket Hỗ Trợ IT tạo từ Onboarding/Offboarding thiếu "Mã Yêu Cầu" vĩnh viễn trên dữ liệu
// ĐÃ CÓ, cần script 1 lần vá dữ liệu PRODUCTION đang live, mirror ĐÚNG khuôn test-checklist-required-
// bulk-toggle.js Phần A/testScriptDbScope() — stub '../db'/'../lib/recordStore'/'../lib/appData' bằng
// fakePool + ghi lại mọi UPDATE để kiểm tra, không cần SQL Server thật.
//
// Chạy: node server/tests/test-itsupporttickets-code-backfill.js
'use strict';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

async function main() {
  const dbPath = require.resolve('../db');
  const recordStorePath = require.resolve('../lib/recordStore');
  const appDataPath = require.resolve('../lib/appData');
  const scriptPath = require.resolve('../scripts/backfill-itsupporttickets-code');

  // Dữ liệu giả: 2 ticket Id=1/Id=3 CÙNG Phòng Ban "Phòng Công Nghệ Thông Tin" THIẾU Code (mô phỏng
  // đúng 3 ticket Onboarding trong ảnh người dùng gửi), 1 ticket Id=2 (dept KHÁC) ĐÃ CÓ Code từ trước
  // (KHÔNG được đụng lại), 1 ticket Id=4 Payload lỗi (KHÔNG được làm crash cả script).
  const rows = [
    { Id: 1, Code: null, Dept: 'Phòng Công Nghệ Thông Tin', Payload: JSON.stringify({ title: '[Onboarding] Tạo email công ty & tài khoản VPDT — A', dept: 'Phòng Công Nghệ Thông Tin' }) },
    { Id: 2, Code: 'HCRC-NSHCPC-ITHT-002', Dept: 'Phòng Nhân Sự', Payload: JSON.stringify({ title: 'Ticket thường, đã có Code', dept: 'Phòng Nhân Sự', code: 'HCRC-NSHCPC-ITHT-002' }) },
    { Id: 3, Code: null, Dept: 'Phòng Công Nghệ Thông Tin', Payload: JSON.stringify({ title: '[Onboarding] Tạo email công ty & tài khoản VPDT — B', dept: 'Phòng Công Nghệ Thông Tin' }) },
    { Id: 4, Code: null, Dept: 'Phòng Công Nghệ Thông Tin', Payload: '{không phải JSON hợp lệ' }
  ];
  const updates = [];
  const fakePool = {
    request() {
      const inputs = {};
      return {
        input(name, type, value) { inputs[name] = value; return this; },
        async query(sqlText) {
          if (/SELECT Id, Code, Dept, Payload FROM/.test(sqlText)) {
            return { recordset: rows.map(r => ({ ...r })) };
          }
          if (/UPDATE .* SET Code = @code, Payload = @payload/.test(sqlText)) {
            updates.push({ id: inputs.id, code: inputs.code, payload: JSON.parse(inputs.payload) });
            return {};
          }
          throw new Error('Mock chưa hỗ trợ câu lệnh: ' + sqlText);
        }
      };
    },
    close: async () => {}
  };

  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getPool: async () => fakePool, sql: { BigInt: 'BigInt', NVarChar: (n) => `NVarChar(${n})`, MAX: 'MAX' } } };
  require.cache[recordStorePath] = { id: recordStorePath, filename: recordStorePath, loaded: true, exports: { dedicatedTableName: (c) => `dbo.${c === 'itSupportTickets' ? 'ItSupportTickets' : c}` } };
  require.cache[appDataPath] = { id: appDataPath, filename: appDataPath, loaded: true, exports: { getAppDataValue: async (key) => (key === 'deptAbbrs' ? { 'Phòng Công Nghệ Thông Tin': 'CNTT' } : null) } };

  // ===== Dry-run (không --confirm): KHÔNG ghi UPDATE nào =====
  const origArgv = process.argv;
  process.argv = ['node', 'script'];
  delete require.cache[scriptPath];
  const { main: scriptMain } = require('../scripts/backfill-itsupporttickets-code');
  await scriptMain();
  check('Dry-run: KHÔNG ghi UPDATE nào xuống DB', updates.length === 0, updates);
  process.argv = origArgv;

  // ===== --confirm: ghi ĐÚNG 2 ticket thiếu Code (Id=1, Id=3), BỎ QUA Id=2 (đã có Code) và Id=4 (Payload lỗi) =====
  process.argv = ['node', 'script', '--confirm'];
  delete require.cache[scriptPath];
  const { main: scriptMainConfirm } = require('../scripts/backfill-itsupporttickets-code');
  await scriptMainConfirm();
  check('--confirm: ghi ĐÚNG 2 UPDATE (Id=1 và Id=3), KHÔNG đụng Id=2/Id=4', updates.length === 2 && updates.every(u => u.id === 1 || u.id === 3), updates);

  const u1 = updates.find(u => u.id === 1);
  const u3 = updates.find(u => u.id === 3);
  check('Id=1: Code đúng khuôn HCRC-CNTT-ITHT-001 (số thứ tự đầu tiên cho Phòng Ban này)', u1 && u1.code === 'HCRC-CNTT-ITHT-001', u1);
  check('Id=3: Code đúng khuôn HCRC-CNTT-ITHT-002 (tiếp nối ĐÚNG số thứ tự vừa gán ở Id=1, KHÔNG trùng)', u3 && u3.code === 'HCRC-CNTT-ITHT-002', u3);
  check('Id=1: Payload ghi lại có field code khớp đúng Code SQL', u1 && u1.payload.code === u1.code, u1);
  check('Id=3: Payload ghi lại có field code khớp đúng Code SQL', u3 && u3.payload.code === u3.code, u3);
  check('Payload các field KHÁC (title/dept) giữ nguyên, không bị đụng', u1 && u1.payload.title === '[Onboarding] Tạo email công ty & tài khoản VPDT — A' && u1.payload.dept === 'Phòng Công Nghệ Thông Tin', u1 && u1.payload);
  process.argv = origArgv;

  // ===== Idempotent: chạy lại --confirm lần 2 trên state ĐÃ backfill (rows[0]/rows[2] giờ coi như đã có Code) =====
  rows[0].Code = u1.code; rows[0].Payload = JSON.stringify(u1.payload);
  rows[2].Code = u3.code; rows[2].Payload = JSON.stringify(u3.payload);
  updates.length = 0;
  process.argv = ['node', 'script', '--confirm'];
  delete require.cache[scriptPath];
  const { main: scriptMainConfirm2 } = require('../scripts/backfill-itsupporttickets-code');
  await scriptMainConfirm2();
  check('Idempotent: chạy lại lần 2 sau khi đã backfill -> KHÔNG ghi UPDATE nào nữa', updates.length === 0, updates);
  process.argv = origArgv;

  delete require.cache[dbPath];
  delete require.cache[recordStorePath];
  delete require.cache[appDataPath];
  delete require.cache[scriptPath];

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
