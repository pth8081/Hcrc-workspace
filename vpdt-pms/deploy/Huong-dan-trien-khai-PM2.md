# HƯỚNG DẪN TRIỂN KHAI VPDT (VĂN PHÒNG ĐIỆN TỬ) — CHỈ PM2, KHÔNG QUA NGINX
### Node.js + SQL Server (MSSQL) + PM2 (cluster mode, chạy dưới tài khoản dịch vụ riêng, do systemd quản lý)

---

## Bản này dùng khi nào?

Đây là bản triển khai **rút gọn** — ứng dụng phục vụ trực tiếp ở
`http://<ip-server>:3000`, **không có Nginx đứng trước**. Phù hợp khi:

- Chỉ dùng trong **mạng nội bộ công ty (LAN/VPN)**, không có ai truy cập từ
  Internet công khai.
- Muốn dựng nhanh, ít bước cấu hình hơn, chưa cần HTTPS/domain riêng.

**KHÔNG dùng bản này nếu** bạn cần public ứng dụng ra Internet, cần HTTPS thật
(tên miền + chứng chỉ), hoặc cần các tính năng bắt buộc phải có HTTPS (đăng
nhập vân tay/Face ID — WebAuthn, cài ứng dụng lên màn hình chính đúng chuẩn —
PWA) — chuyển sang dùng
[`Huong-dan-trien-khai-PM2-Nginx.md`](./Huong-dan-trien-khai-PM2-Nginx.md)
(cùng thư mục), có thêm lớp Nginx làm reverse proxy + HTTPS + fail2ban. 2 bản
hướng dẫn dùng chung toàn bộ phần cài đặt Node.js/SQL Server/PM2 — chỉ khác ở
việc có lớp Nginx hay không, nên có thể **chuyển từ bản này sang bản kia bất
cứ lúc nào sau này** (chỉ cần làm thêm phần Nginx, không phải dựng lại từ đầu).

---

## 0. Tổng quan kiến trúc

```
[Trình duyệt người dùng — trong mạng nội bộ/VPN công ty]
        │  HTTP thường (KHÔNG mã hoá — chỉ chấp nhận được vì cùng mạng tin cậy)
        ▼
[Ubuntu Server]
   ├─ systemd — khởi động/giám sát daemon PM2 (mục 10c), tự phục hồi sau khi
   │  reboot server hay PM2 bị crash
   ├─ PM2 (cluster mode, nhiều tiến trình Node) — chạy DƯỚI 1 tài khoản hệ
   │  thống riêng KHÔNG phải root (mục 9), phục vụ TRỰC TIẾP port 3000: giao
   │  diện + API, xác thực bằng JWT ký ở server (xem mục 6)
   └─ SQL Server (MSSQL) — port 1433 — lưu trữ dữ liệu (dbo.AppData + các bảng
      riêng theo loại hồ sơ: dbo.SystemLogs, dbo.Tasks, dbo.Docs, dbo.Contracts...)
```

**Đặc điểm kiến trúc cần biết trước khi triển khai:**

- **Xác thực hoàn toàn ở phía SERVER.** Mật khẩu lưu dạng hash (bcrypt, không
  đọc lại được nguyên văn dù có quyền truy cập CSDL trực tiếp). Đăng nhập cấp
  1 phiên qua cookie JWT httpOnly, ký bằng `JWT_SECRET` — biến này **bắt buộc
  phải có trong `.env`, server sẽ không khởi động nếu thiếu** (xem mục 6). Có
  giới hạn số lần đăng nhập sai liên tiếp + khoá tạm tài khoản.
- **Cookie phiên đăng nhập ở bản này đặt `COOKIE_SECURE=false`** (khác mặc
  định `true` của bản PM2+Nginx) — vì không có HTTPS, cookie phải cho phép
  gửi qua `http://` thường, nếu không người dùng đăng nhập xong sẽ lập tức bị
  đá về màn đăng nhập (xem chi tiết ở mục 6). Đánh đổi: phiên đăng nhập (cookie
  JWT) truyền ở dạng không mã hoá trên mạng nội bộ — **chấp nhận được CHỈ khi
  mạng đó thật sự tin cậy** (không có thiết bị lạ/khách vãng lai chung mạng).
- **Toàn bộ thao tác tạo/sửa/xoá/duyệt hồ sơ nghiệp vụ** đều được SERVER tự
  xác minh lại quyền + đúng bước quy trình trước khi ghi — không chỉ dựa vào
  ẩn/hiện nút trên giao diện.
- **Dữ liệu nghiệp vụ** (Văn bản trình, Tài liệu, Hợp đồng, Đăng ký xe, Đề
  xuất văn phòng, Công việc, Báo cáo định kỳ...) nằm trong các bảng riêng có
  khoá đúng từng dòng (`dbo.SystemLogs`, `dbo.Tasks`, và 1 bảng riêng cho mỗi
  collection nghiệp vụ khác — `dbo.Docs`, `dbo.Contracts`, `dbo.Submissions`...).
  `dbo.AppData` chỉ còn giữ dữ liệu cấu hình (người dùng, phân quyền, quy
  trình mẫu, cấu hình email...). `schema.sql` (mục 4) tạo sẵn đầy đủ các bảng
  này — **không cần chạy tay thêm gì khác, không cần seed dữ liệu tay**, ứng
  dụng tự seed dữ liệu mặc định khi khởi động lần đầu (mục 8).
- **Tiến trình Node.js chạy dưới 1 tài khoản hệ thống riêng, không phải
  root** (mục 9) — kể cả nếu có lỗ hổng chưa biết trong ứng dụng/1 gói npm bị
  khai thác được, kẻ tấn công cũng chỉ có quyền của tài khoản giới hạn đó,
  không có quyền toàn hệ thống. `.env` (chứa `JWT_SECRET`, mật khẩu SQL
  Server...) chỉ tài khoản đó đọc được (`chmod 600`).

**Thứ tự đọc hướng dẫn này:** mục 1-8 là dựng lần đầu (cài đặt, cấu hình, chạy
thử bằng chính tài khoản bạn đang đăng nhập). Mục 9-10 chuyển sang chạy
production thật (tài khoản dịch vụ riêng + PM2 cluster + systemd). Mục 11 là
tổng kết bảo mật + giới hạn tải hệ thống, áp dụng cho track không-Nginx này.
Mục 12-13 dùng lâu dài sau khi đã lên production (kiểm tra sức khỏe, quy trình
cập nhật code).

### Mục lục

- [0. Tổng quan kiến trúc](#0-tổng-quan-kiến-trúc)
- [1. Cài đặt Node.js trên Ubuntu](#1-cài-đặt-nodejs-trên-ubuntu)
- [2. Cài đặt SQL Server (MSSQL) trên Ubuntu](#2-cài-đặt-sql-server-mssql-trên-ubuntu)
- [3. Chuẩn bị thư mục ứng dụng trên Ubuntu](#3-chuẩn-bị-thư-mục-ứng-dụng-trên-ubuntu)
- [4. Tạo Database và bảng dữ liệu](#4-tạo-database-và-bảng-dữ-liệu)
- [5. Kiểm tra kết nối SQL Server trước khi cấu hình ứng dụng](#5-kiểm-tra-kết-nối-sql-server-trước-khi-cấu-hình-ứng-dụng)
- [6. Cấu hình kết nối SQL Server + xác thực đăng nhập](#6-cấu-hình-kết-nối-sql-server--xác-thực-đăng-nhập)
- [7. Cấu hình gửi email thật (SMTP)](#7-cấu-hình-gửi-email-thật-smtp)
- [8. Chạy thử (kiểm tra trước khi đưa vào production)](#8-chạy-thử-kiểm-tra-trước-khi-đưa-vào-production)
- [9. Tạo tài khoản hệ thống riêng chạy ứng dụng](#9-tạo-tài-khoản-hệ-thống-riêng-chạy-ứng-dụng-nguyên-tắc-least-privilege)
- [10. Chạy production ổn định bằng PM2 (cluster mode)](#10-chạy-production-ổn-định-bằng-pm2-cluster-mode-dưới-tài-khoản-dịch-vụ--systemd)
- [11. Tình trạng bảo mật hiện tại và các việc cần làm](#11-tình-trạng-bảo-mật-hiện-tại-và-các-việc-cần-làm)
- [12. Kiểm tra sức khỏe hệ thống](#12-kiểm-tra-sức-khỏe-hệ-thống)
- [13. Cập nhật code sau này](#13-cập-nhật-code-sau-này)

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

Làm bằng chính tài khoản bạn đang đăng nhập để dựng máy chủ (ví dụ tài khoản
admin có quyền `sudo`) — **CHƯA cần** tài khoản dịch vụ riêng ở bước này,
việc đó chuyển quyền sở hữu thư mục ở mục 9 sau khi đã chạy thử xong (mục 8):

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
cảnh báo tương tự ở mục 13 cho các lần cập nhật code sau này).

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
- Tạo `dbo.SystemLogs`, `dbo.Tasks`, và 1 bảng riêng cho mỗi collection nghiệp
  vụ khác (dữ liệu hồ sơ nghiệp vụ — mỗi bản ghi 1 dòng riêng, xem ghi chú
  kiến trúc ở mục 0)

Dữ liệu mặc định (phòng ban, user admin, quy trình mẫu...) sẽ được **tự động
seed khi server Node.js khởi động lần đầu** (mục 8) — không cần chạy tay.

---

## 5. Kiểm tra kết nối SQL Server trước khi cấu hình ứng dụng

```bash
sqlcmd -S localhost -U sa -P 'Your_Strong_Password_Here' -Q "SELECT name FROM sys.databases;"
```

Phải thấy `VPDT_DMS` trong danh sách trả về. Nếu lỗi kết nối ở bước này, xử
lý dứt điểm trước khi sang mục 6 — mọi lỗi kết nối DB sau này (mục 8, mục 10)
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
cần thiết). **Khác với `.env.example` mặc định (vốn nhắm bản PM2+Nginx),
track này đặt `COOKIE_SECURE=false`:**

```
PORT=3000

# --- Xác thực đăng nhập (BẮT BUỘC — server sẽ không khởi động nếu thiếu JWT_SECRET) ---
JWT_SECRET=change-me-to-a-long-random-string
COOKIE_SECURE=false

# --- Kết nối SQL Server ---
DB_SERVER=localhost          # hoặc IP máy chủ SQL Server nếu chạy riêng (Lựa chọn C ở mục 2)
DB_PORT=1433
DB_NAME=VPDT_DMS
DB_USER=sa
DB_PASSWORD=Your_Strong_Password_Here
DB_ENCRYPT=false
DB_TRUST_CERT=true
```

> ⚠️ `DB_ENCRYPT=false` chỉ chấp nhận được khi SQL Server và server ứng dụng cùng nằm trong 1 phân
> đoạn mạng tin cậy duy nhất (không đi qua firewall/router trung gian nào, kể cả nội bộ) — server sẽ
> in cảnh báo lúc khởi động nếu vẫn để `false`. Đổi thành `true` ngay khi kiến trúc có server DB/app
> tách riêng (khác máy, khác VLAN, đi qua firewall dù vẫn trong mạng công ty) — xem hướng dẫn bật tại
> mục 11.4.

Tạo `JWT_SECRET` bằng lệnh:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Đây là khoá ký phiên đăng nhập (JWT) — **PHẢI là chuỗi ngẫu nhiên dài, giữ
kín, và khác nhau giữa các môi trường** (dev/staging/production). Đổi giá trị
này sẽ khiến mọi phiên đăng nhập đang mở bị đăng xuất (không sao, chỉ cần
đăng nhập lại) — hữu ích nếu nghi ngờ khoá đã lộ.

> ⚠️ **Vì sao `COOKIE_SECURE=false` ở bản này**: bản `.env.example` mặc định
> đặt `true` (bắt buộc HTTPS) vì hướng dẫn gốc đi qua Nginx + HTTPS. Track
> KHÔNG-Nginx này phục vụ trực tiếp qua `http://<ip>:3000` — nếu để nguyên
> `true`, trình duyệt sẽ không lưu lại cookie phiên đăng nhập và người dùng
> **không đăng nhập được dù nhập đúng mật khẩu** (vào được màn chính rồi lập
> tức bị đá về màn đăng nhập, không có thông báo lỗi rõ ràng). Nếu sau này
> bạn thêm HTTPS bằng cách khác (ví dụ 1 load balancer/reverse proxy khác
> ngoài Nginx đã tự có sẵn), đổi lại `true` và test kỹ trước khi báo cho người
> dùng — xem thêm điều kiện đủ ở mục 11.

> ⚠️ Không commit file `.env` lên Git — chứa mật khẩu SQL Server và khoá
> `JWT_SECRET`. Từ mục 9 trở đi, file này còn được khoá quyền đọc ở tầng hệ
> điều hành (`chmod 600`, chỉ tài khoản dịch vụ riêng đọc được) — 1 lớp
> phòng thủ bổ sung, không thay thế việc không commit lên Git.

**Bỏ qua `TRUST_PROXY` và `ALLOWED_ORIGINS`** — 2 biến này chỉ cần thiết khi
có 1 lớp reverse proxy đứng trước Node (Nginx hoặc tương tự); track này Node
nhận request trực tiếp nên KHÔNG khai báo `TRUST_PROXY` (để `.env.example`
comment sẵn, không bỏ dấu `#`) — bật nhầm ở đây sẽ khiến Express tin sai địa
chỉ IP người dùng do client tự khai (`X-Forwarded-For` giả mạo được nếu không
có proxy thật đứng giữa lọc lại), làm suy yếu giới hạn đăng nhập sai theo IP.

Các biến khác trong `.env.example` (`DB_POOL_*`, `APPDATA_CACHE_TTL_MS`) đều
có giá trị mặc định hợp lý — chỉ cần điền khi bạn thực sự cần chỉnh khác mặc
định, xem chú thích trong chính file `.env.example` và mục 11.3.

---

## 7. Cấu hình gửi email thật (SMTP)

Toàn bộ cấu hình — kể cả tài khoản/mật khẩu đăng nhập SMTP — nay cấu hình được **trực tiếp trên web**
tại màn **Quản trị > Cấu Hình Email**, không cần đụng `.env` hay khởi động lại server. Mật khẩu SMTP
được mã hoá 2 chiều trước khi lưu vào CSDL bằng khoá `EMAIL_ENCRYPTION_KEY` trong `.env`:

```
EMAIL_ENCRYPTION_KEY=<chuỗi ngẫu nhiên dài, tạo bằng lệnh bên dưới>
```
Tạo nhanh: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Đặt biến này
**trước khi** cấu hình mật khẩu SMTP qua web lần đầu — nếu bạn chỉ dùng máy chủ SMTP không yêu cầu
xác thực, hoặc vẫn muốn giữ tài khoản trong `.env` (đường lùi cũ, xem bên dưới), có thể bỏ qua biến
này.

Màn Cấu Hình Email có **3 nút Mã Hoá** (Không mã hoá/TLS/SSL) tương ứng port chuẩn 25/587/465 — bấm 1
nút sẽ tự đổi Port sang giá trị chuẩn (trừ khi Port đang là 1 giá trị tuỳ chỉnh khác). Có nút
**"Gửi Thử"** ngay trên form để xác minh cấu hình đúng trước khi Lưu, không cần dò log server.

Mặc định hệ thống chỉ **mô phỏng** gửi email (ghi vào Nhật ký hệ thống, không gửi thật) cho tới khi
nhập SMTP Server ở màn này.

**Trường hợp 1 — Gmail (cần xác thực):** vào **Quản trị > Cấu Hình Email**, điền
`SMTP Server = smtp.gmail.com`, `Port = 587`, chọn nút mã hoá **TLS**, bật "Máy chủ SMTP yêu cầu xác
thực" rồi điền Tài khoản = email Gmail, Mật khẩu = "Mật khẩu ứng dụng" (App Password) tạo tại
`https://myaccount.google.com/apppasswords` (Google đã chặn đăng nhập SMTP bằng mật khẩu thường).

**Trường hợp 2 — mail relay nội bộ công ty (KHÔNG cần xác thực):** điền Host/Port/Email người gửi
thật của relay, KHÔNG bật "Máy chủ SMTP yêu cầu xác thực". Nếu relay dùng chứng chỉ TLS tự ký
(self-signed), thêm trong `.env`:
```
SMTP_TLS_REJECT_UNAUTHORIZED=false
```

**Đường lùi `.env` (`SMTP_USER`/`SMTP_PASS`):** chỉ dành cho máy chủ đã deploy từ trước khi có tính
năng cấu hình tài khoản trên web — nếu màn Cấu Hình Email chưa lưu tài khoản nào (chưa bật "Máy chủ
SMTP yêu cầu xác thực"), hệ thống tự dùng `SMTP_USER`/`SMTP_PASS` trong `.env` nếu có. Không bắt buộc
cho cài đặt mới.

> ⚠️ Sau khi sửa `.env` (`EMAIL_ENCRYPTION_KEY`/`SMTP_USER`/`SMTP_PASS`/`SMTP_TLS_REJECT_UNAUTHORIZED`),
> cần khởi động lại server (mục 10 sau khi đã lên production — `sudo -u vpdt-app pm2 restart vpdt`, xem
> mục 10d) để áp dụng. Mọi thay đổi trên màn Cấu Hình Email (Host/Port/Mã hoá/Tài khoản SMTP/Email
> người gửi/Bật-tắt) thì KHÔNG cần khởi động lại.

---

## 8. Chạy thử (kiểm tra trước khi đưa vào production)

Vẫn chạy bằng tài khoản hiện tại của bạn (chưa cần tài khoản dịch vụ riêng —
việc đó ở mục 9, làm NGAY SAU bước này):

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
xem lại `COOKIE_SECURE` ở mục 6 — phải là `false` ở track này.

Mật khẩu các tài khoản mặc định được lưu **đã băm bằng bcrypt** (không phải
plain-text). Server tự động phát hiện tài khoản nào còn dùng mật khẩu mặc định
`123456` và **bắt buộc đổi mật khẩu ngay lần đăng nhập đầu tiên** (màn hình
đổi mật khẩu hiện ra, không thể bỏ qua) — không cần bạn phải nhớ tự đổi thủ
công, nhưng vẫn nên đổi ngay khi đưa vào sử dụng thật cho đúng người dùng thật.

**Dừng lại (Ctrl+C) sau khi xác nhận chạy được** — bước này chỉ để kiểm tra
nhanh bằng tài khoản hiện tại. Chuyển ngay sang mục 9 để tạo tài khoản dịch
vụ riêng trước khi chạy production thật (mục 10) — KHÔNG chạy production
bằng lệnh `npm start`/`node server.js` thủ công như trên (tiến trình chết
ngay khi bạn đóng phiên SSH, và đang chạy bằng tài khoản cá nhân/root thay vì
tài khoản giới hạn quyền).

---

## 9. Tạo tài khoản hệ thống riêng chạy ứng dụng (nguyên tắc least privilege)

**Vì sao cần bước này:** chạy ứng dụng bằng tài khoản `root` hoặc tài khoản
cá nhân của admin (có quyền `sudo`/mật khẩu đăng nhập SSH) nghĩa là bất kỳ
lỗ hổng nào trong ứng dụng hoặc trong 1 gói npm phụ thuộc (kể cả gói bên thứ
3 chưa từng biết có lỗi) đều có thể bị khai thác để chiếm TOÀN QUYỀN máy chủ.
Tạo riêng 1 tài khoản hệ thống (system account) **không có mật khẩu đăng
nhập, không cho SSH/đăng nhập trực tiếp**, chỉ dùng để chạy đúng 1 việc là
tiến trình Node của ứng dụng — giới hạn thiệt hại nếu ứng dụng bị khai thác
xuống đúng phạm vi tài khoản đó (đọc/ghi được `uploads/`, kết nối được SQL
Server bằng thông tin trong `.env`, **không** đọc được file của tài khoản
khác, **không** có quyền `sudo`, **không** cài/sửa được phần mềm hệ thống).

### 9a. Tạo tài khoản

```bash
sudo useradd --system --no-create-home --home-dir /opt/vpdt \
  --shell /usr/sbin/nologin vpdt-app
```

Giải thích từng phần:
- `--system`: tài khoản hệ thống (UID thấp, không hiện trong màn đăng nhập
  đồ hoạ nếu có, đúng quy ước cho tài khoản chạy dịch vụ).
- `--no-create-home --home-dir /opt/vpdt`: **không** tạo 1 thư mục home riêng
  biệt (vd `/home/vpdt-app`) — trỏ thẳng "home" của tài khoản này vào ĐÚNG
  thư mục ứng dụng đã có sẵn (`/opt/vpdt`, mục 3). Lý do kỹ thuật quan trọng:
  PM2 lưu trạng thái/log của nó vào `$HOME/.pm2` — trỏ home vào `/opt/vpdt`
  nghĩa là mọi thao tác `sudo -u vpdt-app pm2 ...` sau này tự động dùng đúng
  `/opt/vpdt/.pm2` mà **không cần khai báo thêm biến môi trường `PM2_HOME`
  nào** (đã tự kiểm chứng: nếu dùng `--no-create-home` mà KHÔNG trỏ `--home-dir`
  vào đây, PM2 sẽ báo lỗi `ENOENT` ngay lần chạy đầu vì thư mục home mặc định
  `/home/vpdt-app` không hề tồn tại).
- `--shell /usr/sbin/nologin`: chặn đăng nhập tương tác (SSH/`su - vpdt-app`)
  bằng tài khoản này — không ai cần gõ lệnh trực tiếp với danh nghĩa
  `vpdt-app`, mọi thao tác quản trị vẫn thực hiện qua `sudo -u vpdt-app <lệnh>`
  (chạy ĐÚNG 1 lệnh chỉ định, không mở shell tương tác nên `nologin` không
  cản trở — đã kiểm chứng thực tế, xem mục 10d).

Kiểm tra đã tạo đúng:
```bash
id vpdt-app
getent passwd vpdt-app     # cột home phải là /opt/vpdt, cột shell là nologin
```

### 9b. Chuyển quyền sở hữu thư mục ứng dụng + khoá `.env`

```bash
sudo chown -R vpdt-app:vpdt-app /opt/vpdt
sudo chmod 750 /opt/vpdt
sudo chmod 600 /opt/vpdt/.env
```

- `chown -R ... /opt/vpdt`: toàn bộ thư mục ứng dụng (mã nguồn, `node_modules/`,
  `uploads/`, các file cấu hình...) đổi sang thuộc sở hữu `vpdt-app` — tiến
  trình Node chạy dưới tài khoản này đọc/ghi bình thường (`uploads/` khi
  người dùng tải file lên, PM2 ghi log/trạng thái vào `.pm2/` sẽ tự tạo dưới
  đây, xem mục 9a), **tài khoản cá nhân của bạn (hay bất kỳ tài khoản nào
  khác trên máy) không còn đọc/ghi được các file này nữa**.
- `chmod 750 /opt/vpdt`: chủ sở hữu (`vpdt-app`) toàn quyền, nhóm cùng tên
  (mặc định chỉ có đúng `vpdt-app` là thành viên) chỉ đọc + duyệt thư mục,
  người khác (kể cả tài khoản admin của bạn) **không có quyền gì** — kể cả
  không liệt kê được tên file bên trong.
- `chmod 600 /opt/vpdt/.env`: khoá riêng thêm 1 lớp cho đúng file chứa bí
  mật (`JWT_SECRET`, mật khẩu SQL Server, `EMAIL_ENCRYPTION_KEY`...) — CHỈ
  chủ sở hữu (`vpdt-app`) đọc/ghi được, **kể cả thành viên nhóm `vpdt-app`
  cũng không đọc được** (khác với `750` ở thư mục cha, vốn còn cho nhóm
  quyền đọc/duyệt) — đúng nguyên tắc "khoá chặt nhất cho đúng file nhạy cảm
  nhất", các file mã nguồn còn lại không cần khắt khe bằng.

**Đã rà lại, không có file/thư mục nào trong repo cần quyền rộng hơn mức
trên:** `uploads/` chỉ do đúng 1 tiến trình (ứng dụng, chạy dưới `vpdt-app`)
ghi vào — không có tiến trình/tài khoản nào khác trên máy cần ghi trực tiếp
vào đây, nên không cần bật thêm bit "group-writable"/`770` như một số hướng
dẫn chung chung hay làm. PM2 tự ghi log vào `/opt/vpdt/.pm2/logs/` (dưới
quyền `vpdt-app`, đã bao phủ bởi `chown -R` ở trên) — ứng dụng không tự ghi
ra file log riêng nào khác ở đường dẫn cứng nào (xem `server.js`/`db.js`:
mọi đường dẫn dùng `path.join(__dirname, ...)` tương đối theo thư mục cài
đặt, không giả định chạy dưới `root` hay dưới bất kỳ tài khoản cụ thể nào).

**Từ đây trở đi, để xem/sửa `.env` hoặc các file khác trong `/opt/vpdt`,
tài khoản cá nhân của bạn phải dùng `sudo`** (ví dụ `sudo nano /opt/vpdt/.env`
hoặc `sudo -u vpdt-app cat /opt/vpdt/.env`) — không còn mở trực tiếp bằng
tài khoản thường được nữa, đây là kết quả ĐÚNG NHƯ MONG MUỐN của bước khoá
quyền này.

> 💡 **Tuỳ chọn — cho phép 1 tài khoản admin cụ thể ĐỌC (không ghi) thư mục
> ứng dụng để chạy script backup mà không cần `sudo` mỗi lần** (mục 11.2 mục
> 7, backup `uploads/`): `sudo usermod -aG vpdt-app <tên-tài-khoản-admin>`
> rồi đăng nhập lại phiên đó. Nhóm `vpdt-app` chỉ có quyền **đọc + duyệt**
> thư mục (`750`, không có quyền ghi) và **vẫn không đọc được `.env`** (`600`,
> chỉ đúng chủ sở hữu) — an toàn để cấp cho 1 tài khoản backup tin cậy mà
> không nới lỏng quyền ghi hay lộ bí mật trong `.env`. Không bắt buộc, bỏ qua
> nếu bạn luôn chạy backup bằng `root`/`sudo` (root đọc được mọi file bất kể
> quyền, xem mục 11.2 mục 7).

---

## 10. Chạy production ổn định bằng PM2 (cluster mode) dưới tài khoản dịch vụ + systemd

### 10a. Cài PM2 (1 lần, dùng tài khoản admin/`sudo` của bạn)

```bash
sudo npm install -g pm2
pm2 --version
```

Cài `-g` (global) nên chỉ cần làm 1 lần — bin `pm2` dùng chung được cho mọi
tài khoản trên máy, kể cả `vpdt-app` (đã kiểm chứng thực tế: gọi qua
`sudo -u vpdt-app pm2 ...` chạy đúng, không cần cài lại riêng cho tài khoản
đó).

### 10b. Khởi động ứng dụng bằng cluster mode, chạy dưới tài khoản `vpdt-app`

```bash
cd /opt/vpdt
sudo -u vpdt-app pm2 start ecosystem.config.js --env production
```

`ecosystem.config.js` (có sẵn trong repo) chạy `exec_mode: 'cluster'`,
`instances: 'max'` — PM2 tự chạy đúng bằng số nhân CPU thật của máy. Node là
đơn luồng cho JS (1 tiến trình chỉ dùng được 1 nhân CPU) — chạy nhiều tiến
trình cùng lúc tận dụng hết phần cứng. Ứng dụng đã thiết kế stateless giữa
các request (xác thực qua JWT + tra DB, không giữ session trong bộ nhớ tiến
trình) nên chạy nhiều tiến trình an toàn.

**Về SỐ LƯỢNG tiến trình (`instances`) — dựa trên load test THẬT, không phải
ước đoán** (chi tiết đầy đủ + số liệu đo ở mục 11.3): load test k6 thật với
500 người dùng đồng thời cho thấy **`instances: 'max'` (mặc định trong
`ecosystem.config.js`) đạt p95 30ms, 0% lỗi**, trong khi chạy 1 tiến trình
đơn (không qua cluster mode) ở CÙNG mức tải chậm rõ rệt (p95 27 giây) dù vẫn
không lỗi. Vì vậy:
- Máy chủ dành riêng cho ứng dụng này (không chạy chung SQL Server/dịch vụ
  nặng khác trên cùng máy): giữ nguyên `instances: 'max'`.
- Máy chủ dùng CHUNG với SQL Server hoặc dịch vụ khác cũng cần CPU: đổi
  `instances: 'max'` trong `ecosystem.config.js` thành 1 số cụ thể (vd `2`
  hoặc `4`), chừa lại nhân CPU cho các dịch vụ khác — tham khảo số nhân CPU
  còn trống thực tế bằng `nproc`.
- Dưới ~100 người dùng đồng thời: cluster mode vẫn dùng tốt và là mặc định
  của hướng dẫn này, nhưng không bắt buộc — 1 tiến trình đơn vẫn đủ nếu bạn
  muốn đơn giản hoá (đổi `exec_mode`/`instances` trong `ecosystem.config.js`,
  hoặc dùng thẳng `sudo -u vpdt-app pm2 start server.js --name vpdt`).

**⚠️ Lưu ý pool kết nối SQL Server khi chạy nhiều tiến trình**: mỗi tiến
trình giữ 1 pool kết nối RIÊNG (mặc định tối đa 20 — `DB_POOL_MAX` trong
`.env`, xem mục 6). Chạy 4 tiến trình × 20 = tối đa 80 kết nối đồng thời tới
SQL Server — kiểm tra SQL Server (RAM/CPU/giới hạn kết nối theo license, đặc
biệt nếu dùng bản Express có giới hạn) có đủ sức chịu; nếu không, hạ
`DB_POOL_MAX` xuống (vd. 10) để tổng kết nối across mọi tiến trình ở mức hợp
lý.

**Job định kỳ (nhắc hết hạn hợp đồng/giấy phép/gia hạn dịch vụ IT, giám sát ổ
đĩa — `server.js`) tự nhận biết chỉ chạy ở ĐÚNG 1 trong số các tiến trình
cluster** (tiến trình instance 0, dựa vào biến `NODE_APP_INSTANCE` PM2 tự
gán cho từng tiến trình — không phải bạn tự đặt tay biến này ở đâu cả) —
không bị gửi email nhắc hạn/cảnh báo trùng lặp N lần theo số tiến trình đang
chạy. Đây là hành vi ĐÚNG THIẾT KẾ — nếu chạy `pm2 status` thấy N dòng tiến
trình `vpdt` nhưng chỉ 1 dòng log job định kỳ mỗi ngày/mỗi giờ, đó không phải
lỗi.

### 10c. Đăng ký PM2 làm dịch vụ systemd — sống sót qua reboot server + phiên SSH đóng

Đây là bước khiến ứng dụng thật sự chạy như "1 dịch vụ hệ thống" thay vì "1
tiến trình chạy tay trong phiên terminal" — nếu bỏ qua bước này, PM2 (và ứng
dụng bên trong) vẫn SỐNG khi bạn đóng phiên SSH (đúng là điểm mạnh sẵn có của
PM2), nhưng sẽ **KHÔNG tự khởi động lại nếu server reboot** (mất điện, bảo
trì, `sudo reboot`...).

```bash
sudo env PATH=$PATH:$(dirname "$(which node)") pm2 startup systemd \
  -u vpdt-app --hp /opt/vpdt
```

Lệnh trên **tự phát hiện `systemd`** đang chạy trên máy và in ra **đúng 1
dòng lệnh khác** bắt đầu bằng `sudo env PATH=...` — copy **ĐÚNG NGUYÊN VĂN
dòng lệnh đó** (không phải dòng bạn vừa gõ) rồi chạy lại — đây là hành vi
chuẩn của PM2 (tự thấy đang không đủ quyền ghi vào `/etc/systemd/system/`
theo đúng ngữ cảnh user/home bạn chỉ định, nên chỉ in sẵn lệnh có quyền `root`
đầy đủ để bạn xác nhận rồi tự chạy, thay vì tự ý chạy ngầm). Lệnh này tạo
file dịch vụ systemd tên `pm2-vpdt-app` (theo quy ước `pm2-<tài khoản>`),
kích hoạt `systemctl enable` để tự khởi động cùng server.

> Đã tự kiểm chứng đúng cú pháp trên với PM2 phiên bản `7.0.3` (`pm2 --version`)
> — nếu máy chủ thật của bạn cài bản PM2 khác, chạy `pm2 startup --help` để
> xác nhận lại cú pháp trước khi copy lệnh ở trên (cú pháp `pm2 startup
> systemd -u <user> --hp <thư mục home>` đã ổn định qua nhiều bản PM2 gần
> đây, nhưng vẫn nên tự xác nhận trên đúng bản cài thật).

Sau khi chạy xong lệnh được in ra, **lưu lại danh sách tiến trình đang chạy**
— đây là bước DỄ QUÊN NHẤT và QUAN TRỌNG NHẤT, vì file dịch vụ systemd vừa
tạo chỉ làm 1 việc khi server khởi động lại: chạy `pm2 resurrect` để phục
hồi ĐÚNG danh sách tiến trình đã lưu gần nhất bằng lệnh dưới đây — bỏ qua
bước này thì sau khi reboot, PM2 daemon có chạy nhưng KHÔNG có tiến trình
`vpdt` nào cả (danh sách rỗng):

```bash
sudo -u vpdt-app pm2 save
```

Xác nhận dịch vụ đã đăng ký và đang chạy:

```bash
sudo systemctl status pm2-vpdt-app --no-pager
```

Phải thấy `Active: active (running)` và `enabled` (tự khởi động cùng
server). Muốn kiểm tra thật sự sống sót qua reboot, có thể thử ngay
`sudo reboot` sau khi hoàn tất, chờ máy lên lại rồi `pm2 status` (xem mục
10d) — không bắt buộc nhưng là cách xác nhận chắc chắn nhất.

### 10d. Các lệnh quản lý thường dùng

Từ đây, ứng dụng chạy dưới tài khoản `vpdt-app` — mọi lệnh `pm2` thao tác
trên đúng tiến trình ứng dụng đều cần chạy **với danh nghĩa tài khoản đó**
(`sudo -u vpdt-app pm2 ...`), KHÔNG còn gõ thẳng `pm2 ...` bằng tài khoản cá
nhân của bạn nữa (tài khoản cá nhân không có quyền đọc `/opt/vpdt/.pm2/`,
xem mục 9b, nên sẽ tự khởi tạo 1 daemon PM2 KHÁC hoàn toàn không liên quan
nếu gõ nhầm):

```bash
sudo -u vpdt-app pm2 status       # xem trạng thái (cluster mode sẽ thấy nhiều dòng "vpdt" — mỗi dòng 1 tiến trình)
sudo -u vpdt-app pm2 logs vpdt    # xem log realtime
sudo -u vpdt-app pm2 restart vpdt # khởi động lại sau khi cập nhật code (mục 13) — có gián đoạn ngắn
sudo -u vpdt-app pm2 reload vpdt  # tương tự restart nhưng KHÔNG gián đoạn ở cluster mode (lần lượt từng tiến trình)
sudo -u vpdt-app pm2 stop vpdt
```

**Phân biệt 2 tầng quản lý (dễ nhầm):**
- `sudo -u vpdt-app pm2 restart|reload|stop vpdt` → thao tác ở tầng ỨNG DỤNG
  (đúng lệnh dùng cho việc thường ngày: cập nhật code xong thì restart/reload,
  xem mục 13).
- `sudo systemctl status|restart pm2-vpdt-app` → thao tác ở tầng DAEMON PM2
  (hiếm khi cần) — chỉ dùng khi nghi ngờ chính daemon PM2 có vấn đề (không
  phải ứng dụng bên trong), ví dụ sau khi nâng cấp bản PM2. `systemctl
  restart` tầng này chạy lại `pm2 resurrect` (phục hồi từ `pm2 save` gần
  nhất) — nếu bạn vừa `pm2 restart vpdt` ở tầng ứng dụng mà KHÔNG đổi số
  lượng/tên tiến trình đang chạy thì KHÔNG cần `pm2 save` lại (danh sách
  "những app nào đang chạy" không đổi) — chỉ cần `pm2 save` lại khi bạn
  THÊM/BỚT hẳn 1 app khỏi PM2 (khác với restart/reload 1 app đã có).

---

## 11. Tình trạng bảo mật hiện tại và các việc cần làm

### 11.1. Đã hoàn thiện ở tầng ứng dụng/server

- **Xác thực phía server**: đăng nhập kiểm tra mật khẩu bằng bcrypt, phát
  cookie phiên JWT `httpOnly` — không còn so sánh mật khẩu ở JS trình duyệt.
  Mọi API nghiệp vụ đều bắt buộc có phiên hợp lệ, server tự kiểm tra lại
  quyền/trạng thái tài khoản (đã bị vô hiệu hoá hay chưa) trên **mỗi request**
  chứ không chỉ tin nội dung JWT.
- **Chống dò mật khẩu**: giới hạn số lần đăng nhập sai theo IP (chặn 15 phút
  nếu vượt ngưỡng) **và** khoá riêng theo từng tài khoản sau 5 lần sai liên
  tiếp — 2 lớp độc lập. Vì track này Node nhận request TRỰC TIẾP (không qua
  reverse proxy), `req.ip` của Express đã là địa chỉ thật của người dùng ngay
  từ đầu — **không cần** cấu hình `TRUST_PROXY` như bản PM2+Nginx.
- **Chính sách mật khẩu**: mật khẩu mới (khi admin tạo/đặt lại) phải tối
  thiểu 8 ký tự, không nằm trong danh sách mật khẩu phổ biến/dễ đoán. Tài
  khoản còn dùng mật khẩu mặc định `123456` bị tự động đánh dấu **bắt buộc
  đổi mật khẩu ngay lần đăng nhập kế tiếp**, chặn ở cả giao diện lẫn server
  (không thể bỏ qua bằng cách sửa code phía trình duyệt).
- **HTTP security headers**: đã bật CSP, `X-Frame-Options`, `X-Content-Type-Options`,
  ẩn `X-Powered-By`, ... (xem `server/lib/securityHeaders.js`) — riêng HSTS
  không có tác dụng ở track này vì không có HTTPS.
- **Chống xung đột dữ liệu (race condition)**: các thao tác lưu dùng optimistic
  concurrency (If-Match/409) hoặc khoá dòng (`WITH UPDLOCK, HOLDLOCK`) cho các
  thao tác cần cộng dồn/append an toàn (ví dụ nhật ký hệ thống).
- **Connection pool** đã tinh chỉnh để chịu tải tốt hơn (xem mục 6, biến
  `DB_POOL_*` trong `.env.example`).
- **Chạy dưới tài khoản hệ thống riêng, không phải `root`**, quyền thư mục/
  `.env` đã khoá theo nguyên tắc least privilege (mục 9), do systemd quản lý
  vòng đời (mục 10c).

### 11.2. Việc bạn cần tự làm khi triển khai

1. Đặt `JWT_SECRET` là chuỗi ngẫu nhiên dài, **khác nhau giữa các môi trường**
   (mục 6) — không dùng lại giá trị mẫu trong `.env.example`.
2. **BẮT BUỘC chỉ chạy trong mạng nội bộ tin cậy (LAN/VPN công ty)** — track
   này không có HTTPS, cookie phiên đăng nhập truyền dạng cleartext. **Không
   public port 3000 ra Internet** dưới bất kỳ hình thức nào (kể cả port-forward
   trên router). Nếu công ty cần truy cập từ ngoài (nhân viên làm việc từ xa,
   chi nhánh khác không đi qua VPN...), dùng VPN riêng để đưa họ "vào" mạng
   nội bộ trước, hoặc chuyển sang
   [`Huong-dan-trien-khai-PM2-Nginx.md`](./Huong-dan-trien-khai-PM2-Nginx.md)
   để có HTTPS thật.
3. **Đổi mật khẩu tài khoản mặc định** cho đúng người dùng thật ngay sau khi
   triển khai (hệ thống sẽ tự bắt buộc đổi ở lần đăng nhập đầu, xem mục 8,
   nhưng vẫn nên chủ động rà lại danh sách tài khoản trước khi đưa vào dùng
   thật).
4. **Tạo tài khoản hệ thống riêng chạy ứng dụng + khoá quyền thư mục/`.env`**
   (mục 9) — không chạy production bằng `root` hay tài khoản cá nhân của
   admin, kể cả khi chỉ dùng nội bộ.
5. **Backup định kỳ CẢ 2 nơi, không chỉ SQL Server:**
   - **Database**: `sqlcmd`/SQL Server Agent job hoặc script
     `BACKUP DATABASE VPDT_DMS TO DISK = ...` chạy cron hàng ngày.
   - **Thư mục `/opt/vpdt/uploads/`**: file đính kèm (Tài liệu, Tờ trình, Hợp
     đồng, tài liệu ký...) lưu VẬT LÝ ở đây, KHÔNG nằm trong SQL Server —
     backup riêng DB mà quên thư mục này thì phục hồi xong vẫn mất toàn bộ
     file đính kèm (chỉ còn đường dẫn trong DB trỏ tới file không còn tồn
     tại). `rsync`/`tar` định kỳ ra nơi lưu trữ khác cùng lịch với backup DB
     — chạy bằng `root`/cron hệ thống thì không bị chặn bởi quyền thư mục đã
     khoá ở mục 9 (root đọc được mọi file bất kể chủ sở hữu); nếu muốn chạy
     bằng 1 tài khoản backup riêng không phải root, xem gợi ý cấp quyền đọc
     qua nhóm `vpdt-app` ở cuối mục 9b.
6. **Thử nghiệm 1 lần tình huống 2 người thao tác đồng thời** trước khi
   thông báo cho toàn công ty dùng thật — ví dụ 2 người cùng đặt trùng 1
   phòng họp/khung giờ từ 2 tài khoản gần như đồng thời: chỉ 1 yêu cầu phải
   thành công, yêu cầu còn lại báo lỗi trùng lịch rõ ràng (không phải lỗi 500
   chung chung). Hệ thống đã có cơ chế khoá ở tầng CSDL cho các trường hợp
   này nhưng nên tự xác nhận 1 lần trên đúng SQL Server thật đang dùng.

### 11.3. Giới hạn kiến trúc + kết quả load test khi mở rộng quy mô người dùng

Thiết kế lưu trữ ban đầu (port thẳng từ `localStorage`) dồn TOÀN BỘ collection
vào 1 bản ghi JSON duy nhất trong `dbo.AppData`. Từ "Bước 6" trở đi, các
collection tăng trưởng nhanh/hay ghi nhiều nhất đã được TÁCH sang bảng riêng,
mỗi bản ghi = 1 dòng thật (khoá đúng 1 dòng thay vì cả collection khi ghi) —
xem chi tiết ở đầu `server/sql/schema.sql`:

- `dbo.SystemLogs` — nhật ký hệ thống
- `dbo.Tasks` — Công việc
- Mỗi collection nghiệp vụ còn lại (submissions/docs/carRegs/officeReqs/
  contracts/meetings/meetingMinutes/internalPosts/paymentRequests/
  vppPeriods/vppRegistrations/reportPeriods/reportEntries + ~40 collection
  khác) đều có BẢNG RIÊNG (`dbo.Docs`, `dbo.Contracts`, `dbo.Submissions`...
  xem `DEDICATED_TABLES` ở `server/lib/recordStore.js` cho danh sách đầy đủ)
  — ban đầu (Bước 6c-6j) các collection này dùng CHUNG 1 bảng `dbo.Records`
  (phân biệt bằng cột `Collection`), nhưng từ Bước 7 đã lần lượt "tốt
  nghiệp" sang bảng riêng để có cột lọc thật (Dept/Status/Creator...) thay
  vì phải tải nguyên JSON rồi lọc bằng Node — tới Bước 7g, TOÀN BỘ collection
  đã tốt nghiệp hết, bảng `dbo.Records` dùng chung không còn được tạo mới.

Chỉ còn dữ liệu CẤU HÌNH (người dùng, phân quyền, quy trình phê duyệt theo
phòng ban, danh mục...) còn ở dạng 1-blob-JSON/collection trong `dbo.AppData`
— các collection này thay đổi ít, không phải điểm nghẽn ghi.

**Kết quả load test thật với 500 người dùng đồng thời** (k6, tháng 8/2026,
xem chi tiết tại PR sửa lỗi cùng đợt): `GET /api/data` — API nặng nhất, gọi
mỗi lần mở app/làm mới dữ liệu — đạt **trung vị 7ms, p95 30ms, 0% lỗi** ở 500
người dùng đồng thời, **VỚI ĐIỀU KIỆN chạy PM2 cluster mode (mục 10)**. Chạy
1 tiến trình đơn (`node server.js` hoặc `pm2 start server.js` không qua
`ecosystem.config.js`) ở cùng mức tải: trung vị 7s, p95 27s — vẫn không lỗi
nhưng chậm rõ rệt. **Kết luận: bắt buộc dùng cluster mode (mục 10) trước khi
đưa vào dùng thật cho từ khoảng 100-200 người dùng đồng thời trở lên** —
không phải tuỳ chọn tối ưu thêm. Hướng dẫn chọn số lượng `instances` cụ thể
theo phần cứng máy chủ đã nêu ở mục 10b — dựa trực tiếp trên kết quả đo ở
đây, không phải số ước đoán.

Điểm nghẽn đo được là CPU xử lý JSON (đọc + lọc quyền xem + serialize hàng
trăm KB mỗi request), KHÔNG phải database (SQL Server chỉ ~38% CPU lúc app
nghẽn nặng nhất) — cluster mode phát huy tác dụng vì đúng loại tải này (CPU-
bound, phân chia được qua nhiều tiến trình) chứ không phải I/O-bound.

Trước khi dùng thật rộng rãi, ngoài việc chạy cluster mode cần lưu ý thêm các thông số tinh chỉnh được:

- **`DB_POOL_MAX`** (`.env`, mục 6) — cân đối với số tiến trình cluster, xem lưu ý ở mục 10b.
- **`APPDATA_CACHE_TTL_MS`** (mặc định 3000 = 3 giây, `.env`, tuỳ chọn) — thời gian cache tạm trong bộ
  nhớ cho các lượt đọc lặp lại nhiều (vd. `requireAuth()` tra trạng thái tài khoản ở mỗi request có xác
  thực). Tăng lên nếu vẫn thấy nghẽn DB dưới tải cao, giảm xuống (hoặc đặt `0`) nếu cần thay đổi quyền/
  vô hiệu hoá tài khoản có hiệu lực ngay lập tức tuyệt đối, chấp nhận đổi lại tải DB cao hơn.
- **Rate limit toàn cục** (`server.js`, mặc định 600 request/phút, khoá theo người dùng đã đăng nhập
  chứ không theo IP) — nếu vẫn thấy người dùng bị chặn nhầm (lỗi "gửi quá nhiều yêu cầu") lúc dùng bình
  thường, có thể nâng thêm `limit` trong `globalApiRateLimiter`.

Giới hạn còn lại (không phải lỗi, chỉ là ranh giới thiết kế hiện tại): nếu
công ty phát triển tới quy mô hàng nghìn người dùng đồng thời thao tác liên
tục, các collection CẤU HÌNH còn ở `dbo.AppData` (đặc biệt "users" nếu công
ty có hàng nghìn tài khoản) sẽ cần cân nhắc tách bảng tương tự — không cấp
thiết ở quy mô vài trăm người dùng đã kiểm chứng ở trên. Dù cấu hình đúng
theo hướng dẫn này không đảm bảo chịu tải đúng thực tế của công ty bạn — nên
tự làm 1 đợt load test riêng (k6/Artillery: đăng nhập + các thao tác CRUD phổ
biến) nhắm vào server thật trước khi công bố chính thức.

### 11.4. Bật mã hoá kết nối SQL Server (`DB_ENCRYPT=true`) khi app và DB tách máy/VLAN

Áp dụng khi kiến trúc của bạn giống mô hình đã rà soát: máy chủ DB nằm sau
firewall riêng, máy chủ app là phần cứng khác cũng sau firewall riêng, 2 máy
ở 2 VLAN khác nhau, firewall chỉ cho phép app → DB kết nối tới đúng port
1433. Đây KHÔNG còn là "1 phân đoạn mạng tin cậy duy nhất" như điều kiện
chấp nhận `DB_ENCRYPT=false` nêu ở mục 6 — traffic đi qua firewall/router
trung gian, dữ liệu (bao gồm mật khẩu SQL Server lúc xác thực) truyền ở dạng
không mã hoá qua chặng đó nếu vẫn để `false`.

**Không cần cài đặt gì thêm trên SQL Server** — SQL Server tự sinh sẵn 1
chứng chỉ TLS self-signed ngay từ lần khởi động đầu tiên (không cần bật
"Force Encryption" trong SQL Server Configuration Manager), driver `mssql`
phía app chỉ cần chủ động yêu cầu mã hoá:

1. Sửa `.env` trên máy chủ app:
   ```
   DB_ENCRYPT=true
   DB_TRUST_CERT=true
   ```
   Giữ nguyên `DB_TRUST_CERT=true` — vì dùng chứng chỉ self-signed (không có
   CA nào ký), driver cần được phép bỏ qua bước xác minh chuỗi chứng chỉ,
   nếu không sẽ báo lỗi kết nối `self signed certificate`.
2. `sudo -u vpdt-app pm2 restart vpdt` (xem mục 10d).
3. Kiểm tra log khởi động — dòng cảnh báo `⚠️ DB_ENCRYPT chưa bật...` (xem
   `server/db.js`) phải biến mất, và vẫn thấy `✅ Đã kết nối SQL Server`.

**Giới hạn cần biết**: cách trên mã hoá được đường truyền (chống nghe lén
thụ động nếu ai đó chen được vào chặng firewall giữa 2 VLAN), nhưng KHÔNG
xác thực được SQL Server có đúng là SQL Server thật hay không (không chống
được tấn công chủ động kiểu man-in-the-middle giả làm SQL Server) — vì
`DB_TRUST_CERT=true` bỏ qua bước xác minh CA. Với topology đã mô tả (firewall
chỉ cho phép đúng 1 đường app → DB, không có thiết bị lạ chen giữa được),
đây là đánh đổi hợp lý. Nếu muốn mã hoá + xác thực đầy đủ, cần cài chứng chỉ
TLS do CA nội bộ/công khai ký cho SQL Server rồi đổi `DB_TRUST_CERT=false`
— bước này phức tạp hơn (quản lý CA, gia hạn chứng chỉ định kỳ) nên không
bắt buộc ở quy mô hiện tại, chỉ nêu để biết hướng nâng cấp sau này.

### 11.5. Bật CAPTCHA chống bot ở trang đăng nhập

Dùng được bình thường ở track này (không phụ thuộc HTTPS/Nginx) — hữu ích
ngay cả trong mạng nội bộ nếu công ty lớn/nhiều máy trạm, phòng trường hợp 1
máy trong mạng bị nhiễm mã độc chạy công cụ dò mật khẩu hàng loạt nhắm vào
server nội bộ.

Dùng CAPTCHA số đơn giản — **tự vẽ + tự xác minh hoàn toàn trên server**
(`server/lib/captcha.js`), không cần đăng ký tài khoản/API key ở bất kỳ dịch
vụ ngoài nào: server sinh 1 mã 4 chữ số, vẽ ra ảnh SVG có nhiễu nhẹ (đường kẻ,
chấm, xoay lệch từng chữ số — đủ chặn kịch bản trích text thô, KHÔNG chống
được OCR chuyên biệt, chấp nhận được vì mục tiêu chỉ là thêm ma sát cho bot dò
mật khẩu hàng loạt), người dùng gõ lại đúng mã đó.

1. Điền vào `.env`:
   ```
   CAPTCHA_ENABLED=true
   ```
2. `sudo -u vpdt-app pm2 restart vpdt`. Mở lại trang đăng nhập — khung "Mã xác nhận"
   (ảnh số + nút ↻ lấy mã khác) sẽ tự hiện dưới ô mật khẩu.

Không cấu hình (mặc định `false`) thì trang đăng nhập hoạt động y như
trước — không bắt buộc.

### 11.6. Đăng nhập/xác thực khi Duyệt bằng vân tay, Face ID (WebAuthn/FIDO2) — CẦN HTTPS, KHÔNG dùng được ở track này

Tính năng đăng nhập bằng vân tay/Face ID và mức xác thực "WEBAUTHN" khi Duyệt
**yêu cầu trình duyệt cấp API vân tay/Face ID qua HTTPS thật** (trừ đúng
`http://localhost` lúc dev) — track PM2-only này phục vụ qua `http://<ip>`
thường nên **tính năng này sẽ không dùng được** (nút liên quan tự ẩn phía
trình duyệt, không cần tắt gì thêm). Muốn dùng, chuyển sang
[`Huong-dan-trien-khai-PM2-Nginx.md`](./Huong-dan-trien-khai-PM2-Nginx.md)
mục 14.6 (có HTTPS).

### 11.7. Cài đặt ứng dụng lên màn hình chính (PWA) — hoạt động hạn chế khi không có HTTPS

Cho phép người dùng "cài" HCRC Workspace như 1 ứng dụng (icon riêng, mở
không qua trình duyệt) trên điện thoại/máy tính. Ở track này (không HTTPS):
- **Android/Chrome**: yêu cầu ngữ cảnh bảo mật (HTTPS hoặc `localhost`) để
  trình duyệt cho cài đặt đầy đủ — qua `http://<ip>` LAN thường, Chrome
  **sẽ KHÔNG cho cài đặt** (không hiện gợi ý cài, nút "Cài Đặt Ngay" ở
  "⚙️ Cá Nhân Hóa" báo lỗi hoặc không có tác dụng).
- **iPhone/iPad (Safari)**: "Thêm vào MH chính" qua Share vẫn tạo được icon
  ngay cả qua `http://` — nhưng trải nghiệm chỉ là 1 bookmark toàn màn hình
  đơn giản, KHÔNG có các đặc tính PWA đầy đủ (không có Service Worker hoạt
  động ổn định, không cache offline).

Muốn trải nghiệm cài đặt đầy đủ trên mọi thiết bị, chuyển sang
[`Huong-dan-trien-khai-PM2-Nginx.md`](./Huong-dan-trien-khai-PM2-Nginx.md)
mục 14.7 (có HTTPS).

---

## 12. Kiểm tra sức khỏe hệ thống

Endpoint kiểm tra nhanh:
```
GET http://<ip-server>:3000/api/health
→ {"status":"ok","db":"connected","version":"1.42.0"}
```

`version` khớp đúng trường `version` trong `package.json` của bản code server
đang chạy — dùng để xác nhận sau khi cập nhật code (mục 13) đã áp dụng đúng
bản mới hay chưa, không cần đoán. Cùng số phiên bản này cũng hiện ở góc dưới
bên phải màn hình web (không cần đăng nhập), đối xứng với ghi chú bản quyền
ở góc dưới bên trái.

Dùng cho giám sát (uptime monitor, script cron cảnh báo qua email/Zalo nếu server down).

Kiểm tra dịch vụ systemd (mục 10c) đang bật cùng server, không chỉ tiến
trình đang chạy tạm thời:
```bash
sudo systemctl is-enabled pm2-vpdt-app   # phải in ra "enabled"
sudo systemctl is-active  pm2-vpdt-app   # phải in ra "active"
```

---

## 13. Cập nhật code sau này

**Chỉ copy code + restart là đủ CHỈ KHI** bản cập nhật không đổi gì
ngoài code (đa số các lần sửa giao diện/tính năng nhỏ là vậy). Với bản cập
nhật lớn hơn — đặc biệt khi máy chủ đã lâu chưa cập nhật (bỏ qua nhiều phiên
bản) — cần kiểm tra thêm 3 chỗ sau trước khi restart, vì code mới có thể yêu
cầu:

1. **`server/sql/schema.sql` đổi** — bảng/cột/index mới, hoặc sửa lỗi trong
   chính script này. An toàn chạy lại nhiều lần (mọi thay đổi đều bọc trong
   `IF OBJECT_ID(...) IS NULL`), nhưng **PHẢI chạy lại** nếu file này có thay
   đổi so với bản đang chạy, nếu không tính năng mới liên quan sẽ lỗi ngay khi
   dùng (thiếu bảng/cột/index).
2. **`server/.env.example` đổi** — biến môi trường mới hoặc đổi ý nghĩa. Một
   số biến bắt buộc để server khởi động được (như `JWT_SECRET`), số khác chỉ
   cần khi dùng đúng tính năng liên quan (ví dụ `EMAIL_ENCRYPTION_KEY` chỉ cần
   nếu dùng màn Cấu Hình Email trên web). So sánh `.env.example` mới với
   `.env` hiện tại của bạn để biết biến nào cần thêm — vì `.env` giờ chỉ tài
   khoản `vpdt-app` đọc được (mục 9), dùng `sudo` để so sánh:
   ```bash
   sudo diff /opt/vpdt/.env /opt/vpdt/.env.example
   ```
   **Lưu ý riêng track này**: `.env.example` mặc định gợi ý `COOKIE_SECURE=true`
   — khi đối chiếu, **giữ nguyên `false`** ở máy chủ của bạn (đừng copy nhầm
   giá trị mẫu), trừ khi bạn đã chuyển hẳn sang track PM2+Nginx.
3. **`server/package.json` đổi `dependencies`** — cần chạy lại `npm install`
   trong thư mục `server/` trước khi restart, nếu không server có thể báo lỗi
   "Cannot find module" ngay khi khởi động.
4. **Bản cập nhật kèm script di trú dữ liệu 1 lần** (`server/scripts/migrate-*.js`) — một số bản cập
   nhật lớn (đổi kiến trúc lưu trữ, VD Bước 7 — tách 1 số collection khỏi bảng dùng chung `dbo.Records`
   sang bảng riêng có cột lọc thật) yêu cầu chạy 1 script Node **SAU KHI** chạy `schema.sql` (bảng mới
   được tạo) nhưng **TRƯỚC KHI** `pm2 restart` (code mới sẽ đọc từ bảng mới — nếu restart trước khi
   script chạy xong, app sẽ thấy các collection đó RỖNG). Mỗi script tự nêu rõ cách chạy ở đầu file
   (`node scripts/<tên-script>.js` xem trước, thêm `--confirm` để chạy thật) — luôn xem README/comment
   đầu file trước khi chạy, và **luôn sao lưu CSDL trước** (script không xoá dữ liệu cũ nhưng vẫn nên
   có bản sao lưu đề phòng, đặc biệt lần đầu áp dụng 1 script loại này).
5. **`server/public/tailwind.css` đổi** — file này là CSS đã build sẵn
   (`npm run build:css`, đọc `tailwind.config.js` + `tailwind-input.css`,
   xem `package.json` script `build:css`), **KHÔNG** tự sinh lúc chạy server
   và **KHÔNG** đổi theo mỗi lần đổi `index.html`/JS. Nếu bản cập nhật có kèm
   class Tailwind mới (giao diện/tab mới, đổi màu…) mà `public/tailwind.css`
   không đổi theo (hoặc bạn tự copy đè `index.html`/`public/js/*.js` mà quên
   copy `public/tailwind.css` mới), phần giao diện dùng class mới đó sẽ
   **không có style** dù code JS/HTML hoàn toàn đúng. Luôn copy đúng file
   `public/tailwind.css` đã build kèm theo code mới, hoặc chạy lại
   `npm run build:css` ngay trên server production trước khi restart — chỉ
   `pm2 restart` không đủ để khắc phục lỗi thiếu style loại này.

**Quy trình cập nhật đầy đủ, an toàn cho mọi trường hợp:**

```bash
# 0. Backup CSDL trước (luôn làm, kể cả khi tưởng chỉ đổi code)
sqlcmd -S localhost -U sa -Q "BACKUP DATABASE VPDT_DMS TO DISK = '/var/backups/vpdt_$(date +%F).bak'"

cd /opt/vpdt
# 1. Lấy code mới (git pull hoặc copy đè) — làm bằng tài khoản admin/sudo của
#    bạn như bình thường (KHÔNG cần đăng nhập bằng vpdt-app, tài khoản đó
#    không có shell đăng nhập — xem mục 9a); các file mới sẽ tạm thời không
#    thuộc sở hữu vpdt-app, sẽ trả lại đúng quyền ở bước 5 bên dưới.

cd server
# 2. Cài lại dependency (vô hại nếu không có gói mới) — chạy bằng sudo để có
#    quyền ghi vào node_modules/ hiện đang thuộc sở hữu vpdt-app
sudo npm install

# 3. Chạy lại schema.sql — an toàn chạy nhiều lần
sqlcmd -S localhost -U sa -i sql/schema.sql
# (dùng sqlcmd18 nếu Ubuntu 22.04+, xem mục 2)

# 3b. NẾU bản cập nhật kèm script scripts/migrate-*.js (xem điểm 4 ở trên) — chạy dry-run trước, đọc
#     kỹ kết quả, rồi mới --confirm. Bỏ qua bước này nếu bản cập nhật không nhắc tới script nào.
node scripts/migrate-records-batch1.js
node scripts/migrate-records-batch1.js --confirm

# 4. Xem có biến .env mới cần thêm không
sudo diff .env .env.example

# 5. QUAN TRỌNG — trả lại đúng quyền sở hữu cho tài khoản dịch vụ (mục 9)
#    trước khi restart, vì bước 1/2 ở trên có thể đã tạo file mới thuộc sở
#    hữu tài khoản admin/root thay vì vpdt-app:
sudo chown -R vpdt-app:vpdt-app /opt/vpdt
sudo chmod 600 /opt/vpdt/.env

# 6. Khởi động lại (chạy bằng tài khoản dịch vụ, xem mục 10d)
sudo -u vpdt-app pm2 restart vpdt
sudo -u vpdt-app pm2 status      # phải thấy "online", KHÔNG phải liên tục "restart"/"errored"
```

Vì toàn bộ dữ liệu đã nằm trong SQL Server (không còn trong trình duyệt), việc
cập nhật giao diện/code **không làm mất dữ liệu người dùng đã nhập** — kể cả
khi có chạy lại `schema.sql` (script chỉ thêm mới, không xoá/ghi đè dữ liệu).

Số lượng tiến trình PM2 đang chạy (`pm2 status`) và việc PM2 tự khởi động
cùng server (systemd, mục 10c) **không đổi** sau bước `pm2 restart` — restart
chỉ khởi động lại code bên trong các tiến trình đã có, không cần `pm2 save`
lại (xem phân biệt 2 tầng quản lý ở mục 10d).

> ⚠️ **Lỗi thường gặp: web báo lỗi kết nối/không mở được sau khi cập nhật
> code.** Nguyên nhân hầu hết là bỏ sót bước `npm install` — nếu code mới
> thêm gói mới trong `package.json` (`dependencies`) mà chưa cài, tiến trình
> Node sẽ báo lỗi `Cannot find module '...'` và **thoát ngay khi khởi động**,
> khiến PM2 cứ khởi động rồi crash liên tục (`pm2 status` sẽ thấy số lần
> restart tăng rất nhanh). Cách kiểm tra và khắc phục:
> ```bash
> sudo -u vpdt-app pm2 logs vpdt --lines 50 --err   # tìm dòng "Cannot find module ..."
> cd /opt/vpdt && sudo npm install && sudo chown -R vpdt-app:vpdt-app /opt/vpdt
> sudo -u vpdt-app pm2 restart vpdt
> ```
> Sau khi sửa, mở `GET /api/health` (mục 12) để xác nhận server đã lên và
> đúng phiên bản mới trước khi báo cho người dùng thử lại.

---

## Xem thêm

Tài liệu này chỉ nói về **triển khai/hạ tầng** (cài đặt, chạy production, bảo
mật tầng hệ điều hành) cho track KHÔNG-qua-Nginx. Cần HTTPS/public Internet →
xem [`Huong-dan-trien-khai-PM2-Nginx.md`](./Huong-dan-trien-khai-PM2-Nginx.md)
(cùng thư mục). Mô tả nghiệp vụ + hướng dẫn sử dụng/cấu hình các tính năng
nghiệp vụ, API, báo cáo của ứng dụng nằm ở
[`Huong-dan-nghiep-vu.md`](./Huong-dan-nghiep-vu.md).

**Quy ước cập nhật:** bất kỳ thay đổi nào liên quan tới triển khai/hạ tầng
(biến môi trường mới, bước cài đặt mới, thay đổi cách chạy production...) đều
phải cập nhật vào CẢ 2 file hướng dẫn triển khai (file này và
`Huong-dan-trien-khai-PM2-Nginx.md`) — xem `CLAUDE.md` ở gốc repo.
