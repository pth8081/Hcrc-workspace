#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression test: nút "Mở rộng tất cả"/"Thu gọn tất cả" ở cây phân quyền (màn "Sửa Người Dùng"/"Sửa
// Nhóm Phân Quyền") — mục C của đợt "Hỗ Trợ IT: 3 việc trong 1 đợt".
//
// BUG ĐÃ VÁ: 2 nút gọi qua cơ chế CSP-safe data-op — data-op="setAllPermTreeNodes" data-arg0="true"
// (Mở rộng) / data-arg0="false" (Thu gọn). cspCoerceArg() (public/index.html) CHỈ coerce chuỗi TOÀN
// SỐ sang Number, giữ nguyên "true"/"false" ở dạng STRING khi truyền vào setAllPermTreeNodes(open).
// Hàm cũ làm `d.open = open` — gán 1 STRING KHÔNG RỖNG vào thuộc tính boolean IDL
// HTMLDetailsElement.open luôn bị ép kiểu Boolean(str), mà Boolean("false") === true (chuỗi không rỗng
// luôn truthy) — nghĩa là CẢ 2 nút đều MỞ RỘNG hết, "Thu gọn tất cả" không hề thu gọn được gì.
//
// Test PHẢI gọi setAllPermTreeNodes() với đúng STRING 'true'/'false' (không phải boolean JS) để thật
// sự tái hiện đường đi qua data-op/cspCoerceArg — nếu gọi bằng boolean JS thật sẽ KHÔNG bắt được bug
// gốc (bug chỉ lộ ra với input kiểu string).
//
// Playwright thật, load thẳng public/index.html thật (KHÔNG mock DOM) — #permFieldsContainer và các
// details.perm-tree-node là markup TĨNH có sẵn trong trang (màn "Sửa Người Dùng"), không cần seed dữ
// liệu/đăng nhập gì để kiểm tra hành vi thuần DOM này.
//
// Run: node server/tests/test-perm-tree-expand-collapse.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8996;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      // Tài nguyên JS ngoài index.html — public/index.html giờ tải JS qua nhiều
      // <script src="/js/...">  thay vì 1 khối inline (xem VERSION.md "Tách JS ra file ngoài") — phục
      // vụ tĩnh trực tiếp từ public/js/, khớp đúng cách server.js thật serve (express.static(public/)).
      if (urlPath.startsWith('/js/')) {
        const PUBLIC_DIR = path.join(__dirname, '..', 'public');
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
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
  try {
    await fn();
    record(name, true);
  } catch (e) {
    record(name, false, 'threw: ' + (e && e.message ? e.message : String(e)));
  }
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.waitForTimeout(150);

  try {
    await scenario('#permFieldsContainer có sẵn nhiều details.perm-tree-node (markup tĩnh) để kiểm thử', async () => {
      const count = await page.evaluate(() => document.querySelectorAll('#permFieldsContainer details.perm-tree-node').length);
      if (count < 5) throw new Error(`Cần ít nhất 5 node để test có ý nghĩa, chỉ thấy ${count}`);
    });

    // ===== KỊCH BẢN GỐC CỦA BUG: gọi với đúng STRING 'false' (đường đi thật qua data-op/cspCoerceArg) =====
    await scenario('setAllPermTreeNodes(\'false\') (STRING, đúng đường đi qua data-op) phải ĐÓNG hết mọi node — đây chính là bug gốc nếu không vá', async () => {
      const result = await page.evaluate(() => {
        // Mở sẵn TẤT CẢ trước (kể cả node vốn "open" mặc định lẫn node vốn đóng) để chắc chắn hành vi
        // đóng lại là do setAllPermTreeNodes() thực hiện, không phải trạng thái mặc định của HTML.
        document.querySelectorAll('#permFieldsContainer details.perm-tree-node').forEach(d => { d.open = true; });
        const openedCount = Array.from(document.querySelectorAll('#permFieldsContainer details.perm-tree-node')).filter(d => d.open).length;

        // Gọi ĐÚNG string 'false' — mô phỏng chính xác giá trị cspCoerceArg() trả về cho data-arg0="false"
        // (KHÔNG phải digit thuần nên KHÔNG bị coerce sang Number/Boolean, giữ nguyên dạng string).
        setAllPermTreeNodes('false');

        const nodes = Array.from(document.querySelectorAll('#permFieldsContainer details.perm-tree-node'));
        const stillOpenCount = nodes.filter(d => d.open).length;
        return { totalNodes: nodes.length, openedCount, stillOpenCount };
      });
      if (result.openedCount !== result.totalNodes) {
        throw new Error(`Setup lỗi: phải mở được hết ${result.totalNodes} node trước, chỉ mở được ${result.openedCount}`);
      }
      if (result.stillOpenCount !== 0) {
        throw new Error(`BUG TÁI HIỆN: gọi setAllPermTreeNodes('false') (string) phải đóng HẾT ${result.totalNodes} node, nhưng còn ${result.stillOpenCount} node vẫn mở (Boolean("false") === true nếu chưa vá)`);
      }
    });

    await scenario('setAllPermTreeNodes(\'true\') (STRING) phải MỞ hết mọi node', async () => {
      const result = await page.evaluate(() => {
        document.querySelectorAll('#permFieldsContainer details.perm-tree-node').forEach(d => { d.open = false; });
        setAllPermTreeNodes('true');
        const nodes = Array.from(document.querySelectorAll('#permFieldsContainer details.perm-tree-node'));
        return { totalNodes: nodes.length, openCount: nodes.filter(d => d.open).length };
      });
      if (result.openCount !== result.totalNodes) {
        throw new Error(`Phải mở HẾT ${result.totalNodes} node, chỉ có ${result.openCount} node mở`);
      }
    });

    // ===== Đối chứng: hàm vẫn hoạt động đúng khi gọi trực tiếp bằng boolean JS thật (đường gọi trực
    // tiếp không qua data-op, nếu có nơi nào khác trong code gọi thẳng) =====
    await scenario('setAllPermTreeNodes(false) (boolean JS thật) cũng phải đóng hết — không chỉ mỗi đường string mới đúng', async () => {
      const result = await page.evaluate(() => {
        document.querySelectorAll('#permFieldsContainer details.perm-tree-node').forEach(d => { d.open = true; });
        setAllPermTreeNodes(false);
        const nodes = Array.from(document.querySelectorAll('#permFieldsContainer details.perm-tree-node'));
        return { totalNodes: nodes.length, stillOpenCount: nodes.filter(d => d.open).length };
      });
      if (result.stillOpenCount !== 0) {
        throw new Error(`Gọi bằng boolean false thật cũng phải đóng hết ${result.totalNodes} node, còn ${result.stillOpenCount} node mở`);
      }
    });

    await scenario('setAllPermTreeNodes(true) (boolean JS thật) cũng phải mở hết', async () => {
      const result = await page.evaluate(() => {
        document.querySelectorAll('#permFieldsContainer details.perm-tree-node').forEach(d => { d.open = false; });
        setAllPermTreeNodes(true);
        const nodes = Array.from(document.querySelectorAll('#permFieldsContainer details.perm-tree-node'));
        return { totalNodes: nodes.length, openCount: nodes.filter(d => d.open).length };
      });
      if (result.openCount !== result.totalNodes) {
        throw new Error(`Phải mở HẾT ${result.totalNodes} node, chỉ có ${result.openCount} node mở`);
      }
    });

    // ===== Đúng đường dispatch thật qua data-op (bấm nút thật, không gọi thẳng hàm) =====
    await scenario('Bấm nút "Thu gọn tất cả"/"Mở rộng tất cả" thật (qua data-op dispatch) phải đóng/mở đúng hết', async () => {
      const collapseBtn = page.locator('[data-op="setAllPermTreeNodes"][data-arg0="false"]').first();
      const expandBtn = page.locator('[data-op="setAllPermTreeNodes"][data-arg0="true"]').first();
      if (await collapseBtn.count() === 0 || await expandBtn.count() === 0) {
        throw new Error('Không tìm thấy nút Mở rộng tất cả/Thu gọn tất cả thật trong DOM (data-op="setAllPermTreeNodes")');
      }

      await page.evaluate(() => {
        document.querySelectorAll('#permFieldsContainer details.perm-tree-node').forEach(d => { d.open = true; });
      });
      await collapseBtn.dispatchEvent('click');
      const afterCollapse = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#permFieldsContainer details.perm-tree-node')).filter(d => d.open).length
      );
      if (afterCollapse !== 0) throw new Error(`Bấm nút "Thu gọn tất cả" thật phải đóng hết, còn ${afterCollapse} node mở`);

      await expandBtn.dispatchEvent('click');
      const afterExpand = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('#permFieldsContainer details.perm-tree-node'));
        return { total: nodes.length, open: nodes.filter(d => d.open).length };
      });
      if (afterExpand.open !== afterExpand.total) {
        throw new Error(`Bấm nút "Mở rộng tất cả" thật phải mở hết ${afterExpand.total} node, chỉ có ${afterExpand.open} node mở`);
      }
    });
  } finally {
    await browser.close();
    server.close();
  }

  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  const failed = total - passed;
  console.log('');
  console.log(`==== ${passed}/${total} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
})();
