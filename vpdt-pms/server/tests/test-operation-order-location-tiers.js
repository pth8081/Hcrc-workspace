// server/tests/test-operation-order-location-tiers.js
//
// Test THUẦN Node (không Playwright/SQL Server) cho đợt "Tách Đơn Hàng Siêu Thị/HO" — quy trình duyệt
// operationOrders đổi HẲN từ theo phòng ban sang theo MỨC GIÁ TRỊ đơn hàng, TÁCH RIÊNG hoàn toàn "Đặt
// Hàng Tại Siêu Thị" (STORE, 3 mức) và "Đặt Hàng Tại HO" (HO, 2 mức) — xem lib/workflowEngine.js
// computeOperationOrderTier()/computeOperationOrderAmount()/resolveOperationOrderWorkflow().
//
// Phủ:
//   1. computeOperationOrderTier() bắt đúng biên giới ở CẢ 2 phía đúng mốc 10.000.000 và 100.000.000
//      (mốc đúng bằng luôn rơi vào mức CAO HƠN — "< 10 triệu"/"< 100 triệu" LOẠI TRỪ đúng mốc đó).
//   2. computeOperationOrderAmount() lấy MAX(amount, paymentTotalAmount) — paymentTotalAmount (field
//      người dùng tự gõ trên form/đọc từ PDF) chỉ được phép đẩy tier LÊN cao hơn (VD gồm VAT/phụ phí),
//      KHÔNG được phép kéo tier XUỐNG thấp hơn mức mà amount (server tự tính lại từ items, tamper-proof)
//      thật sự yêu cầu — đây chính là hướng đã từng là lỗ hổng (đã vá).
//   3. 2 quy trình Siêu Thị/HO ĐỘC LẬP HOÀN TOÀN: approver cấu hình cho 1 mức của Siêu Thị KHÔNG được
//      quyền duyệt đơn HO (dù cùng mức giá trị tương đương), và ngược lại.
//   4. Server LUÔN tự tính lại tier từ amount/orderLocationType hiện có trên item — 1 field lạ client tự
//      gắn thêm vào (giả lập cố tình sửa tay ở DevTools) mô phỏng tier KHÁC hoàn toàn không hề được đọc
//      tới, resolveOperationOrderWorkflow() vẫn tính đúng dựa trên amount thật.
//
// Chạy: node server/tests/test-operation-order-location-tiers.js
const assert = require('assert');
const {
  applyWorkflowAction, WorkflowError,
  computeOperationOrderAmount, computeOperationOrderTier,
  OPERATION_ORDER_STORE_TIERS, OPERATION_ORDER_HO_TIERS
} = require('../lib/workflowEngine');

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
function assertThrows(fn, statusExpected, messageContains, label) {
  try {
    fn();
  } catch (err) {
    assert(err instanceof WorkflowError || typeof err.status === 'number', `${label}: lỗi ném ra phải có .status`);
    if (statusExpected !== undefined) assert.strictEqual(err.status, statusExpected, `${label}: sai mã lỗi (nhận ${err.status})`);
    if (messageContains) assert(err.message.includes(messageContains), `${label}: message "${err.message}" phải chứa "${messageContains}"`);
    return;
  }
  throw new Error(`${label}: đáng lẽ phải ném lỗi nhưng không`);
}

// ===================== 1) Biên giới mức (STORE: 3 mức, HO: 2 mức) =====================
test('OPERATION_ORDER_STORE_TIERS/OPERATION_ORDER_HO_TIERS: đúng số lượng mức đã chốt với người dùng', () => {
  assert.strictEqual(OPERATION_ORDER_STORE_TIERS.length, 3, 'Siêu Thị phải có đúng 3 mức');
  assert.strictEqual(OPERATION_ORDER_HO_TIERS.length, 2, 'HO phải có đúng 2 mức');
});

test('computeOperationOrderTier(STORE): biên giới 10.000.000 — đúng mốc rơi vào mức GIỮA (không phải mức thấp)', () => {
  assert.strictEqual(computeOperationOrderTier('STORE', 9999999), 'LT10M', '9.999.999 phải là LT10M (< 10 triệu)');
  assert.strictEqual(computeOperationOrderTier('STORE', 10000000), 'FROM10M_TO100M', 'ĐÚNG 10.000.000 phải rơi vào mức GIỮA (10tr-100tr), KHÔNG còn là "< 10 triệu"');
  assert.strictEqual(computeOperationOrderTier('STORE', 10000001), 'FROM10M_TO100M', '10.000.001 phải là mức giữa');
});
test('computeOperationOrderTier(STORE): biên giới 100.000.000 — đúng mốc rơi vào mức CAO NHẤT', () => {
  assert.strictEqual(computeOperationOrderTier('STORE', 99999999), 'FROM10M_TO100M', '99.999.999 vẫn phải là mức giữa (< 100 triệu)');
  assert.strictEqual(computeOperationOrderTier('STORE', 100000000), 'GTE100M', 'ĐÚNG 100.000.000 phải rơi vào mức CAO NHẤT (>= 100 triệu), KHÔNG còn là mức giữa');
  assert.strictEqual(computeOperationOrderTier('STORE', 100000001), 'GTE100M', '100.000.001 phải là mức cao nhất');
});
test('computeOperationOrderTier(STORE): giá trị 0/rất nhỏ vẫn rơi đúng mức thấp nhất', () => {
  assert.strictEqual(computeOperationOrderTier('STORE', 0), 'LT10M');
  assert.strictEqual(computeOperationOrderTier('STORE', 1), 'LT10M');
});
test('computeOperationOrderTier(HO): biên giới 100.000.000 — đúng mốc rơi vào mức CAO (chỉ 2 mức, không có mức 10 triệu)', () => {
  assert.strictEqual(computeOperationOrderTier('HO', 9999999), 'LT100M', 'HO không có mức 10 triệu — vẫn là LT100M');
  assert.strictEqual(computeOperationOrderTier('HO', 99999999), 'LT100M', '99.999.999 phải là LT100M (< 100 triệu)');
  assert.strictEqual(computeOperationOrderTier('HO', 100000000), 'GTE100M', 'ĐÚNG 100.000.000 phải rơi vào mức CAO (>= 100 triệu)');
  assert.strictEqual(computeOperationOrderTier('HO', 100000001), 'GTE100M');
});
test('computeOperationOrderTier(): locationType lạ/thiếu (fallback) coi như HO, KHÔNG throw', () => {
  assert.strictEqual(computeOperationOrderTier(undefined, 50000000), 'LT100M');
  assert.strictEqual(computeOperationOrderTier('KHONG_HOP_LE', 50000000), 'LT100M');
});

// ===================== 2) Ưu tiên paymentTotalAmount > amount =====================
test('computeOperationOrderAmount(): paymentTotalAmount > amount -> dùng paymentTotalAmount (max thắng)', () => {
  assert.strictEqual(computeOperationOrderAmount({ amount: 1000000, paymentTotalAmount: 250000000 }), 250000000);
});
test('computeOperationOrderAmount(): amount > paymentTotalAmount -> dùng amount (max thắng, paymentTotalAmount giả thấp KHÔNG kéo xuống được)', () => {
  assert.strictEqual(computeOperationOrderAmount({ amount: 250000000, paymentTotalAmount: 1000000 }), 250000000);
});
test('computeOperationOrderAmount(): paymentTotalAmount = 0/chưa nhập -> dùng amount (đơn tạo tay không kèm PDF)', () => {
  assert.strictEqual(computeOperationOrderAmount({ amount: 5000000, paymentTotalAmount: 0 }), 5000000);
  assert.strictEqual(computeOperationOrderAmount({ amount: 5000000 }), 5000000);
  assert.strictEqual(computeOperationOrderAmount({ amount: 5000000, paymentTotalAmount: null }), 5000000);
});
test('computeOperationOrderAmount(): cả 2 field đều thiếu -> 0, không throw/NaN', () => {
  assert.strictEqual(computeOperationOrderAmount({}), 0);
});

// ===================== 3) Siêu Thị/HO ĐỘC LẬP HOÀN TOÀN — approver 1 bên không duyệt được bên kia =====================
const STORE_APPROVER = 'tp.sieuthi';
const HO_APPROVER = 'tp.ho';
const appData = {
  workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
  operationOrderStoreTierWorkflows: {
    LT10M: { workflowId: 'WF_1STEP', approvers: { 1: [STORE_APPROVER] } }
  },
  operationOrderHOTierWorkflows: {
    LT100M: { workflowId: 'WF_1STEP', approvers: { 1: [HO_APPROVER] } }
  }
};
function freshOrder(overrides) {
  return Object.assign({
    id: 1, code: 'DH-0001', dept: 'Phòng Vận Hành', status: 'PENDING', currentStep: 1, history: [],
    creator: 'nv.mua', creatorName: 'Nhân Viên Mua Hàng', amount: 5000000, items: []
  }, overrides);
}
function makeUser(username, extra) { return Object.assign({ username, name: username, perms: {} }, extra); }

test('Đơn STORE (5tr, tier LT10M): approver Siêu Thị duyệt được', () => {
  const item = freshOrder({ orderLocationType: 'STORE' });
  const { item: result, transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: makeUser(STORE_APPROVER), comment: '', appData });
  assert.strictEqual(transition.type, 'COMPLETED');
  assert.strictEqual(result.status, 'AWAITING_RECEIPT');
});
test('Đơn STORE (5tr, tier LT10M): approver HO (dù cấu hình đúng mức tương ứng bên HO) KHÔNG được quyền duyệt — 403', () => {
  const item = freshOrder({ orderLocationType: 'STORE' });
  assertThrows(
    () => applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: makeUser(HO_APPROVER), comment: '', appData }),
    403, 'Bạn không có quyền', 'STORE order approved by HO approver'
  );
});
test('Đơn HO (5tr, tier LT100M): approver HO duyệt được', () => {
  const item = freshOrder({ orderLocationType: 'HO' });
  const { item: result, transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: makeUser(HO_APPROVER), comment: '', appData });
  assert.strictEqual(transition.type, 'COMPLETED');
  assert.strictEqual(result.status, 'AWAITING_RECEIPT');
});
test('Đơn HO (5tr, tier LT100M): approver Siêu Thị KHÔNG được quyền duyệt — 403 (2 quy trình hoàn toàn tách biệt)', () => {
  const item = freshOrder({ orderLocationType: 'HO' });
  assertThrows(
    () => applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: makeUser(STORE_APPROVER), comment: '', appData }),
    403, 'Bạn không có quyền', 'HO order approved by STORE approver'
  );
});
test('Cùng 1 số tiền (50 triệu) nhưng khác orderLocationType -> rơi vào 2 tier KHÁC NHAU (STORE: mức giữa, HO: mức thấp) -> 2 tập approver khác nhau', () => {
  const storeItem = freshOrder({ orderLocationType: 'STORE', amount: 50000000 });
  const hoItem = freshOrder({ orderLocationType: 'HO', amount: 50000000 });
  // STORE 50tr rơi vào FROM10M_TO100M — CHƯA cấu hình approver nào (appData chỉ có LT10M) -> approvers rỗng -> 403 với cả STORE_APPROVER lẫn HO_APPROVER (không ai trong danh sách rỗng).
  assertThrows(
    () => applyWorkflowAction({ moduleKey: 'operationOrders', item: storeItem, action: 'APPROVE', user: makeUser(STORE_APPROVER), comment: '', appData }),
    403, 'Bạn không có quyền', 'STORE 50tr (tier FROM10M_TO100M chưa cấu hình) phải chặn mọi người kể cả approver LT10M'
  );
  // HO 50tr rơi vào LT100M (ĐÃ cấu hình HO_APPROVER) -> duyệt được bình thường.
  const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item: hoItem, action: 'APPROVE', user: makeUser(HO_APPROVER), comment: '', appData });
  assert.strictEqual(transition.type, 'COMPLETED', 'HO 50tr (tier LT100M đã cấu hình) phải duyệt được bình thường');
});

// ===================== 4) Server LUÔN tự tính lại tier — KHÔNG tin field lạ client tự gắn =====================
test('Tamper: item mang field lạ mô phỏng tier THẤP (vd client tự gắn orderTier:"LT10M") nhưng amount thật rơi vào GTE100M -> server vẫn tính lại ĐÚNG theo amount thật, KHÔNG đọc field lạ đó', () => {
  // 250 triệu, orderLocationType STORE -> tier THẬT phải là GTE100M — appData CHƯA cấu hình approver nào
  // cho GTE100M (chỉ có LT10M), nên STORE_APPROVER (chỉ được gán ở LT10M) PHẢI bị chặn — nếu server lỡ
  // tin field "orderTier" giả client gắn thêm (LT10M) thay vì tự tính lại, STORE_APPROVER sẽ bị duyệt
  // NHẦM được (lỗ hổng leo thang quyền) — test này xác nhận điều đó KHÔNG xảy ra.
  const item = freshOrder({ orderLocationType: 'STORE', amount: 250000000, orderTier: 'LT10M', tier: 'LT10M' });
  assertThrows(
    () => applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: makeUser(STORE_APPROVER), comment: '', appData }),
    403, 'Bạn không có quyền', 'Field lạ "orderTier" client tự gắn KHÔNG được server tin — vẫn phải chặn đúng theo amount thật (GTE100M, chưa cấu hình approver)'
  );
});
test('paymentTotalAmount CAO hơn amount (VD gồm VAT/phụ phí) hợp lệ đẩy tier LÊN cao hơn — đúng thiết kế công khai (max(amount, paymentTotalAmount))', () => {
  // paymentTotalAmount (250tr) > amount (5tr) -> max = 250tr -> tier HO phải là GTE100M (chưa cấu hình approver nào ở appData) -> chặn cả HO_APPROVER (chỉ được gán ở LT100M).
  const item = freshOrder({ orderLocationType: 'HO', amount: 5000000, paymentTotalAmount: 250000000 });
  assert.strictEqual(computeOperationOrderAmount(item), 250000000, 'max(5tr, 250tr) phải = 250tr');
  assertThrows(
    () => applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: makeUser(HO_APPROVER), comment: '', appData }),
    403, 'Bạn không có quyền', 'paymentTotalAmount cao hơn amount phải thắng, đẩy đơn lên tier GTE100M chưa cấu hình'
  );
});
// ===== Tamper: paymentTotalAmount giả mạo THẤP KHÔNG được phép né tier cao khi amount thật (server tự
// tính từ items, tamper-proof) cao hơn — đây là hướng RỦI RO THẬT (đơn hàng thật đắt, khai
// paymentTotalAmount thấp/giả để rơi vào tier ít người duyệt hơn/mức duyệt thấp hơn) — trước bản vá này
// computeOperationOrderAmount() ưu tiên paymentTotalAmount tuyệt đối bất kể amount cao hơn bao nhiêu,
// nên hướng này đã KHÔNG được test tới (dù tên test cũ đã nhắc tới rủi ro này, phần thân lại chỉ test
// hướng ngược lại) — nay bổ sung đúng hướng này cho cả STORE (3 mức) và HO (2 mức).
test('Tamper STORE: amount thật 200 triệu (GTE100M) + paymentTotalAmount giả mạo THẤP 5 triệu -> tier vẫn phải tính theo 200tr (GTE100M), KHÔNG rơi xuống LT10M', () => {
  const item = freshOrder({ orderLocationType: 'STORE', amount: 200000000, paymentTotalAmount: 5000000 });
  assert.strictEqual(computeOperationOrderAmount(item), 200000000, 'max(200tr, 5tr) phải = 200tr, không được kéo xuống 5tr');
  assert.strictEqual(computeOperationOrderTier('STORE', computeOperationOrderAmount(item)), 'GTE100M');
  // GTE100M chưa cấu hình approver nào ở appData (chỉ có LT10M) -> STORE_APPROVER (chỉ gán ở LT10M) PHẢI bị chặn dù paymentTotalAmount khai giả 5tr rơi đúng mức của họ.
  assertThrows(
    () => applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: makeUser(STORE_APPROVER), comment: '', appData }),
    403, 'Bạn không có quyền', 'STORE: paymentTotalAmount giả thấp không được né tier cao của amount thật'
  );
});
test('Tamper HO: amount thật 200 triệu (GTE100M) + paymentTotalAmount giả mạo THẤP 5 triệu -> tier vẫn phải tính theo 200tr (GTE100M), KHÔNG rơi xuống LT100M', () => {
  const item = freshOrder({ orderLocationType: 'HO', amount: 200000000, paymentTotalAmount: 5000000 });
  assert.strictEqual(computeOperationOrderAmount(item), 200000000, 'max(200tr, 5tr) phải = 200tr, không được kéo xuống 5tr');
  assert.strictEqual(computeOperationOrderTier('HO', computeOperationOrderAmount(item)), 'GTE100M');
  // GTE100M chưa cấu hình approver nào ở appData (chỉ có LT100M) -> HO_APPROVER (chỉ gán ở LT100M) PHẢI bị chặn dù paymentTotalAmount khai giả 5tr rơi đúng mức của họ (LT100M).
  assertThrows(
    () => applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: makeUser(HO_APPROVER), comment: '', appData }),
    403, 'Bạn không có quyền', 'HO: paymentTotalAmount giả thấp không được né tier cao của amount thật'
  );
});
// Kiểm tra biên giới CHÍNH XÁC quanh mốc tier khi dùng max(): amount ngay dưới mốc + paymentTotalAmount ngay trên mốc -> phải nhảy tier theo paymentTotalAmount (đúng hướng ĐẨY LÊN hợp lệ), và ngược lại (paymentTotalAmount thấp không kéo xuống).
test('Biên giới HO đúng mốc 100 triệu qua max(): amount=99.999.999 (LT100M) + paymentTotalAmount=100.000.000 (đúng mốc, GTE100M) -> phải là GTE100M', () => {
  const item = freshOrder({ orderLocationType: 'HO', amount: 99999999, paymentTotalAmount: 100000000 });
  assert.strictEqual(computeOperationOrderTier('HO', computeOperationOrderAmount(item)), 'GTE100M');
});
test('Biên giới HO đúng mốc 100 triệu qua max(): amount=100.000.000 (đúng mốc, GTE100M) + paymentTotalAmount=1 (giả thấp) -> vẫn phải là GTE100M (không kéo xuống LT100M)', () => {
  const item = freshOrder({ orderLocationType: 'HO', amount: 100000000, paymentTotalAmount: 1 });
  assert.strictEqual(computeOperationOrderTier('HO', computeOperationOrderAmount(item)), 'GTE100M');
});

// ===================== 5) migrateOperationOrdersDefaultLocationType() (seedDefaults.js) =====================
// Fake lib/recordStore.js tối thiểu (getAllRecords/withLockedRecordById) — cùng kỹ thuật require.cache
// đã dùng ở tests/test-operation-order-receiving.js cho migrateApprovedOperationOrdersToAwaitingReceipt().
function makeFakeRecordStore(seed) {
  return {
    async getAllRecords(collection) { return seed[collection] || []; },
    async withLockedRecordById(collection, id, mutatorFn) {
      const arr = seed[collection] || [];
      const idx = arr.findIndex(r => r.id === id);
      if (idx === -1) throw new Error(`fakeRecordStore: không tìm thấy ${collection}#${id}`);
      arr[idx] = await mutatorFn(arr[idx]);
      return arr[idx];
    }
  };
}
function requireFreshLocationMigrationFn(seed) {
  const recordStorePath = require.resolve('../lib/recordStore');
  const seedDefaultsPath = require.resolve('../seedDefaults');
  require.cache[recordStorePath] = { id: recordStorePath, filename: recordStorePath, loaded: true, exports: makeFakeRecordStore(seed) };
  delete require.cache[seedDefaultsPath];
  const { migrateOperationOrdersDefaultLocationType } = require('../seedDefaults');
  return {
    migrateOperationOrdersDefaultLocationType,
    cleanup: () => { delete require.cache[recordStorePath]; delete require.cache[seedDefaultsPath]; }
  };
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
  await testAsync('migrateOperationOrdersDefaultLocationType(): hồ sơ CŨ (không có orderLocationType) -> gán mặc định "HO"', async () => {
    const seed = { operationOrders: [{ id: 1, code: 'DH-OLD-1', status: 'RECEIVED' }] };
    const { migrateOperationOrdersDefaultLocationType, cleanup } = requireFreshLocationMigrationFn(seed);
    try {
      await migrateOperationOrdersDefaultLocationType();
      assert.strictEqual(seed.operationOrders[0].orderLocationType, 'HO');
    } finally { cleanup(); }
  });
  await testAsync('migrateOperationOrdersDefaultLocationType(): hồ sơ ĐÃ có orderLocationType (STORE hoặc HO) KHÔNG bị đụng vào', async () => {
    const seed = {
      operationOrders: [
        { id: 2, code: 'DH-STORE', status: 'PENDING', orderLocationType: 'STORE' },
        { id: 3, code: 'DH-HO', status: 'PENDING', orderLocationType: 'HO' }
      ]
    };
    const { migrateOperationOrdersDefaultLocationType, cleanup } = requireFreshLocationMigrationFn(seed);
    try {
      await migrateOperationOrdersDefaultLocationType();
      assert.strictEqual(seed.operationOrders[0].orderLocationType, 'STORE', 'Đơn đã có STORE không được đổi thành HO');
      assert.strictEqual(seed.operationOrders[1].orderLocationType, 'HO');
    } finally { cleanup(); }
  });
  await testAsync('migrateOperationOrdersDefaultLocationType(): idempotent — chạy 2 lần liên tiếp không đổi gì thêm ở lần 2', async () => {
    const seed = { operationOrders: [{ id: 4, code: 'DH-OLD-2', status: 'PENDING' }] };
    const { migrateOperationOrdersDefaultLocationType, cleanup } = requireFreshLocationMigrationFn(seed);
    try {
      await migrateOperationOrdersDefaultLocationType();
      await migrateOperationOrdersDefaultLocationType();
      assert.strictEqual(seed.operationOrders[0].orderLocationType, 'HO');
    } finally { cleanup(); }
  });
  await testAsync('Hồ sơ đã di trú "HO" vẫn duyệt được bình thường qua tier LT100M (regression "hồ sơ cũ vẫn hoạt động sau di trú")', async () => {
    const migrated = freshOrder({ orderLocationType: 'HO', amount: 5000000 }); // mô phỏng đã qua migrateOperationOrdersDefaultLocationType()
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item: migrated, action: 'APPROVE', user: makeUser(HO_APPROVER), comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed) process.exitCode = 1;
}
main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
