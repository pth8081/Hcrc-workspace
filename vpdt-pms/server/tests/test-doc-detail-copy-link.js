// server/tests/test-doc-detail-copy-link.js
//
// Regression test cho nút "🔗" Copy Link THEO TỪNG PHIÊN BẢN tài liệu (11/2026, theo yêu cầu người
// dùng, sau khi xem demo 1 tài liệu có NHIỀU phiên bản cùng "Đã Phát Hành" đồng thời — VD v1.0 và
// v3.0 — và chỉ ra "để copy link ở modal như kia sẽ không giải quyết vấn đề, cần để copy link chỗ
// thao tác tại mỗi tài liệu phát hành"): THIẾT KẾ LẠI hoàn toàn so với bản cũ (nút Copy Link DUY NHẤT
// ở header modal, dùng mã GỐC chung cho cả family — không phân biệt được đang chia sẻ đúng phiên bản
// nào). Giờ MỖI dòng phiên bản trong bảng lịch sử có nút "🔗" RIÊNG (data-op="copyDocVersionLink"),
// dùng ĐÚNG mã của phiên bản đó (v.code, không phải displayCode/mã gốc dùng chung cho cả family).
//
// TÁI DÙNG hạ tầng deep-link ?gotoModule=<tab>&code=<mã> đã có sẵn cho link email phê duyệt (core.js)
// + CỘNG THÊM cờ `openView=1` để báo "đây là link chia sẻ 1 phiên bản cụ thể" — khi người nhận bấm
// vào, hệ thống KHÔNG CHỈ mở modal "Chi Tiết Tài Liệu" (xem cả family) mà còn tự cuộn tới + chớp sáng
// ĐÚNG dòng phiên bản đó, RỒI TỰ MỞ LUÔN màn xem nội dung "👁️ Xem" của đúng phiên bản (người dùng xác
// nhận: "mở luôn vào xem" — không bắt người nhận tự bấm thêm lần nữa).
//
//   1. Mở Chi Tiết 1 tài liệu có 2 phiên bản -> bấm "🔗" ở dòng phiên bản 2 (v2, id=102) -> clipboard
//      nhận ĐÚNG URL ?gotoModule=doc&code=<mã CỦA v2, KHÔNG phải mã gốc v1> + openView=1 + alert báo
//      thành công.
//   2. Đóng modal rồi dán lại URL đó (mô phỏng mở tab mới/F5 với URL đã copy) -> tự mở ĐÚNG modal Chi
//      Tiết của ĐÚNG tài liệu đó, cuộn/chớp sáng ĐÚNG dòng phiên bản 2, VÀ tự mở luôn modal xem nội
//      dung (#viewDocModal) của đúng phiên bản 2 — không bắt bấm thêm.
//   3. Mở Chi Tiết 1 tài liệu KHÁC, bấm "🔗" ở dòng version 1 duy nhất -> vẫn dùng đúng mã của chính
//      phiên bản đó, không lẫn mã tài liệu trước.
//   4. Link email phê duyệt THƯỜNG (không có openView=1) vẫn giữ nguyên hành vi cũ — chỉ mở modal Chi
//      Tiết, KHÔNG tự mở #viewDocModal (đối chứng — không được đổi hành vi link email phê duyệt sẵn có).
//
// Chạy: node server/tests/test-doc-detail-copy-link.js
'use strict';
const { startHarness } = require('./_harness-contract');

let passed = 0, failed = 0;
function check(label, cond) { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.log(`  ❌ ${label}`); failed++; } }

async function main() {
  const h = await startHarness();
  const { page, loginAs, stop } = h;
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  try {
    await loginAs('admin');

    await page.evaluate(() => {
      window.__copied = null;
      window.__lastAlert = null;
      navigator.clipboard.writeText = (text) => { window.__copied = text; return Promise.resolve(); };
      window.alert = (msg) => { window.__lastAlert = msg; };
      DB.docs = [
        { id: 101, code: 'QTQD-I-001', displayCode: 'QTQD-I-001', title: 'Quy Trình Quản Đốc', dept: 'Phòng IT', cat: 'Quy trình', rootDocId: null, ver: 1, uploader: 'admin', uploaderName: 'Admin', createdAt: '2026-11-01', status: 'APPROVED', published: true, history: [] },
        { id: 102, code: 'QTQD-I-001-V2', displayCode: 'QTQD-I-001', title: 'Quy Trình Quản Đốc', dept: 'Phòng IT', cat: 'Quy trình', rootDocId: 101, ver: 2, uploader: 'admin', uploaderName: 'Admin', createdAt: '2026-11-05', status: 'APPROVED', published: true, history: [] },
        { id: 201, code: 'HDLD-NS-005', displayCode: 'HDLD-NS-005', title: 'Hợp Đồng Mẫu', dept: 'Phòng Nhân Sự', cat: 'Biểu mẫu', rootDocId: null, ver: 1, uploader: 'admin', uploaderName: 'Admin', createdAt: '2026-11-02', status: 'APPROVED', published: true, history: [] }
      ];
    });

    await page.evaluate(() => viewDocDetails(101));
    await page.click('#docDetailBody tr[data-version-row="102"] [data-op="copyDocVersionLink"]');
    await page.waitForTimeout(100);

    const copiedUrl1 = await page.evaluate(() => window.__copied);
    const alert1 = await page.evaluate(() => window.__lastAlert);
    check('Bấm "🔗" ở dòng v2 -> clipboard nhận 1 URL hợp lệ', typeof copiedUrl1 === 'string' && copiedUrl1.startsWith('http'));
    check('URL chứa ?gotoModule=doc', copiedUrl1.includes('gotoModule=doc'));
    check('URL chứa ĐÚNG mã của PHIÊN BẢN v2 (QTQD-I-001-V2), không phải mã gốc v1', copiedUrl1.includes('code=QTQD-I-001-V2'));
    check('URL có cờ openView=1 (báo "mở luôn vào xem")', copiedUrl1.includes('openView=1'));
    check('Có báo alert xác nhận đã sao chép', /sao chép|clipboard/i.test(alert1 || ''));

    await page.evaluate(() => closeDocDetailModal());

    // Mô phỏng người nhận dán link vào thanh địa chỉ -> tự mở đúng modal Chi Tiết + cuộn/chớp sáng
    // đúng dòng v2 + tự mở LUÔN modal xem nội dung (#viewDocModal) của đúng v2.
    const parsedUrl1 = new URL(copiedUrl1);
    await page.evaluate((qs) => { history.replaceState(null, '', location.pathname + qs); }, parsedUrl1.search);
    await page.evaluate(() => gotoApprovalResultRecordFromQueryParam());
    await page.waitForSelector('#docDetailModal:not(.hidden)', { timeout: 3000 });
    const titleAfterDeepLink = await page.evaluate(() => document.getElementById('docDetailTitle').innerText);
    check('Dán link v2 -> tự mở ĐÚNG modal Chi Tiết của ĐÚNG tài liệu (family)',
      titleAfterDeepLink.includes('Quy Trình Quản Đốc'));
    const rowHighlighted = await page.evaluate(() =>
      document.querySelector('#docDetailBody tr[data-version-row="102"]')?.classList.contains('doc-version-row-highlight'));
    check('Dòng phiên bản v2 (đúng phiên bản đã share) được chớp sáng (class doc-version-row-highlight)', rowHighlighted === true);
    const rowV1NotHighlighted = await page.evaluate(() =>
      document.querySelector('#docDetailBody tr[data-version-row="101"]')?.classList.contains('doc-version-row-highlight'));
    check('Dòng phiên bản v1 (KHÔNG phải phiên bản đã share) KHÔNG bị chớp sáng', rowV1NotHighlighted === false);
    await page.waitForSelector('#viewDocModal:not(.hidden)', { timeout: 3000 });
    const viewModalTitle = await page.evaluate(() => document.getElementById('viewModalContent')?.innerText || '');
    check('openView=1 -> TỰ MỞ LUÔN modal xem nội dung (#viewDocModal), không bắt bấm "👁️ Xem" thêm',
      (await page.evaluate(() => !document.getElementById('viewDocModal').classList.contains('hidden'))));

    await page.evaluate(() => { closeViewDocModal(); closeDocDetailModal(); });

    // Tài liệu KHÁC — xác nhận không lẫn mã giữa các lần mở khác nhau.
    await page.evaluate(() => viewDocDetails(201));
    await page.click('#docDetailBody tr[data-version-row="201"] [data-op="copyDocVersionLink"]');
    await page.waitForTimeout(100);
    const copiedUrl2 = await page.evaluate(() => window.__copied);
    check('Mở tài liệu KHÁC -> Copy Link dùng ĐÚNG mã phiên bản đó, không dính mã tài liệu trước', copiedUrl2.includes('code=HDLD-NS-005') && !copiedUrl2.includes('code=QTQD'));

    await page.evaluate(() => closeDocDetailModal());

    // Đối chứng: link email phê duyệt THƯỜNG (không openView) chỉ mở modal Chi Tiết, KHÔNG tự mở
    // #viewDocModal — hành vi cũ giữ nguyên, không bị đợt vá này làm ảnh hưởng.
    await page.evaluate(() => { history.replaceState(null, '', location.pathname + '?gotoModule=doc&code=QTQD-I-001'); });
    await page.evaluate(() => gotoApprovalResultRecordFromQueryParam());
    await page.waitForSelector('#docDetailModal:not(.hidden)', { timeout: 3000 });
    const viewModalHiddenStill = await page.evaluate(() => document.getElementById('viewDocModal').classList.contains('hidden'));
    check('Link email phê duyệt THƯỜNG (không openView) -> KHÔNG tự mở #viewDocModal (giữ nguyên hành vi cũ)', viewModalHiddenStill === true);

    check('Không có ngoại lệ JS chưa bắt (pageerror) nào phát sinh', pageErrors.length === 0);
    if (pageErrors.length) console.error('  pageerror:', pageErrors.join(' | '));
  } finally {
    await stop();
  }

  console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
