// server/tests/demo-workflow-any-approver-config.js
//
// DEMO (PREVIEW, CHƯA MERGE — gửi người dùng xác nhận phương án trước khi hoàn thiện/mở rộng) cho tính
// năng MỚI: "ở các bước trong quy trình, cho phép cấu hình — nếu có nhiều người ở bước đó, cho phép MỘT
// TRONG NHỮNG NGƯỜI đó phê duyệt là có thể qua (thay vì bắt buộc tất cả 'đồng phê duyệt' như hiện tại).
// Phải ĐỘNG — admin chọn bật ở bước nào thì bước đó mới vậy, bước nào không chọn thì giữ nguyên".
//
// Minh hoạ:
//   1. Màn "Hệ Thống > Quy Trình & Phê Duyệt > 🚗 QT Đăng Ký Xe" — nút MỚI "⚡ Chỉ cần 1 người duyệt"
//      cạnh "🧭 Theo vị trí" (CAR là 1 trong các module PHASE 1 đã wire xong engine).
//   2. Cùng màn đó nhưng chọn "📜 QT Văn Bản Trình" — XÁC NHẬN chưa hiện nút này (PHASE 2, chưa wire
//      xong engine — cố tình ẩn để tránh 1 tuỳ chọn trông như hoạt động nhưng vô tác dụng).
//   3. Kết quả thực tế ở màn "🚗 Đăng Ký Xe": 1 phiếu PENDING có 2 người duyệt bước 1 + đã bật "Chỉ cần
//      1 người duyệt" — badge hiện đúng "(Đã 0/2 người duyệt — chỉ cần 1 người là đủ)".
//
// Dựng lại đúng khuôn tests/demo-carreg-driver-view.js (testHarness.js, Chromium thật).
//
// Chạy: node server/tests/demo-workflow-any-approver-config.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8996;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'workflow-any-approver-config');

const WF_2STEP = { id: 'WF_2STEP', name: '2 bước', steps: [{ order: 1, name: 'Trưởng phòng' }, { order: 2, name: 'Giám đốc' }] };

// Admin — vừa xem được màn cấu hình, vừa LÀ 1 trong 2 người duyệt bước 1 (để xem đúng badge ở màn Đăng
// Ký Xe) — canApproveStep() không còn bypass cho admin nên phải có tên THẬT trong approvers[1].
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Kinh Doanh', perms: { admin: true }, active: true, totpEnabled: true };
const APPROVER2 = { username: 'tp_kd2', name: 'Trưởng Phòng Kinh Doanh 2', dept: 'Kinh Doanh', perms: {}, active: true };

const CAR_REG = {
  id: 9001, code: 'DKX-9001', dept: 'Kinh Doanh', creator: 'nv1', creatorName: 'Nhân Viên A',
  status: 'PENDING', currentStep: 1, history: [],
  type: 'Xe 4 chỗ', km: 12, passengers: '2', directUser: 'Nhân Viên A', directUserPhone: '0901111111',
  purpose: 'Gặp khách hàng', reason: 'Ký hợp đồng quý IV',
  destination: 'Trụ sở → Khách sạn ABC', startTime: '2026-11-20T08:00:00', endTime: '2026-11-20T12:00:00'
};

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({
    depts: ['Kinh Doanh'], users: [ADMIN, APPROVER2], carRegs: [CAR_REG]
  });
  state.workflows = [WF_2STEP];
  state.carDeptWorkflows = { 'Kinh Doanh': { workflowId: 'WF_2STEP', approvers: { 1: ['admin', 'tp_kd2'], 2: ['admin'] } } };

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 900 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.waitForTimeout(150);

    // ===== 1) Màn Cấu Hình — "🚗 QT Đăng Ký Xe" — nút MỚI xuất hiện, CHƯA bật =====
    await page.evaluate(() => switchTab('system'));
    await page.waitForTimeout(150);
    await page.evaluate(() => document.querySelector('#btnSystemSubWorkflow')?.click());
    await page.waitForTimeout(150);
    await page.evaluate(() => document.querySelector('#btnWfModCar')?.click());
    await page.waitForTimeout(200);
    await shot(page, '#workflowSection', '1-qt-dang-ky-xe-chua-bat.png');

    const beforeState = await page.evaluate(() => {
      const el = document.getElementById('wfAnyApproverToggle_Kinh_Doanh_1');
      return { exists: !!el, checked: el ? el.checked : null };
    });
    console.log('[Trước khi bật, QT Đăng Ký Xe]', beforeState);

    // ===== 2) Bật "⚡ Chỉ cần 1 người duyệt" cho bước 1 + Lưu Cấu Hình =====
    await page.click('#wfAnyApproverToggle_Kinh_Doanh_1');
    await page.waitForTimeout(100);
    await shot(page, '#workflowSection', '2-qt-dang-ky-xe-da-bat-truoc-khi-luu.png');
    await page.click('[data-op="saveDeptWorkflowConfig"][data-arg0="Kinh Doanh"]');
    await page.waitForTimeout(250);

    const afterSaveConfig = await page.evaluate(() => DB.carDeptWorkflows['Kinh Doanh']);
    console.log('[Sau khi lưu] DB.carDeptWorkflows["Kinh Doanh"]:', JSON.stringify(afterSaveConfig));

    // ===== 3) Chuyển sang "📜 QT Văn Bản Trình" — XÁC NHẬN nút MỚI KHÔNG hiện (PHASE 2, chưa wire) =====
    await page.evaluate(() => document.querySelector('#btnWfModSubmission')?.click());
    await page.waitForTimeout(200);
    await shot(page, '#workflowSection', '3-qt-van-ban-trinh-khong-co-nut-moi.png');
    const submissionHasToggle = await page.evaluate(() => {
      const container = document.getElementById('deptWorkflowConfigContainer');
      return container ? container.innerHTML.includes('wfAnyApproverToggle_') : null;
    });
    console.log('[QT Văn Bản Trình có nút "Chỉ cần 1 người duyệt" không?]', submissionHasToggle);

    // ===== 4) Màn "🚗 Đăng Ký Xe" — phiếu PENDING hiện đúng badge "chỉ cần 1 người là đủ" =====
    await page.evaluate(() => { switchTab('car'); setCarSubTab('REG'); });
    await page.waitForTimeout(250);
    await shot(page, '#carSubReg', '4-dang-ky-xe-badge-chi-can-1-nguoi.png');
    const badgeText = await page.evaluate(() => {
      const td = Array.from(document.querySelectorAll('td')).find(e => e.textContent.includes('DKX-9001'));
      const tr = td ? td.closest('tr') : null;
      return tr ? tr.textContent : '';
    });
    console.log('[Nội dung dòng phiếu DKX-9001 có chứa "chỉ cần 1 người là đủ"?]', badgeText.includes('chỉ cần 1 người là đủ'));
    console.log('[Nội dung badge đầy đủ]', badgeText.match(/⏳[^✍]*/)?.[0]?.trim());

    console.log(`\nẢnh demo đã lưu tại: ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
