'use strict';

// tests/test-submissiontype-catalog-rename-cascade.js
//
// Regression cho LOI DA VA (dot ra soat chuyen sau lan 2 truoc go-live, muc Cao - Agent "bang lien ket"):
// doi LABEL cua 1 "Loai To Trinh" (submissionTypes, optionsKey:'submissionTypes', optionsIsKeyLabel:true
// - xem saveCoreFieldOptionsList() o core.js) qua man Bieu Mau truoc day:
//   1. Khong giu nguyen KEY on dinh cho vi tri doi ten (saveCoreFieldOptionsList() sinh key MOI) -> mo
//      coi submissionTypeDeptWorkflows[keyCu] (mat cau hinh quy trinh rieng cua loai do).
//   2. Khong cascade cac ban ghi `submissions` DA TAO (luu nguyen chuoi label CU o field `type`, khong
//      phai key) sang label MOI -> vo hieu lookup theo label (DB.submissionTypes.find(t => t.label === type)).
//
// File nay test 2 phan THUAN (khong can boot ca routes/data.js), cung khuon
// test-nganhhang-catalog-rename-cascade.js:
//   1. diffSubmissionTypeCatalogRenames(oldList, newList) - so sanh mang theo `key` de tim cap (label cu -> label moi).
//   2. cascadeSubmissionTypeRename(oldLabel, newLabel) - cascade submissions.type qua renameFieldValueInCollection.
//
// Chay: node server/tests/test-submissiontype-catalog-rename-cascade.js
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let RECORDS;
let renameFieldCalls;
function resetState() {
  RECORDS = {
    submissions: [
      { id: 101, code: 'VBT-001', dept: 'Phong Ke Toan', type: 'De xuat' },
      { id: 102, code: 'VBT-002', dept: 'Phong CNTT', type: 'De xuat' },
      { id: 103, code: 'VBT-003', dept: 'Phong Ke Toan', type: 'Thong bao' },
      { id: 104, code: 'VBT-004', dept: 'Phong CNTT', type: 'Khac' }
    ]
  };
  renameFieldCalls = [];
}

stubModule('lib/appData', { withLockedAppDataValue: async () => {} });
stubModule('lib/recordStore', {
  renameFieldValueInCollection: async (collection, mutateFn) => {
    renameFieldCalls.push(collection);
    const list = RECORDS[collection] || [];
    RECORDS[collection] = list.map((item) => mutateFn(item));
  }
});

const { cascadeSubmissionTypeRename, diffSubmissionTypeCatalogRenames } = require('../lib/catalogRename');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}

async function main() {
  test('diffSubmissionTypeCatalogRenames: 1 entry doi label (cung key, khac label) -> phat hien dung 1 cap', () => {
    const oldList = [{ key: 'DE_XUAT', label: 'De xuat' }, { key: 'THONG_BAO', label: 'Thong bao' }];
    const newList = [{ key: 'DE_XUAT', label: 'De nghi' }, { key: 'THONG_BAO', label: 'Thong bao' }];
    assert.deepStrictEqual(diffSubmissionTypeCatalogRenames(oldList, newList), [{ oldValue: 'De xuat', newValue: 'De nghi' }]);
  });

  test('diffSubmissionTypeCatalogRenames: them loai moi (key khong co trong mang cu) -> KHONG bi coi la doi ten', () => {
    const oldList = [{ key: 'DE_XUAT', label: 'De xuat' }];
    const newList = [{ key: 'DE_XUAT', label: 'De xuat' }, { key: 'MOI', label: 'Loai moi' }];
    assert.deepStrictEqual(diffSubmissionTypeCatalogRenames(oldList, newList), []);
  });

  test('diffSubmissionTypeCatalogRenames: xoa han 1 loai -> KHONG bao doi ten', () => {
    const oldList = [{ key: 'DE_XUAT', label: 'De xuat' }, { key: 'THONG_BAO', label: 'Thong bao' }];
    const newList = [{ key: 'DE_XUAT', label: 'De xuat' }];
    assert.deepStrictEqual(diffSubmissionTypeCatalogRenames(oldList, newList), []);
  });

  test('diffSubmissionTypeCatalogRenames: khong doi gi -> mang rong', () => {
    const list = [{ key: 'DE_XUAT', label: 'De xuat' }];
    assert.deepStrictEqual(diffSubmissionTypeCatalogRenames(list, list.slice()), []);
  });

  test('diffSubmissionTypeCatalogRenames: mang cu rong/thieu -> khong throw, tra mang rong', () => {
    assert.deepStrictEqual(diffSubmissionTypeCatalogRenames(null, [{ key: 'A', label: 'X' }]), []);
    assert.deepStrictEqual(diffSubmissionTypeCatalogRenames(undefined, undefined), []);
  });

  await testAsync('cascadeSubmissionTypeRename: doi dung cac submissions co type = label CU, giu nguyen cac type khac', async () => {
    resetState();
    await cascadeSubmissionTypeRename('De xuat', 'De nghi');
    assert.deepStrictEqual(RECORDS.submissions.map(s => s.type), ['De nghi', 'De nghi', 'Thong bao', 'Khac']);
    assert.deepStrictEqual(renameFieldCalls, ['submissions']);
  });

  await testAsync('cascadeSubmissionTypeRename: khong co submission nao dung label cu -> khong doi gi, van chay khong loi', async () => {
    resetState();
    await cascadeSubmissionTypeRename('Khong Ton Tai', 'Gi Do Moi');
    assert.deepStrictEqual(RECORDS.submissions.map(s => s.type), ['De xuat', 'De xuat', 'Thong bao', 'Khac']);
  });

  console.log(`\n${passed}/${passed + failed} scenario(s) passed.`);
  if (failed) process.exitCode = 1;
}

main();
