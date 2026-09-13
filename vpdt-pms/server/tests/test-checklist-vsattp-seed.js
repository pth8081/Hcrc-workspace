// server/tests/test-checklist-vsattp-seed.js
//
// Test cho seedDefaults.js::seedVsattpChecklistTemplateIfMissing() (v21.0) — dựng sẵn 1 mẫu checklist
// "Trừ điểm theo hạng mục" (templateKind DEDUCTION) với đúng nội dung VSATTP người dùng gửi
// (seedVsattpChecklist.js), NGAY LẦN KHỞI ĐỘNG ĐẦU TIÊN sau khi triển khai tính năng — idempotent (chạy
// lại nhiều lần không tạo trùng, theo templateCode 'CL_VSATTP').
//
// Mock '../lib/recordStore' (chỉ getAllForCollection/insertRecord mà hàm này thực sự dùng) qua
// require.cache, thao tác thẳng trên mảng in-memory — cùng kỹ thuật đã dùng ở
// tests/test-operation-danhmuc-dautu-units.js.
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
  const { seedVsattpChecklistTemplateIfMissing } = require('../seedDefaults');
  return {
    seedVsattpChecklistTemplateIfMissing,
    cleanup: () => { delete require.cache[recordStorePath]; delete require.cache[seedDefaultsPath]; }
  };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

async function main() {
  // ===== 1. Lần đầu (chưa có bản ghi nào) -> tạo đúng 1 template DRAFT, templateKind DEDUCTION =====
  const seed1 = { checklistTemplates: [] };
  const { seedVsattpChecklistTemplateIfMissing, cleanup } = requireFreshSeedFn(seed1);
  await seedVsattpChecklistTemplateIfMissing();
  check('Tạo đúng 1 template mới', seed1.checklistTemplates.length === 1, seed1.checklistTemplates.length);
  const created = seed1.checklistTemplates[0];
  check('templateCode đúng "CL_VSATTP"', created.templateCode === 'CL_VSATTP', created.templateCode);
  check('templateKind = DEDUCTION', created.templateKind === 'DEDUCTION', created.templateKind);
  check('status = DRAFT (KHÔNG tự Kích Hoạt)', created.status === 'DRAFT', created.status);
  check('có id hợp lệ (bắt buộc để insertRecord thật không lỗi)', typeof created.id === 'number' && created.id > 0, created.id);
  check('5 hạng mục, tổng điểm tối đa = 100', created.categories.length === 5 && created.categories.reduce((s, c) => s + c.maxDeduction, 0) === 100, created.categories.map(c => c.maxDeduction));
  check('criteria id đánh số toàn cục liên tục 1..38, không trùng', (() => {
    const ids = created.categories.flatMap(c => c.subItems.flatMap(su => su.criteria.map(cr => cr.id)));
    const unique = new Set(ids);
    return ids.length === 38 && unique.size === 38 && Math.min(...ids) === 1 && Math.max(...ids) === 38;
  })(), created.categories);
  cleanup();

  // ===== 2. Idempotent — đã có sẵn 1 bản ghi cùng templateCode (dù trạng thái/nội dung khác) -> KHÔNG tạo thêm =====
  const seed2 = { checklistTemplates: [{ id: 1, templateCode: 'CL_VSATTP', templateName: 'Đã có rồi', status: 'ACTIVE', templateKind: 'DEDUCTION', categories: [] }] };
  const second = requireFreshSeedFn(seed2);
  await second.seedVsattpChecklistTemplateIfMissing();
  check('Chạy lại lần 2 KHÔNG tạo thêm bản ghi mới (idempotent)', seed2.checklistTemplates.length === 1, seed2.checklistTemplates.length);
  second.cleanup();

  console.log(`\n${pass} pass, ${fail} fail`);
  if (fail > 0) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
