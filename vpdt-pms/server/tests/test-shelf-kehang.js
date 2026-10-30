// tests/test-shelf-kehang.js — "📋 Kiểm Soát Hàng Hóa" (Vận Hành, Phase 1 MVP, 11/2026). Test TRỰC TIẾP
// logic server (lib/createValidation.js validateAndPrepareCreate() + lib/recordViewScope.js filter*ForUser()),
// không qua Playwright/HTTP — nhanh, tập trung đúng phần RỦI RO BẢO MẬT nhất của tính năng này: chặn
// store-spoofing (dept luôn = user.dept, không tin client gửi) + phân quyền 3 checkbox mới.
const { createRunner, assert, assertEqual } = require('./testHarness');
const { CREATE_MODULE_CONFIGS, CreateError, validateAndPrepareCreate } = require('../lib/createValidation');
const {
  canViewShelfLocation, filterShelfLocationsForUser, canViewShelfRecord, filterShelfRecordsForUser,
  MODULE_ACCESS_GATED_COLLECTIONS
} = require('../lib/recordViewScope');

function userOf(dept, perms) {
  return { username: 'u1', name: 'User 1', dept, perms: perms || {} };
}

async function main() {
  const run = createRunner();

  await run.run('MODULE_ACCESS_GATED_COLLECTIONS.vanHanh có shelfLocations + shelfRecords', async () => {
    assert(MODULE_ACCESS_GATED_COLLECTIONS.vanHanh.includes('shelfLocations'), 'thiếu shelfLocations');
    assert(MODULE_ACCESS_GATED_COLLECTIONS.vanHanh.includes('shelfRecords'), 'thiếu shelfRecords');
  });

  await run.run('shelfLocations: thiếu quyền shelfLocationManage -> CreateError 403', async () => {
    const user = userOf('Siêu thị Quận 1', {});
    let caught = null;
    try {
      validateAndPrepareCreate('shelfLocations', { shelfCode: 'A1', name: 'Nước giải khát' }, user, [], {});
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 403, `phải bị chặn 403, thực tế: ${caught}`);
  });

  await run.run('shelfLocations: có quyền -> tạo OK, dept LUÔN = user.dept (forceOwnDept, không tin payload.dept client gửi)', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfLocationManage: true });
    // Store-spoofing: client cố tình gửi payload.dept khác — chặn KHÔNG phải bằng throw mà bằng việc
    // server luôn ghi đè finalDept = user.dept (xem validateAndPrepareCreate()), record.dept KHÔNG bao
    // giờ lấy theo payload.dept.
    const record = validateAndPrepareCreate('shelfLocations', { shelfCode: 'A1', name: 'Nước giải khát', dept: 'Siêu thị Quận 7 (giả mạo)' }, user, [], {});
    assertEqual(record.dept, 'Siêu thị Quận 1', 'dept phải = user.dept, không phải dept giả mạo trong payload');
    assertEqual(record.code, 'A1', 'code phải được gán từ shelfCode');
    assertEqual(record.active, true, 'active mặc định true');
  });

  await run.run('shelfLocations: trùng mã CHỈ chặn trong CÙNG siêu thị, 2 siêu thị khác nhau dùng lại cùng mã vẫn OK', async () => {
    const user1 = userOf('Siêu thị Quận 1', { shelfLocationManage: true });
    const user7 = userOf('Siêu thị Quận 7', { shelfLocationManage: true });
    const existing = [{ id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Đã có' }];
    let caught = null;
    try {
      validateAndPrepareCreate('shelfLocations', { shelfCode: 'A1', name: 'Trùng mã cùng siêu thị' }, user1, existing, {});
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 409, 'phải báo trùng mã trong CÙNG siêu thị');

    const record7 = validateAndPrepareCreate('shelfLocations', { shelfCode: 'A1', name: 'Siêu thị khác, cùng mã vẫn OK' }, user7, existing, {});
    assertEqual(record7.dept, 'Siêu thị Quận 7', 'Siêu thị Quận 7 vẫn tạo được mã A1 vì khác dept với bản ghi đã có');
  });

  await run.run('shelfRecords: thiếu quyền shelfRecordCreate -> CreateError 403', async () => {
    const user = userOf('Siêu thị Quận 1', {});
    let caught = null;
    try {
      validateAndPrepareCreate('shelfRecords', { shelfLocationId: 1, productName: 'Coca-Cola', quantity: 10 }, user, [], { shelfLocations: [] });
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 403, `phải bị chặn 403, thực tế: ${caught}`);
  });

  await run.run('shelfRecords: chặn store-spoofing qua shelfLocationId — không tạo được ghi nhận trên quầy kệ của SIÊU THỊ KHÁC', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfRecordCreate: true });
    const appData = { shelfLocations: [{ id: 99, dept: 'Siêu thị Quận 7', code: 'B1', name: 'Quầy siêu thị khác', active: true }] };
    let caught = null;
    try {
      validateAndPrepareCreate('shelfRecords', { shelfLocationId: 99, productName: 'Coca-Cola', quantity: 10 }, user, [], appData);
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 400, 'phải chặn vì quầy kệ #99 thuộc siêu thị khác');
  });

  await run.run('shelfRecords: quầy kệ đã ngừng dùng (active:false) -> chặn, không ghi nhận được', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfRecordCreate: true });
    const appData = { shelfLocations: [{ id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Quầy A1', active: false }] };
    let caught = null;
    try {
      validateAndPrepareCreate('shelfRecords', { shelfLocationId: 1, productName: 'Coca-Cola', quantity: 10 }, user, [], appData);
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 400, 'phải chặn vì quầy kệ đã ngừng dùng');
  });

  await run.run('shelfRecords: hợp lệ -> tạo OK, snapshot đúng mã/tên quầy kệ, dept = user.dept', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfRecordCreate: true });
    const appData = { shelfLocations: [{ id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Nước giải khát', active: true }] };
    const record = validateAndPrepareCreate('shelfRecords', { shelfLocationId: 1, productName: 'Coca-Cola lon 330ml', maVach: '893458', quantity: 24, expiryDate: '2027-03-12' }, user, [], appData);
    assertEqual(record.dept, 'Siêu thị Quận 1', 'dept phải = user.dept');
    assertEqual(record.shelfLocationCode, 'A1', 'phải snapshot đúng mã quầy kệ');
    assertEqual(record.shelfLocationName, 'Nước giải khát', 'phải snapshot đúng tên quầy kệ');
    assertEqual(record.quantity, 24, 'quantity phải giữ đúng giá trị');
  });

  await run.run('shelfRecords: số lượng âm/không hợp lệ -> CreateError 400', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfRecordCreate: true });
    const appData = { shelfLocations: [{ id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'A1', active: true }] };
    let caught = null;
    try {
      validateAndPrepareCreate('shelfRecords', { shelfLocationId: 1, productName: 'X', quantity: -5 }, user, [], appData);
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 400, 'số lượng âm phải bị chặn');
  });

  await run.run('filterShelfLocationsForUser/filterShelfRecordsForUser: mặc định chỉ thấy đúng siêu thị mình', async () => {
    const user = userOf('Siêu thị Quận 1', {});
    const items = [
      { id: 1, dept: 'Siêu thị Quận 1' },
      { id: 2, dept: 'Siêu thị Quận 7' }
    ];
    const visibleLoc = filterShelfLocationsForUser(items, user);
    const visibleRec = filterShelfRecordsForUser(items, user);
    assertEqual(JSON.stringify(visibleLoc.map(i => i.id)), JSON.stringify([1]), 'chỉ thấy đúng id=1 (cùng dept)');
    assertEqual(JSON.stringify(visibleRec.map(i => i.id)), JSON.stringify([1]), 'chỉ thấy đúng id=1 (cùng dept)');
  });

  await run.run('filterShelfRecordsForUser: shelfReportViewAll xem được TẤT CẢ siêu thị', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfReportViewAll: true });
    const items = [
      { id: 1, dept: 'Siêu thị Quận 1' },
      { id: 2, dept: 'Siêu thị Quận 7' }
    ];
    const visible = filterShelfRecordsForUser(items, user);
    assertEqual(JSON.stringify(visible.map(i => i.id)), JSON.stringify([1, 2]), 'shelfReportViewAll phải thấy cả 2 siêu thị');
  });

  await run.run('canViewShelfLocation/canViewShelfRecord: admin luôn xem được, user rỗng luôn bị chặn', async () => {
    const admin = userOf('Siêu thị Quận 1', { admin: true });
    const otherDeptItem = { dept: 'Siêu thị Quận 7' };
    assert(canViewShelfLocation(admin, otherDeptItem) === true, 'admin phải xem được mọi siêu thị');
    assert(canViewShelfRecord(admin, otherDeptItem) === true, 'admin phải xem được mọi siêu thị');
    assert(canViewShelfLocation(null, otherDeptItem) === false, 'user rỗng phải bị chặn');
  });

  await run.run('CREATE_MODULE_CONFIGS.shelfLocations/shelfRecords đều forceOwnDept:true', async () => {
    assertEqual(CREATE_MODULE_CONFIGS.shelfLocations.forceOwnDept, true, 'shelfLocations phải forceOwnDept');
    assertEqual(CREATE_MODULE_CONFIGS.shelfRecords.forceOwnDept, true, 'shelfRecords phải forceOwnDept');
  });

  run.summary();
}

main().catch(err => { console.error(err); process.exit(1); });
