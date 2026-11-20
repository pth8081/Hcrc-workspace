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
const { getAllForCollection, withLockedRecordForCollection } = require('../lib/recordStore');
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
      const { wasOverwrite, storeResults, storeFanOutError, ...dsmartKey } = await insertWholesalePrice({
        custId: e.custId, skuId: e.skuId, price: e.price, frDate: e.frDate, toDate: e.toDate
      });
      await withLockedRecordForCollection('dsmartWholesalePriceEntries', e.id, (item) => {
        if (item.status !== 'SCHEDULED') return item; // đã bị hủy/xử lý bởi thao tác khác trong lúc job đang chạy
        const now = new Date().toISOString();
        return {
          ...item, dsmartKey, status: 'ACTIVE', appliedAt: now,
          history: [...(item.history || []), {
            action: wasOverwrite ? 'INSERT_OVERWRITE' : 'INSERT', mode: 'AUTO_SCHEDULED', actor: null, at: now,
            price: item.price, frDate: item.frDate, toDate: item.toDate, storeResults,
            note: 'Tự động áp dụng đúng Ngày Bắt Đầu đã lên lịch'
          }]
        };
      });
      appliedCount++;
      if (storeFanOutError || (storeResults || []).some(r => !r.ok)) {
        const failCount = (storeResults || []).filter(r => !r.ok).length;
        errorDetails.push(`${e.custId}/${e.skuId}: áp dụng HO thành công nhưng ${storeFanOutError ? 'không đọc được danh sách siêu thị' : `${failCount} siêu thị fan-out lỗi`}`);
      }
    } catch (err) {
      errorCount++;
      console.error(`⛔ jobs/dsmartAutoApplyScheduledPrices: áp dụng thất bại ID nội bộ=${e.id} (CustId=${e.custId}/SkuId=${e.skuId}) —`, err.message);
      if (errorDetails.length < 5) errorDetails.push(`${e.custId}/${e.skuId}: ${err.message}`);
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
