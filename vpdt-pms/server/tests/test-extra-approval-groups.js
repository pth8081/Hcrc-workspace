// server/tests/test-extra-approval-groups.js
//
// "Nhóm Phê Duyệt Cuối" (10/2026) — tính năng RIÊNG BIỆT cho 7 collection (docs/carRegs/officeReqs/
// vppRegistrations/paymentRequests/itPriceApprovals/operationOrders, LOẠI TRỪ contracts/submissions vốn
// đã có cơ chế Nhóm Phê Duyệt HĐ/Trình riêng): copy đúng cơ chế "Cấp Phê Duyệt Cuối Cùng + Phê Duyệt" của
// Hợp Đồng nhưng ĐỘC LẬP theo từng moduleKey (10 bộ groups/levels tách biệt hoàn toàn, xem
// EXTRA_APPROVAL_MODULE_KEYS ở routes/data.js) và dùng cơ chế "đông cứng lựa chọn lúc tạo, ghép bước MỖI
// LẦN resolve" (khác Hợp Đồng/Văn Bản Trình snapshot toàn bộ effectiveSteps) vì 7 module trên KHÔNG
// snapshot workflow — chúng đọc lại cấu hình admin MỚI NHẤT mỗi lần duyệt (xem MODULE_CONFIGS.*.resolveWfConfig
// ở lib/workflowEngine.js). 2 hàm cốt lõi:
//   - prepareExtraApprovalSelectionForCreate(moduleKey, payload, appData) — validate lựa chọn (level +
//     layer keys/members) lúc TẠO hồ sơ, trả về {extraApprovalLevel, extraApprovalLayers} đã đông cứng
//     approvers cụ thể, hoặc null nếu moduleKey chưa cấu hình (an toàn, không đổi hành vi cũ).
//   - appendExtraApprovalLayers(resolved, item) — ghép các lớp đã đông cứng thành bước MỚI (order tính
//     lại theo độ dài steps hiện tại) vào {steps, approvers} vừa resolve xong từ quy trình gốc.
//
// Chạy: node server/tests/test-extra-approval-groups.js
'use strict';
const { createRunner, assertEqual } = require('./testHarness');
const { validateAndPrepareCreate, prepareExtraApprovalSelectionForCreate } = require('../lib/createValidation');
const { appendExtraApprovalLayers } = require('../lib/workflowEngine');

function expectHttpError(fn, status, messagePart) {
  let thrown = null;
  try { fn(); } catch (err) { thrown = err; }
  if (!thrown) throw new Error(`Đáng lẽ phải ném lỗi (${status}) nhưng chạy thành công`);
  if (thrown.status !== status) throw new Error(`Sai mã lỗi: mong ${status}, thực tế ${thrown.status} (${thrown.message})`);
  if (messagePart && !String(thrown.message).includes(messagePart)) {
    throw new Error(`Sai nội dung lỗi: mong chứa "${messagePart}", thực tế "${thrown.message}"`);
  }
}

// ===== Fixture dùng chung cho phần test đơn vị prepareExtraApprovalSelectionForCreate() =====
const GROUPS = [
  { id: 'CEO', label: 'Cấp Phê Duyệt Cuối Cùng', order: 1, members: ['ceo1'] },
  { id: 'CFO', label: 'Phê Duyệt CFO', order: 2, members: ['cfo1', 'cfo2'] },
  { id: 'LEGAL', label: 'Phê Duyệt Pháp Chế', order: 3, members: ['legal1', 'legal2'] },
  { id: 'EMPTY', label: 'Nhóm Chưa Gán', order: 4, members: [] }
];
const LEVELS = [
  { id: 'L1', visibleGroupIds: ['CEO'], lockedGroupIds: ['CEO'] },
  { id: 'L2', visibleGroupIds: ['CEO', 'CFO', 'LEGAL'], lockedGroupIds: ['CEO'] },
  { id: 'L3', visibleGroupIds: ['CEO', 'CFO'], lockedGroupIds: ['CEO', 'CFO'] },
  { id: 'L4', visibleGroupIds: ['CEO', 'EMPTY'], lockedGroupIds: ['CEO', 'EMPTY'] }
];
const APP_DATA_TESTMOD = { extraApprovalGroups_TESTMOD: GROUPS, extraApprovalLevels_TESTMOD: LEVELS };

const basePayload = (over) => ({ approvalLevel: 'L1', selectedExtraApprovalLayerKeys: ['CEO'], ...over });

async function main() {
  const run = createRunner();

  // ===================== A) prepareExtraApprovalSelectionForCreate() — đơn vị =====================

  await run.run('moduleKey chưa cấu hình (groups/levels rỗng) -> null, KHÔNG throw gì (an toàn tuyệt đối)', async () => {
    const rec = prepareExtraApprovalSelectionForCreate('CHUA_CAU_HINH', basePayload({}), {});
    assertEqual(rec, null, 'chưa cấu hình phải trả về null');
  });

  await run.run('moduleKey có groups nhưng thiếu levels (hoặc ngược lại) -> vẫn null', async () => {
    const rec1 = prepareExtraApprovalSelectionForCreate('X', basePayload({}), { extraApprovalGroups_X: GROUPS, extraApprovalLevels_X: [] });
    assertEqual(rec1, null, 'thiếu levels vẫn phải null (cấu hình chưa đủ 2 vế)');
    const rec2 = prepareExtraApprovalSelectionForCreate('X', basePayload({}), { extraApprovalGroups_X: [], extraApprovalLevels_X: LEVELS });
    assertEqual(rec2, null, 'thiếu groups vẫn phải null');
  });

  await run.run('approvalLevel không hợp lệ -> 400', async () => {
    expectHttpError(() => prepareExtraApprovalSelectionForCreate('TESTMOD', basePayload({ approvalLevel: 'NO_SUCH_LEVEL' }), APP_DATA_TESTMOD),
      400, 'Cấp phê duyệt cuối cùng không hợp lệ');
  });

  await run.run('L1 (chỉ CEO, locked, 1 thành viên duy nhất) -> tự động chọn approver, không cần selectedExtraApprovalLayerMembers', async () => {
    const rec = prepareExtraApprovalSelectionForCreate('TESTMOD', basePayload({}), APP_DATA_TESTMOD);
    assertEqual(rec.extraApprovalLevel, 'L1', 'phải giữ đúng level');
    assertEqual(rec.extraApprovalLayers.length, 1, 'L1 chỉ có đúng 1 lớp (CEO)');
    assertEqual(rec.extraApprovalLayers[0].layerKey, 'CEO', 'lớp phải là CEO');
    assertEqual(JSON.stringify(rec.extraApprovalLayers[0].approvers), JSON.stringify(['ceo1']), 'nhóm 1 thành viên -> tự động chọn đúng người đó');
  });

  await run.run('chọn lớp NGOÀI phạm vi visible của level -> 403', async () => {
    expectHttpError(() => prepareExtraApprovalSelectionForCreate('TESTMOD',
      basePayload({ approvalLevel: 'L1', selectedExtraApprovalLayerKeys: ['CEO', 'CFO'] }), APP_DATA_TESTMOD),
      403, 'Nhóm phê duyệt không thuộc phạm vi cấp');
  });

  await run.run('L2: thiếu lớp bắt buộc (locked CEO) -> 400', async () => {
    expectHttpError(() => prepareExtraApprovalSelectionForCreate('TESTMOD',
      basePayload({ approvalLevel: 'L2', selectedExtraApprovalLayerKeys: ['CFO'] }), APP_DATA_TESTMOD),
      400, 'Thiếu nhóm phê duyệt bắt buộc');
  });

  await run.run('L2: lớp KHÔNG locked (CFO, nhiều thành viên) nhưng không chọn người -> 400 "Chưa chọn người"', async () => {
    expectHttpError(() => prepareExtraApprovalSelectionForCreate('TESTMOD',
      basePayload({ approvalLevel: 'L2', selectedExtraApprovalLayerKeys: ['CEO', 'CFO'] }), APP_DATA_TESTMOD),
      400, 'Chưa chọn người cho nhóm');
  });

  await run.run('L2: chọn người KHÔNG thuộc nhóm được admin gán (lớp không locked) -> 403', async () => {
    expectHttpError(() => prepareExtraApprovalSelectionForCreate('TESTMOD',
      basePayload({
        approvalLevel: 'L2', selectedExtraApprovalLayerKeys: ['CEO', 'CFO'],
        selectedExtraApprovalLayerMembers: { CFO: ['ke_la_ai_do'] }
      }), APP_DATA_TESTMOD),
      403, 'không thuộc nhóm được admin gán');
  });

  await run.run('L2: CEO (locked, auto) + CFO (chọn 1 người hợp lệ) + LEGAL (chọn nhiều người hợp lệ) -> thành công', async () => {
    const rec = prepareExtraApprovalSelectionForCreate('TESTMOD', basePayload({
      approvalLevel: 'L2', selectedExtraApprovalLayerKeys: ['CEO', 'CFO', 'LEGAL'],
      selectedExtraApprovalLayerMembers: { CFO: ['cfo1'], LEGAL: ['legal1', 'legal2'] }
    }), APP_DATA_TESTMOD);
    assertEqual(rec.extraApprovalLayers.length, 3, 'phải có đủ 3 lớp');
    // Thứ tự trả về PHẢI theo canonical order của groups (order: CEO=1, CFO=2, LEGAL=3), KHÔNG theo thứ
    // tự client gửi lên.
    assertEqual(rec.extraApprovalLayers.map(l => l.layerKey).join(','), 'CEO,CFO,LEGAL', 'thứ tự lớp phải theo canonical order');
    assertEqual(JSON.stringify(rec.extraApprovalLayers[1].approvers), JSON.stringify(['cfo1']), 'CFO phải giữ đúng 1 người đã chọn');
    assertEqual(JSON.stringify(rec.extraApprovalLayers[2].approvers), JSON.stringify(['legal1', 'legal2']), 'LEGAL giữ đúng 2 người đã chọn');
  });

  await run.run('canonical order + khử trùng lặp: client gửi thứ tự ngược + trùng key -> vẫn đúng canonical, không lặp', async () => {
    const rec = prepareExtraApprovalSelectionForCreate('TESTMOD', basePayload({
      approvalLevel: 'L2', selectedExtraApprovalLayerKeys: ['LEGAL', 'CEO', 'LEGAL', 'CEO'],
      selectedExtraApprovalLayerMembers: { LEGAL: ['legal1'] }
    }), APP_DATA_TESTMOD);
    assertEqual(rec.extraApprovalLayers.length, 2, 'phải khử trùng lặp, chỉ còn 2 lớp (CEO, LEGAL)');
    assertEqual(rec.extraApprovalLayers.map(l => l.layerKey).join(','), 'CEO,LEGAL', 'vẫn phải sắp theo canonical dù client gửi ngược thứ tự');
  });

  await run.run('L3: lớp locked NHIỀU thành viên (CFO) nhưng không chọn cụ thể -> 400 yêu cầu chọn ĐÚNG 1 người', async () => {
    expectHttpError(() => prepareExtraApprovalSelectionForCreate('TESTMOD',
      basePayload({ approvalLevel: 'L3', selectedExtraApprovalLayerKeys: ['CEO', 'CFO'] }), APP_DATA_TESTMOD),
      400, 'vui lòng chọn ĐÚNG 1 người phê duyệt cụ thể');
  });

  await run.run('L3: lớp locked nhiều thành viên nhưng chọn >1 người -> vẫn 400 (phải ĐÚNG 1, không phải "ít nhất 1")', async () => {
    expectHttpError(() => prepareExtraApprovalSelectionForCreate('TESTMOD',
      basePayload({
        approvalLevel: 'L3', selectedExtraApprovalLayerKeys: ['CEO', 'CFO'],
        selectedExtraApprovalLayerMembers: { CFO: ['cfo1', 'cfo2'] }
      }), APP_DATA_TESTMOD),
      400, 'vui lòng chọn ĐÚNG 1 người phê duyệt cụ thể');
  });

  await run.run('L3: lớp locked nhiều thành viên, chọn ĐÚNG 1 người hợp lệ -> thành công', async () => {
    const rec = prepareExtraApprovalSelectionForCreate('TESTMOD', basePayload({
      approvalLevel: 'L3', selectedExtraApprovalLayerKeys: ['CEO', 'CFO'],
      selectedExtraApprovalLayerMembers: { CFO: ['cfo2'] }
    }), APP_DATA_TESTMOD);
    assertEqual(JSON.stringify(rec.extraApprovalLayers.find(l => l.layerKey === 'CFO').approvers), JSON.stringify(['cfo2']), 'phải giữ đúng người đã chọn');
  });

  await run.run('L4: lớp locked nhưng CHƯA gán thành viên nào (members rỗng) -> 400', async () => {
    expectHttpError(() => prepareExtraApprovalSelectionForCreate('TESTMOD',
      basePayload({ approvalLevel: 'L4', selectedExtraApprovalLayerKeys: ['CEO', 'EMPTY'] }), APP_DATA_TESTMOD),
      400, 'Chưa gán thành viên nào cho nhóm bắt buộc');
  });

  // ===================== B) appendExtraApprovalLayers() — đơn vị =====================

  await run.run('item không có extraApprovalLayers -> trả về NGUYÊN resolved (no-op, giữ nguyên tham chiếu)', async () => {
    const resolved = { steps: [{ order: 1, name: 'Bước 1' }], approvers: { 1: ['userA'] } };
    const out = appendExtraApprovalLayers(resolved, {});
    assertEqual(out, resolved, 'không có extraApprovalLayers phải trả về ĐÚNG object cũ, không tạo bản sao');
  });

  await run.run('item.extraApprovalLayers = [] (mảng rỗng) -> cũng no-op', async () => {
    const resolved = { steps: [{ order: 1, name: 'Bước 1' }], approvers: { 1: ['userA'] } };
    const out = appendExtraApprovalLayers(resolved, { extraApprovalLayers: [] });
    assertEqual(out, resolved, 'mảng rỗng cũng phải no-op');
  });

  await run.run('ghép 1 lớp -> thêm đúng 1 bước nối tiếp, approvers gắn đúng theo order mới, KHÔNG sửa object gốc', async () => {
    const resolved = { steps: [{ order: 1, name: 'Bước 1' }], approvers: { 1: ['userA'] } };
    const item = { extraApprovalLayers: [{ layerKey: 'CEO', label: 'Cấp Phê Duyệt Cuối Cùng', actionLabel: 'Phê Duyệt', approvers: ['ceo1'] }] };
    const out = appendExtraApprovalLayers(resolved, item);
    assertEqual(out.steps.length, 2, 'phải có 2 bước sau khi ghép');
    assertEqual(out.steps[1].order, 2, 'bước mới phải nối tiếp order');
    assertEqual(out.steps[1].name, 'Cấp Phê Duyệt Cuối Cùng', 'tên bước phải lấy từ label của lớp');
    assertEqual(out.steps[1].layerKey, 'CEO', 'phải giữ layerKey để đối chiếu về sau');
    assertEqual(out.steps[1].actionLabel, 'Phê Duyệt', 'phải giữ actionLabel (nhãn hành động riêng)');
    assertEqual(JSON.stringify(out.approvers[2]), JSON.stringify(['ceo1']), 'approvers bước mới phải đúng người đã đông cứng');
    assertEqual(JSON.stringify(out.approvers[1]), JSON.stringify(['userA']), 'approvers bước gốc không đổi');
    // Bất biến (immutability) — resolved gốc KHÔNG bị sửa, vì hàm này chạy lại MỖI LẦN resolveWfConfig(),
    // sửa trực tiếp object gốc có thể làm rò rỉ trạng thái giữa các lần gọi khác nhau.
    assertEqual(resolved.steps.length, 1, 'object resolved GỐC không được sửa (vẫn còn đúng 1 bước)');
    assertEqual(resolved.approvers[2], undefined, 'object approvers GỐC không được sửa');
  });

  await run.run('ghép nhiều lớp -> nối tiếp ĐÚNG THỨ TỰ trong mảng extraApprovalLayers (không tự sắp lại)', async () => {
    const resolved = { steps: [{ order: 1, name: 'Bước 1' }, { order: 2, name: 'Bước 2' }], approvers: { 1: ['userA'], 2: ['userB'] } };
    const item = {
      extraApprovalLayers: [
        { layerKey: 'CFO', label: 'Phê Duyệt CFO', actionLabel: null, approvers: ['cfo1'] },
        { layerKey: 'CEO', label: 'Cấp Phê Duyệt Cuối Cùng', actionLabel: 'Phê Duyệt', approvers: ['ceo1'] }
      ]
    };
    const out = appendExtraApprovalLayers(resolved, item);
    assertEqual(out.steps.length, 4, 'phải có 4 bước tổng cộng');
    assertEqual(out.steps[2].layerKey, 'CFO', 'lớp thứ nhất trong mảng phải nối vào bước 3 (giữ đúng thứ tự mảng)');
    assertEqual(out.steps[3].layerKey, 'CEO', 'lớp thứ hai nối vào bước 4');
    assertEqual(JSON.stringify(out.approvers[3]), JSON.stringify(['cfo1']), 'approvers bước 3 đúng CFO');
    assertEqual(JSON.stringify(out.approvers[4]), JSON.stringify(['ceo1']), 'approvers bước 4 đúng CEO');
  });

  await run.run('số bước GỐC thay đổi vẫn ghép đúng vị trí kế tiếp (mô phỏng admin đổi quy trình phòng ban sau khi hồ sơ đã tạo)', async () => {
    // Đây chính là lý do KHÔNG đông cứng "order" lúc tạo (xem chú thích ở lib/createValidation.js) — nếu
    // quy trình gốc từ 2 bước tăng lên 3 bước (admin thêm 1 bước duyệt phòng ban), lớp "Nhóm Phê Duyệt
    // Cuối" vẫn phải luôn nối SAU CÙNG, không được kẹt cứng ở vị trí 3 (đè lên bước phòng ban mới).
    const resolvedCu = { steps: [{ order: 1 }, { order: 2 }], approvers: { 1: ['a'], 2: ['b'] } };
    const resolvedMoi = { steps: [{ order: 1 }, { order: 2 }, { order: 3 }], approvers: { 1: ['a'], 2: ['b'], 3: ['c'] } };
    const item = { extraApprovalLayers: [{ layerKey: 'CEO', label: 'Cấp Phê Duyệt Cuối Cùng', actionLabel: null, approvers: ['ceo1'] }] };
    const outCu = appendExtraApprovalLayers(resolvedCu, item);
    const outMoi = appendExtraApprovalLayers(resolvedMoi, item);
    assertEqual(outCu.steps[outCu.steps.length - 1].order, 3, 'trước khi thêm bước mới -> lớp cuối nối ở vị trí 3');
    assertEqual(outMoi.steps[outMoi.steps.length - 1].order, 4, 'sau khi quy trình gốc có thêm 1 bước -> lớp cuối tự trượt xuống vị trí 4');
  });

  // ===================== C) Tích hợp qua validateAndPrepareCreate() — xác nhận mapping moduleKey đúng
  // cho 3 module TÁCH theo field split (officeReqs/subType, itPriceApprovals/priceType,
  // operationOrders/orderLocationType), MỖI bên có bộ groups/levels ĐỘC LẬP hoàn toàn =====================

  const ADMIN_USER = { username: 'admin1', name: 'Quản Trị', dept: 'Ban Giám Đốc', perms: { admin: true } };

  await run.run('itPriceApprovals: RETAIL đã cấu hình Nhóm Phê Duyệt Cuối, WHOLESALE CHƯA cấu hình -> mỗi bên độc lập đúng', async () => {
    const appData = {
      formTemplates: {}, stores: ['Siêu thị A'], priceZones: [],
      extraApprovalGroups_ITPRICE_RETAIL: GROUPS, extraApprovalLevels_ITPRICE_RETAIL: LEVELS
      // extraApprovalGroups_ITPRICE_WHOLESALE / extraApprovalLevels_ITPRICE_WHOLESALE: KHÔNG cấu hình
    };
    const retailPayload = {
      dept: 'Kinh Doanh', reason: 'Áp giá đợt test', priceType: 'RETAIL', effectiveDate: '2026-09-01',
      files: [{ fileUrl: '/uploads/123-abcdef0123456789.pdf', fileName: 'bang-gia.xlsx', items: [{ values: { c0: 'Mặt hàng A', c1: '15000' } }], columnLabels: [] }],
      approvalLevel: 'L1', selectedExtraApprovalLayerKeys: ['CEO']
    };
    const recRetail = validateAndPrepareCreate('itPriceApprovals', retailPayload, ADMIN_USER, [], appData);
    assertEqual(recRetail.extraApprovalLevel, 'L1', 'RETAIL đã cấu hình -> phải đông cứng đúng level');
    assertEqual(recRetail.extraApprovalLayers.length, 1, 'RETAIL phải có đúng 1 lớp CEO');

    const wholesalePayload = {
      dept: 'Kinh Doanh', reason: 'Áp giá đợt test', priceType: 'WHOLESALE', effectiveDate: '2026-09-01',
      priceTier: 'MARGIN_LT5', wholesaleApplyUnit: 'Đại lý ABC', storeScope: { mode: 'OTHER', stores: ['Siêu thị A'] },
      files: [{ fileUrl: '/uploads/123-abcdef0123456789.pdf', fileName: 'bang-gia.xlsx', items: [{ values: { c0: 'Mặt hàng A', c1: '15000' } }], columnLabels: [] }],
      approvalLevel: 'L1', selectedExtraApprovalLayerKeys: ['CEO']
    };
    const recWholesale = validateAndPrepareCreate('itPriceApprovals', wholesalePayload, ADMIN_USER, [], appData);
    assertEqual(recWholesale.extraApprovalLevel, undefined, 'WHOLESALE chưa cấu hình -> KHÔNG được gắn field này (an toàn, no-op)');
    assertEqual(recWholesale.extraApprovalLayers, undefined, 'WHOLESALE chưa cấu hình -> KHÔNG được gắn field này');
  });

  await run.run('officeReqs: MUA_BAN (OFFICE_BUY) đã cấu hình, SUA_CHUA (OFFICE_FIX) CHƯA -> mapping subType đúng', async () => {
    const appData = {
      formTemplates: {},
      extraApprovalGroups_OFFICE_BUY: GROUPS, extraApprovalLevels_OFFICE_BUY: LEVELS
      // extraApprovalGroups_OFFICE_FIX / extraApprovalLevels_OFFICE_FIX: KHÔNG cấu hình
    };
    const muaBanUser = { username: 'u1', name: 'NV Mua Sắm', dept: 'Hành Chính', perms: { admin: true } };
    const recMuaBan = validateAndPrepareCreate('officeReqs',
      { dept: 'Hành Chính', subType: 'MUA_BAN', amount: 5000000, approvalLevel: 'L1', selectedExtraApprovalLayerKeys: ['CEO'] },
      muaBanUser, [], appData);
    assertEqual(recMuaBan.extraApprovalLevel, 'L1', 'MUA_BAN (OFFICE_BUY) đã cấu hình -> phải đông cứng đúng level');

    const recSuaChua = validateAndPrepareCreate('officeReqs',
      { dept: 'Hành Chính', subType: 'SUA_CHUA', amount: 5000000, approvalLevel: 'L1', selectedExtraApprovalLayerKeys: ['CEO'] },
      muaBanUser, [], appData);
    assertEqual(recSuaChua.extraApprovalLevel, undefined, 'SUA_CHUA (OFFICE_FIX) chưa cấu hình -> KHÔNG được gắn field này');
  });

  await run.run('operationOrders: STORE (OPERATION_ORDER_STORE) đã cấu hình, HO (OPERATION_ORDER_HO) CHƯA -> mapping orderLocationType đúng', async () => {
    const appData = {
      formTemplates: {},
      extraApprovalGroups_OPERATION_ORDER_STORE: GROUPS, extraApprovalLevels_OPERATION_ORDER_STORE: LEVELS
      // extraApprovalGroups_OPERATION_ORDER_HO / extraApprovalLevels_OPERATION_ORDER_HO: KHÔNG cấu hình
    };
    const opUser = { username: 'u2', name: 'NV Đặt Hàng', dept: 'Siêu Thị 1', perms: { admin: true } };
    const items = [{ name: 'Hàng A', qty: 10, unitPrice: 1000 }];
    const recStore = validateAndPrepareCreate('operationOrders',
      { title: 'Đơn hàng test', orderLocationType: 'STORE', items, approvalLevel: 'L1', selectedExtraApprovalLayerKeys: ['CEO'] },
      opUser, [], appData);
    assertEqual(recStore.extraApprovalLevel, 'L1', 'STORE (OPERATION_ORDER_STORE) đã cấu hình -> phải đông cứng đúng level');

    const recHO = validateAndPrepareCreate('operationOrders',
      { title: 'Đơn hàng test', orderLocationType: 'HO', items, approvalLevel: 'L1', selectedExtraApprovalLayerKeys: ['CEO'] },
      opUser, [], appData);
    assertEqual(recHO.extraApprovalLevel, undefined, 'HO (OPERATION_ORDER_HO) chưa cấu hình -> KHÔNG được gắn field này');
  });

  run.summary();
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
