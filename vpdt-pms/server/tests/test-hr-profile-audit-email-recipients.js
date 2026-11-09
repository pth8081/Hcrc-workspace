// tests/test-hr-profile-audit-email-recipients.js — "🔍 Audit Nhân Sự" (jobs/hrProfileGapAudit.js):
// khoá đúng danh sách người nhận email cảnh báo theo yêu cầu người dùng (11/2026, nguyên văn đợt 1):
// "Audit nhân sự bạn bỏ gửi email đến admin cho tôi nhé, chỉ gửi đến người nào có quyền audit nhân sự
// thôi" — rồi xác nhận lại rõ hơn (đợt 2): "audit hồ sơ nhân sự ko gửi cho admin mà chỉ gửi cho người
// quản lý nhân sự thôi nhé" (chọn rõ: thu hẹp chỉ còn ĐÚNG quyền hrProfileManage).
//
// TRƯỚC (bản gốc): gửi cho BẤT KỲ ai có perms.admin HOẶC hrProfileManage/hrProfileEdit/hrContractManage
// — kể cả admin không hề bật quyền Hồ Sơ Nhân Sự nào, không đối chiếu Khối 0 module `hrAudit`.
// ĐỢT 1 (đã thay bằng đợt 2): gửi theo đúng canAccessHrProfileAudit() trừ admin-bypass (còn rộng, gồm cả
// hrProfileEdit/hrContractManage/hrReportView).
// NAY (đợt 2, bản cuối): CHỈ gửi cho tài khoản có ĐÚNG quyền "Quản Lý Hồ Sơ Nhân Sự" (hrProfileManage) +
// Khối 0 module hrAudit + còn active — không còn hrProfileEdit/hrContractManage/hrReportView/admin nào.
//
// Chạy: node tests/test-hr-profile-audit-email-recipients.js
'use strict';
const assert = require('assert');
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
async function check(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.message}`); fail++; }
}

async function main() {
  let capturedTo = null;
  let APP_DATA = {};

  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
    setAppDataValue: async (key, val) => { APP_DATA[key] = val; },
    getAllAppData: async () => APP_DATA
  });
  stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
  stubModule('lib/mailer', {
    sendMail: async ({ to }) => { capturedTo = to; return { sent: to, failed: [], simulated: false }; },
    resolveEncryption: () => 'none', resolveGraphOption: () => null, resolveEwsOption: () => null
  });
  // Luôn phát hiện đúng 1 "gap" cố định — chữ ký đổi mỗi test (employeeCode khác nhau) để job KHÔNG
  // coi là "đã gửi y hệt lần trước" rồi bỏ qua gửi (xem checkHrProfileGaps(): so lastEmailedSignature).
  let findingsEmployeeCode = 'NV001';
  stubModule('lib/hrProfileAudit', {
    auditHrProfileGaps: async () => [{ severity: 'WARNING', employeeCode: findingsEmployeeCode, name: 'Test', reason: 'test finding' }],
    computeFindingsSignature: (findings) => JSON.stringify(findings)
  });

  const { checkHrProfileGaps } = require('../jobs/hrProfileGapAudit');

  function resetAppData(users) {
    APP_DATA = { users, emailConfig: {}, hrProfileAuditJobConfig: { autoScanEmailEnabled: true, ccEmails: [] } };
  }

  await check('Admin THUẦN (chỉ perms.admin=true) -> KHÔNG nhận email', async () => {
    findingsEmployeeCode = 'NV101';
    resetAppData([
      { username: 'admin1', email: 'admin1@hcrc.vn', active: true, perms: { admin: true } }
    ]);
    capturedTo = null;
    await checkHrProfileGaps();
    assert.strictEqual(capturedTo, null, 'admin thuần không nhận email audit nhân sự (0 người nhận -> sendMail không được gọi)');
  });

  await check('User có hrProfileManage + module hrAudit bật -> CÓ nhận email', async () => {
    findingsEmployeeCode = 'NV102';
    resetAppData([
      { username: 'hr1', email: 'hr1@hcrc.vn', active: true, perms: { hrProfileManage: true, moduleAccess: { hrAudit: true } } }
    ]);
    capturedTo = null;
    await checkHrProfileGaps();
    assert.deepStrictEqual(capturedTo, ['hr1@hcrc.vn']);
  });

  await check('User có hrProfileManage NHƯNG module hrAudit bị TẮT (moduleAccess.hrAudit=false) -> KHÔNG nhận (Khối 0 chặn)', async () => {
    findingsEmployeeCode = 'NV103';
    resetAppData([
      { username: 'hr2', email: 'hr2@hcrc.vn', active: true, perms: { hrProfileManage: true, moduleAccess: { hrAudit: false } } }
    ]);
    capturedTo = null;
    await checkHrProfileGaps();
    assert.strictEqual(capturedTo, null);
  });

  await check('User có hrContractManage (KHÔNG có hrProfileManage) -> KHÔNG nhận (đợt 2: thu hẹp chỉ còn hrProfileManage)', async () => {
    findingsEmployeeCode = 'NV104';
    resetAppData([
      { username: 'ct1', email: 'ct1@hcrc.vn', active: true, perms: { hrContractManage: true } }
    ]);
    capturedTo = null;
    await checkHrProfileGaps();
    assert.strictEqual(capturedTo, null);
  });

  await check('User có hrReportView (chỉ xem báo cáo, KHÔNG có hrProfileManage) -> KHÔNG nhận', async () => {
    findingsEmployeeCode = 'NV105';
    resetAppData([
      { username: 'rv1', email: 'rv1@hcrc.vn', active: true, perms: { hrReportView: true } }
    ]);
    capturedTo = null;
    await checkHrProfileGaps();
    assert.strictEqual(capturedTo, null);
  });

  await check('User có hrProfileEdit (KHÔNG có hrProfileManage) -> KHÔNG nhận (đợt 2: hrProfileEdit không còn đủ)', async () => {
    findingsEmployeeCode = 'NV109';
    resetAppData([
      { username: 'hr5', email: 'hr5@hcrc.vn', active: true, perms: { hrProfileEdit: true } }
    ]);
    capturedTo = null;
    await checkHrProfileGaps();
    assert.strictEqual(capturedTo, null);
  });

  await check('Tài khoản ĐÃ KHOÁ (active:false) dù có hrProfileManage -> KHÔNG nhận', async () => {
    findingsEmployeeCode = 'NV106';
    resetAppData([
      { username: 'hr3', email: 'hr3@hcrc.vn', active: false, perms: { hrProfileManage: true } }
    ]);
    capturedTo = null;
    await checkHrProfileGaps();
    assert.strictEqual(capturedTo, null);
  });

  await check('Admin ĐỒNG THỜI có hrProfileManage riêng -> VẪN nhận (không phải vì admin, mà vì có đúng quyền Quản Lý Hồ Sơ Nhân Sự)', async () => {
    findingsEmployeeCode = 'NV107';
    resetAppData([
      { username: 'adminhr', email: 'adminhr@hcrc.vn', active: true, perms: { admin: true, hrProfileManage: true } }
    ]);
    capturedTo = null;
    await checkHrProfileGaps();
    assert.deepStrictEqual(capturedTo, ['adminhr@hcrc.vn']);
  });

  await check('4 user trộn (admin thuần/hrProfileEdit/hrContractManage đều bị loại, chỉ hrProfileManage được nhận) -> chỉ đúng 1 địa chỉ', async () => {
    findingsEmployeeCode = 'NV108';
    resetAppData([
      { username: 'admin2', email: 'admin2@hcrc.vn', active: true, perms: { admin: true } },
      { username: 'hr4', email: 'hr4@hcrc.vn', active: true, perms: { hrProfileManage: true } },
      { username: 'edit1', email: 'edit1@hcrc.vn', active: true, perms: { hrProfileEdit: true } },
      { username: 'ct2', email: 'ct2@hcrc.vn', active: true, perms: { hrContractManage: true } }
    ]);
    capturedTo = null;
    await checkHrProfileGaps();
    assert.deepStrictEqual(capturedTo, ['hr4@hcrc.vn']);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
