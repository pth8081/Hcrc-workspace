// jobs/dsmartAutoApplyScheduledPrices.js — "📅 Lên Lịch Áp Giá" (Hỗ Trợ IT > "💰 Cài Đặt Giá Bán Buôn",
// 12/2026, theo yêu cầu người dùng: "giá sẽ theo ngày bắt đầu trong file excel và lịch tự động bắt ngày
// bắt đầu và áp giá từ 0 giờ, nếu người tạo chọn đặt lịch, còn không đặt lịch thì sẽ là áp giá luôn").
// Chạy định kỳ (10 phút/lần — cùng cadence jobs/dsmartAutoDeleteExpiredPrices.js, đủ sát "từ 0 giờ ngày
// bắt đầu" mà không cần job theo phút), với MỖI dòng status='SCHEDULED' của
// dbo.DsmartWholesalePriceEntries có FrDate <= hôm nay — GHI THẬT vào CSPRICE (insertWholesalePrice(),
// TỰ ĐỘNG kèm FAN-OUT xuống mọi siêu thị Enabled — xem lib/dsmartSqlClient.js, KHÔNG viết lại logic ghi
// riêng ở đây), chuyển status ACTIVE.
//
// KHÔNG CÓ CÔNG TẮC BẬT/TẮT RIÊNG (khác "Tự Động Xoá Khi Hết Hạn" vốn có autoDeleteEnabled toàn module) —
// "Lên Lịch" là lựa chọn TỪNG LƯỢT của người tạo (tick hay không tick lúc Thêm Giá Mới), không phải 1
// công tắc module-wide, nên job này LUÔN chạy nhưng không làm gì nếu không có dòng SCHEDULED nào đến hạn.
//
// AN TOÀN: lỗi ghi 1 dòng (VD mất kết nối DSmart) KHÔNG làm hỏng các dòng khác trong cùng lượt chạy — log
// cảnh báo rõ ràng, tự thử lại ở lượt chạy kế tiếp (dòng vẫn giữ nguyên SCHEDULED nếu áp thất bại).
const { insertWholesalePrice, DsmartConfigError } = require('../lib/dsmartSqlClient');
const { getAllForCollection, withLockedRecordForCollection, withAppLock } = require('../lib/recordStore');
const { insertSystemLog } = require('../lib/systemLogStore');

function todayDateOnlyIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function runDsmartAutoApplyScheduledPrices() {
  const today = todayDateOnlyIso();
  let entries;
  try {
    entries = await getAllForCollection('dsmartWholesalePriceEntries');
  } catch (err) {
    console.error('⛔ jobs/dsmartAutoApplyScheduledPrices: không đọc được danh sách giá —', err.message);
    return { skipped: true, reason: 'entries-read-error' };
  }

  const due = entries.filter(e => e.status === 'SCHEDULED' && e.frDate <= today);
  let appliedCount = 0, errorCount = 0;
  const errorDetails = [];
  let stoppedEarly = false;
  for (const e of due) {
    if (stoppedEarly) break;
    try {
      // Khoá theo đúng cặp (CUST_ID, SKU_ID) — CÙNG khoá routes/dsmartWholesalePrice.js::POST /apply dùng
      // — để 2 thao tác cùng chạm cặp này (VD người dùng "Thêm Giá Mới" tay cho ĐÚNG cặp đang chờ lên
      // lịch, ngay trước khi job này tới lượt) không xen vào giữa, tránh mirror nội bộ có >1 entry ACTIVE
      // cùng trỏ 1 dòng CSPRICE thật (audit chéo 12/2026 phát hiện: job cũ KHÔNG khoá/dọn stale entry như
      // /apply, có thể để sót entry ACTIVE cũ khi insertWholesalePrice() ghi đè — xem lịch sử ở trên).
      const acted = await withAppLock(`dsmartWholesalePrice:${e.custId}:${e.skuId}`, async () => {
        // LỖI THẬT đã vá (audit chéo lần 2, 12/2026 — cùng loại race vừa vá ở jobs/dsmartAutoDeleteExpiredPrices.js):
        // job này TRƯỚC ĐÂY ghi thẳng vào DSmart (insertWholesalePrice()) dựa trên snapshot `e` đọc TRƯỚC
        // khi giành khoá, KHÔNG đọc lại trạng thái NGAY TRONG khoá như job Xoá sibling đã làm — trong lúc
        // job đang CHỜ giành khoá (VD đang kẹt ở 1 dòng khác), route POST /entries/:id/cancel-schedule
        // (KHÔNG giành khoá theo cặp, chỉ khoá theo record-id) có thể hủy lịch đúng dòng này. Nếu không
        // đọc lại, job vẫn ghi giá XUỐNG THẬT CSPRICE/siêu thị dù lịch đã bị hủy — tạo ra 1 dòng giá "ma"
        // trên CSPRICE mà mirror nội bộ KHÔNG theo dõi được (vẫn báo CANCELLED, dsmartKey không được lưu).
        // Vá: đọc lại (fresh) TRONG khoá trước khi ghi DSmart, bỏ qua nếu KHÔNG còn SCHEDULED/chưa tới hạn.
        const freshList = await getAllForCollection('dsmartWholesalePriceEntries');
        const fresh = freshList.find(x => x.id === e.id);
        if (!fresh || fresh.status !== 'SCHEDULED' || fresh.frDate > today) return false;
        // targetStoreIds (12/2026): tái dùng đúng danh sách siêu thị đã ĐÓNG BĂNG lúc "Thêm Giá Mới"/tick
        // "Đặt Lịch Áp Giá" (null = đã chọn "Tất Cả" lúc đó) — xem chú thích tại fanOutToStores()/
        // lib/dsmartSqlClient.js.
        const { wasOverwrite, storeResults, storeFanOutError, ...dsmartKey } = await insertWholesalePrice({
          custId: fresh.custId, skuId: fresh.skuId, price: fresh.price, frDate: fresh.frDate, toDate: fresh.toDate
        }, fresh.targetStoreIds);
        const now = new Date().toISOString();
        // Trùng khoá chính CSPRICE (CUST_ID, SKU_ID) -> insertWholesalePrice() đã TỰ GHI ĐÈ dòng cũ trên
        // DSmart. Đánh dấu DELETED MỌI entry mirror ACTIVE khác cho đúng cặp này (cùng logic routes/
        // dsmartWholesalePrice.js::POST /apply) — tránh mirror có nhiều entry ACTIVE cùng trỏ 1 dòng
        // CSPRICE thật.
        if (wasOverwrite) {
          const existingActive = await getAllForCollection('dsmartWholesalePriceEntries');
          const staleList = existingActive.filter(x => x.custId === fresh.custId && x.skuId === fresh.skuId && x.status === 'ACTIVE');
          for (const stale of staleList) {
            await withLockedRecordForCollection('dsmartWholesalePriceEntries', stale.id, (item) => {
              if (item.status !== 'ACTIVE') return item;
              return {
                ...item, status: 'DELETED', deletedBy: null, deletedAt: now,
                history: [...(item.history || []), {
                  action: 'DELETE', mode: 'AUTO_OVERWRITTEN', actor: null, at: now,
                  oldPrice: item.price, oldFrDate: item.frDate, oldToDate: item.toDate,
                  note: 'Bị ghi đè tự động bởi 1 dòng khác (Lên Lịch Áp Giá hoặc Thêm Giá Mới) cho cùng Mã Khách B2B/Mã Sản Phẩm (CSPRICE chỉ cho phép 1 dòng/cặp)'
                }]
              };
            });
          }
        }
        await withLockedRecordForCollection('dsmartWholesalePriceEntries', fresh.id, (item) => {
          if (item.status !== 'SCHEDULED') return item; // đã bị hủy/xử lý bởi thao tác khác trong lúc job đang chạy
          return {
            ...item, dsmartKey, status: 'ACTIVE', appliedAt: now, lastAutoApplyError: null, lastAutoApplyAt: null,
            history: [...(item.history || []), {
              action: wasOverwrite ? 'INSERT_OVERWRITE' : 'INSERT', mode: 'AUTO_SCHEDULED', actor: null, at: now,
              price: item.price, frDate: item.frDate, toDate: item.toDate, storeResults,
              note: 'Tự động áp dụng đúng Ngày Bắt Đầu đã lên lịch'
            }]
          };
        });
        if (storeFanOutError || (storeResults || []).some(r => !r.ok)) {
          const failCount = (storeResults || []).filter(r => !r.ok).length;
          errorDetails.push(`${fresh.custId}/${fresh.skuId}: áp dụng HO thành công nhưng ${storeFanOutError ? 'không đọc được danh sách siêu thị' : `${failCount} siêu thị fan-out lỗi`}`);
        }
        return true;
      });
      if (acted) appliedCount++;
    } catch (err) {
      errorCount++;
      console.error(`⛔ jobs/dsmartAutoApplyScheduledPrices: áp dụng thất bại ID nội bộ=${e.id} (CustId=${e.custId}/SkuId=${e.skuId}) —`, err.message);
      if (errorDetails.length < 5) errorDetails.push(`${e.custId}/${e.skuId}: ${err.message}`);
      // lastAutoApplyError/At (12/2026, theo yêu cầu người dùng: "nếu bị lỗi mạng thì cho phép chạy lại,
      // có cờ kiểm tra trạng thái") — ghi lại NGAY trên entry để UI "2b. Giá Đã Lên Lịch" hiện rõ lần thử
      // gần nhất lỗi gì, không cần đợi tra riêng System Log. Job VẪN tự động thử lại ở lượt chạy kế tiếp
      // (10 phút sau) như trước — entry giữ nguyên SCHEDULED nên lần sau lại khớp điều kiện `due`, KHÔNG
      // cần thêm cơ chế retry/đếm số lần riêng. Bọc try/catch riêng — lỗi ghi lại trạng thái (hiếm, VD mất
      // kết nối CSDL app) không được làm hỏng việc xử lý các dòng SCHEDULED khác trong cùng lượt chạy.
      try {
        await withLockedRecordForCollection('dsmartWholesalePriceEntries', e.id, (item) => {
          if (item.status !== 'SCHEDULED') return item;
          return { ...item, lastAutoApplyError: err.message || 'Lỗi không xác định', lastAutoApplyAt: new Date().toISOString() };
        });
      } catch (_) { /* phớt lờ lỗi ghi lại trạng thái, không chặn các dòng khác */ }
      // Lỗi kết nối/cấu hình sẽ LẶP LẠI y hệt cho mọi dòng còn lại trong lượt này — dừng sớm, thử lại ở
      // lượt chạy kế tiếp (10 phút sau), tránh spam lỗi kết nối hàng chục/trăm lần trong 1 lượt.
      if (err instanceof DsmartConfigError) stoppedEarly = true;
    }
  }
  if (appliedCount || errorCount) {
    const errorNote = errorDetails.length
      ? ` — ${errorDetails.join(' | ')}${errorCount > errorDetails.length ? ` (và ${errorCount - errorDetails.length} lỗi khác, xem log server)` : ''}`
      : '';
    insertSystemLog({
      username: 'SYSTEM', fullName: 'Hệ thống (tự động)', ipAddress: null, module: 'IT_SUPPORT',
      actionType: 'AUTO_APPLY_DSMART_SCHEDULED_PRICE', targetObject: 'dsmartWholesalePriceEntries',
      description: `Tự động áp dụng giá bán buôn đã lên lịch: ${appliedCount} thành công, ${errorCount} lỗi${errorNote}`,
      status: errorCount && !appliedCount ? 'FAILED' : 'SUCCESS'
    }).catch(() => {});
  }
  return { skipped: false, appliedCount, errorCount, checked: due.length };
}

module.exports = { runDsmartAutoApplyScheduledPrices };
