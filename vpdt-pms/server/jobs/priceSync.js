// jobs/priceSync.js — Đồng bộ ngầm "bảng giá" của 1 siêu thị cho "💲 Kiểm Tra Giá" (12/2026, theo yêu
// cầu người dùng: "tự đồng bộ giá của siêu thị xuống trình duyệt người dùng, tra giá nhanh hơn, offline
// cả bảng giá"). KHÁC HẲN jobs/inventorySync.js: đối tác BRGMART KHÔNG có API bulk giá (chỉ có API tra
// ĐÚNG 1 mã/lần, lib/priceCheckApiClient.js) — job này tự "dựng bulk giả" bằng cách LẶP qua từng mã hàng
// ĐÃ BIẾT của đúng Mã Điểm (lấy từ SystemInventorySnapshots đã đồng bộ sẵn — KHÔNG gọi thêm API tồn kho)
// rồi gọi API giá cho TỪNG mã, gộp kết quả lại lưu vào dbo.StorePriceSnapshots (lib/priceSnapshotStore.js).
//
// QUYẾT ĐỊNH THIẾT KẾ (đã trao đổi + xác nhận với người dùng trước khi code — nêu rõ để góp ý nếu cần đổi):
// - CHỈ đồng bộ cho siêu thị NÀO THỰC SỰ có người vào tab Kiểm Soát Hàng Hóa/Kiểm Tra Giá — KHÔNG chạy
//   lịch cố định mù cho MỌI siêu thị (người dùng xác nhận rõ: "chỉ đồng bộ siêu thị nào có người vào tab"
//   — siêu thị không hoạt động hôm đó không tốn lượt gọi đối tác). Trigger: routes/shelfStock.js GET
//   /price-catalog tự gọi syncStorePriceCatalog({force:false}) KHÔNG AWAIT (fire-and-forget) mỗi lần có
//   người mở tab — cùng tinh thần "tự có dữ liệu mới, không chờ job nền" đã áp dụng cho Tồn Kho, nhưng
//   KHÔNG có tick nền độc lập nào chạy cho mọi siêu thị (khác hẳn jobs/inventorySync.js).
// - Chu kỳ làm mới ĐẦY ĐỦ: 1 LẦN/NGÀY (PRICE_SYNC_INTERVAL_MS) — giá đổi ít hơn tồn kho nhiều, không cần
//   mịn như 20 phút của Tồn Kho. Trả NGAY bản đang có (dù cũ tới 1 ngày) cho người dùng dùng tạm trong
//   lúc job chạy nền — không ai phải chờ vòng lặp hàng nghìn lượt gọi mới thấy được giá.
// - Trả lời xong request NGAY bằng bản snapshot đang có trong CSDL (có thể null nếu lần đầu chưa từng
//   đồng bộ) RỒI MỚI kích hoạt vòng lặp đồng bộ ở nền — route KHÔNG BAO GIỜ await syncStorePriceCatalog()
//   (sẽ treo request hàng chục giây/vài phút nếu catalog lớn).
// - "Giành chỗ" chống nhiều request/tiến trình PM2 cluster cùng lúc tự chạy vòng lặp cho CÙNG 1 Mã Điểm
//   (nhiều nhân viên cùng mở tab gần như đồng thời) — qua AppData "priceSyncLocks" (object nhỏ, KHÔNG
//   phải bảng SQL riêng vì chỉ là tín hiệu tạm thời, không phải dữ liệu nghiệp vụ cần bền/truy vấn).
//   Khoá coi là "treo"/crash giữa chừng sau PRICE_SYNC_LOCK_STALE_MS, tự cho phép giành lại.
// - Lỗi xác thực (401/403, PriceCheckApiAuthError) ở BẤT KỲ mã nào → DỪNG HẲN vòng lặp ngay (tiếp tục chỉ
//   tốn hàng nghìn lượt gọi chắc chắn thất bại) — khác lỗi 404 "không có giá cho mã này" (bỏ qua mã đó,
//   đi tiếp, không phải lỗi hệ thống — có mã hiển thị trên kệ nhưng đối tác chưa/không còn bán).
// - Pacing giữa các lượt gọi đối tác (PRICE_SYNC_PACE_MS) — tránh dồn dập hàng nghìn request liên tiếp
//   lên đối tác trong vài giây.
const { resolveInventoryApiCreds, getSystemInventoryForMaDiem } = require('./inventorySync');
const { getAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { getSnapshotForMaDiemMerged, replaceSnapshotForMaDiem } = require('../lib/priceSnapshotStore');
const { checkPrice, PriceCheckApiAuthError } = require('../lib/priceCheckApiClient');
const { aggregateSystemInventoryRowsByMaHang } = require('../lib/shelfInventoryAggregate');

const PRICE_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 lần/ngày — có thể làm UI cấu hình sau nếu cần, giống Tồn Kho
const PRICE_SYNC_LOCK_STALE_MS = 15 * 60 * 1000; // coi khoá "treo" sau 15 phút (đủ dư cho vòng lặp vài nghìn mã)
const PRICE_SYNC_PACE_MS = parseInt(process.env.PRICE_SYNC_PACE_MS || '200', 10); // nghỉ giữa mỗi lượt gọi đối tác

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// "Giành chỗ" — trả true nếu GIÀNH ĐƯỢC (chưa ai đang chạy/khoá đã treo quá lâu), false nếu đã có tiến
// trình khác đang chạy ĐÚNG Mã Điểm này. CÙNG khuôn "giành chỗ" ở syncSystemInventory() (jobs/inventorySync.js)
// — cập nhật lock TRƯỚC khi chạy việc chậm, không giữ trong transaction.
async function claimPriceSyncSlot(maDiem) {
  let claimed = false;
  await withLockedAppDataValue('priceSyncLocks', (locks) => {
    const current = locks || {};
    const existing = current[maDiem];
    if (existing && (Date.now() - new Date(existing).getTime()) < PRICE_SYNC_LOCK_STALE_MS) {
      return current; // đã có tiến trình khác đang chạy, không đổi gì
    }
    claimed = true;
    return { ...current, [maDiem]: new Date().toISOString() };
  });
  return claimed;
}

async function releasePriceSyncSlot(maDiem) {
  try {
    await withLockedAppDataValue('priceSyncLocks', (locks) => {
      const current = { ...(locks || {}) };
      delete current[maDiem];
      return current;
    });
  } catch (err) {
    console.error('⛔ jobs/priceSync: không gỡ được khoá đồng bộ giá —', err.message);
  }
}

// syncStorePriceCatalog(maDiemRaw, {force}) — maDiemRaw có thể là "217" hoặc "217,305" (nhiều Mã Điểm
// gộp, xem chú thích getSnapshotForMaDiemMerged()/lib/priceSnapshotStore.js) — ĐỒNG BỘ TỪNG Mã Điểm một
// (mỗi Mã Điểm là 1 dòng SQL riêng), không gộp chung payload của nhiều Mã Điểm vào 1 dòng.
async function syncStorePriceCatalog(maDiemRaw, { force = false } = {}) {
  const codes = [...new Set(String(maDiemRaw || '').split(',').map((s) => s.trim()).filter(Boolean))];
  if (!codes.length) return { skipped: true, reason: 'no_ma_diem' };

  const creds = await resolveInventoryApiCreds();
  if (!creds) return { skipped: true, reason: 'not_configured' };

  const results = [];
  for (const maDiem of codes) {
    results.push(await syncOneMaDiem(maDiem, creds, force));
  }
  return { results };
}

async function syncOneMaDiem(maDiem, creds, force) {
  if (!force) {
    const existing = await getSnapshotForMaDiemMerged(maDiem);
    if (existing && existing.fetchedAt && (Date.now() - new Date(existing.fetchedAt).getTime()) < PRICE_SYNC_INTERVAL_MS) {
      return { maDiem, skipped: true, reason: 'not_due' };
    }
  }

  const claimed = await claimPriceSyncSlot(maDiem);
  if (!claimed) return { maDiem, skipped: true, reason: 'already_in_progress' };

  try {
    // Lấy danh sách mã hàng ĐÃ BIẾT của đúng Mã Điểm này từ snapshot Tồn Kho đã đồng bộ sẵn — KHÔNG gọi
    // thêm API tồn kho (job Tồn Kho tự lo việc đó theo chu kỳ riêng của nó). Gộp theo maHang trước (cùng
    // hàm dùng ở routes/shelfStock.js GET /system-inventory) để không tra giá trùng lặp cho các dòng thô
    // đối tác trả nhiều lần cho CÙNG 1 mã hàng.
    const inventoryEntry = await getSystemInventoryForMaDiem(maDiem);
    if (!inventoryEntry || !inventoryEntry.rows || !inventoryEntry.rows.length) {
      return { maDiem, skipped: true, reason: 'no_inventory_data' };
    }
    const aggregated = aggregateSystemInventoryRowsByMaHang(inventoryEntry.rows);
    const maHangList = aggregated.map((r) => r.maHang).filter(Boolean);

    const priceRows = [];
    let errorCount = 0;
    for (const maHang of maHangList) {
      try {
        const price = await checkPrice({ baseUrl: creds.baseUrl, apiKey: creds.apiKey, maHang, maDiem });
        priceRows.push(price);
      } catch (err) {
        if (err instanceof PriceCheckApiAuthError) {
          // Lỗi xác thực — tiếp tục lặp hàng nghìn mã còn lại CHẮC CHẮN cũng thất bại, dừng hẳn ngay.
          console.error(`⛔ jobs/priceSync: lỗi xác thực API Giá Bán (Mã Điểm ${maDiem}), dừng vòng lặp —`, err.message);
          throw err;
        }
        // Lỗi khác (404 không có giá cho mã này, timeout tạm thời...) — bỏ qua mã đó, đi tiếp, không chặn
        // cả lượt đồng bộ vì 1 mã lỗi (mã hiển thị trên kệ nhưng đối tác chưa/không còn bán, bình thường).
        errorCount++;
      }
      if (PRICE_SYNC_PACE_MS > 0) await sleep(PRICE_SYNC_PACE_MS);
    }

    const fetchedAt = new Date();
    const capNhatLuc = priceRows.reduce((latest, r) => (r.capNhatLuc && (!latest || r.capNhatLuc > latest)) ? r.capNhatLuc : latest, null);
    await replaceSnapshotForMaDiem(maDiem, { rows: priceRows, capNhatLuc }, fetchedAt);
    const message = `Đồng bộ bảng giá Mã Điểm ${maDiem}: ${priceRows.length}/${maHangList.length} mã có giá, ${errorCount} mã bỏ qua.`;
    console.log(`✅ jobs/priceSync: ${message}`);
    return { maDiem, ok: true, itemCount: priceRows.length, errorCount };
  } catch (err) {
    console.error(`⛔ jobs/priceSync: lỗi đồng bộ bảng giá Mã Điểm ${maDiem} (giữ nguyên cache cũ) —`, err.message);
    return { maDiem, ok: false, error: err.message };
  } finally {
    await releasePriceSyncSlot(maDiem);
  }
}

module.exports = { syncStorePriceCatalog, PRICE_SYNC_INTERVAL_MS, claimPriceSyncSlot, releasePriceSyncSlot };
