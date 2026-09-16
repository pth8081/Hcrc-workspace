// server/tests/test-operation-workitem-quickview.js
//
// Tính năng MỚI (9/2026, theo yêu cầu người dùng kèm ảnh chụp màn hình): ở tab "Báo Cáo" của Vận Hành >
// 🏬 Siêu Thị, bấm vào SỐ LIỆU (Tổng CV/Đã Nghiệm Thu/Đang Thực Hiện/Chưa Bắt Đầu) ở bảng rollup cấp hồ
// sơ (renderOperationStoreReport(), module-vanhanh.js) trước đây chỉ là TEXT tĩnh — giờ mở modal
// "👁️ Xem Nhanh" (#operationWorkItemQuickViewModal) liệt kê ĐÚNG các công việc thuộc đúng nhóm vừa bấm,
// kèm trạng thái + người thực hiện + hạn, không cần mở "Xem/Lập Danh Mục Đầu Tư" đầy đủ.
//
// Cùng khuôn Playwright thật (DOM thật + click chuột thật, KHÔNG chỉ gọi thẳng hàm JS) của
// test-operation-vhst-uibugfix.js — bài học từ chính module này: 'operationWorkItemQuickViewModal' là 1
// <div> ĐỘC LẬP cấp cao (nằm NGOÀI #vanHanhSection), PHẢI được thêm vào forEach(bindOperationDelegation)
// (module-vanhanh.js) thì thao tác BÊN TRONG modal (nút "✕") mới phản hồi — bài test này xác nhận CẢ
// việc bấm số liệu MỞ ĐƯỢC modal LẪN nút "✕" ĐÓNG ĐƯỢC modal (cùng lớp lỗi CSP-delegation đã gặp ở
// VHST-5, không lặp lại nếu quên đăng ký).
//
// Chạy: node server/tests/test-operation-workitem-quickview.js
const path = require('path');
const os = require('os');
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual, assertIncludes
} = require('./testHarness');

const PORT = 8995;
const SHOTS_DIR = path.join(os.tmpdir(), 'operation-workitem-quickview-shots');
try { require('fs').mkdirSync(SHOTS_DIR, { recursive: true }); } catch (_) { /* ignore */ }

const VIEWER = { username: 'qv_viewer', name: 'Người Xem Báo Cáo', dept: 'Vận Hành', perms: { operationRecordManageAll: true }, active: true };
const RECORD_OPEN = { id: 9101, code: 'MMST-9101', storeName: 'Siêu Thị Xem Nhanh Test', dept: 'Vận Hành', creator: 'qv_viewer', estimateStatus: 'APPROVED' };

// 4 công việc trải đủ 3 nhóm (Đã Nghiệm Thu/Đang Thực Hiện — gồm cả DANG_THUC_HIEN lẫn DANG_NGHIEM_THU/
// Chưa Bắt Đầu) + Tổng = 4, đúng khuôn buildOperationStoreReportComputed() tính r.total/done/doing/notStarted.
const WORK_ITEMS = [
  { id: 8101, title: 'Lắp kệ hàng', sourceType: 'OPERATION_STORE_OPENING', sourceId: 9101, parentWorkItemId: null,
    status: 'DA_NGHIEM_THU', deadline: '2026-01-10', startDate: '2025-12-01',
    assignedTo: ['qv_viewer'], assignedToName: ['Người Xem Báo Cáo'], acceptorUsername: 'qv_viewer', acceptorName: 'Người Xem Báo Cáo', history: [] },
  { id: 8102, title: 'Sơn tường', sourceType: 'OPERATION_STORE_OPENING', sourceId: 9101, parentWorkItemId: null,
    status: 'DANG_THUC_HIEN', deadline: '2026-02-15', startDate: '2026-01-20',
    assignedTo: ['qv_viewer'], assignedToName: ['Người Xem Báo Cáo'], acceptorUsername: null, acceptorName: null, history: [] },
  { id: 8103, title: 'Lắp điện chiếu sáng', sourceType: 'OPERATION_STORE_OPENING', sourceId: 9101, parentWorkItemId: null,
    status: 'DANG_NGHIEM_THU', deadline: '2026-02-20', startDate: '2026-01-25',
    assignedTo: ['qv_viewer'], assignedToName: ['Người Xem Báo Cáo'], acceptorUsername: 'qv_viewer', acceptorName: 'Người Xem Báo Cáo', history: [] },
  { id: 8104, title: 'Trang trí sảnh', sourceType: 'OPERATION_STORE_OPENING', sourceId: 9101, parentWorkItemId: null,
    status: 'CHUA_BAT_DAU', deadline: '2026-03-01', startDate: '',
    assignedTo: [], assignedToName: [], acceptorUsername: null, acceptorName: null, history: [] }
];

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function main() {
  const state = createMockState({
    depts: ['Vận Hành'], users: [VIEWER],
    operationStoreOpenings: [RECORD_OPEN], operationWorkItems: WORK_ITEMS
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await loginAs(page, VIEWER);
    // Điều hướng ĐÚNG như người dùng thật (switchTab -> sub-tab "🏬 Siêu Thị" -> sub-tab con "📊 Báo Cáo")
    // — KHÔNG chỉ gọi thẳng renderOperationStoreReport() (chỉ đổ dữ liệu vào bảng, không tự mở các lớp
    // "vỏ" #vanHanhSection/#vanHanhStoreWrap/#opStoreReportPanel đang "hidden" theo mặc định), nếu không
    // Playwright click() thật sẽ báo "element is not visible" dù phần tử vẫn tồn tại trong DOM.
    await page.evaluate(async () => {
      await switchTab('vanHanh');
      setVanHanhSubTab('STORE');
      setOperationStoreSubTab('REPORT');
      renderOperationStoreReport();
    });
    await page.waitForTimeout(150);

    await run.run('Bảng Báo Cáo hiện đúng 4 số liệu Tổng CV/Đã Nghiệm Thu/Đang Thực Hiện/Chưa Bắt Đầu, dạng NÚT BẤM ĐƯỢC (không còn chỉ là chữ tĩnh)', async () => {
      const counts = await page.evaluate(() => {
        const row = document.querySelector('#operationStoreReportTableBody tr');
        const buttons = row.querySelectorAll('button[data-op="openOperationWorkItemQuickViewModal"]');
        return Array.from(buttons).map(b => ({ filter: b.dataset.filter, text: b.textContent.trim() }));
      });
      assertEqual(counts.length, 4, 'Phải có đúng 4 nút bấm số liệu trên 1 dòng hồ sơ');
      assertEqual(counts.find(c => c.filter === 'ALL').text, '4', 'Tổng CV phải = 4');
      assertEqual(counts.find(c => c.filter === 'DA_NGHIEM_THU').text, '1', 'Đã Nghiệm Thu phải = 1');
      assertEqual(counts.find(c => c.filter === 'DOING').text, '2', 'Đang Thực Hiện phải = 2 (gộp DANG_THUC_HIEN + DANG_NGHIEM_THU)');
      assertEqual(counts.find(c => c.filter === 'CHUA_BAT_DAU').text, '1', 'Chưa Bắt Đầu phải = 1');
      await page.screenshot({ path: path.join(SHOTS_DIR, '1-report-table-clickable-numbers.png'), fullPage: true });
    });

    await run.run('Bấm THẬT vào "Tổng CV" -> modal Xem Nhanh mở ra, liệt kê ĐỦ 4 công việc kèm trạng thái + người thực hiện', async () => {
      await page.click('button[data-op="openOperationWorkItemQuickViewModal"][data-filter="ALL"]');
      await page.waitForTimeout(120);
      const modalOpened = await page.evaluate(() => !document.getElementById('operationWorkItemQuickViewModal').classList.contains('hidden'));
      assert(modalOpened, 'Modal Xem Nhanh phải mở ra khi bấm "Tổng CV"');
      const title = await page.evaluate(() => document.getElementById('operationWorkItemQuickViewModalTitle').textContent);
      assertIncludes(title, 'Tất cả công việc', 'Tiêu đề modal phải nêu đúng nhóm đang xem');
      assertIncludes(title, 'Siêu Thị Xem Nhanh Test', 'Tiêu đề modal phải nêu đúng tên hồ sơ');
      assertIncludes(title, 'MMST-9101', 'Tiêu đề modal phải nêu đúng mã hồ sơ');
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#operationWorkItemQuickViewModalBody tr')).map(tr => tr.innerText));
      assertEqual(rows.length, 4, 'Phải liệt kê đủ 4 công việc');
      assert(rows.some(r => r.includes('Lắp kệ hàng') && r.includes('Người Xem Báo Cáo')), 'Phải thấy đúng tên công việc + người thực hiện');
      await page.screenshot({ path: path.join(SHOTS_DIR, '2-quickview-modal-all.png') });

      await page.click('button[data-op="closeOperationWorkItemQuickViewModal"]');
      await page.waitForTimeout(100);
      const modalClosed = await page.evaluate(() => document.getElementById('operationWorkItemQuickViewModal').classList.contains('hidden'));
      assert(modalClosed, 'Nút "✕" phải đóng được modal (nếu KHÔNG đóng: bug CSP-delegation tái phát — modal chưa đăng ký bindOperationDelegation)');
    });

    await run.run('Bấm "Đã Nghiệm Thu" -> CHỈ liệt kê đúng 1 công việc thuộc nhóm đó', async () => {
      await page.click('button[data-op="openOperationWorkItemQuickViewModal"][data-filter="DA_NGHIEM_THU"]');
      await page.waitForTimeout(120);
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#operationWorkItemQuickViewModalBody tr')).map(tr => tr.innerText));
      assertEqual(rows.length, 1, 'Chỉ được liệt kê đúng 1 công việc (Đã Nghiệm Thu)');
      assertIncludes(rows[0], 'Lắp kệ hàng', 'Phải đúng công việc "Lắp kệ hàng"');
      assertIncludes(rows[0], 'Đã nghiệm thu', 'Badge trạng thái phải đúng "Đã nghiệm thu"');
      await page.screenshot({ path: path.join(SHOTS_DIR, '3-quickview-modal-accepted-only.png') });
      await page.click('button[data-op="closeOperationWorkItemQuickViewModal"]');
      await page.waitForTimeout(80);
    });

    await run.run('Bấm "Đang Thực Hiện" -> liệt kê đúng 2 công việc (gộp DANG_THUC_HIEN + DANG_NGHIEM_THU)', async () => {
      await page.click('button[data-op="openOperationWorkItemQuickViewModal"][data-filter="DOING"]');
      await page.waitForTimeout(120);
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#operationWorkItemQuickViewModalBody tr')).map(tr => tr.innerText));
      assertEqual(rows.length, 2, 'Phải liệt kê đúng 2 công việc');
      assert(rows.some(r => r.includes('Sơn tường')), 'Phải có "Sơn tường" (DANG_THUC_HIEN)');
      assert(rows.some(r => r.includes('Lắp điện chiếu sáng')), 'Phải có "Lắp điện chiếu sáng" (DANG_NGHIEM_THU)');
      await page.click('button[data-op="closeOperationWorkItemQuickViewModal"]');
      await page.waitForTimeout(80);
    });

    await run.run('Bấm "Chưa Bắt Đầu" -> liệt kê đúng 1 công việc, người thực hiện hiện "(chưa gán)" nếu chưa gán ai', async () => {
      await page.click('button[data-op="openOperationWorkItemQuickViewModal"][data-filter="CHUA_BAT_DAU"]');
      await page.waitForTimeout(120);
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#operationWorkItemQuickViewModalBody tr')).map(tr => tr.innerText));
      assertEqual(rows.length, 1, 'Phải liệt kê đúng 1 công việc');
      assertIncludes(rows[0], 'Trang trí sảnh', 'Phải đúng công việc "Trang trí sảnh"');
      assertIncludes(rows[0], '(chưa gán)', 'Công việc chưa gán người thực hiện phải hiện rõ "(chưa gán)" thay vì để trống mơ hồ');
      await page.screenshot({ path: path.join(SHOTS_DIR, '4-quickview-modal-notstarted-unassigned.png') });
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
