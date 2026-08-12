# VPDT Server — Node.js + MSSQL

Backend + frontend đã chuyển đổi từ localStorage sang SQL Server.

## Cấu trúc thư mục

```
server/
├── server.js            # Điểm khởi chạy chính (Express app)
├── db.js                 # Kết nối SQL Server (connection pool)
├── defaults.js            # Dữ liệu mặc định (seed) - thuần data, không phụ thuộc mssql
├── seedDefaults.js        # Logic ghi dữ liệu mặc định vào SQL Server khi khởi động lần đầu
├── routes/
│   ├── data.js            # API: GET /api/data, GET/POST /api/data/:key
│   └── upload.js          # API: POST /api/upload — nhận file, lưu ra thư mục uploads/
├── uploads/                # File đính kèm (tài liệu, tờ trình...) lưu vật lý tại đây, KHÔNG lưu trong DB
├── sql/
│   └── schema.sql          # Script tạo database + bảng AppData
├── public/
│   └── index.html          # Frontend (đã sửa để gọi API thay vì localStorage)
├── package.json
├── .env.example            # Copy thành .env và điền thông tin SQL Server thật
└── .gitignore
```

## Chạy nhanh (xem chi tiết trong HUONG_DAN_DEPLOY_UBUNTU.md)

```bash
cd server
npm install
cp .env.example .env   # rồi sửa thông tin kết nối SQL Server trong .env
# chạy schema SQL: sqlcmd -S <server> -U sa -P <password> -i sql/schema.sql
npm start
```

Mở trình duyệt: http://localhost:3000

Tài khoản mặc định: `admin / 123456` (đổi mật khẩu ngay sau khi triển khai thật).

## Những gì đã thay đổi so với bản localStorage gốc

- **Không đổi** bất kỳ giao diện, module, hay logic nghiệp vụ nào (upload,
  phê duyệt, hủy, phân quyền...).
- **Chỉ đổi tầng lưu trữ**: `initDatabase()`/`syncStorage()` trong
  `public/index.html` giờ gọi API (`/api/data`) thay vì `localStorage`.
- **Đã sửa 1 lỗi có sẵn**: một số lời gọi lưu cấu hình quy trình dùng sai tên
  khóa (snake_case) không khớp field thực tế (camelCase), khiến thay đổi cấu
  hình bị mất khi tải lại trang. Đã chuẩn hoá lại toàn bộ tên khóa.
- **File đính kèm (tài liệu, tờ trình) không còn nhúng base64 trong JSON**:
  khi upload, file được gửi qua `POST /api/upload` (multipart) và lưu vật lý
  trong thư mục `server/uploads/`; các collection JSON (`docs`,
  `submissions`) chỉ lưu `fileUrl` (đường dẫn `/uploads/<tên-file>`),
  `fileName`, `fileType`. Nhờ đó dung lượng bảng `AppData` không phình to
  theo số lượng/độ lớn file, và giới hạn body JSON đã giảm từ 60MB xuống
  5MB (không còn cần chứa base64). Giới hạn dung lượng mỗi file upload mặc
  định 20MB, chỉnh qua biến môi trường `UPLOAD_MAX_MB`. Các bản ghi cũ còn
  `fileData` (base64) trong DB vẫn xem được nhờ cơ chế fallback ở
  `viewDoc()`.
  ⚠️ Khi deploy: nhớ backup định kỳ thư mục `uploads/` cùng với DB, vì file
  giờ nằm ngoài SQL Server.

Xem đầy đủ hướng dẫn triển khai tại `HUONG_DAN_DEPLOY_UBUNTU.md`.
