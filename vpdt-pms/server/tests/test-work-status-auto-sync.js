// tests/test-work-status-auto-sync.js — Regression cho lỗ hổng THẬT người dùng phát hiện (11/2026, qua
// Báo Cáo Định Biên Nhân Sự): "Tình trạng làm việc hiện tại (chi tiết)" = Nghỉ thai sản KHÔNG lên được
// cột "Thai Sản/Nghỉ Ốm" vì field này (currentWorkStatusDetail) trước đây HOÀN TOÀN ĐỘC LẬP với
// profile.status (ACTIVE/ON_LEAVE — field báo cáo định biên THẬT SỰ đếm theo, xem lib/headcountReport.js).
//
// Phạm vi:
//   1. applyProfileEdit(): chọn currentWorkStatusDetail thuộc nhóm AUTO_ON_LEAVE_WORK_STATUS_DETAILS
//      ('Nghỉ thai sản'/'Nghỉ ốm dài ngày'/'Không lương') khi status=ACTIVE -> TỰ chuyển ON_LEAVE + set
//      cờ workStatusAutoSetLeave=true.
//   2. Đổi detail sang giá trị KHÁC (hoặc xoá) trong khi cờ đang bật -> TỰ trả về ACTIVE + xoá cờ.
//   3. Hồ sơ ĐÃ ON_LEAVE (status khác ACTIVE, dù lý do gì) -> set detail vào nhóm trên KHÔNG đụng gì
//      status/cờ (không override hiện trạng không phải ACTIVE).
//   4. PATCH /api/hr-profile/by-code/:code/status (đổi tay) LUÔN xoá cờ workStatusAutoSetLeave, dù đổi
//      sang chiều nào — tay luôn thắng tự động.
//   5. autoRevertExpiredWorkStatusLeaves(): hồ sơ ON_LEAVE+cờ bật+currentWorkStatusTo đã qua -> tự trả về
//      ACTIVE + xoá cờ; cờ TẮT (HR tự set tay) dù hết hạn vẫn KHÔNG bị đụng; còn hạn (currentWorkStatusTo
//      >= hôm nay) hoặc không có "Đến ngày" (mở) -> giữ nguyên ON_LEAVE.
//   6. Tích hợp đầu-cuối: headcountReport.computeHeadcountReport() đếm đúng "onLeave" cho hồ sơ được tự
//      động chuyển (không cần test lại công thức breakdown — đã có test-orgchart-headcount-breakdown-
//      columns.js riêng, ở đây chỉ xác nhận ĐƯỜNG DẪN từ currentWorkStatusDetail -> status -> headcountReport
//      hoạt động đúng, đúng vấn đề người dùng phát hiện).
'use strict';
const assert = require('assert');
const employeeProfile = require('../lib/employeeProfile');
const { computeHeadcountReport } = require('../lib/headcountReport');
const orgChart = require('../lib/orgChart');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.message}`); fail++; }
}

function activeProfile(code) {
  const p = employeeProfile.defaultProfile(code);
  p.status = 'ACTIVE';
  return p;
}

console.log('\n[1] currentWorkStatusDetail thuộc nhóm tự động -> ACTIVE tự chuyển ON_LEAVE');
check('"Nghỉ thai sản" + status=ACTIVE -> status=ON_LEAVE, workStatusAutoSetLeave=true', () => {
  const p = activeProfile('BLAUTO001');
  employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: 'Nghỉ thai sản' }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });
  assert.strictEqual(p.status, 'ON_LEAVE');
  assert.strictEqual(p.workStatusAutoSetLeave, true);
  assert.strictEqual(p.currentWorkStatusDetail, 'Nghỉ thai sản');
});
check('"Nghỉ ốm dài ngày" + status=ACTIVE -> cũng tự chuyển ON_LEAVE', () => {
  const p = activeProfile('BLAUTO002');
  employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: 'Nghỉ ốm dài ngày' }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });
  assert.strictEqual(p.status, 'ON_LEAVE');
  assert.strictEqual(p.workStatusAutoSetLeave, true);
});
check('"Không lương" + status=ACTIVE -> cũng tự chuyển ON_LEAVE', () => {
  const p = activeProfile('BLAUTO003');
  employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: 'Không lương' }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });
  assert.strictEqual(p.status, 'ON_LEAVE');
  assert.strictEqual(p.workStatusAutoSetLeave, true);
});
check('"Hưu trí"/"HĐ thứ 2"/"Khác" KHÔNG thuộc nhóm tự động -> status GIỮ NGUYÊN ACTIVE', () => {
  for (const detail of ['Hưu trí', 'HĐ thứ 2', 'Khác']) {
    const p = activeProfile('BLAUTO004_' + detail);
    employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: detail }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });
    assert.strictEqual(p.status, 'ACTIVE', `detail="${detail}" không được tự chuyển ON_LEAVE`);
    assert.ok(!p.workStatusAutoSetLeave, `detail="${detail}" không được bật cờ tự động`);
  }
});

console.log('\n[2] Đổi detail sang giá trị KHÁC/xoá trong khi cờ đang bật -> tự trả về ACTIVE');
check('Đổi "Nghỉ thai sản" -> "Khác" (cờ đang bật) -> tự trả ACTIVE, xoá cờ', () => {
  const p = activeProfile('BLAUTO005');
  employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: 'Nghỉ thai sản' }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });
  assert.strictEqual(p.status, 'ON_LEAVE');
  employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: 'Khác' }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });
  assert.strictEqual(p.status, 'ACTIVE');
  assert.strictEqual(p.workStatusAutoSetLeave, false);
});
check('Xoá hẳn "Nghỉ thai sản" (set null, cờ đang bật) -> tự trả ACTIVE', () => {
  const p = activeProfile('BLAUTO006');
  employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: 'Nghỉ thai sản' }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });
  employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: '' }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });
  assert.strictEqual(p.status, 'ACTIVE');
  assert.strictEqual(p.currentWorkStatusDetail, null);
  assert.strictEqual(p.workStatusAutoSetLeave, false);
});
check('Lưu lại ĐÚNG giá trị cũ "Nghỉ thai sản" (không đổi) -> idempotent, vẫn ON_LEAVE, không lỗi', () => {
  const p = activeProfile('BLAUTO007');
  employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: 'Nghỉ thai sản' }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });
  employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: 'Nghỉ thai sản' }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });
  assert.strictEqual(p.status, 'ON_LEAVE');
  assert.strictEqual(p.workStatusAutoSetLeave, true);
});

console.log('\n[3] Hồ sơ ĐÃ không phải ACTIVE (status khác) -> KHÔNG tự đụng gì');
check('status=DRAFT + set detail "Nghỉ thai sản" -> status GIỮ NGUYÊN DRAFT, không tự bật cờ', () => {
  const p = employeeProfile.defaultProfile('BLAUTO008'); // status mặc định DRAFT
  employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: 'Nghỉ thai sản' }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });
  assert.strictEqual(p.status, 'DRAFT');
  assert.ok(!p.workStatusAutoSetLeave);
});
check('status=ON_LEAVE do HR tự bấm tay (cờ=false) + set detail "Nghỉ thai sản" -> vẫn ON_LEAVE, cờ KHÔNG tự bật', () => {
  const p = activeProfile('BLAUTO009');
  p.status = 'ON_LEAVE'; // mô phỏng HR đã tự bấm tay TRƯỚC đó (không qua detail)
  employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: 'Nghỉ thai sản' }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });
  assert.strictEqual(p.status, 'ON_LEAVE');
  assert.ok(!p.workStatusAutoSetLeave, 'Không tự bật cờ vì status lúc vào case không phải ACTIVE (đã ON_LEAVE sẵn)');
});

console.log('\n[4] autoRevertExpiredWorkStatusLeaves() — job hằng ngày');
check('ON_LEAVE + cờ bật + currentWorkStatusTo ĐÃ QUA -> tự trả ACTIVE + xoá cờ', () => {
  const p = activeProfile('BLAUTO010');
  employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: 'Nghỉ thai sản' }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });
  p.currentWorkStatusTo = '2020-01-01'; // chắc chắn đã qua
  const reverted = employeeProfile.autoRevertExpiredWorkStatusLeaves([p]);
  assert.deepStrictEqual(reverted, [p.employeeCode]);
  assert.strictEqual(p.status, 'ACTIVE');
  assert.strictEqual(p.workStatusAutoSetLeave, false);
});
check('ON_LEAVE + cờ bật + currentWorkStatusTo CÒN HẠN (tương lai xa) -> GIỮ NGUYÊN ON_LEAVE', () => {
  const p = activeProfile('BLAUTO011');
  employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: 'Nghỉ thai sản' }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });
  p.currentWorkStatusTo = '2099-01-01';
  const reverted = employeeProfile.autoRevertExpiredWorkStatusLeaves([p]);
  assert.deepStrictEqual(reverted, []);
  assert.strictEqual(p.status, 'ON_LEAVE');
});
check('ON_LEAVE + cờ bật + KHÔNG có currentWorkStatusTo (mở, không hạn) -> GIỮ NGUYÊN ON_LEAVE', () => {
  const p = activeProfile('BLAUTO012');
  employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: 'Không lương' }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });
  assert.strictEqual(p.currentWorkStatusTo, null);
  const reverted = employeeProfile.autoRevertExpiredWorkStatusLeaves([p]);
  assert.deepStrictEqual(reverted, []);
  assert.strictEqual(p.status, 'ON_LEAVE');
});
check('ON_LEAVE do HR tự bấm tay (cờ=false/không set) dù currentWorkStatusTo đã qua -> KHÔNG đụng (tay thắng)', () => {
  const p = activeProfile('BLAUTO013');
  p.status = 'ON_LEAVE';
  p.currentWorkStatusTo = '2020-01-01';
  const reverted = employeeProfile.autoRevertExpiredWorkStatusLeaves([p]);
  assert.deepStrictEqual(reverted, []);
  assert.strictEqual(p.status, 'ON_LEAVE');
});
check('status=ACTIVE (không phải ON_LEAVE) -> bỏ qua dù có currentWorkStatusTo đã qua + cờ (dữ liệu rác giả định)', () => {
  const p = activeProfile('BLAUTO014');
  p.workStatusAutoSetLeave = true; // dữ liệu rác giả định, không nên xảy ra thật nhưng vẫn test an toàn
  p.currentWorkStatusTo = '2020-01-01';
  const reverted = employeeProfile.autoRevertExpiredWorkStatusLeaves([p]);
  assert.deepStrictEqual(reverted, []);
  assert.strictEqual(p.status, 'ACTIVE');
});
check('Nhiều hồ sơ cùng lúc, chỉ đúng những hồ sơ đủ điều kiện mới bị đổi', () => {
  const p1 = activeProfile('BLAUTO015');
  employeeProfile.applyProfileEdit(p1, { currentWorkStatusDetail: 'Nghỉ thai sản' }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });
  p1.currentWorkStatusTo = '2020-01-01'; // hết hạn -> bị đổi
  const p2 = activeProfile('BLAUTO016');
  employeeProfile.applyProfileEdit(p2, { currentWorkStatusDetail: 'Nghỉ thai sản' }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });
  p2.currentWorkStatusTo = '2099-01-01'; // còn hạn -> KHÔNG đổi
  const reverted = employeeProfile.autoRevertExpiredWorkStatusLeaves([p1, p2]);
  assert.deepStrictEqual(reverted, [p1.employeeCode]);
  assert.strictEqual(p1.status, 'ACTIVE');
  assert.strictEqual(p2.status, 'ON_LEAVE');
});

console.log('\n[5] Tích hợp: headcountReport.computeHeadcountReport() đếm đúng "onLeave" sau khi tự động chuyển');
check('Hồ sơ tự chuyển ON_LEAVE qua currentWorkStatusDetail -> headcountReport đếm vào cột Thai Sản/Nghỉ Ốm (đúng vấn đề người dùng phát hiện)', () => {
  const v = { id: 1, versionName: 'Test', status: 'DRAFT', nodes: [], kpiFlow: [] };
  const root = orgChart.addNode(v, { parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty' });
  const posBanHang = orgChart.addNode(v, { parentNodeId: root.nodeId, nodeType: 'POSITION', jobTitle: 'Nhân viên bán hàng', headcountQuota: 2 });

  const p = activeProfile('BLAUTO017');
  p.positionKey = posBanHang.positionKey;
  // Trước khi vá: HR chỉ điền detail, KHÔNG tự bấm chuyển trạng thái -> status vẫn ACTIVE -> headcountReport
  // KHÔNG đếm được vào "onLeave" (đúng bug thật người dùng phát hiện qua ảnh "BL3021/BL713/...").
  employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: 'Nghỉ thai sản' }, ['currentWorkStatusDetail'], 'hr1', 'HR', { skipHistory: true });

  const { rows } = computeHeadcountReport(v, [p], [], []);
  const rBanHang = rows.find(r => r.nodeId === posBanHang.nodeId);
  assert.strictEqual(rBanHang.onLeave, 1, 'Sau khi vá: tự chuyển ON_LEAVE -> headcountReport đếm đúng 1 người vào cột Thai Sản/Nghỉ Ốm');
  assert.strictEqual(rBanHang.active, 0);
  assert.strictEqual(rBanHang.actualTotal, 1);
});

console.log(`\n=== test-work-status-auto-sync.js: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
