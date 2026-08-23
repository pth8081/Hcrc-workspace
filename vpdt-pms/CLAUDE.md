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

Quy trình cập nhật đầy đủ đã viết sẵn ở mục 11 `HUONG_DAN_DEPLOY_UBUNTU.md`
(thư mục gốc) — trỏ người dùng tới đó thay vì lặp lại toàn bộ mỗi lần, chỉ
nêu phần khác biệt cụ thể của lần cập nhật đang báo cáo.

## Lưu ý khác

- Có 2 bản `HUONG_DAN_DEPLOY_UBUNTU.md` trong repo (thư mục gốc và trong
  `server/`) đã lệch nội dung — `README.md` trỏ tới bản ở thư mục gốc, coi
  đó là bản canonical cho tới khi 2 bản được gộp lại (chưa làm, ngoài phạm vi
  các thay đổi nhỏ lẻ).
