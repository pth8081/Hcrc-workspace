// lib/recordStore.js — Kho lưu trữ DÙNG CHUNG cho các collection "hồ sơ nghiệp vụ" dùng chung 2 engine
// generic lib/createValidation.js (tạo mới) + lib/workflowEngine.js (duyệt theo bước) — submissions,
// docs, carRegs, officeReqs — cùng bảng dbo.Records (Bước 6c trở đi), phân biệt bằng cột Collection.
// Khác SystemLogs/Tasks (Bước 6a/6b, mỗi collection 1 bảng riêng với bộ cột lọc cố định), các collection
// ở đây không có bộ cột chung hợp lý để tách riêng — dùng 1 bảng CHUNG, mỗi bản ghi vẫn là 1 dòng thật
// (khoá đúng 1 dòng thay vì cả collection, cùng lý do đã áp dụng ở SystemLogs/Tasks).
//
// getAllForCollection/createForCollection/withLockedRecordForCollection là điểm gọi DUY NHẤT mà
// routes/create.js, routes/workflow.js, routes/data.js cần biết tới — tự động dùng bảng Records nếu
// collection đã có trong MIGRATED_COLLECTIONS, ngược lại rơi về đường AppData cũ
// (withLockedAppDataValue) — code gọi không cần biết/quan tâm collection đó đã migrate hay chưa. Mỗi
// bước 6c/6d/... tiếp theo chỉ cần thêm 1 dòng vào MIGRATED_COLLECTIONS + chạy di trú, không cần sửa
// gì ở routes/create.js hay routes/workflow.js.
const { getPool, sql } = require('../db');
const { getAppDataValue, withLockedAppDataValue } = require('./appData');
const { HttpError } = require('./httpErrors');

// Collection ĐÃ chuyển sang dbo.Records — thêm dần theo đúng lộ trình đã thống nhất, mỗi bước 1
// collection (Bước 6c: submissions, Bước 6d: docs, Bước 6e: carRegs, Bước 6f: officeReqs, Bước 6g:
// contracts, Bước 6h: meetings, Bước 6i: meetingMinutes, Bước 6j: internalPosts — bước CUỐI của lộ
// trình Bước 6). Khác 4 collection Bước 6c-6f (dùng chung 2 engine
// createValidation.js/workflowEngine.js qua routes/create.js + routes/workflow.js),
// contracts/meetings/meetingMinutes/internalPosts SỬA qua route riêng đơn giản (routes/records.js
// POST /contracts/:id/edit, POST /minutes/:id/edit, POST /internalPosts/:id/<action>,
// routes/meetingActions.js POST /:id/approve|cancel) — vẫn dùng được đúng dispatch
// withLockedRecordForCollection() ở đây vì các hàm sửa chỉ cần 1 bản ghi (không cần cả collection).
// meetingMinutes còn có thêm route XOÁ (POST /minutes/:id/delete) — collection ĐẦU TIÊN trong nhóm này
// cần xoá 1 dòng, xem deleteRecordForCollection() bên dưới. internalPosts trước Bước 6j chỉ có route
// TẠO qua createValidation.js — 5 hành động tương tác (đánh dấu đã đọc/thích/bình luận/đăng ký đào tạo)
// vẫn ghi thẳng qua đường /api/data/internalPosts chung, không xác thực gì — đã xây route riêng cho cả
// 5 hành động này trong routes/records.js TRƯỚC KHI migrate storage ở bước này (xem
// lib/recordActions.js phần "TRUYỀN THÔNG NỘI BỘ").
const MIGRATED_COLLECTIONS = new Set(['submissions', 'docs', 'carRegs', 'officeReqs', 'contracts', 'meetings', 'meetingMinutes', 'internalPosts', 'paymentRequests', 'vppPeriods', 'vppRegistrations', 'reportPeriods', 'reportEntries', 'reportSlideTemplates', 'trainingDocuments', 'trainingClasses', 'trainingRegistrations', 'careerPaths', 'careerPathConfirmations', 'trainingTests', 'trainingTestSubmissions', 'recruitmentJobs', 'recruitmentReferrals']);

function toRecord(row) {
  return JSON.parse(row.Payload);
}

// Lỗi trùng khoá SQL Server (unique index UX_Records_Collection_Code) — request thứ 2 trong 1 race
// hiếm gặp (2 người tạo cùng mã CÙNG LÚC) nhận đúng thông báo nghiệp vụ thay vì lỗi SQL thô.
function isUniqueConstraintViolation(err) {
  return err && (err.number === 2601 || err.number === 2627);
}

async function getAllRecords(collection) {
  const pool = await getPool();
  const result = await pool.request()
    .input('collection', sql.NVarChar(50), collection)
    .query('SELECT Payload FROM dbo.Records WHERE Collection = @collection ORDER BY CreatedAt DESC, Id DESC');
  return result.recordset.map(toRecord);
}

async function insertRecord(collection, record) {
  const pool = await getPool();
  try {
    await pool.request()
      .input('collection', sql.NVarChar(50), collection)
      .input('id', sql.BigInt, record.id)
      .input('code', sql.NVarChar(100), record.code || null)
      .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(record))
      .query(`
        INSERT INTO dbo.Records (Collection, Id, Code, Payload)
        VALUES (@collection, @id, @code, @payload);
      `);
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new HttpError(409, `Mã "${record.code}" đã tồn tại`);
    }
    throw err;
  }
  invalidateCollectionCache(collection);
  return record;
}

async function withLockedRecordById(collection, id, mutatorFn) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const readReq = new sql.Request(tx);
    const readResult = await readReq
      .input('collection', sql.NVarChar(50), collection)
      .input('id', sql.BigInt, id)
      .query('SELECT Payload FROM dbo.Records WITH (UPDLOCK, HOLDLOCK) WHERE Collection = @collection AND Id = @id');
    if (readResult.recordset.length === 0) {
      throw new HttpError(404, 'Không tìm thấy hồ sơ');
    }
    const item = toRecord(readResult.recordset[0]);

    const updated = await mutatorFn(item);

    const writeReq = new sql.Request(tx);
    await writeReq
      .input('collection', sql.NVarChar(50), collection)
      .input('id', sql.BigInt, id)
      .input('code', sql.NVarChar(100), updated.code || null)
      .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(updated))
      .query('UPDATE dbo.Records SET Code = @code, Payload = @payload WHERE Collection = @collection AND Id = @id');

    await tx.commit();
    invalidateCollectionCache(collection);
    return updated;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

// checkFn(item) (tuỳ chọn) -> throw HttpError (vd 403) để huỷ, không xoá gì — chạy SAU khi đã khoá đọc
// được đúng bản ghi (UPDLOCK/HOLDLOCK), TRƯỚC khi xoá, khớp đúng thời điểm mutatorFn chạy ở
// withLockedRecordById() bên trên.
async function deleteRecordById(collection, id, checkFn) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const readReq = new sql.Request(tx);
    const readResult = await readReq
      .input('collection', sql.NVarChar(50), collection)
      .input('id', sql.BigInt, id)
      .query('SELECT Payload FROM dbo.Records WITH (UPDLOCK, HOLDLOCK) WHERE Collection = @collection AND Id = @id');
    if (readResult.recordset.length === 0) {
      throw new HttpError(404, 'Không tìm thấy hồ sơ');
    }
    const item = toRecord(readResult.recordset[0]);

    if (checkFn) await checkFn(item);

    const delReq = new sql.Request(tx);
    await delReq
      .input('collection', sql.NVarChar(50), collection)
      .input('id', sql.BigInt, id)
      .query('DELETE FROM dbo.Records WHERE Collection = @collection AND Id = @id');

    await tx.commit();
    invalidateCollectionCache(collection);
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

// Di trú dữ liệu cũ (nếu còn) từ AppData[collection] sang dbo.Records — CHỈ chạy nếu collection này
// đang RỖNG trong bảng mới (idempotent, khớp đúng lib/systemLogStore.js/lib/taskStore.js). Xoá dòng
// AppData cũ sau khi di trú xong.
async function migrateLegacyCollection(collection) {
  const pool = await getPool();
  const countResult = await pool.request()
    .input('collection', sql.NVarChar(50), collection)
    .query('SELECT COUNT(*) AS c FROM dbo.Records WHERE Collection = @collection');
  if (countResult.recordset[0].c > 0) return;

  const legacy = await getAppDataValue(collection);
  if (!Array.isArray(legacy) || legacy.length === 0) return;

  for (let i = legacy.length - 1; i >= 0; i--) {
    await insertRecord(collection, legacy[i]);
  }
  await pool.request()
    .input('collection', sql.NVarChar(50), collection)
    .query('DELETE FROM dbo.AppData WHERE DataKey = @collection');
  console.log(`   ↳ Đã di chuyển ${legacy.length} bản ghi "${collection}" cũ sang bảng Records.`);
}

// Chạy di trú cho MỌI collection đã liệt kê trong MIGRATED_COLLECTIONS — gọi 1 lần lúc khởi động
// (seedDefaults.js), không cần liệt kê tay từng collection ở đó khi thêm collection mới vào danh sách.
async function migrateAllLegacyCollections() {
  for (const collection of MIGRATED_COLLECTIONS) {
    await migrateLegacyCollection(collection);
  }
}

// ===== Dispatch: 1 điểm gọi cho routes/create.js, routes/workflow.js, routes/data.js — không cần biết
// collection đã migrate hay chưa. =====

async function getAllForCollection(collection) {
  if (MIGRATED_COLLECTIONS.has(collection)) return getAllRecords(collection);
  return (await getAppDataValue(collection)) || [];
}

// Cache ngắn hạn TRONG BỘ NHỚ theo TỪNG collection, chỉ dùng cho GET /api/data (routes/data.js) — cùng
// khuôn getAppDataValueCached()/getAllTasksCached(): nhiều người dùng khác nhau gọi gần như cùng lúc
// đều cần y hệt danh sách RAW của 1 collection trước khi lọc theo quyền xem riêng (lib/recordViewScope.js,
// chạy SAU bước này) — an toàn dùng chung. CHỈ dùng ở routes/data.js, KHÔNG dùng cho các route ghi/kiểm
// tra trùng lặp (routes/create.js, routes/workflow.js, routes/meetingActions.js...) — nơi đó cần đọc
// mới nhất tuyệt đối để chặn đúng race (trùng mã, trùng khung giờ...).
const RECORDS_CACHE_TTL_MS = parseInt(process.env.APPDATA_CACHE_TTL_MS || '3000', 10);
const collectionCache = new Map(); // collection -> { value, expiresAt }

function invalidateCollectionCache(collection) {
  collectionCache.delete(collection);
}

async function getAllForCollectionCached(collection) {
  const hit = collectionCache.get(collection);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await getAllForCollection(collection);
  collectionCache.set(collection, { value, expiresAt: Date.now() + RECORDS_CACHE_TTL_MS });
  return value;
}

// builderFn(existingList) -> bản ghi mới (hoặc throw để huỷ, không tạo gì). Với collection ĐÃ migrate,
// đọc danh sách hiện có TRƯỚC KHI khoá gì (không còn khái niệm khoá cả collection) — khoảng hở giữa đọc
// và ghi được UNIQUE INDEX (Collection, Code) ở tầng CSDL đóng lại cho trường hợp trùng mã do race
// thật (2 request tạo cùng mã cùng lúc), không chỉ dựa vào kiểm tra ở tầng ứng dụng.
async function createForCollection(collection, builderFn) {
  if (MIGRATED_COLLECTIONS.has(collection)) {
    const existing = await getAllRecords(collection);
    const record = await builderFn(existing);
    return insertRecord(collection, record);
  }
  let record;
  await withLockedAppDataValue(collection, (list) => {
    const arr = Array.isArray(list) ? list : [];
    record = builderFn(arr);
    arr.unshift(record);
    return arr;
  });
  return record;
}

// Giống createForCollection() nhưng dùng sp_getapplock để khoá NGHIÊM TÚC theo 1 khoá nghiệp vụ (vd
// "phòng họp X") trong SUỐT lúc đọc-kiểm tra-ghi — dành cho trường hợp điều kiện trùng lặp KHÔNG diễn
// đạt được bằng UNIQUE INDEX đơn giản như trùng "Code" (vd trùng khung giờ/phòng họp — kiểm tra
// khoảng thời gian chồng lấn, không phải so bằng đúng 1 giá trị cột). Hầu hết collection khác không
// cần hàm này — UNIQUE INDEX (Collection, Code) ở createForCollection() thường đã đủ chặn race thật.
// @LockOwner='Transaction' -> khoá tự nhả khi commit/rollback, không cần tự gọi sp_releaseapplock.
async function createForCollectionSerialized(collection, lockKey, builderFn) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  let record;
  try {
    const lockReq = new sql.Request(tx);
    lockReq.input('Resource', sql.NVarChar(255), lockKey);
    lockReq.input('LockMode', sql.VarChar(32), 'Exclusive');
    lockReq.input('LockOwner', sql.VarChar(32), 'Transaction');
    lockReq.input('LockTimeout', sql.Int, 15000);
    const lockResult = await lockReq.execute('sp_getapplock');
    if (lockResult.returnValue < 0) {
      throw new HttpError(409, 'Hệ thống đang bận xử lý một yêu cầu trùng — vui lòng thử lại.');
    }

    const readReq = new sql.Request(tx);
    const readResult = await readReq
      .input('collection', sql.NVarChar(50), collection)
      .query('SELECT Payload FROM dbo.Records WHERE Collection = @collection ORDER BY CreatedAt DESC, Id DESC');
    const existing = readResult.recordset.map(toRecord);

    record = await builderFn(existing);

    const writeReq = new sql.Request(tx);
    await writeReq
      .input('collection', sql.NVarChar(50), collection)
      .input('id', sql.BigInt, record.id)
      .input('code', sql.NVarChar(100), record.code || null)
      .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(record))
      .query('INSERT INTO dbo.Records (Collection, Id, Code, Payload) VALUES (@collection, @id, @code, @payload);');

    await tx.commit();
    invalidateCollectionCache(collection);
    return record;
  } catch (err) {
    await tx.rollback().catch(() => {});
    if (isUniqueConstraintViolation(err)) {
      throw new HttpError(409, `Mã "${record?.code}" đã tồn tại`);
    }
    throw err;
  }
}

// Khoá NGHIÊM TÚC theo 1 khoá nghiệp vụ bất kỳ (sp_getapplock, cùng cơ chế createForCollectionSerialized
// ở trên) bọc quanh TOÀN BỘ chuỗi đọc-kiểm tra-ghi của fn(), không giới hạn ở 1 lượt TẠO mới — dùng cho
// trường hợp bước DUYỆT (không phải tạo mới) có kiểm tra trùng lặp giữa NHIỀU bản ghi khác nhau (vd
// trùng biển số xe được GÁN ở bước duyệt carRegs, xem routes/workflow.js). withLockedRecordForCollection
// chỉ khoá ĐÚNG 1 dòng đang sửa (UPDLOCK theo Id) — 2 yêu cầu duyệt 2 hồ sơ KHÁC NHAU cùng gán 1 biển số
// trùng khung giờ vẫn đọc được "ảnh chụp" collection của nhau TRƯỚC khi cả hai commit, cả hai đều thấy
// "chưa ai gán trùng" rồi cùng gán trùng — phải khoá theo GIÁ TRỊ BIỂN SỐ (không phải theo Id bản ghi)
// trong suốt lúc fn() chạy để chặn đúng race này.
async function withAppLock(lockKey, fn) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const lockReq = new sql.Request(tx);
    lockReq.input('Resource', sql.NVarChar(255), lockKey);
    lockReq.input('LockMode', sql.VarChar(32), 'Exclusive');
    lockReq.input('LockOwner', sql.VarChar(32), 'Transaction');
    lockReq.input('LockTimeout', sql.Int, 15000);
    const lockResult = await lockReq.execute('sp_getapplock');
    if (lockResult.returnValue < 0) {
      throw new HttpError(409, 'Hệ thống đang bận xử lý một yêu cầu trùng — vui lòng thử lại.');
    }
    const result = await fn();
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

// mutatorFn(item) -> bản ghi đã sửa (hoặc throw HttpError, ví dụ 404/403/409, để huỷ giao dịch).
async function withLockedRecordForCollection(collection, id, mutatorFn) {
  if (MIGRATED_COLLECTIONS.has(collection)) return withLockedRecordById(collection, id, mutatorFn);
  let result;
  await withLockedAppDataValue(collection, (list) => {
    const arr = Array.isArray(list) ? list : [];
    const idx = arr.findIndex(it => it.id === id);
    if (idx === -1) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    result = mutatorFn(arr[idx]);
    arr[idx] = result;
    return arr;
  });
  return result;
}

// checkFn(item) (tuỳ chọn) -> throw HttpError (vd 403) để huỷ, không xoá gì.
async function deleteRecordForCollection(collection, id, checkFn) {
  if (MIGRATED_COLLECTIONS.has(collection)) return deleteRecordById(collection, id, checkFn);
  await withLockedAppDataValue(collection, (list) => {
    const arr = Array.isArray(list) ? list : [];
    const idx = arr.findIndex(it => it.id === id);
    if (idx === -1) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    if (checkFn) checkFn(arr[idx]);
    arr.splice(idx, 1);
    return arr;
  });
}

module.exports = {
  MIGRATED_COLLECTIONS,
  getAllRecords, insertRecord, withLockedRecordById, deleteRecordById, migrateLegacyCollection, migrateAllLegacyCollections,
  getAllForCollection, getAllForCollectionCached, createForCollection, createForCollectionSerialized, withAppLock, withLockedRecordForCollection, deleteRecordForCollection
};
