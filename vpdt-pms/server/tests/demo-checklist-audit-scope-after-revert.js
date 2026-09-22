// server/tests/demo-checklist-audit-scope-after-revert.js
//
// DEMO thật (người dùng chủ động yêu cầu: "Bạn gửi ảnh demo trước khi làm nhé") cho trạng thái checklist
// Đánh Giá Siêu Thị SAU KHI thu hồi quyền "checklistAuditLockOwnStore" (v23.102, xem VERSION.md) — xác
// nhận lại đúng logic CŨ mà người dùng muốn giữ: Kiểm Soát Viên tự chọn danh sách siêu thị mình kiểm
// soát (checklistAuditScope, đa chọn hoặc tick ALL), KHÔNG còn nút "khoá cứng 1 siêu thị" nào nữa.
//
// Dùng testHarness.js (Chromium thật mở public/index.html thật + toàn bộ public/js/*.js thật):
//   1) Admin mở form "Sửa Người Dùng" THẬT cho 1 Kiểm Soát Viên — chụp ảnh cây phân quyền khối 23
//      "Checklist Đánh Giá Siêu Thị" xác nhận: KHÔNG còn checkbox khoá nào, chỉ còn "Phạm Vi Kiểm Soát"
//      (đa chọn siêu thị + ALL) như logic gốc.
//   2) Đăng nhập 2 tài khoản Kiểm Soát Viên khác nhau — 1 người được gán 2 siêu thị cụ thể, 1 người
//      được tick ALL — chụp ảnh tab Thực Hiện, xác nhận ô chọn siêu thị luôn là <select> hiện ĐÚNG danh
//      sách siêu thị trong phạm vi được gán (không có nhãn khoá cố định nào).
//
// Chạy: node server/tests/demo-checklist-audit-scope-after-revert.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');
const checklist = require('../lib/checklist');

const PORT = 8992;
const OUT_DIR = process.env.CHECKLIST_SCOPE_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'checklist-audit-scope-after-revert');

// KHÔNG dùng perms.admin:true kèm totpEnabled:false — proceedAfterAuth() (core.js) tự động chuyển sang
// màn "Bắt buộc bật TOTP" cho tài khoản admin CHƯA bật totpEnabled, bỏ qua initDatabase() luôn.
const ADMIN_USER = {
  id: 1, username: 'admin', name: 'Quản Trị Hệ Thống', dept: 'Ban Giám Đốc', posType: 'HO',
  perms: { admin: true }, totpEnabled: true, active: true
};

const KSV_TWO_STORES = {
  id: 2, username: 'ksv_2st', name: 'Nguyễn Văn A (Kiểm Soát Viên — 2 siêu thị được phân công)', dept: 'Phòng Kiểm Soát Chất Lượng', posType: 'HO',
  perms: { checklistAuditScope: { all: false, depts: ['Siêu thị A', 'Siêu thị B'] } },
  active: true
};

const KSV_ALL_STORES = {
  id: 3, username: 'ksv_all', name: 'Trần Thị B (Kiểm Soát Viên — kiểm soát TẤT CẢ siêu thị)', dept: 'Phòng Kiểm Soát Chất Lượng', posType: 'HO',
  perms: { checklistAuditScope: { all: true, depts: [] } },
  active: true
};

let idSeq = 9500;
function nextId() { return idSeq++; }

function buildControlAuditTemplate() {
  const core = checklist.assertTemplateCoreFields({
    templateCode: 'CL_KSDEMO2', templateName: 'Checklist Kiểm Soát Vệ Sinh & An Toàn (demo sau thu hồi khoá)',
    templateType: 'CONTROL_AUDIT', passThreshold: 80
  });
  const questions = checklist.validateChecklistQuestions([
    {
      text: 'Khu vực trưng bày sạch sẽ, không có hàng hoá hư hỏng', isRequired: true, category: 'Vệ sinh chung',
      options: [{ text: 'Đạt', scoreValue: 10, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }]
    },
    {
      text: 'Lối thoát hiểm không bị chắn', isRequired: true, category: 'An toàn PCCC',
      options: [{ text: 'Đạt', scoreValue: 10, isPassing: true }, { text: 'Không đạt (nghiêm trọng)', scoreValue: -20, isPassing: false, isCriticalFail: true }]
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

  const template = buildControlAuditTemplate();

  const state = createMockState({
    depts: ['Ban Giám Đốc', 'Phòng Kiểm Soát Chất Lượng'],
    stores: ['Siêu thị A', 'Siêu thị B', 'Siêu thị C'],
    users: [ADMIN_USER, KSV_TWO_STORES, KSV_ALL_STORES],
    checklistTemplates: [template],
    checklistSubmissions: []
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 1000 });

  try {
    // ===== BƯỚC 1: Admin mở form Sửa Người Dùng THẬT — xác nhận KHÔNG còn checkbox khoá nào =====
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN_USER);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('PERMS'); });
    await page.waitForTimeout(150);

    const ksvId = state.users.find(u => u.username === 'ksv_2st').id;
    await page.evaluate((id) => { editUser(id); }, ksvId);
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const badge = document.getElementById('permTreeBadge_checklist');
      if (badge) { badge.closest('details').open = true; badge.scrollIntoView({ block: 'center' }); }
    });
    await page.waitForTimeout(100);
    const lockCheckboxExists = await page.evaluate(() => !!document.getElementById('pChecklistAuditLockOwnStore'));
    console.log(`✅ Checkbox "Khoá đúng siêu thị được gán" đã bị gỡ khỏi form? ${!lockCheckboxExists ? 'ĐÚNG (đã gỡ)' : 'SAI (vẫn còn!)'}`);
    if (lockCheckboxExists) throw new Error('❌ Checkbox khoá vẫn còn tồn tại trong form — chưa gỡ sạch.');
    await shot(page, 'details:has(#permTreeBadge_checklist)', '01-cay-phan-quyen-checklist-khong-con-nut-khoa.png');

    // ===== BƯỚC 2: KSV được gán 2 siêu thị cụ thể — dropdown chỉ hiện đúng 2 siêu thị đó =====
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, KSV_TWO_STORES);
    await page.evaluate(() => { switchTab('checklist'); setChecklistSubTab('EXECUTE'); });
    await page.waitForTimeout(150);
    await shot(page, '#checklistSubExecute', '02-ksv-duoc-gan-2-sieu-thi-dropdown-tu-chon.png');
    const twoStoreOptions = await page.evaluate(() => Array.from(document.getElementById('checklistAuditStoreSelect').options).map(o => o.value));
    console.log(`✅ ksv_2st: dropdown hiện đúng danh sách được gán? [${twoStoreOptions.join(', ')}]`);
    if (twoStoreOptions.length !== 2 || !twoStoreOptions.includes('Siêu thị A') || !twoStoreOptions.includes('Siêu thị B') || twoStoreOptions.includes('Siêu thị C')) {
      throw new Error('❌ Danh sách siêu thị trong dropdown không đúng phạm vi được gán.');
    }

    // ===== BƯỚC 3: KSV được tick ALL — dropdown hiện TOÀN BỘ siêu thị =====
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, KSV_ALL_STORES);
    await page.evaluate(() => { switchTab('checklist'); setChecklistSubTab('EXECUTE'); });
    await page.waitForTimeout(150);
    await shot(page, '#checklistSubExecute', '03-ksv-duoc-tick-ALL-dropdown-hien-moi-sieu-thi.png');
    const allStoreOptions = await page.evaluate(() => Array.from(document.getElementById('checklistAuditStoreSelect').options).map(o => o.value));
    console.log(`✅ ksv_all: dropdown hiện TOÀN BỘ siêu thị? [${allStoreOptions.join(', ')}]`);
    if (allStoreOptions.length !== 3) throw new Error('❌ Tick ALL nhưng dropdown không hiện đủ toàn bộ siêu thị.');

    console.log('\n🖼️  Ảnh demo đã lưu tại:', OUT_DIR);
    console.log('✅ DEMO THÀNH CÔNG — đã thu hồi sạch nút khoá, Kiểm Soát Viên quay lại tự chọn siêu thị (đa chọn/ALL) đúng như yêu cầu.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error('💥 Demo lỗi:', e); process.exitCode = 1; });
