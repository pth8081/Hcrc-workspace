// server/tests/test-approval-needed-email-template.js
//
// Regression test cho MẪU EMAIL "CẦN PHÊ DUYỆT" DÙNG CHUNG (11/2026, theo yêu cầu người dùng: "làm mẫu
// gửi chung cho tất cả các module có phê duyệt" theo 1 khuôn cố định) — xem buildApprovalNeededEmailBody()
// + APPROVAL_GREETING_PLACEHOLDER/APPROVAL_SIGNATURE_PLACEHOLDER ở notifyRecipientsByEmail() (core.js).
// CHỈ actionType NOTIFY_APPROVAL_NEEDED (family 'approvalNeeded') đổi sang khuôn này — mọi family khác
// (result/forward*/...) giữ NGUYÊN body tự do như cũ, test riêng ở (C) dưới cùng để chống regression.
//
//   (A) buildApprovalNeededEmailBody(): dựng đúng khuôn cố định người dùng yêu cầu — đủ 8 dòng thông tin
//       (Loại phiếu/Số phiếu/Trích yếu/Người tạo/Ngày tạo/Bước hiện tại/Yêu cầu/Hạn xử lý/Mức độ), mặc
//       định hợp lý khi thiếu field (deadline/urgency/summary).
//   (B) notifyRecipientsByEmail() điền placeholder + chèn link + chữ ký ĐÚNG VỊ TRÍ (nội dung -> link ->
//       chữ ký), xưng đúng tên khi gửi cho DUY NHẤT 1 người, xưng chung "Anh/Chị" khi gửi cho NHIỀU người.
//   (C) Đối chứng: bodyText KHÔNG chứa placeholder (mọi family khác từ trước tới nay) -> hành vi CŨ giữ
//       nguyên 100% (chỉ nối thêm link ở cuối, KHÔNG có chữ ký/không đổi gì khác).
//
// Chạy: node server/tests/test-approval-needed-email-template.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual, assertIncludes } = require('./testHarness');

const PORT_UI = 8997;

async function main() {
  const REPORTER = { username: 'nv1', name: 'Nguyễn Văn A', dept: 'Phòng Kinh Doanh', perms: {}, active: true, email: 'a@x.com' };
  const APPROVER1 = { username: 'tp1', name: 'Trần Thị B', dept: 'Phòng Kinh Doanh', perms: {}, active: true, email: 'b@x.com' };
  const APPROVER2 = { username: 'tp2', name: 'Lê Văn C', dept: 'Phòng Kinh Doanh', perms: {}, active: true, email: 'c@x.com' };

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({ users: [REPORTER, APPROVER1, APPROVER2] });
  const { browser, page } = await launchPage(PORT_UI, state);
  const run = createRunner();

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, REPORTER);

    await run.run('buildApprovalNeededEmailBody(): dựng đúng khuôn cố định, đủ 8 dòng thông tin', async () => {
      const body = await page.evaluate(() => buildApprovalNeededEmailBody({
        ticketType: 'Đăng Ký Xe', ticketNumber: 'XE-001', summary: 'Đi công tác Hà Nội',
        creatorName: 'Nguyễn Văn A', creatorDept: 'Phòng Kinh Doanh', createdAt: '01/11/2026 09:00:00',
        stepName: 'Bước 1', deadline: '05/11/2026', urgency: 'Gấp'
      }));
      assertIncludes(body, 'Hệ thống Văn phòng điện tử thông báo', 'Phải có câu mở đầu đúng khuôn');
      assertIncludes(body, '- Loại phiếu: Đăng Ký Xe', 'Phải có dòng Loại phiếu');
      assertIncludes(body, '- Số phiếu: XE-001', 'Phải có dòng Số phiếu');
      assertIncludes(body, '- Trích yếu: Đi công tác Hà Nội', 'Phải có dòng Trích yếu');
      assertIncludes(body, '- Người tạo: Nguyễn Văn A – Phòng Kinh Doanh', 'Phải có dòng Người tạo kèm phòng ban');
      assertIncludes(body, '- Ngày tạo: 01/11/2026 09:00:00', 'Phải có dòng Ngày tạo');
      assertIncludes(body, '- Bước hiện tại: Bước 1', 'Phải có dòng Bước hiện tại');
      assertIncludes(body, '- Yêu cầu: Phê duyệt', 'Phải có dòng Yêu cầu, mặc định "Phê duyệt"');
      assertIncludes(body, '- Hạn xử lý: 05/11/2026', 'Phải có dòng Hạn xử lý đúng giá trị truyền vào');
      assertIncludes(body, '- Mức độ: Gấp', 'Phải có dòng Mức độ đúng giá trị truyền vào');
      assertIncludes(body, 'Anh/Chị vui lòng truy cập đường dẫn dưới đây', 'Phải có câu dẫn link');
    });

    await run.run('buildApprovalNeededEmailBody(): thiếu deadline/urgency -> mặc định "Không quy định"/"Thường"', async () => {
      const body = await page.evaluate(() => buildApprovalNeededEmailBody({
        ticketType: 'Tài Liệu', ticketNumber: 'TL-001', summary: 'Quy trình ABC',
        creatorName: 'A', creatorDept: 'IT', createdAt: '01/11/2026', stepName: 'Bước 1'
      }));
      assertIncludes(body, '- Hạn xử lý: Không quy định', 'Thiếu deadline -> mặc định "Không quy định"');
      assertIncludes(body, '- Mức độ: Thường', 'Thiếu urgency -> mặc định "Thường"');
    });

    await run.run('notifyRecipientsByEmail(): gửi cho DUY NHẤT 1 người -> xưng đúng tên người đó', async () => {
      const result = await page.evaluate(() => {
        const bodyText = buildApprovalNeededEmailBody({
          ticketType: 'Đăng Ký Xe', ticketNumber: 'XE-010', summary: 'Đi HN',
          creatorName: 'A', creatorDept: 'KD', createdAt: '01/11/2026', stepName: 'Bước 1'
        });
        let captured = null;
        const original = window.dispatchRealEmail;
        window.dispatchRealEmail = (recipients, subject, text) => { captured = text; };
        notifyRecipientsByEmail('CAR', 'NOTIFY_APPROVAL_NEEDED', 'XE-010', [{ username: 'tp1', name: 'Trần Thị B', email: 'b@x.com' }], 'Chủ đề', bodyText);
        window.dispatchRealEmail = original;
        return captured;
      });
      assertIncludes(result, 'Kính gửi Anh/Chị Trần Thị B,', 'Gửi cho 1 người -> phải xưng đúng tên người đó');
    });

    await run.run('notifyRecipientsByEmail(): gửi cho NHIỀU người -> xưng chung "Anh/Chị", không đoán sai tên', async () => {
      const result = await page.evaluate(() => {
        const bodyText = buildApprovalNeededEmailBody({
          ticketType: 'Đăng Ký Xe', ticketNumber: 'XE-011', summary: 'Đi HN',
          creatorName: 'A', creatorDept: 'KD', createdAt: '01/11/2026', stepName: 'Bước 1'
        });
        let captured = null;
        const original = window.dispatchRealEmail;
        window.dispatchRealEmail = (recipients, subject, text) => { captured = text; };
        notifyRecipientsByEmail('CAR', 'NOTIFY_APPROVAL_NEEDED', 'XE-011',
          [{ username: 'tp1', name: 'Trần Thị B', email: 'b@x.com' }, { username: 'tp2', name: 'Lê Văn C', email: 'c@x.com' }],
          'Chủ đề', bodyText);
        window.dispatchRealEmail = original;
        return captured;
      });
      assertIncludes(result, 'Kính gửi Anh/Chị,', 'Gửi cho nhiều người -> phải xưng chung "Anh/Chị"');
      assertEqual(/Trần Thị B|Lê Văn C/.test(result), false, 'KHÔNG được đoán/nêu chỉ 1 trong nhiều tên khi gửi nhóm');
    });

    await run.run('notifyRecipientsByEmail(): thứ tự ĐÚNG khuôn — nội dung -> link thật -> chữ ký công ty', async () => {
      const result = await page.evaluate(() => {
        const bodyText = buildApprovalNeededEmailBody({
          ticketType: 'Đăng Ký Xe', ticketNumber: 'XE-012', summary: 'Đi HN',
          creatorName: 'A', creatorDept: 'KD', createdAt: '01/11/2026', stepName: 'Bước 1'
        });
        let captured = null;
        const original = window.dispatchRealEmail;
        window.dispatchRealEmail = (recipients, subject, text) => { captured = text; };
        notifyRecipientsByEmail('CAR', 'NOTIFY_APPROVAL_NEEDED', 'XE-012', [{ username: 'tp1', name: 'Trần Thị B', email: 'b@x.com' }], 'Chủ đề', bodyText);
        window.dispatchRealEmail = original;
        return captured;
      });
      const idxLead = result.indexOf('vui lòng truy cập đường dẫn');
      const idxLink = result.indexOf('🔗 Xem trực tiếp hồ sơ');
      const idxSig = result.indexOf('Trân trọng,');
      const idxCompany = result.indexOf('Hệ thống Văn phòng số – Công ty HCRC');
      assertEqual(idxLead > -1 && idxLink > idxLead && idxSig > idxLink && idxCompany > idxSig, true,
        `Thứ tự phải là nội dung -> link -> "Trân trọng," -> tên công ty (idxLead=${idxLead} idxLink=${idxLink} idxSig=${idxSig} idxCompany=${idxCompany})`);
    });

    await run.run('ĐỐI CHỨNG: bodyText KHÔNG dùng mẫu mới (family khác, VD "result") -> hành vi CŨ giữ nguyên 100%', async () => {
      const result = await page.evaluate(() => {
        let captured = null;
        const original = window.dispatchRealEmail;
        window.dispatchRealEmail = (recipients, subject, text) => { captured = text; };
        notifyRecipientsByEmail('CAR', 'NOTIFY_APPROVED', 'XE-013', [{ username: 'nv1', name: 'Nguyễn Văn A', email: 'a@x.com' }], 'Chủ đề', 'Câu văn tự do của family result, không đổi gì.');
        window.dispatchRealEmail = original;
        return captured;
      });
      assertEqual(result.startsWith('Câu văn tự do của family result, không đổi gì.'), true, 'Body KHÔNG chứa placeholder phải giữ nguyên y hệt (chỉ nối thêm link ở cuối)');
      assertEqual(result.includes('Trân trọng,'), false, 'KHÔNG được tự thêm chữ ký công ty cho family khác (chưa dùng mẫu mới)');
      assertEqual(result.includes('{{APPROVAL'), false, 'KHÔNG được để sót placeholder chưa thay thế ra ngoài');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
