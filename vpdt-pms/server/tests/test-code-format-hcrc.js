// tests/test-code-format-hcrc.js — Yêu cầu 4 (đợt "4 yêu cầu 1 khối"): định dạng mã tự sinh MỚI thống
// nhất "HCRC-<mã phòng>-<viết tắt module>-<số thứ tự>" (bỏ hẳn phần ngày) cho nhóm "7+1 module" dùng
// chung generateHcrcCode() ở public/js/module-tailieu.js. Nạp NGUYÊN VĂN file thật vào 1 sandbox qua vm
// (cùng khuôn tests/test-kpi-evaluator-config.js) rồi gọi lại ĐÚNG hàm thật — không chép lại thuật toán
// bằng tay, tránh test tự kiểm chứng chính giả định của nó thay vì kiểm chứng code thật.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.message}`); fail++; }
}

const MODULE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'module-tailieu.js'), 'utf8');

// Sandbox mới mỗi lần gọi (tránh state DB rò rỉ giữa các kịch bản) — chỉ cần các global mà nhóm hàm
// generate*Code() thực sự đụng tới: DB.<collection>/DB.deptAbbrs, document.getElementById(...).value,
// currentUser.dept, activeOfficeSubTab (Mua Bán/Sửa Chữa dùng chung 1 form).
// stripVnDiacritics() sống ở core.js (luôn nạp sẵn cùng module-tailieu.js trong app thật) — copy nguyên
// văn implementation (tiện ích thuần, không phải logic nghiệp vụ đang kiểm thử) vào sandbox vì vm chỉ
// nạp đúng 1 file module-tailieu.js.
function stripVnDiacritics(str) {
  return (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function makeSandbox({ DB, currentUser, fieldValues, activeOfficeSubTab }) {
  const elements = fieldValues || {};
  const ctx = {
    console,
    stripVnDiacritics,
    DB: Object.assign({
      submissions: [], carRegs: [], officeReqs: [], meetingMinutes: [], meetings: [],
      itPriceApprovals: [], itSupportTickets: [], licenses: [],
      deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {}
    }, DB || {}),
    currentUser: currentUser || { dept: 'Phòng Công Nghệ Thông Tin' },
    activeOfficeSubTab: activeOfficeSubTab || 'MUA_BAN',
    document: {
      getElementById: (id) => elements[id] !== undefined ? { value: elements[id] } : { value: '' }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(MODULE_SRC, ctx, { filename: 'module-tailieu.js' });
  return ctx;
}
function call(ctx, expr) { return vm.runInContext(expr, ctx); }

console.log('\nĐịnh dạng mã tự sinh mới: HCRC-<mã phòng>-<abbr module>-<số thứ tự> (không còn phần ngày)');

check('Văn Bản Trình (generateSubCode) — HCRC-<mã phòng đang chọn ở #subDept>-VBT-001 (chưa có bản ghi nào)', () => {
  const ctx = makeSandbox({ fieldValues: { subDept: 'Phòng Công Nghệ Thông Tin' } });
  const code = call(ctx, 'generateSubCode()');
  assert.strictEqual(code, 'HCRC-CNTT-VBT-001');
});

check('Văn Bản Trình — trình THAY MẶT phòng ban KHÁC (subDept khác currentUser.dept) -> mã phòng theo #subDept, KHÔNG theo currentUser.dept', () => {
  const ctx = makeSandbox({
    currentUser: { dept: 'Phòng Kế Toán' },
    fieldValues: { subDept: 'Phòng Công Nghệ Thông Tin' }
  });
  const code = call(ctx, 'generateSubCode()');
  assert.strictEqual(code, 'HCRC-CNTT-VBT-001');
});

check('Văn Bản Trình — số thứ tự tăng theo ĐÚNG số lớn nhất đã có cho CÙNG prefix (mã phòng+module)', () => {
  const ctx = makeSandbox({
    DB: { submissions: [{ code: 'HCRC-CNTT-VBT-001' }, { code: 'HCRC-CNTT-VBT-004' }, { code: 'HCRC-KT-VBT-099' }] },
    fieldValues: { subDept: 'Phòng Công Nghệ Thông Tin' }
  });
  const code = call(ctx, 'generateSubCode()');
  assert.strictEqual(code, 'HCRC-CNTT-VBT-005'); // KHÔNG bị lệch bởi prefix khác phòng (HCRC-KT-VBT-099)
});

check('Đăng Ký Xe (generateCarCode) — mã phòng theo #carDept đang chọn (KHÔNG forceOwnDept)', () => {
  const ctx = makeSandbox({ fieldValues: { carDept: 'Siêu Thị Quận 1' } });
  const code = call(ctx, 'generateCarCode()');
  assert.strictEqual(code, 'HCRC-STQ-DKX-001');
});

check('Mua Bán/Sửa Chữa/Đầu Tư (generateOfficeCode) — forceOwnDept -> currentUser.dept, viết tắt đổi theo activeOfficeSubTab', () => {
  const ctxMB = makeSandbox({ currentUser: { dept: 'Phòng Hành Chính' }, activeOfficeSubTab: 'MUA_BAN' });
  assert.strictEqual(call(ctxMB, 'generateOfficeCode()'), 'HCRC-HC-MB-001');
  const ctxSC = makeSandbox({ currentUser: { dept: 'Phòng Hành Chính' }, activeOfficeSubTab: 'SUA_CHUA' });
  assert.strictEqual(call(ctxSC, 'generateOfficeCode()'), 'HCRC-HC-SC-001');
});

check('Biên Bản Họp (generateMinutesCode) — không có ô chọn phòng ban trên form -> currentUser.dept', () => {
  const ctx = makeSandbox({ currentUser: { dept: 'Phòng Nhân Sự' } });
  const code = call(ctx, 'generateMinutesCode()');
  assert.strictEqual(code, 'HCRC-NS-BBH-001');
});

check('Đặt Phòng Họp (generateMeetingCode) — mã phòng theo #meetingDept đang chọn', () => {
  const ctx = makeSandbox({ fieldValues: { meetingDept: 'Phòng Kinh Doanh' } });
  const code = call(ctx, 'generateMeetingCode()');
  assert.strictEqual(code, 'HCRC-KD-DPH-001');
});

check('Phê Duyệt Giá IT (generateItPriceCode) — forceOwnDept -> currentUser.dept', () => {
  const ctx = makeSandbox({ currentUser: { dept: 'Phòng Công Nghệ Thông Tin' } });
  const code = call(ctx, 'generateItPriceCode()');
  assert.strictEqual(code, 'HCRC-CNTT-ITPG-001');
});

check('Ticket Hỗ Trợ IT (generateItTicketCode) — forceOwnDept -> currentUser.dept', () => {
  const ctx = makeSandbox({ currentUser: { dept: 'Phòng Công Nghệ Thông Tin' } });
  const code = call(ctx, 'generateItTicketCode()');
  assert.strictEqual(code, 'HCRC-CNTT-ITHT-001');
});

check('KHÔNG còn phần ngày tạo (YYYYMMDD) trong bất kỳ mã nào ở nhóm 7 module này', () => {
  const ctx = makeSandbox({ fieldValues: { subDept: 'Phòng Công Nghệ Thông Tin', carDept: 'Phòng Công Nghệ Thông Tin', meetingDept: 'Phòng Công Nghệ Thông Tin' } });
  const codes = [
    call(ctx, 'generateSubCode()'), call(ctx, 'generateCarCode()'), call(ctx, 'generateOfficeCode()'),
    call(ctx, 'generateMinutesCode()'), call(ctx, 'generateMeetingCode()'),
    call(ctx, 'generateItPriceCode()'), call(ctx, 'generateItTicketCode()')
  ];
  for (const c of codes) assert.ok(!/\d{8}/.test(c), `mã "${c}" vẫn còn vẻ như chứa 1 cụm 8 chữ số (ngày cũ)`);
});

// getDeptAbbr()/deriveAbbr() TỰ suy viết tắt khi admin chưa cấu hình DB.deptAbbrs — "Siêu Thị Quận 1" ->
// "STQ1" (bỏ dấu, lấy chữ cái đầu mỗi từ, giữ số) — xác nhận qua chính hàm thật, không chép lại thuật toán.
check('getDeptAbbr() tự suy viết tắt khi admin CHƯA cấu hình DB.deptAbbrs (dùng bởi mọi hàm trên)', () => {
  const ctx = makeSandbox({});
  assert.strictEqual(call(ctx, "getDeptAbbr('Phòng Công Nghệ Thông Tin')"), 'CNTT');
});

check('getDeptAbbr() ƯU TIÊN giá trị admin đã cấu hình sẵn trong DB.deptAbbrs (không tự suy)', () => {
  const ctx = makeSandbox({ DB: { deptAbbrs: { 'Phòng Công Nghệ Thông Tin': 'IT' } } });
  assert.strictEqual(call(ctx, "getDeptAbbr('Phòng Công Nghệ Thông Tin')"), 'IT');
});

console.log(`\n=== test-code-format-hcrc.js: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
