// server/tests/test-operation-workitem-multilevel-cascade.js
//
// Audit nghiệp vụ — xác nhận syncOperationWorkItemAncestorsClient()/syncOperationWorkItemAncestors()
// (public/js/module-vanhanh.js / routes/records.js) cascade ĐÚNG qua NHIỀU TẦNG (cháu -> con -> ông) chứ
// không chỉ 1 tầng (con -> cha) — nghi vấn #4 trong đề bài audit. Cây: Ông (gốc) -> Con -> Cháu (lá, duy
// nhất). Đưa Cháu (lá DUY NHẤT của Con) tới DA_NGHIEM_THU qua đúng nút "🔄 Cập Nhật Tiến Độ"/"✅ Hoàn
// Thành"/"✅ Nghiệm Thu" DOM thật -> Con (chỉ có 1 con là Cháu) phải tự cascade DA_NGHIEM_THU NGAY, rồi
// Ông (chỉ có 1 con là Con) cũng phải tự cascade DA_NGHIEM_THU theo — cả 2 tầng cascade trong CÙNG 1 lần
// bấm Nghiệm Thu Cháu (syncOperationWorkItemAncestorsClient() phải tự đệ quy lên tới tận gốc).
//
// Chạy: node server/tests/test-operation-workitem-multilevel-cascade.js
const path = require('path');
const fs = require('fs');
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8999;
const SHOTS_DIR = process.env.MULTILEVEL_SHOTS_DIR || path.join(require('os').tmpdir(), 'owi-multilevel-shots');
try { fs.mkdirSync(SHOTS_DIR, { recursive: true }); } catch (_) { /* ignore */ }

const CREATOR = {
  username: 'vh_creator_ml', name: 'Người Tạo Hồ Sơ', dept: 'Vận Hành',
  perms: { operationStoreOpenCreate: true, operationRecordManageAll: true }, active: true
};
const state = createMockState({ depts: ['Vận Hành'], users: [CREATOR] });

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  let recordId = null, grandparentId = null, parentId = null, leafId = null;

  try {
    await run.run('Setup: hồ sơ + danh mục đầu tư APPROVED + cây 3 tầng Ông->Con->Cháu (setup qua callRecordCreate, cùng mẫu các test hiện có)', async () => {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, CREATOR);
      recordId = await page.evaluate(async () => {
        const res = await callCreateAction('operationStoreOpenings', {
          storeName: 'Siêu thị multilevel (test)', address: '123 Test', area: 200,
          approvedBudget: 5000000000, expectedOpenDate: '', personInCharge: '', note: ''
        });
        DB.operationStoreOpenings.push(res.item);
        return res.item.id;
      });
      await page.evaluate((id) => { openOperationEstimateModal('operationStoreOpenings', id); }, recordId);
      await page.waitForTimeout(60);
      await page.click('button[data-op="addOperationEstimateItemRow"]');
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(1) input[data-field="content"]', 'Hạng mục ml');
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(1) input[data-field="amount"]', '10000000');
      await page.evaluate(async () => { await submitOperationEstimateForApproval(); });
      await page.evaluate(() => { document.getElementById('operationEstimateModal').classList.add('hidden'); });

      const ids = await page.evaluate(async (id) => {
        const g = await callRecordCreate('operationWorkItems', { sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: null, title: 'Ông (gốc)' });
        DB.operationWorkItems.push(g.item);
        const p = await callRecordCreate('operationWorkItems', { sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: g.item.id, title: 'Con' });
        DB.operationWorkItems.push(p.item);
        const l = await callRecordCreate('operationWorkItems', { sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: p.item.id, title: 'Cháu (lá)' });
        DB.operationWorkItems.push(l.item);
        return { grandparentId: g.item.id, parentId: p.item.id, leafId: l.item.id };
      }, recordId);
      grandparentId = ids.grandparentId; parentId = ids.parentId; leafId = ids.leafId;
      assert(grandparentId && parentId && leafId, 'Phải tạo được cây 3 tầng Ông->Con->Cháu');

      await page.evaluate((id) => { openOperationWorkItemModal('operationStoreOpenings', id, 'EXECUTION'); }, recordId);
      await page.waitForTimeout(80);
      const statuses = await page.evaluate((ids2) => ({
        g: DB.operationWorkItems.find(w => w.id === ids2.g).status,
        p: DB.operationWorkItems.find(w => w.id === ids2.p).status,
        l: DB.operationWorkItems.find(w => w.id === ids2.l).status
      }), { g: grandparentId, p: parentId, l: leafId });
      assertEqual(statuses.g, 'CHUA_BAT_DAU', 'Ông ban đầu Chưa bắt đầu');
      assertEqual(statuses.p, 'CHUA_BAT_DAU', 'Con ban đầu Chưa bắt đầu');
      assertEqual(statuses.l, 'CHUA_BAT_DAU', 'Cháu ban đầu Chưa bắt đầu');
    });

    await run.run('Đưa Cháu (lá DUY NHẤT của Con) -> Đang thực hiện -> Đang nghiệm thu (DOM thật)', async () => {
      await page.click(`button[data-op="openOperationWorkItemProgressModal"][data-id="${leafId}"]`);
      await page.waitForTimeout(60);
      await page.selectOption('#owiProgressNewStatus', { value: 'DANG_THUC_HIEN' });
      await page.click('button[data-op="confirmOperationWorkItemProgress"]');
      await page.waitForTimeout(100);
      await page.click(`button[data-op="updateOperationWorkItemProgressAction"][data-id="${leafId}"][data-status="DANG_NGHIEM_THU"]`);
      await page.waitForTimeout(120);
      const statuses = await page.evaluate((ids2) => ({
        g: DB.operationWorkItems.find(w => w.id === ids2.g).status,
        p: DB.operationWorkItems.find(w => w.id === ids2.p).status,
        l: DB.operationWorkItems.find(w => w.id === ids2.l).status
      }), { g: grandparentId, p: parentId, l: leafId });
      await page.screenshot({ path: path.join(SHOTS_DIR, '01-chau-dang-nghiem-thu.png'), fullPage: true });
      assertEqual(statuses.l, 'DANG_NGHIEM_THU', 'Cháu phải "Đang nghiệm thu" sau khi Hoàn Thành');
      assertEqual(statuses.p, 'DANG_NGHIEM_THU', 'TẦNG 1: Con (chỉ có 1 con là Cháu) phải tự cascade "Đang nghiệm thu" NGAY');
      assertEqual(statuses.g, 'DANG_NGHIEM_THU', 'TẦNG 2 (multi-level thật sự): Ông (chỉ có 1 con là Con) PHẢI tự cascade "Đang nghiệm thu" THEO trong CÙNG 1 lần cascade — đây là điểm audit multi-level, không chỉ dừng ở tầng 1');
    });

    await run.run('Nghiệm thu (ACCEPT) Cháu -> cascade DA_NGHIEM_THU đúng multi-level lên tới Ông (2 tầng)', async () => {
      // Mở lại đúng modal ở mode 'ACCEPTANCE' (openOperationWorkItemModal(kind, id, mode) — cách DUY NHẤT
      // chuyển mode, không có nút chuyển mode riêng trong modal, xem module-vanhanh.js) — DOM thật.
      await page.evaluate((id) => { openOperationWorkItemModal('operationStoreOpenings', id, 'ACCEPTANCE'); }, recordId);
      await page.waitForTimeout(80);
      await page.click(`button[data-op="openOperationAcceptanceActionModal"][data-id="${leafId}"][data-action="ACCEPT"]`);
      await page.waitForTimeout(60);
      await page.fill('#opAcceptanceReason', 'Đạt yêu cầu (audit multilevel)');
      await page.click('button[data-op="confirmOperationAcceptanceAction"]');
      await page.waitForTimeout(150);
      const statuses = await page.evaluate((ids2) => ({
        g: DB.operationWorkItems.find(w => w.id === ids2.g).status,
        p: DB.operationWorkItems.find(w => w.id === ids2.p).status,
        l: DB.operationWorkItems.find(w => w.id === ids2.l).status
      }), { g: grandparentId, p: parentId, l: leafId });
      await page.screenshot({ path: path.join(SHOTS_DIR, '02-da-nghiem-thu-multilevel.png'), fullPage: true });
      assertEqual(statuses.l, 'DA_NGHIEM_THU', 'Cháu phải "Đã nghiệm thu"');
      assertEqual(statuses.p, 'DA_NGHIEM_THU', 'TẦNG 1: Con phải tự cascade "Đã nghiệm thu"');
      assertEqual(statuses.g, 'DA_NGHIEM_THU', 'TẦNG 2 (multi-level): Ông PHẢI tự cascade "Đã nghiệm thu" theo — xác nhận syncOperationWorkItemAncestors* đệ quy đúng qua NHIỀU tầng, không chỉ 1 tầng');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
  console.log(`(Ảnh chụp màn hình lưu tại: ${SHOTS_DIR})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
