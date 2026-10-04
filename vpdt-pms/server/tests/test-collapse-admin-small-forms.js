// tests/test-collapse-admin-small-forms.js
//
// Regression test cho đợt "thu gọn form nhập" (10/2026) áp lên 4 form admin nhỏ ở Hệ Thống (xem
// CLAUDE.md-equivalent task — pattern mẫu lấy từ mhVendorFormWrap/openMhVendorForm()/closeMhVendorForm()
// ở Mua Hàng). Bài này tập trung vào form PHỨC TẠP NHẤT trong 4 form — "➕ Thêm/Sửa Cấu Hình Áp Dụng
// Nhanh" (#quickApplyAddForm, saveQuickApplyConfig(), module-workflow.js) — xác nhận:
//
//   1. Form mặc định ẨN (class "hidden") ngay khi vào sub-tab "⚡ Áp Dụng Nhanh", KHÔNG hiện sẵn như
//      trước đợt thu gọn.
//   2. Bấm "+ Thêm Cấu Hình Áp Dụng Nhanh" (openQuickApplyConfigForm()) -> form HIỆN RA, VÀ lưới
//      checkbox module (#qaModuleGrid) + ô chọn mẫu quy trình (#qaTplSelect) đã được renderQuickApplySection()
//      (gọi lúc vào sub-tab) khởi tạo sẵn — không rỗng.
//   3. Chọn mẫu quy trình -> khối "Gán người duyệt theo bước" (#qaPositionStepsWrap,
//      renderQuickApplyPositionSteps()) khởi tạo đúng số khối = số bước của mẫu.
//   4. Lưu 1 cấu hình mới qua UI thật (saveQuickApplyConfig()) -> form tự THU GỌN lại (ẩn) sau khi lưu
//      thành công (closeQuickApplyConfigForm()/resetQuickApplyConfigForm() gọi đúng lúc).
//   5. Bấm "✏️ Sửa" (editQuickApplyConfig()) ở cấu hình vừa tạo -> form tự MỞ LẠI, nạp đúng lại mẫu quy
//      trình đã chọn (qaTplSelect.value) + đúng checkbox module đã tick + đúng khối bước (không rò state
//      từ lượt trước, không rỗng).
//   6. Bấm "✕ Thu Gọn" (closeQuickApplyConfigForm()) -> form ẩn lại NGAY (không cần lưu).
//   7. Bấm "+ Thêm Cấu Hình Áp Dụng Nhanh" lại (mở mới, không phải Sửa) -> lưới checkbox PHẢI reset về
//      KHÔNG tick gì (không rò state của lượt Sửa #5 trước đó) — xác nhận openQuickApplyConfigForm() gọi
//      resetQuickApplyConfigForm() trước khi mở.
//
// Dựng theo đúng khuôn tests/test-perm-tree-expand-collapse.js (bài mẫu người dùng chỉ định) + dùng
// testHarness.js (startStaticServer/createMockState/launchPage/createRunner) giống
// tests/test-quickapply-configs-initdatabase-load.js (cùng seed quickApplyConfigs qua mock backend thật,
// đăng nhập qua proceedAfterAuth() để initDatabase() nạp đúng dữ liệu, không tự ý giả lập lại logic).
//
// Run: node server/tests/test-collapse-admin-small-forms.js
'use strict';
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual
} = require('./testHarness');

const PORT = 8991;

const ADMIN = { username: 'admin_collapse', name: 'Admin Test Thu Gọn', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };

const state = createMockState({
  depts: ['Phòng CNTT', 'Phòng Kế Toán'], stores: [], users: [ADMIN],
  workflows: [
    { id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }] },
    { id: 'WF_2STEP', name: 'Quy trình 2 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }, { order: 2, name: 'Phê duyệt 2' }] }
  ],
  quickApplyConfigs: []
});

async function gotoQuickApplyTab(page) {
  await page.evaluate(() => document.querySelector('[data-op="switchTab"][data-arg0="system"]')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#btnSystemTab')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('button[data-op-seq*="setSystemSubTab(ADVWORKFLOW)"]')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#btnAdvWorkflowSubQuickApply')?.click());
  await page.waitForTimeout(200);
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err && err.stack || String(err)));

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await gotoQuickApplyTab(page);

    const ready = await page.evaluate(() => typeof saveQuickApplyConfig === 'function' && typeof openQuickApplyConfigForm === 'function' && typeof closeQuickApplyConfigForm === 'function' && typeof editQuickApplyConfig === 'function');
    assert(ready, 'module-workflow.js phải đã nạp xong qua điều hướng thật (openQuickApplyConfigForm/closeQuickApplyConfigForm/editQuickApplyConfig/saveQuickApplyConfig tồn tại)');

    await run.run('1. #quickApplyAddForm mặc định ẨN ngay khi vào sub-tab "⚡ Áp Dụng Nhanh"', async () => {
      const hidden = await page.evaluate(() => document.getElementById('quickApplyAddForm').classList.contains('hidden'));
      assertEqual(hidden, true, 'Form "Thêm/Sửa Cấu Hình Áp Dụng Nhanh" phải ẩn mặc định (pattern thu gọn form nhập)');
    });

    await run.run('2. Bấm "+ Thêm Cấu Hình Áp Dụng Nhanh" -> form HIỆN RA, lưới module + ô chọn mẫu đã khởi tạo sẵn', async () => {
      await page.click('#btnQuickApplyConfigNew');
      const state2 = await page.evaluate(() => ({
        hidden: document.getElementById('quickApplyAddForm').classList.contains('hidden'),
        tplOptionsCount: document.getElementById('qaTplSelect').options.length,
        moduleCheckCount: document.querySelectorAll('#qaModuleGrid .qaModuleCheck').length
      }));
      assertEqual(state2.hidden, false, 'Form phải HIỆN sau khi bấm "+ Thêm Cấu Hình"');
      assert(state2.tplOptionsCount === 2, `#qaTplSelect phải có đúng 2 mẫu quy trình (WF_1STEP/WF_2STEP) đã nạp sẵn, thấy ${state2.tplOptionsCount}`);
      assert(state2.moduleCheckCount > 0, 'Lưới checkbox module (#qaModuleGrid) phải đã được khởi tạo (renderQuickApplySection() gọi lúc vào sub-tab), không rỗng');
    });

    await run.run('3. Chọn mẫu quy trình WF_2STEP -> khối "Gán người duyệt theo bước" khởi tạo đúng 2 khối (khớp 2 bước)', async () => {
      await page.selectOption('#qaTplSelect', 'WF_2STEP');
      await page.waitForTimeout(80);
      const blockCount = await page.evaluate(() => document.querySelectorAll('#qaPositionStepsWrap > div').length);
      assertEqual(blockCount, 2, `#qaPositionStepsWrap phải vẽ đúng 2 khối (mẫu WF_2STEP có 2 bước), thấy ${blockCount}`);
    });

    let newConfigId;
    await run.run('4. Lưu cấu hình mới (mẫu WF_2STEP, module CAR) qua UI thật -> lưu đúng DB.quickApplyConfigs VÀ form tự THU GỌN lại', async () => {
      await page.locator('#qaModuleGrid .qaModuleCheck[value="CAR"]').check();
      await page.click('#btnSaveQaConfig');
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => ({
        hidden: document.getElementById('quickApplyAddForm').classList.contains('hidden'),
        configs: DB.quickApplyConfigs
      }));
      assertEqual(after.hidden, true, 'Form phải tự ẨN LẠI (thu gọn) ngay sau khi lưu thành công');
      assertEqual(after.configs.length, 1, 'DB.quickApplyConfigs phải có đúng 1 cấu hình sau khi lưu');
      assertEqual(after.configs[0].workflowId, 'WF_2STEP', 'Cấu hình vừa lưu phải đúng mẫu WF_2STEP đã chọn');
      assertEqual(JSON.stringify(after.configs[0].modules), JSON.stringify(['CAR']), 'Cấu hình vừa lưu phải đúng phạm vi module CAR đã tick');
      newConfigId = after.configs[0].id;
    });

    await run.run('5. Bấm "✏️ Sửa" cấu hình vừa tạo -> form tự MỞ LẠI, nạp ĐÚNG lại mẫu + checkbox module đã lưu', async () => {
      await page.click(`button[data-op="editQuickApplyConfig"][data-arg0="${newConfigId}"]`);
      await page.waitForTimeout(100);
      const editState = await page.evaluate(() => ({
        hidden: document.getElementById('quickApplyAddForm').classList.contains('hidden'),
        tplValue: document.getElementById('qaTplSelect').value,
        carChecked: document.querySelector('#qaModuleGrid .qaModuleCheck[value="CAR"]').checked,
        docChecked: document.querySelector('#qaModuleGrid .qaModuleCheck[value="DOC"]').checked,
        blockCount: document.querySelectorAll('#qaPositionStepsWrap > div').length
      }));
      assertEqual(editState.hidden, false, 'Form phải tự MỞ LẠI khi bấm "✏️ Sửa"');
      assertEqual(editState.tplValue, 'WF_2STEP', 'Phải nạp lại ĐÚNG mẫu quy trình đã lưu (WF_2STEP)');
      assertEqual(editState.carChecked, true, 'Checkbox module CAR (đã lưu) phải đang TICK');
      assertEqual(editState.docChecked, false, 'Checkbox module DOC (KHÔNG thuộc phạm vi đã lưu) phải KHÔNG tick');
      assertEqual(editState.blockCount, 2, 'Khối "Gán người duyệt theo bước" phải vẫn đúng 2 khối (khớp mẫu WF_2STEP) khi mở lại để Sửa');
    });

    await run.run('6. Bấm "✕ Thu Gọn" -> form ẨN LẠI ngay, KHÔNG cần lưu', async () => {
      await page.click('#quickApplyAddForm button[data-op="closeQuickApplyConfigForm"]');
      const hidden = await page.evaluate(() => document.getElementById('quickApplyAddForm').classList.contains('hidden'));
      assertEqual(hidden, true, 'Form phải ẩn ngay sau khi bấm "✕ Thu Gọn" (không cần submit)');
      const configsUnchanged = await page.evaluate(() => DB.quickApplyConfigs.length);
      assertEqual(configsUnchanged, 1, '"✕ Thu Gọn" KHÔNG phải là lưu — DB.quickApplyConfigs phải vẫn còn đúng 1 cấu hình như trước, không đổi');
    });

    await run.run('7. Bấm "+ Thêm Cấu Hình Áp Dụng Nhanh" lại (mở MỚI) -> lưới checkbox module PHẢI reset về KHÔNG tick (không rò state của lượt Sửa #5)', async () => {
      await page.click('#btnQuickApplyConfigNew');
      const freshState = await page.evaluate(() => ({
        hidden: document.getElementById('quickApplyAddForm').classList.contains('hidden'),
        anyChecked: Array.from(document.querySelectorAll('#qaModuleGrid .qaModuleCheck')).some(el => el.checked),
        cancelBtnHidden: document.getElementById('btnCancelQaConfig').classList.contains('hidden')
      }));
      assertEqual(freshState.hidden, false, 'Form phải hiện ra sau khi bấm "+ Thêm Cấu Hình Áp Dụng Nhanh"');
      assertEqual(freshState.anyChecked, false, 'Lưới checkbox module phải được resetQuickApplyConfigForm() dọn sạch (KHÔNG còn tick "CAR" sót lại từ lượt Sửa #5)');
      assertEqual(freshState.cancelBtnHidden, true, 'Nút "Hủy Sửa" phải ẨN lại (không còn ở chế độ Sửa) khi mở form để Thêm Mới');
    });

    await run.run('Không có lỗi JS chưa bắt nào phát sinh trong suốt bài test', () => {
      assertEqual(jsErrors.length, 0, `Phải không có lỗi JS nào (${jsErrors.join('; ')})`);
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
