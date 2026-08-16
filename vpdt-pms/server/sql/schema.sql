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
    -- UpdatedAt xuống mili-giây để hợp lệ dùng làm version token. An toàn chạy lại nhiều lần (no-op
    -- nếu cột đã đúng kiểu), không mất dữ liệu (chỉ cắt bớt phần dưới mili-giây vốn chưa được dùng).
    ALTER TABLE dbo.AppData ALTER COLUMN UpdatedAt DATETIME2(3) NOT NULL;
END
GO

/* CẬP NHẬT: API /api/data/* giờ bắt buộc đăng nhập thật (xem routes/auth.js, lib/auth.js) — mật
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
        IpAddress     NVARCHAR(100)  NULL,
        Module        NVARCHAR(50)   NOT NULL,
        ActionType    NVARCHAR(100)  NOT NULL,
        TargetObject  NVARCHAR(200)  NULL,
        Description   NVARCHAR(MAX)  NOT NULL,
        Status        NVARCHAR(20)   NOT NULL DEFAULT 'SUCCESS'
    );
    CREATE INDEX IX_SystemLogs_CreatedAt ON dbo.SystemLogs (CreatedAt DESC, Id DESC);
END
GO

PRINT 'Schema VPDT_DMS đã sẵn sàng.';
GO
