'use strict';

// tests/test-labor-contract-expiry-reminder-recipients.js
//
// jobs/laborContractExpiryReminder.js — xác nhận người nhận cảnh báo hết hạn Hợp Đồng Lao Động CHỈ còn
// quản lý nhân sự (quyền hrContractManage/admin), KHÔNG CÒN gửi cho quản lý trực tiếp của nhân viên có
// hợp đồng sắp hết hạn (đã bỏ theo yêu cầu người dùng, 11/2026 — trước đó job này tra thêm
// employeeProfiles -> user.managerUsername để cộng thêm 1 người nhận nữa).
//
// Chạy: node server/tests/test-labor-contract-expiry-reminder-recipients.js
const assert = require('assert');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (err) { failed++; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

function requireFreshJob({ appData, contracts }) {
  const dbPath = require.resolve('../db');
  const mailerPath = require.resolve('../lib/mailer');
  const emailCryptoPath = require.resolve('../lib/emailCrypto');
  const recordStorePath = require.resolve('../lib/recordStore');
  const systemLogStorePath = require.resolve('../lib/systemLogStore');
  const jobPath = require.resolve('../jobs/laborContractExpiryReminder');

  const sentMails = [];
  const systemLogs = [];
  const lockedUpdates = [];

  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true, exports: {
      getPool: async () => ({
        request: () => {
          const inputs = {};
          const reqObj = {
            input(name, _type, value) { inputs[name] = value; return reqObj; },
            query: async (sqlText) => {
              if (/SELECT DataValue FROM dbo\.AppData WHERE DataKey = @k/.test(sqlText)) {
                const key = inputs.k;
                return Object.prototype.hasOwnProperty.call(appData, key)
                  ? { recordset: [{ DataValue: JSON.stringify(appData[key]) }] }
                  : { recordset: [] };
              }
              throw new Error(`Unexpected query trong dbMock: ${sqlText}`);
            }
          };
          return reqObj;
        }
      }),
      sql: { NVarChar: () => undefined }
    }
  };

  require.cache[mailerPath] = {
    id: mailerPath, filename: mailerPath, loaded: true, exports: {
      sendMail: async (opts) => { sentMails.push(opts); return { sent: opts.to, failed: [], simulated: false, host: 'mock-smtp' }; },
      resolveEncryption: () => 'none',
      resolveGraphOption: () => null,
      resolveEwsOption: () => null,
      buildReminderEmailLink: () => '',
      buildReminderEmailUrl: () => ''
    }
  };

  require.cache[emailCryptoPath] = {
    id: emailCryptoPath, filename: emailCryptoPath, loaded: true, exports: { decryptSecret: () => 'dummy' }
  };

  require.cache[recordStorePath] = {
    id: recordStorePath, filename: recordStorePath, loaded: true, exports: {
      getAllForCollection: async (name) => (name === 'laborContracts' ? contracts : []),
      withLockedRecordById: async (name, id, mutatorFn) => {
        const item = contracts.find((c) => c.id === id);
        const updated = await mutatorFn({ ...item });
        lockedUpdates.push({ name, id, updated });
        Object.assign(item, updated);
        return updated;
      }
    }
  };

  require.cache[systemLogStorePath] = {
    id: systemLogStorePath, filename: systemLogStorePath, loaded: true, exports: {
      insertSystemLog: async (entry) => { systemLogs.push(entry); }
    }
  };

  delete require.cache[jobPath];
  const { checkLaborContractExpiryReminders } = require('../jobs/laborContractExpiryReminder');
  return {
    checkLaborContractExpiryReminders,
    sentMails, systemLogs, lockedUpdates,
    cleanup: () => {
      [dbPath, mailerPath, emailCryptoPath, recordStorePath, systemLogStorePath, jobPath].forEach((p) => delete require.cache[p]);
    }
  };
}

async function main() {
  await test('Cảnh báo hết hạn HĐLĐ CHỈ gửi cho HR (hrContractManage/admin), KHÔNG gửi cho quản lý trực tiếp của nhân viên', async () => {
    const appData = {
      emailConfig: { enabled: true },
      users: [
        { username: 'hr1', name: 'Nhân Sự A', email: 'hr1@company.com', active: true, perms: { hrContractManage: true } },
        { username: 'admin1', name: 'Admin', email: 'admin1@company.com', active: true, perms: { admin: true } },
        { username: 'nv.an', name: 'Nguyễn Văn An', email: 'nv.an@company.com', active: true, perms: {}, managerUsername: 'tp.binh' },
        { username: 'tp.binh', name: 'Trần Thị Bình (Quản Lý Trực Tiếp)', email: 'tp.binh@company.com', active: true, perms: {} }
      ],
      employeeProfiles: [
        { employeeCode: 'NV001', username: 'nv.an' }
      ]
    };
    const contracts = [
      { id: 1, code: 'HDLD-001', employeeCode: 'NV001', status: 'ACTIVE', contractType: 'FIXED_TERM',
        endDate: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000).toISOString(), notifiedThresholds: [] }
    ];

    const { checkLaborContractExpiryReminders, sentMails, systemLogs, lockedUpdates, cleanup } = requireFreshJob({ appData, contracts });
    try {
      await checkLaborContractExpiryReminders();
    } finally {
      cleanup();
    }

    assert.strictEqual(sentMails.length, 1, 'phải gửi đúng 1 lượt email cho hợp đồng sắp hết hạn');
    const recipients = sentMails[0].to.map((e) => e.toLowerCase());
    assert.ok(recipients.includes('hr1@company.com'), 'phải gửi cho HR (hrContractManage)');
    assert.ok(recipients.includes('admin1@company.com'), 'phải gửi cho admin');
    assert.ok(!recipients.includes('tp.binh@company.com'), 'KHÔNG được gửi cho quản lý trực tiếp của nhân viên (tp.binh)');
    assert.strictEqual(recipients.length, 2, 'chỉ đúng 2 người nhận (HR + admin), không thêm quản lý trực tiếp');

    assert.strictEqual(systemLogs.length, 1, 'phải ghi đúng 1 dòng Nhật ký hệ thống');
    assert.ok(!systemLogs[0].description.includes('tp.binh@company.com'), 'log Nhật ký hệ thống cũng không được nhắc tới email quản lý trực tiếp');

    assert.strictEqual(lockedUpdates.length, 1, 'phải đánh dấu notifiedThresholds cho đúng hợp đồng');
    // Còn 29 ngày -> vượt qua CẢ 3 ngưỡng mặc định [60,45,30] cùng lúc (daysUntil <= từng ngưỡng),
    // job đánh dấu TẤT CẢ ngưỡng đã vượt qua (không chỉ ngưỡng gần nhất) — xem chú thích cùng logic ở
    // jobs/contractExpiryReminder.js.
    assert.deepStrictEqual(lockedUpdates[0].updated.notifiedThresholds.sort((a, b) => a - b), [30, 45, 60], 'cả 3 ngưỡng đã vượt qua (60/45/30) phải được đánh dấu đã nhắc trong 1 lượt');
  });

  await test('Hợp đồng INDEFINITE (vô thời hạn) không bao giờ được nhắc hạn', async () => {
    const appData = {
      emailConfig: { enabled: true },
      users: [{ username: 'hr1', name: 'Nhân Sự A', email: 'hr1@company.com', active: true, perms: { hrContractManage: true } }],
      employeeProfiles: []
    };
    const contracts = [
      { id: 2, code: 'HDLD-002', employeeCode: 'NV002', status: 'ACTIVE', contractType: 'INDEFINITE', endDate: null, notifiedThresholds: [] }
    ];
    const { checkLaborContractExpiryReminders, sentMails, cleanup } = requireFreshJob({ appData, contracts });
    try {
      await checkLaborContractExpiryReminders();
    } finally {
      cleanup();
    }
    assert.strictEqual(sentMails.length, 0, 'hợp đồng vô thời hạn không được gửi email nhắc hạn');
  });

  console.log(`\n${passed} pass, ${failed} fail`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => { console.error('FATAL:', err); process.exitCode = 1; });
