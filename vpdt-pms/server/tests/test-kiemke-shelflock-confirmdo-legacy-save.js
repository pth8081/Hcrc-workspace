#!/usr/bin/env node
'use strict';

// tests/test-kiemke-shelflock-confirmdo-legacy-save.js
//
// Vá lỗ hổng THẬT phát hiện qua audit chéo trước merge (12/2026, đợt nâng cấp kiemKeShelfLockManage/
// kiemKeConfirmDo từ boolean đơn giản sang {all, depts[]}): populatePermsForm() TRƯỚC KHI VÁ luôn hiện
// dữ liệu CŨ boolean `true` lên form như {all:true} ("Tất Cả Siêu Thị" được tick sẵn) — nhưng hành vi
// THẬT của server với `true` (canManageStocktakeShelfLockForDept()/canConfirmStocktakeForDept() ở
// lib/stocktakeEngine.js) lại là "CHỈ đúng siêu thị của người đó", không phải mọi siêu thị.
// collectPermsFromForm() LUÔN ghi lại TOÀN BỘ object mỗi lần bấm Lưu (kể cả sửa 1 trường hoàn toàn khác
// không liên quan) — nghĩa là CHỈ cần Admin mở form 1 người đang có `true` cũ rồi bấm Lưu (sửa email, số
// điện thoại...) là ÂM THẦM nâng quyền người đó lên "khoá/mở khoá hoặc xác nhận được MỌI siêu thị" mà
// không ai cố ý — leo thang quyền im lặng trên hệ thống PRODUCTION thật.
//
// Đã vá: populatePermsForm(permsInput, targetDept) nhận thêm targetDept — hiện ĐÚNG checkbox siêu thị đó
// (không tick "Tất Cả") khi gặp `true` cũ VÀ biết targetDept (sửa User — xem module-admin-userstaging.js
// truyền u.dept/user.dept); không biết targetDept (sửa Nhóm Phân Quyền, không có 1 dept cố định) thì để
// trống (Lưu lại sẽ ghi {all:false,depts:[]} — THU HẸP về an toàn, không MỞ RỘNG ra mọi siêu thị).
//
// Playwright thật, load thẳng public/index.html thật (KHÔNG mock DOM) — cùng hạ tầng
// tests/test-perm-tree-store-scope-widget.js.
//
// Run: node server/tests/test-kiemke-shelflock-confirmdo-legacy-save.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8948;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.startsWith('/js/') || urlPath.startsWith('/fragments/')) {
        const PUBLIC_DIR = path.join(__dirname, '..', 'public');
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          res.writeHead(200, { 'Content-Type': urlPath.startsWith('/js/') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
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

const STORE_NAMES = ['Siêu thị Quận 1', 'Siêu thị Quận 2', 'Siêu thị Quận 3'];

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));
  await page.waitForTimeout(150);

  await page.evaluate((stores) => { window.DB = window.DB || {}; DB.stores = stores; }, STORE_NAMES);

  try {
    await scenario('Sửa USER đang có kiemKeShelfLockManage:true (dept Quận 2) -> populatePermsForm(perms, dept) KHÔNG tick "Tất Cả"', async () => {
      const r = await page.evaluate((dept) => {
        populatePermsForm({ kiemKeShelfLockManage: true }, dept);
        return {
          allChecked: document.getElementById('pKiemKeShelfLockManageAll').checked,
          depts: getMultiSelectValues('pKiemKeShelfLockManageDeptContainer')
        };
      }, STORE_NAMES[1]);
      if (r.allChecked) throw new Error('"Tất Cả Siêu Thị" KHÔNG được tự tick cho dữ liệu cũ true — đây chính là lỗ hổng leo thang quyền im lặng');
      if (!r.depts.includes(STORE_NAMES[1])) throw new Error(`Phải tự hiện đúng siêu thị của user (${STORE_NAMES[1]}), thực tế: ${JSON.stringify(r.depts)}`);
    });

    await scenario('...bấm Lưu NGAY (không đụng checkbox nào) -> collectPermsFromForm() ghi lại ĐÚNG hành vi cũ (chỉ đúng dept, KHÔNG phải mọi siêu thị)', async () => {
      const collected = await page.evaluate(() => collectPermsFromForm().kiemKeShelfLockManage);
      if (collected.all !== false) throw new Error(`Lưu không đụng gì mà "all" phải vẫn là false, thực tế: ${JSON.stringify(collected)}`);
      if (!Array.isArray(collected.depts) || collected.depts.length !== 1 || collected.depts[0] !== STORE_NAMES[1]) {
        throw new Error(`Lưu không đụng gì phải giữ ĐÚNG hành vi cũ (chỉ Quận 2), thực tế: ${JSON.stringify(collected)}`);
      }
    });

    await scenario('Admin CHỦ Ý tick "Tất Cả" sau đó -> Lưu đúng ghi {all:true} (vẫn đổi được bình thường, không bị khoá cứng)', async () => {
      // Checkbox nằm trong <details> cây quyền chưa mở (không ảnh hưởng gì tới logic đang test) — gán
      // trực tiếp qua JS thay vì page.check() (yêu cầu phần tử phải nhìn thấy được).
      const collected = await page.evaluate(() => {
        document.getElementById('pKiemKeShelfLockManageAll').checked = true;
        toggleKiemKeShelfLockScopeGroup();
        return collectPermsFromForm().kiemKeShelfLockManage;
      });
      if (collected.all !== true) throw new Error(`Admin tick "Tất Cả" phải ghi được all:true, thực tế: ${JSON.stringify(collected)}`);
    });

    await scenario('Sửa NHÓM PHÂN QUYỀN (không có 1 dept cố định) đang có kiemKeConfirmDo:true -> KHÔNG tự tick "Tất Cả" (không rõ dept thì để trống, an toàn hơn leo thang)', async () => {
      const r = await page.evaluate(() => {
        populatePermsForm({ kiemKeConfirmDo: true }); // KHÔNG truyền targetDept — giống đúng luồng sửa Nhóm Phân Quyền
        return {
          allChecked: document.getElementById('pKiemKeConfirmDoAll').checked,
          depts: getMultiSelectValues('pKiemKeConfirmDoDeptContainer')
        };
      });
      if (r.allChecked) throw new Error('"Tất Cả Siêu Thị" KHÔNG được tự tick khi không rõ targetDept (sửa Nhóm) — vẫn là leo thang quyền nếu admin lỡ bấm Lưu ngay');
      if (r.depts.length !== 0) throw new Error(`Không rõ targetDept thì không được tự chọn dept nào, thực tế: ${JSON.stringify(r.depts)}`);
    });

    await scenario('kiemKeShelfLockManage/kiemKeConfirmDo đã là {all,depts} MỚI (không phải boolean cũ) -> hiện lại ĐÚNG NGUYÊN giá trị đã lưu, không bị targetDept can thiệp', async () => {
      const r = await page.evaluate((dept) => {
        populatePermsForm({ kiemKeShelfLockManage: { all: false, depts: ['Siêu thị Quận 3'] }, kiemKeConfirmDo: { all: true, depts: [] } }, dept);
        return {
          lockAll: document.getElementById('pKiemKeShelfLockManageAll').checked,
          lockDepts: getMultiSelectValues('pKiemKeShelfLockManageDeptContainer'),
          confirmAll: document.getElementById('pKiemKeConfirmDoAll').checked
        };
      }, STORE_NAMES[1]);
      if (r.lockAll) throw new Error('Giá trị mới {all:false,depts:[Quận 3]} không được tự đổi thành all:true');
      if (!(r.lockDepts.length === 1 && r.lockDepts[0] === 'Siêu thị Quận 3')) throw new Error(`Phải giữ đúng nguyên depts đã lưu (Quận 3), targetDept (Quận 2) không được chèn thêm, thực tế: ${JSON.stringify(r.lockDepts)}`);
      if (!r.confirmAll) throw new Error('Giá trị mới {all:true} phải giữ nguyên all:true');
    });

    const anyFail = results.some(r => !r.pass);
    console.log(`\n==== ${results.filter(r => r.pass).length}/${results.length} scenario(s) passed ====`);
    await browser.close();
    server.close();
    process.exit(anyFail ? 1 : 0);
  } catch (err) {
    console.error(err);
    await browser.close();
    server.close();
    process.exit(1);
  }
})();
