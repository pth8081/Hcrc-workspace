// server/tests/test-vendorrebate-bas-extension-10-2026.js
//
// Mở rộng BAS (10/2026, theo file Điều Khoản Thương Mại/Tính BAS người dùng cung cấp) — 3 nghiệp vụ mới
// trong lib/vendorRebate.js + lib/purchaseBasisAggregator.js:
//   1. GROWTH_REBATE (Chiết Khấu Theo Tăng Trưởng) — GỠ khỏi UNSUPPORTED_TERM_TYPES, tính % tăng trưởng
//      so KỲ LIỀN TRƯỚC cùng độ dài, tra bậc thang CLIFF ra rate, áp lên basisAmount kỳ này.
//   2. FIXED_LUMP_SUM (amountMode) — điều khoản số tiền cố định/kỳ (không phụ thuộc doanh số), có thể
//      phân bổ theo tỷ trọng thực nhập đa pháp nhân (PRORATA_BY_ENTITY) hoặc gán 100% 1 pháp nhân
//      (FULL_TO_ENTITY).
//   3. scopeType ENTITY/CHANNEL mới trong matchesScope() — lọc theo pháp nhân (BRG/Fuji) / kênh mua
//      (qua Kho Trung Tâm DC hay mua trực tiếp) — 3 scopeType cũ (STORE_FORMAT/STORE/CATEGORY) KHÔNG đổi.
//
// Toàn bộ hàm test ở đây là hàm THUẦN (không cần DB/HTTP) — chạy thẳng: node server/tests/test-vendorrebate-bas-extension-10-2026.js
'use strict';
const assert = require('assert');
const vendorRebate = require('../lib/vendorRebate');
const { aggregateBasisAmount, matchesScope } = require('../lib/purchaseBasisAggregator');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.stack || err.message}`); failed++; }
}

const vendor = { id: 1, vendorCode: 'NCC001' };

// ===================== 1. GROWTH_REBATE =====================
test('assertCalcBasisAndTermTypeSupported: GROWTH_REBATE KHÔNG còn bị chặn', () => {
  const err = vendorRebate.assertCalcBasisAndTermTypeSupported('PURCHASE_VALUE', 'GROWTH_REBATE');
  assert.strictEqual(err, null);
});

test('computePreviousPeriod: kỳ liền trước cùng độ dài, kết thúc đúng 1 ngày trước periodStart', () => {
  const { previousPeriodStart, previousPeriodEnd } = vendorRebate.computePreviousPeriod('2026-03-01', '2026-03-31');
  assert.strictEqual(previousPeriodEnd, '2026-02-28');
  assert.strictEqual(previousPeriodStart, '2026-01-29'); // 31 ngày (01/03->31/03) lùi lại từ 28/02
});

test('findAchievedGrowthRate: CLIFF — đạt mốc cao nhất', () => {
  const tiers = [{ fromAmount: 0, ratePct: 0 }, { fromAmount: 10, ratePct: 0.5 }, { fromAmount: 20, ratePct: 1.5 }];
  assert.strictEqual(vendorRebate.findAchievedGrowthRate(5, tiers), 0);
  assert.strictEqual(vendorRebate.findAchievedGrowthRate(15, tiers), 0.5);
  assert.strictEqual(vendorRebate.findAchievedGrowthRate(25, tiers), 1.5);
});

test('computeRebateEstimate GROWTH_REBATE: tăng trưởng 20% -> áp rate bậc đạt lên basisAmount kỳ này', () => {
  const term = {
    termType: 'GROWTH_REBATE', amountMode: 'PERCENT_TIERED', scopes: [],
    tiers: [{ fromAmount: 0, ratePct: 0 }, { fromAmount: 10, ratePct: 1 }, { fromAmount: 20, ratePct: 2 }]
  };
  // Kỳ trước: 100tr (01/02-28/02), Kỳ này: 120tr (01/03-31/03) -> tăng trưởng đúng 20% -> đạt mốc 2%
  const purchaseTransactions = [
    { vendorCode: 'NCC001', purchaseDate: '2026-02-15', amount: 100000000, isReturn: false },
    { vendorCode: 'NCC001', purchaseDate: '2026-03-15', amount: 120000000, isReturn: false }
  ];
  const result = vendorRebate.computeRebateEstimate({
    vendor, term, purchaseTransactions, periodStart: '2026-03-01', periodEnd: '2026-03-31',
    previousPeriodStart: '2026-02-01', previousPeriodEnd: '2026-02-28'
  });
  assert.strictEqual(result.basisAmount, 120000000);
  assert.strictEqual(result.breakdown[0].prevBasisAmount, 100000000);
  assert.strictEqual(result.breakdown[0].growthPct, 20);
  assert.strictEqual(result.breakdown[0].achievedRatePct, 2);
  assert.strictEqual(result.rebateAmount, 120000000 * 2 / 100);
});

test('computeRebateEstimate GROWTH_REBATE: kỳ trước = 0 -> coi tăng trưởng 100% (không chia cho 0)', () => {
  const term = { termType: 'GROWTH_REBATE', tiers: [{ fromAmount: 0, ratePct: 0 }, { fromAmount: 50, ratePct: 3 }], scopes: [] };
  const purchaseTransactions = [{ vendorCode: 'NCC001', purchaseDate: '2026-03-15', amount: 50000000, isReturn: false }];
  const result = vendorRebate.computeRebateEstimate({
    vendor, term, purchaseTransactions, periodStart: '2026-03-01', periodEnd: '2026-03-31',
    previousPeriodStart: '2026-02-01', previousPeriodEnd: '2026-02-28'
  });
  assert.strictEqual(result.breakdown[0].prevBasisAmount, 0);
  assert.strictEqual(result.breakdown[0].growthPct, 100);
  assert.strictEqual(result.rebateAmount, 50000000 * 3 / 100);
});

test('VOLUME_REBATE (termType khác) KHÔNG bị ảnh hưởng — vẫn dùng calculateTieredRebate như cũ', () => {
  const term = { termType: 'VOLUME_REBATE', tierMode: 'CLIFF', tiers: [{ fromAmount: 0, ratePct: 5 }], scopes: [] };
  const purchaseTransactions = [{ vendorCode: 'NCC001', purchaseDate: '2026-03-15', amount: 100000000, isReturn: false }];
  const result = vendorRebate.computeRebateEstimate({ vendor, term, purchaseTransactions, periodStart: '2026-03-01', periodEnd: '2026-03-31' });
  assert.strictEqual(result.rebateAmount, 100000000 * 5 / 100);
  assert.ok(!result.breakdown[0] || result.breakdown[0].growthPct === undefined, 'không được lẫn breakdown dạng growth');
});

// ===================== 2. FIXED_LUMP_SUM + phân bổ đa pháp nhân =====================
test('FIXED_LUMP_SUM allocationMode=NONE -> rebateAmount = fixedAmount, không entityAllocation', () => {
  const term = { amountMode: 'FIXED_LUMP_SUM', fixedAmount: 2000000, allocationMode: 'NONE', scopes: [] };
  const result = vendorRebate.computeRebateEstimate({ vendor, term, purchaseTransactions: [], periodStart: '2026-03-01', periodEnd: '2026-03-31' });
  assert.strictEqual(result.rebateAmount, 2000000);
  assert.strictEqual(result.entityAllocation, null);
});

test('FIXED_LUMP_SUM allocationMode=FULL_TO_ENTITY -> gán nguyên 100% cho 1 pháp nhân', () => {
  const term = { amountMode: 'FIXED_LUMP_SUM', fixedAmount: 2000000, allocationMode: 'FULL_TO_ENTITY', allocationTargetEntity: 'BRG', scopes: [] };
  const result = vendorRebate.computeRebateEstimate({ vendor, term, purchaseTransactions: [], periodStart: '2026-03-01', periodEnd: '2026-03-31' });
  assert.strictEqual(result.rebateAmount, 2000000);
  assert.deepStrictEqual(result.entityAllocation, [{ entity: 'BRG', purchaseAmount: null, ratio: 1, allocatedAmount: 2000000 }]);
});

test('FIXED_LUMP_SUM allocationMode=PRORATA_BY_ENTITY -> chia theo đúng tỷ trọng thực nhập (mirror cơ chế BRG/Fuji trong file người dùng)', () => {
  const brgAmount = 6914968017.95, fujiAmount = 4478603964.1;
  const term = {
    amountMode: 'FIXED_LUMP_SUM', fixedAmount: 50000000, allocationMode: 'PRORATA_BY_ENTITY',
    allocationEntities: ['BRG', 'FUJI'], scopes: []
  };
  const purchaseTransactions = [
    { vendorCode: 'NCC001', purchaseDate: '2026-03-10', amount: brgAmount, isReturn: false, entity: 'BRG' },
    { vendorCode: 'NCC001', purchaseDate: '2026-03-10', amount: fujiAmount, isReturn: false, entity: 'FUJI' }
  ];
  const result = vendorRebate.computeRebateEstimate({ vendor, term, purchaseTransactions, periodStart: '2026-03-01', periodEnd: '2026-03-31' });
  assert.strictEqual(result.rebateAmount, 50000000);
  const expectedBrgRatio = brgAmount / (brgAmount + fujiAmount);
  const brg = result.entityAllocation.find(e => e.entity === 'BRG');
  assert.ok(Math.abs(brg.ratio - expectedBrgRatio) < 1e-9, `tỷ trọng BRG sai: ${brg.ratio} (mong đợi ${expectedBrgRatio})`);
  assert.ok(Math.abs(brg.allocatedAmount - 50000000 * expectedBrgRatio) < 1e-6, `số tiền phân bổ BRG sai: ${brg.allocatedAmount}`);
  const sumAllocated = result.entityAllocation.reduce((s, e) => s + e.allocatedAmount, 0);
  assert.ok(Math.abs(sumAllocated - 50000000) < 1e-6, 'tổng phân bổ phải khớp đúng fixedAmount (không rơi rớt)');
});

// ===================== Vá Cao #3 (rà soát v24.74→v24.90, 10/2026) =====================
// allocateFixedAmountByEntity(): trùng tên pháp nhân trong allocationEntities (VD ['BRG','BRG','FUJI'])
// trước đây cộng basisAmount của BRG 2 LẦN vào grandTotal (mẫu số chung) nhưng chỉ 1 LẦN vào
// totalsByEntity (tử số theo key) -> làm lệch tỷ trọng của FUJI (pháp nhân KHÔNG trùng) dù tổng vẫn khớp
// 100% fixedAmount (dễ lọt test "tổng có khớp không"). Test dưới so sánh ĐÚNG ratio của FUJI với kịch bản
// KHÔNG trùng (['BRG','FUJI']) để bắt được sai lệch tỷ trọng, không chỉ check tổng.
test('allocateFixedAmountByEntity: trùng tên pháp nhân KHÔNG làm lệch tỷ trọng (dedupe trước khi tính grandTotal)', () => {
  const brgAmount = 6914968017.95, fujiAmount = 4478603964.1;
  const purchaseTransactions = [
    { vendorCode: 'NCC001', purchaseDate: '2026-03-10', amount: brgAmount, isReturn: false, entity: 'BRG' },
    { vendorCode: 'NCC001', purchaseDate: '2026-03-10', amount: fujiAmount, isReturn: false, entity: 'FUJI' }
  ];
  const termNoDup = { amountMode: 'FIXED_LUMP_SUM', fixedAmount: 50000000, allocationMode: 'PRORATA_BY_ENTITY', allocationEntities: ['BRG', 'FUJI'], scopes: [] };
  const termWithDup = { amountMode: 'FIXED_LUMP_SUM', fixedAmount: 50000000, allocationMode: 'PRORATA_BY_ENTITY', allocationEntities: ['BRG', 'BRG', 'FUJI'], scopes: [] };

  const resultNoDup = vendorRebate.computeRebateEstimate({ vendor, term: termNoDup, purchaseTransactions, periodStart: '2026-03-01', periodEnd: '2026-03-31' });
  const resultWithDup = vendorRebate.computeRebateEstimate({ vendor, term: termWithDup, purchaseTransactions, periodStart: '2026-03-01', periodEnd: '2026-03-31' });

  const fujiNoDup = resultNoDup.entityAllocation.find(e => e.entity === 'FUJI');
  // Entity trùng ('BRG') xuất hiện 2 lần trong entityAllocation TRƯỚC KHI vá (bug cũ) — sau khi dedupe chỉ
  // còn ĐÚNG 1 dòng mỗi entity, giống kịch bản không trùng.
  assert.strictEqual(resultWithDup.entityAllocation.length, 2, `phải dedupe về đúng 2 pháp nhân (BRG+FUJI), thực tế: ${resultWithDup.entityAllocation.length}`);
  const fujiWithDup = resultWithDup.entityAllocation.find(e => e.entity === 'FUJI');
  assert.ok(Math.abs(fujiWithDup.ratio - fujiNoDup.ratio) < 1e-9, `tỷ trọng FUJI bị lệch do trùng tên BRG: ${fujiWithDup.ratio} (mong đợi ${fujiNoDup.ratio})`);
  const sumAllocated = resultWithDup.entityAllocation.reduce((s, e) => s + e.allocatedAmount, 0);
  assert.ok(Math.abs(sumAllocated - 50000000) < 1e-6, 'tổng phân bổ (đã dedupe) vẫn phải khớp đúng fixedAmount');
});

test('validateRebateTermPayload: PRORATA_BY_ENTITY trùng tên pháp nhân -> báo lỗi (chặn ngay tại validate)', () => {
  const base = { termCode: 'DK-01', termName: 'X', termType: 'TRADE_SPEND', calcBasis: 'PURCHASE_VALUE', tierMode: 'GRADUATED', periodType: 'ONE_TIME', effectiveFrom: '2026-01-01', amountMode: 'FIXED_LUMP_SUM', fixedAmount: 1, allocationMode: 'PRORATA_BY_ENTITY', allocationEntities: ['BRG', 'BRG', 'FUJI'], scopes: [] };
  const err = vendorRebate.validateRebateTermPayload(base);
  assert.ok(err && err.includes('Trùng pháp nhân'), `phải báo lỗi trùng pháp nhân — thực tế: ${err}`);
});

test('FIXED_LUMP_SUM PRORATA nhưng không có giao dịch nào của pháp nhân nào -> ratio=0, không NaN/chia 0', () => {
  const term = { amountMode: 'FIXED_LUMP_SUM', fixedAmount: 1000000, allocationMode: 'PRORATA_BY_ENTITY', allocationEntities: ['BRG', 'FUJI'], scopes: [] };
  const result = vendorRebate.computeRebateEstimate({ vendor, term, purchaseTransactions: [], periodStart: '2026-03-01', periodEnd: '2026-03-31' });
  result.entityAllocation.forEach(e => {
    assert.strictEqual(e.ratio, 0);
    assert.strictEqual(e.allocatedAmount, 0);
    assert.ok(!Number.isNaN(e.allocatedAmount));
  });
});

// ===================== 3. scopeType ENTITY/CHANNEL =====================
test('matchesScope: 3 scopeType CŨ (STORE_FORMAT/STORE/CATEGORY) không đổi hành vi', () => {
  const line = { storeFormat: 'MART', storeCode: 'ST001', categoryCode: 'FOOD' };
  assert.strictEqual(matchesScope(line, []), true);
  assert.strictEqual(matchesScope(line, [{ scopeType: 'STORE_FORMAT', scopeValue: 'MART' }]), true);
  assert.strictEqual(matchesScope(line, [{ scopeType: 'STORE_FORMAT', scopeValue: 'MINIMART' }]), false);
  assert.strictEqual(matchesScope(line, [{ scopeType: 'STORE', scopeValue: 'ST001' }]), true);
  assert.strictEqual(matchesScope(line, [{ scopeType: 'CATEGORY', scopeValue: 'FOOD' }]), true);
});

test('matchesScope: ENTITY mới — lọc đúng pháp nhân', () => {
  assert.strictEqual(matchesScope({ entity: 'BRG' }, [{ scopeType: 'ENTITY', scopeValue: 'BRG' }]), true);
  assert.strictEqual(matchesScope({ entity: 'FUJI' }, [{ scopeType: 'ENTITY', scopeValue: 'BRG' }]), false);
  assert.strictEqual(matchesScope({ entity: null }, [{ scopeType: 'ENTITY', scopeValue: 'BRG' }]), false);
});

test('matchesScope: CHANNEL mới — lọc đúng qua DC/trực tiếp', () => {
  assert.strictEqual(matchesScope({ isViaDC: true }, [{ scopeType: 'CHANNEL', scopeValue: 'DC' }]), true);
  assert.strictEqual(matchesScope({ isViaDC: false }, [{ scopeType: 'CHANNEL', scopeValue: 'DC' }]), false);
  assert.strictEqual(matchesScope({ isViaDC: false }, [{ scopeType: 'CHANNEL', scopeValue: 'DIRECT' }]), true);
  assert.strictEqual(matchesScope({}, [{ scopeType: 'CHANNEL', scopeValue: 'DIRECT' }]), true); // thiếu isViaDC -> coi như trực tiếp
});

test('aggregateBasisAmount: scope CHANNEL=DC chỉ gộp đúng giao dịch qua DC (mirror "BAS qua DC" tách riêng)', () => {
  const lines = [
    { vendorCode: 'NCC001', purchaseDate: '2026-03-05', amount: 1000, isReturn: false, isViaDC: true },
    { vendorCode: 'NCC001', purchaseDate: '2026-03-06', amount: 2000, isReturn: false, isViaDC: false }
  ];
  const { basisAmount } = aggregateBasisAmount(lines, {
    vendorCode: 'NCC001', periodStart: '2026-03-01', periodEnd: '2026-03-31', scopes: [{ scopeType: 'CHANNEL', scopeValue: 'DC' }]
  });
  assert.strictEqual(basisAmount, 1000);
});

// ===================== 4. validateRebateTermPayload cho FIXED_LUMP_SUM =====================
test('validateRebateTermPayload: FIXED_LUMP_SUM thiếu fixedAmount -> báo lỗi, KHÔNG bắt buộc tiers', () => {
  const base = { termCode: 'DK-01', termName: 'Phí tạo mã mới', termType: 'LISTING_FEE', calcBasis: 'PURCHASE_VALUE', tierMode: 'GRADUATED', periodType: 'ONE_TIME', effectiveFrom: '2026-01-01', amountMode: 'FIXED_LUMP_SUM' };
  const err = vendorRebate.validateRebateTermPayload({ ...base });
  assert.ok(err && err.includes('Số Tiền Cố Định'), `phải báo lỗi thiếu fixedAmount — thực tế: ${err}`);
});

test('validateRebateTermPayload: FIXED_LUMP_SUM có fixedAmount hợp lệ, KHÔNG cần tiers -> qua', () => {
  const base = { termCode: 'DK-01', termName: 'Phí tạo mã mới', termType: 'LISTING_FEE', calcBasis: 'PURCHASE_VALUE', tierMode: 'GRADUATED', periodType: 'ONE_TIME', effectiveFrom: '2026-01-01', amountMode: 'FIXED_LUMP_SUM', fixedAmount: 2000000, scopes: [] };
  assert.strictEqual(vendorRebate.validateRebateTermPayload(base), null);
});

test('validateRebateTermPayload: PRORATA_BY_ENTITY cần >= 2 pháp nhân', () => {
  const base = { termCode: 'DK-01', termName: 'X', termType: 'TRADE_SPEND', calcBasis: 'PURCHASE_VALUE', tierMode: 'GRADUATED', periodType: 'ONE_TIME', effectiveFrom: '2026-01-01', amountMode: 'FIXED_LUMP_SUM', fixedAmount: 1, allocationMode: 'PRORATA_BY_ENTITY', allocationEntities: ['BRG'], scopes: [] };
  const err = vendorRebate.validateRebateTermPayload(base);
  assert.ok(err && err.includes('ít nhất 2 pháp nhân'), `thực tế: ${err}`);
});

test('validateRebateTermPayload: PERCENT_TIERED (mặc định, điều khoản cũ) vẫn bắt buộc tiers như trước', () => {
  const base = { termCode: 'DK-01', termName: 'X', termType: 'VOLUME_REBATE', calcBasis: 'PURCHASE_VALUE', tierMode: 'GRADUATED', periodType: 'ONE_TIME', effectiveFrom: '2026-01-01', scopes: [] };
  const err = vendorRebate.validateRebateTermPayload(base); // không có amountMode -> mặc định PERCENT_TIERED
  assert.ok(err && err.includes('bậc thang'), `thực tế: ${err}`);
});

// ===================== 5. defaultRebateTerm() giữ nguyên hành vi mặc định =====================
test('defaultRebateTerm(): field mở rộng 10/2026 có giá trị mặc định ĐÚNG hành vi gốc', () => {
  const t = vendorRebate.defaultRebateTerm(1);
  assert.strictEqual(t.includedInBas, true);
  assert.strictEqual(t.amountMode, 'PERCENT_TIERED');
  assert.strictEqual(t.allocationMode, 'NONE');
  assert.deepStrictEqual(t.allocationEntities, []);
  assert.strictEqual(t.allocationTargetEntity, null);
});

console.log(`\n== Kết quả: ${passed} PASS, ${failed} FAIL ==`);
process.exit(failed ? 1 : 0);
