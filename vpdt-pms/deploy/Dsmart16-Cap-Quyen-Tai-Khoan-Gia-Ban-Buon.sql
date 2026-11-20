-- ============================================================================
-- Dsmart16-Cap-Quyen-Tai-Khoan-Gia-Ban-Buon.sql
-- Script MẪU để DBA chạy TRỰC TIẾP trên CSDL DSmart (qua SSMS) — tạo tài
-- khoản SQL riêng + cấp ĐÚNG quyền tối thiểu cho tính năng "💰 Cài Đặt Giá
-- Bán Buôn" (Hỗ Trợ IT) của HCRC Workspace. Dùng CHUNG 1 khuôn này cho:
--   (A) DSmart16 Trung Tâm (HO) — tài khoản cấu hình ở "⚙️ Cấu Hình Kết Nối"
--   (B) MỖI siêu thị (fan-out, 12/2026) — tài khoản cấu hình ở "🏬 Kết Nối
--       Siêu Thị", chạy đúng script này trên CSDL DSmart RIÊNG của từng
--       siêu thị, đổi <TEN_LOGIN>/<MAT_KHAU> cho phù hợp (có thể dùng
--       CHUNG 1 tên đăng nhập cho mọi siêu thị, hoặc đặt riêng theo mã siêu
--       thị — tuỳ quy ước nội bộ, không bắt buộc theo khuôn cụ thể).
--
-- NGUYÊN TẮC LEAST-PRIVILEGE (đã thống nhất với người dùng, xác nhận qua 3
-- lỗi THẬT production trước khi quyền được cấp đúng — xem Huong-dan-nghiep-
-- vu.md mục 6c/6d để biết lịch sử):
--   - dbo.CSPRICE : CHỈ GRANT INSERT/UPDATE/DELETE — TUYỆT ĐỐI KHÔNG GRANT
--     SELECT (ứng dụng dùng OUTPUT INSERTED./OUTPUT DELETED. ngay trên câu
--     lệnh ghi để đọc lại dữ liệu, không bao giờ cần SELECT độc lập trên
--     bảng này — nếu vô tình cấp thêm SELECT cũng không hỏng gì, chỉ là
--     thừa quyền so với nguyên tắc đã thống nhất).
--   - dbo.SKU_DEF  : CHỈ GRANT SELECT (ứng dụng tra Đơn Vị Tính/Hệ Số Quy
--     Đổi/Mã Thuế theo Mã Sản Phẩm trước khi ghi giá — xem
--     lookupSkuDefUnitInfo(), server/lib/dsmartSqlClient.js).
--   - KHÔNG cấp thêm bất kỳ quyền nào khác (không sysadmin, không db_owner,
--     không quyền trên bảng/view nào khác của CSDL DSmart).
--
-- Trước khi chạy: đổi <TEN_LOGIN>, <MAT_KHAU>, <TEN_CSDL_DSMART> cho đúng
-- thực tế (CSDL DSmart Trung Tâm hoặc CSDL DSmart của từng siêu thị).
-- ============================================================================

USE [master];
GO

-- 1) Tạo SQL Login (bỏ qua bước này nếu Login đã có sẵn — VD dùng chung 1
--    tên đăng nhập cho nhiều siêu thị, chỉ cần tạo 1 lần ở bước đầu).
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'<TEN_LOGIN>')
BEGIN
    CREATE LOGIN [<TEN_LOGIN>]
        WITH PASSWORD = N'<MAT_KHAU>',
        CHECK_POLICY = ON,      -- bật chính sách mật khẩu Windows (độ phức tạp, hết hạn...)
        CHECK_EXPIRATION = OFF; -- tắt BẮT ĐỔI mật khẩu định kỳ — tránh kết nối ứng dụng bị gãy đột ngột
                                 -- (nếu tổ chức bắt buộc đổi định kỳ, nhớ cập nhật lại mật khẩu mới ở
                                 -- đúng màn cấu hình tương ứng trên HCRC Workspace NGAY khi đổi).
END
GO

-- 2) Chuyển sang đúng CSDL DSmart cần cấp quyền (Trung Tâm hoặc của 1 siêu
--    thị cụ thể) rồi tạo User gắn với Login ở trên.
USE [<TEN_CSDL_DSMART>];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'<TEN_LOGIN>')
BEGIN
    CREATE USER [<TEN_LOGIN>] FOR LOGIN [<TEN_LOGIN>];
END
GO

-- 3) Cấp ĐÚNG quyền tối thiểu — CSPRICE: ghi được nhưng KHÔNG đọc được.
GRANT INSERT, UPDATE, DELETE ON [dbo].[CSPRICE] TO [<TEN_LOGIN>];
GO

-- 4) Cấp ĐÚNG quyền tối thiểu — SKU_DEF: CHỈ đọc (tra Đơn Vị Tính/Thuế).
GRANT SELECT ON [dbo].[SKU_DEF] TO [<TEN_LOGIN>];
GO

-- ============================================================================
-- Kiểm tra lại sau khi chạy (tuỳ chọn, chạy dưới tài khoản sysadmin để xem
-- — KHÔNG phải câu lệnh tài khoản <TEN_LOGIN> tự chạy được, vì chính nó
-- không có quyền SELECT trên các view hệ thống quyền theo mặc định):
--
-- SELECT dp.permission_name, dp.state_desc, obj.name AS table_name
-- FROM sys.database_permissions dp
-- JOIN sys.objects obj ON dp.major_id = obj.object_id
-- WHERE dp.grantee_principal_id = USER_ID('<TEN_LOGIN>')
-- ORDER BY obj.name, dp.permission_name;
--
-- Kỳ vọng ĐÚNG 5 dòng: CSPRICE (INSERT/UPDATE/DELETE) + SKU_DEF (SELECT).
-- ============================================================================

-- ============================================================================
-- Sau khi chạy xong trên ĐÚNG CSDL (Trung Tâm hoặc của 1 siêu thị), vào
-- HCRC Workspace nhập Host/Port/Tên CSDL/<TEN_LOGIN>/<MAT_KHAU> ở:
--   - DSmart16 Trung Tâm  -> Hỗ Trợ IT > Cài Đặt Giá Bán Buôn > "⚙️ Cấu
--     Hình Kết Nối" (admin), rồi bấm "🔌 Kiểm Tra Kết Nối" VÀ "🔍 Kiểm Tra
--     Quyền Đọc SKU_DEF" để tự xác nhận quyền đã đủ TRƯỚC khi ghi giá thật.
--   - 1 siêu thị (fan-out) -> Hỗ Trợ IT > Cài Đặt Giá Bán Buôn > "🏬 Kết
--     Nối Siêu Thị" (admin) > Thêm/Sửa đúng siêu thị đó, rồi bấm "🔌 Kiểm
--     Tra" trên dòng siêu thị đó để xác nhận kết nối + quyền ghi đã đúng
--     (nút này gọi testStoreConnection(), chỉ kiểm tra kết nối được —
--     CHƯA kiểm tra riêng quyền SKU_DEF cho từng siêu thị như ở Trung
--     Tâm; nếu thiếu quyền SKU_DEF ở 1 siêu thị, lần "Thêm Giá Mới" ĐẦU
--     TIÊN fan-out xuống siêu thị đó sẽ báo lỗi rõ ràng trong storeResults
--     thay vì ghi thiếu dữ liệu).
-- ============================================================================
