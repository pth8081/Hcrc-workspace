// server/tests/test-hr-lifecycle.js
//
// Regression test cho "Nhân Sự > Onboarding / Offboarding" v2 — mô hình quy trình có checklist theo
// giai đoạn (collection DUY NHẤT DB.hrProcesses, mỗi bản ghi tự chứa tasks[]/attachments[]/history[],
// checklist tự sinh từ danh mục admin-config DB.hrTaskTemplates lúc tạo — xem lib/createValidation.js/
// lib/recordActions.js/lib/recordViewScope.js). Thay hẳn bản v1 (2 collection hrOnboardingRequests/
// hrOffboardingRequests, "1 yêu cầu = 1 ticket Hỗ Trợ IT") — mirror ĐÚNG khuôn cầu nối Hỗ Trợ IT cũ
// nhưng chuyển sang "1 task nhãn IT = 1 ticket tuỳ chọn" (createItTicketForHrTask()/
// applyItTicketCompletionToHrProcessTask()) — KHÔNG BAO GIỜ tự tạo/khoá DB.users, IT vẫn tự tay xử lý
// NGOÀI hệ thống này rồi xác nhận hoàn thành ngược lại đây.
//
// Quyền tạo/quản lý quy trình: hrOnboardingManage/hrOffboardingManage (theo đúng processType) hoặc
// admin — TÁCH RIÊNG khỏi hrTaskTemplateManage (chỉ quản lý danh mục checklist chuẩn) và hrViewAll (chỉ
// xem toàn bộ, không được thao tác).
//
// Dùng chung testHarness.js (mirror ĐÚNG lib/createValidation.js/lib/recordActions.js/
// lib/recordViewScope.js thật, không tự đoán lại luật nghiệp vụ) — cùng khuôn test-hr-feedback.js.
//
// Chạy: node server/tests/test-hr-lifecycle.js
const {
  startStaticServer, createMockState, createDispatcher, launchPage, createRunner,
  assert, assertEqual, assertIncludes
} = require('./testHarness');

const PORT = 8987;

const HR1 = { username: 'hr1', name: 'Chuyên Viên Nhân Sự', dept: 'Phòng Nhân Sự', perms: { hrOnboardingManage: true, hrOffboardingManage: true }, active: true };
// Cùng phòng Nhân Sự nhưng KHÔNG có quyền quản lý -> dùng để kiểm tra gác quyền phía SERVER (không chỉ ẩn ở UI).
const HR_NOPERM = { username: 'hr2', name: 'Nhân Viên Nhân Sự Khác', dept: 'Phòng Nhân Sự', perms: {}, active: true };
// hrViewAll: true — chỉ được XEM toàn bộ quy trình để theo dõi tiến độ, KHÔNG được thao tác task/huỷ quy trình.
const HR_VIEWER = { username: 'hr.viewer', name: 'Trưởng Phòng Nhân Sự (chỉ xem)', dept: 'Phòng Nhân Sự', perms: { hrViewAll: true }, active: true };
// hrTaskTemplateManage: true — chỉ được sửa danh mục checklist chuẩn, KHÔNG được tạo/quản lý quy trình.
const HR_TEMPLATE_ADMIN = { username: 'hr.tpl', name: 'Quản Lý Checklist Mẫu', dept: 'Phòng Nhân Sự', perms: { hrTaskTemplateManage: true }, active: true };
const IT1 = { username: 'it1', name: 'Nhân Viên IT', dept: 'Phòng CNTT', perms: { itManage: true }, active: true };
const FIN1 = { username: 'fin1', name: 'Nhân Viên Tài Chính', dept: 'Phòng Kế Toán', perms: { paymentManage: true }, active: true };
// Trưởng phòng làm "Quản lý trực tiếp" cho EMP — không có bất kỳ quyền phẳng nào khác.
const MANAGER1 = { username: 'mgr1', name: 'Trưởng Phòng Kế Toán', dept: 'Phòng Kế Toán', perms: {}, active: true };
// Nhân viên ĐANG active — nguồn tra cứu cho Offboarding (employeeUsername).
const EMP = { username: 'nv.ketoan', name: 'Nguyễn Văn Kế Toán', dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên', email: 'ketoan@company.com', perms: {}, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };
// Đợt 4 (vá gap #1 Phần B, mục A.6 tài liệu thiết kế) — SUP_MGR đang là managerUsername của SUP_REPORT
// (còn active) -> Offboarding của SUP_MGR phải bị chặn tự động Hoàn Tất cho tới khi chỉ định người kế
// nhiệm. SUP_SUCCESSOR dùng làm người kế nhiệm hợp lệ.
const SUP_MGR = { username: 'nv.suptruong', name: 'Nguyễn Văn Trưởng Nhóm', dept: 'Phòng Kế Toán', jobTitle: 'Chuyên viên', email: 'suptruong@company.com', perms: {}, active: true };
const SUP_REPORT = { username: 'nv.baocao', name: 'Trần Thị Báo Cáo', dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên', perms: {}, active: true, managerUsername: 'nv.suptruong' };
const SUP_SUCCESSOR = { username: 'nv.kenhiem', name: 'Lê Văn Kế Nhiệm', dept: 'Phòng Kế Toán', jobTitle: 'Chuyên viên', perms: {}, active: true };

// Danh mục checklist chuẩn tối giản — 1 việc/giai đoạn/loại, đủ để kiểm tra auto-generate + due-date +
// department gating + auto-progress qua từng giai đoạn mà không cần chép lại nguyên 28 dòng defaults.js.
const ONB_TEMPLATES = [
  { id: 1, processType: 'ONBOARDING', stage: 'PRE_BOARDING', taskName: 'Chuẩn bị máy tính', department: 'IT', dueDaysOffset: -3, isRequired: true, displayOrder: 1, isActive: true },
  { id: 2, processType: 'ONBOARDING', stage: 'FIRST_DAY', taskName: 'Ký hợp đồng lao động', department: 'HR', dueDaysOffset: 0, isRequired: true, displayOrder: 2, isActive: true },
  { id: 3, processType: 'ONBOARDING', stage: 'FIRST_DAY', taskName: 'Giới thiệu quản lý trực tiếp', department: 'MANAGER', dueDaysOffset: 0, isRequired: false, displayOrder: 3, isActive: true },
  { id: 4, processType: 'ONBOARDING', stage: 'TRAINING', taskName: 'Đào tạo hội nhập', department: 'HR', dueDaysOffset: 7, isRequired: true, displayOrder: 4, isActive: true },
  { id: 5, processType: 'ONBOARDING', stage: 'PROBATION_REVIEW', taskName: 'Đánh giá kết thúc thử việc', department: 'MANAGER', dueDaysOffset: 60, isRequired: true, displayOrder: 5, isActive: true },
  // isActive=false — KHÔNG được sinh vào tasks[] của bất kỳ quy trình mới nào.
  { id: 6, processType: 'ONBOARDING', stage: 'FIRST_DAY', taskName: 'Việc đã tắt trong danh mục', department: 'HR', dueDaysOffset: 0, isRequired: true, displayOrder: 6, isActive: false }
];
const OFFB_TEMPLATES = [
  { id: 7, processType: 'OFFBOARDING', stage: 'NOTICE', taskName: 'Thông báo cho phòng ban', department: 'HR', dueDaysOffset: 0, isRequired: true, displayOrder: 1, isActive: true },
  { id: 8, processType: 'OFFBOARDING', stage: 'HANDOVER', taskName: 'Bàn giao công việc', department: 'MANAGER', dueDaysOffset: -2, isRequired: true, displayOrder: 2, isActive: true },
  { id: 9, processType: 'OFFBOARDING', stage: 'ASSET_REVOKE', taskName: 'Thu hồi thiết bị + khoá tài khoản', department: 'IT', dueDaysOffset: 0, isRequired: true, displayOrder: 3, isActive: true },
  { id: 10, processType: 'OFFBOARDING', stage: 'SETTLEMENT', taskName: 'Quyết toán lương/BHXH', department: 'FINANCE', dueDaysOffset: 5, isRequired: true, displayOrder: 4, isActive: true },
  { id: 11, processType: 'OFFBOARDING', stage: 'EXIT_INTERVIEW', taskName: 'Phỏng vấn nghỉ việc', department: 'HR', dueDaysOffset: 3, isRequired: false, displayOrder: 5, isActive: true }
];

const state = createMockState({
  depts: ['Phòng Nhân Sự', 'Phòng CNTT', 'Phòng Kế Toán', 'Ban Giám Đốc'],
  stores: ['Siêu Thị A'],
  jobTitles: ['Nhân viên', 'Chuyên viên'],
  storeJobTitles: [{ label: 'Nhân viên bán hàng' }],
  users: [HR1, HR_NOPERM, HR_VIEWER, HR_TEMPLATE_ADMIN, IT1, FIN1, MANAGER1, EMP, ADMIN, SUP_MGR, SUP_REPORT, SUP_SUCCESSOR],
  hrTaskTemplates: [...ONB_TEMPLATES, ...OFFB_TEMPLATES]
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => {
    window.__resetCapture();
    await proceedAfterAuth(u);
  }, user);
}

function onboardHoPayload(overrides) {
  return Object.assign({
    processType: 'ONBOARDING',
    employeeCode: 'NV0001', fullName: 'Trần Văn Mới',
    employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Nhân viên',
    email: '', phone: '0912345678', startDate: '2026-09-15', directManagerUsername: 'mgr1', note: ''
  }, overrides || {});
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const directDispatch = createDispatcher(state); // đọc lại GET /api/data theo ĐÚNG view-scope của 1 user cụ thể, không cần đổi currentUser của trang.

  let onboardId = null, offboardId = null, itTaskId = null, itTicketId = null;

  try {
    // ===================== TẠO QUY TRÌNH — ONBOARDING =====================

    await run.run('Không có hrOnboardingManage -> tạo quy trình Onboarding bị chặn ở SERVER (403)', async () => {
      await loginAs(page, HR_NOPERM);
      const err = await page.evaluate(async (payload) => {
        try { await callCreateAction('hrProcesses', payload); return null; }
        catch (e) { return e.message; }
      }, onboardHoPayload());
      assertIncludes(err, 'không có quyền tạo quy trình Onboarding', 'Phải báo đúng lỗi thiếu quyền');
    });

    await run.run('hrViewAll (chỉ xem) -> vẫn KHÔNG tạo được quy trình (view-only, không phải quản lý)', async () => {
      await loginAs(page, HR_VIEWER);
      const err = await page.evaluate(async (payload) => {
        try { await callCreateAction('hrProcesses', payload); return null; }
        catch (e) { return e.message; }
      }, onboardHoPayload());
      assertIncludes(err, 'không có quyền tạo quy trình Onboarding', 'hrViewAll không phải quyền quản lý -> vẫn phải bị chặn');
      await loginAs(page, HR1);
    });

    await run.run('Onboarding STORE thiếu Email -> 400 (bắt buộc với nhân viên Siêu Thị)', async () => {
      const err = await page.evaluate(async (payload) => {
        try { await callCreateAction('hrProcesses', payload); return null; }
        catch (e) { return e.message; }
      }, onboardHoPayload({ employeePosType: 'STORE', employeeDept: 'Siêu Thị A', employeeJobTitle: 'Nhân viên bán hàng', email: '' }));
      assertIncludes(err, 'bắt buộc phải nhập Email', 'Phải chặn thiếu email cho nhân viên Siêu Thị');
    });

    await run.run('Onboarding HO -> tạo thành công, tự sinh đúng 5 task ĐANG BẬT (bỏ qua task isActive=false), đúng dueDate/department/stage, giai đoạn đầu = PRE_BOARDING', async () => {
      const item = await page.evaluate(async (payload) => (await callCreateAction('hrProcesses', payload)).item, onboardHoPayload());
      onboardId = item.id;
      assertEqual(item.status, 'IN_PROGRESS', 'Trạng thái khởi tạo phải là IN_PROGRESS');
      assertEqual(item.stage, 'PRE_BOARDING', 'Giai đoạn khởi tạo phải là PRE_BOARDING (giai đoạn đầu tiên)');
      assertEqual(item.creator, HR1.username, 'creator phải là người vừa tạo (HR1)');
      assertEqual(item.directManagerUsername, MANAGER1.username, 'directManagerUsername phải khớp người được chọn làm Quản lý trực tiếp');
      assertEqual(item.tasks.length, 5, 'Chỉ 5 task ĐANG BẬT (isActive!==false) được sinh ra, bỏ qua task đã tắt trong danh mục');
      assert(!item.tasks.some(t => t.taskName === 'Việc đã tắt trong danh mục'), 'Task đã tắt (isActive:false) KHÔNG được xuất hiện trong checklist');
      const itTask = item.tasks.find(t => t.taskName === 'Chuẩn bị máy tính');
      assertEqual(itTask.department, 'IT', 'department phải khớp đúng danh mục');
      assertEqual(itTask.dueDate, '2026-09-12', 'dueDate = startDate + dueDaysOffset (-3 ngày) phải đúng');
      assertEqual(itTask.status, 'PENDING', 'Task mới sinh phải ở trạng thái PENDING');
      itTaskId = itTask.taskId;
    });

    // ===================== TẠO QUY TRÌNH — OFFBOARDING =====================

    await run.run('Offboarding: tên đăng nhập không tồn tại -> 400', async () => {
      const err = await page.evaluate(async () => {
        try { await callCreateAction('hrProcesses', { processType: 'OFFBOARDING', employeeUsername: 'khong-ton-tai', lastWorkingDate: '2026-09-30' }); return null; }
        catch (e) { return e.message; }
      });
      assertIncludes(err, 'Không tìm thấy tài khoản nhân viên này', 'Phải báo lỗi không tìm thấy tài khoản');
    });

    await run.run('Offboarding: thiếu Ngày nghỉ việc -> 400', async () => {
      const err = await page.evaluate(async () => {
        try { await callCreateAction('hrProcesses', { processType: 'OFFBOARDING', employeeUsername: 'nv.ketoan' }); return null; }
        catch (e) { return e.message; }
      });
      assertIncludes(err, 'Ngày nghỉ việc', 'Phải chặn thiếu Ngày nghỉ việc');
    });

    await run.run('Offboarding: đủ điều kiện -> tạo thành công, snapshot đúng tên/dept/chức danh/email từ DB.users, tự sinh đúng 5 task theo lastWorkingDate làm mốc', async () => {
      const item = await page.evaluate(async () => (await callCreateAction('hrProcesses', {
        processType: 'OFFBOARDING', employeeUsername: 'nv.ketoan', lastWorkingDate: '2026-09-30', reason: 'Nghỉ việc theo nguyện vọng cá nhân'
      })).item);
      offboardId = item.id;
      assertEqual(item.status, 'IN_PROGRESS', 'Trạng thái khởi tạo phải là IN_PROGRESS');
      assertEqual(item.stage, 'NOTICE', 'Giai đoạn khởi tạo phải là NOTICE (giai đoạn đầu tiên)');
      assertEqual(item.fullName, EMP.name, 'Phải snapshot đúng tên nhân viên');
      assertEqual(item.employeeDept, EMP.dept, 'Phải snapshot đúng phòng ban nhân viên');
      assertEqual(item.employeeJobTitle, EMP.jobTitle, 'Phải snapshot đúng chức danh nhân viên');
      assertEqual(item.email, EMP.email, 'Phải snapshot đúng email nhân viên');
      assertEqual(item.tasks.length, 5, 'Phải sinh đúng 5 task OFFBOARDING đang bật');
      const financeTask = item.tasks.find(t => t.taskName === 'Quyết toán lương/BHXH');
      assertEqual(financeTask.dueDate, '2026-10-05', 'dueDate = lastWorkingDate + 5 ngày phải đúng');
    });

    // ===================== THAO TÁC TASK — GÁC QUYỀN THEO NHÃN PHÒNG BAN =====================

    await run.run('Task nhãn IT: người KHÔNG có itManage/không được giao riêng -> KHÔNG hoàn thành được (403, chặn ở SERVER)', async () => {
      await loginAs(page, HR1);
      const err = await page.evaluate(async (args) => {
        try { await callRecordAction('hrProcesses', args.id, 'complete-task', { taskId: args.taskId }); return null; }
        catch (e) { return e.message; }
      }, { id: onboardId, taskId: itTaskId });
      assertIncludes(err, 'không có quyền hoàn thành việc này', 'HR1 (hrOnboardingManage, không phải itManage) không được tự hoàn thành task nhãn IT');
    });

    await run.run('Task nhãn IT: người có itManage -> hoàn thành được, tiến độ được tính lại', async () => {
      await loginAs(page, IT1);
      const result = await page.evaluate(async (args) => await callRecordAction('hrProcesses', args.id, 'complete-task', { taskId: args.taskId }), { id: onboardId, taskId: itTaskId });
      const task = result.item.tasks.find(t => t.taskId === itTaskId);
      assertEqual(task.status, 'DONE', 'Task phải chuyển DONE');
      assertEqual(task.completedBy, IT1.username, 'completedBy phải đúng người IT vừa xác nhận');
      await loginAs(page, HR1);
    });

    await run.run('Hoàn thành lại task đã DONE -> 409', async () => {
      const err = await page.evaluate(async (args) => {
        try { await callRecordAction('hrProcesses', args.id, 'complete-task', { taskId: args.taskId }); return null; }
        catch (e) { return e.message; }
      }, { id: onboardId, taskId: itTaskId });
      assertIncludes(err, 'đã được đánh dấu hoàn thành rồi', 'Phải chặn hoàn thành trùng');
    });

    await run.run('Bỏ qua task BẮT BUỘC nhãn IT: IT1 (canActOnHrTask=true qua itManage nhưng KHÔNG quản lý quy trình) -> 403; HR1 (quản lý quy trình NHƯNG không có itManage -> canActOnHrTask=false) -> CŨNG 403; chỉ admin (cả 2 điều kiện đều bypass) mới bỏ qua được', async () => {
      // Tạo thêm quy trình Onboarding riêng để test nhánh "Chuẩn bị máy tính" (nhãn IT, bắt buộc) còn nguyên PENDING.
      const item2 = await page.evaluate(async (payload) => (await callCreateAction('hrProcesses', payload)).item,
        onboardHoPayload({ employeeCode: 'NV0002', fullName: 'Lê Thị Hai' }));
      const itTask2 = item2.tasks.find(t => t.taskName === 'Chuẩn bị máy tính');
      await loginAs(page, IT1);
      const errIt = await page.evaluate(async (args) => {
        try { await callRecordAction('hrProcesses', args.id, 'skip-task', { taskId: args.taskId, reason: 'Chưa cần' }); return null; }
        catch (e) { return e.message; }
      }, { id: item2.id, taskId: itTask2.taskId });
      assertIncludes(errIt, 'Chỉ người quản lý quy trình', 'IT1 có itManage (canActOnHrTask=true) nhưng KHÔNG quản lý quy trình -> không được tự ý bỏ qua task bắt buộc của chính mình');
      await loginAs(page, HR1);
      const errHr = await page.evaluate(async (args) => {
        try { await callRecordAction('hrProcesses', args.id, 'skip-task', { taskId: args.taskId, reason: 'Đã có sẵn máy từ đợt trước' }); return null; }
        catch (e) { return e.message; }
      }, { id: item2.id, taskId: itTask2.taskId });
      assertIncludes(errHr, 'không có quyền bỏ qua việc này', 'HR1 quản lý quy trình (qua creator) NHƯNG không có itManage -> canActOnHrTask false -> vẫn KHÔNG bỏ qua được task nhãn IT (2 lớp quyền độc lập: quản lý quy trình + thao tác đúng nhãn)');
      await loginAs(page, ADMIN);
      const result = await page.evaluate(async (args) => await callRecordAction('hrProcesses', args.id, 'skip-task', { taskId: args.taskId, reason: 'Đã có sẵn máy từ đợt trước' }), { id: item2.id, taskId: itTask2.taskId });
      const skipped = result.item.tasks.find(t => t.taskId === itTask2.taskId);
      assertEqual(skipped.status, 'SKIPPED', 'admin bypass cả canManageHrProcess lẫn canActOnHrTask -> phải bỏ qua được');
      assertEqual(skipped.note, 'Đã có sẵn máy từ đợt trước', 'note phải khớp đúng lý do bỏ qua vừa nhập');
      await loginAs(page, HR1);
    });

    await run.run('Bỏ qua task: thiếu lý do -> 400', async () => {
      const item2 = await page.evaluate(async (payload) => (await callCreateAction('hrProcesses', payload)).item,
        onboardHoPayload({ employeeCode: 'NV0003', fullName: 'Phạm Văn Ba' }));
      const hrTask = item2.tasks.find(t => t.taskName === 'Đào tạo hội nhập');
      const err = await page.evaluate(async (args) => {
        try { await callRecordAction('hrProcesses', args.id, 'skip-task', { taskId: args.taskId, reason: '' }); return null; }
        catch (e) { return e.message; }
      }, { id: item2.id, taskId: hrTask.taskId });
      assertIncludes(err, 'Vui lòng nhập lý do bỏ qua', 'Phải bắt buộc lý do khi bỏ qua');
    });

    await run.run('Task nhãn MANAGER: giao riêng cho người khác (assignedToUsername) -> chỉ đúng người đó thao tác được, quản lý trực tiếp gốc KHÔNG còn quyền', async () => {
      const reassignResult = await page.evaluate(async (args) => await callRecordAction('hrProcesses', args.id, 'reassign-task', { taskId: args.taskId, assignedToUsername: 'it1' }),
        { id: onboardId, taskId: (await page.evaluate((id) => DB.hrProcesses.find(p => p.id === id).tasks.find(t => t.taskName === 'Giới thiệu quản lý trực tiếp').taskId, onboardId)) });
      const reassignedTask = reassignResult.item.tasks.find(t => t.taskName === 'Giới thiệu quản lý trực tiếp');
      assertEqual(reassignedTask.assignedToUsername, 'it1', 'Task phải được giao đúng cho it1');
      await loginAs(page, IT1);
      const doneResult = await page.evaluate(async (args) => await callRecordAction('hrProcesses', args.id, 'complete-task', { taskId: args.taskId }), { id: onboardId, taskId: reassignedTask.taskId });
      assertEqual(doneResult.item.tasks.find(t => t.taskId === reassignedTask.taskId).status, 'DONE', 'it1 được giao riêng -> phải hoàn thành được dù không phải nhãn IT');
      await loginAs(page, HR1);
    });

    await run.run('Giao lại task: người KHÔNG quản lý quy trình (không phải creator/hrOnboardingManage/admin) -> 403', async () => {
      await loginAs(page, IT1);
      const err = await page.evaluate(async (args) => {
        try { await callRecordAction('hrProcesses', args.id, 'reassign-task', { taskId: args.taskId, assignedToUsername: 'fin1' }); return null; }
        catch (e) { return e.message; }
      }, { id: onboardId, taskId: itTaskId });
      assertIncludes(err, 'không có quyền giao việc trong quy trình này', 'IT1 không quản lý quy trình -> không được giao lại task');
      await loginAs(page, HR1);
    });

    // ===================== TÍCH HỢP HỖ TRỢ IT (1 task IT = 1 ticket tuỳ chọn) =====================

    await run.run('"Tạo Ticket IT" cho task nhãn IT (Offboarding) -> sinh đúng 1 ticket itSupportTickets, sourceType=HR_PROCESS_TASK, sourceTaskId khớp đúng task', async () => {
      await loginAs(page, IT1);
      const offItem = await page.evaluate((id) => DB.hrProcesses.find(p => p.id === id), offboardId);
      const itOffTask = offItem.tasks.find(t => t.taskName === 'Thu hồi thiết bị + khoá tài khoản');
      const result = await page.evaluate(async (args) => await callRecordAction('hrProcesses', args.id, 'create-it-ticket', { taskId: args.taskId }), { id: offboardId, taskId: itOffTask.taskId });
      assertEqual(result.item.tasks.find(t => t.taskId === itOffTask.taskId).linkedTicketId, result.ticket.id, 'task.linkedTicketId phải khớp id ticket vừa tạo');
      assertEqual(result.ticket.category, 'ACCOUNT', 'Ticket phải thuộc danh mục "Tài khoản / Đăng nhập"');
      assertEqual(result.ticket.sourceType, 'HR_PROCESS_TASK', 'sourceType phải là HR_PROCESS_TASK');
      assertEqual(result.ticket.sourceId, offboardId, 'sourceId phải trỏ đúng về quy trình Offboarding');
      assertEqual(result.ticket.sourceTaskId, itOffTask.taskId, 'sourceTaskId phải trỏ đúng về task vừa tạo ticket (phân biệt với các task khác cùng quy trình)');
      assertEqual(result.ticket.status, 'TODO', 'Ticket mới sinh phải ở trạng thái TODO');
      itTicketId = result.ticket.id;
    });

    await run.run('Tạo ticket lần 2 cho task đã có ticket -> 409 (chặn tạo trùng)', async () => {
      const offItem = await page.evaluate((id) => DB.hrProcesses.find(p => p.id === id), offboardId);
      const itOffTask = offItem.tasks.find(t => t.taskName === 'Thu hồi thiết bị + khoá tài khoản');
      const err = await page.evaluate(async (args) => {
        try { await callRecordAction('hrProcesses', args.id, 'create-it-ticket', { taskId: args.taskId }); return null; }
        catch (e) { return e.message; }
      }, { id: offboardId, taskId: itOffTask.taskId });
      assertIncludes(err, 'đã có ticket Hỗ Trợ IT liên kết rồi', 'Phải chặn tạo ticket trùng cho cùng 1 task');
    });

    await run.run('IT xác nhận "Hoàn thành" ticket -> ghi ngược DONE + completedBy/completedAt vào ĐÚNG task đã sinh ra ticket, KHÔNG đụng DB.users, các task KHÁC trong cùng quy trình không bị ảnh hưởng', async () => {
      const usersSnapshotBefore = JSON.stringify(state.users);
      await page.evaluate(async (id) => { await callRecordAction('itSupportTickets', id, 'claim', {}); }, itTicketId);
      const ticketResult = await page.evaluate(async (id) => await callRecordAction('itSupportTickets', id, 'update-status', { status: 'DONE', resolutionNote: 'Đã thu hồi laptop + khoá AD' }), itTicketId);
      assertEqual(ticketResult.item.status, 'DONE', 'Ticket phải chuyển DONE');

      const linked = state.hrProcesses.find(p => p.id === offboardId);
      const linkedTask = linked.tasks.find(t => t.linkedTicketId === itTicketId);
      assertEqual(linkedTask.status, 'DONE', 'Task liên kết ticket phải tự chuyển DONE khi ticket DONE');
      assertEqual(linkedTask.completedBy, IT1.username, 'completedBy phải là người IT vừa xác nhận ticket');
      assert(!!linkedTask.completedAt, 'completedAt phải được gán');
      assertEqual(linkedTask.note, 'Đã thu hồi laptop + khoá AD', 'note của task phải khớp resolutionNote IT vừa nhập');
      const otherTask = linked.tasks.find(t => t.taskName === 'Bàn giao công việc');
      assertEqual(otherTask.status, 'PENDING', 'Task KHÁC trong cùng quy trình (không liên quan ticket này) phải giữ nguyên PENDING');

      const usersSnapshotAfter = JSON.stringify(state.users);
      assertEqual(usersSnapshotAfter, usersSnapshotBefore, 'TUYỆT ĐỐI KHÔNG được đụng tới DB.users khi ghi ngược kết quả IT — IT vẫn tự tay cấp/khoá tài khoản NGOÀI hệ thống này');
      await loginAs(page, HR1);
    });

    // ===================== TỰ ĐỘNG HOÀN TẤT QUY TRÌNH =====================

    await run.run('Hoàn thành/bỏ qua HẾT task BẮT BUỘC của quy trình Onboarding -> quy trình tự chuyển COMPLETED', async () => {
      const item = await page.evaluate((id) => DB.hrProcesses.find(p => p.id === id), onboardId);
      const remaining = item.tasks.filter(t => t.status === 'PENDING');
      for (const t of remaining) {
        if (t.department === 'IT' || t.assignedToUsername === 'it1') { await loginAs(page, IT1); }
        else if (t.department === 'FINANCE') { await loginAs(page, FIN1); }
        else if (t.department === 'MANAGER' && !t.assignedToUsername) { await loginAs(page, MANAGER1); }
        else { await loginAs(page, HR1); }
        await page.evaluate(async (args) => await callRecordAction('hrProcesses', args.id, 'complete-task', { taskId: args.taskId }), { id: onboardId, taskId: t.taskId });
      }
      await loginAs(page, HR1);
      const finalItem = await page.evaluate((id) => DB.hrProcesses.find(p => p.id === id), onboardId);
      assertEqual(finalItem.status, 'COMPLETED', 'Quy trình phải tự chuyển COMPLETED khi mọi task bắt buộc đã DONE');
      assertEqual(finalItem.stage, 'PROBATION_REVIEW', 'Giai đoạn cuối phải là giai đoạn cuối cùng (PROBATION_REVIEW)');
      assert(!!finalItem.actualEndDate, 'actualEndDate phải được gán khi tự động hoàn tất');
    });

    await run.run('Quy trình đã COMPLETED -> không huỷ được nữa (409, KHÔNG còn ở trạng thái đang thực hiện)', async () => {
      const err = await page.evaluate(async (id) => {
        try { await callRecordAction('hrProcesses', id, 'cancel', { reason: 'thử huỷ' }); return null; }
        catch (e) { return e.message; }
      }, onboardId);
      assertIncludes(err, 'không còn ở trạng thái đang thực hiện', 'Không được huỷ quy trình đã COMPLETED');
    });

    // ===================== HUỶ QUY TRÌNH =====================

    await run.run('Huỷ quy trình: thiếu lý do -> 400; đủ lý do -> chuyển CANCELLED', async () => {
      const item3 = await page.evaluate(async (payload) => (await callCreateAction('hrProcesses', payload)).item,
        onboardHoPayload({ employeeCode: 'NV0004', fullName: 'Đỗ Văn Tư' }));
      const err = await page.evaluate(async (id) => {
        try { await callRecordAction('hrProcesses', id, 'cancel', { reason: '' }); return null; }
        catch (e) { return e.message; }
      }, item3.id);
      assertIncludes(err, 'Vui lòng nhập lý do huỷ', 'Phải bắt buộc lý do khi huỷ');
      const result = await page.evaluate(async (id) => await callRecordAction('hrProcesses', id, 'cancel', { reason: 'Ứng viên từ chối nhận việc' }), item3.id);
      assertEqual(result.item.status, 'CANCELLED', 'Quy trình phải chuyển CANCELLED');
      assertEqual(result.item.cancelReason, 'Ứng viên từ chối nhận việc', 'cancelReason phải khớp đúng lý do vừa nhập');
    });

    // ===================== VIEW-SCOPE (server-side) =====================

    await run.run('Người KHÔNG liên quan (không phải creator/quản lý/quản lý trực tiếp/được giao task) KHÔNG xem được quy trình của người khác; hrViewAll xem được TOÀN BỘ', async () => {
      const res = await directDispatch('GET', '/api/data', null, HR_NOPERM.username);
      const seen = (res.body.hrProcesses || []).some(q => q.id === offboardId);
      assert(!seen, 'HR_NOPERM không liên quan -> không được thấy hồ sơ Offboarding này');
      const resViewer = await directDispatch('GET', '/api/data', null, HR_VIEWER.username);
      const seenByViewer = (resViewer.body.hrProcesses || []).some(q => q.id === offboardId);
      assert(seenByViewer, 'hrViewAll phải xem được TOÀN BỘ quy trình để theo dõi tiến độ, kể cả không phải người tạo');
      const resMgr = await directDispatch('GET', '/api/data', null, MANAGER1.username);
      const seenByMgr = (resMgr.body.hrProcesses || []).some(q => q.id === offboardId);
      assert(!seenByMgr, 'MANAGER1 không phải directManager/creator của hồ sơ Offboarding này -> không được thấy');
      const seenByMgrOwn = (resMgr.body.hrProcesses || []).some(q => q.id === onboardId);
      assert(seenByMgrOwn, 'MANAGER1 LÀ directManagerUsername của hồ sơ Onboarding onboardId -> phải được thấy');
    });

    // ===================== Đợt 4 (vá gap #1 Phần B, mục A.6 tài liệu thiết kế) — chặn Offboarding tự
    // Hoàn Tất khi thiếu người kế nhiệm, cho quản lý còn người báo cáo trực tiếp =====================

    let supOffboardId = null;
    // callCreateAction/callRecordAction KHÔNG tự cập nhật cache window.DB phía client (chỉ trả thẳng
    // {ok,item} từ server — DB chỉ được nạp lại mỗi khi loginAs()/proceedAfterAuth() chạy) -> lưu sẵn
    // taskId từ ngay kết quả tạo mới, KHÔNG dò lại qua DB.hrProcesses.find() giữa các bước (sẽ undefined).
    const supTaskId = {};

    await run.run('Offboarding SUP_MGR (đang là managerUsername của SUP_REPORT) -> tạo thành công, chưa có người kế nhiệm', async () => {
      const item = await page.evaluate(async () => (await callCreateAction('hrProcesses', {
        processType: 'OFFBOARDING', employeeUsername: 'nv.suptruong', lastWorkingDate: '2026-10-15', reason: 'Chuyển công tác',
        isManagerialPosition: true, directManagerUsername: 'mgr1'
      })).item);
      supOffboardId = item.id;
      item.tasks.forEach(t => { supTaskId[t.taskName] = t.taskId; });
      assertEqual(item.successorUsername, null, 'successorUsername phải rỗng lúc mới tạo (chọn ở bước Bàn Giao, không phải lúc tạo)');
      assert(!item.pendingSuccessor, 'pendingSuccessor chưa được tính lúc mới tạo (computeHrProcessProgress() chỉ chạy sau mỗi lần đổi trạng thái task, không chạy lúc tạo) -> phải falsy, không phải true');
    });

    await run.run('Hoàn thành/bỏ qua HẾT task bắt buộc của Offboarding SUP_MGR -> KHÔNG tự chuyển COMPLETED vì còn thiếu người kế nhiệm (pendingSuccessor=true)', async () => {
      // Task nhãn MANAGER chỉ canActOnHrTask được qua item.directManagerUsername === user.username ->
      // dùng MANAGER1 (mgr1), đúng người đã chọn làm Quản lý trực tiếp lúc tạo quy trình ở trên. Dùng
      // complete-task (chỉ cần canActOnHrTask) chứ không dùng skip-task (còn đòi canManageHrProcess,
      // MANAGER1 không phải creator/hrOffboardingManage nên sẽ bị chặn ở lớp đó).
      await loginAs(page, MANAGER1);
      let item = await page.evaluate(async (args) => (await callRecordAction('hrProcesses', args.id, 'complete-task', {
        taskId: args.taskId
      })).item, { id: supOffboardId, taskId: supTaskId['Bàn giao công việc'] });
      await loginAs(page, HR1);
      item = await page.evaluate(async (args) => (await callRecordAction('hrProcesses', args.id, 'complete-task', {
        taskId: args.taskId
      })).item, { id: supOffboardId, taskId: supTaskId['Thông báo cho phòng ban'] });
      await loginAs(page, IT1);
      item = await page.evaluate(async (args) => (await callRecordAction('hrProcesses', args.id, 'complete-task', {
        taskId: args.taskId
      })).item, { id: supOffboardId, taskId: supTaskId['Thu hồi thiết bị + khoá tài khoản'] });
      await loginAs(page, FIN1);
      item = await page.evaluate(async (args) => (await callRecordAction('hrProcesses', args.id, 'complete-task', {
        taskId: args.taskId
      })).item, { id: supOffboardId, taskId: supTaskId['Quyết toán lương/BHXH'] });
      await loginAs(page, HR1);
      // "Phỏng vấn nghỉ việc" không isRequired -> KHÔNG cần xử lý để allRequiredDone=true.
      assertEqual(item.status, 'IN_PROGRESS', 'KHÔNG được tự chuyển COMPLETED — SUP_MGR vẫn đang là managerUsername sống của SUP_REPORT, chưa có người kế nhiệm');
      assertEqual(item.pendingSuccessor, true, 'pendingSuccessor phải true — đây chính là lý do duy nhất còn chặn Hoàn Tất');
    });

    await run.run('Chỉ định người kế nhiệm: người KHÔNG quản lý quy trình (không phải creator/hrOffboardingManage/admin/hrViewAll) -> 403', async () => {
      // canManageHrProcess() coi hrViewAll ngang admin (bypass toàn bộ, xem chú thích ngay tại hàm đó) —
      // HR_VIEWER KHÔNG dùng được để test 403 ở đây (sẽ thao tác được thật) -> dùng HR_NOPERM (perms
      // rỗng, không phải creator của supOffboardId) để đúng nghĩa "không quản lý quy trình".
      await loginAs(page, HR_NOPERM);
      const err = await page.evaluate(async (id) => {
        try { await callRecordAction('hrProcesses', id, 'assign-successor', { successorUsername: 'nv.kenhiem' }); return null; }
        catch (e) { return e.message; }
      }, supOffboardId);
      assertIncludes(err, 'không có quyền chỉ định người kế nhiệm', 'Người không quản lý quy trình này (không phải creator/hrOffboardingManage/admin/hrViewAll) phải bị chặn');
      await loginAs(page, HR1);
    });

    await run.run('Chỉ định người kế nhiệm: bỏ trống -> 400; chọn chính nhân viên đang nghỉ việc -> 400; tài khoản không tồn tại/đã khoá -> 400', async () => {
      const errEmpty = await page.evaluate(async (id) => {
        try { await callRecordAction('hrProcesses', id, 'assign-successor', { successorUsername: '' }); return null; }
        catch (e) { return e.message; }
      }, supOffboardId);
      assertIncludes(errEmpty, 'Vui lòng chọn người kế nhiệm', 'Phải bắt buộc chọn người kế nhiệm');
      const errSelf = await page.evaluate(async (id) => {
        try { await callRecordAction('hrProcesses', id, 'assign-successor', { successorUsername: 'nv.suptruong' }); return null; }
        catch (e) { return e.message; }
      }, supOffboardId);
      assertIncludes(errSelf, 'không thể là chính nhân viên đang nghỉ việc', 'Không được chọn chính người đang Offboarding làm người kế nhiệm của mình');
      const errBad = await page.evaluate(async (id) => {
        try { await callRecordAction('hrProcesses', id, 'assign-successor', { successorUsername: 'khong-ton-tai' }); return null; }
        catch (e) { return e.message; }
      }, supOffboardId);
      assertIncludes(errBad, 'Không tìm thấy tài khoản người kế nhiệm này', 'Phải báo lỗi tài khoản người kế nhiệm không hợp lệ');
    });

    await run.run('Chỉ định người kế nhiệm hợp lệ (SUP_SUCCESSOR) -> ghi successorUsername/successorName + lịch sử, quy trình TỰ chuyển COMPLETED ngay (gate vừa được gỡ)', async () => {
      const result = await page.evaluate(async (id) => await callRecordAction('hrProcesses', id, 'assign-successor', { successorUsername: 'nv.kenhiem' }), supOffboardId);
      assertEqual(result.item.successorUsername, 'nv.kenhiem', 'successorUsername phải được ghi lại đúng');
      assertEqual(result.item.successorName, SUP_SUCCESSOR.name, 'successorName phải khớp tên hiển thị');
      assertEqual(result.item.pendingSuccessor, false, 'pendingSuccessor phải tắt ngay sau khi có người kế nhiệm');
      assertEqual(result.item.status, 'COMPLETED', 'Toàn bộ task bắt buộc đã xong từ trước — chỉ còn thiếu bước này — phải TỰ chuyển COMPLETED ngay trong action assign-successor');
      assert(result.item.history.some(h => h.action === 'SUCCESSOR_ASSIGNED' && h.detail.includes(SUP_SUCCESSOR.name)), 'Lịch sử phải ghi lại đúng sự kiện chỉ định người kế nhiệm kèm tên hiển thị');
    });

    await run.run('Chỉ định lại người kế nhiệm sau khi quy trình đã COMPLETED -> 409 (không còn ở trạng thái đang thực hiện)', async () => {
      const err = await page.evaluate(async (id) => {
        try { await callRecordAction('hrProcesses', id, 'assign-successor', { successorUsername: 'nv.kenhiem' }); return null; }
        catch (e) { return e.message; }
      }, supOffboardId);
      assertIncludes(err, 'không còn ở trạng thái đang thực hiện', 'Không được chỉ định lại sau khi quy trình đã Hoàn Tất');
    });

    // ===================== CHECKLIST MẪU (hrTaskTemplateManage) =====================

    await run.run('Sửa danh mục checklist mẫu (POST /api/data/hrTaskTemplates): người KHÔNG có hrTaskTemplateManage bị chặn (403), người có quyền sửa được', async () => {
      await loginAs(page, HR_NOPERM);
      const errNoPerm = await page.evaluate(async (templates) => {
        const res = await fetch('/api/data/hrTaskTemplates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(templates) });
        return res.ok ? null : (await res.json()).error;
      }, ONB_TEMPLATES);
      assert(!!errNoPerm, 'Người không có hrTaskTemplateManage/admin phải bị server chặn ghi danh mục checklist mẫu');

      await loginAs(page, HR_TEMPLATE_ADMIN);
      const okResult = await page.evaluate(async (templates) => {
        const res = await fetch('/api/data/hrTaskTemplates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(templates) });
        return res.ok;
      }, ONB_TEMPLATES);
      assert(okResult, 'hrTaskTemplateManage (dù KHÔNG có hrOnboardingManage/hrOffboardingManage) phải sửa được danh mục checklist mẫu');
      await loginAs(page, HR1);
    });

    // ===================== UI wiring (client) =====================

    await run.run('canAccessHrLifecycleModule(): HR_NOPERM (không quyền quản lý/xem, không liên quan quy trình nào) không vào được; HR1 vào được', async () => {
      await loginAs(page, HR_NOPERM);
      const canAccess = await page.evaluate(() => canAccessHrLifecycleModule(currentUser));
      assert(!canAccess, 'HR_NOPERM không có quyền nào liên quan và không phải creator/directManager/assignee của bất kỳ quy trình nào -> không được vào module');
      await loginAs(page, HR1);
      const canAccessHr1 = await page.evaluate(() => canAccessHrLifecycleModule(currentUser));
      assert(canAccessHr1, 'HR1 có hrOnboardingManage/hrOffboardingManage -> phải vào được module');
    });

    await run.run('setHrLifecycleView(LIST/MYTASKS/TEMPLATES) hiện đúng view + danh sách quy trình render không lỗi', async () => {
      await page.evaluate(() => { switchTab('hrLifecycle'); });
      const snap = await page.evaluate(() => {
        setHrLifecycleView('LIST');
        const list = {
          listHidden: document.getElementById('hrpViewList').classList.contains('hidden'),
          myTasksHidden: document.getElementById('hrpViewMyTasks').classList.contains('hidden'),
          listHtml: document.getElementById('hrpListContainer').innerHTML
        };
        setHrLifecycleView('MYTASKS');
        const myTasks = {
          listHidden: document.getElementById('hrpViewList').classList.contains('hidden'),
          myTasksHidden: document.getElementById('hrpViewMyTasks').classList.contains('hidden')
        };
        return { list, myTasks };
      });
      assertEqual(snap.list.listHidden, false, 'View LIST phải hiện #hrpViewList');
      assertEqual(snap.list.myTasksHidden, true, 'View LIST phải ẩn #hrpViewMyTasks');
      assertIncludes(snap.list.listHtml, 'Trần Văn Mới', 'Danh sách quy trình phải hiện đúng hồ sơ Onboarding vừa tạo');
      assertEqual(snap.myTasks.listHidden, true, 'View MYTASKS phải ẩn #hrpViewList');
      assertEqual(snap.myTasks.myTasksHidden, false, 'View MYTASKS phải hiện #hrpViewMyTasks');
    });

  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-hr-lifecycle.js:', err);
  process.exitCode = 1;
});
