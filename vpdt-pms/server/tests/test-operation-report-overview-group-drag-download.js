// server/tests/test-operation-report-overview-group-drag-download.js
//
// Regression cho 3 yêu cầu QA module Vận Hành (rủi ro thấp, đợt 2 sau Nhóm A Sửa Chữa):
//   B3. DMĐT (operationEstimate) — thêm nút "⬇️" tải file đính kèm cạnh link xem ở
//       renderOperationEstimateItemRow()/attachmentsListHTML.
//   C1. Modal "Thêm Công Việc Gốc" (#operationWorkItemFormModal) di dời tự do — makeModalDraggable()
//       (core.js), chỉ gọi cho đúng modal này ở openOperationWorkItemFormModal().
//   D1. Báo Cáo "Tổng Quan Toàn Bộ Công Việc" — gom nhóm theo mã hồ sơ, click xổ ra công việc con,
//       renderOperationStoreReportOverview()/toggleOperationReportGroup()/expandAll.../collapseAll...
//       (module-vanhanh.js) — KHÔNG đụng buildOperationStoreReportOverviewRows() (vẫn phẳng, phục vụ
//       Xuất Excel).
//
// Chạy: node server/tests/test-operation-report-overview-group-drag-download.js
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
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

  const out = await page.evaluate(() => {
    // ===== B3: nút tải file đính kèm DMĐT =====
    operationEstimateItems = [
      { id: 1, parentId: null, content: 'Hạng mục A', description: '', amount: 1000000, note: '',
        attachments: [{ fileUrl: '/uploads/bao-gia.pdf', fileName: 'bao-gia.pdf', fileType: 'application/pdf' }] }
    ];
    const rowHTML = renderOperationEstimateItemRow(operationEstimateItems[0], 0, 0, false, 1);
    const b3 = {
      hasViewLink: rowHTML.includes('data-op="viewOperationEstimateAttachment"'),
      hasDownloadLink: /href="[^"]*bao-gia\.pdf[^"]*"[^>]*download="bao-gia\.pdf"/.test(rowHTML) || (rowHTML.includes('download="bao-gia.pdf"') && rowHTML.includes('⬇️'))
    };

    // ===== C1: modal kéo-thả =====
    document.getElementById('operationWorkItemFormModal').classList.remove('hidden');
    const panelBefore = document.getElementById('operationWorkItemFormModalPanel');
    const transformBeforeDrag = getComputedStyle(panelBefore).transform;
    makeModalDraggable('operationWorkItemFormModalPanel', '.p-4.border-b');
    const handle = panelBefore.querySelector('.p-4.border-b');
    const hasCursorMove = handle.classList.contains('cursor-move');
    // mô phỏng kéo: mousedown trên handle -> mousemove 50px,30px -> mouseup
    const downEvt = new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true });
    handle.dispatchEvent(downEvt);
    const moveEvt = new MouseEvent('mousemove', { clientX: 150, clientY: 130, bubbles: true });
    document.dispatchEvent(moveEvt);
    const transformDuringDrag = panelBefore.style.transform;
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    // gọi lại makeModalDraggable (mô phỏng mở modal LẦN NỮA) -> phải RESET vị trí về 0,0
    makeModalDraggable('operationWorkItemFormModalPanel', '.p-4.border-b');
    const transformAfterReset = panelBefore.style.transform;
    // nút đóng (nếu có trong vùng handle) vẫn phải bấm được bình thường — mousedown trên nút không kích hoạt kéo
    const closeBtn = panelBefore.querySelector('[data-op="closeOperationWorkItemFormModal"]');
    let closeBtnDragBlocked = true;
    if (closeBtn) {
      makeModalDraggable('operationWorkItemFormModalPanel', '.p-4.border-b'); // reset lại trước khi test nút đóng
      const beforeTransform = panelBefore.style.transform;
      closeBtn.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 60, bubbles: true }));
      closeBtnDragBlocked = (panelBefore.style.transform === beforeTransform);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }
    document.getElementById('operationWorkItemFormModal').classList.add('hidden');
    const c1 = {
      hasCursorMove,
      draggedDuringDrag: transformDuringDrag.includes('translate(50px, 30px)'),
      resetAfterReopen: transformAfterReset === '',
      closeBtnStillWorks: closeBtnDragBlocked
    };

    // ===== D1: gom nhóm báo cáo tổng quan =====
    const computed = [
      {
        kind: 'operationRepairs',
        o: { id: 501, code: 'HCRC-SX-SCST-001' },
        items: [
          { id: 1, title: 'Việc 1', status: 'DA_NGHIEM_THU', assignedToName: ['A'], acceptorName: 'B', history: [{ action: 'ACCEPTED', time: '10:00 01/11/2026' }] },
          { id: 2, title: 'Việc 2', status: 'CHUA_BAT_DAU', assignedToName: [], acceptorName: '' }
        ]
      },
      {
        kind: 'operationRepairs',
        o: { id: 502, code: 'HCRC-SX-SCST-002' },
        items: [
          { id: 3, title: 'Việc 3', status: 'DANG_THUC_HIEN', assignedToName: ['C'], acceptorName: '' }
        ]
      }
    ];
    OPERATION_KIND_META.operationRepairs.titleField = (o) => `Hồ sơ ${o.code}`;
    renderOperationStoreReportOverview(computed);
    const tbody = document.getElementById('operationWorkItemOverviewTableBody');
    const groupRows = [...tbody.querySelectorAll('tr[data-op="toggleOperationReportGroup"]')];
    const detailRowsCode1Hidden = [...tbody.querySelectorAll('tr[data-group="HCRC-SX-SCST-001"]')].every(tr => tr.classList.contains('hidden'));
    // bấm vào dòng tổng quan đầu tiên -> xổ ra
    toggleOperationReportGroup('HCRC-SX-SCST-001');
    const detailRowsCode1Shown = [...tbody.querySelectorAll('tr[data-group="HCRC-SX-SCST-001"]')].every(tr => !tr.classList.contains('hidden'));
    const detailRowsCode2StillHidden = [...tbody.querySelectorAll('tr[data-group="HCRC-SX-SCST-002"]')].every(tr => tr.classList.contains('hidden'));
    expandAllOperationReportGroups();
    const allShownAfterExpandAll = [...tbody.querySelectorAll('tr[data-group]')].every(tr => !tr.classList.contains('hidden'));
    collapseAllOperationReportGroups();
    const allHiddenAfterCollapseAll = [...tbody.querySelectorAll('tr[data-group]')].every(tr => tr.classList.contains('hidden'));
    const d1 = {
      groupCount: groupRows.length,
      defaultAllCollapsed: detailRowsCode1Hidden,
      toggleShowsGroup: detailRowsCode1Shown,
      otherGroupUnaffected: detailRowsCode2StillHidden,
      allShownAfterExpandAll,
      allHiddenAfterCollapseAll,
      // Xuất Excel vẫn dùng hàm build PHẲNG riêng, không bị đụng
      flatRowsStillFlat: buildOperationStoreReportOverviewRows(computed).length === 3
    };

    return { b3, c1, d1 };
  });

  record('B3: renderOperationEstimateItemRow() vẫn có link "Xem" như cũ', out.b3.hasViewLink);
  record('B3: renderOperationEstimateItemRow() có thêm link "⬇️ Tải" đúng href file', out.b3.hasDownloadLink, JSON.stringify(out.b3));
  record('C1: handle kéo có class cursor-move', out.c1.hasCursorMove);
  record('C1: kéo chuột (mousedown+mousemove) dịch đúng transform translate(dx,dy)', out.c1.draggedDuringDrag, JSON.stringify(out.c1));
  record('C1: mở lại modal (gọi lại makeModalDraggable) RESET vị trí về 0,0', out.c1.resetAfterReopen, JSON.stringify(out.c1));
  record('C1: mousedown trên nút Đóng trong header KHÔNG kích hoạt kéo (vẫn bấm được bình thường)', out.c1.closeBtnStillWorks, JSON.stringify(out.c1));
  record('D1: 2 mã hồ sơ -> đúng 2 dòng tổng quan (group)', out.d1.groupCount === 2, JSON.stringify(out.d1));
  record('D1: mặc định MỌI dòng chi tiết ẩn (chỉ hiện dòng tổng quan)', out.d1.defaultAllCollapsed);
  record('D1: bấm dòng tổng quan -> xổ ra ĐÚNG công việc con của mã hồ sơ đó', out.d1.toggleShowsGroup);
  record('D1: bấm xổ 1 nhóm KHÔNG ảnh hưởng nhóm khác (vẫn đóng)', out.d1.otherGroupUnaffected);
  record('D1: "Mở Hết" hiện toàn bộ dòng chi tiết mọi nhóm', out.d1.allShownAfterExpandAll);
  record('D1: "Đóng Hết" ẩn toàn bộ dòng chi tiết mọi nhóm', out.d1.allHiddenAfterCollapseAll);
  record('D1: buildOperationStoreReportOverviewRows() (dùng cho Xuất Excel) vẫn trả về phẳng, không đổi', out.d1.flatRowsStillFlat);

  record('Không có lỗi JS chưa bắt (pageerror) nào phát sinh', pageErrors.length === 0, pageErrors.join('; '));

  await browser.close();
  server.close();

  const total = results.length;
  const passedCount = results.filter(r => r.pass).length;
  console.log(`\n==== ${passedCount}/${total} scenario(s) passed ====`);
  process.exit(passedCount === total ? 0 : 1);
}

main().catch((err) => {
  console.error('LỖI CHẠY TEST:', err);
  process.exit(1);
});
