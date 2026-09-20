// server/tests/test-it-reminder-lost-update.js
//
// LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Cao — LOST UPDATE): jobs/itApprovalDeadlineReminder.js
// trước đây ghi cờ "đã nhắc" bằng cách gán NGUYÊN mảng `rec.infoRequests = item.infoRequests` với
// `item` là SNAPSHOT đọc TRƯỚC khi lấy khoá (getAllForCollection()) — mọi thay đổi phát sinh trên hồ sơ
// trong lúc job đang gửi email (gửi SMTP thật có thể mất vài giây) bị GHI ĐÈ MẤT TRẮNG:
//   - người đề xuất vừa tải tệp bổ sung xong (openReq.response/respondedAt) -> mất phản hồi, hồ sơ quay
//     lại trạng thái "còn yêu cầu bổ sung chưa xử lý" (blockApproveIf của itPriceApprovals chặn duyệt).
//   - đội IT/người duyệt vừa thêm 1 yêu cầu bổ sung MỚI -> biến mất hoàn toàn.
//   - cờ emergencyRejectReminderSent đang true trong DB bị ghi đè bằng giá trị cũ của snapshot.
// Nay job chỉ set ĐÚNG cờ reminderSent trên ĐÚNG phần tử (tra lại theo id bên trong khoá) +
// emergencyRejectReminderSent, không đụng gì khác.
//
// Giả lập db/lib/recordStore/mailer/systemLogStore — cùng khuôn tests/test-it-approval-deadline-reminder.js,
// thêm 1 "người dùng khác" ghi xen vào ĐÚNG lúc job đang gửi mail (hook trong sendMail giả).
//
// Chạy: node server/tests/test-it-reminder-lost-update.js
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

function vnDateTimeAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toLocaleString('vi-VN');
}

async function main() {
  console.log('== jobs/itApprovalDeadlineReminder.js — lost update trên itPriceApprovals.infoRequests ==');

  const STORE = { itSupportTickets: [], itPriceApprovals: [] };
  const APP_DATA = {
    emailConfig: { enabled: true, smtpHost: 'smtp.test', smtpPort: 587, senderEmail: 'system@test.vn' },
    users: [
      { username: 'nv1', name: 'Người Đề Xuất', email: 'nv1@test.vn', active: true, perms: {} },
      { username: 'kt_emergency', name: 'Duyệt Khẩn Cấp', email: 'kt@test.vn', active: true, perms: { itPriceEmergencyRejectApproveRetail: true } }
    ]
  };

  stubModule('lib/recordStore', {
    getAllForCollection: async (c) => JSON.parse(JSON.stringify(STORE[c] || [])), // job đọc SNAPSHOT (đúng như thật)
    withLockedRecordById: async (c, id, mutatorFn) => {
      const arr = STORE[c] || [];
      const idx = arr.findIndex(x => x.id === id);
      if (idx === -1) throw new Error('Không tìm thấy bản ghi');
      arr[idx] = await mutatorFn(arr[idx]);
      return arr[idx];
    }
  });
  stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

  // Mỗi lượt gửi mail = 1 "khoảng thời gian" job đang bận -> mô phỏng người dùng khác ghi xen vào ĐÚNG
  // lúc đó (đây chính là cửa sổ đua thật: đọc snapshot -> gửi mail (chậm) -> mới ghi cờ).
  let onSend = null;
  stubModule('lib/mailer', {
    sendMail: async ({ to, subject }) => {
      if (onSend) await onSend();
      return { sent: to, failed: [], simulated: false };
    },
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

  const { checkItApprovalDeadlineReminders } = require('../jobs/itApprovalDeadlineReminder');

  await test('Người đề xuất phản hồi ĐÚNG LÚC job đang gửi mail -> phản hồi KHÔNG bị ghi đè mất, vẫn đánh dấu đã nhắc', async () => {
    STORE.itPriceApprovals = [{
      id: 10, code: 'PG-LU-001', creator: 'nv1', priceType: 'RETAIL', status: 'APPROVED',
      infoRequests: [{
        id: 100, requestedBy: 'it1', requestedByName: 'IT 1', reason: 'Thiếu file gốc',
        requestedAt: vnDateTimeAgo(3), response: null, respondedAt: null, byRole: 'it', reminderSent: false
      }]
    }];
    onSend = async () => {
      // "submitPriceSupplementFile()" chạy xen giữa: ghi thẳng vào STORE (bản ghi THẬT trong DB).
      const rec = STORE.itPriceApprovals.find(i => i.id === 10);
      rec.infoRequests[0].response = 'Đã tải lên tệp bổ sung: bang-gia-moi.xlsx';
      rec.infoRequests[0].respondedAt = vnDateTimeAgo(0);
      rec.files = [{ id: 1, fileName: 'bang-gia-moi.xlsx' }];
    };
    await checkItApprovalDeadlineReminders();
    onSend = null;

    const rec = STORE.itPriceApprovals.find(i => i.id === 10);
    assert.strictEqual(rec.infoRequests[0].response, 'Đã tải lên tệp bổ sung: bang-gia-moi.xlsx',
      'LOST UPDATE: phản hồi của người đề xuất bị job ghi đè mất bằng snapshot cũ');
    assert.ok(rec.infoRequests[0].respondedAt, 'respondedAt cũng phải còn nguyên');
    assert.strictEqual(rec.infoRequests[0].reminderSent, true, 'Vẫn phải đánh dấu đã nhắc (không nhắc lại lần sau)');
    assert.strictEqual((rec.files || []).length, 1, 'Tệp bổ sung vừa tải lên không được mất');
  });

  await test('Yêu cầu bổ sung MỚI thêm vào giữa chừng -> không bị job xoá mất', async () => {
    STORE.itPriceApprovals = [{
      id: 11, code: 'PG-LU-002', creator: 'nv1', priceType: 'RETAIL', status: 'APPROVED',
      infoRequests: [{
        id: 200, requestedBy: 'it1', requestedByName: 'IT 1', reason: 'Thiếu file gốc',
        requestedAt: vnDateTimeAgo(3), response: 'Đã bổ sung', respondedAt: vnDateTimeAgo(2), byRole: 'it', reminderSent: false
      }, {
        id: 201, requestedBy: 'it1', requestedByName: 'IT 1', reason: 'Sai đơn giá dòng 5',
        requestedAt: vnDateTimeAgo(3), response: null, respondedAt: null, byRole: 'it', reminderSent: false
      }]
    }];
    onSend = async () => {
      const rec = STORE.itPriceApprovals.find(i => i.id === 11);
      rec.infoRequests.push({
        id: 202, requestedBy: 'it2', requestedByName: 'IT 2', reason: 'Bổ sung thêm hợp đồng NCC',
        requestedAt: vnDateTimeAgo(0), response: null, respondedAt: null, byRole: 'it', reminderSent: false
      });
    };
    await checkItApprovalDeadlineReminders();
    onSend = null;

    const rec = STORE.itPriceApprovals.find(i => i.id === 11);
    assert.strictEqual(rec.infoRequests.length, 3, 'LOST UPDATE: yêu cầu bổ sung mới thêm giữa chừng bị ghi đè mất');
    assert.ok(rec.infoRequests.some(r => r.id === 202), 'Phần tử id=202 phải còn');
    assert.strictEqual(rec.infoRequests.find(r => r.id === 201).reminderSent, true, 'Đúng phần tử đang treo (201) được đánh dấu đã nhắc');
    assert.strictEqual(rec.infoRequests.find(r => r.id === 202).reminderSent, false, 'Phần tử MỚI không bị đánh dấu nhắc oan');
  });

  await test('Cờ emergencyRejectReminderSent đã true trong DB không bị snapshot cũ ghi đè về giá trị cũ', async () => {
    STORE.itPriceApprovals = [{
      id: 12, code: 'PG-LU-003', creator: 'nv1', priceType: 'RETAIL', status: 'APPROVED',
      infoRequests: [{
        id: 300, requestedBy: 'it1', requestedByName: 'IT 1', reason: 'Thiếu file',
        requestedAt: vnDateTimeAgo(3), response: null, respondedAt: null, byRole: 'it', reminderSent: false
      }],
      emergencyRejectStatus: 'PENDING', emergencyRejectRequestedByName: 'QL 1',
      emergencyRejectRequestedAt: vnDateTimeAgo(0), // chưa quá hạn -> job KHÔNG gửi nhắc khẩn cấp lượt này
      emergencyRejectReminderSent: false
    }];
    onSend = async () => {
      const rec = STORE.itPriceApprovals.find(i => i.id === 12);
      rec.emergencyRejectReminderSent = true; // 1 luồng khác vừa đánh dấu (VD job chạy ở tiến trình PM2 khác)
    };
    await checkItApprovalDeadlineReminders();
    onSend = null;

    const rec = STORE.itPriceApprovals.find(i => i.id === 12);
    assert.strictEqual(rec.emergencyRejectReminderSent, true,
      'Cờ nhắc khẩn cấp bị ghi đè ngược về false bằng snapshot cũ (nhắc lại lần 2 oan)');
  });

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
