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
//   1) VHST-3 "Danh Mục Đầu Tư 2 cấp": root cause THẬT — populateEstimateNewItemParentSelect() (dropdown
//      "đây là danh mục con của...") trước đây CHỈ được refresh trong renderOperationEstimateItemsTable()
//      (tức lúc thêm/xoá dòng hoặc mở lại modal) — KHÔNG refresh khi người dùng gõ "Nội Dung" cho dòng vừa
//      thêm (updateOperationEstimateItemField(), input sự kiện 'input' từng phím, cố tình KHÔNG render lại
//      cả bảng để giữ con trỏ). Hệ quả: gõ xong Nội Dung rồi bấm "➕ Thêm Hạng Mục" NGAY (thao tác tự
//      nhiên nhất) thì dropdown vẫn CHƯA kịp có dòng vừa gõ làm lựa chọn cha — dòng mới luôn bị thêm thành
//      danh mục LỚN (parentId=null) dù người dùng tưởng đã chọn được cha, đúng y hệt "2 dòng cùng cấp,
//      Tổng Chi Phí cộng phẳng" trong ảnh chụp người dùng gửi. Fix: gọi populateEstimateNewItemParentSelect()
//      ngay trong updateOperationEstimateItemField() khi field==='content' (không render lại cả bảng).
//      Cũng thêm nhãn rõ ràng "Dòng mới thêm — thuộc danh mục lớn nào?" (trước đây <select> trơn không
//      nhãn, người dùng phản ánh là "mũi tên nhỏ không rõ nghĩa").
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
const state = createMockState({ depts: ['Vận Hành'], users: [CREATOR] });

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
    await run.run('VHST-3 (DOM thật): gõ Nội Dung dòng 1 xong -> dropdown cha PHẢI đã có dòng đó NGAY (không cần thêm/xoá dòng nào khác)', async () => {
      await page.evaluate((id) => { openOperationEstimateModal('operationStoreOpenings', id); }, recordId);
      await page.waitForTimeout(100);
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(1) input[data-field="content"]', 'Nội thất');
      await page.waitForTimeout(80);
      const selOptions = await page.evaluate(() => [...document.getElementById('selEstimateNewItemParent').options].map(o => o.textContent));
      assert(selOptions.includes('Nội thất'), `Dropdown cha phải có "Nội thất" ngay sau khi gõ xong (thực tế: ${JSON.stringify(selOptions)})`);
    });

    await run.run('VHST-3 (DOM thật): chọn "Nội thất" làm cha rồi bấm "➕ Thêm Hạng Mục" -> dòng mới PHẢI là con (parentId đúng), hiển thị THỤT LỀ + rollup Chi Phí', async () => {
      await page.selectOption('#selEstimateNewItemParent', { label: 'Nội thất' });
      await page.click('button[data-op="addOperationEstimateItemRow"]');
      await page.waitForTimeout(100);
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(2) input[data-field="content"]', 'Bàn ghế');
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(2) input[data-field="amount"]', '2000000000');
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

    await run.run('VHST-3 (DOM thật): thêm 1 danh mục lớn KHÁC ("Thiết bị") -> Tổng Chi Phí = rollup(Nội thất) + Thiết bị, không double-count', async () => {
      await page.selectOption('#selEstimateNewItemParent', { label: '— Không, đây là danh mục lớn —' });
      await page.click('button[data-op="addOperationEstimateItemRow"]');
      await page.waitForTimeout(80);
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(3) input[data-field="content"]', 'Thiết bị');
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(3) input[data-field="amount"]', '500000000');
      await page.waitForTimeout(80);
      const total = await page.evaluate(() => document.getElementById('operationEstimateItemsTotalDisplay').innerText);
      assertEqual(total, '2.500.000.000', 'Tổng Chi Phí phải = 2.000.000.000 (rollup Nội thất) + 500.000.000 (Thiết bị)');
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

    await run.run('VHST-4 (DOM thật): submit với Ngày Bắt Đầu SAU Hạn Hoàn Thành -> bị chặn client-side (alert rõ ràng), KHÔNG tạo công việc', async () => {
      await page.evaluate(() => { window.__resetCapture(); });
      await page.fill('#owiTitle', 'Làm nội thất');
      await page.fill('#owiDeadline', '2026-01-01');
      await page.fill('#owiStartDate', '2026-06-01');
      await page.screenshot({ path: path.join(SHOTS_DIR, 'vhst4-bad-dates.png') });
      const result = await page.evaluate(async () => {
        document.querySelector('#operationWorkItemFormModal form').requestSubmit();
        await new Promise(r => setTimeout(r, 200));
        return {
          alerts: window.__alerts.slice(),
          itemCount: DB.operationWorkItems.length,
          formHidden: document.getElementById('operationWorkItemFormModal').classList.contains('hidden')
        };
      });
      assert(result.alerts.some(a => a.includes('Ngày bắt đầu') && a.includes('Hạn hoàn thành')), `Phải có alert chặn rõ ràng (thực tế: ${JSON.stringify(result.alerts)})`);
      assertEqual(result.itemCount, 0, 'KHÔNG được tạo công việc khi ngày bắt đầu sau hạn');
      assert(!result.formHidden, 'Form phải VẪN MỞ (không đóng) để người dùng sửa lại');
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
      const hasButton = await page.evaluate((rid) => !!document.querySelector(`button[data-op="openOperationWorkItemDependencyModal"][data-id="${rid}"]`), rootWorkItemId);
      assert(hasButton, 'Nút "🔗 Liên kết" phải hiện trên dòng công việc LÁ');
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
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
  console.log(`(Ảnh chụp màn hình lưu tại: ${SHOTS_DIR})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
