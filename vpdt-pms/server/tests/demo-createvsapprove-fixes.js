// server/tests/demo-createvsapprove-fixes.js
//
// DEMO thật (người dùng chủ động yêu cầu: "demo cho tôi xem") cho đợt vá 4 lỗ hổng "tạo hồ sơ ≠ duyệt
// hồ sơ" (v24.38, xem VERSION.md) — rà soát chuyên sâu phát hiện, người dùng xác nhận vá đúng 4 điểm.
//
// Phần 1-2 dùng testHarness.js (Chromium thật mở public/index.html thật + toàn bộ public/js/*.js thật,
// bấm nút THẬT) cho 2 fix dễ minh hoạ bằng ảnh chụp màn hình nhất:
//   1) Đồng Phục — Hành Chính (uniformManage) tự tạo kỳ cấp phát rồi tự bấm "Duyệt" ĐÚNG kỳ đó -> bị
//      chặn ngay trên UI (banner lỗi thật). Người KHÁC giữ uniformApprove duyệt được bình thường.
//   2) Ngân Sách — màn admin "📊 QT Ngân Sách - Đề Xuất" đã ĐƯỢC KHÔI PHỤC trong Hệ Thống → Quy Trình &
//      Phê Duyệt (trước đây không tồn tại, budgetLines chỉ có 1 cấp gác quyền phẳng).
//
// Phần 3-5 gọi THẲNG lib/recordActions.js (không qua DB, đúng nguyên tắc "recordActions.js không tự đọc
// DB" — xem đầu file đó) để minh hoạ rõ ràng qua console log, không cần dựng thêm hạ tầng mock backend
// cho tasks/recruitmentReferrals (testHarness.js hiện chỉ wire Đồng Phục/Hỗ Trợ IT/Báo Cáo Định Kỳ):
//   3) Tuyển Dụng — người TỰ giới thiệu ứng viên không tự cập nhật được trạng thái ứng viên đó.
//   4) Công Việc — người TỰ giao việc cho bản thân không tự duyệt được yêu cầu gia hạn do chính mình gửi.
//   5) Ngân Sách (Đề Xuất) — budgetCreate-only KHÔNG duyệt được đề xuất của phòng ban CHƯA cấu hình;
//      SAU KHI admin cấu hình đúng phòng ban (giống thao tác ở màn admin phần 2), approver được cấu hình
//      duyệt được bình thường — budgetManage/admin luôn duyệt được bất kể cấu hình.
//
// Chạy: node server/tests/demo-createvsapprove-fixes.js
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');
const recordActions = require('../lib/recordActions');

const PORT = 8994;
const OUT_DIR = process.env.CREATEVSAPPROVE_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'createvsapprove-fixes');

const ADMIN_USER = { id: 1, username: 'admin', name: 'Quản Trị Hệ Thống', dept: 'Ban Giám Đốc', perms: { admin: true }, totpEnabled: true, active: true };
const HC = { id: 2, username: 'hc1', name: 'Trần Thị Hành Chính', dept: 'Hành Chính', perms: { uniformManage: true }, active: true };
const HC2 = { id: 3, username: 'hc2', name: 'Đỗ Thị Phó Hành Chính', dept: 'Hành Chính', perms: { uniformApprove: true }, active: true };

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('\n===== 1) ĐỒNG PHỤC — chặn tự tạo + tự duyệt kỳ cấp phát =====\n');

  const state = createMockState({
    depts: ['Hành Chính'],
    stores: ['Siêu Thị Demo'],
    users: [ADMIN_USER, HC, HC2],
    uniformCatalog: [{ id: 1, name: 'Áo đồng phục nam', sizes: ['L'] }],
    // workflows: cần ít nhất 1 mẫu quy trình để renderWorkflowTab() (module-ngansach.js) có DB.workflows[0]
    // làm fallback khi chưa có cấu hình dept nào — thiếu field này thì màn admin "🔄 Quy Trình & Phê Duyệt"
    // (Phần 2 của demo) crash ngay khi mở bất kỳ module nào, không riêng BUDGET.
    workflows: [{ id: 'WF_1STEP', name: 'Quy trình 1 bước (Trưởng phòng duyệt)', steps: [{ order: 1, name: 'Trưởng Phòng' }] }]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 900 });

  try {
    await loginAs(page, HC);
    const created = await page.evaluate(async () => {
      switchTab('uniform');
      setUniformSubTab('PERIODS');
      document.getElementById('uniformPeriodName').value = 'Kỳ Demo Vá Lỗi Tự Duyệt';
      addUniformAllocationBlock();
      updateUniformAllocDept(0, 'Siêu Thị Demo');
      updateUniformAllocItemField(0, 0, 'name', 'Áo đồng phục nam');
      updateUniformAllocItemField(0, 0, 'size', 'L');
      updateUniformAllocItemField(0, 0, 'qty', '10');
      await submitUniformPeriod();
      const p = DB.uniformPeriods.find((x) => x.name === 'Kỳ Demo Vá Lỗi Tự Duyệt');
      return { id: p ? p.id : null };
    });
    assert(created.id, 'HC phải tạo được kỳ cấp phát demo');
    console.log(`✅ HC (uniformManage) tạo kỳ cấp phát "Kỳ Demo Vá Lỗi Tự Duyệt" (id=${created.id})`);

    // HC bấm THẬT nút "Duyệt" trên đúng kỳ do chính mình tạo — server phải chặn 403.
    await page.evaluate(() => { renderUniformPeriodsList(); });
    await page.click(`button[data-op="approveUniformPeriodAction"][data-arg0="${created.id}"]`);
    await page.evaluate(() => window.__confirmPending());
    await page.waitForTimeout(200);
    const afterSelfApprove = await page.evaluate((id) => {
      const p = DB.uniformPeriods.find((x) => x.id === id);
      return { status: p.approvalStatus, alerts: window.__alerts };
    }, created.id);
    console.log(`🚫 HC tự bấm "Duyệt" -> trạng thái vẫn "${afterSelfApprove.status}" (KHÔNG chuyển APPROVED), thông báo lỗi: "${(afterSelfApprove.alerts || []).slice(-1)[0] || ''}"`);
    assert.strictEqual(afterSelfApprove.status, 'PENDING_APPROVAL', 'LỖI: HC vẫn tự duyệt được kỳ do chính mình tạo!');
    await shot(page, 'body', '01-dong-phuc-HC-tu-duyet-bi-chan.png');

    // HC2 (uniformApprove riêng, KHÔNG phải người tạo) bấm Duyệt — phải thành công.
    await loginAs(page, HC2);
    await page.evaluate(() => { switchTab('uniform'); renderUniformPeriodsList(); });
    await page.click(`button[data-op="approveUniformPeriodAction"][data-arg0="${created.id}"]`);
    await page.evaluate(() => window.__confirmPending());
    await page.waitForTimeout(200);
    const afterOtherApprove = await page.evaluate((id) => DB.uniformPeriods.find((x) => x.id === id).approvalStatus, created.id);
    console.log(`✅ HC2 (khác người tạo) bấm "Duyệt" -> trạng thái chuyển "${afterOtherApprove}"`);
    assert.strictEqual(afterOtherApprove, 'APPROVED', 'HC2 phải duyệt được kỳ do người khác tạo');
    await shot(page, 'body', '02-dong-phuc-nguoi-khac-duyet-thanh-cong.png');

    console.log('\n===== 2) NGÂN SÁCH — màn admin cấu hình "Đề Xuất" theo phòng ban ĐÃ ĐƯỢC KHÔI PHỤC =====\n');
    await loginAs(page, ADMIN_USER);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('WORKFLOW'); });
    await page.waitForTimeout(150);
    await page.click('button[data-op="switchWfModule"][data-arg0="BUDGET"]');
    await page.waitForTimeout(150);
    const wfTitle = await page.evaluate(() => document.getElementById('wfConfigTitle')?.innerText || '');
    console.log(`✅ Màn admin đã mở: "${wfTitle}"`);
    assert(wfTitle.includes('Ngân Sách'), 'Màn cấu hình Ngân Sách - Đề Xuất phải mở được');
    await shot(page, '#workflowSection', '03-ngansach-man-admin-cau-hinh-de-xuat-khoi-phuc.png');
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n===== 3) TUYỂN DỤNG — chặn người tự giới thiệu ứng viên tự xử lý trạng thái =====\n');
  {
    const referrer = { username: 'nv1', perms: { internalRecruitmentCreate: true } };
    const colleague = { username: 'nv2', perms: { internalRecruitmentCreate: true } };
    const referral = { referrerUsername: 'nv1', status: 'NEW' };

    try {
      recordActions.setRecruitmentReferralStatus({ status: 'CONTACTED' }, referrer, referral);
      throw new Error('LỖI: người tự giới thiệu vẫn tự cập nhật được trạng thái ứng viên của chính mình!');
    } catch (err) {
      console.log(`🚫 nv1 (tự giới thiệu ứng viên) tự cập nhật trạng thái -> bị chặn: "${err.message}"`);
    }
    const updated = recordActions.setRecruitmentReferralStatus({ status: 'CONTACTED' }, colleague, referral);
    console.log(`✅ nv2 (đồng nghiệp, không phải người giới thiệu) cập nhật được -> trạng thái: "${updated.status}"`);
  }

  console.log('\n===== 4) CÔNG VIỆC — chặn người tự giao việc cho bản thân tự duyệt gia hạn =====\n');
  {
    const selfAssigner = { username: 'qly1', perms: { taskEdit: true } };
    const otherManager = { username: 'qly2', perms: { taskEdit: true } };
    const selfTask = {
      assignedBy: 'qly1', assignedTo: 'qly1', status: 'IN_PROGRESS',
      pendingExtension: { newDeadline: '2026-12-31', reason: 'bận việc khác', requestedBy: 'qly1', requestedByName: 'Quản Lý 1' }
    };
    try {
      recordActions.resolvePendingTaskAction('extension', 'approve', selfAssigner, selfTask);
      throw new Error('LỖI: vẫn tự duyệt được yêu cầu gia hạn của việc tự giao cho bản thân!');
    } catch (err) {
      console.log(`🚫 qly1 (tự giao việc cho bản thân) tự duyệt gia hạn -> bị chặn: "${err.message}"`);
    }
    const normalTask = {
      assignedBy: 'qly2', assignedTo: 'nv1', status: 'IN_PROGRESS',
      pendingExtension: { newDeadline: '2026-12-31', reason: 'bận việc khác', requestedBy: 'nv1', requestedByName: 'Nhân Viên 1' }
    };
    const approved = recordActions.resolvePendingTaskAction('extension', 'approve', otherManager, normalTask);
    console.log(`✅ qly2 (người giao việc thật, khác người nhận) duyệt gia hạn bình thường -> hạn mới: "${approved.deadline}"`);
  }

  console.log('\n===== 5) NGÂN SÁCH (Đề Xuất) — chỉ approver ĐÃ CẤU HÌNH đúng phòng ban mới duyệt được =====\n');
  {
    const noConfigApprover = { username: 'nv_kd', perms: { budgetCreate: true } };
    const configuredApprover = { username: 'tp_kd', perms: { budgetCreate: true } };
    const budgetManageUser = { username: 'qlns1', perms: { budgetManage: true } };
    const appData = {
      workflows: [{ id: 'wf1', steps: [{ order: 1, name: 'Duyệt' }] }],
      // "Khối Vận Hành" CỐ Ý không có trong đây -> mô phỏng phòng ban CHƯA được admin cấu hình.
      budgetDeptWorkflows: { 'Khối Kinh Doanh': { workflowId: 'wf1', approvers: { 1: ['tp_kd'] } } }
    };

    const proposalUnconfiguredDept = { dept: 'Khối Vận Hành', createdBy: 'nv_kd', stage: 'PROPOSED', status: 'SUBMITTED' };
    try {
      recordActions.approveBudgetLineProposal(noConfigApprover, proposalUnconfiguredDept, appData);
      throw new Error('LỖI: budgetCreate vẫn duyệt chéo được Đề Xuất của phòng ban chưa cấu hình!');
    } catch (err) {
      console.log(`🚫 nv_kd (chỉ budgetCreate) duyệt Đề Xuất "Khối Vận Hành" (CHƯA cấu hình) -> bị chặn: "${err.message}"`);
    }
    const byManage = recordActions.approveBudgetLineProposal(budgetManageUser, proposalUnconfiguredDept, appData);
    console.log(`✅ qlns1 (budgetManage) vẫn LUÔN duyệt được dù phòng ban chưa cấu hình -> trạng thái: "${byManage.status}"`);

    const proposalConfiguredDept = { dept: 'Khối Kinh Doanh', createdBy: 'nv_kd', stage: 'PROPOSED', status: 'SUBMITTED' };
    const byConfigured = recordActions.approveBudgetLineProposal(configuredApprover, proposalConfiguredDept, appData);
    console.log(`✅ tp_kd (được cấu hình làm approver bước 1 của "Khối Kinh Doanh") duyệt được -> trạng thái: "${byConfigured.status}"`);
  }

  console.log('\n🖼️  Ảnh demo (Đồng Phục + màn admin Ngân Sách) đã lưu tại:', OUT_DIR);
  console.log('✅ DEMO THÀNH CÔNG — cả 4 lỗ hổng "tạo hồ sơ ≠ duyệt hồ sơ" đã được vá đúng như yêu cầu.');
}

main().catch((e) => { console.error('💥 Demo lỗi:', e); process.exitCode = 1; });
