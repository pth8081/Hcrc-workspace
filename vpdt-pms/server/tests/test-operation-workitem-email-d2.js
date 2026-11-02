// server/tests/test-operation-workitem-email-d2.js
//
// Regression cho D2 (yêu cầu QA module Vận Hành > Thực hiện > Quản Lý Công Việc, 11/2026):
//   "Có cảnh báo được gửi tới mail của user khi phát sinh công việc: ... được gán phụ trách công việc,
//    cập nhật trạng thái công việc ..." — chốt phạm vi với người dùng: CHỈ 2 mốc trạng thái (bắt đầu +
//    hoàn thành/nghiệm thu, KHÔNG phải mọi lần cập nhật ghi chú tiến độ, tránh spam hộp thư) + người
//    nhận mốc trạng thái là NGƯỜI KHỞI TẠO hồ sơ (ptcv), KHÔNG PHẢI admin hệ thống.
//
// Bao phủ (module-vanhanh.js, hàm mới notifyOperationWorkItemAssigned()/notifyOperationWorkItemStatusMilestone()
// + 3 điểm gọi: submitOperationWorkItemForm() tạo/sửa, updateOperationWorkItemProgressAction(), confirmOperationAcceptanceAction()):
//  (A) Tạo công việc mới có gán phụ trách -> báo email đúng người được gán, KHÔNG báo người gán (manager).
//  (B) Tạo công việc KHÔNG gán ai -> không gửi email nào.
//  (C) Tạo công việc tự gán cho CHÍNH NGƯỜI TẠO (manager) -> tự loại khỏi người nhận, không gửi.
//  (D) Sửa công việc, thêm 1 người phụ trách MỚI (giữ người cũ) -> CHỈ báo người MỚI, không báo lại người cũ.
//  (E) Sửa công việc, KHÔNG đổi người phụ trách -> không gửi email nào (tránh spam mỗi lần sửa khác).
//  (F) Cập nhật tiến độ CHUA_BAT_DAU -> DANG_THUC_HIEN (mốc "bắt đầu" THẬT), người thao tác KHÁC người
//      khởi tạo hồ sơ -> báo người khởi tạo.
//  (G) Cùng mốc "bắt đầu", nhưng người thao tác CHÍNH LÀ người khởi tạo hồ sơ -> tự loại, không gửi.
//  (H) Cập nhật tiến độ DANG_THUC_HIEN -> DANG_THUC_HIEN (lặp lại, chỉ ghi thêm ghi chú) -> KHÔNG phải mốc
//      "bắt đầu" dù newStatus cùng giá trị -> không gửi.
//  (I) Nghiệm thu ACCEPT: DANG_NGHIEM_THU -> DA_NGHIEM_THU, người thao tác khác người khởi tạo -> báo
//      người khởi tạo mốc "hoàn thành nghiệm thu".
//  (J) Yêu cầu bổ sung (REQUEST_INFO, vẫn DANG_NGHIEM_THU, chưa xong) -> KHÔNG phải mốc "hoàn thành" ->
//      không gửi.
//  (K) operationKindFromSourceType()/operationWorkItemSourceRecord() resolve đúng cho CẢ 2 kind
//      (operationStoreOpenings/operationRepairs).
//
// Chạy: node server/tests/test-operation-workitem-email-d2.js
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
  page.on('dialog', async (dialog) => { await dialog.dismiss(); });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

  // Seed dữ liệu dùng chung: MANAGER thao tác (operationRecordManageAll, KHÁC creator), CREATOR (own1,
  // người khởi tạo hồ sơ — người nhận email mốc trạng thái), 2 người được gán (assignee_b/assignee_c).
  await page.evaluate(() => {
    DB.users = [
      { username: 'qlvh', name: 'Quản Lý VH', dept: 'Vận Hành', perms: { operationRecordManageAll: true }, active: true, email: 'qlvh@x.com' },
      { username: 'own1', name: 'Creator Own', dept: 'Vận Hành', perms: {}, active: true, email: 'own1@x.com' },
      { username: 'assignee_b', name: 'Assignee B', dept: 'Vận Hành', perms: {}, active: true, email: 'b@x.com' },
      { username: 'assignee_c', name: 'Assignee C', dept: 'Vận Hành', perms: {}, active: true, email: 'c@x.com' }
    ];
    DB.operationRepairs = [{ id: 100, code: 'HCRC-VH-SCST-100', title: 'Sửa kho A', creator: 'own1', creatorName: 'Creator Own', dept: 'Vận Hành' }];
    DB.operationStoreOpenings = [{ id: 200, code: 'HCRC-VH-MMST-200', storeName: 'Siêu thị B', creator: 'own1', creatorName: 'Creator Own', dept: 'Vận Hành' }];
    DB.operationWorkItems = [];
    DB.systemLogs = [];
    currentUser = DB.users[0]; // qlvh — manager, dùng cho mọi scenario trừ (G) đổi riêng
    currentWorkItemModalKind = 'operationRepairs';
    currentWorkItemModalRecordId = 100;
    currentEditWorkItemId = null;
    // Stub render — tránh ném lỗi do thiếu context UI khác không liên quan phạm vi test này (đã kiểm
    // riêng ở test C1/C3/D1).
    renderOperationWorkItemModalBody = () => {};
    renderOperationExecutionList = () => {};
    renderOperationAcceptanceList = () => {};
    syncOperationWorkItemAncestorsClient = () => {};
    collectDynamicFieldsData = async () => ({});
    // Bắt dispatchRealEmail() thay vì gọi fetch('/api/send-email') thật (mirror khuôn
    // test-notify-email-modules.js) — ghi lại {recipients, subject, bodyText} mỗi lượt gọi.
    window.__emailCalls = [];
    dispatchRealEmail = (recipients, subject, bodyText) => {
      window.__emailCalls.push({ recipients: (recipients || []).map(r => r.username || r.email), subject, bodyText });
    };
  });

  async function resetEmailCalls() { await page.evaluate(() => { window.__emailCalls = []; }); }
  async function getEmailCalls() { return page.evaluate(() => window.__emailCalls); }

  // ===== (A) Tạo mới, gán cho assignee_b =====
  await resetEmailCalls();
  await page.evaluate(() => {
    currentEditWorkItemId = null;
    document.getElementById('owiTitle').value = 'Việc A';
    callRecordCreate = async () => ({ item: { id: 1, title: 'Việc A', assignedTo: ['assignee_b'], assignedToName: ['Assignee B'], deadline: '2026-12-01', sourceType: 'OPERATION_REPAIR', sourceId: 100, parentWorkItemId: null } });
  });
  await page.evaluate(() => submitOperationWorkItemForm({ preventDefault() {} }));
  let calls = await getEmailCalls();
  record('D2 (A): tạo công việc gán assignee_b -> gửi ĐÚNG 1 email cho assignee_b', calls.length === 1 && calls[0].recipients.includes('assignee_b'), JSON.stringify(calls));
  record('D2 (A): KHÔNG báo lại cho người tạo (qlvh, chính người bấm)', !(calls[0] && calls[0].recipients.includes('qlvh')), JSON.stringify(calls));
  record('D2 (A): chủ đề có nhắc "được gán phụ trách"', calls[0] && calls[0].subject.includes('được gán phụ trách'), JSON.stringify(calls));

  // ===== (B) Tạo mới, không gán ai =====
  await resetEmailCalls();
  await page.evaluate(() => {
    callRecordCreate = async () => ({ item: { id: 2, title: 'Việc B', assignedTo: [], assignedToName: [], deadline: '', sourceType: 'OPERATION_REPAIR', sourceId: 100, parentWorkItemId: null } });
  });
  await page.evaluate(() => submitOperationWorkItemForm({ preventDefault() {} }));
  calls = await getEmailCalls();
  record('D2 (B): tạo công việc KHÔNG gán ai -> không gửi email nào', calls.length === 0, JSON.stringify(calls));

  // ===== (C) Tạo mới, tự gán cho chính người tạo (qlvh) =====
  await resetEmailCalls();
  await page.evaluate(() => {
    callRecordCreate = async () => ({ item: { id: 3, title: 'Việc C', assignedTo: ['qlvh'], assignedToName: ['Quản Lý VH'], deadline: '', sourceType: 'OPERATION_REPAIR', sourceId: 100, parentWorkItemId: null } });
  });
  await page.evaluate(() => submitOperationWorkItemForm({ preventDefault() {} }));
  calls = await getEmailCalls();
  record('D2 (C): tự gán cho chính mình -> tự loại khỏi người nhận, không gửi', calls.length === 0, JSON.stringify(calls));

  // ===== (D) Sửa công việc: cũ=[assignee_b], mới=[assignee_b, assignee_c] -> chỉ báo assignee_c =====
  await resetEmailCalls();
  await page.evaluate(() => {
    DB.operationWorkItems = [{ id: 4, title: 'Việc D', assignedTo: ['assignee_b'], assignedToName: ['Assignee B'], status: 'CHUA_BAT_DAU' }];
    currentEditWorkItemId = 4;
    callRecordAction = async () => ({ item: { id: 4, title: 'Việc D sửa', assignedTo: ['assignee_b', 'assignee_c'], assignedToName: ['Assignee B', 'Assignee C'], deadline: '', sourceType: 'OPERATION_REPAIR', sourceId: 100 } });
  });
  await page.evaluate(() => submitOperationWorkItemForm({ preventDefault() {} }));
  calls = await getEmailCalls();
  record('D2 (D): sửa thêm assignee_c (giữ assignee_b) -> CHỈ gửi 1 email cho assignee_c', calls.length === 1 && calls[0].recipients.length === 1 && calls[0].recipients.includes('assignee_c'), JSON.stringify(calls));
  record('D2 (D): KHÔNG báo lại assignee_b (đã được gán từ trước)', !(calls[0] && calls[0].recipients.includes('assignee_b')), JSON.stringify(calls));

  // ===== (E) Sửa công việc, không đổi người phụ trách =====
  await resetEmailCalls();
  await page.evaluate(() => {
    DB.operationWorkItems = [{ id: 5, title: 'Việc E', assignedTo: ['assignee_b'], assignedToName: ['Assignee B'], status: 'CHUA_BAT_DAU' }];
    currentEditWorkItemId = 5;
    callRecordAction = async () => ({ item: { id: 5, title: 'Việc E sửa mô tả', assignedTo: ['assignee_b'], assignedToName: ['Assignee B'], deadline: '', sourceType: 'OPERATION_REPAIR', sourceId: 100 } });
  });
  await page.evaluate(() => submitOperationWorkItemForm({ preventDefault() {} }));
  calls = await getEmailCalls();
  record('D2 (E): sửa công việc KHÔNG đổi người phụ trách -> không gửi email nào (tránh spam)', calls.length === 0, JSON.stringify(calls));

  // ===== (F) Tiến độ: CHUA_BAT_DAU -> DANG_THUC_HIEN (mốc "bắt đầu" THẬT), người thao tác (qlvh) KHÁC người khởi tạo (own1) =====
  await resetEmailCalls();
  await page.evaluate(() => {
    DB.operationWorkItems = [{ id: 6, title: 'Việc F', status: 'CHUA_BAT_DAU', assignedToName: [], sourceType: 'OPERATION_REPAIR', sourceId: 100, parentWorkItemId: null }];
    callRecordAction = async () => ({ item: { id: 6, title: 'Việc F', status: 'DANG_THUC_HIEN', assignedToName: [], sourceType: 'OPERATION_REPAIR', sourceId: 100, parentWorkItemId: null } });
  });
  await page.evaluate(() => updateOperationWorkItemProgressAction(6, 'DANG_THUC_HIEN', ''));
  calls = await getEmailCalls();
  record('D2 (F): mốc "bắt đầu" THẬT -> gửi ĐÚNG 1 email cho người khởi tạo (own1)', calls.length === 1 && calls[0].recipients.includes('own1'), JSON.stringify(calls));
  record('D2 (F): chủ đề có nhắc "bắt đầu thực hiện"', calls[0] && calls[0].subject.includes('bắt đầu thực hiện'), JSON.stringify(calls));

  // ===== (G) Cùng mốc "bắt đầu", nhưng người thao tác CHÍNH LÀ người khởi tạo (own1) =====
  await resetEmailCalls();
  await page.evaluate(() => {
    currentUser = DB.users.find(u => u.username === 'own1');
    DB.operationWorkItems = [{ id: 7, title: 'Việc G', status: 'CHUA_BAT_DAU', assignedToName: [], sourceType: 'OPERATION_REPAIR', sourceId: 100, parentWorkItemId: null }];
    callRecordAction = async () => ({ item: { id: 7, title: 'Việc G', status: 'DANG_THUC_HIEN', assignedToName: [], sourceType: 'OPERATION_REPAIR', sourceId: 100, parentWorkItemId: null } });
  });
  await page.evaluate(() => updateOperationWorkItemProgressAction(7, 'DANG_THUC_HIEN', ''));
  calls = await getEmailCalls();
  record('D2 (G): người khởi tạo tự cập nhật trạng thái việc CỦA CHÍNH MÌNH -> tự loại, không gửi', calls.length === 0, JSON.stringify(calls));
  await page.evaluate(() => { currentUser = DB.users.find(u => u.username === 'qlvh'); }); // trả lại manager cho các scenario sau

  // ===== (H) Tiến độ: DANG_THUC_HIEN -> DANG_THUC_HIEN (lặp lại ghi chú, KHÔNG phải mốc "bắt đầu") =====
  await resetEmailCalls();
  await page.evaluate(() => {
    DB.operationWorkItems = [{ id: 8, title: 'Việc H', status: 'DANG_THUC_HIEN', assignedToName: [], sourceType: 'OPERATION_REPAIR', sourceId: 100, parentWorkItemId: null }];
    callRecordAction = async () => ({ item: { id: 8, title: 'Việc H', status: 'DANG_THUC_HIEN', assignedToName: [], sourceType: 'OPERATION_REPAIR', sourceId: 100, parentWorkItemId: null } });
  });
  await page.evaluate(() => updateOperationWorkItemProgressAction(8, 'DANG_THUC_HIEN', 'vẫn đang làm'));
  calls = await getEmailCalls();
  record('D2 (H): lặp lại DANG_THUC_HIEN (chỉ ghi chú tiến độ) -> KHÔNG phải mốc "bắt đầu", không gửi', calls.length === 0, JSON.stringify(calls));

  // ===== (I) Nghiệm thu ACCEPT: DANG_NGHIEM_THU -> DA_NGHIEM_THU, người thao tác (qlvh) khác người khởi tạo (own1) =====
  await resetEmailCalls();
  await page.evaluate(() => {
    document.getElementById('opAcceptanceReason').value = 'Đạt yêu cầu';
    currentAcceptanceActionItemId = 9;
    currentAcceptanceActionType = 'ACCEPT';
    DB.operationWorkItems = [{ id: 9, title: 'Việc I', status: 'DANG_NGHIEM_THU', assignedToName: ['Assignee B'], sourceType: 'OPERATION_REPAIR', sourceId: 100, parentWorkItemId: null }];
    callRecordAction = async () => ({ item: { id: 9, title: 'Việc I', status: 'DA_NGHIEM_THU', assignedToName: ['Assignee B'], sourceType: 'OPERATION_REPAIR', sourceId: 100, parentWorkItemId: null } });
  });
  await page.evaluate(() => confirmOperationAcceptanceAction());
  calls = await getEmailCalls();
  record('D2 (I): ACCEPT (hoàn thành nghiệm thu) -> gửi ĐÚNG 1 email cho người khởi tạo (own1)', calls.length === 1 && calls[0].recipients.includes('own1'), JSON.stringify(calls));
  record('D2 (I): chủ đề có nhắc "hoàn thành nghiệm thu"', calls[0] && calls[0].subject.includes('hoàn thành nghiệm thu'), JSON.stringify(calls));

  // ===== (J) Yêu cầu bổ sung (REQUEST_INFO) — vẫn DANG_NGHIEM_THU, KHÔNG phải mốc "hoàn thành" =====
  await resetEmailCalls();
  await page.evaluate(() => {
    document.getElementById('opAcceptanceReason').value = 'Thiếu minh chứng';
    currentAcceptanceActionItemId = 10;
    currentAcceptanceActionType = 'REQUEST_INFO';
    DB.operationWorkItems = [{ id: 10, title: 'Việc J', status: 'DANG_NGHIEM_THU', assignedToName: ['Assignee B'], sourceType: 'OPERATION_REPAIR', sourceId: 100, parentWorkItemId: null }];
    callRecordAction = async () => ({ item: { id: 10, title: 'Việc J', status: 'DANG_NGHIEM_THU', assignedToName: ['Assignee B'], sourceType: 'OPERATION_REPAIR', sourceId: 100, parentWorkItemId: null } });
  });
  await page.evaluate(() => confirmOperationAcceptanceAction());
  calls = await getEmailCalls();
  record('D2 (J): REQUEST_INFO (yêu cầu bổ sung, chưa xong) -> KHÔNG phải mốc "hoàn thành", không gửi', calls.length === 0, JSON.stringify(calls));

  // ===== (K) operationKindFromSourceType()/operationWorkItemSourceRecord() — cả 2 kind =====
  const kindOut = await page.evaluate(() => ({
    repairKind: operationKindFromSourceType('OPERATION_REPAIR'),
    storeKind: operationKindFromSourceType('OPERATION_STORE_OPENING'),
    repairRecordCode: operationWorkItemSourceRecord('operationRepairs', 100)?.code,
    storeRecordCode: operationWorkItemSourceRecord('operationStoreOpenings', 200)?.code
  }));
  record('D2 (K): operationKindFromSourceType("OPERATION_REPAIR") -> "operationRepairs"', kindOut.repairKind === 'operationRepairs', JSON.stringify(kindOut));
  record('D2 (K): operationKindFromSourceType("OPERATION_STORE_OPENING") -> "operationStoreOpenings"', kindOut.storeKind === 'operationStoreOpenings', JSON.stringify(kindOut));
  record('D2 (K): operationWorkItemSourceRecord() resolve đúng hồ sơ Sửa Chữa (code khớp)', kindOut.repairRecordCode === 'HCRC-VH-SCST-100', JSON.stringify(kindOut));
  record('D2 (K): operationWorkItemSourceRecord() resolve đúng hồ sơ Mở Mới (code khớp)', kindOut.storeRecordCode === 'HCRC-VH-MMST-200', JSON.stringify(kindOut));

  record('D2: không có lỗi JS chưa bắt (pageerror) nào phát sinh trong toàn bộ bài test', pageErrors.length === 0, pageErrors.join('; '));

  await browser.close();
  server.close();

  const total = results.length;
  const passedCount = results.filter(r => r.pass).length;
  console.log(`\n==== ${passedCount}/${total} scenario(s) passed ====`);
  if (passedCount !== total) process.exitCode = 1;
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
