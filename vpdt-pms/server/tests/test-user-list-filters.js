// server/tests/test-user-list-filters.js
//
// Regression cho đợt vá (11/2026, theo yêu cầu người dùng ở màn Hệ Thống > Quản Trị > "Danh Sách Người
// Dùng & Quyền Hạn") — thêm 2 nhóm bộ lọc MỚI (renderUsers(), module-admin-userstaging.js):
//
// 1) "🔍 Lọc hồ sơ thiếu thông tin" — 4 checkbox (filterUserMissingDept/JobTitle/Email/PosType), tick
//    NHIỀU ô gộp kiểu OR (hiện người dùng thiếu BẤT KỲ mục nào đã tick). Xác nhận riêng của người dùng:
//    "Chưa gắn Chức Danh" áp dụng CHO CẢ tài khoản Siêu Thị (posType=STORE), không miễn trừ dù hệ thống ở
//    chỗ khác (VD applyOperationOrderPoLock()) coi Siêu Thị thiếu Chức Danh là bình thường.
// 2) "🏷️ Chỉ hiện tài khoản ĐANG có Chức Danh Kiêm Nhiệm" (filterUserHasSecondaryPositions) — checkbox
//    đơn (KHÔNG phải ô gõ tìm kiếm — người dùng đã từ chối phương án ô tìm kiếm ở demo trước), tick là
//    hiện NGAY tài khoản có secondaryPositions.length>0, dùng chung 1 field cho CẢ 2 nguồn (đồng bộ từ Hồ
//    Sơ Nhân Sự khi tài khoản đã liên kết, hoặc admin gán thủ công khi chưa liên kết) — badge trên mỗi
//    dòng còn ghi rõ nguồn gốc (dựa vào _hrLinkedUsernamesCache, GET /api/hr-profile/linked-usernames).
//
// Chạy: node server/tests/test-user-list-filters.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual, assert } = require('./testHarness');

const PORT_UI = 8994;

async function main() {
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', jobTitle: 'Quản Trị Viên', email: 'admin@x.com', posType: 'HO', perms: { admin: true }, totpEnabled: true, active: true };

  const users = [
    ADMIN,
    { username: 'u1full', name: 'Đầy Đủ', dept: 'Phòng A', jobTitle: 'Nhân Viên', email: 'u1@x.com', posType: 'HO', perms: {} },
    { username: 'u2nodept', name: 'Thiếu Phòng Ban', dept: '', jobTitle: 'Nhân Viên', email: 'u2@x.com', posType: 'HO', perms: {} },
    { username: 'u3noemail', name: 'Thiếu Email', dept: 'Phòng B', jobTitle: 'Nhân Viên', email: '', posType: 'STORE', perms: {} },
    { username: 'u4storenojob', name: 'Siêu Thị Thiếu Chức Danh', dept: 'Siêu Thị 1', jobTitle: '', email: 'u4@x.com', posType: 'STORE', perms: {} },
    { username: 'u5noPosType', name: 'Thiếu Vị Trí', dept: 'Phòng C', jobTitle: 'Nhân Viên', email: 'u5@x.com', posType: '', perms: {} },
    { username: 'u6secondaryhr', name: 'Kiêm Nhiệm Từ Nhân Sự', dept: 'Phòng D', jobTitle: 'Nhân Viên', email: 'u6@x.com', posType: 'HO', perms: {}, secondaryPositions: [{ jobTitle: 'Thẩm Định FMCG', dept: 'Phòng Thu Mua' }] },
    { username: 'u7secondarymanual', name: 'Kiêm Nhiệm Gán Thủ Công', dept: 'Phòng E', jobTitle: 'Nhân Viên', email: 'u7@x.com', posType: 'HO', perms: {}, secondaryPositions: [{ jobTitle: 'Thẩm Định B', dept: 'Phòng F' }] }
  ];

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({ users, employeeProfiles: [{ username: 'u6secondaryhr', employeeCode: 'NV001' }] });
  const { browser, page } = await launchPage(PORT_UI, state);
  const run = createRunner();

  const rowUsernames = async () => page.evaluate(() =>
    Array.from(document.querySelectorAll('#userTableBody tr')).map(tr => tr.querySelector('td')?.textContent || '')
  );
  const setCheckbox = (id, checked) => page.evaluate(({ id, checked }) => {
    const el = document.getElementById(id);
    el.checked = checked;
    onUserFilterChange();
  }, { id, checked });
  // resetAllFilters() — đặt lại TOÀN BỘ checkbox lọc về false TRƯỚC mỗi kịch bản (không dựa vào dọn dẹp ở
  // cuối kịch bản trước, vì 1 assertEqual ném lỗi giữa chừng sẽ bỏ qua luôn các lệnh uncheck phía sau nó,
  // kéo theo trạng thái sai lan sang các kịch bản sau — lỗi gặp thực tế khi viết test này).
  const ALL_FILTER_IDS = ['filterUserMustChangeOnly', 'filterUserHasSecondaryPositions', 'filterUserMissingDept', 'filterUserMissingJobTitle', 'filterUserMissingEmail', 'filterUserMissingPosType'];
  const resetAllFilters = () => page.evaluate((ids) => {
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
    onUserFilterChange();
  }, ALL_FILTER_IDS);

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); });
    await page.waitForTimeout(250); // cho prefetch _hrLinkedUsernamesCache kịp resolve + tự renderUsers() lại

    await run.run('Mặc định (không tick gì) -> hiện ĐỦ cả 8 tài khoản', async () => {
      await resetAllFilters();
      const names = await rowUsernames();
      assertEqual(names.length, 8, `phải có 8 dòng, thực tế ${names.length}`);
    });

    await run.run('Tick "Chưa gắn Phòng Ban/Siêu Thị" -> CHỈ hiện u2nodept', async () => {
      await resetAllFilters();
      await setCheckbox('filterUserMissingDept', true);
      const names = await rowUsernames();
      assertEqual(names.length, 1, `phải đúng 1 dòng, thực tế ${names.length} (${names.join(',')})`);
      assert(names[0].includes('u2nodept'), `phải là u2nodept, thực tế "${names[0]}"`);
      const badgeText = await page.evaluate(() => document.querySelector('#userTableBody tr td')?.textContent || '');
      assert(badgeText.includes('Thiếu Phòng Ban/Siêu Thị'), 'phải hiện badge "Thiếu Phòng Ban/Siêu Thị"');
      await setCheckbox('filterUserMissingDept', false);
    });

    await run.run('Tick "Chưa gắn Email" -> CHỈ hiện u3noemail', async () => {
      await resetAllFilters();
      await setCheckbox('filterUserMissingEmail', true);
      const names = await rowUsernames();
      assertEqual(names.length, 1, `phải đúng 1 dòng, thực tế ${names.length}`);
      assert(names[0].includes('u3noemail'), `phải là u3noemail, thực tế "${names[0]}"`);
    });

    await run.run('XÁC NHẬN RIÊNG CỦA NGƯỜI DÙNG: Tick "Chưa gắn Chức Danh" -> VẪN hiện tài khoản Siêu Thị thiếu Chức Danh (u4storenojob), không miễn trừ', async () => {
      await resetAllFilters();
      await setCheckbox('filterUserMissingJobTitle', true);
      const names = await rowUsernames();
      assertEqual(names.length, 1, `phải đúng 1 dòng, thực tế ${names.length}`);
      assert(names[0].includes('u4storenojob'), `phải là u4storenojob (Siêu Thị), thực tế "${names[0]}"`);
    });

    await run.run('Tick "Chưa gắn Vị Trí (HO/Siêu Thị)" -> CHỈ hiện u5noPosType', async () => {
      await resetAllFilters();
      await setCheckbox('filterUserMissingPosType', true);
      const names = await rowUsernames();
      assertEqual(names.length, 1, `phải đúng 1 dòng, thực tế ${names.length}`);
      assert(names[0].includes('u5noPosType'), `phải là u5noPosType, thực tế "${names[0]}"`);
    });

    await run.run('GỘP OR: tick CẢ "Chưa gắn Phòng Ban" + "Chưa gắn Email" -> hiện ĐÚNG 2 người (hợp, không phải giao)', async () => {
      await resetAllFilters();
      await setCheckbox('filterUserMissingDept', true);
      await setCheckbox('filterUserMissingEmail', true);
      const names = await rowUsernames();
      assertEqual(names.length, 2, `phải đúng 2 dòng (OR), thực tế ${names.length} (${names.join(' | ')})`);
      assert(names.some(n => n.includes('u2nodept')), 'phải có u2nodept (thiếu Phòng Ban)');
      assert(names.some(n => n.includes('u3noemail')), 'phải có u3noemail (thiếu Email)');
    });

    await run.run('Tick "🏷️ Chỉ hiện tài khoản ĐANG có Chức Danh Kiêm Nhiệm" -> CHỈ hiện 2 người (u6/u7), badge đúng chức danh+phòng ban', async () => {
      await resetAllFilters();
      await setCheckbox('filterUserHasSecondaryPositions', true);
      const names = await rowUsernames();
      assertEqual(names.length, 2, `phải đúng 2 dòng, thực tế ${names.length} (${names.join(' | ')})`);
      assert(names.some(n => n.includes('u6secondaryhr')), 'phải có u6secondaryhr');
      assert(names.some(n => n.includes('u7secondarymanual')), 'phải có u7secondarymanual');
      const fullText = await page.evaluate(() => document.getElementById('userTableBody').textContent);
      assert(fullText.includes('Thẩm Định FMCG') && fullText.includes('Phòng Thu Mua'), 'phải hiện đúng chức danh+phòng ban kiêm nhiệm của u6');
      assert(fullText.includes('Thẩm Định B') && fullText.includes('Phòng F'), 'phải hiện đúng chức danh+phòng ban kiêm nhiệm của u7');
    });

    await run.run('Badge nguồn gốc ĐÚNG: u6 (đã liên kết Hồ Sơ Nhân Sự) -> "Hồ Sơ Nhân Sự"; u7 (chưa liên kết) -> "gán thủ công"', async () => {
      await resetAllFilters();
      await setCheckbox('filterUserHasSecondaryPositions', true);
      const result = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('#userTableBody tr'));
        const find = (uname) => rows.find(tr => (tr.querySelector('td')?.textContent || '').includes(uname));
        const u6row = find('u6secondaryhr');
        const u7row = find('u7secondarymanual');
        return { u6text: u6row ? u6row.textContent : '', u7text: u7row ? u7row.textContent : '' };
      });
      assert(result.u6text.includes('Hồ Sơ Nhân Sự'), `u6 phải ghi nguồn "Hồ Sơ Nhân Sự", thực tế: ${result.u6text}`);
      assert(result.u7text.includes('gán thủ công'), `u7 phải ghi nguồn "gán thủ công", thực tế: ${result.u7text}`);
    });

    await run.run('Bỏ tick hết -> quay lại ĐỦ 8 tài khoản (không còn lọc gì)', async () => {
      await resetAllFilters();
      const names = await rowUsernames();
      assertEqual(names.length, 8, `phải quay lại đủ 8 dòng, thực tế ${names.length}`);
    });

    await run.run('ĐỐI CHỨNG: không tick "Chưa gắn Chức Danh" -> KHÔNG hiện BADGE thiếu Chức Danh (dù u4 vẫn thiếu thật, và tên hiển thị "...Thiếu Chức Danh" của fixture test vẫn còn đó) — badge (có tiền tố "⚠️ 💼") chỉ hiện khi filter đang bật', async () => {
      await resetAllFilters();
      const fullText = await page.evaluate(() => document.getElementById('userTableBody').textContent);
      // So khớp ĐÚNG chuỗi badge thật ("⚠️ 💼 Thiếu Chức Danh") thay vì bare "Thiếu Chức Danh" — fixture
      // u4storenojob cố ý đặt name="Siêu Thị Thiếu Chức Danh" (mô tả tình huống test) nên bare-substring
      // SẼ LUÔN khớp false-positive vào cột Họ Tên dù badge có hiện hay không.
      assert(!fullText.includes('⚠️ 💼 Thiếu Chức Danh'), 'không được hiện badge "⚠️ 💼 Thiếu Chức Danh" khi checkbox tương ứng đang tắt');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
