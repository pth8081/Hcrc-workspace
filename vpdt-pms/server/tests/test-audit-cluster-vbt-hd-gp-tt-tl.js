// server/tests/test-audit-cluster-vbt-hd-gp-tt-tl.js
//
// Regression test cho 12/16 phát hiện CÒN LẠI của đợt audit chuyên sâu cụm "Văn Bản Trình / Hợp Đồng /
// Giấy Phép / Thanh Toán / Tài Liệu" (5 Cao, 8 Trung bình, 3 Thấp — 4 lỗi Nghiêm trọng của cả đợt đã vá
// riêng ở commit 7913e5d). 4 mục còn lại được kiểm ở 2 nơi khác: cascade xoá Giấy Phép + rate-limit tải
// tệp ở tests/test-audit-cluster-license-cascade-download-limit.js (cần router HTTP thật), 2 mục email
// Văn Bản Trình là thay đổi THUẦN client (module-vanbantrinh.js).
//
// Mỗi khối dưới đây FAIL trên code TRƯỚC bản vá và PASS sau khi vá:
//   1. [Cao]  fileAuthz: tệp "Đề xuất thay thế tờ trình" (pendingFileProposal.fileUrl + history[].fileUrl)
//             KHÔNG còn rơi vào FAIL-OPEN.
//   2. [Cao]  fileAuthz: installments[].files[] của Đề Nghị Thanh Toán KHÔNG còn rơi vào FAIL-OPEN.
//   3. [Cao]  editContract(): đổi `dept` phải qua assertDeptScopeAllowed() + đối chiếu danh mục.
//   4. [Cao]  editPaymentRequest(): đổi `dept` giữa chừng duyệt -> invalidate lịch sử + reset bước, và
//             đối chiếu danh mục phòng ban (cả lúc TẠO lẫn lúc SỬA).
//   5. [Cao]  submissions: `type`/`priority` phải khớp danh mục ở server (gửi label lệch KHÔNG còn âm
//             thầm rơi về 'KHAC' để đi ít bước duyệt hơn) — cả lúc TẠO lẫn lúc SỬA NHÁP.
//   6. [TB]   CANCEL_FILE_PROPOSAL: admin / chính người đề xuất gỡ được đề xuất treo (hết deadlock).
//   7. [TB]   submitPaymentRequest(): chặn gửi khi bước 1 của phòng ban resolve ra 0 người duyệt.
//   9. [TB]   approveLicense()/rejectLicense()/setLicenseRenewing()/revokeLicense(): chặn TỰ DUYỆT.
//  10. [TB]   code/displayCode SINH LẠI Ở SERVER cho docs/submissions/contracts/licenses.
//  11. [TB]   "Nhập Hợp Đồng/Phụ Lục Đã Ký" cần quyền RIÊNG contractImportSigned.
//  12. [TB]   editSubmissionDraft(): approvalLevel bị admin xoá -> fallback cấp mặc định, KHÔNG kẹt NHÁP.
//  16. [Thấp] submissions: title/content bị .slice() giới hạn độ dài ở server.
//
// Test thuần Node (không HTTP/Playwright): gọi THẲNG các hàm thật ở lib/createValidation.js,
// lib/recordActions.js, lib/workflowEngine.js, lib/fileAuthz.js, lib/recordCodeGen.js — chỉ cắm bản giả
// cho tầng lưu trữ (lib/recordStore, lib/appData, lib/db) vào require.cache TRƯỚC khi require, đúng
// khuôn tests/test-uploads-file-authz.js.
//
// Chạy: node server/tests/test-audit-cluster-vbt-hd-gp-tt-tl.js
'use strict';
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

// ===================== Seed cho lib/fileAuthz.js (mục 1 + 2) =====================
const DEPT_A = 'Kinh Doanh';
const DEPT_B = 'Marketing';

// Tờ trình có 1 đề xuất thay thế tệp ĐANG TREO + 1 dòng lịch sử đã giữ lại fileUrl của đề xuất TRƯỚC đó
// (đề xuất cũ đã được xử lý xong nên pendingFileProposal không còn trỏ tới, nhưng file vẫn đọc được).
const SUBMISSION_WITH_PROPOSAL = {
  id: 'sub-1', code: 'HCRC-KD-VBT-001', dept: DEPT_A, creator: 'owner_sub',
  status: 'PENDING', currentStep: 2,
  fileUrl: '/uploads/sub-goc.pdf',
  extraFiles: [],
  pendingFileProposal: { fileUrl: '/uploads/sub-de-xuat-moi.pdf', fileName: 'moi.pdf', proposedBy: 'tlk1', proposedByName: 'Trợ Lý' },
  history: [
    { action: 'PROPOSE_FILE_REPLACEMENT', fileUrl: '/uploads/sub-de-xuat-cu.pdf', fileName: 'cu.pdf' },
    { action: 'FILE_PROPOSAL_DECLINED', fileUrl: '/uploads/sub-de-xuat-cu.pdf', fileName: 'cu.pdf' }
  ]
};
const PAYMENT_WITH_INSTALLMENT_FILES = {
  id: 'pr-1', dept: DEPT_A, createdBy: 'owner_pr', status: 'PENDING',
  requestFiles: [{ fileUrl: '/uploads/pr-ho-so-chung.pdf' }],
  installments: [
    { description: 'Đợt 1', amount: 1000, files: [{ fileUrl: '/uploads/pr-dot1-chung-tu.pdf', fileName: 'ct.pdf' }], confirmFileUrl: null }
  ]
};

const COLLECTIONS = {
  submissions: [SUBMISSION_WITH_PROPOSAL],
  paymentRequests: [PAYMENT_WITH_INSTALLMENT_FILES]
};

// db: lib/recordStore thật sẽ kéo theo lib/db (nối SQL Server) — chặn trước.
stubModule('db', { getPool: async () => { throw new Error('không dùng DB trong test này'); }, sql: {} });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(COLLECTIONS)),
  getAllForCollection: async (name) => COLLECTIONS[name] || [],
  getAllForCollectionCached: async (name) => COLLECTIONS[name] || [],
  getAllTrashItemsCached: async () => [],
  // CODE_SEQ_SUFFIX_RE/computeNextSeqForPrefix — lib/createValidation.js require thật từ recordStore.
  CODE_SEQ_SUFFIX_RE: /^(.*?)(\d+)$/,
  computeNextSeqForPrefix: (records, prefix) => (records || []).reduce((max, r) => {
    const code = String(r.code || '');
    if (!code.startsWith(prefix)) return max;
    const n = parseInt(code.slice(prefix.length), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0) + 1
});
// deptWorkflows/submissionDeptWorkflows rỗng -> nhánh "đang là người duyệt" của canViewSubmission()
// không cho ai qua, để test chỉ xét đúng nhánh phạm vi phòng ban.
stubModule('lib/appData', {
  getAllAppData: async () => ({ deptWorkflows: {}, submissionDeptWorkflows: {}, paymentDeptWorkflows: {} }),
  getAppDataValue: async () => ({}),
  getAppDataValueCached: async () => ({})
});

const { authorizeFileAccess } = require('../lib/fileAuthz');
const { validateAndPrepareCreate, CreateError } = require('../lib/createValidation');
const recordActions = require('../lib/recordActions');
const { applyWorkflowAction, WorkflowError } = require('../lib/workflowEngine');
const recordCodeGen = require('../lib/recordCodeGen');

// ===================== Runner =====================
let passed = 0, failed = 0;
async function run(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (err) { failed++; console.error(`FAIL  ${name}\n      ${err.message}`); }
}
function expectThrow(fn, reMsg, label) {
  let thrown = null;
  try { fn(); } catch (e) { thrown = e; }
  assert.ok(thrown, `${label}: mong đợi ném lỗi nhưng KHÔNG ném`);
  if (reMsg) assert.ok(reMsg.test(thrown.message), `${label}: thông điệp lỗi không khớp — "${thrown.message}"`);
  return thrown;
}

// ===================== Dữ liệu dùng chung cho các mục server-side =====================
const APP_DATA = {
  depts: [DEPT_A, DEPT_B],
  stores: ['Siêu Thị A'],
  deptAbbrs: { [DEPT_A]: 'KD', [DEPT_B]: 'MKT' },
  docCatAbbrs: { 'Quy trình': 'QT' },
  contractTypeAbbrs: { 'Hợp đồng kinh tế': 'HDKT' },
  cats: ['Quy trình'],
  formTemplates: {},
  workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
  submissionTypes: [
    { key: 'KINH_PHI', label: 'Tờ trình duyệt kinh phí' },
    { key: 'KHAC', label: 'Tờ trình khác' }
  ],
  submissionPriorities: [
    { key: 'Bình thường', label: 'Bình thường' },
    { key: 'Gấp', label: '🔥 Gấp' }
  ],
  submissionApprovalGroups: [],
  submissionApprovalLevels: [
    { id: 'TGD', label: 'Tổng giám đốc phê duyệt', order: 1, visibleGroupIds: [], lockedGroupIds: [] },
    { id: 'GD_PGD', label: 'Giám đốc phê duyệt', order: 2, visibleGroupIds: [], lockedGroupIds: [], isSystemDefault: true }
  ],
  submissionDeptWorkflows: {},
  submissionTypeDeptWorkflows: {},
  contractApprovalGroups: [],
  contractApprovalLevels: [{ id: 'TGD', label: 'TGĐ', order: 1, visibleGroupIds: [], lockedGroupIds: [] }],
  contractApprovalDeptWorkflows: {},
  paymentDeptWorkflows: {},
  users: []
};

const USER_A = { username: 'u_a', name: 'Người A', dept: DEPT_A, perms: {
  submissionCreate: { all: false, depts: [DEPT_A] },
  contractCreate: { all: false, depts: [DEPT_A] },
  uploadAll: false, uploadDepts: [DEPT_A],
  licenseCreate: true
} };
const ADMIN = { username: 'admin', name: 'Quản Trị', dept: DEPT_A, perms: { admin: true } };

async function main() {
  // ================= 1. [Cao] Tệp "Đề xuất thay thế tờ trình" FAIL-OPEN =================
  await run('1a. pendingFileProposal.fileUrl: người ngoài phạm vi KHÔNG còn đọc được (trước vá: FAIL-OPEN -> true)', async () => {
    const outsider = { username: 'outsider', dept: DEPT_B, perms: {} };
    assert.strictEqual(await authorizeFileAccess(outsider, '/uploads/sub-de-xuat-moi.pdf', 'view'), false);
    assert.strictEqual(await authorizeFileAccess(outsider, '/uploads/sub-de-xuat-moi.pdf', 'download'), false);
  });
  await run('1b. history[].fileUrl (đề xuất CŨ đã xử lý xong) cũng được gác, không rơi FAIL-OPEN', async () => {
    const outsider = { username: 'outsider', dept: DEPT_B, perms: {} };
    assert.strictEqual(await authorizeFileAccess(outsider, '/uploads/sub-de-xuat-cu.pdf', 'view'), false);
  });
  await run('1c. KHÔNG chặn nhầm: chính người trình vẫn xem/tải được tệp đề xuất thay thế', async () => {
    const owner = { username: 'owner_sub', dept: DEPT_A, perms: {} };
    assert.strictEqual(await authorizeFileAccess(owner, '/uploads/sub-de-xuat-moi.pdf', 'view'), true);
    assert.strictEqual(await authorizeFileAccess(owner, '/uploads/sub-de-xuat-moi.pdf', 'download'), true);
  });

  // ================= 2. [Cao] installments[].files[] FAIL-OPEN =================
  await run('2a. installments[].files[]: người ngoài phạm vi KHÔNG còn đọc được (trước vá: FAIL-OPEN -> true)', async () => {
    const outsider = { username: 'outsider', dept: DEPT_B, perms: {} };
    assert.strictEqual(await authorizeFileAccess(outsider, '/uploads/pr-dot1-chung-tu.pdf', 'view'), false);
    assert.strictEqual(await authorizeFileAccess(outsider, '/uploads/pr-dot1-chung-tu.pdf', 'download'), false);
  });
  await run('2b. KHÔNG chặn nhầm: kế toán (paymentManage) vẫn xem được chứng từ theo đợt', async () => {
    const ketoan = { username: 'kt', dept: DEPT_B, perms: { paymentManage: true } };
    assert.strictEqual(await authorizeFileAccess(ketoan, '/uploads/pr-dot1-chung-tu.pdf', 'view'), true);
  });

  // ================= 3. [Cao] editContract(): đổi dept không kiểm scope/danh mục =================
  const baseContract = () => ({
    id: 1, code: 'HCRC-KD-HDKT-001', creator: USER_A.username, dept: DEPT_A, custodianDept: DEPT_A,
    type: 'Hợp đồng kinh tế', title: 'HĐ', partner: 'X', amount: 1000, approvalStatus: 'PENDING',
    currentStep: 1, history: [], isAddendum: false, paymentInstallments: [],
    selectedApprovalLayers: [], selectedLayerMembers: {}, approvalLevel: 'TGD'
  });
  await run('3a. Đổi dept sang phòng ban NGOÀI scope contractCreate -> 403 (trước vá: gán thẳng, dựng lại cả quy trình duyệt)', async () => {
    const c = baseContract();
    const err = expectThrow(() => recordActions.editContract({ dept: DEPT_B }, USER_A, c, false, undefined, APP_DATA, undefined),
      /không có quyền chuyển hồ sơ sang phòng ban/i, '3a');
    assert.strictEqual(err.status, 403);
    assert.strictEqual(c.dept, DEPT_A, 'dept KHÔNG được đổi sau khi bị chặn');
  });
  await run('3b. Đổi dept sang giá trị KHÔNG có trong danh mục depts/stores -> 400 (dù scope cho phép ALL)', async () => {
    const c = baseContract();
    const userAll = { ...USER_A, perms: { ...USER_A.perms, contractCreate: { all: true, depts: [] } } };
    const err = expectThrow(() => recordActions.editContract({ dept: 'Phòng Ma' }, userAll, c, false, undefined, APP_DATA, undefined),
      /Phòng ban không hợp lệ/i, '3b');
    assert.strictEqual(err.status, 400);
  });
  await run('3c. KHÔNG chặn nhầm: đổi dept trong đúng scope + đúng danh mục -> thành công, dựng lại quy trình duyệt', async () => {
    const c = baseContract();
    const userBoth = { ...USER_A, perms: { ...USER_A.perms, contractCreate: { all: false, depts: [DEPT_A, DEPT_B] } } };
    recordActions.editContract({ dept: DEPT_B }, userBoth, c, false, undefined, APP_DATA, undefined);
    assert.strictEqual(c.dept, DEPT_B);
    assert.ok(Array.isArray(c.effectiveSteps), 'effectiveSteps phải được dựng lại theo dept mới');
  });

  // ================= 4. [Cao] Thanh Toán: đổi dept giữa chừng duyệt + kiểm danh mục =================
  const basePr = () => ({
    id: 1, createdBy: USER_A.username, dept: DEPT_A, title: 'ĐNTT', status: 'PENDING', currentStep: 2,
    history: [{ step: 1, action: 'APPROVED', username: 'sep1' }],
    installments: [{ description: 'Đợt 1', amount: 1000, files: [], confirmed: false }],
    requestFiles: [{ fileUrl: '/uploads/a.pdf', fileName: 'a.pdf' }], amount: 1000
  });
  const KE_TOAN = { username: 'kt', name: 'Kế Toán', dept: DEPT_B, perms: { paymentManage: true } };
  await run('4a. Đổi dept giữa chừng quy trình duyệt -> invalidate lịch sử APPROVED + reset currentStep=1 (trước vá: giữ nguyên bước 2)', async () => {
    const pr = basePr();
    recordActions.editPaymentRequest({ dept: DEPT_B }, KE_TOAN, pr, APP_DATA);
    assert.strictEqual(pr.dept, DEPT_B);
    assert.strictEqual(pr.currentStep, 1, 'currentStep phải reset về 1');
    assert.strictEqual(pr.history[0].invalidated, true, 'lượt APPROVED cũ phải bị đánh dấu invalidated');
  });
  await run('4b. Đổi dept sang giá trị ngoài danh mục -> 400 (trước vá: nhận nguyên chuỗi client gửi)', async () => {
    const pr = basePr();
    const err = expectThrow(() => recordActions.editPaymentRequest({ dept: 'Phòng Ma' }, KE_TOAN, pr, APP_DATA),
      /Phòng ban không hợp lệ/i, '4b');
    assert.strictEqual(err.status, 400);
    assert.strictEqual(pr.dept, DEPT_A, 'dept KHÔNG được đổi sau khi bị chặn');
  });
  await run('4c. KHÔNG chặn nhầm: chỉ sửa title (không đụng dept) -> KHÔNG reset bước duyệt đang dở dang', async () => {
    const pr = basePr();
    recordActions.editPaymentRequest({ title: 'ĐNTT sửa tên' }, KE_TOAN, pr, APP_DATA);
    assert.strictEqual(pr.currentStep, 2, 'currentStep giữ nguyên khi không đổi dept/installments');
    assert.notStrictEqual(pr.history[0].invalidated, true);
  });

  // ================= 5 + 16. [Cao/Thấp] submissions: type/priority/title/content =================
  const subPayload = (over) => Object.assign({
    dept: DEPT_A, type: 'Tờ trình duyệt kinh phí', priority: 'Bình thường',
    title: 'Tờ trình test', content: 'Nội dung', fileUrl: '/uploads/x.pdf', fileName: 'x.pdf',
    approvalLevel: 'TGD', selectedApprovalLayers: [], selectedLayerMembers: {}
  }, over || {});
  await run('5a. TẠO: `type` lệch label -> 400, KHÔNG còn âm thầm rơi về KHAC để đi ít bước duyệt hơn', async () => {
    // "Tờ trình duyệt kinh phí." (thừa dấu chấm) hiển thị gần như y hệt nhãn thật trên phiếu/email, nhưng
    // TRƯỚC BẢN VÁ không khớp submissionTypes -> typeKey rơi về 'KHAC' -> đi quy trình duyệt của loại
    // "Tờ trình khác" (thường ít bước hơn hẳn loại "duyệt kinh phí").
    const err = expectThrow(() => validateAndPrepareCreate('submissions', subPayload({ type: 'Tờ trình duyệt kinh phí.' }), USER_A, [], APP_DATA, []),
      /Loại tờ trình không hợp lệ/i, '5a');
    assert.strictEqual(err.status, 400);
  });
  await run('5a-bis. Khoảng trắng thừa đầu/cuối được TRIM (không phải lỗi nhập liệu thật) -> vẫn tạo được', async () => {
    const rec = validateAndPrepareCreate('submissions', subPayload({ type: '  Tờ trình duyệt kinh phí  ' }), USER_A, [], APP_DATA, []);
    assert.strictEqual(rec.type, 'Tờ trình duyệt kinh phí');
  });
  await run('5b. TẠO: `priority` không có trong appData.submissionPriorities -> 400', async () => {
    expectThrow(() => validateAndPrepareCreate('submissions', subPayload({ priority: 'Siêu khẩn cấp' }), USER_A, [], APP_DATA, []),
      /Độ khẩn không hợp lệ/i, '5b');
  });
  await run('5c. KHÔNG chặn nhầm: type/priority khớp đúng danh mục -> tạo được bình thường', async () => {
    const rec = validateAndPrepareCreate('submissions', subPayload(), USER_A, [], APP_DATA, []);
    assert.strictEqual(rec.type, 'Tờ trình duyệt kinh phí');
    assert.strictEqual(rec.status, 'PENDING');
  });
  await run('16. TẠO: title/content bị .slice() giới hạn ở server (300 / 20000 ký tự)', async () => {
    const rec = validateAndPrepareCreate('submissions', subPayload({ title: 'T'.repeat(900), content: 'C'.repeat(50000) }), USER_A, [], APP_DATA, []);
    assert.strictEqual(rec.title.length, 300, 'title phải bị cắt còn 300');
    assert.strictEqual(rec.content.length, 20000, 'content phải bị cắt còn 20000');
  });

  // ================= 6. [TB] CANCEL_FILE_PROPOSAL — lối thoát cho hồ sơ bị khoá cứng =================
  const subWithProposal = () => ({
    id: 9, code: 'HCRC-KD-VBT-009', dept: DEPT_A, creator: 'nguoi_trinh_da_nghi_viec',
    type: 'Tờ trình khác', status: 'PENDING', currentStep: 2, history: [],
    fileUrl: '/uploads/goc.pdf',
    selectedApprovalLayers: [], selectedLayerMembers: {}, approvalLevel: 'TGD',
    effectiveSteps: [{ order: 1, name: 'B1' }, { order: 2, name: 'B2' }],
    effectiveApprovers: { 1: ['sep1'], 2: ['sep2'] },
    pendingFileProposal: { fileUrl: '/uploads/dx.pdf', fileName: 'dx.pdf', proposedBy: 'tlk1', proposedByName: 'Trợ Lý', step: 2 }
  });
  await run('6a. Trước vá: mọi hành động bị chặn 409 khi có đề xuất treo (giữ nguyên hành vi này)', async () => {
    const item = subWithProposal();
    const err = expectThrow(() => applyWorkflowAction({
      moduleKey: 'submissions', item, action: 'APPROVE', user: { username: 'sep2', name: 'Sếp 2', perms: {} },
      comment: 'ok', appData: APP_DATA, users: []
    }), /đang chờ người trình xác nhận/i, '6a');
    assert.strictEqual(err.status, 409);
  });
  await run('6b. Admin HUỶ được đề xuất treo -> pendingFileProposal = null, giữ nguyên bước duyệt hiện tại', async () => {
    const item = subWithProposal();
    const out = applyWorkflowAction({
      moduleKey: 'submissions', item, action: 'CANCEL_FILE_PROPOSAL', user: ADMIN, comment: 'gỡ kẹt', appData: APP_DATA, users: []
    });
    assert.strictEqual(out.item.pendingFileProposal, null);
    assert.strictEqual(out.item.currentStep, 2, 'KHÔNG đụng bước duyệt (khác RESOLVE_FILE_PROPOSAL)');
    assert.strictEqual(out.item.status, 'PENDING');
    assert.ok(out.item.history.some(h => h.action === 'FILE_PROPOSAL_CANCELLED'), 'phải ghi 1 dòng lịch sử');
  });
  await run('6c. Chính người đã đề xuất cũng tự rút lại được', async () => {
    const item = subWithProposal();
    const out = applyWorkflowAction({
      moduleKey: 'submissions', item, action: 'CANCEL_FILE_PROPOSAL',
      user: { username: 'tlk1', name: 'Trợ Lý', perms: {} }, comment: '', appData: APP_DATA, users: []
    });
    assert.strictEqual(out.item.pendingFileProposal, null);
  });
  await run('6d. Người KHÁC (không admin, không phải người đề xuất) -> 403', async () => {
    const item = subWithProposal();
    const err = expectThrow(() => applyWorkflowAction({
      moduleKey: 'submissions', item, action: 'CANCEL_FILE_PROPOSAL',
      user: { username: 'ke_la', name: 'Kẻ Lạ', perms: {} }, comment: '', appData: APP_DATA, users: []
    }), /Chỉ Quản Trị Viên hoặc chính người đã đề xuất/i, '6d');
    assert.strictEqual(err.status, 403);
  });
  await run('6e. Sau khi huỷ, hồ sơ xử lý lại bình thường (Duyệt được ngay ở bước hiện tại) — hết deadlock', async () => {
    const item = subWithProposal();
    applyWorkflowAction({ moduleKey: 'submissions', item, action: 'CANCEL_FILE_PROPOSAL', user: ADMIN, comment: '', appData: APP_DATA, users: [] });
    const out = applyWorkflowAction({
      moduleKey: 'submissions', item, action: 'APPROVE', user: { username: 'sep2', name: 'Sếp 2', perms: {} },
      comment: 'duyệt', appData: APP_DATA, users: []
    });
    assert.strictEqual(out.item.status, 'APPROVED');
  });

  // ================= 7. [TB] Thanh Toán: chặn gửi vào ngõ cụt =================
  const draftPr = () => ({
    id: 2, createdBy: USER_A.username, dept: DEPT_A, title: 'ĐNTT nháp', status: 'DRAFT',
    installments: [{ description: 'Đợt 1', amount: 1000, files: [], confirmed: false }],
    requestFiles: [{ fileUrl: '/uploads/a.pdf', fileName: 'a.pdf' }], history: []
  });
  await run('7a. paymentDeptWorkflows RỖNG (mặc định) -> chặn 409 khi "Chuyển Xác Nhận Thanh Toán" (trước vá: gửi được rồi kẹt PENDING vĩnh viễn)', async () => {
    const pr = draftPr();
    const err = expectThrow(() => recordActions.submitPaymentRequest(USER_A, pr, APP_DATA),
      /chưa được cấu hình quy trình duyệt/i, '7a');
    assert.strictEqual(err.status, 409);
    assert.strictEqual(pr.status, 'DRAFT', 'hồ sơ phải ở nguyên NHÁP sau khi bị chặn');
  });
  await run('7b. KHÔNG chặn nhầm: phòng ban ĐÃ cấu hình quy trình -> gửi được bình thường', async () => {
    const pr = draftPr();
    const appDataOk = { ...APP_DATA, paymentDeptWorkflows: { [DEPT_A]: { workflowId: 'WF_1STEP', approvers: { 1: ['sep1'] } } } };
    recordActions.submitPaymentRequest(USER_A, pr, appDataOk);
    assert.strictEqual(pr.status, 'PENDING');
    assert.strictEqual(pr.currentStep, 1);
  });

  // ================= 9. [TB] Giấy Phép: chặn TỰ DUYỆT =================
  const license = () => ({ id: 3, code: 'HCRC-KD-GP-001', creator: 'nguoi_tai_len', status: 'PENDING', history: [], lifecycleStatus: null });
  const SELF = { username: 'nguoi_tai_len', name: 'Người Tải Lên', perms: { licenseCreate: true, licenseApprove: true } };
  const OTHER_APPROVER = { username: 'nguoi_duyet', name: 'Người Duyệt', perms: { licenseApprove: true } };
  await run('9a. approveLicense(): người tải lên (có licenseApprove) KHÔNG tự duyệt được -> 403', async () => {
    const err = expectThrow(() => recordActions.approveLicense(SELF, license()), /không thể tự xử lý/i, '9a');
    assert.strictEqual(err.status, 403);
  });
  await run('9b. rejectLicense() cũng bị chặn tự xử lý', async () => {
    expectThrow(() => recordActions.rejectLicense(SELF, license(), { reason: 'x' }), /không thể tự xử lý/i, '9b');
  });
  await run('9c. setLicenseRenewing()/revokeLicense() cũng bị chặn tự xử lý', async () => {
    const approved = { ...license(), status: 'APPROVED' };
    expectThrow(() => recordActions.setLicenseRenewing(SELF, { ...approved }, { renewing: true }), /không thể tự xử lý/i, '9c-1');
    expectThrow(() => recordActions.revokeLicense(SELF, { ...approved }, { reason: 'x' }), /không thể tự xử lý/i, '9c-2');
  });
  await run('9d. KHÔNG chặn nhầm: người duyệt KHÁC vẫn duyệt được; admin vẫn giữ đặc quyền vượt cấu hình', async () => {
    assert.strictEqual(recordActions.approveLicense(OTHER_APPROVER, license()).status, 'APPROVED');
    assert.strictEqual(recordActions.approveLicense({ ...ADMIN, username: 'nguoi_tai_len' }, license()).status, 'APPROVED');
  });

  // ================= 10. [TB] code/displayCode SINH LẠI Ở SERVER =================
  await run('10a. submissions: mã client gửi bị BỎ QUA, server tự sinh HCRC-<mã phòng>-VBT-<số>', async () => {
    const rec = validateAndPrepareCreate('submissions', subPayload({ code: 'MÃ-TỰ-CHẾ-999' }), USER_A, [], APP_DATA, []);
    assert.strictEqual(rec.code, 'HCRC-KD-VBT-001', `mã thật: ${rec.code}`);
  });
  await run('10b. submissions: số thứ tự nối tiếp ĐÚNG số lớn nhất từng có của cùng prefix', async () => {
    const existing = [{ id: 1, code: 'HCRC-KD-VBT-007' }, { id: 2, code: 'HCRC-MKT-VBT-050' }];
    const rec = validateAndPrepareCreate('submissions', subPayload({ code: 'HCRC-KD-VBT-001' }), USER_A, existing, APP_DATA, []);
    assert.strictEqual(rec.code, 'HCRC-KD-VBT-008', `mã thật: ${rec.code}`);
  });
  await run('10c. docs: mã + displayCode sinh ở server theo (Phân loại, Phòng ban), bỏ qua client', async () => {
    const rec = validateAndPrepareCreate('docs', {
      dept: DEPT_A, cat: 'Quy trình', title: 'TL', ver: '1.0',
      fileUrl: '/uploads/x.pdf', fileName: 'x.pdf', code: 'TỰ-CHẾ', displayCode: 'TỰ-CHẾ', rootDocId: null
    }, USER_A, [], APP_DATA, []);
    assert.strictEqual(rec.code, 'QT-KD-001', `mã thật: ${rec.code}`);
    assert.strictEqual(rec.displayCode, 'QT-KD-001');
  });
  await run('10d. contracts: mã hợp đồng gốc sinh ở server theo (Phòng ban, Loại Pháp Lý)', async () => {
    const rec = validateAndPrepareCreate('contracts', {
      dept: DEPT_A, custodianDept: DEPT_A, type: 'Hợp đồng kinh tế', title: 'HĐ', partner: 'X', amount: 1000,
      startDate: '2026-01-01', endDate: '2026-12-31', fileUrl: '/uploads/x.pdf', fileName: 'x.pdf',
      code: 'TỰ-CHẾ-HD', approvalLevel: 'TGD', selectedApprovalLayers: [], selectedLayerMembers: {},
      paymentInstallments: []
    }, USER_A, [], APP_DATA, []);
    assert.strictEqual(rec.code, 'HCRC-KD-HDKT-001', `mã thật: ${rec.code}`);
  });
  await run('10e. contracts: mã PHỤ LỤC sinh ở server = <mã gốc>-PLHD<số 2 chữ số>, đánh số riêng theo từng hợp đồng gốc', async () => {
    const root = { id: 100, code: 'HCRC-KD-HDKT-001', dept: DEPT_A, custodianDept: DEPT_A, type: 'Hợp đồng kinh tế', approvalStatus: 'APPROVED', isAddendum: false };
    const existingAdd = { id: 101, code: 'HCRC-KD-HDKT-001-PLHD03', isAddendum: true, rootContractId: 100 };
    const rec = validateAndPrepareCreate('contracts', {
      dept: DEPT_A, custodianDept: DEPT_A, type: 'Hợp đồng kinh tế', title: 'PL', partner: 'X', amount: 500,
      startDate: '2026-01-01', endDate: '2026-12-31', fileUrl: '/uploads/x.pdf', fileName: 'x.pdf',
      code: 'TỰ-CHẾ-PL', isAddendum: true, rootContractId: 100,
      approvalLevel: 'TGD', selectedApprovalLayers: [], selectedLayerMembers: {}, paymentInstallments: []
    }, USER_A, [root, existingAdd], APP_DATA, []);
    assert.strictEqual(rec.code, 'HCRC-KD-HDKT-001-PLHD04', `mã thật: ${rec.code}`);
  });
  await run('10f. licenses: mã gốc sinh ở server HCRC-<mã phòng người tạo>-GP-<số>', async () => {
    const rec = validateAndPrepareCreate('licenses', {
      companyName: 'CT', locationName: 'ĐĐ', licenseType: 'GPKD', licenseNumber: '123', issuingAuthority: 'SKHĐT',
      operatingStatus: 'ACTIVE', issueDate: '2026-01-01', expiryDate: '2027-01-01',
      fileUrl: '/uploads/x.pdf', fileName: 'x.pdf', code: 'TỰ-CHẾ-GP', rootLicenseId: null
    }, USER_A, [], APP_DATA, []);
    assert.strictEqual(rec.code, 'HCRC-KD-GP-001', `mã thật: ${rec.code}`);
    assert.strictEqual(rec.displayCode, 'HCRC-KD-GP-001');
  });
  await run('10g. recordCodeGen giữ KHỚP thuật toán viết tắt của client (deriveAbbr bỏ stopword "Phòng")', async () => {
    assert.strictEqual(recordCodeGen.getDeptAbbr({}, 'Phòng Công Nghệ Thông Tin'), 'CNTT');
    assert.strictEqual(recordCodeGen.getDeptAbbr({ deptAbbrs: { 'Phòng Công Nghệ Thông Tin': 'IT' } }, 'Phòng Công Nghệ Thông Tin'), 'IT');
  });

  // ================= 11. [TB] Quyền riêng contractImportSigned =================
  const importPayload = () => ({
    dept: DEPT_A, custodianDept: DEPT_A, type: 'Hợp đồng kinh tế', title: 'HĐ đã ký', partner: 'X', amount: 1000,
    startDate: '2026-01-01', endDate: '2026-12-31', fileUrl: '/uploads/x.pdf', fileName: 'x.pdf',
    isSignedImport: true, approvalLevel: 'TGD', selectedApprovalLayers: [], selectedLayerMembers: {}, paymentInstallments: []
  });
  await run('11a. Chỉ có contractCreate -> KHÔNG còn nhập được hợp đồng "đã ký" (bỏ qua duyệt) -> 403', async () => {
    const err = expectThrow(() => validateAndPrepareCreate('contracts', importPayload(), USER_A, [], APP_DATA, []),
      /Nhập Hợp Đồng\/Phụ Lục Đã Ký/i, '11a');
    assert.strictEqual(err.status, 403);
  });
  await run('11b. Có contractImportSigned -> nhập được, hồ sơ APPROVED ngay như thiết kế', async () => {
    const importer = { ...USER_A, perms: { ...USER_A.perms, contractImportSigned: true } };
    const rec = validateAndPrepareCreate('contracts', importPayload(), importer, [], APP_DATA, []);
    assert.strictEqual(rec.approvalStatus, 'APPROVED');
    assert.strictEqual(rec.signedFileStatus, 'APPROVED');
  });
  await run('11c. KHÔNG chặn nhầm: contractCreate vẫn tạo được hợp đồng THƯỜNG (đi hàng chờ duyệt)', async () => {
    const p = importPayload(); p.isSignedImport = false;
    const rec = validateAndPrepareCreate('contracts', p, USER_A, [], APP_DATA, []);
    assert.strictEqual(rec.approvalStatus, 'PENDING');
  });

  // ================= 12. [TB] approvalLevel bị admin xoá -> fallback, không kẹt NHÁP =================
  const draftSub = (level) => ({
    id: 5, code: 'HCRC-KD-VBT-005', dept: DEPT_A, creator: USER_A.username, status: 'DRAFT',
    type: 'Tờ trình khác', priority: 'Bình thường', title: 'TT', content: 'ND',
    fileUrl: '/uploads/x.pdf', fileName: 'x.pdf', extraFiles: [],
    approvalLevel: level, selectedApprovalLayers: [], selectedLayerMembers: {}, history: []
  });
  await run('12a. approvalLevel không còn trong danh mục -> tự fallback cấp isSystemDefault, KHÔNG ném lỗi (trước vá: 400, kẹt NHÁP vĩnh viễn)', async () => {
    const item = draftSub('CAP_DA_BI_XOA');
    recordActions.editSubmissionDraft({ title: 'TT sửa' }, USER_A, item, APP_DATA);
    assert.strictEqual(item.approvalLevel, 'GD_PGD', 'phải rơi về cấp mặc định hợp lệ');
    assert.strictEqual(item.approvalLevelFallbackFrom, 'CAP_DA_BI_XOA', 'phải báo lại cấp cũ để client thông báo rõ');
    assert.ok(Array.isArray(item.effectiveSteps), 'quy trình duyệt phải dựng lại được');
  });
  await run('12b. KHÔNG đổi oan: approvalLevel còn hợp lệ -> giữ nguyên, không báo fallback', async () => {
    const item = draftSub('TGD');
    recordActions.editSubmissionDraft({ title: 'TT sửa' }, USER_A, item, APP_DATA);
    assert.strictEqual(item.approvalLevel, 'TGD');
    assert.strictEqual(item.approvalLevelFallbackFrom, null);
  });
  await run('12c. SỬA NHÁP cũng áp luật type/title như lúc TẠO (mục 5/16 không hở qua vòng "Bổ Sung")', async () => {
    const item = draftSub('TGD');
    expectThrow(() => recordActions.editSubmissionDraft({ type: 'Tờ trình bịa' }, USER_A, item, APP_DATA),
      /Loại tờ trình không hợp lệ/i, '12c');
    const item2 = draftSub('TGD');
    recordActions.editSubmissionDraft({ title: 'T'.repeat(900) }, USER_A, item2, APP_DATA);
    assert.strictEqual(item2.title.length, 300);
  });
  await run('12d. KHÔNG tạo deadlock mới: hồ sơ CŨ mang `type` không còn trong danh mục (admin đã xoá) vẫn sửa được khi người dùng không đổi loại', async () => {
    const item = draftSub('TGD');
    item.type = 'Loại tờ trình admin đã xoá';
    recordActions.editSubmissionDraft({ title: 'Chỉ sửa tiêu đề' }, USER_A, item, APP_DATA);
    assert.strictEqual(item.title, 'Chỉ sửa tiêu đề');
    assert.strictEqual(item.type, 'Loại tờ trình admin đã xoá', 'giữ nguyên loại cũ, không ép đổi');
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exit(1); });
