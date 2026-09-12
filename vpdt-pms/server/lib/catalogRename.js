// lib/catalogRename.js — Đổi tên (rename) 1 giá trị trong danh mục "stores"/"jobTitles"/"storeJobTitles"
// KÈM cascade cập nhật mọi nơi đang lưu nguyên chuỗi cũ — dùng bởi POST /api/admin/renameCatalogEntry
// (routes/adminCatalog.js). Khác các route CRUD danh mục đơn giản khác (saveStore()/saveJobTitle() ở
// index.html chỉ POST /api/data/<key> ghi đè cả mảng, không cascade) — RENAME cần route riêng vì
// stores/jobTitles là mảng CHUỖI THÔ (khác contractTypes/carTypes có {key,label} ổn định — đổi label
// không cần cascade vì mọi nơi tra theo "key", không theo chuỗi hiển thị).
const { withLockedAppDataValue } = require('./appData');
const { renameFieldValueInCollection } = require('./recordStore');
const { HttpError } = require('./httpErrors');

// Mọi collection ĐÃ XÁC NHẬN (grep lib/createValidation.js/lib/recordActions.js lúc viết route này, xem
// PR mô tả) có field mang tên PHÒNG BAN/SIÊU THỊ (giá trị lấy chung từ DB.depts hoặc DB.stores) — danh
// sách này là danh sách ĐẦY ĐỦ tại thời điểm viết, không phải danh sách khởi điểm còn phải đoán thêm.
// Có 2 collection phát hiện thêm NGOÀI danh sách khởi điểm nêu trong kế hoạch gốc (đều lưu nguyên chuỗi
// tên siêu thị, đối chiếu DB.depts + DB.stores gộp chung — xem lib/createValidation.js):
// - recruitmentJobs.hiringDept ("Đơn Vị/Siêu Thị Đăng Tuyển", Bản Tin Tuyển Dụng)
// - trainingPlans.targetDept ("Đơn Vị Nhắm Tới", Kế Hoạch Đào Tạo)
const DEPT_FIELD_COLLECTIONS = [
  { collection: 'docs', fields: ['dept'] },
  { collection: 'submissions', fields: ['dept'] },
  { collection: 'carRegs', fields: ['dept'] },
  { collection: 'officeReqs', fields: ['dept'] },
  { collection: 'contracts', fields: ['dept', 'custodianDept'] },
  { collection: 'vppRegistrations', fields: ['dept'] },
  { collection: 'itPriceApprovals', fields: ['dept'] },
  { collection: 'budgetEntries', fields: ['dept'] },
  { collection: 'uniformIssuances', fields: ['dept'] },
  { collection: 'uniformStockAdjustments', fields: ['dept'] },
  { collection: 'uniformTransfers', fields: ['sourceDept', 'targetDept'] },
  { collection: 'recruitmentJobs', fields: ['hiringDept'] },
  { collection: 'trainingPlans', fields: ['targetDept'] },
  // paymentRequests/laborContracts: PHÁT HIỆN THIẾU ở đợt audit chuyên sâu — cả 2 đều lưu field .dept
  // (paymentRequests: phòng ban đề nghị, khớp DEPT_FIELD_COLLECTIONS.contracts kiểu cũ; laborContracts:
  // forceOwnDept ép theo phòng ban người tạo, xem lib/createValidation.js dòng ~3052) nhưng bị bỏ sót
  // khỏi danh sách này — đổi tên 1 phòng ban KHÔNG cascade sang 2 collection này, để lại giá trị dept CŨ
  // (không còn khớp DB.depts nào) trên các hồ sơ đã tạo trước đó.
  { collection: 'paymentRequests', fields: ['dept'] },
  { collection: 'laborContracts', fields: ['dept'] },
  // meetings/hrProcesses: PHÁT HIỆN THIẾU ở đợt audit chuyên sâu lần 2 — cùng dạng thiếu sót như
  // paymentRequests/laborContracts ở trên (meetings.dept: phòng ban đặt phòng họp; hrProcesses.employeeDept:
  // snapshot phòng ban của nhân viên lúc tạo quy trình Onboarding/Offboarding).
  { collection: 'meetings', fields: ['dept'] },
  { collection: 'hrProcesses', fields: ['employeeDept'] }
];

// *DeptWorkflows: nhiều map cấu hình duyệt theo BƯỚC/PHÒNG BAN nằm rải rác ở AppData, mỗi map khoá
// theo ĐÚNG TÊN phòng ban/siêu thị (dạng {[dept]: <cấu hình bước duyệt>}, xem lib/workflowEngine.js) —
// PHÁT HIỆN THIẾU ở đợt audit chuyên sâu lần 2: cascadeStoreRename() trước đây KHÔNG đổi các map này,
// nên sau khi đổi tên 1 phòng ban/siêu thị, cấu hình duyệt CŨ vẫn còn nằm dưới TÊN CŨ (không ai duyệt
// được hồ sơ nữa, vì hồ sơ mới tạo mang tên MỚI) cho tới khi admin tự tay cấu hình lại từ đầu. Cấu trúc
// BÊN TRONG mỗi map khác nhau (itPriceDeptWorkflows còn lồng thêm cấp RETAIL/WHOLESALE) nhưng TẦNG NGOÀI
// CÙNG luôn là {[dept]: <cấu hình>} nên chỉ cần đổi tên KEY, không cần biết cấu trúc bên trong.
// operationStoreOpenDeptWorkflows/operationRepairDeptWorkflows: 2 map CŨ không còn route/logic nào đọc
// tới (xem chú thích ở lib/workflowEngine.js — quy trình duyệt hồ sơ chính operationStoreOpenings/
// operationRepairs đã bỏ hẳn phê duyệt) — vẫn cascade cho ĐỒNG BỘ dữ liệu (admin vẫn xem lại được ở màn
// cấu hình cũ), không có tác dụng phụ nào khác vì không route nào tiêu thụ.
const DEPT_WORKFLOW_MAP_KEYS = [
  'submissionDeptWorkflows', 'contractApprovalDeptWorkflows', 'contractManageDeptWorkflows',
  'carDeptWorkflows', 'officeBuyDeptWorkflows', 'officeFixDeptWorkflows', 'vppDeptWorkflows',
  'itPriceDeptWorkflows', 'budgetDeptWorkflows', 'paymentDeptWorkflows',
  'operationStoreOpenEstimateDeptWorkflows', 'operationRepairEstimateDeptWorkflows',
  'operationStoreOpenDeptWorkflows', 'operationRepairDeptWorkflows'
];

async function cascadeDeptWorkflowMaps(oldValue, newValue) {
  for (const mapKey of DEPT_WORKFLOW_MAP_KEYS) {
    await withLockedAppDataValue(mapKey, (map) => {
      if (!map || typeof map !== 'object' || !(oldValue in map)) return map;
      const next = { ...map };
      next[newValue] = next[oldValue];
      delete next[oldValue];
      return next;
    });
  }
}

// users[].perms.*: nhiều quyền phẳng giới hạn theo danh sách phòng ban/siêu thị, dưới 2 khuôn khác nhau
// — PHÁT HIỆN THIẾU ở đợt audit chuyên sâu lần 2, cascadeStoreRename() trước đây bỏ sót hẳn users.perms:
//  1) mảng chuỗi phẳng, tên quyền kết thúc bằng "Depts" (viewApprovedDepts/viewDraftDepts/uploadDepts...).
//  2) object {all, depts:[...]} (contractCreate/officeCreate/carCreate/submissionCreate/meetingBookScope/
//     operationOrderReceiptManage..., xem scopeAllows() ở lib/recordActions.js) — "depts" ở khuôn này có
//     thể lẫn sentinel không phải tên phòng ban thật (VD 'HO' của operationOrderReceiptManage) nhưng so
//     trực tiếp === oldValue vẫn an toàn (không trùng bất kỳ tên phòng ban/siêu thị thật nào).
function renameDeptInUserPerms(perms, oldValue, newValue) {
  if (!perms || typeof perms !== 'object') return perms;
  let changed = false;
  const next = {};
  for (const [key, val] of Object.entries(perms)) {
    if (Array.isArray(val) && key.endsWith('Depts') && val.includes(oldValue)) {
      next[key] = val.map(d => (d === oldValue ? newValue : d));
      changed = true;
    } else if (val && typeof val === 'object' && !Array.isArray(val) && Array.isArray(val.depts) && val.depts.includes(oldValue)) {
      next[key] = { ...val, depts: val.depts.map(d => (d === oldValue ? newValue : d)) };
      changed = true;
    } else {
      next[key] = val;
    }
  }
  return changed ? next : perms;
}

async function cascadeUserPermsDepts(oldValue, newValue) {
  await withLockedAppDataValue('users', (list) => (list || []).map(u => {
    const nextPerms = renameDeptInUserPerms(u.perms, oldValue, newValue);
    return nextPerms === u.perms ? u : { ...u, perms: nextPerms };
  }));
}

function renameSimpleFields(item, fields, oldValue, newValue) {
  let changed = false;
  const next = { ...item };
  for (const f of fields) {
    if (next[f] === oldValue) { next[f] = newValue; changed = true; }
  }
  return changed ? next : item;
}

// uniformPeriods: KHÔNG có field .dept ở cấp bản ghi chính — nằm SÂU trong allocations[].dept (mỗi kỳ
// cấp phát có nhiều dòng phân bổ, mỗi dòng gắn 1 siêu thị, xem lib/createValidation.js sanitizeUniformItems()).
function renameUniformPeriodAllocations(item, oldValue, newValue) {
  if (!Array.isArray(item.allocations) || !item.allocations.some(a => a?.dept === oldValue)) return item;
  return { ...item, allocations: item.allocations.map(a => (a?.dept === oldValue ? { ...a, dept: newValue } : a)) };
}

// employeeProfiles: collection AppData (KHÔNG phải dbo.Records, khác mọi collection ở DEPT_FIELD_COLLECTIONS
// — cùng lý do users ở trên phải tự withLockedAppDataValue riêng thay vì renameFieldValueInCollection())
// — PHÁT HIỆN THIẾU ở đợt audit chuyên sâu lần 2: cascade rename bỏ sót hẳn Hồ Sơ Nhân Sự, để lại
// profile.dept/.jobTitle mang TÊN CŨ dù tài khoản liên kết (DB.users) đã được cascade đúng ở trên — 2
// nguồn dữ liệu lệch nhau (module Hồ Sơ Nhân Sự đọc thẳng profile.dept/.jobTitle, KHÔNG đọc lại qua
// user liên kết, xem lib/employeeProfile.js).
async function cascadeEmployeeProfilesDept(oldValue, newValue) {
  await withLockedAppDataValue('employeeProfiles', (list) => (list || []).map(p =>
    (p.dept === oldValue ? { ...p, dept: newValue } : p)
  ));
}

async function cascadeEmployeeProfilesJobTitle(oldValue, newValue, isStore) {
  await withLockedAppDataValue('employeeProfiles', (list) => (list || []).map(p => {
    const matchesScope = isStore ? p.posType === 'STORE' : p.posType !== 'STORE';
    return (p.jobTitle === oldValue && matchesScope) ? { ...p, jobTitle: newValue } : p;
  }));
}

async function cascadeStoreRename(oldValue, newValue) {
  // user.dept dùng CHUNG 1 field cho cả tên phòng ban (HO) lẫn tên siêu thị (phân biệt bằng posType) —
  // so trực tiếp giá trị, không cần lọc posType (1 dept/store name không thể vừa là tên phòng ban vừa
  // là tên siêu thị cùng lúc trong thực tế vận hành).
  await withLockedAppDataValue('users', (list) => (list || []).map(u => (u.dept === oldValue ? { ...u, dept: newValue } : u)));
  await cascadeEmployeeProfilesDept(oldValue, newValue);
  await cascadeUserPermsDepts(oldValue, newValue);
  await cascadeDeptWorkflowMaps(oldValue, newValue);
  for (const { collection, fields } of DEPT_FIELD_COLLECTIONS) {
    await renameFieldValueInCollection(collection, (item) => renameSimpleFields(item, fields, oldValue, newValue));
  }
  await renameFieldValueInCollection('uniformPeriods', (item) => renameUniformPeriodAllocations(item, oldValue, newValue));
  await withLockedAppDataValue('orgChartVersions', (list) => {
    const { renameDepartmentRefInAllVersions } = require('./orgChart'); // require trễ — tránh vòng lặp require
    return renameDepartmentRefInAllVersions(list, oldValue, newValue);
  });
}

// jobTitles (Khối Văn Phòng/HO): cascade users[].jobTitle CHỈ cho user KHÔNG phải posType STORE
// (posType STORE dùng danh mục storeJobTitles riêng, xem cascadeStoreJobTitleRename() bên dưới) +
// vppExcludedJobTitles[] (mảng chuỗi phẳng, so khớp chuỗi thô, xem isUserVppExcluded() ở index.html).
// KHÔNG còn cascade vppExcludeGroups[].jobTitles[] (DẠNG CŨ) — key đó vẫn còn trong AppData nhưng
// không còn được đọc/ghi ở đâu trong code mới, xem migrateVppExcludedJobTitles() ở seedDefaults.js.
async function cascadeJobTitleRename(oldValue, newValue) {
  await withLockedAppDataValue('users', (list) => (list || []).map(u =>
    (u.jobTitle === oldValue && u.posType !== 'STORE') ? { ...u, jobTitle: newValue } : u
  ));
  await withLockedAppDataValue('vppExcludedJobTitles', (list) => (list || []).map(jt => (jt === oldValue ? newValue : jt)));
  await cascadeEmployeeProfilesJobTitle(oldValue, newValue, false);
  await withLockedAppDataValue('orgChartVersions', (list) => {
    const { renameJobTitleInAllVersions } = require('./orgChart');
    return renameJobTitleInAllVersions(list, oldValue, newValue, false);
  });
}

// storeJobTitles (Siêu Thị, mục 4a): cascade users[].jobTitle CHỈ cho posType === 'STORE'.
async function cascadeStoreJobTitleRename(oldValue, newValue) {
  await withLockedAppDataValue('users', (list) => (list || []).map(u =>
    (u.jobTitle === oldValue && u.posType === 'STORE') ? { ...u, jobTitle: newValue } : u
  ));
  await cascadeEmployeeProfilesJobTitle(oldValue, newValue, true);
  await withLockedAppDataValue('orgChartVersions', (list) => {
    const { renameJobTitleInAllVersions } = require('./orgChart');
    return renameJobTitleInAllVersions(list, oldValue, newValue, true);
  });
}

const CATALOG_HANDLERS = {
  stores: {
    async renameInCatalog(oldValue, newValue) {
      return withLockedAppDataValue('stores', (list) => {
        const arr = Array.isArray(list) ? list : [];
        if (!arr.includes(oldValue)) throw new HttpError(404, `Không tìm thấy "${oldValue}" trong Danh Mục Siêu Thị`);
        if (arr.includes(newValue)) throw new HttpError(400, `"${newValue}" đã có trong Danh Mục Siêu Thị`);
        return arr.map(s => (s === oldValue ? newValue : s));
      });
    },
    cascade: cascadeStoreRename
  },
  jobTitles: {
    async renameInCatalog(oldValue, newValue) {
      return withLockedAppDataValue('jobTitles', (list) => {
        const arr = Array.isArray(list) ? list : [];
        if (!arr.includes(oldValue)) throw new HttpError(404, `Không tìm thấy "${oldValue}" trong Danh Sách Chức Danh`);
        if (arr.includes(newValue)) throw new HttpError(400, `"${newValue}" đã có trong Danh Sách Chức Danh`);
        return arr.map(t => (t === oldValue ? newValue : t));
      });
    },
    cascade: cascadeJobTitleRename
  },
  storeJobTitles: {
    async renameInCatalog(oldValue, newValue) {
      return withLockedAppDataValue('storeJobTitles', (list) => {
        const arr = Array.isArray(list) ? list : [];
        const idx = arr.findIndex(t => t?.label === oldValue);
        if (idx === -1) throw new HttpError(404, `Không tìm thấy "${oldValue}" trong Danh Sách Chức Danh (Siêu Thị)`);
        if (arr.some((t, i) => i !== idx && t?.label === newValue)) throw new HttpError(400, `"${newValue}" đã có trong Danh Sách Chức Danh (Siêu Thị)`);
        return arr.map((t, i) => (i === idx ? { ...t, label: newValue } : t));
      });
    },
    cascade: cascadeStoreJobTitleRename
  }
};

// oldValue/newValue: chuỗi đã trim, khác rỗng, khác nhau (validate ở route trước khi gọi tới đây).
async function renameCatalogEntry(catalogKey, oldValue, newValue) {
  const handler = CATALOG_HANDLERS[catalogKey];
  if (!handler) throw new HttpError(400, `Danh mục không hợp lệ: ${catalogKey}`);
  const updatedCatalog = await handler.renameInCatalog(oldValue, newValue);
  await handler.cascade(oldValue, newValue);
  return updatedCatalog;
}

module.exports = { renameCatalogEntry };
