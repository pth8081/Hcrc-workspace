# HƯỚNG DẪN TRIỂN KHAI VPDT (VĂN PHÒNG ĐIỆN TỬ) TRÊN UBUNTU SERVER
### Node.js + SQL Server (MSSQL) — thay thế localStorage

---

## 0. Tổng quan kiến trúc sau khi chuyển đổi

```
[Trình duyệt người dùng]
        │  HTTP (http://<ip-server>:3000)
        ▼
[Ubuntu Server]
   ├─ Node.js (Express) — port 3000 — phục vụ giao diện + API
   └─ SQL Server (MSSQL) — port 1433 — lưu trữ dữ liệu (bảng AppData)
```

Toàn bộ giao diện, chức năng, các module (Tài liệu, Văn bản trình, Hợp đồng,
Phòng họp, Đăng ký xe, Đề xuất văn phòng, Quản trị, Quy trình...) **giữ nguyên
100%** — chỉ thay đổi nơi lưu trữ dữ liệu từ `localStorage` của trình duyệt
sang SQL Server thông qua một API Node.js ở giữa.

**Lưu ý về 1 lỗi đã sửa trong quá trình chuyển đổi:** một số hàm cấu hình quy
trình (`dept_workflows`, `car_regs`, `office_reqs`...) trong code gốc gọi lưu
dữ liệu với tên khóa không khớp với tên trường thực tế trong bộ nhớ, khiến các
thay đổi này bị mất khi tải lại trang. Đã sửa lại cho khớp đúng — đây là sửa
lỗi, không phải thay đổi chức năng hay giao diện.

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

Script này sẽ:
- Tạo database `VPDT_DMS`
- Tạo bảng `dbo.AppData` (lưu trữ toàn bộ dữ liệu ứng dụng dạng JSON theo từng "collection")

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

## 5. Cấu hình kết nối SQL Server

```bash
cp .env.example .env
nano .env
```

Điền đúng thông tin:

```
PORT=3000

# Bắt buộc — server sẽ không khởi động nếu thiếu. Tạo bằng lệnh:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=change-me-to-a-long-random-string

# Cookie phiên đăng nhập mặc định bắt buộc HTTPS. Chỉ đặt =false khi chạy dev cục bộ qua
# http://localhost — xem lưu ý HTTPS ở mục 8.
COOKIE_SECURE=true

DB_SERVER=localhost          # hoặc IP máy chủ SQL Server nếu chạy riêng
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

> ⚠️ Không commit file `.env` lên Git — chứa `JWT_SECRET` và mật khẩu SQL Server.

Các biến khác trong `.env.example` (`TRUST_PROXY`, `DB_POOL_*`, `SMTP_*`) đều có giá trị mặc định hợp
lý — chỉ cần điền khi bạn thực sự cần chỉnh khác mặc định (xem chú thích trong chính file
`.env.example`). Riêng `TRUST_PROXY=1` **bắt buộc phải đặt** nếu bạn triển khai Nginx theo mục 8 — xem
giải thích ở đó.

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

Mật khẩu các tài khoản mặc định được lưu **đã băm bằng bcrypt** (không phải
plain-text). Server tự động phát hiện tài khoản nào còn dùng mật khẩu mặc định
`123456` và **bắt buộc đổi mật khẩu ngay lần đăng nhập đầu tiên** (màn hình
đổi mật khẩu hiện ra, không thể bỏ qua) — không cần bạn phải nhớ tự đổi thủ
công, nhưng vẫn nên đổi ngay khi đưa vào sử dụng thật cho đúng người dùng thật.

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
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/vpdt /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

> ⚠️ **Bắt buộc đặt `TRUST_PROXY=1` trong `.env` khi dùng Nginx như trên** (rồi
> `pm2 restart vpdt`). Tính năng khoá tài khoản/giới hạn số lần đăng nhập sai
> (mục 9) xác định người dùng dựa theo IP qua `req.ip` của Express — nếu không
> khai báo `TRUST_PROXY`, Express chỉ thấy IP của chính Nginx (giống nhau cho
> mọi người dùng), khiến giới hạn theo IP mất tác dụng thực tế dù tính năng
> vẫn "chạy" bình thường không báo lỗi gì. Cấu hình `proxy_set_header
> X-Forwarded-For ...` ở trên và `TRUST_PROXY=1` ở `.env` phải đi cùng nhau.

Mở firewall (nếu dùng `ufw`):
```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

**Về HTTPS:** `COOKIE_SECURE` mặc định là `true` (bắt buộc HTTPS) — cookie
phiên đăng nhập sẽ **không được trình duyệt gửi lên** nếu truy cập qua `http://`
thường (không phải `https://`), khiến đăng nhập không giữ được phiên. Vì vậy
sau khi cấu hình Nginx, bạn cần bật HTTPS bằng 1 trong 2 cách trước khi đưa
vào dùng thật:
- Có domain public trỏ về server: dùng `certbot` (Let's Encrypt, miễn phí).
- Chỉ dùng nội bộ (LAN/VPN, không có domain public): tự cấp chứng chỉ qua CA
  nội bộ của công ty, hoặc dùng chứng chỉ self-signed cho môi trường thử
  nghiệm (trình duyệt sẽ cảnh báo "không an toàn", chấp nhận thủ công 1 lần).

Nếu thực sự không thể bật HTTPS (ví dụ đang thử nghiệm nhanh trong LAN kín),
có thể tạm đặt `COOKIE_SECURE=false` — nhưng khi đó phiên đăng nhập (cookie
JWT) đi dạng cleartext trên mạng, **không nên dùng cấu hình này khi đã có dữ
liệu thật của nhân viên**.

---

## 9. Tình trạng bảo mật hiện tại và các việc cần làm trước khi public

### 9.1. Đã hoàn thiện ở tầng ứng dụng/server

- **Xác thực phía server**: đăng nhập kiểm tra mật khẩu bằng bcrypt, phát
  cookie phiên JWT `httpOnly` — không còn so sánh mật khẩu ở JS trình duyệt.
  Mọi API nghiệp vụ đều bắt buộc có phiên hợp lệ, server tự kiểm tra lại
  quyền/trạng thái tài khoản (đã bị vô hiệu hoá hay chưa) trên **mỗi request**
  chứ không chỉ tin nội dung JWT.
- **Chống dò mật khẩu**: giới hạn số lần đăng nhập sai theo IP (chặn 15 phút
  nếu vượt ngưỡng) **và** khoá riêng theo từng tài khoản sau 5 lần sai liên
  tiếp — 2 lớp độc lập, xem lưu ý bắt buộc về `TRUST_PROXY` ở mục 8.
- **Chính sách mật khẩu**: mật khẩu mới (khi admin tạo/đặt lại) phải tối
  thiểu 8 ký tự, không nằm trong danh sách mật khẩu phổ biến/dễ đoán. Tài
  khoản còn dùng mật khẩu mặc định `123456` bị tự động đánh dấu **bắt buộc
  đổi mật khẩu ngay lần đăng nhập kế tiếp**, chặn ở cả giao diện lẫn server
  (không thể bỏ qua bằng cách sửa code phía trình duyệt).
- **HTTP security headers**: đã bật CSP, `X-Frame-Options`, `X-Content-Type-Options`,
  HSTS, ẩn `X-Powered-By`, ... (xem `server/lib/securityHeaders.js`).
- **Chống xung đột dữ liệu (race condition)**: các thao tác lưu dùng optimistic
  concurrency (If-Match/409) hoặc khoá dòng (`WITH UPDLOCK, HOLDLOCK`) cho các
  thao tác cần cộng dồn/append an toàn (ví dụ nhật ký hệ thống).
- **Connection pool** đã tinh chỉnh để chịu tải tốt hơn (xem mục 5, biến
  `DB_POOL_*` trong `.env.example`).

### 9.2. Việc bạn cần tự làm khi triển khai

1. Đặt `JWT_SECRET` là chuỗi ngẫu nhiên dài, **khác nhau giữa các môi trường**
   (mục 5) — không dùng lại giá trị mẫu trong `.env.example`.
2. Bật HTTPS thật (`COOKIE_SECURE=true` là mặc định, xem lưu ý ở mục 8) trước
   khi cho người dùng thật đăng nhập — nếu không, cookie phiên không hoạt
   động qua `http://` thường.
3. Nếu dùng Nginx (khuyến nghị, mục 8): **bắt buộc** đặt `TRUST_PROXY=1` và
   cấu hình `proxy_set_header X-Forwarded-For ...` — thiếu bước này khiến
   giới hạn đăng nhập theo IP mất tác dụng thực tế dù không báo lỗi gì.
4. **Chỉ mở port 3000/1433 trong mạng nội bộ** (LAN/VPN công ty) nếu không
   qua Nginx + HTTPS; không expose thẳng port 3000/1433 ra Internet.
5. **Backup định kỳ SQL Server** (`sqlcmd`/SQL Server Agent job hoặc script
   `BACKUP DATABASE VPDT_DMS TO DISK = ...` chạy cron hàng ngày).
6. Đổi mật khẩu tài khoản mặc định cho đúng người dùng thật ngay sau khi
   triển khai (hệ thống sẽ tự bắt buộc đổi ở lần đăng nhập đầu, xem mục 6,
   nhưng vẫn nên chủ động rà lại danh sách tài khoản trước khi public).

### 9.3. Giới hạn kiến trúc cần biết khi mở rộng quy mô người dùng

Thiết kế lưu trữ ban đầu (port thẳng từ `localStorage`) dồn TOÀN BỘ collection
vào 1 bản ghi JSON duy nhất trong `dbo.AppData`. Từ "Bước 6" trở đi, các
collection tăng trưởng nhanh/hay ghi nhiều nhất đã được TÁCH sang bảng riêng,
mỗi bản ghi = 1 dòng thật (khoá đúng 1 dòng thay vì cả collection khi ghi) —
xem chi tiết ở đầu `server/sql/schema.sql`:

- `dbo.SystemLogs` — nhật ký hệ thống
- `dbo.Tasks` — Công việc
- `dbo.Records` — submissions/docs/carRegs/officeReqs/contracts/meetings/
  meetingMinutes/internalPosts/paymentRequests/vppPeriods/vppRegistrations/
  reportPeriods/reportEntries/reportSlideTemplates (phân biệt bằng cột
  `Collection`, mỗi bản ghi vẫn 1 dòng riêng)

Chỉ còn dữ liệu CẤU HÌNH (người dùng, phân quyền, quy trình phê duyệt theo
phòng ban, danh mục...) còn ở dạng 1-blob-JSON/collection trong `dbo.AppData`
— các collection này thay đổi ít, không phải điểm nghẽn ghi.

**Kết quả load test thật với 500 người dùng đồng thời** (k6, tháng 8/2026,
xem chi tiết tại PR sửa lỗi cùng đợt): `GET /api/data` — API nặng nhất, gọi
mỗi lần mở app/làm mới dữ liệu — đạt **trung vị 7ms, p95 30ms, 0% lỗi** ở 500
người dùng đồng thời, **VỚI ĐIỀU KIỆN chạy PM2 cluster mode (mục 9a)**. Chạy
1 tiến trình đơn (`node server.js` hoặc `pm2 start server.js` không qua
`ecosystem.config.js`) ở cùng mức tải: trung vị 7s, p95 27s — vẫn không lỗi
nhưng chậm rõ rệt. **Kết luận: bắt buộc dùng cluster mode (mục 9a) trước khi
public cho từ khoảng 100-200 người dùng đồng thời trở lên** — không phải tuỳ
chọn tối ưu thêm.

Điểm nghẽn đo được là CPU xử lý JSON (đọc + lọc quyền xem + serialize hàng
trăm KB mỗi request), KHÔNG phải database (SQL Server chỉ ~38% CPU lúc app
nghẽn nặng nhất) — cluster mode phát huy tác dụng vì đúng loại tải này (CPU-
bound, phân chia được qua nhiều tiến trình) chứ không phải I/O-bound.

Giới hạn còn lại (không phải lỗi, chỉ là ranh giới thiết kế hiện tại): nếu
công ty phát triển tới quy mô hàng nghìn người dùng đồng thời thao tác liên
tục, các collection CẤU HÌNH còn ở `dbo.AppData` (đặc biệt "users" nếu công
ty có hàng nghìn tài khoản) sẽ cần cân nhắc tách bảng tương tự — không cấp
thiết ở quy mô vài trăm người dùng đã kiểm chứng ở trên.

---

## 10. Kiểm tra sức khỏe hệ thống

Endpoint kiểm tra nhanh:
```
GET http://<ip-server>:3000/api/health
→ {"status":"ok","db":"connected"}
```

Dùng cho giám sát (uptime monitor, script cron cảnh báo qua email/Zalo nếu server down).

---

## 11. Cập nhật code sau này

**Chỉ copy code + `pm2 restart` là đủ CHỈ KHI** bản cập nhật không đổi gì
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
   `.env` hiện tại của bạn (`diff .env server/.env.example` sau khi copy code
   mới) để biết biến nào cần thêm.
3. **`server/package.json` đổi `dependencies`** — cần chạy lại `npm install`
   trong thư mục `server/` trước khi restart, nếu không server có thể báo lỗi
   "Cannot find module" ngay khi khởi động.

**Quy trình cập nhật đầy đủ, an toàn cho mọi trường hợp:**

```bash
# 0. Backup CSDL trước (luôn làm, kể cả khi tưởng chỉ đổi code)
sqlcmd -S localhost -U sa -Q "BACKUP DATABASE VPDT_DMS TO DISK = '/var/backups/vpdt_$(date +%F).bak'"

cd /opt/vpdt
# 1. Lấy code mới (git pull hoặc copy đè)

cd server
# 2. Cài lại dependency (vô hại nếu không có gói mới)
npm install

# 3. Chạy lại schema.sql — an toàn chạy nhiều lần
sqlcmd -S localhost -U sa -i sql/schema.sql
# (dùng sqlcmd18 nếu Ubuntu 22.04+, xem mục 3)

# 4. Xem có biến .env mới cần thêm không
diff .env .env.example

# 5. Khởi động lại
pm2 restart vpdt
```

Vì toàn bộ dữ liệu đã nằm trong SQL Server (không còn trong trình duyệt), việc
cập nhật giao diện/code **không làm mất dữ liệu người dùng đã nhập** — kể cả
khi có chạy lại `schema.sql` (script chỉ thêm mới, không xoá/ghi đè dữ liệu).
