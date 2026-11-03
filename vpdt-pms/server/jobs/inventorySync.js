// jobs/inventorySync.js — Đồng bộ nền "Tồn Kho Hệ Thống" (API BRGMART, tài liệu v1.1 10/2026) cho Đối
// Chiếu Kệ & Tồn Kho (Kiểm Soát Hàng Hóa, Vận Hành). API trả về TOÀN BỘ siêu thị trong 1 lần gọi (có
// phân trang, xem lib/inventoryApiClient.js) — job này tự lấy hết, gom theo maDiem rồi LƯU VÀO
// dbo.AppData (khoá "systemInventorySnapshot", qua lib/appData.js — KHÔNG còn giữ cache TRONG TIẾN
// TRÌNH NODE như trước v28.84). routes/shelfStock.js (GET /system-inventory) đọc dữ liệu này theo ĐÚNG
// maDiem đã tra từ dept người gọi — dữ liệu không tự nó biết gì về user/dept, chỉ là 1 bảng tra theo
// maDiem.
//
// LÝ DO CHUYỂN TỪ CACHE RAM SANG CSDL (v28.84, người dùng phát hiện + yêu cầu): server chạy PM2 cluster
// mode (ecosystem.config.js, instances:'max' — nhiều tiến trình Node song song, 1 tiến trình/lõi CPU),
// nhưng job đồng bộ CHỈ chạy ở ĐÚNG 1 tiến trình (isSchedulerInstance, xem server.js — tránh gọi API đối
// tác lặp N lần/chu kỳ). Khi cache còn nằm trong Map RAM của tiến trình đó, các tiến trình worker KHÁC
// (KHÔNG BAO GIỜ tự chạy job) sẽ mãi mãi không có dữ liệu trong Map RIÊNG của chúng — người dùng bị PM2
// định tuyến vào 1 trong các tiến trình đó sẽ LUÔN thấy "Chưa có dữ liệu tồn kho hệ thống" dù đồng bộ
// vẫn chạy đúng ở tiến trình #0 — đây là LỖI THẬT đang tồn tại trên production (không phải lý thuyết),
// chỉ không lộ rõ nếu người dùng tình cờ luôn được định tuyến vào đúng tiến trình #0. Lưu vào dbo.AppData
// (cùng cơ chế đã dùng cho "inventoryApiConfig") để MỌI tiến trình đọc chung 1 nguồn + sống sót qua
// restart/deploy. Giá trị LUÔN bị GHI ĐÈ HOÀN TOÀN mỗi lần đồng bộ thành công (setAppDataValue — không
// phải đọc-sửa-ghi từng phần) — đúng bản chất "tồn kho tại thời điểm hiện tại", KHÔNG giữ lịch sử, KHÔNG
// tích luỹ dung lượng theo thời gian (1 bản ghi AppData duy nhất, luôn bị thay thế toàn bộ).
//
// QUYẾT ĐỊNH THIẾT KẾ (chưa có đặc tả chính thức, nêu rõ để góp ý nếu cần đổi):
// - Chu kỳ đồng bộ: 20 phút/lần (trong khoảng 15-30 phút tài liệu khuyến nghị — khớp đúng độ trễ đồng bộ
//   15 phút của chính API, không gọi dồn dập, không để dữ liệu cũ quá lâu).
// - Chạy 1 lần NGAY lúc server khởi động (không chờ hết 20 phút đầu) — cùng khuôn mọi job nhắc hạn khác
//   trong server.js.
// - Lỗi xác thực (401/403, lib/inventoryApiClient.js InventoryApiAuthError): log cảnh báo RÕ + KHÔNG tự
//   retry ở job (đổi key/IP mới chạy lại được, retry vô ích) — vẫn tự chạy lại ở chu kỳ 20 phút kế tiếp
//   như thường (phòng trường hợp admin vừa sửa lại key/IP).
// - Lỗi mạng/server tạm thời: log cảnh báo, giữ NGUYÊN cache cũ (không xoá) để Đối Chiếu vẫn hiển thị
//   được số liệu gần nhất thay vì trống trơn — chỉ cập nhật "capNhatLuc" khi có dữ liệu mới thật.
//
// NGUỒN cấu hình (11/2026, theo yêu cầu người dùng "sao không cho cấu hình API tồn kho trên app, bắt
// buộc .env tôi không chủ động được") — ƯU TIÊN THEO THỨ TỰ:
//   1. AppData "inventoryApiConfig" (màn admin "🧺 Cấu Hình API Tồn Kho", module-hethong-tabs.js) — Base
//      URL + API Key do CHÍNH ADMIN tự nhập qua giao diện, mã hoá 2 chiều (lib/emailCrypto.js). Vì
//      nguồn này do admin tự đổi qua UI (không cần quyền truy cập file/server), bắt buộc kiểm tra SSRF
//      (lib/ssrfGuard.js) trước mỗi lượt gọi thật — admin bị chiếm tài khoản không thể lợi dụng đổi Base
//      URL để dò quét/rò rỉ API Key vào mạng nội bộ.
//   2. Biến môi trường BRGMART_INVENTORY_API_BASE_URL/BRGMART_INVENTORY_API_KEY (.env) — ĐƯỜNG LÙI giữ
//      nguyên cho môi trường đã cấu hình theo cách cũ trước đợt này; nguồn này do người triển khai server
//      gõ trực tiếp vào máy (không qua giao diện), không áp SSRF guard (mức tin cậy khác hẳn — cùng cách
//      lib/inventoryApiClient.js đã ghi chú từ đầu).
// Mục (1) "enabled !== true" hoặc thiếu baseUrl/apiKeyEnc thì bỏ qua, rơi về mục (2) như cũ.
const { fetchAllSystemInventory, InventoryApiAuthError } = require('../lib/inventoryApiClient');
const { getAppDataValue, getAppDataValueCached, setAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { decryptSecret } = require('../lib/emailCrypto');
const { assertSafeExternalUrl } = require('../lib/ssrfGuard');

// Khoá AppData lưu snapshot tồn kho hệ thống — xem chú thích đầu file. Giá trị:
// { byMaDiem: { [maDiem]: { rows: Array, capNhatLuc: string|null, fetchedAt: string (ISO) } }, fetchedAt: string (ISO) }
const INVENTORY_SNAPSHOT_KEY = 'systemInventorySnapshot';

let lastSyncAttemptAt = null;
let lastSyncSuccessAt = null;
let lastSyncError = null;

// resolveInventoryApiCreds() — xem thứ tự ưu tiên ở chú thích đầu file. Trả { baseUrl, apiKey, source }
// hoặc null nếu CẢ 2 nguồn đều chưa cấu hình.
async function resolveInventoryApiCreds() {
  let cfg = null;
  try {
    cfg = await getAppDataValue('inventoryApiConfig');
  } catch (err) {
    // CSDL tạm thời không gọi được (hoặc key "inventoryApiConfig" chưa kịp seedDefaults() ở môi trường
    // vừa nâng cấp) — rơi về .env NGAY thay vì làm sập hẳn job, cùng tinh thần "lỗi mạng/server tạm thời
    // giữ nguyên cache cũ" ở đầu file (không để 1 sự cố đọc config biến thành mất luôn tính năng).
    console.error('⛔ jobs/inventorySync: không đọc được Cấu Hình API Tồn Kho từ CSDL, thử rơi về .env —', err.message);
  }
  if (cfg && cfg.enabled === true && cfg.baseUrl && cfg.apiKeyEnc) {
    try {
      return { baseUrl: cfg.baseUrl, apiKey: decryptSecret(cfg.apiKeyEnc), source: 'ui' };
    } catch (err) {
      console.error('⛔ jobs/inventorySync: không giải mã được API Key đã lưu qua Cấu Hình API Tồn Kho —', err.message);
      // Không rơi về .env ở nhánh này — admin ĐÃ bật qua UI nhưng dữ liệu hỏng, cần admin tự sửa lại
      // (vào Cấu Hình API Tồn Kho nhập lại key), không âm thầm dùng key .env khác ý admin.
      return null;
    }
  }
  if (process.env.BRGMART_INVENTORY_API_KEY && process.env.BRGMART_INVENTORY_API_KEY.trim()) {
    return {
      baseUrl: process.env.BRGMART_INVENTORY_API_BASE_URL || 'https://api.brgmart.vn',
      apiKey: process.env.BRGMART_INVENTORY_API_KEY,
      source: 'env'
    };
  }
  return null;
}

async function isInventoryApiConfigured() {
  return !!(await resolveInventoryApiCreds());
}

// writeInventorySyncStatus() — ghi lastSyncAt/lastSyncStatus/lastSyncMessage vào AppData "inventoryApiConfig"
// để màn Cấu Hình API Tồn Kho hiện được "Lần đồng bộ gần nhất" (cùng khuôn operationOrderApiConfig) — CHỈ
// ghi khi có cfg.enabled thật (nguồn UI đang dùng); đồng bộ qua nguồn .env (source 'env') thì không có gì
// để ghi lại (cfg rỗng mặc định, không có nút "Đồng Bộ Ngay" tương ứng ở UI đó). Lỗi ghi (VD key chưa
// seedDefaults() kịp) chỉ log, không chặn job.
async function writeInventorySyncStatus(status, message) {
  try {
    const cfg = await getAppDataValue('inventoryApiConfig');
    if (!cfg || cfg.enabled !== true) return;
    await withLockedAppDataValue('inventoryApiConfig', (current) => ({
      ...current, lastSyncAt: new Date().toISOString(), lastSyncStatus: status, lastSyncMessage: message
    }));
  } catch (err) {
    console.error('⛔ jobs/inventorySync: không ghi lại được trạng thái đồng bộ vào Cấu Hình API Tồn Kho —', err.message);
  }
}

async function syncSystemInventory() {
  const creds = await resolveInventoryApiCreds();
  if (!creds) {
    // Log 1 lần/chu kỳ là đủ rõ — không spam nếu admin cố ý chưa cấu hình (VD môi trường dev/staging).
    console.warn('⚠️  jobs/inventorySync: chưa cấu hình API Tồn Kho (qua UI lẫn .env) — Đối Chiếu Tồn Kho Hệ Thống tạm vô hiệu hoá.');
    return { skipped: true };
  }
  lastSyncAttemptAt = new Date();
  try {
    // allowPrivateRanges: true (11/2026, người dùng xác nhận Base URL BRGMART thật là domain NỘI BỘ
    // công ty, máy chủ VPDT + API đối tác cùng mạng nội bộ/VPN — mô hình triển khai on-premise bình
    // thường) — vẫn giữ chặn loopback/link-local/metadata cloud (xem lib/ssrfGuard.js), chỉ nới phần
    // RFC1918/CGNAT/ULA cho ĐÚNG nguồn 'ui' (admin tự xác nhận qua Cấu Hình API Tồn Kho).
    if (creds.source === 'ui') await assertSafeExternalUrl(creds.baseUrl, { allowPrivateRanges: true });

    const { rows, pagesFetched } = await fetchAllSystemInventory({ baseUrl: creds.baseUrl, apiKey: creds.apiKey, pageSize: 1000 });

    const grouped = new Map();
    for (const row of rows) {
      const maDiem = row && row.maDiem ? String(row.maDiem) : '';
      if (!maDiem) continue;
      if (!grouped.has(maDiem)) grouped.set(maDiem, []);
      grouped.get(maDiem).push(row);
    }
    const fetchedAt = new Date();
    const byMaDiem = {};
    for (const [maDiem, maDiemRows] of grouped) {
      const capNhatLuc = maDiemRows.reduce((latest, r) => (r.capNhatLuc && (!latest || r.capNhatLuc > latest)) ? r.capNhatLuc : latest, null);
      byMaDiem[maDiem] = { rows: maDiemRows, capNhatLuc, fetchedAt: fetchedAt.toISOString() };
    }
    // GHI ĐÈ HOÀN TOÀN — snapshot cũ (nếu có) bị thay thế trọn vẹn bởi lần đồng bộ mới này, đúng bản
    // chất "tồn kho tại thời điểm hiện tại" (xem chú thích đầu file). Chỉ ghi khi CHẮC CHẮN có dữ liệu
    // mới (đã qua khỏi mọi bước fetch/parse phía trên không lỗi) — lỗi ở bất kỳ bước nào trước đó nhảy
    // thẳng xuống catch(), KHÔNG chạy tới dòng này, nên snapshot cũ trong CSDL giữ nguyên như cam kết.
    await setAppDataValue(INVENTORY_SNAPSHOT_KEY, { byMaDiem, fetchedAt: fetchedAt.toISOString() });
    lastSyncSuccessAt = fetchedAt;
    lastSyncError = null;
    const message = `Đồng bộ thành công — ${rows.length} dòng, ${grouped.size} siêu thị, ${pagesFetched} trang.`;
    console.log(`✅ jobs/inventorySync: ${message}`);
    await writeInventorySyncStatus('SUCCESS', message);
    return { ok: true, rowCount: rows.length, storeCount: grouped.size, pagesFetched };
  } catch (err) {
    lastSyncError = err.message;
    if (err instanceof InventoryApiAuthError) {
      console.error('⛔ jobs/inventorySync: lỗi xác thực API Tồn Kho (kiểm tra lại API Key/IP đã đăng ký) —', err.message);
    } else {
      console.error('⛔ jobs/inventorySync: lỗi đồng bộ (giữ nguyên cache cũ) —', err.message);
    }
    await writeInventorySyncStatus('FAILED', err.message);
    return { ok: false, error: err.message };
  }
}

// Đọc snapshot theo ĐÚNG maDiem — route gọi hàm này SAU KHI đã tự tra maDiem từ dept người gọi (KHÔNG
// bao giờ nhận maDiem trực tiếp từ client, xem routes/shelfStock.js). Dùng getAppDataValueCached() (TTL
// vài giây + tự phát/nhận tín hiệu xoá cache qua PM2 IPC khi có tiến trình khác ghi — xem lib/appData.js)
// thay vì getAppDataValue() thường, để không phải round-trip CSDL ở MỌI request đọc màn Đối Chiếu trong
// khi vẫn đảm bảo MỌI tiến trình PM2 cluster thấy dữ liệu MỚI gần như ngay lập tức sau mỗi lần đồng bộ.
async function getSystemInventoryForMaDiem(maDiem) {
  if (!maDiem) return null;
  const snapshot = await getAppDataValueCached(INVENTORY_SNAPSHOT_KEY);
  const entry = snapshot && snapshot.byMaDiem ? snapshot.byMaDiem[String(maDiem)] : null;
  return entry || null;
}

async function getInventorySyncStatus() {
  const snapshot = await getAppDataValue(INVENTORY_SNAPSHOT_KEY);
  return {
    configured: await isInventoryApiConfigured(),
    lastSyncAttemptAt, lastSyncSuccessAt, lastSyncError,
    cachedStoreCount: snapshot && snapshot.byMaDiem ? Object.keys(snapshot.byMaDiem).length : 0
  };
}

module.exports = {
  syncSystemInventory, getSystemInventoryForMaDiem, getInventorySyncStatus, isInventoryApiConfigured,
  // resolveInventoryApiCreds — export riêng cho test (tests/test-inventory-api-config.js), để kiểm tra
  // đúng nguồn/giá trị được chọn (UI hay .env) mà không cần dựng 1 server HTTP public thật (Base URL
  // local test server luôn là 127.0.0.1, bị chính SSRF guard coi là nội bộ — không đại diện đúng cho
  // trường hợp domain BRGMART thật).
  resolveInventoryApiCreds
};
