// server/tests/demo-emergency-reject-badge.js — demo ảnh chụp cho người dùng (11/2026, phản hồi "Hoàng
// Văn Đại đã gửi phê duyệt khẩn cấp nhưng trạng thái bên ngoài ko chuyển sang đang chờ phê duyệt... gây
// nhầm lẫn"): chụp màn danh sách Phê Duyệt Giá TRƯỚC/SAU khi gửi "Từ chối khẩn cấp" để xác nhận badge
// mới "⏳ Chờ Duyệt Hủy" hiện đúng (trước fix: vẫn hiện "✅ Đã phê duyệt").
'use strict';
const path = require('path');
const os = require('os');
const { startStaticServer, createMockState, launchPage, createRunner, assert } = require('./testHarness');

const PORT = 8997;
const SHOTS_DIR = path.join(os.tmpdir(), 'itprice-emergency-reject-badge-shots');
try { require('fs').mkdirSync(SHOTS_DIR, { recursive: true }); } catch (_) { /* ignore */ }

// Dùng user "approver1" y hệt bản chạy thành công ban đầu (perms.admin=true khiến initDatabase() phía
// client không gán được DB.itPriceApprovals vì lý do khác chưa rõ — không đáng mất thời gian điều tra
// thêm cho 1 demo ảnh thuần tuý, KHÔNG liên quan tới bản vá badge đang demo) — dùng itPriceSupport (cùng
// quyền IT1 trong test-it-support.js) để nhìn thấy đủ hồ sơ trong danh sách.
const ADMIN = { username: 'approver1', name: 'Trưởng Phòng Duyệt', dept: 'Ban Giám Đốc', perms: { itPriceSupport: true }, active: true };
const state = createMockState({ depts: ['Kinh Doanh', 'Ban Giám Đốc', 'IT'], users: [ADMIN] });
state.itPriceWholesaleApproverFallback = ['approver1'];
state.deptWorkflows = state.deptWorkflows || {};
state.deptWorkflows['Kinh Doanh'] = { workflowId: 'WF_1STEP', approvers: { 1: ['approver1'] } };
state.workflows = state.workflows || [];
state.workflows.push({ id: 'WF_1STEP', steps: [{ order: 1, name: 'Trưởng phòng duyệt' }] });

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  let id = null;

  try {
    await run.run('Setup: seed thẳng 1 hồ sơ Phê Duyệt Giá APPROVED (bỏ qua form tạo — chỉ phục vụ demo ảnh, logic tạo đã test đầy đủ ở test-it-support.js)', async () => {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
      id = Date.now();
      // Seed CẢ 2 nơi: state.itPriceApprovals (phía Node, mock server dùng khi app tự fetch lại /api/data)
      // VÀ DB.itPriceApprovals (phía trang) — cùng bài học đã rút ra ở test-operation-store-opening-edit-
      // modal.js, tránh mất dữ liệu seed nếu switchTab()/các hàm render sau đó kích hoạt đồng bộ lại.
      const seedItem = {
        id, code: 'HCRC-MHTPTS-ITPG-BL-DEMO', priceType: 'RETAIL', productName: 'SP Demo',
        dept: 'Kinh Doanh', creator: 'kd1', creatorName: 'Ngô Văn Kinh Doanh',
        status: 'APPROVED', currentStep: 1, history: [], files: [], extraFiles: [],
        fileUrl: '/uploads/demo.xlsx', fileName: 'demo.xlsx',
        items: [{ values: { code: 'SP001', name: 'SP Demo', oldPrice: '10000', newPrice: '11000' } }],
        columnLabels: [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên' }, { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }],
        emergencyRejectStatus: null, createdAt: new Date().toISOString()
      };
      state.itPriceApprovals.push(seedItem);
      await page.evaluate((item) => { DB.itPriceApprovals.push(item); }, seedItem);
    });

    await run.run('Ảnh TRƯỚC: danh sách hiện "✅ Đã phê duyệt" (chưa có yêu cầu khẩn cấp)', async () => {
      await page.evaluate(() => { switchTab('itSupport'); setItSupportSubTab('ITPRICE'); renderItPriceApprovals(); });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS_DIR, '1-before-approved.png'), fullPage: true });
    });

    await run.run('Seed thẳng trạng thái "Từ chối khẩn cấp" PENDING (business logic đã test đầy đủ ở test-it-support.js — demo này chỉ minh hoạ hiển thị)', async () => {
      const stateItem = state.itPriceApprovals.find(x => x.id === id);
      Object.assign(stateItem, {
        emergencyRejectStatus: 'PENDING', emergencyRejectReason: 'Sai luồng phê duyệt',
        emergencyRejectRequestedBy: 'approver1', emergencyRejectRequestedByName: 'Trưởng Phòng Duyệt',
        emergencyRejectRequestedAt: new Date().toLocaleString('vi-VN')
      });
      await page.evaluate((patch) => {
        const item = DB.itPriceApprovals.find(x => x.id === patch.id);
        Object.assign(item, patch);
        renderItPriceApprovals();
      }, stateItem);
      await page.waitForTimeout(150);
    });

    await run.run('Ảnh SAU: danh sách PHẢI hiện "⏳ Chờ Duyệt Hủy" (đã fix)', async () => {
      await page.screenshot({ path: path.join(SHOTS_DIR, '2-after-cho-duyet-huy.png'), fullPage: true });
      const badgeText = await page.evaluate((id) => {
        const row = Array.from(document.querySelectorAll('#itPriceApprovalsTableBody tr, table tr')).find(tr => tr.textContent.includes(String(DB.itPriceApprovals.find(x => x.id === id).code)));
        return row ? row.textContent : null;
      }, id);
      assert(badgeText && badgeText.includes('Chờ Duyệt Hủy'), `Danh sách phải hiện "Chờ Duyệt Hủy" — thực tế: ${badgeText}`);
    });

    await run.run('Mở modal chi tiết -> tiêu đề trạng thái cũng PHẢI hiện "⏳ Chờ Duyệt Hủy"', async () => {
      await page.evaluate((id) => { openItPriceModal(id); }, id);
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(SHOTS_DIR, '3-detail-modal.png'), fullPage: true });
      const modalText = await page.evaluate(() => document.getElementById('itPriceModalBody')?.textContent || document.body.textContent);
      assert(modalText.includes('Chờ Duyệt Hủy'), 'Tiêu đề modal chi tiết phải hiện "Chờ Duyệt Hủy"');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
  console.log(`(Ảnh chụp màn hình lưu tại: ${SHOTS_DIR})`);
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
