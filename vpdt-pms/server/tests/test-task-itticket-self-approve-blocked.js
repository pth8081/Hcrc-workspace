'use strict';

// tests/test-task-itticket-self-approve-blocked.js
//
// LỖI ĐÃ VÁ (re-audit lần 5, mức Trung Bình — "Admin vẫn tự duyệt ở Công Việc + leo thang ticket IT"):
//
// 1) resolvePendingTaskAction() (lib/recordActions.js, Công Việc — duyệt/từ chối yêu cầu Gia hạn/Huỷ
//    việc): đợt vá đầu (9/2026) đã thêm chặn "tự duyệt yêu cầu do chính mình gửi" (task.assignedTo ===
//    user.username) nhưng VẪN cho admin vượt qua nhánh chặn đó ("admin vẫn luôn vượt qua được") — module
//    này BỊ BỎ SÓT khi quyết định "Chặn admin tự duyệt ở TẤT CẢ module, không có ngoại lệ" (11/2026)
//    được áp cho mọi assertNotSelfDecidingXxx() khác. requestExtension()/cancelOrRequestCancelTask() cho
//    admin tự GỬI yêu cầu cho BẤT KỲ task nào (nhánh `|| user.perms?.admin`), nên 1 tài khoản admin có
//    thể tự gửi yêu cầu RỒI tự duyệt luôn bằng ĐÚNG tài khoản đó.
//
// 2) escalateItTicket()/approveItTicketEscalation()/denyItTicketEscalation() (Hỗ Trợ IT — "Leo Thang
//    Phê Duyệt"): approve/deny có nhánh admin-bypass hợp lệ cho mục đích "gỡ kẹt hộ" (approver gốc nghỉ
//    việc/khoá tài khoản), nhưng trước đây KHÔNG lưu lại AI đã gửi yêu cầu leo thang — 1 admin có thể tự
//    escalateItTicket() tới người X rồi LẬP TỨC tự approveItTicketEscalation()/denyItTicketEscalation()
//    bằng admin-bypass, vô hiệu hoá hoàn toàn mục đích "xin ý kiến người có trách nhiệm cụ thể".
//
// Đã vá: (1) bỏ hẳn admin-bypass trong nhánh chặn tự duyệt của resolvePendingTaskAction(); (2) thêm field
// escalatedBy/escalatedByName + assertNotSelfDecidingItTicketEscalation() chặn CỨNG (không phân biệt
// admin) khi ticket.escalatedBy === user.username.
//
// Test gọi THẲNG các hàm lib (cùng khuôn test-hrprofile-export-salary-permission.js).
//
// Chạy: node server/tests/test-task-itticket-self-approve-blocked.js
const assert = require('assert');
const recordActions = require('../lib/recordActions');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err && err.stack ? err.stack : err}`); }
}

const ADMIN = { username: 'admin1', name: 'Admin 1', perms: { admin: true } };
const OTHER_ADMIN = { username: 'admin2', name: 'Admin 2', perms: { admin: true } };
const OTHER_APPROVER = { username: 'nv1', name: 'NV 1', perms: {} };

(async () => {
  // ===== Phần 1: Công Việc — Gia hạn/Huỷ việc =====

  await test('LỖI ĐÃ VÁ: admin tự gửi yêu cầu gia hạn cho task của chính mình RỒI tự duyệt -> bị chặn 403 (trước đây admin vượt qua được)', () => {
    const task = { assignedTo: 'admin1', assignedBy: 'admin1', status: 'DOING', deadline: '2026-01-10', history: [] };
    recordActions.requestExtension({ newDeadline: '2026-01-20', reason: 'Cần thêm thời gian' }, ADMIN, task);
    assert.ok(task.pendingExtension, 'phải có yêu cầu gia hạn đang chờ');
    assert.throws(
      () => recordActions.resolvePendingTaskAction('extension', 'approve', ADMIN, task),
      /không thể tự duyệt.*chính mình/i
    );
  });

  await test('admin KHÁC (không phải người gửi yêu cầu) duyệt gia hạn vẫn hoạt động bình thường', () => {
    const task = { assignedTo: 'admin1', assignedBy: 'admin1', status: 'DOING', deadline: '2026-01-10', history: [] };
    recordActions.requestExtension({ newDeadline: '2026-01-20', reason: 'Cần thêm thời gian' }, ADMIN, task);
    const updated = recordActions.resolvePendingTaskAction('extension', 'approve', OTHER_ADMIN, task);
    assert.strictEqual(updated.deadline, '2026-01-20');
    assert.strictEqual(updated.pendingExtension, null);
  });

  await test('LỖI ĐÃ VÁ: resolvePendingTaskAction("cancellation") — admin là chính người đã gửi yêu cầu huỷ (task.assignedTo) RỒI tự duyệt -> bị chặn 403', () => {
    // Dựng thẳng pendingCancellation (không qua cancelOrRequestCancelTask()) để test ĐÚNG đoạn
    // resolvePendingTaskAction() đang xét — cancelOrRequestCancelTask() luôn cho admin huỷ NGAY (nhánh
    // isAssignerOrAdmin), không tạo pendingCancellation cho chính admin, nên không dựng lại được qua đó.
    const task = {
      assignedTo: 'admin1', assignedBy: 'nv1', status: 'DOING', history: [],
      pendingCancellation: { reason: 'Không còn cần thiết', requestedBy: 'admin1', requestedByName: 'Admin 1', requestedAt: '2026-01-01' }
    };
    assert.throws(
      () => recordActions.resolvePendingTaskAction('cancellation', 'approve', ADMIN, task),
      /không thể tự duyệt.*chính mình/i
    );
  });

  // ===== Phần 2: Hỗ Trợ IT — Leo Thang Phê Duyệt =====

  await test('LỖI ĐÃ VÁ: admin tự escalateItTicket() tới người khác RỒI tự approveItTicketEscalation() bằng admin-bypass -> bị chặn 403', () => {
    const ticket = { status: 'DOING', creator: 'nv2', approvalStatus: null };
    recordActions.escalateItTicket(ADMIN, ticket, { reason: 'Cần ý kiến trước khi xử lý', approverUsername: 'nv1' }, [OTHER_APPROVER, { username: 'nv2', name: 'NV 2', active: true }]);
    assert.strictEqual(ticket.approvalStatus, 'PENDING');
    assert.strictEqual(ticket.escalatedBy, 'admin1');
    assert.throws(
      () => recordActions.approveItTicketEscalation(ADMIN, ticket),
      /không thể tự duyệt.*chính mình/i
    );
  });

  await test('LỖI ĐÃ VÁ: admin tự escalateItTicket() RỒI tự denyItTicketEscalation() bằng admin-bypass -> bị chặn 403', () => {
    const ticket = { status: 'DOING', creator: 'nv2', approvalStatus: null };
    recordActions.escalateItTicket(ADMIN, ticket, { reason: 'Cần ý kiến trước khi xử lý', approverUsername: 'nv1' }, [OTHER_APPROVER, { username: 'nv2', name: 'NV 2', active: true }]);
    assert.throws(
      () => recordActions.denyItTicketEscalation(ADMIN, ticket, { comment: 'Không cần nữa' }),
      /không thể tự duyệt.*chính mình/i
    );
  });

  await test('approver được chỉ định (nv1) duyệt yêu cầu leo thang do admin KHÁC gửi vẫn hoạt động bình thường', () => {
    const ticket = { status: 'DOING', creator: 'nv2', approvalStatus: null };
    recordActions.escalateItTicket(ADMIN, ticket, { reason: 'Cần ý kiến trước khi xử lý', approverUsername: 'nv1' }, [OTHER_APPROVER, { username: 'nv2', name: 'NV 2', active: true }]);
    const updated = recordActions.approveItTicketEscalation(OTHER_APPROVER, ticket);
    assert.strictEqual(updated.approvalStatus, 'APPROVED');
  });

  await test('admin KHÁC (không phải người gửi yêu cầu leo thang) vẫn duyệt được hộ — giữ đúng mục đích "gỡ kẹt hộ"', () => {
    const ticket = { status: 'DOING', creator: 'nv2', approvalStatus: null };
    recordActions.escalateItTicket(ADMIN, ticket, { reason: 'Cần ý kiến trước khi xử lý', approverUsername: 'nv1' }, [OTHER_APPROVER, { username: 'nv2', name: 'NV 2', active: true }]);
    const updated = recordActions.approveItTicketEscalation(OTHER_ADMIN, ticket);
    assert.strictEqual(updated.approvalStatus, 'APPROVED');
  });

  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
