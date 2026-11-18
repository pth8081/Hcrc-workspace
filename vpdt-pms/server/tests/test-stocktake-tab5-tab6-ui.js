// tests/test-stocktake-tab5-tab6-ui.js — test Playwright THẬT (click/select thật, không gọi hàm nội bộ)
// cho Tab 5 "🗄️ Cấu Hình Quầy Kệ" (danh mục quầy kệ RIÊNG của Kiểm Kê, ĐỔI 12/2026 — xem
// test-stocktake-kiemke-shelf-config-crud.js cho CRUD/Import/Export riêng) + Tab 6 "✅ Xác Nhận" (xác
// nhận từng quầy kệ khoá Kiểm Đếm không khoá Kiểm Soát + Xác Nhận Toàn Bộ Đợt đóng kỳ).
// Chạy: node tests/test-stocktake-tab5-tab6-ui.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8999;
  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const SHELF_A2 = { id: 11, dept: DEPT1, code: 'A2', name: 'Kệ A2 — Mì, cháo', active: true };
  // Nhãn hiển thị trong ô tìm-kiếm-gõ-chọn (sdd*) — ĐÚNG khuôn kkShelfOptionLabel() ở module-vanhanh.js:
  // `${kiemKeLocked ? '🔒 ' : ''}${dept} — ${code} — ${name}`. 2 quầy kệ này không bị khoá trong suốt file.
  const SHELF_A1_LABEL = `${DEPT1} — ${SHELF_A1.code} — ${SHELF_A1.name}`;
  const SHELF_A2_LABEL = `${DEPT1} — ${SHELF_A2.code} — ${SHELF_A2.name}`;
  // qlA: Quản Lý Siêu Thị — Kiểm Đếm + Xác Nhận Toàn Bộ Đợt (kiemKeConfirmDo), đúng vai thực tế thường
  // gặp nhất (1 người vừa thao tác vừa chốt đợt ở siêu thị nhỏ).
  const MANAGER = {
    username: 'qlA', name: 'Quản Lý A', dept: DEPT1,
    // kiemKeGomMaDo (MỚI, 12/2026) thêm để test được bulk-select + Xác Nhận Gom Mã ở cuối file.
    perms: { kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true, kiemKeConfirmDo: true, kiemKeShelfConfigManage: true, kiemKeGomMaDo: true }, active: true, totpEnabled: true
  };
  // nv1: CHỈ có kiemKeKiemDemDo (KHÔNG kiemKeConfirmDo) — đúng vai nhân viên Kiểm Đếm thường, dùng để
  // xác nhận Tab 6 VẪN hiện cho vai này (tự Xác Nhận quầy kệ mình vừa đếm xong), chỉ ẩn nút Toàn Bộ Đợt.
  const STAFF = { username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1, perms: { kiemKeKiemDemDo: true }, active: true, totpEnabled: true };
  const ADMIN = { username: 'admin', name: 'Admin', dept: DEPT1, perms: { admin: true }, active: true, totpEnabled: true };
  const THONG_KE_SESSION = { id: 9002, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [MANAGER, STAFF, ADMIN],
    kiemKeShelfLocations: [SHELF_A1, SHELF_A2],
    stocktakeSessions: [THONG_KE_SESSION],
    stocktakeUserAccess: [
      { id: 1, username: 'qlA', dept: DEPT1, shelfLocationId: 10, canKiemDem: true, canKiemSoat: true, canGomMa: true },
      { id: 2, username: 'qlA', dept: DEPT1, shelfLocationId: 11, canKiemDem: true, canKiemSoat: true, canGomMa: true }
    ],
    stocktakeCounts: []
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  state.__mockSystemInventoryRows = [
    { maHang: 'SP001', maVach: '8934000000001', tenHang: 'Hàng A1', soLuongTon: 50 },
    { maHang: 'SP002', maVach: '8934000000002', tenHang: 'Hàng A2', soLuongTon: 30 }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  // LƯU Ý: bỏ qua ĐÚNG 1 thông báo đã biết trước, không liên quan tới Tab 5/6 đang test —
  // test này chuyển đổi user đăng nhập (proceedAfterAuth) nhiều lần trong 1 page session,
  // mỗi lần kích hoạt 1 nhánh đồng bộ ngầm POST /api/data/users mà testHarness.js chưa mock
  // route chung này (xem pattern tương tự ở tests/audit-v30-excel-dashboard-sdd.js).
  const KNOWN_HARNESS_NOISE = 'Lỗi khi lưu "users" lên máy chủ: Error: Mock chỉ hỗ trợ patch-mode (__patchUser) cho /api/data/users ở harness này';
  const jsErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (msg.text().includes(KNOWN_HARNESS_NOISE)) return;
    jsErrors.push('[console.error] ' + msg.text());
  });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  // "Nhắc nhở mềm" (MỚI, 12/2026) — đổi quầy kệ khác khi quầy kệ đang thao tác CÓ số liệu quét nhưng CHƯA
  // Xác Nhận nay bật 1 hộp thoại confirm() hỏi lại — file test này CỐ Ý đổi qua lại nhiều quầy kệ CHƯA
  // Xác Nhận (đúng kịch bản cần test Tab 6 xử lý nhiều quầy kệ cùng lúc), nên chấp nhận SẴN mọi hộp thoại
  // dạng này ở mức toàn file (các listener cục bộ page.on/page.off ở từng bước bulk vẫn giữ nguyên, không
  // xung đột — dialog luôn được xử lý bởi listener gắn trước).
  page.on('dialog', (d) => d.accept().catch(() => {}));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, MANAGER);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(100);

    await run.run('Tab 5 Cấu Hình Quầy Kệ: hiện ĐÚNG danh sách quầy kệ của siêu thị (chỉ xem)', async () => {
      await page.click('#btnKkSubShelfConfig');
      await page.waitForTimeout(150);
      const text = await page.evaluate(() => document.getElementById('kkShelfConfigListBody').textContent);
      assert(text.includes('A1') && text.includes('A2'), `Phải hiện đủ 2 quầy kệ, thực tế: ${text}`);
    });

    await run.run('Tab 5: bộ lọc "Quầy Kệ" (mới, panel thu gọn mặc định) -> chỉ còn đúng 1 dòng khớp', async () => {
      const collapsedInitially = await page.evaluate(() => document.getElementById('kkShelfConfigFilterPanel').classList.contains('hidden'));
      assert(collapsedInitially, 'Panel bộ lọc Tab 5 phải THU GỌN mặc định (quy tắc mới, xem CLAUDE.md)');
      await page.click('#btnToggleKkShelfConfigFilter');
      await page.waitForTimeout(100);
      await page.fill('#kkscfShelf', 'A2');
      await page.waitForTimeout(150);
      const text = await page.evaluate(() => document.getElementById('kkShelfConfigListBody').textContent);
      assert(!text.includes('A1') && text.includes('A2'), `Phải lọc đúng chỉ còn A2, thực tế: ${text}`);
      await page.fill('#kkscfShelf', '');
      await page.waitForTimeout(100);
    });

    // Chuẩn bị dữ liệu Kiểm Đếm thật qua UI Tab 3 trước khi test Tab 6.
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(150);
    await page.fill('#kkKiemDemShelfInput', SHELF_A1_LABEL);
    await page.waitForTimeout(150);
    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(150);
    await page.fill('#kkKiemDemShelfInput', SHELF_A2_LABEL);
    await page.waitForTimeout(150);
    await page.fill('#kkKiemDemBarcodeInput', 'SP002');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(150);

    await run.run('Tab 6 Xác Nhận: tự chọn đúng kỳ Thống Kê đang hoạt động, hiện đủ 2 quầy kệ ĐÃ Kiểm Đếm, nút Xác Nhận Toàn Bộ Đợt đang KHOÁ', async () => {
      await page.click('#btnKkSubConfirm');
      await page.waitForTimeout(250);
      const sessionLabel = await page.evaluate(() => document.getElementById('kkConfirmSessionInput')?.value);
      assert(sessionLabel && sessionLabel.includes('Thống Kê Q4/2026'), `Phải tự chọn đúng kỳ, thực tế: ${sessionLabel}`);
      const text = await page.evaluate(() => document.getElementById('kkConfirmShelfListBody').textContent);
      assert(text.includes('A1') && text.includes('A2'), `Phải hiện đủ 2 quầy kệ đã Kiểm Đếm, thực tế: ${text}`);
      const btnDisabled = await page.evaluate(() => document.querySelector('[data-op="submitKkConfirmAll"]').disabled);
      assert(btnDisabled, 'Chưa quầy kệ nào Xác Nhận -> nút Xác Nhận Toàn Bộ Đợt phải bị khoá (disabled)');
    });

    await run.run('Tab 6: Xác Nhận quầy kệ A1 -> hiện đúng trạng thái đã xác nhận, nút Toàn Bộ Đợt VẪN khoá (còn A2)', async () => {
      await page.click('#kkConfirmShelfListBody button[data-op="confirmKkShelf"][data-arg0="10"]');
      await page.waitForTimeout(200);
      const text = await page.evaluate(() => document.getElementById('kkConfirmShelfListBody').textContent);
      assert(/A1.*đã xác nhận|đã xác nhận.*A1/s.test(text) || text.includes('✅'), `Phải hiện A1 đã xác nhận, thực tế: ${text}`);
      const btnDisabled = await page.evaluate(() => document.querySelector('[data-op="submitKkConfirmAll"]').disabled);
      assert(btnDisabled, 'Còn A2 chưa xác nhận -> nút Toàn Bộ Đợt vẫn phải khoá');
    });

    await run.run('Tab 6: quầy kệ A1 đã Xác Nhận -> sang Tab 3 Kiểm Đếm TIẾP trên A1 bị chặn rõ ràng NGAY lúc chọn (không đợi quét/submit mới biết)', async () => {
      await page.click('#btnKkSubKiemDem');
      await page.waitForTimeout(150);
      await page.fill('#kkKiemDemShelfInput', SHELF_A1_LABEL);
      await page.waitForTimeout(200);
      // LỖI UX THẬT phát hiện qua audit chéo (11/2026) đã vá: trước đây ô quét vẫn MỞ bình thường, chỉ
      // chặn SAU KHI gõ mã + bấm "Thêm" (ăn alert 409) — nay route active-session-for-shelf trả kèm
      // `shelfConfirmed`, ô quét KHOÁ NGAY lúc chọn quầy kệ, không cần quét thử mới biết.
      const info = await page.evaluate(() => document.getElementById('kkKiemDemSessionInfo').textContent);
      assert(/ĐÃ được Xác Nhận/.test(info), `Phải báo rõ "ĐÃ được Xác Nhận" ngay lúc chọn quầy kệ, thực tế: "${info}"`);
      const scanBoxHidden = await page.evaluate(() => document.getElementById('kkKiemDemScanBox').classList.contains('hidden'));
      assert(scanBoxHidden, 'Ô quét phải KHOÁ (ẩn) ngay khi chọn quầy kệ đã Xác Nhận, không mở rồi mới chặn ở bước submit');
      // Vẫn XEM được danh sách đã quét trước đó (tham khảo) — chỉ khoá Ô QUÉT, không ẩn trắng dữ liệu cũ.
      const rowCount = await page.evaluate(() => document.querySelectorAll('#kkKiemDemListBody tbody tr').length);
      assertEqual(rowCount, 1, `Quầy kệ đã khoá vẫn phải XEM được đúng 1 dòng đã quét trước đó (tham khảo), thực tế: ${rowCount} dòng`);
    });

    await run.run('Tab 4 Kiểm Soát: quầy kệ A1 (đã Xác Nhận Kiểm Đếm) VẪN Kiểm Soát được bình thường', async () => {
      await page.click('#btnKkSubKiemSoat');
      await page.waitForTimeout(150);
      await page.fill('#kkKiemSoatShelfInput', SHELF_A1_LABEL);
      await page.waitForTimeout(150);
      const hidden = await page.evaluate(() => document.getElementById('kkKiemSoatScanBox').classList.contains('hidden'));
      assert(!hidden, 'Kiểm Soát KHÔNG được bị khoá lây từ Xác Nhận Kiểm Đếm');
      await page.fill('#kkKiemSoatBarcodeInput', 'SP001');
      await page.click('[data-op="submitKkScan"][data-arg0="KIEMSOAT"]');
      await page.waitForTimeout(200);
      const text = await page.evaluate(() => document.getElementById('kkKiemSoatListBody').textContent);
      assert(text.includes('SP001'), `Kiểm Soát phải quét thành công, thực tế: ${text}`);
    });

    await run.run('Tab 6: Xác Nhận nốt A2 (Kiểm Đếm) -> ĐỦ Kiểm Đếm nhưng A1 còn Kiểm Soát chưa Xác Nhận Kiểm Soát -> nút Xác Nhận Toàn Bộ Đợt VẪN khoá', async () => {
      await page.click('#btnKkSubConfirm');
      await page.waitForTimeout(200);
      await page.click('#kkConfirmShelfListBody button[data-op="confirmKkShelf"][data-arg0="11"]');
      await page.waitForTimeout(200);
      const btnDisabled = await page.evaluate(() => document.querySelector('[data-op="submitKkConfirmAll"]').disabled);
      assert(btnDisabled, 'A1 đã có hoạt động Kiểm Soát (bước trước) nhưng CHƯA Xác Nhận Kiểm Soát -> nút Xác Nhận Toàn Bộ Đợt phải vẫn khoá (yêu cầu CẢ 2 điều kiện)');
      const text = await page.evaluate(() => document.getElementById('kkConfirmSoatShelfListBody').textContent);
      assert(text.includes('A1'), `Khung "Xác Nhận Kiểm Soát Từng Quầy Kệ" phải hiện A1 (đã có hoạt động Kiểm Soát), thực tế: ${text}`);
    });

    await run.run('Tab 6: Xác Nhận Kiểm Soát nốt A1 -> đủ CẢ 2 điều kiện, nút Xác Nhận Toàn Bộ Đợt MỞ KHOÁ', async () => {
      await page.click('#kkConfirmSoatShelfListBody button[data-op="confirmKkSoatShelf"][data-arg0="10"]');
      await page.waitForTimeout(200);
      const btnDisabled = await page.evaluate(() => document.querySelector('[data-op="submitKkConfirmAll"]').disabled);
      assert(!btnDisabled, 'Đủ cả Kiểm Đếm (A1+A2) lẫn Kiểm Soát (A1) đã Xác Nhận -> nút Xác Nhận Toàn Bộ Đợt phải MỞ KHOÁ');
    });

    await run.run('Tab 4 Kiểm Soát: quầy kệ A1 (đã Xác Nhận Kiểm Soát) -> Kiểm Soát TIẾP bị chặn rõ ràng NGAY lúc chọn', async () => {
      await page.click('#btnKkSubKiemSoat');
      await page.waitForTimeout(150);
      await page.fill('#kkKiemSoatShelfInput', SHELF_A2_LABEL);
      await page.waitForTimeout(150);
      await page.fill('#kkKiemSoatShelfInput', SHELF_A1_LABEL);
      await page.waitForTimeout(200);
      const info = await page.evaluate(() => document.getElementById('kkKiemSoatSessionInfo').textContent);
      assert(/ĐÃ được Xác Nhận Kiểm Soát/.test(info), `Phải báo rõ "ĐÃ được Xác Nhận Kiểm Soát" ngay lúc chọn quầy kệ, thực tế: "${info}"`);
      const scanBoxHidden = await page.evaluate(() => document.getElementById('kkKiemSoatScanBox').classList.contains('hidden'));
      assert(scanBoxHidden, 'Ô quét Kiểm Soát phải KHOÁ (ẩn) ngay khi chọn quầy kệ đã Xác Nhận Kiểm Soát');
      await page.click('#btnKkSubConfirm');
      await page.waitForTimeout(200);
    });

    await run.run('Tab 6: bấm Xác Nhận Toàn Bộ Đợt -> đóng kỳ thành công, không còn thao tác tiếp được', async () => {
      // Đăng ký SẴN 1 listener bắt HẾT mọi dialog (confirm() rồi alert() báo thành công nối tiếp nhau) —
      // dùng page.on (không phải page.once) để không bỏ sót dialog thứ 2 nếu nó tới trước khi kịp đăng ký
      // lại, rồi gỡ listener ngay sau khi xong (tránh ảnh hưởng các bước test khác).
      const onDialog = (d) => d.accept().catch(() => {});
      page.on('dialog', onDialog);
      await page.click('[data-op="submitKkConfirmAll"]');
      await page.waitForTimeout(300);
      page.off('dialog', onDialog);
      // Kỳ đã Đã chốt -> dropdown Tab 6 không còn liệt kê nó trong danh sách "Đang hoạt động" nữa.
      const sessionOptions = await page.evaluate(() => (document.getElementById('kkConfirmSessionDropdown')._sddItems || []).map(i => i.label));
      assert(!sessionOptions.some(o => o.includes('Thống Kê Q4/2026')), `Kỳ đã chốt không còn hiện trong danh sách "đang hoạt động", thực tế: ${sessionOptions.join(',')}`);
    });

    await run.run('nv1 (CHỈ kiemKeKiemDemDo, KHÔNG kiemKeConfirmDo) VẪN thấy nút Tab 6 "Xác Nhận" (để tự xác nhận quầy kệ mình đếm) — nhưng KHÔNG thấy/bấm được nút Xác Nhận Toàn Bộ Đợt', async () => {
      // Kỳ Thống Kê trước đã Đã chốt ở bước trên — tạo + kích hoạt 1 kỳ Thống Kê MỚI (qua chính API thật,
      // đăng nhập tạm bằng admin vì qlA không có kiemKePeriodManage) để có nội dung thật trong Tab 6 cho
      // nv1 xem, không phụ thuộc trạng thái rỗng.
      await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
      await page.evaluate(async (dept) => {
        const r = await fetch('/api/stocktake/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dept, loaiKy: 'THONG_KE', tenKy: 'Thống Kê đợt 2' }) });
        const body = await r.json();
        await fetch(`/api/stocktake/sessions/${body.item.id}/activate`, { method: 'POST' });
      }, DEPT1);
      await page.evaluate(async (u) => { await proceedAfterAuth(u); }, STAFF);
      await page.evaluate(() => switchTab('kiemKe'));
      await page.waitForTimeout(150);
      const btnVisible = await page.evaluate(() => !document.getElementById('btnKkSubConfirm').classList.contains('hidden'));
      assert(btnVisible, 'Nhân viên CHỈ có kiemKeKiemDemDo vẫn phải THẤY nút Tab 6 (để tự xác nhận quầy kệ mình đếm)');
      await page.click('#btnKkSubConfirm');
      await page.waitForTimeout(250);
      const bodyVisible = await page.evaluate(() => !document.getElementById('kkConfirmBody').classList.contains('hidden'));
      assert(bodyVisible, 'Phải tự chọn được kỳ Thống Kê mới đang hoạt động và hiện nội dung Tab 6');
      const confirmAllWrapHidden = await page.evaluate(() => document.getElementById('kkConfirmAllWrap').classList.contains('hidden'));
      assert(confirmAllWrapHidden, 'Nhân viên KHÔNG có kiemKeConfirmDo KHÔNG được thấy khối "Xác Nhận Toàn Bộ Đợt"');
      const btnShelfConfigHidden = await page.evaluate(() => document.getElementById('btnKkSubShelfConfig').classList.contains('hidden'));
      assert(btnShelfConfigHidden, 'Nhân viên không có kiemKeShelfConfigManage thì KHÔNG thấy nút Tab 5 (gating độc lập, không bị ảnh hưởng bởi thay đổi Tab 6)');
    });

    // ===== Bulk multi-select Xác Nhận/Gỡ Xác Nhận (MỚI, 12/2026, theo yêu cầu người dùng "chọn nhiều
    // quầy kệ kiểm đếm, gom mã và kiểm soát để xác nhận cũng như gỡ xác nhận") + Xác Nhận Gom Mã (MỚI,
    // 12/2026 — trước đây Gom Mã không có khoá/Xác Nhận nào) — dùng ĐÚNG session "Thống Kê đợt 2" (đã
    // tạo+kích hoạt ở test ngay trên, còn "Đang hoạt động", qlA có allowlist Kiểm Đếm/Kiểm Soát/Gom Mã
    // trên A1/A2) + 1 session Gom Mã MỚI tạo riêng. Đăng nhập lại bằng qlA (đủ cả 3 quyền). =====
    // qlA không có kiemKePeriodManage (vai "thao tác", không "quản lý Kỳ") -> tạo+kích hoạt Kỳ Gom Mã
    // bằng ADMIN trước (CÙNG cách session "Thống Kê đợt 2" đã tạo ở test ngay trên), rồi mới đăng nhập
    // lại qlA để thao tác Tab 6.
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    const gomMaSessionId = await page.evaluate(async (dept) => {
      const r = await fetch('/api/stocktake/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dept, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Q4/2026' }) });
      const body = await r.json();
      await fetch(`/api/stocktake/sessions/${body.item.id}/activate`, { method: 'POST' });
      return body.item.id;
    }, DEPT1);
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, MANAGER);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(100);

    await run.run('Chuẩn bị: Kiểm Đếm + Kiểm Soát A1/A2 (session "Thống Kê đợt 2") + Gom Mã A1 (session Gom Mã mới) qua UI thật', async () => {
      await page.click('#btnKkSubKiemDem');
      await page.waitForTimeout(150);
      await page.fill('#kkKiemDemShelfInput', SHELF_A1_LABEL);
      await page.waitForTimeout(150);
      await page.fill('#kkKiemDemBarcodeInput', 'SP001');
      await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
      await page.waitForTimeout(150);
      await page.fill('#kkKiemDemShelfInput', SHELF_A2_LABEL);
      await page.waitForTimeout(150);
      await page.fill('#kkKiemDemBarcodeInput', 'SP002');
      await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
      await page.waitForTimeout(150);

      await page.click('#btnKkSubKiemSoat');
      await page.waitForTimeout(150);
      await page.fill('#kkKiemSoatShelfInput', SHELF_A1_LABEL);
      await page.waitForTimeout(150);
      await page.fill('#kkKiemSoatBarcodeInput', 'SP001');
      await page.click('[data-op="submitKkScan"][data-arg0="KIEMSOAT"]');
      await page.waitForTimeout(150);

      await page.click('#btnKkSubGomMa');
      await page.waitForTimeout(150);
      await page.fill('#kkGomMaShelfInput', SHELF_A1_LABEL);
      await page.waitForTimeout(150);
      await page.fill('#kkGomMaBarcodeInput', 'SP001');
      await page.click('[data-op="submitKkScan"][data-arg0="GOMMA"]');
      await page.waitForTimeout(150);
      const text = await page.evaluate(() => document.getElementById('kkGomMaListBody').textContent);
      assert(text.includes('SP001'), `Gom Mã phải quét thành công, thực tế: ${text}`);
    });

    await run.run('Tab 6 bulk Kiểm Đếm: "Chọn tất cả" + "Xác Nhận Đã Chọn" -> cả A1+A2 Xác Nhận cùng lúc', async () => {
      await page.click('#btnKkSubConfirm');
      await page.waitForTimeout(250);
      const text0 = await page.evaluate(() => document.getElementById('kkConfirmShelfListBody').textContent);
      assert(text0.includes('A1') && text0.includes('A2'), `Phải hiện đủ A1/A2 chưa xác nhận ở session mới, thực tế: ${text0}`);
      const onDialog = (d) => d.accept().catch(() => {});
      page.on('dialog', onDialog);
      await page.check('#kkConfirmBulkBarKiemDem input[type="checkbox"]');
      await page.waitForTimeout(100);
      const countLabel = await page.evaluate(() => document.querySelector('#kkConfirmBulkBarKiemDem [data-role="count"]').textContent);
      assert(countLabel.includes('2'), `Phải báo đã chọn 2 quầy kệ, thực tế: "${countLabel}"`);
      await page.click('[data-op="bulkConfirmKkShelves"][data-arg0="KIEMDEM"]');
      await page.waitForTimeout(250);
      page.off('dialog', onDialog);
      const text = await page.evaluate(() => document.getElementById('kkConfirmShelfListBody').textContent);
      const checkCount = (text.match(/đã xác nhận bởi/g) || []).length;
      assertEqual(checkCount, 2, `Cả A1+A2 phải cùng chuyển sang đã xác nhận sau 1 lần bấm bulk, thực tế: ${text}`);
    });

    await run.run('Tab 6 bulk Kiểm Đếm: "Chọn tất cả" + "Gỡ Xác Nhận Đã Chọn" -> cả A1+A2 gỡ xác nhận cùng lúc', async () => {
      const onDialog = (d) => d.accept().catch(() => {});
      page.on('dialog', onDialog);
      await page.check('#kkConfirmBulkBarKiemDem input[type="checkbox"]');
      await page.waitForTimeout(100);
      await page.click('[data-op="bulkUnconfirmKkShelves"][data-arg0="KIEMDEM"]');
      await page.waitForTimeout(250);
      page.off('dialog', onDialog);
      const text = await page.evaluate(() => document.getElementById('kkConfirmShelfListBody').textContent);
      const checkCount = (text.match(/đã xác nhận bởi/g) || []).length;
      assertEqual(checkCount, 0, `Cả A1+A2 phải cùng gỡ xác nhận sau 1 lần bấm bulk gỡ, thực tế: ${text}`);
      const btnDisabled = await page.evaluate(() => document.querySelector('[data-bulk-btn][data-op="bulkConfirmKkShelves"][data-arg0="KIEMDEM"]').disabled);
      assert(btnDisabled, 'Sau khi bulk xong, selection phải tự reset -> nút bulk quay lại trạng thái khoá (chưa chọn gì)');
    });

    await run.run('Tab 6 bulk Kiểm Soát: tick riêng 1 dòng (không dùng "Chọn tất cả") + "Xác Nhận Đã Chọn" -> đúng 1 quầy kệ được xác nhận', async () => {
      const text0 = await page.evaluate(() => document.getElementById('kkConfirmSoatShelfListBody').textContent);
      assert(text0.includes('A1'), `Phải hiện A1 đã có hoạt động Kiểm Soát, thực tế: ${text0}`);
      const onDialog = (d) => d.accept().catch(() => {});
      page.on('dialog', onDialog);
      await page.check('#kkConfirmSoatShelfListBody input[type="checkbox"][data-shelf-id="10"]');
      await page.waitForTimeout(100);
      await page.click('[data-op="bulkConfirmKkShelves"][data-arg0="KIEMSOAT"]');
      await page.waitForTimeout(250);
      page.off('dialog', onDialog);
      const text = await page.evaluate(() => document.getElementById('kkConfirmSoatShelfListBody').textContent);
      assert(text.includes('đã xác nhận bởi'), `A1 phải chuyển sang đã Xác Nhận Kiểm Soát qua bulk (1 dòng), thực tế: ${text}`);
    });

    // LỖI THẬT phát hiện qua đợt chuyển select->input sdd* này (KHÔNG phải lỗi của bản chuyển đổi test
    // này — module-vanhanh.js nằm NGOÀI phạm vi file được phép sửa của đợt audit này, nêu rõ để phiên điều
    // phối tự quyết định vá riêng): loadKkConfirmGomMaTab() (module-vanhanh.js, dòng ~2001) VẪN đọc
    // document.getElementById('kkConfirmGomMaSessionSelect') — id <select> CŨ đã bị xoá khỏi DOM khi đổi
    // sang #kkConfirmGomMaSessionInput — nên sel luôn là null, sessionId luôn ép về 0, hàm return sớm
    // TRƯỚC khi fetch dữ liệu xác nhận Gom Mã. Khối "Xác Nhận Gom Mã" ở Tab 6 vì vậy KHÔNG BAO GIỜ tải
    // được danh sách quầy kệ nữa (ngay cả khi input/sdd đã chọn đúng kỳ) — không phải lỗi do test này gõ/
    // chọn sai, đã xác nhận qua debug trực tiếp hàm thật.
    await run.run('Tab 6 Gom Mã (kỳ riêng): chọn đúng kỳ Gom Mã mới, hiện A1, bulk Xác Nhận hoạt động đúng', async () => {
      await page.fill('#kkConfirmGomMaSessionInput', 'Gom Mã Q4/2026');
      await page.waitForTimeout(250);
      const text0 = await page.evaluate(() => document.getElementById('kkConfirmGomMaShelfListBody').textContent);
      assert(text0.includes('A1'), `Phải hiện A1 đã có hoạt động Gom Mã ở ĐÚNG kỳ Gom Mã riêng, thực tế: ${text0}`);
      const onDialog = (d) => d.accept().catch(() => {});
      page.on('dialog', onDialog);
      await page.check('#kkConfirmBulkBarGomMa input[type="checkbox"]');
      await page.waitForTimeout(100);
      await page.click('[data-op="bulkConfirmKkShelves"][data-arg0="GOMMA"]');
      await page.waitForTimeout(250);
      page.off('dialog', onDialog);
      const text = await page.evaluate(() => document.getElementById('kkConfirmGomMaShelfListBody').textContent);
      assert(text.includes('đã xác nhận bởi'), `A1 phải chuyển sang đã Xác Nhận Gom Mã qua bulk, thực tế: ${text}`);
      // Gom Mã đã khoá -> sang Tab 2 Gom Mã TIẾP trên A1 bị chặn rõ ràng NGAY lúc chọn (cùng khuôn Kiểm
      // Đếm/Kiểm Soát).
      await page.click('#btnKkSubGomMa');
      await page.waitForTimeout(150);
      await page.fill('#kkGomMaShelfInput', SHELF_A2_LABEL);
      await page.waitForTimeout(150);
      await page.fill('#kkGomMaShelfInput', SHELF_A1_LABEL);
      await page.waitForTimeout(200);
      const info = await page.evaluate(() => document.getElementById('kkGomMaSessionInfo').textContent);
      assert(/ĐÃ được Xác Nhận Gom Mã/.test(info), `Phải báo rõ "ĐÃ được Xác Nhận Gom Mã" ngay lúc chọn quầy kệ, thực tế: "${info}"`);
    });

    // ===== Bộ lọc tìm kiếm MỚI (12/2026, theo yêu cầu người dùng: "lọc tìm kiếm theo quầy kệ, theo
    // trạng thái, xác nhận, mã sản phẩm... dạng drop list, searchable, gợi ý nhắc", xem CLAUDE.md "Bộ lọc
    // tìm kiếm MỚI từ nay"). Dùng tiếp đúng session "Thống Kê đợt 2" (A1 đã Xác Nhận Kiểm Soát từ test
    // trên, A2 chưa) + Gom Mã session mới (A1 đã Xác Nhận Gom Mã). =====
    await run.run('Chuẩn bị bộ lọc: Kiểm Soát thêm A2 (để có 1 quầy ĐÃ xác nhận + 1 quầy CHƯA xác nhận)', async () => {
      await page.click('#btnKkSubKiemSoat');
      await page.waitForTimeout(150);
      await page.fill('#kkKiemSoatShelfInput', SHELF_A2_LABEL);
      await page.waitForTimeout(150);
      await page.fill('#kkKiemSoatBarcodeInput', 'SP002');
      await page.click('[data-op="submitKkScan"][data-arg0="KIEMSOAT"]');
      await page.waitForTimeout(150);
    });

    await run.run('Tab 6 bộ lọc Kiểm Soát: panel thu gọn mặc định, lọc "Xác Nhận" tách đúng 2 nhóm', async () => {
      await page.click('#btnKkSubConfirm');
      await page.waitForTimeout(250);
      const collapsedInitially = await page.evaluate(() => document.getElementById('kkcfKiemSoatPanel').classList.contains('hidden'));
      assert(collapsedInitially, 'Panel bộ lọc Kiểm Soát phải THU GỌN mặc định (quy tắc mới)');
      await page.click('#btnToggleKkcfKiemSoat');
      await page.waitForTimeout(100);
      await page.fill('#kkcfKiemSoatXacNhan', 'Đã xác nhận');
      await page.waitForTimeout(150);
      let text = await page.evaluate(() => document.getElementById('kkConfirmSoatShelfListBody').textContent);
      assert(text.includes('A1') && !text.includes('A2'), `Lọc "Đã xác nhận" phải chỉ còn A1, thực tế: ${text}`);
      await page.fill('#kkcfKiemSoatXacNhan', 'Chưa xác nhận');
      await page.waitForTimeout(150);
      text = await page.evaluate(() => document.getElementById('kkConfirmSoatShelfListBody').textContent);
      assert(!text.includes('A1') && text.includes('A2'), `Lọc "Chưa xác nhận" phải chỉ còn A2, thực tế: ${text}`);
      await page.fill('#kkcfKiemSoatXacNhan', '');
      await page.fill('#kkcfKiemSoatShelf', 'A2');
      await page.waitForTimeout(150);
      text = await page.evaluate(() => document.getElementById('kkConfirmSoatShelfListBody').textContent);
      assert(!text.includes('A1') && text.includes('A2'), `Lọc Quầy Kệ "A2" phải chỉ còn A2, thực tế: ${text}`);
      // "Chọn tất cả" lúc đang lọc chỉ còn A2 -> chỉ chọn đúng A2 (không âm thầm chọn luôn A1 đang bị ẩn).
      await page.check('#kkConfirmBulkBarKiemSoat input[type="checkbox"]');
      await page.waitForTimeout(100);
      const countLabel = await page.evaluate(() => document.querySelector('#kkConfirmBulkBarKiemSoat [data-role="count"]').textContent);
      assertEqual(countLabel, 'Đã chọn 1 quầy kệ', `"Chọn tất cả" lúc đang lọc chỉ được chọn đúng những dòng ĐANG HIỆN, thực tế: "${countLabel}"`);
      await page.click('[data-op="clearKkConfirmFilters"][data-arg0="KIEMSOAT"]');
      await page.waitForTimeout(150);
      text = await page.evaluate(() => document.getElementById('kkConfirmSoatShelfListBody').textContent);
      assert(text.includes('A1') && text.includes('A2'), `Xoá Bộ Lọc phải hiện lại đủ cả A1+A2, thực tế: ${text}`);
    });

    await run.run('Tab 5 bộ lọc "Trạng Thái": phân biệt đúng quầy kệ Đang hoạt động / Ngừng hoạt động', async () => {
      await page.evaluate(() => { const l = DB.kiemKeShelfLocations.find(x => x.code === 'A2'); if (l) l.active = false; });
      await page.click('#btnKkSubShelfConfig');
      await page.waitForTimeout(200);
      let text = await page.evaluate(() => document.getElementById('kkShelfConfigListBody').textContent);
      assert(text.includes('A1') && text.includes('A2'), `Không lọc Trạng Thái -> phải hiện CẢ quầy đã ngừng hoạt động, thực tế: ${text}`);
      // Panel có thể đang MỞ SẴN từ 1 test trước đó (đã bấm toggle, chưa đóng lại) -> chỉ bấm toggle nếu
      // đang THỰC SỰ thu gọn, tránh bấm nhầm thành ĐÓNG panel đang mở.
      const isCollapsed = await page.evaluate(() => document.getElementById('kkShelfConfigFilterPanel').classList.contains('hidden'));
      if (isCollapsed) await page.click('#btnToggleKkShelfConfigFilter');
      await page.waitForTimeout(100);
      await page.fill('#kkscfStatus', 'Ngừng hoạt động');
      await page.waitForTimeout(150);
      text = await page.evaluate(() => document.getElementById('kkShelfConfigListBody').textContent);
      assert(!text.includes('A1') && text.includes('A2'), `Lọc "Ngừng hoạt động" phải chỉ còn A2, thực tế: ${text}`);
      await page.fill('#kkscfStatus', 'Đang hoạt động');
      await page.waitForTimeout(150);
      text = await page.evaluate(() => document.getElementById('kkShelfConfigListBody').textContent);
      assert(text.includes('A1') && !text.includes('A2'), `Lọc "Đang hoạt động" phải chỉ còn A1, thực tế: ${text}`);
      await page.evaluate(() => { const l = DB.kiemKeShelfLocations.find(x => x.code === 'A2'); if (l) l.active = true; });
    });

    await run.run('Tab 2/3/4 ô "Tìm theo mã/tên": tự nạp gợi ý (sdd) từ đúng mã đã quét ở quầy kệ đang chọn', async () => {
      await page.click('#btnKkSubKiemDem');
      await page.waitForTimeout(150);
      await page.fill('#kkKiemDemShelfInput', SHELF_A1_LABEL);
      await page.waitForTimeout(200);
      const items = await page.evaluate(() => (document.getElementById('kkKiemDemSearchDropdown')._sddItems || []).map(i => i.label));
      assert(items.some(l => l.includes('SP001')), `Gợi ý ô tìm Kiểm Đếm phải có SP001 đã quét ở quầy kệ A1, thực tế: ${JSON.stringify(items)}`);
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
