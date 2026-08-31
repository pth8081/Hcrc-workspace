// server/tests/test-hr-feedback.js
//
// Regression test cho tính năng "HCRC Đồng Hành" (collection hrFeedback) — 2 mặt của CÙNG 1 dữ liệu:
//   - Nhân viên: tab "🤝 HCRC Đồng Hành" trong module Truyền Thông (setInternalSubTab('QNA')) — gửi
//     câu hỏi + xem lại ĐÚNG câu hỏi của CHÍNH MÌNH. Mở cho MỌI nhân viên, không cần quyền riêng.
//   - Nhân Sự: module mới "Nhân Sự" (switchTab('hr')) > tab "Quản Lý & Phản Hồi Ý Kiến" — xem TOÀN BỘ
//     câu hỏi công ty gửi lên và trả lời. Gác bởi ĐÚNG 1 quyền phẳng nhanSuManage (vừa là quyền vào
//     module, vừa là quyền trả lời — module hiện chỉ có 1 tab con nên không tách quyền theo tab).
//
// 2 điểm khác biệt cần bảo vệ chặt nhất:
//   1. TÍNH RIÊNG TƯ (lý do không tái dùng internalPosts — bảng tin CÔNG KHAI): chỉ chính người hỏi +
//      Nhân Sự đọc được, đồng nghiệp cùng phòng ban cũng KHÔNG thấy. Lọc thật ở server
//      (filterHrFeedbackForUser, lib/recordViewScope.js), giao diện chỉ lọc thêm 1 lớp nữa.
//   2. Cờ CHƯA ĐỌC BỀN VỮNG employeeUnread — khái niệm MỚI lần đầu trong hệ thống (mọi badge khác đều
//      chiếu trực tiếp từ trạng thái hiện tại của bản ghi). Bật khi Nhân Sự trả lời, tắt khi nhân viên
//      mở xem; người dùng đã chốt KHÔNG gửi email nên đây là kênh báo DUY NHẤT.
//
// Chạy: node server/tests/test-hr-feedback.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual, assertIncludes
} = require('./testHarness');
const { filterHrFeedbackForUser, canViewHrFeedback } = require('../lib/recordViewScope');

const PORT = 8985;

// ===================== Seed dữ liệu =====================
// STAFF_A/STAFF_B CÙNG phòng ban — cố ý, để chứng minh tính riêng tư KHÔNG dựa vào phòng ban (khác mọi
// collection dept-workflow khác trong hệ thống).
const STAFF_A = { username: 'staff_a', name: 'Nguyễn Văn A', dept: 'Kinh Doanh', perms: {}, active: true };
const STAFF_B = { username: 'staff_b', name: 'Trần Thị B', dept: 'Kinh Doanh', perms: {}, active: true };
const HR1 = { username: 'hr1', name: 'Chuyên Viên Nhân Sự', dept: 'Nhân Sự', perms: { nhanSuManage: true }, active: true };
// Admin CỐ Ý không có nhanSuManage — kiểm tra nhánh perms.admin của canManageHrFeedback()/
// canAccessHrModule() thực sự hoạt động độc lập với cờ quyền riêng của module.
// totpEnabled:true — admin bắt buộc xác thực 2 lớp (xem lib/totp.js/proceedAfterAuth() ở index.html);
// thiếu field này khiến loginAs() (gọi thẳng proceedAfterAuth()) bị chặn lại ở màn bắt buộc thiết lập
// TOTP thay vì vào được giao diện chính, không liên quan gì tới nội dung bài test này.
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };

const state = createMockState({
  depts: ['Kinh Doanh', 'Nhân Sự', 'Ban Giám Đốc'],
  users: [STAFF_A, STAFF_B, HR1, ADMIN]
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => {
    window.__resetCapture();
    await proceedAfterAuth(u);
  }, user);
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  let questionId = null;

  try {
    // ===== 1) Nhân viên thường (KHÔNG quyền gì) gửi được câu hỏi qua tab HCRC Đồng Hành =====
    await run.run('Nhân viên thường gửi câu hỏi HCRC Đồng Hành -> PENDING, creator đúng, mọi field trạng thái do server ép cứng', async () => {
      await loginAs(page, STAFF_A);
      const result = await page.evaluate(async () => {
        switchTab('internal');
        setInternalSubTab('QNA');
        document.getElementById('hrFeedbackCategory').value = 'BENEFITS';
        document.getElementById('hrFeedbackQuestion').value = 'Công ty có hỗ trợ chi phí gửi trẻ cho nhân viên nữ không ạ?';
        // Payload GIẢ MẠO thêm ở tầng client là không thể (submitHrFeedbackQuestion chỉ gửi
        // question/category) — phần chống giả mạo thật nằm ở extraValidate, kiểm tra ngay dưới đây.
        await submitHrFeedbackQuestion({ preventDefault() {}, target: { reset() {} } });
        const q = DB.hrFeedback[0];
        return { alerts: window.__alerts.slice(), item: q, count: DB.hrFeedback.length };
      });
      assert(result.item, 'Câu hỏi phải được tạo');
      assertEqual(result.item.status, 'PENDING', 'Câu hỏi mới luôn ở trạng thái chờ phản hồi');
      assertEqual(result.item.creator, 'staff_a', 'creator phải là người đang đăng nhập (server tự gán)');
      assertEqual(result.item.creatorName, 'Nguyễn Văn A', 'creatorName phải do server gán từ phiên đăng nhập');
      assertEqual(result.item.dept, 'Kinh Doanh', 'dept phải bị ép về đúng phòng ban của người hỏi (forceOwnDept)');
      assertEqual(result.item.category, 'BENEFITS', 'category phải giữ đúng lựa chọn hợp lệ của người hỏi');
      assertEqual(result.item.response, '', 'response phải rỗng lúc tạo');
      assertEqual(result.item.respondedBy, null, 'respondedBy phải rỗng lúc tạo');
      assertEqual(result.item.employeeUnread, false, 'employeeUnread phải là false lúc tạo (chưa có gì để đọc)');
      assert(!!result.item.createdAt, 'createdAt phải do server gán');
      assertIncludes(result.alerts, 'Đã gửi câu hỏi tới bộ phận Nhân Sự', 'Phải báo gửi câu hỏi thành công');
      questionId = result.item.id;
    });

    // ===== 1b) Chống giả mạo ở tầng SERVER: payload tự soạn không thể tự xưng đã được trả lời =====
    await run.run('Chống giả mạo: payload tự soạn (status/response/employeeUnread) bị server ép về giá trị khởi tạo', async () => {
      const forged = await page.evaluate(async () => {
        const result = await callCreateAction('hrFeedback', {
          question: 'Câu hỏi thử giả mạo trạng thái',
          category: 'KHONG_HOP_LE',
          status: 'ANSWERED',
          response: 'Tự trả lời cho chính mình',
          respondedBy: 'hr1', respondedByName: 'Chuyên Viên Nhân Sự', respondedAt: 'hôm qua',
          employeeUnread: true,
          creator: 'hr1', creatorName: 'Chuyên Viên Nhân Sự', dept: 'Ban Giám Đốc'
        });
        DB.hrFeedback.unshift(result.item);
        return result.item;
      });
      assertEqual(forged.status, 'PENDING', 'status client gửi lên phải bị bỏ qua');
      assertEqual(forged.response, '', 'response client gửi lên phải bị bỏ qua');
      assertEqual(forged.respondedBy, null, 'respondedBy client gửi lên phải bị bỏ qua');
      assertEqual(forged.employeeUnread, false, 'employeeUnread client gửi lên phải bị bỏ qua');
      assertEqual(forged.creator, 'staff_a', 'creator client gửi lên phải bị ghi đè bằng người đang đăng nhập');
      assertEqual(forged.dept, 'Kinh Doanh', 'dept client gửi lên phải bị ghi đè bằng phòng ban thật của người hỏi');
      assertEqual(forged.category, 'OTHER', 'category không hợp lệ phải rơi về OTHER');
    });

    // ===== 2) RIÊNG TƯ: đồng nghiệp CÙNG phòng ban không thấy câu hỏi của người khác =====
    await run.run('Riêng tư: nhân viên KHÁC (cùng phòng ban) không nhận được câu hỏi này từ server, hộp thư của họ trống', async () => {
      await loginAs(page, STAFF_B);
      const result = await page.evaluate(() => {
        switchTab('internal');
        setInternalSubTab('QNA');
        return {
          received: DB.hrFeedback.length,
          inboxHtml: document.getElementById('hrFeedbackInboxContainer').innerHTML
        };
      });
      assertEqual(result.received, 0, 'Server KHÔNG được trả câu hỏi của người khác về cho nhân viên thường (lọc ở GET /api/data)');
      assertIncludes(result.inboxHtml, 'Bạn chưa gửi câu hỏi nào', 'Hộp thư của nhân viên khác phải trống');

      // Kiểm tra thẳng luật lọc phía server (không đi qua giao diện) cho chắc chắn.
      assertEqual(canViewHrFeedback(STAFF_B, { creator: 'staff_a' }), false, 'canViewHrFeedback phải chặn người không phải người hỏi/Nhân Sự');
      assertEqual(filterHrFeedbackForUser(state.hrFeedback, STAFF_B).length, 0, 'filterHrFeedbackForUser phải lọc sạch câu hỏi của người khác');
      assertEqual(filterHrFeedbackForUser(state.hrFeedback, STAFF_A).length, 2, 'Chính người hỏi phải thấy đủ câu hỏi của mình');
    });

    // ===== 3) Nhân viên không có nhanSuManage: không thấy nút module + gọi thẳng route respond -> 403 =====
    await run.run('Nhân viên không có nhanSuManage: nút "Nhân Sự" bị ẩn, switchTab("hr") bị chặn, gọi thẳng route respond -> 403', async () => {
      const result = await page.evaluate(async (id) => {
        window.__resetCapture();
        const navHidden = document.getElementById('btnHrTab').classList.contains('hidden');
        switchTab('hr');
        const sectionHidden = document.getElementById('hrSection').classList.contains('hidden');
        let threw = null;
        try {
          await callRecordAction('hrFeedback', id, 'respond', { response: 'Tôi tự trả lời câu hỏi của chính mình' });
        } catch (e) {
          threw = e.message;
        }
        return { navHidden, sectionHidden, alerts: window.__alerts.slice(), threw };
      }, questionId);
      assertEqual(result.navHidden, true, 'Nút nav "Nhân Sự" phải ẩn với người không có nhanSuManage');
      assertEqual(result.sectionHidden, true, 'Màn hình module Nhân Sự phải không mở được');
      assertIncludes(result.alerts, 'không có quyền truy cập Module Nhân Sự', 'Phải cảnh báo không có quyền vào module');
      assertIncludes(result.threw, 'không có quyền phản hồi', 'Gọi thẳng route respond phải bị server từ chối (403)');
    });

    // ===== 4) Nhân Sự thấy TOÀN BỘ câu hỏi và trả lời được =====
    await run.run('Nhân Sự (nhanSuManage) thấy toàn bộ câu hỏi công ty ở màn Quản Lý & Phản Hồi, trả lời -> ANSWERED + employeeUnread=true', async () => {
      await loginAs(page, HR1);
      const seen = await page.evaluate(() => {
        const navHidden = document.getElementById('btnHrTab').classList.contains('hidden');
        switchTab('hr');
        return {
          navHidden,
          sectionHidden: document.getElementById('hrSection').classList.contains('hidden'),
          received: DB.hrFeedback.length,
          html: document.getElementById('hrFeedbackManageContainer').innerHTML
        };
      });
      assertEqual(seen.navHidden, false, 'Nút nav "Nhân Sự" phải hiện với người có nhanSuManage');
      assertEqual(seen.sectionHidden, false, 'Màn hình module Nhân Sự phải mở được');
      assertEqual(seen.received, 2, 'Nhân Sự phải nhận được TOÀN BỘ câu hỏi công ty (không lọc theo creator)');
      assertIncludes(seen.html, 'Nguyễn Văn A', 'Danh sách quản lý phải hiện tên người hỏi');
      assertIncludes(seen.html, 'chi phí gửi trẻ', 'Danh sách quản lý phải hiện nội dung câu hỏi');

      const answered = await page.evaluate(async (id) => {
        window.__resetCapture();
        document.getElementById(`hrFeedbackResponseInput_${id}`).value = 'Công ty hỗ trợ 500.000đ/tháng cho con dưới 6 tuổi, chị làm đơn gửi Nhân Sự nhé.';
        await submitHrFeedbackResponse(id);
        const item = DB.hrFeedback.find(x => x.id === id);
        return { alerts: window.__alerts.slice(), item };
      }, questionId);
      assertEqual(answered.item.status, 'ANSWERED', 'Trả lời xong phải chuyển sang ANSWERED');
      assertIncludes(answered.item.response, '500.000đ/tháng', 'Nội dung phản hồi phải được lưu đúng');
      assertEqual(answered.item.respondedBy, 'hr1', 'respondedBy phải là người trả lời thật (server tự gán)');
      assertEqual(answered.item.respondedByName, 'Chuyên Viên Nhân Sự', 'respondedByName phải do server gán');
      assert(!!answered.item.respondedAt, 'respondedAt phải được gán khi trả lời');
      assertEqual(answered.item.employeeUnread, true, 'Trả lời xong phải bật cờ chưa đọc cho nhân viên');
      assertIncludes(answered.alerts, 'Đã gửi phản hồi tới nhân viên', 'Phải báo gửi phản hồi thành công');
    });

    // ===== 4b) 1 hỏi – 1 đáp: không trả lời lần 2, không gửi phản hồi rỗng =====
    await run.run('Mô hình 1 hỏi – 1 đáp: câu đã trả lời không trả lời lại được; phản hồi rỗng bị chặn', async () => {
      const result = await page.evaluate(async (id) => {
        let twice = null;
        try {
          await callRecordAction('hrFeedback', id, 'respond', { response: 'Trả lời lần 2' });
        } catch (e) { twice = e.message; }

        const pending = DB.hrFeedback.find(x => x.status === 'PENDING');
        let empty = null;
        try {
          await callRecordAction('hrFeedback', pending.id, 'respond', { response: '   ' });
        } catch (e) { empty = e.message; }
        return { twice, empty };
      }, questionId);
      assertIncludes(result.twice, 'đã được phản hồi', 'Câu đã trả lời không được trả lời lần nữa');
      assertIncludes(result.empty, 'Vui lòng nhập nội dung phản hồi', 'Phản hồi rỗng phải bị chặn');
    });

    // ===== 5) Nhân viên đăng nhập lại: badge hiện đúng số chưa đọc =====
    await run.run('Nhân viên đã hỏi đăng nhập lại: badge "HCRC Đồng Hành" hiện đúng số phản hồi chưa đọc', async () => {
      await loginAs(page, STAFF_A);
      const result = await page.evaluate(() => ({
        dropdownLabel: document.getElementById('hrFeedbackDropdownLabel').innerText,
        subTabLabel: document.getElementById('hrFeedbackSubTabLabel').innerText,
        received: DB.hrFeedback.length
      }));
      assertEqual(result.received, 2, 'Người hỏi phải nhận lại đủ 2 câu hỏi của chính mình');
      assertIncludes(result.dropdownLabel, 'HCRC Đồng Hành (1)', 'Nhãn ở dropdown sidebar phải hiện 1 phản hồi chưa đọc');
      assertIncludes(result.subTabLabel, 'HCRC Đồng Hành (1)', 'Nhãn sub-tab bên trong module phải hiện cùng số');
    });

    // ===== 5b) Badge chưa đọc là của RIÊNG người hỏi, không lây sang người khác =====
    await run.run('Badge chưa đọc chỉ tính câu hỏi của CHÍNH mình — nhân viên khác vẫn thấy nhãn sạch', async () => {
      await loginAs(page, STAFF_B);
      const label = await page.evaluate(() => document.getElementById('hrFeedbackDropdownLabel').innerText);
      assertEqual(label, '🤝 HCRC Đồng Hành', 'Nhân viên khác không được thấy số chưa đọc của người khác');
    });

    // ===== 6) Mở câu đã trả lời -> mark-read -> badge về 0, employeeUnread=false lưu đúng =====
    await run.run('Nhân viên mở câu đã trả lời -> markHrFeedbackRead -> employeeUnread=false, badge về 0', async () => {
      await loginAs(page, STAFF_A);
      const result = await page.evaluate(async (id) => {
        switchTab('internal');
        setInternalSubTab('QNA');
        const inboxHtml = document.getElementById('hrFeedbackInboxContainer').innerHTML;
        await openHrFeedbackAnswer(id);
        return {
          inboxHtml,
          afterHtml: document.getElementById('hrFeedbackInboxContainer').innerHTML,
          item: DB.hrFeedback.find(x => x.id === id),
          dropdownLabel: document.getElementById('hrFeedbackDropdownLabel').innerText,
          subTabLabel: document.getElementById('hrFeedbackSubTabLabel').innerText
        };
      }, questionId);
      assertIncludes(result.inboxHtml, 'Phản hồi mới', 'Trước khi mở, câu trả lời phải được đánh dấu là mới');
      assertEqual(result.item.employeeUnread, false, 'Mở xem xong phải tắt cờ chưa đọc');
      assertEqual(result.item.status, 'ANSWERED', 'Đánh dấu đã đọc KHÔNG được đổi trạng thái câu hỏi');
      assertIncludes(result.item.response, '500.000đ/tháng', 'Đánh dấu đã đọc KHÔNG được đụng tới nội dung phản hồi');
      assertEqual(result.dropdownLabel, '🤝 HCRC Đồng Hành', 'Badge phải về 0 sau khi đọc');
      assertEqual(result.subTabLabel, '🤝 HCRC Đồng Hành', 'Badge sub-tab phải về 0 sau khi đọc');
      assertIncludes(result.afterHtml, '500.000đ/tháng', 'Sau khi đọc vẫn phải hiện nguyên nội dung phản hồi');

      // Cờ đã lưu THẬT xuống "kho" (state của mock backend), không chỉ đổi trong bộ nhớ trang.
      const stored = state.hrFeedback.find(x => x.id === result.item.id);
      assertEqual(stored.employeeUnread, false, 'employeeUnread=false phải được lưu lại ở tầng lưu trữ, không chỉ ở giao diện');
    });

    // ===== 6b) Người khác không đánh dấu đã đọc hộ được =====
    await run.run('Nhân viên khác không gọi được mark-read lên câu hỏi không phải của mình', async () => {
      await loginAs(page, STAFF_B);
      const threw = await page.evaluate(async (id) => {
        try {
          await callRecordAction('hrFeedback', id, 'mark-read', {});
          return null;
        } catch (e) { return e.message; }
      }, questionId);
      assertIncludes(threw, 'không có quyền xem câu hỏi này', 'mark-read phải bị chặn với người không liên quan');
    });

    // ===== 7) Admin (KHÔNG có nhanSuManage) vẫn quản lý được nhờ nhánh perms.admin =====
    await run.run('Admin (không có nhanSuManage) vẫn vào được module Nhân Sự và trả lời được', async () => {
      await loginAs(page, ADMIN);
      const result = await page.evaluate(async () => {
        const navHidden = document.getElementById('btnHrTab').classList.contains('hidden');
        switchTab('hr');
        const pending = DB.hrFeedback.find(x => x.status === 'PENDING');
        window.__resetCapture();
        document.getElementById(`hrFeedbackResponseInput_${pending.id}`).value = 'Đã tiếp nhận, Nhân Sự sẽ rà soát lại.';
        await submitHrFeedbackResponse(pending.id);
        const item = DB.hrFeedback.find(x => x.id === pending.id);
        return { navHidden, received: DB.hrFeedback.length, item, alerts: window.__alerts.slice() };
      });
      assertEqual(result.navHidden, false, 'Admin phải thấy nút nav "Nhân Sự" dù không có nhanSuManage');
      assertEqual(result.received, 2, 'Admin phải xem được toàn bộ câu hỏi công ty');
      assertEqual(result.item.status, 'ANSWERED', 'Admin trả lời được nhờ nhánh perms.admin của canManageHrFeedback()');
      assertEqual(result.item.respondedBy, 'admin', 'respondedBy phải là chính admin vừa trả lời');
      assertEqual(result.item.employeeUnread, true, 'Admin trả lời cũng phải bật cờ chưa đọc cho nhân viên');
      assertIncludes(result.alerts, 'Đã gửi phản hồi tới nhân viên', 'Phải báo gửi phản hồi thành công');
    });

    // ===== 8) 4 tab cũ của Truyền Thông không vỡ vì có thêm nhánh QNA =====
    await run.run('Thêm tab QNA không phá 4 tab Truyền Thông cũ (NEWS/TRAINING/RECRUITMENT/SHARE)', async () => {
      await loginAs(page, STAFF_A);
      const result = await page.evaluate(() => {
        const snap = (sub) => {
          setInternalSubTab(sub);
          return {
            sub,
            qna: document.getElementById('internalQnaSection').classList.contains('hidden'),
            training: document.getElementById('internalTrainingLmsSection').classList.contains('hidden'),
            recruitment: document.getElementById('internalRecruitmentSection').classList.contains('hidden'),
            list: document.getElementById('internalListBlock').classList.contains('hidden'),
            btnCls: document.getElementById('btnInternalSubQna').className
          };
        };
        return ['NEWS', 'TRAINING', 'RECRUITMENT', 'SHARE', 'QNA'].map(snap);
      });
      const by = Object.fromEntries(result.map(r => [r.sub, r]));
      assertEqual(by.NEWS.qna, true, 'Tab Nhịp Sống HCRC phải ẩn khối HCRC Đồng Hành');
      assertEqual(by.NEWS.list, false, 'Tab Nhịp Sống HCRC vẫn phải hiện danh sách bài viết như cũ');
      assertEqual(by.TRAINING.training, false, 'Tab Đào Tạo vẫn phải hiện khối LMS như cũ');
      assertEqual(by.TRAINING.qna, true, 'Tab Đào Tạo phải ẩn khối HCRC Đồng Hành');
      assertEqual(by.RECRUITMENT.recruitment, false, 'Tab Tuyển Dụng vẫn phải hiện khối tuyển dụng như cũ');
      assertEqual(by.SHARE.list, false, 'Tab Góc Chia Sẻ vẫn phải hiện danh sách bài viết như cũ');
      assertEqual(by.SHARE.qna, true, 'Tab Góc Chia Sẻ phải ẩn khối HCRC Đồng Hành');
      assertEqual(by.QNA.qna, false, 'Tab HCRC Đồng Hành phải hiện khối riêng của nó');
      assertEqual(by.QNA.list, true, 'Tab HCRC Đồng Hành phải ẩn danh sách bài viết chung');
      assertEqual(by.QNA.training, true, 'Tab HCRC Đồng Hành phải ẩn khối Đào Tạo');
      assertEqual(by.QNA.recruitment, true, 'Tab HCRC Đồng Hành phải ẩn khối Tuyển Dụng');
      assertIncludes(by.QNA.btnCls, 'bg-fuchsia-700', 'Nút sub-tab HCRC Đồng Hành phải được tô sáng khi đang mở');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-hr-feedback.js:', err);
  process.exitCode = 1;
});
