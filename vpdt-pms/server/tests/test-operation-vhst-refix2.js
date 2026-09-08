// server/tests/test-operation-vhst-refix2.js
//
// Regression test Playwright THẬT (DOM thật + page.click()/page.fill(), KHÔNG gọi tắt page.evaluate() để
// né UI) cho ĐỢT SỬA LỖI THỨ 2 — người dùng báo cáo LẦN THỨ HAI đúng 3 lỗi Vận Hành > Siêu Thị (Danh Mục
// Đầu Tư/Ngày bắt đầu/Liên kết công việc) vẫn còn nguyên SAU KHI đợt sửa lỗi thứ 1 (commit 960c5de, xem
// tests/test-operation-vhst-uibugfix.js) đã báo "đã fix, đã xác nhận Playwright". Bài học: bộ test đợt 1
// PASS 10/10 nhưng dùng đúng 1 thao tác "may mắn khớp" (gõ Nội Dung RỒI MỚI chọn dropdung cha RỒI MỚI bấm
// Thêm) — không mô phỏng thao tác TỰ NHIÊN hơn của người dùng thật (thêm sẵn nhiều dòng trống rồi mới gõ
// nội dung từng dòng), nên không bắt được lỗ hổng UX thật khiến người dùng "vẫn không tạo được danh mục
// con". File này bổ khuyết đúng lỗ hổng đó + 1 lỗ hổng nghiệp vụ thứ 4 (Hỗ Trợ IT) mới phát hiện lần này.
//
//   1) "Danh Mục Đầu Tư" — root cause THẬT (khác hẳn root cause đợt 1): trước đợt sửa lỗi thứ 2 này, CHỈ
//      có đúng 1 cách gán cha — chọn dropdown "Dòng mới thêm — thuộc danh mục lớn nào?" TRƯỚC KHI bấm "➕
//      Thêm Hạng Mục". KHÔNG có cách nào đổi cha của 1 dòng ĐÃ CÓ SẴN (VD: bấm "Thêm Hạng Mục" vài lần tạo
//      sẵn nhiều dòng trống RỒI MỚI gõ Nội Dung từng dòng — thao tác tự nhiên không kém gì thao tác đợt 1
//      test qua). Fix: thêm cột "Cha" ở MỖI DÒNG (không chỉ dòng sắp thêm) — đổi cha bất kỳ lúc nào qua
//      changeOperationEstimateItemParent() (module-vanhanh.js), server (submitOperationEstimate(), không
//      đổi) đã hỗ trợ sẵn mọi thứ tự gán cha nên không cần sửa gì phía server.
//
//   2) "Ngày bắt đầu" + thứ tự field + UI gọn: XÁC NHẬN LẠI đã đúng từ đợt 1 (không có lỗi mới) — chặn
//      client+server, field "Ngày Bắt Đầu" đã nằm TRÊN "Hạn Hoàn Thành", modal form đã max-w-lg (hẹp hơn
//      cả Danh Mục Đầu Tư max-w-4xl). Giữ lại đúng các kịch bản test cũ để làm bằng chứng KHÔNG regressed
//      trong đợt sửa lần 2 này (không sửa gì thêm ở mục 2).
//
//   3) "🔗 Liên kết" — XÁC NHẬN LẠI đã đúng từ đợt 1 (modal đã đăng ký CSP-delegation đầy đủ, nút Lưu Liên
//      Kết hoạt động, chặn Bắt Đầu khi phụ thuộc chưa xong) — không sửa gì thêm ở mục 3.
//
//   4) Hỗ Trợ IT "Chuyển Phê Duyệt" — root cause THẬT: escalateItTicket() (lib/recordActions.js) +
//      điều kiện hiện nút ở client (module-itsupport-price.js) TRƯỚC ĐÂY chỉ cho gửi yêu cầu phê duyệt khi
//      ticket.status === 'DOING' (tức PHẢI "🎯 Nhận Xử Lý" trước) — người dùng cần xin phê duyệt TRƯỚC KHI
//      nhận việc/bắt đầu xử lý, không phải sau. Fix: nới điều kiện (cả client lẫn server) sang cả TODO lẫn
//      DOING; claimItTicket() thêm chặn claim khi đang có 1 yêu cầu phê duyệt PENDING/REJECTED (mirror
//      đúng chặn đã có ở updateItTicketStatus()).
//
// Chạy: node server/tests/test-operation-vhst-refix2.js
const path = require('path');
const fs = require('fs');
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual
} = require('./testHarness');

const PORT = 8996;
const SHOTS_DIR = process.env.VHST_REFIX2_SHOTS_DIR || path.join(require('os').tmpdir(), 'vhst-refix2-shots');
try { fs.mkdirSync(SHOTS_DIR, { recursive: true }); } catch (_) { /* ignore */ }

const CREATOR = {
  username: 'vh_creator_refix2', name: 'Người Tạo Hồ Sơ', dept: 'Vận Hành',
  perms: { operationStoreOpenCreate: true, operationRecordManageAll: true }, active: true
};
const PLAIN = { username: 'plain_refix2', name: 'Nhân Viên Thường', dept: 'Kinh Doanh', perms: {}, active: true };
const IT1 = { username: 'it1_refix2', name: 'Đội Hỗ Trợ IT', dept: 'IT', perms: { itManage: true }, active: true };
const APPROVER1 = { username: 'approver1_refix2', name: 'Trưởng Phòng Duyệt', dept: 'Ban Giám Đốc', perms: {}, active: true };
const state = createMockState({ depts: ['Vận Hành'], users: [CREATOR, PLAIN, IT1, APPROVER1] });

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
          storeName: 'Siêu thị refix2 (test)', address: '123 Test', area: 200,
          approvedBudget: 5000000000, expectedOpenDate: '', personInCharge: '', note: ''
        });
        DB.operationStoreOpenings.push(res.item);
        return res.item.id;
      });
      assert(recordId, 'Phải tạo được hồ sơ');
    });

    // ===================== 1) Danh Mục Đầu Tư — đổi cha DÒNG ĐÃ CÓ SẴN =====================
    await run.run('MỤC 1 (DOM thật): thêm 3 dòng trống trước (KHÔNG đụng dropdown cha) rồi mới gõ Nội Dung -> vẫn 3 danh mục lớn phẳng (đúng thao tác tự nhiên của người dùng)', async () => {
      await page.evaluate((id) => { openOperationEstimateModal('operationStoreOpenings', id); }, recordId);
      await page.waitForTimeout(80);
      await page.click('button[data-op="addOperationEstimateItemRow"]');
      await page.click('button[data-op="addOperationEstimateItemRow"]');
      await page.waitForTimeout(80);
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(1) input[data-field="content"]', 'Nội thất');
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(2) input[data-field="content"]', 'Bàn ghế');
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(2) input[data-field="amount"]', '200000000');
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(3) input[data-field="content"]', 'Đèn trang trí');
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(3) input[data-field="amount"]', '50000000');
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(SHOTS_DIR, '01a-before-3-dong-phang.png'), fullPage: true });
      const parents = await page.evaluate(() => operationEstimateItems.map(it => it.parentId));
      assert(parents.every(p => p === null), `3 dòng đều là danh mục lớn (parentId=null) — đúng hiện trạng SAU khi thêm trống rồi gõ nội dung (thực tế: ${JSON.stringify(parents)})`);
    });

    await run.run('MỤC 1 (DOM thật, bấm THẬT): dùng cột "Cha" MỚI ở dòng "Bàn ghế" để chọn "Nội thất" làm cha -> PHẢI thành danh mục con NGAY (không cần xoá/thêm lại)', async () => {
      const hasParentSelectPerRow = await page.evaluate(() => !!document.querySelector('#operationEstimateItemsTableBody select[data-op-change="changeOperationEstimateItemParent"]'));
      assert(hasParentSelectPerRow, 'Sau fix: mỗi dòng phải có 1 <select> "Cha" riêng');
      // Dòng 2 = "Bàn ghế" — chọn "Nội thất" (dòng 1) làm cha qua ĐÚNG select của dòng đó.
      await page.selectOption('#operationEstimateItemsTableBody tr:nth-child(2) select[data-op-change="changeOperationEstimateItemParent"]', { label: 'Nội thất' });
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(SHOTS_DIR, '01b-after-doi-cha-thanh-cong.png'), fullPage: true });
      const check = await page.evaluate(() => {
        const parent = operationEstimateItems.find(it => it.content === 'Nội thất');
        const child = operationEstimateItems.find(it => it.content === 'Bàn ghế');
        return {
          childParentId: child.parentId, parentId: parent.id,
          rowsText: document.getElementById('operationEstimateItemsTableBody').innerText,
          total: document.getElementById('operationEstimateItemsTotalDisplay').innerText
        };
      });
      assertEqual(check.childParentId, check.parentId, '"Bàn ghế" phải có parentId = id "Nội thất" NGAY sau khi chọn ở cột Cha (không cần thao tác gì thêm)');
      assert(check.rowsText.includes('↳'), 'Phải hiển thị ký hiệu thụt lề "↳" cho dòng con');
      // Tổng = rollup("Nội thất" = 200tr từ "Bàn ghế") + "Đèn trang trí" (50tr, vẫn là danh mục lớn) = 250tr.
      assertEqual(check.total, '250.000.000', 'Tổng Chi Phí = rollup(Nội thất=Bàn ghế 200tr) + Đèn trang trí 50tr = 250.000.000, không double-count');
    });

    await run.run('MỤC 1: danh mục ĐANG có con thì cột "Cha" phải ẨN (không cho biến thành con của cái khác, giữ luật CHỈ 2 CẤP)', async () => {
      const parentRowParentCellText = await page.evaluate(() => {
        // Lưu ý: KHÔNG dùng r.innerText.includes('Nội thất') để tìm dòng — nội dung dòng nằm trong
        // <input value="..."> (không có text node), trong khi <select> "Cha" của dòng KHÁC lại CÓ thể
        // liệt kê "Nội thất" như 1 <option> (Chromium tính cả text option vào innerText của <select>),
        // dễ match NHẦM sang dòng khác. Tìm đúng dòng qua GIÁ TRỊ input Nội Dung thay vì innerText.
        const rows = [...document.querySelectorAll('#operationEstimateItemsTableBody tr')];
        const row = rows.find(r => {
          const contentInput = r.querySelector('input[data-field="content"]');
          return contentInput && contentInput.value === 'Nội thất';
        });
        return row ? row.children[1].innerText.trim() : null;
      });
      assertEqual(parentRowParentCellText, '—', 'Dòng "Nội thất" (đang có con "Bàn ghế") phải hiện "—" ở cột Cha, không cho chọn lại');
      await page.evaluate(async () => { await submitOperationEstimateForApproval(); });
      await page.evaluate(() => { document.getElementById('operationEstimateModal').classList.add('hidden'); });
    });

    // ===================== 2) Ngày bắt đầu > Hạn — XÁC NHẬN LẠI không regressed =====================
    await run.run('MỤC 2 (DOM thật): field "Ngày Bắt Đầu" vẫn nằm TRƯỚC "Hạn Hoàn Thành", modal form vẫn gọn (max-w-lg, hẹp hơn Danh Mục Đầu Tư)', async () => {
      await page.evaluate((id) => { openOperationWorkItemModal('operationStoreOpenings', id, 'EXECUTION'); }, recordId);
      await page.waitForTimeout(80);
      await page.click('button[data-op="openOperationWorkItemFormModal"]');
      await page.waitForTimeout(80);
      await page.screenshot({ path: path.join(SHOTS_DIR, '02a-form-cong-viec-gon.png') });
      const info = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('#operationWorkItemFormModal form label')].map(l => l.textContent.trim());
        const modalBox = document.querySelector('#operationWorkItemFormModal > div');
        return {
          startIdx: labels.findIndex(l => l.includes('Ngày Bắt Đầu')),
          deadlineIdx: labels.findIndex(l => l.includes('Hạn Hoàn Thành')),
          hasMaxWLg: modalBox.className.includes('max-w-lg'),
          widthPx: modalBox.getBoundingClientRect().width
        };
      });
      assert(info.startIdx !== -1 && info.deadlineIdx !== -1 && info.startIdx < info.deadlineIdx, '"Ngày Bắt Đầu" phải đứng trước "Hạn Hoàn Thành"');
      assert(info.hasMaxWLg, 'Form "Thêm/Sửa Công Việc" phải giữ max-w-lg (gọn, hẹp hơn Danh Mục Đầu Tư max-w-4xl)');
    });

    // Đợt sửa lỗi lần 3 (sau file này): syncOwiDateBounds() (module-vanhanh.js) nay set min/max HTML5
    // NGAY khi 1 trong 2 ô đổi giá trị — điền Hạn Hoàn Thành TRƯỚC (như dòng dưới) khiến Ngày Bắt Đầu nhận
    // max=2026-01-01 NGAY LẬP TỨC, nên điền 2026-06-01 sau đó khiến input tự validity.rangeOverflow=true và
    // trình duyệt tự chặn requestSubmit() TRƯỚC KHI 'submit' event (và alert() JS bên trong) kịp chạy —
    // KHÔNG phải regression, đây là lớp chặn MẠNH HƠN (chặn ngay lúc chọn, không đợi bấm Lưu mới báo lỗi)
    // thay thế cho alert()-only trước đây. Xem test-operation-vhst-uibugfix.js (cùng đợt) để xem đầy đủ 3
    // lớp chặn (real-time native + defense-in-depth alert() khi giá trị lọt qua native validation).
    await run.run('MỤC 2 (DOM thật): chọn Ngày Bắt Đầu SAU Hạn Hoàn Thành -> vẫn bị chặn (nay chặn NGAY lúc chọn qua native rangeOverflow, mạnh hơn alert()-only cũ), KHÔNG tạo được', async () => {
      await page.evaluate(() => { window.__resetCapture(); });
      await page.fill('#owiTitle', 'Làm nội thất refix2');
      await page.fill('#owiDeadline', '2026-01-01');
      await page.fill('#owiStartDate', '2026-06-01');
      await page.screenshot({ path: path.join(SHOTS_DIR, '02b-ngay-bat-dau-sau-han-bi-chan.png') });
      const result = await page.evaluate(async () => {
        const rangeOverflow = document.getElementById('owiStartDate').validity.rangeOverflow;
        document.querySelector('#operationWorkItemFormModal form').requestSubmit();
        await new Promise(r => setTimeout(r, 200));
        return { alerts: window.__alerts.slice(), itemCount: DB.operationWorkItems.length, rangeOverflow };
      });
      assert(result.rangeOverflow || result.alerts.some(a => a.includes('Ngày bắt đầu') && a.includes('Hạn hoàn thành')), 'Phải chặn bằng 1 trong 2 lớp: native rangeOverflow (real-time, nay là lớp chính) HOẶC alert() JS (dự phòng)');
      assertEqual(result.itemCount, 0, 'KHÔNG được tạo công việc khi ngày bắt đầu sau hạn');
      // Server-side (không tin riêng client) — gọi thẳng action với ngày sai để xác nhận HttpError 400.
      const serverBlocked = await page.evaluate(async (id) => {
        try {
          await callRecordCreate('operationWorkItems', { sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: null, title: 'Server check', deadline: '2026-01-01', startDate: '2026-06-01' });
          return false;
        } catch (e) { return /Ngày bắt đầu/.test(e.message); }
      }, recordId);
      assert(serverBlocked, 'Server (nguồn sự thật) cũng phải chặn — không tin riêng client');
    });

    let rootWorkItemId = null;
    await run.run('MỤC 2: sửa lại ngày hợp lệ -> tạo được bình thường', async () => {
      await page.fill('#owiStartDate', '2025-12-01');
      await page.evaluate(async () => {
        document.querySelector('#operationWorkItemFormModal form').requestSubmit();
        await new Promise(r => setTimeout(r, 200));
      });
      await page.waitForTimeout(100);
      rootWorkItemId = await page.evaluate(() => {
        const it = DB.operationWorkItems.find(w => w.title === 'Làm nội thất refix2');
        return it ? it.id : null;
      });
      assert(rootWorkItemId, 'Phải tạo được công việc với ngày hợp lệ');
    });

    // ===================== 3) "🔗 Liên kết" — XÁC NHẬN LẠI không regressed =====================
    let otherWorkItemId = null;
    await run.run('MỤC 3 (DOM thật, bấm THẬT): "🔗 Liên kết" vẫn hoạt động — mở modal, chọn phụ thuộc, Lưu Liên Kết thành công', async () => {
      otherWorkItemId = await page.evaluate(async (id) => {
        const r = await callRecordCreate('operationWorkItems', {
          sourceType: 'OPERATION_STORE_OPENING', sourceId: id, parentWorkItemId: null,
          title: 'Lắp điện refix2', deadline: '2026-01-01', startDate: '2025-11-01'
        });
        DB.operationWorkItems.push(r.item);
        return r.item.id;
      }, recordId);
      await page.evaluate(() => { renderOperationWorkItemModalBody(); });
      await page.waitForTimeout(80);
      await page.click(`button[data-op="openOperationWorkItemDependencyModal"][data-id="${rootWorkItemId}"]`);
      await page.waitForTimeout(80);
      await page.screenshot({ path: path.join(SHOTS_DIR, '03a-modal-lien-ket-mo.png') });
      await page.check(`.owi-dependency-cb[value="${otherWorkItemId}"]`);
      await page.click('button[data-op="submitOperationWorkItemDependencies"]');
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS_DIR, '03b-lien-ket-da-luu.png'), fullPage: true });
      const check = await page.evaluate((rid) => {
        const item = DB.operationWorkItems.find(w => w.id === rid);
        return { deps: item.dependsOnWorkItemIds, modalHidden: document.getElementById('operationWorkItemDependencyModal').classList.contains('hidden') };
      }, rootWorkItemId);
      assertEqual(check.deps.length, 1, 'Phải lưu đúng 1 liên kết (nút Lưu KHÔNG "chết")');
      assert(check.modalHidden, 'Modal phải tự đóng sau khi lưu');
      const rowHtml = await page.evaluate(() => document.getElementById('operationWorkItemTableBody').innerHTML);
      assert(rowHtml.includes('Chưa thể bắt đầu'), 'Badge chặn "Chưa thể bắt đầu" phải hiện vì "Lắp điện" chưa nghiệm thu');
      const serverBlocked = await page.evaluate(async (rid) => {
        try { await callRecordAction('operationWorkItems', rid, 'progress', { status: 'DANG_THUC_HIEN', note: '' }); return false; }
        catch (e) { return true; }
      }, rootWorkItemId);
      assert(serverBlocked, 'Server vẫn phải chặn "Bắt đầu" khi phụ thuộc chưa nghiệm thu xong');
      await page.evaluate(() => { document.getElementById('operationWorkItemModal').classList.add('hidden'); });
    });

    // ===================== 4) Hỗ Trợ IT — "Chuyển Phê Duyệt" TRƯỚC khi Nhận Việc =====================
    let ticketId = null;
    await run.run('MỤC 4 setup: nhân viên thường tạo 1 ticket mới (TODO, chưa ai nhận)', async () => {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, PLAIN);
      ticketId = await page.evaluate(async () => {
        switchTab('itSupport'); setItSupportSubTab('TICKET');
        document.getElementById('itTicketCode').value = generateItTicketCode();
        document.getElementById('itTicketTitle').value = 'Máy in hỏng refix2';
        document.getElementById('itTicketCategory').value = 'HARDWARE';
        document.getElementById('itTicketDescription').value = 'Máy in không lên nguồn, cần duyệt ngân sách mua máy mới trước khi xử lý.';
        await submitItTicket({ preventDefault() {}, target: { reset() {} } });
        return DB.itSupportTickets[0].id;
      });
      assert(ticketId, 'Phải tạo được ticket');
    });

    await run.run('MỤC 4 (DOM thật, bấm THẬT): IT mở ticket CHƯA NHẬN VIỆC -> nút "📨 Gửi Yêu Cầu Phê Duyệt" PHẢI đã hiện (trước fix: hoàn toàn không có)', async () => {
      await page.evaluate(async (u) => { await proceedAfterAuth(u); }, IT1);
      await page.evaluate(() => { switchTab('itSupport'); setItSupportSubTab('TICKET'); renderItTickets(); });
      await page.waitForTimeout(80);
      const rowHtml = await page.evaluate(() => document.getElementById('itTicketTableBody').innerHTML);
      assert(rowHtml.includes('value="escalate"'), 'Dropdown "Khác" PHẢI có mục "Gửi Phê Duyệt" ngay cả khi ticket còn TODO (chưa nhận việc)');
      await page.click(`button[data-op="runItTicketAction"][data-arg1="view"]`);
      await page.waitForTimeout(80);
      await page.screenshot({ path: path.join(SHOTS_DIR, '04a-chua-nhan-viec-co-nut-chuyen-phe-duyet.png'), fullPage: true });
      const controlsHtml = await page.evaluate(() => document.getElementById('itTicketModalControls').innerHTML);
      assert(controlsHtml.includes('openItTicketEscalateForm'), 'Modal chi tiết PHẢI có nút "📨 Gửi Yêu Cầu Phê Duyệt" dù ticket còn TODO');
      assert(controlsHtml.includes('claimItTicketAction'), 'Nút "🎯 Nhận Xử Lý" vẫn phải còn (chưa claim)');
    });

    await run.run('MỤC 4 (DOM thật, bấm THẬT): gửi phê duyệt TRƯỚC khi nhận việc -> ticket vẫn TODO nhưng approvalStatus=PENDING, "🎯 Nhận Xử Lý" PHẢI biến mất (chặn nhận việc khi đang chờ duyệt)', async () => {
      await page.click('button[data-op="openItTicketEscalateForm"]');
      await page.waitForTimeout(60);
      await page.selectOption('#itTicketApproverSelect', { value: APPROVER1.username });
      await page.fill('#itTicketApprovalReason', 'Cần duyệt ngân sách mua máy in mới trước khi xử lý');
      await page.click('button[data-op="escalateItTicketAction"]');
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(SHOTS_DIR, '04b-da-gui-phe-duyet-truoc-khi-nhan-viec.png'), fullPage: true });
      const check = await page.evaluate((id) => {
        const t = DB.itSupportTickets.find(x => x.id === id);
        return { status: t.status, approvalStatus: t.approvalStatus, controlsHtml: document.getElementById('itTicketModalControls').innerHTML };
      }, ticketId);
      assertEqual(check.status, 'TODO', 'Ticket vẫn ở TODO (chưa nhận việc) — chỉ gửi yêu cầu phê duyệt, không tự đổi trạng thái xử lý');
      assertEqual(check.approvalStatus, 'PENDING', 'approvalStatus phải chuyển PENDING');
      assert(!check.controlsHtml.includes('claimItTicketAction'), 'Nút "🎯 Nhận Xử Lý" phải ẨN trong lúc đang chờ phê duyệt (chặn claim tới khi duyệt xong)');
      // Server-side: cũng phải chặn claim ngay cả khi có ai đó cố gọi thẳng action.
      const serverBlocked = await page.evaluate(async (id) => {
        try { await callRecordAction('itSupportTickets', id, 'claim', {}); return false; }
        catch (e) { return true; }
      }, ticketId);
      assert(serverBlocked, 'Server (claimItTicket()) phải chặn nhận việc khi đang chờ phê duyệt — không tin riêng UI');
    });

    await run.run('MỤC 4: quản lý DUYỆT -> "🎯 Nhận Xử Lý" hiện lại -> IT nhận việc + xử lý tiếp bình thường (đúng luồng đầy đủ)', async () => {
      await page.evaluate(async (u) => { await proceedAfterAuth(u); }, APPROVER1);
      const approveResult = await page.evaluate(async (id) => {
        openItTicketModal(id);
        await approveItTicketEscalationAction();
        const t = DB.itSupportTickets.find(x => x.id === id);
        return { approvalStatus: t.approvalStatus };
      }, ticketId);
      assertEqual(approveResult.approvalStatus, 'APPROVED', 'Quản lý duyệt xong phải chuyển APPROVED');

      await page.evaluate(async (u) => { await proceedAfterAuth(u); }, IT1);
      await page.evaluate((id) => { openItTicketModal(id); }, ticketId);
      await page.waitForTimeout(60);
      await page.screenshot({ path: path.join(SHOTS_DIR, '04c-da-duyet-nhan-viec-lai-duoc.png'), fullPage: true });
      const controlsAfterApprove = await page.evaluate(() => document.getElementById('itTicketModalControls').innerHTML);
      assert(controlsAfterApprove.includes('claimItTicketAction'), 'Sau khi được duyệt, nút "🎯 Nhận Xử Lý" phải hiện lại');
      await page.click('button[data-op="claimItTicketAction"]');
      await page.waitForTimeout(80);
      const afterClaim = await page.evaluate((id) => DB.itSupportTickets.find(x => x.id === id).status, ticketId);
      assertEqual(afterClaim, 'DOING', 'Nhận việc thành công sau khi được duyệt trước');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
  console.log(`(Ảnh chụp màn hình lưu tại: ${SHOTS_DIR})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
