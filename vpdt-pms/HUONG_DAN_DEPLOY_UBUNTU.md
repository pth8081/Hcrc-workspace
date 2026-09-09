# HƯỚNG DẪN TRIỂN KHAI VPDT — ĐÃ CHUYỂN VỊ TRÍ

Nội dung đầy đủ đã chuyển sang thư mục `deploy/`, tách thành 2 bản tuỳ theo có
dùng Nginx hay không:

- [`deploy/Huong-dan-trien-khai-PM2.md`](./deploy/Huong-dan-trien-khai-PM2.md)
  — chỉ PM2, phục vụ trực tiếp `http://<ip>:3000`, dùng cho mạng nội bộ (LAN/VPN).
- [`deploy/Huong-dan-trien-khai-PM2-Nginx.md`](./deploy/Huong-dan-trien-khai-PM2-Nginx.md)
  — PM2 + Nginx (reverse proxy + HTTPS + fail2ban), khuyến nghị cho production/
  public ra Internet.

File này chỉ còn là điểm trỏ — không xoá hẳn để các đường dẫn cũ (comment
code, README...) không bị lỗi "not found".
