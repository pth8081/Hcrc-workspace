// server/tests/demo-checklist-full-module.js
//
// DEMO thật (không phải bộ hồi quy tự động — 8 file test-checklist-*.js đã phủ đủ luật nghiệp vụ, 89
// kịch bản) cho TOÀN BỘ module "✅ Checklist Đánh Giá Siêu Thị" sau đợt v21.0 (2 loại mẫu QA/DEDUCTION)
// + v21.1 (Xuất Báo Cáo Theo Đúng Mẫu Excel Gốc) — người dùng yêu cầu xem demo toàn module sau khi hoàn
// tất, theo đúng quy trình đã chốt ("chỉ làm demo khi người dùng chủ động yêu cầu").
//
// Dùng testHarness.js (Chromium thật mở public/index.html thật + toàn bộ public/js/*.js thật) — data
// (2 mẫu ACTIVE + 2 mẫu DRAFT + nhiều bài nộp đã chấm điểm) CẤY SẴN trực tiếp vào state (bỏ qua toàn bộ
// luồng tạo/kích hoạt/nộp bài qua UI — đã phủ đủ ở 8 bộ test kia), tránh phải dựng lại từ đầu chỉ để
// chụp ảnh. RIÊNG nút "📥 Xuất Theo Mẫu Gốc" (POST /api/checklist/export-report, response nhị phân)
// KHÔNG có trong testHarness.js's mock dispatcher (dispatcher đó chỉ trả JSON) — bài demo này tự thêm 1
// lớp fetch NGAY TRONG TRANG chặn riêng route đó, chuyển tiếp sang lib/checklistReportExport.js THẬT
// (page.exposeFunction) để tải về đúng file .xlsx THẬT, rồi convert sang ảnh bằng LibreOffice để minh
// hoạ ĐÚNG nội dung file xuất ra (không chỉ chụp giao diện nút bấm).
//
// Chạy: node server/tests/demo-checklist-full-module.js
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');
const checklist = require('../lib/checklist');
const { VSATTP_CHECKLIST_TEMPLATE } = require('../seedVsattpChecklist');
const { buildQaReportWorkbook, buildDeductionReportWorkbook } = require('../lib/checklistReportExport');

const PORT = 8990;
const OUT_DIR = process.env.CHECKLIST_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'checklist-full-module');

// KHÔNG dùng perms.admin:true — proceedAfterAuth() (core.js) tự động chuyển sang màn "Bắt buộc bật
// TOTP" cho tài khoản admin CHƯA bật totpEnabled, bỏ qua initDatabase() (DB.depts/DB.stores không được
// nạp) — dùng đúng 3 quyền phẳng của module + posType STORE để mở khoá đủ 4 tab demo mà không đụng
// nhánh admin-only đó.
const DEMO_USER = {
  username: 'demo_qltc', name: 'Trần Thị Quản Lý Checklist', dept: 'Siêu thị A', posType: 'STORE',
  perms: { checklistTemplateManage: true, checklistReportView: true, checklistAuditScope: { all: true, depts: [] } },
  active: true
};

let idSeq = 5000;
function nextId() { return idSeq++; }

// ===== 1 mẫu QA (Câu Hỏi & Đáp Án) ACTIVE — mirror layout "form xuất" người dùng gửi, có category =====
function buildQaTemplate(status) {
  const core = checklist.assertTemplateCoreFields({
    templateCode: 'CL_VESINH', templateName: 'Checklist Vệ Sinh & Trưng Bày Siêu Thị', templateType: 'STORE_SELF', passThreshold: 80
  });
  const questions = checklist.validateChecklistQuestions([
    {
      text: 'Biển hiệu siêu thị nguyên vẹn, không rách nát, có đủ đèn hắt', isRequired: true, category: '1. Kiểm soát cảnh quan chung',
      options: [{ text: 'Đạt', scoreValue: 10, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }]
    },
    {
      text: 'Âm thanh, ánh sáng trong và ngoài siêu thị đầy đủ', isRequired: true, category: '1. Kiểm soát cảnh quan chung',
      options: [{ text: 'Đạt', scoreValue: 10, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }]
    },
    {
      text: 'Hàng hóa đầy đủ nhãn mác, hạn sử dụng, xuất xứ', isRequired: true, category: '6. Chất lượng hàng hóa',
      options: [{ text: 'Đạt', scoreValue: 10, isPassing: true }, { text: 'Không đạt (lỗi nghiêm trọng)', scoreValue: -20, isPassing: false, isCriticalFail: true }]
    },
    {
      text: 'Không có hàng hết hạn sử dụng trên quầy', isRequired: true, category: '6. Chất lượng hàng hóa',
      options: [{ text: 'Đạt', scoreValue: 10, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }]
    },
    {
      text: 'Giá bán trên kệ đúng với giá trên hệ thống', isRequired: true, category: '',
      options: [{ text: 'Đạt', scoreValue: 10, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }]
    }
  ], 'SCORED');
  return Object.assign({ id: nextId(), status, version: 1, clonedFromTemplateId: null, activatedAt: status === 'ACTIVE' ? checklist.nowVN() : null, creator: DEMO_USER.username, creatorName: DEMO_USER.name }, core, { questions });
}

function buildDeductionTemplate(status) {
  const core = checklist.assertTemplateCoreFields({
    templateCode: VSATTP_CHECKLIST_TEMPLATE.templateCode, templateName: VSATTP_CHECKLIST_TEMPLATE.templateName,
    templateType: 'CONTROL_AUDIT', templateKind: 'DEDUCTION'
  });
  const categories = checklist.validateChecklistCategories(VSATTP_CHECKLIST_TEMPLATE.categories);
  return Object.assign({ id: nextId(), status, version: 1, clonedFromTemplateId: null, activatedAt: status === 'ACTIVE' ? checklist.nowVN() : null, creator: DEMO_USER.username, creatorName: DEMO_USER.name }, core, { categories });
}

function qaSubmission(template, { storeCode, submittedAt, answers, id }) {
  const scoring = checklist.computeChecklistScoring(template, answers);
  return {
    id, templateId: template.id, templateCode: template.templateCode, templateName: template.templateName,
    templateType: template.templateType, templateVersion: template.version,
    storeCode, submittedByUsername: 'nv_' + storeCode.replace(/\W+/g, ''), submittedByName: `Nhân viên ${storeCode}`,
    status: 'SUBMITTED', answers, deductions: [],
    totalScore: scoring.totalScore, maxPossibleScore: scoring.maxPossibleScore, scorePercent: scoring.scorePercent,
    hasCriticalFail: scoring.hasCriticalFail, isPassed: scoring.isPassed,
    startedAt: submittedAt, submittedAt,
    storeResponseText: null, storeRespondedAt: null, storeRespondedByUsername: null, storeRespondedByName: null
  };
}
function deductionSubmission(template, { storeCode, submittedAt, deductions, id }) {
  const scoring = checklist.computeDeductionScoring(template, deductions);
  return {
    id, templateId: template.id, templateCode: template.templateCode, templateName: template.templateName,
    templateType: template.templateType, templateVersion: template.version,
    storeCode, submittedByUsername: 'ks1', submittedByName: 'Kiểm Soát Viên Nguyễn Văn A',
    status: 'SUBMITTED', answers: [], deductions,
    totalScore: scoring.totalScore, maxPossibleScore: scoring.maxPossibleScore, scorePercent: scoring.scorePercent,
    hasCriticalFail: false, isPassed: scoring.isPassed,
    startedAt: submittedAt, submittedAt,
    storeResponseText: null, storeRespondedAt: null, storeRespondedByUsername: null, storeRespondedByName: null
  };
}

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function xlsxToImage(xlsxPath, outPrefix) {
  try {
    execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', OUT_DIR, xlsxPath], { stdio: 'pipe', timeout: 60000 });
    const pdfPath = path.join(OUT_DIR, path.basename(xlsxPath, '.xlsx') + '.pdf');
    if (fs.existsSync(pdfPath)) {
      execFileSync('pdftoppm', ['-jpeg', '-r', '110', pdfPath, path.join(OUT_DIR, outPrefix)], { stdio: 'pipe' });
      console.log('🖼️  Đã convert', path.basename(xlsxPath), '-> ảnh xem trước');
    }
  } catch (e) {
    console.log('⚠️  Không convert được xlsx sang ảnh (bỏ qua, vẫn giữ file .xlsx thật):', e.message.split('\n')[0]);
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const qaActive = buildQaTemplate('ACTIVE');
  const qaDraft = buildQaTemplate('DRAFT'); qaDraft.templateCode = 'CL_VESINH_V2'; qaDraft.templateName = 'Checklist Vệ Sinh & Trưng Bày (bản đang soạn)';
  const dedActive = buildDeductionTemplate('ACTIVE');
  const dedDraft = buildDeductionTemplate('DRAFT'); dedDraft.templateCode = 'CL_VSATTP_V2'; dedDraft.status = 'DRAFT';

  const qA = qaActive.questions;
  const subQaA = qaSubmission(qaActive, {
    id: nextId(), storeCode: 'Siêu thị A', submittedAt: '09:15:00 10/9/2026',
    answers: [
      { questionId: qA[0].id, optionIds: [qA[0].options[0].id], note: '' },
      { questionId: qA[1].id, optionIds: [qA[1].options[1].id], note: 'Đèn hắt cửa chính bị hỏng, đã báo bảo trì' },
      { questionId: qA[2].id, optionIds: [qA[2].options[0].id], note: '' },
      { questionId: qA[3].id, optionIds: [qA[3].options[0].id], note: '' },
      { questionId: qA[4].id, optionIds: [qA[4].options[0].id], note: '' }
    ]
  });
  const subQaB = qaSubmission(qaActive, {
    id: nextId(), storeCode: 'Siêu thị B', submittedAt: '14:30:00 10/9/2026',
    answers: [
      { questionId: qA[0].id, optionIds: [qA[0].options[0].id], note: '' },
      { questionId: qA[1].id, optionIds: [qA[1].options[0].id], note: '' },
      { questionId: qA[2].id, optionIds: [qA[2].options[0].id], note: '' },
      { questionId: qA[3].id, optionIds: [qA[3].options[0].id], note: '' },
      { questionId: qA[4].id, optionIds: [qA[4].options[0].id], note: '' }
    ]
  });
  const qaDraftInProgress = {
    id: nextId(), templateId: qaActive.id, templateCode: qaActive.templateCode, templateName: qaActive.templateName,
    templateType: qaActive.templateType, templateVersion: qaActive.version,
    storeCode: 'Siêu thị A', submittedByUsername: DEMO_USER.username, submittedByName: DEMO_USER.name,
    status: 'DRAFT', answers: [{ questionId: qA[0].id, optionIds: [qA[0].options[0].id], note: '' }], deductions: [],
    totalScore: null, maxPossibleScore: null, scorePercent: null, hasCriticalFail: null, isPassed: null,
    startedAt: checklist.nowVN(), submittedAt: null,
    storeResponseText: null, storeRespondedAt: null, storeRespondedByUsername: null, storeRespondedByName: null
  };

  const critByPath = {};
  dedActive.categories.forEach(cat => cat.subItems.forEach(sub => sub.criteria.forEach(c => { critByPath[`${cat.name}::${sub.name}::${c.description}`] = c.id; })));
  const firstCat = dedActive.categories[0];
  const firstCrit = firstCat.subItems[0].criteria[0];
  const subDedA = deductionSubmission(dedActive, {
    id: nextId(), storeCode: 'Siêu thị A', submittedAt: '10:00:00 11/9/2026',
    deductions: [{ criteriaId: firstCrit.id, deductedPoints: 4, description: '2 mã sản phẩm bao bì rách nhẹ', riskLevel: 'B', deadline: '20/09/2026', note: 'Đã yêu cầu ST thu hồi', attachments: [] }]
  });
  const subDedC = deductionSubmission(dedActive, {
    id: nextId(), storeCode: 'Siêu thị C', submittedAt: '15:00:00 11/9/2026',
    deductions: [{ criteriaId: firstCrit.id, deductedPoints: 0, description: '', riskLevel: null, deadline: '', note: '', attachments: [] }]
  });

  const state = createMockState({
    depts: ['Phòng Vận Hành'], stores: ['Siêu thị A', 'Siêu thị B', 'Siêu thị C'],
    users: [DEMO_USER],
    checklistTemplates: [qaActive, qaDraft, dedActive, dedDraft],
    checklistSubmissions: [subQaA, subQaB, qaDraftInProgress, subDedA, subDedC]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1440, height: 1400 });

  // Nút "📥 Xuất Theo Mẫu Gốc" gọi route nhị phân THẬT (POST /api/checklist/export-report) — testHarness.js's
  // mock dispatcher chỉ trả JSON, nên chặn riêng route này ở TẦNG FETCH trong trang, chuyển sang hàm Node
  // THẬT (lib/checklistReportExport.js, cùng code production dùng) qua exposeFunction, encode base64 để
  // JS trong trang tự dựng lại thành Blob thật — vẫn là code xuất báo cáo 100% thật, chỉ khác đường vận
  // chuyển qua CDP thay vì HTTP thường (Playwright không truyền được Buffer nhị phân qua exposeFunction).
  await page.exposeFunction('__checklistExportDispatchReal', async (bodyStr) => {
    const body = JSON.parse(bodyStr || '{}');
    const templates = state.checklistTemplates;
    const template = templates.find(t => t.id === Number(body.templateId));
    if (!template) return { status: 404, error: 'Không tìm thấy checklist' };
    const storeFilter = Array.isArray(body.storeCodes) && body.storeCodes.length ? new Set(body.storeCodes) : null;
    const matched = state.checklistSubmissions.filter(s => s.templateId === template.id && s.status === 'SUBMITTED' && (!storeFilter || storeFilter.has(s.storeCode)));
    if (!matched.length) return { status: 400, error: 'Không có bài đã nộp nào khớp bộ lọc' };
    const byStore = new Map();
    matched.forEach(s => { if (!byStore.has(s.storeCode)) byStore.set(s.storeCode, []); byStore.get(s.storeCode).push(s); });
    const wb = template.templateKind === 'DEDUCTION' ? buildDeductionReportWorkbook(template, byStore) : buildQaReportWorkbook(template, byStore);
    const buf = await wb.xlsx.writeBuffer();
    return { status: 200, base64: Buffer.from(buf).toString('base64') };
  });
  await page.evaluate(() => {
    const orig = window.fetch;
    window.fetch = async (url, opts) => {
      if (url === '/api/checklist/export-report' && opts && opts.method === 'POST') {
        const result = await window.__checklistExportDispatchReal(opts.body);
        if (result.status !== 200) return { ok: false, status: result.status, json: async () => ({ error: result.error }) };
        const bin = atob(result.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return { ok: true, status: 200, blob: async () => new Blob([bytes]) };
      }
      return orig(url, opts);
    };
  });

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, DEMO_USER);
    await page.evaluate(() => { switchTab('checklist'); setChecklistSubTab('CONFIG'); });
    await page.waitForTimeout(150);

    await shot(page, '#checklistSubConfig', '01-cau-hinh-danh-sach-mau.png');

    await page.evaluate(() => openChecklistTemplateCreatePicker());
    await page.waitForTimeout(100);
    await shot(page, '#checklistKindPickerWrap', '02-chon-loai-mau-khi-tao-moi.png');
    await page.evaluate(() => closeChecklistTemplateCreatePicker());

    await page.evaluate((id) => openChecklistTemplateBuilder(id), qaDraft.id);
    await page.waitForTimeout(100);
    await shot(page, '#checklistTemplateBuilderWrap', '03-soan-mau-cau-hoi-dap-an-co-nhom-hang-muc.png');
    await page.evaluate(() => closeChecklistTemplateBuilder());

    await page.evaluate((id) => openChecklistTemplateBuilder(id), dedDraft.id);
    await page.waitForTimeout(100);
    await shot(page, '#checklistTemplateBuilderWrap', '04-soan-mau-tru-diem-theo-hang-muc-vsattp.png');
    await page.evaluate(() => closeChecklistTemplateBuilder());

    await page.evaluate((id) => viewChecklistTemplate(id), qaActive.id);
    await page.waitForTimeout(100);
    await shot(page, '#checklistTemplateViewWrap', '05-xem-mau-cau-hoi-dap-an-dang-dung.png');
    await page.evaluate(() => closeChecklistTemplateView());

    await page.evaluate((id) => viewChecklistTemplate(id), dedActive.id);
    await page.waitForTimeout(100);
    await shot(page, '#checklistTemplateViewWrap', '06-xem-mau-tru-diem-vsattp-dang-dung.png');
    await page.evaluate(() => closeChecklistTemplateView());

    await page.evaluate(() => setChecklistSubTab('EXECUTE'));
    await page.waitForTimeout(150);
    await shot(page, '#checklistSubExecute', '07-thuc-hien-danh-sach-bat-dau.png');

    await page.evaluate((id) => resumeChecklistSubmission(id), qaDraftInProgress.id);
    await page.waitForTimeout(150);
    await shot(page, '#checklistSubmissionFormWrap', '08-lam-bai-cau-hoi-dap-an.png');
    await page.evaluate(() => closeChecklistSubmissionForm());

    await page.evaluate((id) => openChecklistSubmissionForm(id), subDedA.id);
    await page.waitForTimeout(150);
    await shot(page, '#checklistSubmissionFormWrap', '09-lam-bai-tru-diem-vsattp.png');
    await page.evaluate(() => closeChecklistSubmissionForm());

    await page.evaluate(() => setChecklistSubTab('RESULT'));
    await page.waitForTimeout(150);
    await shot(page, '#checklistSubResult', '10-ket-qua-va-phan-hoi.png');

    await page.evaluate(() => setChecklistSubTab('REPORT'));
    await page.waitForTimeout(150);
    await page.evaluate((id) => { document.getElementById('checklistReportTemplateFilter').value = String(id); applyChecklistReportFilter(); }, qaActive.id);
    await page.waitForTimeout(150);
    await shot(page, '#checklistSubReport', '11-bao-cao-tong-quan-va-xuat-theo-mau-goc.png');

    // Xuất THẬT — nút "Xuất Theo Mẫu Gốc" cho mẫu QA (2 siêu thị -> 4 sheet) và mẫu DEDUCTION (2 siêu
    // thị -> 2 sheet) — lưu cả 2 file .xlsx THẬT rồi convert sang ảnh minh hoạ nội dung xuất ra.
    const qaXlsxPath = path.join(OUT_DIR, 'xuat-bao-cao-CL_VESINH.xlsx');
    const qaBuf = await page.evaluate(async (tid) => {
      const res = await fetch('/api/checklist/export-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId: tid, storeCodes: null }) });
      const blob = await res.blob();
      const arr = await blob.arrayBuffer();
      return Array.from(new Uint8Array(arr));
    }, qaActive.id);
    fs.writeFileSync(qaXlsxPath, Buffer.from(qaBuf));
    console.log('💾 Đã lưu', qaXlsxPath);

    const dedXlsxPath = path.join(OUT_DIR, 'xuat-bao-cao-CL_VSATTP.xlsx');
    const dedBuf = await page.evaluate(async (tid) => {
      const res = await fetch('/api/checklist/export-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId: tid, storeCodes: null }) });
      const blob = await res.blob();
      const arr = await blob.arrayBuffer();
      return Array.from(new Uint8Array(arr));
    }, dedActive.id);
    fs.writeFileSync(dedXlsxPath, Buffer.from(dedBuf));
    console.log('💾 Đã lưu', dedXlsxPath);

    await xlsxToImage(qaXlsxPath, 'xuat-bao-cao-CL_VESINH-preview');
    await xlsxToImage(dedXlsxPath, 'xuat-bao-cao-CL_VSATTP-preview');

    console.log('\n✅ Demo hoàn tất — ảnh chụp + file xuất thật ở:', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
