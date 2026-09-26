'use strict';

// tests/test-migrate-workflow-dept-groups.js
//
// migrateWorkflowParticipatingDeptGroups() (seedDefaults.js) — di trú 1 LẦN "Đơn Vị Tham Gia Quy Trình"
// từ danh sách phẳng cũ workflowParticipatingDepts[] sang NHIỀU NHÓM workflowParticipatingDeptGroups[]
// (xem defaults.js + getWorkflowParticipatingDepts(moduleKey) ở module-admin-specialperm.js). Cùng kỹ
// thuật require.cache đã dùng ở tests/test-operation-order-location-tiers.js (stub lib/appData thay vì
// lib/recordStore — hàm này chỉ đọc/ghi qua getAppDataValue/setAppDataValue, không đụng collection nào).
//
// Chạy: node server/tests/test-migrate-workflow-dept-groups.js
const assert = require('assert');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (err) { failed++; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

function requireFreshMigrationFn(seed) {
  const appDataPath = require.resolve('../lib/appData');
  const seedDefaultsPath = require.resolve('../seedDefaults');
  require.cache[appDataPath] = {
    id: appDataPath, filename: appDataPath, loaded: true, exports: {
      getAppDataValue: async (key) => (key in seed ? seed[key] : null),
      setAppDataValue: async (key, value) => { seed[key] = value; },
      withLockedAppDataValue: async (key, fn) => { seed[key] = await fn(seed[key]); return seed[key]; }
    }
  };
  delete require.cache[seedDefaultsPath];
  const { migrateWorkflowParticipatingDeptGroups } = require('../seedDefaults');
  return {
    migrateWorkflowParticipatingDeptGroups,
    cleanup: () => { delete require.cache[appDataPath]; delete require.cache[seedDefaultsPath]; }
  };
}

(async () => {
  await test('CSDL cũ có dữ liệu thật ở workflowParticipatingDepts (phẳng) -> gói thành ĐÚNG 1 nhóm mặc định, claim đủ module cũ', async () => {
    const seed = { workflowParticipatingDepts: ['Phòng IT', 'Phòng Kế Toán'], workflowParticipatingDeptGroups: [] };
    const { migrateWorkflowParticipatingDeptGroups, cleanup } = requireFreshMigrationFn(seed);
    try {
      await migrateWorkflowParticipatingDeptGroups();
      assert.strictEqual(seed.workflowParticipatingDeptGroups.length, 1, 'phải tạo đúng 1 nhóm mặc định');
      const grp = seed.workflowParticipatingDeptGroups[0];
      assert.deepStrictEqual(grp.depts, ['Phòng IT', 'Phòng Kế Toán'], 'depts của nhóm phải khớp NGUYÊN VẸN danh sách phẳng cũ');
      assert.ok(Array.isArray(grp.moduleKeys) && grp.moduleKeys.includes('DOC') && grp.moduleKeys.includes('CAR') && grp.moduleKeys.length >= 10,
        'nhóm mặc định phải claim ĐỦ các module WF_MODULE_CONFIG hiện có tại thời điểm nâng cấp, giữ nguyên hành vi cũ (áp dụng cho MỌI quy trình)');
      // workflowParticipatingDepts CŨ vẫn giữ nguyên (không xoá), chỉ là không còn được đọc nữa.
      assert.deepStrictEqual(seed.workflowParticipatingDepts, ['Phòng IT', 'Phòng Kế Toán']);
    } finally { cleanup(); }
  });

  await test('CSDL mới (workflowParticipatingDepts rỗng, chưa ai cấu hình gì) -> KHÔNG tạo nhóm nào', async () => {
    const seed = { workflowParticipatingDepts: [], workflowParticipatingDeptGroups: [] };
    const { migrateWorkflowParticipatingDeptGroups, cleanup } = requireFreshMigrationFn(seed);
    try {
      await migrateWorkflowParticipatingDeptGroups();
      assert.deepStrictEqual(seed.workflowParticipatingDeptGroups, [], 'không có gì để di trú thì không tạo nhóm rác');
    } finally { cleanup(); }
  });

  await test('Idempotent: workflowParticipatingDeptGroups ĐÃ có dữ liệu (admin đã tự cấu hình nhóm mới) -> KHÔNG ghi đè', async () => {
    const seed = {
      workflowParticipatingDepts: ['Phòng IT'],
      workflowParticipatingDeptGroups: [{ id: 'grp_custom', name: 'Nhóm Tự Cấu Hình', depts: ['Phòng Kế Toán'], moduleKeys: ['CAR'] }]
    };
    const { migrateWorkflowParticipatingDeptGroups, cleanup } = requireFreshMigrationFn(seed);
    try {
      await migrateWorkflowParticipatingDeptGroups();
      assert.strictEqual(seed.workflowParticipatingDeptGroups.length, 1);
      assert.strictEqual(seed.workflowParticipatingDeptGroups[0].id, 'grp_custom', 'không được ghi đè nhóm admin đã tự tạo');
    } finally { cleanup(); }
  });

  await test('Chạy 2 lần liên tiếp (idempotent với chính lần di trú đầu) -> lần 2 không tạo thêm nhóm nào nữa', async () => {
    const seed = { workflowParticipatingDepts: ['Phòng IT'], workflowParticipatingDeptGroups: [] };
    const { migrateWorkflowParticipatingDeptGroups, cleanup } = requireFreshMigrationFn(seed);
    try {
      await migrateWorkflowParticipatingDeptGroups();
      await migrateWorkflowParticipatingDeptGroups();
      assert.strictEqual(seed.workflowParticipatingDeptGroups.length, 1, 'chạy lại lần 2 không được nhân đôi nhóm');
    } finally { cleanup(); }
  });

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  process.exit(failed > 0 ? 1 : 0);
})();
