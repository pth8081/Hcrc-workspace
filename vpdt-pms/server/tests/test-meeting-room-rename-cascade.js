'use strict';

// tests/test-meeting-room-rename-cascade.js
//
// Regression cho LỖI ĐÃ VÁ (rà soát chuyên sâu 2, cụm "Hành Chính", mức Cao): đổi tên 1 phòng họp trong
// "Danh Mục Phòng Họp" (module-phonghop.js editMeetingRoomCatalogItem(), lưu qua POST
// /api/data/meetingRooms) TRƯỚC ĐÂY không cascade sang meetings.room (lưu nguyên TÊN phòng, so trùng
// bằng so chuỗi tuyệt đối) — lịch CŨ mang tên cũ "biến mất" khỏi lưới lịch, và findMeetingConflict()
// không còn phát hiện trùng phòng giữa lịch mang tên cũ và lịch mới mang tên mới.
//
// File này test 2 phần THUẦN (không cần boot cả routes/data.js, vốn có quá nhiều phụ thuộc):
//   1. diffMeetingRoomRenames(oldRooms, newRooms) — hàm so sánh mảng theo id để tìm ra (các) cặp đã đổi
//      tên (routes/data.js gọi hàm này TRƯỚC khi ghi 'meetingRooms', xem POST /api/data/:key).
//   2. cascadeMeetingRoomRename(oldValue, newValue) — hàm cascade thật, dời TÊN trong TẤT CẢ bản ghi
//      meetings.room đang mang tên cũ sang tên mới (mirror cascadeStoreRename() đã có, xem
//      lib/catalogRename.js).
//
// Chạy: node server/tests/test-meeting-room-rename-cascade.js
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let RECORDS;
let renameFieldCalls;
function resetState() {
  RECORDS = {
    meetings: [
      { id: 1, room: 'Phòng Họp A', dept: 'Phòng IT', startTime: '2026-01-01T08:00:00', endTime: '2026-01-01T09:00:00', status: 'APPROVED' },
      { id: 2, room: 'Phòng Họp A', dept: 'Phòng Nhân Sự', startTime: '2026-02-01T08:00:00', endTime: '2026-02-01T09:00:00', status: 'PENDING' },
      { id: 3, room: 'Phòng Họp B', dept: 'Phòng IT', startTime: '2026-01-05T08:00:00', endTime: '2026-01-05T09:00:00', status: 'APPROVED' }
    ]
  };
  renameFieldCalls = [];
}

stubModule('lib/appData', {
  withLockedAppDataValue: async () => { throw new Error('không dùng trong test này'); }
});
stubModule('lib/recordStore', {
  renameFieldValueInCollection: async (collection, mutateFn) => {
    renameFieldCalls.push(collection);
    const list = RECORDS[collection] || [];
    RECORDS[collection] = list.map((item) => mutateFn(item));
  }
});

const { cascadeMeetingRoomRename, diffMeetingRoomRenames } = require('../lib/catalogRename');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}

async function main() {
  test('diffMeetingRoomRenames: 1 dòng đổi tên (cùng id, khác name) -> phát hiện đúng 1 cặp', () => {
    const oldRooms = [{ id: 1, name: 'Phòng Họp A', short: 'PHA' }, { id: 2, name: 'Phòng Họp B', short: 'PHB' }];
    const newRooms = [{ id: 1, name: 'Phòng Họp A Mới', short: 'PHA' }, { id: 2, name: 'Phòng Họp B', short: 'PHB' }];
    const pairs = diffMeetingRoomRenames(oldRooms, newRooms);
    assert.deepStrictEqual(pairs, [{ oldValue: 'Phòng Họp A', newValue: 'Phòng Họp A Mới' }]);
  });

  test('diffMeetingRoomRenames: thêm phòng mới (id không có trong mảng cũ) -> KHÔNG bị coi là đổi tên', () => {
    const oldRooms = [{ id: 1, name: 'Phòng Họp A', short: 'PHA' }];
    const newRooms = [{ id: 1, name: 'Phòng Họp A', short: 'PHA' }, { id: 2, name: 'Phòng Họp C', short: 'PHC' }];
    assert.deepStrictEqual(diffMeetingRoomRenames(oldRooms, newRooms), []);
  });

  test('diffMeetingRoomRenames: xoá phòng (id có trong mảng cũ, KHÔNG còn trong mảng mới) -> KHÔNG báo đổi tên', () => {
    const oldRooms = [{ id: 1, name: 'Phòng Họp A', short: 'PHA' }, { id: 2, name: 'Phòng Họp B', short: 'PHB' }];
    const newRooms = [{ id: 1, name: 'Phòng Họp A', short: 'PHA' }];
    assert.deepStrictEqual(diffMeetingRoomRenames(oldRooms, newRooms), []);
  });

  test('diffMeetingRoomRenames: sửa "short" nhưng KHÔNG đổi "name" -> không báo đổi tên (chỉ so theo name)', () => {
    const oldRooms = [{ id: 1, name: 'Phòng Họp A', short: 'PHA' }];
    const newRooms = [{ id: 1, name: 'Phòng Họp A', short: 'PHA-2' }];
    assert.deepStrictEqual(diffMeetingRoomRenames(oldRooms, newRooms), []);
  });

  test('diffMeetingRoomRenames: 2 phòng cùng đổi tên trong 1 lượt lưu -> phát hiện đủ cả 2 cặp', () => {
    const oldRooms = [{ id: 1, name: 'A', short: 'A' }, { id: 2, name: 'B', short: 'B' }];
    const newRooms = [{ id: 1, name: 'A2', short: 'A' }, { id: 2, name: 'B2', short: 'B' }];
    assert.deepStrictEqual(diffMeetingRoomRenames(oldRooms, newRooms), [
      { oldValue: 'A', newValue: 'A2' }, { oldValue: 'B', newValue: 'B2' }
    ]);
  });

  test('diffMeetingRoomRenames: mảng cũ rỗng/thiếu (dữ liệu lạ) -> không throw, trả mảng rỗng', () => {
    assert.deepStrictEqual(diffMeetingRoomRenames(null, [{ id: 1, name: 'A' }]), []);
    assert.deepStrictEqual(diffMeetingRoomRenames(undefined, undefined), []);
  });

  await testAsync('cascadeMeetingRoomRename: dời TÊN trong MỌI bản ghi meetings.room mang tên cũ (cả tương lai lẫn quá khứ)', async () => {
    resetState();
    await cascadeMeetingRoomRename('Phòng Họp A', 'Phòng Họp Sen Vàng');
    assert.deepStrictEqual(RECORDS.meetings.map(m => m.room), ['Phòng Họp Sen Vàng', 'Phòng Họp Sen Vàng', 'Phòng Họp B'],
      'Cả 2 lịch (id 1 quá khứ tháng 1, id 2 tương lai tháng 2) mang tên "Phòng Họp A" đều phải đổi; "Phòng Họp B" giữ nguyên');
    assert.deepStrictEqual(renameFieldCalls, ['meetings'], 'Chỉ gọi renameFieldValueInCollection cho đúng 1 collection "meetings"');
  });

  await testAsync('cascadeMeetingRoomRename: phòng không có lịch nào dùng -> không đổi gì, không lỗi', async () => {
    resetState();
    await cascadeMeetingRoomRename('Phòng Họp Không Ai Đặt', 'Phòng Họp Mới');
    assert.deepStrictEqual(RECORDS.meetings.map(m => m.room), ['Phòng Họp A', 'Phòng Họp A', 'Phòng Họp B']);
  });

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  if (failed > 0) process.exit(1);
}

main();
