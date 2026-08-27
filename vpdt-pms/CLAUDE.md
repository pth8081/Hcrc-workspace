# Ghi chú cho Claude khi làm việc trên repo này

## Lưu ý bắt buộc khi báo cáo thay đổi liên quan tới deploy

Người dùng chạy `server/` trên máy chủ thật riêng, KHÔNG tự động đồng bộ code
qua git — mỗi lần cập nhật là thao tác thủ công. Khi báo cáo bất kỳ thay đổi
nào đã commit/push/merge, **luôn kiểm tra và nêu rõ** nếu thay đổi đó yêu cầu
làm thêm gì ngoài việc copy code + `pm2 restart`, cụ thể là:

- `server/sql/schema.sql` có đổi không (bảng/cột/index mới hoặc sửa lỗi
  trong script) — nếu có, phải nhắc chạy lại (an toàn, script tự bọc
  `IF OBJECT_ID(...) IS NULL`).
- `server/.env.example` có thêm biến môi trường mới không — nêu rõ biến nào
  **bắt buộc** để server khởi động được, biến nào chỉ cần khi dùng đúng tính
  năng liên quan.
- `server/package.json` có thêm/đổi `dependencies` không — nếu có, nhắc chạy
  `npm install` lại.
- Có cần thao tác 1 lần nào khác không (migrate dữ liệu thủ công, đổi cấu
  hình PM2/Nginx...).

Không giả định người dùng tự soát các file diff này — luôn liệt kê tường
minh trong phần tóm tắt, kể cả khi câu trả lời là "không cần làm gì thêm
ngoài copy code".

Quy trình cập nhật đầy đủ đã viết sẵn ở mục 12 `HUONG_DAN_DEPLOY_UBUNTU.md`
(thư mục gốc, bản DUY NHẤT — đã gộp bản trùng lặp từng có trong `server/`) —
trỏ người dùng tới đó thay vì lặp lại toàn bộ mỗi lần, chỉ nêu phần khác biệt
cụ thể của lần cập nhật đang báo cáo.

## Luôn tăng version khi merge vào main

Mỗi lần merge PR vào main (bất kể tính năng lớn hay fix nhỏ), **luôn tăng
`server/package.json` field `version`** trong CÙNG PR trước khi merge — theo
kiểu semver không chặt (patch cho fix nhỏ, minor cho tính năng mới). Đây là
version DUY NHẤT client đọc (badge góc màn hình + `/api/health`, xem
`server.js` require `./package.json`), không có bản sao nào khác cần sửa.
Nếu lỡ quên ở 1-2 lần merge trước, bump bắt kịp luôn (cộng dồn số lần đã bỏ
lỡ) ở lần merge kế tiếp thay vì bỏ qua.
