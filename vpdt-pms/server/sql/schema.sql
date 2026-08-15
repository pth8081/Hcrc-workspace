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

PRINT 'Schema VPDT_DMS đã sẵn sàng.';
GO
