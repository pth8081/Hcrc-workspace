'use strict';

// tests/test-migrate-workflow-dept-groups.js
//
// migrateWorkflowParticipatingDeptGroups() (seedDefaults.js) — di trú 1 LẦN "Đơn Vị Tham Gia Quy Trình"
// từ danh sách phẳng cũ workflowParticipatingDepts[] sang NHIỀU NHÓM workflowParticipatingDeptGroups[]
// (xem defaults.js + getWorkflowParticipatingDepts(moduleKey) ở module-admin-specialperm.js). Cùng kỹ
// thuật require.cache đã dùng ở tests/test-operation-order-location-tiers.js (stub lib/appData thay vì
// lib/recordStore — hàm này chỉ đọc/ghi qua getAppDataValue/setAppDataValue, không đụng collection nào).
//
// LỖI ĐÃ VÁ (đợt rà soát độc lập 9/2026 — xem chú thích đầy đủ ở workflowParticipatingDeptGroupsMigrated
// trong defaults.js): bản ĐẦU TIÊN suy ra "đã di trú chưa" từ ĐỘ DÀI workflowParticipatingDeptGroups —
// không phân biệt được "chưa từng di trú" với "admin đã chủ động xoá hết nhóm" (2 trạng thái nhìn giống
// hệt nhau: mảng rỗng), trong khi workflowParticipatingDepts (phẳng, cũ) KHÔNG BAO GIỜ bị xoá — hệ quả:
// admin xoá sạch mọi nhóm rồi mỗi lần server restart lại bị âm thầm tạo lại đúng nhóm mặc định cũ. Kịch
// bản '"xoá hết nhóm" ... KHÔNG bị hồi sinh' bên dưới là chốt chặn TRỰC TIẾP cho đúng lỗi này — bài test
// gốc trước khi vá KHÔNG hề có kịch bản này (chỉ test "chưa từng di trú" và "đã có nhóm tuỳ chỉnh", cả 2
// đều không chạm đúng điều kiện gây lỗi).
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

// Mô phỏng 1 lượt "server restart": require lại seedDefaults.js (module state cũ mất, y hệt process
// Node thật khởi động lại) nhưng seed (đóng vai dbo.AppData thật) giữ nguyên giữa các lượt gọi.
function bootAndMigrate(seed) {
  const { migrateWorkflowParticipatingDeptGroups, cleanup } = requireFreshMigrationFn(seed);
  return migrateWorkflowParticipatingDeptGroups().finally(cleanup);
}

(async () => {
  await test('CSDL cũ có dữ liệu thật ở workflowParticipatingDepts (phẳng) -> gói thành ĐÚNG 1 nhóm mặc định, claim đủ module cũ, và đặt cờ đã-di-trú', async () => {
    const seed = { workflowParticipatingDepts: ['Phòng IT', 'Phòng Kế Toán'], workflowParticipatingDeptGroups: [] };
    await bootAndMigrate(seed);
    assert.strictEqual(seed.workflowParticipatingDeptGroups.length, 1, 'phải tạo đúng 1 nhóm mặc định');
    const grp = seed.workflowParticipatingDeptGroups[0];
    assert.deepStrictEqual(grp.depts, ['Phòng IT', 'Phòng Kế Toán'], 'depts của nhóm phải khớp NGUYÊN VẸN danh sách phẳng cũ');
    assert.ok(Array.isArray(grp.moduleKeys) && grp.moduleKeys.includes('DOC') && grp.moduleKeys.includes('CAR') && grp.moduleKeys.length >= 10,
      'nhóm mặc định phải claim ĐỦ các module WF_MODULE_CONFIG hiện có tại thời điểm nâng cấp, giữ nguyên hành vi cũ (áp dụng cho MỌI quy trình)');
    // workflowParticipatingDepts CŨ vẫn giữ nguyên (không xoá), chỉ là không còn được đọc nữa.
    assert.deepStrictEqual(seed.workflowParticipatingDepts, ['Phòng IT', 'Phòng Kế Toán']);
    assert.strictEqual(seed.workflowParticipatingDeptGroupsMigrated, true, 'phải đặt cờ đã-di-trú sau lần chạy đầu tiên');
  });

  await test('CSDL mới (workflowParticipatingDepts rỗng, chưa ai cấu hình gì) -> KHÔNG tạo nhóm nào, vẫn đặt cờ đã-di-trú', async () => {
    const seed = { workflowParticipatingDepts: [], workflowParticipatingDeptGroups: [] };
    await bootAndMigrate(seed);
    assert.deepStrictEqual(seed.workflowParticipatingDeptGroups, [], 'không có gì để di trú thì không tạo nhóm rác');
    assert.strictEqual(seed.workflowParticipatingDeptGroupsMigrated, true);
  });

  await test('Cờ đã-di-trú CHƯA có nhưng workflowParticipatingDeptGroups đã có sẵn dữ liệu thật (VD phục hồi backup) -> KHÔNG ghi đè, chỉ đặt cờ', async () => {
    const seed = {
      workflowParticipatingDepts: ['Phòng IT'],
      workflowParticipatingDeptGroups: [{ id: 'grp_custom', name: 'Nhóm Tự Cấu Hình', depts: ['Phòng Kế Toán'], moduleKeys: ['CAR'] }]
    };
    await bootAndMigrate(seed);
    assert.strictEqual(seed.workflowParticipatingDeptGroups.length, 1);
    assert.strictEqual(seed.workflowParticipatingDeptGroups[0].id, 'grp_custom', 'không được ghi đè nhóm admin đã tự tạo');
    assert.strictEqual(seed.workflowParticipatingDeptGroupsMigrated, true);
  });

  await test('Chạy 2 lần liên tiếp (2 lượt "restart" ngay sau nhau) -> lần 2 không tạo thêm nhóm nào nữa', async () => {
    const seed = { workflowParticipatingDepts: ['Phòng IT'], workflowParticipatingDeptGroups: [] };
    await bootAndMigrate(seed);
    await bootAndMigrate(seed);
    assert.strictEqual(seed.workflowParticipatingDeptGroups.length, 1, 'chạy lại lần 2 không được nhân đôi nhóm');
  });

  // ===== Chốt chặn TRỰC TIẾP cho lỗi đã vá — xem chú thích đầu file =====
  await test('LỖI ĐÃ VÁ: admin xoá HẾT mọi nhóm (còn [] thật sự) rồi server restart nhiều lần -> KHÔNG bị hồi sinh lại nhóm mặc định cũ', async () => {
    const seed = { workflowParticipatingDepts: ['Phòng IT', 'Phòng Kế Toán'], workflowParticipatingDeptGroups: [] };
    // Lượt boot #1 (lần đầu server chạy version có di trú này): tạo nhóm mặc định như bình thường.
    await bootAndMigrate(seed);
    assert.strictEqual(seed.workflowParticipatingDeptGroups.length, 1, 'lượt boot đầu vẫn phải tạo đúng nhóm mặc định');

    // Admin vào màn "Đơn Vị Tham Gia Quy Trình", xoá nhóm rồi bấm "Lưu Cấu Hình" -> mảng về [] THẬT SỰ
    // (mirror đúng saveWorkflowParticipatingDeptGroups() ở module-admin-specialperm.js: DB.workflowParticipatingDeptGroups = []; syncStorage(...)).
    seed.workflowParticipatingDeptGroups = [];

    // 3 lượt "restart" liên tiếp (pm2 restart/deploy/crash) — KHÔNG lượt nào được phép tạo lại nhóm mặc định.
    for (let i = 0; i < 3; i++) {
      await bootAndMigrate(seed);
      assert.deepStrictEqual(seed.workflowParticipatingDeptGroups, [],
        `lượt restart #${i + 1} KHÔNG được hồi sinh nhóm mặc định — admin đã chủ động xoá hết`);
    }
    // Danh sách phẳng cũ vẫn còn nguyên trong CSDL (đúng thiết kế, không xoá lịch sử) — chính đây là lý
    // do bug cũ xảy ra nếu chỉ dựa vào "workflowParticipatingDeptGroups rỗng" để suy ra "chưa di trú".
    assert.deepStrictEqual(seed.workflowParticipatingDepts, ['Phòng IT', 'Phòng Kế Toán']);
  });

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  process.exit(failed > 0 ? 1 : 0);
})();
