// server/tests/crosscheck-operation-estimate-auto-workitems.js
//
// CROSS-CHECK bổ sung (agent test độc lập, 11/2026) cho tính năng CHƯA merge "tự động tạo Công Việc từ
// Danh Mục Đầu Tư + 🔁 Giao Lại" (xem commit 6c2177c, lib/recordActions.js buildAutoWorkItemsFromEstimate()/
// reassignOperationWorkItem(), routes/records.js autoCreateOperationWorkItemsAfterEstimateSave()).
//
// MỤC TIÊU: đi XA HƠN demo-operation-estimate-auto-workitems.js + test-operation-estimate-auto-workitems.js
// đã có (happy path 1 gốc + 1 con, toàn quyền lưu, chủ sở hữu tự Giao Lại) — dùng Playwright THẬT (Chromium
// mở public/index.html thật qua testHarness.js, KHÔNG gọi thẳng hàm nội bộ cho các bước nghiệp vụ chính,
// chỉ dùng window.__apiDispatch trực tiếp cho 2 kịch bản CỐ Ý mô phỏng "crafted API call" bỏ qua UI ở mục 7/8).
//
// Các kịch bản (đánh số khớp yêu cầu test):
//   1) operationRepairs (không chỉ operationStoreOpenings)
//   2) Nhiều danh mục lớn, nhiều người phụ trách khác nhau, có/không con, có 1 KHÔNG gán ai
//   3) Idempotent qua UI thật: lưu lại chỉ đổi Mô Tả -> KHÔNG tạo trùng
//   4) Thêm danh mục con MỚI vào danh mục lớn ĐÃ có Công Việc Gốc từ trước -> chỉ tạo đúng 1 con mới
//   5) Chủ sở hữu phạm vi hẹp (canOwnEstimateCategoryClient, KHÔNG toàn quyền) tự thêm con -> vẫn tự tạo
//   6) Toàn quyền hồ sơ "Giao Lại" 1 việc mà KHÔNG phải assignee hiện tại
//   7) Việc ĐÃ nghiệm thu xong (DA_NGHIEM_THU) -> nút ẩn + API trực tiếp bị chặn 409
//   8) Người ngoài (không assignee, không toàn quyền) -> nút ẩn + API trực tiếp bị chặn 403
//   9) Tab Nghiệm Thu sau khi Giao Lại -> acceptorName/"Chỉ định:" KHÔNG đổi
//   10) Chụp ảnh Playwright cho ít nhất 2-3 kịch bản trên.
//
// Chạy: node server/tests/crosscheck-operation-estimate-auto-workitems.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 9007;
const OUT_DIR = process.env.CROSSCHECK_OUT_DIR
  || '/tmp/claude-0/-home-user-vpdt-dms/92486df7-a010-5b7a-a5ae-6b624f39c073/scratchpad/playwright-crosscheck';

const MANAGER = { username: 'qlvh_cross', name: 'Trưởng Phòng Vận Hành (Cross)', dept: 'Vận Hành', perms: { operationRecordManageAll: true }, active: true };
const OWNER_A = { username: 'nv_a_cross', name: 'Nhân Viên A (Cross)', dept: 'Vận Hành', perms: {}, active: true };
const OWNER_B = { username: 'nv_b_cross', name: 'Nhân Viên B (Cross)', dept: 'Vận Hành', perms: {}, active: true };
const STAFF = { username: 'nv_staff_cross', name: 'Nhân Viên Thực Hiện (Cross)', dept: 'Vận Hành', perms: {}, active: true };
const OUTSIDER = { username: 'nguoi_ngoai_cross', name: 'Người Ngoài (Cross)', dept: 'Vận Hành', perms: {}, active: true };
const OWNER_SCOPED = { username: 'nv_scoped_cross', name: 'Nhân Viên Phạm Vi Hẹp (Cross)', dept: 'Vận Hành', perms: {}, active: true };

const REC_REPAIR = { id: 9301, code: 'SCST-9301', title: 'Sửa Chữa Demo Cross', dept: 'Vận Hành', creator: MANAGER.username, creatorName: MANAGER.name, estimateStatus: 'DRAFT', estimateItems: [] };
const REC_MULTI = { id: 9201, code: 'MMST-9201', storeName: 'Siêu Thị Đa Danh Mục', dept: 'Vận Hành', creator: MANAGER.username, creatorName: MANAGER.name, estimateStatus: 'DRAFT', estimateItems: [] };
const REC_INCR = { id: 9401, code: 'MMST-9401', storeName: 'Siêu Thị Lưu Nhiều Lần', dept: 'Vận Hành', creator: MANAGER.username, creatorName: MANAGER.name, estimateStatus: 'DRAFT', estimateItems: [] };
const REC_SCOPED = { id: 9501, code: 'MMST-9501', storeName: 'Siêu Thị Phạm Vi Hẹp', dept: 'Vận Hành', creator: MANAGER.username, creatorName: MANAGER.name, estimateStatus: 'DRAFT', estimateItems: [] };
const REC_DONE = { id: 9601, code: 'MMST-9601', storeName: 'Siêu Thị Đã Nghiệm Thu', dept: 'Vận Hành', creator: MANAGER.username, creatorName: MANAGER.name, estimateStatus: 'DRAFT', estimateItems: [] };

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
  await page.waitForTimeout(120);
}
async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}
async function openEstimate(page, kind, id) {
  await page.evaluate(([k, i]) => { openOperationEstimateModal(k, i); }, [kind, id]);
  await page.waitForTimeout(150);
}
async function closeEstimate(page) {
  await page.evaluate(() => closeOperationEstimateModal());
}
async function openWorkItems(page, kind, id, mode) {
  await page.evaluate(([k, i, m]) => { openOperationWorkItemModal(k, i, m); }, [kind, id, mode]);
  await page.waitForTimeout(150);
}
async function closeWorkItems(page) {
  await page.evaluate(() => closeOperationWorkItemModal());
}
async function saveEstimate(page) {
  // LƯU Ý QUAN TRỌNG (phát hiện lúc viết test này): submitOperationEstimateForApproval()
  // (module-vanhanh.js) KHÔNG có `return` nào — nó tự renderOperationEstimateList() +
  // openOperationEstimateModal() lại rồi thôi, page.evaluate() ở đây luôn nhận về `undefined`.
  // KHÔNG dùng giá trị trả về của hàm này để kiểm tra autoCreatedWorkItems — dùng
  // saveEstimateAndDiff() (diff DB.operationWorkItems thật trước/sau) cho mục đó.
  await page.evaluate(() => submitOperationEstimateForApproval());
  await page.waitForTimeout(200);
}
function getWorkItems(page, sourceType, sourceId) {
  return page.evaluate(([st, sid]) => (DB.operationWorkItems || []).filter(w => w.sourceType === st && w.sourceId === sid), [sourceType, sourceId]);
}
// Lưu Danh Mục Đầu Tư + DIFF thật DB.operationWorkItems (client-side cache) trước/sau — dùng để kiểm tra
// chính xác "autoCreatedWorkItems" THẬT đã vào DB.operationWorkItems chưa (mirror đúng hệ quả người dùng
// thật nhìn thấy khi mở Thực Hiện ngay sau khi Lưu, KHÔNG dựa vào giá trị trả về của
// submitOperationEstimateForApproval() — xem chú thích ở saveEstimate() ngay trên).
async function saveEstimateAndDiff(page, sourceType, sourceId) {
  const before = await page.evaluate(() => (DB.operationWorkItems || []).map(w => w.id));
  await page.evaluate(() => submitOperationEstimateForApproval());
  await page.waitForTimeout(200);
  const after = await getWorkItems(page, sourceType, sourceId);
  const newItems = after.filter(w => !before.includes(w.id));
  return { newItems, allItems: after };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const run = createRunner();

  const state = createMockState({
    depts: ['Vận Hành'],
    users: [MANAGER, OWNER_A, OWNER_B, STAFF, OUTSIDER, OWNER_SCOPED],
    operationStoreOpenings: [REC_MULTI, REC_INCR, REC_SCOPED, REC_DONE],
    operationRepairs: [REC_REPAIR]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 920 });

  try {
    // ===================== Kịch bản 1: operationRepairs =====================
    await run.run('1) operationRepairs: Lập Danh Mục Đầu Tư có Người Phụ Trách -> tự tạo Công Việc Gốc+Con', async () => {
      await loginAs(page, MANAGER);
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('REPAIR'); });
      await openEstimate(page, 'operationRepairs', REC_REPAIR.id);
      await page.evaluate(() => {
        addOperationEstimateChildRow(0); // idx1 — con của idx0 (dòng lớn rỗng mặc định)
        updateOperationEstimateItemField(0, 'content', 'Sửa hệ thống điện');
        updateOperationEstimateItemField(1, 'content', 'Thay tủ điện tổng');
        renderOperationEstimateItemsTable(true);
        pmsAdd('estimateAssigneePicker_0', 'nv_a_cross');
      });
      await page.waitForTimeout(100);
      await shot(page, '#operationEstimateModal', 'scenario1-repair-01-truoc-khi-luu.png');
      await saveEstimate(page);
      await closeEstimate(page);

      await openWorkItems(page, 'operationRepairs', REC_REPAIR.id, 'EXECUTION');
      await shot(page, '#operationWorkItemModal', 'scenario1-repair-02-thuc-hien-tu-dong-tao.png');
      const items = await getWorkItems(page, 'OPERATION_REPAIR', REC_REPAIR.id);
      console.log('   -> operationWorkItems (OPERATION_REPAIR/9301):', JSON.stringify(items.map(w => ({ id: w.id, title: w.title, parentWorkItemId: w.parentWorkItemId, assignedTo: w.assignedTo, acceptorUsername: w.acceptorUsername })), null, 2));
      assertEqual(items.length, 2, 'Phải có đúng 2 work item (1 gốc + 1 con) cho operationRepairs');
      const root = items.find(w => w.parentWorkItemId == null);
      const child = items.find(w => w.parentWorkItemId != null);
      assert(root, 'Phải có Công Việc Gốc');
      assertEqual(root.title, 'Sửa hệ thống điện');
      assertEqual((root.assignedTo || []).join(','), 'nv_a_cross');
      assertEqual(root.acceptorUsername, 'nv_a_cross', 'Nghiệm thu mặc định = người phụ trách');
      assert(child, 'Phải có Công Việc Con');
      assertEqual(child.title, 'Thay tủ điện tổng');
      assertEqual(child.parentWorkItemId, root.id, 'Con phải trỏ đúng gốc (cùng record operationRepairs)');
      assertEqual((child.assignedTo || []).join(','), 'nv_a_cross', 'Con kế thừa đúng người phụ trách từ gốc');
      await closeWorkItems(page);
    });

    // ===================== Kịch bản 2: nhiều danh mục lớn, nhiều người phụ trách, có cái không ai =====================
    await run.run('2) Nhiều danh mục lớn (2 có người phụ trách khác nhau, 1 KHÔNG gán ai) -> đúng tập Công Việc được tạo', async () => {
      await loginAs(page, MANAGER);
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('OPEN'); });
      await openEstimate(page, 'operationStoreOpenings', REC_MULTI.id);
      await page.evaluate(() => {
        // idx0 = dòng lớn rỗng mặc định ("Khu A"). Thêm idx1="Khu B" (lớn), idx2="Khu C" (lớn, không ai),
        // idx3 = con của idx0 (Khu A - Con 1).
        addOperationEstimateItemRow(null); // idx1
        addOperationEstimateItemRow(null); // idx2
        addOperationEstimateChildRow(0);   // idx3, con của idx0
        updateOperationEstimateItemField(0, 'content', 'Khu A');
        updateOperationEstimateItemField(1, 'content', 'Khu B');
        updateOperationEstimateItemField(2, 'content', 'Khu C (không ai phụ trách)');
        updateOperationEstimateItemField(3, 'content', 'Khu A - Con 1');
        renderOperationEstimateItemsTable(true);
        pmsAdd('estimateAssigneePicker_0', 'nv_a_cross'); // Khu A -> OWNER_A
        pmsAdd('estimateAssigneePicker_1', 'nv_b_cross'); // Khu B -> OWNER_B
        // Khu C (idx2) CỐ Ý không gán ai.
      });
      await page.waitForTimeout(100);
      await shot(page, '#operationEstimateModal', 'scenario2-multi-01-truoc-khi-luu.png');
      await saveEstimate(page);
      await closeEstimate(page);

      await openWorkItems(page, 'operationStoreOpenings', REC_MULTI.id, 'EXECUTION');
      await shot(page, '#operationWorkItemModal', 'scenario2-multi-02-thuc-hien-sau-khi-luu.png');
      const items = await getWorkItems(page, 'OPERATION_STORE_OPENING', REC_MULTI.id);
      console.log('   -> operationWorkItems (REC_MULTI/9201):', JSON.stringify(items.map(w => ({ id: w.id, title: w.title, parentWorkItemId: w.parentWorkItemId, assignedTo: w.assignedTo })), null, 2));
      assertEqual(items.length, 3, 'Tổng phải đúng 3 work item: gốc Khu A + con Khu A + gốc Khu B (Khu C không tạo gì)');
      const rootA = items.find(w => w.title === 'Khu A');
      const childA = items.find(w => w.title === 'Khu A - Con 1');
      const rootB = items.find(w => w.title === 'Khu B');
      const anyKhuC = items.find(w => (w.title || '').includes('Khu C'));
      assert(rootA, 'Phải có gốc Khu A'); assert(childA, 'Phải có con Khu A'); assert(rootB, 'Phải có gốc Khu B');
      assert(!anyKhuC, 'Khu C KHÔNG gán ai -> KHÔNG được tạo công việc nào');
      assertEqual((rootA.assignedTo || []).join(','), 'nv_a_cross');
      assertEqual((childA.assignedTo || []).join(','), 'nv_a_cross', 'Con kế thừa đúng người phụ trách của Khu A, không lẫn Khu B');
      assertEqual(childA.parentWorkItemId, rootA.id);
      assertEqual((rootB.assignedTo || []).join(','), 'nv_b_cross');
      assertEqual(rootB.parentWorkItemId, null, 'Khu B không có con -> gốc không có con');
      await closeWorkItems(page);
    });

    // ===================== Kịch bản 3+4: idempotent qua UI thật + thêm con sau =====================
    let incrRootId = null, incrChild1Id = null;
    await run.run('3) Idempotent qua UI thật: lưu lại chỉ đổi Mô Tả (KHÔNG đổi người phụ trách) -> KHÔNG tạo trùng', async () => {
      await loginAs(page, MANAGER);
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('OPEN'); });

      // --- Lượt lưu 1: tạo gốc + 1 con ---
      await openEstimate(page, 'operationStoreOpenings', REC_INCR.id);
      await page.evaluate(() => {
        addOperationEstimateChildRow(0);
        updateOperationEstimateItemField(0, 'content', 'Hạng mục X');
        updateOperationEstimateItemField(1, 'content', 'Con X1');
        renderOperationEstimateItemsTable(true);
        pmsAdd('estimateAssigneePicker_0', 'nv_a_cross');
      });
      await saveEstimate(page);
      await closeEstimate(page);
      let items = await getWorkItems(page, 'OPERATION_STORE_OPENING', REC_INCR.id);
      assertEqual(items.length, 2, 'Lượt lưu 1 phải tạo đúng 2 work item (gốc + 1 con)');
      const root1 = items.find(w => w.parentWorkItemId == null);
      const child1 = items.find(w => w.parentWorkItemId != null);
      incrRootId = root1.id; incrChild1Id = child1.id;

      // --- Lượt lưu 2: mở lại, CHỈ đổi Mô Tả của danh mục lớn đã liên kết (không đụng người phụ trách) ---
      await openEstimate(page, 'operationStoreOpenings', REC_INCR.id);
      const topIdxBefore = await page.evaluate(() => operationEstimateItems.findIndex(it => it.content === 'Hạng mục X'));
      assert(topIdxBefore !== -1, 'Phải tìm lại được đúng dòng "Hạng mục X" khi mở lại modal');
      await page.evaluate((idx) => { updateOperationEstimateItemField(idx, 'description', 'Mô tả cập nhật lần 2 — KHÔNG đổi người phụ trách'); }, topIdxBefore);
      const diff2 = await saveEstimateAndDiff(page, 'OPERATION_STORE_OPENING', REC_INCR.id);
      await closeEstimate(page);
      console.log('   -> Sau lượt lưu 2 (chỉ đổi Mô Tả): work item MỚI xuất hiện trong DB.operationWorkItems =', JSON.stringify(diff2.newItems.map(w => ({ id: w.id, title: w.title }))));
      assertEqual(diff2.newItems.length, 0, 'Lượt lưu 2 KHÔNG được tạo thêm work item nào trong DB.operationWorkItems (idempotent)');
      items = await getWorkItems(page, 'OPERATION_STORE_OPENING', REC_INCR.id);
      assertEqual(items.length, 2, 'Sau lượt lưu 2, tổng work item PHẢI VẪN đúng 2 (không tạo trùng)');
      const rootAfter = items.find(w => w.id === incrRootId);
      const childAfter = items.find(w => w.id === incrChild1Id);
      assert(rootAfter, 'Công việc gốc cũ phải còn nguyên (đúng id cũ)');
      assert(childAfter, 'Công việc con cũ phải còn nguyên (đúng id cũ)');
      assertEqual(rootAfter.status, 'CHUA_BAT_DAU', 'Trạng thái gốc KHÔNG bị đụng tới qua lượt lưu lại');
      assertEqual(rootAfter.description, '', 'Mô Tả của Công Việc (Thực Hiện) là field RIÊNG — sửa Mô Tả ở Danh Mục Đầu Tư không "chạm ngược" vào Công Việc đã tạo (2 cây độc lập, đúng thiết kế)');
    });

    await run.run('4) Thêm 1 danh mục con MỚI vào danh mục lớn ĐÃ có Công Việc Gốc từ trước -> chỉ tạo đúng 1 con mới, đúng cha', async () => {
      await openEstimate(page, 'operationStoreOpenings', REC_INCR.id);
      const topIdx = await page.evaluate(() => operationEstimateItems.findIndex(it => it.content === 'Hạng mục X'));
      assert(topIdx !== -1);
      await page.evaluate((idx) => {
        addOperationEstimateChildRow(idx);
        const newIdx = operationEstimateItems.length - 1;
        updateOperationEstimateItemField(newIdx, 'content', 'Con X2 (thêm sau)');
      }, topIdx);
      const diff3 = await saveEstimateAndDiff(page, 'OPERATION_STORE_OPENING', REC_INCR.id);
      await closeEstimate(page);
      console.log('   -> Sau lượt lưu 3 (thêm con X2): work item MỚI xuất hiện =', JSON.stringify(diff3.newItems.map(w => ({ title: w.title, parentWorkItemId: w.parentWorkItemId }))));
      assertEqual(diff3.newItems.length, 1, 'Lượt lưu 3 phải tạo đúng 1 work item mới (con X2)');
      const items = await getWorkItems(page, 'OPERATION_STORE_OPENING', REC_INCR.id);
      assertEqual(items.length, 3, 'Tổng work item phải đúng 3 (gốc + con X1 cũ + con X2 mới), KHÔNG tạo gốc mới');
      const child2 = items.find(w => w.title === 'Con X2 (thêm sau)');
      assert(child2, 'Phải có Con X2 mới');
      assertEqual(child2.parentWorkItemId, incrRootId, 'Con X2 mới PHẢI trỏ đúng Công Việc Gốc ĐÃ TỒN TẠI từ lượt lưu 1 (không tạo gốc trùng)');
      assert(items.some(w => w.id === incrRootId), 'Gốc cũ vẫn còn nguyên, đúng id');
      assert(items.some(w => w.id === incrChild1Id), 'Con X1 cũ vẫn còn nguyên, đúng id');
      await openWorkItems(page, 'operationStoreOpenings', REC_INCR.id, 'EXECUTION');
      await shot(page, '#operationWorkItemModal', 'scenario3-4-idempotent-them-con-sau.png');
      await closeWorkItems(page);
    });

    // ===================== Kịch bản 5: chủ sở hữu phạm vi hẹp tự thêm con =====================
    let scopedRootId = null, scopedOtherRootId = null;
    await run.run('5) Chủ sở hữu phạm vi hẹp (canOwnEstimateCategoryClient, KHÔNG toàn quyền) tự thêm danh mục con -> vẫn tự tạo đúng Công Việc Con', async () => {
      // --- Toàn quyền tạo trước 2 danh mục lớn: "Khu Riêng" (OWNER_SCOPED phụ trách, có sẵn 1 con) và
      // "Khu Khác" (STAFF phụ trách, không con) — mục đích: xác nhận lượt lưu của OWNER_SCOPED sau này
      // KHÔNG đụng/không tạo trùng gì cho "Khu Khác" (ngoài phạm vi họ).
      await loginAs(page, MANAGER);
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('OPEN'); });
      await openEstimate(page, 'operationStoreOpenings', REC_SCOPED.id);
      await page.evaluate(() => {
        addOperationEstimateItemRow(null); // idx1 = "Khu Khác"
        addOperationEstimateChildRow(0);   // idx2 = con sẵn của idx0
        updateOperationEstimateItemField(0, 'content', 'Khu Riêng');
        updateOperationEstimateItemField(1, 'content', 'Khu Khác');
        updateOperationEstimateItemField(2, 'content', 'Con sẵn của Khu Riêng');
        renderOperationEstimateItemsTable(true);
        pmsAdd('estimateAssigneePicker_0', 'nv_scoped_cross');
        pmsAdd('estimateAssigneePicker_1', 'nv_staff_cross');
      });
      await saveEstimate(page);
      await closeEstimate(page);
      let items = await getWorkItems(page, 'OPERATION_STORE_OPENING', REC_SCOPED.id);
      assertEqual(items.length, 3, 'Lượt lưu đầu (toàn quyền): gốc Khu Riêng + con sẵn + gốc Khu Khác = 3');
      scopedRootId = items.find(w => w.title === 'Khu Riêng').id;
      scopedOtherRootId = items.find(w => w.title === 'Khu Khác').id;

      // --- Đăng nhập là OWNER_SCOPED (KHÔNG toàn quyền, chỉ phụ trách "Khu Riêng") ---
      await loginAs(page, OWNER_SCOPED);
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('OPEN'); });
      await openEstimate(page, 'operationStoreOpenings', REC_SCOPED.id);
      const scopeCheck = await page.evaluate(() => ({
        isFullManager: estimateIsFullManager,
        itemsVisible: operationEstimateItems.map(it => it.content)
      }));
      console.log('   -> OWNER_SCOPED mở modal: estimateIsFullManager =', scopeCheck.isFullManager, '| items nạp vào bộ nhớ =', scopeCheck.itemsVisible);
      assertEqual(scopeCheck.isFullManager, false, 'OWNER_SCOPED KHÔNG phải toàn quyền hồ sơ (chỉ phụ trách 1 danh mục lớn)');
      assert(scopeCheck.itemsVisible.includes('Khu Riêng') && scopeCheck.itemsVisible.includes('Con sẵn của Khu Riêng'), 'Phải thấy đúng danh mục mình phụ trách + con của nó');
      assert(!scopeCheck.itemsVisible.includes('Khu Khác'), 'KHÔNG được thấy "Khu Khác" (ngoài phạm vi phụ trách) — rò rỉ dữ liệu nếu có');

      const ownIdx = await page.evaluate(() => operationEstimateItems.findIndex(it => it.content === 'Khu Riêng'));
      await page.evaluate((idx) => {
        addOperationEstimateChildRow(idx);
        const newIdx = operationEstimateItems.length - 1;
        updateOperationEstimateItemField(newIdx, 'content', 'Con Mới Do Chủ Sở Hữu Tự Thêm');
      }, ownIdx);
      await page.waitForTimeout(100);
      await shot(page, '#operationEstimateModal', 'scenario5-owner-scoped-them-con.png');
      const diff5 = await saveEstimateAndDiff(page, 'OPERATION_STORE_OPENING', REC_SCOPED.id);
      await closeEstimate(page);
      console.log('   -> OWNER_SCOPED lưu xong: work item MỚI xuất hiện =', JSON.stringify(diff5.newItems.map(w => ({ title: w.title, parentWorkItemId: w.parentWorkItemId, assignedTo: w.assignedTo }))));
      assertEqual(diff5.newItems.length, 1, 'Lượt lưu của OWNER_SCOPED phải tự tạo đúng 1 Công Việc Con mới (KHÔNG cần là toàn quyền hồ sơ)');

      items = await getWorkItems(page, 'OPERATION_STORE_OPENING', REC_SCOPED.id);
      assertEqual(items.length, 4, 'Tổng phải đúng 4 (3 cũ + 1 con mới), KHÔNG đụng/trùng "Khu Khác"');
      const newChild = items.find(w => w.title === 'Con Mới Do Chủ Sở Hữu Tự Thêm');
      assert(newChild, 'Phải có Công Việc Con mới');
      assertEqual(newChild.parentWorkItemId, scopedRootId, 'Con mới phải trỏ đúng Công Việc Gốc ĐÃ TỒN TẠI của "Khu Riêng" (không tạo gốc mới)');
      assertEqual((newChild.assignedTo || []).join(','), 'nv_scoped_cross', 'Con mới kế thừa đúng người phụ trách "Khu Riêng"');
      assertEqual(items.filter(w => w.id === scopedOtherRootId).length, 1, '"Khu Khác" vẫn đúng 1 bản ghi, không bị trùng/đụng bởi lượt lưu của OWNER_SCOPED');
    });

    // ===================== Kịch bản 6+9: toàn quyền Giao Lại khi KHÔNG phải assignee + Nghiệm Thu không đổi =====================
    await run.run('6+9) Toàn quyền hồ sơ "Giao Lại" 1 việc KHÔNG phải assignee hiện tại -> thành công, Nghiệm Thu KHÔNG đổi', async () => {
      await loginAs(page, MANAGER);
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('OPEN'); });
      const itemsBefore = await getWorkItems(page, 'OPERATION_STORE_OPENING', REC_MULTI.id);
      const rootB = itemsBefore.find(w => w.title === 'Khu B');
      assert(rootB, 'Cần lại được gốc "Khu B" (OWNER_B phụ trách) từ kịch bản 2');
      assertEqual((rootB.assignedTo || []).join(','), 'nv_b_cross');
      assertEqual(rootB.acceptorUsername, 'nv_b_cross');

      await openWorkItems(page, 'operationStoreOpenings', REC_MULTI.id, 'EXECUTION');
      await page.evaluate((id) => { openOperationWorkItemReassignModal(id); }, rootB.id);
      await page.waitForTimeout(100);
      const infoText = await page.locator('#owiReassignInfo').innerText();
      console.log('   -> #owiReassignInfo:', infoText);
      assert(infoText.includes('Khu B'), 'Modal Giao Lại phải hiện đúng tên công việc "Khu B"');
      await page.evaluate(() => {
        pmsRemove('owiReassignAssignedToPicker', 'nv_b_cross');
        pmsAdd('owiReassignAssignedToPicker', 'nv_staff_cross');
      });
      await page.evaluate(() => { submitOperationWorkItemReassign(); });
      await page.waitForTimeout(200);

      const itemsAfter = await getWorkItems(page, 'OPERATION_STORE_OPENING', REC_MULTI.id);
      const rootBAfter = itemsAfter.find(w => w.id === rootB.id);
      console.log('   -> Khu B sau Giao Lại: assignedTo =', rootBAfter.assignedTo, '| acceptorUsername =', rootBAfter.acceptorUsername, '| history cuối =', JSON.stringify(rootBAfter.history[rootBAfter.history.length - 1]));
      assertEqual((rootBAfter.assignedTo || []).join(','), 'nv_staff_cross', 'MANAGER (toàn quyền, KHÔNG phải assignee cũ nv_b_cross) phải Giao Lại thành công sang nv_staff_cross');
      assertEqual(rootBAfter.acceptorUsername, 'nv_b_cross', 'Nghiệm Thu KHÔNG đổi — vẫn giữ nguyên OWNER_B (người phụ trách gốc)');
      assertEqual(rootBAfter.history[rootBAfter.history.length - 1].action, 'REASSIGNED');
      assertEqual(rootBAfter.history[rootBAfter.history.length - 1].by, MANAGER.username, 'Lịch sử phải ghi đúng người Giao Lại là MANAGER, không phải assignee cũ');
      await closeWorkItems(page);

      // ----- Kịch bản 9: tab Nghiệm Thu sau khi Giao Lại — acceptorName/"Chỉ định:" KHÔNG đổi -----
      await openWorkItems(page, 'operationStoreOpenings', REC_MULTI.id, 'ACCEPTANCE');
      const acceptanceText = await page.locator('#operationWorkItemTableBody').innerText();
      console.log('   -> Nội dung bảng Nghiệm Thu (trích):', acceptanceText.split('\n').filter(l => l.includes('Khu B') || l.includes('Chỉ định')).join(' | '));
      assert(acceptanceText.includes('Chỉ định: Nhân Viên B (Cross)') || acceptanceText.includes('Nhân Viên B (Cross)'), 'Tab Nghiệm Thu vẫn phải hiện đúng Nhân Viên B (Cross) là người Nghiệm Thu được chỉ định, không đổi theo Giao Lại');
      await shot(page, '#operationWorkItemModal', 'scenario6-9-giao-lai-nghiemthu-khong-doi.png');
      await closeWorkItems(page);
    });

    // ===================== Kịch bản 9b: Giao Lại 1 CÔNG VIỆC CON (không chỉ gốc) -> Nghiệm Thu con cũng KHÔNG đổi =====================
    await run.run('9b) Giao Lại 1 Công Việc CON (Khu A - Con 1) -> Nghiệm Thu của đúng dòng con đó cũng KHÔNG đổi', async () => {
      const itemsBefore = await getWorkItems(page, 'OPERATION_STORE_OPENING', REC_MULTI.id);
      const childA = itemsBefore.find(w => w.title === 'Khu A - Con 1');
      assert(childA, 'Cần lại được con "Khu A - Con 1" từ kịch bản 2');
      assertEqual(childA.acceptorUsername, 'nv_a_cross');

      // Lần này để CHÍNH assignee (OWNER_A, KHÔNG phải toàn quyền) tự Giao Lại việc CON của mình — bổ sung
      // cho demo gốc (chỉ test assignee tự giao lại ở việc GỐC) + kịch bản 6 (chỉ test toàn quyền ở GỐC).
      await loginAs(page, OWNER_A);
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('OPEN'); });
      await openWorkItems(page, 'operationStoreOpenings', REC_MULTI.id, 'EXECUTION');
      await page.evaluate((id) => { openOperationWorkItemReassignModal(id); }, childA.id);
      await page.waitForTimeout(100);
      await page.evaluate(() => {
        pmsRemove('owiReassignAssignedToPicker', 'nv_a_cross');
        pmsAdd('owiReassignAssignedToPicker', 'nv_staff_cross');
      });
      await page.evaluate(() => { submitOperationWorkItemReassign(); });
      await page.waitForTimeout(200);
      await closeWorkItems(page);

      const itemsAfter = await getWorkItems(page, 'OPERATION_STORE_OPENING', REC_MULTI.id);
      const childAAfter = itemsAfter.find(w => w.id === childA.id);
      console.log('   -> "Khu A - Con 1" sau Giao Lại (do chính OWNER_A tự giao): assignedTo =', childAAfter.assignedTo, '| acceptorUsername =', childAAfter.acceptorUsername);
      assertEqual((childAAfter.assignedTo || []).join(','), 'nv_staff_cross', 'OWNER_A (chính assignee) tự Giao Lại CÔNG VIỆC CON của mình cho STAFF phải thành công');
      assertEqual(childAAfter.acceptorUsername, 'nv_a_cross', 'Nghiệm Thu của CÔNG VIỆC CON cũng KHÔNG đổi — vẫn giữ nguyên OWNER_A');

      await openWorkItems(page, 'operationStoreOpenings', REC_MULTI.id, 'ACCEPTANCE');
      const acceptanceText = await page.locator('#operationWorkItemTableBody').innerText();
      const childLine = acceptanceText.split('\n').filter(l => l.includes('Khu A - Con 1') || (l.includes('Chỉ định') && l.includes('Nhân Viên A')));
      console.log('   -> Nội dung bảng Nghiệm Thu liên quan "Khu A - Con 1":', JSON.stringify(childLine));
      assert(acceptanceText.includes('Nhân Viên A (Cross)'), 'Tab Nghiệm Thu phải vẫn hiện đúng Nhân Viên A (Cross) là người Nghiệm Thu của "Khu A - Con 1" dù đã Giao Lại người thực hiện');
      await closeWorkItems(page);
    });

    // ===================== Kịch bản 7: việc ĐÃ nghiệm thu -> nút ẩn + API trực tiếp 409 =====================
    let doneRootId = null;
    await run.run('7) Việc ĐÃ nghiệm thu (DA_NGHIEM_THU) -> nút "🔁 Giao Lại" KHÔNG hiện + gọi API trực tiếp bị chặn 409 (server, không chỉ UI)', async () => {
      await loginAs(page, MANAGER);
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('OPEN'); });
      await openEstimate(page, 'operationStoreOpenings', REC_DONE.id);
      await page.evaluate(() => {
        updateOperationEstimateItemField(0, 'content', 'Việc Sẽ Nghiệm Thu Xong');
        renderOperationEstimateItemsTable(true);
        pmsAdd('estimateAssigneePicker_0', 'nv_a_cross');
      });
      await saveEstimate(page);
      await closeEstimate(page);
      let items = await getWorkItems(page, 'OPERATION_STORE_OPENING', REC_DONE.id);
      doneRootId = items[0].id;

      // Đưa việc qua đủ các bước tới DA_NGHIEM_THU — thao tác qua đúng action nghiệp vụ thật (progress/accept).
      await page.evaluate((id) => callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_THUC_HIEN', note: '' }), doneRootId);
      await page.evaluate((id) => callRecordAction('operationWorkItems', id, 'progress', { status: 'DANG_NGHIEM_THU', note: '' }), doneRootId);
      const acceptRes = await page.evaluate((id) => callRecordAction('operationWorkItems', id, 'accept', { action: 'ACCEPT', reason: 'Đạt yêu cầu' }), doneRootId);
      assertEqual(acceptRes.item.status, 'DA_NGHIEM_THU', 'Việc phải chuyển DA_NGHIEM_THU trước khi test kịch bản 7');
      // Đẩy state mới nhất vào DB.operationWorkItems phía client (mirror đúng cách các hàm thật làm) để
      // render lại đúng dữ liệu mới nhất trước khi mở modal.
      await page.evaluate((item) => { const idx = DB.operationWorkItems.findIndex(w => w.id === item.id); if (idx !== -1) DB.operationWorkItems[idx] = item; }, acceptRes.item);

      await openWorkItems(page, 'operationStoreOpenings', REC_DONE.id, 'EXECUTION');
      const rowHtml = await page.evaluate((id) => {
        const btn = document.querySelector(`[data-op="openOperationWorkItemReassignModal"][data-id="${id}"]`);
        return { buttonExists: !!btn, bodyIncludesGiaoLai: document.getElementById('operationWorkItemTableBody').innerText.includes('Giao Lại') };
      }, doneRootId);
      console.log('   -> UI sau DA_NGHIEM_THU:', JSON.stringify(rowHtml));
      assertEqual(rowHtml.buttonExists, false, 'Nút "🔁 Giao Lại" KHÔNG được hiện cho việc đã DA_NGHIEM_THU (kể cả với MANAGER toàn quyền)');
      await shot(page, '#operationWorkItemModal', 'scenario7-da-nghiem-thu-khong-con-nut-giao-lai.png');
      await closeWorkItems(page);

      // Giờ thử gọi THẲNG API reassign (giống crafted request bỏ qua UI) — PHẢI bị server chặn 409, không
      // chỉ dựa vào việc ẩn nút trên UI. Dùng window.__apiDispatch trực tiếp (mirror đúng route thật, xem
      // testHarness.js createDispatcher 'operationWorkItems:reassign' -> lib/recordActions.js
      // reassignOperationWorkItem()) — gọi với MANAGER (vốn có quyền canManageOperationRecord, để chắc
      // chắn bị chặn bởi đúng điều kiện status, không lẫn với 403 thiếu quyền).
      const direct = await page.evaluate(([id, who]) => window.__apiDispatch('POST', `/api/records/operationWorkItems/${id}/reassign`, JSON.stringify({ assignedTo: ['nv_staff_cross'] }), who), [doneRootId, MANAGER.username]);
      console.log('   -> API trực tiếp /reassign (MANAGER, item DA_NGHIEM_THU):', JSON.stringify(direct));
      assertEqual(direct.status, 409, 'Server (không chỉ UI) PHẢI chặn 409 khi gọi reassign trực tiếp trên việc đã DA_NGHIEM_THU, dù người gọi là toàn quyền hồ sơ');
    });

    // ===================== Kịch bản 8: người ngoài -> nút ẩn + API trực tiếp 403 =====================
    await run.run('8) Người ngoài (KHÔNG phải assignee, KHÔNG toàn quyền hồ sơ) -> nút "🔁 Giao Lại" KHÔNG hiện + API trực tiếp bị chặn 403', async () => {
      // Dùng lại gốc "Khu A" (REC_MULTI, assignee hiện là OWNER_A, status CHUA_BAT_DAU, chưa bị đụng gì).
      const items = await getWorkItems(page, 'OPERATION_STORE_OPENING', REC_MULTI.id);
      const rootA = items.find(w => w.title === 'Khu A');
      assert(rootA, 'Cần lại được gốc "Khu A" từ kịch bản 2');
      assertEqual((rootA.assignedTo || []).join(','), 'nv_a_cross');

      await loginAs(page, OUTSIDER);
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('OPEN'); });
      await openWorkItems(page, 'operationStoreOpenings', REC_MULTI.id, 'EXECUTION');
      const rowHtml = await page.evaluate((id) => {
        const btn = document.querySelector(`[data-op="openOperationWorkItemReassignModal"][data-id="${id}"]`);
        return { buttonExists: !!btn };
      }, rootA.id);
      console.log('   -> OUTSIDER mở Thực Hiện, kiểm tra nút Giao Lại trên "Khu A":', JSON.stringify(rowHtml));
      assertEqual(rowHtml.buttonExists, false, 'OUTSIDER (không phải assignee, không toàn quyền) KHÔNG được thấy nút "🔁 Giao Lại"');
      await closeWorkItems(page);

      const direct = await page.evaluate(([id, who]) => window.__apiDispatch('POST', `/api/records/operationWorkItems/${id}/reassign`, JSON.stringify({ assignedTo: ['nguoi_ngoai_cross'] }), who), [rootA.id, OUTSIDER.username]);
      console.log('   -> API trực tiếp /reassign (OUTSIDER, item "Khu A"):', JSON.stringify(direct));
      assertEqual(direct.status, 403, 'Server PHẢI chặn 403 khi OUTSIDER gọi reassign trực tiếp (không phải assignee, không toàn quyền hồ sơ)');

      // Phòng thủ sâu: xác nhận "Khu A" THẬT SỰ không hề bị đổi bởi lần gọi API bị chặn ở trên.
      const after = await getWorkItems(page, 'OPERATION_STORE_OPENING', REC_MULTI.id);
      const rootAAfter = after.find(w => w.id === rootA.id);
      assertEqual((rootAAfter.assignedTo || []).join(','), 'nv_a_cross', '"Khu A" PHẢI vẫn giữ nguyên assignee cũ sau cuộc gọi API bị 403 chặn');
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
