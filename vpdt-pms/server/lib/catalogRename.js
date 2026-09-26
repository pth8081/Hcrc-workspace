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
  { collection: 'operationExecutionPeriods', fields: ['dept'] },
  // budgetLines (Ngân Sách 2.0, v23.0 — thay thế budgetEntries cho MỌI màn nhập liệu mới): PHÁT HIỆN
  // THIẾU ở đợt audit chuyên sâu 9/2026 (gộp từ cụm Vận Hành, cùng lúc cụm Hệ Thống/Admin/Cấu Hình) —
  // budgetEntries (module CŨ) đã có mặt ở trên nhưng budgetLines (module MỚI) thì KHÔNG. Collection này
  // lưu CẢ 2 field cần cascade: "dept" (Khối Phòng Ban) VÀ "location" ("Vị trí" — 'HO' hoặc TÊN 1 siêu
  // thị, xem lib/createValidation.js budgetLines.extraValidate — dept = location khi Vị trí khác 'HO').
  // Không cascade: canViewBudgetLine() (lib/recordViewScope.js) so item.dept === user.dept -> nhân viên
  // mất quyền xem dòng ngân sách cũ của chính mình sau khi đổi tên; addBudgetLineChild()/
  // updateBudgetLineUsedParent() (lib/recordActions.js) đòi khớp parent.dept/location -> không ghi Sử
  // Dụng được, hoặc bị từ chối vì location không còn khớp DB.stores. Cơ chế `fields` (mảng) ở đây VỐN ĐÃ
  // hỗ trợ nhiều field/collection (xem contracts ở trên: ['dept','custodianDept']) nên chỉ cần khai thêm
  // đúng 1 dòng, không cần sửa renameSimpleFields()/renameFieldValueInCollection().
  { collection: 'budgetLines', fields: ['dept', 'location'] }
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

// Đổi tên đúng 1 KEY tầng ngoài cùng của 1 map AppData dạng {[dept]: <bất kỳ giá trị gì>} — tách riêng
// khỏi cascadeDeptWorkflowMaps() để dùng lại được cho cả map KHÔNG phải cấu hình duyệt (VD
// contractExpiryDeptContacts bên dưới, xem DEPT_KEYED_APPDATA_MAP_KEYS).
async function renameTopLevelDeptKey(mapKey, oldValue, newValue) {
  await withLockedAppDataValue(mapKey, (map) => {
    if (!map || typeof map !== 'object' || !(oldValue in map)) return map;
    const next = { ...map };
    next[newValue] = next[oldValue];
    delete next[oldValue];
    return next;
  });
}

async function cascadeDeptWorkflowMaps(oldValue, newValue) {
  for (const mapKey of DEPT_WORKFLOW_MAP_KEYS) {
    await renameTopLevelDeptKey(mapKey, oldValue, newValue);
  }
}

// contractExpiryDeptContacts: {[dept]: [{name,email}]} — người phụ trách phòng ban NHẬN EMAIL nhắc hạn
// hợp đồng (xem jobs/contractExpiryReminder.js) — CÙNG hình dạng {dept: value} như *DeptWorkflows ở trên
// (chỉ khác value là mảng liên hệ, không phải cấu hình duyệt) nên tái dùng ĐÚNG renameTopLevelDeptKey().
// PHÁT HIỆN THIẾU ở đợt audit chuyên sâu 9/2026 (cụm Hệ Thống/Admin/Cấu Hình): đổi tên 1 phòng ban KHÔNG
// cascade map này — người phụ trách phòng đó ÂM THẦM ngừng nhận email nhắc hạn hợp đồng (không có lỗi/
// cảnh báo nào hiện ra). Tách RIÊNG khỏi DEPT_WORKFLOW_MAP_KEYS (không phải map "duyệt" thật, không cần
// bị cuốn theo cascadePositionPairs() quét approversByPosition bên trong — value ở đây chỉ là
// {name,email}, không có field đó).
const DEPT_KEYED_APPDATA_MAP_KEYS = ['contractExpiryDeptContacts'];

async function cascadeDeptKeyedAppDataMaps(oldValue, newValue) {
  for (const mapKey of DEPT_KEYED_APPDATA_MAP_KEYS) {
    await renameTopLevelDeptKey(mapKey, oldValue, newValue);
  }
}

// submissionTypeDeptWorkflows: {typeKey: {dept: cfg}} — LỒNG SÂU HƠN 1 CẤP so với mọi map trong
// DEPT_WORKFLOW_MAP_KEYS (key TẦNG NGOÀI CÙNG là typeKey — loại tờ trình — KHÔNG phải dept, nên
// renameTopLevelDeptKey()/cascadeDeptWorkflowMaps() không đổi được key `dept` nằm ở TẦNG 2). PHÁT HIỆN
// mức Cao ở đợt audit chuyên sâu 9/2026 (cụm Hệ Thống/Admin/Cấu Hình): map này CÓ mặt trong
// POSITION_PAIR_CONFIG_MAP_KEYS (cascade cặp jobTitle/dept BÊN TRONG approversByPosition của mỗi cfg,
// xem cascadePositionPairs() bên dưới) nhưng KHÔNG có trong DEPT_WORKFLOW_MAP_KEYS — khoá `dept` tầng 2
// (typeMap[dept] = cfg, xem lib/workflowEngine.js getSubmissionDeptWorkflowConfig()) không được dời khi
// đổi tên phòng ban, dù chính cfg BÊN TRONG đã được cascade đúng approversByPosition. Hậu quả: sau khi
// đổi tên 1 phòng ban, cấu hình quy trình RIÊNG theo loại tờ trình (nếu có) của phòng đó vẫn nằm dưới
// TÊN CŨ -> tờ trình mới (mang tên MỚI) rơi về fallback submissionDeptWorkflows/mặc định, bỏ qua cấu
// hình riêng theo loại đã đặt tay.
const NESTED_DEPT_WORKFLOW_MAP_KEYS = ['submissionTypeDeptWorkflows'];

async function cascadeNestedDeptWorkflowMaps(oldValue, newValue) {
  for (const mapKey of NESTED_DEPT_WORKFLOW_MAP_KEYS) {
    await withLockedAppDataValue(mapKey, (outer) => {
      if (!outer || typeof outer !== 'object') return outer;
      let changed = false;
      const next = {};
      for (const [typeKey, inner] of Object.entries(outer)) {
        if (inner && typeof inner === 'object' && !Array.isArray(inner) && (oldValue in inner)) {
          const nextInner = { ...inner };
          nextInner[newValue] = nextInner[oldValue];
          delete nextInner[oldValue];
          next[typeKey] = nextInner;
          changed = true;
        } else {
          next[typeKey] = inner;
        }
      }
      return changed ? next : outer;
    });
  }
}

// workflowParticipatingDepts: MẢNG chuỗi tên phòng ban (KHÔNG phải map {dept: value} như các danh mục ở
// trên) — dùng để LỌC BỚT danh sách phòng ban hiện ở màn "🔄 Quy Trình & Phê Duyệt" (khối 17 "Nhóm
// Quyền Đặc Biệt", xem getWorkflowParticipatingDepts() ở module-admin-specialperm.js). PHÁT HIỆN THIẾU
// ở đợt audit chuyên sâu 9/2026 (cụm Hệ Thống/Admin/Cấu Hình): đổi tên 1 phòng ban không cập nhật GIÁ
// TRỊ trong mảng này — phòng ban đó biến mất khỏi màn cấu hình (mảng vẫn giữ TÊN CŨ, không còn khớp
// DB.depts/DB.stores nào) dù cấu hình duyệt bên trong (*DeptWorkflows) đã được cascade đúng tên MỚI.
async function cascadeWorkflowParticipatingDepts(oldValue, newValue) {
  await withLockedAppDataValue('workflowParticipatingDepts', (list) =>
    (Array.isArray(list) ? list.map(d => (d === oldValue ? newValue : d)) : list));
  // workflowParticipatingDeptGroups (10/2026, thay thế danh sách phẳng ở trên bằng NHIỀU NHÓM — xem
  // defaults.js): mỗi nhóm mang 1 mảng `depts` CÙNG khuôn (mảng chuỗi tên phòng ban) — cascade y hệt,
  // chỉ khác đi vào ĐÚNG field `depts` của TỪNG phần tử thay vì cả mảng phẳng.
  await withLockedAppDataValue('workflowParticipatingDeptGroups', (groups) =>
    (Array.isArray(groups) ? groups.map(g => (g && Array.isArray(g.depts) && g.depts.includes(oldValue))
      ? { ...g, depts: g.depts.map(d => (d === oldValue ? newValue : d)) }
      : g) : groups));
}

// ===== CẶP (jobTitle, dept) LỒNG BÊN TRONG cấu hình quy trình — "Theo vị trí" (POSITION mode) =====
// PHÁT HIỆN mức Cao ở đợt audit chuyên sâu 12 cụm: cascadeDeptWorkflowMaps() ở trên CHỈ đổi KEY NGOÀI
// CÙNG của các map {[dept]: <cấu hình>} — hoàn toàn KHÔNG đi vào BÊN TRONG cấu hình, nơi bước "Theo vị
// trí" lưu `approversByPosition[stepOrder] = [{jobTitle, dept}]` (xem lib/positionApprovers.js
// resolvePositionApprovers() — so khớp CHUỖI THÔ cả 2 field với u.jobTitle/u.dept). Hậu quả: đổi tên 1
// Phòng Ban/Chức Danh làm mọi bước "Theo vị trí" đang trỏ tới tên CŨ tra ra 0 approver -> bước treo, chỉ
// admin duyệt được (ảnh hưởng nhiều module: Hỗ Trợ IT (Bán Lẻ/Bán Buôn), Ngân Sách, Vận Hành HO/Siêu
// Thị, Tài Liệu, Văn Bản Trình, Xe, VPP, Hợp Đồng, Thanh Toán...). Cùng lớp lỗi ở danh mục
// `workflowParticipatingPositions` ("Vị Trí Tham Gia Quy Trình", khối 17 Quyền Đặc Biệt — mảng
// {jobTitle, dept} admin tự dựng, là NGUỒN CHỌN của chính các picker "Theo vị trí" đó, xem
// module-admin-specialperm.js): không cascade thì cặp cũ biến mất khỏi danh sách gợi ý sau khi đổi tên.
//
// Cấu trúc BÊN TRONG mỗi map KHÁC NHAU tuỳ module (dept -> cfg; dept -> {RETAIL,WHOLESALE} -> cfg;
// typeKey -> dept -> cfg; tierKey -> cfg) nên KHÔNG hardcode đường đi — quét ĐỆ QUY, đổi tên trong MỌI
// map `approversByPosition` tìm thấy ở bất kỳ độ sâu nào (tự đúng luôn cho cấu trúc mới thêm sau này).
// GHI CHÚ SỬA (đợt audit chuyên sâu 9/2026, cụm Hệ Thống/Admin/Cấu Hình, mức Thấp — vô hại về hành vi):
// trước đây khai LẶP LẠI 'deptWorkflows' ở đây kèm chú thích SAI ("deptWorkflows KHÔNG có trong
// DEPT_WORKFLOW_MAP_KEYS") — 'deptWorkflows' THỰC RA đã có mặt ở đúng phần tử ĐẦU TIÊN của
// DEPT_WORKFLOW_MAP_KEYS (xem khai báo ở trên) nên đã được `...DEPT_WORKFLOW_MAP_KEYS` mang vào đây
// rồi, dòng lặp chỉ dư thừa (JS tự loại trùng khi lặp Array, cascadePositionPairs() bên dưới chỉ chạy
// withLockedAppDataValue('deptWorkflows', ...) 2 lần liên tiếp vô hại, không sai kết quả) — xoá dòng dư.
const POSITION_PAIR_CONFIG_MAP_KEYS = [
  ...DEPT_WORKFLOW_MAP_KEYS,
  'submissionTypeDeptWorkflows',        // {typeKey: {dept: cfg}} — lồng SÂU hơn 1 cấp so với các map trên
  'itPriceTierWorkflows',               // {tierKey: cfg} — Hỗ Trợ IT > Bán Buôn (4 mức Margin/Chiết Khấu)
  'operationOrderStoreTierWorkflows',   // {tierKey: cfg} — Vận Hành > Đặt Hàng Tại Siêu Thị
  'operationOrderHOTierWorkflows'       // {tierKey: cfg} — Vận Hành > Đặt Hàng Tại HO
];

// {stepOrder: [{jobTitle, dept}]} — đổi đúng 1 field (jobTitle HOẶC dept) của mọi cặp khớp tên cũ.
// Giữ NGUYÊN reference nếu không có gì đổi (để nhánh đệ quy bên dưới biết có cần clone lên trên không).
function renamePositionPairsMap(map, field, oldValue, newValue) {
  let changed = false;
  const next = {};
  for (const [stepOrder, pairs] of Object.entries(map)) {
    if (!Array.isArray(pairs)) { next[stepOrder] = pairs; continue; }
    let pairChanged = false;
    const nextPairs = pairs.map(p => {
      if (p && typeof p === 'object' && p[field] === oldValue) { pairChanged = true; return { ...p, [field]: newValue }; }
      return p;
    });
    if (pairChanged) changed = true;
    next[stepOrder] = pairChanged ? nextPairs : pairs;
  }
  return changed ? next : map;
}

function renamePositionPairsDeep(node, field, oldValue, newValue) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map(child => {
      const renamed = renamePositionPairsDeep(child, field, oldValue, newValue);
      if (renamed !== child) changed = true;
      return renamed;
    });
    return changed ? next : node;
  }
  let changed = false;
  const next = {};
  for (const [key, val] of Object.entries(node)) {
    const renamed = (key === 'approversByPosition' && val && typeof val === 'object' && !Array.isArray(val))
      ? renamePositionPairsMap(val, field, oldValue, newValue)
      : renamePositionPairsDeep(val, field, oldValue, newValue);
    if (renamed !== val) changed = true;
    next[key] = renamed;
  }
  return changed ? next : node;
}

// field: 'jobTitle' (đổi tên Chức Danh HO/Siêu Thị) hoặc 'dept' (đổi tên Phòng Ban/Siêu Thị).
async function cascadePositionPairs(field, oldValue, newValue) {
  for (const mapKey of POSITION_PAIR_CONFIG_MAP_KEYS) {
    await withLockedAppDataValue(mapKey, (map) => renamePositionPairsDeep(map, field, oldValue, newValue));
  }
  await withLockedAppDataValue('workflowParticipatingPositions', (list) => {
    if (!Array.isArray(list)) return list;
    return list.map(p => (p && typeof p === 'object' && p[field] === oldValue ? { ...p, [field]: newValue } : p));
  });
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

// meetingRooms (Danh Mục Phòng Họp, module Phòng Họp): LỖI ĐÃ VÁ (rà soát chuyên sâu 2, cụm "Hành
// Chính") — khác stores/depts (mảng chuỗi phẳng), meetingRooms là mảng OBJECT {id, name, short}, và
// đổi tên đi qua route generic POST /api/data/meetingRooms (routes/data.js, admin-only) chứ KHÔNG qua
// POST /api/admin/renameCatalogEntry — nên KHÔNG dùng chung CATALOG_HANDLERS bên dưới. meetings.room
// lưu nguyên TÊN phòng (không tham chiếu theo id) và so trùng bằng so chuỗi tuyệt đối (cả lưới lịch lẫn
// findMeetingConflict() chống trùng lịch, xem module-phonghop.js) — đổi tên phòng mà không cascade làm
// lịch CŨ "biến mất" khỏi lưới (không khớp cột dựng từ DB.meetingRooms mới) VÀ làm 2 cuộc họp có thể bị
// duyệt trùng phòng cùng giờ vì tên khác nhau không còn bị coi là cùng 1 phòng. Cascade CẢ lịch tương
// lai lẫn quá khứ (giữ tính nhất quán lịch sử — cùng đánh đổi stores/depts ở trên), gọi từ routes/data.js
// SAU KHI ghi thành công key 'meetingRooms' (route đó tự so sánh mảng cũ/mới theo id để tìm ra (các) cặp
// tên đã đổi rồi gọi hàm này cho từng cặp).
async function cascadeMeetingRoomRename(oldValue, newValue) {
  await renameFieldValueInCollection('meetings', (item) => renameSimpleFields(item, ['room'], oldValue, newValue));
}

// So sánh mảng meetingRooms CŨ/MỚI theo `id` để tìm ra (các) cặp (tên cũ -> tên mới) — TÁCH RIÊNG thành
// hàm THUẦN (không side-effect) để test được độc lập, không cần boot cả routes/data.js. oldRooms/newRooms:
// mảng {id, name, short} (giữ nguyên NGAY CẢ KHI không hợp lệ — phần tử null/thiếu id đều bị bỏ qua an
// toàn, không throw). Chỉ những dòng CÙNG id nhưng KHÁC name mới được coi là "đổi tên" (dòng MỚI THÊM —
// id không có trong oldRooms — hoặc dòng bị XOÁ hẳn không nằm trong phạm vi hàm này).
function diffMeetingRoomRenames(oldRooms, newRooms) {
  const oldById = new Map((Array.isArray(oldRooms) ? oldRooms : []).filter(r => r && r.id != null).map(r => [r.id, r]));
  return (Array.isArray(newRooms) ? newRooms : [])
    .filter(r => r && oldById.has(r.id) && oldById.get(r.id).name !== r.name)
    .map(r => ({ oldValue: oldById.get(r.id).name, newValue: r.name }));
}

async function cascadeStoreRename(oldValue, newValue) {
  // user.dept dùng CHUNG 1 field cho cả tên phòng ban (HO) lẫn tên siêu thị (phân biệt bằng posType) —
  // so trực tiếp giá trị, không cần lọc posType (1 dept/store name không thể vừa là tên phòng ban vừa
  // là tên siêu thị cùng lúc trong thực tế vận hành).
  await withLockedAppDataValue('users', (list) => (list || []).map(u => (u.dept === oldValue ? { ...u, dept: newValue } : u)));
  await cascadeEmployeeProfilesDept(oldValue, newValue);
  await cascadeUserPermsDepts(oldValue, newValue);
  await cascadeDeptWorkflowMaps(oldValue, newValue);
  await cascadeNestedDeptWorkflowMaps(oldValue, newValue);
  await cascadeDeptKeyedAppDataMaps(oldValue, newValue);
  await cascadeWorkflowParticipatingDepts(oldValue, newValue);
  await cascadePositionPairs('dept', oldValue, newValue);
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
  await cascadePositionPairs('jobTitle', oldValue, newValue);
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
  // Cặp "Theo vị trí" lưu jobTitle THUẦN (không phân biệt nguồn HO/Siêu Thị, cùng lý do
  // cascadeMixedApprovalRuleJobTitle() ở trên) — dùng chung 1 hàm cho cả 2 danh mục chức danh.
  await cascadePositionPairs('jobTitle', oldValue, newValue);
  await withLockedAppDataValue('orgChartVersions', (list) => {
    const { renameJobTitleInAllVersions } = require('./orgChart');
    return renameJobTitleInAllVersions(list, oldValue, newValue, true);
  });
}

// Chức Danh của 1 Vị Trí Làm Việc TỰ THÊM (khác HO/Siêu Thị builtin, xem defaults.js positionTypes) —
// cascade users[].jobTitle CHỈ cho đúng posType === posTypeKey (so CHÍNH XÁC, không suy luận "khác
// STORE" như cascadeJobTitleRename() vì HO không còn là nhánh else duy nhất nữa). PHẠM VI GIAI ĐOẠN 1
// (đã xác nhận với người dùng): CHỈ cascade users[].jobTitle + cặp "Vị Trí Kiêm Nhiệm"/"Vị Trí Tham Gia
// Quy Trình" (cascadePositionPairs, vốn đã posType-agnostic) — KHÔNG cascade employeeProfiles/quy trình
// duyệt hỗn hợp Vận Hành/Cơ Cấu Tổ Chức (những tính năng đó hiện CHỈ nhận biết HO/STORE, ngoài phạm vi
// Giai Đoạn 1, xem VERSION.md đợt merge này).
async function cascadeCustomPosTypeJobTitleRename(posTypeKey, oldValue, newValue) {
  await withLockedAppDataValue('users', (list) => (list || []).map(u =>
    (u.jobTitle === oldValue && u.posType === posTypeKey) ? { ...u, jobTitle: newValue } : u
  ));
  await cascadePositionPairs('jobTitle', oldValue, newValue);
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
  // deptGroups[].depts[] (10/2026, "Khối/Ban") — tên Phòng Ban con lưu THEO CHUỖI bên trong từng nhóm,
  // phải cascade cùng lúc để không giữ tên đã lỗi thời (khác user.khoiBan vốn lưu theo `id` bất biến,
  // không cần cascade khi ĐỔI TÊN Khối/Ban — chỉ cascade khi đổi tên PHÒNG BAN như ở đây).
  await withLockedAppDataValue('deptGroups', (list) => (list || []).map(g => (
    (g.depts || []).includes(oldValue) ? { ...g, depts: g.depts.map(d => (d === oldValue ? newValue : d)) } : g
  )));
}

// cats (Phân Loại Tài Liệu): PHẠM VI HẸP hơn nhiều so với depts/stores — chỉ 1 collection (docs.cat,
// xem lib/createValidation.js MODULE_CONFIGS.docs) + 1 map viết tắt (docCatAbbrs) tham chiếu tới giá trị
// này, không lan ra users/*DeptWorkflows/orgChart như phòng ban/siêu thị.
async function cascadeCatRename(oldValue, newValue) {
  await renameFieldValueInCollection('docs', (item) => renameSimpleFields(item, ['cat'], oldValue, newValue));
  await renameAbbrMapKey('docCatAbbrs', oldValue, newValue);
}

// PHÁT HIỆN ở đợt rà soát chuyên sâu vòng 2 (cụm "Văn Bản Trình/Hợp Đồng/Giấy Phép/Thanh Toán/Tài
// Liệu"): "Loại Pháp Lý HĐ" (DB.contractTypes) trước đây KHÔNG có handler cascade nào — CATALOG_HANDLERS
// chưa từng khai key 'contractTypes' (chỉ khai contractTypeAbbrs riêng, xem updateContractTypeAbbr() ở
// public/js/module-admin.js, và danh sách contractTypes tự thêm/bớt qua "Biểu Mẫu" — saveCoreFieldOptionsList()
// ở core.js — ghi đè THẲNG cả mảng, không cascade gì). Đổi tên 1 Loại Pháp Lý qua đường ghi đè đó để lại
// contractTypeAbbrs mang KEY CŨ (viết tắt "mồ côi", không còn áp dụng cho tên mới -> generateContractCode()
// tự suy viết tắt khác) + mọi contracts.type của hợp đồng ĐÃ TẠO vẫn giữ tên CŨ (không còn khớp danh mục
// mới -> lọc/thống kê theo loại pháp lý bỏ sót các hồ sơ này). Cùng khuôn cascadeCatRename() ngay ở
// trên: đổi contracts.type của MỌI hợp đồng (gồm cả phụ lục — addendum kế thừa type của gốc lúc tạo,
// contracts.extraValidate — nên cùng field, cascade chung không cần phân biệt isAddendum) + dời key
// contractTypeAbbrs. Route rename có cascade thật (POST /api/admin/renameCatalogEntry) — xem thêm
// VALID_CATALOG_KEYS (routes/adminCatalog.js) + renameContractType()/renderContractTypeAbbrList()
// (public/js/module-admin.js, nút "✏️ Sửa" mới, mirror renameCat()) để UI thật sự gọi qua đường này thay
// vì ghi đè thẳng qua Biểu Mẫu khi đây là RENAME (thêm/bớt hẳn 1 lựa chọn mới vẫn qua Biểu Mẫu như cũ).
async function cascadeContractTypeRename(oldValue, newValue) {
  await renameFieldValueInCollection('contracts', (item) => renameSimpleFields(item, ['type'], oldValue, newValue));
  await renameAbbrMapKey('contractTypeAbbrs', oldValue, newValue);
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
  carEvaluationIssues: simpleArrayCatalogHandler('carEvaluationIssues', 'Danh Mục Lý Do Đánh Giá Chuyến Xe'),
  priceZones: simpleArrayCatalogHandler('priceZones', 'Danh Mục Vùng Giá Áp Dụng'),
  trainingCategories: simpleArrayCatalogHandler('trainingCategories', 'Danh Mục Loại Đào Tạo'),
  // itRenewalCategories ("Loại Dịch Vụ" — Hỗ Trợ IT > Gia Hạn Dịch Vụ CNTT, module-itsupport-renewal.js):
  // cùng khuôn licenseTypes/carTaxiCompanies/priceZones/trainingCategories ở trên (mảng chuỗi phẳng,
  // itServiceRenewals.category chỉ dùng làm NHÃN hiển thị/lọc, không có logic quyền/bảo mật nào so khớp
  // ngược lại danh mục) — 10/2026, thêm nút "✏️ Sửa" (trước đây chỉ Xoá, gõ sai tên phải xoá tạo lại,
  // MẤT liên kết với các bản ghi Gia Hạn CNTT đã gán loại dịch vụ đó).
  itRenewalCategories: simpleArrayCatalogHandler('itRenewalCategories', 'Danh Mục Loại Dịch Vụ Gia Hạn CNTT'),
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
  },
  // contractTypes: mảng chuỗi phẳng — cùng khuôn cats/depts (dùng renameInCatalog kiểm trùng/tồn tại
  // trực tiếp, không qua simpleArrayCatalogHandler() vì CẦN cascade, khác 4 danh mục dùng factory đó).
  contractTypes: {
    async renameInCatalog(oldValue, newValue) {
      return withLockedAppDataValue('contractTypes', (list) => {
        const arr = Array.isArray(list) ? list : [];
        if (!arr.includes(oldValue)) throw new HttpError(404, `Không tìm thấy "${oldValue}" trong Loại Pháp Lý HĐ`);
        if (arr.includes(newValue)) throw new HttpError(400, `"${newValue}" đã có trong Loại Pháp Lý HĐ`);
        return arr.map(t => (t === oldValue ? newValue : t));
      });
    },
    cascade: cascadeContractTypeRename
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

// cascadeStoreRename/cascadeCustomPosTypeJobTitleRename export riêng (ngoài renameCatalogEntry()) cho
// routes/positionTypes.js tái dùng khi đổi tên 1 "địa điểm"/"chức danh" bên trong 1 Vị Trí Làm Việc TỰ
// THÊM (không phải HO/STORE builtin) — giá trị đó KHÔNG nằm trong danh mục "stores"/"jobTitles" nên
// không đi qua CATALOG_HANDLERS/renameCatalogEntry() ở trên được (route riêng tự cập nhật mảng lồng
// trong positionTypes[].locations/jobTitles, chỉ cần chạy PHẦN CASCADE ở đây).
module.exports = { renameCatalogEntry, cascadeMeetingRoomRename, diffMeetingRoomRenames, cascadeStoreRename, cascadeCustomPosTypeJobTitleRename };
