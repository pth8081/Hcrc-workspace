// server/tests/test-license-expiry-reminder-family.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu Hành Chính, 9/2026): jobs/licenseExpiryReminder.js trước đây quét ĐỘC
// LẬP từng bản ghi Giấy Phép, không loại trừ các phiên bản CŨ đã bị thay thế bởi phiên bản MỚI hơn trong
// cùng 1 family (rootLicenseId/versionNumber) — gia hạn SỚM (thêm phiên bản mới trước khi bản cũ hết
// hạn) khiến bản CŨ vẫn tiếp tục kích hoạt nhắc hạn riêng của nó dù không còn là bản hiện hành. Test này
// giả lập lib/recordStore + lib/mailer + lib/systemLogStore + db.js bằng dữ liệu in-memory (KHÔNG cần
// SQL Server/SMTP thật) — cùng khuôn tests/test-report-period-deadline-reminder.js.
//
// Chạy: node server/tests/test-license-expiry-reminder-family.js
'use strict';

const path = require('path');
const assert = require('assert');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

async function main() {
  console.log('== jobs/licenseExpiryReminder.js: chỉ nhắc hạn bản MỚI NHẤT trong family, bỏ qua bản đã bị thay thế ==');

  const STORE = { licenses: [] };
  const APP_DATA = {
    emailConfig: { enabled: true, smtpHost: 'smtp.test', smtpPort: 587, senderEmail: 'system@test.vn' },
    users: [
      { username: 'nv1', name: 'Người Tạo', email: 'nv1@test.vn', active: true, perms: {} },
      { username: 'duyet1', name: 'Người Duyệt Giấy Phép', email: 'duyet1@test.vn', active: true, perms: { licenseApprove: true } }
    ]
  };
  stubModule('lib/recordStore', {
    getAllForCollection: async (c) => (STORE[c] || []).slice(),
    withLockedRecordById: async (c, id, mutatorFn) => {
      const arr = STORE[c] || [];
      const idx = arr.findIndex(x => x.id === id);
      if (idx === -1) throw new Error('Không tìm thấy bản ghi');
      arr[idx] = await mutatorFn(arr[idx]);
      return arr[idx];
    }
  });
  stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
  const sentMails = [];
  stubModule('lib/mailer', {
    sendMail: async ({ to, subject }) => { sentMails.push({ to, subject }); return { sent: to, failed: [], simulated: false, host: 'smtp.test', port: 587 }; },
    resolveEncryption: () => 'STARTTLS'
  });
  stubModule('lib/emailCrypto', { decryptSecret: (s) => s });
  stubModule('db', {
    getPool: async () => ({
      request: () => {
        let key = null;
        const req = {
          input: (name, type, value) => { key = value; return req; },
          query: async () => {
            const value = APP_DATA[key];
            return { recordset: value === undefined ? [] : [{ DataValue: JSON.stringify(value) }] };
          }
        };
        return req;
      }
    }),
    sql: { NVarChar: () => 'NVARCHAR' }
  });

  const todayPlus = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  STORE.licenses = [
    // Family 1: 2 phiên bản. Bản V1 (id 1, gốc, đã bị thay thế) còn 5 ngày là hết hạn (đã lỗi thời) —
    // KHÔNG được nhắc. Bản V2 (id 2, mới nhất) hết hạn xa (200 ngày) — chưa tới ngưỡng nhắc nào.
    { id: 1, rootLicenseId: null, versionNumber: 1, expiryDate: todayPlus(5), status: 'APPROVED', lifecycleStatus: 'ACTIVE', creator: 'nv1', code: 'GP-001', title: 'Giấy phép kinh doanh', notifiedThresholds: [] },
    { id: 2, rootLicenseId: 1, versionNumber: 2, expiryDate: todayPlus(200), status: 'APPROVED', lifecycleStatus: 'ACTIVE', creator: 'nv1', code: 'GP-001', title: 'Giấy phép kinh doanh', notifiedThresholds: [] },
    // Family 2: chỉ 1 bản duy nhất (không có version nào khác), còn 5 ngày -> PHẢI được nhắc bình thường
    // (đối chứng — xác nhận bản vá không chặn nhầm giấy phép không có versioning).
    { id: 3, rootLicenseId: null, versionNumber: 1, expiryDate: todayPlus(5), status: 'APPROVED', lifecycleStatus: 'ACTIVE', creator: 'nv1', code: 'GP-002', title: 'Giấy phép PCCC', notifiedThresholds: [] }
  ];

  const { checkLicenseExpiryReminders } = require('../jobs/licenseExpiryReminder');
  await checkLicenseExpiryReminders();

  await test('Bản CŨ đã bị thay thế (id 1, còn 5 ngày) KHÔNG được nhắc dù còn "còn hiệu lực" độc lập', () => {
    const gp001Mails = sentMails.filter(m => m.subject.includes('GP-001'));
    assert.strictEqual(gp001Mails.length, 0, 'Family GP-001 chưa tới ngưỡng nhắc của bản MỚI NHẤT (còn 200 ngày) -> không được gửi email nào, kể cả dựa theo bản cũ');
  });

  await test('Giấy phép KHÔNG có versioning (family chỉ 1 bản, còn 5 ngày) vẫn được nhắc bình thường', () => {
    const gp002Mails = sentMails.filter(m => m.subject.includes('GP-002'));
    assert.ok(gp002Mails.length > 0, 'Giấy phép đơn (không phải family nhiều bản) phải được nhắc hạn như cũ, bản vá không được chặn nhầm');
  });

  await test('Bản CŨ (id 1) không bị đánh dấu notifiedThresholds dù không được nhắc (không phải bản đang xét)', () => {
    const v1 = STORE.licenses.find(l => l.id === 1);
    assert.deepStrictEqual(v1.notifiedThresholds, [], 'Bản đã lỗi thời không được job đụng tới, notifiedThresholds phải giữ nguyên rỗng');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
