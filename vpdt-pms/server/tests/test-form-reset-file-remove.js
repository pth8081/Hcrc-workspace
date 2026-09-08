'use strict';
// Regression test cho "Đợt A" (UX rollout — 5 đợt): 2 hạ tầng dùng chung MỚI ở core.js —
//   - confirmAndResetForm(formId, resetFnName): nút "↺ Làm Mới" trên form Tạo Mới, hỏi xác nhận NẾU
//     form đang có dữ liệu đã nhập, rồi gọi resetXxxForm() riêng của module.
//   - onSingleFileChosen()/clearSingleFileInput() (input file đơn) + onMultiFileChosen()/
//     removeOneFileFromMultiInput()/clearMultiFileInput() (input file multiple): chip "📎 tên file [✕]"
//     cho phép bỏ chọn tệp TRƯỚC KHI gửi form.
// — áp dụng cho 4 form tạo mới (mẫu tham chiếu cho 4 đợt sau, ~12 module còn lại):
//   Văn Bản Trình (#submissionForm, resetSubmissionForm() — module-vanbantrinh.js)
//   Hợp Đồng (#contractForm, resetContractForm() — module-hopdong.js)
//   Tài Liệu (#docForm, resetDocUploadForm() — module-tailieu.js)
//   Giấy Phép (#licenseForm, resetLicenseForm() — module-tailieu.js)
//
// Dùng lại hạ tầng tests/_harness-contract.js (tests/_seed.js) — đã seed sẵn đủ dept/loại pháp lý/
// workflow/nhóm phê duyệt cho Hợp Đồng LẪN Văn Bản Trình (3 bộ test gốc dùng chung: test-contract.js/
// test-payment.js/test-office-budget.js). Giấy Phép không thuộc 3 module gốc đó nên DB.licenses/
// DB.licenseTypes phải tự seed thêm (rỗng là đủ — module này không lọc theo dept).
//
// Chạy: node server/tests/test-form-reset-file-remove.js
const { startHarness } = require('./_harness-contract');

function fakeFile(name, content, mime) {
  return { name, mimeType: mime, buffer: Buffer.from(content) };
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

async function main() {
  const h = await startHarness();
  const { page } = h;
  const results = [];
  function recordResult(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
    if (!ok) console.log(`  -> ${detail && detail.message ? detail.message : detail}`);
  }
  async function check(name, fn) {
    try { await fn(); recordResult(name, true); }
    catch (err) { recordResult(name, false, err); }
  }

  try {
    await h.loginAs('admin');

    // Giấy Phép: không thuộc 3 module gốc dùng _seed.js — bổ sung tay 2 collection còn thiếu.
    await page.evaluate(() => { DB.licenses = []; DB.licenseTypes = []; });

    // window.confirm() của _harness-contract.js luôn trả true nhưng KHÔNG ghi log lời gọi — thay bằng
    // bản có ghi log (vẫn trả true, không chặn luồng resetXxxForm() phía sau) để bài test xác minh được
    // ĐÚNG lúc confirmAndResetForm() có hỏi/không hỏi xác nhận.
    await page.evaluate(() => {
      window.__confirmCalls = [];
      window.confirm = (msg) => { window.__confirmCalls.push(String(msg)); return true; };
    });

    // ================= 1) Văn Bản Trình =================
    await check(
      'Văn Bản Trình: chip file đơn + multi hiện đúng tên, xoá đúng 1 file khỏi multi (còn lại đúng file kia), "Làm Mới" trắng toàn bộ form kể cả panel phê duyệt bổ sung + mã tự sinh',
      async () => {
        await page.evaluate(() => {
          // Gán 1 thành viên cho lớp "Đồng trình" — DONG_TRINH mặc định rỗng ở _seed.js, checkbox lớp sẽ
          // bị disabled nếu không có thành viên nào (xem renderSubmissionApprovalLayerCheckboxes()).
          DB.submissionApprovalGroups = { DONG_TRINH: ['admin'] };
          switchTab('submission');
        });
        // subDept KHÔNG có option rỗng đặt trước (cùng lý do contractDept ở kịch bản Hợp Đồng bên dưới)
        // — chọn "Phòng Kế Toán" (KHÁC option đầu tiên "Phòng Kinh Doanh") để quan sát được form.reset()
        // thật sự đưa nó về lại ĐÚNG option đầu, không phải về rỗng.
        await page.selectOption('#subDept', 'Phòng Kế Toán');
        await page.selectOption('#subType', 'Tờ trình khác');
        await page.selectOption('#subApprovalLevel', 'KHAC');
        await page.evaluate(() => renderSubmissionApprovalLayerCheckboxes());
        await page.fill('#subTitle', 'Đề xuất kiểm thử reset form');
        await page.fill('#subContent', 'Nội dung kiểm thử reset form.');

        // Chọn tệp đơn -> chip hiện đúng tên.
        await page.setInputFiles('#subFile', fakeFile('to-trinh.pdf', 'noi dung', 'application/pdf'));
        const chip1 = await page.locator('#subFileChip').innerText();
        assertTrue(chip1.includes('to-trinh.pdf'), `Chip subFile phải hiện tên file, thực tế: ${chip1}`);

        // Chọn 2 tệp bổ sung -> 2 chip; xoá 1 -> còn ĐÚNG 1, đúng file còn lại, input.files còn đúng 1.
        await page.setInputFiles('#subExtraFiles', [
          fakeFile('phu-luc-1.pdf', 'a', 'application/pdf'),
          fakeFile('phu-luc-2.pdf', 'b', 'application/pdf')
        ]);
        const chipCountBefore = await page.locator('#subExtraFilesChip button[data-op="removeOneFileFromMultiInput"]').count();
        assertTrue(chipCountBefore === 2, `Phải có đúng 2 chip tài liệu bổ sung, thực tế ${chipCountBefore}`);
        await page.locator('#subExtraFilesChip button[data-op="removeOneFileFromMultiInput"]').first().click();
        const remainingChips = await page.locator('#subExtraFilesChip button[data-op="removeOneFileFromMultiInput"]').count();
        assertTrue(remainingChips === 1, `Sau khi xoá 1 phải còn đúng 1 chip, thực tế ${remainingChips}`);
        const remainingChipText = await page.locator('#subExtraFilesChip').innerText();
        assertTrue(
          remainingChipText.includes('phu-luc-2.pdf') && !remainingChipText.includes('phu-luc-1.pdf'),
          `Phải còn ĐÚNG file phu-luc-2.pdf (đã xoá phu-luc-1.pdf), thực tế: ${remainingChipText}`
        );
        const remainingFilesLength = await page.locator('#subExtraFiles').evaluate((el) => el.files.length);
        assertTrue(remainingFilesLength === 1, `input.files phải còn đúng 1 phần tử, thực tế ${remainingFilesLength}`);

        // Tick 1 checkbox lớp phê duyệt bổ sung (KHAC -> DONG_TRINH có thành viên, không bị disable).
        await page.click('#subApprovalDropdownBtn');
        await page.check('#subApprovalDropdownPanel input.sub-layer-toggle[value="DONG_TRINH"]');
        const codeBeforeReset = await page.locator('#subCode').inputValue();
        assertTrue(codeBeforeReset !== '', 'subCode phải tự sinh sẵn khi vừa mở tab');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#submissionForm button[data-arg1="resetSubmissionForm"]');
        const state = await page.evaluate(() => ({
          subDept: document.getElementById('subDept').value,
          subTitle: document.getElementById('subTitle').value,
          subContent: document.getElementById('subContent').value,
          subCode: document.getElementById('subCode').value,
          subFileValue: document.getElementById('subFile').value,
          subFileChip: document.getElementById('subFileChip').innerHTML,
          subExtraFilesValue: document.getElementById('subExtraFiles').value,
          subExtraFilesChip: document.getElementById('subExtraFilesChip').innerHTML,
          anyLayerChecked: document.querySelectorAll('#subApprovalDropdownPanel input.sub-layer-toggle:checked').length,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.subDept === 'Phòng Kinh Doanh', `subDept phải về ĐÚNG option đầu (Phòng Kinh Doanh, KHÁC "Phòng Kế Toán" vừa chọn), thực tế "${state.subDept}"`);
        assertTrue(state.subTitle === '', 'subTitle phải về rỗng');
        assertTrue(state.subContent === '', 'subContent phải về rỗng');
        assertTrue(/^HCRC-VBT-/.test(state.subCode), `subCode phải được sinh lại đúng khuôn HCRC-VBT-..., thực tế "${state.subCode}"`);
        assertTrue(state.subFileValue === '', 'subFile input phải về rỗng');
        assertTrue(state.subFileChip === '', 'Chip subFile phải biến mất sau Làm Mới');
        assertTrue(state.subExtraFilesValue === '', 'subExtraFiles input phải về rỗng');
        assertTrue(state.subExtraFilesChip === '', 'Chip subExtraFiles phải biến mất sau Làm Mới');
        assertTrue(state.anyLayerChecked === 0, 'Không còn checkbox lớp phê duyệt bổ sung nào được tick sau Làm Mới');
      }
    );

    // ================= 2) Hợp Đồng =================
    await check(
      // contractDept/contractType KHÔNG có option rỗng đặt trước (khác selDept của Tài Liệu) — chọn 1
      // dept/type KHÁC option đầu tiên để form.reset() có gì đó "khác biệt" mà quan sát được: reset() sẽ
      // đưa 2 select này về lại đúng OPTION ĐẦU TIÊN (Phòng Kinh Doanh/Hợp đồng kinh tế, theo đúng thứ
      // tự DB.depts/DB.contractTypes ở tests/_seed.js) — không phải về rỗng như 2 module Tài Liệu/Giấy
      // Phép (những form đó có option rỗng "-- Chọn... --" đặt đầu).
      'Hợp Đồng: chip file, "Làm Mới" trắng form (2 select không có option rỗng -> reset về ĐÚNG option đầu) + trắng Đợt Thanh Toán về 0 dòng + mã hợp đồng sinh lại đúng theo option đầu',
      async () => {
        await page.evaluate(() => switchTab('contract'));
        await page.selectOption('#contractDept', 'Phòng Kế Toán');
        await page.selectOption('#contractType', 'Hợp đồng dịch vụ');
        await page.fill('#contractTitle', 'Hợp đồng kiểm thử reset form');
        await page.fill('#contractPartner', 'Công ty TNHH Kiểm Thử');
        await page.fill('#contractAmount', '10000000');
        await page.fill('#contractStartDate', '2026-01-01');
        await page.fill('#contractEndDate', '2026-12-31');
        await page.fill('#contractContent', 'Nội dung kiểm thử reset form.');
        await page.setInputFiles('#contractFile', fakeFile('hop-dong.pdf', 'noi dung', 'application/pdf'));
        const chip = await page.locator('#contractFileChip').innerText();
        assertTrue(chip.includes('hop-dong.pdf'), `Chip contractFile phải hiện tên file, thực tế: ${chip}`);

        // Thêm 2 dòng Đợt Thanh Toán.
        await page.click('button[data-op="addContractInstallmentRow"]');
        await page.click('button[data-op="addContractInstallmentRow"]');
        const rowsBefore = await page.locator('#contractInstallmentsList [data-installment-row]').count();
        assertTrue(rowsBefore === 2, `Phải có 2 dòng Đợt Thanh Toán trước khi Làm Mới, thực tế ${rowsBefore}`);

        const codeBeforeReset = await page.locator('#contractCode').inputValue();
        assertTrue(codeBeforeReset !== '', 'contractCode phải tự sinh khi đã chọn đủ Phòng Ban + Loại Pháp Lý');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#contractForm button[data-arg1="resetContractForm"]');
        const state = await page.evaluate(() => ({
          contractDept: document.getElementById('contractDept').value,
          contractTitle: document.getElementById('contractTitle').value,
          contractCode: document.getElementById('contractCode').value,
          contractFileValue: document.getElementById('contractFile').value,
          contractFileChip: document.getElementById('contractFileChip').innerHTML,
          installmentRows: document.querySelectorAll('#contractInstallmentsList [data-installment-row]').length,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.contractDept === 'Phòng Kinh Doanh', `contractDept phải về ĐÚNG option đầu (Phòng Kinh Doanh, KHÁC "Phòng Kế Toán" vừa chọn), thực tế "${state.contractDept}"`);
        assertTrue(state.contractTitle === '', 'contractTitle phải về rỗng');
        // dept/type đã reset về option đầu (Phòng Kinh Doanh/Hợp đồng kinh tế) -> mã tự sinh lại theo
        // ĐÚNG 2 giá trị đó (viết tắt KD/KTE, xem tests/_seed.js deptAbbrs/contractTypeAbbrs).
        assertTrue(/^HCRC-KD-KTE-/.test(state.contractCode), `contractCode phải sinh lại đúng theo option đầu (HCRC-KD-KTE-...), thực tế "${state.contractCode}"`);
        assertTrue(state.contractFileValue === '', 'contractFile input phải về rỗng');
        assertTrue(state.contractFileChip === '', 'Chip contractFile phải biến mất sau Làm Mới');
        assertTrue(state.installmentRows === 0, `Đợt Thanh Toán phải về 0 dòng sau Làm Mới, thực tế ${state.installmentRows}`);
      }
    );

    // ================= 3) Tài Liệu =================
    await check(
      'Tài Liệu: chip file, "Làm Mới" trắng form + đưa toggle Nhập Mới/Cập Nhật về lại "Nhập Mới" + mã về rỗng',
      async () => {
        await page.evaluate(() => switchTab('doc'));
        await page.selectOption('#selDept', 'Phòng Kinh Doanh');
        await page.selectOption('#selCat', 'Hợp đồng / Hồ sơ');
        await page.fill('#docTitle', 'Tài liệu kiểm thử reset form');
        await page.fill('#docSummary', 'Tóm tắt kiểm thử reset form.');
        await page.setInputFiles('#docFile', fakeFile('tai-lieu.pdf', 'noi dung', 'application/pdf'));
        const chip = await page.locator('#docFileChip').innerText();
        assertTrue(chip.includes('tai-lieu.pdf'), `Chip docFile phải hiện tên file, thực tế: ${chip}`);
        const codeBeforeReset = await page.locator('#docCode').inputValue();
        assertTrue(codeBeforeReset !== '', 'docCode phải tự sinh khi đã chọn đủ Phòng Ban + Phân Loại');

        // Đổi sang "Cập nhật" -> xác nhận Làm Mới đưa được VỀ LẠI "Nhập Mới" (không kẹt ở chế độ Cập nhật).
        await page.selectOption('#docOpMode', 'UPDATE');
        await page.evaluate(() => onDocOpModeChange());

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#docForm button[data-arg1="resetDocUploadForm"]');
        const state = await page.evaluate(() => ({
          docOpMode: document.getElementById('docOpMode').value,
          selDept: document.getElementById('selDept').value,
          docTitle: document.getElementById('docTitle').value,
          docCode: document.getElementById('docCode').value,
          docFileValue: document.getElementById('docFile').value,
          docFileChip: document.getElementById('docFileChip').innerHTML,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.docOpMode === 'NEW', `docOpMode phải về "NEW" sau Làm Mới, thực tế "${state.docOpMode}"`);
        assertTrue(state.selDept === '', `selDept phải về rỗng, thực tế "${state.selDept}"`);
        assertTrue(state.docTitle === '', 'docTitle phải về rỗng');
        assertTrue(state.docCode === '', `docCode phải về rỗng (chưa chọn lại Phòng Ban/Phân Loại), thực tế "${state.docCode}"`);
        assertTrue(state.docFileValue === '', 'docFile input phải về rỗng');
        assertTrue(state.docFileChip === '', 'Chip docFile phải biến mất sau Làm Mới');
      }
    );

    // ================= 4) Giấy Phép =================
    await check(
      'Giấy Phép: chip file, "Làm Mới" trắng form + sinh lại mã đúng khuôn HCRC-GP-...',
      async () => {
        await page.evaluate(() => switchTab('license'));
        await page.fill('#licenseCompanyName', 'Công ty TNHH Kiểm Thử');
        await page.fill('#licenseLocationName', 'Chi nhánh kiểm thử');
        await page.fill('#licenseType', 'Giấy phép kiểm thử');
        await page.fill('#licenseNumber', 'GP-TEST-001');
        await page.fill('#licenseIssueDate', '2026-01-01');
        await page.fill('#licenseExpiryDate', '2027-01-01');
        await page.fill('#licenseIssuingAuthority', 'Cơ quan kiểm thử');
        await page.setInputFiles('#licenseFile', fakeFile('giay-phep.pdf', 'noi dung', 'application/pdf'));
        const chip = await page.locator('#licenseFileChip').innerText();
        assertTrue(chip.includes('giay-phep.pdf'), `Chip licenseFile phải hiện tên file, thực tế: ${chip}`);

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#licenseForm button[data-arg1="resetLicenseForm"]');
        const state = await page.evaluate(() => ({
          licenseOpMode: document.getElementById('licenseOpMode').value,
          licenseCompanyName: document.getElementById('licenseCompanyName').value,
          licenseCode: document.getElementById('licenseCode').value,
          licenseFileValue: document.getElementById('licenseFile').value,
          licenseFileChip: document.getElementById('licenseFileChip').innerHTML,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.licenseOpMode === 'NEW', `licenseOpMode phải về "NEW" sau Làm Mới, thực tế "${state.licenseOpMode}"`);
        assertTrue(state.licenseCompanyName === '', 'licenseCompanyName phải về rỗng');
        assertTrue(/^HCRC-GP-/.test(state.licenseCode), `licenseCode phải được sinh lại đúng khuôn HCRC-GP-..., thực tế "${state.licenseCode}"`);
        assertTrue(state.licenseFileValue === '', 'licenseFile input phải về rỗng');
        assertTrue(state.licenseFileChip === '', 'Chip licenseFile phải biến mất sau Làm Mới');
      }
    );

    // ================= 5) confirmAndResetForm(): KHÔNG hỏi xác nhận khi form đang trống =================
    await check('confirmAndResetForm(): KHÔNG hỏi xác nhận khi form đang trống (vừa mở tab, chưa nhập gì)', async () => {
      await page.evaluate(() => { switchTab('license'); window.__confirmCalls = []; });
      await page.click('#licenseForm button[data-arg1="resetLicenseForm"]');
      const confirmCount = await page.evaluate(() => window.__confirmCalls.length);
      assertTrue(confirmCount === 0, `KHÔNG được hỏi xác nhận khi form đang trống, thực tế đã hỏi ${confirmCount} lần`);
    });

  } finally {
    const total = results.length;
    const passed = results.filter((r) => r.ok).length;
    console.log('');
    console.log(`==== ${passed}/${total} scenario(s) passed${total - passed ? `, ${total - passed} FAILED` : ''} ====`);
    if (total - passed > 0) process.exitCode = 1;
    await h.stop();
  }
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
