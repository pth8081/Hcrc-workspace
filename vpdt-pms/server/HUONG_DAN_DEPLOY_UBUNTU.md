# HƯỚNG DẪN TRIỂN KHAI VPDT (VĂN PHÒNG ĐIỆN TỬ) TRÊN UBUNTU SERVER
### Node.js + SQL Server (MSSQL) — thay thế localStorage

---

## 0. Tổng quan kiến trúc sau khi chuyển đổi

```
[Trình duyệt người dùng]
        │  HTTP(S) (http://<ip-server>:3000, cookie phiên đăng nhập httpOnly)
        ▼
[Ubuntu Server]
   ├─ Node.js (Express) — port 3000 — phục vụ giao diện + API, xác thực bằng
   │  JWT ký ở server (xem mục 5)
   └─ SQL Server (MSSQL) — port 1433 — lưu trữ dữ liệu (dbo.AppData + các bảng
      riêng theo loại hồ sơ: dbo.SystemLogs, dbo.Tasks, dbo.Records — xem ghi
      chú cập nhật bên dưới)
```

Bản mô tả gốc ở đây (lần đầu chuyển từ `localStorage` sang SQL Server) nói
giao diện/chức năng **giữ nguyên 100%**, chỉ đổi nơi lưu trữ. Từ đó tới nay
ứng dụng đã trải qua nhiều đợt nâng cấp bảo mật/kiến trúc lớn nên mô tả đó
**không còn đúng nữa** — xem ghi chú cập nhật ngay dưới đây trước khi triển
khai, đặc biệt là phần cấu hình `.env` ở mục 5.

**Lưu ý về 1 lỗi đã sửa trong quá trình chuyển đổi (lịch sử, không còn liên
quan tới bản hiện tại):** một số hàm cấu hình quy trình (`dept_workflows`,
`car_regs`, `office_reqs`...) trong code gốc gọi lưu dữ liệu với tên khóa
không khớp với tên trường thực tế trong bộ nhớ, khiến các thay đổi này bị mất
khi tải lại trang. Đã sửa lại cho khớp đúng.

**Cập nhật quan trọng sau lần chuyển đổi ban đầu — ĐỌC TRƯỚC KHI TRIỂN KHAI:**

- **Xác thực đã chuyển hẳn sang phía SERVER.** Mật khẩu lưu dạng hash
  (bcrypt, không đọc lại được nguyên văn dù có quyền truy cập CSDL trực
  tiếp). Đăng nhập cấp 1 phiên qua cookie JWT httpOnly, ký bằng `JWT_SECRET`
  — biến này **bắt buộc phải có trong `.env`, server sẽ không khởi động nếu
  thiếu** (xem mục 5, đã bổ sung vào ví dụ `.env` bên dưới). Có giới hạn số
  lần đăng nhập sai liên tiếp + khoá tạm tài khoản.
- **Cookie phiên đăng nhập mặc định bắt buộc HTTPS** (`COOKIE_SECURE=true`
  theo mặc định). Nếu triển khai theo đường tối giản ở mục 6-7 (chạy thẳng
  qua `http://<ip>:3000`, **chưa** làm mục 8 Nginx+HTTPS), trình duyệt sẽ
  **không gửi lại cookie này** — đăng nhập có vẻ thành công nhưng ngay sau đó
  bị coi như chưa đăng nhập, không có thông báo lỗi rõ ràng. Phải đặt
  `COOKIE_SECURE=false` trong `.env` nếu thật sự chạy qua HTTP thuần trong
  mạng nội bộ tin cậy (xem cảnh báo lại ở mục 5 và mục 8).
- **Toàn bộ thao tác tạo/sửa/xoá/duyệt hồ sơ nghiệp vụ** (Văn bản trình, Tài
  liệu, Hợp đồng, Đăng ký xe, Đề xuất văn phòng, Phòng họp, Biên bản họp,
  Công việc, Truyền thông nội bộ...) đều được SERVER tự xác minh lại quyền +
  đúng bước quy trình trước khi ghi — không chỉ dựa vào ẩn/hiện nút trên giao
  diện như bản gốc.
- **Phần lớn dữ liệu nghiệp vụ đã tách khỏi `dbo.AppData`** (vốn chỉ lưu 1
  dòng JSON cho cả collection, phải khoá/đọc/ghi lại NGUYÊN dòng mỗi lần sửa
  1 bản ghi) sang các bảng riêng có khoá đúng từng dòng (`dbo.SystemLogs`,
  `dbo.Tasks`, `dbo.Records`). `dbo.AppData` giờ chỉ còn giữ dữ liệu cấu hình
  (người dùng, phân quyền, quy trình mẫu, cấu hình email...). `schema.sql`
  (mục 3) đã tạo sẵn đầy đủ các bảng này.

Mục 9 (Khuyến nghị bảo mật) đã cập nhật lại đúng hiện trạng này.

---

## 1. Cài đặt Node.js trên Ubuntu

```bash
# Cài Node.js 20 LTS (khuyến nghị) qua NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Kiểm tra
node -v      # >= v18
npm -v
```

---

## 2. Cài đặt SQL Server (MSSQL) trên Ubuntu

Có 2 lựa chọn — chọn 1 trong 2:

### Lựa chọn A: Cài SQL Server trực tiếp trên Ubuntu (khuyến nghị cho server riêng)

```bash
# Thêm repo Microsoft SQL Server 2022 cho Ubuntu 22.04 (đổi "22.04" nếu bạn dùng bản khác)
sudo curl -o /etc/apt/trusted.gpg.d/microsoft.asc https://packages.microsoft.com/keys/microsoft.asc
sudo curl -o /etc/apt/sources.list.d/mssql-server-2022.list https://packages.microsoft.com/config/ubuntu/22.04/mssql-server-2022.list

sudo apt-get update
sudo apt-get install -y mssql-server

# Chạy cấu hình lần đầu: chọn Edition (Developer/Express miễn phí cho test, hoặc nhập license Standard/Enterprise) và đặt mật khẩu SA
sudo /opt/mssql/bin/mssql-conf setup

# Kiểm tra dịch vụ
systemctl status mssql-server --no-pager
```

Cài thêm công cụ dòng lệnh `sqlcmd` để chạy script SQL:

```bash
sudo curl -o /etc/apt/trusted.gpg.d/microsoft.asc https://packages.microsoft.com/keys/microsoft.asc
sudo curl -o /etc/apt/sources.list.d/mssql-tools.list https://packages.microsoft.com/config/ubuntu/22.04/prod.list
sudo apt-get update
sudo ACCEPT_EULA=Y apt-get install -y mssql-tools18 unixodbc-dev

echo 'export PATH="$PATH:/opt/mssql-tools18/bin"' >> ~/.bashrc
source ~/.bashrc
```

### Lựa chọn B: Chạy SQL Server bằng Docker (nhanh, gọn, dễ backup/di chuyển)

```bash
sudo apt-get install -y docker.io
sudo docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=Your_Strong_Password_Here" \
  -p 1433:1433 --name vpdt-mssql --restart unless-stopped \
  -v vpdt-mssql-data:/var/opt/mssql \
  -d mcr.microsoft.com/mssql/server:2022-latest
```

### Lựa chọn C: Dùng SQL Server có sẵn trên máy chủ Windows khác trong công ty

Nếu công ty đã có máy chủ SQL Server riêng (ví dụ theo tiêu chuẩn Dell
PowerEdge R760xs đã cấu hình trước đó), bạn **không cần cài SQL Server trên
Ubuntu** — chỉ cần đảm bảo Ubuntu server có thể kết nối tới máy chủ SQL Server
đó qua mạng nội bộ (port 1433 mở trên firewall Windows), rồi trỏ file `.env`
(bước 5) tới địa chỉIP của máy chủ đó.

---

## 3. Tạo Database và bảng dữ liệu

Chạy script SQL đã cung cấp (`server/sql/schema.sql`) bằng `sqlcmd`:

```bash
sqlcmd -S localhost -U sa -P 'Your_Strong_Password_Here' -i schema.sql
```

Nếu dùng Docker, chạy từ trong container hoặc trỏ `-S localhost,1433` từ máy host.

Script này sẽ (an toàn để chạy lại nhiều lần — chỉ tạo bảng nào chưa có, không đụng dữ liệu cũ):
- Tạo database `VPDT_DMS`
- Tạo bảng `dbo.AppData` (dữ liệu cấu hình: người dùng, phân quyền, quy trình
  mẫu, cấu hình email... — mỗi collection 1 dòng JSON)
- Tạo `dbo.SystemLogs`, `dbo.Tasks`, `dbo.Records` (dữ liệu hồ sơ nghiệp vụ —
  mỗi bản ghi 1 dòng riêng, xem ghi chú kiến trúc ở mục 0)

Dữ liệu mặc định (phòng ban, user admin, quy trình mẫu...) sẽ được **tự động
seed khi server Node.js khởi động lần đầu** (không cần chạy tay).

---

## 4. Chuẩn bị thư mục ứng dụng trên Ubuntu

```bash
# Tạo thư mục và copy toàn bộ thư mục "server/" đã cung cấp lên đây
sudo mkdir -p /opt/vpdt
sudo chown $USER:$USER /opt/vpdt
cd /opt/vpdt
# (copy toàn bộ nội dung thư mục server/ vào đây, ví dụ qua scp/rsync từ máy local)

npm install
```

---

## 5. Cấu hình kết nối SQL Server + xác thực đăng nhập

```bash
cp .env.example .env
nano .env
```

Điền đúng thông tin:

```
PORT=3000

# --- Xác thực đăng nhập (BẮT BUỘC — server sẽ không khởi động nếu thiếu JWT_SECRET) ---
JWT_SECRET=change-me-to-a-long-random-string
COOKIE_SECURE=true

# --- Kết nối SQL Server ---
DB_SERVER=localhost          # hoặc IP máy chủ SQL Server nếu chạy riêng
DB_PORT=1433
DB_NAME=VPDT_DMS
DB_USER=sa
DB_PASSWORD=Your_Strong_Password_Here
DB_ENCRYPT=false
DB_TRUST_CERT=true
```

Tạo `JWT_SECRET` bằng lệnh:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Đây là khoá ký phiên đăng nhập (JWT) — **PHẢI là chuỗi ngẫu nhiên dài, giữ
kín, và khác nhau giữa các môi trường** (dev/staging/production). Đổi giá trị
này sẽ khiến mọi phiên đăng nhập đang mở bị đăng xuất (không sao, chỉ cần
đăng nhập lại) — hữu ích nếu nghi ngờ khoá đã lộ.

> ⚠️ **`COOKIE_SECURE=true` (mặc định) yêu cầu truy cập qua HTTPS.** Nếu bạn
> làm theo mục 8 (Nginx + HTTPS nội bộ) thì giữ nguyên giá trị này. Nếu bạn
> **bỏ qua mục 8** và chạy thẳng qua `http://<ip>:3000` (chỉ nên làm trong
> mạng nội bộ hoàn toàn tin cậy), phải đổi thành `COOKIE_SECURE=false` — nếu
> không, trình duyệt sẽ không lưu lại cookie phiên đăng nhập và người dùng
> **không đăng nhập được dù nhập đúng mật khẩu** (không có thông báo lỗi rõ
> ràng, chỉ tự động bị coi như chưa đăng nhập ngay sau khi vào được màn
> chính).

> ⚠️ Không commit file `.env` lên Git — chứa mật khẩu SQL Server và khoá
> `JWT_SECRET`.

---

## 5b. Cấu hình gửi email thật (SMTP)

Cấu hình gửi email chia làm 2 nơi, **mỗi phần chỉ có đúng 1 nguồn**, không trùng lặp/không chồng
chéo ưu tiên:

- **Host / Port / Mã hoá TLS / Email người gửi / Bật-tắt gửi mail** — cấu hình trực tiếp trên web,
  tại màn **Quản trị > Cấu Hình Email**. Đổi ở đây có hiệu lực ngay, không cần đụng server hay
  khởi động lại. Mặc định hệ thống chỉ **mô phỏng** gửi email (ghi vào Nhật ký hệ thống, không gửi
  thật) cho tới khi nhập SMTP Server ở màn này.
- **Tài khoản/mật khẩu đăng nhập SMTP** (`SMTP_USER`/`SMTP_PASS`, chỉ cần nếu máy chủ SMTP yêu cầu
  xác thực) — bắt buộc đặt trong `.env` trên server vì lý do bảo mật (không lưu trong dữ liệu ứng
  dụng, vì `GET /api/data` trả nguyên dữ liệu cho mọi client gọi được). Để trống **cả 2** biến này
  nếu máy chủ SMTP không yêu cầu đăng nhập — hệ thống hỗ trợ song song cả 2 kiểu.

**Trường hợp 1 — Gmail (cần xác thực):**
```
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```
Bật xác thực 2 bước cho tài khoản Gmail, tạo "Mật khẩu ứng dụng" (App Password) tại
`https://myaccount.google.com/apppasswords`, dùng mật khẩu đó cho `SMTP_PASS` (Google đã chặn đăng
nhập SMTP bằng mật khẩu thường). Sau đó vào **Quản trị > Cấu Hình Email** trên web, điền
`SMTP Server = smtp.gmail.com`, `Port = 587`, `Mã hoá TLS = Tắt / STARTTLS`.

**Trường hợp 2 — mail relay nội bộ công ty (KHÔNG cần xác thực):** nếu relay chỉ cho phép kết nối
từ IP nội bộ tin cậy (không hỏi tài khoản/mật khẩu), để trống cả `SMTP_USER` lẫn `SMTP_PASS` trong
`.env`. Nếu relay dùng chứng chỉ TLS tự ký (self-signed), thêm:
```
SMTP_TLS_REJECT_UNAUTHORIZED=false
```
Sau đó vào **Quản trị > Cấu Hình Email** trên web điền Host/Port/Email người gửi thật của relay nội
bộ. Màn này cũng hiển thị sẵn dòng trạng thái "Server đang cấu hình CÓ/KHÔNG xác thực" để xác nhận
lại đúng chế độ đang chạy, không cần mở file `.env` để kiểm tra.

> ⚠️ Sau khi sửa `.env` (chỉ áp dụng cho tài khoản/mật khẩu SMTP), cần khởi động lại server
> (`pm2 restart vpdt` hoặc tương đương) để áp dụng. Đổi Host/Port/TLS/Email người gửi/Bật-tắt trên
> màn Cấu Hình Email thì KHÔNG cần khởi động lại.

---

## 6. Chạy thử (kiểm tra trước khi đưa vào production)

```bash
npm start
```

Kỳ vọng thấy log:
```
⏳ Đang kết nối SQL Server...
✅ Đã kết nối SQL Server: localhost:1433 - DB: VPDT_DMS
⏳ Đang kiểm tra / khởi tạo dữ liệu mặc định...
   ↳ Seed mặc định cho "depts"
   ↳ Seed mặc định cho "users"
   ... (19 dòng seed cho lần chạy đầu tiên)
✅ VPDT server đang chạy tại http://localhost:3000
```

Mở trình duyệt: `http://<ip-server>:3000` — đăng nhập thử với tài khoản mặc định:
- `admin / 123456` (Quản trị viên - full quyền)
- `nv_nhansu / 123456`, `ks_kiemsoat / 123456`, `sep_duyet / 123456`

Nếu đang chạy thử qua `http://` thuần (chưa làm mục 8) mà đăng nhập không ăn
(vào được màn chính rồi lại bị đá về màn đăng nhập), xem lại cảnh báo
`COOKIE_SECURE` ở mục 5 — nguyên nhân hầu hết là do đó.

**⚠️ Đổi ngay mật khẩu các tài khoản mặc định này trước khi đưa vào sử dụng
thật** (qua module Quản trị → Người dùng). Mật khẩu đã lưu dạng hash (bcrypt,
không đọc lại được nguyên văn dù có quyền truy cập CSDL trực tiếp), nhưng giá
trị mặc định `123456` thì ai cũng biết trước — xem thêm khuyến nghị bảo mật ở
mục 9.

---

## 7. Chạy production ổn định bằng PM2 (tự khởi động lại khi lỗi/reboot server)

```bash
sudo npm install -g pm2

cd /opt/vpdt
pm2 start server.js --name vpdt

# Tự khởi động lại khi server reboot
pm2 startup systemd
pm2 save
```

Các lệnh quản lý thường dùng:
```bash
pm2 status              # xem trạng thái
pm2 logs vpdt           # xem log realtime
pm2 restart vpdt        # khởi động lại sau khi cập nhật code
pm2 stop vpdt
```

---

## 8. Cấu hình Nginx làm Reverse Proxy (khuyến nghị cho production)

Giúp chạy ứng dụng qua cổng 80/443 (thay vì :3000), dễ gắn domain nội bộ và SSL.

```bash
sudo apt-get install -y nginx
sudo nano /etc/nginx/sites-available/vpdt
```

Nội dung:
```nginx
server {
    listen 80;
    server_name vpdt.congty.local;   # đổi thành domain/IP nội bộ của bạn

    client_max_body_size 60M;        # cho phép upload file lớn (tài liệu/hợp đồng)

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/vpdt /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Mở firewall (nếu dùng `ufw`):
```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

Nếu cần HTTPS nội bộ, dùng `certbot` (nếu có domain public trỏ về server) hoặc
tự cấp chứng chỉ nội bộ qua CA công ty.

---

## 9. Khuyến nghị bảo mật trước khi đưa vào sử dụng chính thức

**Cập nhật:** mục "nâng cấp hash mật khẩu (bcrypt) + xác thực phía server"
trong bản hướng dẫn gốc **đã hoàn tất từ lâu** — không còn là việc cần làm
thêm. Xác thực hiện đã hoàn toàn ở phía server (mật khẩu hash bcrypt, phiên
đăng nhập bằng JWT httpOnly, có giới hạn số lần đăng nhập sai + khoá tạm tài
khoản), và toàn bộ thao tác tạo/sửa/xoá/duyệt hồ sơ nghiệp vụ đều được server
tự xác minh lại quyền trước khi ghi (xem ghi chú cập nhật ở mục 0). Các điểm
dưới đây vẫn là khuyến nghị **vận hành** thật sự cần làm khi triển khai —
không phụ thuộc vào code, chỉ phụ thuộc vào cách bạn cấu hình/vận hành server:

1. **Đổi toàn bộ mật khẩu mặc định** (`123456`) ngay sau khi triển khai —
   mật khẩu đã hash nên không đọc lại được nguyên văn, nhưng giá trị mặc định
   này ai cũng biết trước, vẫn là điểm yếu nếu không đổi.
2. **Đặt `JWT_SECRET` đủ mạnh, ngẫu nhiên, và giữ bí mật** trong `.env` (mục
   5). Đây là khoá ký phiên đăng nhập — lộ khoá này coi như lộ khả năng tự
   tạo phiên đăng nhập giả mạo bất kỳ tài khoản nào mà không cần biết mật
   khẩu. Không dùng chung 1 giá trị `JWT_SECRET` giữa các môi trường
   (dev/staging/production).
3. **Giữ `COOKIE_SECURE=true`** (mặc định) và triển khai HTTPS thật (mục 8)
   khi có thể — cookie phiên đăng nhập chỉ thật sự an toàn khi truyền qua
   HTTPS. Chỉ tắt (`false`) khi chạy hoàn toàn trong mạng nội bộ tin cậy và
   chấp nhận đánh đổi (xem cảnh báo ở mục 5).
4. **Chỉ mở port 3000/1433 trong mạng nội bộ** (LAN/VPN công ty), không expose
   trực tiếp ra Internet nếu không có SSL + xác thực bổ sung.
5. **Backup định kỳ SQL Server** (`sqlcmd`/SQL Server Agent job hoặc script
   `BACKUP DATABASE VPDT_DMS TO DISK = ...` chạy cron hàng ngày).

---

## 10. Kiểm tra sức khỏe hệ thống

Endpoint kiểm tra nhanh:
```
GET http://<ip-server>:3000/api/health
→ {"status":"ok","db":"connected","version":"1.1.0"}
```

`version` khớp đúng trường `version` trong `package.json` của bản code server
đang chạy — dùng để xác nhận sau khi cập nhật code (mục 11) đã áp dụng đúng
bản mới hay chưa, không cần đoán. Cùng số phiên bản này cũng hiện ở góc dưới
bên phải màn hình web (không cần đăng nhập).

Dùng cho giám sát (uptime monitor, script cron cảnh báo qua email/Zalo nếu server down).

---

## 11. Cập nhật code sau này

```bash
cd /opt/vpdt
# copy toàn bộ code mới (backend + public/index.html) đè lên
npm install     # BẮT BUỘC nếu package.json có thay đổi (thêm/đổi gói) — xem cảnh báo bên dưới
pm2 restart vpdt
pm2 status      # phải thấy "online", không phải liên tục "restart"/"errored"
```

Vì toàn bộ dữ liệu đã nằm trong SQL Server (không còn trong trình duyệt), việc
cập nhật giao diện/code **không làm mất dữ liệu người dùng đã nhập**.

> ⚠️ **Lỗi thường gặp: web báo 502/503 sau khi cập nhật code, không truy cập
> được.** Nguyên nhân hầu hết là bỏ sót bước `npm install` — nếu code mới
> thêm gói mới trong `package.json` (`dependencies`) mà chưa cài, tiến trình
> Node sẽ báo lỗi `Cannot find module '...'` và **thoát ngay khi khởi động**,
> khiến PM2 cứ khởi động rồi crash liên tục, Nginx không có gì để chuyển tiếp
> request tới nên trả về 502/503. Cách kiểm tra và khắc phục:
> ```bash
> pm2 logs vpdt --lines 50 --err   # tìm dòng "Cannot find module ..."
> cd /opt/vpdt && npm install
> pm2 restart vpdt
> ```
> Sau khi sửa, mở `GET /api/health` (mục 10) để xác nhận server đã lên và
> đúng phiên bản mới trước khi báo cho người dùng thử lại.
>
> Ngoài `npm install`, nếu bản cập nhật có ghi chú đổi cấu trúc bảng
> (`server/sql/schema.sql`), cũng cần chạy lại script đó trên SQL Server thật
> (script viết để chạy lại nhiều lần an toàn, không mất dữ liệu cũ) và đảm
> bảo file `.env` đã có đủ biến bắt buộc mới (ví dụ `JWT_SECRET`) — xem
> `.env.example`.

---

## 12. Ghi chú đợt rà soát trước khi đưa vào chạy thật (rà soát code PR #40–59)

Đợt cập nhật này sửa 6 vấn đề phát hiện khi rà soát lại toàn bộ code trước khi
đưa vào chạy thật (sửa lỗi/bảo mật, không phải tính năng mới). **Không cần đổi
gì ở `.env` (mục 5), không cần chạy lại `schema.sql` (mục 3), không có gói npm
mới** — chỉ cần làm đúng bước "Cập nhật code" ở mục 11 như bình thường
(`npm install` vẫn nên chạy cho chắc, dù `package.json` không đổi ở đợt này).

Các thay đổi hành vi cần biết trước khi thông báo cho người dùng:

- **`/uploads` (tải file đính kèm) giờ bắt buộc phải đăng nhập mới tải
  được.** Trước đây ai có đúng URL file — kể cả chưa đăng nhập vào hệ thống —
  đều tải thẳng được. Nếu công ty có thói quen gửi thẳng link file đính kèm ra
  ngoài (email, Zalo/chat...) cho người **chưa có tài khoản** trong hệ thống,
  các link đó sẽ ngừng hoạt động sau đợt cập nhật này — cần báo trước cho
  người dùng liên quan hoặc đổi quy trình gửi file.
- **API ghi cấu hình quy trình mẫu (`/api/data/workflows`) giờ chỉ Quản trị
  viên mới ghi được** — trước đây bất kỳ ai đã đăng nhập cũng ghi trực tiếp
  được qua API chung (dù giao diện không hiện nút cho phép).
- **Xác minh mật khẩu cho thao tác nhạy cảm (duyệt hồ sơ mức PASSWORD...)
  giờ có giới hạn: sai 5 lần liên tiếp/tài khoản sẽ tạm khoá 15 phút** —
  cùng cơ chế đã áp dụng cho màn đăng nhập từ trước, giờ áp dụng thêm cho màn
  xác minh này.
- **Danh sách người dùng trả về từ API không còn lộ số lần đăng nhập sai /
  thời điểm khoá tài khoản** của người khác cho các tài khoản không phải quản
  trị viên — chỉ ẩn bớt field trả về, không ảnh hưởng tính năng nào trên giao
  diện.
- **Đổi thông tin cá nhân (`Hồ sơ của tôi` — số điện thoại/mật khẩu)** đổi
  sang cơ chế khoá dòng khi ghi xuống CSDL, tránh mất dữ liệu nếu vô tình có 2
  request ghi cùng lúc — hành vi với người dùng cuối không đổi.
- **Chống đặt trùng phòng họp cùng khung giờ khi 2 người bấm tạo gần như
  đồng thời** (trước đây có khe hở nhỏ có thể tạo trùng nếu bấm rất sát
  nhau) — dùng cơ chế khoá `sp_getapplock` sẵn có của SQL Server. Đã kiểm thử
  kỹ ở tầng logic ứng dụng (giả lập CSDL), nhưng **chưa kiểm thử được với SQL
  Server thật** trong môi trường phát triển hiện tại (không có sẵn instance
  MSSQL thật để nối). **Khuyến nghị:** sau khi triển khai lên server thật, thử
  tạo 2 booking trùng phòng + trùng giờ từ 2 tab/2 người gần như đồng thời một
  lần để xác nhận chỉ 1 yêu cầu thành công, yêu cầu còn lại báo lỗi trùng lịch
  rõ ràng (không phải lỗi 500 chung chung).
