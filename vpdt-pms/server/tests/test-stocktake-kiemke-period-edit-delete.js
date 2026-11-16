// tests/test-stocktake-kiemke-period-edit-delete.js — Playwright THẬT, VIẾT MỚI (audit chéo trước merge
// nhánh claude/chao-ban-oo5ijl) — CHƯA có test nào cho nút "✏️ Sửa"/"🗑️ Xoá" Kỳ Kiểm Kê (editSessionMeta()/
// deleteDraftSession(), lib/stocktakeEngine.js + PATCH|DELETE /api/stocktake/sessions/:id) ở bộ test
// hiện có (đã grep xác nhận trước khi viết).
//
// GHI CHÚ QUAN TRỌNG rút ra từ chính code thật (đọc lib/stocktakeEngine.js TRƯỚC khi viết test, không
// đoán): "✏️ Sửa" CHỦ ĐÍCH cho sửa ở MỌI trạng thái (Nháp/Đang hoạt động/Đã chốt — chỉ đổi Tên Kỳ/Thời
// Gian, KHÔNG đổi dept/loaiKy/trangThai, xem chú thích editSessionMeta()), còn "🗑️ Xoá" CHO Nháp HOẶC
// Đang hoạt động NHƯNG CHƯA có dữ liệu quét nào (deleteDraftSession() tự chặn 409 cho Đã chốt, hoặc Đang
// hoạt động mà ĐÃ có dữ liệu) — MỞ RỘNG sau phản hồi người dùng thật "kỳ Gom Mã này chưa thực hiện, chưa
// có dữ liệu gì phải xoá nữa chứ" (ban đầu code chỉ cho Xoá đúng Nháp, giả định an toàn tự đặt ra lúc
// code chứ không phải ý người dùng). Test này xác nhận ĐÚNG các hành vi THIẾT KẾ đó bằng chứng thật (UI +
// gọi thẳng route, không chỉ ẩn nút) — KHÔNG giả định "Sửa phải bị chặn ở kỳ đã kích hoạt" (giả định đó
// SAI với chủ đích thiết kế thật đã ghi rõ trong code).
async function main() {
  const { createRunner, assert, assertEqual, startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8953;
  const DEPT = 'CH Phú Nhuận';
  const ADMIN = { username: 'admin.editdel', name: 'Admin Edit/Del', dept: DEPT, perms: { admin: true }, active: true, totpEnabled: true };

  const draftSession = { id: 8801, dept: DEPT, loaiKy: 'GOM_MA', tenKy: 'Kỳ Nháp — sẽ Sửa rồi Xoá', trangThai: 'NHAP' };
  const activeSession = { id: 8802, dept: DEPT, loaiKy: 'THONG_KE', tenKy: 'Kỳ Đang Hoạt Động — CHƯA có dữ liệu — thử Sửa/Xoá', trangThai: 'DANG_HOAT_DONG' };
  const activeSessionWithData = { id: 8804, dept: DEPT, loaiKy: 'GOM_MA', tenKy: 'Kỳ Đang Hoạt Động — ĐÃ có dữ liệu — không Xoá được', trangThai: 'DANG_HOAT_DONG' };
  const closedSession = { id: 8803, dept: DEPT, loaiKy: 'THONG_KE', tenKy: 'Kỳ Đã Chốt — thử Sửa/Xoá', trangThai: 'DA_CHOT' };

  const state = createMockState({
    depts: [DEPT], stores: [DEPT], users: [ADMIN],
    stocktakeSessions: [draftSession, activeSession, activeSessionWithData, closedSession],
    stocktakeCounts: [
      { id: 1, sessionId: activeSessionWithData.id, shelfLocationId: 1, dept: DEPT, maHang: 'SP001', slGomMa: 3 }
    ]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const KNOWN_HARNESS_NOISE = 'Lỗi khi lưu "users" lên máy chủ: Error: Mock chưa hỗ trợ route: POST /api/data/users';
  const jsErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (msg.text().includes(KNOWN_HARNESS_NOISE)) return;
    jsErrors.push('[console.error] ' + msg.text());
  });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);

    // ===== Kỳ Nháp: Sửa được (UI thật, bấm nút, gõ tên mới, lưu) rồi Xoá được (UI thật, confirm) =====
    await run.run('[7] Kỳ Nháp: bấm "✏️ Sửa" qua UI thật, đổi Tên Kỳ, Lưu -> cập nhật đúng', async () => {
      await page.click(`button[data-op="editKkPeriodClick"][data-arg0="${draftSession.id}"]`);
      await page.waitForTimeout(150);
      const title = await page.evaluate(() => document.getElementById('kkPeriodCreateBoxTitle').textContent);
      assert(title.includes('Sửa Kỳ Kiểm Kê'), `Phải chuyển form sang chế độ Sửa, thực tế title: ${title}`);
      await page.fill('#kkNewTenKy', 'Kỳ Nháp — ĐÃ SỬA TÊN');
      await page.click('#btnSubmitKkPeriod');
      await page.waitForTimeout(250);
      const text = await page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
      assert(text.includes('ĐÃ SỬA TÊN'), `Danh sách phải hiện tên kỳ mới sau khi Sửa, thực tế: ${text}`);
      assertEqual(draftSession.tenKy, 'Kỳ Nháp — ĐÃ SỬA TÊN', 'Bản ghi thật phía server (mock state) phải được cập nhật tenKy');
      assertEqual(draftSession.dept, DEPT, 'Sửa KHÔNG được đổi dept (chỉ đổi Tên Kỳ/Thời Gian theo đúng thiết kế)');
      assertEqual(draftSession.trangThai, 'NHAP', 'Sửa KHÔNG được đổi trạng thái');
    });

    await run.run('[7] Kỳ Nháp: bấm "🗑️ Xoá" qua UI thật (confirm) -> xoá hẳn khỏi danh sách VÀ khỏi dữ liệu thật', async () => {
      const btnBefore = await page.$(`button[data-op="deleteKkPeriodClick"][data-arg0="${draftSession.id}"]`);
      assert(!!btnBefore, 'Phải thấy nút Xoá cho kỳ còn Nháp');
      await btnBefore.click();
      await page.waitForTimeout(250);
      const text = await page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
      assert(!text.includes('ĐÃ SỬA TÊN'), `Kỳ Nháp phải biến mất khỏi danh sách sau khi Xoá, thực tế: ${text}`);
      const listed = await page.evaluate(async (dept) => (await (await fetch(`/api/stocktake/sessions?dept=${encodeURIComponent(dept)}`)).json()).items, DEPT);
      assert(!listed.some(s => s.id === draftSession.id), `Kỳ Nháp (id ${draftSession.id}) phải biến mất khỏi dữ liệu thật phía server sau khi Xoá, thực tế items: ${JSON.stringify(listed.map(s => s.id))}`);
    });

    // ===== Kỳ Đang hoạt động: Sửa VẪN được (ĐÚNG THIẾT KẾ — chỉ đổi Tên Kỳ/Thời Gian). Xoá: phụ thuộc
    // ĐÃ có dữ liệu quét hay chưa (MỞ RỘNG theo phản hồi người dùng thật, xem chú thích đầu file) — CHƯA
    // có dữ liệu (activeSession) thì VẪN Xoá được dù đã Kích Hoạt; ĐÃ có dữ liệu (activeSessionWithData)
    // thì KHÔNG Xoá được nữa, kể cả tấn công trực tiếp qua route =====
    await run.run('[7] Kỳ Đang hoạt động: VẪN Sửa được Tên Kỳ qua UI thật (đúng chủ đích thiết kế, không bị chặn)', async () => {
      await page.click(`button[data-op="editKkPeriodClick"][data-arg0="${activeSession.id}"]`);
      await page.waitForTimeout(150);
      await page.fill('#kkNewTenKy', 'Kỳ Đang Hoạt Động — ĐÃ SỬA');
      await page.click('#btnSubmitKkPeriod');
      await page.waitForTimeout(250);
      assertEqual(activeSession.tenKy, 'Kỳ Đang Hoạt Động — ĐÃ SỬA', 'Phải Sửa được Tên Kỳ của kỳ Đang hoạt động (CHỦ ĐÍCH thiết kế, xem editSessionMeta())');
      assertEqual(activeSession.trangThai, 'DANG_HOAT_DONG', 'Sửa KHÔNG được làm đổi trạng thái kỳ');
    });

    await run.run('[7] Kỳ Đang hoạt động CHƯA có dữ liệu: CÓ nút Xoá, bấm qua UI thật -> xoá hẳn thành công (MỞ RỘNG mới)', async () => {
      const btn = await page.$(`button[data-op="deleteKkPeriodClick"][data-arg0="${activeSession.id}"]`);
      assert(!!btn, 'PHẢI thấy nút Xoá cho kỳ Đang hoạt động nhưng chưa có dữ liệu quét nào (hasData=false)');
      await btn.click();
      await page.waitForTimeout(250);
      const listed = await page.evaluate(async (dept) => (await (await fetch(`/api/stocktake/sessions?dept=${encodeURIComponent(dept)}`)).json()).items, DEPT);
      assert(!listed.some(s => s.id === activeSession.id), `Kỳ Đang hoạt động CHƯA có dữ liệu phải xoá được, thực tế items còn: ${JSON.stringify(listed.map(s => s.id))}`);
    });

    await run.run('[7] Kỳ Đang hoạt động ĐÃ có dữ liệu: KHÔNG có nút Xoá trên UI, VÀ gọi thẳng route DELETE bị server chặn 409 (không chỉ ẩn UI)', async () => {
      const btn = await page.$(`button[data-op="deleteKkPeriodClick"][data-arg0="${activeSessionWithData.id}"]`);
      assert(!btn, 'KHÔNG được thấy nút Xoá cho kỳ Đang hoạt động ĐÃ có dữ liệu quét');
      const res = await page.evaluate(async (id) => {
        const r = await fetch(`/api/stocktake/sessions/${id}`, { method: 'DELETE' });
        return { status: r.status, body: await r.json() };
      }, activeSessionWithData.id);
      assertEqual(res.status, 409, `Server phải chặn 409 (Conflict) khi cố Xoá kỳ Đang hoạt động ĐÃ có dữ liệu, thực tế: ${JSON.stringify(res)}`);
      assertEqual(activeSessionWithData.trangThai, 'DANG_HOAT_DONG', 'Kỳ KHÔNG được bị xoá sau đòn tấn công trực tiếp');
    });

    // ===== Kỳ Đã chốt: CÙNG hành vi — Sửa vẫn được, Xoá vẫn bị chặn 409 =====
    await run.run('[7] Kỳ Đã chốt: VẪN Sửa được Tên Kỳ qua UI thật (đúng chủ đích thiết kế)', async () => {
      await page.click(`button[data-op="editKkPeriodClick"][data-arg0="${closedSession.id}"]`);
      await page.waitForTimeout(150);
      await page.fill('#kkNewTenKy', 'Kỳ Đã Chốt — ĐÃ SỬA');
      await page.click('#btnSubmitKkPeriod');
      await page.waitForTimeout(250);
      assertEqual(closedSession.tenKy, 'Kỳ Đã Chốt — ĐÃ SỬA', 'Phải Sửa được Tên Kỳ của kỳ Đã chốt (CHỦ ĐÍCH thiết kế)');
      assertEqual(closedSession.trangThai, 'DA_CHOT', 'Sửa KHÔNG được làm đổi trạng thái kỳ');
    });

    await run.run('[7] Kỳ Đã chốt: KHÔNG có nút Xoá trên UI, VÀ gọi thẳng route DELETE bị server chặn 409', async () => {
      const btn = await page.$(`button[data-op="deleteKkPeriodClick"][data-arg0="${closedSession.id}"]`);
      assert(!btn, 'KHÔNG được thấy nút Xoá cho kỳ Đã chốt');
      const res = await page.evaluate(async (id) => {
        const r = await fetch(`/api/stocktake/sessions/${id}`, { method: 'DELETE' });
        return { status: r.status, body: await r.json() };
      }, closedSession.id);
      assertEqual(res.status, 409, `Server phải chặn 409 khi cố Xoá kỳ Đã chốt, thực tế: ${JSON.stringify(res)}`);
      assertEqual(closedSession.trangThai, 'DA_CHOT', 'Kỳ KHÔNG được bị xoá sau đòn tấn công trực tiếp');
    });

    // ===== Sanity thêm: gọi thẳng PATCH route (không qua UI) để xác nhận editSessionMeta() không cho đổi
    // dept/loaiKy/trangThai dù body gửi kèm field đó (server chỉ đọc đúng tenKy/thoiGianBatDau/thoiGianKetThuc). =====
    await run.run('[7] Tấn công trực tiếp PATCH kèm field dept/trangThai lạ -> server CHỈ áp dụng tenKy, bỏ qua field khác', async () => {
      const res = await page.evaluate(async (id) => {
        const r = await fetch(`/api/stocktake/sessions/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenKy: 'Kỳ Đã Chốt — PATCH trực tiếp', dept: 'SIÊU THỊ GIẢ MẠO', trangThai: 'NHAP' })
        });
        return { status: r.status, body: await r.json() };
      }, closedSession.id);
      assertEqual(res.status, 200, `PATCH hợp lệ (chỉ sửa tên) phải thành công, thực tế: ${JSON.stringify(res)}`);
      assertEqual(res.body.item.dept, DEPT, `dept KHÔNG được bị đổi dù body gửi kèm field lạ, thực tế: ${res.body.item.dept}`);
      assertEqual(res.body.item.trangThai, 'DA_CHOT', `trangThai KHÔNG được bị đổi qua PATCH, thực tế: ${res.body.item.trangThai}`);
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
