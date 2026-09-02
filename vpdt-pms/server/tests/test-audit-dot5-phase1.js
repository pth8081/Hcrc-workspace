// server/tests/test-audit-dot5-phase1.js
//
// Regression test cho Giai đoạn 1 của Audit Đợt 5 (rà soát bảo mật toàn diện):
//   - lib/recordViewScope.js sanitizeUsersPermsForViewer() — ẩn perms/permOverrides/groupIds của
//     NGƯỜI KHÁC khỏi GET /api/data cho viewer không phải admin, giữ nguyên cho admin và cho chính
//     bản ghi của người gọi.
//   - lib/recordViewScope.js computeModuleApproverUsernames() — danh sách username giữ 1 cờ quyền
//     phê duyệt cụ thể (meetingApprove/internalPostApprove/itPriceEmergencyRejectApprove/
//     licenseApprove), tính từ perms ĐẦY ĐỦ trước khi bị ẩn, để client vẫn dựng được danh sách nhận
//     email mà không cần đọc perms của người khác.
//   - lib/recordViewScope.js filterTrainingTestSubmissionsForUser()/
//     filterTrainingRegistrationsForUser() — chỉ chính chủ/giảng viên đúng lớp/trainingManage mới
//     xem được bài làm/đăng ký của người khác.
//
// Chạy: node server/tests/test-audit-dot5-phase1.js
const { createRunner, assert, assertEqual } = require('./testHarness');
const {
  sanitizeUsersPermsForViewer, computeModuleApproverUsernames,
  filterTrainingTestSubmissionsForUser, filterTrainingRegistrationsForUser
} = require('../lib/recordViewScope');

const run = createRunner();

async function main() {

const USERS = [
  { username: 'admin1', name: 'Admin', perms: { admin: true }, permOverrides: {}, groupIds: ['g1'] },
  { username: 'nv1', name: 'Nhân Viên 1', perms: { meetingApprove: true }, permOverrides: { foo: true }, groupIds: ['g2'] },
  { username: 'nv2', name: 'Nhân Viên 2', perms: { licenseApprove: true, itPriceEmergencyRejectApprove: true } },
  { username: 'nv3', name: 'Nhân Viên 3', perms: { internalPostApprove: true } },
];

await run.run('sanitizeUsersPermsForViewer(): admin xem được perms/permOverrides/groupIds của TẤT CẢ mọi người', () => {
  const result = sanitizeUsersPermsForViewer(USERS, 'admin1', true);
  result.forEach(u => {
    const original = USERS.find(x => x.username === u.username);
    assertEqual(JSON.stringify(u.perms), JSON.stringify(original.perms), `admin phải thấy đúng perms của ${u.username}`);
  });
  assert(result[1].hasOwnProperty('permOverrides'), 'admin phải thấy permOverrides của người khác');
  assert(result[1].hasOwnProperty('groupIds'), 'admin phải thấy groupIds của người khác');
});

await run.run('sanitizeUsersPermsForViewer(): non-admin KHÔNG thấy perms/permOverrides/groupIds của NGƯỜI KHÁC', () => {
  const result = sanitizeUsersPermsForViewer(USERS, 'nv1', false);
  const admin = result.find(u => u.username === 'admin1');
  const nv2 = result.find(u => u.username === 'nv2');
  assert(!admin.hasOwnProperty('perms'), 'non-admin không được thấy perms của admin1 (kể cả cờ admin:true)');
  assert(!admin.hasOwnProperty('permOverrides'), 'non-admin không được thấy permOverrides của admin1');
  assert(!admin.hasOwnProperty('groupIds'), 'non-admin không được thấy groupIds của admin1');
  assert(!nv2.hasOwnProperty('perms'), 'non-admin không được thấy perms của đồng nghiệp khác (nv2)');
  // Các field khác (name, username...) vẫn phải còn nguyên — chỉ ẩn đúng 3 field nhạy cảm.
  assertEqual(admin.name, 'Admin', 'các field không nhạy cảm khác vẫn phải giữ nguyên');
});

await run.run('sanitizeUsersPermsForViewer(): non-admin VẪN thấy đủ perms/permOverrides/groupIds của CHÍNH MÌNH', () => {
  const result = sanitizeUsersPermsForViewer(USERS, 'nv1', false);
  const self = result.find(u => u.username === 'nv1');
  const original = USERS.find(u => u.username === 'nv1');
  assertEqual(JSON.stringify(self.perms), JSON.stringify(original.perms), 'phải thấy đúng perms của chính mình');
  assert(self.hasOwnProperty('permOverrides'), 'phải thấy permOverrides của chính mình');
  assert(self.hasOwnProperty('groupIds'), 'phải thấy groupIds của chính mình');
});

await run.run('sanitizeUsersPermsForViewer(): input rỗng/không phải mảng -> trả nguyên (an toàn)', () => {
  assertEqual(sanitizeUsersPermsForViewer(null, 'nv1', false), null);
  assertEqual(sanitizeUsersPermsForViewer(undefined, 'nv1', true), undefined);
});

await run.run('computeModuleApproverUsernames(): gộp đúng admin + cờ quyền cụ thể cho từng module', () => {
  const result = computeModuleApproverUsernames(USERS);
  assert(result.meetingApprove.includes('admin1') && result.meetingApprove.includes('nv1'), 'meetingApprove phải gồm admin + nv1');
  assertEqual(result.meetingApprove.length, 2);
  assert(result.licenseApprove.includes('admin1') && result.licenseApprove.includes('nv2'), 'licenseApprove phải gồm admin + nv2');
  assert(result.itPriceEmergencyRejectApprove.includes('nv2'), 'itPriceEmergencyRejectApprove phải gồm nv2');
  assert(result.internalPostApprove.includes('nv3'), 'internalPostApprove phải gồm nv3');
  assert(!result.internalPostApprove.includes('nv1'), 'nv1 không có cờ internalPostApprove, không được lọt vào danh sách');
});

await run.run('computeModuleApproverUsernames(): input rỗng -> mỗi cờ trả mảng rỗng, không throw', () => {
  const result = computeModuleApproverUsernames([]);
  assertEqual(result.meetingApprove.length, 0);
  assertEqual(result.licenseApprove.length, 0);
  const result2 = computeModuleApproverUsernames(undefined);
  assertEqual(result2.meetingApprove.length, 0);
});

const CLASSES = [
  { id: 1, instructorUsername: 'gv1' },
  { id: 2, instructorUsername: 'gv2' },
];
const TRAINING_MANAGER = { username: 'qltraining', perms: { trainingManage: true } };
const INSTRUCTOR_1 = { username: 'gv1', perms: { trainingInstruct: true } };
const INSTRUCTOR_2 = { username: 'gv2', perms: { trainingInstruct: true } };
const LEARNER = { username: 'hv1', perms: {} };
const UNRELATED = { username: 'hv3', perms: {} }; // không sở hữu bài làm/đăng ký nào, không phải giảng viên lớp nào trong 2 lớp trên

const SUBMISSIONS = [
  { id: 's1', classId: 1, username: 'hv1', answers: ['A'], score: 8, percentage: 80 },
  { id: 's2', classId: 2, username: 'hv2', answers: ['B'], score: 5, percentage: 50 },
];

await run.run('filterTrainingTestSubmissionsForUser(): trainingManage thấy TẤT CẢ bài làm', () => {
  const result = filterTrainingTestSubmissionsForUser(SUBMISSIONS, TRAINING_MANAGER, { trainingClasses: CLASSES });
  assertEqual(result.length, 2);
});

await run.run('filterTrainingTestSubmissionsForUser(): giảng viên đúng lớp chỉ thấy bài làm của lớp mình', () => {
  const result = filterTrainingTestSubmissionsForUser(SUBMISSIONS, INSTRUCTOR_1, { trainingClasses: CLASSES });
  assertEqual(result.length, 1);
  assertEqual(result[0].id, 's1');
});

await run.run('filterTrainingTestSubmissionsForUser(): chính học viên chỉ thấy bài làm của MÌNH', () => {
  const result = filterTrainingTestSubmissionsForUser(SUBMISSIONS, LEARNER, { trainingClasses: CLASSES });
  assertEqual(result.length, 1);
  assertEqual(result[0].username, 'hv1');
});

await run.run('filterTrainingTestSubmissionsForUser(): người không liên quan (không sở hữu bài làm nào, không phải giảng viên lớp nào) -> KHÔNG thấy gì', () => {
  const result = filterTrainingTestSubmissionsForUser(SUBMISSIONS, UNRELATED, { trainingClasses: CLASSES });
  assertEqual(result.length, 0, 'hv3 không liên quan gì tới s1/s2 -> không thấy bài làm nào của người khác');
});

const REGISTRATIONS = [
  { id: 'r1', classId: 1, creator: 'hv1', result: 'PASSED', score: 9 },
  { id: 'r2', classId: 2, creator: 'hv2', result: 'FAILED', score: 3 },
];

await run.run('filterTrainingRegistrationsForUser(): trainingManage thấy TẤT CẢ đăng ký', () => {
  const result = filterTrainingRegistrationsForUser(REGISTRATIONS, TRAINING_MANAGER, { trainingClasses: CLASSES });
  assertEqual(result.length, 2);
});

await run.run('filterTrainingRegistrationsForUser(): giảng viên đúng lớp chỉ thấy đăng ký của lớp mình', () => {
  const result = filterTrainingRegistrationsForUser(REGISTRATIONS, INSTRUCTOR_2, { trainingClasses: CLASSES });
  assertEqual(result.length, 1);
  assertEqual(result[0].id, 'r2');
});

await run.run('filterTrainingRegistrationsForUser(): chính học viên chỉ thấy đăng ký của MÌNH', () => {
  const result = filterTrainingRegistrationsForUser(REGISTRATIONS, LEARNER, { trainingClasses: CLASSES });
  assertEqual(result.length, 1);
  assertEqual(result[0].creator, 'hv1');
});

}

main().then(() => run.summary()).catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exitCode = 1;
});
