// server/tests/demo-noapprover-block-itprice.js
//
// DEMO thật (gọi THẲNG router production routes/create.js qua HTTP, KHÔNG mock lại logic nghiệp vụ) cho
// tính năng mới (10/2026, theo yêu cầu người dùng sau khi xem 2 ảnh "Xem Trước Quy Trình" của Phê Duyệt
// Giá Bán Lẻ hiện "(chưa có người duyệt — kiểm tra lại cấu hình quy trình)"): từ nay hệ thống CHẶN CỨNG
// việc gửi phê duyệt (không chỉ cảnh báo mềm như trước) nếu BẤT KỲ bước nào của quy trình không có ít
// nhất 1 người duyệt HỢP LỆ — áp dụng luôn cho tài khoản đã bị khoá/nghỉ việc — và tự động thông báo cho
// admin. Dùng ĐÚNG module/kịch bản trong 2 ảnh: Phê Duyệt Giá Bán Lẻ (itPriceApprovals, priceType
// RETAIL), 2 phòng ban "Phòng Mua Hàng FMCG" và "Phòng IT", Bước 1 "Trưởng phòng".
//
// Vì sandbox này không có SQL Server thật, demo chạy ở mức HTTP (gọi thẳng Express router thật của
// routes/create.js qua supertest-style fetch, KHÔNG mock lib/workflowEngine.js/lib/createValidation.js/
// lib/recordActions.js — chỉ giả lập tầng lưu trữ/đăng nhập) thay vì mở trình duyệt thật — vẫn là đường
// SẢN XUẤT THẬT (cùng route người dùng thật gọi khi bấm "Gửi phê duyệt"), chỉ khác lớp hiển thị.
//
// Chạy: node server/tests/demo-noapprover-block-itprice.js
'use strict';

const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ PASS: ${name}`); }
  else { fail++; console.log(`❌ FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail, null, 2) : ''}`); }
}

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const TRUONG_PHONG_FMCG = { username: 'tp.fmcg', name: 'Nguyễn Văn Trưởng', dept: 'Phòng Mua Hàng FMCG', perms: {}, active: true };
const PROPOSER = { username: 'proposer', name: 'Người Đề Xuất', dept: 'Phòng Mua Hàng FMCG', perms: { itPriceProposeCreateRetail: true }, active: true };
const USERS = [ADMIN, TRUONG_PHONG_FMCG, PROPOSER];

// itPriceDeptWorkflows: ĐÚNG như 2 ảnh người dùng gửi — "Phòng Mua Hàng FMCG" và "Phòng IT" đều đã cấu
// hình quy trình (workflowId trỏ tới WF_1STEP, bước "Trưởng phòng") nhưng KHÔNG hề khai approvers nào.
const APP_DATA = {
  users: USERS,
  workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Trưởng phòng' }] }],
  itPriceDeptWorkflows: {
    'Phòng Mua Hàng FMCG': { workflowId: 'WF_1STEP', approvers: { 1: [] } },
    'Phòng IT': { workflowId: 'WF_1STEP', approvers: { 1: [] } }
  },
  priceZones: []
};

const notifications = [];
const systemLogEntries = [];
let RECORDS = { itPriceApprovals: [] };
function resetRecords() { RECORDS = { itPriceApprovals: [] }; }

stubModule('lib/appData', {
  getAllAppData: async () => JSON.parse(JSON.stringify(APP_DATA)),
  withLockedAppDataValue: async (key, fn) => fn([])
});
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['itPriceApprovals']),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  getTrashItems: async () => [],
  createForCollection: async (c, builderFn) => {
    const record = await builderFn((RECORDS[c] || []).slice());
    RECORDS[c].push(record);
    return record;
  },
  createForCollectionSerialized: async (c, lockKey, builderFn) => {
    const record = await builderFn((RECORDS[c] || []).slice());
    RECORDS[c].push(record);
    return record;
  },
  withAppLock: async (key, fn) => fn()
});
stubModule('lib/systemLogStore', {
  insertSystemLog: async (entry) => { systemLogEntries.push(entry); }
});
// Fail-open giống hệt getFileUrlOwners() thật khi không tìm thấy bản ghi sở hữu (sandbox không có SQL
// Server thật) — KHÔNG đổi hành vi assertPayloadFileUrlsOwnedByUser(), chỉ bỏ qua bước đọc DB thật.
stubModule('lib/uploadedFiles', {
  assertPayloadFileUrlsOwnedByUser: async () => {},
  recordUploadedFile: async () => {},
  getFileUrlOwners: async () => new Map(),
  collectFileUrlsDeep: () => {}
});
// Bắt lại lời gọi thông báo admin THẬT (notifyUsers() của blockCreateForMissingApprover(), routes/
// create.js) để chứng minh admin có nhận được thông báo khi hồ sơ bị chặn — không mock logic quyết định
// GỬI hay KHÔNG, chỉ chặn bước ghi DB thật (dbo.Records "notifications").
stubModule('lib/notifications', {
  notifyUsers: async (usernames, type, title, message, linkTo) => {
    const entry = { usernames, type, title, message, linkTo };
    notifications.push(entry);
    return [entry];
  }
});
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const username = req.headers['x-test-user'];
    const fresh = USERS.find((u) => u.username === username);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const createRoutes = require('../routes/create');

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function api(server, method, urlPath, body, asUser) {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-test-user': asUser.username },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

function retailPayload(overrides) {
  return Object.assign({
    priceType: 'RETAIL',
    dept: 'Phòng Mua Hàng FMCG',
    reason: 'Demo chặn gửi khi chưa có người duyệt',
    effectiveDate: '2026-11-01',
    storeScope: { mode: 'ALL', stores: [] },
    files: [{ fileUrl: '/uploads/demo-bang-gia.xlsx', fileName: 'bang-gia.xlsx', items: [{ values: { code: 'SP001', name: 'Sản phẩm demo', oldPrice: '10000', newPrice: '12000' } }], columnLabels: [] }]
  }, overrides);
}

async function main() {
  const server = await startApp();
  try {
    console.log('\n========== CÂU HỎI: "quy trình chưa có người gán vào phê duyệt thì chặn gửi, báo đúng bước nào, loại trừ cả account disable/nghỉ việc" ==========\n');

    // ===== Kịch bản 1 (ĐÚNG ảnh người dùng gửi): Phòng Mua Hàng FMCG, Bước 1 "Trưởng phòng" — CHƯA cấu
    // hình người duyệt nào (approvers: {1: []}) =====
    resetRecords(); notifications.length = 0; systemLogEntries.length = 0;
    const r1 = await api(server, 'POST', '/api/create/itPriceApprovals', retailPayload({}), PROPOSER);
    check('[Kịch bản 1] Gửi đề xuất "Phê Duyệt Giá Bán Lẻ" vào Phòng Mua Hàng FMCG (CHƯA cấu hình người duyệt Bước 1) -> BỊ CHẶN (409), KHÔNG tạo được hồ sơ',
      r1.status === 409 && RECORDS.itPriceApprovals.length === 0, r1.body);
    check('[Kịch bản 1] Thông báo lỗi nêu ĐÚNG "Bước 1 (Trưởng phòng)"',
      /Bước 1 \(Trưởng phòng\)/.test(r1.body?.error || ''), r1.body?.error);
    check('[Kịch bản 1] Admin nhận được thông báo trong hệ thống ngay khi bị chặn',
      notifications.length === 1 && notifications[0].usernames.includes('admin') && /Thiếu người duyệt/.test(notifications[0].title),
      notifications);
    check('[Kịch bản 1] Ghi 1 dòng Nhật Ký Hệ Thống mức WARNING (CREATE_BLOCKED_NO_APPROVER)',
      systemLogEntries.length === 1 && systemLogEntries[0].actionType === 'CREATE_BLOCKED_NO_APPROVER', systemLogEntries);
    console.log(`   📩 Nội dung lỗi người đề xuất thấy ngay trên form: "${r1.body?.error}"`);

    // ===== Kịch bản 2 (ĐÚNG ảnh thứ 2): Phòng IT — cùng tình huống =====
    resetRecords(); notifications.length = 0; systemLogEntries.length = 0;
    const r2 = await api(server, 'POST', '/api/create/itPriceApprovals', retailPayload({ dept: 'Phòng IT' }), { ...PROPOSER, dept: 'Phòng IT' });
    check('[Kịch bản 2] Gửi đề xuất vào Phòng IT (CHƯA cấu hình người duyệt Bước 1) -> BỊ CHẶN (409)',
      r2.status === 409 && RECORDS.itPriceApprovals.length === 0, r2.body);

    // ===== Kịch bản 3 (LỖ HỔNG CŨ, nay đã vá): admin cấu hình ĐÚNG 1 người duyệt bước 1 cho Phòng Mua
    // Hàng FMCG, NHƯNG người đó đã bị KHOÁ TÀI KHOẢN (active:false, mô phỏng "đã nghỉ việc") — TRƯỚC ĐÂY
    // guard cũ (resolveWorkflowStepApprovers, không lọc active) sẽ cho gửi vì "approvers[1] không rỗng".
    // NAY PHẢI VẪN BỊ CHẶN. =====
    resetRecords(); notifications.length = 0; systemLogEntries.length = 0;
    const TRUONG_DA_NGHI_VIEC = { username: 'tp.old', name: 'Trần Văn Cũ (đã nghỉ việc)', dept: 'Phòng Mua Hàng FMCG', perms: {}, active: false };
    USERS.push(TRUONG_DA_NGHI_VIEC);
    APP_DATA.itPriceDeptWorkflows['Phòng Mua Hàng FMCG'] = { workflowId: 'WF_1STEP', approvers: { 1: [TRUONG_DA_NGHI_VIEC.username] } };
    const r3 = await api(server, 'POST', '/api/create/itPriceApprovals', retailPayload({}), PROPOSER);
    check('[Kịch bản 3 — LỖ HỔNG CŨ ĐÃ VÁ] Bước 1 có "người duyệt" trên giấy nhưng tài khoản đã khoá/nghỉ việc -> VẪN PHẢI BỊ CHẶN (không chỉ đếm số lượng, phải lọc active)',
      r3.status === 409 && /chưa có người duyệt hợp lệ/.test(r3.body?.error || '') && /khoá tài khoản\/nghỉ việc/.test(r3.body?.error || ''), r3.body);
    check('[Kịch bản 3] Admin vẫn được thông báo dù nguyên nhân là tài khoản bị khoá (không phải "chưa cấu hình")',
      notifications.length === 1, notifications);

    // ===== Kịch bản 4 (đối chứng — không chặn oan): admin sửa lại, gán đúng 1 người ĐANG hoạt động ->
    // gửi thành công bình thường. =====
    resetRecords(); notifications.length = 0; systemLogEntries.length = 0;
    APP_DATA.itPriceDeptWorkflows['Phòng Mua Hàng FMCG'] = { workflowId: 'WF_1STEP', approvers: { 1: [TRUONG_PHONG_FMCG.username] } };
    const r4 = await api(server, 'POST', '/api/create/itPriceApprovals', retailPayload({}), PROPOSER);
    check('[Kịch bản 4 — đối chứng] Bước 1 có người duyệt ĐANG hoạt động -> gửi thành công bình thường, không bị chặn oan',
      r4.status === 200 && RECORDS.itPriceApprovals.length === 1, r4.body);
    check('[Kịch bản 4] Không gửi thông báo admin nào khi mọi thứ hợp lệ (tránh làm phiền admin vô cớ)',
      notifications.length === 0, notifications);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  if (!fail) {
    console.log('\n✅ XÁC NHẬN: quy trình chưa gán người duyệt (hoặc người được gán đã khoá tài khoản/nghỉ việc) -> hệ thống CHẶN gửi phê duyệt ngay, báo ĐÚNG bước nào, và tự thông báo admin — đúng yêu cầu.');
  }
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
