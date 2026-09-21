// server/tests/test-meeting-edit-route.js
//
// TÍNH NĂNG MỚI (theo yêu cầu người dùng): "cho phép người đăng ký và người quản lý phòng họp có thể
// sửa phòng họp (check trùng tại thời điểm tạo và thời điểm ấn gửi phê duyệt) và gửi phê duyệt lại thay
// vì hủy và tạo đăng ký phòng họp lại". Trước đây module Phòng Họp KHÔNG có route/tính năng Sửa nào cả
// (chỉ Duyệt/Hủy) — PUT /api/meetings/:id (routes/meetingActions.js) là route MỚI HOÀN TOÀN.
//
// Kiểm tra:
//   - Creator sửa được chính lịch mình đặt (PENDING giữ nguyên PENDING).
//   - Sửa lịch đang APPROVED -> tự quay về PENDING (gửi phê duyệt lại), xoá approvedBy/approvedByName/approvedAt.
//   - Người có quyền meetingCancel ("Người quản lý phòng họp") sửa được lịch của NGƯỜI KHÁC.
//   - Người ngoài (không phải creator, không meetingCancel/admin) bị chặn 403.
//   - Lịch đã CANCELLED không sửa được (409).
//   - Check trùng lịch loại trừ ĐÚNG chính bản ghi đang sửa (excludeId) — giữ nguyên giờ/phòng cũ khi sửa
//     nội dung khác KHÔNG bị tự báo trùng với chính nó.
//   - Đổi sang giờ/phòng đã bị lịch KHÁC chiếm -> 409 (đúng yêu cầu "check trùng tại thời điểm ấn gửi
//     phê duyệt", tức lúc Lưu, không chỉ lúc tạo ban đầu).
//   - Phòng họp không có trong danh mục -> 400.
//   - Phòng ban ngoài phạm vi meetingBookScope -> 403 (re-check giống hệt lúc tạo mới).
//
// Chạy thẳng express router THẬT với lib/recordStore + lib/auth + lib/appData bị stub (cùng khuôn
// tests/test-meeting-busy-slots-route.js).
//
// Chạy: node server/tests/test-meeting-edit-route.js
'use strict';
const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const CREATOR = {
  username: 'nv_kd', name: 'Nhân Viên KD', dept: 'Phòng Kinh Doanh', active: true,
  perms: { meetingBookScope: { all: false, depts: ['Phòng Kinh Doanh'] } }
};
const ROOM_MANAGER = {
  username: 'qlph', name: 'Quản Lý Phòng Họp', dept: 'Phòng Hành Chính', active: true,
  perms: { meetingCancel: true, meetingBookScope: { all: true } }
};
const OUTSIDER = {
  username: 'nv_khac', name: 'Nhân Viên Khác', dept: 'Phòng Kỹ Thuật', active: true,
  perms: { meetingBookScope: { all: false, depts: ['Phòng Kỹ Thuật'] } }
};
let currentActor = CREATOR;

function makeMeetings() {
  return [
    {
      id: 1, code: 'PH-001', dept: 'Phòng Kinh Doanh', room: 'Phòng Họp Lớn A', title: 'Họp KD tuần',
      startTime: '2026-10-20T08:00', endTime: '2026-10-20T09:00', status: 'PENDING',
      creator: 'nv_kd', creatorName: 'Nhân Viên KD', agenda: 'Đánh giá tuần', attendees: 5, customData: {}
    },
    {
      id: 2, code: 'PH-002', dept: 'Phòng Kinh Doanh', room: 'Phòng Họp Lớn A', title: 'Họp đã duyệt',
      startTime: '2026-10-21T08:00', endTime: '2026-10-21T09:00', status: 'APPROVED',
      creator: 'nv_kd', creatorName: 'Nhân Viên KD', agenda: 'Triển khai dự án', attendees: 4, customData: {},
      approvedBy: 'boss', approvedByName: 'Sếp', approvedAt: '2026-10-19 10:00:00'
    },
    {
      id: 3, code: 'PH-003', dept: 'Phòng Kỹ Thuật', room: 'Phòng Họp Nhỏ B', title: 'Lịch của phòng khác',
      startTime: '2026-10-20T10:00', endTime: '2026-10-20T11:00', status: 'APPROVED',
      creator: 'nv_khac', creatorName: 'Nhân Viên Khác', agenda: '', attendees: 2, customData: {}
    },
    {
      id: 4, code: 'PH-004', dept: 'Phòng Kinh Doanh', room: 'Phòng Họp Nhỏ B', title: 'Chiếm chỗ 14h-15h',
      startTime: '2026-10-22T14:00', endTime: '2026-10-22T15:00', status: 'PENDING',
      creator: 'nv_khac', creatorName: 'Nhân Viên Khác', agenda: '', attendees: 2, customData: {}
    },
    {
      id: 5, code: 'PH-005', dept: 'Phòng Kinh Doanh', room: 'Phòng Họp Lớn A', title: 'Đã huỷ',
      startTime: '2026-10-23T08:00', endTime: '2026-10-23T09:00', status: 'CANCELLED',
      creator: 'nv_kd', creatorName: 'Nhân Viên KD', agenda: '', attendees: 2, customData: {}
    }
  ];
}
let MEETINGS = makeMeetings();

stubModule('lib/recordStore', {
  getAllForCollection: async () => MEETINGS,
  withLockedRecordForCollection: async (collection, id, fn) => {
    const item = MEETINGS.find((m) => m.id === id);
    if (!item) { const { HttpError } = require(path.join(__dirname, '..', 'lib/httpErrors')); throw new HttpError(404, 'Không tìm thấy hồ sơ'); }
    return fn(item);
  },
  withAppLock: async (keys, fn) => fn()
});

stubModule('lib/auth', {
  requireAuth: (req, res, next) => { req.freshUser = currentActor; next(); },
  blockIfMustChangePassword: (req, res, next) => next()
});

stubModule('lib/appData', {
  getAllAppData: async () => ({
    meetingRooms: [{ id: 1, name: 'Phòng Họp Lớn A', short: 'A' }, { id: 2, name: 'Phòng Họp Nhỏ B', short: 'B' }],
    formTemplates: {}
  })
});

const express = require('express');
const { createRunner, assertEqual, assert } = require('./testHarness');
const meetingRoutes = require('../routes/meetingActions');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/meetings', meetingRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function put(port, id, body) {
  const res = await fetch(`http://127.0.0.1:${port}/api/meetings/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function basePayload(overrides) {
  return Object.assign({
    dept: 'Phòng Kinh Doanh', room: 'Phòng Họp Lớn A', title: 'Họp KD tuần (đã sửa)',
    attendees: 6, startTime: '2026-10-20T08:00', endTime: '2026-10-20T09:00',
    equipment: 'Máy chiếu', agenda: 'Đánh giá tuần (cập nhật)', customData: {}
  }, overrides || {});
}

async function main() {
  const server = await startApp();
  const port = server.address().port;
  const run = createRunner();
  try {
    await run.run('Creator sửa được chính lịch PENDING của mình -> vẫn giữ PENDING', async () => {
      currentActor = CREATOR;
      const { status, json } = await put(port, 1, basePayload());
      assertEqual(status, 200);
      assertEqual(json.item.status, 'PENDING');
      assertEqual(json.item.title, 'Họp KD tuần (đã sửa)');
      assertEqual(json.item.agenda, 'Đánh giá tuần (cập nhật)');
    });

    await run.run('Sửa lịch ĐANG APPROVED -> tự quay về PENDING (gửi phê duyệt lại), xoá dấu vết duyệt cũ', async () => {
      currentActor = CREATOR;
      const { status, json } = await put(port, 2, basePayload({ room: 'Phòng Họp Lớn A', startTime: '2026-10-21T08:00', endTime: '2026-10-21T09:00' }));
      assertEqual(status, 200);
      assertEqual(json.item.status, 'PENDING', 'Phải quay về PENDING để chờ duyệt lại');
      assertEqual(json.item.approvedBy, null);
      assertEqual(json.item.approvedByName, null);
      assertEqual(json.item.approvedAt, null);
    });

    await run.run('Người NGOÀI (không phải creator, không meetingCancel/admin) bị chặn 403', async () => {
      MEETINGS = makeMeetings();
      currentActor = OUTSIDER;
      const { status, json } = await put(port, 1, basePayload());
      assertEqual(status, 403);
      assert(/quyền/.test(json.error || ''));
    });

    await run.run('Người có quyền meetingCancel ("Người quản lý phòng họp") sửa được lịch của NGƯỜI KHÁC', async () => {
      MEETINGS = makeMeetings();
      currentActor = ROOM_MANAGER;
      const { status, json } = await put(port, 1, basePayload({ title: 'Sửa hộ bởi quản lý phòng họp' }));
      assertEqual(status, 200);
      assertEqual(json.item.title, 'Sửa hộ bởi quản lý phòng họp');
    });

    await run.run('Lịch ĐÃ HUỶ không sửa được (409)', async () => {
      MEETINGS = makeMeetings();
      currentActor = CREATOR;
      const { status, json } = await put(port, 5, basePayload({ startTime: '2026-10-23T08:00', endTime: '2026-10-23T09:00' }));
      assertEqual(status, 409);
      assert(/huỷ/i.test(json.error || ''));
    });

    await run.run('Check trùng loại trừ ĐÚNG chính bản ghi đang sửa — giữ nguyên giờ/phòng cũ, chỉ đổi nội dung KHÔNG bị tự báo trùng với chính nó', async () => {
      MEETINGS = makeMeetings();
      currentActor = CREATOR;
      const { status, json } = await put(port, 1, basePayload({ room: 'Phòng Họp Lớn A', startTime: '2026-10-20T08:00', endTime: '2026-10-20T09:00', title: 'Chỉ đổi tiêu đề' }));
      assertEqual(status, 200, JSON.stringify(json));
      assertEqual(json.item.title, 'Chỉ đổi tiêu đề');
    });

    await run.run('Đổi sang giờ/phòng đã bị lịch KHÁC chiếm -> 409 (check trùng lúc Lưu, không chỉ lúc tạo ban đầu)', async () => {
      MEETINGS = makeMeetings();
      currentActor = CREATOR;
      // id=1 đổi sang đúng khung giờ/phòng của id=4 (Phòng Họp Nhỏ B, 14h-15h ngày 22/10, PENDING của nv_khac).
      const { status, json } = await put(port, 1, basePayload({ room: 'Phòng Họp Nhỏ B', startTime: '2026-10-22T14:00', endTime: '2026-10-22T15:00' }));
      assertEqual(status, 409);
      assert(/trùng/.test(json.error || ''), JSON.stringify(json));
    });

    await run.run('Phòng họp không có trong danh mục -> 400', async () => {
      MEETINGS = makeMeetings();
      currentActor = CREATOR;
      const { status, json } = await put(port, 1, basePayload({ room: 'Phòng Bịa Đặt' }));
      assertEqual(status, 400);
      assert(/danh mục/.test(json.error || ''));
    });

    await run.run('Phòng ban ngoài phạm vi meetingBookScope -> 403 (re-check giống hệt lúc tạo mới)', async () => {
      MEETINGS = makeMeetings();
      currentActor = CREATOR; // chỉ có scope Phòng Kinh Doanh
      const { status, json } = await put(port, 1, basePayload({ dept: 'Phòng Kỹ Thuật' }));
      assertEqual(status, 403);
      assert(/phòng ban/.test(json.error || ''));
    });

    await run.run('Không tìm thấy lịch họp (id lạ) -> 404', async () => {
      MEETINGS = makeMeetings();
      currentActor = CREATOR;
      const { status } = await put(port, 999, basePayload());
      assertEqual(status, 404);
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch((err) => { console.error('FATAL:', err); process.exitCode = 1; });
