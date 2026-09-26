// Kiểm tra tĩnh (không cần Playwright/SQL): mọi key trong server/defaults.js (DEFAULTS, = toàn bộ
// VALID_KEYS của route GET/POST /api/data) phải có 1 dòng đọc lại tương ứng trong initDatabase()
// (server/public/js/core.js) — nếu không, dữ liệu ĐÃ LƯU ĐÚNG trên server sẽ "biến mất" trên giao diện
// sau F5 (DB.<key> = undefined), và thao tác sửa tiếp theo có nguy cơ ghi đè xoá sạch dữ liệu cũ.
//
// Đây CHÍNH XÁC là lỗi đã lặp lại ≥6 lần trong lịch sử repo (quickApplyConfigs, carVehicleTypes,
// workflowParticipatingPositions, contractApprovalGroups, storeTypes, operationOrderStoreMixedApprovalRules)
// — mỗi lần đều do thêm 1 tính năng mới có POST /api/data/<key> nhưng quên nối vào initDatabase().
// Test này KHÔNG chạy code thật (không cần server/SQL), chỉ soát chuỗi ký tự trong 2 file nguồn.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

const defaultsSrc = fs.readFileSync(path.join(__dirname, '../defaults.js'), 'utf8');
const coreSrc = fs.readFileSync(path.join(__dirname, '../public/js/core.js'), 'utf8');

// Lấy DEFAULTS bằng cách require() thật (an toàn — defaults.js không có side-effect, chỉ export object).
const { DEFAULTS } = require('../defaults.js');
const allKeys = Object.keys(DEFAULTS);
ok('defaults.js export được >= 70 key (sanity check, tránh parse nhầm object rỗng)', allKeys.length >= 70,
  `chỉ thấy ${allKeys.length} key`);

// Danh sách key CỐ Ý không đi qua initDatabase()/DB.* — có route/luồng riêng, không phải qua GET /api/data
// blob chung (đã xác nhận qua khảo sát 9/2026, KHÔNG phải bug). Thêm key mới vào đây CHỈ KHI đã xác minh
// rõ ràng nó có đường load riêng (route riêng hẳn, không qua initDatabase()) — không thêm để "cho qua" test.
const INTENTIONALLY_EXEMPT = new Set([
  'diskSpaceMonitorState',      // chỉ dùng nội bộ server (jobs/diskSpaceMonitor.js), không có UI client
  'orgChartVersions',           // route riêng routes/orgChart.js, client fetch riêng
  'employeeProfiles',           // SENSITIVE_KEYS_BLOCKED_FROM_GENERIC_DATA_ROUTE, route riêng routes/employeeProfile.js
  'hrProfileManagerVisibleFields', // trả kèm trong GET/PATCH /api/hr-profile/me, không qua DB.* blob
  'hrProfileSelfVisibleFields',
  'payrollRateConfig',          // đọc thẳng phía server trong routes/payroll.js, không qua DB.* client
]);

const missing = [];
for (const key of allKeys) {
  if (INTENTIONALLY_EXEMPT.has(key)) continue;
  // Chấp nhận 2 khuôn: gán trực tiếp `DB.<key> =` trong initDatabase(), hoặc nạp qua nhóm lazy-load
  // (assignLazyGroupField('<key>', ...) hoặc chuỗi '<key>' xuất hiện trong TAB_DATA_GROUPS/tương đương).
  const directAssign = new RegExp(`DB\\.${key}\\s*=`).test(coreSrc);
  const lazyGroupRef = new RegExp(`['"\`]${key}['"\`]`).test(coreSrc) && /assignLazyGroupField|TAB_DATA_GROUPS/.test(coreSrc);
  if (!directAssign && !lazyGroupRef) missing.push(key);
}

ok('mọi key trong defaults.js (trừ danh sách exempt có lý do rõ ràng) đều được initDatabase() đọc lại',
  missing.length === 0,
  missing.length ? `THIẾU: ${missing.join(', ')} — sẽ mất dữ liệu hiển thị sau F5, xem lỗi storeTypes/operationOrderStoreMixedApprovalRules đã vá làm mẫu` : '');

// Chốt chặn cụ thể cho 2 lỗi vừa vá (10/2026) — không dựa hoàn toàn vào vòng lặp ở trên, phòng khi có
// người sửa lại regex tổng quát mà quên giữ đúng 2 trường hợp cụ thể này.
ok('DB.storeTypes được gán từ data.storeTypes trong initDatabase()',
  /DB\.storeTypes\s*=\s*data\.storeTypes/.test(coreSrc));
ok('DB.operationOrderStoreMixedApprovalRules được gán từ data.operationOrderStoreMixedApprovalRules trong initDatabase()',
  /DB\.operationOrderStoreMixedApprovalRules\s*=[\s\S]{0,80}data\.operationOrderStoreMixedApprovalRules/.test(coreSrc));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
