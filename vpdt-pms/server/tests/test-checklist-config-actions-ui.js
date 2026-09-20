// server/tests/test-checklist-config-actions-ui.js
//
// Regression cho UI MỚI (v23.4) của tab "🛠️ Cấu Hình" module Checklist — yêu cầu người dùng: "checklist
// đang dùng có thể Dừng/Sửa/Xóa/Nhân bản/Xem, nút xóa chỉ admin mới thực hiện được". Khác
// tests/test-checklist.js (chạy thẳng routes/checklist.js qua HTTP, kiểm phía SERVER) và
// tests/test-checklist-builder-ui.js (kiểm builder qua testHarness.js + route generic /api/create) —
// file NÀY kiểm riêng renderChecklistConfigTab() (ma trận nút theo trạng thái/quyền/đã-có-người-nộp)
// và 2 hàm hành động mới editViaCloneChecklistTemplate()/deactivateChecklistTemplate(), dựng theo đúng
// khuôn tests/test-car-report-eval-confirm.js (static server phục vụ public/ + Chromium thật, mock
// window.fetch cho 2 route mới, không cần route server thật).
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'
  }[ext] || 'application/octet-stream';
}
function startStaticServer(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
        res.writeHead(200, { 'Content-Type': contentType(filePath) });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

async function main() {
  const PORT = 9800 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.prompt = () => '';

    // Mock fetch CHỈ cho 2 route mới (clone/deactivate) — mirror hình dạng response thật của
    // routes/checklist.js ({ ok:true, item }). Các route khác (nếu module gọi tới, VD /api/data lúc
    // đăng nhập) trả mảng rỗng, không quan trọng cho bài test này.
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      let m;
      if (method === 'POST' && (m = String(url).match(/^\/api\/checklist\/templates\/(\d+)\/clone$/))) {
        const srcId = Number(m[1]);
        const src = DB.checklistTemplates.find(t => t.id === srcId);
        const clone = { ...src, id: 9999, status: 'DRAFT', version: (src.version || 1) + 1, templateCode: src.templateCode };
        return { ok: true, status: 200, json: async () => ({ ok: true, item: clone }) };
      }
      if (method === 'POST' && (m = String(url).match(/^\/api\/checklist\/templates\/(\d+)\/deactivate$/))) {
        const id = Number(m[1]);
        const src = DB.checklistTemplates.find(t => t.id === id);
        const updated = { ...src, status: 'ARCHIVED' };
        return { ok: true, status: 200, json: async () => ({ ok: true, item: updated }) };
      }
      return { ok: true, status: 200, json: async () => ([]) };
    };

    Object.assign(DB, {
      depts: ['Phòng Vận Hành'], stores: [], cats: [],
      checklistSubmissions: [
        { id: 501, templateId: 301, status: 'SUBMITTED' }, // template ACTIVE #301 đã có người nộp bài
        { id: 502, templateId: 401, status: 'SUBMITTED' }  // template ARCHIVED #401 đã có người nộp bài
      ],
      checklistTemplates: [
        { id: 201, templateCode: 'CL_DRAFT', templateName: 'Checklist Nháp', templateType: 'STORE_SELF', templateKind: 'QA', status: 'DRAFT', version: 1, questions: [] },
        { id: 301, templateCode: 'CL_ACTIVE_SUB', templateName: 'Checklist Đang Dùng (đã có bài nộp)', templateType: 'STORE_SELF', templateKind: 'QA', status: 'ACTIVE', version: 1, questions: [] },
        { id: 302, templateCode: 'CL_ACTIVE_CLEAN', templateName: 'Checklist Đang Dùng (chưa ai nộp)', templateType: 'STORE_SELF', templateKind: 'QA', status: 'ACTIVE', version: 1, questions: [] },
        { id: 401, templateCode: 'CL_ARCHIVED_SUB', templateName: 'Checklist Lưu Trữ (đã có bài nộp)', templateType: 'STORE_SELF', templateKind: 'QA', status: 'ARCHIVED', version: 1, questions: [] }
      ],
      users: [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng Vận Hành', jobTitle: 'Admin', email: 'a@test.local', phone: '090', perms: { admin: true }, active: true, groupIds: [], permOverrides: null },
        { id: 2, username: 'qltc1', name: 'Quản Lý Checklist', dept: 'Phòng Vận Hành', jobTitle: 'QL', email: 'q@test.local', phone: '091', perms: { checklistTemplateManage: true }, active: true, groupIds: [], permOverrides: null }
      ]
    });
  });

  // Đăng nhập admin trước — đủ để render tab Cấu Hình + có quyền nạp module-checklist.js.
  // switchTab('checklist') nạp module-checklist.js KHÔNG đồng bộ (loadModuleGroup() chèn <script> rồi
  // đợi sự kiện load) — PHẢI đợi tải xong rồi mới gọi setChecklistSubTab(), không được gộp chung 1
  // evaluate() như đã lỡ làm ở bản nháp đầu (setChecklistSubTab is not defined -> lỗi không bắt được
  // -> browser.close() không được gọi -> tiến trình treo mãi khi không có pipe/timeout dọn hộ).
  await page.evaluate(() => finishLogin(DB.users.find(u => u.username === 'admin')));
  await page.evaluate(() => switchTab('checklist'));
  await page.waitForTimeout(250);
  await page.evaluate(() => setChecklistSubTab('CONFIG'));
  await page.waitForTimeout(200);

  const ready = await page.evaluate(() => typeof renderChecklistConfigTab === 'function' && typeof editViaCloneChecklistTemplate === 'function' && typeof deactivateChecklistTemplate === 'function');
  record('setup: module-checklist.js đã nạp xong, các hàm cần test đã sẵn sàng', ready);
  if (!ready) { record('DỪNG SỚM — không thể tiếp tục vì hàm chưa nạp được', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  // ===== 1. Ma trận nút — ADMIN =====
  await page.evaluate(() => renderChecklistConfigTab());
  const htmlAdmin = await page.evaluate(() => document.getElementById('checklistTemplateListWrap').innerHTML);
  // Kiểm trực tiếp bằng cách tìm cụm "data-op="X" data-arg0="<id>"" xuất hiện đúng/không đúng.
  function hasOp(html, op, id) { return html.includes(`data-op="${op}" data-arg0="${id}"`); }

  record('DRAFT (201): ADMIN thấy nút Sửa + Kích Hoạt + Xoá', hasOp(htmlAdmin, 'openChecklistTemplateBuilder', 201) && hasOp(htmlAdmin, 'activateChecklistTemplate', 201) && hasOp(htmlAdmin, 'deleteChecklistTemplate', 201));
  record('ACTIVE chưa ai nộp (302): ADMIN thấy Xem/Sửa(clone)/Dừng/Xoá (không disabled)', hasOp(htmlAdmin, 'viewChecklistTemplate', 302) && hasOp(htmlAdmin, 'editViaCloneChecklistTemplate', 302) && hasOp(htmlAdmin, 'deactivateChecklistTemplate', 302) && hasOp(htmlAdmin, 'deleteChecklistTemplate', 302));
  record('ACTIVE chưa ai nộp (302): nút Xoá KHÔNG bị disabled', !new RegExp(`data-op="deleteChecklistTemplate" data-arg0="302"[^>]*disabled`).test(htmlAdmin));
  record('ACTIVE đã có bài nộp (301): ADMIN vẫn thấy nút Xoá nhưng bị disabled + có tooltip cảnh báo', new RegExp(`data-op="deleteChecklistTemplate" data-arg0="301"[^>]*disabled[^>]*title="[^"]*không thể xoá`).test(htmlAdmin));
  record('ACTIVE đã có bài nộp (301): vẫn thấy nút Dừng (Dừng không bị chặn bởi việc có bài nộp)', hasOp(htmlAdmin, 'deactivateChecklistTemplate', 301));
  record('ARCHIVED đã có bài nộp (401): KHÔNG có nút Dừng (chỉ ACTIVE mới Dừng được)', !hasOp(htmlAdmin, 'deactivateChecklistTemplate', 401));
  record('ARCHIVED đã có bài nộp (401): ADMIN thấy Xem/Sửa(clone), nút Xoá disabled', hasOp(htmlAdmin, 'viewChecklistTemplate', 401) && hasOp(htmlAdmin, 'editViaCloneChecklistTemplate', 401) && new RegExp(`data-op="deleteChecklistTemplate" data-arg0="401"[^>]*disabled`).test(htmlAdmin));
  // v23.5: người dùng phản ánh bấm "⏸️ Dừng" xong không có cách nào kích hoạt LẠI — thêm nút "🔄 Kích
  // Hoạt Lại" cho ARCHIVED (KHÔNG hiện cho ACTIVE, vốn đã đang dùng rồi).
  record('ARCHIVED (401): CÓ nút "🔄 Kích Hoạt Lại" (activateChecklistTemplate) — v23.5', hasOp(htmlAdmin, 'activateChecklistTemplate', 401));
  record('ACTIVE (302): KHÔNG có nút Kích Hoạt Lại (đang dùng rồi, không cần)', !hasOp(htmlAdmin, 'activateChecklistTemplate', 302));
  // LỖI ĐÃ VÁ (rà soát chuyên sâu 10/2026, mức Thấp): trước đây nút "Nhân Bản" hiện cho MỌI trạng thái
  // kể cả NHÁP, trong khi server LUÔN từ chối nhân bản bản NHÁP (409, routes/checklist.js
  // POST /templates/:id/clone) — bấm vào chỉ nhận lỗi. Nay chỉ ACTIVE/ARCHIVED mới có nút này.
  record('ACTIVE/ARCHIVED có nút "Nhân Bản" (cloneChecklistTemplate)', hasOp(htmlAdmin, 'cloneChecklistTemplate', 302) && hasOp(htmlAdmin, 'cloneChecklistTemplate', 401));
  record('DRAFT (201): KHÔNG còn nút "Nhân Bản" (server luôn từ chối 409 — LỖI ĐÃ VÁ 10/2026)', !hasOp(htmlAdmin, 'cloneChecklistTemplate', 201));

  // ===== 2. Ma trận nút — MANAGER (checklistTemplateManage, KHÔNG phải admin) =====
  await page.evaluate(() => { finishLogin(DB.users.find(u => u.username === 'qltc1')); switchTab('checklist'); setChecklistSubTab('CONFIG'); renderChecklistConfigTab(); });
  await page.waitForTimeout(100);
  const htmlManager = await page.evaluate(() => document.getElementById('checklistTemplateListWrap').innerHTML);
  record('DRAFT (201): MANAGER (không admin) KHÔNG thấy nút Xoá', !hasOp(htmlManager, 'deleteChecklistTemplate', 201));
  record('DRAFT (201): MANAGER vẫn thấy Sửa + Kích Hoạt (không bị chặn, chỉ Xoá mới admin-only)', hasOp(htmlManager, 'openChecklistTemplateBuilder', 201) && hasOp(htmlManager, 'activateChecklistTemplate', 201));
  record('ACTIVE (302): MANAGER KHÔNG thấy nút Xoá nhưng vẫn thấy Dừng/Sửa(clone)/Xem', !hasOp(htmlManager, 'deleteChecklistTemplate', 302) && hasOp(htmlManager, 'deactivateChecklistTemplate', 302) && hasOp(htmlManager, 'editViaCloneChecklistTemplate', 302) && hasOp(htmlManager, 'viewChecklistTemplate', 302));
  record('ARCHIVED (401): MANAGER KHÔNG thấy nút Xoá', !hasOp(htmlManager, 'deleteChecklistTemplate', 401));

  // ===== 3. editViaCloneChecklistTemplate() end-to-end — clone xong mở thẳng builder đúng bản mới =====
  await page.evaluate(() => finishLogin(DB.users.find(u => u.username === 'admin')));
  await page.evaluate(() => { switchTab('checklist'); setChecklistSubTab('CONFIG'); renderChecklistConfigTab(); });
  await page.waitForTimeout(100);
  const cloneResult = await page.evaluate(async () => {
    await editViaCloneChecklistTemplate(302);
    return {
      addedToDB: !!DB.checklistTemplates.find(t => t.id === 9999 && t.status === 'DRAFT'),
      builderCodeValue: document.getElementById('checklistBuilderCode')?.value,
      builderTitle: document.getElementById('checklistBuilderTitle')?.innerText || ''
    };
  });
  record('editViaCloneChecklistTemplate: thêm bản Nháp mới (id 9999) vào DB.checklistTemplates', cloneResult.addedToDB);
  record('editViaCloneChecklistTemplate: tự mở builder đúng bản Nháp vừa nhân bản (mã CL_ACTIVE_CLEAN)', cloneResult.builderCodeValue === 'CL_ACTIVE_CLEAN' && cloneResult.builderTitle.includes('Sửa Mẫu Checklist'));

  // ===== 4. deactivateChecklistTemplate() end-to-end — ACTIVE -> ARCHIVED, danh sách render lại đúng =====
  await page.evaluate(() => { closeChecklistTemplateBuilder(); renderChecklistConfigTab(); });
  const deactivateResult = await page.evaluate(async () => {
    await deactivateChecklistTemplate(302);
    const t = DB.checklistTemplates.find(x => x.id === 302);
    return { status: t.status, htmlAfter: document.getElementById('checklistTemplateListWrap').innerHTML };
  });
  record('deactivateChecklistTemplate: template #302 chuyển đúng ACTIVE -> ARCHIVED', deactivateResult.status === 'ARCHIVED');
  record('deactivateChecklistTemplate: sau khi Dừng, nút "⏸️ Dừng" của #302 biến mất khỏi danh sách render lại', !hasOp(deactivateResult.htmlAfter, 'deactivateChecklistTemplate', 302));

  record('Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();
  finish();
}

function finish() {
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  console.log('');
  console.log(`${passed}/${total} scenarios passed.`);
  if (passed !== total) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
