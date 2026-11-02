// server/tests/test-operation-workitem-delete-c3.js
//
// Regression cho C3 (yêu cầu QA module Vận Hành > Quản Lý Công Việc, 11/2026):
//   "Thêm chức năng xoá đối với Tên công việc có trạng thái Chưa bắt đầu".
//
// Trước đây deleteOperationWorkItem() (lib/recordActions.js) CÓ TỒN TẠI + route
// POST /operationWorkItems/:id/delete CÓ SẴN, nhưng KHÔNG CÓ NÚT nào trên UI gọi tới (0 caller —
// xác nhận bằng grep trước khi sửa), và điều kiện chặn CHỈ chặn "DA_NGHIEM_THU" (lỏng hơn yêu cầu mới:
// giờ CHỈ cho xoá khi "Chưa bắt đầu", chặn cả DANG_THUC_HIEN/DANG_NGHIEM_THU). Bản vá này:
//   (a) siết điều kiện deleteOperationWorkItem() — item VÀ mọi công việc con trong nhánh phải đang
//       CHUA_BAT_DAU mới xoá được;
//   (b) thêm nút "🗑️ Xoá" ở buildOperationWorkItemRow() (mode EXECUTION), gate canEditWorkItems (toàn
//       quyền quản lý hồ sơ — KHÔNG mở cho assignee/isOwner, khác nút "🔄 Cập Nhật Tiến Độ") + chỉ hiện
//       khi w.status === 'CHUA_BAT_DAU';
//   (c) thêm deleteOperationWorkItemClient(id) (module-vanhanh.js) — showConfirmModal, BFS tính
//       descendantIds (mirror collectOperationWorkItemDescendantIds() server), gọi
//       callRecordAction('operationWorkItems', id, 'delete', {}), rồi tự dọn DB.operationWorkItems phía
//       client + syncOperationWorkItemAncestorsClient(parentWorkItemId).
//
// Phần 1 (pure logic, không cần Playwright) — kiểm deleteOperationWorkItem() với ĐỦ 4 trạng thái +
// quyền hạn + cascade nhánh con. Phần 2 (Playwright, mirror khuôn
// tests/test-operation-report-overview-group-drag-download.js) — kiểm nút chỉ hiện đúng điều kiện +
// luồng xoá thật trên client (thành công/thất bại) + không có pageerror.
//
// Chạy: node server/tests/test-operation-workitem-delete-c3.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const { createRunner, assert, assertEqual } = require('./testHarness');
const { deleteOperationWorkItem } = require('../lib/recordActions');

function assertThrows(fn, message) {
  try { fn(); } catch (err) { return err; }
  throw new Error(message || 'Đáng lẽ phải throw nhưng không throw');
}

const run = createRunner();

async function runPureLogicTests() {
  const MANAGER = { username: 'qlvh', perms: { operationRecordManageAll: true } };
  const OWNER_MANAGER = { username: 'own1', perms: { operationRepairCreate: true } };
  const OUTSIDER = { username: 'out1', perms: {} };
  const SOURCE_REPAIR = { id: 100, creator: 'own1', sourceType: 'OPERATION_REPAIR' };

  // ===== (a) xoá thành công khi CHUA_BAT_DAU + đủ quyền =====
  await run.run('C3 (a): item CHUA_BAT_DAU, không con, đủ quyền (toàn quyền) -> xoá được, trả về đúng [id]', () => {
    const item = { id: 10, status: 'CHUA_BAT_DAU', sourceType: 'OPERATION_REPAIR' };
    const result = deleteOperationWorkItem(MANAGER, item, []);
    assertEqual(JSON.stringify(result), JSON.stringify([10]));
  });

  await run.run('C3 (a): creator của hồ sơ + có quyền operationRepairCreate -> cũng xoá được (không chỉ admin/operationRecordManageAll)', () => {
    const item = { id: 11, status: 'CHUA_BAT_DAU', sourceType: 'OPERATION_REPAIR' };
    const result = deleteOperationWorkItem(OWNER_MANAGER, item, [], SOURCE_REPAIR);
    assertEqual(JSON.stringify(result), JSON.stringify([11]));
  });

  // ===== (b) chặn xoá ở 3 trạng thái còn lại =====
  for (const status of ['DANG_THUC_HIEN', 'DANG_NGHIEM_THU', 'DA_NGHIEM_THU']) {
    await run.run(`C3 (b): item ở trạng thái ${status} -> bị chặn, KHÔNG xoá được (siết chặt hơn trước — trước chỉ chặn DA_NGHIEM_THU)`, () => {
      const item = { id: 20, status, sourceType: 'OPERATION_REPAIR' };
      const err = assertThrows(() => deleteOperationWorkItem(MANAGER, item, []), `phải chặn xoá khi đang ${status}`);
      assert(err.status === 409, `phải trả 409, nhận được ${err.status}`);
    });
  }

  // ===== (c) người không đủ quyền không xoá được (403), BẤT KỂ trạng thái =====
  await run.run('C3 (c): người ngoài (không phải creator, không toàn quyền) -> 403, dù item đang CHUA_BAT_DAU', () => {
    const item = { id: 30, status: 'CHUA_BAT_DAU', sourceType: 'OPERATION_REPAIR' };
    const err = assertThrows(() => deleteOperationWorkItem(OUTSIDER, item, [], SOURCE_REPAIR), 'phải chặn 403 cho người ngoài');
    assertEqual(err.status, 403);
  });

  // ===== (e) xoá việc GỐC có con -> cascade đúng khi TOÀN BỘ nhánh đều CHUA_BAT_DAU =====
  await run.run('C3 (e): việc gốc + toàn bộ con đều CHUA_BAT_DAU -> xoá cả nhánh, trả về [id, ...descendantIds]', () => {
    const item = { id: 40, status: 'CHUA_BAT_DAU', sourceType: 'OPERATION_REPAIR' };
    const descendants = [
      { id: 41, status: 'CHUA_BAT_DAU' },
      { id: 42, status: 'CHUA_BAT_DAU' }
    ];
    const result = deleteOperationWorkItem(MANAGER, item, [41, 42], undefined, descendants);
    assertEqual(JSON.stringify(result), JSON.stringify([40, 41, 42]));
  });

  await run.run('C3 (e): việc gốc CHUA_BAT_DAU nhưng có 1 con đã DANG_THUC_HIEN -> chặn cả nhánh, không xoá gì', () => {
    const item = { id: 50, status: 'CHUA_BAT_DAU', sourceType: 'OPERATION_REPAIR' };
    const descendants = [
      { id: 51, status: 'CHUA_BAT_DAU' },
      { id: 52, status: 'DANG_THUC_HIEN' }
    ];
    const err = assertThrows(() => deleteOperationWorkItem(MANAGER, item, [51, 52], undefined, descendants), 'phải chặn cả nhánh khi có 1 con đã bắt đầu');
    assertEqual(err.status, 409);
  });

  await run.run('C3 (e): việc gốc có con đã DA_NGHIEM_THU -> chặn cả nhánh (không chỉ chặn riêng con đó)', () => {
    const item = { id: 60, status: 'CHUA_BAT_DAU', sourceType: 'OPERATION_REPAIR' };
    const descendants = [{ id: 61, status: 'DA_NGHIEM_THU' }];
    assertThrows(() => deleteOperationWorkItem(MANAGER, item, [61], undefined, descendants), 'phải chặn cả nhánh khi con đã nghiệm thu');
  });
}

// ===================== Phần 2: Playwright (UI thật) =====================
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

const uiResults = [];
function record(name, pass, detail) {
  uiResults.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

async function runUiTests() {
  const PORT = 9800 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  // alert()/confirm() thật sẽ treo trang (không có người bấm) — auto-dismiss, ghi lại nội dung alert().
  const alerts = [];
  page.on('dialog', async (dialog) => { alerts.push(dialog.message()); await dialog.dismiss(); });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

  // ===== (d) nút "🗑️ Xoá" chỉ hiện đúng điều kiện (4 trạng thái x 2 mức quyền) =====
  const gateOut = await page.evaluate(() => {
    currentUser = { username: 'qlvh', perms: { operationRecordManageAll: true } };
    const STATUSES = ['CHUA_BAT_DAU', 'DANG_THUC_HIEN', 'DANG_NGHIEM_THU', 'DA_NGHIEM_THU'];
    const rows = {};
    for (const status of STATUSES) {
      const w = { id: 900, title: 'Việc test', status, assignedToName: [] };
      rows[`${status}_canEdit`] = buildOperationWorkItemRow(w, 0, false, 'EXECUTION', true, false, true, []).includes('data-op="deleteOperationWorkItemClient"');
      rows[`${status}_noEdit`] = buildOperationWorkItemRow(w, 0, false, 'EXECUTION', true, false, false, []).includes('data-op="deleteOperationWorkItemClient"');
    }
    return rows;
  });
  record('C3 (d): CHUA_BAT_DAU + canEditWorkItems=true -> CÓ nút Xoá', gateOut.CHUA_BAT_DAU_canEdit === true, JSON.stringify(gateOut));
  record('C3 (d): CHUA_BAT_DAU + canEditWorkItems=false -> KHÔNG có nút Xoá (dù trạng thái đúng, thiếu quyền)', gateOut.CHUA_BAT_DAU_noEdit === false, JSON.stringify(gateOut));
  for (const status of ['DANG_THUC_HIEN', 'DANG_NGHIEM_THU', 'DA_NGHIEM_THU']) {
    record(`C3 (d): ${status} + canEditWorkItems=true -> KHÔNG có nút Xoá (đã bắt đầu, không còn Chưa bắt đầu)`, gateOut[`${status}_canEdit`] === false, JSON.stringify(gateOut));
  }

  // ===== (c2) UI: luồng xoá thành công (callRecordAction trả ok) — dọn DB + cascade ancestor =====
  const successOut = await page.evaluate(async () => {
    DB.operationWorkItems = [
      { id: 1, title: 'Việc cha', status: 'CHUA_BAT_DAU', parentWorkItemId: null },
      { id: 2, title: 'Việc con 1', status: 'CHUA_BAT_DAU', parentWorkItemId: 1 },
      { id: 3, title: 'Việc con 2', status: 'CHUA_BAT_DAU', parentWorkItemId: 1 },
      { id: 4, title: 'Việc không liên quan', status: 'CHUA_BAT_DAU', parentWorkItemId: null }
    ];
    let calledWith = null;
    callRecordAction = async (collection, id, action, payload) => {
      calledWith = { collection, id, action, payload };
      return { ok: true };
    };
    // tránh renderOperationExecutionList()/renderOperationAcceptanceList()/renderOperationWorkItemModalBody()
    // ném lỗi do thiếu DOM/context khác không liên quan phạm vi test này (modal Vận Hành đang mở thật) —
    // stub tối thiểu, CHỈ no-op, không ảnh hưởng assertion (đã kiểm riêng ở test C1/D1).
    renderOperationWorkItemModalBody = () => {};
    renderOperationExecutionList = () => {};
    renderOperationAcceptanceList = () => {};
    deleteOperationWorkItemClient(1); // xoá việc CHA -> phải cascade xoá luôn 2 việc con
    await runConfirmedAction(); // mô phỏng bấm "Đồng Ý" trên #genericConfirmModal
    return {
      calledWith,
      remainingIds: DB.operationWorkItems.map(w => w.id),
      parentAndChildrenRemoved: !DB.operationWorkItems.some(w => [1, 2, 3].includes(w.id)),
      unrelatedStillThere: DB.operationWorkItems.some(w => w.id === 4)
    };
  });
  record('C3: luồng xoá thành công gọi ĐÚNG callRecordAction("operationWorkItems", id, "delete", {})', successOut.calledWith && successOut.calledWith.collection === 'operationWorkItems' && successOut.calledWith.id === 1 && successOut.calledWith.action === 'delete', JSON.stringify(successOut));
  record('C3: xoá việc CHA -> cascade xoá luôn 2 việc con (BFS descendantIds khớp server collectOperationWorkItemDescendantIds())', successOut.parentAndChildrenRemoved, JSON.stringify(successOut));
  record('C3: việc KHÔNG liên quan nhánh vẫn còn trong DB sau khi xoá (không xoá nhầm)', successOut.unrelatedStillThere, JSON.stringify(successOut));

  // ===== (c3) UI: luồng xoá bị chặn (callRecordAction throw 409) — KHÔNG xoá gì, báo lỗi rõ ràng =====
  const blockedOut = await page.evaluate(async () => {
    DB.operationWorkItems = [
      { id: 5, title: 'Việc đang bị chặn xoá', status: 'CHUA_BAT_DAU', parentWorkItemId: null }
    ];
    callRecordAction = async () => { throw new Error('Công việc đã bắt đầu/đã nghiệm thu, chỉ xoá được công việc còn ở trạng thái "Chưa bắt đầu"'); };
    renderOperationWorkItemModalBody = () => {};
    renderOperationExecutionList = () => {};
    renderOperationAcceptanceList = () => {};
    deleteOperationWorkItemClient(5);
    await runConfirmedAction();
    return { stillThere: DB.operationWorkItems.some(w => w.id === 5) };
  });
  record('C3: server chặn xoá (throw) -> KHÔNG xoá gì khỏi DB phía client (không rollback sai)', blockedOut.stillThere, JSON.stringify(blockedOut));
  record('C3: server chặn xoá -> có hiện alert() báo lỗi rõ ràng cho người dùng (không "treo" im lặng)', alerts.some(a => a.startsWith('⛔')), JSON.stringify(alerts));

  record('C3: không có lỗi JS chưa bắt (pageerror) nào phát sinh trong toàn bộ luồng test', pageErrors.length === 0, pageErrors.join('; '));

  await browser.close();
  server.close();
}

async function main() {
  await runPureLogicTests();
  run.summary();
  await runUiTests();

  const total = uiResults.length;
  const passedCount = uiResults.filter(r => r.pass).length;
  console.log(`\n==== UI: ${passedCount}/${total} scenario(s) passed ====`);
  if (passedCount !== total) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exit(1); });
