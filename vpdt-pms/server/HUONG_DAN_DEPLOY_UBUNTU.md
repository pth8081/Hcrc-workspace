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
DB_SERVER=localhost          # hoặc IP máy chủ SQL Server nếu chạy riêng
DB_PORT=1433
DB_NAME=VPDT_DMS
DB_USER=sa
DB_PASSWORD=Your_Strong_Password_Here
DB_ENCRYPT=false
DB_TRUST_CERT=true
```

> ⚠️ Không commit file `.env` lên Git — chứa mật khẩu SQL Server.

---

## 5b. Cấu hình gửi email thật (SMTP)

Mặc định hệ thống chỉ **mô phỏng** gửi email (ghi vào Nhật ký hệ thống, không gửi thật) cho tới khi
khai báo `SMTP_HOST` trong `.env`. `SMTP_USER`/`SMTP_PASS` là **tùy chọn** — chỉ cần nếu máy chủ
SMTP yêu cầu đăng nhập.

**Trường hợp 1 — Gmail (cần xác thực):**
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
```
Bật xác thực 2 bước cho tài khoản Gmail, tạo "Mật khẩu ứng dụng" (App Password) tại
`https://myaccount.google.com/apppasswords`, dùng mật khẩu đó cho `SMTP_PASS` (Google đã chặn đăng
nhập SMTP bằng mật khẩu thường).

**Trường hợp 2 — mail relay nội bộ công ty (KHÔNG cần xác thực):** nếu relay chỉ cho phép kết nối
từ IP nội bộ tin cậy (không hỏi tài khoản/mật khẩu), để trống `SMTP_USER`/`SMTP_PASS`:
```
SMTP_HOST=mail.noibobo.local
SMTP_PORT=25
SMTP_FROM=vpdt-noreply@congty.vn
```
Nếu relay dùng chứng chỉ TLS tự ký (self-signed), thêm `SMTP_TLS_REJECT_UNAUTHORIZED=false`.

Host/Port/Email người gửi hiển thị trong màn Quản trị > Cấu Hình Email vẫn chỉnh được trực tiếp
trên web như trước — chỉ riêng tài khoản/mật khẩu đăng nhập SMTP (khi máy chủ yêu cầu) là bắt buộc
đặt trong `.env` vì lý do bảo mật (không lưu trong dữ liệu ứng dụng).

> ⚠️ Sau khi sửa `.env`, cần khởi động lại server (`pm2 restart vpdt` hoặc tương đương) để áp dụng.

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

**⚠️ Đổi ngay mật khẩu các tài khoản mặc định này trước khi đưa vào sử dụng
thật** (qua module Quản trị → Người dùng), vì mật khẩu hiện đang lưu ở dạng
plain-text — xem khuyến nghị bảo mật ở mục 9.

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

Đây là các điểm **quan trọng cần làm thêm**, vì hiện tại ứng dụng vẫn giữ
nguyên cơ chế xác thực gốc (kiểm tra mật khẩu ở phía trình duyệt) để không
thay đổi chức năng — nhưng cơ chế này vốn chưa an toàn cho môi trường
internet mở:

1. **Đổi toàn bộ mật khẩu mặc định** (`123456`) ngay sau khi triển khai.
2. **Chỉ mở port 3000/1433 trong mạng nội bộ** (LAN/VPN công ty), không expose
   trực tiếp ra Internet nếu không có SSL + xác thực bổ sung.
3. **Backup định kỳ SQL Server** (`sqlcmd`/SQL Server Agent job hoặc script
   `BACKUP DATABASE VPDT_DMS TO DISK = ...` chạy cron hàng ngày).
4. Về lâu dài, nên nâng cấp cơ chế đăng nhập sang hash mật khẩu (bcrypt) và xác
   thực phía server thay vì so sánh ở client — tôi có thể hỗ trợ việc này ở
   một đợt cập nhật riêng nếu bạn cần (đây là thay đổi về bảo mật/kiến trúc
   xác thực, ngoài phạm vi "giữ nguyên chức năng" của lần chuyển đổi này nên
   tôi chưa tự ý thực hiện).

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

```bash
cd /opt/vpdt
# copy file public/index.html hoặc code backend mới đè lên
pm2 restart vpdt
```

Vì toàn bộ dữ liệu đã nằm trong SQL Server (không còn trong trình duyệt), việc
cập nhật giao diện/code **không làm mất dữ liệu người dùng đã nhập**.
