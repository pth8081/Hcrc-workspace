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
  { collection: 'trainingPlans', fields: ['targetDept'] }
];

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

async function cascadeStoreRename(oldValue, newValue) {
  // user.dept dùng CHUNG 1 field cho cả tên phòng ban (HO) lẫn tên siêu thị (phân biệt bằng posType) —
  // so trực tiếp giá trị, không cần lọc posType (1 dept/store name không thể vừa là tên phòng ban vừa
  // là tên siêu thị cùng lúc trong thực tế vận hành).
  await withLockedAppDataValue('users', (list) => (list || []).map(u => (u.dept === oldValue ? { ...u, dept: newValue } : u)));
  for (const { collection, fields } of DEPT_FIELD_COLLECTIONS) {
    await renameFieldValueInCollection(collection, (item) => renameSimpleFields(item, fields, oldValue, newValue));
  }
  await renameFieldValueInCollection('uniformPeriods', (item) => renameUniformPeriodAllocations(item, oldValue, newValue));
}

// jobTitles (Khối Văn Phòng/HO): cascade users[].jobTitle CHỈ cho user KHÔNG phải posType STORE
// (posType STORE dùng danh mục storeJobTitles riêng, xem cascadeStoreJobTitleRename() bên dưới) +
// vppExcludeGroups[].jobTitles[] (so khớp chuỗi thô, xem isUserVppExcluded() ở index.html).
async function cascadeJobTitleRename(oldValue, newValue) {
  await withLockedAppDataValue('users', (list) => (list || []).map(u =>
    (u.jobTitle === oldValue && u.posType !== 'STORE') ? { ...u, jobTitle: newValue } : u
  ));
  await withLockedAppDataValue('vppExcludeGroups', (list) => (list || []).map(g => {
    if (!Array.isArray(g.jobTitles) || !g.jobTitles.includes(oldValue)) return g;
    return { ...g, jobTitles: g.jobTitles.map(jt => (jt === oldValue ? newValue : jt)) };
  }));
}

// storeJobTitles (Siêu Thị, mục 4a): cascade users[].jobTitle CHỈ cho posType === 'STORE'.
async function cascadeStoreJobTitleRename(oldValue, newValue) {
  await withLockedAppDataValue('users', (list) => (list || []).map(u =>
    (u.jobTitle === oldValue && u.posType === 'STORE') ? { ...u, jobTitle: newValue } : u
  ));
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
