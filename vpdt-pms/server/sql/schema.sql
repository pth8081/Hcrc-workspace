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
