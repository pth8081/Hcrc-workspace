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

- [kiem-ke-sieu-thi.md](./kiem-ke-sieu-thi.md) — Module "Kiểm Kê" (Vận
  Hành): kiểm kê định kỳ toàn siêu thị, quy trình Gom Mã → Kiểm Đếm → Kiểm
  Soát, Kỳ Kiểm Kê (Gom Mã / Thống Kê), phân quyền theo quầy kệ,
  Online/Offline, biểu đồ Báo Cáo. **Trạng thái: Chờ xác nhận phương án.**
  Bản xem có hình minh hoạ (wireframe, biểu đồ màu):
  https://claude.ai/artifact/7bwcVNmkG3MRBS73D1UnT2
