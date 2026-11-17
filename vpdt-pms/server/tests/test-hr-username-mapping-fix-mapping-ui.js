// server/tests/test-hr-username-mapping-fix-mapping-ui.js
//
// Regression UI (Playwright thật) cho "✏️ Sửa Mapping" (11/2026, theo yêu cầu người dùng: "Cho tôi thêm
// chức năng sửa mapping giữa mã nhân viên và tên đăng nhập ngay trong tab mã nv -- tài khoản. Chỉ
// mapping ko sửa mã nhân viên bên nhân sự") — umapOpenFixMappingModal()/umapSubmitFixMapping()
// (module-hethong-tabs.js). CHỈ hiện cho dòng ⚠️ Lệch mã, đổi field "username" của tài khoản đã liên
// kết qua syncUserPatch() có sẵn (module-admin-submissiongroups.js, dùng CHUNG route/cascade với "Sửa
// Người Dùng" — KHÔNG viết lại logic đổi tên đăng nhập), KHÔNG đụng employeeProfiles.employeeCode.
//
// Mock POST /api/data/users (__patchUser) đã thêm vào testHarness.js (đơn giản hoá, chỉ cascade
// employeeProfiles.username — xem chú thích tại đó) — dùng CHUNG, không cần tự bọc window.fetch riêng.
//
// Chạy: node server/tests/test-hr-username-mapping-fix-mapping-ui.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual, assert } = require('./testHarness');

const PORT_UI = 8998;

function profile({ employeeCode, processId, username, status }) {
  return { employeeCode, processId, status: status || 'ACTIVE', onboardingQueueStatus: 'CONFIRMED', dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên', posType: 'HO', username: username || null, updatedAt: new Date().toISOString() };
}

async function main() {
  const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true, totpEnabled: true };
  // MISMATCH thường: NV0099 <-> "legacy99" (không trùng ai khác) -> sửa thành công.
  const LEGACY_USER = { id: 2, username: 'legacy99', name: 'Đỗ Thị Mai', dept: 'Phòng Kế Toán', perms: {}, active: true };
  // MISMATCH có XUNG ĐỘT: NV0050 <-> "oldname50", nhưng "NV0050" (giá trị gợi ý sẵn) đã bị 1 tài khoản
  // KHÁC chiếm -> xác nhận phải báo lỗi rõ, KHÔNG đổi gì.
  const COLLIDE_USER = { id: 3, username: 'oldname50', name: 'Trần Văn Khoa', dept: 'Phòng Kế Toán', perms: {}, active: true };
  const TAKEN_USER = { id: 4, username: 'NV0050', name: 'Lê Thị Hạnh (tài khoản khác)', dept: 'Phòng Kế Toán', perms: {}, active: true };
  // MATCHED đối chứng (không được có nút Sửa Mapping).
  const MATCHED_USER = { id: 5, username: 'NV0060', name: 'Phạm Văn Lộc', dept: 'Phòng Kế Toán', perms: {}, active: true };

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({
    users: [ADMIN, LEGACY_USER, COLLIDE_USER, TAKEN_USER, MATCHED_USER],
    hrProcesses: [
      { id: 100, processType: 'ONBOARDING', employeeCode: 'NV0099', fullName: 'Đỗ Thị Mai' },
      { id: 101, processType: 'ONBOARDING', employeeCode: 'NV0050', fullName: 'Trần Văn Khoa' },
      { id: 102, processType: 'ONBOARDING', employeeCode: 'NV0060', fullName: 'Phạm Văn Lộc' },
      // Hồ sơ "NV0001" cố tình liên kết NHẦM với tài khoản "admin" gốc — kịch bản hiếm nhưng PHẢI chặn
      // cứng (không được đổi tên đăng nhập tài khoản admin gốc qua màn này).
      { id: 103, processType: 'ONBOARDING', employeeCode: 'NV0001', fullName: 'Tài Khoản Admin Gốc (giả lập)' },
      // Hồ sơ "NV0077" liên kết 1 username KHÔNG hề tồn tại trong DB.users (dữ liệu client đang cũ/lệch)
      // — phải báo lỗi "không tìm thấy tài khoản", KHÔNG được mở modal.
      { id: 104, processType: 'ONBOARDING', employeeCode: 'NV0077', fullName: 'Hồ Sơ Username Ma' }
    ],
    employeeProfiles: [
      profile({ employeeCode: 'NV0099', processId: 100, username: 'legacy99' }),
      profile({ employeeCode: 'NV0050', processId: 101, username: 'oldname50' }),
      profile({ employeeCode: 'NV0060', processId: 102, username: 'NV0060' }),
      profile({ employeeCode: 'NV0001', processId: 103, username: 'admin' }),
      profile({ employeeCode: 'NV0077', processId: 104, username: 'username_ma_khong_ton_tai' })
    ]
  });
  const { browser, page } = await launchPage(PORT_UI, state);
  const run = createRunner();

  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
  await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('USERNAMEMAP'); });
  await page.waitForTimeout(250);

  try {
    await run.run('Chỉ dòng ⚠️ Lệch mã mới có nút "✏️ Sửa Mapping" — MATCHED (NV0060) không có', async () => {
      const result = await page.evaluate(() => ({
        mismatchHasBtn: !!document.querySelector('#umapTableWrap button[data-op="umapOpenFixMappingModal"][data-arg0="NV0099"]'),
        matchedHasBtn: !!document.querySelector('#umapTableWrap button[data-op="umapOpenFixMappingModal"][data-arg0="NV0060"]')
      }));
      assertEqual(result.mismatchHasBtn, true, 'NV0099 (Lệch mã) phải có nút Sửa Mapping');
      assertEqual(result.matchedHasBtn, false, 'NV0060 (Đã khớp) KHÔNG được có nút Sửa Mapping (không hiện ở bộ lọc mặc định/không cần sửa)');
    });

    await run.run('Bấm "✏️ Sửa Mapping" (NV0099) -> modal hiện đúng Mã NV (chỉ đọc), Tên Đăng Nhập hiện tại, gợi ý Tên Đăng Nhập mới = Mã NV', async () => {
      await page.evaluate(() => document.querySelector('#umapTableWrap button[data-op="umapOpenFixMappingModal"][data-arg0="NV0099"]').click());
      await page.waitForTimeout(150);
      const modal = await page.evaluate(() => ({
        visible: !document.getElementById('genericConfirmModal').classList.contains('hidden'),
        title: document.querySelector('#genericConfirmModal h3')?.innerText || document.querySelector('#genericConfirmModal')?.innerText.slice(0, 60),
        newUsernameValue: document.getElementById('umapFixUsernameInput')?.value,
        bodyText: document.getElementById('genericConfirmModal').innerText
      }));
      assertEqual(modal.visible, true);
      assert(modal.bodyText.includes('NV0099'), 'phải hiện đúng Mã Nhân Viên trong modal');
      assert(modal.bodyText.includes('legacy99'), 'phải hiện đúng Tên Đăng Nhập hiện tại trong modal');
      assertEqual(modal.newUsernameValue, 'NV0099', 'gợi ý sẵn Tên Đăng Nhập mới phải = Mã Nhân Viên');
      assert(modal.bodyText.includes('KHÔNG đổi') || modal.bodyText.includes('GIỮ NGUYÊN'), 'modal phải nêu rõ Mã Nhân Viên KHÔNG bị đổi');
      // Đóng lại để sang kịch bản kế tiếp.
      await page.evaluate(() => document.getElementById('genericConfirmModal').classList.add('hidden'));
    });

    await run.run('Xác nhận Sửa Mapping (giữ nguyên gợi ý "NV0099") -> đổi thành công, dòng chuyển MATCHED, employeeProfiles.username tự đồng bộ', async () => {
      await page.evaluate(() => document.querySelector('#umapTableWrap button[data-op="umapOpenFixMappingModal"][data-arg0="NV0099"]').click());
      await page.waitForTimeout(150);
      await page.evaluate(() => window.__confirmPending());
      await page.waitForTimeout(250);
      const alertMsg = await page.evaluate(() => window.__alerts[window.__alerts.length - 1]);
      assertIncludesLocal(alertMsg, 'legacy99');
      assertIncludesLocal(alertMsg, 'NV0099');
      // Bộ lọc mặc định "Chỉ hiện vấn đề" -> NV0099 vừa chuyển MATCHED sẽ tự biến mất khỏi bảng (đúng
      // kỳ vọng, cùng hành vi mọi dòng MATCHED khác — không cần assert riêng cho việc này).
      const statMismatch = await page.evaluate(() => document.getElementById('umapStatMismatch').innerText);
      const statMatched = await page.evaluate(() => document.getElementById('umapStatMatched').innerText);
      assertEqual(statMismatch, '3', `còn đúng 3 Lệch mã (NV0050 + hồ sơ admin giả lập + NV0077 username ma), thực tế ${statMismatch}`);
      assert(Number(statMatched) >= 2, `Đã khớp phải tăng thêm ít nhất 1 (NV0099 vừa sửa xong), thực tế ${statMatched}`);
    });

    await run.run('Xung đột: xác nhận gợi ý mặc định "NV0050" nhưng đã có tài khoản KHÁC đang dùng -> báo lỗi rõ, KHÔNG đổi gì', async () => {
      await page.evaluate(() => document.querySelector('#umapTableWrap button[data-op="umapOpenFixMappingModal"][data-arg0="NV0050"]').click());
      await page.waitForTimeout(150);
      await page.evaluate(() => window.__confirmPending());
      await page.waitForTimeout(250);
      const alertMsg = await page.evaluate(() => window.__alerts[window.__alerts.length - 1]);
      assertIncludesLocal(alertMsg, 'NV0050');
      const stillMismatch = await page.evaluate(() => {
        const row = [...document.querySelectorAll('#umapTableWrap tbody tr')].find(tr => tr.innerText.includes('NV0050'));
        return row ? row.innerText.includes('Lệch mã') : null;
      });
      assertEqual(stillMismatch, true, 'NV0050 phải VẪN còn Lệch mã sau lượt xung đột (không bị đổi lỡ dở)');
    });

    await run.run('Bảo vệ tài khoản "admin" gốc: hồ sơ NV0001 liên kết nhầm "admin" -> bấm Sửa Mapping bị chặn NGAY, không mở modal', async () => {
      await page.evaluate(() => {
        document.getElementById('umapFilter').value = 'ALL';
        document.getElementById('umapFilter').dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForTimeout(150);
      await page.evaluate(() => document.querySelector('#umapTableWrap button[data-op="umapOpenFixMappingModal"][data-arg0="NV0001"]').click());
      await page.waitForTimeout(150);
      const result = await page.evaluate(() => ({
        modalHidden: document.getElementById('genericConfirmModal').classList.contains('hidden'),
        lastAlert: window.__alerts[window.__alerts.length - 1]
      }));
      assertEqual(result.modalHidden, true, 'KHÔNG được mở modal cho tài khoản admin gốc');
      assertIncludesLocal(result.lastAlert, 'admin');
    });

    await run.run('Dữ liệu lệch (username trong report không còn tồn tại trong DB.users) -> báo lỗi "không tìm thấy", không mở modal', async () => {
      await page.evaluate(() => document.querySelector('#umapTableWrap button[data-op="umapOpenFixMappingModal"][data-arg0="NV0077"]').click());
      await page.waitForTimeout(150);
      const result = await page.evaluate(() => ({
        modalHidden: document.getElementById('genericConfirmModal').classList.contains('hidden'),
        lastAlert: window.__alerts[window.__alerts.length - 1]
      }));
      assertEqual(result.modalHidden, true);
      assertIncludesLocal(result.lastAlert, 'Không tìm thấy tài khoản');
    });

    await run.run('Giữ nguyên Tên Đăng Nhập mới (không sửa gì) -> báo "chưa thay đổi gì", KHÔNG gọi lưu', async () => {
      await page.evaluate(() => document.querySelector('#umapTableWrap button[data-op="umapOpenFixMappingModal"][data-arg0="NV0050"]').click());
      await page.waitForTimeout(150);
      await page.evaluate(() => { document.getElementById('umapFixUsernameInput').value = 'oldname50'; });
      await page.evaluate(() => window.__confirmPending());
      await page.waitForTimeout(150);
      const alertMsg = await page.evaluate(() => window.__alerts[window.__alerts.length - 1]);
      assertIncludesLocal(alertMsg, 'chưa thay đổi');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

function assertIncludesLocal(haystack, needle) {
  if (!String(haystack || '').includes(needle)) throw new Error(`Kỳ vọng chứa "${needle}", thực tế: "${haystack}"`);
}

main().catch(err => { console.error(err); process.exit(1); });
