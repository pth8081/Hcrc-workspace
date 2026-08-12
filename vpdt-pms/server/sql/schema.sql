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
        UpdatedAt   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

/* Bảng lưu tài khoản đăng nhập vào chính hệ thống backend (KHÔNG phải tài khoản
   nghiệp vụ DB.users bên trong AppData) - dùng cho việc bảo vệ API sau này nếu cần.
   Hiện tại API đang mở nội bộ (theo đúng mô hình xác thực hiện có của ứng dụng,
   xác thực người dùng vẫn xử lý ở phía Client dựa trên DB.users như bản gốc). */
-- (Không tạo bảng users riêng ở tầng DB để giữ đúng 100% cơ chế đăng nhập gốc của ứng dụng)

PRINT 'Schema VPDT_DMS đã sẵn sàng.';
GO
