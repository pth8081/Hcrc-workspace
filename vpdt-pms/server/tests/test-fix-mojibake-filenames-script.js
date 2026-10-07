// tests/test-fix-mojibake-filenames-script.js — Test THẬT cho scripts/fix-mojibake-filenames.js (script
// vá dữ liệu CŨ đã lưu — người dùng báo kèm ảnh chụp thật, 10/2026: sau khi v25.45 đã chặn tên tệp MỚI
// không còn bị lỗi font, các bản ghi CŨ tạo trước khi server cập nhật code vẫn còn nguyên tên lỗi, VD
// "Test gia há°±n má»›i.xlsx" thay vì "Test gia hạn mới.xlsx", "261006 Test TÄ‚G.xlsx" thay vì "261006
// Test TĂG.xlsx"). Không test qua DB thật (sandbox không có SQL Server) — test trực tiếp 3 hàm thuần
// (walkAndFix/tryFixMojibake/looksLikeMojibakeCandidate) script export ra, với payload mirror ĐÚNG hình
// dạng thật của itPriceApprovals (files[]/extraFiles[].fileName) + employeeProfiles (cvFileName) +
// trường hợp tên ĐÃ ĐÚNG (không được đụng vào).
'use strict';
const { looksLikeMojibakeCandidate, tryFixMojibake, walkAndFix } = require('../scripts/fix-mojibake-filenames');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- ' + JSON.stringify(detail) : ''}`); }
}

// "Test gia hạn mới.xlsx" -> mis-decode latin1(UTF-8 bytes) -> chuỗi lỗi thật từ ảnh chụp người dùng.
const CORRUPTED_1 = Buffer.from('Test gia hạn mới.xlsx', 'utf8').toString('latin1');
const ORIGINAL_1 = 'Test gia hạn mới.xlsx';
const CORRUPTED_2 = Buffer.from('261006 Test TĂG.xlsx', 'utf8').toString('latin1');
const ORIGINAL_2 = '261006 Test TĂG.xlsx';

// ===== 1) looksLikeMojibakeCandidate =====
check('looksLikeMojibakeCandidate: chuỗi lỗi (mọi code point <=0xFF) -> true', looksLikeMojibakeCandidate(CORRUPTED_1) === true);
check('looksLikeMojibakeCandidate: chuỗi ĐÃ ĐÚNG tiếng Việt (code point >0xFF) -> false (không đụng vào)', looksLikeMojibakeCandidate(ORIGINAL_1) === false);
check('looksLikeMojibakeCandidate: chuỗi ASCII thuần -> true nhưng tryFixMojibake sẽ no-op (round-trip identity)', looksLikeMojibakeCandidate('Test KM.xlsx') === true);
check('looksLikeMojibakeCandidate: rỗng/không phải string -> false', looksLikeMojibakeCandidate('') === false && looksLikeMojibakeCandidate(null) === false && looksLikeMojibakeCandidate(123) === false);

// ===== 2) tryFixMojibake =====
check('LỖI ĐÃ VÁ: tryFixMojibake decode đúng "Test gia hạn mới.xlsx" từ chuỗi lỗi', tryFixMojibake(CORRUPTED_1) === ORIGINAL_1, tryFixMojibake(CORRUPTED_1));
check('LỖI ĐÃ VÁ: tryFixMojibake decode đúng "261006 Test TĂG.xlsx" từ chuỗi lỗi', tryFixMojibake(CORRUPTED_2) === ORIGINAL_2, tryFixMojibake(CORRUPTED_2));
check('An toàn: tryFixMojibake trả về null cho tên ASCII thuần (không có gì để sửa)', tryFixMojibake('Test KM.xlsx') === null);
check('An toàn: tryFixMojibake trả về null cho tên ĐÃ ĐÚNG tiếng Việt (không sửa nhầm)', tryFixMojibake(ORIGINAL_1) === null);
check('An toàn: tryFixMojibake trả về null cho chuỗi rỗng', tryFixMojibake('') === null);

// ===== 3) walkAndFix — mirror ĐÚNG payload thật itPriceApprovals (files[]/extraFiles[]) =====
const itemWholesale = {
  id: 1, code: 'IP-WS-001', priceType: 'WHOLESALE',
  files: [
    { id: 10, fileName: CORRUPTED_1, fileUrl: '/uploads/a.xlsx', uploadedByName: 'A' },
    { id: 11, fileName: '261006 Test TAG.xlsx', fileUrl: '/uploads/b.xlsx', uploadedByName: 'B' } // ASCII, không lỗi
  ],
  extraFiles: [
    { fileName: CORRUPTED_2, fileUrl: '/uploads/c.pdf' }
  ],
  reason: 'Biovegi' // KHÔNG được đụng vào (không phải field *fileName)
};
const changes1 = [];
walkAndFix(itemWholesale, changes1, '$');
check('walkAndFix: sửa đúng files[0].fileName (lỗi thật)', itemWholesale.files[0].fileName === ORIGINAL_1, itemWholesale.files[0].fileName);
check('walkAndFix: files[1].fileName ASCII giữ nguyên (không lỗi, không có gì sửa)', itemWholesale.files[1].fileName === '261006 Test TAG.xlsx');
check('walkAndFix: sửa đúng extraFiles[0].fileName', itemWholesale.extraFiles[0].fileName === ORIGINAL_2, itemWholesale.extraFiles[0].fileName);
check('walkAndFix: field KHÔNG phải *fileName (reason) không bị đụng vào', itemWholesale.reason === 'Biovegi');
check('walkAndFix: đúng 2 thay đổi được ghi nhận (files[0] + extraFiles[0])', changes1.length === 2, changes1);

// ===== 4) walkAndFix — mirror employeeProfiles (cvFileName, nested object không phải mảng) =====
const employeeProfile = {
  employeeCode: 'NV001',
  attachments: { cvFileName: CORRUPTED_1, cvFileUrl: '/uploads/cv.pdf' },
  bannerFileName: CORRUPTED_2
};
const changes2 = [];
walkAndFix(employeeProfile, changes2, '$');
check('walkAndFix: sửa đúng attachments.cvFileName (nested object)', employeeProfile.attachments.cvFileName === ORIGINAL_1, employeeProfile.attachments.cvFileName);
check('walkAndFix: cvFileUrl (không phải *fileName) không bị đụng vào', employeeProfile.attachments.cvFileUrl === '/uploads/cv.pdf');
check('walkAndFix: sửa đúng bannerFileName (field top-level)', employeeProfile.bannerFileName === ORIGINAL_2, employeeProfile.bannerFileName);

// ===== 5) walkAndFix — mảng record cấp cao nhất (mirror AppData employeeProfiles là 1 mảng) =====
const employeeProfilesList = [
  { employeeCode: 'NV001', cvFileName: CORRUPTED_1 },
  { employeeCode: 'NV002', cvFileName: ORIGINAL_1 } // đã đúng từ trước -> KHÔNG được đụng
];
const changes3 = [];
walkAndFix(employeeProfilesList, changes3, '$');
check('walkAndFix: xử lý đúng khi node gốc là MẢNG (AppData employeeProfiles)', employeeProfilesList[0].cvFileName === ORIGINAL_1);
check('walkAndFix: hồ sơ đã đúng từ trước giữ nguyên, không bị sửa lại', employeeProfilesList[1].cvFileName === ORIGINAL_1 && changes3.length === 1, changes3);

// ===== 6) Idempotent: chạy walkAndFix LẦN 2 trên dữ liệu đã sửa -> không còn gì để sửa =====
const changes4 = [];
walkAndFix(itemWholesale, changes4, '$');
check('Idempotent: chạy lại trên dữ liệu đã sửa không còn thay đổi gì', changes4.length === 0, changes4);

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
