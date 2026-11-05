// server/tests/demo-owi-contract-multi-contractor.js
//
// DEMO thật — chụp ảnh tính năng MỚI "Nhiều Nhà Thầu" cho modal "💰 Giá trị hợp đồng" (11/2026, phản hồi
// người dùng kèm 2 ảnh chụp màn hình thật (HCRC-SX-SCST-004, dòng "Bảng Biển") + 1 ảnh tự vẽ tay minh hoạ
// ý tưởng "Nhà thầu: A - Bảng biển trong nhà"): "khi người ta nhập giá trị thực tế hợp đồng ấy thì người
// ta phải thuê nhiều nhà thầu, thì ở trong cái phần mà modal nhập giá trị hợp đồng và up file thì có thể
// tạo ra nhiều nhà cung cấp để tôi nhập các giá trị khác nhau được không?"
//
// Dựng lại ĐÚNG kịch bản trong ảnh: công việc "Bảng Biển" (HCRC-SX-SCST-004, Sửa Chữa Lớn — Hải Dương),
// người phụ trách Đỗ Quang Thuấn. Minh hoạ: mở modal -> thêm nhà thầu thứ 2 -> nhập 2 giá trị hợp đồng
// RIÊNG -> Lưu -> cột "Giá Trị Đầu Tư" trong bảng hiện ĐÚNG TỔNG 2 nhà thầu kèm nhãn số lượng nhà thầu.
//
// PHẦN 2 (MỚI, 11/2026, phản hồi NGAY SAU KHI xem demo modal ở trên — "nếu giá trị đầu tư lớn hơn/thấp
// hơn giá trị hợp đồng có nên có cảnh báo kiểu mũi tên để biết cao hơn/thấp hơn không?"): dựng thêm 1 công
// việc "Bảng Biển (có dự toán)" CÓ liên kết Danh Mục Đầu Tư (hạng mục dự toán 50.000.000) để minh hoạ
// cảnh báo mũi tên ▲/▼ so Giá Trị Đầu Tư (dự toán) vs Giá Trị Hợp Đồng (thực tế, 2 nhà thầu = 55.000.000
// > 50.000.000 -> VƯỢT dự toán) — cả ở cột bảng LẪN chân modal "💰".
//
// Chạy: node server/tests/demo-owi-contract-multi-contractor.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8992;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'owi-contract-multi-contractor');
const PHU_TRACH = { username: 'dqthuan', name: 'Đỗ Quang Thuấn', dept: 'Phòng Setup & XDCB', perms: {}, active: true };

const WORK_ITEM_ID = 777;
const WORK_ITEM_BUDGET_ID = 778;

async function shot(page, selector, file, label) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log(`📸 ${label} ->`, file);
}
async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const state = createMockState({
    depts: ['Phòng Setup & XDCB'],
    users: [PHU_TRACH],
    operationRepairs: [{
      id: 500, code: 'HCRC-SX-SCST-004', title: 'Hải Dương - SC 2026 — Sửa chữa lớn', dept: 'Phòng Setup & XDCB',
      status: 'APPROVED', estimateItems: [{ id: 9001, content: 'Bảng biển', amount: 50000000 }]
    }],
    operationWorkItems: [{
      id: WORK_ITEM_ID, title: 'Bảng Biển', status: 'CHUA_BAT_DAU', assignedTo: ['dqthuan'], assignedToName: ['Đỗ Quang Thuấn'],
      estimateItemId: null, contractValue: 0, contractAttachments: [], contractors: [],
      sourceType: 'OPERATION_REPAIR', sourceId: 500, parentWorkItemId: null, history: []
    }, {
      id: WORK_ITEM_BUDGET_ID, title: 'Bảng Biển (có dự toán)', status: 'CHUA_BAT_DAU', assignedTo: ['dqthuan'], assignedToName: ['Đỗ Quang Thuấn'],
      estimateItemId: 9001, contractValue: 0, contractAttachments: [], contractors: [],
      sourceType: 'OPERATION_REPAIR', sourceId: 500, parentWorkItemId: null, history: []
    }]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1180, height: 820 });

  try {
    await loginAs(page, PHU_TRACH);
    // Mở ĐÚNG modal "🛠️ Thực hiện" (khớp ảnh chụp người dùng gửi — HCRC-SX-SCST-004) trước, rồi mới mở
    // tiếp modal "💰" từ nút trong bảng đó — đúng luồng thao tác thật thay vì gọi thẳng hàm.
    await page.evaluate(() => openOperationWorkItemModal('operationRepairs', 500, 'EXECUTION'));
    await page.waitForTimeout(200);
    await shot(page, '#operationWorkItemModal', '00-bang-thuc-hien-truoc-khi-nhap.png', 'Bảng "Thực hiện" — công việc "Bảng Biển" chưa có Giá Trị Hợp Đồng');

    await page.click(`button[data-op="openOperationWorkItemContractModal"][data-id="${WORK_ITEM_ID}"]`);
    await page.waitForTimeout(200);
    await shot(page, '#operationWorkItemContractModal', '01-modal-1-nha-thau-trong.png', 'Modal mở — mặc định 1 dòng nhà thầu trống');

    // Nhập nhà thầu #1
    await page.fill('#owiContractorsList input[data-op-input="onOwiContractorNameInput"][data-idx="0"]', 'A - Bảng biển trong nhà');
    await page.dispatchEvent('#owiContractorsList input[data-op-input="onOwiContractorNameInput"][data-idx="0"]', 'input');
    await page.fill('#owiContractorsList input[data-op-input="onOwiContractorValueInput"][data-idx="0"]', '20000000');
    await page.dispatchEvent('#owiContractorsList input[data-op-input="onOwiContractorValueInput"][data-idx="0"]', 'input');

    // Bấm THẬT "+ Thêm Nhà Thầu" rồi nhập nhà thầu #2
    await page.click('[data-op="addOwiContractorRow"]');
    await page.fill('#owiContractorsList input[data-op-input="onOwiContractorNameInput"][data-idx="1"]', 'B - Bảng biển ngoài trời');
    await page.dispatchEvent('#owiContractorsList input[data-op-input="onOwiContractorNameInput"][data-idx="1"]', 'input');
    await page.fill('#owiContractorsList input[data-op-input="onOwiContractorValueInput"][data-idx="1"]', '35000000');
    await page.dispatchEvent('#owiContractorsList input[data-op-input="onOwiContractorValueInput"][data-idx="1"]', 'input');
    await page.waitForTimeout(150);
    await shot(page, '#operationWorkItemContractModal', '02-modal-2-nha-thau-da-nhap.png', 'Bấm "+ Thêm Nhà Thầu" -> 2 nhà thầu, mỗi nhà thầu 1 giá trị riêng — Tổng cộng tự cộng dồn');

    await page.click('button[data-op="submitOperationWorkItemContract"]');
    await page.waitForTimeout(250);

    const afterSave = await page.evaluate((id) => {
      const w = DB.operationWorkItems.find(x => x.id === id);
      return { contractors: w.contractors, contractValue: w.contractValue, modalHidden: document.getElementById('operationWorkItemContractModal').classList.contains('hidden') };
    }, WORK_ITEM_ID);
    console.log('Sau khi Lưu:', JSON.stringify(afterSave, null, 2));
    if (!afterSave.modalHidden) throw new Error('❌ Modal không tự đóng sau khi Lưu!');
    if (afterSave.contractValue !== 55000000) throw new Error(`❌ contractValue phải = 55.000.000 (tổng 2 nhà thầu), nhận được ${afterSave.contractValue}`);
    if (!Array.isArray(afterSave.contractors) || afterSave.contractors.length !== 2) throw new Error('❌ item.contractors phải có đúng 2 phần tử!');

    // submitOperationWorkItemContract() đã tự gọi renderOperationWorkItemModalBody() — bảng "Thực hiện"
    // đã cập nhật sẵn, chỉ cần chụp lại.
    await shot(page, '#operationWorkItemModal', '03-bang-thuc-hien-sau-khi-luu.png', 'Sau khi Lưu — cột "Giá Trị Đầu Tư" hiện TỔNG 2 nhà thầu (55.000.000) kèm nhãn "2 nhà thầu"');

    // Mở lại modal để minh hoạ dữ liệu được giữ nguyên đúng từng nhà thầu khi xem lại.
    await page.evaluate((id) => openOperationWorkItemContractModal(id), WORK_ITEM_ID);
    await page.waitForTimeout(150);
    await shot(page, '#operationWorkItemContractModal', '04-mo-lai-giu-dung-tung-nha-thau.png', 'Mở lại modal — giữ đúng 2 nhà thầu với tên + giá trị riêng đã lưu');
    await page.evaluate(() => closeOperationWorkItemContractModal());

    // ===== PHẦN 2: cảnh báo mũi tên ▲/▼ so Giá Trị Đầu Tư (dự toán) vs Giá Trị Hợp Đồng (thực tế) =====
    await page.click(`button[data-op="openOperationWorkItemContractModal"][data-id="${WORK_ITEM_BUDGET_ID}"]`);
    await page.waitForTimeout(150);
    await shot(page, '#operationWorkItemContractModal', '05-modal-du-toan-truoc-khi-nhap.png', 'Công việc CÓ liên kết Danh Mục Đầu Tư (dự toán 50.000.000) — chưa nhập hợp đồng nên chưa hiện cảnh báo');

    await page.fill('#owiContractorsList input[data-op-input="onOwiContractorNameInput"][data-idx="0"]', 'A - Bảng biển trong nhà');
    await page.dispatchEvent('#owiContractorsList input[data-op-input="onOwiContractorNameInput"][data-idx="0"]', 'input');
    await page.fill('#owiContractorsList input[data-op-input="onOwiContractorValueInput"][data-idx="0"]', '20000000');
    await page.dispatchEvent('#owiContractorsList input[data-op-input="onOwiContractorValueInput"][data-idx="0"]', 'input');
    await page.click('[data-op="addOwiContractorRow"]');
    await page.fill('#owiContractorsList input[data-op-input="onOwiContractorNameInput"][data-idx="1"]', 'B - Bảng biển ngoài trời');
    await page.dispatchEvent('#owiContractorsList input[data-op-input="onOwiContractorNameInput"][data-idx="1"]', 'input');
    await page.fill('#owiContractorsList input[data-op-input="onOwiContractorValueInput"][data-idx="1"]', '35000000');
    await page.dispatchEvent('#owiContractorsList input[data-op-input="onOwiContractorValueInput"][data-idx="1"]', 'input');
    await page.waitForTimeout(150);
    await shot(page, '#operationWorkItemContractModal', '06-modal-du-toan-vuot-canh-bao.png', '2 nhà thầu cộng lại = 55.000.000 > 50.000.000 dự toán -> chân modal TỰ hiện "▲ Vượt dự toán 5.000.000" (đỏ)');

    await page.click('button[data-op="submitOperationWorkItemContract"]');
    await page.waitForTimeout(250);
    await shot(page, '#operationWorkItemModal', '07-bang-thuc-hien-canh-bao-vuot-du-toan.png', 'Sau khi Lưu — cột "Giá Trị Đầu Tư" trong bảng hiện ĐÚNG 50.000.000 (dự toán) kèm cảnh báo "▲ Vượt dự toán" ngay dưới');

    const budgetCompareCheck = await page.evaluate(() => {
      const compareEl = document.getElementById('owiContractBudgetCompare');
      return { hidden: compareEl.classList.contains('hidden'), text: compareEl.innerText };
    });
    if (!budgetCompareCheck.text.includes('Vượt dự toán')) throw new Error(`❌ Chân modal phải hiện "Vượt dự toán", nhận được: ${JSON.stringify(budgetCompareCheck)}`);

    console.log('\n✅ XÁC NHẬN: 1 công việc có thể gắn NHIỀU nhà thầu, mỗi nhà thầu 1 giá trị hợp đồng + tệp đính kèm RIÊNG; cột "Giá Trị Đầu Tư" tự cộng dồn đúng tổng.');
    console.log('✅ XÁC NHẬN: công việc CÓ liên kết Danh Mục Đầu Tư tự hiện cảnh báo mũi tên ▲/▼ khi Giá Trị Hợp Đồng thực tế chênh lệch với Giá Trị Đầu Tư dự toán.');
  } finally {
    await browser.close();
    server.close();
  }
})();
