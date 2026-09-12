# Ghi chú cho Claude khi làm việc trên repo này

## Quy trình làm việc chuẩn: phân tích → xác nhận → làm + merge luôn, không chờ demo

Từ nay, với các yêu cầu nghiệp vụ/tính năng: nghiên cứu + phân tích sâu, đưa
phương án cho người dùng xác nhận trước — nhưng SAU KHI người dùng xác nhận
phương án thì cứ triển khai và merge vào main luôn, KHÔNG cần đợi demo trước.
Người dùng tự deploy lên server thật và sẽ báo lại nếu cần chỉnh sửa gì thêm.
Chỉ làm demo khi người dùng chủ động yêu cầu ("demo cho tôi xem") — không phải
mặc định cho mọi việc nữa. Vẫn giữ nguyên các quy tắc khác (verify kỹ qua git
fetch/log trước khi báo cáo, chạy full regression, báo deploy-impact rõ ràng,
bump version + cập nhật VERSION.md mỗi lần merge).

## Module mới → bắt buộc thêm vào Báo Cáo + Biểu Mẫu ngay trong cùng đợt merge

Phát hiện từ đợt rà soát chuyên sâu (9/2026): nhiều module nghiệp vụ đã tồn
tại lâu (Nhân Sự, Vận Hành...) nhưng chưa từng được thêm vào 2 màn dùng
chung sau — để không lặp lại khoảng trống này, từ nay **bất kỳ module/module
con MỚI nào có tạo hồ sơ (collection riêng)** phải kiểm tra & bổ sung ngay
trong CÙNG đợt merge tạo module đó (không để dành "làm sau"):

- **📊 Báo Cáo** (`public/js/module-baocaoquantri.js`, `REPORT_NAV_TREE` +
  `REPORT_MODULE_CONFIGS`) — thêm 1 entry `getRecords(dept, from, to)` đọc
  `DB.<collection>` (chuẩn `dept`/`createdAt`, xem 16+ entry đã có làm mẫu).
  **Ngoại lệ phải cân nhắc kỹ**: nếu collection thuộc nhóm dữ liệu CỰC NHẠY
  CẢM đã bị chặn hẳn khỏi `GET /api/data` chung (VD `employeeProfiles`/
  `laborContracts`/`payslips`/`attendanceRecords` — xem `routes/data.js`),
  KHÔNG được thêm theo khuôn `DB.<collection>` này (sẽ luôn rỗng phía client
  và vô tình gợi ý sai hướng sửa) — cần thiết kế route thống kê riêng, gác
  đúng quyền quản lý hiện có của module đó, rồi mới đưa vào Báo Cáo; nếu chưa
  có thời gian làm đúng, nêu rõ với người dùng và xin xác nhận trước khi bỏ
  qua ở đợt hiện tại thay vì tự ý bỏ qua.
- **📋 Biểu Mẫu** (`public/js/core.js`, `CORE_FIELD_MANIFEST` + `FORM_TABS` +
  `FORM_GROUPS`) — mọi form nhập tay THẬT (không phải bảng nhập động kiểu
  câu hỏi/hạng mục tự thêm-bớt, xem ngoại lệ TRAINING_TEST/CHECKLIST/
  CAREER_PATH đã áp dụng) phải có 1 entry liệt kê đúng field id DOM thật,
  để admin tự đổi nhãn/bắt buộc không cần sửa code. `applyAllCoreFieldCustomizations()`
  đã tự chạy 1 lần lúc đăng nhập — thêm entry vào 3 mảng trên là ĐỦ, không
  cần gọi thêm hàm nào khác.

Không bỏ qua bước này chỉ vì module mới nhỏ — cả 2 màn trên đều tồn tại lâu
dài, việc bổ sung càng chậm càng dễ bị quên/tích tụ thành nợ kỹ thuật lớn
(đợt rà soát vừa rồi phát hiện 8 module thiếu ở Báo Cáo cùng lúc).

## 3 file hướng dẫn trong `vpdt-pms/deploy/` — cập nhật liên tục

Có 3 file hướng dẫn sống trong thư mục `vpdt-pms/deploy/`:
- **`Huong-dan-nghiep-vu.md`** — mô tả nghiệp vụ + hướng dẫn sử dụng/cấu hình
  các tính năng nghiệp vụ, API, báo cáo của ứng dụng.
- **`Huong-dan-trien-khai-PM2.md`** — hướng dẫn triển khai bằng PM2 THÔI,
  không qua Nginx (phục vụ trực tiếp `http://<ip>:3000`, cho mạng nội bộ/VPN).
- **`Huong-dan-trien-khai-PM2-Nginx.md`** — hướng dẫn triển khai đầy đủ, PM2 +
  Nginx (reverse proxy + HTTPS + fail2ban), khuyến nghị cho production/public
  ra Internet. 2 file triển khai dùng chung mục 1-10 (Node.js/SQL Server/PM2/
  systemd), chỉ khác từ mục Nginx trở đi.

**Quy ước bắt buộc từ nay về sau**: bất kỳ lần nào hoàn thành một thay đổi có
liên quan tới **nghiệp vụ** (module mới, luồng phê duyệt mới, cấu hình API/
báo cáo mới...) → cập nhật vào `Huong-dan-nghiep-vu.md`. Bất kỳ lần nào có
thay đổi liên quan tới **triển khai/hạ tầng** (biến môi trường mới, bước cài
đặt mới, thay đổi cách chạy production...) → cập nhật vào **CẢ 2 FILE** triển
khai (`Huong-dan-trien-khai-PM2.md` VÀ `Huong-dan-trien-khai-PM2-Nginx.md`)
nếu thay đổi đó áp dụng cho cả 2 track (đa số trường hợp — biến `.env` mới,
gói npm mới, `schema.sql` mới đều áp dụng bất kể có Nginx hay không); chỉ cập
nhật đúng 1 file nếu thay đổi CHỈ liên quan riêng tới track đó (VD nội dung
Nginx/fail2ban/HTTPS chỉ có ở bản PM2+Nginx). Không bỏ qua bước này chỉ vì
thay đổi nhỏ — giữ cả 3 file này luôn phản ánh đúng trạng thái hiện tại của
ứng dụng.

## Repo GitHub đã đổi tên (không phải chuyển repo khác)

`git push` tới remote cũ (`github.com/pth8081/vpdt-dms`) có thể trả về thông
báo "This repository moved. Please use the new location:
`github.com/pth8081/Hcrc-workspace`" — đây chỉ là do người dùng đổi tên
thư mục/repo trên GitHub, KHÔNG phải tạo repo mới hay chuyển dữ liệu. Push
vẫn thành công bình thường (GitHub tự redirect theo tên cũ). Không cần coi
đây là lỗi hay việc cần xử lý gì thêm — chỉ nêu 1 dòng nếu thấy thông báo
này, không cần cảnh báo lặp lại mỗi lần.

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

Quy trình cập nhật đầy đủ đã viết sẵn ở mục tương ứng ("Cập nhật code sau này")
trong CẢ 2 file `deploy/Huong-dan-trien-khai-PM2.md` và
`deploy/Huong-dan-trien-khai-PM2-Nginx.md` (đã dời từ
`HUONG_DAN_DEPLOY_UBUNTU.md` ở thư mục gốc — file gốc giờ chỉ còn là 1 trang
trỏ ngắn, KHÔNG xoá hẳn để không phá đường dẫn cũ trong comment code) — trỏ
người dùng tới đó thay vì lặp lại toàn bộ mỗi lần, chỉ nêu phần khác biệt cụ
thể của lần cập nhật đang báo cáo.

## Luôn tăng version khi merge vào main

Mỗi lần merge PR vào main (bất kể tính năng lớn hay fix nhỏ), **luôn tăng
`server/package.json` field `version`** trong CÙNG PR trước khi merge. Đây là
version DUY NHẤT client đọc (badge góc màn hình + `/api/health`, xem
`server.js` require `./package.json`), không có bản sao nào khác cần sửa.
Nếu lỡ quên ở 1-2 lần merge trước, bump bắt kịp luôn (cộng dồn số lần đã bỏ
lỡ) ở lần merge kế tiếp thay vì bỏ qua.

**Định dạng version (từ v2.0 trở đi, KHÔNG còn semver 3 phần):** chỉ 2 số
`MAJOR.MINOR` (VD `"2.0"`, `"2.1"`... không có số thứ 3 kiểu `.0` ở cuối).
MINOR chỉ chạy từ 0 đến 9 — mỗi lần merge tăng MINOR lên 1 (`2.0`→`2.1`→...→
`2.9`), và lần merge NGAY SAU khi đang ở `X.9` thì tăng MAJOR lên 1 và reset
MINOR về 0 (`2.9`→`3.0`→`3.1`...). Không phân biệt patch/minor theo mức độ
thay đổi nữa — mọi lần merge (dù fix nhỏ hay tính năng lớn) đều tăng đúng 1
bậc theo quy tắc này. Version trước v2.0 (`1.75.0`...`1.102.0`, kiểu semver 3
phần cũ) đã ngừng dùng — không lùi lại đổi các bản ghi lịch sử cũ.

## Ô tìm-kiếm-gõ-chọn (searchable picker): KHÔNG dùng `<input list>`+`<datalist>` native

Cơ chế `<datalist>` gốc của trình duyệt không đáng tin cậy trên nhiều
trình duyệt/thiết bị (đã xác nhận lỗi thực tế trên Chrome/Firefox/Edge
desktop lẫn Chrome-Samsung/Safari-iPhone dù dữ liệu/logic lọc phía sau
vẫn đúng — xem lịch sử ở block `sdd*` trong `public/index.html`, ngay
trước `renderPeopleMultiSelect()`). Toàn bộ 19 điểm dùng datalist trong
hệ thống đã được thay bằng widget JS tự dựng, không phụ thuộc thư viện
ngoài: `sddSetOptions(dropdownId, items)` để nạp danh sách, input dùng
`data-sdd-list="dropdownId"` (thay cho `list="..."`), dropdown là
`<div id="dropdownId" class="hidden sdd-dropdown" data-sdd-dropdown></div>`
(thay cho `<datalist>`). Xem chú thích 3 bước migrate ngay tại block
`sdd*`. **Mọi ô tìm-kiếm-gõ-chọn mới từ giờ trở đi phải dùng cơ chế này**
(hoặc `renderPeopleMultiSelect()`/dropdown tự dựng tương tự nếu cần
multi-select thật sự) — không quay lại `<datalist>` native.
