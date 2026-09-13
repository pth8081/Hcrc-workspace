// server/tests/test-merge-groups-perms.js
//
// PQ-02 (đợt test chuyên sâu 9/2026, mục Phân Quyền): mergeGroupsBasePermsServer() (routes/data.js) hợp
// nhất quyền của nhiều nhóm mà 1 user thuộc về — nguyên tắc là OVERLAY/UNION (cộng dồn), không phải
// last-write-wins. Test bằng script riêng đã xác nhận thuật toán {all,depts}/boolean/approverAuthLevel
// (ranked enum) đều union ĐÚNG — nhưng phát hiện 3 trường "kiểu cũ" của Tài Liệu (uploadDepts/
// viewDraftDepts/viewApprovedDepts, mảng TRẦN chứ không phải object {all,depts}) bị rơi vào nhánh
// else -> lấy giá trị NHÓM CUỐI CÙNG, làm mất phòng ban của các nhóm khác. Test này gọi THẲNG hàm thật
// (export qua module.exports.mergeGroupsBasePermsServer, xem routes/data.js) để không chép lại logic.
//
// Chạy: node server/tests/test-merge-groups-perms.js
'use strict';
const path = require('path');
const { createRunner, assertEqual } = require('./testHarness');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}
stubModule('lib/appData', { getAllAppDataWithVersionsCached: async () => ({ data: {}, versions: {} }) });
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(),
  getAllForCollectionCached: async () => [], getForCollectionByDeptCached: async () => [],
  getForCollectionByUsernameCached: async () => [], getForCollectionByColumnCached: async () => []
});
stubModule('lib/auth', {
  requireAuth: (req, res, next) => next(), blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => p, isBcryptHash: () => false, validatePin: () => null
});

const { mergeGroupsBasePermsServer } = require('../routes/data');

function assertArraySetEqual(actual, expected, msg) {
  const a = JSON.stringify([...(actual || [])].sort());
  const e = JSON.stringify([...expected].sort());
  assertEqual(a, e, `${msg} (thực tế: ${a}, mong đợi: ${e})`);
}

async function main() {
  const run = createRunner();

  await run.run('PQ-02: uploadDepts (mảng trần) của 3 nhóm KHÔNG chồng nhau -> hợp nhất UNION cả 3, không last-write-wins', async () => {
    const groups = [
      { uploadAll: false, uploadDepts: ['PhongA'] },
      { uploadAll: false, uploadDepts: ['PhongB'] },
      { uploadAll: false, uploadDepts: ['PhongC'] }
    ];
    const merged = mergeGroupsBasePermsServer(groups);
    assertArraySetEqual(merged.uploadDepts, ['PhongA', 'PhongB', 'PhongC'], 'phải union đủ 3 phòng ban, không chỉ giữ nhóm cuối (PhongC)');
  });

  await run.run('PQ-02: viewApprovedDepts/viewDraftDepts (cùng khuôn) cũng union đúng, không phụ thuộc thứ tự nhóm', async () => {
    const forward = mergeGroupsBasePermsServer([
      { viewApprovedDepts: ['KeToan'] }, { viewApprovedDepts: ['Kho'] }, { viewApprovedDepts: ['VanHanh'] }
    ]);
    const shuffled = mergeGroupsBasePermsServer([
      { viewApprovedDepts: ['VanHanh'] }, { viewApprovedDepts: ['KeToan'] }, { viewApprovedDepts: ['Kho'] }
    ]);
    assertArraySetEqual(forward.viewApprovedDepts, ['KeToan', 'Kho', 'VanHanh'], 'phải union đủ 3 phòng ban');
    assertArraySetEqual(shuffled.viewApprovedDepts, ['KeToan', 'Kho', 'VanHanh'], 'kết quả không phụ thuộc thứ tự nhóm trong mảng');
  });

  await run.run('PQ-02: uploadDepts trùng lặp giữa các nhóm -> khử trùng lặp (không nhân đôi phần tử)', async () => {
    const merged = mergeGroupsBasePermsServer([{ uploadDepts: ['PhongA', 'PhongB'] }, { uploadDepts: ['PhongB'] }]);
    assertArraySetEqual(merged.uploadDepts, ['PhongA', 'PhongB'], 'PhongB chỉ xuất hiện 1 lần');
  });

  await run.run('PQ-02: uploadAll (boolean đi kèm) vẫn OR đúng như trước (không bị ảnh hưởng bởi bản sửa)', async () => {
    const merged = mergeGroupsBasePermsServer([{ uploadAll: false, uploadDepts: [] }, { uploadAll: true, uploadDepts: [] }, { uploadAll: false, uploadDepts: [] }]);
    assertEqual(merged.uploadAll, true, 'chỉ cần 1 nhóm cho uploadAll=true là đủ (OR)');
  });

  await run.run('PQ-02 (đối chiếu, không phải bug): scope {all,depts} chuẩn vẫn union đúng như cũ (không regressed bởi bản sửa nhánh mảng trần)', async () => {
    const merged = mergeGroupsBasePermsServer([
      { docViewScope: { all: false, depts: ['A'] } },
      { docViewScope: { all: false, depts: ['B'] } },
      { docViewScope: { all: true, depts: [] } }
    ]);
    assertEqual(merged.docViewScope.all, true, 'all=true từ bất kỳ nhóm nào cũng thắng');
    assertArraySetEqual(merged.docViewScope.depts, ['A', 'B'], 'depts vẫn union đúng như cũ');
  });

  run.summary();
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
