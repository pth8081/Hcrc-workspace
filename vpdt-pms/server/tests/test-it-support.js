// server/tests/test-it-support.js
//
// Regression test cho module Hỗ Trợ IT (key 'itSupport'), 2 sub-tab tách biệt hoàn toàn:
//   - Phê Duyệt Giá (itPriceApprovals): Mẫu Giá (itPriceMasterLists) giờ CHỈ còn là khuôn cột
//     (columns[]) đại diện cho định dạng file bên mua hàng gửi — dùng để BẮT BUỘC người đề xuất
//     chọn đúng mẫu + dò/gắn columnLabels (snapshot theo TỪNG tệp) khi nộp, KHÔNG còn dữ liệu giá
//     thật để đối chiếu/tự động duyệt (đã bỏ hẳn matchAgainstMaster()/autoApproved — xem
//     lib/priceFileParser.js + itPriceApprovals.extraValidate ở lib/createValidation.js). Mọi đề xuất
//     từ nay LUÔN đi qua đúng quy trình duyệt phòng ban (itPriceDeptWorkflows, dùng chung
//     lib/workflowEngine.js). "Yêu Cầu Bổ Sung" từ đội Hỗ Trợ IT là kênh song song, append-only
//     (files[] chỉ được THÊM, không thay thế — xem submitPriceSupplementFile() ở lib/recordActions.js).
//   - Hỗ Trợ Yêu Cầu (itSupportTickets): ticket helpdesk nội bộ, ai cũng tạo được; đội Hỗ Trợ IT
//     (itManage) claim/xử lý/leo thang phê duyệt (escalate) tới 1 người cụ thể trước khi tiếp tục.
//
// Chạy: node server/tests/test-it-support.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual, assertIncludes
} = require('./testHarness');

const PORT = 8982;

// ===================== Seed dữ liệu =====================
const STAFF_KD = { username: 'staff_kd', name: 'Ngô Văn Kinh Doanh', dept: 'Kinh Doanh', perms: { itPriceProposeCreate: true }, active: true };
const IT1 = { username: 'it1', name: 'Đội Hỗ Trợ IT', dept: 'IT', perms: { itManage: true }, active: true };
const APPROVER1 = { username: 'approver1', name: 'Trưởng Phòng Duyệt', dept: 'Ban Giám Đốc', perms: {}, active: true };
const PLAIN = { username: 'plain', name: 'Nhân Viên Thường', dept: 'Kinh Doanh', perms: {}, active: true };

// Mẫu Giá giờ chỉ là khuôn CỘT (không còn dữ liệu items thật) — khớp đúng hình dạng
// parsePriceTemplateColumns() trả về + addItPriceMasterList() lưu ở public/index.html.
const MASTER_LIST = {
  id: 1, name: 'Bảng Giá Chuẩn 2026',
  columns: [
    { key: 'code', label: 'Mã hàng' },
    { key: 'name', label: 'Tên mặt hàng' },
    { key: 'oldPrice', label: 'Giá cũ' },
    { key: 'newPrice', label: 'Giá mới' }
  ],
  fileUrl: '/uploads/mau-gia-chuan-2026.xlsx', fileName: 'mau-gia-chuan-2026.xlsx',
  uploadedBy: 'admin', uploadedByName: 'Quản Trị Viên', uploadedAt: new Date().toLocaleString('vi-VN')
};

const state = createMockState({
  depts: ['Kinh Doanh', 'IT', 'Ban Giám Đốc'],
  users: [STAFF_KD, IT1, APPROVER1, PLAIN],
  itPriceMasterLists: [MASTER_LIST],
  // Bỏ auto-approve -> mọi đề xuất phải qua đúng 1 bước duyệt phòng ban (dept 'Kinh Doanh', khớp
  // forceOwnDept của itPriceApprovals) trước khi đội IT áp giá — approver1 là người duyệt bước 1.
  itPriceDeptWorkflows: { 'Kinh Doanh': { workflowId: 'wf-kd-price', approvers: { 1: ['approver1'] } } },
  workflows: [{ id: 'wf-kd-price', steps: [{ order: 1, name: 'Trưởng Phòng Duyệt' }] }]
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
  let priceApprovalId = null;
  let ticketDoneId = null;
  let ticketDeniedId = null;

  try {
    // ===== 1) Phê Duyệt Giá: tạo đề xuất mới phải LUÔN đi qua đúng quy trình duyệt phòng ban (không
    // còn autoApproved), gắn đúng columnLabels snapshot theo Mẫu Giá đã chọn lúc nộp =====
    await run.run('Phê Duyệt Giá: tạo đề xuất mới ở PENDING (không còn tự động duyệt), gắn đúng columnLabels theo Mẫu Giá đã chọn', async () => {
      await loginAs(page, STAFF_KD);
      const result = await page.evaluate(async () => {
        switchTab('itSupport');
        setItSupportSubTab('PRICE');
        document.getElementById('itPriceMasterListSelect').value = String(1);
        document.getElementById('itPriceReason').value = 'Điều chỉnh giá theo chương trình khuyến mãi';
        itPricePendingFile = {
          fileUrl: '/uploads/gia-de-xuat.xlsx',
          fileName: 'gia-de-xuat.xlsx',
          items: [{ code: 'SP001', name: 'Mì gói Hảo Hảo', oldPrice: 5000, newPrice: 5500 }],
          columnLabels: [
            { key: 'code', label: 'Mã hàng' },
            { key: 'name', label: 'Tên mặt hàng' },
            { key: 'oldPrice', label: 'Giá cũ' },
            { key: 'newPrice', label: 'Giá mới' }
          ]
        };
        await submitItPriceApproval({ preventDefault() {}, target: { reset() {} } });
        const p = DB.itPriceApprovals[0];
        return { alerts: window.__alerts, item: p };
      });
      assert(result.item, 'Đề xuất duyệt giá phải được tạo');
      assertEqual(result.item.status, 'PENDING', 'Đề xuất mới phải chờ đúng bước duyệt phòng ban (không còn nhánh autoApproved)');
      assertEqual(result.item.currentStep, 1, 'Đề xuất mới phải ở bước duyệt đầu tiên');
      assertEqual(result.item.autoApproved, false, 'autoApproved phải luôn là false với đề xuất tạo mới (chỉ còn ý nghĩa hiển thị hồ sơ cũ)');
      assertEqual(result.item.files[0].columnLabels.length, 4, 'Phải lưu snapshot đúng khuôn cột (columnLabels) theo Mẫu Giá đã chọn lúc nộp');
      assertEqual(result.item.files[0].columnLabels[1].label, 'Tên mặt hàng', 'columnLabels phải khớp đúng tên cột của Mẫu Giá đã chọn, không phải nhãn mặc định');
      assertIncludes(result.alerts, 'Đã gửi đề xuất duyệt giá thành công', 'Phải thông báo gửi đề xuất thành công (không còn thông báo tự động duyệt)');
      priceApprovalId = result.item.id;
    });

    // ===== 1b) Trưởng phòng (approver1) duyệt đúng bước 1 theo itPriceDeptWorkflows['Kinh Doanh'] để
    // đưa hồ sơ sang APPROVED — bước bắt buộc phải có thật từ nay (không còn autoApproved rút gọn),
    // và là điều kiện tiên quyết cho toàn bộ luồng "Yêu Cầu Bổ Sung"/"Xác nhận áp giá" ở kịch bản 3.
    await run.run('Phê Duyệt Giá: Trưởng phòng duyệt đúng bước 1 (dept-workflow thật) đưa hồ sơ sang APPROVED', async () => {
      await loginAs(page, APPROVER1);
      const result = await page.evaluate(async (id) => {
        window.__resetCapture();
        await approveItPriceConfirmed(id);
        const item = DB.itPriceApprovals.find(x => x.id === id);
        return { status: item.status, alerts: window.__alerts.slice() };
      }, priceApprovalId);
      assertEqual(result.status, 'APPROVED', 'Sau khi Trưởng phòng duyệt xong bước duy nhất, hồ sơ phải chuyển APPROVED');
      assertIncludes(result.alerts, 'Phê duyệt đề xuất giá thành công', 'Phải thông báo phê duyệt hoàn tất, chờ đội IT áp giá');
    });

    // ===== 2) Validation: chưa chọn tệp bảng giá thì không gửi được =====
    await run.run('Validation: Phê Duyệt Giá không cho gửi khi chưa chọn tệp bảng giá', async () => {
      const before = await page.evaluate(() => DB.itPriceApprovals.length);
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        document.getElementById('itPriceCode').value = generateItPriceCode();
        itPricePendingFile = null;
        await submitItPriceApproval({ preventDefault() {}, target: { reset() {} } });
        return { alerts: window.__alerts, count: DB.itPriceApprovals.length };
      });
      assertIncludes(result.alerts, 'Vui lòng chọn tệp bảng giá', 'Phải cảnh báo thiếu tệp bảng giá');
      assertEqual(result.count, before, 'Không được tạo thêm đề xuất nào khi chưa chọn tệp');
    });

    // ===== 3) Yêu Cầu Bổ Sung (đội IT) — append-only, chặn "Xác nhận áp giá" tới khi có phản hồi =====
    // submitPriceSupplementFile() ở lib/recordActions.js CHỈ CHO chính người đề xuất (item.creator) tải
    // tệp bổ sung — nên kịch bản phải đổi user đúng vai trò ở từng bước (IT yêu cầu -> người đề xuất
    // phản hồi -> IT xác nhận áp giá), không thể làm hết bằng 1 user.
    await run.run('Yêu Cầu Bổ Sung từ Hỗ Trợ IT chặn áp giá tới khi có tệp bổ sung (append-only)', async () => {
      await loginAs(page, IT1);
      const step1 = await page.evaluate(async (id) => {
        switchTab('itSupport');
        setItSupportSubTab('PRICE');
        openItPriceModal(id);

        // Nhận xử lý trước (bắt buộc trước khi xác nhận áp giá).
        await claimPriceApplyAction(id);

        // Đội IT yêu cầu bổ sung — dùng chung item.infoRequests, đánh dấu byRole:'it'.
        window.__promptAnswer = 'Cần bổ sung ảnh chụp bảng giá kệ hàng thực tế';
        await requestItPriceInfoIt(id);

        // Thử xác nhận áp giá ngay khi còn yêu cầu bổ sung chưa phản hồi -> phải bị chặn.
        window.__resetCapture();
        await applyItPriceAction(id);
        return {
          blockedAlerts: window.__alerts.slice(),
          stillNotApplied: DB.itPriceApprovals.find(x => x.id === id).applied
        };
      }, priceApprovalId);
      assertIncludes(step1.blockedAlerts, 'yêu cầu bổ sung chưa được người đề xuất phản hồi', 'Phải chặn xác nhận áp giá khi còn yêu cầu bổ sung mở');
      assertEqual(step1.stillNotApplied, false, 'Đề xuất chưa được đánh dấu applied trong lúc còn chặn');

      // Chính người đề xuất (staff_kd) tải lên tệp bổ sung — file MỚI được THÊM vào cuối files[], KHÔNG
      // thay thế bản gốc (append-only).
      await loginAs(page, STAFF_KD);
      const step2 = await page.evaluate(async (id) => {
        itPriceSupplementPendingFile = {
          fileUrl: '/uploads/gia-bo-sung.xlsx', fileName: 'gia-bo-sung.xlsx',
          items: [{ code: 'SP001', name: 'Mì gói Hảo Hảo', oldPrice: 5000, newPrice: 5500 }],
          columnLabels: [
            { key: 'code', label: 'Mã hàng' },
            { key: 'name', label: 'Tên mặt hàng' },
            { key: 'oldPrice', label: 'Giá cũ' },
            { key: 'newPrice', label: 'Giá mới' }
          ]
        };
        await submitItPriceSupplementAction(id);
        const item = DB.itPriceApprovals.find(x => x.id === id);
        return {
          fileCount: item.files.length,
          supplementColumnLabelsLen: item.files[1].columnLabels.length,
          infoRequestReason: item.infoRequests[0].reason,
          infoRequestResponded: !!item.infoRequests[0].response
        };
      }, priceApprovalId);
      assertEqual(step2.fileCount, 2, 'Tệp bổ sung phải được THÊM vào cuối (append-only) — tổng 2 tệp (gốc + bổ sung)');
      assertEqual(step2.supplementColumnLabelsLen, 4, 'Tệp bổ sung cũng phải được sanitize + gắn columnLabels riêng của nó (snapshot đúng lúc nộp)');
      assertEqual(step2.infoRequestReason, 'Cần bổ sung ảnh chụp bảng giá kệ hàng thực tế', 'Phải ghi đúng lý do yêu cầu bổ sung');
      assert(step2.infoRequestResponded, 'Yêu cầu bổ sung phải được đánh dấu đã phản hồi sau khi có tệp bổ sung');

      // Người đã nhận xử lý (IT1) giờ xác nhận áp giá lại phải thành công.
      await loginAs(page, IT1);
      const step3 = await page.evaluate(async (id) => {
        window.__resetCapture();
        await applyItPriceAction(id);
        const item = DB.itPriceApprovals.find(x => x.id === id);
        return { applied: item.applied, appliedByName: item.appliedByName, alerts: window.__alerts.slice() };
      }, priceApprovalId);
      assertEqual(step3.applied, true, 'Sau khi có tệp bổ sung, xác nhận áp giá phải thành công');
      assertEqual(step3.appliedByName, IT1.name, 'Phải ghi đúng người xác nhận áp giá');
      assertIncludes(step3.alerts, 'Đã xác nhận áp giá thành công', 'Phải có thông báo áp giá thành công');
    });

    // ===== 4) Hỗ Trợ Yêu Cầu: tạo ticket (mở cho toàn bộ nhân viên) =====
    await run.run('Hỗ Trợ Yêu Cầu: bất kỳ nhân viên nào cũng tạo được ticket (happy path)', async () => {
      await loginAs(page, PLAIN);
      const result = await page.evaluate(async () => {
        switchTab('itSupport');
        setItSupportSubTab('TICKET');
        document.getElementById('itTicketTitle').value = 'Máy tính không lên nguồn';
        document.getElementById('itTicketCategory').value = 'HARDWARE';
        document.getElementById('itTicketDescription').value = 'Bấm nút nguồn không có phản hồi, đèn báo tắt hẳn.';
        await submitItTicket({ preventDefault() {}, target: { reset() {} } });
        return { alerts: window.__alerts, item: DB.itSupportTickets[0] };
      });
      assert(result.item, 'Ticket phải được tạo thành công');
      assertEqual(result.item.status, 'TODO', 'Ticket mới tạo phải ở trạng thái TODO');
      assertEqual(result.item.creator, PLAIN.username, 'Phải ghi đúng người tạo');
      assertIncludes(result.alerts, 'Đã gửi yêu cầu hỗ trợ IT thành công', 'Phải có thông báo tạo ticket thành công');
      ticketDoneId = result.item.id;
    });

    // ===== 5) Validation: thiếu mô tả sự cố bị server chặn =====
    await run.run('Validation: tạo ticket thiếu mô tả sự cố bị chặn (server tự xác minh)', async () => {
      const before = await page.evaluate(() => DB.itSupportTickets.length);
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        document.getElementById('itTicketCode').value = generateItTicketCode();
        document.getElementById('itTicketTitle').value = 'Không mở được email';
        document.getElementById('itTicketCategory').value = 'SOFTWARE';
        document.getElementById('itTicketDescription').value = '';
        await submitItTicket({ preventDefault() {}, target: { reset() {} } });
        return { alerts: window.__alerts, count: DB.itSupportTickets.length };
      });
      assertIncludes(result.alerts, 'Thiếu mô tả sự cố', 'Phải báo lỗi thiếu mô tả sự cố/yêu cầu');
      assertEqual(result.count, before, 'Không được tạo ticket khi thiếu mô tả');
    });

    // ===== 6) Đội Hỗ Trợ IT nhận xử lý (claim) ticket =====
    await run.run('Đội Hỗ Trợ IT nhận xử lý ticket (TODO -> DOING)', async () => {
      await loginAs(page, IT1);
      const result = await page.evaluate(async (id) => {
        switchTab('itSupport');
        setItSupportSubTab('TICKET');
        openItTicketModal(id);
        await claimItTicketAction();
        const t = DB.itSupportTickets.find(x => x.id === id);
        return { status: t.status, assigneeName: t.assigneeName };
      }, ticketDoneId);
      assertEqual(result.status, 'DOING', 'Ticket phải chuyển sang DOING sau khi được nhận xử lý');
      assertEqual(result.assigneeName, IT1.name, 'Phải ghi đúng người nhận xử lý');
    });

    // ===== 7) Leo thang phê duyệt -> người được chỉ định DUYỆT -> IT hoàn tất xử lý (workflow đầy đủ) =====
    await run.run('Leo thang phê duyệt: người được chỉ định DUYỆT rồi IT hoàn tất xử lý (DONE)', async () => {
      const escalateResult = await page.evaluate(async (id) => {
        showItTicketEscalateForm = true;
        renderItTicketModal();
        document.getElementById('itTicketApproverSelect').value = 'approver1';
        document.getElementById('itTicketApprovalReason').value = 'Cần xin ý kiến trước khi thay thế linh kiện đắt tiền';
        await escalateItTicketAction();
        const t = DB.itSupportTickets.find(x => x.id === id);
        return { approvalStatus: t.approvalStatus, approverName: t.approvalApproverName };
      }, ticketDoneId);
      assertEqual(escalateResult.approvalStatus, 'PENDING', 'Sau khi gửi yêu cầu, phê duyệt phải ở trạng thái PENDING');
      assertEqual(escalateResult.approverName, APPROVER1.name, 'Phải ghi đúng người được chỉ định phê duyệt');

      await loginAs(page, APPROVER1);
      const approveResult = await page.evaluate(async (id) => {
        // LƯU Ý: canViewItTicket() ở public/index.html chỉ cho admin/itManage/người tạo xem ticket trong
        // danh sách — KHÔNG có nhánh cho approvalApprover, nên người được chỉ định phê duyệt (như
        // approver1 ở đây) sẽ không tự thấy được ticket này qua renderItTickets() bình thường (xem ghi
        // chú "suspected bug" trong báo cáo cuối). Gọi thẳng openItTicketModal() để kiểm tra đúng hành
        // vi duyệt/từ chối (approveItTicketEscalation ở lib/recordActions.js) không phụ thuộc vào lỗ hổng UI đó.
        openItTicketModal(id);
        await approveItTicketEscalationAction();
        const t = DB.itSupportTickets.find(x => x.id === id);
        return { approvalStatus: t.approvalStatus, alerts: window.__alerts };
      }, ticketDoneId);
      assertEqual(approveResult.approvalStatus, 'APPROVED', 'Sau khi duyệt, trạng thái phê duyệt phải là APPROVED');
      assertIncludes(approveResult.alerts, 'Đã duyệt yêu cầu phê duyệt', 'Phải có thông báo duyệt thành công');

      await loginAs(page, IT1);
      const doneResult = await page.evaluate(async (id) => {
        openItTicketModal(id);
        document.getElementById('itTicketUpdateStatus').value = 'DONE';
        document.getElementById('itTicketUpdateNote').value = 'Đã thay nguồn máy tính, hoạt động bình thường.';
        await updateItTicketStatusAction();
        const t = DB.itSupportTickets.find(x => x.id === id);
        return { status: t.status, resolutionNote: t.resolutionNote };
      }, ticketDoneId);
      assertEqual(doneResult.status, 'DONE', 'Sau khi được duyệt, IT phải cập nhật hoàn tất được (DONE)');
      assertEqual(doneResult.resolutionNote, 'Đã thay nguồn máy tính, hoạt động bình thường.', 'Phải lưu đúng ghi chú xử lý');
    });

    // ===== 8) Leo thang phê duyệt bị TỪ CHỐI -> IT vẫn bị chặn cập nhật tiến độ (server chặn kép) =====
    await run.run('Leo thang phê duyệt bị từ chối: server vẫn chặn cập nhật trạng thái ticket cho tới khi gửi lại', async () => {
      await loginAs(page, PLAIN);
      const created = await page.evaluate(async () => {
        window.__resetCapture();
        document.getElementById('itTicketCode').value = generateItTicketCode();
        document.getElementById('itTicketTitle').value = 'Wifi công ty chập chờn';
        document.getElementById('itTicketCategory').value = 'NETWORK';
        document.getElementById('itTicketDescription').value = 'Mất kết nối liên tục mỗi 10 phút ở khu vực kế toán.';
        await submitItTicket({ preventDefault() {}, target: { reset() {} } });
        return DB.itSupportTickets[0].id;
      });
      ticketDeniedId = created;

      await loginAs(page, IT1);
      await page.evaluate(async (id) => {
        openItTicketModal(id);
        await claimItTicketAction();
        showItTicketEscalateForm = true;
        renderItTicketModal();
        document.getElementById('itTicketApproverSelect').value = 'approver1';
        document.getElementById('itTicketApprovalReason').value = 'Cần duyệt ngân sách thuê đơn vị khảo sát mạng';
        await escalateItTicketAction();
      }, ticketDeniedId);

      await loginAs(page, APPROVER1);
      const denyResult = await page.evaluate(async (id) => {
        openItTicketModal(id);
        window.__promptAnswer = 'Chưa đủ ngân sách quý này, tạm xử lý bằng biện pháp khác';
        await denyItTicketEscalationAction();
        const t = DB.itSupportTickets.find(x => x.id === id);
        return { approvalStatus: t.approvalStatus, approvalComment: t.approvalComment };
      }, ticketDeniedId);
      assertEqual(denyResult.approvalStatus, 'REJECTED', 'Sau khi từ chối, trạng thái phê duyệt phải là REJECTED');
      assertEqual(denyResult.approvalComment, 'Chưa đủ ngân sách quý này, tạm xử lý bằng biện pháp khác', 'Phải lưu đúng lý do từ chối');

      await loginAs(page, IT1);
      const blockedResult = await page.evaluate(async (id) => {
        // Giao diện KHÔNG hiện khối "Cập Nhật Xử Lý" khi blockedByRejection (xem renderItTicketModal()),
        // nên gọi thẳng callRecordAction() như UI sẽ làm nếu có nút — kiểm tra server tự chặn ĐỘC LẬP
        // với UI (đúng triết lý "server tự xác minh lại" xuyên suốt hệ thống).
        try {
          await callRecordAction('itSupportTickets', id, 'update-status', { status: 'DONE', resolutionNote: 'x' });
          return { threw: null };
        } catch (e) {
          return { threw: e.message };
        }
      }, ticketDeniedId);
      assertIncludes(blockedResult.threw, 'Đang chờ hoặc chưa được phê duyệt', 'Server phải tiếp tục chặn cập nhật trạng thái khi phê duyệt bị từ chối');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-it-support.js:', err);
  process.exitCode = 1;
});
