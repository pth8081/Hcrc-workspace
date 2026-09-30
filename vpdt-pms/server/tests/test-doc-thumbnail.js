'use strict';
// tests/test-doc-thumbnail.js — Kho Tài Liệu (10/2026, theo yêu cầu người dùng "Mục kho tài liệu cần
// hiển thị thumbnail minh hoạ"): uploadDoc() sinh ảnh minh hoạ THẬT từ trang đầu PDF lúc tải lên
// (generateDocThumbnail(), module-tailieu.js — vẽ qua PDF.js thật, upload lại như 1 ảnh qua moduleKey
// 'internalImage') + docThumbHTML() hiển thị đúng (ảnh sinh ra / ảnh gốc nếu là file ảnh / icon nếu
// không có gì để vẽ) trong "Danh Sách Tài Liệu Trong Hệ Thống".
//
// Own minimal static server + window.fetch stub (mirror tests/test-doc.js, KHÔNG dùng _harness.js vì
// _mock-backend.js chưa hỗ trợ moduleKey 'docs') — chỉ đủ cho đúng luồng uploadDoc() cần, không lặp lại
// toàn bộ 22 kịch bản đã có ở test-doc.js.
//
// Run: node tests/test-doc-thumbnail.js
const path = require('path');
const http = require('http');
const fs = require('fs');
const assert = require('assert');
const { PDFDocument } = require('pdf-lib');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8978;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let results;
  const pageErrors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
    await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

    // PDF thật (1 trang, pdf-lib) — sinh ở Node rồi truyền bytes vào trang qua tham số page.evaluate();
    // file.arrayBuffer() ở trong trang đọc THẲNG các byte này (không qua mạng, không qua window.fetch
    // bị giả lập bên dưới) nên PDF.js vẽ được trang thật, đúng khuôn test-training-video-pdf-progress.js.
    const pdfDoc = await PDFDocument.create();
    const p = pdfDoc.addPage([300, 200]);
    p.drawText('Trang dau tai lieu', { x: 20, y: 150, size: 18 });
    const realPdfBytes = Array.from(await pdfDoc.save());

    results = await page.evaluate(async (pdfBytesArr) => {
      const results = [];
      const check = (name, fn) => { try { fn(); results.push({ name, pass: true }); } catch (e) { results.push({ name, pass: false, detail: e.message }); } };
      const checkAsync = async (name, fn) => { try { await fn(); results.push({ name, pass: true }); } catch (e) { results.push({ name, pass: false, detail: e.message }); } };

      let nextId = 1000;
      const uploadCalls = [];
      window.confirm = () => true;
      window.alert = () => {};
      window.fetch = async (url, opts = {}) => {
        const method = opts.method || 'GET';
        let body = {};
        if (typeof opts.body === 'string') { try { body = JSON.parse(opts.body); } catch (e) { /* ignore */ } }

        if (url === '/api/upload' && method === 'POST') {
          const file = opts.body && opts.body.get ? opts.body.get('file') : null;
          const moduleKey = opts.body && opts.body.get ? opts.body.get('module') : null;
          const fileName = file ? file.name : 'file.bin';
          uploadCalls.push({ moduleKey, fileName, fileType: file ? file.type : '' });
          return { ok: true, status: 200, json: async () => ({ fileName, fileType: file ? file.type : '', fileUrl: `/uploads/fake_${nextId++}_${fileName}`, size: file ? file.size : 0 }) };
        }
        const m = url.match(/^\/api\/create\/([a-zA-Z]+)$/);
        if (m && method === 'POST') {
          const id = nextId++;
          const item = { ...body, id, uploader: currentUser.username, uploaderName: currentUser.name };
          return { ok: true, status: 200, json: async () => ({ ok: true, item }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      };

      Object.assign(DB, {
        depts: ['Phòng Kinh Doanh'], cats: ['Quy Định Nội Bộ'], stores: [], jobTitles: ['Trưởng Phòng'],
        deptAbbrs: {}, docCatAbbrs: {}, submissionTypes: [], contractTypes: [], carTypes: [],
        workflows: [], deptWorkflows: {}, submissionDeptWorkflows: {}, submissionTypeDeptWorkflows: {},
        submissionApprovalGroups: [], permGroups: [], docs: []
      });
      const adminUser = { username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng Kinh Doanh', jobTitle: 'Trưởng Phòng', email: 'a@hcrc.vn', phone: '0900000001', perms: { admin: true } };
      DB.users = [adminUser];
      finishLogin(adminUser);
      switchTab('doc');

      function setFileInput(id, filename, bytesOrText, mime) {
        const dt = new DataTransfer();
        const content = typeof bytesOrText === 'string' ? bytesOrText : new Uint8Array(bytesOrText);
        dt.items.add(new File([content], filename, { type: mime }));
        document.getElementById(id).files = dt.files;
      }

      // ===== 1) Tải lên PDF THẬT -> sinh thumbnail thật, upload qua moduleKey internalImage =====
      await checkAsync('PDF thật: uploadDoc() sinh + tải thumbnail qua moduleKey internalImage, lưu vào doc.thumbnailUrl', async () => {
        document.getElementById('docOpMode').value = 'NEW';
        onDocOpModeChange();
        document.getElementById('selDept').value = 'Phòng Kinh Doanh';
        document.getElementById('selCat').value = 'Quy Định Nội Bộ';
        refreshDocCodePreview();
        document.getElementById('docTitle').value = 'Tài liệu có thumbnail thật';
        document.getElementById('docSummary').value = 'Kiểm thử thumbnail';
        setFileInput('docFile', 'tai-lieu-that.pdf', pdfBytesArr, 'application/pdf');
        uploadCalls.length = 0;
        await uploadDoc({ preventDefault() {} });
        const created = DB.docs.find(d => d.title === 'Tài liệu có thumbnail thật');
        if (!created) throw new Error('tài liệu phải được tạo');
        const thumbCall = uploadCalls.find(c => c.moduleKey === 'internalImage');
        if (!thumbCall) throw new Error(`phải có 1 lượt upload moduleKey=internalImage, thực tế: ${JSON.stringify(uploadCalls)}`);
        if (!created.thumbnailUrl) throw new Error('doc.thumbnailUrl phải được lưu');
        if (!created.thumbnailUrl.includes('fake_')) throw new Error(`thumbnailUrl phải là URL server trả về, thực tế: ${created.thumbnailUrl}`);
      });

      // ===== 2) Danh sách hiện <img> đúng src cho tài liệu vừa tạo =====
      await checkAsync('renderDocs(): dòng tài liệu có thumbnailUrl hiện <img> object trong ô tên', async () => {
        renderDocs();
        const doc = DB.docs.find(d => d.title === 'Tài liệu có thumbnail thật');
        const row = document.querySelector(`#docTableBody tr`);
        const html = document.getElementById('docTableBody').innerHTML;
        if (!html.includes(doc.thumbnailUrl)) throw new Error('bảng phải hiện đúng src thumbnailUrl');
        const img = document.querySelector('#docTableBody img');
        if (!img) throw new Error('phải có thẻ <img> trong danh sách');
      });

      // ===== 3) Tải lên PDF "giả" (không parse được) -> KHÔNG chặn luồng tải lên, thumbnailUrl rỗng =====
      await checkAsync('PDF hỏng/giả (không phải PDF thật): uploadDoc() vẫn thành công, thumbnailUrl rỗng, icon 📕 thay thế', async () => {
        document.getElementById('docOpMode').value = 'NEW';
        onDocOpModeChange();
        document.getElementById('selDept').value = 'Phòng Kinh Doanh';
        document.getElementById('selCat').value = 'Quy Định Nội Bộ';
        refreshDocCodePreview();
        document.getElementById('docTitle').value = 'Tài liệu PDF giả';
        document.getElementById('docSummary').value = 'x';
        setFileInput('docFile', 'gia.pdf', 'khong phai PDF that', 'application/pdf');
        uploadCalls.length = 0;
        await uploadDoc({ preventDefault() {} });
        const created = DB.docs.find(d => d.title === 'Tài liệu PDF giả');
        if (!created) throw new Error('tài liệu vẫn phải được tạo dù không vẽ được thumbnail');
        if (created.thumbnailUrl) throw new Error('thumbnailUrl phải rỗng khi PDF không đọc được');
        renderDocs();
        const html = document.getElementById('docTableBody').innerHTML;
        if (!html.includes('📕')) throw new Error('phải hiện icon 📕 (pdf) thay cho ảnh');
      });

      // ===== 4) Tải lên file KHÔNG PHẢI PDF (ảnh) -> KHÔNG sinh thumbnail riêng, dùng thẳng fileUrl làm ảnh =====
      await checkAsync('File ảnh (không phải PDF): không gọi upload internalImage thừa, hiện thẳng ảnh gốc làm thumbnail', async () => {
        document.getElementById('docOpMode').value = 'NEW';
        onDocOpModeChange();
        document.getElementById('selDept').value = 'Phòng Kinh Doanh';
        document.getElementById('selCat').value = 'Quy Định Nội Bộ';
        refreshDocCodePreview();
        document.getElementById('docTitle').value = 'Tài liệu ảnh scan';
        document.getElementById('docSummary').value = 'x';
        setFileInput('docFile', 'scan.png', 'noi dung anh gia', 'image/png');
        uploadCalls.length = 0;
        await uploadDoc({ preventDefault() {} });
        const created = DB.docs.find(d => d.title === 'Tài liệu ảnh scan');
        if (!created) throw new Error('tài liệu phải được tạo');
        if (created.thumbnailUrl) throw new Error('file ảnh không cần sinh thumbnailUrl riêng');
        if (uploadCalls.some(c => c.moduleKey === 'internalImage')) throw new Error('không được gọi upload thumbnail thừa cho file ảnh');
        renderDocs();
        const html = document.getElementById('docTableBody').innerHTML;
        if (!html.includes(created.fileUrl)) throw new Error('phải hiện thẳng ảnh gốc (doc.fileUrl) làm thumbnail');
      });

      // ===== 5) CSP self-check =====
      check('không có on*=/style= nội tuyến trong danh sách tài liệu', () => {
        const html = document.getElementById('docTableBody').innerHTML;
        if (/\son[a-z]+="/i.test(html)) throw new Error('on*= nội tuyến');
        if (/\sstyle="/i.test(html)) throw new Error('style= nội tuyến');
      });

      return results;
    }, realPdfBytes);
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }

  let failCount = 0;
  for (const r of results) {
    if (r.pass) console.log(`PASS: ${r.name}`);
    else { failCount++; console.log(`FAIL: ${r.name} — ${r.detail}`); }
  }
  if (pageErrors.length) {
    console.log('--- Uncaught page errors observed during the run ---');
    pageErrors.forEach((e) => console.log('  ' + e));
  }
  console.log(`\n${results.length - failCount}/${results.length} scenarios passed.`);
  if (failCount > 0) process.exitCode = 1;
}

main().catch((err) => { console.error('FATAL:', err); process.exitCode = 1; });
