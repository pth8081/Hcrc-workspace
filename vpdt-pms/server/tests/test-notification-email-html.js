// server/tests/test-notification-email-html.js
//
// Regression test cho BẢN HTML CHUYÊN NGHIỆP đi kèm MỌI thông báo email (11/2026, theo yêu cầu người
// dùng: "thiết kế 1 mẫu chuyên nghiệp áp dụng cho TẤT CẢ thông báo của hệ thống, không chỉ family 'Cần
// phê duyệt'") — xem EMAIL_STATUS_THEME/ACTION_TYPE_EMAIL_META/buildNotificationEmailHtml()/
// renderApprovalNeededEmailBodyHtml()/renderPlainEmailBodyHtml() + LAST_APPROVAL_NEEDED_OPTS ở core.js.
//
//   (A) buildNotificationEmailHtml(): khung chung đúng màu theo status, badge, ẩn/hiện nút CTA.
//   (B) notifyRecipientsByEmail() family 'approvalNeeded' -> html dựng BẢNG cấu trúc từ
//       LAST_APPROVAL_NEEDED_OPTS (không parse lại bodyText), đúng actionType -> đúng màu/badge.
//   (C) notifyRecipientsByEmail() family KHÁC (VD 'result'/NOTIFY_APPROVED) -> html dùng đoạn văn
//       thường (escape + <br>) từ CHÍNH bodyText, KHÔNG còn bảng của lượt gọi approvalNeeded trước đó
//       (LAST_APPROVAL_NEEDED_OPTS phải được reset ngay, không rò sang lượt gọi không liên quan).
//   (D) dispatchRealEmail() nhận đúng tham số thứ 5 (html) và forward vào body JSON gửi /api/send-email.
//   (E) escapeHtml() áp dụng cho bodyText tự do -> chống XSS khi nội dung chứa ký tự HTML.
//
// Chạy: node server/tests/test-notification-email-html.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual, assertIncludes } = require('./testHarness');

const PORT_UI = 8996;

async function main() {
  const REPORTER = { username: 'nv1', name: 'Nguyễn Văn A', dept: 'Phòng Kinh Doanh', perms: {}, active: true, email: 'a@x.com' };
  const APPROVER1 = { username: 'tp1', name: 'Trần Thị B', dept: 'Phòng Kinh Doanh', perms: {}, active: true, email: 'b@x.com' };

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({ users: [REPORTER, APPROVER1] });
  const { browser, page } = await launchPage(PORT_UI, state);
  const run = createRunner();

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, REPORTER);

    await run.run('buildNotificationEmailHtml(): status "warning" -> đúng màu accent/badge, có nút CTA khi có ctaUrl', async () => {
      const html = await page.evaluate(() => buildNotificationEmailHtml({
        status: 'warning', badge: '⚠️ Test Badge', bodyRowsHtml: '<tr><td>Nội dung</td></tr>',
        ctaUrl: 'https://example.com/x', ctaText: 'Xem Ngay'
      }));
      assertIncludes(html, '#d97706', 'Status warning phải dùng đúng màu accent #d97706');
      assertIncludes(html, '⚠️ Test Badge', 'Phải hiện đúng text badge truyền vào');
      assertIncludes(html, 'href="https://example.com/x"', 'Có ctaUrl -> phải hiện nút với đúng href');
      assertIncludes(html, 'Xem Ngay', 'Phải hiện đúng ctaText');
      assertIncludes(html, 'HCRC WORKSPACE', 'Phải có wordmark thương hiệu ở header');
      assertIncludes(html, 'Đây là email tự động', 'Phải có dòng chữ ký tự động ở footer');
    });

    await run.run('buildNotificationEmailHtml(): KHÔNG có ctaUrl -> ẩn hẳn nút CTA (không hiện href="" vô nghĩa)', async () => {
      const html = await page.evaluate(() => buildNotificationEmailHtml({
        status: 'info', badge: '🔔 Thông báo', bodyRowsHtml: '<tr><td>Nội dung</td></tr>', ctaUrl: ''
      }));
      assertEqual(html.includes('<a href='), false, 'ctaUrl rỗng thì không được render thẻ <a> nút CTA nào');
    });

    await run.run('notifyRecipientsByEmail() family approvalNeeded: html dựng BẢNG đúng dữ liệu LAST_APPROVAL_NEEDED_OPTS', async () => {
      const result = await page.evaluate(() => {
        const bodyText = buildApprovalNeededEmailBody({
          ticketType: 'Đăng Ký Xe', ticketNumber: 'XE-100', summary: 'Đi công tác Đà Nẵng',
          creatorName: 'Nguyễn Văn A', creatorDept: 'Phòng Kinh Doanh', createdAt: '01/11/2026 09:00:00',
          stepName: 'Bước 1', deadline: '05/11/2026', urgency: 'Gấp'
        });
        let capturedHtml = null;
        const original = window.dispatchRealEmail;
        window.dispatchRealEmail = (recipients, subject, text, context, html) => { capturedHtml = html; };
        notifyRecipientsByEmail('CAR', 'NOTIFY_APPROVAL_NEEDED', 'XE-100', [{ username: 'tp1', name: 'Trần Thị B', email: 'b@x.com' }], 'Chủ đề', bodyText);
        window.dispatchRealEmail = original;
        return capturedHtml;
      });
      assertEqual(typeof result, 'string', 'Phải gọi dispatchRealEmail() với tham số thứ 5 là chuỗi HTML');
      assertIncludes(result, '⏳ Cần phê duyệt', 'actionType NOTIFY_APPROVAL_NEEDED -> đúng badge');
      assertIncludes(result, '#2563eb', 'family approvalNeeded -> status info -> đúng màu accent #2563eb');
      assertIncludes(result, 'Đăng Ký Xe', 'Bảng phải có đúng giá trị Loại phiếu từ opts gốc');
      assertIncludes(result, 'XE-100', 'Bảng phải có đúng giá trị Số phiếu từ opts gốc');
      assertIncludes(result, 'Đi công tác Đà Nẵng', 'Bảng phải có đúng giá trị Trích yếu từ opts gốc');
      assertIncludes(result, 'Gấp', 'Bảng phải có đúng giá trị Mức độ từ opts gốc');
      assertIncludes(result, 'Loại phiếu', 'family approvalNeeded phải render bằng bảng cấu trúc "Loại phiếu/Số phiếu/...", không phải đoạn văn thường');
    });

    await run.run('notifyRecipientsByEmail() family result (NOTIFY_APPROVED): html dùng đoạn văn thường từ bodyText, KHÔNG còn bảng cũ (LAST_APPROVAL_NEEDED_OPTS đã reset)', async () => {
      const result = await page.evaluate(() => {
        // Gọi 1 lượt approvalNeeded TRƯỚC để set LAST_APPROVAL_NEEDED_OPTS, rồi gọi lượt KHÔNG liên quan
        // ngay sau đó -> phải KHÔNG rò dữ liệu bảng của lượt trước sang lượt này.
        const approvalBody = buildApprovalNeededEmailBody({
          ticketType: 'Đăng Ký Xe', ticketNumber: 'XE-101', summary: 'Không liên quan',
          creatorName: 'A', creatorDept: 'KD', createdAt: '01/11/2026', stepName: 'Bước 1'
        });
        const originalDispatch = window.dispatchRealEmail;
        window.dispatchRealEmail = () => {};
        notifyRecipientsByEmail('CAR', 'NOTIFY_APPROVAL_NEEDED', 'XE-101', [{ username: 'tp1', name: 'Trần Thị B', email: 'b@x.com' }], 'Chủ đề', approvalBody);

        let capturedHtml = null;
        window.dispatchRealEmail = (recipients, subject, text, context, html) => { capturedHtml = html; };
        notifyRecipientsByEmail('CAR', 'NOTIFY_APPROVED', 'XE-102', [{ username: 'nv1', name: 'Nguyễn Văn A', email: 'a@x.com' }], 'Chủ đề', 'Đăng ký xe XE-102 đã được duyệt.');
        window.dispatchRealEmail = originalDispatch;
        return capturedHtml;
      });
      assertIncludes(result, '✅ Đã duyệt', 'actionType NOTIFY_APPROVED -> đúng badge');
      assertIncludes(result, '#16a34a', 'family result/NOTIFY_APPROVED -> status success -> đúng màu accent #16a34a');
      assertIncludes(result, 'Đăng ký xe XE-102 đã được duyệt', 'Phải hiện đúng bodyText tự do (đoạn văn thường)');
      assertEqual(result.includes('Loại phiếu'), false, 'KHÔNG được còn sót bảng cấu trúc "Loại phiếu/Số phiếu/..." của lượt approvalNeeded TRƯỚC đó (LAST_APPROVAL_NEEDED_OPTS phải reset)');
      assertEqual(result.includes('XE-101'), false, 'KHÔNG được rò dữ liệu phiếu XE-101 (lượt gọi trước, không liên quan) sang email này');
    });

    await run.run('notifyRecipientsByEmail(): escapeHtml() chống XSS cho bodyText tự do', async () => {
      const result = await page.evaluate(() => {
        let capturedHtml = null;
        const original = window.dispatchRealEmail;
        window.dispatchRealEmail = (recipients, subject, text, context, html) => { capturedHtml = html; };
        notifyRecipientsByEmail('CAR', 'NOTIFY_APPROVED', 'XE-103', [{ username: 'nv1', name: 'Nguyễn Văn A', email: 'a@x.com' }], 'Chủ đề', 'Nội dung <script>alert(1)</script> & "trích dẫn"');
        window.dispatchRealEmail = original;
        return capturedHtml;
      });
      assertEqual(result.includes('<script>alert(1)</script>'), false, 'KHÔNG được chèn thẳng <script> chưa escape vào HTML email');
      assertIncludes(result, '&lt;script&gt;', 'Phải escape đúng thẻ <script> thành &lt;script&gt;');
      assertIncludes(result, '&amp;', 'Phải escape dấu & thành &amp;');
    });

    await run.run('dispatchRealEmail(): forward đúng html vào body JSON gửi /api/send-email', async () => {
      const captured = await page.evaluate(() => {
        return new Promise((resolve) => {
          const originalFetch = window.fetch;
          window.fetch = (url, opts) => {
            window.fetch = originalFetch;
            resolve({ url, body: JSON.parse(opts.body) });
            return Promise.resolve({ json: async () => ({ simulated: true }) });
          };
          dispatchRealEmail([{ email: 'x@x.com', name: 'X' }], 'Chủ đề test', 'Nội dung chữ thuần', { module: 'EMAIL', targetCode: 'T1' }, '<html>bản HTML</html>');
        });
      });
      assertEqual(captured.url, '/api/send-email', 'Phải gọi đúng endpoint /api/send-email');
      assertEqual(captured.body.text, 'Nội dung chữ thuần', 'Phải giữ nguyên field text (bản chữ thuần)');
      assertEqual(captured.body.html, '<html>bản HTML</html>', 'Phải forward đúng field html (tham số thứ 5) trong JSON gửi lên server');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
