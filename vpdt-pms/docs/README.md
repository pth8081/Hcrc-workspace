# Tài liệu đề xuất / phân tích tính năng

Thư mục này chứa các tài liệu **phân tích nghiệp vụ + đề xuất phương án** cho
tính năng **mới**, viết **trước khi code** — để trao đổi và xác nhận hướng
làm trước khi triển khai thật. Khác với:

- `../deploy/Huong-dan-nghiep-vu.md` — hướng dẫn **sử dụng/cấu hình** các
  tính năng **đã có** trong hệ thống (sản phẩm đã chạy thật).
- `../deploy/Huong-dan-trien-khai-PM2.md`,
  `../deploy/Huong-dan-trien-khai-PM2-Nginx.md` — hướng dẫn triển khai hạ
  tầng (PM2/Nginx).
- `../CLAUDE.md` — ghi chú quy ước code cho Claude khi làm việc trên repo.

Mỗi file trong đây là **1 đề xuất**, trạng thái ghi rõ ở đầu file (Chờ xác
nhận / Đã xác nhận đang code / Đã triển khai...). Khi 1 đề xuất được triển
khai xong, nội dung sử dụng/cấu hình thật của nó chuyển sang
`Huong-dan-nghiep-vu.md` như quy trình chuẩn — file ở đây giữ lại làm lịch
sử quyết định (vì sao thiết kế như vậy), không xoá.

## Danh sách

- [kiem-ke-sieu-thi.md](./kiem-ke-sieu-thi.md) — Module "📋 Kiểm Kê" (nay
  là module chính ở sidebar, tách khỏi Vận Hành 12/2026): kiểm kê định kỳ
  toàn siêu thị, quy trình Gom Mã → Kiểm Đếm → Kiểm Soát, Kỳ Kiểm Kê (Gom
  Mã / Kiểm Kê), phân quyền theo quầy kệ, Online/Offline, biểu đồ Báo Cáo.
  **Trạng thái: Đã triển khai** — tài liệu gốc giữ lại làm lịch sử quyết
  định; hướng dẫn sử dụng thật xem `../deploy/Huong-dan-nghiep-vu.md`, quy
  trình vận hành kèm ảnh chụp màn hình thật xem
  [kiem-ke-quy-trinh-van-hanh.md](./kiem-ke-quy-trinh-van-hanh.md).
  Bản xem có hình minh hoạ (wireframe, biểu đồ màu) — bản đề xuất ban đầu:
  https://claude.ai/artifact/7bwcVNmkG3MRBS73D1UnT2
- [kiem-ke-quy-trinh-van-hanh.md](./kiem-ke-quy-trinh-van-hanh.md) — Quy
  trình vận hành ĐẦY ĐỦ của module "📋 Kiểm Kê" sau khi đã triển khai thật
  (6 bước: Chuẩn Bị → Gom Mã → Kiểm Đếm → Kiểm Soát → Xác Nhận & Đóng Kỳ →
  Báo Cáo), kèm ảnh chụp màn hình thật từng bước + bảng phân quyền theo
  vai trò. **Trạng thái: Tài liệu tham khảo (as-built).**
