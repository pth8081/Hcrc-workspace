// server/tests/test-doc-upload-publish.js
//
// Regression test cho đợt "6-module" (10/2026), phần Tài Liệu (task cuối cùng của đợt):
//   1. uploadAll: bỏ hẳn cặp cũ uploadAll(bool)+uploadDepts(mảng) — giờ CHỈ còn 1 cờ phẳng boolean DUY
//      NHẤT, tự khoá đúng phòng ban người tải lên (forceOwnDept), cùng khuôn 5 module trước
//      (meetingBook/submissionCreate/contractCreate/carCreate/officeCreate).
//   2. "Phát Hành" tài liệu (TÍNH NĂNG MỚI) — 3 quyền ĐỘC LẬP hẳn với uploadAll:
//        - docPublish: ai được bấm Phát Hành/Hủy Phát Hành 1 PHIÊN BẢN cụ thể (publishDoc()/
//          unpublishDoc(), lib/recordActions.js). Publish yêu cầu status APPROVED; Unpublish không.
//        - docViewPublished/docDownloadPublished: ai được xem/tải BẤT KỲ phiên bản ĐÃ PHÁT HÀNH, bất kể
//          phòng ban/quy trình duyệt gốc — THÊM 1 nhánh "HOẶC" độc lập vào canViewDoc()/
//          canDownloadRecordFile() (lib/recordViewScope.js), KHÔNG thay thế các lớp quyền cũ.
//      RIÊNG TỪNG BẢN GHI VERSION — published KHÔNG lan sang version khác của cùng họ tài liệu.
//
// Test THUẦN Node (không Playwright): gọi THẲNG hàm thật của lib/createValidation.js +
// lib/recordActions.js + lib/recordViewScope.js với dữ liệu dựng sẵn trong bộ nhớ.
//
// Chạy: node server/tests/test-doc-upload-publish.js
const assert = require('assert');

const { validateAndPrepareCreate } = require('../lib/createValidation');
const recordActions = require('../lib/recordActions');
const { canViewDoc, canDownloadRecordFile } = require('../lib/recordViewScope');

const DEPT_A = 'Kinh Doanh';
const DEPT_B = 'IT';
const GOOD_URL = '/uploads/1717171717171-0123456789abcdef.pdf';
const APP_DATA_EMPTY = { depts: [DEPT_A, DEPT_B], cats: ['Quy trình'], formTemplates: {}, docCatAbbrs: {}, deptAbbrs: {} };

const results = [];
function run(name, fn) {
  try { fn(); results.push({ name, pass: true }); console.log(`PASS  ${name}`); }
  catch (e) { results.push({ name, pass: false, err: e }); console.log(`FAIL  ${name}\n      ${e.message}`); }
}
function expectHttpError(fn, status, msgPart) {
  try {
    fn();
    throw new Error(`Kỳ vọng throw status ${status} nhưng không throw gì cả`);
  } catch (e) {
    if (e.message && e.message.startsWith('Kỳ vọng throw')) throw e;
    assert.strictEqual(e.status, status, `status sai: kỳ vọng ${status}, được ${e.status} (${e.message})`);
    if (msgPart) assert.ok(e.message.includes(msgPart), `message "${e.message}" không chứa "${msgPart}"`);
    return e;
  }
}

const docPayload = (over) => ({
  dept: DEPT_A, cat: 'Quy trình', title: 'Quy trình ISO', ver: '1.0',
  fileUrl: GOOD_URL, fileName: 'x.pdf', rootDocId: null, ...over
});

console.log('\n===== 1) uploadAll (forceOwnDept) — gộp phẳng, bỏ uploadDepts =====');

run('1a. KHÔNG có uploadAll -> 403 "Bạn không có quyền tải lên tài liệu"', () => {
  const user = { username: 'u1', name: 'User1', dept: DEPT_A, perms: {} };
  expectHttpError(() => validateAndPrepareCreate('docs', docPayload({}), user, [], APP_DATA_EMPTY),
    403, 'không có quyền tải lên tài liệu');
});
run('1b. Có uploadAll:true + dept đúng phòng mình -> tạo được bình thường', () => {
  const user = { username: 'u1', name: 'User1', dept: DEPT_A, perms: { uploadAll: true } };
  const rec = validateAndPrepareCreate('docs', docPayload({}), user, [], APP_DATA_EMPTY);
  assert.strictEqual(rec.dept, DEPT_A);
});
run('1c. Có uploadAll:true nhưng gửi dept KHÁC phòng mình -> forceOwnDept tự ép về đúng phòng mình (KHÔNG throw, KHÔNG tin payload.dept)', () => {
  const user = { username: 'u1', name: 'User1', dept: DEPT_A, perms: { uploadAll: true } };
  const rec = validateAndPrepareCreate('docs', docPayload({ dept: DEPT_B }), user, [], APP_DATA_EMPTY);
  assert.strictEqual(rec.dept, DEPT_A, 'dept phải bị ép về đúng phòng ban của người tải lên, không tin payload.dept gửi lên');
});
run('1d. admin KHÔNG cần uploadAll vẫn tạo được (admin bypass)', () => {
  const admin = { username: 'admin', name: 'Admin', dept: DEPT_A, perms: { admin: true } };
  const rec = validateAndPrepareCreate('docs', docPayload({}), admin, [], APP_DATA_EMPTY);
  assert.strictEqual(rec.dept, DEPT_A);
});
run('1e. Tài liệu MỚI (bản gốc lẫn version) luôn bắt đầu published=false', () => {
  const user = { username: 'u1', name: 'User1', dept: DEPT_A, perms: { uploadAll: true } };
  const rec = validateAndPrepareCreate('docs', docPayload({}), user, [], APP_DATA_EMPTY);
  assert.strictEqual(rec.published, false);
});

console.log('\n===== 2) publishDoc()/unpublishDoc() — "Phát Hành" tài liệu =====');

const makeApprovedDoc = (over) => ({
  id: 1, uploader: 'u1', status: 'APPROVED', dept: DEPT_A, title: 'Quy trình ISO',
  fileUrl: GOOD_URL, fileName: 'x.pdf', published: false, history: [], ...over
});

run('2a. KHÔNG có docPublish -> publishDoc() 403', () => {
  const user = { username: 'u2', name: 'User2', dept: DEPT_A, perms: {} };
  expectHttpError(() => recordActions.publishDoc(user, makeApprovedDoc()), 403, 'không có quyền phát hành');
});
run('2b. Có docPublish nhưng status KHÔNG phải APPROVED -> 409', () => {
  const user = { username: 'u2', name: 'User2', dept: DEPT_A, perms: { docPublish: true } };
  expectHttpError(() => recordActions.publishDoc(user, makeApprovedDoc({ status: 'PENDING' })), 409, 'đã duyệt xong');
});
run('2c. Có docPublish + status APPROVED -> publish thành công, set published/publishedBy/publishedAt + lịch sử', () => {
  const user = { username: 'u2', name: 'User2', dept: DEPT_A, perms: { docPublish: true } };
  const doc = makeApprovedDoc();
  const result = recordActions.publishDoc(user, doc);
  assert.strictEqual(result.published, true);
  assert.strictEqual(result.publishedBy, 'u2');
  assert.ok(result.publishedAt);
  assert.ok(result.history.some(h => h.action === 'PUBLISHED'));
});
run('2d. Đã published rồi -> publish lại lần 2 bị chặn 409', () => {
  const user = { username: 'u2', name: 'User2', dept: DEPT_A, perms: { docPublish: true } };
  const doc = makeApprovedDoc({ published: true });
  expectHttpError(() => recordActions.publishDoc(user, doc), 409, 'đã được phát hành rồi');
});
run('2e. admin KHÔNG cần docPublish vẫn publish được (admin bypass)', () => {
  const admin = { username: 'admin', name: 'Admin', dept: DEPT_A, perms: { admin: true } };
  const doc = makeApprovedDoc();
  const result = recordActions.publishDoc(admin, doc);
  assert.strictEqual(result.published, true);
});
run('2f. KHÔNG có docPublish -> unpublishDoc() 403', () => {
  const user = { username: 'u2', name: 'User2', dept: DEPT_A, perms: {} };
  expectHttpError(() => recordActions.unpublishDoc(user, makeApprovedDoc({ published: true })), 403, 'không có quyền hủy phát hành');
});
run('2g. Chưa published -> unpublish bị chặn 409', () => {
  const user = { username: 'u2', name: 'User2', dept: DEPT_A, perms: { docPublish: true } };
  expectHttpError(() => recordActions.unpublishDoc(user, makeApprovedDoc({ published: false })), 409, 'chưa được phát hành');
});
run('2h. Có docPublish + đang published -> unpublish thành công, set published=false + lịch sử', () => {
  const user = { username: 'u2', name: 'User2', dept: DEPT_A, perms: { docPublish: true } };
  const doc = makeApprovedDoc({ published: true });
  const result = recordActions.unpublishDoc(user, doc);
  assert.strictEqual(result.published, false);
  assert.ok(result.history.some(h => h.action === 'UNPUBLISHED'));
});

console.log('\n===== 3) canViewDoc(): nhánh "Phát Hành" ĐỘC LẬP, chỉ THÊM không thay thế =====');

const outsider = (perms) => ({ username: 'outsider', dept: DEPT_B, perms: perms || {} });

run('3a. Người NGOÀI phạm vi (khác phòng, không phải uploader/approver) + docViewPublished + doc.published=true -> xem được', () => {
  const doc = makeApprovedDoc({ published: true });
  assert.strictEqual(canViewDoc(outsider({ docViewPublished: true }), doc, {}), true);
});
run('3b. Người NGOÀI phạm vi KHÔNG có docViewPublished, dù doc.published=true -> vẫn KHÔNG xem được (quyền không tự cấp cho ai)', () => {
  const doc = makeApprovedDoc({ published: true });
  assert.strictEqual(canViewDoc(outsider({}), doc, {}), false);
});
run('3c. Người NGOÀI phạm vi có docViewPublished nhưng doc.published=false -> KHÔNG xem được (nhánh chỉ áp dụng tài liệu ĐÃ phát hành)', () => {
  const doc = makeApprovedDoc({ published: false });
  assert.strictEqual(canViewDoc(outsider({ docViewPublished: true }), doc, {}), false);
});
run('3d. uploader vẫn xem được tài liệu của chính mình như cũ, không bị ảnh hưởng bởi nhánh published', () => {
  const doc = makeApprovedDoc({ published: false });
  const uploaderUser = { username: 'u1', dept: DEPT_A, perms: {} };
  assert.strictEqual(canViewDoc(uploaderUser, doc, {}), true);
});

console.log('\n===== 4) canDownloadRecordFile(): nhánh "Phát Hành" ĐỘC LẬP cho tải xuống =====');

run('4a. published=true + docDownloadPublished:true -> tải được dù khác phòng ban/không phải chủ', () => {
  const user = { username: 'outsider', perms: { docDownloadPublished: true } };
  assert.strictEqual(canDownloadRecordFile(user, 'doc', DEPT_A, 'u1', true), true);
});
run('4b. published=true nhưng KHÔNG có docDownloadPublished -> vẫn bị chặn (rơi về nhánh scopeAllows cũ, không có docDownload scope -> false)', () => {
  const user = { username: 'outsider', perms: {} };
  assert.strictEqual(canDownloadRecordFile(user, 'doc', DEPT_A, 'u1', true), false);
});
run('4c. published=false (hoặc không truyền) dù có docDownloadPublished -> KHÔNG áp dụng nhánh này, vẫn rơi về luật cũ', () => {
  const user = { username: 'outsider', perms: { docDownloadPublished: true } };
  assert.strictEqual(canDownloadRecordFile(user, 'doc', DEPT_A, 'u1', false), false);
  assert.strictEqual(canDownloadRecordFile(user, 'doc', DEPT_A, 'u1'), false);
});
run('4d. Lời gọi CŨ không truyền tham số published (các module khác: car/office/submission/contract) không bị ảnh hưởng', () => {
  const user = { username: 'outsider', perms: { carDownload: { all: true, depts: [] } } };
  assert.strictEqual(canDownloadRecordFile(user, 'car', DEPT_A, 'u1'), true);
});
run('4e. Chủ sở hữu (ownerUsername khớp) vẫn luôn tải được, không phụ thuộc published', () => {
  const user = { username: 'u1', perms: {} };
  assert.strictEqual(canDownloadRecordFile(user, 'doc', DEPT_A, 'u1', false), true);
});

console.log('\n===== 5) Cô lập theo TỪNG bản ghi version — published KHÔNG lan sang version khác =====');

run('5a. Publish version 1 KHÔNG tự động published version 2 của cùng họ tài liệu', () => {
  const root = makeApprovedDoc({ id: 10, rootDocId: null, versionNumber: 1 });
  const v2 = makeApprovedDoc({ id: 11, rootDocId: 10, versionNumber: 2 });
  const user = { username: 'u2', dept: DEPT_A, perms: { docPublish: true } };
  recordActions.publishDoc(user, root);
  assert.strictEqual(root.published, true);
  assert.strictEqual(v2.published, false, 'version khác KHÔNG bị ảnh hưởng bởi publish của version 1');
});

console.log('');
const passed = results.filter(r => r.pass).length;
const total = results.length;
console.log(`==== ${passed}/${total} scenario(s) passed${passed < total ? `, ${total - passed} FAILED` : ''} ====`);
if (passed < total) process.exitCode = 1;
