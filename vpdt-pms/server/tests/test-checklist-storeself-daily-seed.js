// server/tests/test-checklist-storeself-daily-seed.js
//
// Test cho seedDefaults.js::seedStoreSelfDailyChecklistTemplateIfMissing() (9/2026) — dựng sẵn 1 mẫu
// checklist "Câu hỏi & đáp án" (templateKind QA) TỰ ĐÁNH GIÁ HÀNG NGÀY cho GĐST/CHT, đúng nội dung sheet
// "10.6" người dùng gửi (seedChecklistStoreSelfDaily.js), NGAY LẦN KHỞI ĐỘNG ĐẦU TIÊN sau khi triển khai
// tính năng — idempotent (chạy lại nhiều lần không tạo trùng, theo templateCode 'CL_STCH_DAILY').
//
// Mock '../lib/recordStore' (chỉ getAllForCollection/insertRecord mà hàm này thực sự dùng) qua
// require.cache — cùng kỹ thuật đã dùng ở tests/test-checklist-vsattp-seed.js.
'use strict';

function makeFakeRecordStore(seed) {
  return {
    async getAllForCollection(collection) { return seed[collection] || []; },
    async insertRecord(collection, record) {
      seed[collection] = seed[collection] || [];
      seed[collection].push(record);
      return record;
    }
  };
}
function requireFreshSeedFn(seed) {
  const recordStorePath = require.resolve('../lib/recordStore');
  const seedDefaultsPath = require.resolve('../seedDefaults');
  require.cache[recordStorePath] = { id: recordStorePath, filename: recordStorePath, loaded: true, exports: makeFakeRecordStore(seed) };
  delete require.cache[seedDefaultsPath];
  const { seedStoreSelfDailyChecklistTemplateIfMissing } = require('../seedDefaults');
  return {
    seedStoreSelfDailyChecklistTemplateIfMissing,
    cleanup: () => { delete require.cache[recordStorePath]; delete require.cache[seedDefaultsPath]; }
  };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

async function main() {
  // ===== 1. Lần đầu (chưa có bản ghi nào) -> tạo đúng 1 template DRAFT, templateKind QA =====
  const seed1 = { checklistTemplates: [] };
  const { seedStoreSelfDailyChecklistTemplateIfMissing, cleanup } = requireFreshSeedFn(seed1);
  await seedStoreSelfDailyChecklistTemplateIfMissing();
  check('Tạo đúng 1 template mới', seed1.checklistTemplates.length === 1, seed1.checklistTemplates.length);
  const created = seed1.checklistTemplates[0];
  check('templateCode đúng "CL_STCH_DAILY"', created.templateCode === 'CL_STCH_DAILY', created.templateCode);
  check('templateType = STORE_SELF', created.templateType === 'STORE_SELF', created.templateType);
  check('templateKind = QA', created.templateKind === 'QA', created.templateKind);
  check('scoringMode = PASS_FAIL_ONLY', created.scoringMode === 'PASS_FAIL_ONLY', created.scoringMode);
  check('status = DRAFT (KHÔNG tự Kích Hoạt)', created.status === 'DRAFT', created.status);
  check('có id hợp lệ (bắt buộc để insertRecord thật không lỗi)', typeof created.id === 'number' && created.id > 0, created.id);
  check('49 câu hỏi, đủ 12 hạng mục (category)', created.questions.length === 49 && new Set(created.questions.map(q => q.category)).size === 12, [created.questions.length, new Set(created.questions.map(q => q.category)).size]);
  check('mỗi câu đúng 2 lựa chọn Đạt/Chưa đạt, có 1 lựa chọn isPassing', created.questions.every(q => q.options.length === 2 && q.options.some(o => o.isPassing) && q.options.some(o => !o.isPassing)), created.questions.find(q => q.options.length !== 2));
  check('maxScore/scoreValue ép về 0 (PASS_FAIL_ONLY, không tính điểm)', created.questions.every(q => q.maxScore === 0 && q.options.every(o => o.scoreValue === 0)), created.questions.find(q => q.maxScore !== 0));
  check('optionId đánh số toàn cục liên tục 1..98, không trùng', (() => {
    const ids = created.questions.flatMap(q => q.options.map(o => o.id));
    const unique = new Set(ids);
    return ids.length === 98 && unique.size === 98 && Math.min(...ids) === 1 && Math.max(...ids) === 98;
  })(), created.questions.flatMap(q => q.options.map(o => o.id)));
  cleanup();

  // ===== 2. Idempotent — đã có sẵn 1 bản ghi cùng templateCode (dù trạng thái/nội dung khác) -> KHÔNG tạo thêm =====
  const seed2 = { checklistTemplates: [{ id: 1, templateCode: 'CL_STCH_DAILY', templateName: 'Đã có rồi', status: 'ACTIVE', templateKind: 'QA', questions: [] }] };
  const second = requireFreshSeedFn(seed2);
  await second.seedStoreSelfDailyChecklistTemplateIfMissing();
  check('Chạy lại lần 2 KHÔNG tạo thêm bản ghi mới (idempotent)', seed2.checklistTemplates.length === 1, seed2.checklistTemplates.length);
  second.cleanup();

  console.log(`\n${pass} pass, ${fail} fail`);
  if (fail > 0) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
