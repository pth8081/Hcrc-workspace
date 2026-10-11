// server/tests/test-office-extra-files.js
//
// Tính năng mới (11/2026): "Tệp Đính Kèm Đề Xuất" — multi-file upload TUỲ CHỌN (không bắt buộc) ngay lúc
// tạo Phiếu Đề Xuất ở module Văn Phòng Tổng Hợp (Mua Bán/Sửa Chữa), lưu vào officeReqs.extraFiles[] —
// mirror ĐÚNG khuôn submissions.extraFiles đã có sẵn (xem createValidation.js, fileAuthz.js).
//
// Phần 1 (pure, không DB): CREATE_MODULE_CONFIGS.officeReqs.extraValidate() — validate/chuẩn hoá payload
//   lúc tạo, cùng khuôn test-office-tech-confirm.js.
// Phần 2 (stub DB qua require.cache, mirror test-office-reqs-scope.js): findOwningRecord()
//   (lib/fileAuthz.js) phải khớp ĐÚNG hồ sơ officeReqs sở hữu tệp qua extraFiles[] — không rơi vào nhánh
//   FAIL-OPEN (lỗ hổng đã vá nhiều lần cho các field tương tự ở module khác, xem lịch sử lib/fileAuthz.js).
//
// Chạy: node server/tests/test-office-extra-files.js
'use strict';
const assert = require('assert');
const path = require('path');

let passed = 0, failed = 0;
// async-safe: "await fn()" vẫn bắt được lỗi throw ĐỒNG BỘ (xảy ra trước điểm await) lẫn Promise bị
// reject (fn() là callback async, dùng ở Phần 2) — dùng ĐÚNG 1 hàm test() cho cả 2 phần, không cần tách
// riêng testAsync() như vài file test khác.
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

// ===================== Phần 1: createValidation.js (pure, không DB) =====================
{
  const { CREATE_MODULE_CONFIGS, CreateError } = require('../lib/createValidation');
  const CREATOR = { username: 'nv1', name: 'Nhân Viên E', active: true, perms: { officeCreate: true, officeBuy: true, officeFix: true } };
  const basePayload = (extra) => Object.assign({
    subType: 'MUA_BAN', dept: 'Phòng Kinh Doanh',
    items: [{ name: 'Bàn', qty: 1, unitPrice: 100000 }]
  }, extra);
  const appData = { users: [CREATOR] };

  test('officeReqs TẠO (Mua Sắm): KHÔNG chọn tệp đính kèm nào -> extraFiles = [] (không bắt buộc)', () => {
    const payload = basePayload();
    CREATE_MODULE_CONFIGS.officeReqs.extraValidate(payload, [], CREATOR, appData);
    assert.deepStrictEqual(payload.extraFiles, []);
  });

  test('officeReqs TẠO (Mua Sắm): chọn nhiều tệp hợp lệ -> giữ nguyên trong payload.extraFiles', () => {
    const payload = basePayload({
      extraFiles: [
        { fileUrl: '/uploads/abc123.pdf', fileName: 'bao-gia.pdf' },
        { fileUrl: '/uploads/def456.jpg', fileName: 'anh-hien-truong.jpg' }
      ]
    });
    CREATE_MODULE_CONFIGS.officeReqs.extraValidate(payload, [], CREATOR, appData);
    assert.strictEqual(payload.extraFiles.length, 2);
    assert.strictEqual(payload.extraFiles[0].fileName, 'bao-gia.pdf');
  });

  test('officeReqs TẠO: 1 phần tử extraFiles[] có fileUrl GIẢ MẠO (không phải đường dẫn /uploads hợp lệ) -> 400', () => {
    const payload = basePayload({
      extraFiles: [{ fileUrl: 'javascript:alert(1)', fileName: 'xau.pdf' }]
    });
    assert.throws(() => {
      CREATE_MODULE_CONFIGS.officeReqs.extraValidate(payload, [], CREATOR, appData);
    }, (err) => err instanceof CreateError && err.status === 400);
  });

  test('officeReqs TẠO: gửi hơn 20 tệp -> tự cắt còn đúng 20 (mirror submissions.extraFiles)', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ fileUrl: `/uploads/f${i}.pdf`, fileName: `f${i}.pdf` }));
    const payload = basePayload({ extraFiles: many });
    CREATE_MODULE_CONFIGS.officeReqs.extraValidate(payload, [], CREATOR, appData);
    assert.strictEqual(payload.extraFiles.length, 20);
  });

  test('officeReqs TẠO (Sửa Chữa): extraFiles vẫn hoạt động song song với field Kỹ Thuật Xác Nhận bắt buộc', () => {
    const KY_THUAT = { username: 'kt1', name: 'Kỹ Thuật B', active: true, perms: { officeFixTechMechanical: true } };
    const payload = {
      subType: 'SUA_CHUA', dept: 'Phòng Kinh Doanh', techType: 'MECHANICAL', techAssignedTo: 'kt1',
      extraFiles: [{ fileUrl: '/uploads/anh-hong-hoc.jpg', fileName: 'anh-hong-hoc.jpg' }]
    };
    CREATE_MODULE_CONFIGS.officeReqs.extraValidate(payload, [], CREATOR, { users: [CREATOR, KY_THUAT] });
    assert.strictEqual(payload.extraFiles.length, 1);
    assert.strictEqual(payload.techAssignedTo, 'kt1');
  });
}

// ===================== Phần 2: lib/fileAuthz.js findOwningRecord() (stub DB) =====================
{
  function stubModule(relPath, exportsObj) {
    const full = require.resolve(path.join(__dirname, '..', relPath));
    require.cache[full] = {
      id: full, filename: full, path: path.dirname(full),
      loaded: true, exports: exportsObj, children: [], paths: []
    };
    return exportsObj;
  }

  const DEPT_A = 'Phòng Kinh Doanh';
  const DEPT_B = 'Phòng Marketing';
  const OWNER = { username: 'owner_off', name: 'Người Tạo Đề Xuất', dept: DEPT_A, perms: {}, active: true };
  const OUTSIDER = { username: 'outsider', name: 'Người Ngoài Phạm Vi', dept: DEPT_B, perms: {}, active: true };
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
  const EXTRA_FILE_URL = '/uploads/office-extra-9f8e7d.pdf';
  const OFFICE_ITEM = {
    id: 77, code: 'MB-077', subType: 'MUA_BAN', dept: DEPT_A, creator: OWNER.username, status: 'PENDING',
    currentStep: 1, history: [],
    extraFiles: [{ fileUrl: EXTRA_FILE_URL, fileName: 'bao-gia.pdf' }]
  };
  const APP_DATA = { users: [OWNER, OUTSIDER, ADMIN], officeBuyDeptWorkflows: {}, officeFixDeptWorkflows: {} };

  // Mọi collection khác officeReqs trả rỗng — findOwningRecord() quét tuần tự, chỉ cần officeReqs có data.
  stubModule('lib/recordStore', {
    getAllForCollectionCached: async (collection) => (collection === 'officeReqs' ? [OFFICE_ITEM] : []),
    getAllForCollection: async () => [],
    getAllTrashItemsCached: async () => []
  });
  stubModule('lib/appData', {
    getAllAppData: async () => APP_DATA,
    getAppDataValue: async () => null,
    getAppDataValueCached: async () => []
  });
  stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });

  const { findOwningRecord, authorizeFileAccess } = require('../lib/fileAuthz');

  (async () => {
    await test('findOwningRecord(): tệp trong officeReqs.extraFiles[] khớp ĐÚNG hồ sơ sở hữu (moduleKey office, không rơi FAIL-OPEN)', async () => {
      const owning = await findOwningRecord(EXTRA_FILE_URL);
      assert.ok(owning, 'findOwningRecord() phải trả về owning info, không phải null (fail-open)');
      assert.strictEqual(owning.moduleKey, 'office');
      assert.strictEqual(owning.record.id, 77);
      assert.strictEqual(owning.dept, DEPT_A);
      assert.strictEqual(owning.ownerUsername, OWNER.username);
    });

    await test('authorizeFileAccess(view): người NGOÀI phạm vi (khác phòng ban, không phải người tạo) KHÔNG xem được tệp extraFiles của officeReqs', async () => {
      const allowed = await authorizeFileAccess(OUTSIDER, EXTRA_FILE_URL, 'view');
      assert.strictEqual(allowed, false);
    });

    await test('authorizeFileAccess(view): CHÍNH người tạo hồ sơ xem được tệp extraFiles của chính mình', async () => {
      const allowed = await authorizeFileAccess(OWNER, EXTRA_FILE_URL, 'view');
      assert.strictEqual(allowed, true);
    });

    await test('authorizeFileAccess(view): admin luôn xem được', async () => {
      const allowed = await authorizeFileAccess(ADMIN, EXTRA_FILE_URL, 'view');
      assert.strictEqual(allowed, true);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
  })();
}
