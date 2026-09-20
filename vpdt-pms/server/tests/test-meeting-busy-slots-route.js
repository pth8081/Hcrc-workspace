// server/tests/test-meeting-busy-slots-route.js
//
// Route MỚI (rà soát chuyên sâu 10/2026, phát hiện #2 mức Cao): GET /api/meetings/busy-slots —
// routes/meetingActions.js. Lưới "Lịch Họp" phải thấy phòng bận của TOÀN CÔNG TY (mục đích của màn này
// là xem phòng trống/bận), trong khi GET /api/data vẫn lọc meetings theo phạm vi xem như cũ. Route này
// vì vậy chỉ được trả CHIẾM CHỖ (room/giờ/trạng thái), tuyệt đối KHÔNG kèm tiêu đề/người đặt/phòng ban.
//
// Chạy thẳng express router THẬT với lib/recordStore + lib/auth bị stub (cùng khuôn tests/test-checklist.js).
//
// Chạy: node server/tests/test-meeting-busy-slots-route.js
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

// Nhân viên phòng Kinh Doanh, phạm vi xem lịch họp HẸP (chỉ phòng mình) — đúng đối tượng gặp lỗi
// "phòng trống giả" trước khi có route này.
const NV_KD = {
  username: 'nv_kd', name: 'Nhân Viên KD', dept: 'Phòng Kinh Doanh', active: true,
  perms: { meetingBookScope: { all: false, depts: ['Phòng Kinh Doanh'] }, meetingView: { all: false, depts: ['Phòng Kinh Doanh'] } }
};
const USERS = [NV_KD];

const MEETINGS = [
  {
    id: 1, code: 'PH-001', dept: 'Phòng Kinh Doanh', room: 'Phòng Họp Lớn A', title: 'Họp KD',
    startTime: '2026-10-20T08:00', endTime: '2026-10-20T09:00', status: 'APPROVED',
    creator: 'nv_kd', creatorName: 'Nhân Viên KD', agenda: 'Nội dung nội bộ KD', attendees: 5
  },
  {
    id: 2, code: 'PH-002', dept: 'Phòng Kỹ Thuật', room: 'Phòng Họp Lớn A', title: 'Họp kỹ thuật mật',
    startTime: '2026-10-20T09:00', endTime: '2026-10-20T10:00', status: 'PENDING',
    creator: 'nv_kt', creatorName: 'Nhân Viên KT', agenda: 'Nội dung nhạy cảm', attendees: 3
  },
  {
    id: 3, code: 'PH-003', dept: 'Phòng Kỹ Thuật', room: 'Phòng Họp Nhỏ B', title: 'Lịch đã huỷ',
    startTime: '2026-10-20T10:00', endTime: '2026-10-20T11:00', status: 'CANCELLED',
    creator: 'nv_kt', creatorName: 'Nhân Viên KT', agenda: '', attendees: 2
  }
];

let PORT = 0;

stubModule('lib/recordStore', {
  getAllForCollection: async () => MEETINGS,
  withLockedRecordForCollection: async (collection, id, fn) => fn(MEETINGS.find(m => m.id === id)),
  withAppLock: async (key, fn) => fn()
});

stubModule('lib/auth', {
  requireAuth: (req, res, next) => { req.freshUser = NV_KD; req.allUsers = USERS; next(); },
  blockIfMustChangePassword: (req, res, next) => next()
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
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function main() {
  const server = await startApp();
  const run = createRunner();
  try {
    await run.run('busy-slots: người có phạm vi xem HẸP vẫn nhận đủ lịch chiếm chỗ của MỌI phòng ban', async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/meetings/busy-slots`);
      const body = await res.json();
      assertEqual(res.status, 200, 'Route phải mở cho mọi tài khoản đã đăng nhập');
      assertEqual(body.items.length, 2, 'Phải có cả lịch của Phòng Kỹ Thuật (id 2), chỉ loại lịch đã huỷ');
      assert(body.items.some(i => i.id === 2), 'Lịch của phòng ban khác PHẢI có mặt (đó là mục đích của route)');
    });

    await run.run('busy-slots: KHÔNG kèm tiêu đề/nội dung/người đặt/phòng ban của cuộc họp', async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/meetings/busy-slots`);
      const body = await res.json();
      const allowed = ['id', 'room', 'startTime', 'endTime', 'status'];
      for (const item of body.items) {
        const extra = Object.keys(item).filter(k => !allowed.includes(k));
        assertEqual(extra.length, 0, `Field thừa bị lộ ra: ${extra.join(', ')}`);
      }
      const raw = JSON.stringify(body);
      assert(!raw.includes('Họp kỹ thuật mật'), 'Tiêu đề cuộc họp phòng ban khác không được lộ');
      assert(!raw.includes('Nội dung nhạy cảm'), 'Nội dung/chương trình họp không được lộ');
      assert(!raw.includes('Nhân Viên KT'), 'Người đặt lịch không được lộ');
      assert(!raw.includes('PH-002'), 'Mã phiếu không được lộ');
    });

    await run.run('busy-slots: lịch ĐÃ HUỶ không chiếm chỗ (không trả về)', async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/meetings/busy-slots`);
      const body = await res.json();
      assert(!body.items.some(i => i.id === 3), 'Lịch CANCELLED phải nhả chỗ');
    });

    await run.run('busy-slots: cả lịch PENDING lẫn APPROVED đều tính là đang chiếm chỗ', async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/meetings/busy-slots`);
      const body = await res.json();
      const statuses = body.items.map(i => i.status).sort();
      assertEqual(statuses.join(','), 'APPROVED,PENDING', 'Khớp đúng quy ước findMeetingConflict()');
    });
  } finally {
    server.close();
  }
  run.summary();
}

main().catch(err => { console.error('FATAL:', err); process.exitCode = 1; });
