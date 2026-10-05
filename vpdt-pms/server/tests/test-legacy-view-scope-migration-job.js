// server/tests/test-legacy-view-scope-migration-job.js
//
// Regression test cho jobs/legacyViewScopeMigration.js — 2 lỗi mức Trung bình vừa vá (rà soát
// v24.74→v24.90, 10/2026):
//
// #4: di trú submissionView/contractView -> deptViewScopeConfig.extraViewers ở core.js (client, "Việc D")
//     bản vá v24.83 chỉ SIẾT điều kiện di trú GOING FORWARD, không dọn lại username ĐÃ bị thêm dư thừa
//     vào extraViewers TỪ TRƯỚC khi có bản vá đó. Job này tự dọn lại 1 lần, idempotent.
// #5: di trú đó ở client CHỈ lưu lên server khi người đăng nhập là Admin — user thường đăng nhập trước
//     khi có admin nào đăng nhập sẽ không được di trú ở SERVER (nơi canViewSubmission()/canViewContract()
//     thật sự đọc). Job này chạy Ở SERVER lúc khởi động, không phụ thuộc ai đăng nhập — test gọi job
//     TRỰC TIẾP, không có bất kỳ "user đang đăng nhập" nào, để xác nhận đúng tinh thần đó.
//
// stubAppData(users, currentCfg): dựng 1 "kho" AppData giả DÙNG CHUNG cho cả getAppDataValue() (bước đọc
// trước KHÔNG khoá, chỉ để kiểm tra có cần ghi hay không) VÀ withLockedAppDataValue() (bước đọc-sửa-ghi
// thật) — mirror đúng việc 2 lời gọi này cùng đọc 1 dòng dbo.AppData thật, không phải 2 nguồn khác nhau.
//
// Chạy: node server/tests/test-legacy-view-scope-migration-job.js
'use strict';
const path = require('path');
const { createRunner, assertEqual, assert: ok } = require('./testHarness');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

// Trả { getAppDataValue, withLockedAppDataValue, getWriteCalls, getStore } — `store.deptViewScopeConfig`
// cập nhật TRỰC TIẾP khi withLockedAppDataValue() "ghi" (giống SQL UPDATE thật), nên lần gọi job TIẾP
// THEO (nếu test gọi 2 lần) sẽ đọc đúng giá trị đã ghi, không phải giá trị khởi tạo ban đầu.
function stubAppData(users, initialDeptViewScopeConfig) {
  const store = { users, deptViewScopeConfig: initialDeptViewScopeConfig || {} };
  let writeCalls = 0;
  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key in store ? store[key] : null),
    withLockedAppDataValue: async (key, mutatorFn) => {
      assertEqual(key, 'deptViewScopeConfig', 'phải ghi đúng key deptViewScopeConfig');
      writeCalls++;
      const newValue = await mutatorFn(store[key]);
      store[key] = newValue;
      return newValue;
    }
  });
  return { store, getWriteCalls: () => writeCalls };
}

function freshJob() {
  delete require.cache[require.resolve('../jobs/legacyViewScopeMigration')];
  return require('../jobs/legacyViewScopeMigration');
}

async function main() {
  const run = createRunner();

  await run.run('Không có user legacy nào -> KHÔNG đọc/ghi gì cả', async () => {
    const { getWriteCalls } = stubAppData([{ username: 'binhthuong', dept: 'Phòng A', perms: {} }]);
    const { migrateLegacySubmissionContractViewers } = freshJob();
    await migrateLegacySubmissionContractViewers();
    assertEqual(getWriteCalls(), 0, 'Không có flag legacy nào thì KHÔNG được ghi');
  });

  await run.run('#5: user hợp lệ (submissionView.all=true) được thêm vào extraViewers NGAY ở server, KHÔNG cần ai đăng nhập', async () => {
    const users = [
      { username: 'nv_xem_het', dept: 'Phòng IT', perms: { submissionView: { all: true } } },
      { username: 'binhthuong', dept: 'Phòng A', perms: {} }
    ];
    const { store, getWriteCalls } = stubAppData(users);
    const { migrateLegacySubmissionContractViewers } = freshJob();
    await migrateLegacySubmissionContractViewers();
    assertEqual(getWriteCalls(), 1, 'phải có đúng 1 lần ghi (user hợp lệ cần migrate)');
    assertEqual(store.deptViewScopeConfig.submission.extraViewers.includes('nv_xem_het'), true, 'nv_xem_het phải được thêm vào extraViewers — KHÔNG đọc bất kỳ "user đang đăng nhập" nào, chạy độc lập ở server');
  });

  await run.run('#4: username từng bị migrate DƯ THỪA (bug cũ, .depts chỉ trùng đúng phòng mình) ĐÃ nằm sẵn trong extraViewers -> bị DỌN LẠI (gỡ khỏi extraViewers)', async () => {
    const users = [
      // Shape ĐÚNG bug cũ: .depts không rỗng nhưng MỌI phần tử = dept hiện tại của chính họ -> dư thừa,
      // không còn khớp điều kiện di trú hiện tại (v24.83) — nhưng GIẢ LẬP đã bị bug CŨ (trước v24.83) ghi
      // nhầm vào extraViewers từ trước.
      { username: 'nv_du_thua_cu', dept: 'Phòng Nhân Sự', perms: { submissionView: { depts: ['Phòng Nhân Sự'] } } }
    ];
    const currentCfg = { submission: { mode: 'DEPT', extraViewers: ['nv_du_thua_cu'], managerCanView: false } };
    const { store, getWriteCalls } = stubAppData(users, currentCfg);
    const { migrateLegacySubmissionContractViewers } = freshJob();
    await migrateLegacySubmissionContractViewers();
    assertEqual(getWriteCalls(), 1, 'phải có ghi (reconcile cần dọn entry dư thừa)');
    assertEqual(store.deptViewScopeConfig.submission.extraViewers.includes('nv_du_thua_cu'), false, 'entry dư thừa do bug cũ phải bị GỠ khỏi extraViewers');
  });

  await run.run('#4 (an toàn): username admin tự tay thêm qua Ma Trận UI (KHÔNG có flag legacy nào) -> KHÔNG bị gỡ, KHÔNG ghi gì (không có flag legacy nào trong users)', async () => {
    const users = [
      { username: 'admin_curated', dept: 'Phòng A', perms: {} } // không có submissionView/contractView nào cả
    ];
    const currentCfg = { submission: { mode: 'DEPT', extraViewers: ['admin_curated'], managerCanView: false } };
    const { store, getWriteCalls } = stubAppData(users, currentCfg);
    const { migrateLegacySubmissionContractViewers } = freshJob();
    await migrateLegacySubmissionContractViewers();
    assertEqual(getWriteCalls(), 0, 'Không có username nào mang flag legacy (dù overBroad hay correct) thì KHÔNG được ghi gì cả');
    assertEqual(store.deptViewScopeConfig.submission.extraViewers.includes('admin_curated'), true, 'entry admin tự thêm không bị đụng tới');
  });

  await run.run('#4 (an toàn, mẫu đủ): user dư thừa SONG SONG với user admin tự thêm khác trong CÙNG extraViewers -> chỉ gỡ đúng user dư thừa', async () => {
    const users = [
      { username: 'nv_du_thua_cu', dept: 'Phòng Nhân Sự', perms: { submissionView: { depts: ['Phòng Nhân Sự'] } } },
      { username: 'admin_curated', dept: 'Phòng A', perms: {} }
    ];
    const currentCfg = { submission: { mode: 'DEPT', extraViewers: ['nv_du_thua_cu', 'admin_curated'], managerCanView: false } };
    const { store, getWriteCalls } = stubAppData(users, currentCfg);
    const { migrateLegacySubmissionContractViewers } = freshJob();
    await migrateLegacySubmissionContractViewers();
    assertEqual(getWriteCalls(), 1, 'phải có ghi');
    assertEqual(store.deptViewScopeConfig.submission.extraViewers.includes('nv_du_thua_cu'), false, 'nv_du_thua_cu (dư thừa) phải bị gỡ');
    assertEqual(store.deptViewScopeConfig.submission.extraViewers.includes('admin_curated'), true, 'admin_curated (không liên quan 2 flag legacy) KHÔNG được đụng tới');
  });

  await run.run('LỖI ĐÃ VÁ (idempotent không bump UpdatedAt vô ích): gọi job 2 lần liên tiếp -> lần 2 KHÔNG ghi lại nữa dù seed user vẫn mang flag legacy.all=true vĩnh viễn', async () => {
    const users = [
      { username: 'nv_xem_het', dept: 'Phòng IT', perms: { submissionView: { all: true } } }
    ];
    const { getWriteCalls } = stubAppData(users);
    const { migrateLegacySubmissionContractViewers } = freshJob();
    await migrateLegacySubmissionContractViewers();
    assertEqual(getWriteCalls(), 1, 'lần đầu phải ghi (chưa có trong extraViewers)');
    await migrateLegacySubmissionContractViewers();
    assertEqual(getWriteCalls(), 1, 'lần 2 KHÔNG được ghi lại — đã đủ trong extraViewers từ lần đầu, tránh bump UpdatedAt vô ích làm admin đang sửa Ma Trận ở tab khác gặp conflict version oan');
  });

  run.summary();
}

main().catch(err => { console.error(err); process.exit(1); });
