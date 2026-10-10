// server/tests/test-stuck-subtab-fallback-fix.js
//
// Regression test cho đợt vá 10 file còn lại của "stuck-fallback" (rà soát v24.74→v24.81, 11/2026, mức
// Cao) — cùng lớp lỗi đã vá cho setItSupportSubTab()/resolveAccessibleInternalSubTab()/
// resolveAccessibleTrainingLmsTab() (v24.77, xem test-muc0-module-access-tree.js kịch bản H/I): các hàm
// set*SubTab() dưới đây TRƯỚC ĐÂY dùng `fallback ? fallback[0] : subTab` (hoặc ternary lồng nhau tương
// đương) — GIỮ NGUYÊN giá trị tab đang xin mở khi KHÔNG còn sibling nào được phép (mọi checkbox Mục 0
// con của tab đó đều bị tắt), khiến panel/nội dung của ĐÚNG tab vừa bị khoá vẫn hiện ra hoặc được vẽ dữ
// liệu. Đã đổi toàn bộ sang trả `null` khi không còn sibling nào được phép.
//
// 10 file/12 hàm được vá trong đợt này: module-dangkyxe.js (setCarSubTab), module-phonghop.js
// (setMeetingSubTab), module-vanhanh.js (setOperationOrderSubTab + setVanHanhSubTab),
// module-baocaodinhky-nhap.js (setPeriodicReportSubTab), module-dongphuc.js (setUniformSubTab),
// module-muahang.js (setPurchasingSubTab + setMhBasSubTab), module-orgchart.js (setOrgChartSubTab),
// module-thanhtoan.js (setPaymentSubTab), module-vpp.js (setVppSubTab), module-checklist.js
// (setChecklistReportSubTab).
//
// setContractSubTab() (module-hopdong.js) thêm sau (rà soát v24.74→v24.90, 10/2026, mức Cao — hàm thứ 14
// cùng lớp lỗi, bị bỏ sót ở 2 đợt trước vì canAccessContractModule() không chặn cả module nên dễ lọt qua
// 1 lượt test chỉ kiểm tra "vào được module hay không"): KHÁC các hàm trên (có panel con riêng để ẩn),
// Hợp Đồng dùng CHUNG 1 form/danh sách cho cả 2 sub-tab — khi null phải ẩn hẳn form + XOÁ nội dung bảng
// cũ (không chỉ ẩn), xem chú thích đầy đủ ở setContractSubTab().
//
// Chạy: node server/tests/test-stuck-subtab-fallback-fix.js
'use strict';
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual
} = require('./testHarness');

const PORT = 8992;

const CAR_USER = { username: 'car1', name: 'NV Xe', dept: 'Vận Hành', perms: { carReportView: true, moduleAccess: { carReg: false, carCalendar: false, carDriver: false, carReport: false } } };
const MEETING_USER = { username: 'meeting1', name: 'NV Phòng Họp', dept: 'Vận Hành', perms: { meetingReportView: true, moduleAccess: { meetingRegister: false, meetingCalendar: false, meetingReport: false } } };
// vanHanhOrders (cha của 4 checkbox Store/Ho/Report/Receipt) giữ MỞ — chỉ khoá 4 checkbox cháu, để vào
// được tab ORDERS và gọi đúng setOperationOrderSubTab() (không bị chặn sớm hơn ở setVanHanhSubTab()).
const OPORDER_USER = { username: 'oporder1', name: 'NV Đơn Hàng', dept: 'Vận Hành', perms: { operationOrderReportView: true, moduleAccess: { vanHanhOrdersStore: false, vanHanhOrdersHo: false, vanHanhOrdersReport: false, vanHanhOrdersReceipt: false } } };
const VANHANH_USER = { username: 'vanhanh1', name: 'NV Vận Hành', dept: 'Vận Hành', perms: { operationOrderReportView: true, moduleAccess: { vanHanhOrders: false, vanHanhStoreGroup: false, vanHanhItpriceTab: false } } };
const PERIODIC_USER = { username: 'periodic1', name: 'NV Báo Cáo Định Kỳ', dept: 'Vận Hành', perms: { reportEntryCreate: true, moduleAccess: { periodicReportEntry: false, periodicReportPeriods: false, periodicReportAggregate: false, periodicReportPublished: false } } };
const UNIFORM_USER = { username: 'uniform1', name: 'NV Đồng Phục', dept: 'Vận Hành', perms: { uniformManage: true, moduleAccess: { uniformPeriods: false, uniformStore: false, uniformStock: false, uniformDashboard: false } } };
const MUAHANG_USER = { username: 'muahang1', name: 'NV Mua Hàng', dept: 'Vận Hành', perms: { rebateTermManage: true, moduleAccess: { muaHangBas: false, muaHangReport: false, muaHangItprice: false } } };
const MUAHANGBAS_USER = { username: 'muahangbas1', name: 'NV Mua Hàng BAS', dept: 'Vận Hành', perms: { rebateTermManage: true, moduleAccess: { muaHangBasVendor: false, muaHangBasTerm: false, muaHangBasSync: false } } };
const ORGCHART_USER = { username: 'orgchart1', name: 'NV Cơ Cấu Tổ Chức', dept: 'Vận Hành', perms: { orgChartManage: true, moduleAccess: { orgChartTree: false, orgChartDiagram: false, orgChartKpi: false } } };
const PAYMENT_USER = { username: 'payment1', name: 'NV Thanh Toán', dept: 'Vận Hành', perms: { officeBuy: true, paymentManage: true, moduleAccess: { paymentCreateTab: false, paymentManageTab: false, paymentApproveTab: false } } };
const VPP_USER = { username: 'vpp1', name: 'NV VPP', dept: 'Vận Hành', perms: { vppReportView: true, moduleAccess: { vppRegister: false, vppPeriods: false, vppReports: false } } };
const CHECKLIST_USER = { username: 'checklist1', name: 'NV Checklist', dept: 'Vận Hành', perms: { checklistReportView: true, checklistAtvstpReportView: true, moduleAccess: { checklistReportGeneral: false, checklistReportVsattp: false } } };
// moduleAccess.contract giữ MỞ (cha) — chỉ khoá 2 checkbox con contractApproval/contractManage, để vào
// được module (canAccessContractModule() chỉ cần user.dept, không chặn ở đây) rồi gọi đúng
// setContractSubTab() (không bị chặn sớm hơn ở switchTab()).
const CONTRACT_USER = { username: 'contract1', name: 'NV Hợp Đồng', dept: 'Vận Hành', perms: { moduleAccess: { contractApproval: false, contractManage: false } } };

async function loginAs(page, user) {
  await page.evaluate(async (u) => {
    window.__resetCapture();
    await proceedAfterAuth(u);
  }, user);
}

async function main() {
  const state = createMockState({
    depts: ['Vận Hành'],
    users: [CAR_USER, MEETING_USER, OPORDER_USER, VANHANH_USER, PERIODIC_USER, UNIFORM_USER, MUAHANG_USER, MUAHANGBAS_USER, ORGCHART_USER, PAYMENT_USER, VPP_USER, CHECKLIST_USER, CONTRACT_USER]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err && err.stack || String(err)));

  try {
    await run.run('setCarSubTab(): activeCarSubTab=null khi cả 4 checkbox con đều tắt, mọi panel ẩn', async () => {
      await loginAs(page, CAR_USER);
      await page.evaluate(() => { switchTab('car'); });
      const state2 = await page.evaluate(() => {
        setCarSubTab('REPORT');
        return {
          active: activeCarSubTab,
          regHidden: document.getElementById('carSubReg').classList.contains('hidden'),
          reportHidden: document.getElementById('carSubReport').classList.contains('hidden')
        };
      });
      assertEqual(state2.active, null, `activeCarSubTab phải null, thực tế: ${state2.active}`);
      assert(state2.regHidden && state2.reportHidden, 'Mọi panel con Đăng Ký Xe phải ẩn');
    });

    await run.run('setMeetingSubTab(): activeMeetingSubTab=null khi cả 3 checkbox con đều tắt, mọi panel ẩn', async () => {
      await loginAs(page, MEETING_USER);
      await page.evaluate(() => { switchTab('meeting'); });
      const state2 = await page.evaluate(() => {
        setMeetingSubTab('REPORT');
        return {
          active: activeMeetingSubTab,
          registerHidden: document.getElementById('meetingRegisterTabContent').classList.contains('hidden'),
          reportHidden: document.getElementById('meetingReportTabContent').classList.contains('hidden')
        };
      });
      assertEqual(state2.active, null, `activeMeetingSubTab phải null, thực tế: ${state2.active}`);
      assert(state2.registerHidden && state2.reportHidden, 'Mọi panel con Phòng Họp phải ẩn');
    });

    await run.run('setOperationOrderSubTab(): activeOperationOrderSubTab=null khi cả 4 checkbox con đều tắt, mọi panel ẩn', async () => {
      await loginAs(page, OPORDER_USER);
      await page.evaluate(() => { switchTab('vanHanh'); });
      const state2 = await page.evaluate(() => {
        setOperationOrderSubTab('REPORT');
        return {
          active: activeOperationOrderSubTab,
          listHidden: document.getElementById('opOrderListPanel').classList.contains('hidden'),
          reportHidden: document.getElementById('opOrderReportPanel').classList.contains('hidden'),
          receiptHidden: document.getElementById('opOrderReceiptPanel').classList.contains('hidden')
        };
      });
      assertEqual(state2.active, null, `activeOperationOrderSubTab phải null, thực tế: ${state2.active}`);
      assert(state2.listHidden && state2.reportHidden && state2.receiptHidden, 'Mọi panel con Đơn Hàng phải ẩn');
    });

    await run.run('setVanHanhSubTab(): activeVanHanhSubTab=null khi cả 3 checkbox con đều tắt, mọi panel ẩn', async () => {
      await loginAs(page, VANHANH_USER);
      await page.evaluate(() => { switchTab('vanHanh'); });
      const state2 = await page.evaluate(() => {
        setVanHanhSubTab('ORDERS');
        return {
          active: activeVanHanhSubTab,
          ordersHidden: document.getElementById('vanHanhOrdersWrap').classList.contains('hidden'),
          storeHidden: document.getElementById('vanHanhStoreWrap').classList.contains('hidden')
        };
      });
      assertEqual(state2.active, null, `activeVanHanhSubTab phải null, thực tế: ${state2.active}`);
      assert(state2.ordersHidden && state2.storeHidden, 'Mọi panel con Vận Hành phải ẩn');
    });

    await run.run('setPeriodicReportSubTab(): activePeriodicReportSubTab=null khi cả 4 checkbox con đều tắt, mọi panel ẩn', async () => {
      await loginAs(page, PERIODIC_USER);
      await page.evaluate(() => { switchTab('periodicReport'); });
      const state2 = await page.evaluate(() => {
        setPeriodicReportSubTab('ENTRY');
        return {
          active: activePeriodicReportSubTab,
          entryHidden: document.getElementById('prSubEntry').classList.contains('hidden')
        };
      });
      assertEqual(state2.active, null, `activePeriodicReportSubTab phải null, thực tế: ${state2.active}`);
      assert(state2.entryHidden, 'Panel Nhập Báo Cáo phải ẩn');
    });

    await run.run('setUniformSubTab(): activeUniformSubTab=null khi cả 4 checkbox con đều tắt, mọi panel ẩn', async () => {
      await loginAs(page, UNIFORM_USER);
      await page.evaluate(() => { switchTab('uniform'); });
      const state2 = await page.evaluate(() => {
        setUniformSubTab('STOCK');
        return {
          active: activeUniformSubTab,
          stockHidden: document.getElementById('uniformSubStock').classList.contains('hidden')
        };
      });
      assertEqual(state2.active, null, `activeUniformSubTab phải null, thực tế: ${state2.active}`);
      assert(state2.stockHidden, 'Panel Kho Đồng Phục phải ẩn');
    });

    await run.run('setPurchasingSubTab(): mhSubTab=null khi cả 3 checkbox con đều tắt, mọi panel ẩn', async () => {
      await loginAs(page, MUAHANG_USER);
      await page.evaluate(() => { switchTab('muaHang'); });
      const state2 = await page.evaluate(() => {
        setPurchasingSubTab('BAS');
        return {
          active: mhSubTab,
          basHidden: document.getElementById('mhSubBas').classList.contains('hidden')
        };
      });
      assertEqual(state2.active, null, `mhSubTab phải null, thực tế: ${state2.active}`);
      assert(state2.basHidden, 'Panel BAS phải ẩn');
      assert(await page.evaluate(() => document.getElementById('btnMhSubItPrice').classList.contains('hidden')),
        'LỖI ĐÃ VÁ (10/2026): nút #btnMhSubItPrice phải ẩn khi thiếu quyền muaHangItprice (trước đây id tính toán sai case khiến nút không bao giờ bị ẩn)');
    });

    await run.run('setPurchasingSubTab(): có quyền BAS nhưng KHÔNG có muaHangItprice -> nút #btnMhSubItPrice vẫn ẩn (quy hồi lỗi case-id)', async () => {
      await loginAs(page, { ...MUAHANG_USER, perms: { rebateTermManage: true, moduleAccess: { muaHangBas: true, muaHangReport: false, muaHangItprice: false } } });
      await page.evaluate(() => { switchTab('muaHang'); });
      const state2 = await page.evaluate(() => {
        setPurchasingSubTab('BAS');
        return {
          active: mhSubTab,
          itPriceBtnHidden: document.getElementById('btnMhSubItPrice').classList.contains('hidden'),
          basBtnHidden: document.getElementById('btnMhSubBas').classList.contains('hidden')
        };
      });
      assertEqual(state2.active, 'BAS', `mhSubTab phải là BAS, thực tế: ${state2.active}`);
      assert(!state2.basBtnHidden, 'Nút BAS phải hiện (có quyền)');
      assert(state2.itPriceBtnHidden, 'Nút #btnMhSubItPrice phải ẩn (không có quyền muaHangItprice)');
    });

    await run.run('setMhBasSubTab(): mhBasSubTab=null khi cả 3 checkbox con đều tắt, mọi panel ẩn', async () => {
      await loginAs(page, MUAHANGBAS_USER);
      await page.evaluate(() => { switchTab('muaHang'); });
      const state2 = await page.evaluate(() => {
        setMhBasSubTab('VENDOR');
        return {
          active: mhBasSubTab,
          vendorHidden: document.getElementById('mhBasSubVendor').classList.contains('hidden')
        };
      });
      assertEqual(state2.active, null, `mhBasSubTab phải null, thực tế: ${state2.active}`);
      assert(state2.vendorHidden, 'Panel Nhà Cung Cấp phải ẩn');
    });

    await run.run('setOrgChartSubTab(): activeOrgChartSubTab=null khi cả 3 checkbox con đều tắt, mọi panel ẩn, KHÔNG render KPI cho giá trị null', async () => {
      await loginAs(page, ORGCHART_USER);
      await page.evaluate(() => { switchTab('orgChart'); });
      const state2 = await page.evaluate(() => {
        setOrgChartSubTab('TREE');
        return {
          active: activeOrgChartSubTab,
          treeHidden: document.getElementById('orgChartTreeView').classList.contains('hidden'),
          kpiHidden: document.getElementById('orgChartKpiView').classList.contains('hidden')
        };
      });
      assertEqual(state2.active, null, `activeOrgChartSubTab phải null, thực tế: ${state2.active}`);
      assert(state2.treeHidden && state2.kpiHidden, 'Mọi panel con Cơ Cấu Tổ Chức phải ẩn (kể cả KPI — trước đây `else` trần render KPI cho BẤT KỲ giá trị không phải TREE/DIAGRAM)');
    });

    await run.run('setPaymentSubTab(): activePaymentSubTab=null khi cả 3 checkbox con đều tắt, mọi panel ẩn, KHÔNG render APPROVE cho giá trị null', async () => {
      await loginAs(page, PAYMENT_USER);
      await page.evaluate(() => { switchTab('office'); setOfficeSubTab('PAYMENT'); });
      const state2 = await page.evaluate(() => {
        setPaymentSubTab('CREATE');
        return {
          active: activePaymentSubTab,
          createHidden: document.getElementById('paymentCreateWrap').classList.contains('hidden'),
          approveHidden: document.getElementById('paymentApproveWrap').classList.contains('hidden')
        };
      });
      assertEqual(state2.active, null, `activePaymentSubTab phải null, thực tế: ${state2.active}`);
      assert(state2.createHidden && state2.approveHidden, 'Mọi panel con Thanh Toán phải ẩn (kể cả Approve — trước đây `else` trần render Approve cho mọi giá trị khác MANAGE)');
    });

    await run.run('setVppSubTab(): activeVppSubTab=null khi cả 3 checkbox con đều tắt, mọi panel ẩn', async () => {
      await loginAs(page, VPP_USER);
      await page.evaluate(() => { switchTab('vpp'); });
      const state2 = await page.evaluate(() => {
        setVppSubTab('REGISTER');
        return {
          active: activeVppSubTab,
          registerHidden: document.getElementById('vppSubRegister').classList.contains('hidden')
        };
      });
      assertEqual(state2.active, null, `activeVppSubTab phải null, thực tế: ${state2.active}`);
      assert(state2.registerHidden, 'Panel Đăng Ký VPP phải ẩn');
    });

    await run.run('setChecklistReportSubTab(): checklistReportActiveSubTab=null khi cả 2 checkbox con đều tắt, mọi panel ẩn', async () => {
      await loginAs(page, CHECKLIST_USER);
      await page.evaluate(() => { switchTab('checklist'); });
      const state2 = await page.evaluate(() => {
        setChecklistReportSubTab('GENERAL');
        return {
          active: checklistReportActiveSubTab,
          generalHidden: document.getElementById('checklistReportGeneralPanel').classList.contains('hidden')
        };
      });
      assertEqual(state2.active, null, `checklistReportActiveSubTab phải null, thực tế: ${state2.active}`);
      assert(state2.generalHidden, 'Panel Báo Cáo Chung Checklist phải ẩn');
    });

    await run.run('setContractSubTab(): activeContractSubTab=null khi cả 2 checkbox con đều tắt, ẩn form + XOÁ nội dung bảng/dashboard cũ', async () => {
      await loginAs(page, CONTRACT_USER);
      await page.evaluate(() => { switchTab('contract'); });
      const state2 = await page.evaluate(() => {
        // Gọi 1 lần với tbody/dashboard có nội dung "cũ" giả lập trước, để xác nhận hàm XOÁ hẳn (không chỉ
        // ẩn) — mirror đúng tình huống thật: hàm này còn được gọi lại khi dữ liệu quyền làm mới.
        document.getElementById('contractTableBody').innerHTML = '<tr><td>DỮ LIỆU CŨ RÒ RỈ</td></tr>';
        document.getElementById('contractDashboardCards').innerHTML = '<div>CŨ</div>';
        setContractSubTab('MANAGE');
        return {
          active: activeContractSubTab,
          formHidden: document.getElementById('contractManageFormWrap').classList.contains('hidden'),
          paymentColHidden: document.getElementById('contractPaymentColHeader').classList.contains('hidden'),
          tbodyHtml: document.getElementById('contractTableBody').innerHTML,
          dashboardHtml: document.getElementById('contractDashboardCards').innerHTML
        };
      });
      assertEqual(state2.active, null, `activeContractSubTab phải null, thực tế: ${state2.active}`);
      assert(state2.formHidden, 'Form Tạo Mới/Nhập Hợp Đồng phải ẩn');
      assert(state2.paymentColHidden, 'Cột Thanh Toán phải ẩn');
      assert(!state2.tbodyHtml.includes('DỮ LIỆU CŨ RÒ RỈ'), 'Nội dung bảng Hợp Đồng CŨ phải bị XOÁ hẳn (không chỉ ẩn), thực tế: ' + state2.tbodyHtml);
      assert(!state2.dashboardHtml.includes('CŨ'), 'Nội dung Dashboard CŨ phải bị XOÁ hẳn, thực tế: ' + state2.dashboardHtml);
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS nào phát sinh: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
