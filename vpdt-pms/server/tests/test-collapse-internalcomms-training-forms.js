// tests/test-collapse-internalcomms-training-forms.js — pattern "thu gọn form nhập" (10/2026, theo
// mẫu #mhVendorFormWrap/module-muahang.js: form ẩn sẵn + 1 nút "+ ..." để mở + nút "✕ Thu Gọn" trong
// form để đóng lại) áp dụng cho:
//   1) #internalPostForm (Nhịp Sống HCRC/Góc Chia Sẻ, module-internalcomms-nhipsong.js) — ƯU TIÊN SỐ 1
//      vì đây CHÍNH LÀ module người dùng dùng làm hình mẫu cho cả đợt việc.
//   2) #trainingClassForm (Đào Tạo > Lớp Học, module-internalcomms-daotao.js) — 1 form Đào Tạo tiêu
//      biểu đã chuyển sang pattern này.
//
// Run: node server/tests/test-collapse-internalcomms-training-forms.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8960;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    const admin = makeUser({ username: 'admin1', name: 'Quản Trị Viên', dept: 'Phòng CNTT', perms: { admin: true } });
    // staff: KHÔNG có internalNewsCreate (chặn đăng Nhịp Sống HCRC) lẫn trainingManage (chặn tạo lớp).
    const staff = makeUser({ username: 'nv.an', name: 'Nguyễn Văn An', dept: 'Phòng Nhân Sự', perms: {} });

    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((users) => { DB.users = users; }, [admin, staff]);
    await page.evaluate((u) => finishLogin(u), admin);

    // ===================== 1) #internalPostForm =====================

    await run('NEWS (Nhịp Sống HCRC): #internalPostForm ẩn mặc định, nút "+ Đăng Bài Mới" hiện (admin có quyền, không ở 3 sub-tab riêng)', async () => {
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('NEWS'); });
      const s = await page.evaluate(() => ({
        formHidden: document.getElementById('internalPostForm').classList.contains('hidden'),
        btnHidden: document.getElementById('btnInternalPostNew').classList.contains('hidden')
      }));
      assert(s.formHidden, 'Form phải ẨN mặc định ngay khi vào tab NEWS (chưa bấm nút gì)');
      assert(!s.btnHidden, 'Nút "+ Đăng Bài Mới" phải HIỆN (admin có quyền canCreateInternalPost NEWS, không ở usesOwnSection)');
    });

    await run('TRAINING/RECRUITMENT/QNA (usesOwnSection): nút "+ Đăng Bài Mới" LUÔN ẩn dù currentUser là admin (có mọi quyền)', async () => {
      for (const tab of ['TRAINING', 'RECRUITMENT', 'QNA']) {
        await page.evaluate((t) => setInternalSubTab(t), tab);
        const s = await page.evaluate(() => ({
          formHidden: document.getElementById('internalPostForm').classList.contains('hidden'),
          btnHidden: document.getElementById('btnInternalPostNew').classList.contains('hidden')
        }));
        assert(s.formHidden, `[${tab}] #internalPostForm phải vẫn ẨN (usesOwnSection dùng khối riêng)`);
        assert(s.btnHidden, `[${tab}] nút "+ Đăng Bài Mới" phải ẨN dù admin — usesOwnSection không dùng form này`);
      }
    });

    await run('NEWS: staff KHÔNG có internalNewsCreate -> nút "+ Đăng Bài Mới" ẨN + hiện ghi chú không có quyền', async () => {
      await page.evaluate((u) => { currentUser = u; }, staff);
      await page.evaluate(() => setInternalSubTab('NEWS'));
      const s = await page.evaluate(() => ({
        btnHidden: document.getElementById('btnInternalPostNew').classList.contains('hidden'),
        noPermHidden: document.getElementById('internalNoPermNote').classList.contains('hidden')
      }));
      assert(s.btnHidden, 'staff không có internalNewsCreate -> nút "+ Đăng Bài Mới" phải ẨN ở NEWS');
      assert(!s.noPermHidden, 'Phải hiện ghi chú "không có quyền đăng bài" cho staff ở NEWS');
    });

    await run('SHARE: staff KHÔNG có quyền riêng gì cũng thấy nút "+ Đăng Bài Mới" (Góc Chia Sẻ ai cũng đăng được)', async () => {
      await page.evaluate(() => setInternalSubTab('SHARE'));
      const s = await page.evaluate(() => ({
        formHidden: document.getElementById('internalPostForm').classList.contains('hidden'),
        btnHidden: document.getElementById('btnInternalPostNew').classList.contains('hidden'),
        noPermHidden: document.getElementById('internalNoPermNote').classList.contains('hidden')
      }));
      assert(s.formHidden, 'Form vẫn ẨN mặc định ở SHARE (chưa bấm nút)');
      assert(!s.btnHidden, 'canCreateInternalPost(..., "SHARE") luôn true -> nút "+ Đăng Bài Mới" phải HIỆN cho mọi người');
      assert(s.noPermHidden, 'Không được hiện ghi chú "không có quyền" ở SHARE cho staff');
      await page.evaluate((u) => { currentUser = u; }, admin); // trả lại admin cho các kịch bản sau
    });

    await run('Bấm THẬT nút "+ Đăng Bài Mới" (data-op) -> form mở; bấm "✕ Thu Gọn" -> form ẩn lại', async () => {
      await page.evaluate(() => setInternalSubTab('NEWS'));
      const beforeHidden = await page.evaluate(() => document.getElementById('internalPostForm').classList.contains('hidden'));
      assert(beforeHidden, 'Tiền đề: form phải đang ẨN trước khi bấm');

      await page.click('#btnInternalPostNew');
      const afterOpen = await page.evaluate(() => document.getElementById('internalPostForm').classList.contains('hidden'));
      assert(!afterOpen, 'Bấm "+ Đăng Bài Mới" thật (qua data-op dispatch) phải MỞ form');

      await page.click('#internalPostForm [data-op="closeInternalPostForm"]');
      const afterClose = await page.evaluate(() => document.getElementById('internalPostForm').classList.contains('hidden'));
      assert(afterClose, 'Bấm "✕ Thu Gọn" thật phải ẨN lại form');
    });

    let draftPostId = null;
    await run('Luồng Sửa bài Nháp (editInternalPostUI) TỰ MỞ form, KHÔNG cần bấm nút "+ Đăng Bài Mới"', async () => {
      draftPostId = await page.evaluate((u) => {
        const id = 970001;
        DB.internalPosts.push({
          id, type: 'NEWS', status: 'DRAFT', author: u.username, authorName: u.name, dept: u.dept,
          createdAt: '1/1/2026', code: 'TN-DRAFT-1', title: 'Bài nháp kiểm thử thu gọn form',
          content: 'nội dung nháp', postCategory: 'HOAT_DONG_CHUNG', likes: [], comments: [], readBy: []
        });
        return id;
      }, admin);
      // Đóng hẳn form trước (mô phỏng người dùng vừa Thu Gọn, hoặc vừa đổi tab) để chắc chắn bước mở
      // tiếp theo là do editInternalPostUI() tự làm, không phải "vốn đã mở sẵn từ trước".
      await page.evaluate(() => { setInternalSubTab('NEWS'); });
      const beforeHidden = await page.evaluate(() => document.getElementById('internalPostForm').classList.contains('hidden'));
      assert(beforeHidden, 'Tiền đề: form phải đang ẨN trước khi gọi editInternalPostUI()');

      await page.evaluate((id) => editInternalPostUI(id), draftPostId);
      const s = await page.evaluate(() => ({
        hidden: document.getElementById('internalPostForm').classList.contains('hidden'),
        title: document.getElementById('internalTitle').value,
        editingId: typeof editingInternalPostId !== 'undefined' ? editingInternalPostId : null
      }));
      assert(!s.hidden, 'editInternalPostUI() phải tự MỞ form (KHÔNG cần bấm nút "+ Đăng Bài Mới")');
      assertEqual(s.title, 'Bài nháp kiểm thử thu gọn form', 'Form phải nạp đúng dữ liệu bài nháp đang sửa');
      assertEqual(s.editingId, draftPostId, 'editingInternalPostId phải đúng id bài đang sửa');
    });

    await run('"✕ Thu Gọn" khi đang Sửa dở CHỈ ẩn khung (không huỷ Sửa) -> sau đó bấm "+ Đăng Bài Mới" PHẢI tự huỷ Sửa dở, không lẫn dữ liệu', async () => {
      // Tiếp nối kịch bản trên: vẫn đang mở form Sửa bài nháp (editingInternalPostId = draftPostId).
      await page.click('#internalPostForm [data-op="closeInternalPostForm"]');
      const afterCloseOnly = await page.evaluate(() => ({
        hidden: document.getElementById('internalPostForm').classList.contains('hidden'),
        editingId: editingInternalPostId
      }));
      assert(afterCloseOnly.hidden, '"✕ Thu Gọn" phải ẩn form');
      assertEqual(afterCloseOnly.editingId, draftPostId, '"✕ Thu Gọn" KHÔNG được huỷ Sửa dở (khác hẳn "Huỷ Sửa") — editingInternalPostId phải GIỮ NGUYÊN');

      await page.click('#btnInternalPostNew');
      const afterReopen = await page.evaluate(() => ({
        hidden: document.getElementById('internalPostForm').classList.contains('hidden'),
        editingId: editingInternalPostId,
        title: document.getElementById('internalTitle').value
      }));
      assert(!afterReopen.hidden, 'Bấm "+ Đăng Bài Mới" phải mở lại form');
      assertEqual(afterReopen.editingId, null, 'Bấm "+ Đăng Bài Mới" PHẢI tự huỷ phiên Sửa dở (editingInternalPostId về null) — tránh submit đè lên bài đang sửa dở');
      assertEqual(afterReopen.title, '', 'Form phải TRẮNG (không còn lẫn dữ liệu bài nháp cũ) sau khi "+ Đăng Bài Mới" tự huỷ Sửa dở');
    });

    // ===================== 2) #trainingClassForm (Đào Tạo > Lớp Học) =====================

    await run('Đào Tạo > Lớp Học: #trainingClassForm ẩn mặc định khi vào tab CLASSES, nút "+ Tạo Lớp Mới" hiện (admin có trainingManage)', async () => {
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('CLASSES'); });
      const s = await page.evaluate(() => ({
        formHidden: document.getElementById('trainingClassForm').classList.contains('hidden'),
        btnHidden: document.getElementById('btnTrainingClassNew').classList.contains('hidden')
      }));
      assert(s.formHidden, '#trainingClassForm phải ẨN mặc định ngay khi vào tab CLASSES');
      assert(!s.btnHidden, 'Nút "+ Tạo Lớp Mới" phải HIỆN (admin có trainingManage)');
    });

    await run('Đào Tạo > Lớp Học: staff KHÔNG có trainingManage -> nút "+ Tạo Lớp Mới" ẨN + hiện ghi chú không có quyền', async () => {
      await page.evaluate((u) => { currentUser = u; }, staff);
      await page.evaluate(() => setTrainingLmsTab('CLASSES'));
      const s = await page.evaluate(() => ({
        btnHidden: document.getElementById('btnTrainingClassNew').classList.contains('hidden'),
        noPermHidden: document.getElementById('trainingClassNoPermNote').classList.contains('hidden')
      }));
      assert(s.btnHidden, 'staff không có trainingManage -> nút "+ Tạo Lớp Mới" phải ẨN');
      assert(!s.noPermHidden, 'Phải hiện ghi chú "không có quyền tạo lớp học" cho staff');
      await page.evaluate((u) => { currentUser = u; }, admin);
      await page.evaluate(() => setTrainingLmsTab('CLASSES'));
    });

    await run('Bấm THẬT nút "+ Tạo Lớp Mới" (data-op) -> form mở; bấm "✕ Thu Gọn" -> form ẩn lại', async () => {
      const beforeHidden = await page.evaluate(() => document.getElementById('trainingClassForm').classList.contains('hidden'));
      assert(beforeHidden, 'Tiền đề: form phải đang ẨN trước khi bấm');

      await page.click('#btnTrainingClassNew');
      const afterOpen = await page.evaluate(() => document.getElementById('trainingClassForm').classList.contains('hidden'));
      assert(!afterOpen, 'Bấm "+ Tạo Lớp Mới" thật (qua data-op dispatch) phải MỞ form');

      await page.click('#trainingClassForm [data-op="closeTrainingClassForm"]');
      const afterClose = await page.evaluate(() => document.getElementById('trainingClassForm').classList.contains('hidden'));
      assert(afterClose, 'Bấm "✕ Thu Gọn" thật phải ẨN lại form');
    });

    await run('Đổi tab LMS (CLASSES -> COURSES -> CLASSES) luôn thu gọn lại #trainingClassForm (nav = ẩn mặc định, không nhớ trạng thái đang mở)', async () => {
      await page.click('#btnTrainingClassNew');
      const openedBeforeNav = await page.evaluate(() => document.getElementById('trainingClassForm').classList.contains('hidden'));
      assert(!openedBeforeNav, 'Tiền đề: form phải đang MỞ trước khi đổi tab');

      await page.evaluate(() => setTrainingLmsTab('COURSES'));
      await page.evaluate(() => setTrainingLmsTab('CLASSES'));
      const afterNavBack = await page.evaluate(() => document.getElementById('trainingClassForm').classList.contains('hidden'));
      assert(afterNavBack, 'Quay lại tab CLASSES phải thấy form ẨN lại từ đầu, không giữ trạng thái đang mở trước đó');
    });

    assertEqual(pageErrors.length, 0, `unexpected uncaught page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-collapse-internalcomms-training-forms.js');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
