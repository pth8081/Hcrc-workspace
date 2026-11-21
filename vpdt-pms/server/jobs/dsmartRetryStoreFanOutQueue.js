// jobs/dsmartRetryStoreFanOutQueue.js — hàng đợi TỰ ĐỘNG THỬ LẠI fan-out xuống TỪNG siêu thị đã lỗi lúc
// Áp Giá Mới/Sửa/Xoá (tay hoặc tự động) — theo yêu cầu người dùng (12/2026): "trong quá trình mà xử lý
// xóa thì hoặc là áp giá ấy, thì có thể lỗi do mạng ấy, thì có bao giờ là bạn sẽ xử lý khi nó có kết nối
// trở lại". Chạy định kỳ (10 phút/lần — cùng nhịp 2 job tự động Áp Giá/Xoá Giá) — với MỖI dòng trong hàng
// đợi (dbo.DsmartStoreFanOutRetryQueue, xem lib/dsmartStoreFanOutRetryStore.js), thử lại ĐÚNG thao tác
// đó trên ĐÚNG siêu thị đó (lib/dsmartSqlClient.js::retryStoreFanOut()):
//   - Thành công -> xoá khỏi hàng đợi, gộp vào email thông báo "đồng bộ bổ sung thành công" (xem lib/
//     dsmartPriceNotify.js::notifyDsmartPriceRetryBatch(), 1 email DUY NHẤT/lượt chạy, không phải
//     1 email/siêu thị, tránh bão email nếu nhiều siêu thị cùng kết nối lại 1 lúc).
//   - Siêu thị đã bị XOÁ/TẮT trong lúc chờ -> dọn luôn dòng hàng đợi (không còn gì để thử lại).
//   - Vẫn lỗi (còn mất kết nối) -> GIỮ NGUYÊN trong hàng đợi, ghi lại lỗi gần nhất, tự thử lại ở lượt kế
//     tiếp — KHÔNG giới hạn số lần thử (giống cách 2 job tự động Áp Giá/Xoá Giá đang tự thử lại).
//
// KIỂM TRA LẠI ĐỦ ĐIỀU KIỆN TRƯỚC KHI THỬ LẠI (12/2026, người dùng nhắc lại sau khi nghe thiết kế ban
// đầu: "Bạn cần kiểm tra lại trước khi xóa đủ điều kiện... mã hàng, mã nhà cung cấp đúng thì mới xóa,
// cũng như là update giá mới mất mạng vậy") — dữ liệu ghi vào hàng đợi là 1 ẢNH CHỤP tại thời điểm lỗi,
// có thể đã LỖI THỜI nếu người dùng tiếp tục thao tác (Sửa/Xoá/Thêm lại) cho ĐÚNG cặp đó trước khi job
// này kịp chạy. revalidateQueueItem() đọc lại mirror MỚI NHẤT ngay trước khi thử:
//   - APPLY: entry tham chiếu (entryId) phải còn ACTIVE — nếu đã bị xoá/thay thế, BỎ (không ghi đè dữ
//     liệu cũ); nếu còn ACTIVE, LUÔN dùng giá/ngày MỚI NHẤT của entry (không dùng ảnh chụp cũ) — tự bắt
//     kịp nếu entry bị Sửa nhiều lần liên tiếp trong lúc siêu thị còn mất mạng.
//   - DELETE: nếu ĐÃ CÓ 1 dòng khác đang ACTIVE cho ĐÚNG cặp Mã Khách B2B/Mã Sản Phẩm này (người dùng
//     "Thêm Giá Mới"/"Dùng Lại" tạo lại dòng SAU KHI lượt xoá bị lỗi mạng) -> BỎ lượt xoá lỗi thời này,
//     tránh xoá NHẦM dòng giá MỚI hợp lệ khỏi siêu thị.
// Không đọc được mirror để kiểm tra lại (lỗi CSDL app) -> DỪNG CẢ LƯỢT CHẠY (an toàn hơn là thử mù theo
// ảnh chụp cũ có thể đã sai), tự thử lại ở lượt kế tiếp.
// AN TOÀN: lỗi xử lý 1 dòng KHÔNG làm hỏng các dòng khác trong cùng lượt chạy.
const { retryStoreFanOut } = require('../lib/dsmartSqlClient');
const { getAllForCollection } = require('../lib/recordStore');
const retryQueueStore = require('../lib/dsmartStoreFanOutRetryStore');
const { notifyDsmartPriceRetryBatch } = require('../lib/dsmartPriceNotify');
const { insertSystemLog } = require('../lib/systemLogStore');

function revalidateQueueItem(item, entries) {
  if (item.action === 'APPLY') {
    const entry = item.entryId != null ? entries.find(e => e.id === item.entryId) : null;
    if (!entry || entry.status !== 'ACTIVE') {
      return { proceed: false, reason: 'entry tham chiếu không còn ACTIVE (đã bị xoá/thay thế từ lúc lỗi mạng)' };
    }
    return { proceed: true, payload: { custId: entry.custId, skuId: entry.skuId, price: entry.price, frDate: entry.frDate, toDate: entry.toDate } };
  }
  if (item.action === 'DELETE') {
    const hasNewerActive = entries.some(e => e.custId === item.custId && e.skuId === item.skuId && e.status === 'ACTIVE');
    if (hasNewerActive) {
      return { proceed: false, reason: 'đã có dòng giá MỚI đang ACTIVE cho đúng cặp Mã Khách B2B/Mã Sản Phẩm này — bỏ lượt xoá đã lỗi thời' };
    }
    return { proceed: true, payload: item.payload };
  }
  return { proceed: true, payload: item.payload };
}

async function runDsmartRetryStoreFanOutQueue() {
  let items;
  try {
    items = await retryQueueStore.listAll();
  } catch (err) {
    console.error('⛔ jobs/dsmartRetryStoreFanOutQueue: không đọc được hàng đợi —', err.message);
    return { skipped: true, reason: 'queue-read-error' };
  }
  if (!items.length) return { skipped: true, reason: 'empty' };

  let entries;
  try {
    entries = await getAllForCollection('dsmartWholesalePriceEntries');
  } catch (err) {
    // Không đọc được mirror để kiểm tra lại đủ điều kiện -> KHÔNG thử mù theo ảnh chụp cũ (có thể đã lỗi
    // thời), dừng cả lượt chạy, tự thử lại ở lượt kế tiếp.
    console.error('⛔ jobs/dsmartRetryStoreFanOutQueue: không đọc được mirror để kiểm tra lại trước khi thử —', err.message);
    return { skipped: true, reason: 'entries-read-error' };
  }

  let succeededCount = 0, failedCount = 0, skippedCount = 0, staleCount = 0;
  const succeededItems = [];
  for (const item of items) {
    const { proceed, payload, reason } = revalidateQueueItem(item, entries);
    if (!proceed) {
      // Lượt thử này đã LỖI THỜI (không còn đúng điều kiện nữa) -> dọn khỏi hàng đợi, KHÔNG ghi gì xuống
      // siêu thị — xem chú thích revalidateQueueItem() ở trên.
      await retryQueueStore.removeById(item.id).catch(() => {});
      staleCount++;
      console.log(`ℹ️ jobs/dsmartRetryStoreFanOutQueue: bỏ 1 lượt thử lỗi thời (storeId=${item.storeId}, ${item.action}, CustId=${item.custId}/SkuId=${item.skuId}) — ${reason}`);
      continue;
    }
    try {
      const result = await retryStoreFanOut(item.storeId, item.action, payload);
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

  if (succeededCount || failedCount || staleCount) {
    insertSystemLog({
      username: 'SYSTEM', fullName: 'Hệ thống (tự động)', ipAddress: null, module: 'IT_SUPPORT',
      actionType: 'RETRY_DSMART_STORE_FANOUT', targetObject: 'dsmartStoreFanOutRetryQueue',
      description: `Tự động thử lại đồng bộ giá xuống siêu thị: ${succeededCount} thành công, ${failedCount} vẫn lỗi (giữ trong hàng đợi)${skippedCount ? `, ${skippedCount} bỏ qua (siêu thị đã xoá/tắt)` : ''}${staleCount ? `, ${staleCount} bỏ (đã lỗi thời, dữ liệu đã thay đổi)` : ''}`,
      status: failedCount && !succeededCount ? 'WARNING' : 'SUCCESS'
    }).catch(() => {});
  }
  return { skipped: false, succeededCount, failedCount, skippedCount, staleCount, checked: items.length };
}

module.exports = { runDsmartRetryStoreFanOutQueue };
