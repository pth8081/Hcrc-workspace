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
const checklist = require('../lib/checklist');
const { buildQaReportWorkbook, buildDeductionReportWorkbook } = require('../lib/checklistReportExport');

router.use(requireAuth, blockIfMustChangePassword);

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
    if (source.status !== 'ACTIVE') return res.status(409).json({ error: 'Chỉ nhân bản được từ checklist đang ở trạng thái Đang dùng' });
    const templateKind = source.templateKind || 'QA';
    const clone = {
      id: Date.now(),
      templateCode: source.templateCode, templateName: source.templateName, templateType: source.templateType,
      version: (source.version || 1) + 1, status: 'DRAFT',
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

// ===================== TEMPLATE: kích hoạt (DRAFT -> ACTIVE, tự lưu trữ bản ACTIVE cũ cùng mã) =====================
router.post('/templates/:id/activate', requireManage, async (req, res) => {
  const templateId = Number(req.params.id);
  if (!Number.isFinite(templateId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const result = await withAppLock(`checklist_template_activate:${templateId}`, async () => {
      const templates = await getAllForCollection('checklistTemplates');
      const target = templates.find(t => t.id === templateId);
      if (!target) throw new HttpError(404, 'Không tìm thấy checklist');
      if (target.status !== 'DRAFT') throw new HttpError(409, 'Chỉ kích hoạt được checklist đang ở trạng thái Nháp');
      if (target.templateKind === 'DEDUCTION') {
        if (!(target.categories || []).length) throw new HttpError(400, 'Checklist cần ít nhất 1 hạng mục đánh giá trước khi kích hoạt');
      } else if (!(target.questions || []).length) {
        throw new HttpError(400, 'Checklist cần ít nhất 1 câu hỏi trước khi kích hoạt');
      }

      const activated = await withLockedRecordForCollection('checklistTemplates', templateId, (t) => ({
        ...t, status: 'ACTIVE', activatedAt: checklist.nowVN()
      }));
      // Lưu trữ (ARCHIVED) mọi bản ACTIVE khác CÙNG templateCode — chỉ 1 bản ACTIVE tại 1 thời điểm.
      const others = templates.filter(t => t.id !== templateId && t.templateCode === target.templateCode && t.status === 'ACTIVE');
      for (const other of others) {
        await withLockedRecordForCollection('checklistTemplates', other.id, (t) => ({ ...t, status: 'ARCHIVED' }));
      }
      return activated;
    });
    res.json({ ok: true, item: result });
  } catch (err) { sendCatchError(res, err, `checklistTemplates/${req.params.id}/activate`); }
});

router.post('/templates/:id/delete', requireManage, async (req, res) => {
  const templateId = Number(req.params.id);
  if (!Number.isFinite(templateId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    await deleteRecordForCollection('checklistTemplates', templateId, (template) => {
      // Chỉ xoá được template còn DRAFT — ACTIVE/ARCHIVED phải giữ lại để checklistSubmissions cũ còn
      // tham chiếu đúng (templateId) tra ra được nội dung câu hỏi/lựa chọn gốc, không mồ côi dữ liệu.
      if (template.status !== 'DRAFT') throw new HttpError(409, 'Chỉ xoá được checklist đang ở trạng thái Nháp');
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

    const storeCode = checklist.resolveStoreCodeForSubmission(template, user, req.body?.storeCode);

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
      storeResponseText: null, storeRespondedAt: null, storeRespondedByUsername: null, storeRespondedByName: null
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
      return { ...sub, storeResponseText: responseText, storeRespondedAt: checklist.nowVN(), storeRespondedByUsername: user.username, storeRespondedByName: user.name };
    });
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, `checklistSubmissions/${req.params.id}/store-response`); }
});

router.post('/submissions/:id/delete', requireManage, async (req, res) => {
  const submissionId = Number(req.params.id);
  if (!Number.isFinite(submissionId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    await deleteRecordForCollection('checklistSubmissions', submissionId, () => {}, { username: req.freshUser.username, name: req.freshUser.name });
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

    const wb = template.templateKind === 'DEDUCTION'
      ? buildDeductionReportWorkbook(template, submissionsByStore)
      : buildQaReportWorkbook(template, submissionsByStore);

    const safeName = String(template.templateCode || 'checklist').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="bao-cao-${safeName}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { sendCatchError(res, err, 'checklist/export-report'); }
});

module.exports = router;
