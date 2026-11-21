// jobs/dsmartAutoDeleteExpiredPrices.js — "🔁 Tự động xoá khi hết hạn" (Hỗ Trợ IT > "💰 Cài Đặt Giá Bán
// Buôn", 12/2026, theo yêu cầu người dùng: "cứ cái nào hết hạn nó tự động xóa và sẽ xóa vào 23 giờ cùng
// ngày hết hạn. Hoặc cho phép tôi set cái thời gian xóa cùng ngày hết hạn là bao nhiêu"). Chạy định kỳ
// (10 phút/lần — đủ sát giờ đã đặt mà không cần job theo phút), với MỖI dòng ACTIVE của
// dbo.DsmartWholesalePriceEntries có TO_DATE <= hôm nay VÀ đã qua giờ:phút đã cấu hình (nếu TO_DATE =
// hôm nay) hoặc TO_DATE đã qua từ trước (không cần chờ gì thêm, coi như "đã trễ hạn xoá") — XOÁ THẬT khỏi
// CSPRICE (dùng chung lib/dsmartSqlClient.js với luồng xoá tay routes/dsmartWholesalePrice.js), đánh dấu
// local entry DELETED (mode AUTO).
//
// AN TOÀN: tắt hẳn (không chạy gì) nếu dsmartPriceDbConfig.autoDeleteEnabled=false (mặc định) hoặc chưa
// cấu hình kết nối — không bao giờ tự ý bật ngầm. Lỗi xoá 1 dòng (VD mất kết nối DSmart) KHÔNG làm hỏng
// các dòng khác trong cùng lượt chạy — log cảnh báo rõ ràng, tự thử lại ở lượt chạy kế tiếp (dòng vẫn giữ
// nguyên ACTIVE nếu xoá thất bại, không đánh dấu DELETED sai).
const { getRawConfig } = require('../lib/dsmartPriceConfigStore');
const { deleteWholesalePrice } = require('../lib/dsmartSqlClient');
const { getAllForCollection, withLockedRecordForCollection, withAppLock } = require('../lib/recordStore');
const { insertSystemLog } = require('../lib/systemLogStore');
// Email thông báo Xoá thành công + hàng đợi tự động thử lại (12/2026, theo yêu cầu người dùng — xem chú
// thích đầy đủ ở lib/dsmartPriceNotify.js/lib/dsmartStoreFanOutRetryStore.js). GỘP 1 email DUY NHẤT cho
// CẢ LƯỢT CHẠY, không phải 1 email/dòng.
const { notifyDsmartPriceDeleteBatch } = require('../lib/dsmartPriceNotify');
const retryQueueStore = require('../lib/dsmartStoreFanOutRetryStore');

function todayDateOnlyIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// dueForAutoDelete(): TO_DATE đã qua hẳn (< hôm nay) -> xoá ngay không chờ gì thêm (đã trễ hạn, không có
// lý do giữ thêm); TO_DATE = hôm nay -> chỉ xoá khi đã qua đúng giờ:phút đã cấu hình.
function dueForAutoDelete(entry, now, cfg) {
  const today = todayDateOnlyIso(now);
  if (entry.toDate < today) return true;
  if (entry.toDate > today) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const dueMinutes = (cfg.autoDeleteHour || 0) * 60 + (cfg.autoDeleteMinute || 0);
  return nowMinutes >= dueMinutes;
}

async function runDsmartAutoDeleteExpiredPrices() {
  let cfg;
  try {
    cfg = await getRawConfig();
  } catch (err) {
    console.error('⛔ jobs/dsmartAutoDeleteExpiredPrices: không đọc được cấu hình —', err.message);
    return { skipped: true, reason: 'config-read-error' };
  }
  if (!cfg || !cfg.autoDeleteEnabled) return { skipped: true, reason: 'disabled' };

  const now = new Date();
  let entries;
  try {
    entries = await getAllForCollection('dsmartWholesalePriceEntries');
  } catch (err) {
    console.error('⛔ jobs/dsmartAutoDeleteExpiredPrices: không đọc được danh sách giá —', err.message);
    return { skipped: true, reason: 'entries-read-error' };
  }

  const due = entries.filter(e => e.status === 'ACTIVE' && dueForAutoDelete(e, now, cfg));
  let deletedCount = 0, errorCount = 0;
  // errorDetails: audit chéo (12/2026) phát hiện trước đây hệ thống chỉ ghi SỐ LƯỢNG lỗi vào System Log,
  // lý do thật chỉ ra console.error (đội vận hành xem được System Log trên UI nhưng KHÔNG có quyền truy
  // cập console server) — lưu thêm vài dòng lỗi đầu tiên vào mô tả để đội IT tự chẩn đoán ngay trên UI.
  const errorDetails = [];
  // deletedItems (12/2026): gom lại TẤT CẢ dòng xoá thành công trong LƯỢT CHẠY này — gửi GỘP 1 email
  // thông báo DUY NHẤT ở cuối job, không phải 1 email/dòng.
  const deletedItems = [];
  for (const e of due) {
    try {
      // LỖI THẬT đã vá (audit chéo trước deploy, 12/2026): job này TRƯỚC ĐÂY gọi deleteWholesalePrice()
      // THẲNG, KHÔNG khoá theo withAppLock(`dsmartWholesalePrice:${custId}:${skuId}`) như POST /apply và
      // job "Lên Lịch Áp Giá" (dsmartAutoApplyScheduledPrices.js) đang dùng — 2 job này CÙNG cadence 10
      // phút, khởi động gần như đồng thời (server.js). Nếu giá CŨ (ACTIVE, TO_DATE vừa hết hạn) và giá
      // MỚI (SCHEDULED, FR_DATE=hôm nay) là CÙNG 1 cặp CUST_ID/SKU_ID (tình huống "lên lịch nối tiếp giá
      // sắp hết hạn" — cách dùng điển hình), 2 job có thể chạy chồng nhau: job Lên Lịch ghi đè CSPRICE
      // bằng giá mới TRƯỚC, job Xoá Hết Hạn (không khoá) vẫn XOÁ dòng đó theo cùng khoá tự nhiên NGAY SAU
      // — mất trắng giá mới trên CSPRICE dù mirror nội bộ vẫn báo "ACTIVE" (giá treo, không có thật).
      // Vá: khoá ĐÚNG CÙNG khoá `dsmartWholesalePrice:${custId}:${skuId}` — job nào giành khoá trước thì
      // job kia phải CHỜ, và BẮT BUỘC đọc lại (fresh) trạng thái entry NGAY TRONG khoá trước khi quyết
      // định xoá (không tin snapshot `e` đọc TRƯỚC khi giành khoá) — nếu entry đã bị đổi bởi thao tác
      // khác (VD Lên Lịch vừa ghi đè, hoặc người dùng vừa Sửa/Xoá tay) trong lúc chờ khoá, bỏ qua dòng
      // này (coi như không còn đến hạn xoá nữa), không xoá nhầm dòng CSPRICE vừa được ghi mới.
      const acted = await withAppLock(`dsmartWholesalePrice:${e.custId}:${e.skuId}`, async () => {
        const freshList = await getAllForCollection('dsmartWholesalePriceEntries');
        const fresh = freshList.find(x => x.id === e.id);
        if (!fresh || fresh.status !== 'ACTIVE' || !dueForAutoDelete(fresh, now, cfg)) return false;
        const { storeResults, storeFanOutError } = await deleteWholesalePrice({ dsmartKey: fresh.dsmartKey });
        await withLockedRecordForCollection('dsmartWholesalePriceEntries', fresh.id, (item) => {
          if (item.status !== 'ACTIVE') return item; // đã bị xoá bởi thao tác khác trong lúc job đang chạy
          const nowIso = now.toISOString();
          return {
            ...item, status: 'DELETED', deletedBy: null, deletedAt: nowIso, lastAutoDeleteError: null, lastAutoDeleteAt: null,
            history: [...(item.history || []), { action: 'DELETE', mode: 'AUTO', actor: null, at: nowIso, storeResults }]
          };
        });
        deletedItems.push({ custId: fresh.custId, skuId: fresh.skuId, entryId: fresh.id, storeResults, storeFanOutError });
        retryQueueStore.enqueueFailedStores({
          storeResults, action: 'DELETE', entryId: fresh.id, custId: fresh.custId, skuId: fresh.skuId,
          payload: { dsmartKey: fresh.dsmartKey }
        }).catch(() => {});
        return true;
      });
      if (acted) deletedCount++;
    } catch (err) {
      errorCount++;
      console.error(`⛔ jobs/dsmartAutoDeleteExpiredPrices: xoá thất bại ID nội bộ=${e.id} (CustId=${e.custId}/SkuId=${e.skuId}) —`, err.message);
      if (errorDetails.length < 5) errorDetails.push(`${e.custId}/${e.skuId}: ${err.message}`);
      // lastAutoDeleteError/At (12/2026, theo yêu cầu người dùng — cờ trạng thái "đã xoá hay chưa", xem
      // chú thích đầy đủ tại dsmartAutoApplyScheduledPrices.js) — ghi lại lần thử gần nhất lỗi gì ngay
      // trên entry, để UI "2. Quản Lý Giá Đã Hết Hạn" hiện rõ dòng nào đang kẹt lỗi tự động xoá. Job vẫn
      // tự thử lại ở lượt chạy kế tiếp (entry giữ nguyên ACTIVE) — không cần cơ chế retry riêng.
      try {
        await withLockedRecordForCollection('dsmartWholesalePriceEntries', e.id, (item) => {
          if (item.status !== 'ACTIVE') return item;
          return { ...item, lastAutoDeleteError: err.message || 'Lỗi không xác định', lastAutoDeleteAt: new Date().toISOString() };
        });
      } catch (_) { /* phớt lờ lỗi ghi lại trạng thái, không chặn các dòng khác */ }
    }
  }
  if (deletedCount || errorCount) {
    const errorNote = errorDetails.length
      ? ` — ${errorDetails.join(' | ')}${errorCount > errorDetails.length ? ` (và ${errorCount - errorDetails.length} lỗi khác, xem log server)` : ''}`
      : '';
    insertSystemLog({
      username: 'SYSTEM', fullName: 'Hệ thống (tự động)', ipAddress: null, module: 'IT_SUPPORT',
      actionType: 'AUTO_DELETE_DSMART_PRICE', targetObject: 'dsmartWholesalePriceEntries',
      description: `Tự động xoá giá bán buôn hết hạn: ${deletedCount} thành công, ${errorCount} lỗi${errorNote}`,
      status: errorCount && !deletedCount ? 'FAILED' : 'SUCCESS'
    }).catch(() => {});
  }
  if (deletedItems.length) {
    notifyDsmartPriceDeleteBatch({ mode: 'AUTO', actor: null, items: deletedItems }).catch(() => {});
  }
  return { skipped: false, deletedCount, errorCount, checked: due.length };
}

module.exports = { runDsmartAutoDeleteExpiredPrices };
