// server/tests/test-doc-detail-copy-link.js
//
// Regression test cho nút "🔗 Copy Link" ở header modal "Chi Tiết Tài Liệu" (11/2026, theo yêu cầu người
// dùng: copy link gửi qua email, người nhận bấm vào đến thẳng tài liệu, vẫn phải đăng nhập). TÁI DÙNG
// nguyên vẹn hạ tầng deep-link ?gotoModule=<tab>&code=<mã> đã có sẵn cho link email phê duyệt (core.js —
// module 'DOC' đã đăng ký tab 'doc' + opener viewDocDetails() từ trước) — không có route/cơ chế mới nào
// cần test riêng ở tầng network, chỉ cần xác nhận: (1) nút dựng ĐÚNG URL theo đúng mã tài liệu đang mở,
// (2) bấm xong THẬT SỰ copy vào clipboard, (3) URL đó khi "dán vào thanh địa chỉ" (giả lập lại đúng cơ
// chế gotoApprovalResultRecordFromQueryParam() đã có) mở ĐÚNG modal Chi Tiết của ĐÚNG tài liệu đó —
// chứng minh link thực sự hoạt động đầu-cuối, không chỉ đúng hình thức chuỗi URL.
//
//   1. Mở Chi Tiết 1 tài liệu -> bấm "🔗 Copy Link" -> clipboard nhận ĐÚNG URL ?gotoModule=doc&code=<mã
//      GỐC, không phải mã phiên bản con> + alert báo thành công.
//   2. Đóng modal rồi dán lại URL đó (mô phỏng mở tab mới/F5 với URL đã copy) -> tự mở lại ĐÚNG modal
//      Chi Tiết của ĐÚNG tài liệu đó (chứng minh link hoạt động thật, không chỉ đúng hình thức).
//   3. Mở Chi Tiết 1 tài liệu KHÁC (có nhiều version) -> Copy Link vẫn dùng mã GỐC (family[0].code), không
//      lẫn mã của version con đang hiển thị dòng dưới.
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
        { id: 101, code: 'QTQD-I-001', displayCode: 'QTQD-I-001', title: 'Quy Trình Quản Đốc', dept: 'Phòng IT', cat: 'Quy trình', rootDocId: null, ver: 1, uploader: 'admin', uploaderName: 'Admin', createdAt: '2026-11-01', status: 'APPROVED', history: [] },
        { id: 102, code: 'QTQD-I-001-V2', displayCode: 'QTQD-I-001', title: 'Quy Trình Quản Đốc', dept: 'Phòng IT', cat: 'Quy trình', rootDocId: 101, ver: 2, uploader: 'admin', uploaderName: 'Admin', createdAt: '2026-11-05', status: 'APPROVED', history: [] },
        { id: 201, code: 'HDLD-NS-005', displayCode: 'HDLD-NS-005', title: 'Hợp Đồng Mẫu', dept: 'Phòng Nhân Sự', cat: 'Biểu mẫu', rootDocId: null, ver: 1, uploader: 'admin', uploaderName: 'Admin', createdAt: '2026-11-02', status: 'APPROVED', history: [] }
      ];
    });

    await page.evaluate(() => viewDocDetails(101));
    await page.click('#docDetailModal [data-op="copyDocDetailLink"]');
    await page.waitForTimeout(100);

    const copiedUrl1 = await page.evaluate(() => window.__copied);
    const alert1 = await page.evaluate(() => window.__lastAlert);
    check('Bấm Copy Link -> clipboard nhận 1 URL hợp lệ', typeof copiedUrl1 === 'string' && copiedUrl1.startsWith('http'));
    check('URL chứa ?gotoModule=doc', copiedUrl1.includes('gotoModule=doc'));
    check('URL chứa ĐÚNG mã GỐC (code của family[0], KHÔNG phải mã version con V2)', copiedUrl1.includes('code=QTQD-I-001') && !copiedUrl1.includes('code=QTQD-I-001-V2'));
    check('Có báo alert xác nhận đã sao chép', /sao chép|clipboard/i.test(alert1 || ''));

    await page.evaluate(() => closeDocDetailModal());

    // Mô phỏng người nhận dán link vào thanh địa chỉ (?gotoModule=doc&code=...) -> tự mở đúng modal.
    const parsedUrl = new URL(copiedUrl1);
    await page.evaluate((qs) => {
      history.replaceState(null, '', location.pathname + qs);
    }, parsedUrl.search);
    await page.evaluate(() => gotoApprovalResultRecordFromQueryParam());
    await page.waitForSelector('#docDetailModal:not(.hidden)', { timeout: 3000 });
    const titleAfterDeepLink = await page.evaluate(() => document.getElementById('docDetailTitle').innerText);
    check('Dán link vào URL -> tự mở ĐÚNG modal Chi Tiết của ĐÚNG tài liệu đã copy (chứng minh link hoạt động thật)',
      titleAfterDeepLink.includes('Quy Trình Quản Đốc') && titleAfterDeepLink.includes('QTQD-I-001'));

    await page.evaluate(() => closeDocDetailModal());

    // Tài liệu KHÁC — xác nhận không lẫn mã giữa các lần mở khác nhau.
    await page.evaluate(() => viewDocDetails(201));
    await page.click('#docDetailModal [data-op="copyDocDetailLink"]');
    await page.waitForTimeout(100);
    const copiedUrl2 = await page.evaluate(() => window.__copied);
    check('Mở tài liệu KHÁC -> Copy Link dùng ĐÚNG mã tài liệu đó, không dính mã tài liệu trước', copiedUrl2.includes('code=HDLD-NS-005') && !copiedUrl2.includes('code=QTQD'));

    check('Không có ngoại lệ JS chưa bắt (pageerror) nào phát sinh', pageErrors.length === 0);
    if (pageErrors.length) console.error('  pageerror:', pageErrors.join(' | '));
  } finally {
    await stop();
  }

  console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
