#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression test: Phân Quyền > "🧾 Duyệt Nhập/Hủy Đơn Hàng Siêu Thị" (khối "🚚 22. Vận Hành") và
// "Phạm Vi Kiểm Soát" (khối "✅ 23. Checklist Đánh Giá Siêu Thị") — đợt 10/2026, đổi từ lưới checkbox
// 2-3 cột (grid-cols-2 md:grid-cols-3) sang widget tìm-kiếm-gõ-chọn (renderMultiSelectDropdown(), khuôn
// chip + tìm kiếm dùng chung ở core.js) vì tên siêu thị dài bị "truncate" mất chữ trong lưới checkbox cũ
// (phản hồi người dùng thật 9/2026).
//
// Kiểm tra:
//   1. renderOperationOrderReceiptScopeCheckboxes()/renderChecklistAuditScopeCheckboxes() render ĐÚNG
//      widget (không còn checkbox nào trong container, có ô tìm kiếm data-pms-search).
//   2. setXxxScopeCheckboxes(list) đổ đúng danh sách đã lưu lên widget (getMultiSelectValues() đọc lại
//      khớp) — mô phỏng populatePermsForm() đổ dữ liệu user cũ lên form.
//   3. scopeFromMultiSelectDropdown() (core.js, thay scopeFromForm() cũ) đọc lại đúng {all, depts} —
//      đúng khuôn dữ liệu server đã lưu (operationOrderReceiptManageStore/checklistAuditScope).
//   4. Thao tác THẬT qua UI (gõ tìm kiếm, bấm thêm/bấm xoá chip — data-op="gmsAdd"/"gmsRemove") vẫn ra
//      đúng kết quả, KHÔNG chỉ gọi thẳng hàm JS.
//   5. toggleOperationOrderReceiptScopeGroup()/toggleChecklistAuditScopeGroup() (bấm "ALL") làm mờ +
//      khoá tương tác widget, giống hệt hành vi "disable checkbox" cũ.
//   6. computePermTreeNodeCount()/refreshPermTreeBadges() (badge "đã cấp X/Y" trên mỗi khối quyền) đọc
//      ĐÚNG trạng thái đã chọn của widget (khác checkbox, state nằm ở container._gmsSelected, không phải
//      input:checked) — đây là bug âm thầm CŨ đã vá luôn cho khối Checklist (container id lệch quy ước
//      "<ALL id không 'All'>DeptContainer" khiến badge cũ không đếm được, xem module-admin.js).
//   7. markPermTreeDirty (viền cam "chưa lưu") CHỈ bật khi người dùng thật sự thêm/xoá chip (qua
//      data-op="gmsAdd"/"gmsRemove", tự bắn 'change' nổi bọt từ core.js renderChips()), KHÔNG bật khi
//      populatePermsForm() chỉ đang đổ dữ liệu gốc lên form (set*ScopeCheckboxes() gọi trực tiếp
//      renderMultiSelectDropdown(), không qua thao tác người dùng).
//
// Playwright thật, load thẳng public/index.html thật (KHÔNG mock DOM) — cùng hạ tầng
// tests/test-perm-tree-expand-collapse.js (markup #permFieldsContainer tĩnh có sẵn, không cần đăng nhập).
//
// Run: node server/tests/test-perm-tree-store-scope-widget.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8997;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
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
      if (urlPath.startsWith('/fragments/')) {
        const PUBLIC_DIR = path.join(__dirname, '..', 'public');
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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

const STORE_NAMES = ['Siêu Thị Quận 1 - Chi Nhánh Trung Tâm Thương Mại Rất Dài', 'Siêu Thị B', 'Siêu Thị C'];

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));
  await page.waitForTimeout(150);

  // DB toàn cục cần có DB.stores để widget có dữ liệu render — trang chưa đăng nhập nên DB rỗng, gán tay.
  await page.evaluate((stores) => { window.DB = window.DB || {}; DB.stores = stores; }, STORE_NAMES);

  try {
    await scenario('Setup: container "Duyệt Nhập/Hủy Đơn Hàng Siêu Thị" + "Checklist" có mặt trong DOM', async () => {
      const ids = await page.evaluate(() => ({
        receipt: !!document.getElementById('pOperationOrderReceiptDeptContainer'),
        checklist: !!document.getElementById('pChecklistAuditScopeDeptContainer'),
        oldChecklistIdGone: !document.getElementById('pChecklistAuditScopeStoreContainer')
      }));
      if (!ids.receipt) throw new Error('Thiếu #pOperationOrderReceiptDeptContainer');
      if (!ids.checklist) throw new Error('Thiếu #pChecklistAuditScopeDeptContainer (id mới sau đổi tên)');
      if (!ids.oldChecklistIdGone) throw new Error('Id cũ #pChecklistAuditScopeStoreContainer vẫn còn sót trong HTML — chưa đổi hết');
    });

    await scenario('renderOperationOrderReceiptScopeCheckboxes()/renderChecklistAuditScopeCheckboxes() render ĐÚNG widget (không còn checkbox lưới cũ)', async () => {
      const r = await page.evaluate(() => {
        renderOperationOrderReceiptScopeCheckboxes();
        renderChecklistAuditScopeCheckboxes();
        const recEl = document.getElementById('pOperationOrderReceiptDeptContainer');
        const chkEl = document.getElementById('pChecklistAuditScopeDeptContainer');
        return {
          recHasCheckbox: !!recEl.querySelector('input[type="checkbox"]'),
          recHasSearch: !!recEl.querySelector('[data-pms-search]'),
          chkHasCheckbox: !!chkEl.querySelector('input[type="checkbox"]'),
          chkHasSearch: !!chkEl.querySelector('[data-pms-search]')
        };
      });
      if (r.recHasCheckbox) throw new Error('Container Duyệt Nhập/Hủy vẫn còn checkbox lưới cũ — chưa migrate sang widget');
      if (!r.recHasSearch) throw new Error('Container Duyệt Nhập/Hủy thiếu ô tìm kiếm của widget renderMultiSelectDropdown()');
      if (r.chkHasCheckbox) throw new Error('Container Checklist vẫn còn checkbox lưới cũ — chưa migrate sang widget');
      if (!r.chkHasSearch) throw new Error('Container Checklist thiếu ô tìm kiếm của widget renderMultiSelectDropdown()');
    });

    await scenario('setOperationOrderReceiptScopeCheckboxes(list)/setChecklistAuditScopeCheckboxes(list) đổ đúng dữ liệu đã lưu lên widget', async () => {
      const r = await page.evaluate((stores) => {
        setOperationOrderReceiptScopeCheckboxes([stores[0], stores[1]]);
        setChecklistAuditScopeCheckboxes([stores[2]]);
        return {
          receipt: getMultiSelectValues('pOperationOrderReceiptDeptContainer'),
          checklist: getMultiSelectValues('pChecklistAuditScopeDeptContainer')
        };
      }, STORE_NAMES);
      if (JSON.stringify(r.receipt.sort()) !== JSON.stringify([STORE_NAMES[0], STORE_NAMES[1]].sort())) {
        throw new Error(`Duyệt Nhập/Hủy phải có đúng 2 siêu thị đã lưu, được: ${JSON.stringify(r.receipt)}`);
      }
      if (JSON.stringify(r.checklist) !== JSON.stringify([STORE_NAMES[2]])) {
        throw new Error(`Checklist phải có đúng 1 siêu thị đã lưu, được: ${JSON.stringify(r.checklist)}`);
      }
    });

    await scenario('scopeFromMultiSelectDropdown() đọc lại đúng {all, depts} khớp khuôn dữ liệu server (operationOrderReceiptManageStore/checklistAuditScope)', async () => {
      const r = await page.evaluate((stores) => {
        document.getElementById('pOperationOrderReceiptAll').checked = false;
        document.getElementById('pChecklistAuditScopeAll').checked = true;
        return {
          receipt: scopeFromMultiSelectDropdown('pOperationOrderReceiptAll', 'pOperationOrderReceiptDeptContainer'),
          checklist: scopeFromMultiSelectDropdown('pChecklistAuditScopeAll', 'pChecklistAuditScopeDeptContainer')
        };
      }, STORE_NAMES);
      if (r.receipt.all !== false || JSON.stringify(r.receipt.depts.sort()) !== JSON.stringify([STORE_NAMES[0], STORE_NAMES[1]].sort())) {
        throw new Error(`scopeFromMultiSelectDropdown() Duyệt Nhập/Hủy sai: ${JSON.stringify(r.receipt)}`);
      }
      if (r.checklist.all !== true || JSON.stringify(r.checklist.depts) !== JSON.stringify([STORE_NAMES[2]])) {
        throw new Error(`scopeFromMultiSelectDropdown() Checklist sai: ${JSON.stringify(r.checklist)}`);
      }
    });

    // #permFieldsContainer nằm trong tab-panel "Hệ Thống → Người Dùng" (ẩn theo tab hiện tại, harness
    // này không đăng nhập/chuyển tab thật) — dùng dispatchEvent('click')/gán value+bắn 'input' thay vì
    // .click()/.fill() thật (Playwright đòi phần tử "visible" mới cho .click()/.fill()), CÙNG cách
    // test-perm-tree-expand-collapse.js đã làm với 2 nút Mở rộng/Thu gọn tất cả.
    await scenario('Thao tác THẬT qua UI: gõ tìm kiếm + bấm thêm siêu thị mới (data-op="gmsAdd") ra đúng chip', async () => {
      // Reset về rỗng cho sạch trước khi test thao tác tay.
      await page.evaluate((stores) => { setOperationOrderReceiptScopeCheckboxes([]); }, STORE_NAMES);
      const search = page.locator('#pOperationOrderReceiptDeptContainer [data-pms-search]');
      await search.evaluate((el) => {
        el.value = 'Siêu Thị B';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(50);
      const option = page.locator('#pOperationOrderReceiptDeptContainer [data-pms-dropdown] [data-op="gmsAdd"]', { hasText: 'Siêu Thị B' }).first();
      if (await option.count() === 0) throw new Error('Không tìm thấy gợi ý "Siêu Thị B" trong dropdown khi gõ tìm kiếm');
      await option.dispatchEvent('click');
      await page.waitForTimeout(50);
      const values = await page.evaluate(() => getMultiSelectValues('pOperationOrderReceiptDeptContainer'));
      if (JSON.stringify(values) !== JSON.stringify(['Siêu Thị B'])) {
        throw new Error(`Bấm thêm thật qua UI phải ra đúng ["Siêu Thị B"], được: ${JSON.stringify(values)}`);
      }
      // Bấm xoá chip thật (data-op="gmsRemove") phải xoá đúng.
      const removeBtn = page.locator('#pOperationOrderReceiptDeptContainer [data-pms-chips] [data-op="gmsRemove"]').first();
      await removeBtn.dispatchEvent('click');
      const afterRemove = await page.evaluate(() => getMultiSelectValues('pOperationOrderReceiptDeptContainer'));
      if (afterRemove.length !== 0) throw new Error(`Bấm xoá chip thật phải về rỗng, còn: ${JSON.stringify(afterRemove)}`);
    });

    await scenario('toggleOperationOrderReceiptScopeGroup()/toggleChecklistAuditScopeGroup() ("ALL") làm mờ + khoá widget, giống hệt disable checkbox cũ', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('pOperationOrderReceiptAll').checked = true;
        toggleOperationOrderReceiptScopeGroup();
        document.getElementById('pChecklistAuditScopeAll').checked = false;
        toggleChecklistAuditScopeGroup();
        const recEl = document.getElementById('pOperationOrderReceiptDeptContainer');
        const chkEl = document.getElementById('pChecklistAuditScopeDeptContainer');
        return {
          recDisabled: recEl.classList.contains('opacity-40') && recEl.classList.contains('pointer-events-none'),
          chkDisabled: chkEl.classList.contains('opacity-40') || chkEl.classList.contains('pointer-events-none')
        };
      });
      if (!r.recDisabled) throw new Error('Tick "ALL" phải làm mờ + khoá tương tác widget Duyệt Nhập/Hủy');
      if (r.chkDisabled) throw new Error('KHÔNG tick "ALL" thì widget Checklist phải hoạt động bình thường (không bị mờ/khoá)');
      // Trả lại trạng thái ALL=false cho các kịch bản sau.
      await page.evaluate(() => {
        document.getElementById('pOperationOrderReceiptAll').checked = false;
        toggleOperationOrderReceiptScopeGroup();
      });
    });

    await scenario('computePermTreeNodeCount()/refreshPermTreeBadges(): badge "Vận Hành"/"Checklist" phải đếm ĐÚNG siêu thị đã chọn ở widget (không phải 0/0 do sai sót đọc checkbox cũ)', async () => {
      const r = await page.evaluate((stores) => {
        setOperationOrderReceiptScopeCheckboxes([stores[0]]);
        setChecklistAuditScopeCheckboxes([stores[1], stores[2]]);
        refreshPermTreeBadges();
        return {
          vanHanh: document.getElementById('permTreeBadge_vanHanh').textContent,
          checklist: document.getElementById('permTreeBadge_checklist').textContent
        };
      }, STORE_NAMES);
      const vhGranted = parseInt(r.vanHanh.split('/')[0], 10);
      const ckGranted = parseInt(r.checklist.split('/')[0], 10);
      if (!(vhGranted > 0)) throw new Error(`Badge "Vận Hành" phải đếm >0 mục đã cấp (có siêu thị Duyệt Nhập/Hủy đã chọn), được "${r.vanHanh}"`);
      if (!(ckGranted > 0)) throw new Error(`Badge "Checklist" phải đếm >0 mục đã cấp (có siêu thị Kiểm Soát đã chọn) — bug cũ container lệch tên khiến badge này LUÔN 0, được "${r.checklist}"`);
    });

    await scenario('markPermTreeDirty: populatePermsForm-style set*ScopeCheckboxes() KHÔNG tự đánh dấu "chưa lưu" (đã dọn bởi clearPermTreeDirtyMarks())', async () => {
      const dirty = await page.evaluate((stores) => {
        setOperationOrderReceiptScopeCheckboxes([stores[0]]);
        clearPermTreeDirtyMarks();
        const node = document.getElementById('pOperationOrderReceiptDeptContainer').closest('details.perm-tree-node');
        return node.classList.contains('perm-tree-dirty');
      }, STORE_NAMES);
      if (dirty) throw new Error('Đổ dữ liệu gốc (giả lập populatePermsForm()) xong clearPermTreeDirtyMarks() KHÔNG được để lại viền cam "chưa lưu"');
    });

    await scenario('markPermTreeDirty: thao tác THẬT thêm/xoá chip (qua data-op) PHẢI đánh dấu "chưa lưu"', async () => {
      await page.evaluate((stores) => {
        setOperationOrderReceiptScopeCheckboxes([]);
        clearPermTreeDirtyMarks();
      }, STORE_NAMES);
      const search = page.locator('#pOperationOrderReceiptDeptContainer [data-pms-search]');
      await search.evaluate((el) => {
        el.value = 'Siêu Thị C';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(50);
      const option = page.locator('#pOperationOrderReceiptDeptContainer [data-pms-dropdown] [data-op="gmsAdd"]', { hasText: 'Siêu Thị C' }).first();
      await option.dispatchEvent('click');
      await page.waitForTimeout(50);
      const dirty = await page.evaluate(() => {
        const node = document.getElementById('pOperationOrderReceiptDeptContainer').closest('details.perm-tree-node');
        return node.classList.contains('perm-tree-dirty');
      });
      if (!dirty) throw new Error('Thêm chip thật qua UI phải đánh dấu viền cam "chưa lưu" trên khối "Vận Hành" (giống hệt tick checkbox thường trước đây)');
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
