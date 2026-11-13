// lib/shelfStockEdit.js — logic SỬA 1 bản ghi shelfLocations/shelfStockThresholds, tách ra khỏi
// routes/shelfStock.js để test trực tiếp không cần dựng Express (cùng tinh thần lib/createValidation.js
// tách logic validate khỏi routes/create.js). Mỗi hàm nhận (item, body, user, allUsers?) — item = bản
// ghi ĐANG khoá (withLockedRecordForCollection), body = req.body thô từ client, user = req.freshUser (đã
// re-fetch từ session, KHÔNG tin quyền/dept trong JWT) — trả về bản ghi MỚI hoặc throw HttpError. KHÔNG
// tự đọc/ghi DB — route gọi qua withLockedRecordForCollection() để khoá/ghi thật.
const { HttpError } = require('./httpErrors');
const { formatCreatedAt } = require('./shelfRecordUpsert');

// getShelfEffectiveUser()/getShelfEffectiveUserFromReq() (11/2026) — quyền shelfAnyStoreAccess ("🔑 Được
// Chọn Siêu Thị Bất Kỳ"): người được cấp quyền này chọn 1 siêu thị bất kỳ ở màn Kiểm Soát Hàng Hóa, client
// gửi kèm header X-Shelf-Store-Override ở MỌI request liên quan (thresholds/locations/records/price-check/
// system-inventory...) — route đổi req.freshUser -> effectiveUser (shallow clone, CHỈ đổi field dept) rồi
// truyền effectiveUser vào ĐÚNG những hàm đang nhận req.freshUser hiện có (applyShelfLocationEdit()...,
// extraValidate() ở lib/createValidation.js) — KHÔNG cần sửa gì bên trong các hàm đó, vì toàn bộ logic ở
// đó đều so sánh "item.dept !== user.dept" (admin bypass hẳn, không phân biệt dept) — effectiveUser.dept
// chính là siêu thị ĐANG CHỌN nên mọi so sánh tự đúng. Validate NGHIÊM ở server (không tin riêng quyền
// client tự ẩn/hiện UI): thiếu quyền mà vẫn gửi header -> 403 rõ ràng (lỗi thật, không âm thầm bỏ qua).
function getShelfEffectiveUser(user, overrideDept, allStores) {
  if (overrideDept === undefined || overrideDept === null) return user;
  const dept = String(overrideDept).trim();
  if (!dept) return user;
  if (!(user?.perms?.admin || user?.perms?.shelfAnyStoreAccess)) {
    throw new HttpError(403, 'Bạn không có quyền chọn siêu thị khác để thao tác Kiểm Soát Hàng Hóa');
  }
  if (!Array.isArray(allStores) || !allStores.includes(dept)) {
    throw new HttpError(400, 'Siêu thị chọn không hợp lệ');
  }
  if (dept === user.dept) return user;
  return { ...user, dept };
}

async function getShelfEffectiveUserFromReq(req) {
  const rawHeader = req.get('x-shelf-store-override');
  if (!rawHeader) return req.freshUser;
  // Header HTTP chỉ chấp nhận ByteString (ASCII/Latin-1) — tên siêu thị tiếng Việt có dấu (VD "Siêu Thị",
  // "ị"=U+1ECB vượt hẳn 255) KHÔNG gửi THẲNG được qua header, browser tự throw TypeError nếu cố gán —
  // client PHẢI encodeURIComponent() trước khi gán header (xem shelfFetch()/module-vanhanh.js), nên ở
  // đây giải mã lại ĐÚNG 1 lần. decodeURIComponent lỗi (header bị chỉnh tay sai định dạng) -> coi như
  // siêu thị không hợp lệ, KHÔNG để lộ lỗi 500.
  let overrideDept;
  try { overrideDept = decodeURIComponent(rawHeader); } catch (err) { throw new HttpError(400, 'Siêu thị chọn không hợp lệ'); }
  const { getAppDataValueCached } = require('./appData');
  const allStores = (await getAppDataValueCached('stores')) || [];
  return getShelfEffectiveUser(req.freshUser, overrideDept, allStores);
}

function canManageShelfStock(user) {
  return !!(user?.perms?.admin || user?.perms?.shelfLocationManage);
}

// dept BẤT BIẾN (đổi siêu thị coi như tạo quầy kệ mới ở siêu thị khác — tránh lẫn lịch sử ghi nhận giữa
// 2 siêu thị) — code/name/category/active sửa được. Admin bypass kiểm dept (hỗ trợ xử lý hộ); người chỉ
// có shelfLocationManage (không phải admin) CHỈ sửa được đúng siêu thị mình.
//
// code SỬA ĐƯỢC (11/2026, theo yêu cầu người dùng "cho tôi sửa cả mã kệ") — ĐỔI quyết định cũ
// ("code BẤT BIẾN", xem lịch sử git): xác nhận lại an toàn trước khi mở — shelfRecords (ghi nhận) tham
// chiếu quầy kệ qua `shelfLocationId` (số, bất biến) chứ KHÔNG qua `code`, và tự CHỤP LẠI
// shelfLocationCode/shelfLocationName vào ĐÚNG thời điểm ghi nhận (xem lib/shelfRecordUpsert.js) — đổi
// code ở đây KHÔNG làm sai lệch bất kỳ ghi nhận cũ nào (vẫn giữ nguyên snapshot lúc đó), chỉ ảnh hưởng
// ghi nhận MỚI từ sau khi đổi (hiển thị đúng mã mới). `allItemsInCollection` (mảng ĐANG KHOÁ, route
// truyền vào — xem routes/shelfStock.js PATCH /locations/:id) để tự kiểm trùng mã TRONG CÙNG giao dịch
// khoá, không tách rời 2 bước đọc/ghi (tránh race 2 request cùng đổi trùng 1 mã).
function applyShelfLocationEdit(item, body, user, allItemsInCollection) {
  if (!canManageShelfStock(user)) throw new HttpError(403, 'Bạn không có quyền quản lý Danh Mục Quầy Kệ');
  if (!user.perms?.admin && item.dept !== user.dept) {
    throw new HttpError(403, 'Quầy kệ không thuộc siêu thị của bạn');
  }
  const next = { ...item };
  if (body.code !== undefined) {
    const code = String(body.code || '').trim();
    if (!code) throw new HttpError(400, 'Vui lòng nhập Mã Quầy Kệ');
    const isDup = (allItemsInCollection || []).some(it => it.id !== item.id && it.dept === item.dept && it.code === code);
    if (isDup) throw new HttpError(409, `Mã quầy kệ "${code}" đã tồn tại ở siêu thị này`);
    next.code = code;
  }
  if (body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) throw new HttpError(400, 'Vui lòng nhập Tên Quầy Kệ');
    next.name = name;
  }
  if (body.category !== undefined) next.category = String(body.category || '').trim();
  if (body.active !== undefined) next.active = body.active !== false;
  return next;
}

// maHang/maVach/category BẤT BIẾN sau khi tạo (đổi phạm vi áp dụng coi như tạo ngưỡng mới, tránh phải
// tính lại dup-check với tổ hợp mới giữa lúc sửa — cùng lý do đã áp dụng cho code quầy kệ) — chỉ
// minQuantity/extraRecipientUsernames/active sửa được. allUsers truyền vào để đối chiếu Tầng 4 "tự thêm
// thêm" giống hệt lúc tạo (lib/createValidation.js shelfStockThresholds.extraValidate) — route PHẢI
// truyền đúng danh sách users mới nhất, không được bỏ qua tham số này khi body có extraRecipientUsernames.
function applyShelfStockThresholdEdit(item, body, user, allUsers) {
  if (!canManageShelfStock(user)) throw new HttpError(403, 'Bạn không có quyền quản lý Ngưỡng Tồn Kiểm Soát Hàng Hóa');
  if (!user.perms?.admin && item.dept !== user.dept) {
    throw new HttpError(403, 'Ngưỡng tồn không thuộc siêu thị của bạn');
  }
  const next = { ...item };
  if (body.minQuantity !== undefined) {
    const minQuantity = Number(body.minQuantity);
    if (!Number.isFinite(minQuantity) || minQuantity < 0) {
      throw new HttpError(400, 'Ngưỡng tối thiểu không hợp lệ (phải là số không âm)');
    }
    next.minQuantity = minQuantity;
  }
  if (body.extraRecipientUsernames !== undefined) {
    const rawUsernames = Array.isArray(body.extraRecipientUsernames) ? body.extraRecipientUsernames : [];
    const wantedUsernames = [...new Set(rawUsernames.map(u => String(u || '').trim()).filter(Boolean))];
    const users = Array.isArray(allUsers) ? allUsers : [];
    const invalidUsername = wantedUsernames.find(un => {
      const u = users.find(x => x.username === un);
      return !u || u.active === false || u.dept !== item.dept;
    });
    if (invalidUsername) {
      throw new HttpError(400, `Người nhận "${invalidUsername}" không hợp lệ (phải là nhân viên đang hoạt động của đúng siêu thị này)`);
    }
    next.extraRecipientUsernames = wantedUsernames;
  }
  if (body.active !== undefined) next.active = body.active !== false;
  return next;
}

// Ghi Nhận Trên Kệ (shelfRecords) — TẠO/scan (kể cả ghi đè theo lô) dùng quyền shelfRecordCreate, bất kỳ
// nhân viên scan hàng ngày nào cũng có — KHÁC canManageShelfStock() ở trên (shelfLocationManage, dành
// cho Cửa Hàng Trưởng quản lý Quầy Kệ/Ngưỡng Tồn).
function canManageShelfRecords(user) {
  return !!(user?.perms?.admin || user?.perms?.shelfRecordCreate);
}
// ĐỔI QUYẾT ĐỊNH (11/2026, theo yêu cầu TRỰC TIẾP của người dùng kèm ảnh chụp 2 màn: "quyền Ghi Nhận Trên
// Kệ [chỉ shelfRecordCreate] phải tự Sửa/Xóa/Cập Nhật nhanh/Bán Hết được ngay trên bảng ghi nhận, không
// bắt buộc phải cấp thêm quyền Quản Lý Danh Mục Quầy Kệ"): client ĐÃ LUÔN hiện sẵn cụm nút Sửa/Xóa/SL
// hiện tại-Cập Nhật/Bán Hết cho MỌI người có shelfRecordCreate (renderShelfRecordActionsCell() chỉ gác
// canCreateShelfRecordClient(), xem module-vanhanh.js) — trước đợt này bấm vào đều bị server 403 vì hàm
// dưới đây CHỈ nhận shelfLocationManage/admin, tạo ra trải nghiệm "thấy nút nhưng bấm không được".
//
// LỊCH SỬ (để tham chiếu, không còn áp dụng): trước đó hàm này CỐ Ý tách khỏi canManageShelfRecords() ở
// trên sau khi phát hiện lỗ hổng "1 nhân viên chỉ có shelfRecordCreate — scan được — lại xoá/sửa vĩnh
// viễn được ghi nhận của BẤT KỲ ai khác trong cùng siêu thị". Người dùng (chủ hệ thống) nay xác nhận đây
// là hành vi MONG MUỐN, không phải lỗ hổng — nhân viên ghi nhận hằng ngày cần tự sửa luôn số liệu/đánh
// dấu bán hết mà không phải chờ Cửa Hàng Trưởng (shelfLocationManage) — phạm vi vẫn luôn giới hạn ĐÚNG
// siêu thị của người đó (kiểm tra item.dept !== user.dept ngay dưới mỗi hàm gọi tới đây), chỉ không còn
// phân biệt "người tạo ra ghi nhận" nữa.
function canManageShelfRecordEdits(user) {
  return !!(user?.perms?.admin || user?.perms?.shelfLocationManage || user?.perms?.shelfRecordCreate);
}

// quantity/expiryDate/note sửa được; shelfLocationId/maHang/maVach/dept BẤT BIẾN (đổi định danh sản phẩm
// coi như ghi nhận lô khác, không phải sửa — cùng nguyên tắc code quầy kệ/ngưỡng tồn bất biến ở trên).
// allRecords (tuỳ chọn, route truyền vào khi body có đổi expiryDate) — để chặn tạo trùng "cùng lô" với 1
// dòng ĐANG active khác sau khi sửa (xem findMatchingActiveShelfRecord() ở lib/shelfRecordUpsert.js).
function applyShelfRecordEdit(item, body, user, allRecords) {
  if (!canManageShelfRecordEdits(user)) throw new HttpError(403, 'Bạn không có quyền sửa/xóa Ghi Nhận Trên Kệ (cần quyền quản lý Quầy Kệ)');
  if (!user.perms?.admin && item.dept !== user.dept) {
    throw new HttpError(403, 'Ghi nhận này không thuộc siêu thị của bạn');
  }
  const next = { ...item };
  // lastEditedBy/lastEditedByName/lastEditedAt (11/2026, theo yêu cầu người dùng NGAY SAU KHI mở quyền
  // Sửa/Xóa/Cập Nhật/Bán Hết cho shelfRecordCreate ở trên — "lưu lại ai là người ghi nhận [cập nhật gần
  // nhất]"): từ nay BẤT KỲ ai có shelfRecordCreate cũng sửa được ghi nhận của đồng nghiệp khác, nên
  // `creator`/`creatorName` (người TẠO ĐẦU TIÊN, bất biến) không còn đủ để biết ai vừa thao tác gần nhất.
  // Ghi lại NGƯỜI ĐANG THỰC HIỆN hành động này (Sửa/Cập Nhật nhanh/Bán Hết đều qua ĐÚNG hàm này) — KHÔNG
  // đụng tới creator/creatorName gốc, chỉ thêm field mới song song để không mất lịch sử "ai tạo ra".
  next.lastEditedBy = user.username;
  next.lastEditedByName = user.name;
  next.lastEditedAt = formatCreatedAt(new Date());
  const prevQuantity = Number(item.quantity) || 0;
  // body.quantity là ABSOLUTE (SET THẲNG) — dùng chung cho cả "✏️ Sửa" (full edit), "✅ Bán Hết" (set 0)
  // và nút tắt "💾 Cập Nhật" (set đúng SL vừa đếm trên kệ, thay thế hẳn hướng "➖ Trừ" tương đối cũ — set
  // thẳng không có hiệu ứng dồn/cộng dồn nên 2 thiết bị gửi gần như đồng thời chỉ là last-write-wins,
  // CÙNG rủi ro chấp nhận được như "✏️ Sửa" vốn đã có sẵn, không cần cơ chế atomic riêng).
  if (body.quantity !== undefined) {
    const quantity = Number(body.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new HttpError(400, 'Số lượng không hợp lệ (phải là số không âm)');
    }
    next.quantity = quantity;
    // LỖI ĐÃ VÁ (11/2026, báo cáo người dùng kèm ảnh: "cập nhật còn 7 mà Trên Kệ Hôm Nay vẫn 0"): trước
    // đây "✏️ Sửa"/"💾 Cập Nhật"/"✅ Bán Hết" (mọi đường đổi quantity qua route này) KHÔNG bump
    // lastScannedAt — vi phạm đúng ý thiết kế đã ghi ở routes/shelfStock.js (POST /records/upsert): bump
    // "MỖI LẦN quét/cập nhật tại chỗ", không chỉ lúc tạo/scan lô mới. Hệ quả: Đối Chiếu vẫn coi dòng vừa
    // đếm lại là "Quá Khứ" (isShelfRecordCreatedToday() đọc lastScannedAt||createdAt, module-vanhanh.js)
    // dù số lượng vừa được xác nhận lại ngay hôm nay — nay set lại NGAY ĐÂY, đúng ngữ nghĩa "đổi quantity
    // = vừa kiểm/đếm lại lô này", cùng công thức formatCreatedAt() dùng ở route upsert.
    next.lastScannedAt = formatCreatedAt(new Date());
  }
  // "Hồi sinh" dòng đã Ngừng theo dõi (quantity 0 -> dương) PHẢI chặn trùng "cùng lô" giống hệt lúc tạo
  // mới/đổi Hạn Sử Dụng — không chỉ check khi expiryDate đổi (dup-check cũ bỏ sót đúng trường hợp này:
  // Sửa 1 dòng đã về 0 lên lại >0 trong khi 1 dòng KHÁC đã là bản active "chính thức" của đúng lô đó từ
  // sau khi dòng này bị zero-out — xem chú thích đầu lib/shelfRecordUpsert.js, "không hồi sinh" là CỐ Ý).
  const quantityRevived = prevQuantity <= 0 && Number(next.quantity) > 0;
  if (body.expiryDate !== undefined || quantityRevived) {
    let expiryDate = item.expiryDate;
    if (body.expiryDate !== undefined) {
      expiryDate = '';
      if (body.expiryDate) {
        const d = new Date(body.expiryDate);
        if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Hạn sử dụng không hợp lệ');
        expiryDate = d.toISOString();
      }
    }
    const expiryChanged = expiryDate !== item.expiryDate;
    if ((expiryChanged || quantityRevived) && Number(next.quantity) > 0) {
      const { findMatchingActiveShelfRecord } = require('./shelfRecordUpsert');
      const dup = findMatchingActiveShelfRecord((allRecords || []).filter(r => r.id !== item.id), {
        dept: item.dept, shelfLocationId: item.shelfLocationId, maHang: item.maHang, maVach: item.maVach, expiryDate
      });
      if (dup) throw new HttpError(409, 'Đã có 1 dòng đang theo dõi khác cùng Quầy Kệ/Mã Hàng/Hạn Sử Dụng này — không thể đổi trùng');
    }
    next.expiryDate = expiryDate;
  }
  if (body.note !== undefined) next.note = String(body.note || '').trim();
  return next;
}

module.exports = {
  canManageShelfStock, canManageShelfRecords, canManageShelfRecordEdits,
  applyShelfLocationEdit, applyShelfStockThresholdEdit, applyShelfRecordEdit,
  getShelfEffectiveUser, getShelfEffectiveUserFromReq
};
