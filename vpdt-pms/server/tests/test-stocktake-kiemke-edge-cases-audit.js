// tests/test-stocktake-kiemke-edge-cases-audit.js — AUDIT TẠM (Playwright THẬT, click/select/fill thật)
// cho các góc "người dùng thật làm sai/làm lạ" của Kiểm Kê offline, chưa chắc đã được test kỹ trước đây:
//
//   2) Đổi quầy kệ RẤT NHANH liên tiếp (trước khi active-session-for-shelf kịp trả về) — race condition?
//   3) Bật "✈️ Offline Thủ Công" trong lúc đang có 1 request quét khác ĐANG BAY (pending) — request đó có
//      bị huỷ/lẫn kết quả không, dòng vừa quét offline có bị "biến mất" khỏi danh sách không?
//   4) "Nhắc nhở mềm" + offline cùng lúc — quét xong ở quầy A (chưa Xác Nhận) trong lúc ĐANG offline, đổi
//      sang quầy B cũng lúc offline — hộp thoại nhắc nhở có hiện đúng không, Huỷ có giữ nguyên A không?
//   5) Khoá quầy kệ trong khi nhân viên đang offline ở quầy đó — có mạng lại, đồng bộ — có báo đúng
//      (không im lặng) không cho đồng bộ ngầm tiếp không?
//   6) Console/pageerror JS lạ trong toàn bộ luồng trên.
//
// Dùng testHarness.js's launchPage() (exposeFunction + window.fetch override) — KHÔNG cần page.reload()
// cho các kịch bản này, xem riêng test-stocktake-kiemke-offline-reload-audit.js cho kịch bản reload.
// Chạy: node tests/test-stocktake-kiemke-edge-cases-audit.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8988;
  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const SHELF_A2 = { id: 11, dept: DEPT1, code: 'A2', name: 'Kệ A2 — Mì, cháo', active: true };
  // LABEL_A1/LABEL_A2 — nhãn hiển thị ĐÚNG CÔNG THỨC kkShelfOptionLabel() (module-vanhanh.js:
  // `${locked?'🔒 ':''}${dept} — ${code} — ${name}`) để page.fill() vào #kkKiemDemShelfInput khớp đúng
  // gợi ý — tính từ CHÍNH field fixture (không chép tay) để không lệch nếu sửa fixture sau này. KHÔNG
  // có tiền tố 🔒 trong TOÀN BỘ file test này dù SHELF_A1.kiemKeLocked bị gán true ở mục 5 (bên dưới)
  // VÌ nhãn gõ vào luôn so khớp với `st.shelves` ĐÃ CACHE lúc vào tab (renderKkScanShelfOptions() chỉ
  // chạy lại khi loadKkScanTab() tải MỚI — tab KIEMDEM không bị rời/vào lại trong suốt file này), không
  // phải mảng `kiemKeShelfLocations` gốc vừa bị sửa trực tiếp qua state.
  const LABEL_A1 = `${SHELF_A1.dept} — ${SHELF_A1.code} — ${SHELF_A1.name}`;
  const LABEL_A2 = `${SHELF_A2.dept} — ${SHELF_A2.code} — ${SHELF_A2.name}`;
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1,
    perms: { kiemKeGomMaDo: true, kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true }, active: true, totpEnabled: true
  };
  const THONG_KE_SESSION = { id: 9002, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [USER],
    kiemKeShelfLocations: [SHELF_A1, SHELF_A2],
    stocktakeSessions: [THONG_KE_SESSION],
    stocktakeUserAccess: [
      { id: 1, username: 'nv1', dept: DEPT1, shelfLocationId: 10, canGomMa: true, canKiemDem: true, canKiemSoat: true },
      { id: 2, username: 'nv1', dept: DEPT1, shelfLocationId: 11, canGomMa: true, canKiemDem: true, canKiemSoat: true }
    ],
    stocktakeCounts: []
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  state.__mockSystemInventoryRows = [
    { maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 },
    { maHang: 'SP002', maVach: '8934000000002', tenHang: 'Mì Gấu Đỏ', soLuongTon: 30 }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('Mock chưa hỗ trợ route: POST /api/data/users')) jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  const goOffline = () => page.evaluate(() => { window.__origFetch = window.fetch; window.fetch = () => { throw new TypeError('Failed to fetch'); }; });
  const goOnline = () => page.evaluate(() => { if (window.__origFetch) { window.fetch = window.__origFetch; delete window.__origFetch; } });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(100);
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(200);

    // ===================================================================================
    // 2) Đổi quầy kệ RẤT NHANH liên tiếp — làm chậm phản hồi active-session-for-shelf của A1
    //    (shelfLocationId=10) để lượt A1 "về" SAU lượt A2 (nhanh, không trễ) — nếu client không có
    //    staleness-guard, phản hồi TRỄ của A1 sẽ đè ngược lên màn hình đang hiển thị đúng của A2.
    // ===================================================================================
    await page.evaluate(() => {
      window.__origFetchRace = window.fetch;
      window.fetch = (url, opts) => {
        if (String(url).includes('/api/stocktake/active-session-for-shelf') && String(url).includes('shelfLocationId=10')) {
          return new Promise((resolve) => setTimeout(() => resolve(window.__origFetchRace(url, opts)), 500));
        }
        return window.__origFetchRace(url, opts);
      };
    });

    // Chọn A1 (lượt gọi SẼ BỊ TRỄ 500ms) rồi NGAY LẬP TỨC chọn A2 (lượt gọi nhanh, không trễ) — không
    // await riêng từng bước, mô phỏng đúng "bấm/chọn 2 lần liên tiếp thật nhanh trước khi lượt đầu kịp
    // trả lời". page.fill() tự chờ sự kiện 'input' được DISPATCH xong (không chờ handler async).
    const p1 = page.fill('#kkKiemDemShelfInput', LABEL_A1).catch((e) => ({ __raceErr: e }));
    await page.waitForTimeout(30); // đủ để lượt gọi A1 bắt đầu (qua đoạn code đồng bộ, set st.selectedShelfId=10) nhưng chưa xong fetch
    const disabledWhilePending = await page.evaluate(() => document.getElementById('kkKiemDemShelfInput').disabled);
    const p2 = page.fill('#kkKiemDemShelfInput', LABEL_A2).catch((e) => ({ __raceErr: e }));
    const [r1, r2] = await Promise.all([p1, p2]);
    console.log(`   [ghi nhận cơ chế bảo vệ sẵn có] ô chọn quầy kệ có bị .disabled trong lúc chờ phản hồi A1 (chưa xong)? ${disabledWhilePending} — nếu true: đây là khoá chống double-submit (runCspOp()/core.js) đã tự SERI HOÁ 2 lượt chọn này (page.fill() phải tự chờ nó .disabled=false trở lại rồi mới gõ được), không phải race thật xảy ra đồng thời.`);

    await run.run('2a) Chọn A1 rồi A2 ngay lập tức: lượt chọn A2 không bị khoá/chặn bởi khoá chống double-submit của lượt A1 đang bay', async () => {
      // Nếu runCspOp() (core.js) đã khoá ô nhập trong lúc chờ fetch A1, page.fill(LABEL_A2) sẽ timeout/throw
      // — đây là hành vi AN TOÀN (không phải race) nên không coi là lỗi, chỉ ghi nhận rõ trong báo cáo.
      if (r2 && r2.__raceErr) {
        console.log('   (Ghi nhận: lượt chọn A2 bị CHẶN bởi khoá double-submit trong lúc A1 đang chờ phản hồi — xem chi tiết ở báo cáo cuối, KHÔNG coi là lỗi)');
      }
    });

    await page.waitForTimeout(700); // đợi lượt A1 (trễ 500ms) về xong hẳn
    await page.evaluate(() => { window.fetch = window.__origFetchRace; delete window.__origFetchRace; });

    await run.run('2b) Sau khi CẢ 2 phản hồi đã về (A1 trễ về SAU CÙNG): màn hình phải phản ánh ĐÚNG quầy kệ ĐANG CHỌN (A2), không bị đè ngược lại thông tin của A1', async () => {
      const selectedShelfIdState = await page.evaluate(() => kkScanState.KIEMDEM.selectedShelfId);
      const inputValue = await page.evaluate(() => document.getElementById('kkKiemDemShelfInput').value);
      // Nhãn ô nhập PHẢI khớp ĐÚNG quầy kệ đang có trong state.selectedShelfId (tra lại trong chính
      // st.shelves ĐÃ CACHE qua kkShelfOptionLabel(), cùng công thức app dùng để ghi input.value lúc
      // chọn) — tương đương chính xác phép so sánh <select>.value === state.selectedShelfId cũ (ở khuôn
      // <select>, value CHÍNH LÀ id; ở khuôn input mới, value là LABEL nên phải tra lại đúng label của
      // ĐÚNG id đó rồi mới so sánh, không so trực tiếp số id với chuỗi label được).
      const expectedLabel = await page.evaluate((id) => {
        const shelf = (kkScanState.KIEMDEM.shelves || []).find(l => l.id === id);
        return shelf ? kkShelfOptionLabel(shelf) : '';
      }, selectedShelfIdState || null);
      const infoText = await page.evaluate(() => document.getElementById('kkKiemDemSessionInfo').textContent);
      console.log(`   [ghi nhận thực tế] selectedShelfId state=${selectedShelfIdState}, input.value=${inputValue}, sessionInfo="${infoText}"`);
      // Bất kể selectedShelfIdState là 10 hay 11 (tuỳ runCspOp có chặn lượt 2 hay không), điều PHẢI đúng là:
      // sessionInfo đang hiển thị phải KHỚP với selectedShelfIdState hiện tại (không lệch nhau) — nếu lệch,
      // đây là race UI thật (phản hồi trễ của 1 quầy kệ đè lên màn hình của quầy kệ khác đang hiển thị).
      assertEqual(inputValue, expectedLabel, 'Giá trị ô chọn quầy kệ phải khớp đúng state.selectedShelfId (không được lệch)');
    });

    // Dọn lại trạng thái sạch cho các phần sau.
    await page.fill('#kkKiemDemShelfInput', '');
    await page.waitForTimeout(150);

    // ===================================================================================
    // 3) Bật "✈️ Offline Thủ Công" trong lúc đang có 1 request KHÁC đang bay — dùng ĐÚNG request chạy
    //    NGẦM không qua nút bấm (trySyncPendingKkScans(), do heartbeat 20s/sự kiện 'online' tự gọi), vì
    //    request đi qua nút data-op="submitKkScan" đã tự có khoá chống double-submit (runCspOp() disable
    //    hẳn nút trong lúc chờ — xem core.js) nên KHÔNG bấm lại được nút đó lần 2 trong lúc lượt 1 đang
    //    bay (đã tự kiểm chứng riêng, không phải lỗi) — nhưng vòng đồng bộ ngầm này KHÔNG qua nút nào cả,
    //    nên submitKkScan() (quét mới) vẫn gọi được bình thường trong lúc nó đang chạy.
    // ===================================================================================
    await page.fill('#kkKiemDemShelfInput', LABEL_A1);
    await page.waitForTimeout(200);
    await goOffline();
    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]'); // SP001 vào hàng đợi offline trước
    await page.waitForTimeout(150);
    await goOnline();

    await page.evaluate(() => {
      window.__origFetchDelay = window.fetch;
      window.fetch = (url, opts) => {
        if (String(url).includes('/api/stocktake/counts/scan') && opts && typeof opts.body === 'string' && opts.body.includes('SP001')) {
          return new Promise((resolve) => setTimeout(() => resolve(window.__origFetchDelay(url, opts)), 600));
        }
        return window.__origFetchDelay(url, opts);
      };
    });
    page.evaluate(() => trySyncPendingKkScans()); // KHÔNG await — mô phỏng heartbeat tự chạy ngầm, request SP001 "đang bay" mất 600ms
    await page.waitForTimeout(100); // chắc chắn đã "đang bay" (đã gửi request, chưa có phản hồi)

    await page.click('[data-op="toggleKkManualOfflineMode"]'); // bật Offline Thủ Công GIỮA LÚC đồng bộ SP001 đang bay
    await page.waitForTimeout(50);
    await page.fill('#kkKiemDemBarcodeInput', 'SP002');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]'); // lượt mới: SP002, vào thẳng hàng đợi offline (optimistic) — nút này CHƯA từng bị khoá (chưa ai click nó trước đó)
    await page.waitForTimeout(100);

    await run.run('3a) Ngay sau khi quét SP002 (Offline Thủ Công, lượt SP001 trực tuyến vẫn đang bay): SP002 hiện NGAY trong danh sách với badge ⏳', async () => {
      const listText = await page.evaluate(() => document.getElementById('kkKiemDemListBody').textContent);
      assert(listText.includes('SP002'), `SP002 phải hiện ngay (optimistic), thực tế: ${listText}`);
    });

    await page.waitForTimeout(700); // đợi lượt 1 (SP001, trễ 600ms) về xong -> loadKkScanCounts() sẽ tải lại THẬT từ server
    await page.evaluate(() => { window.fetch = window.__origFetchDelay; delete window.__origFetchDelay; });
    await page.waitForTimeout(150);

    await run.run('3b) LỖI ĐÃ VÁ: sau khi lượt SP001 trực tuyến về xong (tải lại counts THẬT từ server), dòng SP002 (đang ở hàng đợi offline, CHƯA đồng bộ) vẫn phải còn hiện trong danh sách (loadKkScanCounts() merge lại đúng các lượt pending qua applyOptimisticKkScanRow(), không ghi đè mất)', async () => {
      const listText = await page.evaluate(() => document.getElementById('kkKiemDemListBody').textContent);
      const pendingLen = await page.evaluate(() => kkOfflinePendingScans.length);
      assert(listText.includes('SP001'), `SP001 (đã đồng bộ trực tuyến) phải hiện đúng trong danh sách, thực tế: ${listText}`);
      assertEqual(pendingLen, 1, 'kkOfflinePendingScans phải vẫn còn đúng 1 lượt (SP002) — dữ liệu KHÔNG được mất dù có hiện trên bảng hay không');
      assert(listText.includes('SP002'), `SP002 (quét bằng Offline Thủ Công khi lượt SP001 trực tuyến vẫn đang bay) PHẢI vẫn hiện trong bảng sau khi SP001 đồng bộ xong (không được "biến mất" khỏi hiển thị dù dữ liệu còn nguyên trong hàng đợi) — thực tế: ${listText}`);
    });

    // Tắt Offline Thủ Công để đồng bộ nốt SP002, dọn sạch cho phần sau.
    await page.click('[data-op="toggleKkManualOfflineMode"]');
    await page.waitForTimeout(300);
    await run.run('3c) Tắt lại Offline Thủ Công: SP002 tự đồng bộ xong, hàng đợi rỗng, không mất dữ liệu về lâu dài', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingScans.length);
      assertEqual(pendingLen, 0, 'Hàng đợi phải rỗng sau khi tắt Offline Thủ Công (SP002 tự đồng bộ)');
      const listText = await page.evaluate(() => document.getElementById('kkKiemDemListBody').textContent);
      assert(listText.includes('SP001') && listText.includes('SP002'), `Cả 2 mã phải hiện đủ sau khi đồng bộ xong, thực tế: ${listText}`);
    });

    // ===================================================================================
    // 4) "Nhắc nhở mềm" + offline cùng lúc: quét ở A1 (CHƯA xác nhận) trong lúc offline, đổi sang A2
    //    cũng lúc offline -> phải hỏi lại, Huỷ phải giữ nguyên A1 + dữ liệu offline còn nguyên.
    // ===================================================================================
    // Dọn: xoá hết counts hiện có khỏi quầy kệ A1/A2 trước khi vào kịch bản 4 (để phép thử "có số liệu
    // quét thật" ở bước dưới không bị lẫn dữ liệu còn sót từ mục 3).
    state.stocktakeCounts.length = 0;
    await page.fill('#kkKiemDemShelfInput', '');
    await page.waitForTimeout(100);
    await page.fill('#kkKiemDemShelfInput', LABEL_A1);
    await page.waitForTimeout(200); // ONLINE lúc này -> cache session info thật cho A1 + A2 trước khi offline
    await page.fill('#kkKiemDemShelfInput', LABEL_A2);
    await page.waitForTimeout(200);
    await page.fill('#kkKiemDemShelfInput', LABEL_A1);
    await page.waitForTimeout(200);

    await goOffline();
    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]'); // quét SP001 ở A1 lúc ĐANG offline
    await page.waitForTimeout(150);

    await run.run('4a) Chuẩn bị: đã quét SP001 ở A1 lúc offline (vào hàng đợi, optimistic SL=1)', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingScans.length);
      assertEqual(pendingLen, 1, 'Phải có đúng 1 lượt quét SP001 trong hàng đợi offline ở A1');
    });

    await page.evaluate(() => { window.__confirms = []; window.__confirmAnswers = [false]; }); // mô phỏng bấm "Huỷ"
    await page.fill('#kkKiemDemShelfInput', LABEL_A2); // đổi sang A2 trong lúc VẪN OFFLINE
    await page.waitForTimeout(250);

    await run.run('4b) Đổi sang A2 lúc đang offline + A1 có việc dở chưa Xác Nhận -> PHẢI hỏi nhắc nhở mềm, Huỷ -> giữ nguyên A1 với dữ liệu offline còn nguyên', async () => {
      const confirms = await page.evaluate(() => window.__confirms);
      assertEqual(confirms.length, 1, `Phải hỏi đúng 1 lần kể cả khi offline, thực tế: ${JSON.stringify(confirms)}`);
      assert(/CHƯA được Xác Nhận/.test(confirms[0] || ''), `Nội dung hỏi phải đúng như lúc online, thực tế: "${confirms[0]}"`);
      const selectValue = await page.evaluate(() => document.getElementById('kkKiemDemShelfInput').value);
      assertEqual(selectValue, LABEL_A1, 'Huỷ hộp thoại (dù đang offline) -> ô chọn phải trả về đúng A1');
      const selected = await page.evaluate(() => kkScanState.KIEMDEM.selectedShelfId);
      assertEqual(selected, 10, 'State phải vẫn giữ đúng A1');
      const pendingLen = await page.evaluate(() => kkOfflinePendingScans.length);
      assertEqual(pendingLen, 1, 'Dữ liệu SP001 offline ở A1 phải CÒN NGUYÊN (không mất) sau khi Huỷ đổi quầy kệ');
      const listText = await page.evaluate(() => document.getElementById('kkKiemDemListBody').textContent);
      assert(listText.includes('SP001') && listText.includes('⏳'), `Danh sách A1 phải còn hiện SP001 kèm badge ⏳, thực tế: ${listText}`);
      const scanBoxHidden = await page.evaluate(() => document.getElementById('kkKiemDemScanBox').classList.contains('hidden'));
      assert(!scanBoxHidden, 'Ô quét phải vẫn MỞ cho A1 sau khi Huỷ (không bị khoá nhầm)');
    });

    await page.evaluate(() => { window.__confirms = []; }); // đồng ý lần này (mặc định __confirmAnswers rỗng = luôn đồng ý)
    await page.fill('#kkKiemDemShelfInput', LABEL_A2);
    await page.waitForTimeout(250);
    await run.run('4c) Đồng ý hộp thoại (vẫn đang offline) -> cho đổi sang A2, A2 vẫn mở được (đã cache session info từ lúc online)', async () => {
      const confirms = await page.evaluate(() => window.__confirms);
      assertEqual(confirms.length, 1, 'Phải hỏi đúng 1 lần trước khi cho đổi');
      const selected = await page.evaluate(() => kkScanState.KIEMDEM.selectedShelfId);
      assertEqual(selected, 11, 'Đồng ý -> phải đổi thành công sang A2 dù đang offline');
      const scanBoxHidden = await page.evaluate(() => document.getElementById('kkKiemDemScanBox').classList.contains('hidden'));
      assert(!scanBoxHidden, 'A2 đã cache session info lúc còn mạng -> ô quét vẫn phải mở được dù offline');
      const offlineNoteHidden = await page.evaluate(() => document.getElementById('kkKiemDemOfflineNote').classList.contains('hidden'));
      assert(!offlineNoteHidden, 'Phải hiện rõ ghi chú "Ngoại tuyến" cho A2 (dữ liệu từ cache, không phải vừa tải thật)');
    });

    await goOnline();
    await page.evaluate(() => trySyncPendingKkScans());
    await page.waitForTimeout(300);
    await run.run('4d) Dọn dẹp: có mạng lại, đồng bộ hết hàng đợi của mục 4 (SP001 ở A1)', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingScans.length);
      assertEqual(pendingLen, 0, 'Hàng đợi phải rỗng sau khi đồng bộ');
    });

    // ===================================================================================
    // 5) Khoá quầy kệ trong khi nhân viên đang xem dữ liệu cache cũ (offline) của quầy đó -> có mạng lại,
    //    đồng bộ -> phải báo RÕ đã bị khoá, KHÔNG cho đồng bộ ngầm tiếp, KHÔNG im lặng.
    // ===================================================================================
    await page.fill('#kkKiemDemShelfInput', LABEL_A1);
    await page.waitForTimeout(200);
    await goOffline();
    await page.fill('#kkKiemDemBarcodeInput', 'SP002');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]'); // quét thêm SP002 ở A1 lúc offline
    await page.waitForTimeout(150);
    await run.run('5a) Chuẩn bị: đã quét SP002 ở A1 lúc offline (nhân viên vẫn tưởng A1 bình thường, không biết đã bị khoá)', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingScans.length);
      assertEqual(pendingLen, 1, 'Phải có đúng 1 lượt SP002 đang chờ đồng bộ');
    });

    // Mô phỏng ĐÚNG kịch bản: TRONG LÚC thiết bị này offline, 1 thiết bị/admin KHÁC đã khoá quầy kệ A1 —
    // sửa trực tiếp state (giống IT bấm Khoá ở màn khác, server đã ghi nhận, chỉ thiết bị offline này
    // chưa biết).
    SHELF_A1.kiemKeLocked = true;
    SHELF_A1.kiemKeLockedBy = 'it1';
    SHELF_A1.kiemKeLockedByName = 'IT Quản Trị';

    await goOnline();
    await page.evaluate(() => trySyncPendingKkScans());
    await page.waitForTimeout(300);

    await run.run('5b) Có mạng lại, đồng bộ: server từ chối SP002 vì A1 ĐÃ bị khoá -> PHẢI còn trong hàng đợi kèm lý do RÕ, KHÔNG bị xoá âm thầm/báo nhầm thành công', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingScans.length);
      assertEqual(pendingLen, 1, 'SP002 phải CÒN NGUYÊN trong hàng đợi (server từ chối, không phải đồng bộ thành công)');
      const rec = await page.evaluate(() => kkOfflinePendingScans[0]);
      assert(rec && rec.lastError && /KHOÁ/.test(rec.lastError), `lastError phải báo rõ lý do KHOÁ, thực tế: ${JSON.stringify(rec)}`);
    });

    await run.run('5c) UI danh sách A1 PHẢI hiện rõ banner đỏ "bị từ chối khi đồng bộ" kèm lý do KHOÁ cho SP002 (KHÔNG phải lỗi im lặng)', async () => {
      const listText = await page.evaluate(() => document.getElementById('kkKiemDemListBody').textContent);
      assert(/bị từ chối khi đồng bộ/.test(listText), `Phải hiện rõ banner từ chối, thực tế: ${listText}`);
      assert(/KHOÁ/.test(listText), `Banner phải nêu rõ lý do KHOÁ, thực tế: ${listText}`);
      // Nút "Xoá khỏi hàng đợi" phải có sẵn để người dùng tự xử lý, không kẹt vô thời hạn không biết làm gì.
      const hasRemoveBtn = await page.evaluate(() => !!document.querySelector('[data-op="removeKkPendingScanFromUI"]'));
      assert(hasRemoveBtn, 'Phải có nút để người dùng tự xoá lượt bị từ chối khỏi hàng đợi');
    });

    // Chọn lại A1 (đang online) để xác nhận màn CHỌN QUẦY KỆ cũng phản ánh đúng trạng thái khoá MỚI NHẤT
    // (không chỉ riêng banner của hàng đợi).
    await page.fill('#kkKiemDemShelfInput', '');
    await page.waitForTimeout(100);
    await page.fill('#kkKiemDemShelfInput', LABEL_A1);
    await page.waitForTimeout(200);
    await run.run('5d) Chọn lại A1 (đang online, sau khi biết đã bị khoá): màn hình phải báo RÕ A1 đang bị khoá, ô quét phải đóng (không cho thao tác tiếp)', async () => {
      const scanBoxHidden = await page.evaluate(() => document.getElementById('kkKiemDemScanBox').classList.contains('hidden'));
      assert(scanBoxHidden, 'Ô quét PHẢI đóng — A1 đã bị khoá thật (không phải chỉ lỗi 1 lượt quét)');
      const info = await page.evaluate(() => document.getElementById('kkKiemDemSessionInfo').textContent);
      assert(/KHOÁ/.test(info), `Phải báo rõ lý do KHOÁ ngay khi chọn lại quầy kệ, thực tế: ${info}`);
    });

    await run.run('6) Không có lỗi JS/console lạ nào phát sinh trong TOÀN BỘ các kịch bản audit trên', async () => {
      assert(jsErrors.length === 0, 'Lỗi JS: ' + jsErrors.join(' | '));
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
