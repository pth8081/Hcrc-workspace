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

    await run('Bug 1a: wfPositionPairCatalogItems() (nguồn FALLBACK cho picker "Theo vị trí" khi danh mục khối 17 còn rỗng) LUÔN hiện đủ toàn bộ tổ hợp — không tự giới hạn theo danh mục đang có', async () => {
      const count = await page.evaluate(() => {
        DB.jobTitles = ['Nhân viên', 'Trưởng phòng', 'Giám đốc'];
        DB.depts = ['Phòng Nhân Sự', 'Phòng Kế Toán', 'Phòng CNTT'];
        DB.workflowParticipatingPositions = [{ jobTitle: 'Trưởng phòng', dept: 'Phòng CNTT' }];
        return wfPositionPairCatalogItems().length;
      });
      assertEqual(count, 9, 'Ô sửa danh mục phải luôn hiện đủ 9 tổ hợp để admin thêm được vị trí MỚI ngoài danh mục hiện có');
    });

    // ===== Bug thật (rà soát theo yêu cầu người dùng "gán chức danh Giám Đốc Siêu Thị thì mặc định
    // giám đốc ST nào phê duyệt trên luồng của siêu thị đó"): danh mục "Theo vị trí" trước đây CHỈ tích
    // chéo DB.jobTitles × DB.depts, hoàn toàn BỎ QUA DB.storeJobTitles ({label}[], chức danh Siêu Thị,
    // TÁCH RIÊNG khỏi DB.jobTitles) × DB.stores (phòng ban/đơn vị Siêu Thị, TÁCH RIÊNG khỏi DB.depts) —
    // nghĩa là "Giám Đốc Siêu Thị" (chỉ tồn tại trong DB.storeJobTitles) KHÔNG BAO GIỜ ghép được với 1
    // siêu thị cụ thể nào, khiến admin không cấu hình được "Theo vị trí" cho Phê Duyệt Giá/Đồng Phục
    // theo đúng ý (mỗi siêu thị tự động có ĐÚNG giám đốc siêu thị đó duyệt luồng của mình). =====
    await run('Bug MỚI: wfPositionPairCatalogItems() phải ghép ĐỦ chức danh Siêu Thị (DB.storeJobTitles) VỚI phòng ban Siêu Thị (DB.stores) — trước đây hoàn toàn vắng mặt', async () => {
      const result = await page.evaluate(() => {
        DB.jobTitles = ['Nhân viên', 'Trưởng phòng'];
        DB.depts = ['Phòng Nhân Sự', 'Phòng Kế Toán'];
        DB.storeJobTitles = [{ label: 'Giám Đốc Siêu Thị' }, { label: 'Phó Giám Đốc Siêu Thị' }];
        DB.stores = ['Siêu Thị A', 'Siêu Thị B'];
        const items = wfPositionPairCatalogItems();
        return { count: items.length, labels: items.map(i => i.label).sort() };
      });
      // 2 jobTitles × 2 depts (thường) = 4, CỘNG 2 storeJobTitles × 2 stores = 4 -> tổng 8.
      assertEqual(result.count, 8, 'Phải có đủ 4 tổ hợp thường + 4 tổ hợp Siêu Thị (không lai chéo 2 nhóm với nhau)');
      assert(result.labels.includes('Giám Đốc Siêu Thị — Siêu Thị A'), 'Thiếu "Giám Đốc Siêu Thị — Siêu Thị A"');
      assert(result.labels.includes('Giám Đốc Siêu Thị — Siêu Thị B'), 'Thiếu "Giám Đốc Siêu Thị — Siêu Thị B"');
      assert(result.labels.includes('Phó Giám Đốc Siêu Thị — Siêu Thị A'), 'Thiếu "Phó Giám Đốc Siêu Thị — Siêu Thị A"');
      assert(!result.labels.includes('Giám Đốc Siêu Thị — Phòng Nhân Sự'), 'KHÔNG được lai chức danh Siêu Thị với phòng ban thường (vô nghĩa)');
      assert(!result.labels.includes('Trưởng phòng — Siêu Thị A'), 'KHÔNG được lai chức danh thường với Siêu Thị (vô nghĩa)');
    });

    await run('Bug MỚI: sau khi ghép đúng, "Theo vị trí" thật sự chọn đúng giám đốc CỦA ĐÚNG siêu thị (không lẫn sang siêu thị khác)', async () => {
      const result = await page.evaluate(() => {
        const gdA = { username: 'gd_a', name: 'GĐ Siêu Thị A', dept: 'Siêu Thị A', jobTitle: 'Giám Đốc Siêu Thị', active: true, perms: { canBeApprover: true } };
        const gdB = { username: 'gd_b', name: 'GĐ Siêu Thị B', dept: 'Siêu Thị B', jobTitle: 'Giám Đốc Siêu Thị', active: true, perms: { canBeApprover: true } };
        const pairA = [{ jobTitle: 'Giám Đốc Siêu Thị', dept: 'Siêu Thị A' }];
        DB.users = [gdA, gdB];
        return { usernamesForA: resolvePositionApproverUsernamesClient(pairA) };
      });
      assertEqual(JSON.stringify(result.usernamesForA), JSON.stringify(['gd_a']), 'Cấu hình vị trí cho Siêu Thị A chỉ được ra đúng giám đốc Siêu Thị A, không lẫn giám đốc Siêu Thị B');
    });

    // ===== Bug thật (rà soát theo yêu cầu người dùng "mục 17 quyền đặc biệt chọn chức danh tự ghép
    // phòng đã bị sai... chỗ này bạn cho tôi tự chọn ghép chức danh vào phòng ban, nếu tôi chỉ chọn chức
    // danh không ghép phòng cũng được, vì đơn giản như chức danh Tổng giám đốc không cần ghép phòng"):
    // ô "Vị Trí Tham Gia Quy Trình" (khối 17) trước đây CHỈ cho chọn từ 1 danh sách TÍCH CHÉO có sẵn
    // (renderMultiSelectDropdown()) — không tự ghép được cặp mới ngoài tích chéo, và dept LUÔN bắt buộc
    // (không cách nào chỉ chọn riêng 1 chức danh áp dụng cho MỌI phòng ban). Đổi sang widget builder tự
    // dựng: 2 ô gõ-tìm-chọn (Chức Danh bắt buộc + Phòng Ban tuỳ chọn) + nút "➕ Thêm". =====
    await run('Bug MỚI: wfPositionPairLabel() — dept RỖNG thì nhãn CHỈ còn chức danh (không thừa dấu "—")', async () => {
      const result = await page.evaluate(() => ({
        withDept: wfPositionPairLabel({ jobTitle: 'Trưởng phòng', dept: 'Phòng IT' }),
        noDept: wfPositionPairLabel({ jobTitle: 'Tổng Giám Đốc', dept: '' })
      }));
      assertEqual(result.withDept, 'Trưởng phòng — Phòng IT');
      assertEqual(result.noDept, 'Tổng Giám Đốc', 'Không ghép phòng ban -> nhãn chỉ còn tên chức danh, không có "—" thừa');
    });

    await run('Bug MỚI: renderWorkflowParticipatingPositionsWidget() — builder tự dựng thêm/xoá được cặp CÓ ghép phòng ban LẪN cặp CHỈ chức danh (không ghép phòng ban)', async () => {
      const result = await page.evaluate(() => {
        DB.jobTitles = []; DB.depts = []; DB.storeJobTitles = []; DB.stores = [];
        DB.workflowParticipatingPositions = [];
        window.__alerts.length = 0;
        renderWorkflowParticipatingPositionsWidget();

        const jt = document.getElementById('wfPosBuilderJobTitle');
        const dp = document.getElementById('wfPosBuilderDept');
        const chipsText = () => document.querySelector('#workflowParticipatingPositionsMultiSelect [data-wfpos-chips]').textContent;
        const chipCount = () => document.querySelectorAll('#workflowParticipatingPositionsMultiSelect [data-op="removeWfPositionPairFromBuilder"]').length;

        // Thiếu chức danh -> chặn, báo alert, KHÔNG thêm gì (chip vẫn 0 — chỉ hiện text placeholder rỗng).
        jt.value = ''; dp.value = 'Phòng IT';
        addWfPositionPairFromBuilder();
        const blockedNoJobTitle = window.__alerts.length === 1 && chipCount() === 0;

        // 1) Cặp CÓ ghép phòng ban.
        jt.value = 'Trưởng phòng'; dp.value = 'Phòng IT';
        addWfPositionPairFromBuilder();
        const hasWithDept = chipsText().includes('Trưởng phòng — Phòng IT');

        // 2) Chức danh KHÔNG ghép phòng ban (để trống ô Phòng Ban).
        jt.value = 'Tổng Giám Đốc'; dp.value = '';
        addWfPositionPairFromBuilder();
        const hasNoDept = chipsText().includes('Tổng Giám Đốc') && !chipsText().includes('Tổng Giám Đốc —');

        // 3) Thêm trùng đúng cặp đã có -> báo alert cảnh báo, KHÔNG thêm lần 2 (đếm số chip qua nút xoá).
        const chipCountBeforeDup = document.querySelectorAll('#workflowParticipatingPositionsMultiSelect [data-op="removeWfPositionPairFromBuilder"]').length;
        jt.value = 'Tổng Giám Đốc'; dp.value = '';
        addWfPositionPairFromBuilder();
        const chipCountAfterDup = document.querySelectorAll('#workflowParticipatingPositionsMultiSelect [data-op="removeWfPositionPairFromBuilder"]').length;

        // 4) Xoá cặp "Trưởng phòng — Phòng IT" -> còn lại đúng "Tổng Giám Đốc".
        const removeBtn = [...document.querySelectorAll('#workflowParticipatingPositionsMultiSelect [data-op="removeWfPositionPairFromBuilder"]')]
          .find(b => b.getAttribute('data-arg0').startsWith('Trưởng phòng'));
        removeWfPositionPairFromBuilder(removeBtn.getAttribute('data-arg0'));
        const afterRemove = chipsText();

        return {
          blockedNoJobTitle, hasWithDept, hasNoDept,
          alertsAfterDup: window.__alerts.length,
          chipCountBeforeDup, chipCountAfterDup,
          stillHasNoDeptAfterRemove: afterRemove.includes('Tổng Giám Đốc'),
          removedWithDept: !afterRemove.includes('Trưởng phòng — Phòng IT')
        };
      });
      assert(result.blockedNoJobTitle, 'Thiếu Chức Danh phải bị chặn (alert), không thêm được cặp rỗng');
      assert(result.hasWithDept, 'Phải thêm được cặp CÓ ghép phòng ban');
      assert(result.hasNoDept, 'Phải thêm được chức danh KHÔNG ghép phòng ban (nhãn không có "—")');
      assertEqual(result.chipCountBeforeDup, result.chipCountAfterDup, 'Thêm trùng cặp đã có KHÔNG được tạo thêm chip mới');
      assertEqual(result.alertsAfterDup, 2, '1 alert do thiếu Chức Danh + 1 alert cảnh báo trùng');
      assert(result.stillHasNoDeptAfterRemove, 'Xoá riêng cặp có dept KHÔNG được ảnh hưởng cặp không-dept còn lại');
      assert(result.removedWithDept, 'Cặp vừa xoá phải biến mất khỏi danh sách chip');
    });

    await run('Bug MỚI: saveWorkflowParticipatingPositions() lưu đúng danh mục từ builder (kể cả cặp dept rỗng), và resolvePositionApproverUsernamesClient()/matchesPositionPair() khớp ĐÚNG cặp dept rỗng theo CHỈ chức danh', async () => {
      const result = await page.evaluate(async () => {
        DB.jobTitles = []; DB.depts = []; DB.storeJobTitles = []; DB.stores = [];
        DB.workflowParticipatingPositions = [];
        renderWorkflowParticipatingPositionsWidget();
        document.getElementById('wfPosBuilderJobTitle').value = 'Tổng Giám Đốc';
        document.getElementById('wfPosBuilderDept').value = '';
        addWfPositionPairFromBuilder();
        await saveWorkflowParticipatingPositions();

        const tgd1 = { username: 'tgd1', dept: 'Ban Giám Đốc', jobTitle: 'Tổng Giám Đốc', active: true, perms: { canBeApprover: true } };
        const tgd2 = { username: 'tgd2', dept: 'Chi Nhánh Khác', jobTitle: 'Tổng Giám Đốc', active: true, perms: { canBeApprover: true } };
        const nv1 = { username: 'nv1', dept: 'Ban Giám Đốc', jobTitle: 'Nhân viên', active: true, perms: { canBeApprover: true } };
        DB.users = [tgd1, tgd2, nv1];
        const usernames = resolvePositionApproverUsernamesClient(DB.workflowParticipatingPositions);
        return { saved: DB.workflowParticipatingPositions, usernames: usernames.sort() };
      });
      assertEqual(result.saved.length, 1);
      assertEqual(result.saved[0].jobTitle, 'Tổng Giám Đốc');
      assertEqual(result.saved[0].dept, '', 'Lưu đúng dept rỗng (không ghép phòng ban)');
      assertEqual(JSON.stringify(result.usernames), JSON.stringify(['tgd1', 'tgd2']), 'Khớp CẢ 2 Tổng Giám Đốc dù khác phòng ban (dept rỗng = áp dụng mọi phòng ban), bỏ qua nv1 vì sai chức danh');
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

    // ===== Bug thật (rà soát theo báo cáo người dùng "lỗi tương tự chỉ nên ghi Lỗi kết nối đến máy chủ
    // hoặc Hết phiên làm việc" — ảnh chụp màn hình "Không thể kết nối tới máy chủ dữ liệu (MSSQL API)...
    // Chi tiết lỗi: HTTP 401"): initDatabase() (core.js, tải /api/data lúc đăng nhập/làm mới dữ liệu)
    // trước đây gộp CHUNG 401 (phiên không hợp lệ) với lỗi kết nối/máy chủ thật — luôn hiện 1 thông báo
    // sai bản chất, không đưa về màn đăng nhập như mọi điểm gọi API khác trong hệ thống. =====
    await run('Bug MỚI: initDatabase() lỗi 401 -> gọi handleSessionExpired() TRƯỚC khi throw lỗi chung (KHÔNG còn rơi vào nhánh catch cũ hiện "MSSQL API"/"HTTP 401")', async () => {
      // Stub handleSessionExpired() thay vì đi qua logout()/alert() thật — cô lập đúng 1 điều cần xác
      // nhận (initDatabase() có rẽ nhánh 401 riêng hay không), không phụ thuộc trạng thái nền (session
      // keep-alive/approval polling interval) có thể đang chạy sẵn từ các test trước trong cùng 1 trang.
      const result = await page.evaluate(async () => {
        const originalFetch = window.fetch;
        const originalHandleSessionExpired = window.handleSessionExpired;
        let handleSessionExpiredCalled = false;
        window.handleSessionExpired = () => { handleSessionExpiredCalled = true; };
        window.__alerts.length = 0;
        window.fetch = async (url) => {
          if (String(url).includes('/api/data')) return { status: 401, ok: false };
          return originalFetch(url);
        };
        try {
          await initDatabase({ username: 'x' });
        } finally {
          window.fetch = originalFetch;
          window.handleSessionExpired = originalHandleSessionExpired;
        }
        return { handleSessionExpiredCalled, alerts: [...window.__alerts] };
      });
      assert(result.handleSessionExpiredCalled, 'initDatabase() lỗi 401 phải gọi handleSessionExpired()');
      assertEqual(result.alerts.length, 0, 'KHÔNG được rơi thêm vào nhánh catch chung (handleSessionExpired() đã bị stub im lặng, alert cũ "MSSQL API"/"HTTP 401" không còn xuất hiện)');
    });

    await run('Bug MỚI: proceedAfterAuth() KHÔNG tiếp tục chạy finishLogin()/dataReady=true nếu phiên hết hạn giữa lúc initDatabase() đang tải (currentUser bị đặt null bởi handleSessionExpired()/logout())', async () => {
      const result = await page.evaluate(async () => {
        const someUser = { username: 'u1', name: 'Người Dùng Test', dept: 'Phòng IT', phone: '', email: '', perms: {}, active: true };
        const originalInitDatabase = window.initDatabase;
        const originalFinishLogin = window.finishLogin;
        const currentUserBeforeTest = currentUser; // khôi phục lại sau — currentUser là biến toàn cục
        // dùng chung suốt cả trang/các test còn lại trong file này, KHÔNG được để null vĩnh viễn.
        let finishLoginCalled = false;
        // Mô phỏng ĐÚNG hiệu ứng thật của initDatabase() khi gặp 401 giữa chừng: handleSessionExpired()
        // -> logout() đặt currentUser=null — không cần fetch/logout() thật, chỉ cần đúng hệ quả cuối.
        window.initDatabase = async () => { currentUser = null; };
        window.finishLogin = (...args) => { finishLoginCalled = true; return originalFinishLogin.apply(null, args); };
        let currentUserRightAfter;
        try {
          await proceedAfterAuth(someUser);
          currentUserRightAfter = currentUser;
        } finally {
          window.initDatabase = originalInitDatabase;
          window.finishLogin = originalFinishLogin;
          currentUser = currentUserBeforeTest;
        }
        return { finishLoginCalled, currentUserAfter: currentUserRightAfter };
      });
      assert(!result.finishLoginCalled, 'finishLogin() KHÔNG được gọi khi phiên đã hết hạn (currentUser=null) ngay sau initDatabase() — nếu không sẽ lộ lại giao diện chính với dữ liệu rỗng đè lên màn đăng nhập vừa hiện ra do logout()');
      assertEqual(result.currentUserAfter, null, 'currentUser phải giữ nguyên null, không bị finishLogin() ghi đè lại');
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

      // Người dùng thực tế báo riêng tab "QT Thanh Toán" (PAYMENT) không bấm được/không đổi panel —
      // id nút này ("btnWfModPAYMENT") tình cờ VẪN khớp cách dựng chuỗi CŨ (mod không có dấu "_" nên
      // .replace('_','') là no-op, và PAYMENT vốn đã viết hoa toàn bộ) nên KHÔNG bị lộ bởi lỗi case-
      // mismatch chung ở trên — cần tự kiểm riêng để chắc chắn không có lỗi nào khác (VD renderWorkflowTab()
      // ném lỗi riêng cho đúng module PAYMENT) khiến việc chuyển tab bị nuốt lặng lẽ.
      const paymentSwitch = await page.evaluate(() => {
        DB.paymentDeptWorkflows = DB.paymentDeptWorkflows || {};
        switchWfModule('PAYMENT');
        return {
          payment: document.getElementById('btnWfModPAYMENT').className,
          officeBuy: document.getElementById('btnWfModOfficeBuy').className,
          activeMod: activeWfMod,
          title: document.getElementById('wfConfigTitle')?.innerText,
        };
      });
      assertEqual(paymentSwitch.activeMod, 'PAYMENT', 'Bấm "QT Thanh Toán" phải thực sự chuyển activeWfMod sang PAYMENT (không bị nuốt lặng lẽ)');
      assert(paymentSwitch.payment.includes('bg-blue-600'), 'Nút "QT Thanh Toán" phải đổi màu active khi được chọn');
      assert(!paymentSwitch.officeBuy.includes('bg-blue-600'), 'Nút OFFICE_BUY cũ phải mất màu active khi đã chuyển sang PAYMENT');
      assert(/Thanh Toán/.test(paymentSwitch.title || ''), 'Tiêu đề panel phải đổi đúng sang cấu hình Thanh Toán (panel THẬT SỰ đã chuyển, không phải chỉ đổi màu nút)');
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
