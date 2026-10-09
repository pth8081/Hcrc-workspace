'use strict';

// tests/test-nganhhang-catalog-rename-cascade.js
//
// Regression cho LỖI ĐÃ VÁ (10/2026, phản hồi người dùng — "chọn Ngành Hàng Phụ Trách cho 1 người thì
// người đó tự biến mất khỏi quy trình"): editNganhHangCatalogItem() ("🏷️ Danh Mục Ngành Hàng",
// module-workflow.js) cho phép đổi `code` tự do qua prompt(), lưu qua POST /api/data/nganhHangCatalog —
// TRƯỚC ĐÂY không cascade gì, nên đổi/gõ sai 1 mã là MỌI dòng cấu hình approver
// (itPriceWholesaleStoreMixedApprovalRules[].nganhHang[]) VÀ mọi đề xuất đã tạo trước đó (dù đang PENDING,
// itPriceApprovals[].nganhHang[]) đồng loạt "mồ côi" — 2 bên không còn khớp mã nào với nhau, approver bước
// đó tra ra 0 người khớp dù AND-matching nganhHang (ruleMatchesItPriceWholesaleNganhHang(),
// lib/workflowEngine.js) hoàn toàn đúng thiết kế.
//
// File này test 2 phần THUẦN (không cần boot cả routes/data.js), cùng khuôn
// test-meeting-room-rename-cascade.js:
//   1. diffNganhHangCatalogRenames(oldList, newList) — so sánh mảng theo `id` để tìm cặp (mã cũ -> mã mới).
//   2. cascadeNganhHangCodeRename(oldCode, newCode) — cascade thật sang CẢ 2 nơi tham chiếu mã (rules AppData
//      array qua withLockedAppDataValue, itPriceApprovals qua renameFieldValueInCollection).
//
// Chạy: node server/tests/test-nganhhang-catalog-rename-cascade.js
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let APPDATA;
let RECORDS;
let lockedAppDataCalls;
let renameFieldCalls;
function resetState() {
  APPDATA = {
    itPriceWholesaleStoreMixedApprovalRules: [
      { id: 1, tier: 'MARGIN_LT5', step: 1, mode: 'JOBTITLE', jobTitle: 'Trưởng phòng', nganhHang: ['1002'] },
      { id: 2, tier: 'MARGIN_LT5', step: 1, mode: 'PERSON', username: 'nv1', nganhHang: ['1002', '2003'] },
      { id: 3, tier: 'MARGIN_GTE5', step: 1, mode: 'JOBTITLE', jobTitle: 'Giám đốc', nganhHang: ['2003'] },
      { id: 4, tier: 'MARGIN_LT5', step: 2, mode: 'JOBTITLE', jobTitle: 'TGĐ', nganhHang: [] } // "Mặc định" — không nganhHang nào, không bị đụng tới
    ]
  };
  RECORDS = {
    itPriceApprovals: [
      { id: 101, code: 'ITPG-001', priceType: 'WHOLESALE', nganhHang: ['1002'] },
      { id: 102, code: 'ITPG-002', priceType: 'WHOLESALE', nganhHang: ['1002', '2003'] },
      { id: 103, code: 'ITPG-003', priceType: 'WHOLESALE', nganhHang: ['2003'] },
      { id: 104, code: 'ITPG-004', priceType: 'RETAIL', nganhHang: [] }
    ]
  };
  lockedAppDataCalls = [];
  renameFieldCalls = [];
}

stubModule('lib/appData', {
  withLockedAppDataValue: async (key, mutateFn) => {
    lockedAppDataCalls.push(key);
    APPDATA[key] = mutateFn(APPDATA[key]);
  }
});
stubModule('lib/recordStore', {
  renameFieldValueInCollection: async (collection, mutateFn) => {
    renameFieldCalls.push(collection);
    const list = RECORDS[collection] || [];
    RECORDS[collection] = list.map((item) => mutateFn(item));
  }
});

const { cascadeNganhHangCodeRename, diffNganhHangCatalogRenames } = require('../lib/catalogRename');

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
  test('diffNganhHangCatalogRenames: 1 dòng đổi mã (cùng id, khác code) -> phát hiện đúng 1 cặp', () => {
    const oldList = [{ id: 1, code: '1002', name: 'Thực phẩm', dept: '' }, { id: 2, code: '2003', name: 'Gia dụng', dept: '' }];
    const newList = [{ id: 1, code: '1002-A', name: 'Thực phẩm', dept: '' }, { id: 2, code: '2003', name: 'Gia dụng', dept: '' }];
    assert.deepStrictEqual(diffNganhHangCatalogRenames(oldList, newList), [{ oldValue: '1002', newValue: '1002-A' }]);
  });

  test('diffNganhHangCatalogRenames: thêm ngành hàng mới (id không có trong mảng cũ) -> KHÔNG bị coi là đổi mã', () => {
    const oldList = [{ id: 1, code: '1002', name: 'A' }];
    const newList = [{ id: 1, code: '1002', name: 'A' }, { id: 2, code: '9999', name: 'Mới' }];
    assert.deepStrictEqual(diffNganhHangCatalogRenames(oldList, newList), []);
  });

  test('diffNganhHangCatalogRenames: xoá hẳn 1 ngành hàng -> KHÔNG báo đổi mã', () => {
    const oldList = [{ id: 1, code: '1002', name: 'A' }, { id: 2, code: '2003', name: 'B' }];
    const newList = [{ id: 1, code: '1002', name: 'A' }];
    assert.deepStrictEqual(diffNganhHangCatalogRenames(oldList, newList), []);
  });

  test('diffNganhHangCatalogRenames: chỉ sửa name/dept, KHÔNG đổi code -> không báo đổi mã', () => {
    const oldList = [{ id: 1, code: '1002', name: 'Thực phẩm', dept: '' }];
    const newList = [{ id: 1, code: '1002', name: 'Thực Phẩm Tươi Sống', dept: 'Phòng Mua Hàng' }];
    assert.deepStrictEqual(diffNganhHangCatalogRenames(oldList, newList), []);
  });

  test('diffNganhHangCatalogRenames: mảng cũ rỗng/thiếu -> không throw, trả mảng rỗng', () => {
    assert.deepStrictEqual(diffNganhHangCatalogRenames(null, [{ id: 1, code: '1002' }]), []);
    assert.deepStrictEqual(diffNganhHangCatalogRenames(undefined, undefined), []);
  });

  await testAsync('cascadeNganhHangCodeRename: dời mã trong MỌI dòng rule đang dùng mã cũ (giữ nguyên dòng khác/dòng "Mặc định")', async () => {
    resetState();
    await cascadeNganhHangCodeRename('1002', '1002-A');
    assert.deepStrictEqual(APPDATA.itPriceWholesaleStoreMixedApprovalRules.map(r => r.nganhHang), [
      ['1002-A'],           // id 1: chỉ có mã cũ -> đổi
      ['1002-A', '2003'],   // id 2: có CẢ mã cũ lẫn mã khác -> chỉ đổi đúng phần tử khớp
      ['2003'],             // id 3: không dùng mã cũ -> giữ nguyên
      []                    // id 4: "Mặc định" (rỗng) -> giữ nguyên, không bị đụng tới
    ]);
    assert.deepStrictEqual(lockedAppDataCalls, ['itPriceWholesaleStoreMixedApprovalRules']);
  });

  await testAsync('cascadeNganhHangCodeRename: dời mã trong MỌI đề xuất itPriceApprovals đang dùng mã cũ (PENDING lẫn đã xử lý)', async () => {
    resetState();
    await cascadeNganhHangCodeRename('1002', '1002-A');
    assert.deepStrictEqual(RECORDS.itPriceApprovals.map(p => p.nganhHang), [
      ['1002-A'],
      ['1002-A', '2003'],
      ['2003'],
      []
    ]);
    assert.deepStrictEqual(renameFieldCalls, ['itPriceApprovals']);
  });

  await testAsync('cascadeNganhHangCodeRename: mã không ai dùng -> không đổi gì, không lỗi', async () => {
    resetState();
    await cascadeNganhHangCodeRename('KHONG-AI-DUNG', 'MA-MOI');
    assert.deepStrictEqual(APPDATA.itPriceWholesaleStoreMixedApprovalRules.map(r => r.nganhHang), [['1002'], ['1002', '2003'], ['2003'], []]);
    assert.deepStrictEqual(RECORDS.itPriceApprovals.map(p => p.nganhHang), [['1002'], ['1002', '2003'], ['2003'], []]);
  });

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  if (failed > 0) process.exit(1);
}

main();
