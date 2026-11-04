// server/tests/test-operation-vhst-uibugfix.js
//
// Regression test Playwright THẬT (DOM thật + tương tác chuột/gõ phím thật, KHÔNG chỉ assert biến JS ẩn)
// cho đợt sửa lỗi sau khi người dùng kiểm tra trên app THẬT và phát hiện 3 tính năng đã báo cáo "hoàn
// thành và đã test" (VHST-3/VHST-4/VHST-5, merge trong cùng phiên làm việc trước) KHÔNG hoạt động đúng
// trên giao diện thật — bài học: bộ test cũ (test-operation-danhmuc-dautu-units.js/
// test-operation-workitem-progress-frequency.js/test-operation-workitem-dependencies.js) chỉ gọi thẳng
// lib/recordActions.js (đúng LOGIC nghiệp vụ) nên KHÔNG bắt được 2/3 bug THẬT sự nằm ở tầng DOM/client
// (module-vanhanh.js) — file này bổ khuyết đúng lớp đó bằng Playwright thật (page.screenshot() + đọc lại
// DOM/state qua page.evaluate(), KHÔNG chỉ tin assertEqual() trên biến JS).
//
//   1) VHST-3 "Danh Mục Đầu Tư 2 cấp": root cause THẬT (lúc bug này còn tồn tại) — dropdown "Dòng mới
//      thêm — thuộc danh mục lớn nào?" (nay đã BỎ HẲN, đợt sửa sau, xem #2 bên dưới) chỉ được refresh
//      trong renderOperationEstimateItemsTable() (thêm/xoá dòng hoặc mở lại modal) — KHÔNG refresh khi
//      người dùng gõ "Nội Dung" cho dòng vừa thêm. Fix gốc: gọi populateEstimateNewItemParentSelect()
//      ngay trong updateOperationEstimateItemField() khi field==='content'. Cùng lúc đó,
//      updateOperationEstimateItemField() cũng refresh CẢ cột "Cha" ở mỗi dòng (mirror timing y hệt) —
//      cơ chế NÀY vẫn giữ nguyên (dropdown riêng bị bỏ, cột "Cha" per-row thì không), nên kịch bản test
//      "gõ xong -> lựa chọn cha xuất hiện NGAY" bên dưới nay assert qua cột "Cha" thay vì dropdown cũ.
//
//   1b) Đợt sửa lỗi SAU (phản hồi người dùng, đợt bỏ dropdown): dropdown "Dòng mới thêm — thuộc danh mục
//      lớn nào?" bị xác nhận là dư thừa so với 2 cơ chế còn lại — nút "+ Con" trên mỗi dòng danh mục lớn
//      (addOperationEstimateChildRow(), tạo con ngay 1 thao tác) và cột "Cha" ở mỗi dòng đã có sẵn
//      (changeOperationEstimateItemParent(), đổi cha bất kỳ lúc nào, kể cả dòng vừa gõ xong) — đã bỏ hẳn
//      dropdown + label, chỉ giữ nút "➕ Thêm Hạng Mục" (luôn tạo dòng LÀM danh mục lớn, parentId=null).
//
//   2) VHST-4 "Ngày bắt đầu": 2 lỗi thật — (a) resolveOperationWorkItemScheduleFields() (lib/recordActions.js)
//      trước đây CHỈ validate ĐỊNH DẠNG startDate, chưa từng đối chiếu với deadline -> chọn Ngày Bắt Đầu
//      SAU Hạn Hoàn Thành vẫn lưu được bình thường (test riêng cho phần server ở
//      test-operation-workitem-progress-frequency.js); (b) thứ tự field HTML: "Ngày Bắt Đầu" nằm SAU "Hạn
//      Hoàn Thành" trong form (public/index.html) — không phải bug logic nhưng đúng phản hồi UX người
//      dùng, đã đổi thứ tự. File này xác nhận CẢ 2 qua DOM thật (field order + chặn submit thật).
//
//   3) VHST-5 "🔗 Liên kết": root cause THẬT — modal "operationWorkItemDependencyModal" (public/index.html)
//      CHƯA TỪNG được đăng ký ở forEach(bindOperationDelegation) (module-vanhanh.js) từ lúc VHST-5 được
//      thêm — 1 <div> ĐỘC LẬP cấp cao, không lồng trong root nào đã bind, nên nút "💾 Lưu Liên Kết"/"Huỷ"/
//      "✕" BÊN TRONG modal hoàn toàn không phản hồi khi bấm (nút MỞ modal vẫn chạy vì nằm trong
//      operationWorkItemModal đã bind — modal vẫn mở ra bình thường, chỉ thao tác BÊN TRONG mới "chết").
//      Cùng lớp lỗi CSP-delegation với hrLifecycleSection (Đợt E). Fix: thêm
//      'operationWorkItemDependencyModal' vào danh sách forEach(bindOperationDelegation). File này xác
//      nhận bằng cách bấm THẬT (page.click) "💾 Lưu Liên Kết" và đọc lại state — trước fix,
//      dependsOnWorkItemIds không hề đổi và modal không đóng (bằng chứng nút "chết"); sau fix, lưu đúng và
//      modal tự đóng.
//
// Toàn bộ 3 kịch bản đều chụp ảnh (page.screenshot()) vào thư mục SHOTS_DIR bên dưới để xem lại trực
// quan (KHÔNG commit vào git — chỉ phục vụ soát xét trong phiên làm việc), và wire page.on('console')/
// page.on('pageerror') (qua launchPage() có sẵn) để phát hiện lỗi JS ẩn trong lúc chạy.
//
// Chạy: node server/tests/test-operation-vhst-uibugfix.js
const path = require('path');
const os = require('os');
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual
} = require('./testHarness');

const PORT = 8994;
const SHOTS_DIR = path.join(os.tmpdir(), 'vhst-uibugfix-shots');
try { require('fs').mkdirSync(SHOTS_DIR, { recursive: true }); } catch (_) { /* ignore */ }

const CREATOR = {
  username: 'vh_creator_uibug', name: 'Người Tạo Hồ Sơ', dept: 'Vận Hành',
  perms: { operationStoreOpenCreate: true, operationRecordManageAll: true }, active: true
};
// LỖI ĐÃ VÁ (11/2026) — thêm ứng viên "🔁 Giao Lại" (xem kịch bản cuối file): cần ít nhất 1 tài khoản
// active KHÁC CREATOR để renderPeopleMultiSelect() có ứng viên thật để chọn/chuyển giao.
const REASSIGN_TARGET = {
  username: 'vh_reassign_target_uibug', name: 'Người Nhận Việc Mới', dept: 'Vận Hành',
  perms: {}, active: true
};
const state = createMockState({ depts: ['Vận Hành'], users: [CREATOR, REASSIGN_TARGET] });

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  let recordId = null;

  try {
    await run.run('Setup: login + tạo hồ sơ operationStoreOpenings', async () => {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, CREATOR);
      recordId = await page.evaluate(async () => {
        const res = await callCreateAction('operationStoreOpenings', {
          storeName: 'Siêu thị hòa bình (test)', address: '123 Test', area: 200,
          approvedBudget: 5000000000, expectedOpenDate: '', personInCharge: '', note: ''
        });
        DB.operationStoreOpenings.push(res.item);
        return res.item.id;
      });
      assert(recordId, 'Phải tạo được hồ sơ');
    });

    // ===================== 1) VHST-3: Danh Mục Đầu Tư 2 cấp =====================
    // Đợt sửa lỗi sau (phản hồi người dùng): dropdown "Dòng mới thêm — thuộc danh mục lớn nào?" đã BỎ HẲN
    // (dư thừa so với nút "+ Con" trên mỗi dòng + cột "Cha" ở mỗi dòng đã có sẵn) — 3 kịch bản dưới viết
    // lại để dùng ĐÚNG 2 cơ chế còn lại, vẫn dựng ra CÙNG cấu trúc dữ liệu (idx 0=Nội thất, 1=Bàn ghế
    // (con của Nội thất), 2=Thiết bị) để kịch bản VHST-3-v2 ngay sau (dùng nút "+ Con") không cần sửa gì.
    await run.run('VHST-3 (DOM thật): gõ Nội Dung dòng 1 xong, thêm 1 dòng mới -> cột "Cha" của dòng mới PHẢI đã có "Nội thất" làm lựa chọn NGAY (không cần thêm/xoá dòng nào khác — xác nhận fix refresh real-time vẫn còn hiệu lực sau khi bỏ dropdown riêng)', async () => {
      await page.evaluate((id) => { openOperationEstimateModal('operationStoreOpenings', id); }, recordId);
      await page.waitForTimeout(100);
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(1) input[data-field="content"]', 'Nội thất');
      await page.waitForTimeout(80);
      await page.click('button[data-op="addOperationEstimateItemRow"]');
      await page.waitForTimeout(80);
      const selOptions = await page.evaluate(() => [...document.querySelector('select[data-op-change="changeOperationEstimateItemParent"][data-idx="1"]').options].map(o => o.textContent));
      assert(selOptions.includes('Nội thất'), `Cột "Cha" của dòng mới phải có "Nội thất" ngay sau khi gõ xong (thực tế: ${JSON.stringify(selOptions)})`);
    });

    await run.run('VHST-3 (DOM thật, cột "Cha"): chọn "Nội thất" làm cha cho dòng 2 -> dòng đó PHẢI thành con (parentId đúng), hiển thị THỤT LỀ + rollup Chi Phí', async () => {
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(2) input[data-field="content"]', 'Bàn ghế');
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(2) input[data-field="amount"]', '2000000000');
      await page.waitForTimeout(80);
      await page.selectOption('select[data-op-change="changeOperationEstimateItemParent"][data-idx="1"]', { label: 'Nội thất' });
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(SHOTS_DIR, 'vhst3-parent-child.png') });
      const check = await page.evaluate(() => ({
        item2ParentId: operationEstimateItems[1].parentId,
        item1Id: operationEstimateItems[0].id,
        row2Text: document.querySelector('#operationEstimateItemsTableBody tr:nth-child(2)').innerText,
        totalDisplay: document.getElementById('operationEstimateItemsTotalDisplay').innerText
      }));
      assertEqual(check.item2ParentId, check.item1Id, 'Dòng "Bàn ghế" phải có parentId = id "Nội thất"');
      assert(check.row2Text.includes('↳'), 'Dòng con phải hiển thị ký hiệu thụt lề "↳"');
      assertEqual(check.totalDisplay, '2.000.000.000', 'Tổng Chi Phí phải = rollup của "Nội thất" (2 tỷ), KHÔNG cộng đúp');
    });

    await run.run('VHST-3 (DOM thật): bấm "➕ Thêm Hạng Mục" thêm 1 danh mục lớn KHÁC ("Thiết bị") -> dòng mới LUÔN là danh mục lớn (parentId=null, không cần chọn gì), Tổng Chi Phí = rollup(Nội thất) + Thiết bị, không double-count', async () => {
      await page.click('button[data-op="addOperationEstimateItemRow"]');
      await page.waitForTimeout(80);
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(3) input[data-field="content"]', 'Thiết bị');
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(3) input[data-field="amount"]', '500000000');
      await page.waitForTimeout(80);
      const check = await page.evaluate(() => ({
        parentId: operationEstimateItems[2].parentId,
        total: document.getElementById('operationEstimateItemsTotalDisplay').innerText
      }));
      assertEqual(check.parentId, null, 'Dòng "Thiết bị" thêm qua "➕ Thêm Hạng Mục" phải luôn là danh mục lớn (parentId=null)');
      assertEqual(check.total, '2.500.000.000', 'Tổng Chi Phí phải = 2.000.000.000 (rollup Nội thất) + 500.000.000 (Thiết bị)');
    });

    // Phản hồi người dùng (lần 3, ảnh 1): "không chọn được dòng thuộc danh mục nào -> đề xuất tạo danh mục
    // con giống như Thực hiện đang làm cho dễ dàng" — dropdown "Dòng mới thêm..." (cơ chế VHST-3 cũ) khó
    // dùng/dễ bỏ sót theo phản hồi thực tế, và SAU ĐÓ đã bỏ hẳn (xem #1b ở đầu file) — kịch bản dưới xác
    // nhận lối đi hiện đang dùng: bấm thẳng "+ Con" NGAY TRÊN dòng cha muốn thêm con (mirror nút "➕ Con"
    // của cây Công việc Thực hiện), không cần qua dropdown nào cả.
    await run.run('VHST-3-v2 (DOM thật, nút "+ Con"): bấm "+ Con" trên dòng "Thiết bị" (dòng lớn thứ 2, idx=2) -> dòng mới PHẢI là con của "Thiết bị" (không phải "Nội thất")', async () => {
      const addChildBtnExistsOnDepth0 = await page.evaluate(() => !!document.querySelector('button[data-op="addOperationEstimateChildRow"][data-idx="2"]'));
      assert(addChildBtnExistsOnDepth0, 'Dòng "Thiết bị" (depth=0, idx=2) phải có nút "+ Con"');
      const addChildBtnMissingOnDepth1 = await page.evaluate(() => !document.querySelector('button[data-op="addOperationEstimateChildRow"][data-idx="1"]'));
      assert(addChildBtnMissingOnDepth1, 'Dòng "Bàn ghế" (depth=1, đã là con) KHÔNG được có nút "+ Con" (chỉ áp dụng danh mục lớn — bất biến 2 CẤP)');
      await page.click('button[data-op="addOperationEstimateChildRow"][data-idx="2"]');
      await page.waitForTimeout(80);
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(4) input[data-field="content"]', 'Kệ hàng');
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(4) input[data-field="amount"]', '300000000');
      await page.waitForTimeout(80);
      await page.screenshot({ path: path.join(SHOTS_DIR, 'vhst3v2-addchild-button.png') });
      const check = await page.evaluate(() => ({
        newItemParentId: operationEstimateItems[3].parentId,
        thietBiId: operationEstimateItems[2].id,
        row4Text: document.querySelector('#operationEstimateItemsTableBody tr:nth-child(4)').innerText,
        totalDisplay: document.getElementById('operationEstimateItemsTotalDisplay').innerText
      }));
      assertEqual(check.newItemParentId, check.thietBiId, 'Dòng "Kệ hàng" phải có parentId = id "Thiết bị" — bấm "+ Con" đúng trên dòng nào thì con thuộc dòng đó, KHÔNG cần chọn qua dropdown riêng');
      assert(check.row4Text.includes('↳'), 'Dòng con mới (qua nút "+ Con") phải hiển thị ký hiệu thụt lề "↳" giống hệt con tạo qua dropdown cũ');
      // "Thiết bị" VỪA có con ("Kệ hàng") -> operationEstimateEffectiveAmount() bỏ qua amount TỰ NHẬP
      // (500.000.000) của chính "Thiết bị", chỉ tính rollup = tổng amount các con (300.000.000) — mirror
      // ĐÚNG hành vi đã xác nhận ở "Nội thất"/"Bàn ghế" phía trên (2.000.000.000 = tự nhập của "Bàn ghế",
      // KHÔNG cộng thêm amount cũ của "Nội thất" trước khi có con).
      assertEqual(check.totalDisplay, '2.300.000.000', 'Tổng Chi Phí phải = 2.000.000.000 (rollup Nội thất, từ Bàn ghế) + 300.000.000 (rollup Thiết bị, từ Kệ hàng — amount tự nhập 500tr của Thiết bị bị bỏ qua vì đã có con) = 2.300.000.000');
      await page.evaluate(async () => { await submitOperationEstimateForApproval(); });
      await page.evaluate(() => { document.getElementById('operationEstimateModal').classList.add('hidden'); });
    });

    // ===================== 2) VHST-4: Ngày bắt đầu > Hạn bị chặn + thứ tự field =====================
    await run.run('VHST-4 (DOM thật): field "Ngày Bắt Đầu" phải nằm TRƯỚC "Hạn Hoàn Thành" trong form', async () => {
      await page.evaluate((id) => { openOperationWorkItemModal('operationStoreOpenings', id, 'EXECUTION'); }, recordId);
      await page.waitForTimeout(80);
      await page.click('button[data-op="openOperationWorkItemFormModal"]');
      await page.waitForTimeout(80);
      await page.screenshot({ path: path.join(SHOTS_DIR, 'vhst4-form-order.png') });
      const labels = await page.evaluate(() => [...document.querySelectorAll('#operationWorkItemFormModal form label')].map(l => l.textContent.trim()));
      const startIdx = labels.findIndex(l => l.includes('Ngày Bắt Đầu'));
      const deadlineIdx = labels.findIndex(l => l.includes('Hạn Hoàn Thành'));
      assert(startIdx !== -1 && deadlineIdx !== -1, 'Phải tìm thấy cả 2 label');
      assert(startIdx < deadlineIdx, `"Ngày Bắt Đầu" (vị trí ${startIdx}) phải đứng TRƯỚC "Hạn Hoàn Thành" (vị trí ${deadlineIdx})`);
    });

    // Phản hồi người dùng (lần 3, ảnh 2+3): trước đây CHỈ chặn LÚC BẤM LƯU (alert() sau khi submit) — lịch
    // chọn ngày vẫn cho chọn tự do bất kỳ ngày nào tới lúc đó. Nay syncOwiDateBounds() set min/max HTML5
    // NGAY khi 1 trong 2 ô đổi giá trị (data-op-change, xem public/index.html #owiStartDate/#owiDeadline) —
    // kịch bản dưới xác nhận CẢ 2 lớp chặn: (a) real-time — điền Hạn Hoàn Thành xong thì Ngày Bắt Đầu PHẢI
    // có max=đúng giá trị đó NGAY (không cần đợi submit); (b) defense-in-depth — nếu vẫn có giá trị vượt
    // ngưỡng lọt vào (VD gán thẳng qua JS, bỏ qua UI) thì trình duyệt tự chặn requestSubmit() bằng validation
    // NATIVE (rangeOverflow, không cần đợi alert() JS của submitOperationWorkItemForm() — hàm đó vẫn giữ
    // NGUYÊN làm lớp chặn thứ 3 phòng khi browser không hỗ trợ input[type=date] đúng chuẩn).
    await run.run('VHST-4 (DOM thật, real-time): điền Hạn Hoàn Thành xong -> Ngày Bắt Đầu PHẢI có max = đúng giá trị đó NGAY (không cần bấm Lưu)', async () => {
      await page.evaluate(() => { window.__resetCapture(); });
      await page.fill('#owiTitle', 'Làm nội thất');
      const maxBefore = await page.evaluate(() => document.getElementById('owiStartDate').max);
      assertEqual(maxBefore, '', 'Trước khi điền Hạn Hoàn Thành, Ngày Bắt Đầu chưa có giới hạn max nào');
      await page.fill('#owiDeadline', '2026-01-01');
      const maxAfter = await page.evaluate(() => document.getElementById('owiStartDate').max);
      assertEqual(maxAfter, '2026-01-01', 'Ngay khi đổi Hạn Hoàn Thành, Ngày Bắt Đầu phải nhận max mới NGAY LẬP TỨC (real-time, không đợi submit)');
    });

    await run.run('VHST-4 (DOM thật): submit với Ngày Bắt Đầu SAU Hạn Hoàn Thành (vượt max HTML5) -> trình duyệt tự chặn requestSubmit() (rangeOverflow), KHÔNG tạo công việc, form vẫn mở', async () => {
      await page.fill('#owiStartDate', '2026-06-01');
      await page.screenshot({ path: path.join(SHOTS_DIR, 'vhst4-bad-dates.png') });
      const result = await page.evaluate(async () => {
        const startEl = document.getElementById('owiStartDate');
        const overflow = startEl.validity.rangeOverflow;
        document.querySelector('#operationWorkItemFormModal form').requestSubmit();
        await new Promise(r => setTimeout(r, 200));
        return {
          rangeOverflow: overflow,
          itemCount: DB.operationWorkItems.length,
          formHidden: document.getElementById('operationWorkItemFormModal').classList.contains('hidden')
        };
      });
      assert(result.rangeOverflow, 'input[type=date] Ngày Bắt Đầu phải tự báo rangeOverflow=true khi giá trị vượt max (bằng chứng browser đã áp dụng đúng giới hạn real-time)');
      assertEqual(result.itemCount, 0, 'KHÔNG được tạo công việc khi ngày bắt đầu sau hạn (native validation chặn requestSubmit() trước khi JS submit handler chạy)');
      assert(!result.formHidden, 'Form phải VẪN MỞ (không đóng) để người dùng sửa lại');
    });

    await run.run('VHST-4 (defense-in-depth): nếu giá trị vượt ngưỡng LỌT vào bằng cách gán thẳng .value qua JS (bỏ qua constraint UI) -> submitOperationWorkItemForm() vẫn tự chặn bằng alert() (lớp chặn dự phòng thứ 3, KHÔNG bị fix real-time thay thế)', async () => {
      await page.evaluate(() => { window.__resetCapture(); });
      await page.evaluate(() => {
        // Mô phỏng giá trị "lọt" qua constraint UI (VD: trình duyệt cũ không hỗ trợ, hoặc gán trực tiếp
        // qua devtools) — xoá CẢ 2 chiều ràng buộc HTML5 (max của Ngày Bắt Đầu LẪN min của Hạn Hoàn Thành,
        // vì syncOwiDateBounds() đặt ràng buộc 2 CHIỀU đối xứng — chỉ xoá 1 chiều thì chiều kia vẫn tự
        // chặn native, không thật sự kiểm tra được lớp chặn JS độc lập bên dưới) rồi gán .value bằng JS
        // thuần (KHÔNG dispatch change event) để xác nhận lớp chặn thứ 3 (alert() JS trong
        // submitOperationWorkItemForm()) vẫn còn nguyên, không bị fix real-time xoá mất.
        document.getElementById('owiStartDate').removeAttribute('max');
        document.getElementById('owiDeadline').removeAttribute('min');
        document.getElementById('owiStartDate').value = '2026-06-01';
      });
      const result = await page.evaluate(async () => {
        document.querySelector('#operationWorkItemFormModal form').requestSubmit();
        await new Promise(r => setTimeout(r, 200));
        return {
          alerts: window.__alerts.slice(),
          itemCount: DB.operationWorkItems.length,
          formHidden: document.getElementById('operationWorkItemFormModal').classList.contains('hidden')
        };
      });
      assert(result.alerts.some(a => a.includes('Ngày bắt đầu') && a.includes('Hạn hoàn thành')), `Lớp chặn dự phòng (alert() JS) phải vẫn hoạt động khi giá trị lọt qua native validation (thực tế: ${JSON.stringify(result.alerts)})`);
      assertEqual(result.itemCount, 0, 'KHÔNG được tạo công việc dù giá trị lọt qua native validation');
      assert(!result.formHidden, 'Form phải VẪN MỞ để người dùng sửa lại');
    });

    let rootWorkItemId = null;
    await run.run('VHST-4: sửa lại ngày hợp lệ -> tạo được bình thường', async () => {
      await page.fill('#owiStartDate', '2025-12-01');
      await page.evaluate(async () => {
        document.querySelector('#operationWorkItemFormModal form').requestSubmit();
        await new Promise(r => setTimeout(r, 200));
      });
      await page.waitForTimeout(100);
      rootWorkItemId = await page.evaluate(() => {
        const it = DB.operationWorkItems.find(w => w.title === 'Làm nội thất');
        return it ? it.id : null;
      });
      assert(rootWorkItemId, 'Phải tạo được công việc với ngày hợp lệ');
      await page.screenshot({ path: path.join(SHOTS_DIR, 'vhst4-workitem-created.png'), fullPage: true });
    });

    // Phản hồi người dùng (lần 3, ảnh 3): "công việc con vẫn chọn được ngày hoàn thành trước ngày thực
    // hiện" — openOperationWorkItemFormModal(parentWorkItemId, editItem) dùng CHUNG 1 form/CHUNG
    // syncOwiDateBounds() bất kể tạo việc GỐC hay việc CON (không có nhánh riêng theo parentWorkItemId ở
    // logic ngày tháng) nên fix ở trên áp dụng ĐÚNG cho cả 2 trường hợp — xác nhận riêng bằng kịch bản mở
    // form qua nút "➕ Con" (không phải "➕ Thêm Công Việc Gốc") để chắc chắn không có đường vòng nào bỏ sót.
    await run.run('VHST-4 (DOM thật, CÔNG VIỆC CON): mở form qua "➕ Con" -> Ngày Bắt Đầu/Hạn Hoàn Thành PHẢI có cùng cơ chế chặn real-time như công việc gốc', async () => {
      await page.evaluate(() => { window.__resetCapture(); });
      await page.click(`button[data-op="openOperationWorkItemFormModal"][data-parent-id="${rootWorkItemId}"]`);
      await page.waitForTimeout(80);
      const maxBefore = await page.evaluate(() => document.getElementById('owiStartDate').max);
      assertEqual(maxBefore, '', 'Form việc CON mới mở (chưa điền gì) chưa có giới hạn max nào');
      await page.fill('#owiTitle', 'Lắp bóng đèn');
      await page.fill('#owiDeadline', '2025-12-20');
      const maxAfter = await page.evaluate(() => document.getElementById('owiStartDate').max);
      assertEqual(maxAfter, '2025-12-20', 'Form việc CON: Ngày Bắt Đầu phải nhận max real-time giống hệt form việc gốc');
      await page.fill('#owiStartDate', '2026-01-15');
      const overflow = await page.evaluate(() => document.getElementById('owiStartDate').validity.rangeOverflow);
      assert(overflow, 'Form việc CON: input Ngày Bắt Đầu phải tự báo rangeOverflow khi chọn ngày sau Hạn Hoàn Thành');
      await page.screenshot({ path: path.join(SHOTS_DIR, 'vhst4-child-workitem-dates.png') });
      await page.evaluate(() => { closeOperationWorkItemFormModal(); });
    });

    // ===================== 3) VHST-5: "🔗 Liên kết" — nút hiện + modal dùng được thật =====================
    let otherWorkItemId = null;
    await run.run('VHST-5 setup: tạo thêm 1 công việc gốc khác để liên kết tới', async () => {
      otherWorkItemId = await page.evaluate(async (id) => {
        const r = await callRecordCreate('operationWorkItems', {
          sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: null,
          title: 'Lắp điện', deadline: '2026-01-01', startDate: '2025-11-01'
        });
        DB.operationWorkItems.push(r.item);
        return r.item.id;
      }, recordId);
      await page.evaluate(() => { renderOperationWorkItemModalBody(); });
      await page.waitForTimeout(80);
      await page.screenshot({ path: path.join(SHOTS_DIR, 'vhst5-list-with-button.png'), fullPage: true });
      const btn = await page.evaluate((rid) => {
        const el = document.querySelector(`button[data-op="openOperationWorkItemDependencyModal"][data-id="${rid}"]`);
        return el ? { exists: true, className: el.className } : { exists: false };
      }, rootWorkItemId);
      assert(btn.exists, 'Nút "🔗 Liên kết" phải hiện trên dòng công việc LÁ');
      // Phản hồi người dùng (lần 3, ảnh 4): nút trước đây màu nhạt (bg-purple-100) dễ bị bỏ sót giữa nhiều
      // nút khác cùng dòng — nay phải màu đậm (bg-purple-600 text-white) để nổi bật ngang "🔄 Cập Nhật Tiến Độ".
      assert(btn.className.includes('bg-purple-600') && btn.className.includes('text-white'), `Nút "🔗 Liên kết" phải dùng màu đậm nổi bật (bg-purple-600 text-white), thực tế class: ${btn.className}`);
      const hintVisible = await page.evaluate(() => !document.getElementById('operationWorkItemDependencyHintBox').classList.contains('hidden'));
      assert(hintVisible, 'Hộp gợi ý "💡 Muốn 1 công việc chỉ được thực hiện SAU khi..." phải hiện ở tab Thực hiện (canEditWorkItems=true) để người dùng biết nút "🔗 Liên kết" tồn tại và dùng để làm gì');
    });

    await run.run('VHST-5 (DOM thật, bấm THẬT): mở modal Liên kết, chọn "Lắp điện", bấm "💾 Lưu Liên Kết" -> PHẢI lưu đúng + modal PHẢI tự đóng (trước fix: cả 2 đều KHÔNG xảy ra)', async () => {
      await page.click(`button[data-op="openOperationWorkItemDependencyModal"][data-id="${rootWorkItemId}"]`);
      await page.waitForTimeout(100);
      const modalOpened = await page.evaluate(() => !document.getElementById('operationWorkItemDependencyModal').classList.contains('hidden'));
      assert(modalOpened, 'Modal Liên kết phải mở ra khi bấm nút');
      await page.screenshot({ path: path.join(SHOTS_DIR, 'vhst5-modal-open.png') });

      await page.check(`.owi-dependency-cb[value="${otherWorkItemId}"]`);
      await page.click('button[data-op="submitOperationWorkItemDependencies"]');
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(SHOTS_DIR, 'vhst5-after-save.png'), fullPage: true });

      const check = await page.evaluate((rid) => {
        const item = DB.operationWorkItems.find(w => w.id === rid);
        return {
          dependsOnWorkItemIds: item.dependsOnWorkItemIds,
          modalHidden: document.getElementById('operationWorkItemDependencyModal').classList.contains('hidden')
        };
      }, rootWorkItemId);
      assertEqual(check.dependsOnWorkItemIds.length, 1, 'Phải lưu đúng 1 liên kết sau khi bấm "💾 Lưu Liên Kết" THẬT (nếu = 0: nút vẫn "chết", bug CSP-delegation TÁI PHÁT)');
      assertEqual(check.dependsOnWorkItemIds[0], otherWorkItemId, 'Liên kết phải trỏ đúng "Lắp điện"');
      assert(check.modalHidden, 'Modal phải tự đóng sau khi lưu thành công (nếu vẫn mở: nút Lưu vẫn "chết")');
    });

    await run.run('VHST-5: "Làm nội thất" chưa thể "Bắt đầu" (blocked ở cả UI badge lẫn server) vì "Lắp điện" chưa nghiệm thu xong', async () => {
      const rowHtml = await page.evaluate(() => document.getElementById('operationWorkItemTableBody').innerHTML);
      assert(rowHtml.includes('Chưa thể bắt đầu'), 'Dòng "Làm nội thất" phải hiện badge chặn "Chưa thể bắt đầu"');
      const serverCheck = await page.evaluate(async (rid) => {
        try {
          await callRecordAction('operationWorkItems', rid, 'progress', { status: 'DANG_THUC_HIEN', note: '' });
          return { blocked: false };
        } catch (err) { return { blocked: true, message: err.message }; }
      }, rootWorkItemId);
      assert(serverCheck.blocked, 'Server (VHST-5 gate, không bị đợt nào sau đó làm hỏng) phải chặn "Bắt đầu"');
    });

    // ===================== 4) LỖI ĐÃ VÁ (11/2026): "🗑️ Xoá" + "🔁 Giao Lại" không mở gì cả =====================
    // Người dùng báo "không thao tác được nút xóa và nút giao việc trong qlda với thực hiện — CẢ hai nút
    // không mở ra cái gì đâu". Root cause CHÍNH (khác hẳn suy đoán ban đầu về modal thiếu
    // bindOperationDelegation): deleteOperationWorkItemClient()/openOperationWorkItemReassignModal() dùng
    // "data-id" (đúng quy ước riêng OP_CLICK_ACTIONS, xem openOperationWorkItemEditModal làm mẫu) nhưng
    // CHƯA TỪNG được khai ở registry đó — rơi vào fallback cspDispatchOp() chung (core.js), hàm đó CHỈ
    // đọc data-arg0/argN (xem cspCollectArgs()), KHÔNG đọc "data-id" -> gọi hàm với 0 tham số, id=undefined,
    // rơi ngay vào "if (!w) return;" đầu hàm -> KHÔNG MỞ GÌ CẢ, không 1 dòng lỗi console nào. Đã vá bằng
    // cách khai tường minh 2 entry ở OP_CLICK_ACTIONS (đọc Number(el.dataset.id) đúng quy ước). RIÊNG
    // "🔁 Giao Lại" còn có thêm 1 lớp lỗi THỨ 2 (y hệt VHST-5): modal 'operationWorkItemReassignModal'
    // cũng CHƯA TỪNG được đăng ký ở forEach(bindOperationDelegation) — sau khi vá lớp 1 (modal mở đúng),
    // nút "💾 Giao Lại"/"Huỷ" BÊN TRONG modal vẫn sẽ "chết" nếu thiếu fix lớp 2 này. Kịch bản này xác nhận
    // CẢ 2 lớp fix cùng lúc bằng page.click() thật (không gọi hàm JS trực tiếp).
    await run.run('Xoá (DOM thật, bấm THẬT): bấm "🗑️ Xoá" trên 1 công việc LÁ "Chưa bắt đầu" -> popup xác nhận PHẢI mở ra đúng tên công việc (trước fix: không mở gì cả, id=undefined)', async () => {
      // sourceType khớp đúng hồ sơ operationStoreOpenings đã tạo ở bước Setup đầu file (cùng khuôn
      // otherWorkItemId ở kịch bản VHST-5 phía trên).
      const leafId = await page.evaluate(async (id) => {
        const r = await callRecordCreate('operationWorkItems', {
          sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: null,
          title: 'Việc chờ xoá (test)', deadline: '2026-02-01', startDate: '2026-01-01'
        });
        DB.operationWorkItems.push(r.item);
        return r.item.id;
      }, recordId);
      await page.evaluate(() => { renderOperationWorkItemModalBody(); });
      await page.waitForTimeout(80);

      await page.click(`button[data-op="deleteOperationWorkItemClient"][data-id="${leafId}"]`);
      await page.waitForTimeout(100);
      const confirmState = await page.evaluate(() => ({
        opened: !document.getElementById('genericConfirmModal').classList.contains('hidden'),
        bodyText: document.getElementById('genericConfirmBody').innerText
      }));
      assert(confirmState.opened, 'Popup xác nhận xoá phải mở ra khi bấm "🗑️ Xoá" (nếu không mở: id=undefined, bug tái phát)');
      assert(confirmState.bodyText.includes('Việc chờ xoá (test)'), `Popup phải hiện đúng tên công việc đang xoá (chứng minh id đọc đúng, không phải undefined), thực tế: ${confirmState.bodyText}`);
      await page.screenshot({ path: path.join(SHOTS_DIR, 'owi-delete-confirm-open.png') });

      await page.click('button[data-op="runConfirmedAction"]');
      await page.waitForTimeout(200);
      const stillExists = await page.evaluate((lid) => (DB.operationWorkItems || []).some(w => w.id === lid), leafId);
      assert(!stillExists, 'Công việc phải được xoá khỏi DB.operationWorkItems sau khi xác nhận');
    });

    await run.run('Giao Lại (DOM thật, bấm THẬT): mở modal "🔁 Giao Lại", gõ-tìm-chọn người nhận mới (renderPeopleMultiSelect(), KHÔNG phải checkbox thường), bấm "💾 Giao Lại" -> PHẢI đổi đúng người phụ trách + modal PHẢI tự đóng (trước fix: cả 2 đều KHÔNG xảy ra)', async () => {
      await page.click(`button[data-op="openOperationWorkItemReassignModal"][data-id="${rootWorkItemId}"]`);
      await page.waitForTimeout(100);
      const modalOpened = await page.evaluate(() => !document.getElementById('operationWorkItemReassignModal').classList.contains('hidden'));
      assert(modalOpened, 'Modal "Giao Lại" phải mở ra khi bấm nút "🔁 Giao Lại" (nút này nằm TRONG operationWorkItemModal đã bind nên luôn mở được, kể cả trước khi vá — bug thật chỉ nằm ở các nút BÊN TRONG modal này)');
      await page.screenshot({ path: path.join(SHOTS_DIR, 'owi-reassign-modal-open.png') });

      // Ô "Người Thực Hiện Mới" dùng renderPeopleMultiSelect() (chip + ô tìm-gõ-chọn + dropdown), khớp
      // đúng khuôn các test khác đã dùng cho widget này (xem test-shelf-threshold-ui-real-click.js) — KHÔNG
      // phải checkbox hiện sẵn như owi-dependency-cb (VHST-5 ở trên, 1 widget khác hẳn).
      await page.fill('#owiReassignAssignedToPicker [data-pms-search]', REASSIGN_TARGET.name);
      await page.waitForTimeout(30);
      await page.click('#owiReassignAssignedToPicker [data-pms-dropdown] [data-op="pmsAdd"]');
      await page.waitForTimeout(30);
      const chipsText = await page.evaluate(() => document.querySelector('#owiReassignAssignedToPicker [data-pms-chips]').textContent);
      assert(chipsText.includes(REASSIGN_TARGET.username), `Phải hiện chip ${REASSIGN_TARGET.username} đã chọn trước khi bấm Giao Lại, thực tế: ${chipsText}`);

      await page.click('button[data-op="submitOperationWorkItemReassign"]');
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(SHOTS_DIR, 'owi-reassign-after-save.png'), fullPage: true });

      const check = await page.evaluate((rid) => {
        const item = DB.operationWorkItems.find(w => w.id === rid);
        return {
          assignedTo: item.assignedTo,
          modalHidden: document.getElementById('operationWorkItemReassignModal').classList.contains('hidden')
        };
      }, rootWorkItemId);
      assert(check.assignedTo.includes(REASSIGN_TARGET.username), `Phải lưu đúng người phụ trách mới sau khi bấm "💾 Giao Lại" THẬT (nếu không có trong danh sách: nút vẫn "chết", bug CSP-delegation TÁI PHÁT) — thực tế assignedTo: ${JSON.stringify(check.assignedTo)}`);
      assert(check.modalHidden, 'Modal "Giao Lại" phải tự đóng sau khi lưu thành công (nếu vẫn mở: nút "💾 Giao Lại" vẫn "chết")');
    });

    // ===================== 5) LỖI ĐÃ VÁ (11/2026): "💰 Giá trị đầu tư/hợp đồng" — không mở gì cả =====================
    // Người dùng báo (kèm ảnh chụp khoanh đỏ nút "💰"): "ấn nút này đang không khả dụng, ko thao tác được
    // bất kỳ cái gì". Root cause GIỐNG HỆT "Xoá"/"Giao Lại" (v29.14): openOperationWorkItemContractModal()
    // dùng data-id nhưng chưa khai ở OP_CLICK_ACTIONS -> fallback cspDispatchOp() chỉ đọc data-arg0/argN,
    // gọi với id=undefined -> "if (!w) return;" thoát ngay, không mở gì cả. Modal operationWorkItemContractModal
    // cũng CHƯA đăng ký ở forEach(bindOperationDelegation) (lớp lỗi thứ 2, như editOperationRepairModal).
    await run.run('Giá Trị Hợp Đồng (DOM thật, bấm THẬT): bấm "💰" -> modal PHẢI mở đúng (ĐỔI THIẾT KẾ v29.20: modal CHỈ còn Giá Trị Hợp Đồng + tệp đính kèm, "Giá Trị Đầu Tư" đã chuyển ra cột riêng trong bảng) -> gõ Giá Trị Hợp Đồng + bấm "💾 Lưu" -> PHẢI lưu đúng + modal PHẢI tự đóng (trước fix: không mở gì cả)', async () => {
      await page.click(`button[data-op="openOperationWorkItemContractModal"][data-id="${rootWorkItemId}"]`);
      await page.waitForTimeout(100);
      const modalOpened = await page.evaluate(() => !document.getElementById('operationWorkItemContractModal').classList.contains('hidden'));
      assert(modalOpened, 'Modal "💰 Giá trị hợp đồng" phải mở ra khi bấm nút "💰" (nếu không mở: id=undefined, bug tái phát)');
      await page.screenshot({ path: path.join(SHOTS_DIR, 'owi-contract-modal-open.png') });

      const investmentElGone = await page.evaluate(() => document.getElementById('owiContractInvestmentValue') === null);
      assert(investmentElGone, 'Field "Giá Trị Đầu Tư" (owiContractInvestmentValue) phải ĐÃ BỊ BỎ khỏi modal (v29.20 — chuyển ra cột riêng trong bảng)');

      await page.fill('#owiContractValue', '850000000');
      await page.click('button[data-op="submitOperationWorkItemContract"]');
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(SHOTS_DIR, 'owi-contract-after-save.png'), fullPage: true });

      const check = await page.evaluate((rid) => {
        const item = DB.operationWorkItems.find(w => w.id === rid);
        return {
          contractValue: item.contractValue,
          modalHidden: document.getElementById('operationWorkItemContractModal').classList.contains('hidden')
        };
      }, rootWorkItemId);
      assertEqual(check.contractValue, 850000000, 'Giá Trị Hợp Đồng phải được lưu đúng sau khi bấm "💾 Lưu" THẬT (nếu vẫn 0/cũ: nút vẫn "chết", bug CSP-delegation TÁI PHÁT)');
      assert(check.modalHidden, 'Modal phải tự đóng sau khi lưu thành công (nếu vẫn mở: nút "💾 Lưu" vẫn "chết")');
    });

    // ===================== 6) Cột "Giá Trị Đầu Tư" trong bảng (ĐỔI THIẾT KẾ v29.20) =====================
    // v29.18: thêm 1 cột nhỏ hiện Giá Trị Hợp Đồng (contractValue, nhập tay) ngay trong bảng. v29.20
    // (phản hồi người dùng sau demo — "Giá Trị Đầu Tư" trong modal hiện SAI, lấy tổng cả hồ sơ thay vì
    // đúng hạng mục): đổi hẳn cột này thành "Giá Trị Đầu Tư" TỰ ĐỘNG (link qua estimateItemId), Giá Trị
    // Hợp Đồng (nhập tay) nay CHỈ còn xem/sửa trong modal "💰", không còn hiện trong bảng nữa.
    // rootWorkItemId trong file test này được TẠO TAY (nút "➕ Thêm Công Việc Gốc", KHÔNG qua Danh Mục
    // Đầu Tư/buildAutoWorkItemsFromEstimate()) nên estimateItemId = null -> cột PHẢI hiện "—", kể cả sau
    // khi vừa lưu 850.000.000 Giá Trị Hợp Đồng ở kịch bản (5) ngay trên — xác nhận ĐÚNG cột đang hiện
    // Giá Trị Đầu Tư (không liên kết -> "—"), KHÔNG phải vô tình vẫn hiện Giá Trị Hợp Đồng cũ.
    await run.run('Cột "Giá Trị Đầu Tư" (DOM thật): công việc TẠO TAY (không qua Danh Mục Đầu Tư) -> PHẢI hiện "—", KHÔNG hiện 850.000.000 vừa lưu ở Giá Trị Hợp Đồng (xác nhận cột đã đổi đúng, không còn là Giá Trị Hợp Đồng)', async () => {
      const cellText = await page.evaluate((rid) => {
        const btn = document.querySelector(`button[data-op="openOperationWorkItemContractModal"][data-id="${rid}"]`);
        const row = btn && btn.closest('tr');
        if (!row) return null;
        const cells = row.querySelectorAll('td');
        return cells[4] ? cells[4].textContent.trim() : null; // 0=Tên,1=Người PT,2=Hạn,3=Trạng Thái,4=Giá Trị Đầu Tư
      }, rootWorkItemId);
      assert(cellText === '—', `Cột "Giá Trị Đầu Tư" phải hiện "—" cho công việc tạo tay (không liên kết Danh Mục Đầu Tư) — thực tế: "${cellText}" (nếu hiện "850.000.000": cột VẪN đang hiện Giá Trị Hợp Đồng cũ, chưa đổi đúng)`);
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
  console.log(`(Ảnh chụp màn hình lưu tại: ${SHOTS_DIR})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
