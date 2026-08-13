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
- **Phân quyền theo phòng ban cho từng module nghiệp vụ**: trước đây Tờ
  trình / Hợp đồng / Phòng họp / Đăng ký xe / Văn phòng chỉ có 1 công tắc
  bật-tắt truy cập toàn công ty (ai được bật là thấy dữ liệu của MỌI phòng
  ban). Nay mỗi module có phạm vi Xem & Tạo mới riêng dạng "Tất cả" hoặc
  "chỉ các phòng ban được chỉ định" — giống hệt mô hình đã có sẵn ở module
  Tài liệu. Quyền "Xem Bản Nháp" (trước đây được cấu hình nhưng không có
  tác dụng gì) nay thực sự kiểm soát việc xem tài liệu đang xử lý/bị từ
  chối, tách riêng khỏi quyền "Xem Đã Duyệt".
  - **Tự động di trú dữ liệu cũ**: lần đầu tải trang sau khi cập nhật,
    `initDatabase()` tự chuyển đổi phân quyền kiểu cũ (cờ boolean) sang mô
    hình mới và lưu lại ngay, giữ nguyên đúng quyền hiện có của từng user
    (không âm thầm khoá bớt quyền ai). Không cần thao tác thủ công.
  - Người dùng mới tạo mặc định **không** có quyền xem/tạo liên phòng ban ở
    module nào (trước đây mặc định bật hầu hết) — admin cấp thêm quyền nếu
    cần. Mỗi người luôn thao tác được trong phạm vi phòng ban của chính
    mình dù chưa được cấp thêm gì.
- **Module Quy Trình & Đồng Cấp — sửa 2 lỗi có sẵn + thêm quyền "Người duyệt"**:
  - Trước đây đổi mẫu quy trình (dropdown) cho 1 phòng ban sẽ **lưu ngay
    lập tức** bằng danh sách người duyệt của mẫu CŨ còn sót lại trên màn
    hình (chưa kịp render lại theo mẫu mới), khiến các bước mới bị thiếu/mất
    người duyệt mà vẫn báo "lưu thành công". Nay đổi mẫu chỉ preview (có
    banner cảnh báo "chưa lưu"), phải gán lại người duyệt rồi bấm "Lưu Cấu
    Hình" mới thực sự áp dụng.
  - Trước đây xoá 1 mẫu quy trình đang được phòng ban nào đó sử dụng sẽ xoá
    vô điều kiện, để lại tham chiếu treo khiến hệ thống âm thầm rơi về quy
    trình giả không có người duyệt thật. Nay bị **chặn xoá** kèm danh sách
    module/phòng ban đang dùng, phải đổi sang mẫu khác trước.
  - Lưu cấu hình quy trình mà có bước không có ai duyệt sẽ được **cảnh báo
    rõ tên bước** trước khi lưu (vẫn cho lưu nếu admin xác nhận là cố ý).
  - Thêm quyền **"Người duyệt"** (`perms.canBeApprover`, khối 12 trong form
    user) — danh sách chọn người duyệt ở từng bước quy trình giờ chỉ hiện
    người có quyền này (+ admin), thay vì toàn bộ user trong hệ thống; ưu
    tiên hiển thị người cùng phòng ban đang cấu hình lên trước (không lọc
    cứng theo phòng ban để vẫn gán được người duyệt chéo phòng, ví dụ Ban
    Giám Đốc). Người đã được gán làm approver từ trước vẫn luôn hiển thị dù
    chưa có quyền này, để không bị "biến mất" khỏi màn hình cấu hình.
- **Module Đăng Ký Xe — có form xử lý ở cả 2 phía, sinh Phiếu Phê Duyệt điện tử**:
  - Form đăng ký được tái cấu trúc theo đúng Mẫu Oto01 (Thời gian đăng ký,
    Người đăng ký, Đơn vị, Loại xe đăng ký, Số người sử dụng, Người sử dụng
    trực tiếp, Mục đích sử dụng, Nội dung chi tiết, Lộ trình, Thời gian sử
    dụng, Số km dự kiến). Bỏ 2 trường Biển số/Lái xe khỏi bước đăng ký vì
    thực tế do Phòng Hành Chính xếp SAU khi duyệt, không phải người đăng ký
    tự chọn trước.
  - Phía phê duyệt trước đây chỉ có 2 nút Duyệt/Từ chối không nhập được gì.
    Nay có modal "Xử Lý Đăng Ký Xe" giống module Tờ trình, kèm 3 ô nhập cho
    Phòng Hành Chính: Lái xe được phân công / Loại xe cụ thể / Biển kiểm
    soát — điền ở bước nào cũng được (thường là bước cuối), lưu vào lịch sử
    xử lý của từng bước.
  - Sau khi phê duyệt hoàn tất (mọi bước quy trình), người đăng ký (và ai có
    quyền xem/tải phù hợp) thấy nút **"👁️ Xem Phiếu"** — mở "Phiếu Phê Duyệt
    Đăng Ký Xe" dựng động: đầy đủ thông tin đăng ký + phần Phòng Hành Chính +
    khối chữ ký nhiều cột (1 cột/bước quy trình đã cấu hình, tự lấy đúng tên
    bước + người duyệt + thời gian từ lịch sử xử lý), kèm watermark chéo
    "PHÊ DUYỆT TRÊN HỆ THỐNG VĂN PHÒNG ĐIỆN TỬ". Nút **"⬇️ Tải"** bên cạnh
    xuất file `.html` tự chứa (không phụ thuộc CSS ngoài) để lưu/in sau.
  - Modal xem tài liệu (Protected Viewer) có thêm nút **"🖨️ In"** dùng chung
    cho mọi loại nội dung (tài liệu, hợp đồng, phiếu xe...) — in trực tiếp
    đúng phần nội dung đang xem qua 1 iframe ẩn, không kèm khung modal.
  - ⚠️ Lưu ý thiết kế: phần tiêu đề công ty trên phiếu hiện để chung chung
    (không có tên/logo công ty cụ thể) vì hệ thống chưa có cấu hình tên công
    ty — báo lại nếu muốn bổ sung trường này ở Module Quản trị.

Xem đầy đủ hướng dẫn triển khai tại `HUONG_DAN_DEPLOY_UBUNTU.md`.
