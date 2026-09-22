// server/tests/demo-checklist-storeself-execute-perm.js
//
// DEMO thật (người dùng chủ động yêu cầu: "Bạn gửi ảnh demo trước khi làm nhé" / "Bạn demo lại phân
// quyền checklist đi") cho quyền MỚI "checklistStoreSelfExecute" (v24.0, xem VERSION.md) — theo đúng
// yêu cầu: "quyền Đánh giá checklist để tôi gán cho ai thì người đó vào được đánh giá và chỉ sử dụng
// được checklist câu hỏi, loại trừ ai không có quyền thì không vào được tab checklist".
//
// Dùng testHarness.js (Chromium thật mở public/index.html thật + toàn bộ public/js/*.js thật):
//   1) Admin mở form "Sửa Người Dùng" THẬT — chụp ảnh cây phân quyền khối 23 "Checklist Đánh Giá Siêu
//      Thị" xác nhận checkbox mới "✅ Đánh Giá Checklist (Tự Đánh Giá...)" đã có.
//   2) NV siêu thị CHƯA được cấp quyền -> nút "✅ Checklist" ở sidebar bị ẨN HẲN, không vào được tab.
//   3) NV siêu thị ĐÃ được cấp quyền -> thấy nút sidebar bình thường + vào tab Thực Hiện thấy đúng mẫu
//      "Tự Đánh Giá" (dạng câu hỏi) của đúng siêu thị mình.
//
// Chạy: node server/tests/demo-checklist-storeself-execute-perm.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');
const checklist = require('../lib/checklist');

const PORT = 8993;
const OUT_DIR = process.env.CHECKLIST_EXECUTE_PERM_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'checklist-storeself-execute-perm');

const ADMIN_USER = {
  id: 1, username: 'admin', name: 'Quản Trị Hệ Thống', dept: 'Ban Giám Đốc', posType: 'HO',
  perms: { admin: true }, totpEnabled: true, active: true
};

const NV_NO_PERM = {
  id: 2, username: 'nv_chuacap', name: 'Lê Thị Chưa Cấp (Nhân Viên Siêu Thị A)', dept: 'Siêu thị A', posType: 'STORE',
  perms: { checklistStoreSelfExecute: false }, active: true
};

const NV_HAS_PERM = {
  id: 3, username: 'nv_dacap', name: 'Phạm Văn Đã Cấp (GĐST Siêu Thị A)', dept: 'Siêu thị A', posType: 'STORE',
  perms: { checklistStoreSelfExecute: true }, active: true
};

let idSeq = 9800;
function nextId() { return idSeq++; }

function buildStoreSelfTemplate() {
  const core = checklist.assertTemplateCoreFields({
    templateCode: 'CL_TDG_DEMO', templateName: 'Checklist Tự Đánh Giá Hàng Ngày (demo quyền Đánh Giá Checklist)',
    templateType: 'STORE_SELF', passThreshold: 80
  });
  const questions = checklist.validateChecklistQuestions([
    {
      text: 'Quầy kệ trưng bày gọn gàng, đúng sơ đồ', isRequired: true, category: 'Trưng bày',
      options: [{ text: 'Đạt', scoreValue: 10, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }]
    },
    {
      text: 'Đồng phục nhân viên đầy đủ, đúng quy định', isRequired: true, category: 'Tác phong',
      options: [{ text: 'Đạt', scoreValue: 10, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }]
    }
  ], 'SCORED');
  return Object.assign(
    { id: nextId(), status: 'ACTIVE', version: 1, clonedFromTemplateId: null, activatedAt: checklist.nowVN(), creator: 'admin', creatorName: 'Quản Trị Hệ Thống' },
    core, { questions }
  );
}

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const template = buildStoreSelfTemplate();

  const state = createMockState({
    depts: ['Ban Giám Đốc'],
    stores: ['Siêu thị A', 'Siêu thị B'],
    users: [ADMIN_USER, NV_NO_PERM, NV_HAS_PERM],
    checklistTemplates: [template],
    checklistSubmissions: []
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 1000 });

  try {
    // ===== BƯỚC 1: Admin mở form Sửa Người Dùng THẬT — xác nhận checkbox mới đã có =====
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN_USER);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('PERMS'); });
    await page.waitForTimeout(150);

    await page.evaluate((id) => { editUser(id); }, NV_NO_PERM.id);
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const badge = document.getElementById('permTreeBadge_checklist');
      if (badge) { badge.closest('details').open = true; badge.scrollIntoView({ block: 'center' }); }
    });
    await page.waitForTimeout(100);
    const checkboxExists = await page.evaluate(() => !!document.getElementById('pChecklistStoreSelfExecute'));
    console.log(`✅ Checkbox "Đánh Giá Checklist (Tự Đánh Giá)" đã có trong form? ${checkboxExists}`);
    if (!checkboxExists) throw new Error('❌ Checkbox quyền mới KHÔNG có trong form.');
    await shot(page, 'details:has(#permTreeBadge_checklist)', '01-cay-phan-quyen-co-checkbox-danh-gia-checklist.png');

    // ===== BƯỚC 2: NV CHƯA được cấp quyền -> nút sidebar Checklist bị ẩn, không vào được tab =====
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, NV_NO_PERM);
    await page.waitForTimeout(150);
    await shot(page, '#sidebarNav, aside, body', '02-nv-chua-cap-quyen-KHONG-thay-nut-checklist.png').catch(async () => {
      await shot(page, 'body', '02-nv-chua-cap-quyen-KHONG-thay-nut-checklist.png');
    });
    const navHiddenForNoPerm = await page.evaluate(() => document.getElementById('btnChecklistNav')?.classList.contains('hidden'));
    const canAccessNoPerm = await page.evaluate(() => canAccessChecklistModule(currentUser));
    console.log(`✅ NV chưa cấp quyền: nút sidebar "Checklist" bị ẩn? ${navHiddenForNoPerm} — canAccessChecklistModule()? ${canAccessNoPerm}`);
    if (!navHiddenForNoPerm || canAccessNoPerm) throw new Error('❌ NV chưa cấp quyền vẫn thấy/truy cập được tab Checklist — LỖ HỔNG!');

    // ===== BƯỚC 3: NV ĐÃ được cấp quyền -> thấy nút sidebar + vào tab Thực Hiện thấy đúng mẫu =====
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, NV_HAS_PERM);
    await page.evaluate(() => { switchTab('checklist'); setChecklistSubTab('EXECUTE'); });
    await page.waitForTimeout(150);
    await shot(page, '#checklistSubExecute', '03-nv-da-cap-quyen-thay-mau-tu-danh-gia.png');
    const navVisibleForHasPerm = await page.evaluate(() => !document.getElementById('btnChecklistNav')?.classList.contains('hidden'));
    const templateVisible = await page.evaluate(() => document.getElementById('checklistSubExecute').textContent.includes('Tự Đánh Giá'));
    console.log(`✅ NV đã cấp quyền: nút sidebar hiện? ${navVisibleForHasPerm} — thấy khối "Tự Đánh Giá"? ${templateVisible}`);
    if (!navVisibleForHasPerm || !templateVisible) throw new Error('❌ NV đã cấp quyền lại KHÔNG thấy được tab/mẫu — lỗi ngược.');

    console.log('\n🖼️  Ảnh demo đã lưu tại:', OUT_DIR);
    console.log('✅ DEMO THÀNH CÔNG — quyền "checklistStoreSelfExecute" gác đúng tab Checklist Tự Đánh Giá theo yêu cầu.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error('💥 Demo lỗi:', e); process.exitCode = 1; });
