// tests/test-training-question-images.js — Kiểm thử hồi quy THUẦN NODE (không Playwright) cho phần
// SERVER của "Ngân Hàng Câu Hỏi hỗ trợ ảnh minh hoạ câu hỏi" (Đào Tạo, Phần 1/3):
//
//   1. lib/createValidation.js (trainingTests.extraValidate qua validateAndPrepareCreate()) — imageUrl
//      hợp lệ ("/uploads/...") được chấp nhận nguyên vẹn; scheme javascript:/data:/URL ngoài hệ thống bị
//      từ chối 400 (CÙNG lỗ hổng stored-XSS đã vá cho mọi field file khác trong file này).
//   2. lib/fileAuthz.js (mode 'view'/'download', nhánh owning.trainingTestQuestion) — chỉ
//      trainingManage/admin, giảng viên được gán cho 1 lớp dùng đúng bài test đó, hoặc học viên đang có
//      đăng ký còn hiệu lực vào 1 lớp như vậy mới xem/tải được ảnh câu hỏi; người ngoài cuộc (dù đã đăng
//      nhập) bị từ chối — kể cả khi bài test CHƯA gán cho lớp nào.
//   3. lib/trainingTestImport.js — parse mẫu Excel nhập câu hỏi hàng loạt ra đúng dữ liệu preview
//      (text/loại/điểm/đáp án/đáp án đúng/tham chiếu ảnh).
//
// Test THUẦN NODE: lib/recordStore + lib/appData được thay bằng bản giả cắm vào require.cache TRƯỚC khi
// require lib/fileAuthz (cùng khuôn tests/test-itprice-download.js) — code nghiệp vụ THẬT chạy nguyên
// bản, không phải bản chép lại gần giống.
//
// Chạy: node server/tests/test-training-question-images.js
const assert = require('assert');
const ExcelJS = require('exceljs');

let passed = 0, failed = 0;
async function run(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`);
  }
}

function stubModule(relPath, exportsObj) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true, children: [], paths: [], exports: exportsObj
  };
  return resolved;
}

// ===================== Người dùng =====================
const MANAGER = { username: 'gv.linh', name: 'Trần Thị Linh', dept: 'Phòng Nhân Sự', perms: { trainingManage: true } };
const INSTRUCTOR_A = { username: 'gv.a', name: 'Giảng Viên A', dept: 'Phòng CNTT', perms: { trainingInstruct: true } };
const INSTRUCTOR_B = { username: 'gv.b', name: 'Giảng Viên B', dept: 'Phòng Kế Toán', perms: { trainingInstruct: true } };
const STUDENT_ENROLLED = { username: 'nv1', name: 'Học Viên Một', dept: 'Phòng CNTT', perms: {} };
const STUDENT_CANCELLED = { username: 'nv2', name: 'Học Viên Hai', dept: 'Phòng CNTT', perms: {} };
const OUTSIDER = { username: 'nv3', name: 'Người Ngoài Cuộc', dept: 'Phòng Kế Toán', perms: {} };

const TEST_WITH_IMAGE = {
  id: 1, title: 'Bài Test An Toàn', category: '',
  questions: [
    { id: 1, text: 'Câu 1', type: 'SINGLE', options: [{ id: 1, text: 'A' }, { id: 2, text: 'B' }], correctOptionIds: [1], points: 1, imageUrl: '/uploads/1234-abcdef0123456789.png' }
  ]
};
const TEST_WITHOUT_CLASS = {
  id: 2, title: 'Bài Test Chưa Gán Lớp', category: '',
  questions: [
    { id: 1, text: 'Câu 1', type: 'SINGLE', options: [{ id: 1, text: 'A' }, { id: 2, text: 'B' }], correctOptionIds: [1], points: 1, imageUrl: '/uploads/9999-fedcba9876543210.png' }
  ]
};
const CLASS_A = { id: 100, testId: 1, instructorUsername: INSTRUCTOR_A.username };
const REG_ENROLLED = { id: 200, classId: 100, creator: STUDENT_ENROLLED.username, result: 'REGISTERED' };
const REG_CANCELLED = { id: 201, classId: 100, creator: STUDENT_CANCELLED.username, result: 'CANCELLED' };

const COLLECTIONS = {
  trainingTests: [TEST_WITH_IMAGE, TEST_WITHOUT_CLASS],
  trainingClasses: [CLASS_A],
  trainingRegistrations: [REG_ENROLLED, REG_CANCELLED]
};
// Các collection khác findOwningRecord() cũng đọc — rỗng cho gọn, không liên quan tới test này.
const EMPTY_COLLECTIONS = ['docs', 'submissions', 'contracts', 'carRegs', 'officeReqs', 'internalPosts',
  'itPriceApprovals', 'reportEntries', 'reportPeriods', 'recruitmentReferrals', 'licenses',
  'itServiceRenewals', 'operationOrders', 'operationStoreOpenings', 'operationRepairs'];

stubModule('../lib/recordStore', {
  getAllForCollection: async (name) => COLLECTIONS[name] || (EMPTY_COLLECTIONS.includes(name) ? [] : []),
  getAllTrashItemsCached: async () => []
});
stubModule('../lib/appData', {
  getAllAppData: async () => ({}),
  getAppDataValue: async () => ({})
});

const { authorizeFileAccess } = require('../lib/fileAuthz');
const { validateAndPrepareCreate, CreateError } = require('../lib/createValidation');
const { buildTestImportTemplateWorkbook, parseTestImportFile } = require('../lib/trainingTestImport');

function baseTestPayload(imageUrl) {
  return {
    title: 'Bài Test Mẫu',
    category: '',
    questions: [
      { text: 'Câu hỏi có ảnh?', type: 'SINGLE', options: [{ text: 'Có' }, { text: 'Không' }], correctOptionIds: [1], points: 1, imageUrl }
    ]
  };
}

async function main() {
  // ===================== 1. lib/createValidation.js — imageUrl =====================
  await run('trainingTests.extraValidate chấp nhận imageUrl hợp lệ (/uploads/...)', () => {
    const record = validateAndPrepareCreate('trainingTests', baseTestPayload('/uploads/1700000000000-abcdef0123456789.png'), MANAGER, [], {});
    assert.strictEqual(record.questions[0].imageUrl, '/uploads/1700000000000-abcdef0123456789.png');
  });

  await run('trainingTests.extraValidate chấp nhận câu hỏi KHÔNG có ảnh (imageUrl rỗng) — không đổi hành vi cũ', () => {
    const record = validateAndPrepareCreate('trainingTests', baseTestPayload(''), MANAGER, [], {});
    assert.strictEqual(record.questions[0].imageUrl, '');
  });

  await run('trainingTests.extraValidate TỪ CHỐI imageUrl scheme javascript: (stored-XSS)', () => {
    assert.throws(
      () => validateAndPrepareCreate('trainingTests', baseTestPayload('javascript:alert(document.cookie)'), MANAGER, [], {}),
      (err) => err instanceof CreateError && err.status === 400
    );
  });

  await run('trainingTests.extraValidate TỪ CHỐI imageUrl trỏ ra URL ngoài hệ thống', () => {
    assert.throws(
      () => validateAndPrepareCreate('trainingTests', baseTestPayload('https://evil.example.com/x.png'), MANAGER, [], {}),
      (err) => err instanceof CreateError && err.status === 400
    );
  });

  await run('trainingTests.extraValidate TỪ CHỐI imageUrl chứa path traversal', () => {
    assert.throws(
      () => validateAndPrepareCreate('trainingTests', baseTestPayload('/uploads/../../etc/passwd'), MANAGER, [], {}),
      (err) => err instanceof CreateError && err.status === 400
    );
  });

  // ===================== 2. lib/fileAuthz.js — access control =====================
  const imgUrl = TEST_WITH_IMAGE.questions[0].imageUrl;

  await run('authorizeFileAccess: trainingManage xem được ảnh câu hỏi (mode view)', async () => {
    assert.strictEqual(await authorizeFileAccess(MANAGER, imgUrl, 'view'), true);
  });
  await run('authorizeFileAccess: giảng viên được gán cho lớp dùng đúng bài test xem được (mode download)', async () => {
    assert.strictEqual(await authorizeFileAccess(INSTRUCTOR_A, imgUrl, 'download'), true);
  });
  await run('authorizeFileAccess: giảng viên KHÁC (không được gán lớp này) KHÔNG xem được', async () => {
    assert.strictEqual(await authorizeFileAccess(INSTRUCTOR_B, imgUrl, 'view'), false);
  });
  await run('authorizeFileAccess: học viên đang đăng ký còn hiệu lực (REGISTERED) xem được', async () => {
    assert.strictEqual(await authorizeFileAccess(STUDENT_ENROLLED, imgUrl, 'view'), true);
  });
  await run('authorizeFileAccess: học viên đã HUỶ đăng ký (CANCELLED) KHÔNG còn xem được', async () => {
    assert.strictEqual(await authorizeFileAccess(STUDENT_CANCELLED, imgUrl, 'view'), false);
  });
  await run('authorizeFileAccess: người ngoài cuộc (đã đăng nhập, không liên quan) KHÔNG xem được — không rơi vào FAIL-OPEN', async () => {
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, imgUrl, 'view'), false);
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, imgUrl, 'download'), false);
  });
  await run('authorizeFileAccess: bài test CHƯA gán cho lớp nào — chỉ trainingManage/admin xem được, người ngoài bị từ chối', async () => {
    const imgUrl2 = TEST_WITHOUT_CLASS.questions[0].imageUrl;
    assert.strictEqual(await authorizeFileAccess(MANAGER, imgUrl2, 'view'), true);
    assert.strictEqual(await authorizeFileAccess(STUDENT_ENROLLED, imgUrl2, 'view'), false);
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, imgUrl2, 'view'), false);
  });
  await run('authorizeFileAccess: URL không khớp bất kỳ ảnh câu hỏi nào vẫn theo nhánh FAIL-OPEN cũ (không đổi hành vi module khác)', async () => {
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, '/uploads/khong-lien-quan-gi.png', 'view'), true);
  });

  // ===================== 3. lib/trainingTestImport.js — parse Excel =====================
  await run('parseTestImportFile đọc đúng file mẫu do buildTestImportTemplateWorkbook() sinh ra', async () => {
    const wb = await buildTestImportTemplateWorkbook();
    const buffer = await wb.xlsx.writeBuffer();
    const items = await parseTestImportFile(Buffer.from(buffer), '.xlsx');
    assert.strictEqual(items.length, 2, 'mẫu có 2 dòng ví dụ');
    assert.strictEqual(items[0].type, 'SINGLE');
    assert.strictEqual(items[0].options.length, 4);
    assert.deepStrictEqual(items[0].correctIndexes, [1]);
    assert.strictEqual(items[0].imageRef, 'bien-bao-1.png');
    assert.strictEqual(items[0].valid, true);
    assert.strictEqual(items[1].type, 'MULTI');
    assert.deepStrictEqual(items[1].correctIndexes, [3, 4]);
    assert.strictEqual(items[1].imageRef, '');
  });

  await run('parseTestImportFile đánh dấu KHÔNG hợp lệ dòng thiếu đáp án đúng/thiếu đáp án', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Câu Hỏi');
    sheet.addRow(['Nội Dung Câu Hỏi', 'Loại (1 đáp án đúng / Nhiều đáp án đúng)', 'Điểm', 'Các Đáp Án (cách nhau bằng ;)', 'Đáp Án Đúng (số thứ tự, cách nhau bằng ;)', 'Ảnh (đường dẫn /uploads/... hoặc tên tệp đã tải ở bước 2)']);
    sheet.addRow(['Câu thiếu đáp án đúng', '', 1, 'A; B', '', '']);
    sheet.addRow(['Câu chỉ có 1 đáp án', '', 1, 'A', '1', '']);
    const buffer = await wb.xlsx.writeBuffer();
    const items = await parseTestImportFile(Buffer.from(buffer), '.xlsx');
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].valid, false);
    assert.strictEqual(items[1].valid, false);
  });

  await run('parseTestImportFile báo lỗi rõ ràng khi thiếu cột "Nội Dung Câu Hỏi"', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Câu Hỏi');
    sheet.addRow(['Cột Lạ']);
    sheet.addRow(['abc']);
    const buffer = await wb.xlsx.writeBuffer();
    let threw = false;
    try {
      await parseTestImportFile(Buffer.from(buffer), '.xlsx');
    } catch (err) {
      threw = true;
      assert.ok(/Nội Dung Câu Hỏi/.test(err.message));
    }
    assert.ok(threw, 'phải throw khi thiếu cột bắt buộc');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
