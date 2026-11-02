// tests/test-published-docs-hub-client.js — phần CLIENT của hub "📣 Tài Liệu Phát Hành" (11/2026, theo
// yêu cầu người dùng: "có thể xem được các tài liệu phát hành của công ty hoặc phòng ban khác, hiện tại
// gửi link xem được nhưng bất tiện vì người dùng có thể mất link, cho mục này thêm vào module tài liệu").
// Xem tests/test-docs-scope.js cho phần SERVER (routes/data.js loadDocsScoped() tải thêm docs published
// company-wide cho người có docViewPublished).
//
// Kiểm renderPublishedDocsHub() (module-tailieu.js):
//   1. Ẩn hẳn khối hub nếu KHÔNG có docViewPublished/admin.
//   2. Hiện khối hub + liệt kê ĐÚNG các bản ghi published === true (DB.docs đã được server lọc sẵn,
//      client chỉ lọc lại published, không tự mở rộng phạm vi).
//   3. Ô tìm kiếm lọc đúng theo mã/tên/phòng ban.
//   4. Nút "👁️ Xem Chi Tiết" gọi đúng viewDocDetails(id, id) — mở modal Chi Tiết + highlight đúng dòng.
//
// Chạy: node tests/test-published-docs-hub-client.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8998;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();
  try {
    const viewer = makeUser({ username: 'xem1', name: 'Người Xem Phát Hành', dept: 'Phòng Y', perms: { docViewPublished: true } });
    const regular = makeUser({ username: 'nv1', name: 'Nhân Viên Thường', dept: 'Phòng Y', perms: {} });
    const docs = [
      { id: 1, code: 'DOC-001', displayCode: 'DOC-001', title: 'Quy Chế Nhân Sự', dept: 'Phòng Nhân Sự', ver: 'v1.0', status: 'APPROVED', published: true, uploader: 'hr1', uploaderName: 'HR 1', createdAt: '01/11/2026', rootDocId: null, history: [] },
      { id: 2, code: 'DOC-002', displayCode: 'DOC-002', title: 'Quy Trình Mua Hàng', dept: 'Phòng Mua Hàng', ver: 'v2.0', status: 'APPROVED', published: false, uploader: 'mh1', uploaderName: 'MH 1', createdAt: '02/11/2026', rootDocId: null, history: [] },
      { id: 3, code: 'DOC-003', displayCode: 'DOC-003', title: 'Sổ Tay An Toàn', dept: 'Phòng Vận Hành', ver: 'v1.0', status: 'APPROVED', published: true, uploader: 'vh1', uploaderName: 'VH 1', createdAt: '03/11/2026', rootDocId: null, history: [] }
    ];
    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((u) => { DB.users = [u]; }, viewer);
    await page.evaluate((d) => { DB.docs = d; }, docs);
    await page.evaluate((u) => finishLogin(u), viewer);
    await page.evaluate(() => { if (typeof stopApprovalPolling === 'function') stopApprovalPolling(); });
    await page.evaluate(() => switchTab('doc'));

    await run('Người có docViewPublished: khối hub HIỆN, liệt kê ĐÚNG 2 tài liệu published (id1,id3), KHÔNG liệt kê id2 (chưa phát hành)', async () => {
      const r = await page.evaluate(() => {
        renderPublishedDocsHub();
        const wrap = document.getElementById('publishedDocsHubWrap');
        const ids = [...document.querySelectorAll('#publishedDocsHubBody button[data-op="viewDocDetails"]')].map(b => Number(b.getAttribute('data-arg0')));
        return { hidden: wrap.classList.contains('hidden'), ids: ids.sort((a, b) => a - b) };
      });
      assertEqual(r.hidden, false, 'wrap hidden');
      assert(JSON.stringify(r.ids) === JSON.stringify([1, 3]), `phải đúng [1,3], got: ${JSON.stringify(r.ids)}`);
    });

    await run('Ô tìm kiếm lọc theo tên tài liệu ("An Toàn") -> chỉ còn id3', async () => {
      await page.fill('#publishedDocsHubKeyword', 'An Toàn');
      const ids = await page.evaluate(() => {
        renderPublishedDocsHub();
        return [...document.querySelectorAll('#publishedDocsHubBody button[data-op="viewDocDetails"]')].map(b => Number(b.getAttribute('data-arg0')));
      });
      assertEqual(ids.join(','), '3', `phải chỉ còn id3, got: ${ids.join(',')}`);
      await page.fill('#publishedDocsHubKeyword', '');
    });

    await run('Ô tìm kiếm lọc theo phòng ban ("Nhân Sự") -> chỉ còn id1', async () => {
      await page.fill('#publishedDocsHubKeyword', 'Nhân Sự');
      const ids = await page.evaluate(() => {
        renderPublishedDocsHub();
        return [...document.querySelectorAll('#publishedDocsHubBody button[data-op="viewDocDetails"]')].map(b => Number(b.getAttribute('data-arg0')));
      });
      assertEqual(ids.join(','), '1', `phải chỉ còn id1, got: ${ids.join(',')}`);
      await page.fill('#publishedDocsHubKeyword', '');
    });

    await run('Nút "👁️ Xem Chi Tiết" mở modal Chi Tiết Tài Liệu đúng bản ghi (viewDocDetails(id,id))', async () => {
      const r = await page.evaluate(() => {
        renderPublishedDocsHub();
        const btn = document.querySelector('#publishedDocsHubBody button[data-op="viewDocDetails"][data-arg0="1"]');
        btn.click();
        return {
          modalHidden: document.getElementById('docDetailModal').classList.contains('hidden'),
          title: document.getElementById('docDetailTitle').innerText
        };
      });
      assertEqual(r.modalHidden, false, 'modal Chi Tiết phải mở');
      assert(r.title.includes('DOC-001'), `title phải chứa mã DOC-001, got: ${r.title}`);
      await page.evaluate(() => closeDocDetailModal());
    });

    // Đổi sang user KHÔNG có docViewPublished — đối chứng khối hub phải ẩn hẳn.
    await page.evaluate((u) => { currentUser = u; }, regular);
    await run('ĐỐI CHỨNG: người KHÔNG có docViewPublished/admin -> khối hub ẨN hẳn', async () => {
      const hidden = await page.evaluate(() => {
        renderPublishedDocsHub();
        return document.getElementById('publishedDocsHubWrap').classList.contains('hidden');
      });
      assertEqual(hidden, true, 'wrap phải ẩn cho người không có quyền');
    });

    await run('Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', () => {
      assertEqual(pageErrors.length, 0, JSON.stringify(pageErrors));
    });
  } finally {
    await teardown(server, browser);
  }
  summarize();
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
