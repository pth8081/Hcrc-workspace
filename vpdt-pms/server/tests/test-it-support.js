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
//     Đợt 2: bỏ hẳn khái niệm giá cũ/giá mới — mỗi dòng chỉ còn 1 object `values` generic (key = key
//     cột trong Mẫu Giá), không còn field name/newPrice/oldPrice/code cố định nào.
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
const EMERGENCY_APPROVER = { username: 'emg1', name: 'Người Xét Từ Chối Khẩn', dept: 'Ban Giám Đốc', perms: { itPriceEmergencyRejectApprove: true }, active: true };
// ===== Bổ sung cho mục 1/5/6 kế hoạch (2 sub-tab loại giá + khoá khẩn cấp lúc IT đang xử lý) =====
// Phòng "Marketing" dùng cấu hình itPriceDeptWorkflows LỒNG MỚI (RETAIL/WHOLESALE tách riêng người
// duyệt) — khác "Kinh Doanh" ở trên CỐ Ý giữ NGUYÊN dạng phẳng CŨ để làm bằng chứng cho test tương
// thích ngược (mục 6: cấu hình cũ phải resolve đúng thành RETAIL, không throw, không cần migrate).
const STAFF_MKT = { username: 'staff_mkt', name: 'Trần Thị Marketing', dept: 'Marketing', perms: { itPriceProposeCreate: true }, active: true };
const RETAIL_APPROVER_MKT = { username: 'retail_appr_mkt', name: 'Người Duyệt Bán Lẻ MKT', dept: 'Marketing', perms: {}, active: true };
const WHOLESALE_APPROVER_MKT = { username: 'wholesale_appr_mkt', name: 'Người Duyệt Bán Buôn MKT', dept: 'Marketing', perms: {}, active: true };
// admin KHÔNG bật TOTP (mock, không đi qua luồng TOTP thật) — dùng riêng cho kịch bản xác nhận khoá
// "🚨 Từ Chối Khẩn" áp dụng cho CẢ ADMIN khi IT đang xử lý (mục 5 kế hoạch).
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };

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
  depts: ['Kinh Doanh', 'IT', 'Ban Giám Đốc', 'Marketing'],
  users: [STAFF_KD, IT1, APPROVER1, PLAIN, EMERGENCY_APPROVER, STAFF_MKT, RETAIL_APPROVER_MKT, WHOLESALE_APPROVER_MKT, ADMIN],
  itPriceMasterLists: [MASTER_LIST],
  // Bỏ auto-approve -> mọi đề xuất phải qua đúng 1 bước duyệt phòng ban trước khi đội IT áp giá.
  // 'Kinh Doanh' CỐ Ý giữ cấu trúc PHẲNG CŨ (approver1 là người duyệt bước 1) — dùng làm bằng chứng
  // "cấu hình cũ vẫn resolve đúng thành RETAIL" (mục 6 kế hoạch, KHÔNG cần migrate dữ liệu).
  // 'Marketing' dùng cấu trúc LỒNG MỚI, 2 người duyệt TÁCH RIÊNG theo loại giá (mục 1/6 kế hoạch).
  itPriceDeptWorkflows: {
    'Kinh Doanh': { workflowId: 'wf-kd-price', approvers: { 1: ['approver1'] } },
    'Marketing': {
      RETAIL: { workflowId: 'wf-mkt-retail', approvers: { 1: ['retail_appr_mkt'] } },
      WHOLESALE: { workflowId: 'wf-mkt-wholesale', approvers: { 1: ['wholesale_appr_mkt'] } }
    }
  },
  workflows: [
    { id: 'wf-kd-price', steps: [{ order: 1, name: 'Trưởng Phòng Duyệt' }] },
    { id: 'wf-mkt-retail', steps: [{ order: 1, name: 'Duyệt Bán Lẻ' }] },
    { id: 'wf-mkt-wholesale', steps: [{ order: 1, name: 'Duyệt Bán Buôn' }] }
  ]
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
  let emergencyPriceApprovalId = null;

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
          items: [{ values: { code: 'SP001', name: 'Mì gói Hảo Hảo', oldPrice: '5000', newPrice: '5500' } }],
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
          items: [{ values: { code: 'SP001', name: 'Mì gói Hảo Hảo', oldPrice: '5000', newPrice: '5500' } }],
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

    // ===== 9) "Từ chối khẩn cấp" — người đã duyệt bước cuối cùng đổi ý SAU khi duyệt, TRƯỚC khi IT áp
    // giá thật, gửi yêu cầu cho người có quyền itPriceEmergencyRejectApprove xét duyệt (xem
    // requestItPriceEmergencyReject()/approveItPriceEmergencyReject()/denyItPriceEmergencyReject() ở
    // lib/recordActions.js). Dùng 1 đề xuất RIÊNG (không phải priceApprovalId đã bị áp giá ở kịch bản 3).
    await run.run('Từ chối khẩn cấp: chỉ đúng người đã duyệt bước cuối mới gửi được yêu cầu, người khác bị chặn', async () => {
      await loginAs(page, STAFF_KD);
      const created = await page.evaluate(async () => {
        window.__resetCapture();
        switchTab('itSupport');
        setItSupportSubTab('PRICE');
        document.getElementById('itPriceCode').value = generateItPriceCode();
        document.getElementById('itPriceMasterListSelect').value = String(1);
        document.getElementById('itPriceReason').value = 'Điều chỉnh giá đợt 2';
        itPricePendingFile = {
          fileUrl: '/uploads/gia-de-xuat-2.xlsx', fileName: 'gia-de-xuat-2.xlsx',
          items: [{ values: { code: 'SP002', name: 'Bánh Chocopie', oldPrice: '10000', newPrice: '11000' } }],
          columnLabels: [
            { key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' },
            { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }
          ]
        };
        await submitItPriceApproval({ preventDefault() {}, target: { reset() {} } });
        return DB.itPriceApprovals[0].id;
      });
      emergencyPriceApprovalId = created;

      await loginAs(page, APPROVER1);
      await page.evaluate(async (id) => { await approveItPriceConfirmed(id); }, emergencyPriceApprovalId);

      // Người KHÔNG phải người duyệt bước cuối (IT1) không thấy nút, và server phải chặn nếu cố gọi thẳng.
      await loginAs(page, IT1);
      const blockedNonApprover = await page.evaluate(async (id) => {
        openItPriceModal(id);
        const hasButton = document.getElementById('itPriceModalControls').innerHTML.includes('requestItPriceEmergencyRejectAction');
        try {
          await callRecordAction('itPriceApprovals', id, 'request-emergency-reject', { reason: 'thử trái phép' });
          return { hasButton, threw: null };
        } catch (e) {
          return { hasButton, threw: e.message };
        }
      }, emergencyPriceApprovalId);
      assertEqual(blockedNonApprover.hasButton, false, 'Người KHÔNG duyệt bước cuối không được thấy nút Từ Chối Khẩn');
      assertIncludes(blockedNonApprover.threw, 'Chỉ người đã duyệt bước cuối cùng', 'Server phải chặn người không phải người duyệt bước cuối gửi yêu cầu từ chối khẩn cấp');

      // Đúng người đã duyệt bước cuối (approver1) gửi yêu cầu -> PENDING, khoá claim-apply của IT.
      await loginAs(page, APPROVER1);
      const requested = await page.evaluate(async (id) => {
        openItPriceModal(id);
        window.__promptAnswer = 'Phát hiện giá mới tính sai, cần dừng lại trước khi áp dụng';
        await requestItPriceEmergencyRejectAction(id);
        const item = DB.itPriceApprovals.find(x => x.id === id);
        return { status: item.emergencyRejectStatus, reason: item.emergencyRejectReason, requestedByName: item.emergencyRejectRequestedByName };
      }, emergencyPriceApprovalId);
      assertEqual(requested.status, 'PENDING', 'Yêu cầu Từ chối khẩn cấp phải chuyển emergencyRejectStatus sang PENDING');
      assertEqual(requested.reason, 'Phát hiện giá mới tính sai, cần dừng lại trước khi áp dụng', 'Phải lưu đúng lý do từ chối khẩn cấp');
      assertEqual(requested.requestedByName, APPROVER1.name, 'Phải ghi đúng người gửi yêu cầu');

      await loginAs(page, IT1);
      const blockedApply = await page.evaluate(async (id) => {
        try {
          await callRecordAction('itPriceApprovals', id, 'claim-apply', {});
          return { threw: null };
        } catch (e) {
          return { threw: e.message };
        }
      }, emergencyPriceApprovalId);
      assertIncludes(blockedApply.threw, 'Đang có yêu cầu từ chối khẩn cấp', 'Server phải khoá nhận xử lý áp giá trong lúc chờ xét duyệt Từ chối khẩn cấp');
    });

    await run.run('Từ chối khẩn cấp: người có quyền TỪ CHỐI yêu cầu -> hồ sơ trở lại bình thường, gửi lại được', async () => {
      await loginAs(page, EMERGENCY_APPROVER);
      const denied = await page.evaluate(async (id) => {
        openItPriceModal(id);
        window.__promptAnswer = 'Lý do chưa đủ thuyết phục, giữ nguyên giá đã duyệt';
        await denyItPriceEmergencyRejectAction(id);
        const item = DB.itPriceApprovals.find(x => x.id === id);
        return { status: item.status, emergencyStatus: item.emergencyRejectStatus, decidedByName: item.emergencyRejectDecidedByName };
      }, emergencyPriceApprovalId);
      assertEqual(denied.status, 'APPROVED', 'Bị từ chối yêu cầu Từ chối khẩn cấp thì hồ sơ chính vẫn giữ nguyên APPROVED');
      assertEqual(denied.emergencyStatus, 'DENIED', 'emergencyRejectStatus phải chuyển sang DENIED');
      assertEqual(denied.decidedByName, EMERGENCY_APPROVER.name, 'Phải ghi đúng người từ chối yêu cầu');

      // Gửi lại yêu cầu lần 2 vẫn được (không bị khoá vĩnh viễn sau khi bị từ chối 1 lần).
      await loginAs(page, APPROVER1);
      const requestedAgain = await page.evaluate(async (id) => {
        openItPriceModal(id);
        window.__promptAnswer = 'Vẫn muốn dừng lại, đã xác minh lại số liệu';
        await requestItPriceEmergencyRejectAction(id);
        return DB.itPriceApprovals.find(x => x.id === id).emergencyRejectStatus;
      }, emergencyPriceApprovalId);
      assertEqual(requestedAgain, 'PENDING', 'Phải gửi lại được yêu cầu Từ chối khẩn cấp sau khi lần trước bị từ chối');
    });

    await run.run('Từ chối khẩn cấp: người có quyền DUYỆT -> hồ sơ chuyển REJECTED giống từ chối bước thường', async () => {
      await loginAs(page, EMERGENCY_APPROVER);
      const approved = await page.evaluate(async (id) => {
        openItPriceModal(id);
        await approveItPriceEmergencyRejectAction(id);
        const item = DB.itPriceApprovals.find(x => x.id === id);
        return {
          status: item.status,
          emergencyStatus: item.emergencyRejectStatus,
          lastHistory: item.history[item.history.length - 1]
        };
      }, emergencyPriceApprovalId);
      assertEqual(approved.status, 'REJECTED', 'Duyệt yêu cầu Từ chối khẩn cấp phải chuyển hồ sơ chính sang REJECTED');
      assertEqual(approved.emergencyStatus, 'APPROVED', 'emergencyRejectStatus phải chuyển sang APPROVED');
      assertEqual(approved.lastHistory.action, 'REJECTED', 'Dòng lịch sử cuối phải là REJECTED — hiển thị giống hệt bị từ chối ở bước duyệt bình thường');

      // Không thể nhận xử lý áp giá / gửi thêm yêu cầu từ chối khẩn nữa vì hồ sơ đã không còn APPROVED.
      await loginAs(page, IT1);
      const blockedAfterReject = await page.evaluate(async (id) => {
        try {
          await callRecordAction('itPriceApprovals', id, 'claim-apply', {});
          return { threw: null };
        } catch (e) {
          return { threw: e.message };
        }
      }, emergencyPriceApprovalId);
      assertIncludes(blockedAfterReject.threw, 'chưa được phê duyệt xong', 'Sau khi đã REJECTED, không thể nhận xử lý áp giá nữa');
    });

    // ===== 10) 2 sub-tab "Bán Lẻ"/"Bán Buôn" (mục 1 kế hoạch): tạo đúng priceType theo sub-tab đang
    // mở, lọc đúng danh sách theo sub-tab, VÀ mỗi loại giá có người duyệt RIÊNG (cấu hình LỒNG mới của
    // dept "Marketing", mục 6) — người duyệt Bán Lẻ không duyệt được hồ sơ Bán Buôn và ngược lại. =====
    let mktRetailId = null, mktWholesaleId = null;
    await run.run('Sub-tab Bán Lẻ/Bán Buôn: tạo đúng priceType theo sub-tab đang mở, lọc đúng danh sách theo sub-tab', async () => {
      await loginAs(page, STAFF_MKT);
      const created = await page.evaluate(async () => {
        switchTab('itSupport');
        setItSupportSubTab('PRICE');

        setItPriceSubTab('RETAIL');
        document.getElementById('itPriceMasterListSelect').value = String(1);
        document.getElementById('itPriceReason').value = 'Điều chỉnh giá bán lẻ Marketing';
        itPricePendingFile = {
          fileUrl: '/uploads/gia-mkt-retail.xlsx', fileName: 'gia-mkt-retail.xlsx',
          items: [{ values: { code: 'MK001', name: 'Sản phẩm MKT', oldPrice: '1000', newPrice: '1200' } }],
          columnLabels: [
            { key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' },
            { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }
          ]
        };
        await submitItPriceApproval({ preventDefault() {}, target: { reset() {} } });
        const retailItem = DB.itPriceApprovals[0];

        setItPriceSubTab('WHOLESALE');
        document.getElementById('itPriceMasterListSelect').value = String(1);
        document.getElementById('itPriceReason').value = 'Điều chỉnh giá bán buôn Marketing';
        itPricePendingFile = {
          fileUrl: '/uploads/gia-mkt-wholesale.xlsx', fileName: 'gia-mkt-wholesale.xlsx',
          items: [{ values: { code: 'MK001', name: 'Sản phẩm MKT', oldPrice: '900', newPrice: '1000' } }],
          columnLabels: [
            { key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' },
            { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }
          ]
        };
        await submitItPriceApproval({ preventDefault() {}, target: { reset() {} } });
        const wholesaleItem = DB.itPriceApprovals[0];

        // Đang ở sub-tab WHOLESALE -> danh sách chỉ hiện hồ sơ WHOLESALE.
        setItPriceSubTab('WHOLESALE');
        const wholesaleTabCodes = Array.from(document.querySelectorAll('#itPriceTableBody tr')).map(tr => tr.querySelector('td')?.innerText);
        setItPriceSubTab('RETAIL');
        const retailTabCodes = Array.from(document.querySelectorAll('#itPriceTableBody tr')).map(tr => tr.querySelector('td')?.innerText);

        return { retailItem, wholesaleItem, wholesaleTabCodes, retailTabCodes };
      });
      mktRetailId = created.retailItem.id;
      mktWholesaleId = created.wholesaleItem.id;
      assertEqual(created.retailItem.priceType, 'RETAIL', 'Đề xuất tạo lúc sub-tab Bán Lẻ đang mở phải gắn priceType RETAIL');
      assertEqual(created.wholesaleItem.priceType, 'WHOLESALE', 'Đề xuất tạo lúc sub-tab Bán Buôn đang mở phải gắn priceType WHOLESALE');
      assert(created.wholesaleTabCodes.includes(created.wholesaleItem.code), 'Sub-tab Bán Buôn phải hiện đúng hồ sơ WHOLESALE vừa tạo');
      assert(!created.wholesaleTabCodes.includes(created.retailItem.code), 'Sub-tab Bán Buôn KHÔNG được hiện hồ sơ RETAIL');
      assert(created.retailTabCodes.includes(created.retailItem.code), 'Sub-tab Bán Lẻ phải hiện đúng hồ sơ RETAIL vừa tạo');
      assert(!created.retailTabCodes.includes(created.wholesaleItem.code), 'Sub-tab Bán Lẻ KHÔNG được hiện hồ sơ WHOLESALE');
    });

    await run.run('Cấu hình lồng dept×priceType: người duyệt Bán Lẻ KHÔNG duyệt được hồ sơ Bán Buôn (và ngược lại)', async () => {
      // retail_appr_mkt (chỉ được gán cho nhánh RETAIL của Marketing) thử duyệt hồ sơ WHOLESALE -> chặn.
      await loginAs(page, RETAIL_APPROVER_MKT);
      const blockedRetailOnWholesale = await page.evaluate(async (id) => {
        try {
          await callWorkflowAction('itPriceApprovals', id, 'approve', {});
          return { threw: null };
        } catch (e) {
          return { threw: e.message };
        }
      }, mktWholesaleId);
      assertIncludes(blockedRetailOnWholesale.threw, 'Bạn không có quyền xử lý ở bước hiện tại', 'Người duyệt Bán Lẻ không được duyệt hồ sơ Bán Buôn của cùng phòng ban');

      // wholesale_appr_mkt thử duyệt hồ sơ RETAIL -> cũng chặn tương tự (đối xứng 2 chiều).
      await loginAs(page, WHOLESALE_APPROVER_MKT);
      const blockedWholesaleOnRetail = await page.evaluate(async (id) => {
        try {
          await callWorkflowAction('itPriceApprovals', id, 'approve', {});
          return { threw: null };
        } catch (e) {
          return { threw: e.message };
        }
      }, mktRetailId);
      assertIncludes(blockedWholesaleOnRetail.threw, 'Bạn không có quyền xử lý ở bước hiện tại', 'Người duyệt Bán Buôn không được duyệt hồ sơ Bán Lẻ của cùng phòng ban');

      // Đúng người được gán mới duyệt được: retail_appr_mkt duyệt RETAIL, wholesale_appr_mkt duyệt WHOLESALE.
      await loginAs(page, RETAIL_APPROVER_MKT);
      const retailApproved = await page.evaluate(async (id) => {
        const r = await callWorkflowAction('itPriceApprovals', id, 'approve', {});
        return r.item.status;
      }, mktRetailId);
      assertEqual(retailApproved, 'APPROVED', 'Đúng người duyệt Bán Lẻ phải duyệt được hồ sơ Bán Lẻ');

      await loginAs(page, WHOLESALE_APPROVER_MKT);
      const wholesaleApproved = await page.evaluate(async (id) => {
        const r = await callWorkflowAction('itPriceApprovals', id, 'approve', {});
        return r.item.status;
      }, mktWholesaleId);
      assertEqual(wholesaleApproved, 'APPROVED', 'Đúng người duyệt Bán Buôn phải duyệt được hồ sơ Bán Buôn');
    });

    // ===== 11) Hồ sơ CŨ (mock trực tiếp, KHÔNG có field priceType) vẫn lọc đúng vào sub-tab Bán Lẻ
    // (mục 1/2 kế hoạch: fallback '|| RETAIL', không cần script migrate dữ liệu). =====
    await run.run('Hồ sơ cũ không có priceType vẫn hiện đúng ở sub-tab Bán Lẻ (fallback RETAIL)', async () => {
      await loginAs(page, ADMIN);
      const result = await page.evaluate(() => {
        const legacyItem = {
          id: 999001, code: 'ITP-LEGACY-1', dept: 'Kinh Doanh',
          creator: 'staff_kd', creatorName: 'Ngô Văn Kinh Doanh',
          status: 'APPROVED', currentStep: 1, history: [], infoRequests: [],
          applied: false, applyClaimedBy: null,
          files: [{ id: 111, fileUrl: '/uploads/legacy-gia.xlsx', fileName: 'legacy-gia.xlsx', columnLabels: [{ key: 'c0', label: 'Dữ liệu' }], items: [] }],
          createdAt: new Date().toLocaleString('vi-VN')
          // KHÔNG có field priceType — đúng hình dạng hồ sơ tạo trước khi tính năng này ra đời.
        };
        DB.itPriceApprovals.unshift(legacyItem);
        switchTab('itSupport');
        setItSupportSubTab('PRICE');
        setItPriceSubTab('RETAIL');
        const retailCodes = Array.from(document.querySelectorAll('#itPriceTableBody tr')).map(tr => tr.querySelector('td')?.innerText);
        setItPriceSubTab('WHOLESALE');
        const wholesaleCodes = Array.from(document.querySelectorAll('#itPriceTableBody tr')).map(tr => tr.querySelector('td')?.innerText);
        // resolveApprovedFileUrlClient() phải fallback đúng về file cuối cùng (không có approvedFileId).
        const approvedFileUrl = resolveApprovedFileUrlClient(legacyItem);
        return { retailCodes, wholesaleCodes, approvedFileUrl };
      });
      assert(result.retailCodes.includes('ITP-LEGACY-1'), 'Hồ sơ cũ (không priceType) phải hiện ở sub-tab Bán Lẻ');
      assert(!result.wholesaleCodes.includes('ITP-LEGACY-1'), 'Hồ sơ cũ (không priceType) KHÔNG được hiện ở sub-tab Bán Buôn');
      assertEqual(result.approvedFileUrl, '/uploads/legacy-gia.xlsx', 'Fallback file đã duyệt của hồ sơ cũ phải là file cuối cùng (không có approvedFileId + chưa từng có yêu cầu bổ sung từ IT)');
      // Dọn lại state cho các kịch bản sau (không ảnh hưởng test khác dùng DB.itPriceApprovals[0]).
      await page.evaluate(() => { DB.itPriceApprovals = DB.itPriceApprovals.filter(x => x.id !== 999001); });
    });

    // ===== 12) Khoá "🚨 Từ Chối Khẩn" khi IT đang xử lý (applyClaimedBy có giá trị) — ÁP DỤNG CHO
    // MỌI NGƯỜI, KỂ CẢ ADMIN (mục 5 kế hoạch, không có nhánh admin bypass nào). =====
    await run.run('Từ Chối Khẩn bị khoá khi IT đang "Tôi đang xử lý" — kể cả tài khoản admin', async () => {
      // IT claim xử lý hồ sơ Bán Lẻ Marketing đã APPROVED ở kịch bản 10.
      await loginAs(page, IT1);
      await page.evaluate(async (id) => { await claimPriceApplyAction(id); }, mktRetailId);

      // retail_appr_mkt (người duyệt bước cuối, đủ điều kiện isFinalStepApproverOfItPrice) — nút phải ẩn
      // + server phải chặn nếu cố gọi thẳng API.
      await loginAs(page, RETAIL_APPROVER_MKT);
      const blockedApprover = await page.evaluate(async (id) => {
        openItPriceModal(id);
        const html = document.getElementById('itPriceModalControls').innerHTML;
        const hasButton = html.includes('requestItPriceEmergencyRejectAction');
        const hasLockedNote = html.includes('đang xử lý áp giá');
        try {
          await callRecordAction('itPriceApprovals', id, 'request-emergency-reject', { reason: 'thử trong lúc IT đang xử lý' });
          return { hasButton, hasLockedNote, threw: null };
        } catch (e) {
          return { hasButton, hasLockedNote, threw: e.message };
        }
      }, mktRetailId);
      assertEqual(blockedApprover.hasButton, false, 'Nút Từ Chối Khẩn phải ẨN với người duyệt bước cuối khi IT đang xử lý');
      assert(blockedApprover.hasLockedNote, 'Giao diện phải hiện ghi chú tạm khoá vì IT đang xử lý');
      assertIncludes(blockedApprover.threw, 'Không thể từ chối khẩn cấp khi IT đang xử lý áp giá', 'Server phải chặn cứng request-emergency-reject khi applyClaimedBy có giá trị');

      // admin — ĐÚNG TRỌNG TÂM mục 5: không có nhánh nào cho admin bỏ qua chặn applyClaimedBy này.
      await loginAs(page, ADMIN);
      const blockedAdmin = await page.evaluate(async (id) => {
        openItPriceModal(id);
        const html = document.getElementById('itPriceModalControls').innerHTML;
        const hasButton = html.includes('requestItPriceEmergencyRejectAction');
        try {
          await callRecordAction('itPriceApprovals', id, 'request-emergency-reject', { reason: 'admin thử trong lúc IT đang xử lý' });
          return { hasButton, threw: null };
        } catch (e) {
          return { hasButton, threw: e.message };
        }
      }, mktRetailId);
      assertEqual(blockedAdmin.hasButton, false, 'Nút Từ Chối Khẩn phải ẨN với admin khi IT đang xử lý (không có bypass)');
      assertIncludes(blockedAdmin.threw, 'Không thể từ chối khẩn cấp khi IT đang xử lý áp giá', 'Server phải chặn cứng request-emergency-reject với admin y hệt người thường — không có nhánh bypass');

      // Sau khi IT huỷ nhận việc (release), Từ Chối Khẩn phải gửi được lại bình thường (không khoá vĩnh viễn).
      await loginAs(page, IT1);
      await page.evaluate(async (id) => { await callRecordAction('itPriceApprovals', id, 'release-apply-claim', {}); }, mktRetailId);
      await loginAs(page, RETAIL_APPROVER_MKT);
      const unblockedAfterRelease = await page.evaluate(async (id) => {
        openItPriceModal(id);
        const hasButton = document.getElementById('itPriceModalControls').innerHTML.includes('requestItPriceEmergencyRejectAction');
        return { hasButton };
      }, mktRetailId);
      assert(unblockedAfterRelease.hasButton, 'Sau khi IT huỷ nhận việc (release-apply-claim), nút Từ Chối Khẩn phải hiện lại bình thường');
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
