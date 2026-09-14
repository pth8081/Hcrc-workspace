// server/tests/test-checklist.js
//
// Regression test cho module "Checklist Đánh Giá Siêu Thị" (lib/checklist.js + routes/checklist.js) —
// cùng khuôn tests/test-payroll.js: stub lib/appData/lib/recordStore/lib/auth (checklistTemplates/
// checklistSubmissions là MIGRATED_COLLECTIONS, xem lib/recordStore.js), chạy thẳng express router THẬT.
//
//   1. Vòng đời template: sửa/xoá chỉ khi DRAFT; kích hoạt tự lưu trữ bản ACTIVE khác cùng templateCode;
//      nhân bản tạo version+1 DRAFT.
//   2. Bảo mật STORE_SELF (Mục 7.1): storeCode LUÔN suy từ user.dept, storeCode client gửi lên bị bỏ qua.
//   3. Phạm vi CONTROL_AUDIT: kiểm soát viên ngoài checklistAuditScope bị 403.
//   4. Chấm điểm/nộp bài: lỗi nghiêm trọng ép isPassed=false bất kể %; thiếu câu bắt buộc/thiếu ảnh minh
//      chứng cho câu lỗi đều chặn nộp bài.
//   5. Phản hồi kết quả: chỉ đúng siêu thị của bài CONTROL_AUDIT mới phản hồi được.
//
// Chạy: node server/tests/test-checklist.js
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

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', posType: 'HO', perms: { admin: true }, active: true };
const MANAGER = { username: 'qltc1', name: 'Quản Lý Checklist', dept: 'Phòng Vận Hành', posType: 'HO', perms: { checklistTemplateManage: true }, active: true };
const REPORTER = { username: 'bc1', name: 'Người Xem Báo Cáo', dept: 'Phòng Vận Hành', posType: 'HO', perms: { checklistReportView: true }, active: true };
const AUDITOR = { username: 'ks1', name: 'Kiểm Soát Viên', dept: 'Phòng Vận Hành', posType: 'HO', perms: { checklistAuditScope: { all: false, depts: ['Siêu thị A'] } }, active: true };
const STORE_A_EMP = { username: 'nva', name: 'Nhân Viên Siêu Thị A', dept: 'Siêu thị A', posType: 'STORE', perms: {}, active: true };
const STORE_B_EMP = { username: 'nvb', name: 'Nhân Viên Siêu Thị B', dept: 'Siêu thị B', posType: 'STORE', perms: {}, active: true };
let USERS = [ADMIN, MANAGER, REPORTER, AUDITOR, STORE_A_EMP, STORE_B_EMP];

let RECORDS;
function resetRecords() {
  RECORDS = { checklistTemplates: [], checklistSubmissions: [] };
}
resetRecords();

let PORT = 0;
let CURRENT_USERNAME = ADMIN.username;
let idSeq = 1000;

stubModule('lib/appData', {
  getAppDataValue: async () => null,
  getAllAppData: async () => ({}),
  withLockedAppDataValue: async (key, fn) => fn(null)
});

stubModule('lib/recordStore', {
  getAllForCollection: async (collection) => RECORDS[collection] || [],
  // KHÔNG tự gán id nếu record thiếu — mirror ĐÚNG lib/recordStore.js thật (insertRecord() dùng thẳng
  // record.id làm tham số SQL BigInt, không tự sinh id hộ). Mock trước đây tự Object.assign({id:...},
  // record) che mất 1 lỗi thật ở routes/checklist.js (clone/submission thiếu "id:" trước khi gọi
  // insertRecord() -> record.id=undefined -> lỗi 500 thật ở production, không tái hiện được ở đây vì
  // mock tự vá hộ) — xem phản hồi thực tế "Bắt Đầu Test báo lỗi" đã fix ở routes/checklist.js.
  insertRecord: async (collection, record) => {
    if (record.id == null) throw new Error(`insertRecord('${collection}', ...) thiếu record.id — lib/recordStore.js thật KHÔNG tự sinh id hộ, phải gán id: Date.now() trước khi gọi`);
    RECORDS[collection] = RECORDS[collection] || [];
    RECORDS[collection].push(record);
    return record;
  },
  withLockedRecordForCollection: async (collection, id, mutatorFn) => {
    const list = RECORDS[collection] || [];
    const idx = list.findIndex(r => r.id === id);
    if (idx === -1) { const err = new Error('Không tìm thấy bản ghi'); err.statusCode = 404; throw err; }
    const updated = await mutatorFn(list[idx]);
    list[idx] = updated;
    return updated;
  },
  withAppLock: async (key, fn) => fn(),
  deleteRecordForCollection: async (collection, id, checkFn, actor) => {
    const list = RECORDS[collection] || [];
    const idx = list.findIndex(r => r.id === id);
    if (idx === -1) { const err = new Error('Không tìm thấy bản ghi'); err.statusCode = 404; throw err; }
    await checkFn(list[idx]);
    list.splice(idx, 1);
    return true;
  }
});

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const { createRunner, assertEqual, assertIncludes } = require('./testHarness');
const checklistRoutes = require('../routes/checklist');
const checklist = require('../lib/checklist');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/checklist', checklistRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function api(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

// Seed thẳng qua RECORDS + lib/checklist.js thật (bỏ qua routes/create.js — route tạo mới DRAFT dùng
// khuôn generic create engine, test riêng ở createValidation.js, không thuộc phạm vi test này).
function seedTemplate(overrides) {
  const core = checklist.assertTemplateCoreFields(Object.assign({
    templateCode: 'CL_TEST', templateName: 'Checklist Kiểm Tra', templateType: 'STORE_SELF', passThreshold: 80
  }, overrides));
  const questions = checklist.validateChecklistQuestions(overrides?.questions || [
    {
      text: 'Vệ sinh khu vực quầy có đạt không?', isRequired: true, maxScore: 10,
      options: [
        { text: 'Đạt', scoreValue: 10, isPassing: true },
        { text: 'Không đạt (lỗi nghiêm trọng)', scoreValue: 0, isPassing: false, isCriticalFail: true }
      ]
    }
  ]);
  const template = Object.assign({
    id: idSeq++, status: 'DRAFT', version: 1, clonedFromTemplateId: null, activatedAt: null,
    creator: 'admin', creatorName: 'Quản Trị Viên'
  }, core, { questions });
  RECORDS.checklistTemplates.push(template);
  return template;
}

// v21.0 — LOẠI 2: DEDUCTION ("Trừ điểm theo hạng mục", theo file VSATTP người dùng gửi).
function seedDeductionTemplate(overrides) {
  const core = checklist.assertTemplateCoreFields(Object.assign({
    templateCode: 'CL_DED_TEST', templateName: 'Checklist Trừ Điểm Kiểm Tra', templateType: 'CONTROL_AUDIT',
    templateKind: 'DEDUCTION'
  }, overrides));
  const categories = checklist.validateChecklistCategories(overrides?.categories || [
    {
      name: 'CHẤT LƯỢNG SẢN PHẨM', maxDeduction: 30,
      subItems: [
        { name: 'Chất lượng cảm quan', maxDeduction: 30, criteria: [{ description: 'Bao bì không nguyên vẹn', perInstanceValue: 2, ruleText: 'Cho 1 mã SP không phù hợp' }] },
        { name: 'Hạn sử dụng', maxDeduction: null, criteria: [{ description: 'Sản phẩm hết hạn sử dụng', perInstanceValue: 4, ruleText: 'Cho 1 mã SP không phù hợp' }] }
      ]
    },
    {
      name: 'NHÂN VIÊN', maxDeduction: 5,
      subItems: [{ name: 'Đồng phục', maxDeduction: 5, criteria: [{ description: 'Không đúng đồng phục', perInstanceValue: 2 }] }]
    }
  ]);
  const template = Object.assign({
    id: idSeq++, status: 'DRAFT', version: 1, clonedFromTemplateId: null, activatedAt: null,
    creator: 'admin', creatorName: 'Quản Trị Viên'
  }, core, { categories });
  RECORDS.checklistTemplates.push(template);
  return template;
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    // ===== 1. Vòng đời template =====
    await run.run('Template: chỉ sửa được khi còn DRAFT', async () => {
      resetRecords();
      const t = seedTemplate();
      t.status = 'ACTIVE';
      const res = await api('POST', `/api/checklist/templates/${t.id}/edit`, { templateCode: t.templateCode, templateName: 'Đổi tên', templateType: 'STORE_SELF', questions: t.questions }, MANAGER);
      assertEqual(res.status, 409, 'Sửa template ACTIVE phải bị từ chối (409)');
    });

    await run.run('Template: kích hoạt tự lưu trữ bản ACTIVE khác cùng templateCode', async () => {
      resetRecords();
      const t1 = seedTemplate();
      const oldActive = seedTemplate({ templateCode: t1.templateCode });
      oldActive.status = 'ACTIVE';
      const res = await api('POST', `/api/checklist/templates/${t1.id}/activate`, {}, MANAGER);
      assertEqual(res.status, 200, 'Kích hoạt DRAFT phải thành công');
      assertEqual(res.body.item.status, 'ACTIVE', 'Template vừa kích hoạt phải chuyển ACTIVE');
      const refreshedOld = RECORDS.checklistTemplates.find(x => x.id === oldActive.id);
      assertEqual(refreshedOld.status, 'ARCHIVED', 'Bản ACTIVE cũ cùng mã phải tự chuyển ARCHIVED');
    });

    await run.run('Template: nhân bản tạo bản DRAFT version+1', async () => {
      resetRecords();
      const t = seedTemplate();
      t.status = 'ACTIVE'; t.version = 3;
      const res = await api('POST', `/api/checklist/templates/${t.id}/clone`, {}, MANAGER);
      assertEqual(res.status, 200, 'Nhân bản phải thành công');
      assertEqual(res.body.item.status, 'DRAFT', 'Bản nhân bản phải là DRAFT');
      assertEqual(res.body.item.version, 4, 'Bản nhân bản phải là version+1');
      assertEqual(res.body.item.clonedFromTemplateId, t.id, 'Phải ghi lại nguồn nhân bản');
    });

    await run.run('Template: chỉ xoá được khi còn DRAFT', async () => {
      resetRecords();
      const t = seedTemplate();
      t.status = 'ARCHIVED';
      const res = await api('POST', `/api/checklist/templates/${t.id}/delete`, {}, MANAGER);
      assertEqual(res.status, 409, 'Xoá template ARCHIVED phải bị từ chối (409)');
    });

    // ===== 2. Bảo mật STORE_SELF (Mục 7.1) =====
    await run.run('STORE_SELF: storeCode LUÔN suy từ user.dept, bỏ qua storeCode client gửi lên', async () => {
      resetRecords();
      const t = seedTemplate(); t.status = 'ACTIVE';
      const res = await api('POST', '/api/checklist/submissions/start', { templateId: t.id, storeCode: 'Siêu thị B (giả mạo)' }, STORE_A_EMP);
      assertEqual(res.status, 200, 'STORE_SELF hợp lệ phải bắt đầu được');
      assertEqual(res.body.item.storeCode, 'Siêu thị A', 'storeCode phải LUÔN là dept thật của user, không phải giá trị client gửi lên');
    });

    await run.run('STORE_SELF: người không ở vị trí Siêu Thị (posType khác STORE) bị chặn', async () => {
      resetRecords();
      const t = seedTemplate(); t.status = 'ACTIVE';
      const res = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, MANAGER);
      assertEqual(res.status, 400, 'posType không phải STORE thì không tự đánh giá được');
    });

    await run.run('STORE_SELF: admin không gắn Vị Trí Siêu Thị vẫn test được nếu tự chọn siêu thị (storeCode do admin gửi lên được tin, khác hẳn user thường)', async () => {
      resetRecords();
      const t = seedTemplate(); t.status = 'ACTIVE';
      const blocked = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, ADMIN);
      assertEqual(blocked.status, 400, 'Admin KHÔNG chọn siêu thị thì vẫn bị chặn (không có storeCode nào để dùng)');
      const res = await api('POST', '/api/checklist/submissions/start', { templateId: t.id, storeCode: 'Siêu thị B' }, ADMIN);
      assertEqual(res.status, 200, 'Admin CÓ chọn siêu thị thì bắt đầu được (mục đích test mẫu)');
      assertEqual(res.body.item.storeCode, 'Siêu thị B', 'storeCode phải đúng giá trị admin chọn (khác quy tắc "luôn = user.dept" áp dụng cho người dùng thường)');
    });

    // ===== 3. Phạm vi CONTROL_AUDIT =====
    await run.run('CONTROL_AUDIT: kiểm soát viên ngoài phạm vi checklistAuditScope bị 403', async () => {
      resetRecords();
      const t = seedTemplate({ templateType: 'CONTROL_AUDIT' }); t.status = 'ACTIVE';
      const resB = await api('POST', '/api/checklist/submissions/start', { templateId: t.id, storeCode: 'Siêu thị B' }, AUDITOR);
      assertEqual(resB.status, 403, 'Kiểm soát viên chỉ được cấp phạm vi Siêu thị A -> đánh giá Siêu thị B phải bị từ chối');
      const resA = await api('POST', '/api/checklist/submissions/start', { templateId: t.id, storeCode: 'Siêu thị A' }, AUDITOR);
      assertEqual(resA.status, 200, 'Đúng phạm vi được cấp phải cho phép');
      assertEqual(resA.body.item.storeCode, 'Siêu thị A', 'storeCode phải đúng siêu thị được chọn');
    });

    await run.run('CONTROL_AUDIT: thiếu storeCode bị từ chối', async () => {
      resetRecords();
      const t = seedTemplate({ templateType: 'CONTROL_AUDIT' }); t.status = 'ACTIVE';
      const res = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, AUDITOR);
      assertEqual(res.status, 400, 'CONTROL_AUDIT bắt buộc chọn storeCode');
    });

    // ===== 4. Chấm điểm / nộp bài =====
    await run.run('Finalize: thiếu câu bắt buộc bị chặn nộp bài', async () => {
      resetRecords();
      const t = seedTemplate(); t.status = 'ACTIVE';
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_A_EMP);
      const res = await api('POST', `/api/checklist/submissions/${start.body.item.id}/finalize`, {}, STORE_A_EMP);
      assertEqual(res.status, 400, 'Chưa trả lời câu bắt buộc thì không nộp bài được');
    });

    // LỖI THẬT vừa phát hiện (người dùng báo qua ảnh chụp): chọn ĐÚNG đáp án trên màn hình rồi bấm thẳng
    // "Nộp Bài" (KHÔNG bấm "Lưu Nháp" trước) vẫn báo nhầm "Còn N câu hỏi bắt buộc chưa trả lời" — vì
    // TRƯỚC ĐÂY finalizeChecklistSubmission() (module-checklist.js) gửi body RỖNG {}, route /finalize chỉ
    // chấm điểm trên sub.answers đã lưu SẴN trong DB (rỗng từ lúc /start, chưa từng gọi /answers). Test
    // này mô phỏng ĐÚNG luồng lỗi: gọi thẳng /finalize kèm answers[] trong body, KHÔNG gọi /answers trước.
    await run.run('BUG THẬT: bấm "Nộp Bài" ngay (KHÔNG bấm "Lưu Nháp" trước) với answers gửi kèm thẳng trong /finalize vẫn phải nộp được', async () => {
      resetRecords();
      const t = seedTemplate(); t.status = 'ACTIVE';
      const passOption = t.questions[0].options.find(o => o.isPassing);
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_A_EMP);
      const subId = start.body.item.id;
      // KHÔNG gọi POST /answers ở đây — mô phỏng đúng người dùng chưa từng bấm "Lưu Nháp".
      const res = await api('POST', `/api/checklist/submissions/${subId}/finalize`,
        { answers: [{ questionId: t.questions[0].id, optionIds: [passOption.id], note: '' }] }, STORE_A_EMP);
      assertEqual(res.status, 200, 'Gửi kèm answers ngay trong request finalize phải nộp bài được, không báo nhầm thiếu câu bắt buộc');
      assertEqual(res.body.item.isPassed, true, 'Trả lời đầy đủ + không lỗi phải đạt');
    });

    await run.run('BUG THẬT (mirror DEDUCTION): "Nộp Bài" ngay với deductions gửi kèm thẳng trong /finalize vẫn phải nộp được', async () => {
      resetRecords();
      const t = seedDeductionTemplate(); t.status = 'ACTIVE';
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id, storeCode: 'Siêu thị A' }, AUDITOR);
      assertEqual(start.status, 200, 'CONTROL_AUDIT đúng phạm vi phải bắt đầu được');
      const subId = start.body.item.id;
      // KHÔNG gọi POST /answers ở đây — mô phỏng đúng người dùng chưa từng bấm "Lưu Nháp".
      const res = await api('POST', `/api/checklist/submissions/${subId}/finalize`, { deductions: [] }, AUDITOR);
      assertEqual(res.status, 200, 'Loại mẫu DEDUCTION không có khái niệm câu bắt buộc — phải nộp được ngay cả khi gửi kèm deductions rỗng');
    });

    await run.run('Finalize: KHÔNG gửi answers trong body (client cũ) vẫn dùng đúng sub.answers đã lưu nháp sẵn (không bị xoá trắng oan)', async () => {
      resetRecords();
      const t = seedTemplate(); t.status = 'ACTIVE';
      const passOption = t.questions[0].options.find(o => o.isPassing);
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_A_EMP);
      const subId = start.body.item.id;
      await api('POST', `/api/checklist/submissions/${subId}/answers`, { answers: [{ questionId: t.questions[0].id, optionIds: [passOption.id], note: '' }] }, STORE_A_EMP);
      const res = await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, STORE_A_EMP);
      assertEqual(res.status, 200, 'Đã lưu nháp trước đó, gọi /finalize body rỗng (client cũ) vẫn phải nộp được bình thường như trước nay');
      assertEqual(res.body.item.isPassed, true, 'Phải dùng đúng answers đã lưu nháp, không bị coi là rỗng');
    });

    await run.run('Finalize: chọn lựa chọn lỗi nghiêm trọng ép isPassed=false bất kể %', async () => {
      resetRecords();
      const t = seedTemplate(); t.status = 'ACTIVE';
      const failOption = t.questions[0].options.find(o => o.isCriticalFail);
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_A_EMP);
      const subId = start.body.item.id;
      // Câu trả lời lỗi nghiêm trọng — CHƯA đính ảnh minh chứng -> phải bị chặn trước (kiểm ở case sau).
      await api('POST', `/api/checklist/submissions/${subId}/answers`, { answers: [{ questionId: t.questions[0].id, optionIds: [failOption.id], note: '' }] }, STORE_A_EMP);
      const blocked = await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, STORE_A_EMP);
      assertEqual(blocked.status, 400, 'Câu trả lời bị đánh giá lỗi mà chưa có ảnh minh chứng phải bị chặn nộp bài');

      // Đính ảnh minh chứng thủ công (bỏ qua bước upload thật, chỉ kiểm hành vi finalize) rồi nộp lại.
      await checklistAttachFakePhoto(subId, t.questions[0].id);
      const res = await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, STORE_A_EMP);
      assertEqual(res.status, 200, 'Sau khi có ảnh minh chứng phải nộp bài được');
      assertEqual(res.body.item.hasCriticalFail, true, 'Phải ghi nhận có lỗi nghiêm trọng');
      assertEqual(res.body.item.isPassed, false, 'Lỗi nghiêm trọng phải ép isPassed=false bất kể % điểm');
    });

    await run.run('CL-09: lựa chọn Lỗi nghiêm trọng NHƯNG lỡ vẫn mang cờ isPassing=true (lỗi cấu hình mẫu) vẫn bắt buộc ảnh', async () => {
      resetRecords();
      // Mô phỏng ĐÚNG kịch bản đã tìm thấy: builder UI mặc định isPassing:true khi thêm lựa chọn mới,
      // người tạo mẫu tick thêm "Lỗi nghiêm trọng" nhưng quên bỏ tick "Đạt" — validateChecklistQuestions()
      // không có ràng buộc nào chặn 2 cờ cùng true, nên đây là dữ liệu mẫu HOÀN TOÀN hợp lệ ở tầng đó.
      const t = seedTemplate({
        questions: [{
          text: 'Vệ sinh khu vực quầy có đạt không?', isRequired: true, maxScore: 10,
          options: [
            { text: 'Đạt', scoreValue: 10, isPassing: true },
            { text: 'Lỗi nghiêm trọng (lỡ vẫn tick Đạt)', scoreValue: 10, isPassing: true, isCriticalFail: true }
          ]
        }]
      });
      t.status = 'ACTIVE';
      const misconfiguredOption = t.questions[0].options.find(o => o.isCriticalFail);
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_A_EMP);
      const subId = start.body.item.id;
      await api('POST', `/api/checklist/submissions/${subId}/answers`, { answers: [{ questionId: t.questions[0].id, optionIds: [misconfiguredOption.id], note: '' }] }, STORE_A_EMP);
      const blocked = await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, STORE_A_EMP);
      assertEqual(blocked.status, 400, 'Chọn Lỗi nghiêm trọng mà chưa có ảnh minh chứng PHẢI bị chặn, bất kể isPassing đang là gì trên lựa chọn đó');

      await checklistAttachFakePhoto(subId, t.questions[0].id);
      const res = await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, STORE_A_EMP);
      assertEqual(res.status, 200, 'Sau khi có ảnh minh chứng phải nộp bài được');
      assertEqual(res.body.item.hasCriticalFail, true, 'Vẫn phải ghi nhận có lỗi nghiêm trọng');
      assertEqual(res.body.item.isPassed, false, 'Lỗi nghiêm trọng vẫn phải ép isPassed=false dù isPassing=true trên lựa chọn đã chọn');
    });

    await run.run('Finalize: không lỗi, đạt ngưỡng % thì isPassed=true', async () => {
      resetRecords();
      const t = seedTemplate(); t.status = 'ACTIVE';
      const passOption = t.questions[0].options.find(o => o.isPassing);
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_A_EMP);
      const subId = start.body.item.id;
      await api('POST', `/api/checklist/submissions/${subId}/answers`, { answers: [{ questionId: t.questions[0].id, optionIds: [passOption.id], note: '' }] }, STORE_A_EMP);
      const res = await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, STORE_A_EMP);
      assertEqual(res.status, 200, 'Trả lời đầy đủ, không lỗi phải nộp bài được');
      assertEqual(res.body.item.isPassed, true, 'Đạt điểm và không lỗi nghiêm trọng phải isPassed=true');
      assertEqual(res.body.item.scorePercent, 100, 'Chọn đúng lựa chọn tối đa điểm phải đạt 100%');
    });

    await run.run('Bài đã SUBMITTED không sửa/nộp lại được', async () => {
      resetRecords();
      const t = seedTemplate(); t.status = 'ACTIVE';
      const passOption = t.questions[0].options.find(o => o.isPassing);
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_A_EMP);
      const subId = start.body.item.id;
      await api('POST', `/api/checklist/submissions/${subId}/answers`, { answers: [{ questionId: t.questions[0].id, optionIds: [passOption.id] }] }, STORE_A_EMP);
      await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, STORE_A_EMP);
      const res = await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, STORE_A_EMP);
      assertEqual(res.status, 409, 'Bài đã nộp không thể nộp lại lần nữa');
    });

    // ===== 5. Phản hồi kết quả (Kết Quả & Phản Hồi) =====
    await run.run('Store-response: chỉ đúng siêu thị của bài CONTROL_AUDIT mới phản hồi được', async () => {
      resetRecords();
      const t = seedTemplate({ templateType: 'CONTROL_AUDIT' }); t.status = 'ACTIVE';
      const passOption = t.questions[0].options.find(o => o.isPassing);
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id, storeCode: 'Siêu thị A' }, AUDITOR);
      const subId = start.body.item.id;
      await api('POST', `/api/checklist/submissions/${subId}/answers`, { answers: [{ questionId: t.questions[0].id, optionIds: [passOption.id] }] }, AUDITOR);
      await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, AUDITOR);

      const wrongStore = await api('POST', `/api/checklist/submissions/${subId}/store-response`, { responseText: 'Đã khắc phục' }, STORE_B_EMP);
      assertEqual(wrongStore.status, 403, 'Nhân viên siêu thị KHÁC không được phản hồi kết quả');

      const correctStore = await api('POST', `/api/checklist/submissions/${subId}/store-response`, { responseText: 'Đã khắc phục' }, STORE_A_EMP);
      assertEqual(correctStore.status, 200, 'Đúng nhân viên siêu thị được đánh giá phải phản hồi được');
      assertEqual(correctStore.body.item.storeResponseText, 'Đã khắc phục', 'Nội dung phản hồi phải được lưu đúng');
    });

    // ===== CL-06: template không còn ACTIVE (đã bị thay bằng bản clone/kích hoạt khác) vẫn phải xem
    // được nếu user có bài nộp tham chiếu đúng template đó — nếu không, người từng làm bài mất khả năng
    // tra cứu lại câu hỏi/đáp án gốc ngay khi có ai kích hoạt bản mới thay thế (xem lib/recordViewScope.js).
    await run.run('CL-06: template ARCHIVED vẫn xem được nếu user có bài nộp (checklistSubmissions) tham chiếu tới nó', () => {
      const { canViewChecklistTemplate, filterChecklistTemplatesForUser } = require('../lib/recordViewScope');
      const archived = { id: 501, status: 'ARCHIVED', templateCode: 'CL_OLD', templateType: 'STORE_SELF' };
      const otherArchived = { id: 502, status: 'ARCHIVED', templateCode: 'CL_OTHER', templateType: 'STORE_SELF' };
      const ownSubmission = { id: 1, templateId: 501, submittedByUsername: STORE_A_EMP.username, status: 'SUBMITTED', storeCode: 'Siêu thị A' };
      const appData = { checklistSubmissions: [ownSubmission] };

      assertEqual(canViewChecklistTemplate(STORE_A_EMP, archived, appData), true, 'user có bài nộp tham chiếu template ARCHIVED phải xem được template đó');
      assertEqual(canViewChecklistTemplate(STORE_A_EMP, otherArchived, appData), false, 'user KHÔNG có bài nộp nào tham chiếu template ARCHIVED khác vẫn phải bị chặn');
      assertEqual(canViewChecklistTemplate(STORE_B_EMP, archived, appData), false, 'user khác (không phải chủ bài nộp) không được xem template ARCHIVED qua lỗ hổng này');

      const visible = filterChecklistTemplatesForUser([archived, otherArchived], STORE_A_EMP, appData);
      assertEqual(visible.length, 1, 'filterChecklistTemplatesForUser phải chỉ giữ lại đúng 1 template được tham chiếu');
      assertEqual(visible[0].id, 501, 'template giữ lại phải đúng là template được bài nộp tham chiếu');
    });

    // ===== 6 (v20.9): trừ điểm (scoreValue âm) cho câu "yêu cầu vàng" + sàn tổng điểm ở 0 =====
    await run.run('SCORED: scoreValue âm hợp lệ (không bị validate chặn) — dùng để trừ điểm', () => {
      const questions = checklist.validateChecklistQuestions([{
        text: 'Có tuân thủ PCCC không?', isRequired: true, maxScore: 0,
        options: [
          { text: 'Đạt', scoreValue: 0, isPassing: true },
          { text: 'Không đạt', scoreValue: -20, isPassing: false, isCriticalFail: true }
        ]
      }], 'SCORED');
      assertEqual(questions[0].options[1].scoreValue, -20, 'scoreValue âm phải được giữ nguyên, không bị ép về 0/dương');
    });

    await run.run('Finalize: chọn đáp án âm điểm ở 1 đợt, đợt khác vẫn dương -> tổng điểm/% CHẶN SÀN ở 0 (không hiển thị số âm)', async () => {
      resetRecords();
      const t = seedTemplate({
        questions: [
          {
            text: 'Câu thường (10đ)', isRequired: true, maxScore: 10,
            options: [{ text: 'Đạt', scoreValue: 10, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }]
          },
          {
            text: 'Yêu cầu vàng (trừ 20đ nếu không đạt)', isRequired: true, maxScore: 0,
            options: [{ text: 'Đạt', scoreValue: 0, isPassing: true }, { text: 'Không đạt', scoreValue: -20, isPassing: false, isCriticalFail: true }]
          }
        ]
      });
      t.status = 'ACTIVE';
      const q1Pass = t.questions[0].options.find(o => o.isPassing);
      const q2Fail = t.questions[1].options.find(o => o.isCriticalFail);
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_A_EMP);
      const subId = start.body.item.id;
      await api('POST', `/api/checklist/submissions/${subId}/answers`, { answers: [
        { questionId: t.questions[0].id, optionIds: [q1Pass.id] },
        { questionId: t.questions[1].id, optionIds: [q2Fail.id] }
      ] }, STORE_A_EMP);
      await checklistAttachFakePhoto(subId, t.questions[1].id);
      const res = await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, STORE_A_EMP);
      assertEqual(res.status, 200, 'Đủ ảnh minh chứng phải nộp bài được');
      // 10 (câu 1) + (-20) (câu 2) = -10 tổng thô -> CHẶN SÀN về 0 (không hiển thị số âm ra báo cáo).
      assertEqual(res.body.item.totalScore, 0, 'Tổng điểm phải chặn sàn ở 0, không cho xuống âm dù cộng dồn ra số âm');
      assertEqual(res.body.item.scorePercent, 0, 'scorePercent cũng phải chặn sàn ở 0 tương ứng');
      assertEqual(res.body.item.hasCriticalFail, true, 'Vẫn phải ghi nhận lỗi nghiêm trọng ở câu yêu cầu vàng');
      assertEqual(res.body.item.isPassed, false, 'Lỗi nghiêm trọng vẫn ép isPassed=false (không phụ thuộc điểm)');
    });

    // ===== 7 (v20.9): scoringMode PASS_FAIL_ONLY — ẩn hẳn điểm/%, Đạt/Không đạt suy từ isPassing =====
    await run.run('assertTemplateCoreFields: PASS_FAIL_ONLY ép passThreshold về null bất kể client gửi gì', () => {
      const core = checklist.assertTemplateCoreFields({
        templateCode: 'CL_PF', templateName: 'Checklist Pass/Fail', templateType: 'STORE_SELF',
        scoringMode: 'PASS_FAIL_ONLY', passThreshold: 80
      });
      assertEqual(core.scoringMode, 'PASS_FAIL_ONLY', 'scoringMode phải giữ đúng giá trị hợp lệ client gửi');
      assertEqual(core.passThreshold, null, 'PASS_FAIL_ONLY phải ép passThreshold về null dù client cố gửi 80');
    });

    await run.run('validateChecklistQuestions: PASS_FAIL_ONLY ép cứng maxScore/scoreValue về 0 (bỏ qua số client gửi)', () => {
      const questions = checklist.validateChecklistQuestions([{
        text: 'Đồng phục có đúng quy định không?', isRequired: true, maxScore: 50,
        options: [{ text: 'Đạt', scoreValue: 999, isPassing: true }, { text: 'Không đạt', scoreValue: -50, isPassing: false }]
      }], 'PASS_FAIL_ONLY');
      assertEqual(questions[0].maxScore, 0, 'PASS_FAIL_ONLY phải ép maxScore về 0 dù client gửi 50');
      assertEqual(questions[0].options[0].scoreValue, 0, 'PASS_FAIL_ONLY phải ép scoreValue đáp án Đạt về 0 dù client gửi 999');
      assertEqual(questions[0].options[1].scoreValue, 0, 'PASS_FAIL_ONLY phải ép scoreValue đáp án Không đạt về 0 dù client gửi -50');
    });

    await run.run('Finalize PASS_FAIL_ONLY: mọi câu chọn đáp án Đạt -> isPassed=true, KHÔNG có điểm/% nào được lưu', async () => {
      resetRecords();
      const t = seedTemplate({
        scoringMode: 'PASS_FAIL_ONLY',
        questions: [{
          text: 'Khu vực có sạch sẽ không?', isRequired: true,
          options: [{ text: 'Đạt', isPassing: true }, { text: 'Không đạt', isPassing: false }]
        }]
      });
      t.status = 'ACTIVE';
      const passOption = t.questions[0].options.find(o => o.isPassing);
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_A_EMP);
      const subId = start.body.item.id;
      await api('POST', `/api/checklist/submissions/${subId}/answers`, { answers: [{ questionId: t.questions[0].id, optionIds: [passOption.id] }] }, STORE_A_EMP);
      const res = await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, STORE_A_EMP);
      assertEqual(res.status, 200, 'Trả lời đầy đủ phải nộp bài được');
      assertEqual(res.body.item.isPassed, true, 'Mọi câu chọn đáp án Đạt -> isPassed=true');
      assertEqual(res.body.item.totalScore, null, 'PASS_FAIL_ONLY KHÔNG được lưu totalScore (ẩn chấm điểm hoàn toàn, không chỉ ẩn ở UI)');
      assertEqual(res.body.item.maxPossibleScore, null, 'PASS_FAIL_ONLY KHÔNG được lưu maxPossibleScore');
      assertEqual(res.body.item.scorePercent, null, 'PASS_FAIL_ONLY KHÔNG được lưu scorePercent');
    });

    await run.run('Finalize PASS_FAIL_ONLY: chọn 1 đáp án "Không đạt" (không phải lỗi nghiêm trọng) -> isPassed=false dù không có % nào để so ngưỡng', async () => {
      resetRecords();
      const t = seedTemplate({
        scoringMode: 'PASS_FAIL_ONLY',
        questions: [{
          text: 'Khu vực có sạch sẽ không?', isRequired: true,
          options: [{ text: 'Đạt', isPassing: true }, { text: 'Không đạt', isPassing: false }]
        }]
      });
      t.status = 'ACTIVE';
      const failOption = t.questions[0].options.find(o => !o.isPassing);
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_A_EMP);
      const subId = start.body.item.id;
      await api('POST', `/api/checklist/submissions/${subId}/answers`, { answers: [{ questionId: t.questions[0].id, optionIds: [failOption.id] }] }, STORE_A_EMP);
      await checklistAttachFakePhoto(subId, t.questions[0].id);
      const res = await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, STORE_A_EMP);
      assertEqual(res.status, 200, 'Đủ ảnh minh chứng phải nộp bài được');
      assertEqual(res.body.item.isPassed, false, 'PASS_FAIL_ONLY: có câu chọn đáp án Không đạt -> cả bài Không đạt (suy TRỰC TIẾP từ isPassing, không qua %)');
      assertEqual(res.body.item.scorePercent, null, 'Vẫn không có scorePercent nào được lưu dù isPassed=false');
    });

    // ===== 8 (v21.0) — LOẠI 2: DEDUCTION ("Trừ điểm theo hạng mục", theo file VSATTP người dùng gửi) =====
    await run.run('validateChecklistCategories(): hạng mục con KHÔNG đặt trần riêng (maxDeduction=null) -> giữ null, KHÔNG tự gán = trần hạng mục lớn ở bước validate (chỉ áp dụng lúc CHẤM ĐIỂM)', () => {
      const categories = checklist.validateChecklistCategories([
        { name: 'A', maxDeduction: 30, subItems: [
          { name: 'A1', maxDeduction: null, criteria: [{ description: 'crit', perInstanceValue: 2 }] }
        ] }
      ]);
      assertEqual(categories[0].subItems[0].maxDeduction, null, 'maxDeduction null phải giữ nguyên null ở bước validate');
    });

    await run.run('validateChecklistCategories(): thiếu tên hạng mục/hạng mục con/mô tả tiêu chí đều bị chặn rõ ràng', () => {
      let err1 = null;
      try { checklist.validateChecklistCategories([{ name: '', maxDeduction: 10, subItems: [] }]); } catch (e) { err1 = e; }
      assertEqual(err1?.status, 400, 'Thiếu tên hạng mục phải bị chặn 400');

      let err2 = null;
      try { checklist.validateChecklistCategories([{ name: 'A', maxDeduction: 10, subItems: [] }]); } catch (e) { err2 = e; }
      assertEqual(err2?.status, 400, 'Hạng mục không có hạng mục con nào phải bị chặn 400');

      let err3 = null;
      try { checklist.validateChecklistCategories([{ name: 'A', maxDeduction: 10, subItems: [{ name: 'A1', criteria: [{ description: '' }] }] }]); } catch (e) { err3 = e; }
      assertEqual(err3?.status, 400, 'Tiêu chí thiếu mô tả phải bị chặn 400');
    });

    await run.run('computeDeductionScoring(): hạng mục con KHÔNG có trần riêng -> dùng TRỌN VẸN trần hạng mục lớn (không chia đều)', () => {
      const t = { categories: checklist.validateChecklistCategories([
        { name: 'A', maxDeduction: 30, subItems: [
          { name: 'A1', maxDeduction: null, criteria: [{ description: 'c1', perInstanceValue: 2 }] }
        ] }
      ]), passThreshold: null };
      const scoring = checklist.computeDeductionScoring(t, [{ criteriaId: 1, deductedPoints: 5 }]);
      assertEqual(scoring.totalScore, 25, 'A1 dùng trọn trần 30 của hạng mục A -> 30-5=25');
      assertEqual(scoring.maxPossibleScore, 30, 'maxPossibleScore = tổng trần các hạng mục lớn');
    });

    await run.run('computeDeductionScoring(): trừ vượt trần hạng mục con -> điểm hạng mục con đó CHẶN SÀN ở 0 (không kéo âm sang hạng mục khác)', () => {
      const t = { categories: checklist.validateChecklistCategories([
        { name: 'A', maxDeduction: 30, subItems: [
          { name: 'A1', maxDeduction: 10, criteria: [{ description: 'c1', perInstanceValue: 2 }] },
          { name: 'A2', maxDeduction: 20, criteria: [{ description: 'c2', perInstanceValue: 2 }] }
        ] }
      ]), passThreshold: null };
      // A1 (trần 10) bị trừ 15 -> chặn sàn 0 (không phải -5); A2 (trần 20) không bị trừ gì -> giữ nguyên 20.
      const scoring = checklist.computeDeductionScoring(t, [{ criteriaId: 1, deductedPoints: 15 }]);
      assertEqual(scoring.totalScore, 20, 'A1=max(0,10-15)=0, A2=20 -> tổng 20');
    });

    await run.run('computeDeductionScoring(): tổng điểm hạng mục con CHẶN THÊM 1 lớp sàn ở trần hạng mục lớn (đề phòng cấu hình trần con cộng lại vượt trần cha)', () => {
      const t = { categories: checklist.validateChecklistCategories([
        { name: 'A', maxDeduction: 30, subItems: [
          { name: 'A1', maxDeduction: 25, criteria: [{ description: 'c1' }] },
          { name: 'A2', maxDeduction: 25, criteria: [{ description: 'c2' }] } // 25+25=50 > trần cha 30 — cấu hình "lệch" nhưng vẫn phải an toàn
        ] }
      ]), passThreshold: null };
      const scoring = checklist.computeDeductionScoring(t, []); // không trừ gì -> A1=25, A2=25, tổng thô 50
      assertEqual(scoring.totalScore, 30, 'Tổng điểm hạng mục A phải chặn ở đúng trần 30 dù 2 hạng mục con cộng lại ra 50');
    });

    await run.run('Template: templateKind BẤT BIẾN — sửa (edit) cố đổi từ DEDUCTION sang QA (hoặc ngược lại) phải bị chặn 400', async () => {
      resetRecords();
      const t = seedDeductionTemplate();
      const res = await api('POST', `/api/checklist/templates/${t.id}/edit`, {
        templateCode: t.templateCode, templateName: t.templateName, templateType: t.templateType,
        templateKind: 'QA', questions: [{ text: 'x', options: [{ text: 'Đạt', isPassing: true }, { text: 'Không đạt', isPassing: false }] }]
      }, MANAGER);
      assertEqual(res.status, 400, 'Đổi loại mẫu sau khi đã tạo phải bị chặn 400');
    });

    await run.run('Template DEDUCTION: kích hoạt khi chưa có hạng mục nào bị chặn (mirror đúng luật QA "cần ít nhất 1 câu hỏi")', async () => {
      resetRecords();
      const t = seedDeductionTemplate();
      t.categories = [];
      const res = await api('POST', `/api/checklist/templates/${t.id}/activate`, {}, MANAGER);
      assertEqual(res.status, 400, 'Kích hoạt template DEDUCTION rỗng categories phải bị chặn 400');
    });

    await run.run('Finalize DEDUCTION: nộp bài KHÔNG cần ảnh minh chứng (khác QA) dù có tiêu chí bị trừ điểm nhiều', async () => {
      resetRecords();
      const t = seedDeductionTemplate();
      t.status = 'ACTIVE';
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id, storeCode: 'Siêu thị A' }, AUDITOR);
      assertEqual(start.status, 200, 'CONTROL_AUDIT đúng phạm vi phải bắt đầu được');
      const subId = start.body.item.id;
      const c1 = t.categories[0].subItems[0].criteria[0].id; // "Bao bì không nguyên vẹn", cat A max=30 (A1 dùng trọn)
      const c2 = t.categories[0].subItems[1].criteria[0].id; // "Hạn sử dụng", subItem maxDeduction=null -> dùng chung trần cat A (30)
      await api('POST', `/api/checklist/submissions/${subId}/answers`, { deductions: [
        { criteriaId: c1, deductedPoints: 4, description: 'Ớt chuông đỏ mốc', riskLevel: 'A', deadline: '15/05/2026', note: 'Rà soát lại' },
        { criteriaId: c2, deductedPoints: 8, description: 'Hết hạn 2 mã', riskLevel: 'B' }
      ] }, AUDITOR);
      const res = await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, AUDITOR);
      assertEqual(res.status, 200, 'Nộp bài KHÔNG cần ảnh minh chứng phải thành công (khác QA)');
      // cat A (max 30): A1 dùng trọn trần 30, trừ 4 -> 26. A2 (không đặt trần riêng) CŨNG dùng trọn trần 30, trừ 8 -> 22.
      // categoryScore = 26+22=48, chặn ở trần cat A =30 -> totalScore=30. cat NHÂN VIÊN (max 5) không trừ gì -> 5.
      // maxPossibleScore = 30+5=35. totalScore=30+5=35.
      assertEqual(res.body.item.totalScore, 35, 'Tổng điểm phải đúng (cat A chặn ở trần 30 + cat NHÂN VIÊN nguyên vẹn 5)');
      assertEqual(res.body.item.maxPossibleScore, 35, 'maxPossibleScore = tổng trần các hạng mục lớn (30+5)');
      assertEqual(res.body.item.hasCriticalFail, false, 'DEDUCTION không có khái niệm Lỗi nghiêm trọng — luôn false');
      assertEqual(Array.isArray(res.body.item.deductions) && res.body.item.deductions.length === 2, true, 'deductions phải được lưu lại đầy đủ', res.body.item.deductions);
    });

    run.summary();
  } finally {
    server.close();
  }
}

// Gắn thẳng attachment vào RECORDS (bỏ qua bước upload thật /api/upload — test riêng ở routes/upload.js,
// không thuộc phạm vi test này) để kiểm hành vi assertReadyToFinalize() với answersNeedingPhoto.
async function checklistAttachFakePhoto(subId, questionId) {
  const sub = RECORDS.checklistSubmissions.find(s => s.id === subId);
  const answers = sub.answers.map(a => a.questionId === questionId
    ? Object.assign({}, a, { attachments: [{ fileUrl: '/uploads/fake.jpg', fileName: 'fake.jpg', fileType: 'image/jpeg' }] })
    : a);
  sub.answers = answers;
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
