// server/tests/test-hr-discipline-jobgrade-resignation.js
//
// Regression test cho đợt tính năng (10/2026, theo yêu cầu người dùng — "làm luôn cả 2 phần + cấu hình
// danh mục Cấp Bậc"):
//   1. disciplinaryActions[] ("Số kỷ luật") — field mảng MỚI trên employeeProfiles (HR-only, nested array
//      cùng khuôn dependents[]/education[]), xem lib/employeeProfile.js.
//   2. 7 field mới trên dependents[] (đối chiếu mẫu Excel "DATA NGUOI PHU THUOC").
//   3. disciplinaryActions PHẢI nằm trong SENSITIVE_FIELDS (nếu không sẽ LUÔN lộ cho quản lý trực tiếp
//      dù chưa cấu hình mở — xem getProfileForViewer()).
//   4. resignationReason (OFFBOARDING, lib/createValidation.js) — field catalog-suggest TÁCH khỏi field
//      tự do "reason" có sẵn.
//   3 danh mục mới (jobGrades/resignationReasons/disciplinaryTypes) được cover qua test-simple-catalog-
//   excel-tools.js (registry chung "SIMPLE_CATALOG_EXCEL_CONFIG") + test-form-fields-6-catalogs.js (nếu
//   mở rộng) — bài này tập trung vào phần LOGIC NGHIỆP VỤ server-side mới, không lặp lại hạ tầng Excel.
//
// Chạy: node server/tests/test-hr-discipline-jobgrade-resignation.js
'use strict';
const assert = require('assert');
const employeeProfile = require('../lib/employeeProfile');

let failures = 0;
function check(label, cond) {
  if (cond) { console.log(`PASS: ${label}`); } else { console.log(`FAIL: ${label}`); failures++; }
}
function throws(fn, label) {
  try { fn(); check(label, false); } catch (e) { check(label, true); }
}

function main() {
  // ===== 1) Khai báo field: disciplinaryActions nằm đúng nhóm, có nhãn, và KHÔNG tự sửa được qua self =====
  check('SENSITIVE_FIELDS chứa disciplinaryActions (bắt buộc, nếu không sẽ LUÔN lộ cho quản lý trực tiếp dù chưa cấu hình mở)',
    employeeProfile.SENSITIVE_FIELDS.includes('disciplinaryActions'));
  check('SENSITIVE_FIELD_LABELS có nhãn "Kỷ luật" cho disciplinaryActions',
    employeeProfile.SENSITIVE_FIELD_LABELS.disciplinaryActions === 'Kỷ luật');
  check('HR_ONLY_EDITABLE_FIELDS chứa disciplinaryActions (chỉ HR ghi nhận kỷ luật)',
    employeeProfile.HR_ONLY_EDITABLE_FIELDS.includes('disciplinaryActions'));
  check('SELF_EDITABLE_FIELDS KHÔNG chứa disciplinaryActions (nhân viên không tự sửa được kỷ luật của mình)',
    !employeeProfile.SELF_EDITABLE_FIELDS.includes('disciplinaryActions'));
  check('PROFILE_FIELD_LABELS có nhãn cho disciplinaryActions', employeeProfile.PROFILE_FIELD_LABELS.disciplinaryActions === 'Kỷ luật');
  check('defaultProfile() khởi tạo disciplinaryActions = [] (hồ sơ mới)',
    Array.isArray(employeeProfile.defaultProfile('NVT001').disciplinaryActions)
    && employeeProfile.defaultProfile('NVT001').disciplinaryActions.length === 0);

  // ===== 2) applyProfileEdit(): disciplinaryActions — validate + persist đúng, gửi qua field KHÔNG được
  //    phép (SELF_EDITABLE_FIELDS) thì bị ÂM THẦM bỏ qua, không lỗi, không đổi gì =====
  {
    const profile = employeeProfile.defaultProfile('NVT010');
    employeeProfile.applyProfileEdit(
      profile,
      { disciplinaryActions: [{ date: '2026-05-01', type: 'Cảnh cáo', note: 'Đi làm muộn' }] },
      employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR Trưởng'
    );
    check('applyProfileEdit() lưu đúng 1 dòng kỷ luật (HR_ONLY_EDITABLE_FIELDS)', profile.disciplinaryActions.length === 1);
    const row = profile.disciplinaryActions[0];
    check('Dòng kỷ luật có id tự sinh', !!row.id);
    check('Dòng kỷ luật lưu đúng date/type/note', row.date === '2026-05-01' && row.type === 'Cảnh cáo' && row.note === 'Đi làm muộn');
    check('Dòng kỷ luật ghi đúng người quyết định (decidedBy/decidedByName)', row.decidedBy === 'hr1' && row.decidedByName === 'HR Trưởng');

    // Gửi field disciplinaryActions nhưng allowedFields CHỈ cho phép SELF_EDITABLE_FIELDS (giả lập chính
    // chủ tự gửi payload dư field HR-only qua PATCH /me) -> applyProfileEdit() loại field ngay vì không
    // nằm trong allowedFields, hồ sơ giữ nguyên.
    employeeProfile.applyProfileEdit(
      profile,
      { disciplinaryActions: [] },
      employeeProfile.SELF_EDITABLE_FIELDS, 'emp1', 'Nhân Viên Một'
    );
    check('Gửi disciplinaryActions qua SELF_EDITABLE_FIELDS (chính chủ) bị bỏ qua, KHÔNG xoá dữ liệu cũ', profile.disciplinaryActions.length === 1);
  }

  // ===== 3) applyProfileEdit(): disciplinaryActions — thiếu Ngày/Loại kỷ luật phải NÉM LỖI, không lưu dở =====
  throws(() => {
    const profile = employeeProfile.defaultProfile('NVT011');
    employeeProfile.applyProfileEdit(profile, { disciplinaryActions: [{ type: 'Cảnh cáo' }] }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR');
  }, 'Thiếu "date" -> applyProfileEdit() ném lỗi (assertValidDisciplinaryAction)');
  throws(() => {
    const profile = employeeProfile.defaultProfile('NVT012');
    employeeProfile.applyProfileEdit(profile, { disciplinaryActions: [{ date: '2026-05-01' }] }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR');
  }, 'Thiếu "type" (Loại kỷ luật) -> applyProfileEdit() ném lỗi');
  throws(() => {
    const profile = employeeProfile.defaultProfile('NVT013');
    employeeProfile.applyProfileEdit(profile, { disciplinaryActions: [{ date: 'khong-phai-ngay', type: 'Cảnh cáo' }] }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR');
  }, '"date" không parse được thành ngày hợp lệ -> ném lỗi');

  // ===== 4) applyProfileEdit(): dependents — 7 field mới (DATA NGUOI PHU THUOC) lưu đúng, validate định
  //    dạng tháng (YYYY-MM) + số tiền giảm trừ không âm =====
  {
    const profile = employeeProfile.defaultProfile('NVT020');
    employeeProfile.applyProfileEdit(profile, {
      dependents: [{
        fullName: 'Nguyễn Văn Con', relationship: 'Con', dateOfBirth: '2015-01-01',
        nationality: 'Việt Nam', idNumber: '012345678',
        deductionFromMonth: '2024-01', deductionToMonth: '2024-12',
        deductionCutMonth: '2024-12', deductionAmount: 4400000, declarationMonth: '2024-01'
      }]
    }, employeeProfile.SELF_EDITABLE_FIELDS, 'emp1', 'Nhân Viên Một');
    const dep = profile.dependents[0];
    check('Lưu đúng 7 field mới của dependents (DATA NGUOI PHU THUOC)',
      dep.nationality === 'Việt Nam' && dep.idNumber === '012345678'
      && dep.deductionFromMonth === '2024-01' && dep.deductionToMonth === '2024-12'
      && dep.deductionCutMonth === '2024-12' && dep.deductionAmount === 4400000 && dep.declarationMonth === '2024-01');
  }
  throws(() => {
    const profile = employeeProfile.defaultProfile('NVT021');
    employeeProfile.applyProfileEdit(profile, {
      dependents: [{ fullName: 'A', relationship: 'Con', deductionFromMonth: '2024-13' }]
    }, employeeProfile.SELF_EDITABLE_FIELDS, 'emp1', 'NV1');
  }, 'deductionFromMonth="2024-13" (tháng không hợp lệ) -> applyProfileEdit() ném lỗi');
  throws(() => {
    const profile = employeeProfile.defaultProfile('NVT022');
    employeeProfile.applyProfileEdit(profile, {
      dependents: [{ fullName: 'A', relationship: 'Con', deductionToMonth: '01-2024' }]
    }, employeeProfile.SELF_EDITABLE_FIELDS, 'emp1', 'NV1');
  }, 'deductionToMonth="01-2024" (sai thứ tự YYYY-MM) -> ném lỗi');
  throws(() => {
    const profile = employeeProfile.defaultProfile('NVT023');
    employeeProfile.applyProfileEdit(profile, {
      dependents: [{ fullName: 'A', relationship: 'Con', deductionAmount: -500000 }]
    }, employeeProfile.SELF_EDITABLE_FIELDS, 'emp1', 'NV1');
  }, 'deductionAmount âm -> ném lỗi');
  {
    // Để trống hết 7 field mới (hồ sơ cũ/không cần khai) vẫn phải lưu được bình thường, không ép buộc.
    const profile = employeeProfile.defaultProfile('NVT024');
    employeeProfile.applyProfileEdit(profile, {
      dependents: [{ fullName: 'Con Không Khai Thuế', relationship: 'Con' }]
    }, employeeProfile.SELF_EDITABLE_FIELDS, 'emp1', 'NV1');
    const dep = profile.dependents[0];
    check('7 field mới đều TUỲ CHỌN — để trống hết vẫn lưu được, trả về null (không ép buộc nhập)',
      dep.nationality === null && dep.idNumber === null && dep.deductionFromMonth === null
      && dep.deductionToMonth === null && dep.deductionCutMonth === null && dep.deductionAmount === null
      && dep.declarationMonth === null);
  }

  // ===== 5) getProfileForViewer(): disciplinaryActions BỊ ẨN khỏi "quản lý trực tiếp xem giới hạn" khi
  //    CHƯA cấu hình mở (managerVisibleFields rỗng/không chứa) — ĐÚNG lỗi suýt mắc nếu quên thêm field
  //    này vào SENSITIVE_FIELDS (xem chú thích tại SENSITIVE_FIELDS trong lib/employeeProfile.js) =====
  {
    const MGR = { username: 'mgr1', perms: { hrProfileView: true } };
    const EMP = { username: 'emp1', managerUsername: 'mgr1' };
    const ALL_USERS = [MGR, EMP];
    const profile = Object.assign(employeeProfile.defaultProfile('NVT030'), {
      username: 'emp1',
      disciplinaryActions: [{ id: 'd1', date: '2026-01-01', type: 'Cảnh cáo', note: 'x' }]
    });
    const limitedNoConfig = employeeProfile.getProfileForViewer(profile, MGR, ALL_USERS, []);
    check('Quản lý trực tiếp KHÔNG thấy disciplinaryActions khi CHƯA cấu hình mở (mặc định ẩn, opt-in)',
      !('disciplinaryActions' in limitedNoConfig));
    const limitedWithConfig = employeeProfile.getProfileForViewer(profile, MGR, ALL_USERS, ['disciplinaryActions']);
    check('Quản lý trực tiếp THẤY disciplinaryActions SAU KHI admin cấu hình mở managerVisibleFields',
      Array.isArray(limitedWithConfig.disciplinaryActions) && limitedWithConfig.disciplinaryActions.length === 1);
    const HR_FULL = { username: 'hr1', perms: { hrProfileManage: true } };
    const fullView = employeeProfile.getProfileForViewer(profile, HR_FULL, ALL_USERS, []);
    check('HR (hrProfileManage, full view) LUÔN thấy disciplinaryActions, không phụ thuộc cấu hình', fullView === profile);
  }

  // ===== 6) createValidation.js — OFFBOARDING resignationReason: TÁCH khỏi field "reason" tự do có sẵn,
  //    trim + cắt tối đa 200 ký tự, null khi KHÔNG phải OFFBOARDING hoặc không gửi =====
  {
    const { CREATE_MODULE_CONFIGS } = require('../lib/createValidation');
    const HR = { username: 'hr1', name: 'HR Trưởng', perms: { hrOffboardingManage: true } };
    const EMPLOYEE = { username: 'nv1', name: 'Nhân Viên Một', active: true, dept: 'Kinh Doanh', jobTitle: 'NVKD' };
    const appData = { users: [HR, EMPLOYEE], hrTaskTemplates: [], formTemplates: {} };

    const payload1 = {
      processType: 'OFFBOARDING', employeeUsername: 'nv1', lastWorkingDate: '2026-11-01',
      resignationReason: '  Nghỉ việc theo nguyện vọng cá nhân  '
    };
    CREATE_MODULE_CONFIGS.hrProcesses.extraValidate(payload1, 'hrProcesses', HR, appData);
    check('OFFBOARDING resignationReason: trim khoảng trắng 2 đầu', payload1.resignationReason === 'Nghỉ việc theo nguyện vọng cá nhân');

    const payload2 = {
      processType: 'OFFBOARDING', employeeUsername: 'nv1', lastWorkingDate: '2026-11-01',
      resignationReason: 'A'.repeat(500)
    };
    CREATE_MODULE_CONFIGS.hrProcesses.extraValidate(payload2, 'hrProcesses', HR, appData);
    check('OFFBOARDING resignationReason: cắt tối đa 200 ký tự', payload2.resignationReason.length === 200);

    const payload3 = {
      processType: 'OFFBOARDING', employeeUsername: 'nv1', lastWorkingDate: '2026-11-01',
      reason: 'Ghi chú thêm tự do', resignationReason: ''
    };
    CREATE_MODULE_CONFIGS.hrProcesses.extraValidate(payload3, 'hrProcesses', HR, appData);
    check('OFFBOARDING resignationReason trống -> null, KHÔNG ảnh hưởng field "reason" tự do riêng biệt',
      payload3.resignationReason === null && payload3.reason === 'Ghi chú thêm tự do');
  }

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exitCode = failures ? 1 : 0;
}

main();
