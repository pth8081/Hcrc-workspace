// Test cho lỗ hổng mức Cao phát hiện ở đợt audit v25.51→v25.63 (cụm "Quy Trình Hỗn Hợp +
// Phân Quyền batch"): đợt vá "4 vấn đề phân quyền" trước (commit e64f27d) chỉ sửa đúng Công &
// Phép (canSeeHacManageAll AND hasModuleAccessServer(...ManageTab)) nhưng bỏ sót 3 biến thể
// giống hệt — canViewAllPayrollData()/canViewPaymentRequest() (lib/recordViewScope.js) và
// canViewFullProfile() (lib/employeeProfile.js) chỉ check flat-perm, KHÔNG re-check Mục 0
// (tab bị admin tắt). Hậu quả: admin ẩn tab quản lý nhưng còn giữ flat-perm thì user đó gọi
// thẳng GET /api/data vẫn đọc được TOÀN BỘ phiếu lương/yêu cầu thanh toán/hồ sơ nhân sự công ty.
const assert = require('assert');
const {
  canViewAllPayrollData, filterPayrollPeriodsForUser, filterPayslipsForUser,
  canViewPaymentRequest,
} = require('../lib/recordViewScope');
const { canViewFullProfile } = require('../lib/employeeProfile');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log(`PASS: ${label}`); }
  else { fail++; console.log(`FAIL: ${label}`); }
}

// ---- 1) canViewAllPayrollData() / filterPayrollPeriodsForUser() / filterPayslipsForUser() ----
{
  const userManageTabOff = { username: 'u1', perms: { hrPayrollManage: true, moduleAccess: { hrPayrollManageTab: false } } };
  const userManageTabOn = { username: 'u2', perms: { hrPayrollManage: true, moduleAccess: { hrPayrollManageTab: true } } };
  const userApproveTabOff = { username: 'u3', perms: { hrPayrollApprove: true, moduleAccess: { hrPayrollManageTab: false } } };
  const userAdmin = { username: 'u4', perms: { admin: true, moduleAccess: { hrPayrollManageTab: false } } };
  const items = [{ id: 'p1' }, { id: 'p2' }];

  check('LỖ HỔNG ĐÃ VÁ: hrPayrollManage nhưng Mục 0 hrPayrollManageTab=false -> KHÔNG được xem toàn bộ kỳ lương/phiếu lương',
    canViewAllPayrollData(userManageTabOff) === false
    && filterPayrollPeriodsForUser(items, userManageTabOff).length === 0
    && filterPayslipsForUser(items, userManageTabOff).length === 0);
  check('hrPayrollManage + Mục 0 bật -> vẫn xem được ĐỦ (không mất chức năng)',
    canViewAllPayrollData(userManageTabOn) === true
    && filterPayrollPeriodsForUser(items, userManageTabOn).length === 2);
  check('hrPayrollApprove nhưng Mục 0 tắt -> cũng bị chặn (không chỉ riêng Manage)',
    canViewAllPayrollData(userApproveTabOff) === false);
  check('admin luôn bypass bất kể Mục 0',
    canViewAllPayrollData(userAdmin) === true);
}

// ---- 2) canViewPaymentRequest() ----
{
  const appData = { users: [], deptViewScopeConfig: {} };
  const item = { id: 'pr1', createdBy: 'khac', dept: 'PhongKhac' };
  const userManageTabOff = { username: 'u5', dept: 'PhongToi', perms: { paymentManage: true, moduleAccess: { paymentManageTab: false } } };
  const userManageTabOn = { username: 'u6', dept: 'PhongToi', perms: { paymentManage: true, moduleAccess: { paymentManageTab: true } } };
  const userAdmin = { username: 'u7', dept: 'PhongToi', perms: { admin: true, moduleAccess: { paymentManageTab: false } } };

  check('LỖ HỔNG ĐÃ VÁ: paymentManage nhưng Mục 0 paymentManageTab=false, không phải người tạo/cùng phòng/quản lý -> KHÔNG xem được',
    canViewPaymentRequest(userManageTabOff, item, appData) === false);
  check('paymentManage + Mục 0 bật -> vẫn xem được ĐỦ (không mất chức năng)',
    canViewPaymentRequest(userManageTabOn, item, appData) === true);
  check('admin luôn bypass bất kể Mục 0',
    canViewPaymentRequest(userAdmin, item, appData) === true);
}

// ---- 3) canViewFullProfile() ----
{
  const profile = { username: 'nv1', onboardingQueueStatus: null };
  const userManageTabOff = { username: 'hr1', perms: { hrProfileManage: true, moduleAccess: { hrProfileManageTab: false } } };
  const userFullViewTabOff = { username: 'hr2', perms: { hrProfileFullView: true, moduleAccess: { hrProfileManageTab: false } } };
  const userManageTabOn = { username: 'hr3', perms: { hrProfileManage: true, moduleAccess: { hrProfileManageTab: true } } };
  const userSelf = { username: 'nv1', perms: {} };

  check('LỖ HỔNG ĐÃ VÁ: hrProfileManage nhưng Mục 0 hrProfileManageTab=false, không phải hồ sơ của chính mình -> KHÔNG xem được',
    canViewFullProfile(userManageTabOff, profile) === false);
  check('LỖ HỔNG ĐÃ VÁ (biến thể hrProfileFullView): cùng Mục 0 tắt -> cũng bị chặn',
    canViewFullProfile(userFullViewTabOff, profile) === false);
  check('hrProfileManage + Mục 0 bật -> vẫn xem được ĐỦ (không mất chức năng)',
    canViewFullProfile(userManageTabOn, profile) === true);
  check('chính người có profile (profile.username === user.username) luôn xem được, không phụ thuộc Mục 0',
    canViewFullProfile(userSelf, profile) === true);
}

console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
if (fail > 0) process.exit(1);
