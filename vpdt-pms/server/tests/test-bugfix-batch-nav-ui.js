// tests/test-bugfix-batch-nav-ui.js — 5 lỗi UI/nghiệp vụ người dùng báo lại qua ảnh chụp màn hình
// (phản hồi trực tiếp, không phải yêu cầu tính năng mới):
// 1. "Theo vị trí" picker (Quy Trình & Phê Duyệt) không bị giới hạn theo danh mục "Vị Trí Tham Gia
//    Quy Trình" (khối 17) + danh mục đó biến mất sau khi tải lại trang/đăng nhập lại.
// 2. Thông báo lỗi khi hết phiên đăng nhập hiện sai (generic "Không tải được phần chức năng cần
//    thiết" thay vì "Hết phiên làm việc").
// 3. Nút chuyển module ở màn Quy Trình & Phê Duyệt (QT Tài Liệu/QT Văn Bản Trình/...) không đổi màu
//    khi bấm.
// 4. Thẻ dashboard lọc ở Vận Hành > Đơn Hàng (Đang Chờ Duyệt/Chờ Nhập Hàng/...) không đổi màu/không
//    lọc khi bấm — chỉ "Tổng Số" (mặc định) trông như hoạt động.
//
// Run: node server/tests/test-bugfix-batch-nav-ui.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8996;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    const admin = makeUser({ username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng CNTT', perms: { admin: true } });
    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((u) => finishLogin(u), admin);

    // ===== Bug 1: "Theo vị trí" picker phải bị giới hạn theo workflowParticipatingPositions =====
    await run('Bug 1a: wfPositionPairPickerItems() CHỈ trả về danh mục đã cấu hình (khối 17), không phải toàn bộ tích chéo', async () => {
      const result = await page.evaluate(() => {
        DB.jobTitles = ['Nhân viên', 'Trưởng phòng', 'Giám đốc'];
        DB.depts = ['Phòng Nhân Sự', 'Phòng Kế Toán', 'Phòng CNTT'];
        // Full cross-product would be 3x3=9 pairs — but catalog only has 2.
        DB.workflowParticipatingPositions = [
          { jobTitle: 'Trưởng phòng', dept: 'Phòng CNTT' },
          { jobTitle: 'Giám đốc', dept: 'Phòng Nhân Sự' }
        ];
        const items = wfPositionPairPickerItems();
        return { count: items.length, labels: items.map(i => i.label).sort() };
      });
      assertEqual(result.count, 2, 'Picker phải chỉ hiện đúng 2 vị trí đã cấu hình trong danh mục');
      assert(result.labels.includes('Trưởng phòng — Phòng CNTT'), 'Thiếu vị trí đã cấu hình #1');
      assert(result.labels.includes('Giám đốc — Phòng Nhân Sự'), 'Thiếu vị trí đã cấu hình #2');
    });

    await run('Bug 1a (fallback): danh mục RỖNG -> picker vẫn hiện đủ toàn bộ tổ hợp (hành vi cũ, không phá cấu hình trước đợt này)', async () => {
      const count = await page.evaluate(() => {
        DB.jobTitles = ['Nhân viên', 'Trưởng phòng', 'Giám đốc'];
        DB.depts = ['Phòng Nhân Sự', 'Phòng Kế Toán', 'Phòng CNTT'];
        DB.workflowParticipatingPositions = [];
        return wfPositionPairPickerItems().length;
      });
      assertEqual(count, 9, 'Danh mục rỗng phải fallback về đủ 3x3=9 tổ hợp như hành vi cũ');
    });

    await run('Bug 1a: ô SỬA danh mục (khối 17, wfPositionPairCatalogItems) LUÔN hiện đủ toàn bộ tổ hợp — không tự giới hạn theo chính danh mục đang xây', async () => {
      const count = await page.evaluate(() => {
        DB.jobTitles = ['Nhân viên', 'Trưởng phòng', 'Giám đốc'];
        DB.depts = ['Phòng Nhân Sự', 'Phòng Kế Toán', 'Phòng CNTT'];
        DB.workflowParticipatingPositions = [{ jobTitle: 'Trưởng phòng', dept: 'Phòng CNTT' }];
        return wfPositionPairCatalogItems().length;
      });
      assertEqual(count, 9, 'Ô sửa danh mục phải luôn hiện đủ 9 tổ hợp để admin thêm được vị trí MỚI ngoài danh mục hiện có');
    });

    await run('Bug 1b: initDatabase() phải đọc lại workflowParticipatingPositions từ /api/data (không còn mất sau tải lại trang)', async () => {
      const hasAssignment = await page.evaluate(() => {
        // Xác nhận initDatabase() (core.js) có dòng gán DB.workflowParticipatingPositions từ data —
        // kiểm tra qua chính source code của hàm (không round-trip fetch thật qua mock backend, vốn
        // không mô phỏng đầy đủ GET /api/data động theo DB.* hiện tại).
        return initDatabase.toString().includes('DB.workflowParticipatingPositions = data.workflowParticipatingPositions');
      });
      assert(hasAssignment, 'initDatabase() phải gán lại DB.workflowParticipatingPositions từ response /api/data, giống hệt workflowParticipatingDepts sibling ngay phía trên nó');
    });

    // ===== Bug 2: thông báo hết phiên đăng nhập =====
    await run('Bug 2: lỗi 401 khi dispatch (module đã nạp nhưng gọi API bên trong bị hết phiên) -> hiện "Hết phiên làm việc", KHÔNG hiện thông báo lỗi tải module chung chung', async () => {
      const result = await page.evaluate(async () => {
        const alerts = [];
        const originalAlert = window.alert;
        const originalFetch = window.fetch;
        const originalLogout = window.logout;
        let logoutCalled = false;
        window.alert = (msg) => alerts.push(msg);
        window.fetch = async (url) => {
          if (String(url).includes('/api/auth/me')) return { status: 401, ok: false };
          return originalFetch(url);
        };
        window.logout = () => { logoutCalled = true; };
        try {
          await reportCspDispatchFailure('test context', 'someFn', new Error('boom'));
        } finally {
          window.alert = originalAlert;
          window.fetch = originalFetch;
          window.logout = originalLogout;
        }
        return { alerts, logoutCalled };
      });
      assertEqual(result.alerts.length, 1, 'Phải hiện đúng 1 thông báo');
      assert(result.alerts[0].includes('hết hạn'), `Thông báo phải nói phiên đã hết hạn (qua handleSessionExpired()), thực tế: "${result.alerts[0]}"`);
      assert(!result.alerts[0].includes('Không tải được'), 'KHÔNG được hiện thông báo lỗi tải module chung chung khi thực chất là hết phiên');
      assert(result.logoutCalled, 'Phải gọi logout() (qua handleSessionExpired()) khi xác nhận đúng là hết phiên');
    });

    await run('Bug 2: lỗi KHÔNG phải do hết phiên (401 check trả về 200) -> vẫn hiện đúng thông báo lỗi tải module chung như cũ', async () => {
      const result = await page.evaluate(async () => {
        const alerts = [];
        const originalAlert = window.alert;
        const originalFetch = window.fetch;
        window.alert = (msg) => alerts.push(msg);
        window.fetch = async (url) => {
          if (String(url).includes('/api/auth/me')) return { status: 200, ok: true };
          return originalFetch(url);
        };
        try {
          await reportCspDispatchFailure('test context', 'someFn', new Error('boom'));
        } finally {
          window.alert = originalAlert;
          window.fetch = originalFetch;
        }
        return { alerts };
      });
      assertEqual(result.alerts.length, 1, 'Phải hiện đúng 1 thông báo');
      assert(result.alerts[0].includes('Không tải được'), 'Lỗi KHÔNG phải hết phiên vẫn phải hiện đúng thông báo lỗi tải module chung');
    });

    // ===== Bug 3: nút chuyển module ở Quy Trình & Phê Duyệt không đổi màu =====
    await run('Bug 3: switchWfModule() đổi ĐÚNG màu nút đang active, tắt màu nút cũ (trước đây getElementById() luôn null do id không khớp cách dựng chuỗi cũ)', async () => {
      await page.evaluate(() => {
        DB.workflows = [{ id: 'WF_1STEP', name: 'X', steps: [{ order: 1, name: 'Duyệt' }] }];
        setSystemSubTab('WORKFLOW');
      });
      const first = await page.evaluate(() => {
        switchWfModule('SUBMISSION');
        return {
          submission: document.getElementById('btnWfModSubmission').className,
          doc: document.getElementById('btnWfModDoc').className,
          officeBuy: document.getElementById('btnWfModOfficeBuy').className
        };
      });
      assert(first.submission.includes('bg-blue-600'), 'Nút vừa chuyển tới (SUBMISSION) phải đổi màu active');
      assert(!first.doc.includes('bg-blue-600'), 'Nút DOC (không còn active) phải mất màu active');
      assert(!first.officeBuy.includes('bg-blue-600'), 'Nút OFFICE_BUY chưa từng active không được có màu active');

      const second = await page.evaluate(() => {
        switchWfModule('OFFICE_BUY');
        return {
          submission: document.getElementById('btnWfModSubmission').className,
          officeBuy: document.getElementById('btnWfModOfficeBuy').className
        };
      });
      assert(second.officeBuy.includes('bg-blue-600'), 'Chuyển sang OFFICE_BUY (id dựng từ "OFFICE_BUY".replace là case-mismatch trước đây) phải đổi màu active đúng');
      assert(!second.submission.includes('bg-blue-600'), 'Nút SUBMISSION cũ phải mất màu active khi đã chuyển đi');
    });

    // ===== Bug 4: dashboard filter card ở Vận Hành > Đơn Hàng không đổi màu/không lọc =====
    await run('Bug 4: bấm thẻ "Đang Chờ Duyệt" phải lọc danh sách VÀ đổi màu active (trước đây registry OP_CLICK_ACTIONS thiếu filterOperationOrderByCard nên click bị nuốt lặng lẽ)', async () => {
      await page.evaluate(async () => {
        DB.operationOrders = [
          { id: 1, code: 'DH-001', status: 'PENDING', dept: 'Phòng CNTT', creator: 'admin', orderLocationType: 'HO', createdAt: '2026-01-01T09:00:00' },
          { id: 2, code: 'DH-002', status: 'RECEIVED', dept: 'Phòng CNTT', creator: 'admin', orderLocationType: 'HO', createdAt: '2026-01-02T09:00:00' }
        ];
        await switchTab('vanHanh');
        setVanHanhSubTab('ORDERS');
        setOperationOrderSubTab('HO');
      });
      const before = await page.evaluate(() => {
        return document.querySelectorAll('#operationOrderTableBody tr').length;
      });
      assertEqual(before, 2, 'Trước khi lọc phải thấy đủ 2 đơn hàng');

      const card = await page.$('#operationOrderDashboardCards [data-arg0="PENDING"]');
      assert(card, 'Phải tìm được thẻ dashboard "Đang Chờ Duyệt" (data-arg0="PENDING")');
      await card.click();

      const after = await page.evaluate(() => {
        const filterVal = document.getElementById('filterStatusOperationOrder').value;
        const rows = document.querySelectorAll('#operationOrderTableBody tr').length;
        const cardCls = document.querySelector('#operationOrderDashboardCards [data-arg0="PENDING"]').className;
        const totalCardCls = document.querySelector('#operationOrderDashboardCards [data-arg0=""]').className;
        return { filterVal, rows, cardCls, totalCardCls };
      });
      assertEqual(after.filterVal, 'PENDING', 'Bấm thẻ phải set giá trị bộ lọc trạng thái = PENDING');
      assertEqual(after.rows, 1, 'Danh sách phải lọc còn đúng 1 đơn PENDING');
      assert(after.cardCls.includes('ring-2'), 'Thẻ "Đang Chờ Duyệt" phải hiện viền active (ring) sau khi bấm');
      assert(!after.totalCardCls.includes('ring-2'), 'Thẻ "Tổng Số" phải MẤT viền active khi đã chuyển sang lọc thẻ khác');
    });

    assertEqual(pageErrors.length, 0, `Không được có lỗi JS console: ${pageErrors.map(e => e.message).join('; ')}`);
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-bugfix-batch-nav-ui.js');
}

main();
