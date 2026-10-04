// tests/test-collapse-contract-budget-doc-forms.js — Regression test cho đợt "thu gọn form nhập"
// (10/2026): chuyển các form/box nhập dài (Hợp Đồng/Ngân Sách/Tài Liệu/Giấy Phép/Văn Bản Trình) sang
// mặc định ẨN, chỉ mở khi bấm nút "+ ..." riêng ngoài form (xem openMhVendorForm()/closeMhVendorForm()
// ở module-muahang.js làm mẫu gốc).
//
// 2 nhóm kịch bản (dùng CHUNG harness/seed với test-contract.js/test-budget-lines.js —
// tests/_harness-contract.js + tests/_seed.js — để tái dùng ĐÚNG user/quyền/dept-workflow đã có sẵn,
// không cần tự dựng seed riêng):
//
// 1. HỢP ĐỒNG (module-hopdong.js, mục 1 — ĐẶC BIỆT NHẠY CẢM): #contractManageFormWrap giờ luôn bắt đầu
//    ẩn; nút "+ Thêm Hợp Đồng/Phụ Lục" (#btnContractManageNew) ẩn/hiện theo ĐÚNG điều kiện CŨ từng gác
//    chính form đó (subTab==='MANAGE' && !canImportSigned) — setContractSubTab() giờ chỉ còn quyết định
//    NÚT, không tự gỡ 'hidden' của form nữa. Kịch bản cuối re-test lại ĐÚNG hành vi "stuck-fallback" đã
//    vá trước đó (setContractSubTab() trả về null khi cả 2 checkbox con contractApproval/contractManage
//    đều bị tắt — KHÔNG được giữ nguyên subTab đang xin mở) vẫn an toàn sau khi thêm nút/form ẩn: không
//    lộ form, tbody hiện đúng "Bạn không có quyền xem mục này."
//
// 2. NGÂN SÁCH (module-ngansach.js, mục 2+3): #blProposeFormWrap/#blApproveFormWrap giờ luôn bắt đầu
//    ẩn; nút "+ Thêm Đề Xuất"/"+ Thêm Phê Duyệt" (#blProposeNewBtn/#blApproveNewBtn) ẩn/hiện theo ĐÚNG
//    điều kiện CŨ từng gác chính form đó (canOpenBudgetLineFormClient() — budgetCreate, VÀ budgetManage
//    nếu là dòng Phê Duyệt).
//
// Chạy: node server/tests/test-collapse-contract-budget-doc-forms.js
'use strict';

const { startHarness } = require('./_harness-contract');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

async function run() {
  const h = await startHarness();
  const { page, loginAs, jsExceptions, stop } = h;

  try {
    // ================================================================
    // 1) HỢP ĐỒNG — #contractManageFormWrap / #btnContractManageNew
    // ================================================================
    await loginAs('kd1'); // contractCreate (Phòng Kinh Doanh), KHÔNG contractImportSigned, KHÔNG admin.
    await page.evaluate(() => { switchTab('contract'); setContractSubTab('APPROVAL'); });

    let s1 = await page.evaluate(() => ({
      btnHidden: document.getElementById('btnContractManageNew').classList.contains('hidden'),
      formHidden: document.getElementById('contractManageFormWrap').classList.contains('hidden')
    }));
    check('Hợp Đồng (tab Phê Duyệt, kd1): nút "+ Thêm Hợp Đồng/Phụ Lục" HIỆN (điều kiện cũ chỉ ẩn ở tab Quản Lý HĐ)', s1.btnHidden === false, s1);
    check('Hợp Đồng (tab Phê Duyệt, kd1): form #contractManageFormWrap mặc định ẨN (chưa bấm nút)', s1.formHidden === true, s1);

    await page.evaluate(() => openContractManageForm());
    let s2 = await page.evaluate(() => document.getElementById('contractManageFormWrap').classList.contains('hidden'));
    check('Hợp Đồng: bấm "+ Thêm Hợp Đồng/Phụ Lục" (openContractManageForm()) -> form MỞ ra', s2 === false, s2);

    await page.evaluate(() => closeContractManageForm());
    let s3 = await page.evaluate(() => document.getElementById('contractManageFormWrap').classList.contains('hidden'));
    check('Hợp Đồng: bấm "✕ Thu Gọn" (closeContractManageForm()) -> form ẨN lại', s3 === true, s3);

    // Tab "Quản Lý HĐ & Giấy Phép" — kd1 KHÔNG có contractImportSigned -> nút phải ẨN (đúng điều kiện cũ
    // `subTab === 'MANAGE' && !canImportSigned` từng dùng để ẩn CHÍNH form).
    await page.evaluate(() => setContractSubTab('MANAGE'));
    let s4 = await page.evaluate(() => ({
      btnHidden: document.getElementById('btnContractManageNew').classList.contains('hidden'),
      formHidden: document.getElementById('contractManageFormWrap').classList.contains('hidden')
    }));
    check('Hợp Đồng (tab Quản Lý HĐ, kd1 — KHÔNG contractImportSigned): nút "+ Thêm..." ẨN', s4.btnHidden === true, s4);
    check('Hợp Đồng (tab Quản Lý HĐ, kd1): form vẫn ẨN (đổi sub-tab tự thu gọn lại, không lộ form cũ)', s4.formHidden === true, s4);

    // admin bypass contractImportSigned (currentUser.perms.admin) -> nút phải HIỆN ở tab Quản Lý HĐ.
    await loginAs('admin');
    await page.evaluate(() => { switchTab('contract'); setContractSubTab('MANAGE'); });
    let s5 = await page.evaluate(() => document.getElementById('btnContractManageNew').classList.contains('hidden'));
    check('Hợp Đồng (tab Quản Lý HĐ, admin): nút "+ Thêm..." HIỆN (admin bypass contractImportSigned)', s5 === false, s5);

    // ----- Re-test "stuck-fallback" (đã vá trước đó) vẫn đúng sau khi thêm nút/form ẩn -----
    await page.evaluate(() => {
      DB.users.push({
        id: 9001, username: 'contractlocked1', pass: '123456', name: 'NV Bị Khoá Cả 2 Sub-tab HĐ',
        email: 'contractlocked1@company.com', phone: '0900009001', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân viên',
        perms: { admin: false, moduleAccess: { contractApproval: false, contractManage: false } }
      });
    });
    await loginAs('contractlocked1');
    await page.evaluate(() => { switchTab('contract'); });
    // Giả lập dữ liệu "cũ" còn sót trong bảng/dashboard trước khi gọi lại — xác nhận bị XOÁ hẳn, không
    // chỉ ẩn (đúng bản vá stuck-fallback đã có).
    const stuckState = await page.evaluate(() => {
      document.getElementById('contractTableBody').innerHTML = '<tr><td>DỮ LIỆU CŨ RÒ RỈ</td></tr>';
      document.getElementById('contractDashboardCards').innerHTML = '<div>CŨ</div>';
      setContractSubTab('APPROVAL'); // xin mở tab Phê Duyệt dù cả 2 checkbox con đều đã bị tắt.
      return {
        active: activeContractSubTab,
        btnHidden: document.getElementById('btnContractManageNew').classList.contains('hidden'),
        formHidden: document.getElementById('contractManageFormWrap').classList.contains('hidden'),
        tbodyHtml: document.getElementById('contractTableBody').innerHTML,
        dashboardHtml: document.getElementById('contractDashboardCards').innerHTML
      };
    });
    check('Hợp Đồng stuck-fallback: cả 2 checkbox con tắt -> activeContractSubTab phải null (KHÔNG giữ nguyên "APPROVAL" đang xin mở)', stuckState.active === null, stuckState);
    check('Hợp Đồng stuck-fallback: nút "+ Thêm..." phải ẨN (không mời người không có quyền mở form)', stuckState.btnHidden === true, stuckState);
    check('Hợp Đồng stuck-fallback: form #contractManageFormWrap phải ẨN, KHÔNG lộ ra', stuckState.formHidden === true, stuckState);
    check('Hợp Đồng stuck-fallback: tbody hiện đúng "Bạn không có quyền xem mục này." (xoá hẳn dữ liệu cũ, không chỉ ẩn)', stuckState.tbodyHtml.includes('Bạn không có quyền xem mục này.') && !stuckState.tbodyHtml.includes('DỮ LIỆU CŨ RÒ RỈ'), stuckState.tbodyHtml);
    check('Hợp Đồng stuck-fallback: dashboard cards cũ bị xoá hẳn', stuckState.dashboardHtml === '', stuckState.dashboardHtml);

    // ================================================================
    // 2) NGÂN SÁCH — #blProposeFormWrap/#blApproveFormWrap + #blProposeNewBtn/#blApproveNewBtn
    // ================================================================
    await loginAs('kd1'); // budgetCreate: true, KHÔNG budgetManage.
    await page.evaluate(() => { switchTab('budget'); setBudgetLineTab('PROPOSE'); });

    let b1 = await page.evaluate(() => ({
      btnHidden: document.getElementById('blProposeNewBtn').classList.contains('hidden'),
      formHidden: document.getElementById('blProposeFormWrap').classList.contains('hidden')
    }));
    check('Ngân Sách (tab Đề Xuất, kd1 — có budgetCreate): nút "+ Thêm Đề Xuất" HIỆN', b1.btnHidden === false, b1);
    check('Ngân Sách (tab Đề Xuất, kd1): form #blProposeFormWrap mặc định ẨN (chưa bấm nút)', b1.formHidden === true, b1);

    await page.evaluate(() => openBudgetLineForm('Propose'));
    let b2 = await page.evaluate(() => document.getElementById('blProposeFormWrap').classList.contains('hidden'));
    check('Ngân Sách: bấm "+ Thêm Đề Xuất" (openBudgetLineForm(\'Propose\')) -> form MỞ ra', b2 === false, b2);

    await page.evaluate(() => closeBudgetLineForm('Propose'));
    let b3 = await page.evaluate(() => document.getElementById('blProposeFormWrap').classList.contains('hidden'));
    check('Ngân Sách: bấm "✕ Thu Gọn" (closeBudgetLineForm(\'Propose\')) -> form ẨN lại', b3 === true, b3);

    // Tab "Phê Duyệt" (nhập trực tiếp dòng APPROVED) — kd1 có budgetCreate nhưng KHÔNG budgetManage ->
    // nút phải ẨN (đúng điều kiện cũ `!canCreate || (stage==='APPROVED' && !canManage)` từng dùng để ẩn
    // CHÍNH form này).
    await page.evaluate(() => setBudgetLineTab('APPROVE'));
    let b4 = await page.evaluate(() => ({
      btnHidden: document.getElementById('blApproveNewBtn').classList.contains('hidden'),
      formHidden: document.getElementById('blApproveFormWrap').classList.contains('hidden')
    }));
    check('Ngân Sách (tab Phê Duyệt, kd1 — KHÔNG budgetManage): nút "+ Thêm Phê Duyệt" ẨN', b4.btnHidden === true, b4);
    check('Ngân Sách (tab Phê Duyệt, kd1): form vẫn ẨN', b4.formHidden === true, b4);

    // budgetmgr1 (budgetManage: true) -> nút "+ Thêm Phê Duyệt" phải HIỆN.
    await loginAs('budgetmgr1');
    await page.evaluate(() => { switchTab('budget'); setBudgetLineTab('APPROVE'); });
    let b5 = await page.evaluate(() => document.getElementById('blApproveNewBtn').classList.contains('hidden'));
    check('Ngân Sách (tab Phê Duyệt, budgetmgr1 — có budgetManage): nút "+ Thêm Phê Duyệt" HIỆN', b5 === false, b5);

    check('Không có ngoại lệ JS chưa bắt (pageerror) nào phát sinh trong suốt bộ test', jsExceptions.length === 0, jsExceptions);
  } catch (err) {
    fail++;
    console.log(`FAIL: (lỗi không lường trước khiến bộ test dừng giữa chừng) -- ${err.stack || err.message}`);
  } finally {
    await stop();
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exitCode = fail > 0 ? 1 : 0;
}

run();
