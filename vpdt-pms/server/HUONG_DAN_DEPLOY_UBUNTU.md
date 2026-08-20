# HƯỚNG DẪN TRIỂN KHAI VPDT (VĂN PHÒNG ĐIỆN TỬ) TRÊN UBUNTU SERVER
### Node.js + SQL Server (MSSQL) — dựng mới hoàn toàn trên máy chủ thật

---

## 0. Tổng quan kiến trúc

```
[Trình duyệt người dùng]
        │  HTTP(S) (qua Nginx cổng 80/443, cookie phiên đăng nhập httpOnly)
        ▼
[Ubuntu Server]
   ├─ Nginx — reverse proxy cổng 80/443 → 127.0.0.1:3000 (mục 9)
   ├─ Node.js (Express, chạy dưới PM2) — port 3000 — phục vụ giao diện + API,
   │  xác thực bằng JWT ký ở server (xem mục 6)
   └─ SQL Server (MSSQL) — port 1433 — lưu trữ dữ liệu (dbo.AppData + các bảng
      riêng theo loại hồ sơ: dbo.SystemLogs, dbo.Tasks, dbo.Records)
```

**Đặc điểm kiến trúc cần biết trước khi triển khai:**

- **Xác thực hoàn toàn ở phía SERVER.** Mật khẩu lưu dạng hash (bcrypt, không
  đọc lại được nguyên văn dù có quyền truy cập CSDL trực tiếp). Đăng nhập cấp
  1 phiên qua cookie JWT httpOnly, ký bằng `JWT_SECRET` — biến này **bắt buộc
  phải có trong `.env`, server sẽ không khởi động nếu thiếu** (xem mục 6). Có
  giới hạn số lần đăng nhập sai liên tiếp + khoá tạm tài khoản.
- **Cookie phiên đăng nhập mặc định bắt buộc HTTPS** (`COOKIE_SECURE=true`).
  Hướng dẫn này đi thẳng qua Nginx (mục 9) nên giữ nguyên mặc định `true` —
  chỉ đổi `false` nếu bạn cố tình bỏ qua Nginx và chạy thẳng qua
  `http://<ip>:3000` trong mạng nội bộ hoàn toàn tin cậy (xem cảnh báo lại ở
  mục 6).
- **Toàn bộ thao tác tạo/sửa/xoá/duyệt hồ sơ nghiệp vụ** đều được SERVER tự
  xác minh lại quyền + đúng bước quy trình trước khi ghi — không chỉ dựa vào
  ẩn/hiện nút trên giao diện.
- **Dữ liệu nghiệp vụ** (Văn bản trình, Tài liệu, Hợp đồng, Đăng ký xe, Đề
  xuất văn phòng, Công việc, Báo cáo định kỳ...) nằm trong các bảng riêng có
  khoá đúng từng dòng (`dbo.SystemLogs`, `dbo.Tasks`, `dbo.Records`).
  `dbo.AppData` chỉ còn giữ dữ liệu cấu hình (người dùng, phân quyền, quy
  trình mẫu, cấu hình email...). `schema.sql` (mục 4) tạo sẵn đầy đủ các bảng
  này — **không cần chạy tay thêm gì khác, không cần seed dữ liệu tay**, ứng
  dụng tự seed dữ liệu mặc định khi khởi động lần đầu (mục 8).

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

Có 3 lựa chọn — chọn 1:

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

Nếu công ty đã có máy chủ SQL Server riêng, bạn **không cần cài SQL Server
trên Ubuntu** — chỉ cần đảm bảo Ubuntu server có thể kết nối tới máy chủ SQL
Server đó qua mạng nội bộ (port 1433 mở trên firewall Windows), rồi trỏ file
`.env` (mục 6) tới địa chỉ IP của máy chủ đó.

---

## 3. Chuẩn bị thư mục ứng dụng trên Ubuntu

**Làm bước này TRƯỚC khi tạo database ở mục 4** — script SQL nằm sẵn trong
mã nguồn (`sql/schema.sql`), phải có mã nguồn trên máy trước mới chạy được.

```bash
sudo mkdir -p /opt/vpdt
sudo chown $USER:$USER /opt/vpdt
cd /opt/vpdt
# Copy TOÀN BỘ nội dung thư mục server/ đã cung cấp vào đây (scp/rsync/git clone từ máy local)

npm install
```

`npm install` đọc `package.json` và cài đủ mọi gói ứng dụng cần (Express,
mssql, bcryptjs, exceljs...) — bỏ sót bước này ở lần dựng đầu tiên khiến
server báo lỗi `Cannot find module '...'` và thoát ngay lúc khởi động (xem
cảnh báo tương tự ở mục 12 cho các lần cập nhật code sau này).

---

## 4. Tạo Database và bảng dữ liệu

Từ trong thư mục `/opt/vpdt` (đã có `sql/schema.sql` từ mục 3):

```bash
cd /opt/vpdt/sql
sqlcmd -S localhost -U sa -P 'Your_Strong_Password_Here' -i schema.sql
```

Nếu dùng Docker (Lựa chọn B ở mục 2), chạy `sqlcmd` từ máy host trỏ
`-S localhost,1433`, hoặc `docker exec` vào container rồi chạy từ trong đó.
Nếu dùng SQL Server có sẵn ở máy khác (Lựa chọn C), đổi `-S localhost` thành
đúng IP máy chủ đó.

Script này **an toàn để chạy lại nhiều lần** (chỉ tạo bảng nào chưa có,
không đụng dữ liệu cũ) — sẽ:
- Tạo database `VPDT_DMS`
- Tạo bảng `dbo.AppData` (dữ liệu cấu hình — mỗi collection 1 dòng JSON)
- Tạo `dbo.SystemLogs`, `dbo.Tasks`, `dbo.Records` (dữ liệu hồ sơ nghiệp vụ —
  mỗi bản ghi 1 dòng riêng, xem ghi chú kiến trúc ở mục 0)

Dữ liệu mặc định (phòng ban, user admin, quy trình mẫu...) sẽ được **tự động
seed khi server Node.js khởi động lần đầu** (mục 8) — không cần chạy tay.

---

## 5. Kiểm tra kết nối SQL Server trước khi cấu hình ứng dụng

```bash
sqlcmd -S localhost -U sa -P 'Your_Strong_Password_Here' -Q "SELECT name FROM sys.databases;"
```

Phải thấy `VPDT_DMS` trong danh sách trả về. Nếu lỗi kết nối ở bước này, xử
lý dứt điểm trước khi sang mục 6 — mọi lỗi kết nối DB sau này (mục 8, mục 9)
đều bắt nguồn từ đây.

---

## 6. Cấu hình kết nối SQL Server + xác thực đăng nhập

```bash
cd /opt/vpdt
cp .env.example .env
nano .env
```

Điền đúng thông tin (các dòng dưới là **bắt buộc**, phần còn lại trong
`.env.example` đã copy sẵn qua `.env` — để nguyên comment, chỉ sửa giá trị
cần thiết):

```
PORT=3000

# --- Xác thực đăng nhập (BẮT BUỘC — server sẽ không khởi động nếu thiếu JWT_SECRET) ---
JWT_SECRET=change-me-to-a-long-random-string
COOKIE_SECURE=true

# --- Kết nối SQL Server ---
DB_SERVER=localhost          # hoặc IP máy chủ SQL Server nếu chạy riêng (Lựa chọn C ở mục 2)
DB_PORT=1433
DB_NAME=VPDT_DMS
DB_USER=sa
DB_PASSWORD=Your_Strong_Password_Here
DB_ENCRYPT=false
DB_TRUST_CERT=true
```

> ⚠️ `DB_ENCRYPT=false` chỉ chấp nhận được khi SQL Server và server ứng dụng cùng nằm trong mạng nội
> bộ tin cậy — server sẽ in cảnh báo lúc khởi động nếu vẫn để `false`. Đổi thành `true` ngay khi SQL
> Server đã cấu hình chứng chỉ TLS.

Tạo `JWT_SECRET` bằng lệnh:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Đây là khoá ký phiên đăng nhập (JWT) — **PHẢI là chuỗi ngẫu nhiên dài, giữ
kín, và khác nhau giữa các môi trường** (dev/staging/production). Đổi giá trị
này sẽ khiến mọi phiên đăng nhập đang mở bị đăng xuất (không sao, chỉ cần
đăng nhập lại) — hữu ích nếu nghi ngờ khoá đã lộ.

> ⚠️ **`COOKIE_SECURE=true` (mặc định) yêu cầu truy cập qua HTTPS/qua Nginx
> đúng cấu hình ở mục 9.** Nếu bạn cố tình bỏ qua mục 9 và chạy thẳng qua
> `http://<ip>:3000` (chỉ nên làm trong mạng nội bộ hoàn toàn tin cậy), phải
> đổi thành `COOKIE_SECURE=false` — nếu không, trình duyệt sẽ không lưu lại
> cookie phiên đăng nhập và người dùng **không đăng nhập được dù nhập đúng
> mật khẩu** (không có thông báo lỗi rõ ràng, chỉ tự động bị coi như chưa
> đăng nhập ngay sau khi vào được màn chính).

> ⚠️ Không commit file `.env` lên Git — chứa mật khẩu SQL Server và khoá
> `JWT_SECRET`.

**Bỏ qua `TRUST_PROXY` và `ALLOWED_ORIGINS` ở bước này** — 2 biến đó chỉ cần
đặt sau khi dựng xong Nginx, xem lại ở cuối mục 9 (dễ quên vì làm ở đây trước
khi có Nginx sẽ không có tác dụng gì, phải quay lại sau).

---

## 7. Cấu hình gửi email thật (SMTP)

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

## 8. Chạy thử (kiểm tra trước khi đưa vào production)

```bash
cd /opt/vpdt
npm start
```

Kỳ vọng thấy log:
```
⏳ Đang kết nối SQL Server...
✅ Đã kết nối SQL Server: localhost:1433 - DB: VPDT_DMS
⏳ Đang kiểm tra / khởi tạo dữ liệu mặc định...
   ↳ Seed mặc định cho "depts"
   ↳ Seed mặc định cho "users"
   ... (nhiều dòng seed cho lần chạy đầu tiên)
✅ VPDT server đang chạy tại http://localhost:3000
```

Mở trình duyệt: `http://<ip-server>:3000` — đăng nhập thử với tài khoản mặc định:
- `admin / 123456` (Quản trị viên - full quyền)
- `nv_nhansu / 123456`, `ks_kiemsoat / 123456`, `sep_duyet / 123456`

Nếu đăng nhập không ăn (vào được màn chính rồi lại bị đá về màn đăng nhập),
xem lại cảnh báo `COOKIE_SECURE` ở mục 6 — nguyên nhân hầu hết là do đó (đang
thử qua `http://` thuần mà `COOKIE_SECURE` vẫn để `true`).

Dừng lại (Ctrl+C) sau khi xác nhận chạy được — bước này chỉ để kiểm tra
trước khi chuyển sang chạy nền bằng PM2 (mục 9).

**⚠️ Đổi ngay mật khẩu các tài khoản mặc định này trước khi đưa vào sử dụng
thật** (qua module Quản trị → Người dùng). Mật khẩu đã lưu dạng hash (bcrypt,
không đọc lại được nguyên văn dù có quyền truy cập CSDL trực tiếp), nhưng giá
trị mặc định `123456` thì ai cũng biết trước — xem thêm khuyến nghị bảo mật ở
mục 10.

---

## 9. Chạy production ổn định bằng PM2 + Nginx (reverse proxy, HTTPS)

### 9a. PM2 (giữ tiến trình chạy nền, tự khởi động lại khi lỗi/reboot server)

```bash
sudo npm install -g pm2

cd /opt/vpdt
# NODE_ENV=production BẮT BUỘC — thiếu biến này, lỗi máy chủ (500) sẽ trả kèm chi tiết exception thật
# (có thể chứa lỗi SQL, đường dẫn file nội bộ...) ra thẳng cho trình duyệt thay vì chỉ ghi vào log server
# (xem lib/errorResponse.js). KHÔNG bỏ qua bước này khi deploy lên máy chủ thật.
NODE_ENV=production pm2 start server.js --name vpdt

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

### 9b. Nginx (reverse proxy cổng 80/443 → 3000)

```bash
sudo apt-get install -y nginx
sudo nano /etc/nginx/sites-available/vpdt
```

Nội dung — `client_max_body_size` PHẢI ≥ `UPLOAD_MAX_MB` trong `.env` (mặc
định `UPLOAD_MAX_MB=20` nếu không đặt — xem `.env.example`), nếu không file
người dùng tải lên nằm giữa 2 giới hạn này sẽ bị Nginx chặn với lỗi
"413 Request Entity Too Large" mơ hồ thay vì thông báo rõ ràng của ứng dụng:

```nginx
server {
    listen 80;
    server_name vpdt.congty.local;   # đổi thành domain/IP nội bộ của bạn

    client_max_body_size 20M;        # khớp UPLOAD_MAX_MB (.env) — đổi cả 2 cùng lúc nếu cần nâng

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

Mở firewall (nếu dùng `ufw`) — sau lệnh `enable`, chỉ còn 80/443/22 mở ra
ngoài, cổng 3000 (Node) và 1433 (SQL Server) tự động bị chặn từ bên ngoài:
```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

Nếu cần HTTPS nội bộ, dùng `certbot` (nếu có domain public trỏ về server) hoặc
tự cấp chứng chỉ nội bộ qua CA công ty.

### 9c. Bật `TRUST_PROXY` sau khi có Nginx (BẮT BUỘC, dễ bỏ sót)

Giờ mọi request tới Node đều đi qua Nginx trên CÙNG máy — nếu không khai báo
`TRUST_PROXY`, Express sẽ thấy MỌI người dùng đều gọi từ cùng 1 địa chỉ
(`127.0.0.1`, IP của Nginx) thay vì IP thật của từng người. Hậu quả: giới hạn
đăng nhập sai/khoá tạm tài khoản và rate-limit tính GỘP CHUNG cho cả công ty
thay vì theo từng người — 1 người gõ sai mật khẩu 5 lần có thể khiến TOÀN BỘ
người dùng khác bị chặn tạm thời.

```bash
cd /opt/vpdt
nano .env
```
Bỏ dấu `#` trước dòng sau (đã có sẵn, chỉ đang comment):
```
TRUST_PROXY=1
```
Rồi khởi động lại:
```bash
pm2 restart vpdt
```

---

## 10. Khuyến nghị bảo mật + kiểm tra vận hành trước khi đưa vào sử dụng chính thức

1. **Đổi toàn bộ mật khẩu mặc định** (`123456`) ngay sau khi triển khai —
   mật khẩu đã hash nên không đọc lại được nguyên văn, nhưng giá trị mặc định
   này ai cũng biết trước, vẫn là điểm yếu nếu không đổi.
2. **Đặt `JWT_SECRET` đủ mạnh, ngẫu nhiên, và giữ bí mật** trong `.env` (mục
   6). Đây là khoá ký phiên đăng nhập — lộ khoá này coi như lộ khả năng tự
   tạo phiên đăng nhập giả mạo bất kỳ tài khoản nào mà không cần biết mật
   khẩu. Không dùng chung 1 giá trị `JWT_SECRET` giữa các môi trường
   (dev/staging/production).
3. **Giữ `COOKIE_SECURE=true`** (mặc định) — cookie phiên đăng nhập chỉ thật
   sự an toàn khi truyền qua HTTPS. Chỉ tắt (`false`) khi chạy hoàn toàn
   trong mạng nội bộ tin cậy và chấp nhận đánh đổi (xem cảnh báo ở mục 6).
4. **Đã bật `TRUST_PROXY=1`** sau khi dựng Nginx (mục 9c) — kiểm tra lại nếu
   quên, đây là lỗi hay bị bỏ sót nhất vì không gây crash/lỗi rõ ràng, chỉ
   âm thầm làm sai chức năng rate-limit.
5. **Chỉ mở port 3000/1433 trong mạng nội bộ** (đã tự động đúng nếu làm theo
   mục 9b với `ufw`) — không expose trực tiếp ra Internet nếu không có SSL +
   xác thực bổ sung.
6. **Backup định kỳ CẢ 2 nơi, không chỉ SQL Server:**
   - **Database**: `sqlcmd`/SQL Server Agent job hoặc script
     `BACKUP DATABASE VPDT_DMS TO DISK = ...` chạy cron hàng ngày.
   - **Thư mục `/opt/vpdt/uploads/`**: file đính kèm (Tài liệu, Tờ trình, Hợp
     đồng, tài liệu ký...) lưu VẬT LÝ ở đây, KHÔNG nằm trong SQL Server —
     backup riêng DB mà quên thư mục này thì phục hồi xong vẫn mất toàn bộ
     file đính kèm (chỉ còn đường dẫn trong DB trỏ tới file không còn tồn
     tại). `rsync`/`tar` định kỳ ra nơi lưu trữ khác cùng lịch với backup DB.
7. **Thử nghiệm 1 lần tình huống 2 người thao tác đồng thời** trước khi
   thông báo cho toàn công ty dùng thật — ví dụ 2 người cùng đặt trùng 1
   phòng họp/khung giờ từ 2 tài khoản gần như đồng thời: chỉ 1 yêu cầu phải
   thành công, yêu cầu còn lại báo lỗi trùng lịch rõ ràng (không phải lỗi 500
   chung chung). Hệ thống đã có cơ chế khoá ở tầng CSDL cho các trường hợp
   này nhưng nên tự xác nhận 1 lần trên đúng SQL Server thật đang dùng.

---

## 11. Kiểm tra sức khỏe hệ thống

Endpoint kiểm tra nhanh:
```
GET http://<ip-server>:3000/api/health
→ {"status":"ok","db":"connected","version":"1.15.0"}
```

`version` khớp đúng trường `version` trong `package.json` của bản code server
đang chạy — dùng để xác nhận sau khi cập nhật code (mục 12) đã áp dụng đúng
bản mới hay chưa, không cần đoán. Cùng số phiên bản này cũng hiện ở góc dưới
bên phải màn hình web (không cần đăng nhập).

Dùng cho giám sát (uptime monitor, script cron cảnh báo qua email/Zalo nếu server down).

---

## 12. Cập nhật code sau này

```bash
cd /opt/vpdt
# copy toàn bộ code mới (backend + public/index.html) đè lên, HOẶC git pull nếu deploy bằng git
npm install     # LUÔN chạy, kể cả khi không chắc package.json có đổi hay không — xem cảnh báo bên dưới
pm2 restart vpdt
pm2 status      # phải thấy "online", KHÔNG phải liên tục "restart"/"errored"
```

Vì toàn bộ dữ liệu đã nằm trong SQL Server (không còn trong trình duyệt), việc
cập nhật giao diện/code **không làm mất dữ liệu người dùng đã nhập**.

> ⚠️ **Lỗi thường gặp: web báo 502/503 sau khi cập nhật code, không truy cập
> được.** Nguyên nhân hầu hết là bỏ sót bước `npm install` — nếu code mới
> thêm gói mới trong `package.json` (`dependencies`) mà chưa cài, tiến trình
> Node sẽ báo lỗi `Cannot find module '...'` và **thoát ngay khi khởi động**,
> khiến PM2 cứ khởi động rồi crash liên tục (`pm2 status` sẽ thấy số lần
> restart tăng rất nhanh), Nginx không có gì để chuyển tiếp request tới nên
> trả về 502/503. Cách kiểm tra và khắc phục:
> ```bash
> pm2 logs vpdt --lines 50 --err   # tìm dòng "Cannot find module ..."
> cd /opt/vpdt && npm install
> pm2 restart vpdt
> ```
> Sau khi sửa, mở `GET /api/health` (mục 11) để xác nhận server đã lên và
> đúng phiên bản mới trước khi báo cho người dùng thử lại.
>
> Ngoài `npm install`, nếu bản cập nhật có ghi chú đổi cấu trúc bảng
> (`sql/schema.sql`), cũng cần chạy lại script đó trên SQL Server thật (mục
> 4 — script viết để chạy lại nhiều lần an toàn, không mất dữ liệu cũ) và
> đảm bảo file `.env` đã có đủ biến bắt buộc mới — xem `.env.example`.
