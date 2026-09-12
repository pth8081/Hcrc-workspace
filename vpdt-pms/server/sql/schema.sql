/* ==========================================================
   VPDT - Văn Phòng Điện Tử
   SQL Server Schema
   ==========================================================
   Thiết kế: 1 bảng AppData lưu trữ toàn bộ các "collection"
   của ứng dụng (docs, contracts, meetings, users, workflows...)
   dưới dạng JSON, mỗi collection = 1 dòng.

   Đây là cách chuyển đổi trung thực nhất từ localStorage sang
   MSSQL: KHÔNG thay đổi cấu trúc dữ liệu, chức năng hay các
   module hiện có của ứng dụng - chỉ thay nơi lưu trữ.

   Danh sách DataKey tương ứng chính xác với các field của
   object `DB` trong file index.html:
     depts, cats, users, docs, workflows, deptWorkflows,
     submissions, submissionDeptWorkflows, contracts, meetings,
     carRegs, carDeptWorkflows, officeReqs,
     officeBuyDeptWorkflows, officeFixDeptWorkflows,
     officeInvestDeptWorkflows, formTemplates, emailConfig,
     systemLogs
   ========================================================== */

IF DB_ID('VPDT_DMS') IS NULL
BEGIN
    CREATE DATABASE VPDT_DMS;
END
GO

USE VPDT_DMS;
GO

-- UX_Records_Collection_Code bên dưới là INDEX LỌC (filtered index, "WHERE Code IS NOT NULL") — bắt
-- buộc phiên làm việc phải bật QUOTED_IDENTIFIER, nếu không CREATE INDEX sẽ báo lỗi Msg 1934. Driver
-- cũ (sqlcmd/ODBC) tự bật sẵn nên trước đây không phát hiện ra, nhưng sqlcmd18 (mssql-tools18, khuyến
-- nghị dùng cho Ubuntu 22.04+ trong HUONG_DAN_DEPLOY_UBUNTU.md) không tự bật — đặt tường minh ở đây để
-- chạy đúng với cả 2 phiên bản công cụ.
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID('dbo.AppData', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AppData (
        DataKey     NVARCHAR(100)   NOT NULL PRIMARY KEY,
        DataValue   NVARCHAR(MAX)   NOT NULL,
        -- Độ chính xác mili-giây (3), KHÔNG để mặc định (7) — cột này giờ còn đóng vai trò "version
        -- token" cho optimistic concurrency (xem lib/appData.js: getAppDataValueWithVersion() /
        -- setAppDataValueIfVersionMatches()). JS Date chỉ có độ chính xác mili-giây, nên nếu cột lưu
        -- chính xác hơn (100ns mặc định), giá trị đọc ra rồi gửi lại để so sánh WHERE UpdatedAt=@x sẽ
        -- KHÔNG BAO GIỜ khớp — mọi lần ghi đều báo xung đột giả (409) dù không ai ghi đè gì cả.
        UpdatedAt   DATETIME2(3)    NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
ELSE
BEGIN
    -- Database đã tồn tại từ trước khi có optimistic concurrency (Bước 1) — hạ đúng độ chính xác cột
    -- UpdatedAt xuống mili-giây để hợp lệ dùng làm version token. Chỉ ALTER khi cột CHƯA đúng kiểu (tra
    -- INFORMATION_SCHEMA trước) — trước đây chạy ALTER COLUMN vô điều kiện ở MỌI lần deploy dù không có
    -- gì thay đổi, tốn 1 khoá schema không cần thiết trên bảng đọc ở gần như mọi request (audit Đợt 5,
    -- Giai đoạn 4). Vẫn an toàn chạy lại nhiều lần, không mất dữ liệu (chỉ cắt bớt phần dưới mili-giây
    -- vốn chưa được dùng) khi thực sự cần ALTER.
    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AppData' AND COLUMN_NAME = 'UpdatedAt'
          AND (DATA_TYPE <> 'datetime2' OR DATETIME_PRECISION <> 3 OR IS_NULLABLE <> 'NO')
    )
    BEGIN
        ALTER TABLE dbo.AppData ALTER COLUMN UpdatedAt DATETIME2(3) NOT NULL;
    END
END
GO

/* CẬP NHẬT: API /api/data (và các route con) giờ bắt buộc đăng nhập thật (xem routes/auth.js, lib/auth.js) — mật
   khẩu hash bằng bcrypt, phiên đăng nhập là JWT lưu trong cookie httpOnly. Không tạo bảng users
   riêng ở tầng DB: tài khoản nghiệp vụ vẫn là DB.users bên trong AppData (field "users") như thiết
   kế gốc, chỉ khác là server giờ tự xác thực/hash thay vì tin hoàn toàn vào client. */

/* CẬP NHẬT (Bước 6a — bắt đầu tách các collection tăng trưởng nhanh khỏi AppData sang bảng riêng
   theo dòng, xem lib/systemLogStore.js): nhật ký hệ thống (systemLogs) trước đây là 1 dòng JSON duy
   nhất trong AppData, GIỚI HẠN CỨNG 200 dòng gần nhất (cũ hơn bị ghi đè mất) vì mỗi lần ghi thêm 1
   log phải khoá + đọc/sửa/ghi lại NGUYÊN mảng. Chuyển sang bảng riêng, mỗi dòng log = 1 row thật:
   ghi thêm là 1 lệnh INSERT đơn giản (không còn khoá cả collection), cho phép giữ lịch sử dài hơn
   nhiều (xem RETENTION_KEEP trong lib/systemLogStore.js) mà không ảnh hưởng hiệu năng ghi. */
IF OBJECT_ID('dbo.SystemLogs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SystemLogs (
        Id            BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        CreatedAt     DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Username      NVARCHAR(100)  NOT NULL,
        FullName      NVARCHAR(200)  NULL,
        -- 300 (không phải 100): đủ chứa giá trị đã MÃ HOÁ AES-256-GCM khi bật LOG_ENCRYPTION_KEY (xem
        -- lib/logCrypto.js) — chuỗi mã hoá dài hơn IP gốc đáng kể (tiền tố "enc:" + base64(iv+tag+cipher)).
        IpAddress     NVARCHAR(300)  NULL,
        Module        NVARCHAR(50)   NOT NULL,
        ActionType    NVARCHAR(100)  NOT NULL,
        TargetObject  NVARCHAR(200)  NULL,
        Description   NVARCHAR(MAX)  NOT NULL,
        Status        NVARCHAR(20)   NOT NULL DEFAULT 'SUCCESS'
    );
    CREATE INDEX IX_SystemLogs_CreatedAt ON dbo.SystemLogs (CreatedAt DESC, Id DESC);
END
ELSE
BEGIN
    -- Database đã tồn tại từ trước khi có mã hoá IpAddress (xem lib/logCrypto.js) — mở rộng cột nếu vẫn
    -- còn 100 ký tự cũ, đủ chứa giá trị đã mã hoá. Chỉ ALTER khi cột CHƯA đúng độ rộng (tra
    -- INFORMATION_SCHEMA trước, cùng khuôn đã dùng cho AppData.UpdatedAt ở trên) — an toàn chạy lại
    -- nhiều lần, KHÔNG mất dữ liệu (chỉ mở rộng, không thu hẹp).
    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'SystemLogs' AND COLUMN_NAME = 'IpAddress'
          AND CHARACTER_MAXIMUM_LENGTH < 300
    )
    BEGIN
        ALTER TABLE dbo.SystemLogs ALTER COLUMN IpAddress NVARCHAR(300) NULL;
    END
END
GO

/* CẬP NHẬT (Bước 6b — Công việc, xem lib/taskStore.js): giống hệt lý do ở systemLogs (Bước 6a) —
   trước đây MỌI thao tác (giao việc, nhận việc, cập nhật tiến độ, xin gia hạn, huỷ việc...) đều phải
   khoá + đọc/sửa/ghi lại NGUYÊN mảng "tasks" trong AppData, dù chỉ đổi ĐÚNG 1 công việc. Với nhiều
   người dùng thao tác Công việc khác nhau CÙNG LÚC, mỗi thao tác đều tranh chấp khoá ở mức "cả
   collection" dù về bản chất không hề đụng tới cùng 1 bản ghi. Chuyển sang bảng riêng, mỗi Công việc
   = 1 dòng: khoá dòng cụ thể (WITH UPDLOCK, HOLDLOCK WHERE Id=@id) thay vì khoá cả bảng.
   Id giữ NGUYÊN kiểu tạo cũ (Date.now() ở lib/recordActions.js, KHÔNG dùng IDENTITY) — id đã tồn tại
   trong dữ liệu cũ (di trú từ AppData) phải khớp đúng, không đổi cách sinh id.
   Payload giữ NGUYÊN VẸN toàn bộ object Công việc dạng JSON (nguồn dữ liệu chính) — các cột
   Status/AssignedTo/AssignedBy/SourceType/SourceCode chỉ là bản sao trích xuất để tiện lọc/tra cứu
   sau này, LUÔN đồng bộ với Payload ở mọi lần ghi (xem lib/taskStore.js). */
IF OBJECT_ID('dbo.Tasks', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Tasks (
        Id           BIGINT         NOT NULL PRIMARY KEY,
        CreatedAt    DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Status       NVARCHAR(20)   NOT NULL,
        AssignedTo   NVARCHAR(100)  NULL,
        AssignedBy   NVARCHAR(100)  NULL,
        SourceType   NVARCHAR(30)   NULL,
        SourceCode   NVARCHAR(100)  NULL,
        Payload      NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_Tasks_CreatedAt ON dbo.Tasks (CreatedAt DESC, Id DESC);
END
GO

/* Vận Hành — cây công việc "Thực hiện" cho Mở Mới/Sửa Chữa Siêu Thị (lib/operationWorkItemStore.js).
   Bảng RIÊNG, KHÔNG dùng chung dbo.Tasks: subtasks của Công việc công ty chỉ 1 cấp phẳng và gắn chặt
   semantics "Nhận Việc/gia hạn/huỷ việc" của 1 người — ở đây cần cây ĐA CẤP thật (ParentWorkItemId) +
   bộ trạng thái riêng có bước "Nghiệm thu" (CHUA_BAT_DAU/DANG_THUC_HIEN/DANG_NGHIEM_THU/DA_NGHIEM_THU),
   tách hẳn để không đụng state machine Task dùng chung toàn công ty. Payload giữ NGUYÊN VẸN object công
   việc (cùng khuôn dbo.Tasks) — SourceType/SourceId/ParentWorkItemId chỉ là cột trích xuất để lọc/tra
   cứu nhanh theo hồ sơ nguồn hoặc theo cây, xem lib/operationWorkItemStore.js. */
IF OBJECT_ID('dbo.OperationWorkItems', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.OperationWorkItems (
        Id               BIGINT         NOT NULL PRIMARY KEY,
        CreatedAt        DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Status           NVARCHAR(20)   NOT NULL,
        ParentWorkItemId BIGINT         NULL,
        SourceType       NVARCHAR(30)   NOT NULL,
        SourceId         BIGINT         NOT NULL,
        Payload          NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_OperationWorkItems_Source ON dbo.OperationWorkItems (SourceType, SourceId);
    CREATE INDEX IX_OperationWorkItems_Parent ON dbo.OperationWorkItems (ParentWorkItemId);
END
GO

/* SỬA LỖI (phát hiện khi triển khai đợt "Chi Phí Phê Duyệt/Danh Mục Đầu Tư/Thực Hiện linh hoạt"): cột
   SourceId ban đầu tạo kiểu INT (32-bit, tối đa ~2.1 tỷ) trong khi giá trị thật luôn là id kiểu
   Date.now() (mili-giây từ epoch, ~1.7 nghìn tỷ ở thời điểm hiện tại — VƯỢT TRẦN INT ngay lập tức) —
   khiến MỌI lần tạo công việc Thực hiện thật sự (POST /api/records/operationWorkItems) chắc chắn lỗi
   500 "Validation failed for parameter 'sourceId'" trên SQL Server thật, chỉ không bị phát hiện trước
   đây vì bộ test hiện có chạy qua mock backend (tests/testHarness.js) không đi qua kiểu dữ liệu SQL
   thật. An toàn chạy lại nhiều lần (chỉ ALTER khi cột CHƯA đúng kiểu, cùng khuôn cột AppData.UpdatedAt
   ở trên) — mở rộng INT -> BIGINT không mất dữ liệu đã có. */
IF OBJECT_ID('dbo.OperationWorkItems', 'U') IS NOT NULL AND EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'OperationWorkItems' AND COLUMN_NAME = 'SourceId' AND DATA_TYPE = 'int'
)
BEGIN
    DROP INDEX IX_OperationWorkItems_Source ON dbo.OperationWorkItems;
    ALTER TABLE dbo.OperationWorkItems ALTER COLUMN SourceId BIGINT NOT NULL;
    CREATE INDEX IX_OperationWorkItems_Source ON dbo.OperationWorkItems (SourceType, SourceId);
END
GO

/* CẬP NHẬT (Bước 6c trở đi — hồ sơ nghiệp vụ dùng chung 2 engine generic lib/createValidation.js +
   lib/workflowEngine.js: submissions/docs/carRegs/officeReqs, cùng lib/recordActions.js cho
   contracts/meetingMinutes): thay vì viết 1 bảng riêng cho mỗi collection như SystemLogs/Tasks (không
   hợp lý vì các collection này không có bộ cột lọc chung cố định như Tasks), dùng 1 bảng DÙNG CHUNG
   cho nhiều collection, phân biệt bằng cột Collection — mỗi bản ghi vẫn là 1 dòng riêng (khoá đúng 1
   dòng thay vì cả collection, cùng lý do đã nêu ở SystemLogs/Tasks). xem lib/recordStore.js —
   MIGRATED_COLLECTIONS ở đó liệt kê collection nào đã chuyển sang đây; collection chưa có trong danh
   sách đó vẫn ở AppData như cũ, cùng 1 bảng này phục vụ được TẤT CẢ các bước 6c/6d/... tiếp theo mà
   không cần thêm bảng/schema mới mỗi bước.
   Code (mã hồ sơ, vd "TT-001") tách thành cột thật + UNIQUE INDEX lọc (Code IS NOT NULL) — khi còn ở
   AppData, chống trùng mã dựa vào khoá cả collection lúc tạo (WITH UPDLOCK, HOLDLOCK); ở đây không còn
   khoá cả collection nữa nên cần ràng buộc UNIQUE thật ở tầng CSDL để chặn 2 request tạo cùng mã CÙNG
   LÚC (race) — kể cả xác suất xảy ra rất thấp, đây là cách chặn ĐÚNG thay vì chỉ dựa vào kiểm tra ở
   tầng ứng dụng (đọc danh sách hiện có rồi so sánh, có khoảng hở giữa đọc và ghi). */
IF OBJECT_ID('dbo.Records', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Records (
        Collection   NVARCHAR(50)   NOT NULL,
        Id           BIGINT         NOT NULL,
        Code         NVARCHAR(100)  NULL,
        CreatedAt    DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Payload      NVARCHAR(MAX)  NOT NULL,
        CONSTRAINT PK_Records PRIMARY KEY (Collection, Id)
    );
    CREATE INDEX IX_Records_Collection_CreatedAt ON dbo.Records (Collection, CreatedAt DESC, Id DESC);
    CREATE UNIQUE INDEX UX_Records_Collection_Code ON dbo.Records (Collection, Code) WHERE Code IS NOT NULL;
END
GO

/* ==========================================================
   BƯỚC 7 — Tách các collection tăng trưởng nhanh (không giới hạn theo thời gian, KHÔNG bị chặn trần
   bởi số nhân sự/danh mục cấu hình) khỏi bảng dùng chung dbo.Records sang bảng riêng — cùng lý do và
   cùng khuôn đã áp dụng cho SystemLogs (Bước 6a)/Tasks (Bước 6b): dbo.Records chỉ có Collection/Id/
   Code/CreatedAt là cột SQL thật, MỌI field nghiệp vụ khác (status, dept, người tạo...) chỉ nằm trong
   Payload JSON — không lọc/sắp xếp được ở tầng CSDL, mọi request đều phải tải NGUYÊN cả collection vào
   Node rồi lọc bằng JavaScript. Ở quy mô nhỏ (hàng nghìn dòng) không sao, nhưng các collection tăng
   trưởng theo THỜI GIAN không giới hạn (chấm công mỗi ngày/mỗi nhân viên, thông báo hệ thống tự sinh
   liên tục, đơn hàng/hồ sơ mỗi sự kiện nghiệp vụ...) sẽ chạm ngưỡng hàng triệu dòng sau vài năm vận
   hành — đây là bước bắt đầu xử lý đúng nhóm collection đó (không áp dụng cho TOÀN BỘ 44+ collection
   còn lại trong dbo.Records — phần lớn bị chặn trần tự nhiên bởi số nhân sự/danh mục, không cần bảng
   riêng, xem thảo luận đã thống nhất với người dùng).

   Nguyên tắc thiết kế mỗi bảng ở Bước 7 (giữ NHẤT QUÁN với Tasks/OperationWorkItems đã có):
   - Payload NVARCHAR(MAX) vẫn là NGUỒN DỮ LIỆU CHÍNH (đầy đủ, không mất field nào) — an toàn ngay cả
     khi có field nào đó chưa được liệt kê thành cột trích xuất.
   - Chỉ trích xuất thành cột SQL thật ĐÚNG các field đã xác nhận dùng để lọc quyền xem
     (lib/recordViewScope.js) hoặc dùng ở Báo Cáo (module-baocaoquantri.js) — đây là field THỰC SỰ cần
     WHERE/index, không suy đoán thêm field khác chưa có bằng chứng dùng tới.
   - Id GIỮ NGUYÊN kiểu Date.now() cho dữ liệu cũ di trú từ dbo.Records (khớp đúng mọi tham chiếu chéo
     hiện có: taskId, rootDocId...); bản ghi MỚI tạo sau khi migrate mới dùng IDENTITY.
   ========================================================== */

/* Thông báo trong app (lib/notifications.js) — sinh liên tục, không giới hạn theo thời gian (mỗi hành
   động nghiệp vụ ở BẤT KỲ module nào có thể tạo thông báo mới cho nhiều người nhận cùng lúc). Trước đây
   ở dbo.Records, mọi lượt "đánh dấu đã đọc" hay đếm số chưa đọc đều phải tải NGUYÊN mảng thông báo của
   TẤT CẢ mọi người rồi lọc theo username trong Node — trong khi bản chất truy vấn chỉ cần "thông báo của
   1 người". Username tách cột thật + index vì đây là DUY NHẤT điều kiện lọc (xem canViewNotification()/
   filterNotificationsForUser() ở lib/notifications.js — chỉ so username, không có field nào khác dùng
   để lọc quyền xem). IsRead tách cột thật vì đây là field bị SỬA thường xuyên nhất (mỗi lần người dùng
   mở thông báo) — tách riêng để UPDATE 1 cột thay vì ghi lại cả Payload mỗi lần đánh dấu đã đọc.
   CreatedAt: cột SQL dùng SYSUTCDATETIME() (giờ ghi thật, sắp xếp được) — KHÁC với field "createdAt"
   bên trong Payload (chuỗi hiển thị theo giờ Việt Nam dạng toLocaleString('vi-VN'), không sort được bằng
   SQL) — Payload["createdAt"] giữ nguyên để hiển thị, không dùng làm cột sắp xếp. */
IF OBJECT_ID('dbo.Notifications', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Notifications (
        Id         BIGINT         NOT NULL CONSTRAINT PK_Notifications PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Username   NVARCHAR(100)  NOT NULL,
        IsRead     BIT            NOT NULL DEFAULT 0,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_Notifications_Username_CreatedAt ON dbo.Notifications (Username, CreatedAt DESC, Id DESC);
END
GO

/* docs (lib/createValidation.js validateAndPrepareCreate 'docs' + lib/workflowEngine.js) — Dept/Status/
   Uploader tách cột thật vì đây đúng 3 field lib/recordViewScope.js canViewDoc()/filterDocsForUser()
   dùng để lọc quyền xem + Báo Cáo module-baocaoquantri.js dùng để nhóm/đếm. RootDocId (tự tham chiếu
   tới chính bảng này) tách cột vì đây là khoá nhóm "họ" phiên bản tài liệu (xem familyRootId() ở
   lib/recordStore.js) — cần lọc nhanh "mọi phiên bản của 1 tài liệu gốc" khi hiển thị lịch sử phiên bản.
   history[] (lịch sử duyệt, tăng theo mỗi hành động) CHƯA tách bảng con ở đợt này — không phải field bị
   lọc/WHERE trực tiếp (chỉ đọc kèm khi xem 1 hồ sơ cụ thể), giữ trong Payload đúng nguyên tắc chỉ tách
   cột có bằng chứng cần lọc SQL thật. */
IF OBJECT_ID('dbo.Docs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Docs (
        Id         BIGINT         NOT NULL CONSTRAINT PK_Docs PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Code       NVARCHAR(100)  NULL,
        Dept       NVARCHAR(100)  NOT NULL,
        Status     NVARCHAR(20)   NOT NULL,
        Uploader   NVARCHAR(100)  NULL,
        RootDocId  BIGINT         NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_Docs_Dept_Status_CreatedAt ON dbo.Docs (Dept, Status, CreatedAt DESC, Id DESC);
    CREATE INDEX IX_Docs_RootDocId ON dbo.Docs (RootDocId);
    CREATE UNIQUE INDEX UX_Docs_Code ON dbo.Docs (Code) WHERE Code IS NOT NULL;
END
GO

/* submissions (Văn Bản Trình — lib/createValidation.js + lib/workflowEngine.js) — Dept/Creator/Status
   cùng lý do docs ở trên (lib/recordViewScope.js canViewSubmission()/filterSubmissionsForUser() + Báo
   Cáo). effectiveSteps/effectiveApprovers/selectedLayerMembers (snapshot cấu hình quy trình tại thời
   điểm tạo) CỐ Ý giữ trong Payload — hình dạng phụ thuộc cấu hình quy trình theo phòng ban admin tự
   thiết lập, không cố định để làm cột. */
IF OBJECT_ID('dbo.Submissions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Submissions (
        Id         BIGINT         NOT NULL CONSTRAINT PK_Submissions PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Code       NVARCHAR(100)  NULL,
        Dept       NVARCHAR(100)  NOT NULL,
        Creator    NVARCHAR(100)  NULL,
        Status     NVARCHAR(20)   NOT NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_Submissions_Dept_Status_CreatedAt ON dbo.Submissions (Dept, Status, CreatedAt DESC, Id DESC);
    CREATE INDEX IX_Submissions_Creator ON dbo.Submissions (Creator, CreatedAt DESC);
    CREATE UNIQUE INDEX UX_Submissions_Code ON dbo.Submissions (Code) WHERE Code IS NOT NULL;
END
GO

/* attendanceRecords (Chấm Công — lib/attendance.js) — ứng viên tăng trưởng NHANH NHẤT trong toàn bộ hệ
   thống (1 dòng/nhân viên/ngày, không có trần tự nhiên, cộng dồn qua nhiều năm chắc chắn tới quy mô
   triệu dòng). EmployeeCode+WorkDate tách cột thật (khoá tự nhiên UNIQUE đã áp dụng ở tầng ứng dụng,
   nay ràng buộc thêm ở CSDL) — đây cũng đúng 2 field lib/recordViewScope.js
   filterAttendanceRecordsForUser() dùng để lọc. RecordType tách cột vì Báo Cáo Chấm Công cần nhóm theo
   loại (WORK/LEAVE.../OVERTIME...) nhanh khi lọc theo khoảng ngày dài (cả năm). KHÔNG đưa vào Báo Cáo
   Quản Trị chung (module-baocaoquantri.js) — thuộc nhóm dữ liệu cực nhạy cảm đã chặn khỏi GET /api/data
   chung, giữ nguyên ngoại lệ đã thống nhất trước đây. */
IF OBJECT_ID('dbo.AttendanceRecords', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AttendanceRecords (
        Id            BIGINT         NOT NULL CONSTRAINT PK_AttendanceRecords PRIMARY KEY,
        CreatedAt     DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        EmployeeCode  NVARCHAR(50)   NOT NULL,
        WorkDate      DATE           NOT NULL,
        RecordType    NVARCHAR(20)   NOT NULL,
        Payload       NVARCHAR(MAX)  NOT NULL
    );
    CREATE UNIQUE INDEX UX_AttendanceRecords_Employee_Date ON dbo.AttendanceRecords (EmployeeCode, WorkDate);
    CREATE INDEX IX_AttendanceRecords_Date_Type ON dbo.AttendanceRecords (WorkDate, RecordType);
END
GO

/* operationOrders (Vận Hành > Đơn Hàng — lib/createValidation.js + lib/recordActions.js) — Dept/Creator/
   Status cùng lý do docs/submissions (lib/recordViewScope.js canViewOperationOrder() + Báo Cáo).
   items[] (dòng hàng hoá) và history[] CHƯA tách bảng con ở đợt này — cùng lý do đã nêu ở docs.history
   (không phải điều kiện lọc SQL, chỉ đọc kèm theo đúng 1 hồ sơ). */
IF OBJECT_ID('dbo.OperationOrders', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.OperationOrders (
        Id         BIGINT         NOT NULL CONSTRAINT PK_OperationOrders PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Code       NVARCHAR(100)  NULL,
        Dept       NVARCHAR(100)  NOT NULL,
        Creator    NVARCHAR(100)  NULL,
        Status     NVARCHAR(20)   NOT NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_OperationOrders_Dept_Status_CreatedAt ON dbo.OperationOrders (Dept, Status, CreatedAt DESC, Id DESC);
    CREATE UNIQUE INDEX UX_OperationOrders_Code ON dbo.OperationOrders (Code) WHERE Code IS NOT NULL;
END
GO

/* operationStoreOpenings / operationRepairs (Vận Hành > Mở Mới & Sửa Chữa Siêu Thị — cùng khuôn field,
   xử lý chung 1 cặp hàm ở lib/recordActions.js theo sourceType) — Dept/Creator/EstimateStatus tách cột
   (EstimateStatus, không phải Status cũ đã bỏ theo Mục H, là trạng thái THẬT hiện dùng ở Báo Cáo +
   lib/recordViewScope.js). estimateItems[] (cây hạng mục đầu tư, có ParentId) và estimateHistory[]/
   history[] CHƯA tách bảng ở đợt này, cùng lý do docs.history. */
IF OBJECT_ID('dbo.OperationStoreOpenings', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.OperationStoreOpenings (
        Id              BIGINT         NOT NULL CONSTRAINT PK_OperationStoreOpenings PRIMARY KEY,
        CreatedAt       DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Code            NVARCHAR(100)  NULL,
        Dept            NVARCHAR(100)  NOT NULL,
        Creator         NVARCHAR(100)  NULL,
        EstimateStatus  NVARCHAR(20)   NOT NULL,
        Payload         NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_OperationStoreOpenings_Dept_Status_CreatedAt ON dbo.OperationStoreOpenings (Dept, EstimateStatus, CreatedAt DESC, Id DESC);
    CREATE UNIQUE INDEX UX_OperationStoreOpenings_Code ON dbo.OperationStoreOpenings (Code) WHERE Code IS NOT NULL;
END
GO

IF OBJECT_ID('dbo.OperationRepairs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.OperationRepairs (
        Id              BIGINT         NOT NULL CONSTRAINT PK_OperationRepairs PRIMARY KEY,
        CreatedAt       DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Code            NVARCHAR(100)  NULL,
        Dept            NVARCHAR(100)  NOT NULL,
        Creator         NVARCHAR(100)  NULL,
        EstimateStatus  NVARCHAR(20)   NOT NULL,
        Payload         NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_OperationRepairs_Dept_Status_CreatedAt ON dbo.OperationRepairs (Dept, EstimateStatus, CreatedAt DESC, Id DESC);
    CREATE UNIQUE INDEX UX_OperationRepairs_Code ON dbo.OperationRepairs (Code) WHERE Code IS NOT NULL;
END
GO

/* paymentRequests (Đề Nghị Thanh Toán — lib/createValidation.js + lib/recordActions.js) — Dept/
   CreatedBy/Status cùng lý do docs (lib/recordViewScope.js canViewPaymentRequest() + Báo Cáo).
   SourceModule+SourceId là FK ĐA HÌNH (polymorphic) tới contracts.id HOẶC officeReqs.id tuỳ
   SourceModule — không ràng buộc FK CỨNG được (2 bảng đích khác nhau), chỉ index để tra cứu nhanh
   "các đề nghị thanh toán của 1 hợp đồng/đề nghị mua sắm cụ thể". installments[]/requestFiles[]/
   history[] CHƯA tách bảng ở đợt này, cùng lý do docs.history. */
IF OBJECT_ID('dbo.PaymentRequests', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PaymentRequests (
        Id            BIGINT         NOT NULL CONSTRAINT PK_PaymentRequests PRIMARY KEY,
        CreatedAt     DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Dept          NVARCHAR(100)  NOT NULL,
        CreatedBy     NVARCHAR(100)  NULL,
        SourceModule  NVARCHAR(20)   NULL,
        SourceId      BIGINT         NULL,
        Status        NVARCHAR(20)   NOT NULL,
        Payload       NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_PaymentRequests_Dept_Status_CreatedAt ON dbo.PaymentRequests (Dept, Status, CreatedAt DESC, Id DESC);
    CREATE INDEX IX_PaymentRequests_Source ON dbo.PaymentRequests (SourceModule, SourceId);
END
GO

/* checklistSubmissions (Checklist Đánh Giá Siêu Thị — lib/checklist.js + routes/checklist.js) —
   TemplateId/StoreCode/SubmittedByUsername tách cột (lib/recordViewScope.js
   canViewChecklistSubmission()/filterChecklistSubmissionsForUser() dùng đúng 2 field StoreCode +
   SubmittedByUsername để lọc quyền xem, TemplateId cần tra cứu nhanh "mọi bài nộp theo 1 mẫu"). */
IF OBJECT_ID('dbo.ChecklistSubmissions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ChecklistSubmissions (
        Id                    BIGINT         NOT NULL CONSTRAINT PK_ChecklistSubmissions PRIMARY KEY,
        CreatedAt             DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        TemplateId            BIGINT         NOT NULL,
        StoreCode             NVARCHAR(50)   NOT NULL,
        SubmittedByUsername   NVARCHAR(100)  NULL,
        Status                NVARCHAR(20)   NOT NULL,
        Payload               NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_ChecklistSubmissions_Store_CreatedAt ON dbo.ChecklistSubmissions (StoreCode, CreatedAt DESC, Id DESC);
    CREATE INDEX IX_ChecklistSubmissions_Template ON dbo.ChecklistSubmissions (TemplateId);
    CREATE INDEX IX_ChecklistSubmissions_SubmittedBy ON dbo.ChecklistSubmissions (SubmittedByUsername, CreatedAt DESC);
END
GO

/* trainingTestSubmissions (Đào Tạo > Bài Test — routes/records.js + lib/recordActions.js chấm điểm) —
   khoá tự nhiên (ClassId, Username) — mỗi học viên chỉ nộp 1 lần/lớp (upsert theo khoá này, xem
   routes/records.js). TestId/ClassId/Username tách cột (lib/recordViewScope.js
   filterTrainingTestSubmissionsForUser() dùng ClassId để xác định quyền giảng viên + Username để xác
   định quyền tự xem bài của mình). answers[] CHƯA tách bảng — cùng lý do docs.history. */
IF OBJECT_ID('dbo.TrainingTestSubmissions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.TrainingTestSubmissions (
        Id         BIGINT         NOT NULL CONSTRAINT PK_TrainingTestSubmissions PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        TestId     BIGINT         NOT NULL,
        ClassId    BIGINT         NOT NULL,
        Username   NVARCHAR(100)  NOT NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE UNIQUE INDEX UX_TrainingTestSubmissions_Class_Username ON dbo.TrainingTestSubmissions (ClassId, Username);
    CREATE INDEX IX_TrainingTestSubmissions_Test ON dbo.TrainingTestSubmissions (TestId);
END
GO

/* trainingDocumentProgress (Đào Tạo > Tiến Độ Xem Tài Liệu — routes/records.js, khoá tự nhiên
   (DocId, Username), tự cập nhật liên tục khi xem video/PDF) — không có mảng lồng tăng trưởng không
   giới hạn nào (viewedPages[] nhỏ, bị chặn bởi số trang tài liệu) — bảng "sạch" nhất trong đợt này,
   phù hợp chuẩn hoá đầy đủ ngay từ đầu nếu cần ở bước sau. */
IF OBJECT_ID('dbo.TrainingDocumentProgress', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.TrainingDocumentProgress (
        Id         BIGINT         NOT NULL CONSTRAINT PK_TrainingDocumentProgress PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        DocId      BIGINT         NOT NULL,
        Username   NVARCHAR(100)  NOT NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE UNIQUE INDEX UX_TrainingDocumentProgress_Doc_Username ON dbo.TrainingDocumentProgress (DocId, Username);
END
GO

/* ==========================================================
   BƯỚC 7f — Nhóm B (tăng trưởng vừa) + Nhóm C (danh mục/cấu hình, bị chặn trần nhưng vẫn chuyển sang
   bảng riêng cho đồng bộ kiến trúc — người dùng xác nhận CHƯA có dữ liệu thật, coi như dựng hệ thống
   mới, làm theo đúng mô hình quan hệ ngay từ đầu thay vì chỉ ưu tiên nhóm rủi ro cao nhất).
   Cùng nguyên tắc Bước 7b: chỉ tách cột SQL thật cho field có bằng chứng dùng lọc quyền xem
   (lib/recordViewScope.js) hoặc Báo Cáo; mảng lồng (items[]/history[]/allocations[]...) giữ nguyên
   trong Payload. Field-shape khảo sát trực tiếp từ lib/createValidation.js/recordActions.js/
   recordViewScope.js (không đoán mò).
   ========================================================== */

-- Nhóm B (phần 2/2) --

/* uniformTransfers (lib/recordActions.js buildUniformTransfer(), KHÔNG qua createValidation.js) —
   SourceDept/TargetDept là 2 field DUY NHẤT dùng lọc quyền xem (canViewUniformTransfer) — collection
   này KHÔNG có field "dept" phẳng như đa số collection khác. */
IF OBJECT_ID('dbo.UniformTransfers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.UniformTransfers (
        Id          BIGINT         NOT NULL CONSTRAINT PK_UniformTransfers PRIMARY KEY,
        CreatedAt   DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        SourceDept  NVARCHAR(100)  NOT NULL,
        TargetDept  NVARCHAR(100)  NOT NULL,
        Status      NVARCHAR(20)   NOT NULL,
        Payload     NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_UniformTransfers_SourceDept ON dbo.UniformTransfers (SourceDept, CreatedAt DESC);
    CREATE INDEX IX_UniformTransfers_TargetDept ON dbo.UniformTransfers (TargetDept, CreatedAt DESC);
END
GO

IF OBJECT_ID('dbo.BudgetEntries', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.BudgetEntries (
        Id         BIGINT         NOT NULL CONSTRAINT PK_BudgetEntries PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Dept       NVARCHAR(100)  NOT NULL,
        EntryKind  NVARCHAR(10)   NOT NULL,
        PeriodId   BIGINT         NULL,
        Status     NVARCHAR(20)   NOT NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_BudgetEntries_Dept_Status_CreatedAt ON dbo.BudgetEntries (Dept, Status, CreatedAt DESC, Id DESC);
    CREATE INDEX IX_BudgetEntries_Period ON dbo.BudgetEntries (PeriodId);
END
GO

IF OBJECT_ID('dbo.RecruitmentReferrals', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RecruitmentReferrals (
        Id                 BIGINT         NOT NULL CONSTRAINT PK_RecruitmentReferrals PRIMARY KEY,
        CreatedAt          DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Dept               NVARCHAR(100)  NOT NULL,
        ReferrerUsername   NVARCHAR(100)  NOT NULL,
        JobId              BIGINT         NULL,
        Status             NVARCHAR(20)   NOT NULL,
        Payload            NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_RecruitmentReferrals_Referrer ON dbo.RecruitmentReferrals (ReferrerUsername, CreatedAt DESC);
    CREATE INDEX IX_RecruitmentReferrals_Job ON dbo.RecruitmentReferrals (JobId);
END
GO

/* licenses — DUY NHẤT trong nhóm B/C có Code (client tự sinh, có versioning qua RootLicenseId — cùng
   khuôn docs.rootDocId). LifecycleStatus TÁCH RIÊNG Status (2 trục độc lập: PENDING/APPROVED/REJECTED
   vs null/RENEWING/REVOKED). ExpiryDate tách cột phục vụ job nhắc hết hạn (jobs/licenseExpiryReminder.js)
   quét theo khoảng ngày thay vì tải hết rồi lọc. */
IF OBJECT_ID('dbo.Licenses', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Licenses (
        Id               BIGINT         NOT NULL CONSTRAINT PK_Licenses PRIMARY KEY,
        CreatedAt        DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Code             NVARCHAR(100)  NULL,
        Dept             NVARCHAR(100)  NOT NULL,
        Creator          NVARCHAR(100)  NULL,
        RootLicenseId    BIGINT         NULL,
        Status           NVARCHAR(20)   NOT NULL,
        LifecycleStatus  NVARCHAR(20)   NULL,
        ExpiryDate       DATE           NULL,
        Payload          NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_Licenses_Dept_Status_CreatedAt ON dbo.Licenses (Dept, Status, CreatedAt DESC, Id DESC);
    CREATE INDEX IX_Licenses_RootLicenseId ON dbo.Licenses (RootLicenseId);
    CREATE INDEX IX_Licenses_ExpiryDate ON dbo.Licenses (ExpiryDate);
    CREATE UNIQUE INDEX UX_Licenses_Code ON dbo.Licenses (Code) WHERE Code IS NOT NULL;
END
GO

/* itServiceRenewals — quyền xem là perm phẳng (admin/itManage), KHÔNG lọc theo dept/creator từng bản
   ghi — Dept/Creator vẫn giữ làm cột hiển thị/tra cứu nhanh (không phải điều kiện phân quyền).
   ExpiryDate cùng lý do licenses — job nhắc hết hạn quét theo khoảng ngày. */
IF OBJECT_ID('dbo.ItServiceRenewals', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ItServiceRenewals (
        Id          BIGINT         NOT NULL CONSTRAINT PK_ItServiceRenewals PRIMARY KEY,
        CreatedAt   DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Dept        NVARCHAR(100)  NOT NULL,
        Creator     NVARCHAR(100)  NULL,
        ExpiryDate  DATE           NULL,
        Payload     NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_ItServiceRenewals_ExpiryDate ON dbo.ItServiceRenewals (ExpiryDate);
END
GO

/* leaveRequests — EmployeeCode là khoá xem chính (canViewLeaveRequest), FromDate/ToDate phục vụ kiểm
   tra chồng lấn khi tạo mới + lọc theo khoảng ngày ở Nhân Sự/quản lý. */
IF OBJECT_ID('dbo.LeaveRequests', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.LeaveRequests (
        Id            BIGINT         NOT NULL CONSTRAINT PK_LeaveRequests PRIMARY KEY,
        CreatedAt     DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        EmployeeCode  NVARCHAR(50)   NOT NULL,
        FromDate      DATE           NOT NULL,
        ToDate        DATE           NOT NULL,
        Status        NVARCHAR(20)   NOT NULL,
        Payload       NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_LeaveRequests_Employee_Range ON dbo.LeaveRequests (EmployeeCode, FromDate, ToDate);
END
GO

/* shiftSwapRequests — RequesterRosterId là FK quan trọng nhất (recordViewScope.js tra ngược qua
   shiftRoster để xác định phòng ban/siêu thị), Requester/TargetEmployeeCode là 2 phía cần xem được. */
IF OBJECT_ID('dbo.ShiftSwapRequests', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ShiftSwapRequests (
        Id                     BIGINT         NOT NULL CONSTRAINT PK_ShiftSwapRequests PRIMARY KEY,
        CreatedAt              DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        RequesterEmployeeCode  NVARCHAR(50)   NOT NULL,
        TargetEmployeeCode     NVARCHAR(50)   NOT NULL,
        RequesterRosterId      BIGINT         NULL,
        Status                 NVARCHAR(20)   NOT NULL,
        Payload                NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_ShiftSwapRequests_Requester ON dbo.ShiftSwapRequests (RequesterEmployeeCode, CreatedAt DESC);
    CREATE INDEX IX_ShiftSwapRequests_Target ON dbo.ShiftSwapRequests (TargetEmployeeCode, CreatedAt DESC);
    CREATE INDEX IX_ShiftSwapRequests_Roster ON dbo.ShiftSwapRequests (RequesterRosterId);
END
GO

/* operationExecutionPeriods — SourceType+SourceId là FK ĐA HÌNH (polymorphic) tới
   operationStoreOpenings/operationRepairs, cùng khuôn dbo.OperationWorkItems đã có. */
IF OBJECT_ID('dbo.OperationExecutionPeriods', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.OperationExecutionPeriods (
        Id          BIGINT         NOT NULL CONSTRAINT PK_OperationExecutionPeriods PRIMARY KEY,
        CreatedAt   DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        SourceType  NVARCHAR(30)   NOT NULL,
        SourceId    BIGINT         NOT NULL,
        Status      NVARCHAR(20)   NOT NULL,
        Payload     NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_OperationExecutionPeriods_Source ON dbo.OperationExecutionPeriods (SourceType, SourceId);
END
GO

IF OBJECT_ID('dbo.VppRegistrations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.VppRegistrations (
        Id         BIGINT         NOT NULL CONSTRAINT PK_VppRegistrations PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Dept       NVARCHAR(100)  NOT NULL,
        Creator    NVARCHAR(100)  NULL,
        PeriodId   BIGINT         NULL,
        Status     NVARCHAR(20)   NOT NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_VppRegistrations_Dept_Status_CreatedAt ON dbo.VppRegistrations (Dept, Status, CreatedAt DESC, Id DESC);
    CREATE INDEX IX_VppRegistrations_Period ON dbo.VppRegistrations (PeriodId);
END
GO

IF OBJECT_ID('dbo.TrainingRegistrations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.TrainingRegistrations (
        Id         BIGINT         NOT NULL CONSTRAINT PK_TrainingRegistrations PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Creator    NVARCHAR(100)  NULL,
        ClassId    BIGINT         NOT NULL,
        Result     NVARCHAR(20)   NOT NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_TrainingRegistrations_Class ON dbo.TrainingRegistrations (ClassId);
    CREATE INDEX IX_TrainingRegistrations_Creator ON dbo.TrainingRegistrations (Creator, CreatedAt DESC);
END
GO

-- Nhóm C (phần 1/2) --

IF OBJECT_ID('dbo.ReportPeriods', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ReportPeriods (
        Id         BIGINT         NOT NULL CONSTRAINT PK_ReportPeriods PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Dept       NVARCHAR(100)  NOT NULL,
        Creator    NVARCHAR(100)  NULL,
        Status     NVARCHAR(20)   NOT NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_ReportPeriods_Dept_CreatedAt ON dbo.ReportPeriods (Dept, CreatedAt DESC, Id DESC);
END
GO

IF OBJECT_ID('dbo.ReportEntries', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ReportEntries (
        Id         BIGINT         NOT NULL CONSTRAINT PK_ReportEntries PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        PeriodId   BIGINT         NULL,
        Dept       NVARCHAR(100)  NOT NULL,
        Creator    NVARCHAR(100)  NULL,
        Status     NVARCHAR(20)   NOT NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_ReportEntries_Period ON dbo.ReportEntries (PeriodId);
    CREATE INDEX IX_ReportEntries_Dept_Status ON dbo.ReportEntries (Dept, Status, CreatedAt DESC);
END
GO

/* trainingDocuments/trainingCourses/careerPaths/onboardingPaths — danh mục công khai toàn công ty,
   không có hàm lọc quyền xem riêng (khác nhóm hồ sơ cá nhân) — chỉ cần cột FK phục vụ liên kết, không
   cần cột lọc quyền. */
IF OBJECT_ID('dbo.TrainingDocuments', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.TrainingDocuments (
        Id         BIGINT         NOT NULL CONSTRAINT PK_TrainingDocuments PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        CourseId   BIGINT         NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_TrainingDocuments_Course ON dbo.TrainingDocuments (CourseId);
END
GO

/* trainingClasses — Id (khoá chính) được trainingTestSubmissions/trainingRegistrations tham chiếu để
   xác định quyền xem (giảng viên/học viên) — CourseId/TestId/InstructorUsername là FK, Status/
   SessionState là 2 trạng thái độc lập (mở đăng ký vs. đang diễn ra). */
IF OBJECT_ID('dbo.TrainingClasses', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.TrainingClasses (
        Id                  BIGINT         NOT NULL CONSTRAINT PK_TrainingClasses PRIMARY KEY,
        CreatedAt           DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        CourseId            BIGINT         NULL,
        TestId              BIGINT         NULL,
        InstructorUsername  NVARCHAR(100)  NULL,
        Status              NVARCHAR(10)   NOT NULL,
        SessionState        NVARCHAR(10)   NULL,
        Payload             NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_TrainingClasses_Course ON dbo.TrainingClasses (CourseId);
    CREATE INDEX IX_TrainingClasses_Instructor ON dbo.TrainingClasses (InstructorUsername);
END
GO

IF OBJECT_ID('dbo.TrainingCourses', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.TrainingCourses (
        Id         BIGINT         NOT NULL CONSTRAINT PK_TrainingCourses PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Payload    NVARCHAR(MAX)  NOT NULL
    );
END
GO

IF OBJECT_ID('dbo.TrainingPlans', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.TrainingPlans (
        Id          BIGINT         NOT NULL CONSTRAINT PK_TrainingPlans PRIMARY KEY,
        CreatedAt   DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        CourseId    BIGINT         NULL,
        Month       NVARCHAR(7)    NULL,
        TargetDept  NVARCHAR(100)  NULL,
        Payload     NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_TrainingPlans_Month ON dbo.TrainingPlans (Month);
END
GO

IF OBJECT_ID('dbo.CareerPaths', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CareerPaths (
        Id         BIGINT         NOT NULL CONSTRAINT PK_CareerPaths PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Payload    NVARCHAR(MAX)  NOT NULL
    );
END
GO

/* careerPathConfirmations — bản phẳng nhất trong Nhóm C (không qua createValidation.js, mọi field cố
   định — xem lib/recordActions.js confirmCareerPathForEmployee()). Username là điều kiện lọc quyền xem
   DUY NHẤT (canViewCareerPathConfirmation). */
IF OBJECT_ID('dbo.CareerPathConfirmations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CareerPathConfirmations (
        Id         BIGINT         NOT NULL CONSTRAINT PK_CareerPathConfirmations PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        PathId     BIGINT         NULL,
        Username   NVARCHAR(100)  NOT NULL,
        Dept       NVARCHAR(100)  NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_CareerPathConfirmations_Username ON dbo.CareerPathConfirmations (Username, CreatedAt DESC);
    CREATE INDEX IX_CareerPathConfirmations_Path ON dbo.CareerPathConfirmations (PathId);
END
GO

IF OBJECT_ID('dbo.OnboardingPaths', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.OnboardingPaths (
        Id         BIGINT         NOT NULL CONSTRAINT PK_OnboardingPaths PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Payload    NVARCHAR(MAX)  NOT NULL
    );
END
GO

/* onboardingProgress — EmployeeUsername là điều kiện lọc quyền xem chính (tự xem bài của mình), StartDate
   là mốc SNAPSHOT cố định lúc phân công (KHÔNG đọc sống lại từ hồ sơ nhân sự — xem comment gốc), dùng để
   tính hạn giai đoạn 1/2/3 phía client. */
IF OBJECT_ID('dbo.OnboardingProgress', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.OnboardingProgress (
        Id                 BIGINT         NOT NULL CONSTRAINT PK_OnboardingProgress PRIMARY KEY,
        CreatedAt          DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        EmployeeUsername   NVARCHAR(100)  NOT NULL,
        PathId             BIGINT         NULL,
        StartDate          DATE           NULL,
        Payload            NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_OnboardingProgress_Employee ON dbo.OnboardingProgress (EmployeeUsername);
    CREATE INDEX IX_OnboardingProgress_Path ON dbo.OnboardingProgress (PathId);
END
GO

/* recruitmentJobs — HiringDept CỐ Ý TÁCH RIÊNG khỏi Dept (phòng ban tuyển dụng thực tế, không phải
   phòng ban người đăng tin) — xem lib/createValidation.js. */
IF OBJECT_ID('dbo.RecruitmentJobs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RecruitmentJobs (
        Id           BIGINT         NOT NULL CONSTRAINT PK_RecruitmentJobs PRIMARY KEY,
        CreatedAt    DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        HiringDept   NVARCHAR(100)  NULL,
        Status       NVARCHAR(10)   NOT NULL,
        Payload      NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_RecruitmentJobs_HiringDept_Status ON dbo.RecruitmentJobs (HiringDept, Status);
END
GO

/* uniformPeriods — quyền xem thực tế dựa trên perm phẳng (uniformManage/uniformApprove) + lọc nested
   allocations[] ở tầng JS (không phải SQL) — Dept/Creator/ApprovalStatus giữ làm cột hiển thị/tra cứu,
   KHÔNG phải điều kiện phân quyền chính. allocations[] (mảng lồng 2 cấp) giữ nguyên trong Payload. */
IF OBJECT_ID('dbo.UniformPeriods', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.UniformPeriods (
        Id              BIGINT         NOT NULL CONSTRAINT PK_UniformPeriods PRIMARY KEY,
        CreatedAt       DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Dept            NVARCHAR(100)  NULL,
        Creator         NVARCHAR(100)  NULL,
        ApprovalStatus  NVARCHAR(20)   NOT NULL,
        Payload         NVARCHAR(MAX)  NOT NULL
    );
END
GO

-- Nhóm B (phần 1/2) --

/* contracts — Dept/CustodianDept (2 phòng ban độc lập: nơi tạo vs nơi quản lý hợp đồng)/Status/
   PaymentStatus dùng lọc quyền xem + định tuyến thanh toán (lib/recordActions.js). RootContractId tự
   tham chiếu (cùng khuôn docs.rootDocId) cho họ hợp đồng gốc/phụ lục. */
IF OBJECT_ID('dbo.Contracts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Contracts (
        Id              BIGINT         NOT NULL CONSTRAINT PK_Contracts PRIMARY KEY,
        CreatedAt       DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Code            NVARCHAR(100)  NULL,
        Dept            NVARCHAR(100)  NOT NULL,
        CustodianDept   NVARCHAR(100)  NULL,
        Creator         NVARCHAR(100)  NULL,
        Status          NVARCHAR(20)   NOT NULL,
        PaymentStatus   NVARCHAR(20)   NULL,
        RootContractId  BIGINT         NULL,
        Payload         NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_Contracts_Dept_Status_CreatedAt ON dbo.Contracts (Dept, Status, CreatedAt DESC, Id DESC);
    CREATE INDEX IX_Contracts_CustodianDept ON dbo.Contracts (CustodianDept);
    CREATE INDEX IX_Contracts_RootContractId ON dbo.Contracts (RootContractId);
    CREATE UNIQUE INDEX UX_Contracts_Code ON dbo.Contracts (Code) WHERE Code IS NOT NULL;
END
GO

IF OBJECT_ID('dbo.CarRegs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CarRegs (
        Id                     BIGINT         NOT NULL CONSTRAINT PK_CarRegs PRIMARY KEY,
        CreatedAt              DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Code                   NVARCHAR(100)  NULL,
        Dept                   NVARCHAR(100)  NOT NULL,
        Creator                NVARCHAR(100)  NULL,
        Status                 NVARCHAR(20)   NOT NULL,
        AssignedDriverUsername NVARCHAR(100)  NULL,
        Payload                NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_CarRegs_Dept_Status_CreatedAt ON dbo.CarRegs (Dept, Status, CreatedAt DESC, Id DESC);
    CREATE INDEX IX_CarRegs_Driver ON dbo.CarRegs (AssignedDriverUsername);
    CREATE UNIQUE INDEX UX_CarRegs_Code ON dbo.CarRegs (Code) WHERE Code IS NOT NULL;
END
GO

/* officeReqs — SubType (MUA_BAN/SUA_CHUA/DAU_TU) tách cột vì chi phối quy trình duyệt khác nhau HOÀN
   TOÀN theo loại (workflowEngine.js) + phân tách Báo Cáo. */
IF OBJECT_ID('dbo.OfficeReqs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.OfficeReqs (
        Id         BIGINT         NOT NULL CONSTRAINT PK_OfficeReqs PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Code       NVARCHAR(100)  NULL,
        Dept       NVARCHAR(100)  NOT NULL,
        SubType    NVARCHAR(20)   NOT NULL,
        Creator    NVARCHAR(100)  NULL,
        Status     NVARCHAR(20)   NOT NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_OfficeReqs_Dept_Status_CreatedAt ON dbo.OfficeReqs (Dept, Status, CreatedAt DESC, Id DESC);
    CREATE INDEX IX_OfficeReqs_SubType ON dbo.OfficeReqs (SubType);
    CREATE UNIQUE INDEX UX_OfficeReqs_Code ON dbo.OfficeReqs (Code) WHERE Code IS NOT NULL;
END
GO

/* meetings — Room dùng làm khoá kiểm tra trùng lịch (createForCollectionSerialized đã có từ trước khi
   migrate — vẫn giữ nguyên cơ chế này, chỉ đổi bảng lưu). Không có history[]/currentStep (trạng thái
   phẳng, không qua workflowEngine.js). */
IF OBJECT_ID('dbo.Meetings', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Meetings (
        Id         BIGINT         NOT NULL CONSTRAINT PK_Meetings PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Code       NVARCHAR(100)  NULL,
        Dept       NVARCHAR(100)  NOT NULL,
        Creator    NVARCHAR(100)  NULL,
        Room       NVARCHAR(100)  NOT NULL,
        Status     NVARCHAR(20)   NOT NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_Meetings_Room ON dbo.Meetings (Room, CreatedAt DESC);
    CREATE UNIQUE INDEX UX_Meetings_Code ON dbo.Meetings (Code) WHERE Code IS NOT NULL;
END
GO

/* meetingMinutes — creator field tên "author" (không phải "creator" như đa số collection khác);
   KHÔNG có Dept đáng tin cậy để lọc quyền xem (canViewMeetingMinutes không hề dùng dept — chỉ dùng
   author/attendees[]/admin), CỐ Ý KHÔNG thêm cột Dept để tránh ngộ nhận đây là điều kiện lọc. */
IF OBJECT_ID('dbo.MeetingMinutes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MeetingMinutes (
        Id               BIGINT         NOT NULL CONSTRAINT PK_MeetingMinutes PRIMARY KEY,
        CreatedAt        DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Code             NVARCHAR(100)  NULL,
        Author           NVARCHAR(100)  NULL,
        LinkedMeetingId  BIGINT         NULL,
        Payload          NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_MeetingMinutes_Author ON dbo.MeetingMinutes (Author, CreatedAt DESC);
    CREATE INDEX IX_MeetingMinutes_LinkedMeeting ON dbo.MeetingMinutes (LinkedMeetingId);
    CREATE UNIQUE INDEX UX_MeetingMinutes_Code ON dbo.MeetingMinutes (Code) WHERE Code IS NOT NULL;
END
GO

/* internalPosts — Author (không phải "creator"). Dept CỐ Ý KHÔNG thêm cột — chỉ hiển thị (forceOwnDept)
   không hề dùng để lọc quyền xem (canView chỉ xét author/status/admin/internalPostApprove) — thêm cột
   dễ bị hiểu nhầm là điều kiện lọc thật, trong khi hiện tại KHÔNG PHẢI. Không có Code. */
IF OBJECT_ID('dbo.InternalPosts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.InternalPosts (
        Id         BIGINT         NOT NULL CONSTRAINT PK_InternalPosts PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Author     NVARCHAR(100)  NULL,
        Type       NVARCHAR(20)   NOT NULL,
        Status     NVARCHAR(20)   NOT NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_InternalPosts_Author ON dbo.InternalPosts (Author, CreatedAt DESC);
    CREATE INDEX IX_InternalPosts_Type_Status ON dbo.InternalPosts (Type, Status);
END
GO

/* itSupportTickets — trạng thái PHẲNG (TODO/DOING/DONE/CANCELLED), KHÔNG có history[]/currentStep
   (khác đa số collection khác) — có thêm nhánh "leo thang" (ApprovalApprover) độc lập với Status chính.
   Không có Code. */
IF OBJECT_ID('dbo.ItSupportTickets', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ItSupportTickets (
        Id                BIGINT         NOT NULL CONSTRAINT PK_ItSupportTickets PRIMARY KEY,
        CreatedAt         DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Dept              NVARCHAR(100)  NOT NULL,
        Creator           NVARCHAR(100)  NULL,
        Status            NVARCHAR(20)   NOT NULL,
        ApprovalApprover  NVARCHAR(100)  NULL,
        Payload           NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_ItSupportTickets_Dept_Status_CreatedAt ON dbo.ItSupportTickets (Dept, Status, CreatedAt DESC, Id DESC);
    CREATE INDEX IX_ItSupportTickets_ApprovalApprover ON dbo.ItSupportTickets (ApprovalApprover);
END
GO

/* itPriceApprovals — PriceType (RETAIL/WHOLESALE) chi phối quy trình duyệt khác nhau hoàn toàn. Không
   có Code. */
IF OBJECT_ID('dbo.ItPriceApprovals', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ItPriceApprovals (
        Id         BIGINT         NOT NULL CONSTRAINT PK_ItPriceApprovals PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Dept       NVARCHAR(100)  NOT NULL,
        Creator    NVARCHAR(100)  NULL,
        PriceType  NVARCHAR(20)   NOT NULL,
        Status     NVARCHAR(20)   NOT NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_ItPriceApprovals_Dept_Status_CreatedAt ON dbo.ItPriceApprovals (Dept, Status, CreatedAt DESC, Id DESC);
END
GO

IF OBJECT_ID('dbo.UniformIssuances', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.UniformIssuances (
        Id                BIGINT         NOT NULL CONSTRAINT PK_UniformIssuances PRIMARY KEY,
        CreatedAt         DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Code              NVARCHAR(100)  NULL,
        Dept              NVARCHAR(100)  NOT NULL,
        EmployeeUsername  NVARCHAR(100)  NULL,
        Payload           NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_UniformIssuances_Dept_CreatedAt ON dbo.UniformIssuances (Dept, CreatedAt DESC);
    CREATE INDEX IX_UniformIssuances_Employee ON dbo.UniformIssuances (EmployeeUsername);
    CREATE UNIQUE INDEX UX_UniformIssuances_Code ON dbo.UniformIssuances (Code) WHERE Code IS NOT NULL;
END
GO

IF OBJECT_ID('dbo.UniformStockAdjustments', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.UniformStockAdjustments (
        Id                BIGINT         NOT NULL CONSTRAINT PK_UniformStockAdjustments PRIMARY KEY,
        CreatedAt         DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Dept              NVARCHAR(100)  NOT NULL,
        EmployeeUsername  NVARCHAR(100)  NULL,
        Payload           NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_UniformStockAdjustments_Dept_CreatedAt ON dbo.UniformStockAdjustments (Dept, CreatedAt DESC);
END
GO

-- Nhóm C (phần 2/2) --

IF OBJECT_ID('dbo.BudgetTemplates', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.BudgetTemplates (
        Id         BIGINT         NOT NULL CONSTRAINT PK_BudgetTemplates PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Payload    NVARCHAR(MAX)  NOT NULL
    );
END
GO

IF OBJECT_ID('dbo.BudgetPeriods', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.BudgetPeriods (
        Id          BIGINT         NOT NULL CONSTRAINT PK_BudgetPeriods PRIMARY KEY,
        CreatedAt   DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Dept        NVARCHAR(100)  NOT NULL,
        TemplateId  BIGINT         NULL,
        Status      NVARCHAR(20)   NOT NULL,
        Payload     NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_BudgetPeriods_Dept_CreatedAt ON dbo.BudgetPeriods (Dept, CreatedAt DESC, Id DESC);
    CREATE INDEX IX_BudgetPeriods_Template ON dbo.BudgetPeriods (TemplateId);
END
GO

/* checklistTemplates — TemplateCode do NGƯỜI DÙNG tự gõ (không phải tự sinh như docs/submissions) —
   vẫn cần UNIQUE để tránh trùng, nhưng KHÔNG có logic tự tăng số khi trùng (đúng hành vi hiện có, chỉ
   báo lỗi). */
IF OBJECT_ID('dbo.ChecklistTemplates', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ChecklistTemplates (
        Id            BIGINT         NOT NULL CONSTRAINT PK_ChecklistTemplates PRIMARY KEY,
        CreatedAt     DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        TemplateCode  NVARCHAR(50)   NULL,
        TemplateType  NVARCHAR(20)   NOT NULL,
        Status        NVARCHAR(20)   NOT NULL,
        Payload       NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_ChecklistTemplates_Type_Status ON dbo.ChecklistTemplates (TemplateType, Status);
    CREATE UNIQUE INDEX UX_ChecklistTemplates_Code ON dbo.ChecklistTemplates (TemplateCode) WHERE TemplateCode IS NOT NULL;
END
GO

/* trainingTests — công khai toàn công ty (chỉ redact correctOptionIds ở tầng ứng dụng khi trả về, KHÔNG
   phải điều kiện lọc SQL) — không cần cột lọc quyền riêng. */
IF OBJECT_ID('dbo.TrainingTests', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.TrainingTests (
        Id         BIGINT         NOT NULL CONSTRAINT PK_TrainingTests PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Payload    NVARCHAR(MAX)  NOT NULL
    );
END
GO

IF OBJECT_ID('dbo.HrFeedback', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.HrFeedback (
        Id         BIGINT         NOT NULL CONSTRAINT PK_HrFeedback PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Dept       NVARCHAR(100)  NOT NULL,
        Creator    NVARCHAR(100)  NULL,
        Status     NVARCHAR(20)   NOT NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_HrFeedback_Dept_CreatedAt ON dbo.HrFeedback (Dept, CreatedAt DESC);
    CREATE INDEX IX_HrFeedback_Creator ON dbo.HrFeedback (Creator);
END
GO

/* hrProcesses (Onboarding/Offboarding) — EmployeeCode/EmployeeUsername/DirectManagerUsername đều có thể
   NULL (Offboarding không luôn có employeeCode như comment gốc đã nêu). */
IF OBJECT_ID('dbo.HrProcesses', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.HrProcesses (
        Id                       BIGINT         NOT NULL CONSTRAINT PK_HrProcesses PRIMARY KEY,
        CreatedAt                DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Dept                     NVARCHAR(100)  NULL,
        ProcessType              NVARCHAR(20)   NOT NULL,
        EmployeeCode             NVARCHAR(50)   NULL,
        EmployeeUsername         NVARCHAR(100)  NULL,
        DirectManagerUsername    NVARCHAR(100)  NULL,
        Status                   NVARCHAR(20)   NOT NULL,
        Payload                  NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_HrProcesses_Dept_Status_CreatedAt ON dbo.HrProcesses (Dept, Status, CreatedAt DESC, Id DESC);
    CREATE INDEX IX_HrProcesses_Employee ON dbo.HrProcesses (EmployeeUsername);
    CREATE INDEX IX_HrProcesses_Manager ON dbo.HrProcesses (DirectManagerUsername);
END
GO

/* laborContracts — Status là điều kiện lọc QUAN TRỌNG NHẤT (findActiveContractByEmployeeCode() ở
   lib/laborContract.js dùng cho tính lương — phải cùng index với EmployeeCode). */
IF OBJECT_ID('dbo.LaborContracts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.LaborContracts (
        Id             BIGINT         NOT NULL CONSTRAINT PK_LaborContracts PRIMARY KEY,
        CreatedAt      DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Code           NVARCHAR(100)  NULL,
        EmployeeCode   NVARCHAR(50)   NOT NULL,
        EmployeeUsername NVARCHAR(100) NULL,
        HrProcessId    BIGINT         NULL,
        Status         NVARCHAR(20)   NOT NULL,
        Payload        NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_LaborContracts_Employee_Status ON dbo.LaborContracts (EmployeeCode, Status);
    CREATE INDEX IX_LaborContracts_HrProcess ON dbo.LaborContracts (HrProcessId);
    CREATE UNIQUE INDEX UX_LaborContracts_Code ON dbo.LaborContracts (Code) WHERE Code IS NOT NULL;
END
GO

/* shiftRoster — KHÔNG đặt UNIQUE (EmployeeCode, WorkDate): 1 dòng CANCELLED vẫn có thể tồn tại song
   song 1 dòng SCHEDULED mới cho đúng ngày đó (đổi ca) — kiểm tra trùng ở tầng ứng dụng đã tự loại
   CANCELLED khỏi điều kiện trùng (lib/attendance.js), không diễn đạt được bằng UNIQUE INDEX đơn giản. */
IF OBJECT_ID('dbo.ShiftRoster', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ShiftRoster (
        Id            BIGINT         NOT NULL CONSTRAINT PK_ShiftRoster PRIMARY KEY,
        CreatedAt     DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        EmployeeCode  NVARCHAR(50)   NOT NULL,
        WorkDate      DATE           NOT NULL,
        StoreCode     NVARCHAR(100)  NULL,
        Status        NVARCHAR(20)   NOT NULL,
        Payload       NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_ShiftRoster_Employee_Date ON dbo.ShiftRoster (EmployeeCode, WorkDate);
    CREATE INDEX IX_ShiftRoster_Store_Date ON dbo.ShiftRoster (StoreCode, WorkDate);
END
GO

IF OBJECT_ID('dbo.LeaveBalances', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.LeaveBalances (
        Id            BIGINT         NOT NULL CONSTRAINT PK_LeaveBalances PRIMARY KEY,
        CreatedAt     DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        EmployeeCode  NVARCHAR(50)   NOT NULL,
        Year          INT            NOT NULL,
        Payload       NVARCHAR(MAX)  NOT NULL
    );
    CREATE UNIQUE INDEX UX_LeaveBalances_Employee_Year ON dbo.LeaveBalances (EmployeeCode, Year);
END
GO

IF OBJECT_ID('dbo.PayrollPeriods', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PayrollPeriods (
        Id           BIGINT         NOT NULL CONSTRAINT PK_PayrollPeriods PRIMARY KEY,
        CreatedAt    DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        PeriodMonth  INT            NOT NULL,
        PeriodYear   INT            NOT NULL,
        Status       NVARCHAR(20)   NOT NULL,
        Payload      NVARCHAR(MAX)  NOT NULL
    );
    CREATE UNIQUE INDEX UX_PayrollPeriods_Month_Year ON dbo.PayrollPeriods (PeriodMonth, PeriodYear);
END
GO

IF OBJECT_ID('dbo.Payslips', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Payslips (
        Id            BIGINT         NOT NULL CONSTRAINT PK_Payslips PRIMARY KEY,
        CreatedAt     DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Code          NVARCHAR(100)  NULL,
        PeriodId      BIGINT         NULL,
        EmployeeCode  NVARCHAR(50)   NULL,
        Payload       NVARCHAR(MAX)  NOT NULL
    );
    CREATE INDEX IX_Payslips_Period ON dbo.Payslips (PeriodId);
    CREATE INDEX IX_Payslips_Employee ON dbo.Payslips (EmployeeCode);
    CREATE UNIQUE INDEX UX_Payslips_Code ON dbo.Payslips (Code) WHERE Code IS NOT NULL;
END
GO

IF OBJECT_ID('dbo.VppPeriods', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.VppPeriods (
        Id         BIGINT         NOT NULL CONSTRAINT PK_VppPeriods PRIMARY KEY,
        CreatedAt  DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
        Dept       NVARCHAR(100)  NULL,
        Creator    NVARCHAR(100)  NULL,
        Status     NVARCHAR(20)   NOT NULL,
        Payload    NVARCHAR(MAX)  NOT NULL
    );
END
GO

/* Thùng Rác (Trash Bin) — khi admin xoá 1 hồ sơ ở bất kỳ collection nào trong dbo.Records
   (lib/recordStore.js deleteRecordForCollection()), bản ghi được CHUYỂN vào đây thay vì xoá thẳng —
   giữ nguyên Payload gốc để khôi phục lại đúng vị trí (cùng Id) nếu cần, hoặc xoá vĩnh viễn (chỉ xoá
   dòng ở bảng này, dữ liệu đã không còn ở Records từ lúc chuyển vào đây nên "xoá vĩnh viễn" không cần
   đụng gì thêm). Mỗi Id bị xoá ở Records tương ứng ĐÚNG 1 dòng ở đây — không dùng lại Id cũ cho Id mới
   (IDENTITY riêng của bảng này). Xem routes/trash.js. */
IF OBJECT_ID('dbo.TrashBin', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.TrashBin (
        Id             BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Collection     NVARCHAR(50)   NOT NULL,
        OriginalId     BIGINT         NOT NULL,
        Code           NVARCHAR(100)  NULL,
        Payload        NVARCHAR(MAX)  NOT NULL,
        DeletedBy      NVARCHAR(100)  NOT NULL,
        DeletedByName  NVARCHAR(200)  NULL,
        DeletedAt      DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_TrashBin_Collection_DeletedAt ON dbo.TrashBin (Collection, DeletedAt DESC);
END
GO

/* Kho lưu tạm dùng chung cho MỌI trạng thái xác thực nhiều bước ngắn hạn (TOTP đăng nhập/thiết lập,
   challenge WebAuthn đăng ký/đăng nhập, mã CAPTCHA, phiếu/OTP xác thực lại trước khi Duyệt — xem
   lib/ephemeralStore.js). TRƯỚC ĐÂY 4 module này lưu bằng Map trong bộ nhớ RIÊNG của từng tiến trình
   Node — hoạt động sai khi chạy PM2 cluster nhiều tiến trình mà Nginx không bật sticky session (bước
   "cấp" rơi vào tiến trình A, bước "xác minh" rơi vào tiến trình B không thấy gì, báo lỗi nhầm dù người
   dùng nhập đúng). Chuyển sang 1 bảng dùng chung ở đây để đúng bất kỳ tiến trình nào xử lý request cũng
   đọc/ghi cùng 1 nguồn — TokenKey tự đặt tiền tố theo từng module (vd "totp:login:<username>",
   "captcha:<id>") để không đụng nhau giữa các module dù chung 1 bảng. Dữ liệu ở đây CHỦ ĐÍCH không cần
   bền — hết hạn rất nhanh (vài phút), mất khi restart chỉ khiến người dùng phải thử lại, không phải
   mất dữ liệu nghiệp vụ thật. */
IF OBJECT_ID('dbo.EphemeralAuthTokens', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.EphemeralAuthTokens (
        TokenKey   NVARCHAR(200)  NOT NULL PRIMARY KEY,
        Payload    NVARCHAR(MAX)  NOT NULL,
        ExpiresAt  DATETIME2(3)   NOT NULL
    );
    CREATE INDEX IX_EphemeralAuthTokens_ExpiresAt ON dbo.EphemeralAuthTokens (ExpiresAt);
END
GO

PRINT 'Schema VPDT_DMS đã sẵn sàng.';
GO
