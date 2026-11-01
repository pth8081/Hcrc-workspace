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

  // 11/2026: resolvePendingTaskAction() đã bỏ hẳn `|| user.perms?.admin` ở CỔNG QUYỀN (chỉ đúng
  // task.assignedBy mới quyết định được) — OTHER_ADMIN không phải assignedBy của task (admin1 mới là)
  // nên KHÔNG còn tự động duyệt được nữa, dù "là admin khác". Dựng thêm 1 task riêng với assignedBy
  // THẬT là OTHER_ADMIN để chứng minh người ĐÚNG VỊ TRÍ vẫn duyệt được bình thường.
  await test('11/2026: admin KHÁC (không phải assignedBy) KHÔNG còn tự động duyệt được gia hạn (đã bỏ admin-bypass)', () => {
    const task = { assignedTo: 'admin1', assignedBy: 'admin1', status: 'DOING', deadline: '2026-01-10', history: [] };
    recordActions.requestExtension({ newDeadline: '2026-01-20', reason: 'Cần thêm thời gian' }, ADMIN, task);
    assert.throws(
      () => recordActions.resolvePendingTaskAction('extension', 'approve', OTHER_ADMIN, task),
      /Chỉ người giao việc/i
    );
  });

  await test('đối chứng: ĐÚNG người giao việc (assignedBy, kể cả là admin) vẫn duyệt được gia hạn do người khác gửi bình thường', () => {
    const task = { assignedTo: 'nv1', assignedBy: 'admin2', status: 'DOING', deadline: '2026-01-10', history: [] };
    recordActions.requestExtension({ newDeadline: '2026-01-20', reason: 'Cần thêm thời gian' }, OTHER_APPROVER, task);
    const updated = recordActions.resolvePendingTaskAction('extension', 'approve', OTHER_ADMIN, task);
    assert.strictEqual(updated.deadline, '2026-01-20');
    assert.strictEqual(updated.pendingExtension, null);
  });

  await test('LỖI ĐÃ VÁ: resolvePendingTaskAction("cancellation") — admin là chính người giao việc VÀ chính người đã gửi yêu cầu huỷ RỒI tự duyệt -> bị chặn 403', () => {
    // assignedBy = admin1 (chính ADMIN) để test ĐÚNG nhánh tự duyệt — assignedBy khác đi thì admin đã bị
    // chặn ở CỔNG QUYỀN (chỉ assignedBy mới quyết định được) trước khi tới được nhánh tự duyệt này.
    const task = {
      assignedTo: 'nv1', assignedBy: 'admin1', status: 'DOING', history: [],
      pendingCancellation: { reason: 'Không còn cần thiết', requestedBy: 'admin1', requestedByName: 'Admin 1', requestedAt: '2026-01-01' }
    };
    assert.throws(
      () => recordActions.resolvePendingTaskAction('cancellation', 'approve', ADMIN, task),
      /không thể tự duyệt.*chính mình/i
    );
  });

  // ===== Phần 2: Hỗ Trợ IT — Leo Thang Phê Duyệt =====

  await test('LỖI ĐÃ VÁ: admin tự escalateItTicket() tới chính mình (approverUsername = chính mình) RỒI tự approveItTicketEscalation() -> bị chặn 403', () => {
    // escalateItTicket() đã tự chặn chọn approver = chính người leo thang (xem test khác) — ở đây dựng
    // THẲNG ticket với approvalApprover = chính ADMIN để test ĐÚNG nhánh tự duyệt của
    // assertNotSelfDecidingItTicketEscalation(), không đi qua escalateItTicket().
    const ticket = { status: 'DOING', creator: 'nv2', approvalStatus: 'PENDING', escalatedBy: 'admin1', approvalApprover: 'admin1' };
    assert.throws(
      () => recordActions.approveItTicketEscalation(ADMIN, ticket),
      /không thể tự duyệt.*chính mình/i
    );
  });

  await test('LỖI ĐÃ VÁ: admin tự escalateItTicket() tới chính mình RỒI tự denyItTicketEscalation() -> bị chặn 403', () => {
    const ticket = { status: 'DOING', creator: 'nv2', approvalStatus: 'PENDING', escalatedBy: 'admin1', approvalApprover: 'admin1' };
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

  // 11/2026 (quyết định của người dùng): đã bỏ HẲN "lối thoát" admin-bypass ở approve/denyItTicketEscalation
  // — admin KHÁC (không phải ticket.approvalApprover được chỉ định) KHÔNG còn duyệt hộ được nữa. Muốn gỡ
  // kẹt (approver gốc nghỉ/khoá tài khoản) thì đổi approvalApprover của ticket, không dùng cờ admin chung.
  await test('11/2026: admin KHÁC (không phải approvalApprover được chỉ định) KHÔNG còn duyệt hộ được nữa (đã bỏ "lối thoát" admin-bypass)', () => {
    const ticket = { status: 'DOING', creator: 'nv2', approvalStatus: null };
    recordActions.escalateItTicket(ADMIN, ticket, { reason: 'Cần ý kiến trước khi xử lý', approverUsername: 'nv1' }, [OTHER_APPROVER, { username: 'nv2', name: 'NV 2', active: true }]);
    assert.throws(
      () => recordActions.approveItTicketEscalation(OTHER_ADMIN, ticket),
      /không phải người được yêu cầu/i
    );
  });

  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
