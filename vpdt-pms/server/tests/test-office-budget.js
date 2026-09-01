// tests/test-office-budget.js — Kiểm thử hồi quy module Tổng Hợp (Mua Bán/Sửa Chữa/Đầu Tư) + module con
// Ngân Sách: tạo/duyệt/từ chối đề xuất văn phòng, CRUD mẫu ngân sách, tạo kỳ ngân sách (phạm vi phòng
// ban + hạn chót), lập/gửi/duyệt ngân sách theo phòng ban, kiểm tra "kỳ đã đóng" chặn thao tác, và Tổng
// Hợp Ngân Sách (chỉ cộng dồn các bản ĐÃ DUYỆT).
'use strict';

const { startHarness } = require('./_harness-contract');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

async function run() {
  const h = await startHarness();
  const { page, loginAs, alerts, clearAlerts, confirmPending, jsExceptions, stop } = h;

  async function goToOffice(subTab) {
    await page.evaluate((st) => { switchTab('office'); setOfficeSubTab(st); }, subTab);
  }
  async function goToBudget(subTab) {
    await page.evaluate((st) => { switchTab('budget'); setBudgetSubTab(st); }, subTab);
  }
  async function openBudgetManageModal() {
    await page.evaluate(() => { switchTab('budget'); openBudgetPeriodTemplateModal(); });
  }

  try {
    // ============ Kịch bản 1: Validation — "Mua Sắm" (bảng nhiều hạng mục) không có dòng hợp lệ nào
    // (thiếu Tên tài sản / Số lượng <= 0) thì bị chặn, KHÔNG tạo được đề xuất ============
    await loginAs('kd1');
    await goToOffice('MUA_BAN');
    await page.fill('#offReason', 'Kiểm thử validation không có hạng mục hợp lệ.');
    await page.evaluate(() => { officeItems.length = 0; officeItems.push({ name: '', model: '', unit: '', qty: 0, unitPrice: 0, note: '' }); renderOfficeItemsTable(); });
    await clearAlerts();
    await page.evaluate(() => submitOfficeReq({ preventDefault() {}, target: document.getElementById('officeForm') }));
    await page.waitForTimeout(150);
    const noItemAlerts = await alerts();
    check('"Mua Sắm" không có hạng mục hợp lệ nào -> bị chặn ("ít nhất 1 hạng mục hợp lệ")', noItemAlerts.some((a) => a.includes('ít nhất 1 hạng mục hợp lệ')), noItemAlerts);

    // ============ Kịch bản 2: Tạo đề xuất "Mua Sắm" hợp lệ — Dự toán TỰ TÍNH từ Số lượng × Đơn giá
    // từng hạng mục (KHÔNG phải ô nhập tay) ============
    const offCode1 = await page.locator('#offCode').inputValue();
    await page.fill('#offTitle', 'Mua sắm máy in văn phòng');
    await page.evaluate(() => {
      officeItems.length = 0;
      officeItems.push({ name: 'Máy in Laser A4', model: 'LX-2000', unit: 'Cái', qty: 3, unitPrice: 5000000, note: '' });
      officeItems.push({ name: 'Mực in dự phòng', model: '', unit: 'Hộp', qty: 6, unitPrice: 500000, note: '' });
      renderOfficeItemsTable();
    });
    await clearAlerts();
    await page.evaluate(() => submitOfficeReq({ preventDefault() {}, target: document.getElementById('officeForm') }));
    await page.waitForTimeout(200);
    const office1 = await page.evaluate((code) => {
      const o = DB.officeReqs.find((x) => x.code === code);
      return o ? { id: o.id, amount: o.amount, itemsLen: (o.items || []).length, status: o.status, paymentStatus: o.paymentStatus } : null;
    }, offCode1);
    check('Tạo đề xuất Mua Sắm thành công, vào hàng chờ PENDING', !!office1 && office1.status === 'PENDING', office1);
    check('Dự toán tự tính = Σ(Số lượng × Đơn giá) = 3×5tr + 6×0.5tr = 18.000.000', !!office1 && office1.amount === 18000000, office1 && office1.amount);
    check('Trước khi duyệt xong -> paymentStatus CHƯA được gán (chỉ gán khi duyệt xong bước cuối)', !!office1 && office1.paymentStatus === undefined, office1 && office1.paymentStatus);

    // ============ Kịch bản 3: Tạo đề xuất "Sửa Chữa" (1 dòng Số lượng/Dự toán, không dùng bảng hạng
    // mục) — dùng để kiểm thử luồng Từ Chối ============
    await goToOffice('SUA_CHUA');
    const offCode2 = await page.locator('#offCode').inputValue();
    await page.fill('#offTitle', 'Sửa chữa hệ thống điều hoà tầng 3');
    await page.fill('#offQty', '1 hệ thống');
    await page.fill('#offAmount', '12000000');
    await page.fill('#offSupplier', 'Công ty Điện Lạnh Test');
    await page.fill('#offReason', 'Hệ thống điều hoà hỏng, cần sửa chữa gấp.');
    await clearAlerts();
    await page.evaluate(() => submitOfficeReq({ preventDefault() {}, target: document.getElementById('officeForm') }));
    await page.waitForTimeout(200);
    const office2 = await page.evaluate((code) => DB.officeReqs.find((x) => x.code === code), offCode2);
    check('Tạo đề xuất Sửa Chữa thành công (không dùng bảng hạng mục), Dự toán lấy đúng ô nhập tay', !!office2 && office2.amount === 12000000 && office2.items === null, office2);

    // ============ Kịch bản 4: Quy trình duyệt Mua Sắm — duyệt xong bước cuối mới gán paymentStatus
    // CHUA_THANH_TOAN (khớp lib/workflowEngine.js applyWorkflowAction, nhánh moduleKey==='officeReqs')
    await loginAs('tp_kd');
    await goToOffice('MUA_BAN');
    await page.evaluate((id) => openOfficeProcessModal(id), office1.id);
    await page.evaluate(() => confirmProcessOfficeReq('APPROVE'));
    await confirmPending();
    const office1AfterApprove = await page.evaluate((id) => DB.officeReqs.find((x) => x.id === id), office1.id);
    check('Duyệt xong bước cuối (1 bước) -> status chuyển APPROVED', office1AfterApprove.status === 'APPROVED', office1AfterApprove.status);
    check('Duyệt xong -> tự gán paymentStatus = CHUA_THANH_TOAN', office1AfterApprove.paymentStatus === 'CHUA_THANH_TOAN', office1AfterApprove.paymentStatus);

    // ============ Kịch bản 5: Từ chối đề xuất Sửa Chữa — bắt buộc nhập Ý kiến chỉ đạo ============
    await goToOffice('SUA_CHUA');
    await page.evaluate((id) => openOfficeProcessModal(id), office2.id);
    await clearAlerts();
    await page.evaluate(() => confirmProcessOfficeReq('REJECT'));
    const missingReasonAlerts = await alerts();
    check('Từ chối mà chưa nhập Ý kiến chỉ đạo -> bị chặn ngay ở client', missingReasonAlerts.some((a) => a.includes('Vui lòng nhập lý do từ chối')), missingReasonAlerts);

    await page.fill('#txtOfficeComment', 'Báo giá vượt ngân sách phê duyệt, đề nghị tìm nhà cung cấp khác.');
    await page.evaluate(() => confirmProcessOfficeReq('REJECT'));
    await confirmPending();
    const office2AfterReject = await page.evaluate((id) => DB.officeReqs.find((x) => x.id === id).status, office2.id);
    check('Từ chối đề xuất Sửa Chữa -> status chuyển REJECTED', office2AfterReject === 'REJECTED', office2AfterReject);

    // ============ Kịch bản 6: Ngân Sách — tạo Mẫu Ngân Sách (4 cột lõi bắt buộc + 1 cột tuỳ biến), qua
    // modal "⚙️ Quản Lý Kỳ & Mẫu" (trước đây là sub-tab PERIOD riêng, nay gộp vào modal) ============
    await loginAs('budgetmgr1');
    await openBudgetManageModal();
    const manageModalVisible = await page.evaluate(() => !document.getElementById('budgetPeriodTemplateModal').classList.contains('hidden'));
    check('Nút "⚙️ Quản Lý Kỳ & Mẫu" mở đúng modal quản lý kỳ/mẫu ngân sách', manageModalVisible, manageModalVisible);
    await page.evaluate(() => { startNewBudgetTemplate(); addBudgetTemplateField(); });
    const newFieldIdx = await page.evaluate(() => budgetTemplateFormFields.length - 1);
    await page.evaluate((idx) => updateBudgetTemplateField(idx, 'label', 'Nhà cung cấp'), newFieldIdx);
    await page.fill('#budgetTemplateName', 'Mẫu Ngân Sách Kinh Doanh');
    await clearAlerts();
    await page.click('#btnBudgetTemplateSubmit');
    await page.waitForTimeout(200);
    const template1 = await page.evaluate(() => DB.budgetTemplates.find((t) => t.name === 'Mẫu Ngân Sách Kinh Doanh'));
    const coreFields = (template1 && template1.fields || []).filter((f) => f.coreKey);
    check('Tạo mẫu ngân sách -> luôn có đủ 3 cột lõi bắt buộc (Tên Hạng Mục/Số Tiền/Loại NS), không xoá được', !!template1 && coreFields.filter((f) => f.removable === false).length === 3, coreFields);
    const customField = (template1 && template1.fields || []).find((f) => f.label === 'Nhà cung cấp');
    check('Cột tuỳ biến "Nhà cung cấp" được thêm đúng, removable=true', !!customField && customField.removable === true, customField);

    // ============ Kịch bản 7: Validation tạo Kỳ Ngân Sách — hạn chót trong QUÁ KHỨ bị chặn, chưa
    // chọn phòng ban áp dụng cũng bị chặn ============
    await page.fill('#budgetPeriodName', 'Ngân sách Quý 4/2026');
    await page.fill('#budgetPeriodEndTime', '2020-01-01T00:00');
    await clearAlerts();
    await page.evaluate(() => createBudgetPeriod({ preventDefault() {} }));
    await page.waitForTimeout(150);
    const pastDateAlerts = await alerts();
    check('Hạn chót lập ngân sách ở QUÁ KHỨ -> bị chặn', pastDateAlerts.some((a) => a.includes('trong tương lai')), pastDateAlerts);

    await page.fill('#budgetPeriodEndTime', '2027-01-01T00:00');
    await clearAlerts();
    await page.evaluate(() => createBudgetPeriod({ preventDefault() {} }));
    await page.waitForTimeout(150);
    const noDeptAlerts = await alerts();
    check('Chưa chọn phòng ban áp dụng nào (và không chọn "Tất cả") -> bị chặn', noDeptAlerts.some((a) => a.includes('ít nhất 1 phòng ban')), noDeptAlerts);

    // ============ Kịch bản 8: Tạo Kỳ Ngân Sách hợp lệ (chỉ áp dụng "Phòng Kinh Doanh", gắn mẫu vừa
    // tạo) ============
    await page.check('#budgetPeriodDept_0'); // DB.depts[0] = 'Phòng Kinh Doanh'
    await page.selectOption('#budgetPeriodTemplateSelect', String(template1.id));
    await clearAlerts();
    await page.evaluate(() => createBudgetPeriod({ preventDefault() {} }));
    await page.waitForTimeout(200);
    const period1 = await page.evaluate(() => DB.budgetPeriods.find((p) => p.name === 'Ngân sách Quý 4/2026'));
    check('Tạo kỳ ngân sách thành công -> OPEN, đúng phạm vi phòng ban + mẫu đã chọn', !!period1 && period1.status === 'OPEN' && period1.deptScope.depts.includes('Phòng Kinh Doanh') && period1.templateId === template1.id, period1);

    // ============ Kịch bản 9: Ngân Sách Phê Duyệt (kd1, phòng ban Kinh Doanh) theo đúng mẫu đã gắn ====
    await loginAs('kd1');
    await goToBudget('APPROVED');
    await page.selectOption('#budgetEntryPeriodSelect_PLAN', String(period1.id));
    await page.evaluate(() => saveBudgetEntryDraft('PLAN')); // chưa nhập dòng nào -> phải bị chặn
    // (không cần chờ vì đây là kiểm tra client thuần, đồng bộ)
    const emptyLinesAlerts = await alerts();
    check('Lưu nháp ngân sách khi CHƯA nhập dòng nào -> bị chặn ở client', emptyLinesAlerts.some((a) => a.includes('ít nhất 1 dòng ngân sách')), emptyLinesAlerts);

    const customFieldId = customField.id;
    await page.evaluate((fid) => {
      const row = document.querySelector('#budgetEntryLinesBody_PLAN tr[data-budget-line-idx="0"]');
      row.querySelector('.budget-line-core[data-core-key="name"]').value = 'Chi phí quảng cáo Quý 4';
      row.querySelector('.budget-line-core[data-core-key="amount"]').value = '80000000';
      row.querySelector('.budget-line-core[data-core-key="budgetType"]').value = 'OPEX';
      row.querySelector(`.budget-line-extra[data-field-id="${fid}"]`).value = 'Công ty Quảng Cáo ABC';
    }, customFieldId);
    await clearAlerts();
    await page.evaluate(() => saveBudgetEntryDraft('PLAN'));
    await page.waitForTimeout(200);
    const entry1 = await page.evaluate(() => DB.budgetEntries.find((e) => e.dept === 'Phòng Kinh Doanh' && e.periodId && e.entryKind !== 'ACTUAL'));
    check('Lưu nháp ngân sách Phê Duyệt thành công -> trạng thái DRAFT, entryKind=PLAN, đúng 1 dòng, đúng tên/số tiền/loại NS', !!entry1 && entry1.status === 'DRAFT' && entry1.entryKind === 'PLAN' && entry1.lines.length === 1 && entry1.lines[0].name === 'Chi phí quảng cáo Quý 4' && entry1.lines[0].amount === 80000000 && entry1.lines[0].budgetType === 'OPEX', entry1);
    // Đã vá: lib/createValidation.js sanitizeBudgetCustomFields() trước đây sinh id CỘT TUỲ BIẾN mới
    // bằng Date.now() ở MỌI lượt gọi (kể cả chỉ ĐỌC lại mẫu, không phải lúc LƯU), khiến id client dùng
    // để đặt tên key `extra` không khớp id server tính lại lúc validate -> mất giá trị cột tuỳ biến. Nay
    // hàm giữ nguyên id đã có, chỉ sinh id mới cho cột thực sự chưa có id (hoặc bị trùng) — xác nhận id
    // ổn định giữa lúc client dùng và lúc server lưu, giá trị "Nhà cung cấp" không bị mất.
    const savedExtra = entry1 && entry1.lines[0].extra;
    check('id cột tuỳ biến ổn định giữa client và server -> giá trị "Nhà cung cấp" được lưu đúng, không bị mất', !!savedExtra && savedExtra[customFieldId] === 'Công ty Quảng Cáo ABC', { customFieldId, savedExtra });

    // Mỗi phòng ban CHỈ 1 bản/kỳ/LOẠI (entryKind) — tạo thêm 1 bản PLAN khác (không qua "Sửa Nháp") cho
    // CÙNG kỳ+phòng ban+loại phải bị server từ chối.
    await clearAlerts();
    await page.evaluate(() => {
      const payload = { code: generateBudgetEntryCode(), periodId: Number(document.getElementById('budgetEntryPeriodSelect_PLAN').value), entryKind: 'PLAN', lines: [{ name: 'Dòng khác', description: '', amount: 1000000, budgetType: 'OPEX', extra: {} }], createdAt: new Date().toLocaleString('vi-VN') };
      return callCreateAction('budgetEntries', payload).catch((e) => { window.__alerts.push(e.message); });
    });
    await page.waitForTimeout(150);
    const dupBudgetAlerts = await alerts();
    check('Phòng ban đã có ngân sách PHÊ DUYỆT ở kỳ này -> tạo thêm bản PLAN mới bị chặn ("vui lòng sửa bản nháp hiện có")', dupBudgetAlerts.some((a) => a.includes('đã có ngân sách phê duyệt ở kỳ này')), dupBudgetAlerts);

    // ============ Kịch bản 9b: Ngân Sách Thực Hiện (kd1, CÙNG kỳ + CÙNG phòng ban) — entryKind=ACTUAL
    // KHÔNG bị chặn trùng với bản PLAN đã có ở kịch bản 9 (khoá theo bộ kỳ+phòng ban+entryKind) ========
    await goToBudget('ACTUAL');
    await page.selectOption('#budgetEntryPeriodSelect_ACTUAL', String(period1.id));
    await page.evaluate((fid) => {
      const row = document.querySelector('#budgetEntryLinesBody_ACTUAL tr[data-budget-line-idx="0"]');
      row.querySelector('.budget-line-core[data-core-key="name"]').value = 'Chi phí quảng cáo Quý 4';
      row.querySelector('.budget-line-core[data-core-key="amount"]').value = '72000000';
      row.querySelector('.budget-line-core[data-core-key="budgetType"]').value = 'OPEX';
      row.querySelector(`.budget-line-extra[data-field-id="${fid}"]`).value = 'Công ty Quảng Cáo ABC';
    }, customFieldId);
    await clearAlerts();
    await page.evaluate(() => saveBudgetEntryDraft('ACTUAL'));
    await page.waitForTimeout(200);
    const actualEntry1 = await page.evaluate(() => DB.budgetEntries.find((e) => e.dept === 'Phòng Kinh Doanh' && e.entryKind === 'ACTUAL'));
    check('Lưu nháp ngân sách Thực Hiện thành công cho CÙNG kỳ+phòng ban đã có bản Phê Duyệt -> KHÔNG bị chặn trùng (khoá riêng theo entryKind)', !!actualEntry1 && actualEntry1.status === 'DRAFT' && actualEntry1.entryKind === 'ACTUAL' && actualEntry1.lines[0].amount === 72000000, actualEntry1);
    const budgetEntriesForDeptPeriod = await page.evaluate(() => DB.budgetEntries.filter((e) => e.dept === 'Phòng Kinh Doanh' && e.periodId));
    check('Phòng Kinh Doanh có ĐÚNG 2 bản ngân sách ở kỳ này (1 PLAN + 1 ACTUAL), không đè lên nhau', budgetEntriesForDeptPeriod.length === 2, budgetEntriesForDeptPeriod.map((e) => ({ id: e.id, entryKind: e.entryKind })));

    // ============ Kịch bản 10: Gửi Duyệt cả 2 bản (DRAFT -> PENDING) rồi Trưởng phòng KD duyệt cả 2 =>
    // APPROVED (dùng CHUNG 1 cấu hình duyệt theo phòng ban budgetDeptWorkflows cho cả PLAN lẫn ACTUAL) ==
    await page.evaluate(() => submitCurrentBudgetEntry('ACTUAL'));
    await confirmPending();
    const actualEntry1AfterSubmit = await page.evaluate((id) => DB.budgetEntries.find((e) => e.id === id), actualEntry1.id);
    check('"Gửi Duyệt" bản Thực Hiện -> chuyển PENDING, bắt đầu chờ Trưởng phòng duyệt', actualEntry1AfterSubmit.status === 'PENDING', actualEntry1AfterSubmit.status);

    await goToBudget('APPROVED');
    await page.evaluate(() => submitCurrentBudgetEntry('PLAN'));
    await confirmPending();
    const entry1AfterSubmit = await page.evaluate((id) => DB.budgetEntries.find((e) => e.id === id), entry1.id);
    check('"Gửi Duyệt" bản Phê Duyệt -> chuyển PENDING, bắt đầu chờ Trưởng phòng duyệt', entry1AfterSubmit.status === 'PENDING', entry1AfterSubmit.status);

    await loginAs('tp_kd');
    await goToBudget('APPROVED');
    await page.evaluate((id) => openBudgetProcessModal(id), entry1.id);
    const processModalTitlePlan = await page.locator('#budgetProcessModalTitle').innerText();
    check('Modal xử lý hiện đúng nhãn "Ngân Sách Phê Duyệt" cho bản PLAN', processModalTitlePlan.includes('Phê Duyệt'), processModalTitlePlan);
    await page.fill('#txtBudgetProcessComment', 'Đồng ý — khớp kế hoạch quảng cáo đã thống nhất.');
    await page.evaluate(() => confirmProcessBudgetEntry('APPROVE'));
    await confirmPending();
    const entry1AfterApprove = await page.evaluate((id) => DB.budgetEntries.find((e) => e.id === id).status, entry1.id);
    check('Trưởng phòng duyệt bản ngân sách Phê Duyệt -> chuyển APPROVED', entry1AfterApprove === 'APPROVED', entry1AfterApprove);

    await page.evaluate((id) => openBudgetProcessModal(id), actualEntry1.id);
    const processModalTitleActual = await page.locator('#budgetProcessModalTitle').innerText();
    check('Modal xử lý hiện đúng nhãn "Ngân Sách Thực Hiện" cho bản ACTUAL', processModalTitleActual.includes('Thực Hiện'), processModalTitleActual);
    await page.fill('#txtBudgetProcessComment', 'Đồng ý — khớp số liệu chi tiêu thực tế.');
    await page.evaluate(() => confirmProcessBudgetEntry('APPROVE'));
    await confirmPending();
    const actualEntry1AfterApprove = await page.evaluate((id) => DB.budgetEntries.find((e) => e.id === id).status, actualEntry1.id);
    check('Trưởng phòng duyệt bản ngân sách Thực Hiện -> chuyển APPROVED', actualEntry1AfterApprove === 'APPROVED', actualEntry1AfterApprove);

    // ============ Kịch bản 11: Kỳ ngân sách đã ĐÓNG -> chặn lập ngân sách mới (kể cả phòng ban thuộc
    // phạm vi và đang trong hạn), qua modal Quản Lý Kỳ & Mẫu ============
    await loginAs('budgetmgr1');
    await openBudgetManageModal();
    await page.fill('#budgetPeriodName', 'Ngân sách Quý 4/2026 - Đóng Sớm');
    await page.fill('#budgetPeriodEndTime', '2027-06-01T00:00');
    await page.check('#budgetPeriodDeptAll'); // áp dụng toàn bộ phòng ban
    await page.evaluate(() => createBudgetPeriod({ preventDefault() {} }));
    await page.waitForTimeout(200);
    const period2 = await page.evaluate(() => DB.budgetPeriods.find((p) => p.name === 'Ngân sách Quý 4/2026 - Đóng Sớm'));
    await page.evaluate((id) => closeBudgetPeriodAction(id), period2.id);
    await confirmPending();
    const period2Closed = await page.evaluate((id) => DB.budgetPeriods.find((p) => p.id === id).status, period2.id);
    check('Đóng sớm kỳ ngân sách -> status chuyển CLOSED', period2Closed === 'CLOSED', period2Closed);
    await page.evaluate(() => closeBudgetPeriodTemplateModal());

    await loginAs('kd1');
    await goToBudget('APPROVED');
    await clearAlerts();
    await page.evaluate((pid) => callCreateAction('budgetEntries', { code: 'NS-TEST-CLOSED', periodId: pid, entryKind: 'PLAN', lines: [{ name: 'X', description: '', amount: 1, budgetType: 'OPEX', extra: {} }], createdAt: '' }).catch((e) => { window.__alerts.push(e.message); }), period2.id);
    await page.waitForTimeout(150);
    const closedPeriodAlerts = await alerts();
    check('Kỳ ngân sách đã đóng -> lập ngân sách mới bị chặn ("đã kết thúc")', closedPeriodAlerts.some((a) => a.includes('đã kết thúc')), closedPeriodAlerts);

    // ============ Kịch bản 12: Tổng Hợp Ngân Sách — so sánh Phê Duyệt (80.000.000) vs Thực Hiện
    // (72.000.000), CHỈ cộng dồn các bản ĐÃ DUYỆT của mỗi loại, tính đúng Chênh Lệch ============
    await loginAs('budgetmgr1');
    await goToBudget('SUMMARY');
    await page.selectOption('#budgetSummaryPeriodSelect', String(period1.id));
    await page.evaluate(() => buildBudgetSummary());
    const summary = await page.evaluate(() => currentBudgetSummaryData && {
      planCount: currentBudgetSummaryData.planEntries.length,
      actualCount: currentBudgetSummaryData.actualEntries.length,
      planTotal: currentBudgetSummaryData.planEntries.reduce((s, e) => s + (e.lines || []).reduce((s2, l) => s2 + (Number(l.amount) || 0), 0), 0),
      actualTotal: currentBudgetSummaryData.actualEntries.reduce((s, e) => s + (e.lines || []).reduce((s2, l) => s2 + (Number(l.amount) || 0), 0), 0)
    });
    check('Tổng Hợp Ngân Sách chỉ lấy đúng 1 bản PLAN + 1 bản ACTUAL đã DUYỆT của kỳ', !!summary && summary.planCount === 1 && summary.actualCount === 1, summary);
    check('Tổng Hợp Ngân Sách cộng đúng Tổng Phê Duyệt = 80.000.000, Tổng Thực Hiện = 72.000.000', !!summary && summary.planTotal === 80000000 && summary.actualTotal === 72000000, summary);
    const summaryText = await page.locator('#budgetSummaryResultWrap').innerText();
    check('Khối kết quả Tổng Hợp hiển thị đúng nhãn Phê Duyệt/Thực Hiện/Chênh Lệch trên giao diện', summaryText.includes('Phê Duyệt') && summaryText.includes('Thực Hiện') && summaryText.includes('Chênh Lệch') && summaryText.includes('80.000.000') && summaryText.includes('72.000.000'), summaryText.slice(0, 600));
    check('Khối kết quả Tổng Hợp hiển thị đúng chênh lệch = -8.000.000 (thực hiện thấp hơn phê duyệt)', summaryText.includes('-8.000.000'), summaryText.slice(0, 600));
    check('budgetManage (budgetmgr1, tầng 2 — cao nhất) thấy khối "Toàn Công Ty" trong Tổng Hợp', summaryText.includes('📌 Toàn Công Ty') && summaryText.includes('Tổng Phê Duyệt') && summaryText.includes('Tổng Thực Hiện'), summaryText.slice(0, 600));

    // ============ Kịch bản 12b: Phân quyền 3 tầng Ngân Sách (SỬA LẠI theo yêu cầu) — người KHÔNG có bất
    // kỳ quyền ngân sách nào (budgetCreate/budgetAggregate/budgetManage đều false, dù còn quyền vào
    // module ở mục 0) giờ bị KHOÁ HOÀN TOÀN, không còn tầng "xem miễn phí" nào nữa — đúng khuôn
    // canAccessOfficeModule() (đòi 1 trong 3 quyền officeBuy/Fix/Invest) ============
    await loginAs('gd1'); // chỉ có contractView — không có bất kỳ quyền ngân sách nào
    const gd1BudgetNavHidden = await page.evaluate(() => document.getElementById('btnBudgetNav').classList.contains('hidden'));
    check('gd1 (không có budgetCreate/budgetAggregate/budgetManage) -> nút điều hướng "Ngân Sách" bị ẩn', gd1BudgetNavHidden, gd1BudgetNavHidden);
    await clearAlerts();
    await page.evaluate(() => switchTab('budget'));
    await page.waitForTimeout(150);
    const gd1BlockedAlerts = await alerts();
    check('gd1 cố gọi thẳng switchTab("budget") -> bị chặn ngay bằng alert "không có quyền truy cập Module Ngân Sách"', gd1BlockedAlerts.some((a) => a.includes('Ngân Sách')), gd1BlockedAlerts);
    const gd1BudgetSectionHidden = await page.evaluate(() => document.getElementById('budgetSection').classList.contains('hidden'));
    check('gd1 bị chặn -> #budgetSection vẫn ẩn, không lộ bất kỳ dữ liệu ngân sách nào', gd1BudgetSectionHidden, gd1BudgetSectionHidden);

    // ============ Kịch bản 12b-2: budgetCreate (kd1, KHÔNG có budgetAggregate/budgetManage) — "phải có
    // quyền xem, tạo ngân sách mới xem/nhập/sửa được ngân sách Phê Duyệt & Thực Hiện của phòng mình, [và
    // xem được] ngân sách tổng hợp của phòng" -> kd1 giờ vào được tab Tổng Hợp, thấy ĐÚNG số liệu PHÒNG
    // MÌNH (Phòng Kinh Doanh), nhưng KHÔNG thấy khối "Toàn Công Ty" (chỉ budgetManage mới thấy) ============
    await loginAs('kd1');
    await goToBudget('APPROVED');
    const kd1SummaryBtnVisible = await page.evaluate(() => !document.getElementById('btnBudgetSubSummary').classList.contains('hidden'));
    check('kd1 (chỉ có budgetCreate) -> ĐÃ thấy nút tab Tổng Hợp (trước đây chỉ budgetAggregate/budgetManage mới thấy)', kd1SummaryBtnVisible, kd1SummaryBtnVisible);
    await goToBudget('SUMMARY');
    await page.selectOption('#budgetSummaryPeriodSelect', String(period1.id));
    await page.evaluate(() => buildBudgetSummary());
    const kd1SummaryText = await page.locator('#budgetSummaryResultWrap').innerText();
    check('kd1 thấy đúng "ngân sách tổng hợp của phòng" mình (Phòng Kinh Doanh, 80.000.000/72.000.000) ở tab Tổng Hợp', kd1SummaryText.includes('Phòng Kinh Doanh') && kd1SummaryText.includes('80.000.000') && kd1SummaryText.includes('72.000.000'), kd1SummaryText.slice(0, 700));
    check('kd1 (không có budgetManage) -> KHÔNG thấy khối "📌 Toàn Công Ty" / thẻ tổng gộp', !kd1SummaryText.includes('📌 Toàn Công Ty') && !kd1SummaryText.includes('Tổng Phê Duyệt') && !kd1SummaryText.includes('Tổng Thực Hiện'), kd1SummaryText.slice(0, 700));
    check('kd1 thấy dòng ghi chú "chỉ hiển thị đúng phòng ban của bạn"', kd1SummaryText.includes('chỉ hiển thị đúng phòng ban của bạn'), kd1SummaryText.slice(0, 700));

    // ============ Kịch bản 12c: Phân quyền 3 tầng Ngân Sách — tầng budgetAggregate (budgetagg1, KHÔNG có
    // budgetManage). Phải thấy tab Tổng Hợp + khối "Theo Phòng Ban"/"Chi Tiết Theo Hạng Mục" (MỌI phòng
    // ban, không chỉ phòng mình), nhưng TUYỆT ĐỐI KHÔNG được thấy khối "📌 Toàn Công Ty" (chỉ budgetManage
    // mới thấy con số gộp toàn công ty) ============
    await loginAs('budgetagg1');
    await goToBudget('APPROVED'); // vào module trước để nav tab render lại đúng theo quyền của budgetagg1
    const aggSummaryBtnVisible = await page.evaluate(() => !document.getElementById('btnBudgetSubSummary').classList.contains('hidden'));
    check('budgetagg1 (có budgetAggregate) -> thấy nút tab Tổng Hợp', aggSummaryBtnVisible, aggSummaryBtnVisible);
    await goToBudget('SUMMARY');
    await page.selectOption('#budgetSummaryPeriodSelect', String(period1.id));
    await page.evaluate(() => buildBudgetSummary());
    const aggSummaryText = await page.locator('#budgetSummaryResultWrap').innerText();
    check('budgetagg1 thấy khối "Theo Phòng Ban" với đúng số liệu của Phòng Kinh Doanh (mọi phòng ban, không chỉ phòng mình — Kế Toán)', aggSummaryText.includes('Theo Phòng Ban') && aggSummaryText.includes('Phòng Kinh Doanh') && aggSummaryText.includes('80.000.000') && aggSummaryText.includes('72.000.000'), aggSummaryText.slice(0, 700));
    check('budgetagg1 KHÔNG thấy khối "📌 Toàn Công Ty" / các thẻ tổng gộp (chỉ budgetManage mới xem được)', !aggSummaryText.includes('📌 Toàn Công Ty') && !aggSummaryText.includes('Tổng Phê Duyệt') && !aggSummaryText.includes('Tổng Thực Hiện'), aggSummaryText.slice(0, 700));
    check('budgetagg1 thấy dòng ghi chú giải thích vì sao không xem được số liệu toàn công ty', aggSummaryText.includes('chỉ người có quyền Quản Lý Ngân Sách mới xem được'), aggSummaryText.slice(0, 700));

    // ============ Kịch bản 13: "Bổ Sung" (REQUEST_CHANGES) cho Mua Bán/Sửa Chữa/Đầu Tư — người duyệt
    // trả đề xuất về NHÁP, người tạo sửa lại qua modal "Sửa & Gửi Lại" (openBosungEditModal/
    // confirmBosungResubmit ở public/index.html, gọi lib/recordActions.js editOfficeReqDraft()/
    // submitOfficeReqDraft() thật qua tests/_mockBackend.js) rồi được duyệt lại từ bước 1 ============
    await loginAs('kd1');
    await goToOffice('SUA_CHUA');
    const offCode3 = await page.locator('#offCode').inputValue();
    await page.fill('#offTitle', 'Sửa chữa mái tôn nhà xưởng');
    await page.fill('#offQty', '1 hạng mục');
    await page.fill('#offAmount', '9000000');
    await page.fill('#offSupplier', 'Công ty Xây Dựng Test');
    await page.fill('#offReason', 'Mái tôn bị dột, cần sửa gấp trước mùa mưa.');
    await clearAlerts();
    await page.evaluate(() => submitOfficeReq({ preventDefault() {}, target: document.getElementById('officeForm') }));
    await page.waitForTimeout(200);
    const office3 = await page.evaluate((code) => DB.officeReqs.find((x) => x.code === code), offCode3);
    check('Tạo đề xuất Sửa Chữa (kịch bản Bổ Sung) thành công', !!office3 && office3.status === 'PENDING', office3);

    await loginAs('tp_kd');
    await goToOffice('SUA_CHUA');
    await page.evaluate((id) => openOfficeProcessModal(id), office3.id);
    await clearAlerts();
    await page.evaluate(() => confirmProcessOfficeReq('REQUEST_CHANGES'));
    const missingReasonChangesAlerts = await alerts();
    check('"Bổ Sung" mà chưa nhập Ý kiến chỉ đạo -> bị chặn ngay ở client', missingReasonChangesAlerts.some((a) => a.includes('Vui lòng nhập lý do cần bổ sung')), missingReasonChangesAlerts);

    await page.fill('#txtOfficeComment', 'Thiếu báo giá chi tiết vật tư — vui lòng bổ sung và trình lại.');
    await page.evaluate(() => confirmProcessOfficeReq('REQUEST_CHANGES'));
    await confirmPending();
    const office3AfterChanges = await page.evaluate((id) => DB.officeReqs.find((x) => x.id === id), office3.id);
    check('"Bổ Sung" -> đề xuất chuyển về DRAFT (currentStep reset)', !!office3AfterChanges && office3AfterChanges.status === 'DRAFT' && office3AfterChanges.currentStep === 0, office3AfterChanges);
    check('"Bổ Sung" -> lịch sử ghi nhận đúng hành động REQUEST_CHANGES kèm lý do', (office3AfterChanges.history || []).some((h) => h.action === 'REQUEST_CHANGES' && h.comment.includes('báo giá chi tiết')), office3AfterChanges.history);

    // Server-side: người KHÔNG PHẢI người tạo không được sửa hồ sơ đang NHÁP này. callRecordAction()
    // ném Error khi !res.ok — bắt lại ngay trong page.evaluate() để không làm hỏng luồng test.
    await loginAs('tp_kd');
    const foreignEditCheck = await page.evaluate(async (id) => {
      try { await callRecordAction('officeReqs', id, 'update', { title: 'Hack' }); return { blocked: false }; }
      catch (e) { return { blocked: true, message: e.message }; }
    }, office3.id);
    check('Người khác (không phải người tạo) không sửa được đề xuất đang NHÁP này', foreignEditCheck.blocked, foreignEditCheck);

    await loginAs('kd1');
    await goToOffice('SUA_CHUA');
    await page.evaluate((id) => openBosungEditModal('officeReqs', id), office3.id);
    const reasonNoteText = await page.locator('#bosungEditReasonNote').innerText();
    check('Modal "Sửa & Gửi Lại" hiện đúng lý do người duyệt vừa yêu cầu bổ sung', reasonNoteText.includes('báo giá chi tiết'), reasonNoteText);
    await page.fill('#bsTitle', 'Sửa chữa mái tôn nhà xưởng (đã bổ sung báo giá)');
    await page.fill('#bsAmount', '9500000');
    await page.fill('#bsSupplier', 'Công ty Xây Dựng Test (kèm báo giá chi tiết)');
    await clearAlerts();
    await page.evaluate(() => confirmBosungResubmit());
    await page.waitForTimeout(250);
    const office3AfterResubmit = await page.evaluate((id) => DB.officeReqs.find((x) => x.id === id), office3.id);
    check('"Sửa & Gửi Lại" -> đề xuất quay lại PENDING, bước 1, nội dung đã cập nhật (kể cả Dự toán)', !!office3AfterResubmit && office3AfterResubmit.status === 'PENDING' && office3AfterResubmit.currentStep === 1 && office3AfterResubmit.title.includes('đã bổ sung báo giá') && office3AfterResubmit.amount === 9500000, office3AfterResubmit);

    await loginAs('tp_kd');
    await goToOffice('SUA_CHUA');
    await page.evaluate((id) => openOfficeProcessModal(id), office3.id);
    await page.fill('#txtOfficeComment', 'Đã đủ báo giá, đồng ý.');
    await page.evaluate(() => confirmProcessOfficeReq('APPROVE'));
    await confirmPending();
    const office3Final = await page.evaluate((id) => DB.officeReqs.find((x) => x.id === id).status, office3.id);
    check('Sau khi bổ sung + gửi lại, đề xuất được duyệt lại bình thường -> APPROVED', office3Final === 'APPROVED', office3Final);

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
