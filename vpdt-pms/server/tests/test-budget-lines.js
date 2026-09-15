// tests/test-budget-lines.js — Kiểm thử hồi quy module Ngân Sách (v23.0, thiết kế lại HOÀN TOÀN theo
// tài liệu "Ngân sách 2.0" người dùng cung cấp — xem sql/schema.sql/lib/recordActions.js/module-ngansach.js).
// Thay thế các kịch bản Ngân Sách CŨ đã bỏ khỏi tests/test-office-budget.js (Kỳ/Mẫu/budgetEntries không
// còn tồn tại). Bao phủ: 3 giai đoạn Đề Xuất/Phê Duyệt/Sử Dụng độc lập, khoá cứng Nội dung/Mô tả/Danh
// Mục khi kế thừa, tự sinh dòng Sử Dụng khi duyệt Phê Duyệt, tính lại usageStatus theo mục con, chặn tự
// duyệt/tự từ chối, 3 tầng permission phẳng (budgetCreate/budgetAggregate/budgetManage).
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

  async function goToBudget(tab) {
    await page.evaluate((t) => { switchTab('budget'); setBudgetLineTab(t); }, tab);
  }
  async function createBudgetLine(payload) {
    return page.evaluate(async (p) => {
      try { const r = await callCreateAction('budgetLines', p); return { ok: true, item: r.item }; }
      catch (e) { return { ok: false, message: e.message }; }
    }, payload);
  }
  async function recordAction(id, action, payload) {
    return page.evaluate(async ({ id, action, payload }) => {
      try { const r = await callRecordAction('budgetLines', id, action, payload); return { ok: true, ...r }; }
      catch (e) { return { ok: false, message: e.message }; }
    }, { id, action, payload: payload || {} });
  }
  function baseLine(overrides) {
    return {
      stage: 'PROPOSED', dept: 'Phòng Kinh Doanh', location: 'HO',
      content: 'Mua máy tính bàn văn phòng', description: '03 bộ, thay máy cũ hư',
      quantity: 3, unitPrice: 12000000, vatPercent: 10,
      budgetType: 'OPEX', itemCategory: 'HARDWARE',
      budgetYear: 2026, budgetMonth: 10, note: '',
      ...overrides
    };
  }

  try {
    // ============ Kịch bản 0: Phân quyền vào module — gd1 (không có budgetCreate/budgetAggregate/
    // budgetManage) vẫn bị chặn hoàn toàn (canAccessBudgetModule() không đổi hành vi) ============
    await loginAs('gd1');
    const gd1NavHidden = await page.evaluate(() => document.getElementById('btnBudgetNav').classList.contains('hidden'));
    check('gd1 (không có quyền ngân sách nào) -> nút điều hướng "Ngân Sách" bị ẩn', gd1NavHidden, gd1NavHidden);
    await clearAlerts();
    await page.evaluate(() => switchTab('budget'));
    await page.waitForTimeout(150);
    const gd1Blocked = await alerts();
    check('gd1 cố gọi thẳng switchTab("budget") -> bị chặn ngay', gd1Blocked.some((a) => a.includes('Ngân Sách')), gd1Blocked);

    // ============ Kịch bản 1: Validation tạo Đề Xuất — thiếu Nội dung / Khối Phòng Ban sai / Vị trí sai
    // ============
    await loginAs('kd1');
    const missingContent = await createBudgetLine(baseLine({ content: '' }));
    check('Tạo Đề Xuất thiếu Nội dung -> server chặn (400)', !missingContent.ok && missingContent.message.includes('Thiếu nội dung'), missingContent);
    const badDept = await createBudgetLine(baseLine({ dept: 'Phòng Không Tồn Tại' }));
    check('Khối Phòng Ban không có trong Danh Mục Phòng -> bị chặn', !badDept.ok && badDept.message.includes('Khối Phòng Ban'), badDept);
    const badLocation = await createBudgetLine(baseLine({ location: 'Siêu Thị Không Tồn Tại' }));
    check('Vị trí không phải HO và không có trong Danh Mục Siêu Thị -> bị chặn', !badLocation.ok && badLocation.message.includes('Vị trí'), badLocation);

    // ============ Kịch bản 2: kd1 (budgetCreate) tạo Đề Xuất hợp lệ -> SUBMITTED, Thành tiền tự tính
    // đúng 3 × 12.000.000 × 1.10 = 39.600.000 ============
    const propose1 = await createBudgetLine(baseLine());
    check('Tạo Đề Xuất hợp lệ thành công -> SUBMITTED', propose1.ok && propose1.item.status === 'SUBMITTED' && propose1.item.stage === 'PROPOSED', propose1);
    check('Thành tiền tự tính = SL × Đơn giá × (1+VAT%) = 3×12tr×1.1 = 39.600.000', propose1.ok && propose1.item.totalAmount === 39600000, propose1.item && propose1.item.totalAmount);

    // ============ Kịch bản 3: Không thể tự duyệt/tự từ chối Đề Xuất do chính mình tạo ============
    const selfApprove = await recordAction(propose1.item.id, 'approve-proposal');
    check('kd1 KHÔNG tự duyệt được Đề Xuất do chính mình tạo', !selfApprove.ok && selfApprove.message.includes('tự duyệt'), selfApprove);
    const selfReject = await recordAction(propose1.item.id, 'reject-proposal');
    check('kd1 KHÔNG tự từ chối được Đề Xuất do chính mình tạo', !selfReject.ok && selfReject.message.includes('tự duyệt'), selfReject);

    // ============ Kịch bản 4: tp_kd (budgetCreate, khác người tạo) duyệt được Đề Xuất của kd1 -> APPROVED,
    // KHÔNG sinh dòng Sử Dụng nào (chỉ Phê Duyệt mới tự sinh) ============
    await loginAs('tp_kd');
    const approveProposal = await recordAction(propose1.item.id, 'approve-proposal');
    check('tp_kd (khác người tạo) duyệt được Đề Xuất -> APPROVED', approveProposal.ok && approveProposal.item.status === 'APPROVED', approveProposal);
    check('Duyệt Đề Xuất KHÔNG có usedItem nào được tự sinh (khác Phê Duyệt)', approveProposal.ok && !approveProposal.usedItem, approveProposal);

    // ============ Kịch bản 5: Tạo Đề Xuất thứ 2 để test Từ Chối + lý do ============
    await loginAs('kd1');
    const propose2 = await createBudgetLine(baseLine({ content: 'Thuê ngoài kiểm toán quý' }));
    check('Tạo Đề Xuất thứ 2 thành công', propose2.ok, propose2);
    await loginAs('tp_kd');
    const rejectProposal = await recordAction(propose2.item.id, 'reject-proposal', { reason: 'Không đủ ngân sách quý này' });
    check('Từ chối Đề Xuất thành công -> REJECTED, lưu lại lý do', rejectProposal.ok && rejectProposal.item.status === 'REJECTED' && rejectProposal.item.rejectReason.includes('Không đủ ngân sách'), rejectProposal);

    // ============ Kịch bản 6: budgetCreate (kd1) KHÔNG tạo được dòng Phê Duyệt trực tiếp (chỉ
    // budgetManage/admin) ============
    await loginAs('kd1');
    const kd1TryApproveStage = await createBudgetLine(baseLine({ stage: 'APPROVED', content: 'Nâng cấp máy chủ nội bộ' }));
    check('kd1 (chỉ budgetCreate) KHÔNG tạo được dòng Phê Duyệt trực tiếp', !kd1TryApproveStage.ok && kd1TryApproveStage.message.includes('quản lý Ngân Sách'), kd1TryApproveStage);

    // ============ Kịch bản 7: budgetmgr1 (budgetManage) tạo dòng Phê Duyệt trực tiếp thành công ============
    await loginAs('budgetmgr1');
    const approveLine1 = await createBudgetLine(baseLine({
      stage: 'APPROVED', content: 'Nâng cấp máy chủ nội bộ', description: '', dept: 'Phòng Kinh Doanh',
      quantity: 1, unitPrice: 180000000, vatPercent: 0, budgetType: 'CAPEX', itemCategory: 'SYSTEM'
    }));
    check('budgetmgr1 tạo dòng Phê Duyệt trực tiếp thành công -> SUBMITTED', approveLine1.ok && approveLine1.item.stage === 'APPROVED' && approveLine1.item.status === 'SUBMITTED', approveLine1);

    // ============ Kịch bản 8: Không tự duyệt được dòng Phê Duyệt do chính mình tạo (budgetmgr1) ============
    const selfApproveLine = await recordAction(approveLine1.item.id, 'approve');
    check('budgetmgr1 KHÔNG tự duyệt được dòng Phê Duyệt do chính mình tạo', !selfApproveLine.ok && selfApproveLine.message.includes('tự duyệt'), selfApproveLine);

    // ============ Kịch bản 9: budgetmgr1 KHÔNG tự duyệt được -> cần người khác có budgetManage. Không có
    // user thứ 2 nào trong seed có budgetManage, nên xác nhận admin (khác createdBy, KHÔNG bị chặn vì
    // admin không phải người tạo dòng này) duyệt được dòng của budgetmgr1 -> tự sinh 1 dòng Sử Dụng cha
    // đúng field kế thừa ============
    await loginAs('admin');
    const approveLine1Result = await recordAction(approveLine1.item.id, 'approve');
    check('admin (khác người tạo budgetmgr1) duyệt được dòng Phê Duyệt -> APPROVED', approveLine1Result.ok && approveLine1Result.item.status === 'APPROVED', approveLine1Result);
    check('Duyệt Phê Duyệt -> TỰ SINH đúng 1 dòng Sử Dụng cha', approveLine1Result.ok && !!approveLine1Result.usedItem && approveLine1Result.usedItem.stage === 'USED' && approveLine1Result.usedItem.parentId === null, approveLine1Result.usedItem);
    check('Dòng Sử Dụng cha kế thừa ĐÚNG sourceLineId trỏ về dòng Phê Duyệt gốc', approveLine1Result.ok && approveLine1Result.usedItem.sourceLineId === approveLine1.item.id, approveLine1Result.usedItem);
    check('Dòng Sử Dụng cha kế thừa ĐÚNG Nội dung/Danh Mục/Thành tiền từ dòng Phê Duyệt gốc', approveLine1Result.ok && approveLine1Result.usedItem.content === 'Nâng cấp máy chủ nội bộ' && approveLine1Result.usedItem.itemCategory === 'SYSTEM' && approveLine1Result.usedItem.totalAmount === 180000000, approveLine1Result.usedItem);
    check('Dòng Sử Dụng cha mới sinh -> usageStatus = NOT_USED', approveLine1Result.ok && approveLine1Result.usedItem.usageStatus === 'NOT_USED', approveLine1Result.usedItem);
    const usedParentId = approveLine1Result.usedItem.id;

    // ============ Kịch bản 10: Ghi nhận Sử Dụng (mục con) — Nội dung/Mô tả/Danh Mục khoá cứng theo dòng
    // cha (server tự ghi đè dù client cố gửi khác), Tháng mua thực tế bắt buộc, usageStatus tính lại đúng
    // ============
    await loginAs('budgetmgr1');
    const child1 = await recordAction(usedParentId, 'children', {
      content: 'NỘI DUNG GIẢ MẠO', description: 'MÔ TẢ GIẢ MẠO', itemCategory: 'SOFTWARE', // cố tình gửi sai, phải bị ghi đè
      quantity: 1, unitPrice: 80000000, vatPercent: 0, budgetType: 'CAPEX', purchaseMonth: 10
    });
    check('Ghi nhận Sử Dụng (mục con) lần 1 thành công', child1.ok, child1);
    check('Mục con KHOÁ CỨNG Nội dung/Danh Mục theo dòng cha (server bỏ qua giá trị giả mạo client gửi)', child1.ok && child1.item.content === 'Nâng cấp máy chủ nội bộ' && child1.item.itemCategory === 'SYSTEM', child1.item);
    check('Mục con lưu đúng Tháng mua thực tế', child1.ok && child1.item.purchaseMonth === 10, child1.item);
    check('Sau khi ghi nhận 80.000.000/180.000.000 -> dòng cha chuyển PARTIALLY_USED', child1.ok && child1.parentItem.usageStatus === 'PARTIALLY_USED', child1.parentItem);

    // ============ Kịch bản 11: Đổi Loại NS ở mục con khác dòng cha -> bắt buộc Lý do tái phân bổ ============
    const child2NoReason = await recordAction(usedParentId, 'children', {
      quantity: 1, unitPrice: 100000000, vatPercent: 0, budgetType: 'OPEX', purchaseMonth: 10
    });
    check('Đổi Loại NS (CAPEX->OPEX) ở mục con mà KHÔNG nhập Lý do tái phân bổ -> bị chặn', !child2NoReason.ok && child2NoReason.message.includes('Lý do tái phân bổ'), child2NoReason);
    const child2 = await recordAction(usedParentId, 'children', {
      quantity: 1, unitPrice: 100000000, vatPercent: 0, budgetType: 'OPEX', purchaseMonth: 10,
      reallocationReason: 'Chuyển 1 phần chi phí sang OPEX theo thoả thuận nhà cung cấp'
    });
    check('Có nhập Lý do tái phân bổ -> ghi nhận thành công', child2.ok && child2.item.reallocationReason.includes('Chuyển 1 phần'), child2);
    check('Đã dùng đủ 180.000.000 (80tr+100tr) -> dòng cha chuyển USED (đã dùng hết)', child2.ok && child2.parentItem.usageStatus === 'USED', child2.parentItem);

    // ============ Kịch bản 12: budgetCreate (không có budgetManage) vẫn ghi nhận Sử Dụng được, MIỄN LÀ
    // đúng Khối Phòng Ban của dòng cha (kiểm tra nhánh "budgetManage() || parent.dept === user.dept" ở
    // addBudgetLineChild()) ============
    await loginAs('kd1'); // Phòng Kinh Doanh — dòng cha usedParentId cũng thuộc Phòng Kinh Doanh -> ĐƯỢC phép
    const kd1AddChildOwnDept = await recordAction(usedParentId, 'children', {
      quantity: 1, unitPrice: 5000000, vatPercent: 0, budgetType: 'CAPEX', purchaseMonth: 11
    });
    check('budgetCreate (kd1) ghi nhận Sử Dụng được cho dòng cha ĐÚNG Khối Phòng Ban của mình', kd1AddChildOwnDept.ok, kd1AddChildOwnDept);

    // ============ Kịch bản 13: Sửa/Xoá dòng cha Sử Dụng — CHỈ budgetManage/admin, chỉ Vị trí/Khối
    // Phòng Ban/Ghi chú (Nội dung/Danh Mục vẫn khoá cứng) ============
    const kd1TryEditParent = await recordAction(usedParentId, 'used-parent-update', { dept: 'Phòng Kế Toán', location: 'HO', note: 'test' });
    check('budgetCreate (kd1, không có budgetManage) KHÔNG sửa được dòng cha Sử Dụng', !kd1TryEditParent.ok, kd1TryEditParent);
    await loginAs('budgetmgr1');
    const editParent = await recordAction(usedParentId, 'used-parent-update', { dept: 'Phòng Kế Toán', location: 'HO', note: 'Chuyển theo dõi sang Kế Toán' });
    check('budgetManage sửa được Vị trí/Khối Phòng Ban/Ghi chú của dòng cha Sử Dụng', editParent.ok && editParent.item.dept === 'Phòng Kế Toán' && editParent.item.note.includes('Chuyển theo dõi'), editParent);
    check('Nội dung/Danh Mục VẪN khoá cứng sau khi sửa (server không đổi 2 field này)', editParent.ok && editParent.item.content === 'Nâng cấp máy chủ nội bộ' && editParent.item.itemCategory === 'SYSTEM', editParent.item);

    const deleteParentWithChildren = await recordAction(usedParentId, 'used-parent-delete');
    check('KHÔNG xoá được dòng cha Sử Dụng đã có mục con', !deleteParentWithChildren.ok && deleteParentWithChildren.message.includes('mục con'), deleteParentWithChildren);

    // ============ Kịch bản 14: Tạo 1 dòng Phê Duyệt + duyệt riêng để test xoá dòng cha (chưa có mục
    // con) -> mở lại dòng Phê Duyệt gốc về SUBMITTED ============
    const approveLine2 = await createBudgetLine(baseLine({
      stage: 'APPROVED', content: 'Bảo trì hệ thống camera an ninh', description: '',
      quantity: 1, unitPrice: 60000000, vatPercent: 0, budgetType: 'OPEX', itemCategory: 'SERVICE'
    }));
    await loginAs('admin');
    const approveLine2Result = await recordAction(approveLine2.item.id, 'approve');
    check('Duyệt dòng Phê Duyệt thứ 2 thành công, tự sinh dòng Sử Dụng chưa có mục con', approveLine2Result.ok && !!approveLine2Result.usedItem, approveLine2Result);
    const usedParent2Id = approveLine2Result.usedItem.id;
    await loginAs('budgetmgr1');
    const deleteParent2 = await recordAction(usedParent2Id, 'used-parent-delete');
    check('Xoá dòng cha Sử Dụng CHƯA có mục con -> thành công', deleteParent2.ok, deleteParent2);
    // Đọc thẳng state (Node, phía "server" mock) — bài test này gọi callRecordAction()/callCreateAction()
    // TRỰC TIẾP (bỏ qua các hàm UI module-ngansach.js vốn mới là nơi đồng bộ ngược DB.budgetLines phía
    // trình duyệt), nên DB.budgetLines trên trang KHÔNG phản ánh thay đổi này — kiểm tra đúng nguồn sự
    // thật (state.collections, nơi mock backend ghi) thay vì DB.budgetLines phía client.
    const sourceAfterDelete = h.state.collections.budgetLines.find((l) => l.id === approveLine2.item.id);
    check('Xoá dòng cha xong -> dòng Phê Duyệt gốc "mở khoá" lại về SUBMITTED', !!sourceAfterDelete && sourceAfterDelete.status === 'SUBMITTED' && sourceAfterDelete.decidedBy == null, sourceAfterDelete);

    // ============ Kịch bản 15: Phạm vi xem — budgetagg1 (chỉ budgetAggregate, KHÔNG budgetManage) xem
    // được TOÀN BỘ mọi Khối Phòng Ban nhưng KHÔNG được duyệt/sửa gì. filterBudgetLinesForUser() (server)
    // là nơi thực thi luật này — kiểm tra thẳng qua hàm đó (import lib/recordViewScope.js) thay vì qua
    // DB.budgetLines phía client (bài test này gọi API trực tiếp, không qua GET /api/data thật nên
    // DB.budgetLines phía trình duyệt không có ý nghĩa kiểm chứng ở đây) ============
    await loginAs('budgetagg1');
    await goToBudget('PROPOSE');
    const { filterBudgetLinesForUser } = require(require('path').join(__dirname, '..', 'lib', 'recordViewScope'));
    const budgetagg1User = h.state.users.find((u) => u.username === 'budgetagg1');
    const budgetagg1Visible = filterBudgetLinesForUser(h.state.collections.budgetLines, budgetagg1User);
    const budgetagg1SeesAll = new Set(budgetagg1Visible.map((l) => l.dept)).size;
    check('budgetagg1 (budgetAggregate) thấy budgetLines của NHIỀU Khối Phòng Ban khác nhau, không chỉ phòng mình', budgetagg1SeesAll >= 2, budgetagg1SeesAll);
    const aggTryApprove = await recordAction(propose2.item.id, 'approve-proposal');
    check('budgetagg1 (chỉ budgetAggregate, KHÔNG budgetCreate/budgetManage) KHÔNG duyệt được Đề Xuất', !aggTryApprove.ok, aggTryApprove);

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
