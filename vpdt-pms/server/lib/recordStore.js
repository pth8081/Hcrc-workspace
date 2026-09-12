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
const fs = require('fs');
const path = require('path');
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
// trainingCourses (Đợt 4): catalog "Chương Trình" — id+name+category+description, TÁI SỬ DỤNG được cho
// nhiều trainingClasses/trainingDocuments (courseId, tuỳ chọn) — cùng khuôn budgetTemplates ở trên
// (catalog nhỏ, quản lý qua create/delete chung, không cần bảng riêng).
// trainingPlans (Đợt 5): "Kế Hoạch Đào Tạo" theo tháng — cùng khuôn trainingCourses ở trên (catalog nhỏ,
// quản lý qua create/edit/delete chung), số thực tế (actual) hoàn toàn KHÔNG lưu ở đây — tính SỐNG từ
// trainingClasses/trainingRegistrations tại thời điểm xem (xem index.html renderTrainingPlanDashboard()).
// onboardingPaths/onboardingProgress (Đợt 6, Đào Tạo Tân Binh): onboardingPaths là catalog tái sử dụng
// (cùng khuôn trainingCourses), onboardingProgress là 1 dòng/1 nhân viên được phân công — hạn Giai đoạn
// 1/2/3 tính SỐNG từ onboardingProgress.startDate (đã snapshot lúc phân công) tại thời điểm xem, KHÔNG
// lưu deadline, cùng tinh thần trainingPlans ở trên.
// uniformTransfers (Phase 2, Đồng Phục — "Điều Chuyển Kho Giữa Các Siêu Thị"): cùng khuôn
// uniformIssuances/uniformStockAdjustments (bản ghi build bởi hành động riêng ở lib/recordActions.js,
// không qua engine tạo mới chung lib/createValidation.js — xem buildUniformTransfer()), đăng ký ở đây
// để dùng chung getAllForCollection()/insertRecord()/withLockedRecordForCollection() thay vì tự viết
// đường lưu riêng.
// hrFeedback (Nhân Sự — "HCRC Đồng Hành"): câu hỏi RIÊNG TƯ của từng nhân viên gửi lên bộ phận Nhân
// Sự (mô hình 1 hỏi – 1 đáp), tạo qua engine chung lib/createValidation.js (mở cho mọi nhân viên,
// không cần quyền riêng — cùng khuôn itSupportTickets), trả lời/đánh dấu đã đọc qua 2 route riêng ở
// routes/records.js (respondToHrFeedback()/markHrFeedbackRead() ở lib/recordActions.js).
// trainingDocumentProgress (video 0.5x-1.5x/xem hết PDF mới tính hoàn thành): 1 dòng/1 (tài liệu, người
// dùng) theo dõi giây đã xem xa nhất (video)/trang đã xem (PDF) — xem lib/recordActions.js
// computeTrainingDocumentProgressUpdate() + routes/records.js POST trainingDocuments/:id/track-progress.
// Cùng khuôn trainingTestSubmissions (không có createValidation.js riêng — route tự quản lý upsert theo
// khoá tự nhiên docId+username thay vì qua validateAndPrepareCreate(), vì đây không phải "tạo 1 hồ sơ độc
// lập theo lựa chọn người dùng" mà là 1 dòng trạng thái server tự cập nhật liên tục).
// hrProcesses (Nhân Sự > Onboarding / Offboarding v2 — checklist theo giai đoạn, xem
// lib/createValidation.js) — cố ý đặt tiền tố "hr" (KHÔNG dùng bare "process*") để không đụng tên với
// onboardingPaths/onboardingProgress ("Đào Tạo Tân Binh", hoàn toàn khác nghiệp vụ, đã có sẵn trong danh
// sách này từ trước). Thay hẳn cho hrOnboardingRequests/hrOffboardingRequests (bản v1, đã gỡ).
// payrollPeriods/payslips (Nhân Sự > Lương, xem lib/payroll.js đầu file cho toàn bộ điều chỉnh so với
// tài liệu gốc): tách RIÊNG 2 collection (period = sổ cái trạng thái/duyệt, payslip = 1 bản ghi/nhân
// viên/kỳ) — cùng khuôn reportPeriods/reportEntries. notifications: thông báo trong app GENERIC (xem
// lib/notifications.js) — hệ thống tự sinh liên tục (không qua createValidation.js), cùng khuôn
// attendanceRecords (tăng trưởng theo thời gian, cần khoá optimistic theo bản ghi khi đánh dấu đã đọc).
const MIGRATED_COLLECTIONS = new Set(['submissions', 'docs', 'carRegs', 'officeReqs', 'contracts', 'meetings', 'meetingMinutes', 'internalPosts', 'paymentRequests', 'vppPeriods', 'vppRegistrations', 'reportPeriods', 'reportEntries', 'trainingDocuments', 'trainingClasses', 'trainingRegistrations', 'careerPaths', 'careerPathConfirmations', 'trainingTests', 'trainingTestSubmissions', 'trainingCourses', 'trainingPlans', 'onboardingPaths', 'onboardingProgress', 'recruitmentJobs', 'recruitmentReferrals', 'itPriceApprovals', 'itSupportTickets', 'uniformPeriods', 'uniformIssuances', 'uniformStockAdjustments', 'uniformTransfers', 'budgetTemplates', 'budgetPeriods', 'budgetEntries', 'licenses', 'itServiceRenewals', 'hrFeedback', 'operationOrders', 'operationStoreOpenings', 'operationRepairs', 'operationExecutionPeriods', 'trainingDocumentProgress', 'hrProcesses', 'laborContracts',
  'attendanceRecords', 'shiftRoster', 'shiftSwapRequests', 'leaveBalances', 'leaveRequests', 'payrollPeriods', 'payslips', 'notifications',
  // Checklist Đánh Giá Siêu Thị (module TOP-LEVEL mới, xem lib/checklist.js) — checklistTemplates cùng
  // khuôn trainingTests (câu hỏi+lựa chọn nhúng thẳng trong bản ghi); checklistSubmissions cùng khuôn
  // trainingTestSubmissions (route tự quản lý, không qua createValidation.js).
  'checklistTemplates', 'checklistSubmissions']);

function toRecord(row) {
  return JSON.parse(row.Payload);
}

// Lỗi trùng khoá SQL Server (unique index UX_Records_Collection_Code) — request thứ 2 trong 1 race
// hiếm gặp (2 người tạo cùng mã CÙNG LÚC) nhận đúng thông báo nghiệp vụ thay vì lỗi SQL thô.
function isUniqueConstraintViolation(err) {
  return err && (err.number === 2601 || err.number === 2627);
}

async function getAllRecords(collection) {
  // Cùng lý do bảo vệ như insertRecord() ở dưới (Bước 7) — hàm này được gọi trực tiếp ở vài nơi ngoài
  // getAllForCollection() (seedDefaults.js...), phải tự biết collection nào đã "tốt nghiệp" sang bảng
  // riêng để không đọc nhầm dbo.Records (nay đã rỗng cho collection đó sau khi migrate dữ liệu).
  if (DEDICATED_TABLES[collection]) return getAllDedicatedRecords(collection);
  const pool = await getPool();
  const result = await pool.request()
    .input('collection', sql.NVarChar(50), collection)
    .query('SELECT Payload FROM dbo.Records WHERE Collection = @collection ORDER BY CreatedAt DESC, Id DESC');
  return result.recordset.map(toRecord);
}

// dbo.Records có 2 ràng buộc UNIQUE khác nhau (xem sql/schema.sql): PK_Records (Collection, Id) và
// UX_Records_Collection_Code (Collection, Code, khi Code khác NULL). record.id ở khắp lib/recordActions.js/
// createValidation.js/routes/records.js đều là `Date.now()` (đôi khi `+ i` cho tạo hàng loạt) — CHỈ đúng
// khi 2 request tạo record CÙNG collection không rơi đúng cùng mili-giây. Dưới tải cao (nhiều người bấm
// gần như cùng lúc, hoặc vòng lặp tạo hàng loạt) 2 record hoàn toàn khác nhau (Code khác nhau, thậm chí
// không có Code) vẫn có thể trùng Id — trước đây isUniqueConstraintViolation() gộp chung CẢ 2 loại đụng
// độ, báo nhầm "Mã ... đã tồn tại" cho lỗi thực ra chỉ là trùng Id (không phải lỗi của người dùng, họ
// không đổi được gì để tránh). Phân biệt bằng tên ràng buộc trong err.message (chuẩn SQL Server luôn kèm
// theo, VD "Violation of PRIMARY KEY constraint 'PK_Records'"): đụng PK_Records -> tự sinh Id khác rồi
// thử lại ngay (không cần người dùng biết); đụng UX_Records_Collection_Code -> đúng là lỗi nghiệp vụ, giữ
// nguyên thông báo cũ.
// Tách "prefix" + số thứ tự Ở CUỐI CÙNG của 1 mã (VD "HCRC-HCM-VBT-003" -> prefix "HCRC-HCM-VBT-", số
// "003") — khớp ĐÚNG chữ số cuối chuỗi (\d+$), không phải chữ số đầu tiên gặp được, vì prefix bản thân
// có thể chứa chữ số (VD mã phòng ban). Bản ghi không có chữ số nào ở cuối code (không khớp regex, hiếm
// — VD "WF" không đúng, dù thực ra WF luôn có số) -> null, xem retry ở insertRecord() bên dưới.
const CODE_SEQ_SUFFIX_RE = /^(.*?)(\d+)$/;

// Số thứ tự TIẾP THEO chưa từng dùng cho ĐÚNG prefix này trong `records` — lấy số LỚN NHẤT từng xuất
// hiện (không phải đếm số lượng còn lại), CÙNG NGUYÊN LÝ computeNextDocSeq()/computeNextHcrcSeq() ở
// public/js/module-tailieu.js (client, không import chung được — 2 cài đặt độc lập, sửa 1 bên phải sửa
// cả 2 bên nếu đổi thuật toán) — bản SERVER dùng khi tự sinh lại mã MỚI sau khi đụng trùng Code thật ở
// tầng CSDL (xem insertRecord() bên dưới).
function computeNextSeqForPrefix(records, prefix) {
  let maxSeq = 0;
  for (const r of records || []) {
    const code = String(r?.code || '');
    if (!code.startsWith(prefix)) continue;
    const n = parseInt(code.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
  }
  return maxSeq + 1;
}

// insertRecord() dùng chung cho MỌI collection có unique-code-index (không chỉ các collection gọi qua
// createForCollection() — buildUniformIssuance()/buildUniformTransfer()... ở lib/recordActions.js cũng
// gọi thẳng hàm này) — retry ở đây là fix TẦNG CHUNG, áp dụng tự nhiên cho mọi nơi.
const INSERT_RECORD_MAX_ATTEMPTS = 5;
// insertRecord() được gọi trực tiếp (không qua createForCollection()) ở nhiều nơi — lib/notifications.js
// notifyUsers(), lib/recordActions.js buildUniformIssuance()/buildUniformTransfer()... — nên bản thân
// hàm XUẤT RA này phải tự kiểm tra DEDICATED_TABLES (Bước 7) trước, KHÔNG được để mọi nơi gọi tự nhớ
// đổi sang insertDedicatedRecord() (dễ quên sót 1 chỗ, ghi nhầm vào dbo.Records cho collection đã
// "tốt nghiệp" sang bảng riêng — insertRecord() cũ sẽ không báo lỗi gì vì Collection vẫn là cột hợp lệ
// ở dbo.Records, chỉ là dữ liệu rơi sai bảng, rất khó phát hiện sau này).
async function insertRecord(collection, record) {
  if (DEDICATED_TABLES[collection]) return insertDedicatedRecord(collection, record);
  const pool = await getPool();
  for (let attempt = 1; attempt <= INSERT_RECORD_MAX_ATTEMPTS; attempt++) {
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
      invalidateCollectionCache(collection);
      return record;
    } catch (err) {
      if (!isUniqueConstraintViolation(err)) throw err;
      const isIdCollision = String(err.message || '').includes('PK_Records');
      if (isIdCollision) {
        if (attempt === INSERT_RECORD_MAX_ATTEMPTS) {
          throw new HttpError(409, 'Hệ thống đang bận, vui lòng thử tạo lại.');
        }
        record.id = Date.now() + Math.floor(Math.random() * 1000);
        continue;
      }
      // Trùng Code thật (UX_Records_Collection_Code) — THAY VÌ ném lỗi ngay như trước, tự thử sinh mã
      // MỚI cho record này rồi INSERT lại (tối đa hết vòng lặp attempt hiện tại, 5 lần) — "cố gắng tốt
      // nhất" cho UX mượt hơn khi mã được TÍNH Ở CLIENT trước khi gửi (client stale, hoặc 2 người tạo
      // gần như đồng thời). UNIQUE INDEX ở CSDL đã là lớp chặn chống race THẬT SỰ ở tầng thấp nhất rồi —
      // retry ở đây KHÔNG phải cơ chế chống race chính, chỉ tự sửa cho người dùng khỏi phải tự bấm lại.
      const m = CODE_SEQ_SUFFIX_RE.exec(String(record.code || ''));
      if (!m) {
        // Không có chữ số ở cuối để tự tăng -> không đoán mò, giữ nguyên hành vi cũ.
        throw new HttpError(409, `Mã "${record.code}" đã tồn tại`);
      }
      if (attempt === INSERT_RECORD_MAX_ATTEMPTS) {
        throw new HttpError(409, `Mã "${record.code}" đã tồn tại — đã thử tự động sinh mã mới nhưng vẫn trùng, vui lòng thử lại.`);
      }
      const [, prefix, digitsStr] = m;
      // Đọc lại DANH SÁCH BẢN GHI HIỆN TẠI real-time (KHÔNG dùng getAllForCollectionCached()) — cần đúng
      // trạng thái mới nhất ngay tại thời điểm retry để không tính lại đúng số đã trùng lần trước.
      const existing = await getAllRecords(collection);
      const nextSeq = computeNextSeqForPrefix(existing, prefix);
      record.code = prefix + String(nextSeq).padStart(digitsStr.length, '0');
    }
  }
}

// ===== BƯỚC 7 — Bảng riêng cho các collection tăng trưởng nhanh (xem sql/schema.sql, khối "BƯỚC 7") =====
//
// DEDICATED_TABLES: collection đã "tốt nghiệp" khỏi dbo.Records sang bảng riêng có cột SQL thật cho
// field lọc/join đã CÓ BẰNG CHỨNG cần dùng (lib/recordViewScope.js + module-baocaoquantri.js) — KHÔNG
// dùng chung dbo.Records (Collection column) nữa, mỗi collection ở đây là 1 bảng thật riêng. `hasCode`
// = bảng có cột Code + UNIQUE INDEX lọc (theo đúng khuôn dbo.Records) hay không — 6/11 collection ở
// đây không dùng Code (notifications/attendanceRecords/paymentRequests/checklistSubmissions/
// trainingTestSubmissions/trainingDocumentProgress đều có khoá tự nhiên riêng, không phải mã người
// dùng gõ). `columns` liệt kê CHÍNH XÁC cột trích xuất thêm (ngoài Id/CreatedAt/Code/Payload) — mỗi
// lần ghi (insert HOẶC sửa) đều tính lại toàn bộ từ Payload mới nhất, giữ luôn đồng bộ 2 bên.
const DEDICATED_TABLES = {
  notifications: {
    table: 'Notifications', hasCode: false,
    columns: {
      Username: { sqlType: () => sql.NVarChar(100), extract: r => r.username || null },
      IsRead:   { sqlType: () => sql.Bit,            extract: r => !!r.isRead }
    }
  },
  docs: {
    table: 'Docs', hasCode: true,
    columns: {
      Dept:      { sqlType: () => sql.NVarChar(100), extract: r => r.dept || null },
      Status:    { sqlType: () => sql.NVarChar(20),  extract: r => r.status || null },
      Uploader:  { sqlType: () => sql.NVarChar(100), extract: r => r.uploader || null },
      RootDocId: { sqlType: () => sql.BigInt,        extract: r => (r.rootDocId != null ? r.rootDocId : null) }
    }
  },
  submissions: {
    table: 'Submissions', hasCode: true,
    columns: {
      Dept:    { sqlType: () => sql.NVarChar(100), extract: r => r.dept || null },
      Creator: { sqlType: () => sql.NVarChar(100), extract: r => r.creator || null },
      Status:  { sqlType: () => sql.NVarChar(20),  extract: r => r.status || null }
    }
  },
  attendanceRecords: {
    table: 'AttendanceRecords', hasCode: false,
    columns: {
      EmployeeCode: { sqlType: () => sql.NVarChar(50), extract: r => r.employeeCode || null },
      WorkDate:     { sqlType: () => sql.Date,         extract: r => r.workDate || null },
      RecordType:   { sqlType: () => sql.NVarChar(20), extract: r => r.recordType || null }
    }
  },
  operationOrders: {
    table: 'OperationOrders', hasCode: true,
    columns: {
      Dept:    { sqlType: () => sql.NVarChar(100), extract: r => r.dept || null },
      Creator: { sqlType: () => sql.NVarChar(100), extract: r => r.creator || null },
      Status:  { sqlType: () => sql.NVarChar(20),  extract: r => r.status || null }
    }
  },
  operationStoreOpenings: {
    table: 'OperationStoreOpenings', hasCode: true,
    columns: {
      Dept:           { sqlType: () => sql.NVarChar(100), extract: r => r.dept || null },
      Creator:        { sqlType: () => sql.NVarChar(100), extract: r => r.creator || null },
      EstimateStatus: { sqlType: () => sql.NVarChar(20),  extract: r => r.estimateStatus || null }
    }
  },
  operationRepairs: {
    table: 'OperationRepairs', hasCode: true,
    columns: {
      Dept:           { sqlType: () => sql.NVarChar(100), extract: r => r.dept || null },
      Creator:        { sqlType: () => sql.NVarChar(100), extract: r => r.creator || null },
      EstimateStatus: { sqlType: () => sql.NVarChar(20),  extract: r => r.estimateStatus || null }
    }
  },
  paymentRequests: {
    table: 'PaymentRequests', hasCode: false,
    columns: {
      Dept:         { sqlType: () => sql.NVarChar(100), extract: r => r.dept || null },
      CreatedBy:    { sqlType: () => sql.NVarChar(100), extract: r => r.createdBy || null },
      SourceModule: { sqlType: () => sql.NVarChar(20),  extract: r => r.sourceModule || null },
      SourceId:     { sqlType: () => sql.BigInt,        extract: r => (r.sourceId != null ? r.sourceId : null) },
      Status:       { sqlType: () => sql.NVarChar(20),  extract: r => r.status || null }
    }
  },
  checklistSubmissions: {
    table: 'ChecklistSubmissions', hasCode: false,
    columns: {
      TemplateId:          { sqlType: () => sql.BigInt,        extract: r => (r.templateId != null ? r.templateId : null) },
      StoreCode:           { sqlType: () => sql.NVarChar(50),  extract: r => r.storeCode || null },
      SubmittedByUsername: { sqlType: () => sql.NVarChar(100), extract: r => r.submittedByUsername || null },
      Status:              { sqlType: () => sql.NVarChar(20),  extract: r => r.status || null }
    }
  },
  trainingTestSubmissions: {
    table: 'TrainingTestSubmissions', hasCode: false,
    columns: {
      TestId:   { sqlType: () => sql.BigInt,        extract: r => (r.testId != null ? r.testId : null) },
      ClassId:  { sqlType: () => sql.BigInt,        extract: r => (r.classId != null ? r.classId : null) },
      Username: { sqlType: () => sql.NVarChar(100), extract: r => r.username || null }
    }
  },
  trainingDocumentProgress: {
    table: 'TrainingDocumentProgress', hasCode: false,
    columns: {
      DocId:    { sqlType: () => sql.BigInt,        extract: r => (r.docId != null ? r.docId : null) },
      Username: { sqlType: () => sql.NVarChar(100), extract: r => r.username || null }
    }
  }
};

function dedicatedTableName(collection) {
  return 'dbo.' + DEDICATED_TABLES[collection].table;
}

// Build "SET Col1=@c_Col1, Col2=@c_Col2..." + gán input tương ứng — dùng chung cho insert/update để
// KHÔNG BAO GIỜ quên đồng bộ 1 cột nào đó (rủi ro thật nếu viết tay từng nơi: sửa Payload mà quên cập
// nhật cột trích xuất tương ứng, cột đó sẽ "đứng hình" mãi mãi giá trị lúc insert ban đầu).
function bindExtractedColumns(req, cfg, record) {
  const assignments = [];
  for (const [col, def] of Object.entries(cfg.columns)) {
    const paramName = 'c_' + col;
    req.input(paramName, def.sqlType(), def.extract(record));
    assignments.push({ col, param: paramName });
  }
  return assignments;
}

async function getAllDedicatedRecords(collection) {
  const pool = await getPool();
  const result = await pool.request()
    .query(`SELECT Payload FROM ${dedicatedTableName(collection)} ORDER BY CreatedAt DESC, Id DESC`);
  return result.recordset.map(toRecord);
}

// Bước 7d — đọc CÓ LỌC theo cột thật (WHERE ở SQL) + phân trang thật (OFFSET/FETCH), thay vì luôn tải
// nguyên collection về Node như getAllDedicatedRecords(). CHỦ Ý CHỈ nhận filter theo ĐÚNG tên cột đã
// khai báo trong DEDICATED_TABLES[collection].columns (bỏ qua field lạ, không cho where tuỳ ý theo
// chuỗi client gửi lên — tránh SQL injection qua tên cột động) — nơi gọi (route) tự map field cho phép
// theo TỪNG collection, không truyền thẳng req.query nguyên văn vào đây.
//
// KHÔNG thay thế logic lọc quyền xem (lib/recordViewScope.js filter*ForUser()) — hàm đó vẫn chạy y
// nguyên SAU khi đọc, trên tập đã được SQL thu hẹp trước thay vì trên nguyên cả collection. Vì vậy hàm
// này AN TOÀN dùng ngay (không đổi hành vi phân quyền hiện có), chỉ đổi hiệu năng: bớt số dòng phải tải
// + JSON.parse ở Node khi caller đã biết trước sẽ chỉ cần 1 khoảng dept/thời gian cụ thể (VD Báo Cáo).
async function queryDedicatedRecords(collection, { where = {}, dateFrom, dateTo, page, pageSize } = {}) {
  const cfg = DEDICATED_TABLES[collection];
  const table = dedicatedTableName(collection);
  const pool = await getPool();
  const req = pool.request();
  const conditions = [];
  for (const [col, value] of Object.entries(where)) {
    if (value == null) continue;
    const def = cfg.columns[col];
    if (!def) continue; // KHÔNG khai báo trong schema -> bỏ qua âm thầm, không đoán mò/không lỗi 500
    const paramName = 'w_' + col;
    req.input(paramName, def.sqlType(), value);
    conditions.push(`${col} = @${paramName}`);
  }
  if (dateFrom) {
    req.input('dateFrom', sql.DateTime2(3), new Date(dateFrom));
    conditions.push('CreatedAt >= @dateFrom');
  }
  if (dateTo) {
    req.input('dateTo', sql.DateTime2(3), new Date(dateTo));
    conditions.push('CreatedAt <= @dateTo');
  }
  const whereSql = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';

  if (page == null || pageSize == null) {
    const result = await req.query(`SELECT Payload FROM ${table}${whereSql} ORDER BY CreatedAt DESC, Id DESC`);
    return { items: result.recordset.map(toRecord), total: result.recordset.length };
  }

  // Phân trang thật: đếm tổng số khớp điều kiện (để client biết còn bao nhiêu trang) + lấy đúng 1 trang
  // bằng OFFSET/FETCH — CÙNG 1 request (dùng lại param đã bind ở trên cho cả 2 câu) để không phải bind
  // lại where 2 lần.
  req.input('offset', sql.Int, Math.max(0, (page - 1) * pageSize));
  req.input('pageSize', sql.Int, pageSize);
  const result = await req.query(`
    SELECT COUNT(*) AS Total FROM ${table}${whereSql};
    SELECT Payload FROM ${table}${whereSql} ORDER BY CreatedAt DESC, Id DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
  `);
  const total = result.recordsets[0][0].Total;
  const items = result.recordsets[1].map(toRecord);
  return { items, total };
}

async function insertDedicatedRecord(collection, record) {
  const cfg = DEDICATED_TABLES[collection];
  const table = dedicatedTableName(collection);
  const pool = await getPool();
  for (let attempt = 1; attempt <= INSERT_RECORD_MAX_ATTEMPTS; attempt++) {
    const req = pool.request();
    req.input('id', sql.BigInt, record.id);
    req.input('payload', sql.NVarChar(sql.MAX), JSON.stringify(record));
    const colNames = ['Id', 'Payload'];
    const colParams = ['@id', '@payload'];
    if (cfg.hasCode) {
      req.input('code', sql.NVarChar(100), record.code || null);
      colNames.push('Code'); colParams.push('@code');
    }
    for (const { col, param } of bindExtractedColumns(req, cfg, record)) {
      colNames.push(col); colParams.push('@' + param);
    }
    try {
      await req.query(`INSERT INTO ${table} (${colNames.join(', ')}) VALUES (${colParams.join(', ')});`);
      invalidateCollectionCache(collection);
      return record;
    } catch (err) {
      if (!isUniqueConstraintViolation(err)) throw err;
      const isIdCollision = String(err.message || '').includes(`PK_${cfg.table}`);
      if (isIdCollision) {
        if (attempt === INSERT_RECORD_MAX_ATTEMPTS) {
          throw new HttpError(409, 'Hệ thống đang bận, vui lòng thử tạo lại.');
        }
        record.id = Date.now() + Math.floor(Math.random() * 1000);
        continue;
      }
      // Trùng Code (chỉ 5/11 bảng có cột này) — cùng logic tự sinh mã mới rồi thử lại như insertRecord().
      if (!cfg.hasCode) throw err;
      const m = CODE_SEQ_SUFFIX_RE.exec(String(record.code || ''));
      if (!m) throw new HttpError(409, `Mã "${record.code}" đã tồn tại`);
      if (attempt === INSERT_RECORD_MAX_ATTEMPTS) {
        throw new HttpError(409, `Mã "${record.code}" đã tồn tại — đã thử tự động sinh mã mới nhưng vẫn trùng, vui lòng thử lại.`);
      }
      const [, prefix, digitsStr] = m;
      const existing = await getAllDedicatedRecords(collection);
      const nextSeq = computeNextSeqForPrefix(existing, prefix);
      record.code = prefix + String(nextSeq).padStart(digitsStr.length, '0');
    }
  }
}

async function withLockedDedicatedRecordById(collection, id, mutatorFn) {
  const cfg = DEDICATED_TABLES[collection];
  const table = dedicatedTableName(collection);
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const readReq = new sql.Request(tx);
    const readResult = await readReq
      .input('id', sql.BigInt, id)
      .query(`SELECT Payload FROM ${table} WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id`);
    if (readResult.recordset.length === 0) {
      throw new HttpError(404, 'Không tìm thấy hồ sơ');
    }
    const item = toRecord(readResult.recordset[0]);

    const updated = await mutatorFn(item);

    const writeReq = new sql.Request(tx);
    writeReq.input('id', sql.BigInt, id);
    writeReq.input('payload', sql.NVarChar(sql.MAX), JSON.stringify(updated));
    const setClauses = ['Payload = @payload'];
    if (cfg.hasCode) {
      writeReq.input('code', sql.NVarChar(100), updated.code || null);
      setClauses.push('Code = @code');
    }
    for (const { col, param } of bindExtractedColumns(writeReq, cfg, updated)) {
      setClauses.push(`${col} = @${param}`);
    }
    await writeReq.query(`UPDATE ${table} SET ${setClauses.join(', ')} WHERE Id = @id`);

    await tx.commit();
    invalidateCollectionCache(collection);
    return updated;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

// Cùng khuôn moveRecordToTrash() (bên dưới) — vẫn dùng CHUNG dbo.TrashBin (cột Collection ở đó đã đủ
// phân biệt bảng nguồn để restoreTrashItem() biết đường phục hồi đúng chỗ, xem sửa đổi restoreTrashItem()).
async function moveDedicatedRecordToTrash(collection, id, actor, checkFn) {
  const table = dedicatedTableName(collection);
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const readReq = new sql.Request(tx);
    const readResult = await readReq
      .input('id', sql.BigInt, id)
      .query(`SELECT Payload, ${DEDICATED_TABLES[collection].hasCode ? 'Code' : 'NULL AS Code'} FROM ${table} WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id`);
    if (readResult.recordset.length === 0) {
      throw new HttpError(404, 'Không tìm thấy hồ sơ');
    }
    const row = readResult.recordset[0];
    const item = toRecord(row);

    if (checkFn) await checkFn(item);

    const trashReq = new sql.Request(tx);
    await trashReq
      .input('collection', sql.NVarChar(50), collection)
      .input('originalId', sql.BigInt, id)
      .input('code', sql.NVarChar(100), row.Code || null)
      .input('payload', sql.NVarChar(sql.MAX), row.Payload)
      .input('deletedBy', sql.NVarChar(100), actor?.username || 'unknown')
      .input('deletedByName', sql.NVarChar(200), actor?.name || null)
      .query(`
        INSERT INTO dbo.TrashBin (Collection, OriginalId, Code, Payload, DeletedBy, DeletedByName)
        VALUES (@collection, @originalId, @code, @payload, @deletedBy, @deletedByName);
      `);

    const delReq = new sql.Request(tx);
    await delReq.input('id', sql.BigInt, id).query(`DELETE FROM ${table} WHERE Id = @id`);

    await tx.commit();
    invalidateCollectionCache(collection);
    invalidateTrashCache();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

async function withLockedRecordById(collection, id, mutatorFn) {
  // Cùng lý do bảo vệ như insertRecord()/getAllRecords() ở trên (Bước 7) — routes/records.js,
  // routes/payroll.js, seedDefaults.js, jobs/*.js đều gọi thẳng hàm này (không qua
  // withLockedRecordForCollection()) cho nhiều collection khác nhau.
  if (DEDICATED_TABLES[collection]) return withLockedDedicatedRecordById(collection, id, mutatorFn);
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
  // Chưa có bản "xoá thẳng" (không qua Thùng Rác) cho bảng riêng Bước 7 — 11 collection ở
  // DEDICATED_TABLES đều xoá qua Thùng Rác (deleteRecordForCollection() -> moveDedicatedRecordToTrash()).
  // Thà báo lỗi rõ ràng ngay ở đây còn hơn âm thầm xoá nhầm dbo.Records (nay rỗng cho collection đó).
  if (DEDICATED_TABLES[collection]) {
    throw new Error(`deleteRecordById() không hỗ trợ collection "${collection}" (đã chuyển sang bảng riêng Bước 7, dùng deleteRecordForCollection() thay thế).`);
  }
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

// ===== Thùng Rác (Trash Bin) — xem sql/schema.sql dbo.TrashBin + routes/trash.js. =====
//
// Trước đây "Xóa" ở mọi module (qua deleteRecordForCollection() bên dưới) là XÓA THẬT ngay lập tức
// (DELETE FROM dbo.Records) — không có đường lấy lại nếu bấm nhầm, và (như đã phát hiện qua báo cáo
// người dùng) code sinh mã tự động (generateHcrcCode() ở index.html) trước đây tính theo SỐ LƯỢNG bản
// ghi còn lại thay vì SỐ LỚN NHẤT đã dùng — xóa 1 bản ghi giữa dãy làm bản ghi mới tạo sau đó lại sinh
// đúng mã vừa xóa, đụng độ với chính bản ghi đã "biến mất" (đã fix riêng phần sinh mã ở phiên bản
// trước — xem generateHcrcCode()/computeNextContractSeq()/computeNextAddendumSeq()). Thùng Rác giải
// quyết yêu cầu rộng hơn: MỌI lượt xóa admin đều phải có đường khôi phục, và chỉ mất hẳn khi admin chủ
// động "Xóa vĩnh viễn" từ trong Thùng Rác.
//
// moveRecordToTrash() thay hẳn deleteRecordById() làm bước "xóa" thật sự cho MỌI collection đã ở
// dbo.Records (deleteRecordForCollection() bên dưới gọi hàm này thay vì deleteRecordById() — 1 điểm
// sửa duy nhất, tự động áp dụng cho TOÀN BỘ ~30 collection + mọi route delete hiện có, KỂ CẢ các luồng
// cascade xóa "cả họ" (docs/contracts — xem routes/records.js) vì cascade ở đó chỉ là gọi
// deleteRecordForCollection() NHIỀU LẦN, mỗi bản ghi liên quan tự vào Thùng Rác riêng, khôi phục lại
// được TỪNG bản ghi độc lập.
async function moveRecordToTrash(collection, id, actor, checkFn) {
  // Cùng lý do bảo vệ như deleteRecordById()/withLockedRecordById() ở trên (Bước 7).
  if (DEDICATED_TABLES[collection]) return moveDedicatedRecordToTrash(collection, id, actor, checkFn);
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const readReq = new sql.Request(tx);
    const readResult = await readReq
      .input('collection', sql.NVarChar(50), collection)
      .input('id', sql.BigInt, id)
      .query('SELECT Payload, Code FROM dbo.Records WITH (UPDLOCK, HOLDLOCK) WHERE Collection = @collection AND Id = @id');
    if (readResult.recordset.length === 0) {
      throw new HttpError(404, 'Không tìm thấy hồ sơ');
    }
    const row = readResult.recordset[0];
    const item = toRecord(row);

    if (checkFn) await checkFn(item);

    const trashReq = new sql.Request(tx);
    await trashReq
      .input('collection', sql.NVarChar(50), collection)
      .input('originalId', sql.BigInt, id)
      .input('code', sql.NVarChar(100), row.Code || null)
      .input('payload', sql.NVarChar(sql.MAX), row.Payload)
      .input('deletedBy', sql.NVarChar(100), actor?.username || 'unknown')
      .input('deletedByName', sql.NVarChar(200), actor?.name || null)
      .query(`
        INSERT INTO dbo.TrashBin (Collection, OriginalId, Code, Payload, DeletedBy, DeletedByName)
        VALUES (@collection, @originalId, @code, @payload, @deletedBy, @deletedByName);
      `);

    const delReq = new sql.Request(tx);
    await delReq
      .input('collection', sql.NVarChar(50), collection)
      .input('id', sql.BigInt, id)
      .query('DELETE FROM dbo.Records WHERE Collection = @collection AND Id = @id');

    await tx.commit();
    invalidateCollectionCache(collection);
    invalidateTrashCache();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

// Cache ngắn hạn cho TOÀN BỘ Thùng Rác — cùng khuôn/cùng TTL với getAllForCollectionCached() bên dưới.
// CẦN vì lib/fileAuthz.js tra Thùng Rác ở MỌI request /uploads không khớp bản ghi sống nào, mà đó lại
// là trường hợp THƯỜNG GẶP NHẤT (ảnh đại diện, logo — mỗi lần mở màn hình có thể vài chục lượt): không
// cache thì mỗi ảnh avatar là 1 lượt quét cả bảng TrashBin. Bị xoá ngay khi có thay đổi ở Thùng Rác
// (chuyển vào/khôi phục/xoá vĩnh viễn) nên độ trễ tối đa chỉ là TTL vài giây, và lệch theo hướng vô
// hại: file vừa bị xoá còn "dễ đọc" thêm vài giây (đúng như trước khi xoá), không phải ngược lại.
const trashCache = { value: null, expiresAt: 0 };

function invalidateTrashCache() {
  trashCache.value = null;
  trashCache.expiresAt = 0;
}

async function getAllTrashItemsCached() {
  if (trashCache.value && trashCache.expiresAt > Date.now()) return trashCache.value;
  const value = await getTrashItems(null);
  trashCache.value = value;
  trashCache.expiresAt = Date.now() + RECORDS_CACHE_TTL_MS;
  return value;
}

async function getTrashItems(collection) {
  const pool = await getPool();
  const req = pool.request();
  let query = 'SELECT Id, Collection, OriginalId, Code, DeletedBy, DeletedByName, DeletedAt, Payload FROM dbo.TrashBin';
  if (collection) {
    req.input('collection', sql.NVarChar(50), collection);
    query += ' WHERE Collection = @collection';
  }
  query += ' ORDER BY DeletedAt DESC, Id DESC';
  const result = await req.query(query);
  return result.recordset.map(r => ({
    trashId: Number(r.Id),
    collection: r.Collection,
    originalId: Number(r.OriginalId),
    code: r.Code,
    deletedBy: r.DeletedBy,
    deletedByName: r.DeletedByName,
    deletedAt: r.DeletedAt,
    item: JSON.parse(r.Payload)
  }));
}

// Khôi phục lại ĐÚNG Id gốc (không sinh Id mới) để mọi tham chiếu chéo (rootDocId, rootContractId,
// taskId gắn với hồ sơ này...) vẫn còn nguyên vẹn. Chặn khôi phục (409, không tự động đổi mã bên nào)
// nếu Code đã bị 1 bản ghi ĐANG HOẠT ĐỘNG khác trong cùng collection dùng lại kể từ lúc bị xóa — theo
// đúng lựa chọn đã thống nhất, ưu tiên an toàn dữ liệu hơn tiện lợi (không tự thêm hậu tố đổi khác mã
// gốc, tránh gây nhầm lẫn khi đối chiếu hồ sơ cũ).
async function restoreTrashItem(trashId) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const readReq = new sql.Request(tx);
    const readResult = await readReq
      .input('trashId', sql.BigInt, trashId)
      .query('SELECT * FROM dbo.TrashBin WITH (UPDLOCK, HOLDLOCK) WHERE Id = @trashId');
    if (readResult.recordset.length === 0) {
      throw new HttpError(404, 'Không tìm thấy mục này trong thùng rác');
    }
    const row = readResult.recordset[0];
    // Bảng đích để kiểm tra trùng Code/Id + INSERT khôi phục — dbo.Records (mọi collection cũ) HOẶC
    // bảng riêng của collection (nếu đã "tốt nghiệp" ở Bước 7, xem DEDICATED_TABLES) — dbo.TrashBin vẫn
    // dùng CHUNG cho cả 2 loại (cột Collection ở đó đủ phân biệt), chỉ nơi khôi phục TỚI là khác nhau.
    const dedicatedCfg = DEDICATED_TABLES[row.Collection];
    const targetTable = dedicatedCfg ? dedicatedTableName(row.Collection) : 'dbo.Records';
    const collectionFilter = dedicatedCfg ? '' : ' AND Collection = @collection';

    if (row.Code) {
      const codeCheckReq = new sql.Request(tx);
      codeCheckReq.input('code', sql.NVarChar(100), row.Code);
      if (!dedicatedCfg) codeCheckReq.input('collection', sql.NVarChar(50), row.Collection);
      const codeCheck = await codeCheckReq
        .query(`SELECT TOP 1 Id FROM ${targetTable} WHERE Code = @code${collectionFilter}`);
      if (codeCheck.recordset.length > 0) {
        throw new HttpError(409, `Mã "${row.Code}" đã được dùng lại cho 1 hồ sơ khác kể từ lúc bị xóa — vui lòng đổi mã hồ sơ mới đó trước khi khôi phục.`);
      }
    }
    const idCheckReq = new sql.Request(tx);
    idCheckReq.input('id', sql.BigInt, row.OriginalId);
    if (!dedicatedCfg) idCheckReq.input('collection', sql.NVarChar(50), row.Collection);
    const idCheck = await idCheckReq
      .query(`SELECT TOP 1 Id FROM ${targetTable} WHERE Id = @id${collectionFilter}`);
    if (idCheck.recordset.length > 0) {
      throw new HttpError(409, 'Đã có hồ sơ khác chiếm đúng vị trí (Id) này — không thể khôi phục.');
    }

    const insReq = new sql.Request(tx);
    insReq.input('id', sql.BigInt, row.OriginalId);
    insReq.input('payload', sql.NVarChar(sql.MAX), row.Payload);
    if (dedicatedCfg) {
      const colNames = ['Id', 'Payload'];
      const colParams = ['@id', '@payload'];
      if (dedicatedCfg.hasCode) {
        insReq.input('code', sql.NVarChar(100), row.Code || null);
        colNames.push('Code'); colParams.push('@code');
      }
      const restoredItem = JSON.parse(row.Payload);
      for (const { col, param } of bindExtractedColumns(insReq, dedicatedCfg, restoredItem)) {
        colNames.push(col); colParams.push('@' + param);
      }
      await insReq.query(`INSERT INTO ${targetTable} (${colNames.join(', ')}) VALUES (${colParams.join(', ')});`);
    } else {
      insReq.input('collection', sql.NVarChar(50), row.Collection);
      insReq.input('code', sql.NVarChar(100), row.Code || null);
      await insReq.query('INSERT INTO dbo.Records (Collection, Id, Code, Payload) VALUES (@collection, @id, @code, @payload);');
    }

    const delReq = new sql.Request(tx);
    await delReq.input('trashId', sql.BigInt, trashId).query('DELETE FROM dbo.TrashBin WHERE Id = @trashId');

    await tx.commit();
    invalidateCollectionCache(row.Collection);
    invalidateTrashCache();
    return { collection: row.Collection, item: JSON.parse(row.Payload) };
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

// Nhóm "họ" (family) của 1 hồ sơ đã trong Thùng Rác — CHỈ docs (rootDocId) và contracts
// (isAddendum/rootContractId) có khái niệm này (xoá 1 phiên bản/phụ lục sẽ cascade xoá cả họ vào
// Thùng Rác cùng lúc, xem routes/records.js docs/:id/delete và contracts/:id/delete). id gốc của họ:
// bản thân item nếu nó chính là gốc (rootDocId == null / !isAddendum), ngược lại là rootDocId/
// rootContractId nó trỏ tới.
function familyRootId(collection, item) {
  if (collection === 'docs') return item.rootDocId == null ? item.id : item.rootDocId;
  if (collection === 'contracts') return item.isAddendum ? item.rootContractId : item.id;
  return null;
}

// Khôi phục 1 hồ sơ TỪ Thùng Rác, rồi CỐ GẮNG khôi phục luôn mọi thành viên còn lại cùng "họ" (các
// phiên bản/phụ lục khác của cùng tài liệu/hợp đồng) đang còn trong Thùng Rác — đối xứng với việc XOÁ
// đã cascade cả họ vào Thùng Rác cùng lúc (routes/records.js). Trước đây restoreTrashItem() chỉ khôi
// phục ĐÚNG 1 mục — khôi phục 1 phiên bản giữa chừng để lại các phiên bản khác kẹt trong Thùng Rác,
// tài liệu/hợp đồng hiện ra với lịch sử phiên bản bị đứt quãng cho tới khi admin tự phát hiện và khôi
// phục nốt (Thùng Rác không có khái niệm "họ" để nhóm lại khi hiển thị).
//
// Hồ sơ được YÊU CẦU khôi phục (trashId) PHẢI thành công — lỗi ở mục này (404/409 mã trùng/vị trí
// trùng) vẫn ném ra như restoreTrashItem() cũ, giữ nguyên hành vi cho mọi caller hiện có. Các thành
// viên còn lại trong họ là BEST-EFFORT: 1 thành viên có thể đã bị khôi phục riêng trước đó, hoặc đã bị
// xoá vĩnh viễn, hoặc dính đúng lỗi mã trùng/vị trí trùng — không được để 1 thành viên lỗi làm hỏng cả
// lượt (mục chính đã khôi phục xong không nên bị rollback vì 1 thành viên phụ không khôi phục được).
async function restoreTrashItemWithFamily(trashId) {
  const primary = await restoreTrashItem(trashId);
  const rootId = familyRootId(primary.collection, primary.item);
  if (rootId == null) return { ...primary, restoredFamilyMembers: [], familyRestoreErrors: [] };

  const siblings = (await getTrashItems(primary.collection))
    .filter(t => t.trashId !== trashId && familyRootId(primary.collection, t.item) === rootId);

  const restoredFamilyMembers = [];
  const familyRestoreErrors = [];
  for (const sibling of siblings) {
    try {
      const restored = await restoreTrashItem(sibling.trashId);
      restoredFamilyMembers.push(restored.item);
    } catch (err) {
      familyRestoreErrors.push({ originalId: sibling.originalId, code: sibling.code, reason: err.message });
    }
  }
  return { ...primary, restoredFamilyMembers, familyRestoreErrors };
}

// ===== Dọn FILE VẬT LÝ khi xoá vĩnh viễn =====
//
// Thư mục lưu file người dùng tải lên — cùng đường dẫn routes/upload.js dùng (UPLOAD_DIR ở đó) và
// server.js phục vụ tĩnh qua /uploads.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// Sao y parseUploadsFileUrl() ở lib/fileAuthz.js (chỉ nhận "/uploads/<tên-file>" với tên file là MỘT
// thành phần, không "/", "\" hay ".."). Chép lại 4 dòng ở đây thay vì require chéo vì lib/fileAuthz.js
// đã require chính file này -> require vòng, mà đây lại đúng là chỗ CHỐNG path traversal cho lệnh
// fs.unlink bên dưới nên không thể bỏ.
function parseUploadsFileName(fileUrl) {
  const m = /^\/uploads\/([^/\\]+)$/.exec(String(fileUrl || ''));
  if (!m) return null;
  if (m[1] === '.' || m[1] === '..') return null;
  return m[1];
}

// Gom MỌI đường dẫn "/uploads/..." xuất hiện ở bất kỳ đâu trong payload 1 bản ghi — fileUrl/
// signedFileUrl/cvFileUrl ở cấp cao nhất, extraFiles[]/files[]/attachment/compilation.slides[], và cả
// trường bổ sung kiểu Tải tệp/Tải nhiều tệp trong customData/signedCustomData (xem
// collectDynamicFieldsData() ở public/index.html). Duyệt sâu chung thay vì liệt kê từng khuôn: Thùng
// Rác chứa bản ghi của MỌI collection nên không có 1 khuôn cố định nào để dựa vào.
function collectRecordFileUrls(value, out = new Set(), depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return out;
  if (Array.isArray(value)) {
    value.forEach(v => collectRecordFileUrls(v, out, depth + 1));
    return out;
  }
  for (const v of Object.values(value)) {
    if (typeof v === 'string' && parseUploadsFileName(v)) out.add(v);
    else collectRecordFileUrls(v, out, depth + 1);
  }
  return out;
}

// CÒN AI DÙNG file này nữa không? Quét cả 3 nơi dữ liệu có thể tham chiếu tới nó: dbo.Records (hồ sơ
// đang sống của mọi collection), dbo.TrashBin (hồ sơ khác cũng đang nằm trong thùng rác) và dbo.AppData
// (các collection chưa di trú + cấu hình/ảnh đại diện/logo). Dùng LIKE trên nguyên chuỗi JSON thay vì
// tự hiểu khuôn của từng collection — tên file do routes/upload.js sinh ra là
// "<timestamp>-<16 hex>.<ext>", đủ duy nhất để so khớp chuỗi không bị dương tính giả có ý nghĩa; và
// nếu có nhầm thì nhầm về phía AN TOÀN (giữ lại file, không xoá).
async function isFileUrlStillReferenced(pool, fileUrl) {
  const pattern = `%${fileUrl}%`;
  const queries = [
    'SELECT TOP 1 1 AS c FROM dbo.Records WHERE Payload LIKE @pat',
    'SELECT TOP 1 1 AS c FROM dbo.TrashBin WHERE Payload LIKE @pat',
    'SELECT TOP 1 1 AS c FROM dbo.AppData WHERE DataValue LIKE @pat'
  ];
  for (const q of queries) {
    const r = await pool.request().input('pat', sql.NVarChar(sql.MAX), pattern).query(q);
    if (r.recordset.length > 0) return true;
  }
  return false;
}

// Xoá thật các file trên đĩa mà KHÔNG còn bản ghi nào (sống hay trong thùng rác) tham chiếu tới. Mọi
// lỗi đều chỉ ghi log: file đã bị xoá tay/đã mất/không đủ quyền không được phép làm hỏng thao tác "Xoá
// vĩnh viễn" vốn đã hoàn tất ở CSDL.
async function unlinkUnreferencedUploads(fileUrls) {
  if (!fileUrls || fileUrls.size === 0) return { removed: [], kept: [] };
  const removed = [];
  const kept = [];
  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('⛔ Không kiểm tra được tham chiếu file khi xoá vĩnh viễn, giữ nguyên file:', err.message);
    return { removed, kept: [...fileUrls] };
  }
  for (const fileUrl of fileUrls) {
    const fileName = parseUploadsFileName(fileUrl);
    if (!fileName) continue;
    try {
      if (await isFileUrlStillReferenced(pool, fileUrl)) { kept.push(fileUrl); continue; }
      await fs.promises.unlink(path.join(UPLOAD_DIR, fileName));
      removed.push(fileUrl);
    } catch (err) {
      // ENOENT = file đã không còn trên đĩa -> coi như đã dọn xong, không phải lỗi.
      if (err && err.code === 'ENOENT') { removed.push(fileUrl); continue; }
      console.error(`⛔ Không xoá được file "${fileUrl}" khi xoá vĩnh viễn:`, err.message);
      kept.push(fileUrl);
    }
  }
  return { removed, kept };
}

// Xóa vĩnh viễn — xoá dòng ở dbo.TrashBin (dữ liệu đã không còn ở dbo.Records từ lúc chuyển vào thùng
// rác) VÀ dọn luôn file vật lý trong uploads/, không thể hoàn tác. Route gọi hàm này (routes/trash.js)
// bắt buộc xác thực lại (withApprovalAuth/consumeApprovalGrant) trước khi tới đây, khớp mức độ nghiêm
// trọng của 1 hành động không có đường lùi.
//
// TRƯỚC ĐÂY chỉ xoá dòng CSDL: file đính kèm của hồ sơ "đã xoá vĩnh viễn" vẫn nằm nguyên trên đĩa mãi
// mãi, và vì không còn bản ghi nào tra ngược ra nó nữa nên authorizeFileAccess() coi như file lạ ->
// FAIL-OPEN: ai còn giữ URL cũ (lịch sử duyệt web, chat, log proxy) vẫn tải lại được nguyên vẹn nội
// dung "đã bị xoá vĩnh viễn". Lấy luôn Payload qua OUTPUT DELETED (cùng 1 câu lệnh, không có khe hở
// giữa đọc và xoá) để biết chính xác file nào thuộc bản ghi vừa mất.
async function permanentlyDeleteTrashItem(trashId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('trashId', sql.BigInt, trashId)
    .query('DELETE FROM dbo.TrashBin OUTPUT DELETED.Id, DELETED.Payload WHERE Id = @trashId');
  if (result.recordset.length === 0) {
    throw new HttpError(404, 'Không tìm thấy mục này trong thùng rác');
  }
  invalidateTrashCache();

  let payload = null;
  try {
    payload = JSON.parse(result.recordset[0].Payload);
  } catch (err) {
    console.error('⛔ Payload thùng rác hỏng, bỏ qua bước dọn file:', err.message);
    return;
  }
  // Chỉ xoá file KHÔNG còn ai tham chiếu tới (xem isFileUrlStillReferenced) — bản ghi khác cùng trỏ tới
  // đúng file đó (dây chuyền phiên bản, hồ sơ chép lại...) vẫn phải đọc được file của mình.
  await unlinkUnreferencedUploads(collectRecordFileUrls(payload));
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
  if (DEDICATED_TABLES[collection]) return getAllDedicatedRecords(collection);
  if (MIGRATED_COLLECTIONS.has(collection)) return getAllRecords(collection);
  return (await getAppDataValue(collection)) || [];
}

// Sửa hàng loạt bản ghi trong 1 collection theo mutateFn(item) -> item KHÔNG đổi (trả lại ĐÚNG cùng
// reference "item" nếu không cần sửa gì) hoặc 1 object MỚI (đã sửa) — dùng cho cascade đổi tên 1 giá trị
// danh mục (VD Danh Mục Siêu Thị/Chức Danh, xem lib/catalogRename.js) lan toả ra MỌI bản ghi đang lưu
// nguyên chuỗi cũ, không giới hạn ở 1 bản ghi theo Id như withLockedRecordForCollection(). Khoá NGUYÊN
// CẢ collection trong suốt giao dịch (UPDLOCK/HOLDLOCK theo Collection, không theo từng Id) — chấp nhận
// được vì đây là thao tác ADMIN, không thường xuyên, không cần tối ưu tương tranh cao như các route
// nghiệp vụ hàng ngày khác.
async function renameFieldValueInCollection(collection, mutateFn) {
  if (DEDICATED_TABLES[collection]) {
    const cfg = DEDICATED_TABLES[collection];
    const table = dedicatedTableName(collection);
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const readReq = new sql.Request(tx);
      const readResult = await readReq.query(`SELECT Id, Payload, Code FROM ${table} WITH (UPDLOCK, HOLDLOCK)`);
      let changedCount = 0;
      for (const row of readResult.recordset) {
        const item = toRecord(row);
        const updated = mutateFn(item);
        if (updated === item) continue;
        changedCount++;
        const writeReq = new sql.Request(tx);
        writeReq.input('id', sql.BigInt, row.Id);
        writeReq.input('payload', sql.NVarChar(sql.MAX), JSON.stringify(updated));
        const setClauses = ['Payload = @payload'];
        if (cfg.hasCode) {
          writeReq.input('code', sql.NVarChar(100), updated.code || row.Code || null);
          setClauses.push('Code = @code');
        }
        for (const { col, param } of bindExtractedColumns(writeReq, cfg, updated)) {
          setClauses.push(`${col} = @${param}`);
        }
        await writeReq.query(`UPDATE ${table} SET ${setClauses.join(', ')} WHERE Id = @id`);
      }
      await tx.commit();
      if (changedCount) invalidateCollectionCache(collection);
      return changedCount;
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    }
  }
  if (MIGRATED_COLLECTIONS.has(collection)) {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const readReq = new sql.Request(tx);
      const readResult = await readReq
        .input('collection', sql.NVarChar(50), collection)
        .query('SELECT Id, Payload, Code FROM dbo.Records WITH (UPDLOCK, HOLDLOCK) WHERE Collection = @collection');
      let changedCount = 0;
      for (const row of readResult.recordset) {
        const item = toRecord(row);
        const updated = mutateFn(item);
        if (updated === item) continue; // mutateFn báo KHÔNG có gì đổi (cùng reference) -> bỏ qua, không ghi
        changedCount++;
        const writeReq = new sql.Request(tx);
        await writeReq
          .input('collection', sql.NVarChar(50), collection)
          .input('id', sql.BigInt, row.Id)
          .input('code', sql.NVarChar(100), updated.code || row.Code || null)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(updated))
          .query('UPDATE dbo.Records SET Code = @code, Payload = @payload WHERE Collection = @collection AND Id = @id');
      }
      await tx.commit();
      if (changedCount) invalidateCollectionCache(collection);
      return changedCount;
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    }
  }
  // Collection còn ở AppData (chưa migrate, VD "users"/"vppExcludeGroups") — dùng withLockedAppDataValue
  // sẵn có, ghi lại cả mảng (đơn giản hơn — các collection dạng này thường nhỏ, không cần chỉ ghi phần đổi).
  let changedCount = 0;
  await withLockedAppDataValue(collection, (list) => {
    return (Array.isArray(list) ? list : []).map(item => {
      const updated = mutateFn(item);
      if (updated !== item) changedCount++;
      return updated;
    });
  });
  return changedCount;
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
  if (DEDICATED_TABLES[collection]) {
    const existing = await getAllDedicatedRecords(collection);
    const record = await builderFn(existing);
    return insertDedicatedRecord(collection, record);
  }
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
  // Chưa hỗ trợ bảng riêng Bước 7 (chỉ dùng cho "meetings" hiện tại, chưa collection nào trong
  // DEDICATED_TABLES cần khoá nghiêm túc theo khoá nghiệp vụ khi tạo) — báo lỗi rõ thay vì âm thầm ghi
  // nhầm dbo.Records nếu sau này có ai gán thêm collection mới vào đường này.
  if (DEDICATED_TABLES[collection]) {
    throw new Error(`createForCollectionSerialized() chưa hỗ trợ collection "${collection}" (đã chuyển sang bảng riêng Bước 7).`);
  }
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
// lockKeyOrKeys: 1 khoá (chuỗi, hành vi CŨ giữ nguyên) HOẶC 1 MẢNG nhiều khoá (Phase 2 — vd duyệt điều
// chuyển kho đồng phục đụng tới ĐỒNG THỜI 2 siêu thị nguồn+đích, xem approveUniformTransfer() ở
// routes/records.js). Nhiều khoá được sắp XẾP THEO BẢNG CHỮ CÁI (khử trùng lặp) rồi giành applock LẦN
// LƯỢT theo đúng thứ tự đó, TRONG CÙNG 1 giao dịch (chỉ nhả hết khi commit/rollback) — đảm bảo 2 yêu cầu
// đụng CÙNG 2 khoá nhưng theo THỨ TỰ NGƯỢC NHAU (vd điều chuyển A->B và B->A cùng lúc) luôn giành khoá
// theo ĐÚNG 1 THỨ TỰ CỐ ĐỊNH như nhau -> không bao giờ deadlock chờ chéo nhau.
async function withAppLock(lockKeyOrKeys, fn) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const keys = Array.isArray(lockKeyOrKeys) ? [...new Set(lockKeyOrKeys)].sort() : [lockKeyOrKeys];
    for (const key of keys) {
      const lockReq = new sql.Request(tx);
      lockReq.input('Resource', sql.NVarChar(255), key);
      lockReq.input('LockMode', sql.VarChar(32), 'Exclusive');
      lockReq.input('LockOwner', sql.VarChar(32), 'Transaction');
      lockReq.input('LockTimeout', sql.Int, 15000);
      const lockResult = await lockReq.execute('sp_getapplock');
      if (lockResult.returnValue < 0) {
        throw new HttpError(409, 'Hệ thống đang bận xử lý một yêu cầu trùng — vui lòng thử lại.');
      }
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
  if (DEDICATED_TABLES[collection]) return withLockedDedicatedRecordById(collection, id, mutatorFn);
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

// checkFn(item) (tuỳ chọn) -> throw HttpError (vd 403) để huỷ, không xoá gì. actor ({username,name}, tuỳ
// chọn) -> người thực hiện xóa, ghi lại ở Thùng Rác (dbo.TrashBin) để hiển thị "ai xóa/lúc nào" — CHỈ
// áp dụng cho collection đã ở dbo.Records (moveRecordToTrash() thay deleteRecordById() làm bước xóa
// thật); các collection còn ở AppData (users, permGroups, danh mục cấu hình...) KHÔNG nằm trong phạm
// vi Thùng Rác (đã thống nhất phạm vi), vẫn xóa thẳng như cũ.
async function deleteRecordForCollection(collection, id, checkFn, actor) {
  if (DEDICATED_TABLES[collection]) return moveDedicatedRecordToTrash(collection, id, actor, checkFn);
  if (MIGRATED_COLLECTIONS.has(collection)) return moveRecordToTrash(collection, id, actor, checkFn);
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
  CODE_SEQ_SUFFIX_RE, computeNextSeqForPrefix,
  getAllRecords, insertRecord, withLockedRecordById, deleteRecordById, migrateLegacyCollection, migrateAllLegacyCollections,
  getAllForCollection, getAllForCollectionCached, createForCollection, createForCollectionSerialized, withAppLock, withLockedRecordForCollection, deleteRecordForCollection,
  renameFieldValueInCollection,
  moveRecordToTrash, getTrashItems, getAllTrashItemsCached, restoreTrashItem, restoreTrashItemWithFamily, familyRootId, permanentlyDeleteTrashItem,
  collectRecordFileUrls, unlinkUnreferencedUploads,
  // Bước 7 — xuất thêm để scripts/migrate-records-batch1.js (di trú dữ liệu 1 lần) dùng ĐÚNG cùng 1
  // logic trích cột (không viết lại tay ở script, tránh lệch giữa 2 nơi).
  DEDICATED_TABLES, dedicatedTableName, bindExtractedColumns, getAllDedicatedRecords, queryDedicatedRecords
};
