// jobs/dsmartRetryStoreFanOutQueue.js — hàng đợi TỰ ĐỘNG THỬ LẠI fan-out xuống TỪNG siêu thị đã lỗi lúc
// Áp Giá Mới/Xoá (tay hoặc tự động) — theo yêu cầu người dùng (12/2026): "trong quá trình mà xử lý xóa
// thì hoặc là áp giá ấy, thì có thể lỗi do mạng ấy, thì có bao giờ là bạn sẽ xử lý khi nó có kết nối trở
// lại". Chạy định kỳ (10 phút/lần — cùng nhịp 2 job tự động Áp Giá/Xoá Giá) — với MỖI dòng trong hàng
// đợi (dbo.DsmartStoreFanOutRetryQueue, xem lib/dsmartStoreFanOutRetryStore.js), thử lại ĐÚNG thao tác
// đó trên ĐÚNG siêu thị đó (lib/dsmartSqlClient.js::retryStoreFanOut()):
//   - Thành công -> xoá khỏi hàng đợi, gộp vào email thông báo "đồng bộ bổ sung thành công" (xem lib/
//     dsmartPriceNotify.js::notifyDsmartPriceRetryBatch(), 1 email DUY NHẤT/lượt chạy, không phải
//     1 email/siêu thị, tránh bão email nếu nhiều siêu thị cùng kết nối lại 1 lúc).
//   - Siêu thị đã bị XOÁ/TẮT trong lúc chờ -> dọn luôn dòng hàng đợi (không còn gì để thử lại).
//   - Vẫn lỗi (còn mất kết nối) -> GIỮ NGUYÊN trong hàng đợi, ghi lại lỗi gần nhất, tự thử lại ở lượt kế
//     tiếp — KHÔNG giới hạn số lần thử (giống cách 2 job tự động Áp Giá/Xoá Giá đang tự thử lại).
// AN TOÀN: lỗi xử lý 1 dòng KHÔNG làm hỏng các dòng khác trong cùng lượt chạy.
const { retryStoreFanOut } = require('../lib/dsmartSqlClient');
const retryQueueStore = require('../lib/dsmartStoreFanOutRetryStore');
const { notifyDsmartPriceRetryBatch } = require('../lib/dsmartPriceNotify');
const { insertSystemLog } = require('../lib/systemLogStore');

async function runDsmartRetryStoreFanOutQueue() {
  let items;
  try {
    items = await retryQueueStore.listAll();
  } catch (err) {
    console.error('⛔ jobs/dsmartRetryStoreFanOutQueue: không đọc được hàng đợi —', err.message);
    return { skipped: true, reason: 'queue-read-error' };
  }
  if (!items.length) return { skipped: true, reason: 'empty' };

  let succeededCount = 0, failedCount = 0, skippedCount = 0;
  const succeededItems = [];
  for (const item of items) {
    try {
      const result = await retryStoreFanOut(item.storeId, item.action, item.payload);
      if (result.skipped) {
        // Siêu thị đã bị xoá/tắt trong lúc chờ -> dọn luôn, không còn gì để thử lại nữa.
        await retryQueueStore.removeById(item.id);
        skippedCount++;
        continue;
      }
      await retryQueueStore.removeById(item.id);
      succeededCount++;
      succeededItems.push({ action: item.action, storeCode: result.storeCode, storeName: result.storeName, custId: item.custId, skuId: item.skuId });
    } catch (err) {
      failedCount++;
      try { await retryQueueStore.markTried(item.id, err.message || 'Lỗi không xác định'); } catch (_) { /* phớt lờ lỗi ghi lại trạng thái, không chặn các dòng khác */ }
    }
  }

  if (succeededItems.length) {
    await notifyDsmartPriceRetryBatch({ items: succeededItems }).catch(() => {});
  }

  if (succeededCount || failedCount) {
    insertSystemLog({
      username: 'SYSTEM', fullName: 'Hệ thống (tự động)', ipAddress: null, module: 'IT_SUPPORT',
      actionType: 'RETRY_DSMART_STORE_FANOUT', targetObject: 'dsmartStoreFanOutRetryQueue',
      description: `Tự động thử lại đồng bộ giá xuống siêu thị: ${succeededCount} thành công, ${failedCount} vẫn lỗi (giữ trong hàng đợi)${skippedCount ? `, ${skippedCount} bỏ qua (siêu thị đã xoá/tắt)` : ''}`,
      status: failedCount && !succeededCount ? 'WARNING' : 'SUCCESS'
    }).catch(() => {});
  }
  return { skipped: false, succeededCount, failedCount, skippedCount, checked: items.length };
}

module.exports = { runDsmartRetryStoreFanOutQueue };
