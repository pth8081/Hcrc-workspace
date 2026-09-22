// server/tests/demo-checklist-audit-lock-own-store.js
//
// DEMO thật (người dùng chủ động yêu cầu: "Bạn demo vad test xem đã chuẩn quyền chưa nhé") cho quyền
// MỚI "checklistAuditLockOwnStore" (v23.101, xem VERSION.md) — khi bật, Kiểm Soát Viên CHỈ Kiểm Soát
// được ĐÚNG siêu thị hiện đang gán cho tài khoản (user.dept), không tự chọn siêu thị khác, bỏ qua hẳn
// "Phạm Vi Kiểm Soát" (checklistAuditScope) dù có cấu hình gì đi nữa.
//
// Dùng testHarness.js (Chromium thật mở public/index.html thật + toàn bộ public/js/*.js thật):
//   1) Admin mở form "Sửa Người Dùng" THẬT (editUser() → populatePermsForm()) cho 1 tài khoản Kiểm Soát
//      Viên, chụp ảnh cây phân quyền cho thấy checkbox mới đã tick đúng + khối "Phạm Vi Kiểm Soát" bị mờ
//      đi (pointer-events-none) đúng như toggleChecklistAuditLockOwnStoreGroup() thật làm.
//   2) Đăng nhập bằng 2 tài khoản Kiểm Soát Viên khác nhau (1 có khoá, 1 không) và chụp ảnh tab "Thực
//      Hiện" module Checklist — so sánh trực quan: có khoá thì hiện nhãn 🔒 cố định (không phải dropdown),
//      không khoá thì vẫn hiện dropdown chọn siêu thị như trước đây.
//   3) Gọi TRỰC TIẾP hàm chặn thật phía server (lib/checklist.js::resolveStoreCodeForSubmission — cùng
//      hàm routes/records.js gọi khi tạo submission thật) để chứng minh: dù ai đó bỏ qua UI, tự sửa DOM
//      hoặc gọi thẳng API với storeCode khác, server VẪN từ chối — đây là điểm chặn THẬT, không phải chỉ
//      lớp hiển thị. (testHarness.js's mock dispatcher không mô phỏng route POST tạo submission checklist
//      nên gọi thẳng hàm lib thật ở tầng Node — vẫn là code sản xuất 100%, chỉ khác đường gọi.)
//
// Chạy: node server/tests/demo-checklist-audit-lock-own-store.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');
const checklist = require('../lib/checklist');

const PORT = 8991;
const OUT_DIR = process.env.CHECKLIST_LOCK_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'checklist-audit-lock-own-store');

// KHÔNG dùng perms.admin:true kèm totpEnabled:false — proceedAfterAuth() (core.js) tự động chuyển sang
// màn "Bắt buộc bật TOTP" cho tài khoản admin CHƯA bật totpEnabled, bỏ qua initDatabase() luôn (xem
// gotcha tương tự ở demo-checklist-full-module.js).
const ADMIN_USER = {
  id: 1, username: 'admin', name: 'Quản Trị Hệ Thống', dept: 'Ban Giám Đốc', posType: 'HO',
  perms: { admin: true }, totpEnabled: true, active: true
};

const KSV_LOCKED = {
  id: 2, username: 'ksv_khoa', name: 'Nguyễn Văn Khoá (Kiểm Soát Viên — khoá đúng siêu thị)', dept: 'Siêu thị A', posType: 'HO',
  perms: { checklistAuditLockOwnStore: true, checklistAuditScope: { all: true, depts: [] } }, // cố tình để checklistAuditScope:all:true để chứng minh nó BỊ BỎ QUA hoàn toàn khi có cờ khoá
  active: true
};

const KSV_UNLOCKED = {
  id: 3, username: 'ksv_thuong', name: 'Trần Thị Thường (Kiểm Soát Viên — không khoá, chọn tự do)', dept: 'Phòng Kiểm Soát Chất Lượng', posType: 'HO',
  perms: { checklistAuditLockOwnStore: false, checklistAuditScope: { all: true, depts: [] } },
  active: true
};

let idSeq = 9000;
function nextId() { return idSeq++; }

function buildControlAuditTemplate() {
  const core = checklist.assertTemplateCoreFields({
    templateCode: 'CL_KSDEMO', templateName: 'Checklist Kiểm Soát Vệ Sinh & An Toàn (demo quyền khoá siêu thị)',
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
    users: [ADMIN_USER, KSV_LOCKED, KSV_UNLOCKED],
    checklistTemplates: [template],
    checklistSubmissions: []
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 1000 });

  try {
    // ===== BƯỚC 1: Admin mở form Sửa Người Dùng THẬT, xem cây phân quyền của ksv_khoa =====
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN_USER);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('PERMS'); });
    await page.waitForTimeout(150);

    const ksvLockedId = state.users.find(u => u.username === 'ksv_khoa').id;
    await page.evaluate((id) => { editUser(id); }, ksvLockedId);
    await page.waitForTimeout(100);
    // Mở đúng <details> "23. Checklist Đánh Giá Siêu Thị" (đóng mặc định) để lộ checkbox mới trong ảnh.
    await page.evaluate(() => {
      document.getElementById('permTreeBadge_checklist')?.closest('details') && (document.getElementById('permTreeBadge_checklist').closest('details').open = true);
      document.getElementById('permTreeBadge_checklist')?.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(100);
    await shot(page, '#permTreeBadge_checklist', '01-badge-so-quyen-da-tick.png').catch(() => {});
    const checklistNodeSel = 'details:has(#permTreeBadge_checklist)';
    await shot(page, checklistNodeSel, '01-cay-phan-quyen-checklist-da-tick-khoa-sieu-thi.png');

    const lockChecked = await page.evaluate(() => document.getElementById('pChecklistAuditLockOwnStore').checked);
    const scopeWrapDimmed = await page.evaluate(() => document.getElementById('pChecklistAuditScopeWrap').classList.contains('opacity-40'));
    console.log(`✅ Form Sửa Người Dùng (ksv_khoa) hiện đúng: checkbox "Khoá đúng siêu thị được gán" = ${lockChecked}, khối "Phạm Vi Kiểm Soát" bị mờ/khoá = ${scopeWrapDimmed}`);
    if (!lockChecked || !scopeWrapDimmed) throw new Error('❌ Form KHÔNG hiển thị đúng trạng thái quyền — dừng demo.');

    // ===== BƯỚC 2: Đăng nhập ksv_khoa (CÓ khoá) — chụp tab Thực Hiện, kỳ vọng nhãn 🔒 cố định =====
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, KSV_LOCKED);
    await page.evaluate(() => { switchTab('checklist'); setChecklistSubTab('EXECUTE'); });
    await page.waitForTimeout(150);
    await shot(page, '#checklistSubExecute', '02-ksv-CO-khoa-hien-nhan-co-dinh-sieu-thi-A.png');

    const lockedFieldIsSelect = await page.evaluate(() => document.getElementById('checklistAuditStoreSelect').tagName === 'SELECT');
    const lockedFieldValue = await page.evaluate(() => document.getElementById('checklistAuditStoreSelect').value);
    console.log(`✅ Tài khoản ksv_khoa (có khoá): ô chọn siêu thị là <select> chọn tự do? ${lockedFieldIsSelect} — value hiện tại = "${lockedFieldValue}"`);
    if (lockedFieldIsSelect || lockedFieldValue !== 'Siêu thị A') throw new Error('❌ ksv_khoa KHÔNG bị khoá đúng siêu thị A trên giao diện — dừng demo.');

    // ===== BƯỚC 3: Đăng nhập ksv_thuong (KHÔNG khoá) — chụp đối chứng, kỳ vọng dropdown như cũ =====
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, KSV_UNLOCKED);
    await page.evaluate(() => { switchTab('checklist'); setChecklistSubTab('EXECUTE'); });
    await page.waitForTimeout(150);
    await shot(page, '#checklistSubExecute', '03-ksv-KHONG-khoa-doi-chung-van-la-dropdown-tu-chon.png');

    const unlockedFieldIsSelect = await page.evaluate(() => document.getElementById('checklistAuditStoreSelect').tagName === 'SELECT');
    console.log(`✅ Tài khoản ksv_thuong (không khoá, đối chứng): ô chọn siêu thị vẫn là <select> chọn tự do? ${unlockedFieldIsSelect}`);
    if (!unlockedFieldIsSelect) throw new Error('❌ ksv_thuong (không có quyền khoá) lại bị khoá nhầm — dừng demo.');

    console.log('\n🖼️  Ảnh demo giao diện đã lưu tại:', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }

  // ===== BƯỚC 4: Test tamper-proof THẬT phía server — gọi thẳng resolveStoreCodeForSubmission() =====
  // (không qua mock dispatcher, không qua UI — đúng hàm production routes/records.js gọi khi tạo
  // submission thật, chứng minh dù DOM/API bị can thiệp trực tiếp vẫn không vượt qua được).
  console.log('\n===== BƯỚC 4: Test tamper-proof server-side (gọi thẳng lib/checklist.js thật) =====');
  const validStores = ['Siêu thị A', 'Siêu thị B', 'Siêu thị C'];
  let passCount = 0, failCount = 0;
  function check(desc, fn) {
    try { fn(); console.log('  ✅', desc); passCount++; }
    catch (e) { console.log('  ❌', desc, '—', e.message); failCount++; }
  }

  check('ksv_khoa gửi ĐÚNG siêu thị được gán (Siêu thị A) → PHẢI được chấp nhận', () => {
    const result = checklist.resolveStoreCodeForSubmission(template, KSV_LOCKED, 'Siêu thị A', validStores);
    if (result !== 'Siêu thị A') throw new Error('kết quả không đúng: ' + result);
  });
  check('ksv_khoa tự sửa DOM/gọi thẳng API với storeCode="Siêu thị B" (không phải siêu thị của mình) → PHẢI bị từ chối (403)', () => {
    try {
      checklist.resolveStoreCodeForSubmission(template, KSV_LOCKED, 'Siêu thị B', validStores);
      throw new Error('KHÔNG bị chặn — LỖ HỔNG!');
    } catch (e) {
      if (e.status !== 403) throw new Error('bị chặn nhưng sai mã lỗi mong đợi (403): ' + (e.status || e.message));
    }
  });
  check('ksv_khoa gửi storeCode="Siêu thị C" (khác siêu thị mình) → PHẢI bị từ chối dù checklistAuditScope đang để {all:true}', () => {
    try {
      checklist.resolveStoreCodeForSubmission(template, KSV_LOCKED, 'Siêu thị C', validStores);
      throw new Error('KHÔNG bị chặn — checklistAuditScope:{all:true} đã KHÔNG bị bỏ qua như kỳ vọng — LỖ HỔNG!');
    } catch (e) {
      if (e.status !== 403) throw new Error('bị chặn nhưng sai mã lỗi mong đợi (403): ' + (e.status || e.message));
    }
  });
  check('ksv_thuong (KHÔNG có quyền khoá, checklistAuditScope:{all:true}) gửi storeCode="Siêu thị B" → PHẢI được chấp nhận (đối chứng, hành vi CŨ không đổi)', () => {
    const result = checklist.resolveStoreCodeForSubmission(template, KSV_UNLOCKED, 'Siêu thị B', validStores);
    if (result !== 'Siêu thị B') throw new Error('kết quả không đúng: ' + result);
  });

  console.log(`\n===== KẾT QUẢ: ${passCount}/${passCount + failCount} kiểm tra đạt =====`);
  if (failCount > 0) {
    console.log('❌ DEMO THẤT BẠI — có ít nhất 1 kiểm tra không đạt, xem chi tiết ở trên.');
    process.exitCode = 1;
  } else {
    console.log('✅ DEMO THÀNH CÔNG — quyền "checklistAuditLockOwnStore" hoạt động ĐÚNG cả ở giao diện lẫn điểm chặn thật phía server.');
  }
}

main().catch(e => { console.error('💥 Demo lỗi:', e); process.exitCode = 1; });
