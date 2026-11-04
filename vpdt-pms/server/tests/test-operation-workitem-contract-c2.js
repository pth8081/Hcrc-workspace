// server/tests/test-operation-workitem-contract-c2.js
//
// Regression cho C2 (yêu cầu QA module Vận Hành > Thực hiện > Quản Lý Công Việc, 11/2026):
//   "Thêm trường thông tin Giá trị đầu tư (phê duyệt chủ trương), Giá trị hợp đồng, các tệp đính kèm.
//    Cột 1: Giá trị LINK với chi phí đầu tư. Cột 2+3: Để người phụ trách điền Giá trị triển khai Hợp
//    đồng và đính kèm nhiều file. Các file excel (mẫu, nhập, xuất) cũng có các trường thông tin trên."
//
// Phương án BAN ĐẦU đã chốt với người dùng (Option A — "auto-total"), rồi ĐỔI THIẾT KẾ (11/2026, phản
// hồi người dùng sau khi xem demo thật v29.18 — phát hiện "Giá Trị Đầu Tư" trong modal hiện SAI, lấy
// estimateTotalAmount = TỔNG CẢ HỒ SƠ, giống nhau ở MỌI công việc thay vì đúng Chi Phí của riêng công
// việc đó — xem VERSION.md v29.20):
//   - "Giá trị đầu tư": KHÔNG lưu trên operationWorkItems — ĐỌC TỰ ĐỘNG từ ĐÚNG hạng mục Danh Mục Đầu
//     Tư mà công việc này được sinh ra (sourceRecord.estimateItems, tra theo w.estimateItemId — field đã
//     có sẵn từ buildAutoWorkItemsFromEstimate(), lib/recordActions.js), KHÔNG còn đọc estimateTotalAmount
//     (tổng cả hồ sơ) nữa. Field này CHUYỂN RA 1 CỘT RIÊNG trong bảng Thực Hiện
//     (investmentValueCell, buildOperationWorkItemRow() — module-vanhanh.js), KHÔNG còn hiện trong modal
//     "💰" nữa. Công việc tạo tay (không qua Danh Mục Đầu Tư, estimateItemId rỗng) hiện "—".
//   - "Giá trị hợp đồng" (contractValue, Number) + "Tệp đính kèm" (contractAttachments[]) — 2 field MỚI
//     trên operationWorkItems, điền bởi "toàn quyền quản lý hồ sơ" HOẶC đúng người phụ trách
//     (isWorkItemAssignee) qua route riêng POST /operationWorkItems/:id/contract
//     (updateOperationWorkItemContract(), lib/recordActions.js) — KHÔNG chặn theo status (khác
//     editOperationWorkItem(), vì giá trị hợp đồng thật thường chỉ xác định được SAU khi nghiệm thu). 2
//     field này là TOÀN BỘ nội dung modal "💰" nay, không còn field tự động nào khác.
//
// Phần 1 (pure logic) — updateOperationWorkItemContract(): quyền hạn (toàn quyền/phụ trách/người
// ngoài), validate contractValue, sanitize contractAttachments (cap 10, giữ metadata cũ khi re-save).
// createOperationWorkItem(): contractValue mặc định 0 + tuỳ chọn gửi sẵn lúc tạo.
// lib/operationImport.js: WORKITEM_COLUMNS có contractValue + parseOperationWorkItemImportXlsx() đọc
// đúng cột, mặc định 0 nếu thiếu/không hợp lệ. KHÔNG đổi bởi đợt sửa UX này (chỉ đụng client hiển thị).
// Phần 2 (Playwright) — nút "💰" gate đúng theo canEditWorkItems/isOwner, modal CHỈ còn Giá Trị Hợp
// Đồng/tệp đính kèm hiện có (KHÔNG còn field Giá Trị Đầu Tư), cột investmentValueCell trong bảng hiện
// ĐÚNG Chi Phí theo estimateItemId (không phải tổng cả hồ sơ), submit gọi đúng action,
// exportOperationWorkItems() có đủ cột mới với giá trị đúng theo TỪNG dòng.
//
// Chạy: node server/tests/test-operation-workitem-contract-c2.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const { createRunner, assert, assertEqual } = require('./testHarness');
const { createOperationWorkItem, updateOperationWorkItemContract } = require('../lib/recordActions');
const { buildOperationWorkItemTemplateWorkbook, parseOperationWorkItemImportXlsx } = require('../lib/operationImport');

function assertThrows(fn, message) {
  try { fn(); } catch (err) { return err; }
  throw new Error(message || 'Đáng lẽ phải throw nhưng không throw');
}

const run = createRunner();

async function runPureLogicTests() {
  const MANAGER = { username: 'qlvh', name: 'Quản Lý VH', perms: { operationRecordManageAll: true } };
  const ASSIGNEE = { username: 'nv_a', name: 'Nhân Viên A', perms: {} };
  const OUTSIDER = { username: 'out1', name: 'Người Ngoài', perms: {} };
  const SOURCE_REPAIR = { id: 100, creator: 'own1', sourceType: 'OPERATION_REPAIR', estimateTotalAmount: 50000000 };

  await run.run('C2: toàn quyền quản lý hồ sơ điền được Giá Trị Hợp Đồng', () => {
    const item = { id: 1, sourceType: 'OPERATION_REPAIR', assignedTo: ['nv_a'], history: [] };
    const result = updateOperationWorkItemContract(MANAGER, item, { contractValue: 30000000, contractAttachments: [] }, SOURCE_REPAIR);
    assertEqual(result.contractValue, 30000000);
    assertEqual(result.history[result.history.length - 1].action, 'CONTRACT_UPDATED');
  });

  await run.run('C2: đúng người phụ trách (assignedTo[]) cũng điền được, dù KHÔNG toàn quyền', () => {
    const item = { id: 2, sourceType: 'OPERATION_REPAIR', assignedTo: ['nv_a'], history: [] };
    const result = updateOperationWorkItemContract(ASSIGNEE, item, { contractValue: 15000000 }, SOURCE_REPAIR);
    assertEqual(result.contractValue, 15000000);
  });

  await run.run('C2: người ngoài (không toàn quyền, không phải phụ trách) bị chặn 403', () => {
    const item = { id: 3, sourceType: 'OPERATION_REPAIR', assignedTo: ['nv_a'], history: [] };
    const err = assertThrows(() => updateOperationWorkItemContract(OUTSIDER, item, { contractValue: 1000 }, SOURCE_REPAIR), 'phải chặn người ngoài');
    assertEqual(err.status, 403);
  });

  await run.run('C2: giá trị âm bị chặn 400', () => {
    const item = { id: 4, sourceType: 'OPERATION_REPAIR', assignedTo: ['nv_a'], history: [] };
    const err = assertThrows(() => updateOperationWorkItemContract(MANAGER, item, { contractValue: -5 }, SOURCE_REPAIR), 'phải chặn giá trị âm');
    assertEqual(err.status, 400);
  });

  await run.run('C2: giá trị không phải số (NaN/chuỗi rác) bị chặn 400', () => {
    const item = { id: 5, sourceType: 'OPERATION_REPAIR', assignedTo: ['nv_a'], history: [] };
    const err = assertThrows(() => updateOperationWorkItemContract(MANAGER, item, { contractValue: 'abc' }, SOURCE_REPAIR), 'phải chặn giá trị không hợp lệ');
    assertEqual(err.status, 400);
  });

  await run.run('C2: contractValue = 0 vẫn hợp lệ (không âm, không throw)', () => {
    const item = { id: 6, sourceType: 'OPERATION_REPAIR', assignedTo: ['nv_a'], history: [] };
    const result = updateOperationWorkItemContract(MANAGER, item, { contractValue: 0 }, SOURCE_REPAIR);
    assertEqual(result.contractValue, 0);
  });

  await run.run('C2: contractAttachments bị cap tối đa 10 tệp', () => {
    const item = { id: 7, sourceType: 'OPERATION_REPAIR', assignedTo: ['nv_a'], history: [], contractAttachments: [] };
    const raw = Array.from({ length: 15 }, (_, i) => ({ fileUrl: `/uploads/f${i}.pdf`, fileName: `f${i}.pdf` }));
    const result = updateOperationWorkItemContract(MANAGER, item, { contractValue: 1000, contractAttachments: raw }, SOURCE_REPAIR);
    assertEqual(result.contractAttachments.length, 10);
  });

  await run.run('C2: contractAttachments giữ lại metadata cũ (uploadedByName/uploadedAt) khi re-save đúng fileUrl', () => {
    const existing = [{ fileUrl: '/uploads/old.pdf', fileName: 'old.pdf', uploadedByName: 'Ai Đó', uploadedAt: '2026-01-01' }];
    const item = { id: 8, sourceType: 'OPERATION_REPAIR', assignedTo: ['nv_a'], history: [], contractAttachments: existing };
    const result = updateOperationWorkItemContract(MANAGER, item, { contractValue: 1000, contractAttachments: existing }, SOURCE_REPAIR);
    assertEqual(result.contractAttachments[0].uploadedByName, 'Ai Đó');
    assertEqual(result.contractAttachments[0].uploadedAt, '2026-01-01');
  });

  await run.run('C2: KHÔNG chặn theo status DA_NGHIEM_THU (khác editOperationWorkItem) — vẫn điền được sau khi nghiệm thu', () => {
    const item = { id: 9, status: 'DA_NGHIEM_THU', sourceType: 'OPERATION_REPAIR', assignedTo: ['nv_a'], history: [] };
    const result = updateOperationWorkItemContract(MANAGER, item, { contractValue: 99999 }, SOURCE_REPAIR);
    assertEqual(result.contractValue, 99999);
  });

  await run.run('C2: createOperationWorkItem() mặc định contractValue=0, contractAttachments=[] khi không gửi', () => {
    const sourceRecord = { code: 'HCRC-VH-SCST-100', estimateStatus: 'APPROVED', useConfirmStatus: null };
    const item = createOperationWorkItem(MANAGER, { title: 'Việc test' }, sourceRecord, [], [], [], 'OPERATION_REPAIR', {});
    assertEqual(item.contractValue, 0);
    assertEqual(JSON.stringify(item.contractAttachments), '[]');
  });

  await run.run('C2: createOperationWorkItem() nhận contractValue hợp lệ gửi sẵn lúc tạo (VD từ import Excel)', () => {
    const sourceRecord = { code: 'HCRC-VH-SCST-100', estimateStatus: 'APPROVED', useConfirmStatus: null };
    const item = createOperationWorkItem(MANAGER, { title: 'Việc test 2', contractValue: 25000000 }, sourceRecord, [], [], [], 'OPERATION_REPAIR', {});
    assertEqual(item.contractValue, 25000000);
  });

  await run.run('C2: createOperationWorkItem() contractValue âm/không hợp lệ -> fallback 0 (không throw lúc tạo)', () => {
    const sourceRecord = { code: 'HCRC-VH-SCST-100', estimateStatus: 'APPROVED', useConfirmStatus: null };
    const item = createOperationWorkItem(MANAGER, { title: 'Việc test 3', contractValue: -10 }, sourceRecord, [], [], [], 'OPERATION_REPAIR', {});
    assertEqual(item.contractValue, 0);
  });

  await run.run('C2: lib/operationImport.js WORKITEM template có cột "Giá Trị Hợp Đồng"', async () => {
    const wb = await buildOperationWorkItemTemplateWorkbook();
    const sheet = wb.getWorksheet('Danh Sách Công Việc');
    const headerRow = sheet.getRow(1).values.filter(Boolean);
    assert(headerRow.some(h => String(h).includes('Giá Trị Hợp Đồng')), `thiếu cột Giá Trị Hợp Đồng trong mẫu: ${JSON.stringify(headerRow)}`);
  });

  await run.run('C2: parseOperationWorkItemImportXlsx() đọc đúng contractValue từ file mẫu thật (dòng ví dụ)', async () => {
    const wb = await buildOperationWorkItemTemplateWorkbook();
    const buf = await wb.xlsx.writeBuffer();
    const rows = await parseOperationWorkItemImportXlsx(buf);
    assert(rows.length >= 1, 'phải đọc được ít nhất 1 dòng (dòng ví dụ)');
    assert(rows[0].contractValue > 0, `contractValue dòng ví dụ phải > 0, nhận được ${rows[0].contractValue}`);
  });

  // ===== 2 vá lỗi phát hiện từ agent kiểm toán độc lập (11/2026) =====
  await run.run('C2 (vá #1): route /operationWorkItems/:id/contract có gọi assertPayloadFileUrlsOwnedByUser (chặn giả mạo quyền sở hữu file)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'records.js'), 'utf8');
    const routeBlock = src.slice(src.indexOf(`router.post('/operationWorkItems/:id/contract'`), src.indexOf(`router.post('/operationWorkItems/:id/contract'`) + 900);
    assert(routeBlock.includes('assertPayloadFileUrlsOwnedByUser'), 'route /contract thiếu assertPayloadFileUrlsOwnedByUser() — lỗ hổng giả mạo quyền sở hữu file (xem hrProcesses/:id/attachments làm mẫu)');
    assert(routeBlock.includes('exemptFileUrls'), 'route /contract thiếu exemptFileUrls (phải exempt tệp ĐÃ có sẵn trước khi sửa)');
  });

  await run.run('C2 (vá #2): isFileUrlStillReferenced() có quét dbo.OperationWorkItems (chống sweep xoá nhầm tệp đính kèm hợp đồng còn sống)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'recordStore.js'), 'utf8');
    const fnBody = src.slice(src.indexOf('async function isFileUrlStillReferenced'), src.indexOf('async function isFileUrlStillReferenced') + 1500);
    assert(fnBody.includes('dbo.OperationWorkItems'), 'isFileUrlStillReferenced() thiếu quét dbo.OperationWorkItems — sweepOrphanedUploads() sẽ coi contractAttachments là mồ côi và xoá sau 48h dù công việc còn sống');
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
  page.on('dialog', async (dialog) => { await dialog.dismiss(); });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

  // ===== (a) nút "💰" gate đúng canEditWorkItems/isOwner =====
  const gateOut = await page.evaluate(() => {
    currentUser = { username: 'nv_a', perms: {} };
    const w = { id: 900, title: 'Việc test', status: 'CHUA_BAT_DAU', assignedToName: [], assignedTo: ['nv_a'] };
    const asOwnerNotManager = buildOperationWorkItemRow(w, 0, false, 'EXECUTION', false, false, false, []).includes('data-op="openOperationWorkItemContractModal"');
    const w2 = { id: 901, title: 'Việc khác', status: 'CHUA_BAT_DAU', assignedToName: [], assignedTo: ['khac'] };
    const asOutsider = buildOperationWorkItemRow(w2, 0, false, 'EXECUTION', false, false, false, []).includes('data-op="openOperationWorkItemContractModal"');
    const asManager = buildOperationWorkItemRow(w2, 0, false, 'EXECUTION', true, false, true, []).includes('data-op="openOperationWorkItemContractModal"');
    return { asOwnerNotManager, asOutsider, asManager };
  });
  record('C2 (a): người phụ trách (KHÔNG toàn quyền) -> CÓ nút 💰', gateOut.asOwnerNotManager === true, JSON.stringify(gateOut));
  record('C2 (a): người ngoài (không toàn quyền, không phụ trách) -> KHÔNG có nút 💰', gateOut.asOutsider === false, JSON.stringify(gateOut));
  record('C2 (a): toàn quyền quản lý hồ sơ -> CÓ nút 💰 (dù không phải phụ trách)', gateOut.asManager === true, JSON.stringify(gateOut));

  // ===== (b) modal CHỈ còn Giá Trị Hợp Đồng hiện có + tệp đính kèm — KHÔNG còn field Giá Trị Đầu Tư =====
  const modalOut = await page.evaluate(() => {
    currentUser = { username: 'qlvh', perms: { operationRecordManageAll: true } };
    currentWorkItemModalKind = 'operationRepairs';
    currentWorkItemModalRecordId = 100;
    DB.operationRepairs = [{ id: 100, code: 'HCRC-VH-SCST-100', title: 'Sửa kho A', estimateTotalAmount: 80000000, estimateItems: [{ id: 5001, content: 'Hạng mục A', amount: 30000000 }] }];
    DB.operationWorkItems = [{ id: 10, title: 'Việc B', estimateItemId: 5001, contractValue: 12000000, contractAttachments: [{ fileUrl: '/uploads/hd.pdf', fileName: 'hop_dong.pdf' }] }];
    openOperationWorkItemContractModal(10);
    return {
      titleText: document.getElementById('owiContractTitle').innerText,
      investmentElGone: document.getElementById('owiContractInvestmentValue') === null,
      contractValueInput: document.getElementById('owiContractValue').value,
      chipHtml: document.getElementById('owiContractFileChip').innerHTML,
      modalVisible: !document.getElementById('operationWorkItemContractModal').classList.contains('hidden')
    };
  });
  record('C2 (b): modal hiện ra', modalOut.modalVisible === true, JSON.stringify(modalOut));
  record('C2 (b): tiêu đề modal KHÔNG còn nhắc "đầu tư" (đã đổi thành "Giá trị hợp đồng")', !modalOut.titleText.includes('đầu tư'), JSON.stringify(modalOut));
  record('C2 (b): field "Giá Trị Đầu Tư" (owiContractInvestmentValue) ĐÃ BỊ BỎ khỏi modal — chuyển ra cột riêng trong bảng', modalOut.investmentElGone === true, JSON.stringify(modalOut));
  record('C2 (b): Giá Trị Hợp Đồng hiện có (12,000,000) được prefill vào ô nhập', modalOut.contractValueInput.includes('12.000.000') || modalOut.contractValueInput.includes('12,000,000'), JSON.stringify(modalOut));
  record('C2 (b): tệp đính kèm hiện có hiển thị trong chip', modalOut.chipHtml.includes('hop_dong.pdf'), JSON.stringify(modalOut));

  // ===== (b2) MỚI (v29.20): cột "Giá Trị Đầu Tư" trong bảng hiện ĐÚNG Chi Phí của RIÊNG công việc đó
  // (qua estimateItemId), KHÔNG phải tổng cả hồ sơ — và hiện "—" cho công việc tạo tay (không liên kết).
  const investCellOut = await page.evaluate(() => {
    const sourceRecord = { estimateItems: [{ id: 5001, content: 'Hạng mục A', amount: 30000000 }, { id: 5002, content: 'Hạng mục B', amount: 99000000 }] };
    const linked = { id: 20, title: 'Việc liên kết', status: 'CHUA_BAT_DAU', assignedToName: [], assignedTo: [], estimateItemId: 5001 };
    const unlinked = { id: 21, title: 'Việc tạo tay', status: 'CHUA_BAT_DAU', assignedToName: [], assignedTo: [], estimateItemId: null };
    const rowLinked = buildOperationWorkItemRow(linked, 0, false, 'EXECUTION', true, false, true, [], sourceRecord);
    const rowUnlinked = buildOperationWorkItemRow(unlinked, 0, false, 'EXECUTION', true, false, true, [], sourceRecord);
    return { rowLinked, rowUnlinked };
  });
  record('C2 (b2): công việc liên kết hạng mục 5001 (30.000.000) -> cột hiện ĐÚNG số này, KHÔNG phải tổng 2 hạng mục', investCellOut.rowLinked.includes('30.000.000') && !investCellOut.rowLinked.includes('129.000.000'), investCellOut.rowLinked);
  record('C2 (b2): công việc tạo tay (estimateItemId null) -> cột hiện "—", không suy luận/đoán số liệu', investCellOut.rowUnlinked.includes('—'), investCellOut.rowUnlinked);

  // ===== (c) submit gọi ĐÚNG action 'contract' với payload đúng =====
  const submitOut = await page.evaluate(async () => {
    let calledWith = null;
    callRecordAction = async (collection, id, action, payload) => {
      calledWith = { collection, id, action, payload };
      return { item: { id: 10, title: 'Việc B', contractValue: payload.contractValue, contractAttachments: payload.contractAttachments } };
    };
    renderOperationWorkItemModalBody = () => {};
    renderOperationExecutionList = () => {};
    renderOperationAcceptanceList = () => {};
    document.getElementById('owiContractValue').value = '20.000.000';
    await submitOperationWorkItemContract();
    return { calledWith, updatedInDb: DB.operationWorkItems.find(w => w.id === 10)?.contractValue };
  });
  record('C2 (c): submit gọi callRecordAction("operationWorkItems", id, "contract", ...)', submitOut.calledWith && submitOut.calledWith.collection === 'operationWorkItems' && submitOut.calledWith.id === 10 && submitOut.calledWith.action === 'contract', JSON.stringify(submitOut));
  record('C2 (c): payload.contractValue đọc đúng từ ô nhập (20.000.000 -> 20000000)', submitOut.calledWith && submitOut.calledWith.payload.contractValue === 20000000, JSON.stringify(submitOut));
  record('C2 (c): DB.operationWorkItems cập nhật lại đúng kết quả server trả về', submitOut.updatedInDb === 20000000, JSON.stringify(submitOut));

  // ===== (d) exportOperationWorkItems() có đủ cột Giá Trị Đầu Tư/Giá Trị Hợp Đồng/Tệp Đính Kèm HĐ =====
  // v29.20: investmentValue giờ tính ĐÚNG THEO TỪNG DÒNG (estimateItemId), KHÔNG còn estimateTotalAmount
  // (tổng cả hồ sơ) lặp lại ở mọi dòng — 2 công việc trong fixture liên kết 2 hạng mục KHÁC NHAU để xác
  // nhận không bị nhầm/trộn giá trị giữa các dòng.
  const exportOut = await page.evaluate(async () => {
    DB.operationRepairs = [{
      id: 100, code: 'HCRC-VH-SCST-100', title: 'Sửa kho A', estimateTotalAmount: 80000000,
      estimateItems: [{ id: 7001, content: 'Hạng mục X', amount: 5000000 }, { id: 7002, content: 'Hạng mục Y', amount: 75000000 }]
    }];
    DB.operationWorkItems = [
      { id: 11, title: 'Việc C', assignedToName: [], estimateItemId: 7001, contractValue: 5000000, contractAttachments: [{ fileUrl: '/x.pdf', fileName: 'x.pdf' }], parentWorkItemId: null, sourceType: 'OPERATION_REPAIR', sourceId: 100 },
      { id: 12, title: 'Việc D (tạo tay)', assignedToName: [], estimateItemId: null, contractValue: 0, contractAttachments: [], parentWorkItemId: null, sourceType: 'OPERATION_REPAIR', sourceId: 100 }
    ];
    currentWorkItemModalKind = 'operationRepairs'; currentWorkItemModalRecordId = 100;
    let captured = null;
    downloadXlsxFromServer = async (fileName, sheetName, columns, rows) => { captured = { columns, rows }; };
    await exportOperationWorkItems();
    return captured;
  });
  const exportHeaders = (exportOut?.columns || []).map(c => c.header);
  record('C2 (d): export có cột "Giá Trị Đầu Tư (VNĐ)"', exportHeaders.some(h => h.includes('Giá Trị Đầu Tư')), JSON.stringify(exportHeaders));
  record('C2 (d): export có cột "Giá Trị Hợp Đồng (VNĐ)"', exportHeaders.some(h => h.includes('Giá Trị Hợp Đồng')), JSON.stringify(exportHeaders));
  record('C2 (d): export có cột "Tệp Đính Kèm HĐ"', exportHeaders.some(h => h.includes('Tệp Đính Kèm')), JSON.stringify(exportHeaders));
  const row0 = (exportOut?.rows || [])[0] || {};
  const row1 = (exportOut?.rows || [])[1] || {};
  record('C2 (d): dòng "Việc C" (estimateItemId=7001) có investmentValue = 5000000, KHÔNG phải tổng 80.000.000', row0.investmentValue === 5000000, JSON.stringify(row0));
  record('C2 (d): dòng xuất có contractValue = 5000000 (đúng w.contractValue)', row0.contractValue === 5000000, JSON.stringify(row0));
  record('C2 (d): dòng xuất liệt kê đúng tên tệp đính kèm hợp đồng', row0.contractAttachments === 'x.pdf', JSON.stringify(row0));
  record('C2 (d): dòng "Việc D" tạo tay (estimateItemId=null) có investmentValue = 0 (không suy luận)', row1.investmentValue === 0, JSON.stringify(row1));

  record('C2: không có lỗi JS chưa bắt (pageerror) nào phát sinh trong toàn bộ bài test', pageErrors.length === 0, pageErrors.join('; '));

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

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
