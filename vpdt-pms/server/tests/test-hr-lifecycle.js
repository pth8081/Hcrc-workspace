// server/tests/test-hr-lifecycle.js
//
// Regression test cho "Nhân Sự > Onboarding / Offboarding" (collections hrOnboardingRequests/
// hrOffboardingRequests, module con "hrLifecycle" parent:'hr' ở BUSINESS_MODULES) — cầu nối THUẦN TUÝ
// vào ticket "Hỗ Trợ Yêu Cầu" (itSupportTickets, module Hỗ Trợ IT):
//   - Onboarding: khai báo nhân viên MỚI (chưa có tài khoản) -> "Gửi Yêu Cầu Cấp Tài Khoản" tự sinh 1
//     ticket category ACCOUNT cho đội IT xử lý.
//   - Offboarding: tra cứu nhân viên ĐÃ CÓ tài khoản qua ô sdd (#systemUsersDatalist), tích đủ 2 thủ tục
//     bàn giao/chế độ -> "Gửi Yêu Cầu Khóa Tài Khoản" tự sinh 1 ticket tương tự.
//   - Khi IT đánh dấu ticket "Hoàn thành" (DONE): server CHỈ ghi lại resolutionNote/itCompletedBy/
//     itCompletedAt ngược vào ĐÚNG hồ sơ đã sinh ra ticket đó — KHÔNG BAO GIỜ đụng tới DB.users (quyết
//     định phạm vi đã được người dùng xác nhận: IT vẫn tự tay tạo/khoá tài khoản NGOÀI hệ thống này).
//
// Quyền tạo TÁCH RIÊNG khỏi nhanSuManage: hrOnboardingCreate/hrOffboardingCreate (2 cờ phẳng MỚI, xem
// lib/createValidation.js CREATE_MODULE_CONFIGS.hrOnboardingRequests/hrOffboardingRequests).
//
// Dùng chung testHarness.js (mirror ĐÚNG lib/createValidation.js/lib/recordActions.js/
// lib/recordViewScope.js thật, không tự đoán lại luật nghiệp vụ) — cùng khuôn test-hr-feedback.js.
//
// Chạy: node server/tests/test-hr-lifecycle.js
const {
  startStaticServer, createMockState, createDispatcher, launchPage, createRunner,
  assert, assertEqual, assertIncludes
} = require('./testHarness');

const PORT = 8986;

const HR1 = { username: 'hr1', name: 'Chuyên Viên Nhân Sự', dept: 'Phòng Nhân Sự', perms: { hrOnboardingCreate: true, hrOffboardingCreate: true }, active: true };
// Cùng phòng Nhân Sự nhưng KHÔNG có 2 quyền tạo -> dùng để kiểm tra gác quyền phía SERVER (không chỉ ẩn ở UI).
const HR_NOPERM = { username: 'hr2', name: 'Nhân Viên Nhân Sự Khác', dept: 'Phòng Nhân Sự', perms: {}, active: true };
// nhanSuManage: true — KHÔNG có 2 quyền tạo, nhưng phải XEM được toàn bộ yêu cầu (theo dõi tiến độ).
const HR_MANAGER = { username: 'hr.manager', name: 'Trưởng Phòng Nhân Sự', dept: 'Phòng Nhân Sự', perms: { nhanSuManage: true }, active: true };
const IT1 = { username: 'it1', name: 'Nhân Viên IT', dept: 'Phòng CNTT', perms: { itManage: true }, active: true };
// Nhân viên ĐANG active — nguồn tra cứu cho Offboarding (employeeUsername).
const EMP = { username: 'nv.ketoan', name: 'Nguyễn Văn Kế Toán', dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên', email: 'ketoan@company.com', perms: {}, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };

const state = createMockState({
  depts: ['Phòng Nhân Sự', 'Phòng CNTT', 'Phòng Kế Toán', 'Ban Giám Đốc'],
  stores: ['Siêu Thị A'],
  jobTitles: ['Nhân viên', 'Chuyên viên'],
  storeJobTitles: [{ label: 'Nhân viên bán hàng' }],
  users: [HR1, HR_NOPERM, HR_MANAGER, IT1, EMP, ADMIN]
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => {
    window.__resetCapture();
    await proceedAfterAuth(u);
  }, user);
}

function onboardHoPayload(overrides) {
  return Object.assign({
    employeeCode: 'NV0001', fullName: 'Trần Văn Mới',
    employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Nhân viên',
    email: '', phone: '0912345678', startDate: '2026-09-15', note: ''
  }, overrides || {});
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const directDispatch = createDispatcher(state); // dùng để đọc lại GET /api/data theo ĐÚNG view-scope của 1 user cụ thể, không cần đổi currentUser của trang.

  let onboardId = null, onboardTicketId = null;
  let offboardId = null, offboardTicketId = null;

  try {
    // ===================== ONBOARDING =====================

    await run.run('Không có hrOnboardingCreate -> tạo yêu cầu Onboarding bị chặn ở SERVER (403)', async () => {
      await loginAs(page, HR_NOPERM);
      const err = await page.evaluate(async (payload) => {
        try { await callCreateAction('hrOnboardingRequests', payload); return null; }
        catch (e) { return e.message; }
      }, onboardHoPayload());
      assertIncludes(err, 'không có quyền tạo yêu cầu Onboarding', 'Phải báo đúng lỗi thiếu quyền');
    });

    await run.run('Onboarding STORE thiếu Email -> 400 (bắt buộc với nhân viên Siêu Thị)', async () => {
      await loginAs(page, HR1);
      const err = await page.evaluate(async (payload) => {
        try { await callCreateAction('hrOnboardingRequests', payload); return null; }
        catch (e) { return e.message; }
      }, onboardHoPayload({ employeePosType: 'STORE', employeeDept: 'Siêu Thị A', employeeJobTitle: 'Nhân viên bán hàng', email: '' }));
      assertIncludes(err, 'bắt buộc phải nhập Email', 'Phải chặn thiếu email cho nhân viên Siêu Thị');
    });

    await run.run('Onboarding STORE có Email -> tạo thành công', async () => {
      const item = await page.evaluate(async (payload) => (await callCreateAction('hrOnboardingRequests', payload)).item,
        onboardHoPayload({ employeeCode: 'NV0002', employeePosType: 'STORE', employeeDept: 'Siêu Thị A', employeeJobTitle: 'Nhân viên bán hàng', email: 'a@b.com' }));
      assertEqual(item.status, 'PENDING_IT', 'Trạng thái khởi tạo phải là PENDING_IT');
      assertEqual(item.linkedTicketId, null, 'Chưa gửi Hỗ Trợ IT thì linkedTicketId phải null');
    });

    await run.run('Onboarding HO KHÔNG bắt buộc Email -> tạo thành công, mọi field trạng thái do server ép cứng', async () => {
      const item = await page.evaluate(async (payload) => (await callCreateAction('hrOnboardingRequests', payload)).item, onboardHoPayload());
      onboardId = item.id;
      assertEqual(item.status, 'PENDING_IT', 'Trạng thái khởi tạo phải là PENDING_IT');
      assertEqual(item.linkedTicketId, null, 'Chưa gửi Hỗ Trợ IT thì linkedTicketId phải null');
      assertEqual(item.itResultNote, '', 'itResultNote phải rỗng lúc mới tạo');
      assertEqual(item.itCompletedBy, null, 'itCompletedBy phải null lúc mới tạo');
      assertEqual(item.creator, HR1.username, 'creator phải là người vừa tạo (HR1)');
      assertEqual(item.dept, HR1.dept, 'dept của hồ sơ phải là phòng ban của người TẠO (không phải employeeDept)');
      assertEqual(item.employeeDept, 'Phòng Kế Toán', 'employeeDept phải giữ nguyên giá trị nhân viên mới (khác record.dept)');
    });

    await run.run('"Gửi Yêu Cầu Cấp Tài Khoản" -> sinh đúng 1 ticket itSupportTickets liên kết (category ACCOUNT, sourceType/sourceId đúng)', async () => {
      const result = await page.evaluate(async (id) => await callRecordAction('hrOnboardingRequests', id, 'submit-it-request', {}), onboardId);
      assertEqual(result.item.linkedTicketId, result.ticket.id, 'item.linkedTicketId phải khớp id ticket vừa tạo');
      assertEqual(result.ticket.category, 'ACCOUNT', 'Ticket phải thuộc danh mục "Tài khoản / Đăng nhập"');
      assertEqual(result.ticket.sourceType, 'HR_ONBOARDING', 'sourceType phải là HR_ONBOARDING');
      assertEqual(result.ticket.sourceId, onboardId, 'sourceId phải trỏ đúng về hồ sơ Onboarding vừa tạo');
      assertEqual(result.ticket.status, 'TODO', 'Ticket mới sinh phải ở trạng thái TODO');
      assertEqual(result.ticket.creator, HR1.username, 'Ticket phải mang đúng người TẠO yêu cầu Onboarding làm creator (để họ tự xem được tiến độ)');
      onboardTicketId = result.ticket.id;
    });

    await run.run('Gửi lại lần 2 khi đã có ticket -> 409 (chặn tạo trùng ticket)', async () => {
      const err = await page.evaluate(async (id) => {
        try { await callRecordAction('hrOnboardingRequests', id, 'submit-it-request', {}); return null; }
        catch (e) { return e.message; }
      }, onboardId);
      assertIncludes(err, 'đã được gửi tới Hỗ Trợ IT rồi', 'Phải chặn gửi trùng');
    });

    await run.run('Người KHÔNG liên quan (không phải creator/nhanSuManage/admin) KHÔNG xem được yêu cầu Onboarding của người khác (view-scope server)', async () => {
      const res = await directDispatch('GET', '/api/data', null, HR_NOPERM.username);
      const seen = (res.body.hrOnboardingRequests || []).some(q => q.id === onboardId);
      assert(!seen, 'HR_NOPERM không phải creator/nhanSuManage -> không được thấy hồ sơ này');
      const resMgr = await directDispatch('GET', '/api/data', null, HR_MANAGER.username);
      const seenByMgr = (resMgr.body.hrOnboardingRequests || []).some(q => q.id === onboardId);
      assert(seenByMgr, 'nhanSuManage phải xem được TOÀN BỘ yêu cầu để theo dõi tiến độ, kể cả không phải người tạo');
    });

    await run.run('IT xác nhận "Hoàn thành" ticket -> ghi ngược itResultNote/itCompletedBy/itCompletedAt vào hồ sơ Onboarding liên kết, KHÔNG đụng DB.users', async () => {
      const usersSnapshotBefore = JSON.stringify(state.users);
      await loginAs(page, IT1);
      await page.evaluate(async (id) => { await callRecordAction('itSupportTickets', id, 'claim', {}); }, onboardTicketId);
      const ticketResult = await page.evaluate(async (id) => await callRecordAction('itSupportTickets', id, 'update-status', { status: 'DONE', resolutionNote: 'Đã cấp email trannv@company.com + tài khoản AD' }), onboardTicketId);
      assertEqual(ticketResult.item.status, 'DONE', 'Ticket phải chuyển DONE');

      const linked = state.hrOnboardingRequests.find(q => q.id === onboardId);
      assertEqual(linked.status, 'COMPLETED', 'Hồ sơ Onboarding liên kết phải chuyển COMPLETED');
      assertEqual(linked.itResultNote, 'Đã cấp email trannv@company.com + tài khoản AD', 'itResultNote phải khớp đúng resolutionNote IT vừa nhập');
      assertEqual(linked.itCompletedBy, IT1.username, 'itCompletedBy phải là người IT vừa xác nhận');
      assert(!!linked.itCompletedAt, 'itCompletedAt phải được gán');

      const usersSnapshotAfter = JSON.stringify(state.users);
      assertEqual(usersSnapshotAfter, usersSnapshotBefore, 'TUYỆT ĐỐI KHÔNG được đụng tới DB.users khi ghi ngược kết quả IT — IT vẫn tự tay cấp/khoá tài khoản NGOÀI hệ thống này');
      await loginAs(page, HR1);
    });

    // ===================== OFFBOARDING =====================

    await run.run('Không có hrOffboardingCreate -> tạo yêu cầu Offboarding bị chặn ở SERVER (403)', async () => {
      await loginAs(page, HR_NOPERM);
      const err = await page.evaluate(async () => {
        try { await callCreateAction('hrOffboardingRequests', { employeeUsername: 'nv.ketoan', checklistHandover: true, checklistBenefits: true }); return null; }
        catch (e) { return e.message; }
      });
      assertIncludes(err, 'không có quyền tạo yêu cầu Offboarding', 'Phải báo đúng lỗi thiếu quyền');
      await loginAs(page, HR1);
    });

    await run.run('Offboarding: tên đăng nhập không tồn tại -> 400', async () => {
      const err = await page.evaluate(async () => {
        try { await callCreateAction('hrOffboardingRequests', { employeeUsername: 'khong-ton-tai', checklistHandover: true, checklistBenefits: true }); return null; }
        catch (e) { return e.message; }
      });
      assertIncludes(err, 'Không tìm thấy tài khoản nhân viên này', 'Phải báo lỗi không tìm thấy tài khoản');
    });

    await run.run('Offboarding: chưa tích đủ 2 thủ tục bàn giao/chế độ -> 400 (chặn CẢ ở server, không chỉ client)', async () => {
      const err1 = await page.evaluate(async () => {
        try { await callCreateAction('hrOffboardingRequests', { employeeUsername: 'nv.ketoan', checklistHandover: false, checklistBenefits: true }); return null; }
        catch (e) { return e.message; }
      });
      assertIncludes(err1, 'thủ tục bàn giao', 'Phải chặn thiếu xác nhận bàn giao');
      const err2 = await page.evaluate(async () => {
        try { await callCreateAction('hrOffboardingRequests', { employeeUsername: 'nv.ketoan', checklistHandover: true, checklistBenefits: false }); return null; }
        catch (e) { return e.message; }
      });
      assertIncludes(err2, 'thủ tục chế độ', 'Phải chặn thiếu xác nhận chế độ');
    });

    await run.run('Offboarding: đủ điều kiện -> tạo thành công, snapshot đúng tên/dept/chức danh/email từ DB.users TẠI THỜI ĐIỂM tạo', async () => {
      const item = await page.evaluate(async () => (await callCreateAction('hrOffboardingRequests', {
        employeeUsername: 'nv.ketoan', checklistHandover: true, checklistBenefits: true, reason: 'Nghỉ việc theo nguyện vọng cá nhân'
      })).item);
      offboardId = item.id;
      assertEqual(item.status, 'PENDING_IT', 'Trạng thái khởi tạo phải là PENDING_IT');
      assertEqual(item.linkedTicketId, null, 'Chưa gửi Hỗ Trợ IT thì linkedTicketId phải null');
      assertEqual(item.employeeName, EMP.name, 'Phải snapshot đúng tên nhân viên');
      assertEqual(item.employeeDept, EMP.dept, 'Phải snapshot đúng phòng ban nhân viên');
      assertEqual(item.employeeJobTitle, EMP.jobTitle, 'Phải snapshot đúng chức danh nhân viên');
      assertEqual(item.employeeEmail, EMP.email, 'Phải snapshot đúng email nhân viên');
      assertEqual(item.creator, HR1.username, 'creator phải là người vừa tạo (HR1)');
    });

    await run.run('"Gửi Yêu Cầu Khóa Tài Khoản" -> sinh đúng 1 ticket itSupportTickets liên kết (category ACCOUNT, sourceType HR_OFFBOARDING)', async () => {
      const result = await page.evaluate(async (id) => await callRecordAction('hrOffboardingRequests', id, 'submit-it-request', {}), offboardId);
      assertEqual(result.item.linkedTicketId, result.ticket.id, 'item.linkedTicketId phải khớp id ticket vừa tạo');
      assertEqual(result.ticket.category, 'ACCOUNT', 'Ticket phải thuộc danh mục "Tài khoản / Đăng nhập"');
      assertEqual(result.ticket.sourceType, 'HR_OFFBOARDING', 'sourceType phải là HR_OFFBOARDING');
      assertEqual(result.ticket.sourceId, offboardId, 'sourceId phải trỏ đúng về hồ sơ Offboarding vừa tạo');
      offboardTicketId = result.ticket.id;
    });

    await run.run('IT xác nhận "Hoàn thành" ticket Offboarding -> ghi ngược kết quả, KHÔNG đụng DB.users (đặc biệt KHÔNG khoá active của nv.ketoan)', async () => {
      const usersSnapshotBefore = JSON.stringify(state.users);
      await loginAs(page, IT1);
      await page.evaluate(async (id) => { await callRecordAction('itSupportTickets', id, 'claim', {}); }, offboardTicketId);
      await page.evaluate(async (id) => await callRecordAction('itSupportTickets', id, 'update-status', { status: 'DONE', resolutionNote: 'Đã khoá email + tài khoản AD' }), offboardTicketId);

      const linked = state.hrOffboardingRequests.find(q => q.id === offboardId);
      assertEqual(linked.status, 'COMPLETED', 'Hồ sơ Offboarding liên kết phải chuyển COMPLETED');
      assertEqual(linked.itResultNote, 'Đã khoá email + tài khoản AD', 'itResultNote phải khớp đúng resolutionNote IT vừa nhập');
      assertEqual(linked.itCompletedBy, IT1.username, 'itCompletedBy phải là người IT vừa xác nhận');

      const empAfter = state.users.find(u => u.username === EMP.username);
      assertEqual(empAfter.active, true, 'TUYỆT ĐỐI KHÔNG được tự khoá tài khoản DB.users — IT vẫn tự tay khoá NGOÀI hệ thống này');
      const usersSnapshotAfter = JSON.stringify(state.users);
      assertEqual(usersSnapshotAfter, usersSnapshotBefore, 'DB.users phải giữ NGUYÊN VẸN sau khi ghi ngược kết quả IT');
      await loginAs(page, HR1);
    });

    // ===================== UI wiring (client) =====================

    await run.run('Module "Onboarding / Offboarding" đúng quyền vào (canAccessHrLifecycleModule) — HR_NOPERM (không quyền tạo, không nhanSuManage) không vào được', async () => {
      await loginAs(page, HR_NOPERM);
      const canAccess = await page.evaluate(() => canAccessHrLifecycleModule(currentUser));
      assert(!canAccess, 'HR_NOPERM không có hrOnboardingCreate/hrOffboardingCreate/nhanSuManage -> không được vào module');
      await loginAs(page, HR1);
      const canAccessHr1 = await page.evaluate(() => canAccessHrLifecycleModule(currentUser));
      assert(canAccessHr1, 'HR1 có hrOnboardingCreate/hrOffboardingCreate -> phải vào được module');
    });

    await run.run('setHrLifecycleSubTab(ONBOARD/OFFBOARD) hiện đúng view + danh sách render không lỗi', async () => {
      await page.evaluate(() => { switchTab('hrLifecycle'); });
      const snap = await page.evaluate(() => {
        setHrLifecycleSubTab('ONBOARD');
        const onboard = {
          onboardHidden: document.getElementById('hrLifecycleOnboardView').classList.contains('hidden'),
          offboardHidden: document.getElementById('hrLifecycleOffboardView').classList.contains('hidden'),
          listHtml: document.getElementById('hrOnboardingListContainer').innerHTML
        };
        setHrLifecycleSubTab('OFFBOARD');
        const offboard = {
          onboardHidden: document.getElementById('hrLifecycleOnboardView').classList.contains('hidden'),
          offboardHidden: document.getElementById('hrLifecycleOffboardView').classList.contains('hidden'),
          listHtml: document.getElementById('hrOffboardingListContainer').innerHTML
        };
        return { onboard, offboard };
      });
      assertEqual(snap.onboard.onboardHidden, false, 'Sub-tab ONBOARD phải hiện view Onboarding');
      assertEqual(snap.onboard.offboardHidden, true, 'Sub-tab ONBOARD phải ẩn view Offboarding');
      assertIncludes(snap.onboard.listHtml, 'Trần Văn Mới', 'Danh sách Onboarding phải hiện đúng hồ sơ vừa tạo');
      assertEqual(snap.offboard.onboardHidden, true, 'Sub-tab OFFBOARD phải ẩn view Onboarding');
      assertEqual(snap.offboard.offboardHidden, false, 'Sub-tab OFFBOARD phải hiện view Offboarding');
      assertIncludes(snap.offboard.listHtml, 'Nguyễn Văn Kế Toán', 'Danh sách Offboarding phải hiện đúng hồ sơ vừa tạo');
      assertIncludes(snap.offboard.listHtml, 'Hoàn tất', 'Hồ sơ Offboarding đã COMPLETED phải hiện đúng badge kết quả');
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
