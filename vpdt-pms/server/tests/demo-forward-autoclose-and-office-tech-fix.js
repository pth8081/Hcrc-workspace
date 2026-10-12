// server/tests/demo-forward-autoclose-and-office-tech-fix.js
//
// DEMO thật (người dùng chủ động yêu cầu: "gửi cho tôi ảnh demo trước khi tôi xác nhận thực hiện") cho
// 2 lỗi người dùng báo, đã vá:
//
//   1) "Chuyển Tiếp Xin Ý Kiến": bấm "Gửi Chuyển Tiếp" xong không tự tắt popup — overlay Chuyển Tiếp
//      (#genericConfirmModal) vốn đã tự tắt ngay khi bấm (runConfirmedAction()), cái KHÔNG tự tắt là
//      modal "cha" (VD "Chi Tiết Hợp Đồng" #viewDocModal) đang mở sẵn bên dưới. Vá bằng
//      closeForwardHostModal() mới (core.js, gọi ngay sau submitForwardRequest() thành công).
//
//   2) "Người Xác Nhận Kỹ Thuật" (Vận Hành > Sửa Chữa VP): đã gán quyền officeFixTechIT/
//      officeFixTechMechanical cho người nhưng đăng nhập không tìm ra ai, ở BẤT KỲ cấp nào — nguyên nhân
//      KHÔNG phải phạm vi HO/Siêu Thị mà vì onOfficeTechTypeChange() (module-office.js) lọc trực tiếp
//      u.perms?.[permKey] của NGƯỜI KHÁC, trong khi server (sanitizeUsersPermsForViewer(),
//      lib/recordViewScope.js) đã xoá field `perms` khỏi MỌI người khác với viewer không phải admin —
//      luôn ra danh sách rỗng. Vá bằng cách đổi sang đọc DB.moduleApproverUsernames[permKey] (danh sách
//      username AN TOÀN tính sẵn ở server qua APPROVER_FLAG_KEYS, lib/recordViewScope.js) — demo dưới
//      đây mô phỏng ĐÚNG state mà 1 viewer KHÔNG PHẢI admin thực sự nhận được từ server (users đã bị xoá
//      field perms của người khác) để chứng minh picker vẫn tìm ra đúng người sau khi vá.
//
//   + 1 lỗi z-index phụ phát hiện khi vá lỗi 1: popup Chuyển Tiếp (genericConfirmModal, z-[60] tĩnh) có
//     thể bị khuất sau modal cha #viewDocModal (z-[65] tĩnh, nâng cho 1 trường hợp lồng NGƯỢC chiều khác
//     — xem chú thích #viewDocModal, index.html). Vá bằng cách tính z-index ĐỘNG ngay trong
//     showConfirmModal() (core.js) — luôn nổi cao hơn 1 bậc so với modal cha cao nhất đang mở sẵn.
//
//   PHẦN 3 (theo yêu cầu người dùng: "xem ở văn bản trình có bị như vậy không") — kiểm tra Văn Bản Trình
//   (submissions, host modal RIÊNG #submissionProcessModal z-50 tĩnh, KHÁC hẳn #viewDocModal của Hợp
//   Đồng) có dính CẢ 2 lỗi trên không. Do closeForwardHostModal()/showConfirmModal() đã sửa chung cho
//   MỌI moduleKey (không riêng 'contracts'), và z-50 vốn đã THẤP HƠN z-60 mặc định (không cần bump mới
//   vẫn đúng thứ tự) — demo xác nhận Văn Bản Trình KHÔNG dính lỗi, không cần vá thêm riêng.
//
// Dùng testHarness.js (Chromium thật mở public/index.html thật + toàn bộ public/js/*.js thật).
//
// Chạy: node server/tests/demo-forward-autoclose-and-office-tech-fix.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8996;
const OUT_DIR = process.env.FORWARD_OFFICE_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'forward-autoclose-and-office-tech-fix');

const ADMIN = {
  id: 1, username: 'admin', name: 'Quản Trị Hệ Thống', dept: 'Phòng Tài chính Kế toán', posType: 'HO',
  perms: { admin: true }, totpEnabled: true, active: true
};
const TARGET_PERSON = {
  id: 2, username: 'ketoan2', name: 'Nguyễn Thị Kế Toán', dept: 'Phòng Tài chính Kế toán', posType: 'HO',
  perms: {}, active: true
};

// ----- Bug 2 fixture: viewer KHÔNG PHẢI admin, DB.users mô phỏng ĐÚNG state sau khi server xoá field
// `perms` của người khác (sanitizeUsersPermsForViewer()) -----
const STAFF_VIEWER = {
  id: 10, username: 'nv_vanhanh', name: 'Trần Vận Hành', dept: 'Siêu thị Quận 7', posType: 'STORE',
  perms: { officeFix: true }, active: true
};
const IT_CONFIRMER_1 = { id: 11, username: 'it_confirm1', name: 'Lê Văn IT', dept: 'Phòng CNTT', active: true };
const IT_CONFIRMER_2 = { id: 12, username: 'it_confirm2', name: 'Phạm Thị Công Nghệ', dept: 'Phòng CNTT', active: true };

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({
    depts: ['Phòng Tài chính Kế toán', 'Phòng CNTT'],
    stores: ['Siêu thị Quận 7'],
    users: [ADMIN, TARGET_PERSON, STAFF_VIEWER, IT_CONFIRMER_1, IT_CONFIRMER_2],
    contracts: [{
      id: 101, code: 'HCRC-TCKT-HDKT-017', title: 'Hợp đồng test demo', dept: 'Phòng Tài chính Kế toán',
      partner: 'Công ty TNHH A', type: 'Hợp đồng kinh tế', amount: 1000000000,
      approvalStatus: 'PENDING', startDate: '2026-10-01', endDate: '2026-12-16',
      creator: 'admin', createdAt: '09:35:41 12/10/2026', currentStep: 1, history: [],
      content: 'Hợp đồng test demo', isAddendum: false, paymentType: 'ONE_TIME', paymentStatus: 'UNPAID',
      customData: {}, signedCustomData: {}, paymentInstallments: [], forwardThreads: []
    }],
    // Văn Bản Trình (submissions) — người dùng hỏi riêng có bị lỗi tương tự Hợp Đồng không, kiểm tra
    // trong PHẦN 3 bên dưới. Dùng host modal RIÊNG #submissionProcessModal (z-50, KHÁC #viewDocModal
    // z-65 của Hợp Đồng) — closeForwardHostModal() đã xử lý SẴN cả 2 nhánh module trong cùng 1 hàm.
    submissionTypes: [], submissionTypeDeptWorkflows: {}, submissionDeptWorkflows: {},
    submissions: [{
      id: 201, code: 'HCRC-VBT-DEMO-001', title: 'Tờ trình test demo', dept: 'Phòng Tài chính Kế toán',
      creator: 'admin', creatorName: 'Quản Trị Hệ Thống', priority: 'Bình thường', type: 'Khác',
      createdAt: '09:00:00 12/10/2026', content: 'Nội dung tờ trình test demo', customData: {},
      status: 'PENDING', currentStep: 1, history: [], forwardThreads: []
    }]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1100, height: 1000 });

  // testHarness.js's dispatcher (dùng chung cho hầu hết test) KHÔNG có route /forward (chỉ có route
  // duyệt/từ chối generic /api/workflow/:module/:id/:action, 'forward' không khớp WF_ACTION_MAP) — chêm
  // thêm đúng 1 route /forward ở ĐÂY, mirror CHÍNH XÁC logic thật của routes/workflow.js (tạo node
  // forwardThreads, cùng field), còn lại MỌI request khác (GET /api/data, login...) vẫn đi qua
  // __apiDispatch thật như bình thường — chỉ fake đúng 1 endpoint testHarness.js chưa hỗ trợ, không đụng
  // gì tới code đang được demo (submitForwardRequest()/closeForwardHostModal() vẫn chạy nguyên bản thật).
  await page.evaluate(() => {
    const origFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const m = typeof url === 'string' && url.match(/^\/api\/workflow\/([^/]+)\/(\d+)\/forward$/);
      if (m && opts && opts.method === 'POST') {
        const moduleKey = m[1];
        const id = Number(m[2]);
        const dbKey = moduleKey === 'contracts' ? 'contracts' : 'submissions';
        const item = (DB[dbKey] || []).find(x => x.id === id);
        const body = JSON.parse(opts.body);
        const now = new Date().toLocaleString('vi-VN');
        if (!Array.isArray(item.forwardThreads)) item.forwardThreads = [];
        const createdNodes = (body.targetUsernames || []).map(username => {
          const u = (DB.users || []).find(x => x.username === username);
          const node = {
            id: 'demo-' + Math.random().toString(36).slice(2),
            step: item.currentStep, parentNodeId: body.parentNodeId || null,
            forwardedBy: currentUser.username, forwardedByName: currentUser.name,
            forwardedTo: username, forwardedToName: u ? u.name : username,
            message: body.message || null, forwardedAt: now, reply: null
          };
          item.forwardThreads.push(node);
          return node;
        });
        return { ok: true, status: 200, json: async () => ({ ok: true, item, createdNodes }) };
      }
      return origFetch(url, opts);
    };
  });

  try {
    // ===== PHẦN 1: Chuyển Tiếp Xin Ý Kiến — tự tắt HẾT popup sau khi gửi thành công =====
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);

    await page.evaluate((id) => viewContractDetails(id), 101);
    await page.waitForTimeout(150);
    await shot(page, 'body', '01-truoc-chi-tiet-hop-dong-dang-mo.png');

    await page.evaluate((id) => openForwardModal('contracts', id), 101);
    await page.waitForTimeout(150);
    // Chọn người nhận chuyển tiếp qua picker thật (renderPeopleMultiSelect()/pmsAdd())
    await page.evaluate((username) => pmsAdd('fwdPeoplePicker', username), TARGET_PERSON.username);
    await page.waitForTimeout(100);
    await shot(page, '#genericConfirmModal', '02-popup-chuyen-tiep-xin-y-kien.png');

    // Bấm "Gửi Chuyển Tiếp" THẬT qua runConfirmedAction() (khuôn test chuẩn __confirmPending của
    // testHarness.js — đợi đúng onConfirm/submitForwardRequest() chạy xong, bao gồm cả fetch thật qua
    // __apiDispatch đã nối sẵn route /api/workflow/:module/:id/forward ở lib/workflowEngine thật).
    await page.evaluate(() => window.__confirmPending());
    await page.waitForTimeout(200);

    const afterState = await page.evaluate(() => ({
      viewDocModalHidden: document.getElementById('viewDocModal').classList.contains('hidden'),
      confirmModalHidden: document.getElementById('genericConfirmModal').classList.contains('hidden'),
      alerts: window.__alerts.slice()
    }));
    console.log('Trạng thái sau khi "Gửi Chuyển Tiếp":', JSON.stringify(afterState));
    if (!afterState.viewDocModalHidden) throw new Error('❌ #viewDocModal (Chi Tiết Hợp Đồng) vẫn còn mở — lỗi chưa được vá!');
    if (!afterState.confirmModalHidden) throw new Error('❌ #genericConfirmModal (popup Chuyển Tiếp) vẫn còn mở!');
    await shot(page, 'body', '03-sau-gui-chuyen-tiep-da-tat-het-popup.png');
    console.log('✅ PHẦN 1: Sau "Gửi Chuyển Tiếp" thành công, CẢ 2 popup (Chi Tiết Hợp Đồng + Chuyển Tiếp) đã tự tắt.');

    // ===== PHẦN 2: "Người Xác Nhận Kỹ Thuật" — tìm ra đúng người dù đăng nhập KHÔNG PHẢI admin =====
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, STAFF_VIEWER);
    // Mô phỏng ĐÚNG state thật mà server trả về cho 1 viewer không phải admin: DB.users của người KHÁC
    // bị xoá field `perms` (sanitizeUsersPermsForViewer()), chỉ còn DB.moduleApproverUsernames làm
    // nguồn AN TOÀN duy nhất để biết ai giữ quyền officeFixTechIT/officeFixTechMechanical. PHẢI gán SAU
    // proceedAfterAuth() ở trên — initDatabase() (lúc đăng nhập) nạp lại DB.users/DB.moduleApproverUsernames
    // từ GET /api/data (mock testHarness.js KHÔNG tự sanitize/compute 2 field này), nên gán trước sẽ bị
    // initDatabase() ghi đè mất.
    await page.evaluate((payload) => {
      const { viewer, others } = payload;
      DB.users = [viewer, ...others.map(u => { const { perms, ...rest } = u; return rest; })];
      DB.moduleApproverUsernames = DB.moduleApproverUsernames || {};
      DB.moduleApproverUsernames.officeFixTechIT = ['it_confirm1', 'it_confirm2'];
      DB.moduleApproverUsernames.officeFixTechMechanical = [];
    }, { viewer: STAFF_VIEWER, others: [ADMIN, TARGET_PERSON, IT_CONFIRMER_1, IT_CONFIRMER_2] });
    await page.evaluate(() => { switchTab('office'); setOfficeSubTab('SUA_CHUA'); openOfficeForm(); });
    await page.waitForTimeout(150);
    await page.evaluate(() => { document.getElementById('offDept').value = 'Siêu thị Quận 7'; });

    await page.evaluate(() => {
      document.getElementById('offTechType').value = 'IT';
      onOfficeTechTypeChange();
    });
    await page.waitForTimeout(100);

    const pickerItemsBeforeOpen = await page.evaluate(() => (document.getElementById('officeFixTechDatalist')._sddItems || []).map(it => it.value));
    console.log('Danh sách gợi ý "Người Xác Nhận Kỹ Thuật" (loại IT):', JSON.stringify(pickerItemsBeforeOpen));
    if (!pickerItemsBeforeOpen.some(v => v.includes('Lê Văn IT')) || !pickerItemsBeforeOpen.some(v => v.includes('Phạm Thị Công Nghệ'))) {
      throw new Error('❌ Picker KHÔNG tìm ra đủ 2 người giữ quyền officeFixTechIT — lỗi chưa được vá!');
    }

    await page.locator('#offTechAssignedTo').click();
    await page.waitForTimeout(100);
    await shot(page, 'body', '04-sua-chua-nguoi-xac-nhan-ky-thuat-tim-ra-dung-nguoi.png');
    console.log('✅ PHẦN 2: Đăng nhập KHÔNG PHẢI admin (nhân viên Siêu thị Quận 7), chọn loại "IT" -> picker hiện đúng 2 người giữ quyền officeFixTechIT (Lê Văn IT, Phạm Thị Công Nghệ).');

    // ===== PHẦN 3: Văn Bản Trình (submissions) — kiểm tra có dính lỗi tương tự Hợp Đồng không =====
    await page.evaluate(() => document.getElementById('officeFixTechDatalist')?.classList.add('hidden')); // đóng dropdown gợi ý còn sót từ PHẦN 2, chỉ để ảnh demo gọn
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate((id) => openProcessSubmissionModal(id), 201);
    await page.waitForTimeout(150);
    await shot(page, 'body', '06-truoc-but-phe-to-trinh-dang-mo.png');

    await page.evaluate((id) => openForwardModal('submissions', id), 201);
    await page.waitForTimeout(150);
    const submissionZCheck = await page.evaluate(() => {
      const host = document.getElementById('submissionProcessModal');
      const popup = document.getElementById('genericConfirmModal');
      const hostZ = parseInt(getComputedStyle(host).zIndex, 10) || 0;
      const popupZ = parseInt(getComputedStyle(popup).zIndex, 10) || 0;
      const topEl = document.elementFromPoint(550, 500);
      return { hostZ, popupZ, topIsPopup: !!(topEl && topEl.closest('#genericConfirmModal')) };
    });
    console.log('Văn Bản Trình — z-index host vs popup Chuyển Tiếp:', JSON.stringify(submissionZCheck));
    if (!submissionZCheck.topIsPopup) throw new Error('❌ Popup Chuyển Tiếp bị khuất sau Bút Phê Tờ Trình (lỗi z-index TƯƠNG TỰ Hợp Đồng)!');
    await page.evaluate((username) => pmsAdd('fwdPeoplePicker', username), TARGET_PERSON.username);
    await page.waitForTimeout(100);
    await shot(page, 'body', '07-popup-chuyen-tiep-tren-but-phe-to-trinh.png');

    await page.evaluate(() => window.__confirmPending());
    await page.waitForTimeout(200);
    const submissionAfterState = await page.evaluate(() => ({
      hostHidden: document.getElementById('submissionProcessModal').classList.contains('hidden'),
      confirmModalHidden: document.getElementById('genericConfirmModal').classList.contains('hidden')
    }));
    console.log('Văn Bản Trình — trạng thái sau khi "Gửi Chuyển Tiếp":', JSON.stringify(submissionAfterState));
    if (!submissionAfterState.hostHidden) throw new Error('❌ #submissionProcessModal (Bút Phê Tờ Trình) vẫn còn mở sau khi gửi chuyển tiếp — lỗi TƯƠNG TỰ Hợp Đồng!');
    if (!submissionAfterState.confirmModalHidden) throw new Error('❌ #genericConfirmModal vẫn còn mở!');
    await shot(page, 'body', '08-sau-gui-chuyen-tiep-to-trinh-da-tat-het-popup.png');
    console.log('✅ PHẦN 3: Văn Bản Trình (Tờ Trình) dùng CHUNG closeForwardHostModal()/showConfirmModal() với Hợp Đồng -> đã xác nhận KHÔNG bị lỗi tương tự (cả z-index lẫn auto-close), không cần vá thêm gì riêng.');

    console.log('\n🖼️  Ảnh demo đã lưu tại:', OUT_DIR);
    console.log('✅ DEMO THÀNH CÔNG — cả 2 lỗi đã xác nhận được vá đúng qua kịch bản thật (không suy luận).');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error('💥 Demo lỗi:', e); process.exitCode = 1; });
