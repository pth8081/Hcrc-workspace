// server/tests/test-car-busy-slots-route.js
//
// Route MỚI (rà soát chuyên sâu 2, cụm "Hành Chính", mức Trung bình): GET
// /api/records/carRegs/busy-slots — routes/records.js. Lưới "Lịch Xe" phải thấy lái xe bận của TOÀN
// CÔNG TY (mục đích của màn này là xem lái xe trống/bận), trong khi GET /api/data vẫn lọc carRegs theo
// carView như cũ. Route này vì vậy chỉ được trả CHIẾM CHỖ (lái xe được phân công/giờ/trạng thái), tuyệt
// đối KHÔNG kèm điểm đến/mã phiếu/phòng ban/người đăng ký — mirror ĐÚNG khuôn
// tests/test-meeting-busy-slots-route.js (GET /api/meetings/busy-slots).
//
// Chạy thẳng express router THẬT (routes/records.js) với lib/recordStore + lib/auth bị stub.
//
// Chạy: node server/tests/test-car-busy-slots-route.js
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

// Nhân viên phòng Kinh Doanh, phạm vi xem carRegs HẸP (chỉ phòng mình) — đúng đối tượng gặp lỗi "lái xe
// trống giả" trước khi có route này.
const NV_KD = {
  username: 'nv_kd', name: 'Nhân Viên KD', dept: 'Phòng Kinh Doanh', active: true,
  perms: { carView: { all: false, depts: ['Phòng Kinh Doanh'] } }
};
const USERS = [NV_KD];

const CAR_REGS = [
  {
    id: 1, code: 'XE-001', dept: 'Phòng Kinh Doanh', destination: 'HN → Hải Phòng',
    assignedDriverUsername: 'lx1', startTime: '2026-10-20T08:00', endTime: '2026-10-20T09:00', status: 'APPROVED',
    creator: 'nv_kd', creatorName: 'Nhân Viên KD', reason: 'Công tác nội bộ KD'
  },
  {
    id: 2, code: 'XE-002', dept: 'Phòng Kỹ Thuật', destination: 'Điểm đến mật của Kỹ Thuật',
    assignedDriverUsername: 'lx1', startTime: '2026-10-20T09:00', endTime: '2026-10-20T10:00', status: 'PENDING',
    creator: 'nv_kt', creatorName: 'Nhân Viên KT', reason: 'Nội dung nhạy cảm KT'
  },
  {
    id: 3, code: 'XE-003', dept: 'Phòng Kỹ Thuật', destination: 'Chuyến đã huỷ',
    assignedDriverUsername: 'lx2', startTime: '2026-10-20T10:00', endTime: '2026-10-20T11:00', status: 'CANCELLED',
    creator: 'nv_kt', creatorName: 'Nhân Viên KT', reason: ''
  },
  {
    id: 4, code: 'XE-004', dept: 'Phòng Kỹ Thuật', destination: 'Chuyến chưa gán tài xế',
    assignedDriverUsername: null, startTime: '2026-10-21T08:00', endTime: '2026-10-21T09:00', status: 'PENDING',
    creator: 'nv_kt', creatorName: 'Nhân Viên KT', reason: ''
  }
];

let PORT = 0;

stubModule('lib/recordStore', {
  getAllForCollection: async () => CAR_REGS,
  createForCollection: async () => { throw new Error('không dùng trong test này'); },
  insertRecord: async () => { throw new Error('không dùng trong test này'); },
  withLockedRecordForCollection: async (collection, id, fn) => fn(CAR_REGS.find(c => c.id === id)),
  withLockedRecordById: async () => { throw new Error('không dùng trong test này'); },
  deleteRecordForCollection: async () => { throw new Error('không dùng trong test này'); },
  withAppLock: async (key, fn) => fn()
});
stubModule('lib/auth', {
  requireAuth: (req, res, next) => { req.freshUser = NV_KD; req.allUsers = USERS; next(); },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const { createRunner, assertEqual, assert } = require('./testHarness');
const recordsRoutes = require('../routes/records.js');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/records', recordsRoutes);
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
    await run.run('busy-slots: người có phạm vi carView HẸP vẫn nhận đủ chuyến chiếm chỗ của MỌI phòng ban', async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/records/carRegs/busy-slots`);
      const body = await res.json();
      assertEqual(res.status, 200, 'Route phải mở cho mọi tài khoản đã đăng nhập');
      assert(body.items.some(i => i.id === 2), 'Chuyến của Phòng Kỹ Thuật (id 2) PHẢI có mặt (đó là mục đích của route)');
    });

    await run.run('busy-slots: KHÔNG kèm điểm đến/mã phiếu/phòng ban/người đăng ký của chuyến', async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/records/carRegs/busy-slots`);
      const body = await res.json();
      const allowed = ['id', 'assignedDriverUsername', 'startTime', 'endTime', 'status'];
      for (const item of body.items) {
        const extra = Object.keys(item).filter(k => !allowed.includes(k));
        assertEqual(extra.length, 0, `Field thừa bị lộ ra: ${extra.join(', ')}`);
      }
      const raw = JSON.stringify(body);
      assert(!raw.includes('Điểm đến mật của Kỹ Thuật'), 'Điểm đến của chuyến phòng ban khác không được lộ');
      assert(!raw.includes('Nội dung nhạy cảm KT'), 'Lý do đi không được lộ');
      assert(!raw.includes('Nhân Viên KT'), 'Người đăng ký không được lộ');
      assert(!raw.includes('XE-002'), 'Mã phiếu không được lộ');
    });

    await run.run('busy-slots: chuyến ĐÃ HUỶ không chiếm chỗ (không trả về)', async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/records/carRegs/busy-slots`);
      const body = await res.json();
      assert(!body.items.some(i => i.id === 3), 'Chuyến CANCELLED phải nhả chỗ');
    });

    await run.run('busy-slots: cả chuyến PENDING lẫn APPROVED đều tính là đang chiếm chỗ', async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/records/carRegs/busy-slots`);
      const body = await res.json();
      const statuses = body.items.map(i => i.status).sort();
      assertEqual(statuses.join(','), 'APPROVED,PENDING', 'Khớp đúng quy ước isCarRegOccupying()/findCarPlateConflict()');
    });

    await run.run('busy-slots: chuyến CHƯA gán tài xế (assignedDriverUsername rỗng) không đưa vào lưới lái xe', async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/records/carRegs/busy-slots`);
      const body = await res.json();
      assert(!body.items.some(i => i.id === 4), 'Chuyến chưa gán tài xế không có ô nào để tô đỏ trên lưới theo lái xe, nên không cần trả về');
    });
  } finally {
    server.close();
  }
  run.summary();
}

main().catch(err => { console.error('FATAL:', err); process.exitCode = 1; });
