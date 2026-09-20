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
  { collection: 'hrProcesses', fields: ['employeeDept'] },
  // operationOrders/operationStoreOpenings/operationRepairs/operationExecutionPeriods: PHÁT HIỆN THIẾU ở
  // đợt audit chuyên sâu lần 3 — cả 4 collection Vận Hành đều forceOwnDept (snapshot .dept từ người tạo,
  // xem lib/createValidation.js) nhưng bị bỏ sót khỏi danh sách này. 3 collection đầu còn dùng .dept để
  // XÉT QUYỀN XEM (canViewOperationOrder/canViewOperationStoreOpening/canViewOperationRepair ở
  // lib/recordViewScope.js so trực tiếp item.dept === user.dept) — đổi tên phòng ban mà không cascade sẽ
  // làm nhân viên phòng ban đó (không phải người tạo/không phải approver) mất quyền xem hồ sơ vận hành
  // của chính phòng mình sau khi đổi tên.
  { collection: 'operationOrders', fields: ['dept'] },
  { collection: 'operationStoreOpenings', fields: ['dept'] },
  { collection: 'operationRepairs', fields: ['dept'] },
  { collection: 'operationExecutionPeriods', fields: ['dept'] }
];

// *DeptWorkflows: nhiều map cấu hình duyệt theo BƯỚC/PHÒNG BAN nằm rải rác ở AppData, mỗi map khoá
// theo ĐÚNG TÊN phòng ban/siêu thị (dạng {[dept]: <cấu hình bước duyệt>}, xem lib/workflowEngine.js) —
// PHÁT HIỆN THIẾU ở đợt audit chuyên sâu lần 2: cascadeStoreRename() trước đây KHÔNG đổi các map này,
// nên sau khi đổi tên 1 phòng ban/siêu thị, cấu hình duyệt CŨ vẫn còn nằm dưới TÊN CŨ (không ai duyệt
// được hồ sơ nữa, vì hồ sơ mới tạo mang tên MỚI) cho tới khi admin tự tay cấu hình lại từ đầu. Cấu trúc
// BÊN TRONG mỗi map khác nhau (itPriceDeptWorkflows còn lồng thêm cấp RETAIL/WHOLESALE) nhưng TẦNG NGOÀI
// CÙNG luôn là {[dept]: <cấu hình>} nên chỉ cần đổi tên KEY, không cần biết cấu trúc bên trong.
// operationStoreOpenDeptWorkflows/operationRepairDeptWorkflows/operationStoreOpenEstimateDeptWorkflows/
// operationRepairEstimateDeptWorkflows ĐÃ XOÁ khỏi danh sách này — Vận Hành > Siêu Thị (Mở Mới/Sửa Chữa,
// cả 2 giai đoạn Dự toán lẫn hồ sơ chính) không còn bước phê duyệt nào cả, các map cấu hình đó không còn
// tồn tại trong defaults.js nữa (xem lib/workflowEngine.js MODULE_CONFIGS + WF_MODULE_CONFIG ở
// module-workflow.js) — không còn màn cấu hình nào đọc lại dữ liệu này để cần cascade đổi tên nữa.
// 'deptWorkflows' (map duyệt TÀI LIỆU theo phòng ban — xem MODULE_CONFIGS.docs.resolveWfConfig ở
// lib/workflowEngine.js, `appData.deptWorkflows?.[item.dept]`): BỊ SÓT khỏi danh sách này cho tới đợt
// audit chuyên sâu cụm "Văn Bản Trình/Hợp Đồng/Giấy Phép/Thanh Toán/Tài Liệu" — đây là map DUY NHẤT
// không mang hậu tố "<module>DeptWorkflows" nên dễ bị bỏ quên khi rà theo tên. Hậu quả y hệt 10 map
// còn lại: đổi tên 1 phòng ban xong, cấu hình duyệt Tài Liệu của phòng đó vẫn nằm dưới TÊN CŨ ->
// tài liệu mới (mang tên MỚI) rơi về cấu hình mặc định, không ai duyệt được cho tới khi admin tự cấu
// hình lại từ đầu. Hàm cascadeDeptWorkflowMaps() bên dưới vốn đã tổng quát (chỉ đổi tên KEY tầng ngoài
// cùng), nên chỉ cần khai thêm đúng 1 khoá ở đây.
const DEPT_WORKFLOW_MAP_KEYS = [
  'deptWorkflows',
  'submissionDeptWorkflows', 'contractApprovalDeptWorkflows', 'contractManageDeptWorkflows',
  'carDeptWorkflows', 'officeBuyDeptWorkflows', 'officeFixDeptWorkflows', 'vppDeptWorkflows',
  'itPriceDeptWorkflows', 'budgetDeptWorkflows', 'paymentDeptWorkflows'
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
//     operationOrderReceiptManageStore..., xem scopeAllows() ở lib/recordActions.js) — hàm này generic
//     theo CẤU TRÚC (bất kỳ field nào có .depts là mảng), không cần biết tên field cụ thể, nên đợt "Tách
//     quyền Duyệt Nhập/Hủy Đơn Hàng HO/Siêu Thị" (10/2026, operationOrderReceiptManage cũ → tách thành
//     operationOrderReceiptManageHO boolean + operationOrderReceiptManageStore {all,depts[]}) tự động vẫn
//     đúng không cần sửa gì ở đây — field HO giờ là boolean đơn (không có .depts), không rơi vào nhánh
//     này nữa, còn field Store dùng đúng tên "depts" nên vẫn được cascade-rename như trước.
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

// reportPeriods.deptScope/budgetPeriods.deptScope: {all, depts:[<tên phòng ban thô>]} đặt 1 lần lúc tạo
// kỳ (xem lib/createValidation.js dòng ~1434/2451) — PHÁT HIỆN THIẾU ở đợt audit chuyên sâu lần 3: đổi
// tên 1 phòng ban KHÔNG cascade field này, nên 1 kỳ báo cáo/ngân sách đang mở đã giới hạn theo phòng ban
// cụ thể (không phải "all") sẽ âm thầm chặn (403) nhân viên phòng đó nộp/xem dữ liệu ngay sau khi đổi
// tên, dù kỳ không hề bị admin sửa gì.
function renameDeptScopeDepts(item, oldValue, newValue) {
  if (!item.deptScope || !Array.isArray(item.deptScope.depts) || !item.deptScope.depts.includes(oldValue)) return item;
  return { ...item, deptScope: { ...item.deptScope, depts: item.deptScope.depts.map(d => (d === oldValue ? newValue : d)) } };
}

// operationOrderStoreMixedApprovalRules[].stores[]: "🏬 Quy Trình Đặt Hàng Siêu Thị" (module-workflow.js,
// xem lib/workflowEngine.js resolveOperationOrderStoreMixedApprovalRuleUsernames()) — mỗi dòng NGOẠI LỆ
// (rule.stores không rỗng) khai rõ danh sách siêu thị/phòng ban phụ trách, so khớp CHUỖI THÔ với
// item.dept của đơn hàng — PHÁT HIỆN NGHIÊM TRỌNG ở đợt audit chuyên sâu 12 cụm: trước đây cascade rename
// bỏ sót hẳn field này, nên đổi tên 1 siêu thị/phòng ban làm người phụ trách theo dòng ngoại lệ đó MẤT
// quyền duyệt đơn của đúng siêu thị/phòng ban vừa đổi tên (rule.stores vẫn giữ TÊN CŨ, không còn khớp
// item.dept mang TÊN MỚI).
function renameMixedApprovalRuleStores(rule, oldValue, newValue) {
  if (!Array.isArray(rule.stores) || !rule.stores.includes(oldValue)) return rule;
  return { ...rule, stores: rule.stores.map(s => (s === oldValue ? newValue : s)) };
}
async function cascadeMixedApprovalRuleStores(oldValue, newValue) {
  await withLockedAppDataValue('operationOrderStoreMixedApprovalRules', (list) =>
    (list || []).map(r => renameMixedApprovalRuleStores(r, oldValue, newValue)));
}

// operationOrderStoreMixedApprovalRules[].jobTitle: dòng mode 'JOBTITLE' — jobTitle có thể đến từ CẢ 2
// danh mục (HO lẫn Siêu Thị, xem mixedApprovalJobTitleOptions() ở module-workflow.js: "🔀 lọc hỗn hợp
// chức danh HO/Siêu Thị"), so khớp phẳng bằng CHUỖI, không phân biệt nguồn — PHÁT HIỆN NGHIÊM TRỌNG ở đợt
// audit chuyên sâu 12 cụm: trước đây cascadeJobTitleRename()/cascadeStoreJobTitleRename() bỏ sót hẳn field
// này, nên đổi tên 1 chức danh (HO hoặc Siêu Thị) làm rule.jobTitle tra ra TÊN CŨ -> 0 approver -> mọi đơn
// "Đặt Hàng Tại Siêu Thị" PENDING/mới tạo ở bước đó không ai (ngoài Admin) duyệt được. Dùng CHUNG 1 hàm
// cho cả 2 danh mục (không cần biết jobTitle thuộc HO hay Siêu Thị — resolver cũng không phân biệt).
function renameMixedApprovalRuleJobTitle(rule, oldValue, newValue) {
  if (rule.mode !== 'JOBTITLE' || rule.jobTitle !== oldValue) return rule;
  return { ...rule, jobTitle: newValue };
}
async function cascadeMixedApprovalRuleJobTitle(oldValue, newValue) {
  await withLockedAppDataValue('operationOrderStoreMixedApprovalRules', (list) =>
    (list || []).map(r => renameMixedApprovalRuleJobTitle(r, oldValue, newValue)));
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
  await renameFieldValueInCollection('reportPeriods', (item) => renameDeptScopeDepts(item, oldValue, newValue));
  await renameFieldValueInCollection('budgetPeriods', (item) => renameDeptScopeDepts(item, oldValue, newValue));
  await cascadeMixedApprovalRuleStores(oldValue, newValue);
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
  await cascadeMixedApprovalRuleJobTitle(oldValue, newValue);
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
  await cascadeMixedApprovalRuleJobTitle(oldValue, newValue);
  await withLockedAppDataValue('orgChartVersions', (list) => {
    const { renameJobTitleInAllVersions } = require('./orgChart');
    return renameJobTitleInAllVersions(list, oldValue, newValue, true);
  });
}

// deptAbbrs/docCatAbbrs: 2 map {tên -> viết tắt} khoá theo ĐÚNG tên phòng ban/loại tài liệu (xem
// getDeptAbbr()/getDocCatAbbr() ở core.js) — đổi tên mà không dời KEY của map này sẽ làm viết tắt "rơi
// mất" (vẫn còn dữ liệu dưới tên CŨ, tra theo tên MỚI ra rỗng, generateDocCode()/generateMaDoc() tự lùi
// về suy luận mặc định thay vì giữ đúng viết tắt admin đã đặt tay).
async function renameAbbrMapKey(appDataKey, oldValue, newValue) {
  await withLockedAppDataValue(appDataKey, (map) => {
    if (!map || typeof map !== 'object' || !(oldValue in map)) return map;
    const next = { ...map };
    next[newValue] = next[oldValue];
    delete next[oldValue];
    return next;
  });
}

// depts (Phòng Ban, khối Văn Phòng/HO): dùng CHUNG hạ tầng cascade với stores — user.dept/mọi collection
// ở DEPT_FIELD_COLLECTIONS đều lưu chung 1 field cho CẢ tên phòng ban lẫn tên siêu thị (phân biệt bằng
// posType, xem chú thích cascadeStoreRename() ở trên) nên tái dùng NGUYÊN cascadeStoreRename(), chỉ thêm
// bước dời key deptAbbrs (Siêu Thị không có "viết tắt" riêng nên cascadeStoreRename() không cần bước này).
async function cascadeDeptRename(oldValue, newValue) {
  await cascadeStoreRename(oldValue, newValue);
  await renameAbbrMapKey('deptAbbrs', oldValue, newValue);
}

// cats (Phân Loại Tài Liệu): PHẠM VI HẸP hơn nhiều so với depts/stores — chỉ 1 collection (docs.cat,
// xem lib/createValidation.js MODULE_CONFIGS.docs) + 1 map viết tắt (docCatAbbrs) tham chiếu tới giá trị
// này, không lan ra users/*DeptWorkflows/orgChart như phòng ban/siêu thị.
async function cascadeCatRename(oldValue, newValue) {
  await renameFieldValueInCollection('docs', (item) => renameSimpleFields(item, ['cat'], oldValue, newValue));
  await renameAbbrMapKey('docCatAbbrs', oldValue, newValue);
}

// Factory cho các danh mục CHUỖI PHẲNG đơn giản KHÔNG cần cascade — giá trị hiển thị (KHÔNG phải khoá
// định danh/FK bắt buộc khớp) có thể được tham chiếu bởi 1-2 collection khác (VD carRegs.assignedTaxiCompany,
// itPriceApprovals.priceZone) nhưng hồ sơ ĐÃ TẠO trước đó chỉ đơn giản giữ nguyên chuỗi cũ làm nhãn hiển
// thị (KHÔNG "gãy" tham chiếu gì — không có logic nào so khớp ngược lại danh mục để xác thực), cùng
// đánh đổi đã áp dụng từ trước cho "cats" cho tới đợt này (docs.cat CŨ cũng không tự cascade cho tới khi
// thêm hẳn cascadeCatRename() ở trên — nay cats đã lên hẳn cascade đầy đủ, còn 4 danh mục dưới đây vẫn
// giữ đánh đổi "không cascade" vì phạm vi tham chiếu hẹp/không có ý nghĩa bảo mật-phân quyền như dept).
function simpleArrayCatalogHandler(dbKey, label) {
  return {
    async renameInCatalog(oldValue, newValue) {
      return withLockedAppDataValue(dbKey, (list) => {
        const arr = Array.isArray(list) ? list : [];
        if (!arr.includes(oldValue)) throw new HttpError(404, `Không tìm thấy "${oldValue}" trong ${label}`);
        if (arr.includes(newValue)) throw new HttpError(400, `"${newValue}" đã có trong ${label}`);
        return arr.map((v) => (v === oldValue ? newValue : v));
      });
    },
    cascade: async () => {} // không cascade — xem chú thích simpleArrayCatalogHandler() ở trên
  };
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
  depts: {
    async renameInCatalog(oldValue, newValue) {
      return withLockedAppDataValue('depts', (list) => {
        const arr = Array.isArray(list) ? list : [];
        if (!arr.includes(oldValue)) throw new HttpError(404, `Không tìm thấy "${oldValue}" trong Danh Mục Phòng Ban`);
        if (arr.includes(newValue)) throw new HttpError(400, `"${newValue}" đã có trong Danh Mục Phòng Ban`);
        return arr.map(d => (d === oldValue ? newValue : d));
      });
    },
    cascade: cascadeDeptRename
  },
  cats: {
    async renameInCatalog(oldValue, newValue) {
      return withLockedAppDataValue('cats', (list) => {
        const arr = Array.isArray(list) ? list : [];
        if (!arr.includes(oldValue)) throw new HttpError(404, `Không tìm thấy "${oldValue}" trong Phân Loại Tài Liệu`);
        if (arr.includes(newValue)) throw new HttpError(400, `"${newValue}" đã có trong Phân Loại Tài Liệu`);
        return arr.map(c => (c === oldValue ? newValue : c));
      });
    },
    cascade: cascadeCatRename
  },
  licenseTypes: simpleArrayCatalogHandler('licenseTypes', 'Các Loại Giấy Phép'),
  carTaxiCompanies: simpleArrayCatalogHandler('carTaxiCompanies', 'Danh Mục Hãng Taxi'),
  priceZones: simpleArrayCatalogHandler('priceZones', 'Danh Mục Vùng Giá Áp Dụng'),
  trainingCategories: simpleArrayCatalogHandler('trainingCategories', 'Danh Mục Loại Đào Tạo'),
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
