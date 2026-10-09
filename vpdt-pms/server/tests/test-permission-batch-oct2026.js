// server/tests/test-permission-batch-oct2026.js
//
// Đợt vá "4 vấn đề phân quyền" (10/2026, 2 ảnh người dùng gửi — xem báo cáo xác nhận qua AskUserQuestion):
//
//   A) Phân quyền cho user ĐANG LOGIN vẫn phải có hiệu lực NGAY, không cần F5 — runApprovalPollTick()
//      (poll ~20s có sẵn) giờ tự so permsFingerprintFor() TRƯỚC/SAU initDatabase({silent:true}), nếu
//      quyền của CHÍNH người đang đăng nhập vừa đổi thì gán lại currentUser + gọi applyNavVisibility()
//      (hàm MỚI tách ra từ finishLogin(), xem core.js) ngay lập tức — không cần F5/đăng nhập lại.
//   B) Bỏ hẳn cảnh báo đối chiếu % Margin/Chiết Khấu khi import file Bán Buôn — xoá
//      checkItPriceMarginConsistency() + 3 hàm phụ + #itPriceMarginWarningWrap, giữ nguyên dropdown
//      #itPriceTier (vẫn cần cho routing quy trình duyệt).
//   C) canAccessApprovalHub() thiếu 2 nhánh: paymentDeptWorkflows approver + itPriceEmergencyReject-
//      ApproveWholesale/Retail — khiến nút "Phê Duyệt" ẩn sai cho người thật sự có hồ sơ chờ duyệt.
//   D) Mục 0 "Quyền Truy Cập Module": checkbox doc/submission/contract giờ di chuyển (không sao chép)
//      vào đúng khối phân quyền riêng của module đó (renderModuleAccessCheckboxes() ->
//      relocateModuleAccessNodes()), dễ tìm hơn — vẫn cùng 1 DOM node/id, không có trạng thái trùng lặp.
//   E) Lỗ hổng phát hiện PHỤ qua rà soát (Công & Phép): setHrAttendanceView() TRƯỚC ĐÂY tin tưởng mù
//      quáng tham số `view` — gọi thẳng từ console vẫn vẽ được view "Quản Lý" (dữ liệu company-wide) dù
//      Mục 0 hrAttendanceManageTab đã tắt. Đã thêm tự-kiểm-tra NGAY TRONG hàm, cùng khuôn
//      setBudgetLineTab()/setOperationStoreSubTab(). Phần lọc server-side (lib/recordViewScope.js) có
//      test riêng ở tests/test-attendance-records-scope.js (bổ sung case Mục 0 ở đó).
//
// Chạy: node server/tests/test-permission-batch-oct2026.js
'use strict';
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual
} = require('./testHarness');

const PORT = 8988;

const ADMIN = { username: 'admin1', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
// Lúc đăng nhập CHƯA có quyền "budget" — sẽ được admin cấp thêm GIỮA chừng phiên (mô phỏng qua việc sửa
// state.users rồi gọi lại initDatabase() như runApprovalPollTick() thật làm).
const STAFF_NO_BUDGET = { username: 'staff_live', name: 'NV Chờ Cấp Quyền', dept: 'Kế Toán', perms: {}, active: true };

async function main() {
  const server = await startStaticServer(PORT);
  const state = createMockState({ users: [ADMIN, STAFF_NO_BUDGET] });
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    // ===== A) Live perms refresh (không cần F5) =====
    await run.run('A1) Đăng nhập chưa có quyền Ngân Sách -> nút Ngân Sách ẩn', async () => {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, STAFF_NO_BUDGET);
      const hidden = await page.evaluate(() => document.getElementById('btnBudgetNav').classList.contains('hidden'));
      assert(hidden, 'Chưa có quyền Ngân Sách -> nút phải ẩn ngay sau đăng nhập');
    });

    await run.run('A2) Admin cấp quyền Ngân Sách GIỮA chừng phiên -> nhịp poll kế tiếp PHẢI tự hiện nút ngay, không cần F5', async () => {
      // Giả lập admin vừa lưu phân quyền cho đúng user NÀY (sửa thẳng "DB" mock phía Node, như route
      // POST /api/data/users thật đã làm) — user ĐANG ĐĂNG NHẬP không hề gọi lại proceedAfterAuth()/F5.
      const idx = state.users.findIndex(u => u.username === STAFF_NO_BUDGET.username);
      state.users[idx] = { ...STAFF_NO_BUDGET, perms: { budgetCreate: true, moduleAccess: { budget: true, budgetPropose: true } } };

      // Local fetch stub CHỈ cho riêng route polling (testHarness mock chưa hỗ trợ route này) — mọi
      // route khác (đặc biệt /api/data) vẫn đi qua dispatcher thật của testHarness như bình thường.
      await page.evaluate(() => {
        const origFetch = window.fetch;
        window.__origFetchBeforeApprovalStub = origFetch;
        window.fetch = async (url, opts) => {
          if (typeof url === 'string' && url.includes('/api/approvals/pending-signature')) {
            return { ok: true, status: 200, json: async () => ({ count: 0, keys: [] }) };
          }
          return origFetch(url, opts);
        };
      });

      await page.evaluate(() => runApprovalPollTick());

      const [hiddenAfter, currentUserPerms] = await page.evaluate(() => [
        document.getElementById('btnBudgetNav').classList.contains('hidden'),
        currentUser.perms
      ]);
      assert(!hiddenAfter, 'Sau 1 nhịp poll, nút Ngân Sách PHẢI tự hiện ra ngay — không cần F5/đăng nhập lại');
      assert(currentUserPerms.budgetCreate === true, 'currentUser phải được gán lại bằng bản ghi MỚI NHẤT (budgetCreate:true)');
    });

    await run.run('A3) Quyền KHÔNG đổi giữa 2 nhịp poll -> không gọi lại applyNavVisibility() (không lỗi, không reset DOM)', async () => {
      // Đổi thủ công giá trị KHÔNG liên quan quyền (name) để xác nhận fingerprint không đổi -> nhánh
      // "currentUser = freshSelf" không chạy lại (hành vi mong đợi, không phải lỗi nếu nó không chạy).
      const before = await page.evaluate(() => currentUser.name);
      const idx = state.users.findIndex(u => u.username === STAFF_NO_BUDGET.username);
      state.users[idx] = { ...state.users[idx], name: 'Tên Đã Đổi Nhưng Không Phải Quyền' };
      await page.evaluate(() => runApprovalPollTick());
      const after = await page.evaluate(() => currentUser.name);
      assertEqual(after, before, 'permsFingerprintFor() không đổi (chỉ đổi tên) -> currentUser không bị gán lại giữa chừng (đúng thiết kế, tránh re-render thừa)');
    });

    // ===== C) canAccessApprovalHub(): 2 nhánh mới =====
    await run.run('C1) canAccessApprovalHub(): approver trong paymentDeptWorkflows -> true (trước đây bị bỏ sót)', async () => {
      const can = await page.evaluate(() => {
        DB.paymentDeptWorkflows = { 'Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: ['pay_approver'] } } };
        return canAccessApprovalHub({ username: 'pay_approver', dept: 'Kế Toán', perms: {} });
      });
      assert(can, 'Approver trong paymentDeptWorkflows phải thấy được nút Phê Duyệt');
    });

    await run.run('C2) canAccessApprovalHub(): itPriceEmergencyRejectApproveWholesale -> true', async () => {
      const can = await page.evaluate(() => canAccessApprovalHub({ username: 'x', perms: { itPriceEmergencyRejectApproveWholesale: true } }));
      assert(can, 'Quyền duyệt khẩn cấp Bán Buôn phải thấy được nút Phê Duyệt dù không khớp bất kỳ nhánh nào khác');
    });

    await run.run('C3) canAccessApprovalHub(): itPriceEmergencyRejectApproveRetail -> true', async () => {
      const can = await page.evaluate(() => canAccessApprovalHub({ username: 'y', perms: { itPriceEmergencyRejectApproveRetail: true } }));
      assert(can, 'Quyền duyệt khẩn cấp Bán Lẻ phải thấy được nút Phê Duyệt');
    });

    await run.run('C4) canAccessApprovalHub(): không khớp bất kỳ nhánh nào -> vẫn false (đối chứng không nới lỏng quá tay)', async () => {
      const can = await page.evaluate(() => canAccessApprovalHub({ username: 'z', dept: 'Phòng Không Liên Quan', perms: {} }));
      assert(!can, 'User không có bất kỳ quyền/duyệt nào thì nút Phê Duyệt vẫn phải ẩn');
    });

    // ===== D) Mục 0: relocateModuleAccessNodes() =====
    // Dùng ĐÚNG anchor THẬT đã có sẵn trong systemSection.html (được tải lười-nhưng-eager ngay từ đầu
    // bởi testHarness, xem TAB_SECTION_FRAGMENT) — KHÔNG tự tạo phần tử trùng id (document.getElementById
    // với id trùng lặp trả về node ĐẦU TIÊN trong DOM, không phải node test vừa tạo, khiến assertion kiểm
    // tra sai node dù hành vi thật vẫn đúng).
    await run.run('D1) renderModuleAccessCheckboxes(): doc/submission/contract di chuyển đúng vào anchor THẬT của systemSection.html, để lại ghi chú ở vị trí cũ', async () => {
      const result = await page.evaluate(() => {
        const container = document.createElement('div');
        container.id = '__muc0RelocTestContainer';
        document.body.appendChild(container);
        const anchorDoc = document.getElementById('moduleAccessAnchor_doc');
        const anchorSub = document.getElementById('moduleAccessAnchor_submission');
        const anchorContract = document.getElementById('moduleAccessAnchor_contract');

        renderModuleAccessCheckboxes('__muc0RelocTestContainer', 'tReloc');

        const out = {
          anchorsExist: !!anchorDoc && !!anchorSub && !!anchorContract,
          docInAnchor: !!anchorDoc && anchorDoc.contains(document.getElementById('tReloc_doc')),
          subInAnchor: !!anchorSub && anchorSub.contains(document.getElementById('tReloc_submission')),
          contractInAnchor: !!anchorContract && anchorContract.contains(document.getElementById('tReloc_contract')),
          contractChildInAnchor: !!anchorContract && anchorContract.contains(document.getElementById('tReloc_contractApproval')),
          noteLeftBehind: container.innerText.includes('Đã dời vào khối quyền'),
          // Module KHÔNG thuộc danh sách relocate (VD "task") vẫn còn nguyên trong container gốc như cũ.
          taskStillInContainer: container.contains(document.getElementById('tReloc_task'))
        };
        container.remove();
        return out;
      });
      assert(result.anchorsExist, 'Cả 3 anchor #moduleAccessAnchor_doc/submission/contract phải có sẵn trong systemSection.html');
      assert(result.docInAnchor, 'Checkbox "doc" phải nằm trong #moduleAccessAnchor_doc sau khi render');
      assert(result.subInAnchor, 'Checkbox "submission" phải nằm trong #moduleAccessAnchor_submission');
      assert(result.contractInAnchor, 'Checkbox "contract" phải nằm trong #moduleAccessAnchor_contract');
      assert(result.contractChildInAnchor, 'Checkbox con "contractApproval" phải đi THEO cha "contract" vào anchor (di chuyển cả cụm, không tách rời)');
      assert(result.noteLeftBehind, 'Phải để lại ghi chú ngắn ở vị trí cũ trong cây Mục 0 chung');
      assert(result.taskStillInContainer, 'Module "task" (không nằm trong danh sách relocate) phải vẫn ở nguyên vị trí cũ');
    });

    await run.run('D2) Gọi lại renderModuleAccessCheckboxes() lần 2 (mở lại form) KHÔNG để sót node trùng id trong anchor', async () => {
      const result = await page.evaluate(() => {
        const container = document.createElement('div');
        container.id = '__muc0RelocTestContainer2';
        document.body.appendChild(container);
        const anchorDoc = document.getElementById('moduleAccessAnchor_doc');

        renderModuleAccessCheckboxes('__muc0RelocTestContainer2', 'tReloc2');
        renderModuleAccessCheckboxes('__muc0RelocTestContainer2', 'tReloc2'); // mô phỏng mở form lần 2 (Thêm Mới/Sửa user khác)

        const count = anchorDoc.querySelectorAll('[id="tReloc2_doc"]').length;
        container.remove();
        return count;
      });
      assertEqual(result, 1, 'Gọi lại hàm nhiều lần không được để tích luỹ nhiều node trùng id trong anchor (đã clear anchor.innerHTML trước khi append lại)');
    });

    // ===== E) Công & Phép: setHrAttendanceView() tự validate =====
    await run.run('E1) setHrAttendanceView("MANAGE") gọi TRỰC TIẾP (bỏ qua renderHrAttendanceModule()) cho user KHÔNG có quyền Quản Lý -> fallback về SELF, không vẽ dữ liệu company-wide', async () => {
      const result = await page.evaluate(async (u) => {
        await proceedAfterAuth(u);
        setHrAttendanceView('MANAGE'); // gọi thẳng, mô phỏng console/code khác gọi tắt không qua renderHrAttendanceModule()
        return {
          activeView: activeHrAttendanceView,
          manageHidden: document.getElementById('hacViewManage').classList.contains('hidden'),
          selfHidden: document.getElementById('hacViewSelf').classList.contains('hidden')
        };
      }, { username: 'hac_noperm', name: 'NV Không Quyền Công Phép', dept: 'Kế Toán', perms: {}, active: true });
      assertEqual(result.activeView, 'SELF', 'Không có quyền Quản Lý -> phải tự fallback về view được phép (SELF), không giữ nguyên MANAGE');
      assert(result.manageHidden, 'Khối "Quản Lý & Cấu Hình" phải ẩn');
      assert(!result.selfHidden, 'Khối "Của Tôi" (view fallback) phải hiện');
    });

    await run.run('E2) setHrAttendanceView("MANAGE") cho user CÓ đủ quyền (hrAttendanceManage + Mục 0 hrAttendanceManageTab) -> vào đúng MANAGE', async () => {
      const result = await page.evaluate(async (u) => {
        await proceedAfterAuth(u);
        setHrAttendanceView('MANAGE');
        return { activeView: activeHrAttendanceView, manageHidden: document.getElementById('hacViewManage').classList.contains('hidden') };
      }, { username: 'hac_manager', name: 'HR Quản Lý Công Phép', dept: 'Nhân Sự', perms: { hrAttendanceManage: true }, active: true });
      assertEqual(result.activeView, 'MANAGE', 'Đủ quyền thì phải được VÀO ĐÚNG view yêu cầu, không bị fallback oan');
      assert(!result.manageHidden, 'Khối "Quản Lý & Cấu Hình" phải hiện cho người đủ quyền');
    });

    await run.run('E3) setHrAttendanceView("MANAGE") cho user có flat perm NHƯNG Mục 0 hrAttendanceManageTab:false -> vẫn bị chặn (lỗ hổng đã vá)', async () => {
      const result = await page.evaluate(async (u) => {
        await proceedAfterAuth(u);
        setHrAttendanceView('MANAGE');
        return { activeView: activeHrAttendanceView, manageHidden: document.getElementById('hacViewManage').classList.contains('hidden') };
      }, { username: 'hac_blocked', name: 'HR Bị Tắt Mục 0', dept: 'Nhân Sự', perms: { hrAttendanceManage: true, moduleAccess: { hrAttendanceManageTab: false } }, active: true });
      assertEqual(result.activeView, 'SELF', 'Mục 0 hrAttendanceManageTab=false phải chặn được view MANAGE dù còn flat perm hrAttendanceManage (LỖ HỔNG ĐÃ VÁ: trước đây gọi thẳng hàm này sẽ bỏ qua được lớp chặn này)');
      assert(result.manageHidden, 'Khối "Quản Lý & Cấu Hình" phải ẩn dù user còn flat perm hrAttendanceManage');
    });

    // ===== B) Margin/Chiết Khấu check đã bỏ hẳn =====
    await run.run('B1) checkItPriceMarginConsistency() và 3 hàm phụ đã bị xoá hoàn toàn khỏi client', async () => {
      const gone = await page.evaluate(() => ({
        check: typeof checkItPriceMarginConsistency === 'undefined',
        parse: typeof parseItPriceMarginNumber === 'undefined',
        wrongSide: typeof itPriceTierWrongSideCount === 'undefined',
        colKey: typeof itPriceColumnKeyForTier === 'undefined'
      }));
      assert(gone.check, 'checkItPriceMarginConsistency phải không còn tồn tại');
      assert(gone.parse, 'parseItPriceMarginNumber phải không còn tồn tại');
      assert(gone.wrongSide, 'itPriceTierWrongSideCount phải không còn tồn tại');
      assert(gone.colKey, 'itPriceColumnKeyForTier phải không còn tồn tại');
    });

    await run.run('B2) Form Phê Duyệt Giá Bán Buôn: #itPriceMarginWarningWrap không còn trong DOM, #itPriceTier vẫn còn (vẫn cần cho routing quy trình)', async () => {
      const res = await page.evaluate(async (u) => {
        await proceedAfterAuth(u);
        await switchTab('vanHanh'); setVanHanhSubTab('ITPRICE');
        openItPriceCreateForm();
        return {
          warningWrapGone: !document.getElementById('itPriceMarginWarningWrap'),
          tierSelectStillThere: !!document.getElementById('itPriceTier'),
          noDataOpChangeLeft: !document.getElementById('itPriceTier')?.hasAttribute('data-op-change')
        };
      }, { username: 'staff_mkt2', name: 'NV Marketing', dept: 'Marketing', perms: { itPriceProposeCreateWholesale: true }, active: true });
      assert(res.warningWrapGone, '#itPriceMarginWarningWrap phải bị xoá khỏi HTML');
      assert(res.tierSelectStillThere, '#itPriceTier (dropdown mức Margin/Chiết Khấu) vẫn phải còn — vẫn cần cho routing quy trình duyệt');
      assert(res.noDataOpChangeLeft, 'Thuộc tính data-op-change="checkItPriceMarginConsistency" phải được gỡ khỏi #itPriceTier');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
