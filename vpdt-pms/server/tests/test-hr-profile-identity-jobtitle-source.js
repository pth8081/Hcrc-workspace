// server/tests/test-hr-profile-identity-jobtitle-source.js
//
// Regression test cho LỖI ĐÃ VÁ (11/2026, theo yêu cầu người dùng — "chức danh tại màn hình user chỉ để
// liên quan đến các cái phê duyệt thôi, chức danh hồ sơ phải lấy từ Cơ Cấu Tổ Chức"): hrpfIdentitySnapshot()
// (public/js/module-hrprofile.js) TRƯỚC ĐÂY rơi về lấy u.jobTitle (DB.users, field CHỈ phục vụ hiển thị
// chân ký phê duyệt — xem #jobTitleList ở systemSection.html) làm Chức Danh hiển thị khi profile.jobTitle
// (nguồn DUY NHẤT: Cơ Cấu Tổ Chức qua applyPositionAssignment()) còn trống — gây hiểu nhầm hồ sơ đã có
// chức danh chính thức dù chưa hề được gán vị trí nào. Nay Chức Danh CHỈ lấy từ profile.jobTitle, không
// còn mượn tạm field phê duyệt của tài khoản. Phòng Ban (dept) KHÔNG đổi — vẫn rơi về u.dept như cũ (field
// này không có xung đột mục đích giống jobTitle).
//
//   1. Hồ sơ ĐÃ gán chức vụ qua Cơ Cấu Tổ Chức (profile.jobTitle có giá trị) -> hiện ĐÚNG profile.jobTitle,
//      dù tài khoản liên kết có u.jobTitle khác.
//   2. Hồ sơ CHƯA gán chức vụ (profile.jobTitle rỗng) + tài khoản liên kết CÓ u.jobTitle (field phê duyệt)
//      -> KHÔNG hiện u.jobTitle — Chức Danh để trống (chỉ hiện Phòng Ban, không có " — <chức danh>").
//   3. Phòng Ban (dept) vẫn rơi về u.dept khi profile.dept trống (hành vi KHÔNG đổi, chỉ jobTitle đổi).
//
// Chạy: node server/tests/test-hr-profile-identity-jobtitle-source.js
'use strict';
const { startHarness } = require('./_harness-contract');

let passed = 0, failed = 0;
function check(label, cond) { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.log(`  ❌ ${label}`); failed++; } }

async function main() {
  const h = await startHarness();
  const { page, stop } = h;
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  try {
    const ACC = { username: 'NV700', name: 'Trần Văn Bảy Trăm', dept: 'Phòng Kinh Doanh', jobTitle: 'Người Duyệt Mua Hàng', active: true };
    await page.evaluate((u) => {
      const idx = DB.users.findIndex(x => x.username === u.username);
      if (idx >= 0) DB.users[idx] = u; else DB.users.push(u);
    }, ACC);

    const text1 = await page.evaluate((username) => {
      const profile = { employeeCode: 'NV700', username, jobTitle: 'Trưởng Phòng Kinh Doanh', dept: 'Phòng Kinh Doanh', status: 'ACTIVE' };
      return renderHrpfProfileForm(profile, { scope: 'MANAGE', readOnly: true });
    }, ACC.username);
    check('Đã gán chức vụ qua Cơ Cấu Tổ Chức -> hiện ĐÚNG profile.jobTitle', text1.includes('Trưởng Phòng Kinh Doanh'));
    check('Không hiện lẫn jobTitle phê duyệt của tài khoản khi profile đã có jobTitle riêng', !text1.includes('Người Duyệt Mua Hàng'));

    const text2 = await page.evaluate((username) => {
      const profile = { employeeCode: 'NV700', username, jobTitle: null, dept: null, status: 'ACTIVE' };
      return renderHrpfProfileForm(profile, { scope: 'MANAGE', readOnly: true });
    }, ACC.username);
    check('CHƯA gán chức vụ -> KHÔNG mượn u.jobTitle (field phê duyệt) để hiện', !text2.includes('Người Duyệt Mua Hàng'));
    check('CHƯA gán chức vụ -> Phòng Ban vẫn rơi về u.dept như cũ (hành vi dept không đổi)', text2.includes('Phòng Kinh Doanh'));

    check('Không có ngoại lệ JS chưa bắt (pageerror) nào phát sinh', pageErrors.length === 0);
    if (pageErrors.length) console.error('  pageerror:', pageErrors.join(' | '));
  } finally {
    await stop();
  }

  console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
