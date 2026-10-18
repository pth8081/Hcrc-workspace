// server/tests/test-meeting-conflict-code-leak.js
//
// Re-audit lần 4 (mức TB): lỗi 409 "Phòng đã có lịch trùng khung giờ này" lúc tạo mới/sửa/duyệt lịch
// Đặt Phòng Họp trước đây NÊU KÈM `conflict.code` (mã hồ sơ) của cuộc họp đang chiếm phòng — nhưng check
// trùng phòng (findMeetingConflict(), lib/createValidation.js) ĐỌC TOÀN BỘ collection "meetings" không
// lọc theo quyền xem (đúng — phải biết lịch của MỌI phòng ban để chặn trùng thật), trong khi
// canViewMeeting() (lib/recordViewScope.js) gác quyền XEM 1 lịch cụ thể theo phòng ban/người tạo/tham
// dự. Hệ quả: 1 nhân viên phòng ban A đặt/sửa lịch trùng giờ với 1 cuộc họp của phòng ban B (họ KHÔNG
// có quyền xem) vẫn nhận lại đúng MÃ HỒ SƠ của cuộc họp đó qua thông báo lỗi — lộ sự tồn tại + mã cuộc
// họp phòng ban khác cho người không có quyền xem nó.
//
// Đã bỏ `(${conflict.code})` khỏi CẢ 4 điểm phát sinh thông báo này:
//   - lib/createValidation.js: meetings.extraValidate (lúc TẠO MỚI)
//   - routes/meetingActions.js: nhánh approve (lúc DUYỆT, check lại trùng phòng tại thời điểm duyệt)
//   - routes/meetingActions.js: PUT /:id early-conflict (lúc SỬA, check trước khi vào khoá)
//   - routes/meetingActions.js: PUT /:id in-lock conflict (lúc SỬA, check lại trong khoá)
//
// PHẦN A: test THUẦN validateAndPrepareCreate('meetings', ...) — lúc TẠO MỚI.
// PHẦN B: test HTTP thật qua routes/meetingActions.js (mount thật) — lúc DUYỆT/SỬA, cùng khuôn
// test-meeting-edit-route.js.
//
// Chạy: node server/tests/test-meeting-conflict-code-leak.js
'use strict';
const assert = require('assert');
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

const { createRunner, assertEqual, assert: assertTrue } = require('./testHarness');

// ===== PHẦN A: validateAndPrepareCreate('meetings', ...) lúc TẠO MỚI =====

async function runPartA(run) {
  delete require.cache[require.resolve('../lib/createValidation')];
  const { validateAndPrepareCreate } = require('../lib/createValidation');

  const USER = { username: 'nv_a', name: 'NV Phòng A', dept: 'Phòng A', perms: { meetingBook: true } };
  const APPROVER = { username: 'tp_a', name: 'TP Phòng A', dept: 'Phòng A', perms: { meetingApprove: true } };
  const APP_DATA = {
    meetingRooms: [{ id: 1, name: 'Phòng Họp Lớn' }],
    users: [USER, APPROVER],
    formTemplates: {}
  };
  // Cuộc họp CHIẾM PHÒNG thuộc Phòng B, mã "PH-BI-MAT-999" — USER (Phòng A) KHÔNG có quyền xem lịch này
  // (canViewMeeting() chỉ cho creator/cùng phòng ban/approver/tham dự).
  const EXISTING = [{
    id: 1, code: 'PH-BI-MAT-999', dept: 'Phòng B', room: 'Phòng Họp Lớn', status: 'APPROVED',
    creator: 'nv_b', startTime: '2026-10-20T08:00', endTime: '2026-10-20T09:00'
  }];

  await run.run('PHẦN A — LỖI ĐÃ VÁ: tạo mới trùng phòng -> 409 nhưng KHÔNG lộ mã hồ sơ cuộc họp (phòng ban khác) đang chiếm phòng', async () => {
    const payload = {
      dept: 'Phòng A', room: 'Phòng Họp Lớn', title: 'Họp mới', attendees: 3,
      startTime: '2026-10-20T08:30', endTime: '2026-10-20T09:30', customData: {}
    };
    let caught = null;
    try {
      validateAndPrepareCreate('meetings', payload, USER, EXISTING, APP_DATA);
    } catch (err) {
      caught = err;
    }
    assertTrue(!!caught, 'phải báo lỗi (409 trùng phòng)');
    assertEqual(caught.status, 409);
    assertTrue(/trùng khung giờ/.test(caught.message), 'thông báo phải vẫn nêu rõ lý do trùng khung giờ');
    assertTrue(!caught.message.includes('PH-BI-MAT-999'), `LỖI: thông báo lộ mã hồ sơ cuộc họp phòng ban khác -> "${caught.message}"`);
  });

  await run.run('PHẦN A — đối chứng: KHÔNG trùng phòng -> tạo thành công bình thường (không bị chặn oan)', () => {
    const payload = {
      dept: 'Phòng A', room: 'Phòng Họp Lớn', title: 'Họp khác giờ', attendees: 3,
      startTime: '2026-10-20T10:00', endTime: '2026-10-20T11:00', customData: {}
    };
    const item = validateAndPrepareCreate('meetings', payload, USER, EXISTING, APP_DATA);
    assertEqual(item.room, 'Phòng Họp Lớn');
  });
}

// ===== PHẦN B: HTTP thật qua routes/meetingActions.js — lúc DUYỆT/SỬA =====

async function runPartB(run) {
  const CREATOR = { username: 'nv_a', name: 'NV Phòng A', dept: 'Phòng A', active: true, perms: { meetingBook: true } };
  const APPROVER = { username: 'tp_a', name: 'TP Phòng A', dept: 'Phòng A', active: true, perms: { meetingApprove: true } };
  let currentActor = CREATOR;

  function makeMeetings() {
    return [
      {
        id: 1, code: 'PH-001', dept: 'Phòng A', room: 'Phòng Họp Lớn', title: 'Lịch của mình',
        startTime: '2026-10-20T08:00', endTime: '2026-10-20T09:00', status: 'PENDING',
        creator: 'nv_a', creatorName: 'NV Phòng A', agenda: '', attendees: 3, customData: {}
      },
      // Cuộc họp chiếm phòng, thuộc Phòng B (KHÔNG liên quan tới CREATOR) — mã "PH-MAT-002" không được
      // phép lộ ra qua bất kỳ thông báo lỗi nào CREATOR nhận được.
      {
        id: 2, code: 'PH-MAT-002', dept: 'Phòng B', room: 'Phòng Họp Lớn', title: 'Lịch phòng khác',
        startTime: '2026-10-20T10:00', endTime: '2026-10-20T11:00', status: 'APPROVED',
        creator: 'nv_b', creatorName: 'NV Phòng B', agenda: '', attendees: 2, customData: {}
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
    getAllAppData: async () => ({ meetingRooms: [{ id: 1, name: 'Phòng Họp Lớn' }], formTemplates: {} })
  });

  delete require.cache[require.resolve('../routes/meetingActions')];
  const express = require('express');
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

  async function post(port, urlPath) {
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  const server = await startApp();
  const port = server.address().port;
  try {
    await run.run('PHẦN B — LỖI ĐÃ VÁ: PUT /:id (sửa) đổi sang giờ/phòng đã bị cuộc họp phòng ban KHÁC chiếm -> 409 KHÔNG lộ mã hồ sơ của họ', async () => {
      MEETINGS = makeMeetings();
      const { status, json } = await put(port, 1, {
        dept: 'Phòng A', room: 'Phòng Họp Lớn', title: 'Đổi giờ trùng', attendees: 3,
        startTime: '2026-10-20T10:30', endTime: '2026-10-20T11:30', customData: {}
      });
      assertEqual(status, 409);
      assertTrue(/trùng khung giờ/.test(json.error || ''), JSON.stringify(json));
      assertTrue(!(json.error || '').includes('PH-MAT-002'), `LỖI: PUT lộ mã hồ sơ -> "${json.error}"`);
    });

    await run.run('PHẦN B — đối chứng: PUT /:id sửa KHÔNG trùng giờ -> thành công bình thường', async () => {
      MEETINGS = makeMeetings();
      const { status, json } = await put(port, 1, {
        dept: 'Phòng A', room: 'Phòng Họp Lớn', title: 'Sửa tiêu đề thôi', attendees: 3,
        startTime: '2026-10-20T08:00', endTime: '2026-10-20T09:00', customData: {}
      });
      assertEqual(status, 200, JSON.stringify(json));
      assertEqual(json.item.title, 'Sửa tiêu đề thôi');
    });

    await run.run('PHẦN B — LỖI ĐÃ VÁ: POST /:id/approve khi phòng đã bị chiếm bởi lịch KHÁC (check lại lúc duyệt) -> 409 KHÔNG lộ mã hồ sơ', async () => {
      // Dựng lại tình huống: lịch #1 (Phòng A, PENDING) đổi sang CHIẾM đúng giờ/phòng của lịch #2 (Phòng
      // B) ngay trước khi duyệt (race thật: lịch #2 được tạo/duyệt SAU khi #1 đã PENDING nhưng TRƯỚC khi
      // #1 được duyệt) — findMeetingConflict() tại nhánh approve phải bắt được, không lộ mã #2.
      MEETINGS = makeMeetings();
      MEETINGS[0].startTime = '2026-10-20T10:00';
      MEETINGS[0].endTime = '2026-10-20T11:00';
      currentActor = APPROVER;
      const { status, json } = await post(port, '/api/meetings/1/approve');
      assertEqual(status, 409, JSON.stringify(json));
      assertTrue(/trùng khung giờ/.test(json.error || ''), JSON.stringify(json));
      assertTrue(!(json.error || '').includes('PH-MAT-002'), `LỖI: approve lộ mã hồ sơ -> "${json.error}"`);
    });

    run.summary();
  } finally {
    server.close();
  }
}

async function main() {
  const run = createRunner();
  await runPartA(run);
  await runPartB(run);
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
