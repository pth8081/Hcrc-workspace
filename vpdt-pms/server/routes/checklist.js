// routes/checklist.js — Module "Checklist Đánh Giá Siêu Thị" (module TOP-LEVEL riêng — xem
// lib/checklist.js đầu file cho toàn bộ thiết kế + lý do kiến trúc). Route RIÊNG (không qua
// routes/records.js chung) vì module này có khá nhiều hành động vòng đời khác nhau (template: sửa/
// nhân bản/kích hoạt/xoá; submission: bắt đầu/lưu nháp/đính kèm ảnh/nộp bài/phản hồi) — mirror đúng lý
// do routes/payroll.js đã tách riêng (payslips) thay vì dồn hết vào routes/records.js.
//
// POST /api/create/checklistTemplates (routes/create.js, generic) TẠO MỚI 1 template DRAFT — mọi thao
// tác còn lại (sửa/nhân bản/kích hoạt/xoá template; toàn bộ vòng đời submission) đều ở đây.
const express = require('express');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');
const { getAllForCollection, insertRecord, withLockedRecordForCollection, withAppLock, deleteRecordForCollection } = require('../lib/recordStore');
const { assertUploadedFileUrl } = require('../lib/createValidation');
const { assertPayloadFileUrlsOwnedByUser } = require('../lib/uploadedFiles');
const { getAppDataValueCached } = require('../lib/appData');
const checklist = require('../lib/checklist');
const { buildQaReportWorkbook, buildDeductionReportWorkbook, buildVsattpDashboardWorkbook } = require('../lib/checklistReportExport');

router.use(requireAuth, blockIfMustChangePassword);

// LỖI ĐÃ VÁ (rà soát chuyên sâu 10/2026, mức Thấp — "moduleKey do client tự khai"): ràng buộc "ảnh minh
// chứng CHỈ nhận ảnh" của Checklist trước đây nằm HOÀN TOÀN ở POST /api/upload, và quyết định theo đúng
// field text `module` mà CHÍNH CLIENT gửi kèm (routes/upload.js, MODULE_DEFAULT_ALLOWED_EXT
// ['checklistAnswerPhoto']) — 1 request tự soạn chỉ cần khai module='doc' (hoặc bỏ trống) là tải lên
// được .pdf/.docx/.xlsx rồi gắn thẳng vào ảnh minh chứng qua route .../attachments bên dưới, vì route
// đó chỉ kiểm hình dạng URL + quyền sở hữu tệp. Server KHÔNG lưu lại moduleKey đã khai nên không truy
// ngược được — thay vào đó kiểm tra lại ĐUÔI TỆP tại đúng nơi tệp được dùng làm ảnh minh chứng (đuôi
// trong /uploads/... là đuôi THẬT đã qua verifyFileSignature() đối chiếu chữ ký nhị phân ở bước upload,
// không giả được bằng cách đổi tên).
// Danh sách cho phép: đọc đúng cấu hình admin cho 'checklistAnswerPhoto' ("Quản Lý Tệp File") nếu có,
// không thì rơi về mặc định ảnh — mirror ĐÚNG thứ tự ưu tiên ở routes/upload.js để 2 nơi không lệch nhau.
const CHECKLIST_PHOTO_DEFAULT_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
async function assertChecklistPhotoFileUrl(fileUrl) {
  let allowed = CHECKLIST_PHOTO_DEFAULT_EXT;
  try {
    const config = await getAppDataValueCached('uploadFileTypeConfig');
    const configured = config && config.checklistAnswerPhoto;
    if (Array.isArray(configured) && configured.length) allowed = configured;
  } catch (e) {
    // Lỗi tra cứu cấu hình -> giữ danh sách mặc định (siết chặt), không fail-open.
  }
  const ext = String(fileUrl).slice(String(fileUrl).lastIndexOf('.')).toLowerCase();
  if (!allowed.includes(ext)) {
    throw new HttpError(400, `Ảnh minh chứng chỉ nhận tệp ảnh (${allowed.join(', ')}) — tệp này là "${ext || 'không rõ'}"`);
  }
}

function requireManage(req, res, next) {
  if (!checklist.canManageChecklistTemplates(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý Checklist Đánh Giá Siêu Thị' });
  }
  next();
}
function requireReportView(req, res, next) {
  if (!checklist.canViewChecklistReports(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền xem Báo Cáo Checklist' });
  }
  next();
}

// ===================== TEMPLATE: sửa (chỉ khi còn DRAFT) =====================
router.post('/templates/:id/edit', requireManage, async (req, res) => {
  const templateId = Number(req.params.id);
  if (!Number.isFinite(templateId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const updated = await withLockedRecordForCollection('checklistTemplates', templateId, (template) => {
      if (template.status !== 'DRAFT') {
        throw new HttpError(409, 'Chỉ sửa được checklist đang ở trạng thái Nháp — checklist đã Kích Hoạt/Lưu Trữ phải Nhân Bản thành bản mới để sửa');
      }
      const core = checklist.assertTemplateCoreFields(req.body);
      // templateKind BẤT BIẾN sau khi tạo (v21.0, xem lib/checklist.js) — template cũ trước v21.0 không
      // có field này, mặc định coi là QA để so sánh không bị lệch oan.
      const existingKind = template.templateKind || 'QA';
      if (core.templateKind !== existingKind) {
        throw new HttpError(400, 'Không thể đổi loại mẫu (Câu hỏi & đáp án / Trừ điểm theo hạng mục) sau khi đã tạo — vui lòng tạo mẫu mới nếu cần loại khác');
      }
      if (core.templateKind === 'DEDUCTION') {
        const categories = checklist.validateChecklistCategories(req.body?.categories);
        return { ...template, ...core, categories };
      }
      const questions = checklist.validateChecklistQuestions(req.body?.questions, core.scoringMode);
      return { ...template, ...core, questions };
    });
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, `checklistTemplates/${req.params.id}/edit`); }
});

// ===================== TEMPLATE: nhân bản (từ 1 template ACTIVE, tạo bản DRAFT version+1) =====================
router.post('/templates/:id/clone', requireManage, async (req, res) => {
  const templateId = Number(req.params.id);
  if (!Number.isFinite(templateId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const templates = await getAllForCollection('checklistTemplates');
    const source = templates.find(t => t.id === templateId);
    if (!source) return res.status(404).json({ error: 'Không tìm thấy checklist' });
    // PHÁT HIỆN (Thấp) ở đợt audit chuyên sâu lần 2: chú thích route này ghi rõ "từ 1 template ACTIVE"
    // nhưng code trước đây không hề kiểm tra — nhân bản được cả từ DRAFT/ARCHIVED, tạo version+1 không
    // đúng ý nghĩa "phiên bản kế tiếp của bản đang dùng thật", dễ gây nhầm lẫn số phiên bản.
    // Mở rộng (v23.4): cho phép nhân bản từ ARCHIVED nữa (không chỉ ACTIVE) — nút "✏️ Sửa" mới ở client
    // (module-checklist.js) gọi ĐÚNG route này cho cả 2 trạng thái để mở lại 1 bản cũ/đang dùng thành
    // bản Nháp sửa tiếp, đúng yêu cầu người dùng "checklist Lưu Trữ cũng sửa/nhân bản được".
    if (source.status === 'DRAFT') return res.status(409).json({ error: 'Checklist Nháp đã sửa trực tiếp được — không cần nhân bản' });
    const templateKind = source.templateKind || 'QA';
    // LỖI ĐÃ VÁ (rà soát chuyên sâu 10/2026, mức Thấp): version trước đây luôn = version CỦA BẢN NGUỒN
    // + 1 — nhân bản từ 1 bản ARCHIVED (được phép từ v23.4) tạo ra version đã TỒN TẠI (VD v1 ARCHIVED +
    // v2 ACTIVE: nhân bản v1 ra thêm 1 "v2" thứ hai cùng templateCode). 2 dòng cùng mã + cùng số phiên
    // bản không phân biệt được ở danh sách/báo cáo (UNIQUE INDEX thật chỉ chặn 2 bản CÙNG ACTIVE, xem
    // route activate bên dưới) nên vẫn lưu được. Lấy version LỚN NHẤT đang có của đúng templateCode + 1.
    const maxVersionOfCode = templates
      .filter(t => t.templateCode === source.templateCode)
      .reduce((max, t) => Math.max(max, Number(t.version) || 1), 0);
    const clone = {
      id: Date.now(),
      templateCode: source.templateCode, templateName: source.templateName, templateType: source.templateType,
      version: Math.max(maxVersionOfCode, Number(source.version) || 1) + 1, status: 'DRAFT',
      clonedFromTemplateId: source.id, templateKind,
      scoringMode: templateKind === 'DEDUCTION' ? null : (source.scoringMode || 'SCORED'), passThreshold: source.passThreshold,
      questions: templateKind === 'DEDUCTION' ? undefined : source.questions,
      categories: templateKind === 'DEDUCTION' ? source.categories : undefined,
      activatedAt: null,
      creator: req.freshUser.username, creatorName: req.freshUser.name
    };
    const inserted = await insertRecord('checklistTemplates', clone);
    res.json({ ok: true, item: inserted });
  } catch (err) { sendCatchError(res, err, `checklistTemplates/${req.params.id}/clone`); }
});

// ===================== TEMPLATE: kích hoạt (DRAFT/ARCHIVED -> ACTIVE, tự lưu trữ bản ACTIVE cũ cùng mã) =====================
// Mở rộng (v23.5): trước đây chỉ kích hoạt được từ DRAFT — người dùng phản ánh bấm "⏸️ Dừng" xong không
// có cách nào kích hoạt LẠI đúng bản đó (chỉ có "✏️ Sửa" tạo bản Nháp MỚI, không phải bật lại bản cũ) —
// nay cho phép kích hoạt thẳng từ ARCHIVED (không tạo dòng mới, không tăng version, chỉ đổi trạng thái).
router.post('/templates/:id/activate', requireManage, async (req, res) => {
  const templateId = Number(req.params.id);
  if (!Number.isFinite(templateId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const result = await withAppLock(`checklist_template_activate:${templateId}`, async () => {
      const templates = await getAllForCollection('checklistTemplates');
      const target = templates.find(t => t.id === templateId);
      if (!target) throw new HttpError(404, 'Không tìm thấy checklist');
      if (target.status !== 'DRAFT' && target.status !== 'ARCHIVED') {
        throw new HttpError(409, 'Chỉ kích hoạt được checklist đang ở trạng thái Nháp hoặc Lưu trữ');
      }
      if (target.templateKind === 'DEDUCTION') {
        if (!(target.categories || []).length) throw new HttpError(400, 'Checklist cần ít nhất 1 hạng mục đánh giá trước khi kích hoạt');
      } else if (!(target.questions || []).length) {
        throw new HttpError(400, 'Checklist cần ít nhất 1 câu hỏi trước khi kích hoạt');
      }

      // Lưu trữ (ARCHIVED) mọi bản ACTIVE khác CÙNG templateCode TRƯỚC khi kích hoạt bản này — BẮT BUỘC
      // đúng thứ tự này (không phải kích hoạt trước, lưu trữ sau như bản cũ): UNIQUE INDEX thật lọc theo
      // Status='ACTIVE' (sql/schema.sql, v23.5) sẽ chặn ngay nếu có khoảnh khắc 2 dòng CÙNG ACTIVE cùng
      // mã, kể cả chỉ trong 1 câu lệnh UPDATE trung gian.
      const others = templates.filter(t => t.id !== templateId && t.templateCode === target.templateCode && t.status === 'ACTIVE');
      for (const other of others) {
        await withLockedRecordForCollection('checklistTemplates', other.id, (t) => ({ ...t, status: 'ARCHIVED' }));
      }
      const activated = await withLockedRecordForCollection('checklistTemplates', templateId, (t) => ({
        ...t, status: 'ACTIVE', activatedAt: checklist.nowVN()
      }));
      return activated;
    });
    res.json({ ok: true, item: result });
  } catch (err) { sendCatchError(res, err, `checklistTemplates/${req.params.id}/activate`); }
});

// ===================== TEMPLATE: dừng (ACTIVE -> ARCHIVED, thủ công, KHÔNG cần kích hoạt bản thay thế) =====================
// Khác activate() ở trên (tự ARCHIVED các bản ACTIVE khác CÙNG mã khi kích hoạt 1 bản MỚI) — route này
// cho phép dừng hẳn 1 checklist đang dùng mà KHÔNG có bản nào thay thế ngay (VD ngừng hẳn 1 loại đánh
// giá không còn áp dụng nữa) — người dùng yêu cầu riêng nút "⏸️ Dừng" tách biệt "Nhân Bản rồi Kích Hoạt".
router.post('/templates/:id/deactivate', requireManage, async (req, res) => {
  const templateId = Number(req.params.id);
  if (!Number.isFinite(templateId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const updated = await withLockedRecordForCollection('checklistTemplates', templateId, (t) => {
      if (t.status !== 'ACTIVE') throw new HttpError(409, 'Chỉ dừng được checklist đang ở trạng thái Đang dùng');
      return { ...t, status: 'ARCHIVED' };
    });
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, `checklistTemplates/${req.params.id}/deactivate`); }
});

// Xoá template (mọi trạng thái) — người dùng yêu cầu riêng: CHỈ Quản Trị Viên mới xoá được (không phải
// mọi người có checklistTemplateManage như các hành động khác của module này) — thao tác xoá nặng hơn
// hẳn sửa/nhân bản/dừng/kích hoạt, nên gác chặt hơn 1 bậc, mirror tinh thần requireAdmin đã dùng cho
// nhiều thao tác xoá nhạy cảm khác trong app (VD routes/adminExport.js users/import-xlsx).
router.post('/templates/:id/delete', async (req, res) => {
  if (!req.freshUser.perms?.admin) {
    return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới được xoá mẫu checklist' });
  }
  const templateId = Number(req.params.id);
  if (!Number.isFinite(templateId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    // Đọc trước danh sách bài nộp — dùng để chặn xoá 1 template ACTIVE/ARCHIVED đã có ai nộp bài (mồ côi
    // dữ liệu báo cáo cũ, checklistSubmissions.templateId không còn tra ra được câu hỏi/lựa chọn gốc).
    // Template còn DRAFT thì chưa từng kích hoạt nên KHÔNG THỂ có bài nộp — khỏi cần kiểm tra thêm.
    const submissions = await getAllForCollection('checklistSubmissions');
    const hasSubmissions = submissions.some(s => s.templateId === templateId);
    await deleteRecordForCollection('checklistTemplates', templateId, (template) => {
      if (template.status !== 'DRAFT' && hasSubmissions) {
        throw new HttpError(409, 'Checklist này đã có người nộp bài — không thể xoá (sẽ làm mất dữ liệu báo cáo cũ), hãy dùng "⏸️ Dừng" thay thế');
      }
    }, { username: req.freshUser.username, name: req.freshUser.name });
    res.json({ ok: true });
  } catch (err) { sendCatchError(res, err, `checklistTemplates/${req.params.id}/delete`); }
});

// ===================== SUBMISSION: bắt đầu 1 bài (Mục 7.1 — điểm bảo mật cốt lõi) =====================
router.post('/submissions/start', async (req, res) => {
  try {
    const user = req.freshUser;
    const templateId = Number(req.body?.templateId);
    if (!Number.isFinite(templateId)) return res.status(400).json({ error: 'Thiếu templateId' });
    const templates = await getAllForCollection('checklistTemplates');
    const template = templates.find(t => t.id === templateId && t.status === 'ACTIVE');
    if (!template) return res.status(404).json({ error: 'Không tìm thấy checklist đang hoạt động' });

    // LỖI ĐÃ VÁ (rà soát chuyên sâu 2, cụm "Hành Chính"): đối chiếu storeCode với Danh Mục Siêu Thị THẬT
    // ở MỌI nhánh (kể cả admin/scope.all) — xem chú thích đầy đủ tại resolveStoreCodeForSubmission().
    const validStoreCodes = (await getAppDataValueCached('stores')) || [];
    const storeCode = checklist.resolveStoreCodeForSubmission(template, user, req.body?.storeCode, validStoreCodes);

    // Resumable draft — nếu người này ĐANG có 1 bài DRAFT chưa nộp của ĐÚNG checklist + siêu thị này,
    // trả lại bài đó thay vì tạo bài mới (tránh sinh vô số bài dở dang mỗi lần bấm lại "Bắt đầu").
    const existingSubs = await getAllForCollection('checklistSubmissions');
    const existingDraft = existingSubs.find(s => s.templateId === templateId && s.storeCode === storeCode
      && s.submittedByUsername === user.username && s.status === 'DRAFT');
    if (existingDraft) return res.json({ ok: true, item: existingDraft });

    const submission = {
      id: Date.now(),
      templateId: template.id, templateCode: template.templateCode, templateName: template.templateName,
      templateType: template.templateType, templateVersion: template.version,
      storeCode, submittedByUsername: user.username, submittedByName: user.name,
      status: 'DRAFT', answers: [], deductions: [], // deductions[] chỉ có ý nghĩa với templateKind DEDUCTION (v21.0) — luôn khởi tạo cả 2 field cho đơn giản, field không dùng tới thì mãi mãi rỗng.
      totalScore: null, maxPossibleScore: null, scorePercent: null, hasCriticalFail: null, isPassed: null,
      startedAt: checklist.nowVN(), submittedAt: null,
      storeResponseText: null, storeRespondedAt: null, storeRespondedByUsername: null, storeRespondedByName: null,
      storeResponseHistory: [] // bản cũ trước mỗi lần ghi đè store-response (xem POST .../store-response)
    };
    const inserted = await insertRecord('checklistSubmissions', submission);
    res.json({ ok: true, item: inserted });
  } catch (err) { sendCatchError(res, err, 'checklistSubmissions/start'); }
});

// ===================== SUBMISSION: lưu câu trả lời (nháp, nhiều lần) =====================
router.post('/submissions/:id/answers', async (req, res) => {
  const submissionId = Number(req.params.id);
  if (!Number.isFinite(submissionId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const templates = await getAllForCollection('checklistTemplates');
    const updated = await withLockedRecordForCollection('checklistSubmissions', submissionId, (sub) => {
      if (sub.submittedByUsername !== req.freshUser.username) {
        throw new HttpError(403, 'Bạn chỉ có thể sửa bài làm của chính mình');
      }
      if (sub.status !== 'DRAFT') throw new HttpError(409, 'Bài này đã nộp, không thể sửa thêm');
      const template = templates.find(t => t.id === sub.templateId);
      if (!template) throw new HttpError(404, 'Không tìm thấy checklist gốc của bài làm này');
      if (template.templateKind === 'DEDUCTION') {
        return { ...sub, deductions: checklist.sanitizeChecklistDeductions(req.body?.deductions, template, sub.deductions) };
      }
      return { ...sub, answers: checklist.sanitizeChecklistAnswers(req.body?.answers, template, sub.answers) };
    });
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, `checklistSubmissions/${req.params.id}/answers`); }
});

// ===================== SUBMISSION: đính kèm ảnh minh chứng cho 1 câu trả lời/tiêu chí =====================
// Body: { questionId, fileUrl, fileName, fileType } — fileUrl do CHÍNH SERVER sinh ra ở bước upload
// (POST /api/upload, moduleKey='checklistAnswerPhoto') NGAY TRƯỚC lượt gọi này (client 2 bước: upload
// xong mới gọi route này để gắn kết quả vào đúng câu trả lời) — vẫn xác minh lại hình dạng URL cho
// chắc (assertUploadedFileUrl, cùng luật mọi field file khác trong hệ thống). "questionId" TÁI DÙNG
// nguyên tên field cho CẢ 2 loại mẫu (v21.0) — với templateKind DEDUCTION, giá trị này thực chất là
// criteriaId (khớp sub.deductions[].criteriaId) — ảnh TUỲ CHỌN ở loại mẫu này (khác QA), nên route vẫn
// cho phép gọi dù chưa có dòng trừ điểm nào ứng với tiêu chí đó (tự tạo dòng deductedPoints:0 để gắn ảnh).
router.post('/submissions/:id/attachments', async (req, res) => {
  const submissionId = Number(req.params.id);
  if (!Number.isFinite(submissionId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const questionId = Number(req.body?.questionId);
    const fileUrl = String(req.body?.fileUrl || '').trim();
    assertUploadedFileUrl(fileUrl, 'Ảnh minh chứng');
    if (!fileUrl) return res.status(400).json({ error: 'Thiếu tệp ảnh' });
    // Chỉ nhận ảnh THẬT, không phụ thuộc moduleKey client đã khai lúc tải lên — xem
    // assertChecklistPhotoFileUrl() ở đầu file (LỖI ĐÃ VÁ 10/2026).
    await assertChecklistPhotoFileUrl(fileUrl);
    // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026, mức Cao — "giả mạo quyền sở hữu file"): trước đây route
    // này chỉ xác minh ĐÚNG KHUÔN "/uploads/<tên-file>" (assertUploadedFileUrl ở trên), KHÔNG xác minh
    // người gọi có thật sự là người vừa tải ảnh này lên hay không — cho phép tự đặt fileUrl = đường dẫn
    // ảnh THẬT của người khác (đoán/thấy được từ 1 bài checklist khác) để "nhận vơ" làm ảnh minh chứng
    // của chính mình, đúng lớp lỗi đã vá cho luồng tạo mới chung (routes/create.js) nhưng route riêng
    // này (không đi qua routes/create.js) bị bỏ sót. assertPayloadFileUrlsOwnedByUser() ném 403 nếu
    // fileUrl đã được ghi nhận (dbo.UploadedFiles) thuộc về người KHÁC.
    await assertPayloadFileUrlsOwnedByUser({ fileUrl }, req.freshUser);
    const fileName = req.body?.fileName ? String(req.body.fileName).trim().slice(0, 255) : '';
    const fileType = req.body?.fileType ? String(req.body.fileType).trim().slice(0, 100) : '';

    const templates = await getAllForCollection('checklistTemplates');
    const updated = await withLockedRecordForCollection('checklistSubmissions', submissionId, (sub) => {
      if (sub.submittedByUsername !== req.freshUser.username) {
        throw new HttpError(403, 'Bạn chỉ có thể sửa bài làm của chính mình');
      }
      if (sub.status !== 'DRAFT') throw new HttpError(409, 'Bài này đã nộp, không thể sửa thêm');
      const template = templates.find(t => t.id === sub.templateId);
      if (template?.templateKind === 'DEDUCTION') {
        const deductions = [...(sub.deductions || [])];
        let idx = deductions.findIndex(d => d.criteriaId === questionId);
        // Ảnh TUỲ CHỌN ở loại DEDUCTION — cho phép đính kèm dù chưa nhập điểm trừ nào cho tiêu chí này.
        if (idx < 0) { deductions.push({ criteriaId: questionId, deductedPoints: 0, description: '', riskLevel: null, deadline: '', note: '', attachments: [] }); idx = deductions.length - 1; }
        const attachments = [...(deductions[idx].attachments || []), { fileUrl, fileName, fileType }].slice(0, 10);
        deductions[idx] = { ...deductions[idx], attachments };
        return { ...sub, deductions };
      }
      const answers = [...(sub.answers || [])];
      const idx = answers.findIndex(a => a.questionId === questionId);
      if (idx < 0) throw new HttpError(400, 'Vui lòng trả lời câu hỏi này trước khi đính kèm ảnh');
      const attachments = [...(answers[idx].attachments || []), { fileUrl, fileName, fileType }].slice(0, 10);
      answers[idx] = { ...answers[idx], attachments };
      return { ...sub, answers };
    });
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, `checklistSubmissions/${req.params.id}/attachments`); }
});

// ===================== SUBMISSION: nộp bài (Mục 6 — tính điểm + khoá) =====================
router.post('/submissions/:id/finalize', async (req, res) => {
  const submissionId = Number(req.params.id);
  if (!Number.isFinite(submissionId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const templates = await getAllForCollection('checklistTemplates');
    const updated = await withLockedRecordForCollection('checklistSubmissions', submissionId, (sub) => {
      if (sub.submittedByUsername !== req.freshUser.username) {
        throw new HttpError(403, 'Bạn chỉ có thể nộp bài làm của chính mình');
      }
      if (sub.status !== 'DRAFT') throw new HttpError(409, 'Bài này đã nộp trước đó');
      const template = templates.find(t => t.id === sub.templateId);
      if (!template) throw new HttpError(404, 'Không tìm thấy checklist gốc của bài làm này');

      // LỖI THẬT vừa phát hiện: trước đây route này CHỈ chấm điểm trên sub.answers/sub.deductions đã lưu
      // NHÁP SẴN trong DB — nếu người dùng điền form rồi bấm thẳng "✅ Nộp Bài" mà CHƯA từng bấm "💾 Lưu
      // Nháp" lần nào (finalizeChecklistSubmission(), module-checklist.js, TRƯỚC ĐÂY gửi body rỗng {}),
      // server chấm điểm trên dữ liệu RỖNG từ lúc tạo bài -> báo nhầm "Còn N câu hỏi bắt buộc chưa trả
      // lời" dù người dùng đã chọn đúng hết trên màn hình. Nay chấp nhận kèm answers/deductions ngay
      // trong request finalize (client đã gửi kèm, xem sửa cùng đợt ở module-checklist.js) và tự sanitize
      // lại y hệt route /answers ở trên trước khi chấm điểm — vừa vá đúng gốc, vừa không bắt buộc client
      // phải gọi đúng thứ tự 2 lượt request mới ra kết quả đúng. CHỈ ghi đè khi client THỰC SỰ gửi kèm
      // mảng (Array.isArray) — client cũ/đã lưu nháp sẵn rồi gọi finalize KHÔNG kèm gì (body {}) vẫn phải
      // giữ nguyên sub.answers/sub.deductions đã có, không được coi "không gửi" là "xoá trắng".
      const sanitized = template.templateKind === 'DEDUCTION'
        ? { deductions: Array.isArray(req.body?.deductions) ? checklist.sanitizeChecklistDeductions(req.body.deductions, template, sub.deductions) : sub.deductions }
        : { answers: Array.isArray(req.body?.answers) ? checklist.sanitizeChecklistAnswers(req.body.answers, template, sub.answers) : sub.answers };
      const scoring = template.templateKind === 'DEDUCTION'
        ? checklist.computeDeductionScoring(template, sanitized.deductions)
        : checklist.computeChecklistScoring(template, sanitized.answers);
      checklist.assertReadyToFinalize(scoring);
      return {
        ...sub, ...sanitized, status: 'SUBMITTED', submittedAt: checklist.nowVN(),
        totalScore: scoring.totalScore, maxPossibleScore: scoring.maxPossibleScore,
        scorePercent: scoring.scorePercent, hasCriticalFail: scoring.hasCriticalFail, isPassed: scoring.isPassed
      };
    });
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, `checklistSubmissions/${req.params.id}/finalize`); }
});

// ===================== SUBMISSION: phản hồi/giải trình từ siêu thị (chỉ CONTROL_AUDIT) =====================
router.post('/submissions/:id/store-response', async (req, res) => {
  const submissionId = Number(req.params.id);
  if (!Number.isFinite(submissionId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const responseText = String(req.body?.responseText || '').trim().slice(0, 1000);
    if (!responseText) return res.status(400).json({ error: 'Vui lòng nhập nội dung phản hồi' });
    const user = req.freshUser;
    const updated = await withLockedRecordForCollection('checklistSubmissions', submissionId, (sub) => {
      if (sub.templateType !== 'CONTROL_AUDIT') throw new HttpError(400, 'Chỉ áp dụng cho checklist Kiểm Soát');
      if (sub.status !== 'SUBMITTED') throw new HttpError(409, 'Bài này chưa nộp xong, chưa thể phản hồi');
      if (sub.storeCode !== user.dept || user.posType !== 'STORE') {
        throw new HttpError(403, 'Bạn chỉ có thể phản hồi kết quả đánh giá của đúng siêu thị mình');
      }
      // LỖI ĐÃ VÁ (rà soát chuyên sâu 2, cụm "Hành Chính", mức Trung bình): route này TRƯỚC ĐÂY ghi đè
      // TRỰC TIẾP storeResponseText mà không lưu vết bản cũ — BẤT KỲ nhân viên nào của siêu thị (không
      // riêng quản lý, route chỉ đòi storeCode===user.dept && posType==='STORE') gửi được, ghi đè VĨNH
      // VIỄN phản hồi trước đó, không giới hạn số lần, không có lịch sử để đối chiếu lại "ai đã nói gì
      // lúc nào". Vá TỐI THIỂU chống MẤT DỮ LIỆU (chưa giới hạn vai trò gửi — nằm ngoài phạm vi đợt vá
      // này): nếu ĐÃ có phản hồi cũ, đẩy nguyên bản cũ vào storeResponseHistory[] TRƯỚC KHI ghi đè, giữ
      // mảng cũ có sẵn (nếu có) + append — không bao giờ xoá lịch sử đã có ở lượt trước.
      const priorHistory = Array.isArray(sub.storeResponseHistory) ? sub.storeResponseHistory : [];
      const storeResponseHistory = sub.storeResponseText
        ? [...priorHistory, {
            text: sub.storeResponseText, respondedAt: sub.storeRespondedAt,
            respondedByUsername: sub.storeRespondedByUsername, respondedByName: sub.storeRespondedByName
          }]
        : priorHistory;
      return {
        ...sub, storeResponseHistory,
        storeResponseText: responseText, storeRespondedAt: checklist.nowVN(),
        storeRespondedByUsername: user.username, storeRespondedByName: user.name
      };
    });
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, `checklistSubmissions/${req.params.id}/store-response`); }
});

// LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026, mức Trung bình): route này KHÔNG có gì gọi tới từ client
// (xác nhận grep public/js/module-checklist.js — mọi thao tác submission khác đều gọi qua
// callWorkflowStyleAction(), route này thì không), nhưng vẫn tồn tại + gác quyền requireManage với
// checkFn RỖNG (`() => {}`) — xoá được BẤT KỲ bài nào ở BẤT KỲ trạng thái nào, kể cả bài đã SUBMITTED/
// đã tính điểm/đã có phản hồi siêu thị (storeResponse), nếu bị gọi trực tiếp (Postman/script) sẽ xoá mất
// dữ liệu báo cáo/kiểm soát đã hoàn tất mà không có cảnh báo gì — khác hẳn tinh thần chặn xoá của
// templates/:id/delete (chặn xoá khi "đã có người nộp bài", xem ngay phía trên). Giữ route (không xoá
// hẳn — có thể phục vụ dọn dẹp DRAFT bỏ dở qua API/Postman) nhưng thêm ĐÚNG state gating mirror tinh thần
// đó: CHỈ xoá được bài còn DRAFT (chưa nộp — chưa có điểm/phản hồi nào để mất), mirror
// templates.status!=='DRAFT' bị chặn ở trên.
router.post('/submissions/:id/delete', requireManage, async (req, res) => {
  const submissionId = Number(req.params.id);
  if (!Number.isFinite(submissionId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    await deleteRecordForCollection('checklistSubmissions', submissionId, (sub) => {
      if (sub.status !== 'DRAFT') {
        throw new HttpError(409, 'Chỉ xoá được bài đang ở trạng thái Nháp (chưa nộp) — bài đã nộp giữ lại phục vụ báo cáo/kiểm soát, không thể xoá');
      }
    }, { username: req.freshUser.username, name: req.freshUser.name });
    res.json({ ok: true });
  } catch (err) { sendCatchError(res, err, `checklistSubmissions/${req.params.id}/delete`); }
});

// ===================== XUẤT BÁO CÁO EXCEL THEO ĐÚNG MẪU GỐC (v21.1) =====================
// submittedAt lưu dạng nowVN() = "HH:MM:SS D/M/YYYY" (new Date().toLocaleString('vi-VN')) — ngày ở
// TOKEN THỨ 2 (sau dấu cách), KHÔNG phải token đầu (giờ). Chỉ dùng để SO SÁNH khoảng ngày, không cần
// chính xác múi giờ/giây.
function parseSubmittedAtDate(submittedAt) {
  const datePart = String(submittedAt || '').trim().split(' ')[1];
  if (!datePart) return null;
  const [d, m, y] = datePart.split('/').map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

// Body: { templateId, storeCodes: string[] | null (null/rỗng = TẤT CẢ siêu thị có bài trong phạm vi
// lọc), fromDate, toDate (yyyy-mm-dd, tuỳ chọn) } — CHỈ tính bài đã NỘP (status SUBMITTED), mirror đúng
// bộ lọc tab "📊 Báo Cáo" hiện có (applyChecklistReportFilter() ở module-checklist.js), thêm khả năng
// XUẤT FILE theo đúng layout mẫu gốc người dùng gửi thay vì bảng phẳng chung hiện có
// (exportChecklistReportExcel()). Quyền: checklistReportView (khớp đúng quyền xem tab Báo Cáo — KHÔNG
// cần checklistTemplateManage vì đây là XUẤT DỮ LIỆU ĐÃ NỘP, không sửa mẫu).
router.post('/export-report', requireReportView, async (req, res) => {
  try {
    const templateId = Number(req.body?.templateId);
    if (!Number.isFinite(templateId)) return res.status(400).json({ error: 'Vui lòng chọn 1 mẫu checklist cụ thể để xuất (không hỗ trợ "Tất cả" vì mỗi loại mẫu có cách trình bày khác nhau)' });
    const templates = await getAllForCollection('checklistTemplates');
    const template = templates.find(t => t.id === templateId);
    if (!template) return res.status(404).json({ error: 'Không tìm thấy checklist' });
    // 10/2026: checklistReportView có phạm vi theo MẪU — requireReportView chỉ xác nhận CÓ quyền xem báo
    // cáo nói chung, còn phải đối chiếu riêng mẫu này có nằm trong phạm vi hay không.
    if (!checklist.canViewChecklistReportForTemplate(req.freshUser, templateId)) {
      return res.status(403).json({ error: 'Bạn không có quyền xem báo cáo của đúng mẫu checklist này' });
    }

    const rawStoreCodes = Array.isArray(req.body?.storeCodes) ? req.body.storeCodes.map(s => String(s).trim()).filter(Boolean) : [];
    const storeFilter = rawStoreCodes.length ? new Set(rawStoreCodes) : null; // null = không lọc siêu thị (tất cả)
    const fromDate = req.body?.fromDate ? new Date(req.body.fromDate) : null;
    const toDate = req.body?.toDate ? new Date(req.body.toDate) : null;

    const allSubmissions = await getAllForCollection('checklistSubmissions');
    const matched = allSubmissions.filter(s => {
      if (s.templateId !== templateId || s.status !== 'SUBMITTED') return false;
      if (storeFilter && !storeFilter.has(s.storeCode)) return false;
      const submittedDate = parseSubmittedAtDate(s.submittedAt);
      if (fromDate && submittedDate && submittedDate < fromDate) return false;
      if (toDate && submittedDate && submittedDate > toDate) return false;
      return true;
    });
    if (!matched.length) return res.status(400).json({ error: 'Không có bài đã nộp nào khớp bộ lọc (mẫu/siêu thị/khoảng ngày) để xuất' });

    // Nhóm theo siêu thị, MỖI SIÊU THỊ 1 SHEET (yêu cầu người dùng) — sắp theo submittedAt tăng dần
    // trong từng siêu thị để các khối trong sheet đọc theo đúng trình tự thời gian.
    const submissionsByStore = new Map();
    matched.forEach(s => {
      if (!submissionsByStore.has(s.storeCode)) submissionsByStore.set(s.storeCode, []);
      submissionsByStore.get(s.storeCode).push(s);
    });
    for (const list of submissionsByStore.values()) {
      list.sort((a, b) => (parseSubmittedAtDate(a.submittedAt) || 0) - (parseSubmittedAtDate(b.submittedAt) || 0));
    }

    // Coverage "đã làm/chưa làm" (10/2026) — CHỈ tính cho mẫu QA (DEDUCTION dùng sheet Dashboard riêng ở
    // route /vsattp-dashboard/export bên dưới) — đối chiếu TOÀN BỘ AppData 'stores' hiện có với storeCode
    // PHÂN BIỆT trong `matched` (đã lọc đúng bộ lọc siêu thị/khoảng ngày của lượt xuất này).
    let coverage;
    if (template.templateKind !== 'DEDUCTION') {
      const allStores = await getAppDataValueCached('stores');
      coverage = checklist.computeChecklistCoverage(allStores || [], matched);
    }
    const wb = template.templateKind === 'DEDUCTION'
      ? buildDeductionReportWorkbook(template, submissionsByStore)
      : buildQaReportWorkbook(template, submissionsByStore, coverage);

    const safeName = String(template.templateCode || 'checklist').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="bao-cao-${safeName}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { sendCatchError(res, err, 'checklist/export-report'); }
});

// ===================== XUẤT DASHBOARD VSATTP (10/2026, yêu cầu người dùng "gộp chung file") =====================
// Body: { storeCodes: string[]|null (null/rỗng = TẤT CẢ), fromDate, toDate (yyyy-mm-dd, tuỳ chọn) } —
// server TỰ TÍNH LẠI toàn bộ (không tin số liệu client gửi lên, kể cả Top 5/tỷ lệ vi phạm — đây là báo
// cáo xuất file, không phải chỉ hiển thị, phải đúng nguồn sự thật). Xuất ĐÚNG 1 file gộp: sheet
// "Dashboard" (Top 5 x4 + tỷ lệ vi phạm x2) + 1 sheet chi tiết/siêu thị (dùng lại
// buildVsattpDashboardWorkbook(), xem lib/checklistReportExport.js) — áp dụng cho MỌI mẫu
// templateKind==='DEDUCTION' cùng lúc (không riêng mẫu tên "VSATTP").
router.post('/vsattp-dashboard/export', requireReportView, async (req, res) => {
  try {
    const rawStoreCodes = Array.isArray(req.body?.storeCodes) ? req.body.storeCodes.map(s => String(s).trim()).filter(Boolean) : [];
    const storeFilter = rawStoreCodes.length ? new Set(rawStoreCodes) : null;
    const fromDate = req.body?.fromDate ? new Date(req.body.fromDate) : null;
    const toDate = req.body?.toDate ? new Date(req.body.toDate) : null;

    const [templates, allSubmissions, storeTypes, allStores] = await Promise.all([
      getAllForCollection('checklistTemplates'),
      getAllForCollection('checklistSubmissions'),
      getAppDataValueCached('storeTypes'),
      getAppDataValueCached('stores')
    ]);
    // 10/2026: checklistReportView có phạm vi theo MẪU — chỉ gộp vào Dashboard/file xuất những mẫu
    // DEDUCTION nằm trong phạm vi report-view của người gọi (scope.all hoặc có mặt trong danh sách chọn).
    const deductionTemplateIds = new Set(templates
      .filter(t => checklist.isDeductionTemplate(t) && checklist.canViewChecklistReportForTemplate(req.freshUser, t.id))
      .map(t => t.id));
    const matched = allSubmissions.filter(s => {
      if (s.status !== 'SUBMITTED' || !deductionTemplateIds.has(s.templateId)) return false;
      if (storeFilter && !storeFilter.has(s.storeCode)) return false;
      const submittedDate = parseSubmittedAtDate(s.submittedAt);
      if (fromDate && submittedDate && submittedDate < fromDate) return false;
      if (toDate && submittedDate && submittedDate > toDate) return false;
      return true;
    });
    if (!matched.length) return res.status(400).json({ error: 'Không có bài Đánh Giá VSATTP nào khớp bộ lọc (khoảng ngày/siêu thị) để xuất' });

    const dashboardData = checklist.computeVsattpDashboardData(matched, templates, storeTypes || {});
    const templatesById = new Map(templates.map(t => [t.id, t]));
    const submissionsByStore = new Map();
    matched.forEach(s => {
      if (!submissionsByStore.has(s.storeCode)) submissionsByStore.set(s.storeCode, []);
      submissionsByStore.get(s.storeCode).push(s);
    });
    for (const list of submissionsByStore.values()) {
      list.sort((a, b) => (parseSubmittedAtDate(a.submittedAt) || 0) - (parseSubmittedAtDate(b.submittedAt) || 0));
    }

    // Coverage "đã làm/chưa làm" (10/2026) — đối chiếu TOÀN BỘ AppData 'stores' với storeCode PHÂN BIỆT
    // trong `matched` (đã lọc đúng phạm vi mẫu DEDUCTION/siêu thị/khoảng ngày của lượt xuất này).
    const coverage = checklist.computeChecklistCoverage(allStores || [], matched);
    const wb = buildVsattpDashboardWorkbook(dashboardData, submissionsByStore, templatesById, coverage);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="bao-cao-danh-gia-vsattp.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { sendCatchError(res, err, 'checklist/vsattp-dashboard/export'); }
});

module.exports = router;
