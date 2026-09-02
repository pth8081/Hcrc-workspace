// server/tests/test-org-chart-manager-visibility.js
//
// Regression test cho Cơ Cấu Tổ Chức (user.managerUsername) + "trưởng phòng xem việc nhân viên":
//   - lib/recordViewScope.js isManagerOf() — đệ quy trực tiếp/gián tiếp, có giới hạn phòng vệ vòng lặp.
//   - canViewTaskRecord() mở rộng: trưởng phòng (đệ quy) XEM được task của nhân viên mình quản lý,
//     nhưng KHÔNG được cấp thêm quyền thao tác (canManageTasks/canAssignSpecificTask không dùng hàm này).
//   - hasOwnWorkItemInSource() mở rộng tương tự cho Vận Hành (assignedTo/acceptorUsername của cấp dưới).
//   - routes/data.js assertNoManagerCycle() (gọi qua prepareUsersForSave khi lưu users) — không có
//     testHarness mirror cho toàn bộ prepareUsersForSave (chưa từng có test nào cho khu vực này, kể cả
//     assertAtLeastOneAdmin() — validate bằng cách gọi thẳng logic tương đương ở đây, đối chiếu hành vi
//     ĐÚNG như mô tả trong routes/data.js).
//
// Chạy: node server/tests/test-org-chart-manager-visibility.js
const { createRunner, assert, assertEqual } = require('./testHarness');
const { isManagerOf, canViewTaskRecord, hasOwnWorkItemInSource } = require('../lib/recordViewScope');

const run = createRunner();

async function main() {

// Cây tổ chức: CEO -> DIRECTOR -> MANAGER -> STAFF1, STAFF2 (STAFF2 không có quản lý — gốc riêng)
const USERS = [
  { username: 'ceo', name: 'CEO', managerUsername: null },
  { username: 'director', name: 'Giám Đốc', managerUsername: 'ceo' },
  { username: 'manager', name: 'Trưởng Phòng', managerUsername: 'director' },
  { username: 'staff1', name: 'Nhân Viên 1', managerUsername: 'manager' },
  { username: 'staff2', name: 'Nhân Viên 2', managerUsername: null },
  { username: 'other', name: 'Người Ngoài', managerUsername: null }
];

await run.run('isManagerOf(): quản lý TRỰC TIẾP', () => {
  assert(isManagerOf('manager', 'staff1', USERS), 'manager phải là quản lý trực tiếp của staff1');
});
await run.run('isManagerOf(): quản lý GIÁN TIẾP (đệ quy nhiều cấp)', () => {
  assert(isManagerOf('director', 'staff1', USERS), 'director phải là quản lý gián tiếp của staff1 (qua manager)');
  assert(isManagerOf('ceo', 'staff1', USERS), 'ceo phải là quản lý gián tiếp của staff1 (qua director, manager)');
});
await run.run('isManagerOf(): KHÔNG phải quản lý -> false', () => {
  assert(!isManagerOf('other', 'staff1', USERS), 'other không liên quan gì tới staff1');
  assert(!isManagerOf('manager', 'staff2', USERS), 'manager không quản lý staff2 (staff2 không có quản lý)');
  assert(!isManagerOf('staff1', 'manager', USERS), 'Chiều NGƯỢC không đúng — staff1 không phải quản lý của manager');
});
await run.run('isManagerOf(): tự thân/thiếu tham số -> false', () => {
  assert(!isManagerOf('manager', 'manager', USERS), 'Không tự là quản lý của chính mình');
  assert(!isManagerOf(null, 'staff1', USERS), 'Thiếu managerUsername -> false');
  assert(!isManagerOf('manager', null, USERS), 'Thiếu targetUsername -> false');
});
await run.run('isManagerOf(): vòng lặp dữ liệu hỏng vẫn không treo (giới hạn 50 bước)', () => {
  const cyclic = [
    { username: 'a', managerUsername: 'b' },
    { username: 'b', managerUsername: 'c' },
    { username: 'c', managerUsername: 'a' }
  ];
  assert(!isManagerOf('x', 'a', cyclic), 'Vòng lặp không liên quan -> false, không treo vô hạn');
});

// ----- canViewTaskRecord(): trưởng phòng XEM được task của nhân viên, KHÔNG có quyền rộng -----
const MANAGER_USER = { username: 'manager', perms: {} };
const OTHER_USER = { username: 'other', perms: {} };
const appData = { users: USERS };

await run.run('canViewTaskRecord(): trưởng phòng (đệ quy) xem được task của nhân viên cấp dưới', () => {
  const task = { assignedTo: 'staff1', assignedBy: 'someone_else', collaborators: [] };
  assert(canViewTaskRecord(MANAGER_USER, task, appData), 'manager phải xem được task của staff1 (cấp dưới trực tiếp)');
  const DIRECTOR_USER = { username: 'director', perms: {} };
  assert(canViewTaskRecord(DIRECTOR_USER, task, appData), 'director phải xem được task của staff1 (cấp dưới gián tiếp)');
});
await run.run('canViewTaskRecord(): người KHÔNG liên quan/KHÔNG phải quản lý bị chặn xem', () => {
  const task = { assignedTo: 'staff1', assignedBy: 'someone_else', collaborators: [] };
  assert(!canViewTaskRecord(OTHER_USER, task, appData), 'other không phải quản lý của staff1, không được xem');
});
await run.run('canViewTaskRecord(): KHÔNG appData (gọi thiếu tham số) vẫn hoạt động đúng như trước (không crash, không rớt nhánh sở hữu trực tiếp)', () => {
  const task = { assignedTo: 'staff1', assignedBy: 'manager', collaborators: [] };
  const asAssignedBy = { username: 'manager', perms: {} };
  assert(canViewTaskRecord(asAssignedBy, task), 'assignedBy vẫn xem được dù không truyền appData');
});

// ----- hasOwnWorkItemInSource(): trưởng phòng xem được hồ sơ Vận Hành có việc của nhân viên mình -----
await run.run('hasOwnWorkItemInSource(): trưởng phòng (đệ quy) thấy hồ sơ có việc của nhân viên phụ trách/được chỉ định nghiệm thu', () => {
  const opAppData = {
    users: USERS,
    operationWorkItems: [
      { sourceType: 'OPERATION_STORE_OPENING', sourceId: 1, assignedTo: 'staff1', acceptorUsername: null }
    ]
  };
  assert(hasOwnWorkItemInSource(MANAGER_USER, 'OPERATION_STORE_OPENING', 1, opAppData), 'manager phải thấy hồ sơ vì staff1 (cấp dưới) được gán việc');
  assert(!hasOwnWorkItemInSource(OTHER_USER, 'OPERATION_STORE_OPENING', 1, opAppData), 'other không liên quan, không thấy hồ sơ');
});
await run.run('hasOwnWorkItemInSource(): quản lý qua acceptorUsername (người được chỉ định nghiệm thu)', () => {
  const opAppData = {
    users: USERS,
    operationWorkItems: [
      { sourceType: 'OPERATION_REPAIR', sourceId: 2, assignedTo: null, acceptorUsername: 'staff1' }
    ]
  };
  const DIRECTOR_USER = { username: 'director', perms: {} };
  assert(hasOwnWorkItemInSource(DIRECTOR_USER, 'OPERATION_REPAIR', 2, opAppData), 'director (quản lý gián tiếp) phải thấy hồ sơ qua acceptorUsername=staff1');
});

// ----- assertNoManagerCycle() (routes/data.js) — mirror logic để test trực tiếp không phụ thuộc route,
// vì routes/data.js chỉ export router (đúng quy ước toàn bộ routes/*.js trong hệ thống, KHÔNG export
// helper riêng lẻ) — cùng khuôn với assertAtLeastOneAdmin() cũng chưa từng có test trực tiếp trước đây.
function assertNoManagerCycleLikeRoutesData(users) {
  const byUsername = new Map(users.map(u => [u.username, u]));
  for (const u of users) {
    if (!u.managerUsername) continue;
    if (u.managerUsername === u.username) return { ok: false, reason: 'self' };
    if (!byUsername.has(u.managerUsername)) return { ok: false, reason: 'not-found' };
    let cur = byUsername.get(u.managerUsername);
    let steps = 0;
    while (cur && steps < 50) {
      if (cur.username === u.username) return { ok: false, reason: 'cycle' };
      cur = cur.managerUsername ? byUsername.get(cur.managerUsername) : null;
      steps++;
    }
  }
  return { ok: true };
}
await run.run('Cơ Cấu Tổ Chức hợp lệ (cây thật) -> không báo lỗi vòng lặp', () => {
  const result = assertNoManagerCycleLikeRoutesData(USERS);
  assert(result.ok, 'Cây quản lý hợp lệ không được báo lỗi');
});
await run.run('Vòng lặp trực tiếp (A quản lý B, B quản lý A) bị chặn', () => {
  const cyclic = [
    { username: 'p1', managerUsername: 'p2' },
    { username: 'p2', managerUsername: 'p1' }
  ];
  const result = assertNoManagerCycleLikeRoutesData(cyclic);
  assert(!result.ok && result.reason === 'cycle', 'Phải phát hiện vòng lặp trực tiếp');
});
await run.run('Vòng lặp gián tiếp (A->B->C->A) bị chặn', () => {
  const cyclic = [
    { username: 'p1', managerUsername: 'p2' },
    { username: 'p2', managerUsername: 'p3' },
    { username: 'p3', managerUsername: 'p1' }
  ];
  const result = assertNoManagerCycleLikeRoutesData(cyclic);
  assert(!result.ok && result.reason === 'cycle', 'Phải phát hiện vòng lặp gián tiếp qua 3 cấp');
});
await run.run('Tự chọn chính mình làm quản lý bị chặn', () => {
  const result = assertNoManagerCycleLikeRoutesData([{ username: 'p1', managerUsername: 'p1' }]);
  assert(!result.ok && result.reason === 'self', 'Phải chặn tự chọn chính mình');
});

}

main().then(() => run.summary()).catch((err) => {
  console.error("FATAL:", err && err.stack || err);
  process.exitCode = 1;
});
