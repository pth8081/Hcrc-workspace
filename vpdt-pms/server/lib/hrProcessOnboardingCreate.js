// lib/hrProcessOnboardingCreate.js — createOnboardingProcessRecord() (10/2026, theo yêu cầu người dùng:
// thêm Nhập Excel hàng loạt "Theo Quy Trình" cho tab Onboarding) — TÁCH NGUYÊN VẸN (copy, KHÔNG đổi 1
// dòng hành vi) đoạn xử lý riêng cho hrProcesses/ONBOARDING đang nằm trong routes/create.js
// (router.post('/:moduleKey', ...)): sinh/đặt chỗ Mã Nhân Viên -> tạo hrProcesses qua
// validateAndPrepareCreate()/createForCollection() -> hook copy field cá nhân sang employeeProfiles
// DRAFT vừa đặt chỗ (processId/onboardingQueueStatus/currentAddress/nationalId/.../educationEntry).
//
// LÝ DO TÁCH: route nhập Excel hàng loạt mới (POST /api/records/hrProcesses/apply-create-import, xem
// routes/records.js) cần tạo NHIỀU bản ghi hrProcesses/ONBOARDING, mỗi dòng phải đi qua ĐÚNG chuỗi xử lý
// này (không có đường tắt bỏ qua business rule, đúng tinh thần "KHÔNG viết lại business rule mới" đã áp
// dụng cho mọi tính năng Nhập Excel Tạo Mới trước đây — xem lib/laborContractCreateImport.js). Thay vì
// copy-paste lại ~90 dòng logic (rủi ro lệch nhau dần theo thời gian), tách thành 1 hàm DÙNG CHUNG — cả
// route tạo tay đơn lẻ (routes/create.js) LẪN route nhập Excel hàng loạt đều gọi ĐÚNG hàm này.
//
// routes/create.js đã được sửa để gọi hàm này thay cho đoạn code inline cũ — hành vi route tạo tay đơn lẻ
// giữ NGUYÊN 100% (xem test-hr-process-onboarding-shared-create.js, so sánh trực tiếp kết quả route cũ
// trước/sau khi tách).
'use strict';

const { CREATE_MODULE_CONFIGS, CreateError, validateAndPrepareCreate } = require('./createValidation');
const { createForCollection, createForCollectionSerialized, getTrashItems } = require('./recordStore');
const { withLockedAppDataValue } = require('./appData');
const { assertPayloadFileUrlsOwnedByUser } = require('./uploadedFiles');
const employeeProfile = require('./employeeProfile');

// payload: req.body gốc (hoặc 1 object tương đương dựng từ 1 dòng Excel) — HÀM NÀY MUTATE payload.employeeCode
// nếu để trống (giống hệt hành vi cũ ở routes/create.js), nên caller không nên tái sử dụng object này cho
// việc khác sau khi gọi. freshUser/appData: lấy từ req.freshUser / await getAllAppData() như route gốc.
async function createOnboardingProcessRecord(payload, freshUser, appData) {
  const config = CREATE_MODULE_CONFIGS.hrProcesses;
  const trashedItems = await getTrashItems(config.dbKey);

  const clientProvidedEmployeeCode = payload?.employeeCode ? String(payload.employeeCode).trim() : '';
  if (clientProvidedEmployeeCode) {
    const existing = (appData.employeeProfiles || []).find(p => p.employeeCode === clientProvidedEmployeeCode);
    if (!existing) {
      throw new CreateError(400, `Mã Nhân Viên "${clientProvidedEmployeeCode}" không có trong Hồ Sơ Nhân Sự — để TRỐNG ô Mã Nhân Viên nếu đây là nhân viên mới (hệ thống tự sinh mã), hoặc chọn lại đúng hồ sơ cũ qua "Kiểm Tra Nhân Sự Cũ"`);
    }
    const reusableDraft = existing.status === 'DRAFT' && existing.processId == null;
    if (existing.status !== 'INACTIVE' && !reusableDraft) {
      const guidance = existing.status === 'ACTIVE'
        ? `Có thể hồ sơ này đã được Tái Tuyển qua màn Hồ Sơ Nhân Sự trước đó — vui lòng dùng chức năng "Kiểm Tra Nhân Sự Cũ" NGAY TRONG form Onboarding để tái tuyển (giữ đúng quy trình checklist), thay vì bấm Tái Tuyển ở Hồ Sơ Nhân Sự trước rồi mới quay lại đây.`
        : 'Để trống ô Mã Nhân Viên nếu đây là nhân viên mới.';
      throw new CreateError(409, `Mã Nhân Viên "${clientProvidedEmployeeCode}" đang gắn với 1 hồ sơ nhân sự khác đang hoạt động — chỉ tạo Onboarding theo mã cũ cho hồ sơ ĐÃ NGHỈ VIỆC (Tái Tuyển). ${guidance}`);
    }
  }

  // PHÁT HIỆN mức Cao (re-audit lần 4): assertNationalIdNotDuplicated() (gọi bên trong extraValidate()
  // của validateAndPrepareCreate() ngay dưới) trước đây so khớp trên `appData.employeeProfiles` — 1
  // SNAPSHOT đọc đúng 1 LẦN ở ĐẦU request (routes/create.js, TRƯỚC khi vào hàm này), không bao giờ được
  // làm mới. 2 request tạo Onboarding cho 2 ứng viên KHÁC employeeCode nhưng CÙNG 1 số CCCD/CMND, gửi
  // gần như đồng thời, đều đọc được appData.employeeProfiles "chưa ai trùng CCCD" TRƯỚC khi bên nào kịp
  // GHI CCCD của mình xong (việc ghi CCCD vào employeeProfiles chỉ xảy ra SAU KHI hrProcesses đã tạo
  // xong, ở khối withLockedAppDataValue THỨ 2 cũ, tách biệt hẳn) — cả 2 cùng qua được chặn trùng, tạo ra
  // 2 hồ sơ nhân sự khác employeeCode nhưng cùng CCCD. Chỉ thêm getLockKey cho RIÊNG bước tạo hrProcesses
  // (kiểu operationOrders.getLockKey) KHÔNG đủ: nó chỉ serialize bước TẠO, không serialize giữa bước
  // KIỂM TRA (đọc appData.employeeProfiles cũ) và bước GHI CCCD thật (dùng key AppData khác). Mirror
  // ĐÚNG khuôn đã đúng từ trước ở createManualProfile() (routes/employeeProfile.js POST '/' — gọi
  // assertNationalIdNotDuplicated() với `list` là tham số FRESH của CHÍNH withLockedAppDataValue() bao
  // quanh, không phải snapshot appData cũ): gộp cả sinh/dành mã + bước tạo hrProcesses + ghi CCCD sau khi
  // tạo thành MỘT khối `withLockedAppDataValue('employeeProfiles', ...)` DUY NHẤT — mọi lần kiểm tra
  // trùng CCCD LUÔN đọc đúng dữ liệu MỚI NHẤT (đã có CCCD của request trước đó, nếu request đó đã hoàn
  // tất trước khi request này được cấp khoá). withLockedAppDataValue() tự rollback TOÀN BỘ (kể cả mã
  // nhân viên vừa sinh) nếu bất kỳ bước nào bên trong throw (xem transaction thật ở lib/appData.js) —
  // không còn để lại hồ sơ DRAFT "mồ côi" mang mã đã dành nếu tạo hrProcesses thất bại vì lý do khác.
  let record;
  await withLockedAppDataValue('employeeProfiles', async (list) => {
    const arr = Array.isArray(list) ? list : [];

    if (!clientProvidedEmployeeCode) {
      const code = employeeProfile.generateEmployeeCode(arr);
      payload.employeeCode = code;
      arr.push(employeeProfile.createDraftProfileForOnboarding(code, freshUser.username, freshUser.name));
    }

    const freshAppData = { ...appData, employeeProfiles: arr };
    const builderFn = async (hrList) => {
      const rec = validateAndPrepareCreate('hrProcesses', payload, freshUser, hrList, freshAppData, trashedItems);
      await assertPayloadFileUrlsOwnedByUser(rec, freshUser);
      return rec;
    };
    record = config.getLockKey
      ? await createForCollectionSerialized(config.dbKey, config.getLockKey(payload, freshUser), builderFn)
      : await createForCollection(config.dbKey, builderFn);

    const idx = arr.findIndex(p => p.employeeCode === record.employeeCode);
    if (idx !== -1) arr[idx] = {
      ...arr[idx], processId: record.id, onboardingQueueStatus: 'PENDING',
      onboardingQueueCancelReason: null, onboardingQueueCancelledAt: null, onboardingQueueCancelledBy: null
    };
    if (idx !== -1 && (record.currentAddress || record.nationalId || record.gender || record.dateOfBirth
      || record.permanentAddress || record.nationalIdIssueDate || record.nationalIdIssuePlace
      || record.employmentType || record.workSchedule || record.phone || record.email)) {
      const onboardingProfileEdits = {};
      if (record.currentAddress) onboardingProfileEdits.currentAddress = record.currentAddress;
      if (record.nationalId) onboardingProfileEdits.nationalId = record.nationalId;
      if (record.gender) onboardingProfileEdits.gender = record.gender;
      if (record.dateOfBirth) onboardingProfileEdits.dateOfBirth = record.dateOfBirth;
      if (record.permanentAddress) onboardingProfileEdits.permanentAddress = record.permanentAddress;
      if (record.nationalIdIssueDate) onboardingProfileEdits.nationalIdIssueDate = record.nationalIdIssueDate;
      if (record.nationalIdIssuePlace) onboardingProfileEdits.nationalIdIssuePlace = record.nationalIdIssuePlace;
      if (record.employmentType) onboardingProfileEdits.employmentType = record.employmentType;
      if (record.workSchedule) onboardingProfileEdits.workSchedule = record.workSchedule;
      if (record.phone) onboardingProfileEdits.contactPhone = record.phone;
      if (record.email) onboardingProfileEdits.workEmail = record.email;
      employeeProfile.applyProfileEdit(
        arr[idx], onboardingProfileEdits, Object.keys(onboardingProfileEdits),
        freshUser.username, freshUser.name,
        { employmentTypes: appData.employmentTypes, workSchedules: appData.workSchedules, nationalIdIssuePlaces: appData.nationalIdIssuePlaces }
      );
    }
    if (idx !== -1 && record.educationEntry && (!Array.isArray(arr[idx].education) || arr[idx].education.length === 0)) {
      employeeProfile.applyProfileEdit(
        arr[idx], { education: [{ id: require('crypto').randomUUID(), ...record.educationEntry, graduationYear: null }] },
        ['education'], freshUser.username, freshUser.name
      );
    }
    return arr;
  });

  return record;
}

module.exports = { createOnboardingProcessRecord };
