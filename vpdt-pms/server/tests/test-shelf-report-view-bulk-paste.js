#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression test (12/2026, theo yêu cầu người dùng): "picker chọn siêu thị ở quyền Xem Báo Cáo Kiểm
// Soát Hàng Hóa (renderShelfReportViewScopeCheckboxes(), dựng trên renderMultiSelectDropdown() dùng
// chung) cũng dán nhiều tên siêu thị cùng lúc, tự nhận diện và tick hết — giống hệt cơ chế đã có ở ô
// "Thành Viên Nhóm" (renderPeopleMultiSelect())".
//
// Cơ chế mới (xem bindMultiSelectDropdownBulkPaste()/handleGenericMultiSelectBulkPaste(), core.js):
// khớp theo NHÃN (label) đã chuẩn hoá bỏ dấu/hoa-thường, KHÔNG có khái niệm tra employeeCode (picker
// này chọn SIÊU THỊ, không phải người) — đối xứng nhưng không trùng lặp code với
// handlePeopleMultiSelectBulkPaste() (đã gắn cho renderPeopleMultiSelect(), nhận diện qua
// _pmsCandidates/_pmsSelected, KHÔNG đụng container của renderMultiSelectDropdown() dùng _gmsItems/
// _gmsSelected).
//
// Kiểm tra:
//   (A) Dán nhiều TÊN SIÊU THỊ đúng (nhiều dòng, phân biệt hoa/thường + có dấu khác bản gốc) -> tất cả
//       được thêm làm chip.
//   (B) Dán nhiều dòng gồm 1 tên không tồn tại -> tên hợp lệ được thêm, tên không tồn tại báo "Không tìm
//       thấy" trong dòng trạng thái, KHÔNG làm hỏng các tên hợp lệ khác, KHÔNG lỗi/chặn gì.
//   (C) Dán ĐÚNG 1 cụm (tên 1 siêu thị, có khoảng trắng bên trong) -> KHÔNG tự thêm gì, KHÔNG
//       preventDefault() — giữ nguyên hành vi gõ-tìm cũ (đối chứng quan trọng: tên siêu thị thường có
//       khoảng trắng, không được tách nhầm thành nhiều "mã" như bindPeopleMultiSelectBulkPaste() đã né).
//   (D) Listener mới (_gmsItems/_gmsSelected) KHÔNG đụng tới renderPeopleMultiSelect() thật (_pmsCandidates/
//       _pmsSelected) — dán vào ô người vẫn hoạt động đúng cơ chế cũ, không bị gán nhầm logic mới.
//
// Chạy: node server/tests/test-shelf-report-view-bulk-paste.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8996;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.startsWith('/js/') || urlPath.startsWith('/fragments/')) {
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          const ext = path.extname(filePath).toLowerCase();
          const mime = ext === '.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
          res.writeHead(200, { 'Content-Type': mime });
          res.end(data);
        });
      }
      fs.readFile(INDEX_HTML_PATH, (err, data) => {
        if (err) { res.writeHead(500); res.end(String(err)); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  if (pass) console.log(`PASS: ${name}`);
  else console.log(`FAIL: ${name}${detail ? ' -- ' + detail : ''}`);
}
async function scenario(name, fn) {
  try { await fn(); record(name, true); }
  catch (e) { record(name, false, 'threw: ' + (e && e.message ? e.message : String(e))); }
}

const STORE_NAMES = ['Siêu Thị Quận 1', 'Siêu Thị Quận 2', 'Siêu Thị Quận 3'];

async function pasteInto(page, selector, text) {
  const defaultPrevented = await page.evaluate(({ selector, text }) => {
    const input = document.querySelector(selector);
    input.focus();
    const dt = new DataTransfer();
    dt.setData('text', text);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, { selector, text });
  await page.waitForTimeout(150);
  return defaultPrevented;
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));
  await page.waitForTimeout(150);
  await page.evaluate((stores) => { window.DB = window.DB || {}; DB.stores = stores; }, STORE_NAMES);

  try {
    await scenario('Setup: renderShelfReportViewScopeCheckboxes() render ĐÚNG widget (có ô tìm kiếm, có dòng trạng thái dán)', async () => {
      const r = await page.evaluate(() => {
        renderShelfReportViewScopeCheckboxes();
        const el = document.getElementById('pShelfReportViewDeptContainer');
        return { hasSearch: !!el.querySelector('[data-pms-search]'), hasPasteStatus: !!el.querySelector('[data-pms-paste-status]') };
      });
      if (!r.hasSearch) throw new Error('Thiếu ô tìm kiếm [data-pms-search]');
      if (!r.hasPasteStatus) throw new Error('Thiếu dòng trạng thái [data-pms-paste-status] — renderMultiSelectDropdown() chưa thêm template mới');
    });

    await scenario('(A) Dán nhiều TÊN SIÊU THỊ đúng (3 dòng, phân biệt hoa/thường) -> cả 3 được thêm', async () => {
      await pasteInto(page, '#pShelfReportViewDeptContainer [data-pms-search]', 'siêu thị quận 1\nSIÊU THỊ QUẬN 2\nSiêu Thị Quận 3');
      const selected = await page.evaluate(() => [...document.getElementById('pShelfReportViewDeptContainer')._gmsSelected]);
      if (selected.length !== 3) throw new Error(`Kỳ vọng 3 mục, thực tế ${selected.length}: ${JSON.stringify(selected)}`);
      if (!STORE_NAMES.every(s => selected.includes(s))) throw new Error('Thiếu siêu thị trong danh sách đã chọn: ' + JSON.stringify(selected));
    });

    await scenario('(B) Dán nhiều dòng gồm 1 tên không tồn tại -> tên hợp lệ thêm, tên sai báo "Không tìm thấy", không chặn', async () => {
      await page.evaluate(() => { document.getElementById('pShelfReportViewDeptContainer')._gmsSelected.clear(); document.getElementById('pShelfReportViewDeptContainer')._gmsRenderChips(); });
      await pasteInto(page, '#pShelfReportViewDeptContainer [data-pms-search]', 'Siêu Thị Quận 1\nSiêu Thị Không Tồn Tại XYZ');
      const selected = await page.evaluate(() => [...document.getElementById('pShelfReportViewDeptContainer')._gmsSelected]);
      if (selected.length !== 1 || selected[0] !== 'Siêu Thị Quận 1') throw new Error('Kỳ vọng chỉ thêm đúng 1 siêu thị hợp lệ, thực tế: ' + JSON.stringify(selected));
      const statusHtml = await page.evaluate(() => document.querySelector('#pShelfReportViewDeptContainer [data-pms-paste-status]').innerHTML);
      if (!/Không tìm thấy.*Không Tồn Tại XYZ/.test(statusHtml)) throw new Error('Dòng trạng thái không báo đúng "Không tìm thấy": ' + statusHtml);
      if (!/Đã thêm 1 mục/.test(statusHtml)) throw new Error('Dòng trạng thái không báo đúng "Đã thêm 1 mục": ' + statusHtml);
    });

    await scenario('(C) Dán ĐÚNG 1 cụm (tên 1 siêu thị, có khoảng trắng) -> KHÔNG tự thêm gì, KHÔNG preventDefault()', async () => {
      await page.evaluate(() => { document.getElementById('pShelfReportViewDeptContainer')._gmsSelected.clear(); document.getElementById('pShelfReportViewDeptContainer')._gmsRenderChips(); });
      const defaultPrevented = await pasteInto(page, '#pShelfReportViewDeptContainer [data-pms-search]', 'Siêu Thị Quận 1');
      const selected = await page.evaluate(() => [...document.getElementById('pShelfReportViewDeptContainer')._gmsSelected]);
      if (selected.length !== 0) throw new Error('Dán 1 cụm thường lại tự thêm chip: ' + JSON.stringify(selected));
      if (defaultPrevented !== false) throw new Error('preventDefault() bị gọi sai cho trường hợp dán 1 cụm thường (phải giữ hành vi gõ-tìm cũ)');
    });

    await scenario('(D) Listener mới KHÔNG đụng renderPeopleMultiSelect() thật (_pmsCandidates khác _gmsItems)', async () => {
      const r = await page.evaluate(() => {
        const tmp = document.createElement('div');
        tmp.id = 'tmpPeoplePicker';
        document.body.appendChild(tmp);
        renderPeopleMultiSelect('tmpPeoplePicker', [{ username: 'nv.an', name: 'Nguyễn Văn An' }], []);
        return {
          hasPmsCandidates: !!document.getElementById('tmpPeoplePicker')._pmsCandidates,
          hasGmsItemsOnPeoplePicker: !!document.getElementById('tmpPeoplePicker')._gmsItems,
          shelfHasGmsItems: !!document.getElementById('pShelfReportViewDeptContainer')._gmsItems,
          shelfHasPmsCandidates: !!document.getElementById('pShelfReportViewDeptContainer')._pmsCandidates
        };
      });
      if (!r.hasPmsCandidates) throw new Error('renderPeopleMultiSelect() không set _pmsCandidates như cũ');
      if (r.hasGmsItemsOnPeoplePicker) throw new Error('renderPeopleMultiSelect() không được mang _gmsItems (nhầm cơ chế)');
      if (!r.shelfHasGmsItems) throw new Error('Picker siêu thị thiếu _gmsItems');
      if (r.shelfHasPmsCandidates) throw new Error('Picker siêu thị không được mang _pmsCandidates (nhầm cơ chế)');
    });

    await scenario('Không có lỗi JS (pageerror) nào phát sinh trong suốt bài test', () => {
      if (jsErrors.length) throw new Error(jsErrors.join(' | '));
    });
  } finally {
    await browser.close();
    await server.close();
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\n${passed} passed, 0 failed`);
  if (failed > 0) process.exitCode = 1;
})();
