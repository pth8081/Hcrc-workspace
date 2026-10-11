// server/tests/demo-office-extra-files.js
//
// Demo ảnh + test chức năng thật qua trình duyệt (testHarness.js) cho tính năng mới: "Tệp Đính Kèm Đề
// Xuất" — multi-file upload TUỲ CHỌN (không bắt buộc) ở form tạo Phiếu Đề Xuất (Mua Bán/Sửa Chữa), module
// Văn Phòng Tổng Hợp. Lái qua ĐÚNG đường người dùng thật đi: mở form -> chọn nhiều tệp -> gửi phê duyệt
// -> mở lại modal chi tiết -> thấy đúng khối "📎 Tệp Đính Kèm Đề Xuất" với nút Xem/Tải.
//
// Chạy: node server/tests/demo-office-extra-files.js
'use strict';
const path = require('path');
const fs = require('fs');
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual, assertIncludes } = require('./testHarness');

const PORT = 8997;
const DEPT = 'Phòng Kinh Doanh';
const OFFICE_USER = {
  username: 'nv_kd', name: 'Nguyễn Văn Kinh Doanh', dept: DEPT, active: true,
  perms: { officeCreate: true, officeBuy: true, officeFix: true }
};

const state = createMockState({
  depts: [DEPT],
  users: [OFFICE_USER],
  officeBuyDeptWorkflows: { [DEPT]: { approvers: { 1: ['nv_kd'] } } },
  officeFixDeptWorkflows: {}
});

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const outDir = path.join(__dirname, '.tmp-assets');
  fs.mkdirSync(outDir, { recursive: true });
  let createdId = null;

  try {
    await page.evaluate(async (u) => {
      window.__resetCapture();
      await proceedAfterAuth(u);
    }, OFFICE_USER);

    await run.run('Mở form Mua Bán, thấy ô "Tệp Đính Kèm Đề Xuất" mới (tuỳ chọn, multiple)', async () => {
      await page.evaluate(() => { switchTab('office'); setOfficeSubTab('MUA_BAN'); openOfficeForm(); });
      const info = await page.evaluate(() => {
        const input = document.getElementById('officeExtraFiles');
        return input ? { exists: true, multiple: input.multiple, required: input.required } : { exists: false };
      });
      if (!info.exists) throw new Error('Thiếu input #officeExtraFiles trong form');
      if (!info.multiple) throw new Error('Input phải cho phép chọn nhiều tệp (multiple)');
      if (info.required) throw new Error('Input KHÔNG được bắt buộc (phải tuỳ chọn)');
    });

    const shot1 = path.join(outDir, 'demo-office-extra-files-form.png');
    await page.screenshot({ path: shot1, fullPage: true });
    console.log(`✅ Đã chụp (form tạo, có ô Tệp Đính Kèm Đề Xuất): ${shot1}`);

    await run.run('Chọn 2 tệp cho #officeExtraFiles -> hiện đúng 2 chip tên tệp', async () => {
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.items.add(new File(['bao gia nha cung cap'], 'bao-gia-ncc.pdf', { type: 'application/pdf' }));
        dt.items.add(new File(['anh hien truong'], 'anh-hien-truong.jpg', { type: 'image/jpeg' }));
        const input = document.getElementById('officeExtraFiles');
        input.files = dt.files;
        onMultiFileChosen(input, 'officeExtraFilesChip');
      });
      const chipText = await page.evaluate(() => document.getElementById('officeExtraFilesChip').innerText);
      assertIncludes(chipText, 'bao-gia-ncc.pdf', 'Chip phải hiện tên tệp thứ nhất');
      assertIncludes(chipText, 'anh-hien-truong.jpg', 'Chip phải hiện tên tệp thứ hai');
    });

    const shot2 = path.join(outDir, 'demo-office-extra-files-chips.png');
    await page.screenshot({ path: shot2, fullPage: true });
    console.log(`✅ Đã chụp (đã chọn 2 tệp, hiện chip): ${shot2}`);

    await run.run('Điền đủ các trường bắt buộc + gửi phê duyệt -> tạo thành công, lưu đúng extraFiles[]', async () => {
      const created = await page.evaluate(async () => {
        document.getElementById('offDept').value = 'Phòng Kinh Doanh';
        document.getElementById('offTitle').value = 'Mua bàn ghế văn phòng Quý 4';
        document.getElementById('offReason').value = 'Bổ sung bàn ghế cho nhân viên mới';
        updateOfficeItemField(0, 'name', 'Bàn làm việc');
        updateOfficeItemField(0, 'unit', 'Cái');
        updateOfficeItemField(0, 'qty', 5);
        updateOfficeItemField(0, 'unitPrice', 1500000);
        await submitOfficeReq({ preventDefault() {} });
        return DB.officeReqs[0];
      });
      if (!created) throw new Error('Không tạo được đề xuất văn phòng');
      assertEqual(created.extraFiles.length, 2, 'Phải lưu đúng 2 tệp đính kèm vào item.extraFiles');
      assertIncludes(created.extraFiles.map(f => f.fileName), 'bao-gia-ncc.pdf', 'Phải giữ đúng tên tệp thứ nhất');
      assertIncludes(created.extraFiles.map(f => f.fileName), 'anh-hien-truong.jpg', 'Phải giữ đúng tên tệp thứ hai');
      createdId = created.id;
    });

    await run.run('Mở lại modal chi tiết -> thấy khối "📎 Tệp Đính Kèm Đề Xuất" với nút Xem/Tải cho cả 2 tệp', async () => {
      const modalInfo = await page.evaluate((id) => {
        openOfficeProcessModal(id);
        return document.getElementById('officeModalDetails').innerHTML;
      }, createdId);
      assertIncludes(modalInfo, 'Tệp Đính Kèm Đề Xuất', 'Modal chi tiết phải có tiêu đề khối tệp đính kèm');
      assertIncludes(modalInfo, 'bao-gia-ncc.pdf', 'Modal chi tiết phải liệt kê tệp thứ nhất');
      assertIncludes(modalInfo, 'anh-hien-truong.jpg', 'Modal chi tiết phải liệt kê tệp thứ hai');
      assertIncludes(modalInfo, '👁️ Xem', 'Phải có nút Xem cho từng tệp');
      assertIncludes(modalInfo, '⬇️ Tải', 'Phải có nút Tải cho từng tệp (người tạo = chính chủ)');
    });

    const shot3 = path.join(outDir, 'demo-office-extra-files-detail.png');
    await page.screenshot({ path: shot3, fullPage: true });
    console.log(`✅ Đã chụp (modal chi tiết, khối Tệp Đính Kèm Đề Xuất): ${shot3}`);

    await run.run('Không chọn tệp nào (nhánh KHÔNG bắt buộc) -> vẫn tạo được bình thường, extraFiles rỗng', async () => {
      const created2 = await page.evaluate(async () => {
        closeOfficeProcessModal();
        openOfficeForm();
        document.getElementById('offDept').value = 'Phòng Kinh Doanh';
        document.getElementById('offTitle').value = 'Mua ghế xoay';
        document.getElementById('offReason').value = 'Bổ sung ghế';
        updateOfficeItemField(0, 'name', 'Ghế xoay');
        updateOfficeItemField(0, 'unit', 'Cái');
        updateOfficeItemField(0, 'qty', 3);
        updateOfficeItemField(0, 'unitPrice', 800000);
        await submitOfficeReq({ preventDefault() {} });
        return DB.officeReqs[0];
      });
      assertEqual(Array.isArray(created2.extraFiles) && created2.extraFiles.length, 0, 'KHÔNG chọn tệp nào thì extraFiles phải là mảng rỗng (không bắt buộc)');
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
