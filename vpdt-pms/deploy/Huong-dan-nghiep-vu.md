# HƯỚNG DẪN NGHIỆP VỤ — HCRC WORKSPACE (VPDT)

Mô tả nghiệp vụ + hướng dẫn sử dụng/cấu hình các tính năng nghiệp vụ, API, báo
cáo của ứng dụng. Đây là tài liệu **sống** — theo quy ước ở `CLAUDE.md`, bất kỳ
thay đổi nghiệp vụ nào (module mới, luồng phê duyệt mới, cấu hình API/báo cáo
mới...) đều phải cập nhật vào file này.

> Tài liệu triển khai (cài đặt server, SQL Server, PM2, Nginx...) nằm ở
> [`Huong-dan-trien-khai-PM2.md`](./Huong-dan-trien-khai-PM2.md) (chỉ PM2,
> mạng nội bộ) hoặc
> [`Huong-dan-trien-khai-PM2-Nginx.md`](./Huong-dan-trien-khai-PM2-Nginx.md)
> (PM2 + Nginx + HTTPS, khuyến nghị production) — không lặp lại ở đây.

**Cách đọc tài liệu này**: được sắp theo đúng trình tự 1 nhân viên mới sẽ gặp
hệ thống — dùng chung trước (mục 1-3), rồi tới từng nhóm module theo tần suất
dùng (mục 4: hằng ngày → tự phục vụ → tài chính → vận hành → nhân sự → báo cáo
định kỳ), cuối cùng là các màn chỉ admin cần (mục 5-7). Mỗi module/tab/sub-tab
đều có ghi rõ **vai trò** (dùng để làm gì, ai dùng) ngay ở câu mở đầu.

### Mục lục

- [1. Tổng quan](#1-tổng-quan)
- [2. Nền Tảng Dùng Chung (Mọi Người, Mọi Ngày)](#2-nền-tảng-dùng-chung-mọi-người-mọi-ngày)
- [3. Mô hình quy trình phê duyệt chung](#3-mô-hình-quy-trình-phê-duyệt-chung)
- [4. Danh sách module nghiệp vụ theo nhóm](#4-danh-sách-module-nghiệp-vụ-theo-nhóm)
- [5. Báo Cáo (Reports — dashboard tổng hợp)](#5-báo-cáo-reports--dashboard-tổng-hợp)
- [6. Phân quyền (permission model)](#6-phân-quyền-permission-model)
- [7. Hệ Thống / Quản Trị](#7-hệ-thống--quản-trị)

---

## 1. Tổng quan

**HCRC Workspace** (tên nội bộ trước đây: VPDT — Văn Phòng Điện Tử) là hệ
thống quản lý nghiệp vụ/văn bản nội bộ dùng chung cho toàn công ty — mọi nhân
viên dùng để trình/duyệt văn bản, đăng ký xe/phòng họp/văn phòng phẩm, quản lý
hợp đồng/giấy phép, báo cáo công việc, tra cứu chính sách nhân sự...; admin/
quản lý dùng để cấu hình quy trình phê duyệt, phân quyền, báo cáo tổng hợp và
theo dõi toàn bộ hoạt động qua Nhật ký hệ thống.

**Kiến trúc tóm tắt** (chi tiết triển khai xem `Huong-dan-trien-khai-PM2.md`/
`Huong-dan-trien-khai-PM2-Nginx.md`):
backend Node.js/Express phục vụ luôn cả frontend tĩnh (`public/`, cùng
domain — không cần cấu hình CORS trong vận hành thông thường), dữ liệu lưu SQL
Server (SQL Server) — phần lớn dữ liệu cấu hình (người dùng, phân quyền, quy
trình mẫu...) gộp trong bảng `dbo.AppData` theo dạng 1 collection/1 dòng JSON,
còn dữ liệu nghiệp vụ phát sinh nhiều (Tài liệu, Văn bản trình, Công việc, Nhật
ký hệ thống...) đã tách sang bảng riêng khoá theo từng dòng. Xác thực bằng
phiên đăng nhập JWT ký ở server (cookie `httpOnly`), server tự kiểm tra lại
quyền trên **mỗi request** chứ không chỉ tin giao diện ẩn/hiện nút. Production
chạy PM2 **cluster mode** (nhiều tiến trình Node tận dụng hết CPU máy chủ) —
ứng dụng thiết kế stateless giữa các request nên chạy nhiều tiến trình song
song an toàn.

```
[Nhân viên / Quản lý / Admin — trình duyệt]
        │  HTTPS (JWT cookie httpOnly)
        ▼
[Node.js/Express — PM2 cluster] ──── phục vụ luôn giao diện (public/) + API
        │
        ▼
[SQL Server] — dbo.AppData (cấu hình) + dbo.SystemLogs/Tasks/Docs/Contracts/... (hồ sơ nghiệp vụ, mỗi collection 1 bảng riêng)
```

**Ai dùng gì**:
- **Mọi nhân viên** — Trang chủ, Hộp Thư Phê Duyệt, Hồ Sơ Cá Nhân/Bảo Mật
  Thiết Bị (mục 2) đều mở sẵn cho mọi tài khoản; Tài Liệu, Văn Bản Trình, Công
  Việc, Truyền Thông Nội Bộ, Hỗ Trợ IT (ticket), đăng ký Xe/Phòng Họp/VPP cũng
  mở sẵn (admin có thể tắt riêng từng module qua "0. Quyền Truy Cập Module",
  mục 6).
- **Trưởng phòng/người được gán quyền duyệt** — xử lý hồ sơ chờ duyệt của
  phòng/bước mình phụ trách qua Hộp Thư Phê Duyệt (mục 2), theo cơ chế chung ở
  mục 3.
- **Admin/Quản trị** — toàn bộ mục 6 và 7 dưới đây, cộng phần cấu hình quy
  trình duyệt ở mục 3.

---

## 2. Nền Tảng Dùng Chung (Mọi Người, Mọi Ngày)

4 mục dưới đây không phải "module nghiệp vụ" theo nghĩa tạo/duyệt hồ sơ — đây
là lớp hạ tầng mọi tài khoản đều chạm vào mỗi lần đăng nhập, nên đặt lên đầu
thay vì rải rác theo tên phòng ban như các module nghiệp vụ ở mục 4.

### 2.1. Trang chủ (Dashboard)

Màn hình đầu tiên sau khi đăng nhập — **vai trò**: cho biết ngay "có việc gì
đang chờ mình" mà không cần tự đi tìm ở từng module. Mỗi thẻ số liệu (VD "N hồ
sơ Tài Liệu chờ duyệt") chỉ hiện nếu người dùng có quyền liên quan **và** đang
thực sự có việc chờ (đếm bằng 0 thì thẻ tự ẩn) — dashboard tự cá nhân hoá theo
đúng quyền của từng người, không phải 1 màn tĩnh giống nhau cho mọi người.
Nút **"⚙️ Tuỳ chỉnh"** mở hộp cho tự ẩn/hiện từng thẻ theo ý thích riêng — lựa
chọn này lưu vào hồ sơ người dùng trên server (không phải chỉ lưu tạm trên máy)
nên đăng nhập ở máy khác vẫn giữ đúng tuỳ chỉnh đã chọn. Có thêm 1 khối tin tức
nổi bật (Nhịp Sống HCRC/Đào tạo...) nếu tài khoản có quyền vào Truyền Thông Nội
Bộ (mục 4.1).

### 2.2. Hộp Thư Phê Duyệt (✅ Phê Duyệt)

**Vai trò**: 1 nơi DUY NHẤT gom mọi hồ sơ đang chờ đúng người dùng hiện tại
duyệt, từ toàn bộ module có luồng phê duyệt — không phải chuyển qua từng
module để dò tìm hồ sơ cần xử lý. Đây là màn dùng hằng ngày của bất kỳ ai giữ
quyền "Người duyệt" (`canBeApprover`) ở bất kỳ module nào. Cơ chế hoạt động đầy
đủ (tự làm mới định kỳ, duyệt tại Hub tương đương duyệt tại module gốc...)
trình bày chi tiết ở mục 3.4 — mục này chỉ nêu **vai trò**: đây là nơi làm việc
chính của "người duyệt", còn mục 3 là cách admin *cấu hình* ai được vào vai đó.

### 2.3. Hồ Sơ Cá Nhân & Bảo Mật Thiết Bị (2FA)

Bấm avatar/tên ở góc màn hình mở **"⚙️ Cá Nhân Hóa & Cập Nhật Thông Tin"** —
nơi mỗi người tự quản lý thông tin và cách đăng nhập của chính mình:

- **🖐️ Đăng Nhập/Xác Thực Bằng Vân Tay, Face ID (WebAuthn)** — mỗi người tự
  đăng ký thiết bị của mình (phải đăng nhập bằng mật khẩu ít nhất 1 lần trước).
  Sau khi đăng ký, có thể đăng nhập bằng vân tay/Face ID thay vì gõ mật khẩu,
  và admin có thể đặt mức xác thực khi Duyệt của người này thành "Yêu cầu vân
  tay/Face ID" (mục 3.1 nói về các chế độ gán người duyệt; mức xác thực khi
  Duyệt là 1 lớp khác, cấu hình ở khối "9. Người Duyệt" cây phân quyền — mục
  6). **Cần máy chủ chạy HTTPS thật** — không dùng được nếu server chỉ chạy
  `http://` LAN thường (xem `Huong-dan-trien-khai-PM2.md`).
- **TOTP (mã 6 số dùng app xác thực)** — **bắt buộc tự động** với mọi tài
  khoản có quyền `admin` (màn hình thiết lập hiện ra ngay, không thể bỏ qua ở
  lần đăng nhập đầu chưa có TOTP); tài khoản thường không bị bắt buộc.
- **Admin quản lý hộ người khác** (ở form Sửa Người Dùng): xem/thu hồi thiết bị
  vân tay đã đăng ký của bất kỳ ai (VD nhân viên mất điện thoại), và xem/thu
  hồi TOTP của các tài khoản **admin khác** — không có thao tác "bắt buộc bật
  TOTP" cho 1 tài khoản thường bất kỳ, quy tắc bắt buộc chỉ áp dụng tự động cho
  `admin`.

### 2.4. Cài Đặt Ứng Dụng (PWA)

Cùng trong "⚙️ Cá Nhân Hóa", mục **"📲 Cài Đặt Ứng Dụng"** cho phép "cài" HCRC
Workspace như 1 ứng dụng riêng trên điện thoại/máy tính (icon riêng, mở không
qua trình duyệt) — **vai trò**: tiện truy cập nhanh, không phải để dùng
offline. Trên Android/Chrome, cài xong có thể nhấn giữ icon để mở nhanh thẳng
vào 1 trong tối đa **4 module** — admin chọn đúng 4 module nào hiện ở đây tại
"Hệ Thống → Quản Trị → Quản Lý Danh Mục → 📲 Phím Tắt PWA" (mục 7). iPhone/iPad
(Safari) cài thủ công qua Share → "Thêm vào MH chính" và không hỗ trợ phím tắt
(giới hạn của Apple). Cũng cần HTTPS thật để hoạt động đúng chuẩn trên điện
thoại thật.

### 2.5. 📘 Hướng Dẫn (tài liệu quy trình trực quan — từ v23.1, đổi tên + chia 2 tab từ v23.63)

Nút sidebar **"📘 Hướng Dẫn"** (tên cũ **"Nghiệp vụ"**, đặt ngay trước "📊 Báo
Cáo") — **vai trò**: màn tra cứu nhanh "chức năng này hoạt động thế nào" bằng
sơ đồ quy trình + diễn giải ngắn, thay vì phải đọc hết tài liệu này. Mở được
(vào được cả màn) cho **mọi tài khoản đã đăng nhập**. Từ **v23.63**, bên
trong chia **2 tab** (`.nv-section-tabs`, `setNVActiveSection()` ở
`module-nghiepvu.js`):

- **📘 Nghiệp Vụ** — nội dung nghiệp vụ như trước đây, KHÔNG đổi gì. Từ
  **v23.28** mỗi MỤC bên trong chỉ hiện cho người ĐÃ có đúng quyền vào
  module THẬT tương ứng (VD chỉ thấy mục "Lương" nếu có quyền vào module
  Lương thật — xem `canViewNVItem()`/`NV_KEY_ACCESS_FN`, tái dùng thẳng các
  hàm `canAccessXModule()` đã có, không tạo lớp quyền song song). 2 cách mở
  rộng thêm (cây phân quyền, khối "24. Nghiệp Vụ & Báo Cáo"):
  - **"👁️ Xem Toàn Bộ Mục Nghiệp Vụ"** (`perms.nghiepVuViewAll`) — bỏ qua
    giới hạn trên, xem được TẤT CẢ mục dù không có quyền module tương ứng.
  - **"📘 Mở Thêm Mục Nghiệp Vụ"** (`user.nghiepVuExtraKeys`, ở màn Sửa
    Người Dùng, KHÔNG gán qua Nhóm Phân Quyền được vì là field riêng của
    từng người) — mở thêm TỪNG mục cụ thể mà không cần bật cả quyền module thật.
- **⚙️ Hệ Thống** (mới từ v23.63, xem mục 7 bên dưới) — 11 mục cấu hình/quản
  trị (Phân Quyền, Người Dùng, Quy Trình & Phê Duyệt, Quản Lý Danh Mục, Biểu
  Mẫu, Quản Lý Tệp File, Thùng Rác, Nhật Ký Hệ Thống, Cấu Hình Email, API Đối
  Tác Ngoài, Sơ Đồ Kiến Trúc Hệ Thống). **CHỈ hiện tab này khi
  `user.perms.admin === true`** (`nvCanSeeSystemSection()`) — KHÔNG bypass
  được qua `nghiepVuViewAll`/`nghiepVuExtraKeys` như tab Nghiệp Vụ (2 cơ chế
  đó chỉ áp dụng cho tab Nghiệp Vụ), và server không liên quan gì (đây thuần
  là màn tài liệu tham khảo, không có API riêng) — tab bar hoàn toàn không
  render nếu không phải admin, không phải chỉ ẩn bằng CSS.

Nav trái của tab Nghiệp Vụ nhóm theo 10 nhóm đúng cách người dùng vận hành
thực tế (Văn Bản & Tác Nghiệp / Truyền Thông Nội Bộ / Điều Hành / Hành Chính
/ Tổng Hợp / Vận Hành / Nhân Sự / Hỗ Trợ IT / Mua Hàng) — khác thứ tự phẳng
phân quyền nội bộ, chỉ là cách trình bày cho người đọc; tab Hệ Thống có nav
trái riêng (`SYSTEM_NAV`), 6 nhóm (Phân Quyền & Tài Khoản / Cấu Hình Quy
Trình / Danh Mục & Biểu Mẫu / Vận Hành Hệ Thống / Tích Hợp & Thông Báo /
Kiến Trúc). Mỗi mục hiện: mô tả ngắn, 1 sơ đồ quy trình
(node bo góc + mũi tên có hướng; nhánh quyết định viền xanh rẽ 2 màu xanh
"duyệt"/đỏ "từ chối"; khung tham chiếu danh mục nét đứt nếu có; mũi tên vòng
lặp cong khi bị từ chối/làm lại), và khối **"Điểm Chặn Quan Trọng"/"Cơ Chế
Đáng Chú Ý"** 2 cột tóm tắt các ràng buộc/cơ chế đáng lưu ý nhất. Riêng
**🎓 Đào Tạo** (module lớn nhất) có thêm 1 hàng pill chọn 8 khu vực con — mở
đầu bằng **🧭 Tổng Quan** (sơ đồ QUAN HỆ dạng hub, khác kiểu chuỗi tuần tự:
Lớp Học là trung tâm nhận Chương Trình/Kho Tài Liệu/Ngân Hàng Câu Hỏi/Giảng
Viên và mời Học Viên, còn Lộ Trình Tân Binh/Lộ Trình Thăng Tiến đều xây từ
nhiều Chương Trình), rồi tới Lớp Học/Chương Trình/Kế Hoạch Đào Tạo/Kho Tài
Liệu/Ngân Hàng Câu Hỏi/Lộ Trình Tân Binh (nhân viên mới, có đánh giá GĐ3 +
cấp chứng chỉ — khác Onboarding hành chính của Nhân Sự)/Lộ Trình Thăng Tiến.

**Khối "🛠️ Cách Thao Tác" (từ v23.54)**: nằm giữa sơ đồ quy trình và khối
"Lưu Ý/Mẹo" — hướng dẫn CLICK-BY-CLICK (bấm nút gì, tab nào, theo đúng thứ tự
thao tác thật trên giao diện), khác `flow`/footer vốn giải thích NGHIỆP VỤ/
quy tắc chứ không nói thao tác cụ thể. Mỗi bước có thể gắn nhãn vai trò (VD
"Người đăng ký"/"Người duyệt") nếu bước đó do 1 vai trò cụ thể thực hiện.
Trình bày THUẦN TEXT (không kèm ảnh chụp màn hình, để không lạc hậu khi UI
đổi) và là field TUỲ CHỌN theo từng mục — mục nào chưa viết thì khối này tự
ẩn. **Từ v23.55: đã có ở toàn bộ 33 mục nghiệp vụ thao tác thật** (chỉ 2 mục
thuần xem/sơ đồ tham khảo không có, không cần "Cách Thao Tác": "🗺️ Sơ Đồ
Kiến Trúc Hệ Thống" và "🧭 Tổng Quan" của Đào Tạo). Module/tính năng nghiệp
vụ MỚI về sau vẫn nên viết thêm `steps` ngay khi thêm entry `NGHIEP_VU_DOCS`,
theo đúng quy tắc ở mục "Module mới → bắt buộc cập nhật Nghiệp Vụ" (CLAUDE.md).

Đây là bản **tóm tắt trực quan** — mục 3-7 phía dưới của tài liệu này vẫn là
nguồn tham khảo **đầy đủ và chi tiết nhất** (mỗi trang Nghiệp Vụ đều có link
trỏ lại đúng mục tương ứng ở cuối trang). **Quy tắc bắt buộc** (xem
`CLAUDE.md`): module/tính năng nghiệp vụ mới phải thêm 1 entry vào
`NGHIEP_VU_DOCS` (`public/js/module-nghiepvu.js`) NGAY trong cùng đợt merge
tạo module đó — mục nào thiếu entry sẽ tự hiện cảnh báo "⚠️ Chưa có tài liệu
nghiệp vụ" ngay trên màn thật, dùng chính cảnh báo đó làm tín hiệu chưa cập
nhật thay vì phải nhớ tay.

---

## 3. Mô hình quy trình phê duyệt chung

Đây là cơ chế **cross-cutting** quan trọng nhất hệ thống — hơn 15 module dùng
chung 1 khuôn quy trình phê duyệt theo phòng ban/tier (`WF_MODULE_CONFIG` ở
`public/js/module-workflow.js`, engine thật ở `lib/workflowEngine.js`): Tài
Liệu, Văn Bản Trình (theo từng loại tờ trình), Đăng Ký Xe, Mua Sắm/Sửa Chữa Văn
Phòng, Văn Phòng Phẩm, Hợp Đồng (2 quy trình tách riêng: Phê Duyệt gốc và Quản
Lý HĐ/tài liệu ký), Hỗ Trợ IT (Phê Duyệt Giá bán lẻ theo phòng ban + bán buôn
theo 4 mức Margin/Chiết khấu cố định), Ngân Sách, **Thanh Toán** ("Chuyển Xác
Nhận Thanh Toán"), và Vận Hành > Đặt Hàng (theo mức giá trị đơn hàng, tách
riêng Siêu Thị/HO). Mở Mới/Sửa Chữa Siêu Thị (xem mục 4.4) **không** dùng
quy trình này nữa — không có bước phê duyệt nào cả, kể cả giai đoạn Dự toán.
Riêng Thanh Toán
**không** có bước Từ Chối qua engine này (chỉ Duyệt) — cần trả lại thì dùng
"Yêu Cầu Bổ Sung" (kênh riêng, không đổi).

Admin cấu hình tất cả các quy trình này tại **Hệ Thống → 🔄 Quy Trình & Phê
Duyệt** (mục 7) — mỗi module 1 màn riêng, mỗi bước duyệt của mỗi phòng ban/tier
cấu hình độc lập.

### 3.1. 3 cách gán người duyệt cho 1 bước

Mỗi bước duyệt (của mỗi phòng ban/tier) chọn đúng 1 trong 3 chế độ:

| Chế độ | Cách hoạt động | Ghi chú |
|---|---|---|
| **Theo người** (PEOPLE — mặc định) | Admin chọn tay 1 hoặc nhiều người cụ thể làm người duyệt bước đó | Không tự tái kiểm tra quyền "Người duyệt" tại thời điểm duyệt — người đã được thêm vẫn duyệt được kể cả nếu sau đó bị rút quyền (hành vi cũ, giữ nguyên) |
| **Theo phòng ban** | Toàn bộ người có quyền "Người duyệt" (xem 3.2) đang thuộc phòng ban cấu hình cho bước đó | Dùng cho các bước kiểu "ai trong phòng X có quyền duyệt cũng duyệt được" |
| **Theo vị trí** (POSITION) | Bật toggle "🧭 Theo vị trí" ở bước đó, chọn 1 hoặc nhiều **vị trí** (cặp chức danh + phòng ban — phòng ban có thể để trống, xem 3.3) thay vì chọn tay người cụ thể | Hệ thống **tự tra động** người thật đang giữ đúng vị trí đó mỗi lần cần duyệt — luôn phản ánh đúng ai đang giữ chức vụ hiện tại, không cần admin sửa lại khi nhân sự đổi vị trí. Vị trí không ghép phòng ban khớp theo CHỈ chức danh, bất kể người đó thuộc phòng ban nào |

**Điểm bảo mật cốt lõi của chế độ Theo vị trí**: khớp đúng vị trí **chỉ là
điều kiện lọc bớt** — người đó vẫn phải có quyền "Người duyệt" (`canBeApprover`,
xem 3.2) mới thực sự duyệt được. Nếu **không** bật "Theo vị trí", bước đó vẫn
dùng chế độ Theo người/Theo phòng ban như trước — không có gì thay đổi, và vẫn
luôn cần quyền "Người duyệt" mới duyệt được (trừ chế độ Theo người, vốn không
tái kiểm tra quyền này như đã nêu ở bảng trên).

### 3.1a. Nhãn hành động theo bước (từ v22.6)

Mặc định, mọi bước duyệt hiển thị nút bấm + chân ký in là "Phê Duyệt"/"ĐÃ PHÊ
DUYỆT". Từ v22.6, **mỗi bước tự đặt được nhãn hành động riêng** — VD một bước
thực chất chỉ là "xác nhận" hay "thẩm định" (không phải phê duyệt theo đúng
nghĩa) thì đặt nhãn "Xác Nhận"/"Đã Thẩm Định" thay vì để mặc định "Phê Duyệt".

Cấu hình ngay tại **Hệ Thống → 🛠️ Định Nghĩa Các Mẫu Bước Phê Duyệt**: mỗi
dòng bước giờ có 2 ô — "Tên bước" (vai trò/chức danh, VD "Điều Hành Xe", VẪN
GIỮ NGUYÊN như cũ, chỉ để admin dễ nhận diện) và **"Nhãn hành động"** (để
trống = mặc định "Phê Duyệt", như hành vi cũ). Sau khi lưu mẫu, nhãn này tự
động ăn theo ở **cả 2 nơi** cho MỌI hồ sơ đi qua bước đó, không cần sửa gì
thêm:
- **Chân ký in** trên phiếu duyệt (Đăng Ký Xe, Văn Bản Trình, VPP/Văn
  Phòng) — đổi "✅ ĐÃ PHÊ DUYỆT" thành "✅ ĐÃ &lt;NHÃN&gt;" (VD "✅ ĐÃ XÁC NHẬN").
- **Nút bấm + hộp thoại xác nhận** khi người duyệt xử lý hồ sơ — áp dụng cho
  toàn bộ module dùng chung engine phê duyệt theo bước ở mục 3 (Đăng Ký Xe,
  Văn Bản Trình, VPP, Văn Phòng, Ngân Sách, Vận Hành, Hợp Đồng — cả 2 luồng
  Phê Duyệt/Quản Lý HĐ, Hỗ Trợ IT > Phê Duyệt Giá, Tài Liệu, Thanh Toán).

Đổi nhãn hành động **không** ảnh hưởng tới ai được duyệt hay thứ tự bước —
chỉ đổi CHỮ hiển thị trên nút/chân ký, mọi logic phân quyền/chuyển bước giữ
nguyên 100%.

**Xoá 1 mẫu quy trình — chặn đầy đủ hơn (từ đợt rà soát cụm Hệ Thống/Admin/Cấu
Hình)**: hệ thống vốn đã chặn xoá 1 mẫu đang được gán ở đâu đó, nhưng vòng
kiểm tra cũ chỉ đọc được các cấu hình "phẳng" (theo phòng ban hoặc theo mức giá
trị) và **bỏ sót các cấu hình LỒNG**: Văn Bản Trình (theo *loại tờ trình* ×
phòng ban), Hỗ Trợ IT > Phê Duyệt Giá (theo *phòng ban* × loại giá) và cấu hình
chung cũ của Văn Bản Trình. Xoá mẫu đang được các nơi đó dùng vẫn "thành công"
và quy trình N bước của những phòng ban/loại ấy **âm thầm co về 1 bước mặc
định**. Nay vòng kiểm tra quét đệ quy đủ các dạng cấu hình, liệt kê chính xác
nơi đang dùng và từ chối xoá cho tới khi admin đổi các nơi đó sang mẫu khác.

**Nút "🖨️ In" khớp đúng format "👁️ Xem Phiếu" (từ 9/2026)** — trước đây nút In
ngay trong màn Xem (dùng chung cho mọi module, kể cả Phiếu Phê Duyệt) in ra
HOÀN TOÀN không có định dạng (chữ dồn 1 khối, mất hết bảng/khung/chân ký) do
khung in không nạp được CSS của trang chính. Đã vá 1 chỗ dùng chung, khắc phục
đồng thời cho cả 3 module có Phiếu Phê Duyệt (Đăng Ký Xe, Văn Bản Trình, VPP/
Văn Phòng) — nút "⬇️ Tải Phiếu" (tải file riêng) không bị ảnh hưởng, đã đúng từ
trước.

### 3.1b. Ý kiến từng bước hiện trên phiếu in (từ v22.9)

Mỗi bước duyệt đều có ô ghi chú/ý kiến (nhập lúc bấm nút hành động, VD "Cho Ý
Kiến"/"Xác Nhận"/"Phê Duyệt"). Từ v22.9, **phiếu in "Phiếu Phê Duyệt"** (Đăng
Ký Xe, Văn Bản Trình, VPP/Văn Phòng — cả bản xem trực tiếp trong app lẫn file
`.html` tải về) hiện ĐÚNG ý kiến của **từng bước**, đặt ngay dưới tên/chữ ký
người thực hiện bước đó (khung nhỏ, chữ nghiêng). Trước v22.9, phiếu in chỉ
hiện được ý kiến của bước duyệt CUỐI CÙNG — ý kiến của các bước ở giữa (nếu
có) bị rớt mất khỏi bản in dù vẫn còn lưu trong lịch sử hồ sơ.

**Ứng dụng thực tế**: muốn có "ý kiến đánh giá của bộ phận chuyên môn" trước
khi người có thẩm quyền phê duyệt cuối cùng (VD đề xuất Sửa Chữa tài sản, đối
chiếu Mẫu BM-TS02 trong quy trình quản lý tài sản) — chỉ cần vào **Hệ Thống →
Quy Trình & Phê Duyệt** (VD "🔧 QT Sửa Chữa" cho `Tổng Hợp (Mua Bán - Sửa
Chữa - Thanh Toán)` → hồ sơ Sửa Chữa), thêm 1 bước tên "Bộ Phận Chuyên Môn"
(đặt Nhãn hành động là "Cho Ý Kiến" theo mục 3.1a) đứng TRƯỚC bước phê duyệt
chính thức, gán đúng người/phòng phụ trách kỹ thuật. Không cần sửa code —
ý kiến bước này tự động hiện trên phiếu in ngay khi lưu quy trình.

### 3.2. Quyền "Người duyệt" (`canBeApprover`)

Đây là 1 checkbox trong cây phân quyền của từng người dùng (khối "1. Hệ Thống
& Chung") — **điều kiện cần** để 1 người thực sự duyệt được hồ sơ (ở chế độ
Theo phòng ban/Theo vị trí — chế độ Theo người không tái kiểm tra, xem 3.1).
Một người có tên/vị trí đúng như cấu hình bước duyệt nhưng **chưa được cấp**
quyền này thì vẫn không duyệt được gì — đây là lỗi cấu hình thường gặp nhất:
"đã chọn đúng vị trí ở Quy Trình & Phê Duyệt nhưng người đó vẫn không thấy nút
Duyệt" → kiểm tra lại quyền "Người duyệt" của người đó trước.

### 3.3. Danh mục "Nhóm Quyền Đặc Biệt"

Tại **Hệ Thống → 🔀 Quy Trình Nâng Cao → 🧩 Nhóm Quyền Đặc Biệt** (từ v23.65 —
trước đó là khối 17 trong cây phân quyền của form Sửa Người Dùng, đã dời ra
vì đây là cấu hình CHUNG toàn hệ thống, không gắn với riêng tài khoản nào) có
3 danh mục dùng ô "chọn nhiều thật" (gõ tìm, bấm chọn, chip xoá được ngay
trong ô):

1. **Đơn vị tham gia quy trình** (`workflowParticipatingDepts`) — lọc bớt danh
   sách phòng ban hiển thị ở màn Quy Trình & Phê Duyệt (để trống = hiện đầy đủ
   mọi phòng ban như mặc định).
2. **Chức danh bị loại khỏi VPP** (`vppExcludedJobTitles`) — chức danh không
   được cấp Văn Phòng Phẩm (không tính vào đầu người/ngân sách VPP của phòng).
3. **🧭 Vị Trí Tham Gia Quy Trình** (`workflowParticipatingPositions`) — danh
   mục các **cặp (chức danh, phòng ban)** admin tự dựng, vì chức danh trong hệ
   thống vốn generic (VD "Trưởng phòng" không tự phân biệt được "Trưởng phòng
   IT" với "Trưởng phòng Nhân Sự") — mỗi cặp là 1 "vị trí" độc lập, dùng làm
   nguồn chọn cho bước duyệt "Theo vị trí" (3.1). Có thể khai báo trước cả khi
   chưa có ai thực sự giữ đúng vị trí đó.

   **Cách thêm 1 vị trí (từ v22.1)**: gõ/chọn **"Chức danh"** (bắt buộc, ô
   gõ-tìm-chọn gợi ý theo `DB.jobTitles`/chức danh Siêu Thị) rồi tuỳ chọn ghép
   thêm **"Phòng ban"** (gõ-tìm-chọn gợi ý theo `DB.depts`/tên siêu thị) — bấm
   **"➕ Thêm"** để đưa cặp vào danh sách chip bên dưới (xoá bằng nút "×" trên
   từng chip), xong thì bấm "Lưu" 1 lần. **Để trống ô Phòng Ban** nếu chức
   danh này áp dụng cho **MỌI** phòng ban/đơn vị (VD "Tổng Giám Đốc" — không
   cần/không nên ghép riêng 1 phòng ban cụ thể): 1 vị trí như vậy khớp bất kỳ
   ai đang giữ đúng chức danh đó, bất kể họ thuộc phòng ban nào. (Trước v22.1
   chỉ chọn được từ 1 danh sách tích chéo dựng sẵn toàn bộ chức danh × phòng
   ban — vừa sinh ra nhiều tổ hợp không có thật, vừa không cách nào bỏ qua
   phòng ban cho 1 chức danh — đã đổi hẳn sang cách trên.)

   **Tài khoản Siêu Thị (posType=STORE) cũng nằm trong ô chọn này** (từ
   v22.0): ô "🧭 Theo vị trí" ghép sẵn mọi cặp (chức danh Siêu Thị, tên siêu
   thị) — VD "Giám Đốc Siêu Thị — Siêu Thị A" — vì tài khoản Siêu Thị dùng 2
   danh mục chức danh/đơn vị RIÊNG (khác hẳn danh mục chức danh/phòng ban của
   khối văn phòng). Nhờ vậy admin có thể cấu hình bước duyệt **Phê Duyệt Giá
   Siêu Thị** (Hỗ Trợ IT → Duyệt giá) để mỗi siêu thị tự động do ĐÚNG giám đốc
   siêu thị đó duyệt: bật "🧭 Theo vị trí" ở bước tương ứng trong luồng của
   từng siêu thị, chọn đúng cặp "Giám Đốc Siêu Thị — <tên siêu thị đó>" (nhớ
   vẫn phải cấp quyền "Người duyệt"/`canBeApprover` cho tài khoản giám đốc thì
   mới thực sự duyệt được — xem lưu ý bảo mật cốt lõi ở 3.1).
   **Lưu ý: Xác Nhận Đồng Phục KHÔNG dùng cơ chế "Theo vị trí"/chức danh** —
   mô-đun Đồng Phục xác định giám đốc siêu thị được xác nhận nhận hàng qua
   quyền cờ riêng `uniformStoreManage` (cấp thủ công theo từng tài khoản ở
   Phân Quyền) kết hợp `dept` của tài khoản đó trùng tên siêu thị trên phiếu —
   gán chức danh không có tác dụng gì ở mô-đun này.

> Đây là danh mục "Theo vị trí" đơn giản, dùng riêng cho việc **gán bước
> duyệt**. Nhân Sự cũng có 1 khái niệm "vị trí" khác, đầy đủ hơn (cây tổ chức
> có thứ bậc, xem mục 4.5) dùng để tự động tính Quản Lý Trực Tiếp + luồng đánh
> giá KPI — 2 khái niệm **không dùng chung dữ liệu**, chỉ giống nhau về ý
> tưởng "chức danh + phòng ban = 1 vị trí".

#### "Vị Trí Kiêm Nhiệm" (1 người giữ thêm vị trí phụ, chỉ để tính người duyệt)

Cơ Cấu Tổ Chức (mục 4.5) chỉ cho 1 người giữ đúng **1** cặp Chức Danh/Phòng Ban
chính thức tại 1 thời điểm — không hỗ trợ "kiêm nhiệm" nhiều chức danh/phòng
ban cùng lúc, vì Quản Lý Trực Tiếp/luồng KPI/Chấm công (work-model theo
`posType`) đều cần đúng 1 vị trí duy nhất để tính toán, không mơ hồ được.

Để vẫn đáp ứng nhu cầu "1 người kiêm thêm 1-2 vị trí khác chỉ để được tính là
người duyệt/tham gia quy trình 'Theo vị trí' ở module khác" mà **không** đổi
kiến trúc 1-vị-trí-chính thức nói trên, mỗi user có thêm 1 trường tuỳ chọn
**"🏷️ Vị Trí Kiêm Nhiệm"** ở form **Sửa Người Dùng** (dưới ô Chức Danh/Phòng
Ban chính, cùng khối với ô "Là tài xế"):

- Chọn nhiều từ danh mục **🧭 Vị Trí Tham Gia Quy Trình** (`workflowParticipatingPositions`,
  mục 3.3) — ô "chọn nhiều thật" (gõ tìm, bấm chọn, chip xoá được), giống hệt
  thao tác ở "Nhóm Quyền Đặc Biệt".
- Mỗi vị trí kiêm nhiệm chọn thêm sẽ được cộng vào tập (chức danh, phòng ban)
  dùng để khớp bước duyệt **"Theo vị trí"** (3.1) cho người đó — **CHỈ** ảnh
  hưởng bước duyệt "Theo vị trí" ở các module khác (Ngân Sách, Hỗ Trợ IT...).
  **KHÔNG** đổi Chức Danh/Phòng Ban chính thức của người đó, **KHÔNG** ảnh
  hưởng Quản Lý Trực Tiếp/luồng đánh giá KPI (Cơ Cấu Tổ Chức, mục 4.5), và
  **KHÔNG** ảnh hưởng Chấm công/work-model (Công&Phép, mục 4.x).
- Vẫn giữ nguyên **điểm bảo mật cốt lõi** ở 3.1: khớp vị trí kiêm nhiệm chỉ là
  điều kiện lọc bớt — người đó vẫn phải có quyền "Người duyệt" (`canBeApprover`,
  3.2) mới thực sự duyệt được.
- Để trống (mặc định) = hành vi hoàn toàn như cũ, người đó chỉ được tính theo
  đúng 1 cặp Chức Danh/Phòng Ban chính thức.

**Ví dụ**: Chị A chính thức là "Nhân viên — Phòng Kinh Doanh" nhưng thực tế
còn kiêm phụ trách duyệt hồ sơ Ngân Sách với vai trò "Trưởng phòng — Phòng Kế
Toán" (không đổi chức danh/phòng ban chính thức của chị A). Vào Sửa Người
Dùng của chị A, thêm "Trưởng phòng — Phòng Kế Toán" vào ô "Vị Trí Kiêm Nhiệm"
(danh mục này phải có sẵn cặp đó ở "Nhóm Quyền Đặc Biệt" trước) → chị A sẽ được tính là
người duyệt ở bất kỳ bước "Theo vị trí" nào cấu hình đúng cặp đó, miễn là chị
A đã có quyền "Người duyệt".

### 3.4. Hộp Thư Phê Duyệt (Approval Hub) — cơ chế đầy đủ

**Hệ Thống → ✅ Phê Duyệt** (vai trò tóm tắt ở mục 2.2) — hộp thư tổng hợp
**1 nơi duy nhất** cho mọi hồ sơ đang chờ đúng người dùng hiện tại duyệt, gom
từ toàn bộ module có luồng phê duyệt. Tự làm mới định kỳ (polling nhẹ, không
cần bấm F5, không dùng WebSocket) — hồ sơ mới cần duyệt hiện lên gần như ngay
lập tức. Nút Duyệt/Từ chối ở đây gọi thẳng lại đúng hàm xử lý gốc của module
đó — duyệt ở Hub và duyệt tại màn module gốc là **hoàn toàn tương đương**,
không có rủi ro lệch hành vi (email thông báo, chuyển bước, tự tạo Công việc
liên quan... vẫn chạy đầy đủ như duyệt tại module gốc).

Cột "Phân hệ" ở danh sách tự phân biệt rõ luồng con cho các module gộp chung
nhiều luồng phê duyệt khác nhau trong 1 collection, không hiện chung 1 nhãn mơ
hồ: Hỗ Trợ IT - Duyệt Giá hiện đúng "Duyệt giá Bán Buôn"/"Duyệt giá Bán Lẻ"
(theo `priceType`); Vận Hành - Đơn Hàng hiện đúng "Đặt Hàng Tại HO"/"Đặt Hàng
Tại Siêu Thị" (theo `orderLocationType`), kể cả mục "Chờ Nhập Hàng" và "Từ
chối khẩn cấp" của 2 module này.

### 3.5. Ví dụ cấu hình cụ thể

**Yêu cầu**: "Trưởng phòng Pháp Chế duyệt bước 2 của quy trình Hợp Đồng."

1. Vào **Hệ Thống → 🔀 Quy Trình Nâng Cao → 🧩 Nhóm Quyền Đặc Biệt → 🧭 Vị Trí
   Tham Gia Quy Trình** — gõ tìm "Trưởng phòng — Pháp Chế" (chức danh × phòng ban), nếu
   chưa có thì thêm chức danh "Trưởng phòng" (nếu phòng "Pháp Chế" và chức danh
   "Trưởng phòng" đã tồn tại trong danh mục chung), bấm chọn, bấm **Lưu**.
2. Vào **Hệ Thống → 🔄 Quy Trình & Phê Duyệt → Hợp đồng - Phê duyệt**, tìm
   đúng bước 2 của quy trình, bật toggle **"🧭 Theo vị trí"**, chọn vị trí vừa
   thêm ở bước 1, bấm **Lưu**.
3. Xác nhận người thật đang giữ chức danh "Trưởng phòng" tại phòng "Pháp Chế"
   đã được cấp quyền **"Người duyệt"** (`canBeApprover`, xem 3.2) ở form Sửa
   Người Dùng của họ — nếu chưa, họ sẽ khớp đúng vị trí nhưng vẫn không duyệt
   được (xem cảnh báo ở 3.2).
4. Kiểm tra lại: màn cấu hình bước duyệt sẽ hiện ngay bản xem trước "đã tra ra
   người thật" nếu đúng người đang giữ vị trí này có sẵn quyền Người duyệt.

**Bảng tra nhanh khi hồ sơ "không ai duyệt được"**: bước đang ở chế độ nào
(Theo người/Theo phòng ban/Theo vị trí) → nếu Theo vị trí: đã có ai thật sự
giữ đúng vị trí đó chưa (form Sửa Người Dùng có ô Chức danh + Phòng ban) → nếu
có người giữ vị trí: người đó đã có quyền "Người duyệt" chưa (3.2) → nếu Theo
phòng ban: có ai trong phòng đó có quyền "Người duyệt" chưa.

### 3.6. "⚡ Áp Dụng Nhanh" (sub-tab của "🔀 Quy Trình Nâng Cao")

**Hệ Thống → 🔀 Quy Trình Nâng Cao → ⚡ Áp Dụng Nhanh** (từ v23.65 — trước đó
là 1 tab CẤP CAO NHẤT riêng ngang hàng "🔄 Quy Trình & Phê Duyệt", nay gộp
vào umbrella "Quy Trình Nâng Cao" cùng 3 mục cấu hình nâng cao khác) — tiện
ích để set NHANH **số bước** (chọn 1 mẫu quy trình đã định nghĩa sẵn ở khối "🛠️ Định
Nghĩa Các Mẫu Bước Phê Duyệt" bên tab "Quy Trình & Phê Duyệt") cho những
phòng ban/mức đang thiếu cấu hình, thay vì phải vào từng thẻ phòng ban của
từng module một để chọn số bước tay.

Khác với thiết kế cũ (chỉ chọn được 1 mẫu rồi áp cho TẤT CẢ module cùng
lúc), từ v22.3 màn này quản lý **danh sách nhiều cấu hình độc lập** — mỗi
cấu hình là 1 cặp **(mẫu quy trình, danh sách module muốn gắn)**, admin tự
chọn module nào áp mẫu nào: VD tạo 1 cấu hình gắn "Quy trình 1 bước" cho
Đăng Ký Xe + Mua Sắm VPP, tạo thêm 1 cấu hình khác gắn "Quy trình 2 bước"
cho Giá IT + Ngân Sách — không còn bắt buộc chọn 1 mẫu duy nhất áp cho toàn
bộ hệ thống. Mỗi cấu hình có 4 nút riêng: **"🔍 Xem Trước"** (xem danh sách
phòng ban/mức sẽ bị điền, chỉ trong phạm vi module của cấu hình đó),
**"⚡ Áp Dụng"**, **"✏️ Sửa"** (đổi lại mẫu/phạm vi module của cấu hình đã
tạo), **"🗑️ Xoá"** (chỉ xoá cấu hình, không ảnh hưởng gì tới các mục ĐÃ
được áp dụng từ trước).

Nguyên tắc quan trọng cần biết trước khi dùng (không đổi so với trước):

- **Chỉ set số bước, KHÔNG tự gán người duyệt** — sau khi áp dụng, mọi bước
  vừa được điền đều CHƯA có người duyệt nào, admin vẫn phải vào từng module
  (Đăng Ký Xe/VPP/Hợp Đồng/...) gán người duyệt cho từng bước như bình
  thường. Đây thuần là đường tắt chọn nhanh SỐ BƯỚC ban đầu, không thay thế
  bước cấu hình người duyệt.
- **CHỈ áp dụng cho phòng ban/mức nào đang THIẾU cấu hình, trong ĐÚNG phạm
  vi module của cấu hình đó** — bất kỳ phòng ban/mức nào ĐÃ được admin cấu
  hình từ trước (kể cả chỉ mới chọn số bước mà chưa gán người duyệt) đều
  **được giữ nguyên hoàn toàn**, không bị ghi đè; module KHÔNG nằm trong
  danh sách của cấu hình đang bấm "Áp Dụng" cũng **hoàn toàn không bị đụng
  tới**, dù đang thiếu cấu hình (dành cho 1 cấu hình KHÁC xử lý riêng). Bấm
  **"🔍 Xem Trước"** trước để xem chính xác danh sách sẽ bị ảnh hưởng, rồi
  mới bấm **"⚡ Áp Dụng"** nếu đồng ý.
- **Vẫn sửa được từng bước ở từng module bình thường** sau khi áp dụng, tại
  tab "🔄 Quy Trình & Phê Duyệt" — tính năng này không khoá hay thay đổi gì
  cách admin cấu hình chi tiết từng module như trước, chỉ là 1 bước khởi
  tạo nhanh ban đầu.
- **2 module Vận Hành > Mở Mới/Sửa Chữa Siêu Thị không nằm trong phạm vi** —
  2 module này không còn bước phê duyệt nào cả (xem mục 4.4), nên không
  xuất hiện trong danh sách module để chọn khi tạo cấu hình.
- **Báo cáo kết quả trung thực (từ đợt rà soát cụm Hệ Thống/Admin/Cấu Hình)** —
  1 lượt "⚡ Áp Dụng" ghi vào nhiều nhóm cấu hình khác nhau (mỗi module 1 nơi
  lưu riêng). Trước đây dù 1 phần lưu thất bại (mất mạng/phiên hết hạn/người
  khác vừa sửa cùng chỗ) màn hình vẫn luôn báo "✅ Đã áp dụng cho N mục". Nay
  hệ thống chờ xác nhận từng nhóm, **hoàn tác đúng nhóm lưu hỏng** và báo rõ
  "⚠️ Áp dụng KHÔNG trọn vẹn: đã lưu X/N mục" kèm tên nhóm cần thử lại (Nhật
  Ký Hệ Thống ghi mức WARNING thay vì SUCCESS cho lượt đó).

**Dùng khi nào**: hữu ích nhất lúc mới triển khai hệ thống (đồng bộ nhanh
số bước chuẩn cho từng nhóm module trước khi đi gán người duyệt từng nơi),
hoặc khi công ty đổi chính sách chung "từ nay các module X/Y/Z mới thêm đều
theo N bước" mà không muốn phá vỡ các quy trình đã cấu hình riêng từ trước,
và không muốn ảnh hưởng tới các module khác chưa sẵn sàng đổi.

### 3.7. "🔍 Xem Quy Trình" — xem trước quy trình duyệt ngay trên form tạo hồ sơ

Mọi module có quy trình phê duyệt (mục 3) đều có nút **"🔍 Xem Quy Trình"**
ngay trên form tạo hồ sơ, cho phép người tạo xem trước — TRƯỚC KHI gửi —
hồ sơ của mình sẽ đi qua đúng bao nhiêu bước và ai sẽ là người duyệt từng
bước, dựa theo phòng ban/mức đã chọn trên form tại thời điểm bấm. Đây chỉ
mang tính tham khảo — quy trình thật sự vẫn do server tự xác minh lại khi
bấm "Gửi phê duyệt" (không tin dữ liệu client hiển thị).

Áp dụng cho: Tài Liệu, Văn Bản Trình, Đăng Ký Xe, Mua Sắm VP, Sửa Chữa VP,
Văn Phòng Phẩm, Hợp Đồng (**2 nút riêng biệt** — 1 cho sub-tab "Phê Duyệt"
xem quy trình duyệt hồ sơ hợp đồng, 1 cho sub-tab "Quản Lý HĐ" xem quy trình
duyệt Tài liệu ký — 2 quy trình hoàn toàn độc lập, nút hiện đúng theo tab
đang mở), Thanh Toán, Phê Duyệt Giá (1 nút dùng chung cho cả Bán
Lẻ lẫn Bán Buôn, tự động xem đúng quy trình theo sub-tab đang mở), Vận Hành
- Đặt Hàng (mức áp dụng suy ra từ tổng giá trị đơn hàng đang nhập dở, cùng
cách tính server dùng — cần nhập ít nhất 1 hạng mục hoặc Tổng Đợt Thanh Toán
trước khi xem được). Vận Hành > Mở Mới/Sửa Chữa Siêu Thị KHÔNG có nút này vì
2 module đó không còn bước phê duyệt nào cả (xem mục 4.4).

---

## 4. Danh sách module nghiệp vụ theo nhóm

Danh sách module thật (nguồn: `BUSINESS_MODULES` ở `public/js/core.js`) —
nhóm lại theo **tần suất/vai trò sử dụng** (ai chạm vào module này thường
xuyên, không theo tên phòng ban) để đọc từ trên xuống đúng theo mức độ quan
trọng với 1 nhân viên bình thường — không nhất thiết trùng thứ tự sidebar.

### 4.1. Văn Bản & Tác Nghiệp Hằng Ngày

Nhóm module **mọi nhân viên** đều đụng tới gần như mỗi ngày.

- **Tài Liệu** — quản lý văn bản nội bộ theo mã tự sinh + quản lý phiên bản
  (Cập nhật giữ mã, Nhập mới tạo mã khác); có luồng phê duyệt theo phòng ban.
  - **Phiên bản khoá Phòng Ban/Phân Loại theo tài liệu gốc (từ 9/2026)** — 1
    phiên bản của tài liệu đã có (`rootDocId` khác null) khi sửa (Cập nhật)
    KHÔNG còn đổi được Phòng Ban/Phân Loại khác với tài liệu GỐC — trước đây
    có thể đổi lệch, phá vỡ tính nhất quán "gia đình" tài liệu (các phiên bản
    lẽ ra phải cùng 1 phòng ban/phân loại) và có thể bị dùng để né quy trình
    duyệt của phòng ban thật. Tài liệu GỐC (chưa từng có phiên bản nào) vẫn
    đổi Phòng Ban/Phân Loại tự do như trước.
  - **Định dạng mã tự sinh** — Tài Liệu/Hợp Đồng và 8 module khác (Văn Bản
    Trình/Đăng Ký Xe/Mua Bán-Sửa Chữa-Đầu Tư/Biên Bản Họp/Đặt Phòng Họp/Phê
    Duyệt Giá IT/Ticket Hỗ Trợ IT/Vận Hành > Đặt Hàng, cộng thêm Giấy Phép)
    dùng chung 1 khuôn `HCRC-<mã phòng>-<viết tắt phân loại>-<số
    thứ tự>`. **Server tự sinh lại mã mới khi phát hiện trùng** (tối đa vài
    lần thử, lấy đúng số thứ tự lớn nhất từng có +1) thay vì báo lỗi "Mã đã
    tồn tại" bắt người dùng tự bấm lại — áp dụng cho MỌI module có mã tự sinh,
    kể cả khi 2 người tạo hồ sơ gần như cùng lúc. Riêng **Ngân Sách (v23.0)**
    KHÔNG có mã tự sinh — mỗi dòng chỉ định danh bằng `id` nội bộ.
    **Mã do SERVER chốt (9/2026)** — với **Tài Liệu / Văn Bản Trình / Hợp Đồng
    (gồm cả phụ lục) / Giấy Phép**, mã hiển thị trên form chỉ là **bản xem
    trước**: server tự dựng lại mã từ đúng (Phòng ban, Phân loại/Loại pháp lý)
    của hồ sơ rồi **bỏ qua giá trị trình duyệt gửi lên** (trước đây chỉ kiểm
    TRÙNG chứ không kiểm ĐÚNG KHUÔN, nên một request tự soạn đặt được mã tuỳ ý
    — kể cả mã của phòng ban khác hoặc mã trông giống hệt 1 hồ sơ quan trọng
    — khiến mọi chỗ tra cứu chéo theo mã đọc nhầm hồ sơ). Thuật toán giữ y hệt
    bản trình duyệt đang dùng nên mã thực tế khớp bản xem trước trong mọi
    trường hợp bình thường.
- **Văn Bản Trình / Tờ Trình** — trình văn bản lên cấp trên duyệt; quy trình
  duyệt cấu hình **riêng theo từng loại tờ trình** (không chỉ theo phòng ban
  chung một khuôn) — admin tự thêm/bớt loại tờ trình VÀ danh sách "Độ Khẩn"
  (Bình thường/Gấp/Thượng khẩn) ở màn Biểu Mẫu (mục 7.3). Có bản xem trước quy
  trình duyệt ngay trước khi gửi.
  - **Đề xuất thay thế file** (nhóm bật cờ "Đề xuất thay thế file?" ở
    "🖋️ Nhóm Phê Duyệt Trình/HĐ" — Hệ Thống → 🔀 Quy Trình Nâng Cao — mặc định
    chỉ "Bộ Phận Trợ Lý/Thư Ký", ngay trước TGĐ khi chọn Cấp Phê
    Duyệt Cuối Cùng = TGĐ, nhưng admin gán được cho nhóm bất kỳ) — thay vì chỉ
    duyệt/từ chối, người duyệt ở bước của nhóm này có thể **đề xuất thay thế
    hẳn file tờ trình** (tải file mới kèm ghi chú) — hồ sơ "treo" lại (khoá
    mọi thao tác khác) cho tới khi người tạo tờ trình **Đồng ý** (file mới
    được áp dụng, gửi duyệt lại từ bước 1) hoặc **Không đồng ý** (huỷ đề
    xuất, hồ sơ về NHÁP như bị "Yêu cầu bổ sung" thường).
    **Huỷ đề xuất đang treo (9/2026)**: trước đây chỉ CHÍNH người trình mới gỡ
    được đề xuất, nên người trình nghỉ việc/khoá tài khoản/đi vắng dài ngày là
    tờ trình kẹt vĩnh viễn (mọi thao tác khác đều bị khoá). Nay **Quản Trị Viên
    hoặc chính người đã đề xuất** bấm được nút **"🚫 Huỷ Đề Xuất Thay Thế"**
    ngay trong modal Bút Phê — đề xuất bị gỡ, hồ sơ quay lại xử lý bình thường
    **ở đúng bước duyệt hiện tại** (không reset bước, không đổi trạng thái).
    Người đề xuất cũng **được báo email khi đề xuất bị TỪ CHỐI** (trước đây chỉ
    có email cho nhánh "Đồng ý"), và email báo đề xuất mới ghi **đúng tên người
    đề xuất thật** thay vì luôn ghi "Bộ phận Trợ Lý/Thư Ký".
  - **Xác minh nội dung ở server (9/2026)**: "Loại Tờ Trình" và "Độ Khẩn" gửi
    lên phải khớp ĐÚNG danh mục admin cấu hình (mục 7.3) — trước đây giá trị
    lệch sẽ âm thầm rơi về loại "Khác" (thường ÍT bước duyệt hơn) dù phiếu vẫn
    hiện đúng tên loại. Tiêu đề/Nội dung cũng bị giới hạn độ dài (300/20.000 ký
    tự). Hồ sơ CŨ mang loại đã bị admin xoá khỏi danh mục vẫn sửa được bình
    thường nếu người dùng không đổi loại. Tương tự, nếu **"Cấp Phê Duyệt Cuối
    Cùng"** của 1 tờ trình NHÁP bị admin xoá khỏi danh mục, hệ thống **tự
    chuyển hồ sơ về cấp mặc định hợp lệ** và báo rõ cho người trình khi bấm
    "Sửa & Gửi Lại" — thay vì báo lỗi cứng khiến hồ sơ kẹt NHÁP vĩnh viễn.
  - **Ở bước phê duyệt CUỐI CÙNG** (bước có `currentStep === steps.length` —
    có thể là TGĐ, hoặc bước cuối của cấp GD_PGD/PTGD/Khác nếu tờ trình không
    đi qua lớp Trợ Lý/Thư Ký), người duyệt cũng có lựa chọn tương tự: **"Đề
    xuất thay thế file"** (y hệt cơ chế Trợ Lý/Thư Ký ở trên) hoặc **"Yêu cầu
    bổ sung"** dạng bình luận thường (không kèm file, chỉ trả hồ sơ về NHÁP
    kèm lý do) — tuỳ người duyệt chọn khi hồ sơ đã tới đúng bước cuối cùng
    của quy trình đã chọn.
  - **Nhóm Phê Duyệt Trình & Cấp Phê Duyệt Cuối Cùng tự cấu hình** (10/2026) —
    ở **Hệ Thống → 🔀 Quy Trình Nâng Cao → 🖋️ Nhóm Phê Duyệt Trình/HĐ** (từ
    v23.65 — trước đó là mục 11 trong cây phân quyền của form Sửa Người Dùng),
    admin tự
    **đổi tên/thêm/xoá** các nhóm phê duyệt bổ sung (trước đây cố định 7 nhóm
    Đồng trình/Đồng cấp/Xin ý kiến/Giám Đốc-Phó Giám Đốc/Phó Tổng Giám Đốc/Bộ
    Phận Trợ Lý-Thư Ký/Tổng Giám Đốc, giờ tuỳ ý) — tên nhóm ở đây chính là
    nguồn dữ liệu cho danh sách "Phê duyệt" ở form tạo Văn Bản Trình. Mỗi nhóm
    có 3 cờ admin bật/tắt tự do: **"Chặn quy trình?"** (bật = cộng thêm 1 bước
    duyệt thật; tắt = chỉ là kênh "xin ý kiến" tham khảo song song, không có
    nút Duyệt/Từ chối), **"Chỉ 1 người?"** (nhóm chỉ được gán tối đa 1 thành
    viên — ô chọn dạng danh sách sổ xuống 1 lựa chọn), **"Đề xuất thay thế
    file?"** (người duyệt ở bước của nhóm này có thêm lựa chọn đề xuất thay
    thế toàn bộ tệp tờ trình, xem bên dưới). Cùng màn còn có bảng **"Cấp Phê
    Duyệt Cuối Cùng"** — admin tự đổi tên/thêm/xoá các cấp (trước đây cố định
    Tổng giám đốc/Phó tổng giám đốc/Giám đốc-phó giám đốc/Khác), mỗi cấp gán
    "Nhóm Được Chọn" (nhóm nào hiện ra để tick khi người trình chọn cấp này —
    để trống = mọi nhóm hiện có) và "Nhóm Bắt Buộc" (nhóm nào tự động khoá
    tick sẵn, không được bỏ). Cấp "Phê duyệt khác" có khoá 🔒 (mặc định hệ
    thống, không xoá được, vẫn đổi tên được) để luôn có ít nhất 1 cấp dự
    phòng. Đổi tên/thêm nhóm-cấp KHÔNG ảnh hưởng hồ sơ đã tạo trước đó (quy
    trình mỗi hồ sơ đã chốt cố định lúc tạo).
    **Xoá 1 nhóm giờ tự dọn cấu hình Cấp (từ đợt rà soát cụm Hệ Thống/Admin/
    Cấu Hình)** — trước đây xoá 1 nhóm đang được đặt "Nhóm Bắt Buộc" ở 1 Cấp
    sẽ KHOÁ CỨNG việc tạo hồ sơ ở cấp đó (server luôn báo "thiếu nhóm phê
    duyệt bắt buộc" trong khi form không còn ô nào để tick lại). Nay id nhóm
    bị xoá được gỡ tự động khỏi cả "Nhóm Được Chọn" lẫn "Nhóm Bắt Buộc" của
    MỌI cấp (cả ở giao diện lẫn ở server, kể cả khi gọi thẳng API), hộp thoại
    xác nhận cũng liệt kê đúng những cấp sẽ bị ảnh hưởng. Ngoài ra ràng buộc
    "Nhóm Bắt Buộc phải nằm trong Nhóm Được Chọn" nay **được kiểm tra lại ở
    server**, không chỉ ở giao diện.
  - **Chọn người phê duyệt cụ thể khi nhóm có nhiều người** — nhóm chỉ **đúng
    1 người** → hệ thống tự dùng người đó, KHÔNG hiện hộp chọn. Nhóm có
    **nhiều hơn 1 người** (VD 2 Phó Giám Đốc, nhóm không bật "Chỉ 1 người") →
    khi tick lớp đó, hiện thêm 1 hộp chọn (dropdown) bắt buộc chọn **đúng 1
    người cụ thể** trong nhóm làm người duyệt bước đó (không phải cả nhóm
    cùng duyệt 1 bước). Nhóm chưa gán ai (0 người) thì không gửi được tờ
    trình cho tới khi admin gán thành viên (gán ở đúng dòng nhóm đó, "🖋️ Nhóm
    Phê Duyệt Trình/HĐ" — Hệ Thống → 🔀 Quy Trình Nâng Cao).
- **Công Việc** — giao việc, theo dõi tiến độ; có thể tự sinh từ ý kiến chỉ
  đạo trong Văn Bản Trình (xác nhận thủ công, không tự động tạo âm thầm).
  **Đổi người thực hiện khi đang "Đang thực hiện" (từ 9/2026)**: sửa lại
  "Người Thực Hiện" của 1 việc đang ở trạng thái Đang thực hiện sẽ tự động
  đưa việc về lại Cần làm + xoá các việc con đã tạo dở — người MỚI được gán
  phải tự bấm "Nhận việc" lại từ đầu, không thừa hưởng ngầm tiến độ của
  người cũ. **Từ 9/2026 (bổ sung)**: đổi người nhận lúc này còn tự HUỶ LUÔN
  mọi yêu cầu Xin Gia Hạn/Xin Huỷ còn đang treo của người nhận CŨ — trước đó
  các yêu cầu này vẫn tồn tại sau khi đổi người, khiến người nhận MỚI bị
  chặn "Hoàn thành" vô cớ vì 1 yêu cầu không còn liên quan gì tới mình nữa.
- **Biên Bản Họp** — lập biên bản, có thể chọn 1 lịch Đặt Phòng Họp có sẵn để
  tự điền thông tin cơ bản. **Xem/Tải/In khớp nội dung (từ 9/2026)** — trước
  đây màn "Xem" và file Tải/khung In dựng HTML riêng biệt, lệch cả nội dung
  (bản Xem thiếu chân ký Thư Ký/Chủ Trì, bản Tải thiếu cột "Giao việc") lẫn
  định dạng; nay dùng chung đúng 1 bộ nội dung, chỉ khác bản Xem có thêm cột
  trạng thái/nút "📌 Giao việc" (không có ý nghĩa trên bản chính thức nên bản
  Tải/In bỏ cột này), cả 2 đều có khối chân ký "Thư Ký"/"Chủ Trì" xếp ngang
  hàng, căn giữa cân đối (cùng kiểu bố cục với Phiếu Phê Duyệt của Đăng Ký
  Xe/Văn Bản Trình/Văn Phòng). **Giao việc lại cho đầu việc bị lỗi (9/2026)**:
  bấm "Giao việc" trước đây chỉ chạy được ĐÚNG 1 LẦN cho cả biên bản — nếu 1
  vài Ý Kiến Chỉ Đạo không sinh được Công Việc (tài khoản khai ở "Thành phần
  tham dự" không hợp lệ/đã khoá) thì không có cách nào giao lại nữa. Nay sửa
  đúng lại thông tin người thực hiện rồi bấm "Giao việc" lần nữa: hệ thống
  chỉ giao lại đúng (các) đầu việc còn thiếu, không tạo trùng các đầu việc đã
  giao thành công trước đó.
- **Truyền Thông Nội Bộ** — 5 sub-tab dùng chung 1 collection bài đăng, phân
  biệt bằng loại: 📰 Nhịp Sống HCRC (tin tức công ty), 🎓 Đào Tạo (thông báo
  lớp học, liên kết LMS bên dưới), 💼 Tuyển Dụng (đăng tin + nhân viên giới
  thiệu ứng viên), 💬 Góc Chia Sẻ, 🤝 HCRC Đồng Hành (hỏi & đáp riêng tư 1-1
  với Nhân Sự — nhân viên gửi câu hỏi về chế độ/quy định, phía Nhân Sự trả lời
  qua "Quản Lý & Phản Hồi Ý Kiến", xem mục 4.5; 1 hỏi–1 đáp không trao đổi
  nhiều lượt; danh sách "Chủ Đề" admin tự thêm/bớt/đổi nhãn ở màn Biểu Mẫu).
  Bình luận/thả tim/ghi nhận đã xem mở cho mọi người; chỉ việc **đăng bài**
  mới cần quyền riêng theo từng loại.
  - **Đào Tạo (LMS)** — Lớp Học (tạo/danh sách/ghi kết quả) + Đăng Ký Của Tôi +
    Kho Tài Liệu + Lộ Trình Thăng Tiến (danh sách lớp bắt buộc, chỉ xác nhận
    hoàn thành khi đã Đạt hết) + Ngân Hàng Câu Hỏi. 2 mức quyền: quản lý toàn
    quyền (tạo lớp/tài liệu/bài test/lộ trình) và giảng viên (chỉ quản lý
    roster/kết quả đúng lớp được gán).
    - **Ngân Hàng Câu Hỏi — 4 loại câu hỏi**: 1 đáp án đúng (SINGLE), nhiều
      đáp án đúng (MULTI — cả 2 loại này hỗ trợ 1 ảnh minh hoạ đề bài tuỳ
      chọn, KHÔNG phải "loại câu hỏi hình ảnh" riêng), **Nghị Luận** (ESSAY —
      người làm bài tự viết câu trả lời, không có đáp án lựa chọn, trainer
      chấm tay), **Kéo Thả Hình** (IMAGE_DRAG_DROP — mỗi đáp án là 1 ẢNH
      riêng thay vì text, kéo-thả hoặc bấm chọn để trả lời, chấm tự động y hệt
      loại nhiều đáp án đúng). Excel Nhập/Xuất hàng loạt CHỈ hỗ trợ 2 loại
      SINGLE/MULTI — 2 loại mới chỉ tạo được qua giao diện Test Builder.
    - **Chấm tay câu Nghị Luận**: bài test có ÍT NHẤT 1 câu Nghị Luận thì
      Đạt/Không Đạt **KHÔNG có ngay khi học viên nộp bài** — hệ thống tự
      chấm trước phần trắc nghiệm/kéo-thả, học viên thấy "⏳ Chờ chấm nghị
      luận" cho tới khi giảng viên/Nhân Sự phụ trách đào tạo vào mục
      **"📝 Cần Chấm Nghị Luận"** (trong sub-tab Ngân Hàng Câu Hỏi) chấm
      điểm từng câu — lúc đó điểm mới cộng dồn và Đạt/Không Đạt mới chốt
      (so với Điểm Đạt của lớp). Bài test không có câu Nghị Luận nào thì
      không đổi gì — vẫn có kết quả ngay như trước.
      **Chốt Điểm Đạt ngay lúc nộp bài (từ 9/2026)**: hệ thống lưu lại
      snapshot Điểm Đạt của lớp TẠI THỜI ĐIỂM học viên nộp bài — nếu giảng
      viên sửa Điểm Đạt của lớp SAU KHI đã có bài nộp nhưng TRƯỚC KHI chấm
      xong câu Nghị Luận, Đạt/Không Đạt vẫn tính đúng theo ngưỡng lúc nộp
      bài (không bị tính nhầm theo ngưỡng mới). Bài nộp từ trước bản vá này
      (chưa có snapshot) tự dùng lại Điểm Đạt hiện tại của lớp, không lỗi.
    - **Gợi ý học viên chưa hoàn thành khi tổ chức lại lớp** (từ v23.53):
      lớp mới gắn cùng Chương Trình (`courseId`) với 1/nhiều lớp cũ đã có
      học viên KHÔNG ĐẠT — mở modal "➕ Thêm Học Viên" của lớp mới sẽ tự
      hiện khối gợi ý màu vàng liệt kê đúng những học viên **chưa từng ĐẠT**
      ở bất kỳ lớp nào cùng Chương Trình đó (đã ĐẠT 1 lần thì coi như xong,
      không gợi ý lại dù có lần KHÔNG ĐẠT khác trước đó), bấm "+" từng người
      hoặc "+ Thêm tất cả" để đưa vào danh sách tạm rồi xác nhận thêm vào lớp
      như bình thường. Tài khoản đã bị khoá vẫn bị loại khỏi gợi ý (khớp đúng
      luật loại tài khoản khoá dùng chung toàn hệ thống). Tính năng thuần
      phía giao diện — chỉ tính từ dữ liệu Lớp Học/Đăng Ký đã tải sẵn, không
      thêm route/quyền mới.
    - **🔒 Đóng / 🔓 Mở Lại Đăng Ký 1 lớp học (từ 9/2026)** — nút ngay trên
      dòng lớp ở danh sách Lớp Học, dành cho người quản lý đào tạo hoặc giảng
      viên được gán đúng lớp đó. Đóng đăng ký = **dừng nhận học viên tự đăng
      ký** (nhân sự/giảng viên vẫn "➕ Thêm Học Viên" tay được), mở lại bất cứ
      lúc nào. Trước đây trạng thái lớp luôn là "đang mở" và không có cách
      dừng sớm — muốn chặn chỉ còn cách sửa hạn đăng ký/sĩ số. **Khác hoàn
      toàn** "▶️ Bắt Đầu Lớp / ⏹️ Kết Thúc Lớp" (vòng đời BUỔI HỌC của lớp
      Offline) — 2 khái niệm độc lập, không ảnh hưởng nhau.
    - **Duyệt yêu cầu huỷ đăng ký khi học viên ĐÃ có kết quả (từ 9/2026)** —
      học viên xin huỷ đăng ký rồi vẫn kịp thi và có kết quả Đạt/Không Đạt
      trước khi Nhân Sự bấm duyệt: hệ thống nay **chặn lượt duyệt huỷ đó**
      (báo rõ lý do) thay vì âm thầm chuyển đăng ký sang "Đã huỷ" và **xoá
      trắng kết quả đã thi** (không có đường khôi phục, kéo theo mất điều
      kiện Đạt của Lộ Trình Thăng Tiến/Tân Binh). Người duyệt dùng nút "Từ
      chối" để gỡ yêu cầu huỷ đang treo. Ngoài ra mọi lượt ghi kết quả (chấm
      tay lẫn tự động chấm) đều tự dọn yêu cầu huỷ còn treo.
    - **↩️ Thu Hồi Xác Nhận (Lộ Trình Thăng Tiến, từ 9/2026)** — quản lý đào
      tạo xác nhận nhầm người/nhầm cấp nay thu hồi lại được: gõ username vào
      ô tra cứu của lộ trình → nút "↩️ Thu Hồi Xác Nhận Cấp N". Chỉ thu hồi
      được **mốc cao nhất** đã xác nhận (muốn thu hồi cấp dưới thì thu hồi
      cấp trên trước, giữ chuỗi bậc liền mạch); mốc bị thu hồi vào Thùng Rác
      (khôi phục được), sau đó xác nhận lại bình thường.
    - **🔄 Đánh Giá Lại Giai Đoạn 3 (Lộ Trình Tân Binh, từ 9/2026)** — hồ sơ
      đã chấm "Không đạt" trước đây là ngõ cụt vĩnh viễn (không cấp được
      chứng chỉ, cũng không đánh giá lại được). Nay khối "Đánh Giá Giai Đoạn
      3" hiện lại các hồ sơ Không Đạt kèm 2 nút "🔄 Đánh Giá Lại" — **bắt
      buộc nhập lý do**, kết quả cũ lưu vào lịch sử đánh giá của hồ sơ. Không
      áp dụng cho hồ sơ đang Đạt hoặc đã cấp chứng chỉ.
    - **Chặn xoá danh mục còn đang được tham chiếu (từ 9/2026)** — xoá Bài
      Test còn gán cho lớp / Chương Trình còn được lớp học, kế hoạch đào tạo,
      lộ trình thăng tiến hoặc lộ trình tân binh sử dụng / Lộ Trình Thăng
      Tiến đã có mốc xác nhận của nhân viên nay bị **chặn kèm thông báo nêu
      rõ nơi đang dùng**, thay vì xoá được vô điều kiện rồi khoá cứng luồng
      thi/xác nhận đang chạy. Gỡ tham chiếu xong xoá lại bình thường (quyền
      xoá vẫn chỉ Quản Trị Viên như trước).
    - **Danh Sách Được Mời không còn công khai (từ 9/2026)** — danh sách
      username được mời vào 1 lớp giới hạn nay chỉ trả đầy đủ cho quản lý đào
      tạo/Admin/giảng viên phụ trách lớp đó; người khác vẫn biết "lớp này
      giới hạn theo danh sách mời" và biết mình có được mời hay không, nhưng
      không đọc được ai khác trong danh sách.
    - **Gate module ở server (từ 9/2026)** — tắt module "Truyền Thông Nội Bộ"
      cho 1 tài khoản (mục 0 "Khối Truy Cập" của màn Phân Quyền) nay chặn
      **toàn bộ 16 loại dữ liệu** của module (bài đăng, tuyển dụng, lớp học,
      đăng ký, chương trình, tài liệu, bài test, bài làm, kế hoạch, 2 loại lộ
      trình, hội nhập tân binh, HCRC Đồng Hành...) ở tầng API, không chỉ ẩn
      tab ở giao diện — trước đây chỉ bài đăng bị chặn thật.

### 4.2. Yêu Cầu Hành Chính Tự Phục Vụ

Nhóm module nhân viên **tự tạo yêu cầu cho chính mình** (đăng ký xe, đặt
phòng, xin cấp phát...) — khác nhóm 4.1 ở chỗ đây không phải công việc chuyên
môn hằng ngày mà là các yêu cầu hậu cần phát sinh không đều đặn.

- **Đăng Ký Xe** — đăng ký sử dụng xe công ty, qua quy trình duyệt theo phòng
  ban. Danh sách "Mục Đích Sử Dụng" admin tự thêm/bớt/đổi nhãn ở màn Biểu Mẫu.
  4 sub-tab: **🚗 Đăng Ký Xe** (tạo/xử lý phiếu), **🗓️ Lịch Xe** (lưới CHỈ XEM
  lịch trống/bận từng lái xe, **3 chế độ Ngày/Tuần/Tháng** từ v22.6 — giống
  hệt Lịch Họp: chế độ **Ngày** là lưới giờ chi tiết như trước (cột = lái xe,
  hàng = khung giờ 30 phút 07:00-19:00, ô đỏ = lái xe đó đang có phiếu chưa bị
  từ chối/huỷ trùng khung giờ, ô trắng = trống, bấm ô đỏ xem nhanh thông tin
  phiếu), chế độ **Tuần/Tháng** chỉ xem TỔNG QUAN (mỗi ô ngày hiện số chuyến
  đã có theo từng lái xe, bấm 1 ô ngày nhảy thẳng về chế độ Ngày của đúng ngày
  đó) — **không** đặt/kéo-chọn lịch trực tiếp ở bất kỳ chế độ nào, biển số/lái
  xe cụ thể vẫn do Phòng Hành Chính phân công khi xử lý duyệt), **🧑‍✈️ Lái Xe**
  (lái xe tự xác nhận chuyến được phân công), **📊 Báo Cáo** (từ v22.6, CHỈ
  người quản lý thấy — admin/quyền xem xe toàn công ty/người duyệt ở bất kỳ
  phòng ban nào — thẻ tổng hợp số phiếu/đã duyệt/đang chờ/bị từ chối/tổng KM,
  thanh tỷ lệ theo Phòng Ban và theo Lái Xe, lọc theo khoảng ngày đi). Từ
  v23.4, tab Báo Cáo có thêm: **bảng số liệu xu hướng theo kỳ** (mỗi dòng =
  1 kỳ, cột Số Chuyến + Số KM, pill filter chọn 1 trong 5 kỳ **Ngày/Tuần/
  Tháng/Quý/Năm** — khác Lịch Xe ở trên là lưới xem lịch trực quan, đây là
  bảng thống kê xu hướng; đợt 9/2026 đổi từ biểu đồ SVG cột+đường sang bảng
  số liệu thuần văn bản theo phản hồi người dùng — biểu đồ cũ bị vỡ hình khi
  số kỳ hiển thị nhiều, bảng số liệu gọn và không phụ thuộc việc render đồ
  hoạ co giãn), **bảng "Lịch Sử Đánh Giá Chuyến"** (mã phiếu, lái xe, người đăng ký
  đã đánh giá, thời điểm đánh giá, số km thực tế, nhận xét) và **bảng "Lịch
  Sử Xác Nhận Của Lái Xe"** (mã phiếu, lái xe, thời điểm xác nhận nhận
  chuyến, thời điểm kết thúc chuyến, số km lái xe tự báo cáo) — trả lời trực
  tiếp câu hỏi "ai đánh giá lái xe nào, ở phiếu nào" và "lái xe xác nhận/kết
  thúc phiếu nào, lúc nào" mà trước đó chỉ xem được từng phiếu riêng lẻ.
  **"Phần Dành Cho Phòng Hành Chính" (phân công xe lúc xử lý duyệt)** — CHỈ
  Người Điều Hành Xe (`perms.carDispatch`)/Admin mới thấy/sửa được mục này khi
  duyệt (người khác trong luồng duyệt vẫn Duyệt/Từ chối bình thường, không
  đụng được tới các ô dưới đây). Ô **"Loại xe cụ thể"** là `<select>` chọn từ
  danh mục `carVehicleTypes` (Admin tự thêm/xoá ở "🗂️ Quản Lý Danh Mục" →
  "🚗 Quản Lý Danh Mục Loại Xe Cụ Thể") — mỗi mục thường gắn sẵn 1 **Biển Kiểm
  Soát (BKS) cố định**, chọn mục đó sẽ **tự động điền BKS tương ứng** (BKS vẫn
  có thể sửa tay lại nếu cần, VD dùng xe dự phòng). Mục đánh dấu **"Là Xe
  Taxi"** không có BKS cố định — chọn mục này sẽ **ẩn ô BKS, hiện thêm ô
  "Hãng Taxi"** (chọn từ danh mục `carTaxiCompanies`, Admin tự thêm/xoá ở panel
  "🚕 Quản Lý Danh Mục Hãng Taxi" ngay cạnh) để ghi nhận hãng taxi thuê ngoài
  thay vì xe công ty. Đổi qua lại giữa Taxi/không-Taxi (kể cả ở "🔁 Đổi Tài
  Xế-Xe" sau khi phiếu đã duyệt xong) tự động dọn sạch BKS/Hãng Taxi cũ không
  còn phù hợp, tránh để sót dữ liệu gây hiểu nhầm.
  **"🏁 Kết Thúc Chuyến" (lái xe) + "⭐ Đánh Giá" (người đăng ký, bắt buộc để
  hoàn thành)**: trước đây phiếu `APPROVED` là trạng thái cuối cùng với xe (chỉ
  còn Hủy Chuyến/Đổi Tài Xế-Xe). Nay sau khi lái xe đã "✅ Xác Nhận Đăng Ký"
  (sub-tab "🧑‍✈️ Lái Xe"), nút đó được thay bằng **"🏁 Kết Thúc Chuyến"** —
  lái xe bấm, nhập **số km thực tế đã đi**, phiếu chuyển **"⏳ Chờ Đánh Giá"**
  (`AWAITING_EVALUATION`). Lúc này **chỉ đúng người đăng ký phiếu** (không cho
  admin/Người Điều Hành Xe làm hộ, kể cả khi có quyền) mới thấy nút **"⭐ Đánh
  Giá (bắt buộc)"** ở dòng danh sách — xem lại số km lái xe báo cáo, **có thể
  chỉnh lại nếu cần** (VD lái xe đi vòng/tính nhầm), thêm nhận xét (không bắt
  buộc), xác nhận xong phiếu mới chuyển **"✅ Hoàn Thành"** (`COMPLETED`) —
  đây là bước bắt buộc, phiếu KHÔNG được tính là hoàn thành nếu chưa qua Đánh
  Giá. Số km lái xe nhập ban đầu luôn được giữ lại (không bị ghi đè) để đối
  chiếu về sau, kể cả khi người đăng ký chỉnh lại số km hiển thị chính thức.
  Bắt buộc phải "Xác Nhận Đăng Ký" trước mới "Kết Thúc Chuyến" được (không thể
  bỏ qua bước xác nhận). Phiếu Phê Duyệt (xem/tải) vẫn dùng được bình thường ở
  cả 2 trạng thái mới này, có thêm mục "Kết Thúc Chuyến / Đánh Giá" hiện số km
  + nhận xét khi đã có.
  **Trạng thái "🚗 Đang Thực Hiện" (`IN_PROGRESS`, từ 9/2026)** — trước đây lái
  xe bấm "✅ Xác Nhận Đăng Ký" chỉ ghi nhận cờ ngầm, nhãn trạng thái ở danh sách
  vẫn hiện y hệt "Đã Phê Duyệt" nên không phân biệt được đã có ai nhận chuyến
  hay chưa nếu không mở chi tiết. Nay "Xác Nhận Đăng Ký" chuyển hẳn trạng thái
  sang **"🚗 Đang Thực Hiện"** (nằm giữa "Đã Phê Duyệt" và "Chờ Đánh Giá" trong
  luồng), có thẻ riêng ở "📊 Báo Cáo" và filter riêng ở danh sách. "🔁 Đổi Tài
  Xế-Xe"/"🚫 Hủy Chuyến" vẫn dùng được bình thường ở cả 2 trạng thái Đã Phê
  Duyệt lẫn Đang Thực Hiện. **Từ 9/2026**: đổi tài xế cho 1 chuyến ĐANG THỰC
  HIỆN nay tự đưa trạng thái QUAY LẠI "Đã Phê Duyệt" (để tài xế mới xác nhận
  lại được từ đầu) — trước đây phiếu vẫn giữ nguyên "Đang Thực Hiện" dù chưa
  ai xác nhận, kẹt vĩnh viễn (tài xế mới không xác nhận được, tài xế cũ cũng
  không kết thúc được chuyến).
  **"🚫 Hủy Đăng Ký" khi chưa ai duyệt (từ 9/2026)** — trước đây 1 phiếu đang
  chờ duyệt (`PENDING`) hoàn toàn không có cách rút lại, chỉ "Hủy Chuyến" được
  sau khi đã phê duyệt xong. Nay người đăng ký có thể tự hủy đăng ký của chính
  mình ngay khi **còn ở đúng bước duyệt đầu tiên** (chưa ai xử lý gì cả) —
  KHÔNG áp dụng khi phiếu đã qua ít nhất 1 bước duyệt (đang dở dang giữa
  chừng), lúc đó người duyệt bước hiện tại dùng "❌ Từ Chối" thay. Kết hợp với
  "🚫 Hủy Chuyến" sau duyệt đã có sẵn, người đăng ký nay hủy được đăng ký của
  mình ở bất kỳ giai đoạn nào TRƯỚC KHI chuyến thực sự kết thúc (bước 1 chưa
  duyệt, đã duyệt xong, hoặc lái xe đã xác nhận nhưng chưa kết thúc chuyến) —
  chỉ không hủy được khi đang dở dang giữa các bước duyệt, hoặc chuyến đã thực
  sự kết thúc (đang/đã Đánh Giá).
  **Chuyển sang Taxi tự xoá tài xế đã gán (từ 9/2026)** — ở "Phần Dành Cho
  Phòng Hành Chính", khi đổi "Loại xe cụ thể" sang 1 mục đánh dấu "Là Xe Taxi"
  (dù lúc duyệt hay ở "🔁 Đổi Tài Xế-Xe" sau này), hệ thống nay **tự xoá luôn
  cả tài xế đã gán** (trước đây chỉ dọn BKS, để sót tài xế cũ treo lại dù xe
  giờ là taxi thuê ngoài, không còn tài xế công ty đi kèm) — ô "Lái xe được
  phân công" tự khoá/xoá trắng ngay khi chọn Taxi.
  **Quyền Xem/Tải Phiếu Phê Duyệt siết hẹp hơn (từ 9/2026)** — trước đây bất kỳ
  ai xem được dòng đăng ký (kể cả chỉ có quyền xem theo phòng ban, không liên
  quan trực tiếp tới chuyến) đều xem/tải được Phiếu Phê Duyệt chính thức; nay
  **chỉ người đăng ký, tài xế được gán, người đã/đang duyệt hồ sơ đó, hoặc
  admin** mới xem/tải được — bỏ hẳn fallback "cùng phòng ban" mặc định (CHỈ áp
  dụng riêng cho Phiếu Đăng Ký Xe, không đổi hành vi tải file chung của các
  module khác).
- **Đặt Phòng Họp** — tự chặn trùng lịch ngay từ lúc đăng ký (kiểm tra cả lịch
  đang chờ duyệt lẫn đã duyệt là đang "chiếm chỗ" cùng phòng/khung giờ giao
  nhau) — không để dồn nhiều yêu cầu trùng giờ về người phê duyệt rồi mới phát
  hiện xung đột. Danh mục phòng họp (tên đầy đủ + tên gọn hiện trên lưới Lịch
  Họp) admin tự thêm/sửa/xoá tại **Hệ Thống → Quản Trị → Quản Lý Danh Mục →
  "🗂️ Danh Mục Phòng Họp"** (từ v22.2 — trước đó nằm ngay trong tab "📝 Đăng
  Ký" của module, nay gom về cùng chỗ với mọi danh mục quản trị khác).
  **Sub-tab "📊 Báo Cáo" (từ v22.2)** — chỉ hiện cho người có quyền duyệt
  lịch họp (`meetingApprove`/admin): lọc theo khoảng ngày SỬ DỤNG (không
  phải ngày tạo phiếu), xem tổng số/đã duyệt/đang chờ/đã hủy + tổng giờ đã
  sử dụng, mức sử dụng theo từng phòng họp (kể cả phòng chưa có lịch nào,
  để thấy phòng đang "ế") và theo phòng ban, xu hướng sử dụng theo tháng.
  **Xem Lịch Họp — 3 chế độ Ngày/Tuần/Tháng**: chế độ **Ngày** (mặc định) giữ
  nguyên lưới giờ chi tiết 30 phút/phòng, kéo chuột hoặc giữ Shift bấm ô thứ 2
  để chọn nhiều khung giờ liên tiếp rồi đổ sẵn sang tab Đăng Ký. Chế độ **Tuần**/
  **Tháng** chỉ xem TỔNG QUAN — mỗi ô ngày hiện số lịch đã đặt theo từng phòng
  (hoặc tổng số lịch ở Tháng), KHÔNG chọn giờ trực tiếp được (quá dày để hiện
  từng khung 30 phút); bấm vào 1 ô ngày bất kỳ sẽ nhảy về đúng chế độ Ngày của
  ngày đó để xem chi tiết/đặt lịch. Nút ◀ ▶ lùi/tiến đúng 1 đơn vị theo chế độ
  đang xem (1 ngày/1 tuần/1 tháng), nút "Hôm nay" đưa về ngày hệ thống hiện tại
  ngay lập tức — giúp lướt xem trước phòng nào còn trống trong cả tuần/tháng
  tới trước khi quyết định đặt ngày nào, thay vì phải dò từng ngày một.
- **Văn Phòng Phẩm (VPP)** — theo **kỳ đăng ký**: admin tạo kỳ + danh mục mặt
  hàng có đơn giá, mỗi phòng ban có **ngân sách phòng ban** = số nhân sự đang
  hoạt động của phòng (admin có thể sửa tay lại số nhân sự gợi ý này) ×
  **mức/người**. Chức danh nằm trong danh mục "Chức danh bị loại khỏi VPP"
  (3.3) không được tính vào đầu người/không đăng ký được.
  **Mức/người RIÊNG theo từng phòng ban (từ v22.5, đổi cách nhập ở v22.8)**:
  khối "💰 Ngân Sách Văn Phòng Phẩm / Người" ở form "Tạo Kỳ Đăng Ký" có 2 chế
  độ chọn qua 2 nút bấm — **"🏢 Toàn công ty"** (mặc định: 1 ô mức tiền áp cho
  MỌI phòng ban) và **"🎛️ Áp mức khác theo nhóm phòng ban"** (hiện thêm 1 ô
  "Mức mặc định" cho phòng chưa gán nhóm nào, cùng danh sách **"Nhóm mức
  riêng"** — mỗi nhóm gồm 1 ô tiền + 1 ô chọn NHIỀU phòng ban áp dụng (gõ tìm
  + bấm chọn, hiện dạng chip có nút xoá), bấm "+ Thêm Nhóm Mức Riêng" để tạo
  thêm bao nhiêu nhóm tuỳ ý, mỗi nhóm 1 mức tiền độc lập). Mỗi phòng ban chỉ
  thuộc ĐÚNG 1 nhóm — phòng đã chọn ở nhóm này sẽ không tìm-chọn được ở nhóm
  khác nữa. Bảng "Nhân sự theo phòng ban" bên dưới hiện cột "Mức Áp Dụng"
  (chỉ xem trước, tô màu theo đúng nhóm) — đổi mức thì sửa ở ô mặc định/nhóm
  phía trên, không sửa trực tiếp trong bảng; cột "Số Nhân Sự" vẫn sửa tay
  được như trước.
  **Chặn theo TỔNG NGÂN SÁCH CẢ PHÒNG, KHÔNG còn giới hạn riêng từng người (TỪ
  v22.5)**: trước đây hệ thống chặn nếu 1 đăng ký cá nhân vượt quá mức/người —
  nay đổi hẳn sang chặn theo **quỹ chung của cả phòng ban**: khi 1 nhân viên
  bấm "Gửi Phê Duyệt", hệ thống cộng tổng các đăng ký KHÁC cùng phòng đang
  **Chờ Duyệt hoặc Đã Duyệt** trong cùng kỳ, cộng thêm đăng ký đang gửi — nếu
  vượt quá tổng ngân sách phòng ban (Số nhân sự × Mức/người) thì mới chặn. 1
  người có thể đăng ký nhiều hơn mức/người trung bình, miễn quỹ CẢ PHÒNG còn
  đủ — hoàn toàn không giới hạn số tiền của riêng 1 cá nhân nào. Ngay trên
  form chọn mặt hàng, nhân viên thấy realtime dòng "Ngân sách phòng ban còn
  lại" (đã trừ phần các đồng nghiệp khác đang giữ chỗ) để tự cân đối trước khi
  gửi. Đăng ký bị Từ Chối/đưa về Nháp (Yêu Cầu Bổ Sung) sẽ TỰ NHẢ lại phần quỹ
  đã giữ chỗ cho người khác trong phòng dùng tiếp. Màn "Báo Cáo Tổng Hợp" (chỉ
  vppManage/admin) hiện cột "Còn Lại (Sau Chờ Duyệt)" đúng bằng số hệ thống
  dùng để chặn (trừ cả Chờ Duyệt, không chỉ Đã Duyệt).
  **"🚫 Hủy Đăng Ký" khi chưa ai duyệt (từ 9/2026)** — cùng cơ chế "Hủy Đăng
  Ký" đã có ở Đăng Ký Xe (xem mục trên): đăng ký đang Chờ Duyệt mà CHƯA ai xử
  lý gì cả (còn đúng bước duyệt đầu tiên) thì người tạo (hoặc admin) tự hủy
  được ngay ở danh sách — hủy rồi tự "nhả" lại phần quỹ ngân sách phòng ban
  đã giữ chỗ ngay lập tức. Đã qua ít nhất 1 bước duyệt thì không hủy được
  qua nút này nữa (nhờ người duyệt bước hiện tại Từ Chối thay).
  **Danh mục mặt hàng — mẫu/nhập/xuất Excel** (form "Tạo Kỳ Đăng Ký"): nút
  **"⬇️ Tải Mẫu Excel"** ngay cạnh ô chọn file tải về 1 file mẫu rỗng (kèm 1
  dòng ví dụ in nghiêng) đúng 6 cột hệ thống nhận diện được (**Mã Hàng/Tên Mặt
  Hàng/Đơn Vị Tính/Xuất Xứ/Quy Cách Đóng Gói/Đơn Giá**) — gửi file này cho bộ
  phận hành chính điền rồi nộp lại đảm bảo **nhập (import)** đúng cột ngay lần
  đầu (input file Excel/CSV vẫn tự nhận diện cột theo tiêu đề hoặc theo vị trí
  cột 1/2 nếu file không có tiêu đề, không bắt buộc phải dùng đúng file mẫu).
  Mỗi kỳ đăng ký đã tạo trong bảng "Danh Sách Kỳ Đăng Ký" có nút **"📤 Xuất
  Excel"** để xuất lại NGUYÊN danh mục mặt hàng đã chốt của kỳ đó ra file Excel
  cùng đúng 6 cột trên — dùng làm cơ sở cho kỳ sau (import lại được ngay) hoặc
  đối chiếu với file gốc hành chính đã nộp.
- **Đồng Phục** — 2 vai trò: Hành Chính tạo "kỳ cấp phát" phân bổ đồng phục
  xuống từng siêu thị, Giám Đốc Siêu Thị xác nhận đã nhận rồi cấp phát tiếp cho
  nhân viên. "Kho" không lưu bảng riêng — luôn tính động từ số đã phân bổ đã
  xác nhận trừ đi số đã cấp phát cho nhân viên. **Bắt buộc nhân viên xác nhận
  đã nhận**: mỗi phiếu cấp phát (`uniformIssuances`) khởi tạo ở trạng thái "⏳
  Chờ xác nhận" (`ackStatus = PENDING_ACK`) — CHỈ đúng nhân viên được cấp mới
  bấm "✅ Xác nhận đã nhận" được (server tự xác thực lại quyền, không chặn
  được ai xác nhận thay ai), sau đó chuyển "✅ Đã xác nhận" (`ackAt`/`ackByName`
  ghi lại). Đây thuần là bước xác nhận đã thực nhận — KHÔNG ảnh hưởng gì tới
  tồn kho/số đang giữ (vẫn trừ ngay lúc cấp phát). Badge trạng thái hiện ở cả
  bảng "Lịch Sử Cấp Phát" (từng phiếu) và "Đang Giữ" (gộp theo nhân viên×mặt
  hàng×size). Nhân viên thường xem + xác nhận được CHÍNH phiếu của mình qua
  mục **"👕 Đồng Phục Của Tôi"** trong "⚙️ Cá Nhân Hóa" (mục 2.3).
  **Điều chuyển giữa 2 siêu thị — mô hình "hàng đang vận chuyển"**: Giám Đốc
  Siêu Thị A tạo yêu cầu điều chuyển → Hành Chính/người có quyền duyệt
  (`uniformManage`) duyệt (`APPROVED`) → **tồn kho siêu thị A trừ ngay lúc
  duyệt**, nhưng tồn kho siêu thị B **CHƯA cộng** — hàng coi như đang trên
  đường đi, không thuộc kho bên nào cho tới khi xác nhận. Bắt buộc **đúng
  Giám Đốc Siêu Thị ĐÍCH (B)** bấm "✅ Xác nhận đã nhận hàng" thì mới chuyển
  sang `RECEIVED` và tồn kho B mới cộng thêm (server tự xác thực lại quyền
  theo `user.dept === transfer.targetDept`, không ai xác nhận thay siêu thị
  khác được).
  **"🚫 Hủy Điều Chuyển" khi đang "vận chuyển" (từ 9/2026)**: lỡ duyệt nhầm
  1 yêu cầu điều chuyển mà siêu thị đích CHƯA xác nhận nhận, người có quyền
  duyệt (Hành Chính/`uniformManage`) bấm "🚫 Hủy Điều Chuyển" ở mục "🚚 Đang
  Vận Chuyển — Hủy Nếu Cần" — tồn kho siêu thị NGUỒN tự "nhả lại" ngay lập
  tức. Trước đây không có cách nào hủy 1 điều chuyển đã duyệt, tồn kho
  nguồn bị "giam" vĩnh viễn cho tới khi (lỡ tay) có ai đó xác nhận nhận.
  Chỉ hủy được TRƯỚC KHI siêu thị đích xác nhận nhận — sau đó hàng coi như
  đã thật sự chuyển, không "hủy ngược" được nữa.
  **Xác nhận hộ khi nhân viên đã nghỉ việc (9/2026)**: phiếu cấp phát còn "⏳
  Chờ xác nhận" mà nhân viên đã nghỉ việc/khoá tài khoản (không tự bấm được
  nữa) khiến phiếu kẹt vĩnh viễn — nay Giám Đốc Siêu Thị (`uniformStoreManage`)
  bấm nút "✅ Xác nhận hộ (đã nghỉ việc)" hiện ngay tại bảng "Lịch Sử Cấp
  Phát" cho đúng phiếu đó (nút CHỈ hiện khi tài khoản nhân viên đã inactive —
  còn hoạt động vẫn bắt buộc tự nhân viên xác nhận), ghi rõ "(xác nhận hộ,
  nhân viên đã nghỉ việc)" trong lịch sử.
  **Báo cáo Đồng Phục theo siêu thị**: bộ lọc siêu thị của riêng báo cáo Đồng
  Phục là **chọn nhiều** (tick chọn một nhóm siêu thị bất kỳ, có nút "Chọn Tất
  Cả"/"Bỏ Chọn Hết") — báo cáo hiện dòng "Tổng Cộng (N siêu thị đã chọn)" cộng
  tồn kho của đúng nhóm đang chọn, và khi đang lọc hiện thêm khối "Tổng Cộng
  TẤT CẢ Siêu Thị" để so sánh ngay với tổng toàn hệ thống.
- **Giấy Phép** — hồ sơ pháp lý (giấy phép kinh doanh, chứng chỉ...), phân
  quyền hoàn toàn riêng ngay trong module (tạo/duyệt/xem tách biệt), không đi
  qua quy trình duyệt theo phòng ban ở mục 3. Có theo dõi hiệu lực + nhắc hết
  hạn qua email — **chỉ nhắc đúng phiên bản MỚI NHẤT trong 1 family gia hạn
  (từ 9/2026)**: gia hạn sớm (thêm phiên bản mới trước khi bản cũ hết hạn)
  không còn khiến bản CŨ tiếp tục kích hoạt nhắc hạn riêng của nó song song.
  Danh sách các phiên bản gia hạn của cùng 1 giấy phép (cả ở bảng con khi mở
  rộng 1 hồ sơ lẫn màn "Chi Tiết Giấy Phép") hiện **mới nhất lên trước**.
  **Hủy khi còn chờ duyệt (9/2026)**: gửi nhầm tệp/thông tin trong khi hồ sơ
  CÒN ĐANG chờ duyệt (chưa ai xử lý) thì người tạo (hoặc admin) tự bấm "🚫
  Hủy" ngay tại bảng danh sách — không cần chờ người duyệt Từ Chối hộ. Đã
  duyệt/từ chối rồi thì không hủy được nữa.
  **Không tự duyệt hồ sơ của chính mình (9/2026)**: người vừa tải giấy phép lên
  không được Duyệt/Từ chối/đánh dấu Gia hạn/Thu hồi chính hồ sơ đó, kể cả khi
  họ có quyền "Duyệt Giấy Phép" — cần 1 người duyệt KHÁC (Quản Trị Viên vẫn giữ
  đặc quyền vượt cấu hình như mọi module khác). Nút tương ứng cũng được ẩn sẵn
  trên màn hình.
  **Xoá hồ sơ gốc xoá luôn cả "họ" (9/2026)**: xoá 1 giấy phép GỐC nay xoá kèm
  toàn bộ phiên bản gia hạn của nó (trước đây để lại các phiên bản con mồ côi,
  hiện lẫn trong danh sách và không cập nhật tiếp được). Xoá 1 phiên bản con
  vẫn chỉ xoá đúng phiên bản đó.
- **Hỗ Trợ IT** — module 3 sub-tab, mỗi tab phục vụ 1 nhóm người khác nhau
  dù cùng nằm 1 chỗ:
  - **🏷️ Phê Duyệt Giá** — dành cho người tạo/duyệt giá bán mặt hàng siêu thị
    (thực chất là 1 luồng tài chính, xem thêm mục 4.3): **Bán Lẻ** theo phòng
    ban (dùng chung engine quy trình phòng ban ở mục 3), **Bán Buôn** theo 4
    mức Margin/Chiết khấu cố định (không theo phòng ban). Mức người đề xuất
    chọn vẫn **TỰ KHAI** (server không ép server-side), nhưng từ 9/2026 admin
    có thể (tuỳ chọn, không bắt buộc) gán 1 cột trong **Mẫu Giá** (Hệ Thống →
    Hỗ Trợ IT → "📐 Mẫu Giá", nút "🎯 Cột Margin/CK") làm cột "Margin/Chiết
    Khấu (%)" — khi đã gán, hệ thống tự đối chiếu số liệu THẬT trong file bảng
    giá vừa tải lên với mức người đề xuất chọn, **CHỈ hiện cảnh báo màu vàng**
    cho người gửi nếu có vẻ không khớp để họ tự kiểm tra lại (không chặn gửi,
    không ràng buộc gì tới người duyệt — người duyệt vẫn tự do xử lý như cũ).
    Form nộp có thêm 3
    trường **CHỈ mang tính thông tin** cho đội Hỗ Trợ IT biết phạm vi/thời hạn
    áp giá khi xử lý (không giới hạn ai xem được đề xuất, không có xử lý tự
    động nào theo ngày hết hiệu lực — IT tự theo dõi thủ công): **"Siêu Thị Áp
    Dụng"** (Bán Lẻ — mặc định "Toàn bộ siêu thị, cửa hàng", chọn "Khác" để
    chỉ định 1-nhiều siêu thị cụ thể) hoặc **"Siêu Thị Đề Xuất"** (Bán Buôn —
    KHÔNG có "Toàn bộ", luôn bắt buộc chọn rõ siêu thị/cửa hàng áp dụng), cùng
    **"Ngày Áp Dụng"** (bắt buộc) và **"Ngày Hết Hiệu Lực"** (mặc định "Vĩnh
    viễn", chọn "Khác" để nhập ngày thật).
  - **🏢 "Đơn Vị Áp Dụng Giá Bán Buôn"** (chỉ hiện ở sub-tab Bán Buôn) — ô
    nhập tay tự do, **bắt buộc**, ghi tên đơn vị/khách hàng mà mức giá bán
    buôn này áp dụng CHO — khác hẳn "Phòng Ban Đề Xuất"/"Siêu Thị Đề Xuất" ở
    trên (đó là đơn vị NỘI BỘ tạo đề xuất). Không có danh mục hệ thống cho
    đối tác/khách hàng ngoài nên đây là ô gõ tự do, không phải chọn từ danh
    sách có sẵn.
  - **🗺️ "Vùng Giá Áp Dụng"** (chỉ hiện ở sub-tab Bán Lẻ, đối xứng "Đơn Vị Áp
    Dụng Giá Bán Buôn" ở trên) — **KHÔNG bắt buộc** (đợt 9/2026, theo yêu cầu
    người dùng — trước đó bắt buộc, nay bỏ trống vẫn gửi đề xuất được bình
    thường), chọn từ danh mục hệ thống (Hệ Thống → 🗂️ Quản Lý Danh Mục →
    "🗺️ Quản Lý Danh Mục Vùng Giá Áp Dụng", admin tự thêm/xoá), KHÔNG nhập
    tay tự do như Đơn Vị Áp Dụng Giá Bán Buôn — vì đây là khái niệm NỘI BỘ
    công ty tự định nghĩa (VD Miền Bắc/Miền Trung/Miền Nam) nên dùng danh mục
    để tránh gõ sai/không nhất quán giữa các đề xuất, NHƯNG nếu có chọn thì
    vẫn phải khớp đúng 1 giá trị trong danh mục (server đối chiếu lại, không
    tin nguyên văn giá trị client gửi).
  - **Biểu Mẫu (Hệ Thống → 📋 Biểu Mẫu)**: "IT - Duyệt Giá" trước đây gộp
    CHUNG 1 danh sách field Bán Lẻ + Bán Buôn dễ nhầm lẫn (đợt 9/2026, theo
    phản hồi người dùng) — nay tách hẳn thành 2 tab con riêng ("IT - Duyệt
    Giá (Bán Lẻ)"/"IT - Duyệt Giá (Bán Buôn)"), mỗi tab chỉ liệt kê đúng field
    của sub-tab đó. 6 field dùng chung thật (Mã Đề Xuất/Phòng Ban Đề Xuất/Mẫu
    Giá Phê Duyệt/Tệp Bảng Giá/Lý Do Điều Chỉnh Giá/Tài Liệu Bổ Sung) chỉ sửa
    được từ tab "Bán Lẻ" (cùng 1 ô nhập trên form thật, không tách 2 bản
    riêng). "Trường Bổ Sung" (field admin tự thêm) từ nay cũng TÁCH RIÊNG
    theo từng tab — field thêm cho Bán Lẻ không hiện ở Bán Buôn và ngược lại;
    cấu hình cũ (từ trước đợt tách) tự động chuyển sang cả 2 tab mới khi tải
    lại trang, không bị mất.
  - **🎫 Hỗ Trợ Yêu Cầu** — ticket helpdesk IT nội bộ, **mở cho toàn bộ nhân
    viên** (đúng vai trò "tự phục vụ" của cả mục này), vòng đời Chưa xử lý →
    Đang xử lý → Hoàn thành/Đã huỷ. Danh sách "Danh Mục" admin tự thêm/bớt/đổi
    nhãn ở màn Biểu Mẫu. **Phê duyệt là TÙY CHỌN theo từng ticket, do IT tự
    quyết định** — mặc định mọi ticket xử lý bình thường không cần qua duyệt.
    Gửi được nút "📨 Gửi/Gửi Lại Yêu Cầu Phê Duyệt" ngay từ khi ticket còn
    "Chưa xử lý" (chưa ai bấm "🎯 Nhận Xử Lý") — đúng nghiệp vụ "xin ý kiến
    quản lý TRƯỚC KHI bắt đầu xử lý". Chọn 1 người bất kỳ trong hệ thống
    (không giới hạn đúng quản lý trực tiếp theo Cơ Cấu Tổ Chức) + nhập lý do —
    ticket chuyển trạng thái phê duyệt "⏳ Đang chờ duyệt" (trạng thái xử lý
    TODO/DOING của ticket KHÔNG đổi khi gửi phê duyệt). **Trong lúc chờ hoặc
    bị từ chối, server CHẶN CỨNG (lỗi 409) cả "🎯 Nhận Xử Lý" lẫn "Cập nhật
    tiến độ"/đóng ticket** — đội IT chỉ nhận việc/tiếp tục xử lý được sau khi
    quản lý đã Duyệt. **Nhắc hạn tự động khi treo lâu (9/2026)**: yêu cầu xin
    ý kiến còn chờ xử lý quá 2 ngày sẽ tự động gửi email nhắc người được xin
    ý kiến (job chạy mỗi 24h) — không còn phải tự nhớ vào xem badge chờ trên
    giao diện.
  - **🔔 Gia Hạn Dịch Vụ CNTT** — chỉ đội IT thấy được, quản lý nội bộ danh
    mục dịch vụ/hợp đồng CNTT của chính đội IT (tên miền, hosting, license
    phần mềm...), không qua bước duyệt nào, có nhắc hết hạn qua email cùng
    khuôn Giấy Phép. "Loại Dịch Vụ" là danh mục admin-editable, vẫn tự học
    thêm khi ai gõ loại mới lúc thêm dịch vụ.
  - **Cây phân quyền (khối 15, chia nhỏ 10/2026)** — trước đây chỉ 3 quyền gộp
    (`itPriceProposeCreate`/`itManage`/`itPriceEmergencyRejectApprove`), nay
    tách thành **7 quyền riêng** để đúng với thực tế nhiều người chỉ phụ trách
    1 mảng: **Đề xuất duyệt giá Bán Buôn**/**Đề xuất duyệt giá Bán Lẻ** (2 cờ
    riêng — ai chỉ được đề xuất 1 loại thì chỉ tick đúng quyền loại đó, form
    tạo tự ẩn/hiện theo đúng sub-tab đang mở); **🛠️ Đội Hỗ Trợ IT** (`itManage`,
    GIỮ NGUYÊN tên nhưng thu hẹp lại — giờ CHỈ còn điều khiển ai **nhận xử lý
    ticket "🎫 Hỗ Trợ Yêu Cầu"**, không còn tự động áp giá/xem hết Phê Duyệt
    Giá/quản lý Gia Hạn Dịch Vụ như trước); **💲 Hỗ trợ giá Bán Buôn/Bán Lẻ**
    (quyền MỚI `itPriceSupport` — áp giá sau khi duyệt xong + xem toàn bộ hồ
    sơ Phê Duyệt Giá, vẫn GỘP CHUNG cho cả 2 loại giá theo đúng yêu cầu người
    dùng khi chia nhỏ); **🔔 Sử dụng Gia Hạn Dịch Vụ** (quyền MỚI
    `itServiceRenewalManage`, tách hẳn khỏi `itManage`); **Phê duyệt từ chối
    khẩn cấp Bán Buôn**/**Bán Lẻ** (2 cờ riêng theo đúng loại giá của hồ sơ).
    Việc **DUYỆT thật sự** (bước chính trong quy trình Phê Duyệt Giá, KHÔNG
    nằm trong 7 quyền trên) hoàn toàn không đổi — vẫn theo cấu hình phòng ban
    (Bán Lẻ)/mức Margin-Chiết Khấu (Bán Buôn) ở **Hệ Thống → Quy Trình & Phê
    Duyệt**. **Yêu Cầu Bổ Sung giữa chừng tự reset lại từ Bước 1 (từ 9/2026)**:
    nếu người duyệt bấm "Yêu Cầu Bổ Sung" khi hồ sơ ĐÃ có ít nhất 1 bước
    duyệt xong trước đó (Bán Lẻ nhiều bước theo phòng ban), khi người đề xuất
    nộp tệp bảng giá bổ sung, các bước đã duyệt trước đó tự động mất hiệu lực
    và quy trình quay lại Bước 1 để duyệt lại toàn bộ với tệp mới — tránh
    tình huống các bước trước duyệt dựa trên số liệu giá đã lỗi thời. Yêu cầu
    bổ sung từ đội Hỗ Trợ IT (sau khi đã duyệt xong, trước khi áp giá) không
    áp dụng luật này. **Nhắc hạn tự động khi treo lâu (9/2026)**: Yêu Cầu Bổ
    Sung chưa được người đề xuất phản hồi, hoặc Từ Chối Khẩn Cấp chưa được
    người có quyền xử lý — treo quá 2 ngày sẽ tự động gửi email nhắc (job
    chạy mỗi 24h), mỗi yêu cầu chỉ nhắc đúng 1 lần. Có migrate 1 lần khi khởi động server (server-side, không mất
    quyền tài khoản cũ): ai đang có `itPriceProposeCreate` được cấp sẵn CẢ 2
    quyền đề xuất mới; ai đang có `itManage` được cấp sẵn thêm `itPriceSupport`
    + `itServiceRenewalManage`; ai đang có `itPriceEmergencyRejectApprove`
    được cấp sẵn CẢ 2 quyền từ chối khẩn cấp mới — chạy đúng 1 lần, admin có
    thể vào cây phân quyền thu hẹp lại sau nếu muốn tách đúng theo vai trò
    thực tế của từng người.

### 4.3. Tài Chính & Hợp Đồng

Nhóm module người TẠO hồ sơ (thường là phòng chuyên môn) và người DUYỆT
(thường là Kế Toán/Ban Giám Đốc) cùng dùng — trọng tâm là dòng tiền/pháp lý,
khác nhóm 4.2 ở chỗ luôn cần ít nhất 1 bước duyệt tài chính riêng.

- **Hợp Đồng** — 2 sub-tab: **Phê Duyệt** (tạo mới hồ sơ gốc HOẶC phụ lục, cả
  hai đều qua hàng chờ duyệt trừ khi người tạo có quyền tự duyệt) và **Quản Lý
  Hợp Đồng & Giấy Phép** (nhập tay hồ sơ đã có chữ ký thật ký ngoài hệ thống,
  tự động ở trạng thái đã duyệt ngay, không qua hàng chờ). Có thể khai Đợt
  Thanh Toán ngay khi tạo hồ sơ (liên kết sang module Thanh Toán).
  - **⚠️ Quyền RIÊNG cho "Nhập Hợp Đồng/Phụ Lục Đã Ký" (9/2026)**: vì hồ sơ
    nhập theo cách này được đánh dấu **ĐÃ DUYỆT ngay, bỏ qua toàn bộ quy trình
    Phê Duyệt**, nút này không còn dùng chung quyền "Tạo hồ sơ hợp đồng"
    (`contractCreate`) nữa mà cần 1 quyền riêng **"📥 Nhập Hợp Đồng / Phụ Lục
    ĐÃ KÝ"** (`contractImportSigned`, tick trong cây phân quyền của form Sửa
    Người Dùng, ngay dưới "Duyệt hợp đồng"). Người không có quyền này vào
    sub-tab "Quản Lý HĐ" sẽ **không thấy form nhập** (vẫn xem/theo dõi danh
    sách hợp đồng bình thường). **Sau khi cập nhật code, admin phải tự cấp
    quyền này cho đúng người (HR/kế toán) — không ai được cấp mặc định.**
  - **Sửa hồ sơ**: đổi "Phòng ban" khi sửa hợp đồng nay phải nằm trong đúng
    phạm vi quyền tạo hợp đồng của người sửa và khớp danh mục phòng ban/siêu
    thị thật (trước đây không kiểm gì, có thể đẩy hồ sơ sang phòng ban ngoài
    quyền mình rồi kéo theo cả quy trình duyệt sang đó).
  - **Nhóm Phê Duyệt HĐ & Cấp Phê Duyệt Cuối Cùng tự cấu hình** (10/2026, sub-tab
    **Phê Duyệt**) — cùng khuôn với Văn Bản Trình (mục 4.1), ở **Hệ Thống →
    🔀 Quy Trình Nâng Cao → 🖋️ Nhóm Phê Duyệt Trình/HĐ** (từ v23.65 — trước đó
    là mục 14 trong cây phân quyền của form Sửa Người Dùng) admin tự **đổi
    tên/thêm/xoá** các
    nhóm phê duyệt bổ sung (trước đây cố định 4 nhóm Giám Đốc-Phó Giám Đốc/
    Phó Tổng Giám Đốc/Bộ Phận Trợ Lý-Thư Ký/Tổng Giám Đốc, giờ tuỳ ý — Hợp
    Đồng không có khái niệm nhóm "không chặn quy trình" như Văn Bản Trình, mọi
    nhóm đều là 1 bước duyệt thật) — tên nhóm ở đây là nguồn dữ liệu cho danh
    sách "Phê duyệt" ở form tạo Hợp Đồng. Mỗi nhóm có cờ **"Chỉ 1 người?"**
    (nhóm chỉ được gán tối đa 1 thành viên). Cùng màn có bảng **"Cấp Phê
    Duyệt Cuối Cùng"** — admin tự đổi tên/thêm/xoá cấp, mỗi cấp gán "Nhóm
    Được Chọn" (hiện ra để tick) và "Nhóm Bắt Buộc" (tự động khoá tick sẵn);
    cấp "Phê duyệt khác" có khoá 🔒 (mặc định hệ thống, không xoá được). Đổi
    tên/thêm nhóm-cấp KHÔNG ảnh hưởng hồ sơ đã tạo trước đó.
  - **Chọn người phê duyệt cụ thể khi nhóm có nhiều người** — nhóm chỉ **đúng
    1 người** → tự dùng người đó, KHÔNG hiện hộp chọn. Nhóm có **nhiều hơn 1
    người** (không bật "Chỉ 1 người") → hiện thêm 1 hộp chọn bắt buộc chọn
    **đúng 1 người cụ thể** trong nhóm duyệt bước đó. Nhóm chưa gán ai (0
    người) thì không tạo được hồ sơ cho tới khi admin gán thành viên.
  - **Loại Thanh Toán** (chọn ngay ở form Phê Duyệt/Quản Lý HĐ, cạnh Đợt Thanh
    Toán): **"Thanh toán 1 lần"** (mặc định) hoặc **"Thanh toán định kỳ"**.
    Khi Tài liệu ký đã duyệt xong, nút **"🧾 Lập Thanh Toán"** mở ra; bấm xong
    sinh ra đề nghị thanh toán **NHÁP** và tự điều hướng sang sub-tab **"🗂️
    Quản Lý Thanh Toán"** (Tổng Hợp > Thanh Toán) — hợp đồng nguồn **VẪN
    "Chưa thanh toán"** ở bước này, **chỉ chuyển "Chờ thanh toán" khi đề nghị
    vừa sinh ra đó được duyệt XONG theo phòng ban** (không còn đổi ngay lúc
    bấm nút như trước — tránh hiển thị "Chờ thanh toán" khi đề nghị còn đang
    NHÁP/chưa ai duyệt gì). Với hợp đồng **"Thanh toán 1 lần"**: sau khi 1 đề
    nghị hoàn tất (PAID), nút "🧾 Lập Thanh Toán" **không** mở lại nữa (khoá
    cứng). Với hợp đồng **"Thanh toán định kỳ"**: sau khi 1 đợt/chu kỳ PAID,
    hệ thống tự trả hợp đồng về "Chưa thanh toán" và nút mở lại ngay để bắt
    đầu chu kỳ mới — nhưng **không** cho mở 2 chu kỳ song song (kiểm tra dựa
    trên việc còn đề nghị thanh toán nào đang mở của đúng hồ sơ nguồn đó,
    không còn dựa vào paymentStatus).
  - **Đổi Hình Thức Thanh Toán sau khi ĐÃ DUYỆT xong** — người tạo hợp đồng
    bấm **"✏️ Đổi Hình Thức Thanh Toán"** (chỉ hiện khi ĐÃ `APPROVED` VÀ hợp
    đồng **chưa từng có đề nghị thanh toán nào**) — chọn lại Loại Thanh Toán +
    khai lại Đợt Thanh Toán, gửi đi **KHÔNG áp dụng ngay**: hiện badge "⏳ Chờ
    duyệt đổi hình thức thanh toán" cho tới khi ĐÚNG nhóm người duyệt "Tài
    liệu ký" của phòng ban đó (Hệ Thống > Quy Trình & Phê Duyệt > "Hợp đồng -
    Quản Lý HĐ") bấm Duyệt/Từ chối. Duyệt xong mới thật sự đổi Loại/Đợt Thanh
    Toán + ghi lại lịch sử ai yêu cầu/ai duyệt/đổi từ gì sang gì; Từ chối thì
    chỉ xoá yêu cầu, giữ nguyên hình thức cũ. **Từ 9/2026**: khi có 1 yêu cầu
    đổi hình thức đang "⏳ Chờ duyệt", nút **"🧾 Lập Thanh Toán"** bị CHẶN
    (409) cho tới khi yêu cầu đó được xử lý xong — trước đây vẫn lập được
    đề nghị thanh toán theo hình thức CŨ trong lúc yêu cầu đổi đang treo,
    có thể tạo đề nghị sai hình thức nếu yêu cầu đổi được duyệt ngay sau đó.
- **Tổng Hợp** — module cha gồm 2 luồng Mua Sắm/Sửa Chữa văn phòng (mẫu
  BM-TS01) qua quy trình duyệt theo phòng ban, cộng 2 module con:
  **"🚫 Hủy Đề Xuất" khi chưa ai duyệt (từ 9/2026)** — cùng cơ chế đã có ở
  Đăng Ký Xe/Văn Phòng Phẩm: đề xuất Mua Sắm/Sửa Chữa/Đầu Tư đang Chờ Duyệt
  mà CHƯA ai xử lý gì (còn đúng bước duyệt đầu tiên) thì người tạo (hoặc
  admin) tự hủy được ngay ở danh sách; đã qua ít nhất 1 bước duyệt/đã Phê
  Duyệt xong thì không dùng nút này được nữa.
  - **Thanh Toán** — tổng hợp đề nghị thanh toán tự sinh từ Hợp Đồng/Mua
    Bán/Sửa Chữa (nút "🧾 Lập Thanh Toán"/"Chuyển Sang Thanh Toán") hoặc tạo
    thủ công. **3 sub-tab**:
    - **"➕ Tạo Mới"** — tạo thủ công/có nguồn.
    - **"🗂️ Quản Lý Thanh Toán"** — nơi lập/sửa các **đợt thanh toán** của đề
      nghị đang **NHÁP** (`DRAFT`, chỉ phát sinh từ nút "🧾 Lập Thanh Toán" ở
      Hợp Đồng — đề nghị tạo thủ công/CÓ NGUỒN đi thẳng "Chờ duyệt" như
      trước). Khi còn NHÁP, **số tiền từng đợt KHÔNG bắt buộc** — có thể bấm
      **"💾 Lưu"** để giữ nguyên NHÁP, chỉnh sửa dần. Chỉ khi bấm **"📨 Chuyển
      Xác Nhận Thanh Toán"** (NHÁP → Chờ duyệt) thì **MỌI đợt mới bắt buộc
      phải có số tiền > 0** — thiếu đợt nào bị chặn ngay, cả ở giao diện lẫn
      server.
      **v20.7+**: ngoài "Hồ Sơ Đề Nghị Thanh Toán" dùng CHUNG cho cả đề nghị
      (bắt buộc >=1 tệp trước khi gửi, xem bên dưới), **mỗi đợt thanh toán còn
      có thể đính kèm thêm tệp RIÊNG của đợt đó** (cũng nhiều tệp/lần) — hoàn
      toàn TUỲ CHỌN, không thay thế tệp chung, chỉ để lưu chứng từ/căn cứ
      riêng cho từng đợt khi cần (VD hoá đơn từng lần thanh toán khác nhau).
      Sub-tab này cũng là nơi **duyệt theo bước/phòng ban** cho đề nghị đang
      "Chờ duyệt"/"Cần bổ sung" (admin cấu hình người duyệt ở "⚙️ Quản Trị" >
      "Quy Trình & Phê Duyệt" > "💰 QT Thanh Toán") — mỗi đề nghị hiện nút
      **"✅ Xác Nhận Duyệt"**/**"📝 Yêu Cầu Bổ Sung"** (không có nút Từ Chối ở
      bước này, chỉ đưa về "Cần bổ sung" để sửa lại) cộng "✏️ Sửa"/"🗑️ Xoá" —
      **KHÔNG còn ở sub-tab "✅ Xác Nhận" như trước** (đổi chỗ để tách bạch:
      "🗂️ Quản Lý Thanh Toán" phụ trách toàn bộ vòng lập + duyệt nội bộ, "✅
      Xác Nhận" chỉ còn dành riêng cho bước xác nhận ĐÃ CHI TIỀN THẬT bên
      dưới, để có thể phân quyền tab đó CHỈ cho kế toán). Danh sách sắp **đề
      nghị mới tạo lên đầu**. **v20.8+**: mỗi ĐỢT thanh toán luôn hiện đúng 1
      trong 5 badge trạng thái (không còn để trống như trước): **🕐 Đang chờ
      phê duyệt** (đề nghị còn "Chờ duyệt"/"Cần bổ sung"), **⏳ Đang chờ thanh
      toán** (đã duyệt xong, chờ kế toán xác nhận chi), **✅ Đã thanh toán**
      (đã xác nhận chi, đúng/trước hạn), **🔴 Quá hạn — Chưa thanh toán** (quá
      hạn mà chưa xác nhận chi), **⚠️ Đã thanh toán (trễ hạn)** (đã xác nhận
      chi nhưng NGÀY xác nhận trễ hơn hạn đã khai — so `confirmedAt` với
      `dueDate`) — cộng badge **🟡 Sắp đến hạn** (≤ 3 ngày, chưa xác nhận) và
      **📝 Nháp** (đề nghị còn NHÁP). Cảnh báo tổng hợp cũng đếm thêm "N đợt đã
      thanh toán trễ hạn" cạnh "N đợt quá hạn"/"N đợt sắp đến hạn" đã có, VÀ
      badge trạng thái tổng hợp "tổng đợt" (🔴 Quá hạn / 🟡 Đang thanh toán /
      ✅ Đã thanh toán) theo dõi các đề nghị **cho tới khi HOÀN TẤT** (đề nghị
      `PAID` không biến mất khỏi sub-tab này, vẫn hiện đầy đủ kèm link "📎 Xem
      tệp") — đọc CHUNG 1 danh sách với sub-tab "Xác Nhận" bên dưới nên mọi
      thay đổi trạng thái tự hiện ngay ở đây.
      **Tự động nhắc hạn qua email (từ 9/2026)** — job định kỳ (mỗi 24h,
      `jobs/paymentDeadlineReminder.js`) quét mọi đề nghị Đã duyệt ("⏳ Đang
      chờ thanh toán") có đợt còn khoảng 3/1/0 ngày là tới hạn (hoặc đã quá
      hạn), gửi email tới người tạo đề nghị VÀ mọi người đang giữ quyền quản
      lý Thanh Toán (`paymentManage`) — trước đây chỉ có badge cảnh báo trên
      giao diện, không ai chủ động được nhắc. Mỗi đợt chỉ nhắc 1 lần cho mỗi
      ngưỡng đã vượt qua; đợt đã xác nhận thanh toán thì không còn bị nhắc.
      **Chặn gửi vào ngõ cụt (9/2026)**: "💰 QT Thanh Toán" mặc định RỖNG (chưa
      cấu hình phòng ban nào) — trước đây vẫn bấm "📨 Chuyển Xác Nhận Thanh
      Toán" được và đề nghị kẹt "Chờ duyệt" vĩnh viễn (module này không có nút
      Từ Chối, xoá thì chỉ Quản Trị Viên). Nay nếu bước 1 của phòng ban đó
      **không resolve ra người duyệt nào**, hệ thống chặn ngay lúc gửi kèm
      thông điệp chỉ rõ phải nhờ Quản Trị Viên cấu hình quy trình trước.
      **Sửa "Phòng ban" giữa chừng quy trình duyệt (9/2026)**: phòng ban quyết
      định TOÀN BỘ danh sách người duyệt, nên đổi phòng ban của 1 đề nghị đang
      duyệt dở nay **vô hiệu hoá mọi lượt duyệt cũ và đưa hồ sơ về bước 1** (y
      hệt khi sửa lại các đợt thanh toán) — trước đây giữ nguyên bước đang dở,
      tức là hoàn tất chuỗi duyệt của phòng ban MỚI mà người duyệt bước đầu của
      phòng ban đó chưa từng thấy hồ sơ. Phòng ban mới cũng phải khớp danh mục
      phòng ban/siêu thị thật (cả lúc tạo lẫn lúc sửa).
    - **"✅ Xác Nhận Đề Nghị Thanh Toán"** — chỉ còn hiện đề nghị đã duyệt
      XONG bước/phòng ban ở trên (hiển thị **"⏳ Đang chờ thanh toán"** thay vì
      nhãn "APPROVED" cũ), dùng để **phân quyền riêng cho kế toán**: người
      được gán quyền ở tab này CHỈ bấm xác nhận đã chi tiền thật, không đụng
      tới bước duyệt nội bộ (đã chuyển hẳn sang "🗂️ Quản Lý Thanh Toán" ở
      trên). **Yêu cầu đính kèm tệp đã chuyển lên bước GỬI ĐỀ NGHỊ** (v17.6+):
      "Hồ Sơ Đề Nghị Thanh Toán" (nhiều tệp) giờ bắt buộc đính kèm **NGAY LÚC**
      bấm "📨 Chuyển Xác Nhận Thanh Toán" (NHÁP → Chờ duyệt, xem sub-tab "🗂️
      Quản Lý Thanh Toán" ở trên) — thiếu tệp bị chặn ngay từ bước đó, cả giao
      diện lẫn server. Vì vậy **bước Xác Nhận cuối cùng dưới đây KHÔNG còn bắt
      buộc đính kèm thêm tệp nào nữa** (đảo ngược so với thiết kế cũ trước
      v17.6, khi tệp chỉ bắt buộc ở đúng bước này) — chỉ còn 2 CHẾ ĐỘ xác nhận
      tuỳ loại hợp đồng nguồn, chốt CỐ ĐỊNH ngay lúc tạo đề nghị:
      - Hợp đồng **"Thanh toán 1 lần"** (và MỌI đề nghị nguồn Hợp đồng loại
        này): nút **"💰 Xác Nhận Toàn Bộ"** — 1 lần bấm chuyển thẳng "Đã thanh
        toán" cho TẤT CẢ các đợt cùng lúc (không cần chọn thêm tệp nào).
      - Hợp đồng **"Thanh toán định kỳ"**, đề nghị tạo THỦ CÔNG, và đề nghị
        nguồn Mua Bán/Sửa Chữa/Đầu Tư: nút **"Xác nhận"** riêng cho TỪNG ĐỢT
        (không cần chọn thêm tệp nào), lặp lại cho tới khi xác nhận HẾT mọi
        đợt thì đề nghị **tự động** chuyển "Đã thanh toán".
      - **"📝 Yêu Cầu Bổ Sung" ngay tại tab này** — kế toán (quyền quản lý
        thanh toán) vẫn có thể trả đề nghị đang "APPROVED" (⏳ Đang chờ thanh
        toán) về **"Cần bổ sung"** (`NEED_INFO`, quay lại sửa được ở "➕ Tạo
        Mới"/"🗂️ Quản Lý Thanh Toán") **NẾU CHƯA xác nhận bất kỳ đợt nào**
        (`installments` chưa đợt nào `confirmed:true`, và với Hợp đồng "Thanh
        toán 1 lần" — chưa bấm "💰 Xác Nhận Toàn Bộ") — mục đích: kế toán phát
        hiện thiếu/sai thông tin ngay khi chuẩn bị chi tiền (dù đã qua đủ bước
        duyệt nội bộ) vẫn trả lại được mà không cần nhờ người duyệt phòng ban
        thao tác hộ. Đã xác nhận dù chỉ 1 đợt thì nút này biến mất — không thể
        "rút lại" khoản đã chi.
    Vòng đời đầy đủ: **[NHÁP `DRAFT`]** → Chờ duyệt (sửa được, qua duyệt theo
    bước/phòng ban) → [Cần bổ sung thông tin (sửa được)] → Đã duyệt (xác nhận
    — toàn bộ 1 lần hoặc từng đợt, tuỳ loại ở trên) → Đã thanh toán (khoá
    cứng). officeReqs (Mua Bán/Sửa Chữa) không có khái niệm định kỳ, luôn
    khoá cứng "Đã thanh toán".
  - **Ngân Sách (v23.0 — "Ngân Sách 2.0", thiết kế lại HOÀN TOÀN)** — KHÔNG
    còn khái niệm "Kỳ ngân sách"/"Mẫu ngân sách" như trước: mỗi dòng ngân
    sách **độc lập**, tự mang sẵn Năm/Tháng ngân sách riêng, quản lý theo 1
    collection duy nhất `budgetLines` với **3 giai đoạn (Stage) tách biệt**,
    4 tab:
    - **📝 Đề Xuất** (`PROPOSED`) — người có quyền **"Tạo/Quản Lý Ngân Sách"**
      (`budgetCreate`) tạo/sửa/xoá đề xuất của mình (trạng thái Chờ duyệt);
      người có **"Quản Lý Ngân Sách Toàn Quyền"** (`budgetManage`) duyệt hoặc
      từ chối — duyệt xong **tự sinh 1 dòng ✅ Phê Duyệt** tương ứng. Dòng bị
      **Từ chối** (từ 9/2026) sửa được và tự chuyển lại về Chờ duyệt ngay khi
      lưu (nút "Sửa & gửi lại", xoá lý do từ chối cũ) — không còn kẹt vĩnh
      viễn phải tạo dòng mới.
    - **✅ Phê Duyệt** (`APPROVED`) — người có `budgetManage` nhập trực tiếp
      (không cần qua Đề Xuất trước) hoặc duyệt/từ chối dòng chuyển từ Đề
      Xuất lên. Khi 1 dòng Phê Duyệt được duyệt, hệ thống **tự sinh 1 dòng
      💳 Sử Dụng "cha"** mang đúng nội dung/số tiền đã duyệt (không ai nhập
      tay dòng cha này).
    - **💳 Sử Dụng** (`USED`) — mỗi dòng cha (tự sinh) có thể có nhiều **dòng
      con ghi nhận từng lần dùng thực tế** (người có `budgetCreate` ghi nhận
      cho dòng thuộc phòng/vị trí mình, `budgetManage` ghi nhận cho mọi
      dòng) — mỗi lần ghi nhận tự cộng dồn vào dòng cha, tự tính lại trạng
      thái "còn dư / đã dùng hết / vượt ngân sách". Sửa/xoá dòng cha (chỉ
      `budgetManage`) khi xoá sẽ **mở lại** dòng Phê Duyệt nguồn tương ứng.
      **Vượt ngân sách (từ 9/2026)**: ghi nhận Sử Dụng KHÔNG bị chặn dù tổng
      đã vượt số tiền dòng cha được duyệt (tiền thực chi không thể "huỷ") —
      badge dòng cha tự đổi thành **"⚠️ Vượt ngân sách"** (đỏ) thay vì
      "✅ Đã dùng hết" (xanh) để không còn bị âm thầm bỏ sót, không cần vào
      tận tab Báo Cáo mới thấy.
      **Khoá Vị Trí/Khối Phòng Ban khi đã có mục con (từ 9/2026)**: dòng cha
      CHỈ sửa được Vị Trí/Khối Phòng Ban khi CHƯA có mục con nào ghi nhận —
      đã có mục con thì chỉ còn sửa được Ghi chú (đổi Vị Trí/Khối Phòng Ban
      lúc này sẽ làm lệch quyền xem/sửa của các mục con đã ghi nhận theo
      phòng ban cũ); cần chuyển hẳn sang phòng ban khác thì tạo 1 dòng Sử
      Dụng mới.
    - **📊 Báo Cáo** — chỉ hiện với quyền **"Xem Báo Cáo Ngân Sách Toàn Công
      Ty"** (`budgetAggregate`, hoặc `budgetManage`/admin) — tổng hợp
      Đề Xuất/Phê Duyệt/Sử Dụng theo Vị Trí/Khối Phòng Ban/Năm-Tháng, tính
      hoàn toàn ở client từ dữ liệu đã tải, không có bước duyệt.

    **"Vị Trí" thay "Công Ty"** (từ v23.3, đổi thành 2 bước — mirror ĐÚNG cơ
    chế `uPosType`/`uDept`/`uStore` đã dùng ở màn "Quản Trị → Người Dùng"):
    chọn **🏢 HO** (Trụ sở chính) → hiện ô **Khối Phòng Ban** (Danh Mục Phòng)
    để chọn; chọn **🏬 Siêu Thị** → ẨN Khối Phòng Ban, hiện ô **Siêu Thị**
    (Danh Mục Siêu Thị) để chọn — server tự gán `dept` = đúng tên Siêu Thị đó
    khi Vị Trí khác HO (không nhập tay/không tin giá trị client gửi). Không
    tạo danh mục "Vị Trí" riêng — dùng lại đúng Danh Mục Phòng/Danh Mục Siêu
    Thị đã có CRUD sẵn, tránh 2 nơi phải đồng bộ. Cả 2 field **không dùng để
    chặn quyền xem/sửa theo phòng** (là dữ liệu nghiệp vụ tự do) — quyền truy
    cập hoàn toàn theo 3 quyền `budgetCreate`/`budgetManage`/`budgetAggregate`
    ở trên (phải bật ÍT NHẤT 1 trong 3 quyền mới thấy module).

    **Tải File Excel Mẫu / Nhập Excel / Xuất Excel** (từ v23.3) — tab Đề
    Xuất/Phê Duyệt có đủ 3 nút: tải mẫu → điền → nhập lại, server đọc/xem
    trước (dòng hợp lệ/lỗi rõ ràng), người dùng xác nhận mới thật sự tạo
    (mỗi dòng vẫn đi qua đúng luật tạo hồ sơ thật, không có đường tắt). Tab
    Sử Dụng/Báo Cáo chỉ có Xuất Excel (không có Tải Mẫu/Nhập — dòng Sử Dụng
    luôn phải gắn với đúng 1 dòng Phê Duyệt cụ thể, không có khuôn "nhập hàng
    loạt không rõ dòng cha" hợp lý).

    **Không ai tự duyệt hồ sơ mình tạo** (kể cả tài khoản admin) — người có
    `budgetManage` chỉ duyệt được hồ sơ do NGƯỜI KHÁC tạo, không có ngoại lệ.

    **Zero-Trust field locking**: nội dung/mô tả/loại hạng mục của dòng Sử
    Dụng (cả dòng cha tự sinh lẫn dòng con ghi nhận) luôn do SERVER tự ghi
    đè từ đúng dòng Phê Duyệt/Sử Dụng-cha nguồn — không bao giờ tin giá trị
    client gửi lên cho các trường này, chặn sửa sai lệch nội dung đã duyệt.

    Dữ liệu Ngân Sách kiểu cũ (Kỳ/Mẫu/`budgetEntries`) vẫn còn nguyên trên
    server (không xoá) nhưng không còn màn hình nào đọc/ghi vào — chỉ mang
    tính lịch sử, tham khảo qua truy vấn SQL trực tiếp nếu cần.

### 4.4. Vận Hành (Siêu Thị)

Module top-level riêng, **3 luồng độc lập hoàn toàn** về dữ liệu (không chung
gì với "Tổng Hợp" ở mục 4.3), phục vụ đội Vận Hành quản lý mạng lưới siêu thị —
đây là module lớn/phức tạp nhất hệ thống nên trình bày riêng thay vì gộp
chung nhóm khác.

**Đặt tên trên sidebar (từ 10/2026)**: dropdown module lớn ở sidebar hiện
**"⚙️ Vận Hành"** (bọc cả 3 luồng: Đơn Hàng, Mở Mới/Sửa Chữa Siêu Thị, Checklist
Đánh Giá — luồng cuối chỉ gộp chung vị trí điều hướng, dữ liệu/quyền hoàn toàn
tách biệt, xem mục 4.7); tab con bên trong (Mở Mới/Sửa Chữa Siêu Thị + vòng
đời "dự án nhỏ" của nó) hiện **"🏬 QLDA"**. Nhãn "QLDA - ..." ở các màn khác
(cấu hình quy trình, Approval Hub, Biểu Mẫu...) CHỈ dùng cho phần Mở Mới/Sửa
Chữa Siêu Thị; phần Đơn Hàng dùng nhãn "Vận Hành - ...".

- **Đơn Hàng** (Đặt Hàng Tại Siêu Thị / Đặt Hàng Tại HO) — duyệt theo **mức
  giá trị đơn hàng** (tier cố định), không theo phòng ban, 2 quy trình tách
  riêng hoàn toàn: **Đặt Hàng Tại Siêu Thị** 3 mức **≤ 10 triệu / > 10 triệu
  và ≤ 100 triệu / > 100 triệu** (mốc đúng bằng rơi vào mức THẤP hơn, VD đúng
  10.000.000đ tính là "≤ 10 triệu"); **Đặt Hàng Tại HO** 2 mức **≤ 100 triệu /
  > 100 triệu** (cùng quy ước mốc đúng bằng thuộc mức thấp hơn). Mức tính từ
  `MAX(amount, "Tổng Giá Trị Thanh Toán (VNĐ)")` — số lớn hơn giữa tổng hạng
  mục hệ thống tự tính và số người dùng tự gõ/đọc từ PDF phiếu đặt hàng NCC,
  để field tự gõ không thể khai thấp hơn nhằm né bớt lớp duyệt.
  - **"🏬 Quy Trình Đặt Hàng Siêu Thị" — người duyệt Đặt Hàng Tại Siêu Thị
    (10/2026, thay hẳn cơ chế "tự khớp đúng siêu thị" trước đó; đổi tên từ
    "⚙️ Quy Trình Hỗn Hợp" ở v23.66 cho đúng phạm vi thật — id/key nội bộ vẫn
    "mixed"/"MIXED", KHÔNG đổi hành vi/dữ liệu)**: màn "🔄 Quy Trình & Phê
    Duyệt" (mục "📦 QT Vận Hành - Đặt Hàng Tại Siêu Thị") giờ **CHỈ còn quyết
    định SỐ BƯỚC** (theo mức giá trị 3 tier ở trên) — **NGƯỜI DUYỆT từng bước
    chuyển hẳn sang cấu hình ở sub-tab riêng "🏬 Quy Trình Đặt Hàng Siêu Thị"**
    (Hệ Thống → 🔀 Quy Trình Nâng Cao — từ v23.65 gộp chung với "⚡ Áp Dụng
    Nhanh"/"🖋️ Nhóm Phê Duyệt Trình/HĐ"/"🧩 Nhóm Quyền Đặc Biệt" thành 4
    sub-tab của 1 tab lớn; trước đó "⚙️ Quy Trình Hỗn Hợp" (tên cũ) là tab
    ngang hàng cạnh "🔄 Quy Trình & Phê Duyệt"). Màn này là **1 bảng duy
    nhất**, mỗi dòng gồm:
    - **Bước**: 1/2/3... (khớp đúng số bước của tier đơn hàng rơi vào — 1 bước
      cho ≤ 10 triệu, 2 bước cho mức giữa, 3 bước cho > 100 triệu). Có thể
      thêm nhiều dòng cho CÙNG 1 bước.
    - **Kiểu**: **"Chức danh"** (áp dụng cho TẤT CẢ người đang giữ đúng chức
      danh đó — **gõ tìm HỖN HỢP cả 2 danh mục "Chức Danh" (HO) lẫn "Chức
      Danh Siêu Thị"**, mỗi gợi ý gắn nhãn nguồn để phân biệt khi 2 danh mục
      trùng tên; VD gán "Phó Tổng Giám Đốc" — chức danh HO — làm người duyệt
      Bước 3 cho đơn Siêu Thị > 100 triệu, đúng kịch bản "NV siêu thị → Quản
      lý ST → Quản lý vùng → Phó TGĐ ở HO duyệt") hoặc **"Người cụ thể"**
      (đúng 1 người, gõ tìm theo tên/username).
    - **Siêu Thị Phụ Trách**: để TRỐNG = **Mặc định** (áp dụng MỌI siêu thị);
      chọn 1 hoặc nhiều siêu thị (gõ tìm, chọn nhiều) = **Ngoại lệ** (chỉ áp
      dụng đúng các siêu thị đã chọn).
    Ý nghĩa khớp: 1 dòng "Chức danh" + **Mặc định** (không chọn siêu thị) thì
    **tự khớp theo Phòng Ban/Vị Trí Kiêm Nhiệm** của TỪNG người giữ đúng chức
    danh với ĐÚNG siêu thị của đơn (VD "Giám Đốc siêu thị" mặc định → nhân
    viên Siêu Thị A tạo đơn thì chỉ Giám Đốc **đang thuộc Siêu Thị A** thấy/
    duyệt được, Giám Đốc Siêu Thị B/C dù cùng chức danh vẫn KHÔNG thấy) —
    người có "Vị Trí Kiêm Nhiệm" thêm siêu thị khác (VD quản lý vùng) duyệt
    được TẤT CẢ siêu thị mình phụ trách. 1 dòng có khai **Siêu Thị Phụ Trách**
    (ngoại lệ) thì áp dụng cho MỌI người giữ đúng chức danh/đúng người đó, **
    KHÔNG so Phòng Ban** — dùng để gán 1 "Quản Lý Vùng"/1 người cụ thể phụ
    trách nhiều siêu thị không thuộc đúng 1 phòng ban cố định nào. Nhiều dòng
    cùng khớp 1 (Bước, Siêu Thị) thì **HỢP LẠI** (union) danh sách người duyệt,
    KHÔNG loại trừ nhau (VD 1 dòng Mặc định "Giám Đốc siêu thị" + 1 dòng Ngoại
    lệ "Phó Giám Đốc siêu thị" cho riêng vài siêu thị → những siêu thị đó có
    CẢ 2 chức danh cùng duyệt được Bước 1). Được liệt kê ở màn này (theo tên
    NGƯỜI hoặc CHỨC DANH) là **ĐỦ điều kiện duyệt ngay** — nhưng **tài khoản
    phải còn tồn tại và còn hoạt động**: từ đợt rà soát cụm Hệ Thống/Admin/Cấu
    Hình, 1 dòng "Người cụ thể" trỏ tới tài khoản đã bị khoá (nghỉ việc) hoặc
    đã xoá KHÔNG còn được tính là người duyệt (trước đây vẫn tính, khiến đơn
    kẹt vĩnh viễn ở bước đó) và hiện cảnh báo đỏ ngay trên bảng cấu hình
    ("⛔ Tài khoản đã bị khoá/không còn tồn tại — dòng này KHÔNG có tác dụng")
    để admin gán lại người khác. KHÔNG cần bật thêm
    quyền "Người duyệt" (`canBeApprover`, "🧩 Nhóm Quyền Đặc Biệt" — Hệ Thống
    → 🔀 Quy Trình Nâng Cao) như cơ chế
    "Theo vị trí" của các quy trình theo phòng ban khác (Văn Phòng Phẩm/Thanh
    Toán/Xe/Giá IT/Hợp Đồng...). Quy tắc này CHỈ áp dụng cho **Đặt Hàng Tại
    Siêu Thị** — **Đặt Hàng Tại HO** không có khái niệm "siêu thị" nên giữ
    nguyên cơ chế cũ (cấu hình người duyệt thẳng theo mức giá trị ở màn "🔄
    Quy Trình & Phê Duyệt", không qua Quy Trình Đặt Hàng Siêu Thị). Thiết kế phần lõi
    (server) mang tính tổng quát để về sau có thể mở rộng dùng chung cho Hợp
    Đồng/Văn Bản Trình, nhưng ở màn admin hiện tại ô "Áp dụng cho" CHỈ hiện
    đúng 1 lựa chọn "🏬 Đặt Hàng Tại Siêu Thị" (không còn hiện Hợp Đồng/Văn
    Bản Trình dạng disabled "sắp có" nữa, tránh gây hiểu nhầm 2 module đó
    đang ngang hàng/sắp triển khai). Khi tạo/sửa User chọn Vị Trí = Siêu
    Thị, nếu siêu thị cần gán chưa có trong danh mục, bấm nút **"+"** ngay
    cạnh ô Siêu Thị để thêm nhanh vào danh mục mà không cần rời form (Hệ
    Thống → Quản Lý Người Dùng → Danh Mục cũng thêm được).
  - **Cảnh báo "⚠️ Chưa cấu hình duyệt"** (9/2026, đợt rà soát chuyên sâu): nếu
    admin CHƯA cấu hình mẫu quy trình (số bước) cho 1 mức giá trị nào đó (màn
    "🔄 Quy Trình & Phê Duyệt"), đơn hàng rơi vào mức đó sẽ hiện rõ cảnh báo
    này ngay ở cột Trạng Thái trong danh sách — trước đây hồ sơ dạng này hiện
    y hệt 1 đơn đang chờ duyệt bình thường (chỉ Quản Trị Viên mới duyệt được,
    không ai khác thấy), dễ bị bỏ sót không ai để ý cấu hình còn thiếu. Thấy
    cảnh báo này thì vào cấu hình bổ sung mẫu quy trình cho đúng mức đang
    thiếu.
  - **Cảnh báo "chưa có người duyệt khớp đúng siêu thị" (10/2026)**: khác cảnh
    báo ở trên (trường hợp đó là CHƯA hề cấu hình mẫu quy trình) — trường hợp
    này mẫu quy trình đã có (biết đúng số bước), nhưng ở màn "⚙️ Quy Trình Hỗn
    Hợp" không có dòng nào khớp đúng siêu thị của đơn ở Bước 1 (VD quên khai
    thêm siêu thị đó vào 1 dòng "Ngoại lệ", hoặc quên gắn "Vị Trí Kiêm Nhiệm"
    cho người phụ trách siêu thị đó ở dòng "Mặc định"). Khi gặp trường hợp
    này lúc tạo đơn, hệ thống báo ngay bằng 1 thông báo (⚠️) cho người tạo,
    đồng thời ghi 1 dòng Nhật Ký Hệ Thống mức Cảnh Báo để Quản Trị Viên tra
    cứu được kể cả khi bỏ lỡ thông báo lúc tạo — đơn vẫn tạo được bình thường,
    chỉ Quản Trị Viên duyệt được cho tới khi bổ sung đúng dòng cấu hình còn
    thiếu ở "🏬 Quy Trình Đặt Hàng Siêu Thị". **Từ đợt rà soát 9/2026 (12 cụm):
    cảnh báo này kiểm TẤT CẢ các bước của quy trình**, không chỉ Bước 1 — quy
    trình 2-3 bước mà quên cấu hình người duyệt cho bước sau trước đây vẫn tạo
    đơn im lặng rồi mới treo giữa chừng; nay thông báo nêu rõ đang thiếu người
    duyệt ở BƯỚC NÀO.
  - **Người duyệt đã nghỉ việc/bị khoá tài khoản KHÔNG còn được tính** (rà soát
    9/2026): dòng cấu hình (cả kiểu "Chức danh" lẫn "Người cụ thể") trỏ tới tài
    khoản đã ngừng hoạt động sẽ được bỏ qua — trước đây người đã nghỉ vẫn nằm
    trong danh sách đồng phê duyệt nên bước **treo vĩnh viễn** (luật đồng phê
    duyệt đòi TẤT CẢ người trong danh sách bấm Duyệt). Nếu sau khi bỏ qua mà
    bước không còn ai, đơn hiện cảnh báo "chưa có người duyệt" như trên.
  - **Cảnh báo khi XOÁ dòng cấu hình** (màn "🏬 Quy Trình Đặt Hàng Siêu Thị",
    rà soát 9/2026): xoá dòng CUỐI CÙNG của 1 bước sẽ hỏi lại kèm cảnh báo rõ
    "Bước X sẽ KHÔNG CÒN AI DUYỆT"; xoá dòng "Mặc định" duy nhất (chỉ còn các
    dòng "Ngoại lệ") cảnh báo các siêu thị không được khai sẽ mất người duyệt.
    Mỗi dòng trên bảng còn hiện **số người đang thực sự khớp** ("👤 N người",
    hoặc "⚠️ 0 người khớp" màu đỏ khi chức danh chưa ai giữ/người đã nghỉ).
  - **Đổi tên Phòng Ban/Chức Danh/Siêu Thị tự cập nhật cả cấu hình duyệt "Theo
    vị trí"** (rà soát 9/2026): ngoài các nơi đã cascade từ trước, nay còn tự
    đổi tên bên trong cấu hình từng bước của MỌI màn quy trình (Tài Liệu, Văn
    Bản Trình, Xe, Mua Bán/Sửa Chữa VP, VPP, Hợp Đồng, Thanh Toán, Ngân Sách,
    Hỗ Trợ IT Bán Lẻ/Bán Buôn, Vận Hành Đặt Hàng Siêu Thị/HO) và trong danh mục
    "Vị Trí Tham Gia Quy Trình" (Quyền Đặc Biệt) — trước đây các bước "Theo vị
    trí" trỏ tên CŨ sẽ tra ra 0 người duyệt sau khi đổi tên.
  - **Đọc PDF phiếu đặt hàng NCC tự động điền form** — chọn file PDF ở "File
    Đơn Hàng" tự đọc và điền Số Đơn/Ngày Đặt/Ngày Giao/Người Đặt/Tại Trạm/Mã
    NCC/MST NCC/Nơi Nhận/Địa Chỉ Giao/các khoản tiền + toàn bộ bảng hạng mục
    (chỉ áp dụng đúng 1 mẫu phiếu NCC hiện dùng). **Chặn trùng Số Đơn NCC**:
    `poNumber` không được trùng với đơn khác **CÙNG LOẠI** (Siêu Thị/HO tách
    riêng), trừ đơn cũ đã **Từ chối**/**Đã hủy nhập**. **Khoá sửa sau khi đọc
    PDF thành công**: các field vừa tự điền được từ PDF chuyển xám/không sửa
    được nữa (tránh gõ đè nhầm) — Tiêu Đề/Nhà Cung Cấp/Ghi Chú vẫn luôn sửa tự
    do. Bấm **"🔄 Nhập Lại Từ Đầu"** để mở khoá + xoá file PDF đã chọn.
    **Ngày Giao không được TRƯỚC Ngày Đặt (từ 9/2026)**: gõ nhầm (hoặc PDF đọc
    nhầm năm) 2 ngày ngược thứ tự sẽ bị chặn ngay lúc tạo, kèm thông báo rõ —
    giao trong CÙNG NGÀY đặt vẫn hợp lệ bình thường (chỉ so theo ngày, không so
    theo giờ). **Giữ nguyên Mã hàng/Mã vạch/Thực nhận của từng hạng mục khi
    "Sửa & Gửi Lại"** sau khi bị Yêu Cầu Bổ Sung — trước đây 3 field này bị mất
    mỗi vòng sửa lại nếu form có gửi kèm danh sách hạng mục.
  - **Tạo hàng loạt từ nhiều file PDF cùng lúc**: ô "File Đơn Hàng" nhận
    **NHIỀU** tệp PDF 1 lượt (không còn giới hạn 1 file/lượt) — mỗi file được
    đọc/điền form/kiểm tra trùng Số Đơn NCC **độc lập**, tạo thành **từng đơn
    hàng riêng** (không gộp chung 1 đơn). Kết quả trả về theo từng file: đơn
    tạo thành công lẫn file lỗi (đọc PDF thất bại/trùng Số Đơn NCC) đều hiện rõ
    trong 1 bảng tổng kết cuối cùng — 1 file lỗi không chặn các file còn lại.
  - **Duyệt Nhập Hàng/Hủy Đơn — sub-tab riêng + quyền riêng, tách khỏi luồng
    duyệt nội bộ**: 2 nút "✅ Xác nhận nhập hàng"/"❌ Hủy đơn" (áp dụng khi đơn
    đã ở trạng thái **Chờ Nhập Hàng** — tức đã qua đủ các bước duyệt nội bộ
    theo mức giá trị ở trên) **không còn nằm lẫn trong bảng danh sách Đơn
    Hàng chính nữa** — chuyển hẳn sang 1 sub-tab con riêng **"📦 Duyệt Nhập/Hủy
    Đơn Hàng"**, gác bởi quyền **RIÊNG, độc lập hoàn toàn** với quyền duyệt nội
    bộ theo mức giá trị (khối cây phân quyền 22 "Vận Hành"). **Từ 10/2026,
    quyền này TÁCH thành 2 checkbox độc lập** (trước đó là 1 quyền gộp chung
    `operationOrderReceiptManage {all, depts[]}` với `'HO'` là 1 giá trị đặc
    biệt lẫn trong `depts[]`):
    - **"🏢 Quyền Phê Duyệt Đặt Hàng HO"** (`operationOrderReceiptManageHO`) —
      1 công tắc BẬT/TẮT đơn giản (KHÔNG có phạm vi con — HO là 1 thực thể duy
      nhất, không chia theo phòng ban).
    - **"Quyền Phê Duyệt Đặt Hàng Siêu Thị"** (`operationOrderReceiptManageStore`,
      `{all, depts[]}`) — toàn quyền HOẶC giới hạn đúng 1/nhiều siêu thị cụ
      thể, y hệt mô hình phạm vi của các quyền theo-phạm-vi khác. **⚠️ Quyền
      này CHỈ để xác nhận NHẬN HÀNG/HỦY ĐƠN sau khi đơn đã duyệt xong hết —
      KHÔNG liên quan gì tới việc phê duyệt chi tiêu đơn hàng** (xem "⚙️ Quy
      Trình Hỗn Hợp" ở trên cho việc đó). **Lỗi ĐÃ VÁ (đợt rà soát 10/2026)**:
      danh sách chọn phạm vi siêu thị của quyền này trước đây lấy nhầm nguồn
      từ danh mục **Phòng Ban (HO)** thay vì danh mục **Siêu Thị** — khiến
      chọn giới hạn 1/nhiều siêu thị cụ thể không bao giờ khớp được đơn hàng
      thật (đơn STORE luôn ghi nhận theo tên siêu thị, không phải tên phòng
      ban HO) — đã sửa để hiện đúng danh mục Siêu Thị. User đã lỡ chọn nhầm
      "siêu thị" từ trước bản vá này cần vào lại cấu hình quyền, chọn lại
      đúng tên siêu thị thật.

    User đã được cấp quyền cũ trước 10/2026 vẫn hoạt động đúng như trước (server
    tự đọc field cũ nếu 2 field mới chưa từng tồn tại) — admin chỉ cần vào lại
    Hệ Thống → Phân Quyền của user đó, bấm Lưu 1 lần là chuyển hẳn sang 2 quyền
    mới. Mục đích: cho phép giao việc "nhận hàng thực tế tại kho/siêu thị" cho
    1 nhóm người khác hẳn nhóm phê duyệt ngân sách đơn hàng (VD thủ kho xác
    nhận nhập hàng, không cần và không nên có quyền duyệt chi tiêu).
- **Cấu Hình API (đồng bộ đơn hàng ra hệ thống dsmart16)** — Hệ Thống → Quản
  Trị (admin), sub-tab **"🔌 Cấu Hình API"**: bật/tắt đồng bộ, Base URL hệ
  thống dsmart16, tên + giá trị header xác thực (giá trị nhập 1 lần, sau đó ẩn
  — giống cơ chế mật khẩu SMTP, không hiện lại giá trị đã lưu), trường dùng để
  đối chiếu đơn hàng phía dsmart16 (mặc định Số Đơn NCC), chu kỳ đồng bộ (phút).
  Có nút **"🔄 Đồng Bộ Ngay"** để kích hoạt thủ công ngoài chu kỳ tự động. Job
  nền chạy mỗi 5 phút (tự bỏ qua nếu chưa tới chu kỳ đã cấu hình hoặc tính
  năng đang tắt), lấy các đơn hàng cần gửi, gửi từng đơn qua API dsmart16
  (Base URL + header tuỳ chỉnh), đánh dấu đơn đã đồng bộ khi thành công —
  lỗi ở 1 đơn không chặn các đơn còn lại trong cùng lượt chạy. Trạng thái/
  thông báo lần đồng bộ gần nhất hiện ngay trên màn Cấu Hình API.
  **Chỉ Quản Trị Viên ĐỌC được cấu hình này (từ 9/2026)**: trước đây giá trị
  header xác thực đã được giấu kỹ, nhưng Base URL/tên header/thông báo lỗi đồng
  bộ vẫn phát cho mọi tài khoản đã đăng nhập (lộ thông tin hạ tầng nội bộ) —
  nay tài khoản không phải admin đọc về rỗng, không đổi gì với admin.
  **Tự đồng bộ lại khi đơn đổi trạng thái (từ 9/2026)** — trước đây 1 đơn
  hàng chỉ đồng bộ ĐÚNG 1 LẦN duy nhất (thường lúc còn Chờ duyệt); đơn đổi
  trạng thái sau đó (Chờ duyệt → Đã duyệt → Đã nhận, ngày duyệt/nhận được
  gán, số tiền sửa lại...) KHÔNG bao giờ được gửi lại, dsmart16 giữ mãi bản
  ghi cũ đã lỗi thời. Nay hệ thống lưu lại nội dung của lần gửi thành công
  gần nhất, tự so sánh mỗi lượt quét và gửi lại khi phát hiện khác — y hệt
  thì bỏ qua, không gửi thừa.
  **Sửa cấu hình giữa lúc job đang chạy (từ đợt rà soát cụm Hệ Thống/Admin/Cấu
  Hình)** — trước đây job ghi lại trạng thái đồng bộ bằng bản cấu hình đọc từ
  ĐẦU lượt chạy, nên nếu admin đổi Base URL/chu kỳ/tắt đồng bộ trong lúc job
  đang gửi (có thể mất nhiều phút) thì thay đổi đó bị ghi đè lại về giá trị cũ
  mà không báo gì. Nay job đọc lại cấu hình mới nhất ngay trước khi ghi và chỉ
  cập nhật đúng 3 trường trạng thái của lượt chạy (thời điểm/kết quả/thông báo).
  **Chỉ admin đọc được cấu hình này** — trước đây Base URL + tên header xác
  thực trả về cho MỌI tài khoản đã đăng nhập qua API tải dữ liệu chung (giá trị
  header thì chưa bao giờ trả ra); nay ẩn hoàn toàn với người không phải admin.
- **Mở Mới / Sửa Chữa Siêu Thị** — pipeline 4 giai đoạn **Dự toán → Thực hiện
  → Nghiệm thu → Báo cáo**:
  - **Hồ sơ Mở Mới/Sửa Chữa (bản thân bản ghi)** — đi thẳng trạng thái đã
    duyệt ngay lúc tạo, **không** qua bước phê duyệt riêng cho chính bản ghi.
  - **Giai đoạn "Danh mục đầu tư" (trước đây gọi "Dự toán") — KHÔNG có bước
    phê duyệt nào cả**: người quản lý dự án (người tạo hồ sơ) tự lập danh mục
    đầu tư rồi bấm "💾 Lưu Danh Mục Đầu Tư" là hoàn tất ngay
    (`estimateStatus` đi thẳng Nháp → Đã lưu, không qua ai duyệt, không cấu
    hình được ở Hệ Thống → Quy Trình & Phê Duyệt nữa) — mở khoá giai đoạn
    Thực hiện ngay lúc lưu xong. Đã lưu rồi vẫn sửa lại được (thêm/sửa/xoá
    hạng mục) bất cứ lúc nào, không chỉ lần đầu.
  - Sau khi lưu xong Danh mục đầu tư: lập/theo dõi cây công việc thực hiện thực tế
    (độc lập, không tự đồng bộ theo danh mục dự toán) → nghiệm thu khi toàn
    bộ công việc đã xong (ngay hoặc sau N ngày) → báo cáo tổng kết.
  - **Cây công việc Thực hiện/Nghiệm thu, cập nhật tiến độ**: mỗi công việc
    LÁ (không có việc con) có nút "🔄 Cập Nhật Tiến Độ" mirror ĐÚNG UX modal
    "Cập Nhật Tiến Độ" của module Công Việc công ty — khi đang "Đang thực
    hiện", dropdown có 2 lựa chọn: "Vẫn đang thực hiện" (chỉ ghi thêm 1 dòng
    ghi chú tiến độ, BẮT BUỘC nhập ghi chú, KHÔNG đổi trạng thái — gọi được
    nhiều lần liên tiếp) hoặc "Hoàn thành — Nộp nghiệm thu" (đổi hẳn sang
    "Đang nghiệm thu"). Chỉ khi CHỦ ĐỘNG chọn vế sau trạng thái mới thực sự
    đổi.
  - **Công việc CÓ việc con** (đầu mục lớn) không bao giờ tự tay cập nhật/
    nghiệm thu được (server luôn từ chối) — trạng thái LUÔN tính lại tự động
    theo con: khi tất cả con đã "hoàn thành" cha tự chuyển "Đang nghiệm thu",
    khi tất cả con đã "Đã nghiệm thu" cha tự chuyển "Đã nghiệm thu" — đúng
    nhiều cấp (cháu → con → cha → ông...).
  - **Nghiệm thu — "🔄 Bổ Sung"**: người nghiệm thu (toàn quyền hoặc đúng
    người được CHỈ ĐỊNH nghiệm thu việc đó) có 2 lựa chọn khi công việc lá
    đang "Đang nghiệm thu": "✅ Nghiệm Thu" (chốt xong) hoặc "🔄 Bổ Sung" (chỉ
    ghi lý do cần sửa/bổ sung, giữ nguyên "Đang nghiệm thu" — có thể bấm nhiều
    lần).
  - **"📜 Xem Lịch Sử"**: mỗi dòng công việc (cả Thực Hiện lẫn Nghiệm Thu, mọi
    cấp) có nút mở bảng lịch sử đầy đủ (hành động/người thực hiện/thời gian/
    ghi chú) — mirror bảng lịch sử của module Công Việc.
  - **Quyền quản lý — theo "người quản lý dự án"**: chỉ **người quản lý dự
    án** (= người tạo hồ sơ) mới toàn quyền tạo/sửa/xoá đầu mục công việc lớn/
    con + quản lý Danh Mục Đầu Tư + Bắt Đầu Kỳ Thực Hiện + Xác Nhận Đưa Vào Sử
    Dụng, và **CHỈ trên hồ sơ do CHÍNH mình tạo**. 2 quyền **"🏬 Tạo Đề Xuất Mở
    Mới Siêu Thị"**/**"🔧 Tạo Đề Xuất Sửa Chữa Siêu Thị"** (cây phân quyền,
    khối 22 "Vận Hành") cấp quyền quản lý trên hồ sơ TỰ TẠO. Quyền
    **"🏬 Quản Lý Hồ Sơ Siêu Thị (Toàn Quyền — Không Phân Biệt Người Tạo)"**
    (`operationRecordManageAll`) dành cho vai trò cần quản lý xuyên hồ sơ (VD
    trưởng phòng Vận Hành theo dõi mọi dự án của cả phòng): toàn quyền như
    trên nhưng trên **MỌI** hồ sơ. Người thực hiện (được gán "Người Phụ Trách"
    của TỪNG công việc) vẫn tự cập nhật tiến độ đúng việc của mình; người
    nghiệm thu được CHỈ ĐỊNH riêng cho từng việc vẫn tự nghiệm thu đúng việc
    đó — không cần bất kỳ quyền quản lý nào ở trên.
  - **Danh Mục Đầu Tư 2 cấp**: bảng hạng mục Danh Mục Đầu Tư (giai đoạn Dự
    toán) hỗ trợ **đúng 2 cấp** — 1 "danh mục lớn" có thể chứa nhiều "danh mục
    con" bên trong (KHÔNG lồng sâu hơn 2 cấp). Mỗi dòng có cột **"Cha"** riêng
    để đổi/gán cha bất kỳ lúc nào. Danh mục lớn có ≥1 con thì cột "Chi Phí"
    của chính nó tự động = **tổng Chi Phí của toàn bộ con**. **Tổng Danh Mục
    Đầu Tư** (dùng để tính "Ngân sách còn lại") chỉ cộng các danh mục LỚN —
    con đã nằm trong số tự cộng của cha rồi nên KHÔNG bị cộng đúp. Xoá 1 danh
    mục lớn đang có con sẽ **xoá cùng toàn bộ con của nó** (cascade).
  - **"Người Phụ Trách" danh mục lớn**: mỗi danh mục LỚN (không áp dụng danh
    mục con) có thể gán **nhiều** "Người Phụ Trách" (chọn qua ô tìm-kiếm-gõ-
    chọn nhiều người, chỉ người quản lý hồ sơ toàn quyền mới gán/đổi được).
    Người phụ trách (dù không phải người tạo hồ sơ/không có quyền quản lý
    hồ sơ nào khác) tự động: (1) **xem được cả hồ sơ** chứa danh mục lớn mình
    phụ trách dù khác phòng ban/không phải approver; (2) trong bảng Danh Mục
    Đầu Tư, chỉ nhìn thấy đúng danh mục lớn mình phụ trách + toàn bộ con của
    nó (danh mục khác trong cùng hồ sơ bị ẩn khỏi họ); (3) sửa được nội dung/
    mô tả/chi phí/ghi chú của chính danh mục lớn đó + toàn quyền thêm/sửa/xoá
    danh mục con bên trong — **KHÔNG** xoá được chính danh mục lớn, **KHÔNG**
    tự thêm danh mục lớn mới, **KHÔNG** tự đổi lại danh sách người phụ trách
    (server bỏ qua thay đổi field này nếu người gửi không phải người quản lý
    hồ sơ toàn quyền).
  - **"Ngày Bắt Đầu" + "Tần Suất Cập Nhật Tiến Độ" — cảnh báo quá hạn cập
    nhật**: form Thêm/Sửa công việc (cây Thực Hiện) có 2 ô tuỳ chọn — **"Ngày
    Bắt Đầu"** và **"Tần Suất Cập Nhật Tiến Độ (số ngày)"** — CHỈ áp dụng công
    việc LÁ. Cơ chế cảnh báo hoàn toàn THỤ ĐỘNG (tính lại mỗi lần tải trang,
    KHÔNG có job/cron, KHÔNG gửi email chủ động): nếu đã qua "Ngày Bắt Đầu",
    công việc CHƯA "Đã nghiệm thu", và số ngày kể từ lần cập nhật tiến độ gần
    nhất ≥ Tần Suất đã đặt → hiện badge đỏ **"⚠️ Quá hạn cập nhật tiến độ — X
    ngày"**. Không đặt Tần Suất thì KHÔNG BAO GIỜ hiện badge này.
  - **"🔗 Liên Kết" công việc — phụ thuộc kiểu quản lý dự án**: mỗi công việc
    LÁ có nút **"🔗 Liên kết"** để chọn 1 hoặc nhiều công việc LÁ KHÁC trong
    CÙNG hồ sơ mà nó **PHỤ THUỘC** vào. Công việc có liên kết phụ thuộc **CHƯA
    thể bấm "Bắt đầu thực hiện"** cho tới khi **TẤT CẢ** công việc liên kết đã
    "Đã nghiệm thu" — hết chặn ngay khi liên kết cuối cùng xong, không cần
    thao tác gì thêm. Chặn vòng lặp phụ thuộc (trực tiếp hoặc dài hơn), chỉ
    liên kết được công việc LÁ trong CÙNG hồ sơ, chỉ người quản lý hồ sơ đặt/
    sửa được liên kết.
  - **2 loại cảnh báo quá hạn tách riêng**: **🔴 "Quá hạn — Chưa bắt đầu"**
    (đã qua Hạn Hoàn Thành mà vẫn "Chưa bắt đầu") và **🟠 "Quá hạn — Chưa hoàn
    thành"** (đã qua Hạn Hoàn Thành mà chưa "Đã nghiệm thu") — hiện đồng bộ ở
    tab Báo Cáo (khối "📊 Thống Kê Quá Hạn Theo Công Việc"), 2 tab Thực Hiện/
    Nghiệm Thu (cột "Quá Hạn"), và trong cây công việc (badge dưới tên). Công
    việc đã "Đã nghiệm thu" hoặc chưa đặt Hạn Hoàn Thành thì không bao giờ bị
    gắn cờ.
  - **"📋 Tổng Quan Toàn Bộ Công Việc" + Xuất Excel**: tab con "📊 Báo Cáo" có
    1 bảng **liệt kê TỪNG công việc** (không rollup theo hồ sơ) của **TẤT CẢ**
    hồ sơ đang hiển thị, kèm đủ Mã/Tên Hồ Sơ, Tên Công Việc, Người Thực Hiện/
    Nghiệm Thu, Trạng Thái Công Việc, Trạng Thái Hạn, Ngày Bắt Đầu/Hạn Chót/
    Ngày Nghiệm Thu — có 2 filter riêng (Trạng Thái Công Việc/Trạng Thái Hạn)
    và nút **"📥 Xuất Excel"** xuất đúng bảng đang xem (áp dụng mọi filter).
  - **"👁️ Xem Nhanh" theo số liệu (9/2026)**: bảng rollup cấp hồ sơ ở tab
    "📊 Báo Cáo" (cột Tổng CV/Đã Nghiệm Thu/Đang Thực Hiện/Chưa Bắt Đầu) giờ
    **bấm được trực tiếp vào từng số liệu** — mở modal liệt kê ĐÚNG các công
    việc thuộc nhóm vừa bấm (tên việc, trạng thái, người thực hiện, hạn), không
    cần mở "Xem/Lập Danh Mục Đầu Tư" đầy đủ chỉ để xem nhanh 1 nhóm công việc
    của 1 hồ sơ.

### 4.5. Nhân Sự

Nhóm module đội Nhân Sự quản lý + toàn công ty tương tác gián tiếp (cơ cấu tổ
chức ảnh hưởng tới ai duyệt gì ở các module khác, KPI, onboarding/offboarding
nhân sự mới/nghỉ việc).

#### 4.5.1. Cơ Cấu Tổ Chức (Versioned) & Cấu Hình Luồng Đánh Giá KPI Theo Vị Trí

**Nhân Sự → Cơ Cấu Tổ Chức** — **vai trò**: đây là "bộ não" phía sau xác định
ai là quản lý trực tiếp của ai, và ai đánh giá KPI cho ai — hầu hết nhân viên
không thao tác trực tiếp ở đây, nhưng kết quả của nó ảnh hưởng ngầm tới nhiều
module khác (Quản Lý Trực Tiếp dùng ở nhiều luồng duyệt, người đánh giá KPI).
Là 1 cây tổ chức **CÓ PHIÊN BẢN** (mỗi lần sửa cơ cấu là 1 bản nháp riêng,
không ảnh hưởng ngay tới hệ thống đang chạy) và **luồng đánh giá KPI cấu hình
theo đúng vị trí trong cây**.

- **Vòng đời 1 phiên bản cây**: **Nháp (DRAFT)** — sửa thoải mái, chưa ảnh
  hưởng gì tới hệ thống → **Đang áp dụng (APPLIED)** — luôn đúng 1 bản duy
  nhất tại một thời điểm, bấm "Áp dụng" sẽ tự chuyển bản đang áp dụng trước đó
  (nếu có) sang → **Lưu trữ (ARCHIVED)** — chỉ xem, so sánh, không sửa được
  nữa. Muốn sửa tiếp cây đang chạy → bấm "Tạo bản nháp mới" (nhân bản từ bản
  đang áp dụng), sửa xong thì "Kiểm tra hợp lệ" rồi "Áp dụng". **Xoá bản nháp
  không dùng nữa (9/2026)**: tạo thử/nhân bản nhầm 1 bản Nháp muốn dọn đi thì
  chọn đúng bản đó ở dropdown Phiên bản → bấm "🗑️ Xoá Bản Nháp Này" — CHỈ
  xoá được bản đang ở trạng thái Nháp (khôi phục được qua Thùng Rác nếu cần),
  bản Đã áp dụng/Lưu trữ không xoá được.
- **Cây gồm 3 loại node**: **Công ty** (gốc, duy nhất), **Phòng Ban** (tên tự
  gõ, có thể gắn với 1 phòng ban/siêu thị thật có sẵn trong hệ thống để dùng
  làm căn cứ so khớp — không bắt buộc), **Vị Trí** (chức danh — tên hiển thị
  tự ghép "<Chức danh> <Tên phòng ban chứa nó>", trừ vị trí đánh dấu "không
  thuộc phòng ban nào" như Tổng Giám Đốc thì chỉ hiện đúng chức danh). Mỗi
  **Vị Trí** còn có thể gắn thêm **"Vị Trí Làm Việc"** (🏢 Văn phòng / 🏪 Siêu
  Thị, tuỳ chọn) — dùng để tự đồng bộ mô hình chấm công (module Công & Phép)
  xuống tài khoản khi HR gán chức vụ này cho ai đó ở Hồ Sơ Nhân Sự (mục 4.5.3).
- **"Ai đang giữ 1 vị trí" được suy ra ĐỘNG, không lưu riêng** — khớp đúng
  Phòng Ban + Chức Danh hiện tại của từng nhân viên (2 trường đã có sẵn trên
  hồ sơ Người Dùng) với vị trí đó trong cây đang áp dụng. Đổi phòng ban/chức
  danh của 1 nhân viên ở màn Người Dùng là đủ để họ "chuyển vị trí" trong cây.
- **Quản Lý Trực Tiếp tự động cập nhật khi Áp Dụng 1 phiên bản** — ngay khi
  bấm "Áp dụng", hệ thống tự tính lại `managerUsername` cho từng nhân viên
  (= ai đang giữ vị trí CHA của vị trí họ đang giữ), CHỈ khi tra ra được ĐÚNG
  1 người; trường hợp vị trí cha chưa ai giữ hoặc có nhiều hơn 1 người cùng
  giữ thì **giữ nguyên** Quản Lý Trực Tiếp cũ và liệt kê rõ trong màn "Kết Quả
  Áp Dụng" để admin xử lý thủ công (KHÔNG suy đoán bừa).
- **Nút "🔄 Đồng Bộ Quản Lý Trực Tiếp"** (thanh công cụ, chỉ hiện khi có
  quyền `orgChartManage` VÀ bản đang APPLIED) — tính lại `managerUsername` cho
  toàn bộ nhân viên theo ĐÚNG cây đang áp dụng hiện tại, **KHÔNG cần tạo bản
  nháp mới rồi Áp dụng lại**. Dùng khi HR chỉ đổi Phòng Ban/Chức Danh của 1
  nhân viên ở màn "Sửa Người Dùng" (thăng chức/điều chuyển nhẹ) — thao tác đó
  không tự động chạy lại cơ chế tính `managerUsername` (chỉ chạy lúc "Áp
  dụng" 1 phiên bản cây), nên vị trí họ vừa chuyển tới sẽ không có
  `managerUsername` đúng cho tới khi bấm nút này. Cùng logic/cùng màn "Kết
  Quả Áp Dụng" như khi Áp Dụng phiên bản (liệt kê rõ trường hợp không tra ra
  đúng 1 người để admin xử lý thủ công).
- **Xoá 1 node bị chặn nếu còn người đang giữ** — phải chuyển nhân viên đó
  sang vị trí/phòng ban khác trước.
- **"Kiểm tra hợp lệ"** trước khi áp dụng, phát hiện: node cha không tồn tại;
  vị trí bị xoá khỏi bản nháp nhưng bản đang áp dụng vẫn còn người giữ; nhiều
  hơn 1 node "Trưởng phòng" cùng phòng ban đều có người giữ.
- **Cấu Hình Luồng Đánh Giá KPI** (sub-tab riêng, quyền `orgChartManage` HOẶC
  quyền `kpiFlowConfigManage` — tách riêng để giao được cho người chỉ tinh
  chỉnh luồng KPI mà không có quyền sửa cây tổ chức): mỗi khi Áp Dụng 1 phiên
  bản, hệ thống **tự sinh quan hệ "vị trí cha đánh giá vị trí con"** cho mọi
  cặp Vị Trí-Vị Trí kề nhau (chỉ điền chỗ trống). Có thể **thêm quan hệ thủ
  công** ngoài cây báo cáo hành chính và **xoá bất kỳ quan hệ nào**. Tra cứu
  nhanh "ai đang đánh giá KPI cho 1 nhân viên" qua ô tìm kiếm ngay trong màn
  này.
  **Tự dọn quan hệ tự sinh lỗi thời khi đổi cha (từ 9/2026)**: mỗi lần Áp
  Dụng, ngoài việc thêm quan hệ còn thiếu như trên, hệ thống nay còn tự
  **XOÁ** quan hệ tự sinh đã lỗi thời khi 1 vị trí bị chuyển sang cấp trên
  khác giữa 2 lần Áp Dụng — trước đây quan hệ CŨ vẫn tồn tại song song với
  quan hệ MỚI, khiến quản lý CŨ tiếp tục có quyền đánh giá KPI của nhân viên
  đã chuyển sang quản lý khác ("2 người cùng chấm 1 người"). Quan hệ thêm
  THỦ CÔNG (không theo cây báo cáo hành chính) không bao giờ bị đụng vào.
- **Không làm ở đợt này** (đã cân nhắc, không phải bỏ sót): chưa dựng bảng
  lịch sử "ai giữ vị trí nào từ ngày nào"; danh sách Phòng Ban toàn hệ thống
  (`DB.depts`) chưa gắn động theo cây; chưa có cảnh báo tự động khi Offboarding
  1 người đang là người đánh giá KPI của vị trí khác.

#### 4.5.2. Onboarding / Offboarding

Mô hình quy trình có checklist theo giai đoạn (thay hẳn bản cũ "1 yêu cầu = 1
ticket Hỗ Trợ IT cấp/khoá tài khoản"). Tạo quy trình:

- **Onboarding** — khai báo nhân viên MỚI (mã nhân viên tự gõ, họ tên, Vị
  Trí HO/Siêu Thị → Phòng Ban/Siêu Thị + Chức Danh lấy từ danh mục hệ
  thống, Email **để trống nếu chưa cấp, bắt buộc với nhân viên Siêu Thị**,
  SĐT, Ngày vào làm, Quản lý trực tiếp tuỳ chọn) rồi bấm "Tạo Quy Trình".
- **Offboarding** — tra cứu nhân viên ĐÃ CÓ tài khoản (gõ tên/mã nhân viên,
  tự động lấy phòng ban/chức danh/email từ hệ thống), nhập **Ngày Nghỉ Việc
  (bắt buộc, validate cả server)**, tuỳ chọn tick "đang giữ vị trí quản lý" +
  chọn Quản lý trực tiếp, rồi bấm "Tạo Quy Trình".
- Ngay khi tạo, hệ thống **tự sinh sẵn checklist các việc cần làm** từ danh
  mục chuẩn (Quản Lý > Checklist Mẫu), phân theo **giai đoạn** (Onboarding:
  Chuẩn bị trước ngày đi làm → Ngày đầu tiên → Tuần/Tháng đầu → Kết thúc thử
  việc; Offboarding: Thông báo nghỉ việc → Bàn giao công việc → Thu hồi tài
  sản & quyền truy cập → Quyết toán tài chính → Sau khi nghỉ) và **nhãn trách
  nhiệm** (Nhân Sự/IT/Hành Chính/Tài Chính/Quản lý trực tiếp — chỉ quyết định
  AI được thao tác việc đó, không phải phòng ban thật). Hạn từng việc = ngày
  mốc + số ngày lệch cấu hình sẵn trong danh mục.
- Trong màn **Chi Tiết Quy Trình**: đánh dấu **Hoàn thành**/**Bỏ qua** từng
  việc (bỏ qua việc bắt buộc chỉ người quản lý quy trình mới làm được, phải
  nhập lý do), **Giao lại** việc cho người khác, đính kèm tài liệu, xem lịch
  sử. Quy trình **tự động chuyển "Hoàn tất"** ngay khi mọi việc bắt buộc ở mọi
  giai đoạn đã xong/bỏ qua — không có nút "chuyển giai đoạn" thủ công. Có thể
  **Huỷ quy trình** (bắt buộc lý do) khi đang thực hiện.
- **Chặn tự động Hoàn Tất nếu thiếu người kế nhiệm** (chỉ áp dụng Offboarding)
  — ngay cả khi mọi việc bắt buộc đã xong, hệ thống **kiểm tra SỐNG**: nếu
  nhân viên đang nghỉ việc hiện vẫn là "Quản lý trực tiếp" (`managerUsername`)
  của bất kỳ ai đang active, quy trình **giữ nguyên "Đang thực hiện"** kèm
  cảnh báo "Chờ chỉ định người kế nhiệm" — tránh để cả đội "mồ côi" quản lý.
  HR bấm **"Chỉ định người kế nhiệm"** ngay trong Chi Tiết Quy Trình, chọn 1
  tài khoản đang active (không phải chính người sắp nghỉ việc) — hệ thống
  **lập tức chuyển `managerUsername` của toàn bộ người đang báo cáo trực
  tiếp** cho người sắp nghỉ việc sang người kế nhiệm, ghi lịch sử, và nếu đó
  là điều kiện cuối cùng còn thiếu thì quy trình **tự chuyển Hoàn Tất ngay**.
  Việc kiểm tra dựa trên `managerUsername` SỐNG tại thời điểm đó (không dựa
  vào ô "đang giữ vị trí quản lý" HR tự tick lúc tạo — ô đó chỉ mang tính
  tham khảo, phòng trường hợp HR quên tick).
- **Cơ chế liên kết Hỗ Trợ IT** — mỗi việc thuộc nhãn **IT** có thể (không bắt
  buộc) **"Tạo Ticket IT"** riêng — sinh 1 ticket "Hỗ Trợ Yêu Cầu" (danh mục
  "🔑 Tài khoản / Đăng nhập", mục 4.2) để đội IT xử lý theo đúng quy trình sẵn
  có. **IT vẫn tự tay tạo email + tài khoản AD hoàn toàn NGOÀI hệ thống
  này** — hệ thống KHÔNG BAO GIỜ tự động TẠO MỚI tài khoản `DB.users` qua bất
  kỳ đường nào. Khi IT đánh dấu ticket "Hoàn thành" kèm ghi chú, hệ thống ghi
  lại đúng việc đã sinh ra ticket đó chuyển "Hoàn thành", và (từ v17.6, khớp
  đúng những gì xảy ra khi HR tự bấm "Hoàn thành" trực tiếp trên việc đó)
  **cũng tự đóng hợp đồng lao động đang hiệu lực + khoá tài khoản đăng nhập
  của nhân viên đó** nếu chính việc nhãn IT này là việc cuối cùng khiến
  Offboarding đủ điều kiện hoàn tất — trước đó 2 hiệu ứng phụ này CHỈ chạy
  đúng khi hoàn thành việc trực tiếp trên giao diện, bỏ sót nếu hoàn thành
  qua xác nhận ticket IT.
- **Việc Của Tôi** — 1 sub-view tổng hợp mọi việc CHƯA XONG/QUÁ HẠN đang được
  giao cho chính mình (giao riêng hoặc theo đúng nhãn trách nhiệm), gộp cả
  Onboarding lẫn Offboarding.
- **Checklist Mẫu** (sub-view chỉ hiện với quyền **"📋 Quản Lý Checklist
  Mẫu"**/admin) — thêm/sửa/xoá/bật-tắt từng việc trong danh mục chuẩn. Đổi
  danh mục **không ảnh hưởng ngược** các quy trình đã tạo trước đó (checklist
  đã snapshot vào từng quy trình lúc tạo).
- **Phân quyền** (khối 21 cây phân quyền) — 4 cờ phẳng: **"🆕 Quản Lý
  Onboarding"**/**"🚪 Quản Lý Offboarding"** (tạo + quản lý quy trình đúng
  loại), **"📋 Quản Lý Checklist Mẫu"** (chỉ sửa danh mục chuẩn, KHÔNG tự động
  có quyền tạo/quản lý quy trình), **"👁️ Xem Toàn Bộ Quy Trình"** (chỉ xem,
  KHÔNG thao tác được). Người tạo/quản lý trực tiếp/được giao riêng 1 việc
  luôn xem được đúng quy trình liên quan dù không có cờ nào ở trên.

#### 4.5.3. Hồ Sơ Nhân Sự

**Nhân Sự → Hồ Sơ Nhân Sự** — **vai trò**: lưu thông tin cá nhân/nhạy cảm của
từng nhân viên (CCCD, tài khoản ngân hàng, số BHXH, mã số thuế, người phụ
thuộc, học vấn), TÁCH RIÊNG khỏi hồ sơ tài khoản đăng nhập (Người Dùng) vì
đây là dữ liệu nặng/nhạy cảm không cần tải mỗi lần đăng nhập.

- Hồ sơ **tự sinh bản Nháp** ngay khi tạo 1 quy trình Onboarding (khoá theo Mã
  Nhân Viên — lúc này nhân viên CHƯA có tài khoản VPDT), rồi **tự chuyển Đang
  làm việc/Đã nghỉ việc** khi Onboarding/Offboarding tương ứng hoàn tất — bản
  Nháp này KHÔNG cần thao tác tay nào để tạo, checklist Onboarding (mục 4.5.2)
  chỉ có 2 nút Hoàn thành/Bỏ qua từng việc, không có bước "nhập mã/hồ sơ"
  riêng. Đợt 9/2026 (theo phản hồi người dùng), màn chi tiết quy trình
  Onboarding có thêm nút **"👤 Xem Hồ Sơ"** (chỉ hiện với người có quyền xem/
  sửa toàn bộ Hồ Sơ Nhân Sự) để nhảy thẳng sang đúng hồ sơ này ở chế độ chỉ
  xem, không cần tự vào Quản Lý Hồ Sơ rồi gõ lại Mã Nhân Viên.
- HR/admin (**"🗂️ Quản Lý Hồ Sơ Nhân Sự"**) **liên kết** hồ sơ với 1 tài khoản
  VPDT thật (thường ngay sau khi IT hoàn thành việc "Tạo tài khoản VPDT" ở
  Onboarding) — trước khi liên kết, hồ sơ chỉ HR mới tra cứu được.
- **3 tầng xem**: HR/admin (`hrProfileManage`/`hrProfileFullView`/
  `hrProfileEdit`) xem/sửa đủ mọi trường KHÔNG bị giới hạn; **chính chủ** (đã
  liên kết, mục "Hồ Sơ Của Tôi") và **quản lý trực tiếp** (**"👁️ Xem Hồ Sơ
  Nhân Sự Cấp Dưới"**, đi ngược cây Quản Lý Trực Tiếp — mục 4.5.1) đều CHỈ xem
  được 15 trường nhạy cảm (ngày sinh, giới tính, email cá nhân, liên hệ khẩn
  cấp, CCCD, địa chỉ, tài khoản ngân hàng, BHXH, mã số thuế, người phụ thuộc,
  học vấn) khi HR/admin đã **chủ động mở từng trường** ở 2 màn cấu hình riêng
  (xem bên dưới) — **mặc định KHÔNG trường nào hiển thị** cho cả 2 vai trò
  này, kể cả trường vốn "luôn thấy" trước 9/2026 (ngày sinh/giới tính/email cá
  nhân); người không liên quan không tra được (kể cả báo lỗi cũng không phân
  biệt "không tồn tại" hay "không có quyền", tránh dò mã nhân viên). Sửa hồ sơ
  qua "Hồ Sơ Của Tôi" cũng chỉ sửa được đúng trường ĐANG được mở xem (đối
  xứng, chặn cả DevTools gửi tay field đã ẩn khỏi UI).
- Mọi nhân viên đã đăng nhập đều **tự xem/sửa được hồ sơ CHÍNH MÌNH** (mục
  **"Hồ Sơ Của Tôi"**) — không cần quyền gì thêm; **"Quản Lý Hồ Sơ"** (danh
  sách toàn bộ, sửa mọi trường, đổi trạng thái tay Đang làm việc ↔ Nghỉ dài
  hạn) chỉ HR/admin thấy. Mỗi dòng có 2 nút thao tác: **"👁️ Xem"** (mở hồ sơ ở
  chế độ chỉ đọc, không có nút Lưu/liên kết tài khoản) và **"✏️ Sửa"** (mở
  đúng form sửa như trước) — CẢ 2 đều dùng chung quyền `hrProfileManage`,
  KHÔNG phải 2 tầng quyền khác nhau. **Không có nút Xoá** cho Hồ Sơ Nhân Sự —
  khác với hầu hết module khác đều cho admin xoá — vì Mã Nhân Viên được nhiều
  module khác tham chiếu bằng chuỗi tự do (Công & Phép, Đồng Phục, Hợp Đồng
  Lao Động, Cơ Cấu Tổ Chức...) chứ không phải khoá ngoại SQL thật, xoá 1 hồ sơ
  sẽ để lại tham chiếu "mồ côi" ở các module đó mà hệ thống không tự dọn được;
  hồ sơ sai/dư chỉ nên sửa lại hoặc để nguyên (không có tác dụng phụ nếu không
  liên kết tài khoản/không hiển thị trong danh sách nhân viên đang làm việc
  nếu chuyển trạng thái Nghỉ dài hạn).
- **Không đổi trạng thái tay được** DRAFT/Đã nghỉ việc — 2 trạng thái này chỉ
  do hệ thống tự đặt theo Onboarding/Offboarding, tránh HR lỡ tay đóng nhầm hồ
  sơ người đang thực sự làm việc.
- **Nhân viên cũ chưa qua Onboarding**: HR/admin ở "Quản Lý Hồ Sơ" có thêm
  **"➕ Tạo Hồ Sơ Mới"** (nhập tay 1 hồ sơ, tuỳ chọn liên kết ngay tài khoản
  VPDT, tạo thẳng trạng thái Đang làm việc — không qua Nháp) và **"📤 Nhập
  Excel"** (tải mẫu → điền → xem trước → xác nhận nhập hàng loạt, dòng lỗi bị
  bỏ qua không ảnh hưởng dòng hợp lệ khác; chưa hỗ trợ nhập Người phụ thuộc/
  Học vấn qua Excel, bổ sung sau ở Chi tiết từng hồ sơ) cùng **"📊 Xuất Excel"**
  (xuất toàn bộ danh sách).
- **Mã Nhân Viên tự sinh** (9/2026): để trống khi tạo (tay/Onboarding) sẽ tự
  cấp mã tiền tố **"BL"** + số tuần tự 4 chữ số (BL0001, BL0002...) — vẫn gõ
  tay được nếu muốn giữ mã theo hệ thống HR cũ. Chống trùng khi 2 người tạo
  gần như cùng lúc (đặt chỗ mã ngay trong cùng 1 giao dịch khoá).
- **"🔍 Kiểm Tra Nhân Sự Cũ" (Tái Tuyển)**: nút ở cả màn "➕ Tạo Hồ Sơ Mới" lẫn
  màn "Tạo Onboarding mới" — tra theo CCCD/CMND + Ngày sinh, tìm đúng hồ sơ
  ĐÃ NGHỈ VIỆC. Chọn đúng người → **giữ NGUYÊN Mã Nhân Viên cũ** (không cấp mã
  mới), nhập "Ngày bắt đầu làm việc lại" (chỉ để ghi vào lịch sử tái tuyển —
  thâm niên/thời hạn đề xuất tăng lương tính theo **Ngày hiệu lực hợp đồng lao
  động MỚI** sẽ tạo, không phải field riêng này), hồ sơ chuyển thẳng lại Đang
  làm việc.
  - **Đổi tài khoản liên kết khi tái tuyển (9/2026)**: hồ sơ ĐÃ có tài khoản
    liên kết (VD tài khoản cũ đã bị khoá/xoá khi nghỉ việc) muốn đổi sang tài
    khoản VPDT MỚI khi tái tuyển — bấm "🔁 Đổi tài khoản liên kết" ngay tại
    màn Quản Lý Hồ Sơ → gõ chọn tài khoản mới → Xác Nhận Đổi. Tài khoản cũ
    mất quyền xem/sửa hồ sơ ngay, lịch sử đổi được lưu lại để tra soát — khác
    "Liên Kết Tài Khoản VPDT" bên dưới (chỉ dùng cho hồ sơ CHƯA từng liên kết
    lần nào).
  - **Chặn CỨNG trùng CCCD/CMND khi tạo hồ sơ mới (10/2026, đợt rà soát chuyên
    sâu)**: trước đây "Kiểm Tra Nhân Sự Cũ" chỉ là GỢI Ý — bỏ qua bước tra cứu
    (vô ý hoặc cố ý) vẫn tạo được hồ sơ mới trùng CCCD/CMND với 1 hồ sơ khác.
    Từ nay hệ thống **tự chặn** (cả tạo tay lẫn Nhập Excel hàng loạt) nếu
    CCCD/CMND đã có ở BẤT KỲ hồ sơ nào khác — kể cả hồ sơ ĐÃ NGHỈ VIỆC (trường
    hợp đó đúng ra phải dùng "Kiểm Tra Nhân Sự Cũ"/Tái Tuyển ở trên để GIỮ
    NGUYÊN lịch sử cũ, không phải tạo hồ sơ mới mất hết lịch sử). Nhập Excel
    hàng loạt: dòng trùng CCCD bị **bỏ qua kèm lý do rõ ràng**, không chặn cả
    đợt nhập.
- **3 quyền chi tiết Tạo/Xem toàn bộ/Sửa** (9/2026, ở Hệ Thống > Phân Quyền,
  cạnh quyền "🗂️ Quản Lý Hồ Sơ Nhân Sự" gộp sẵn có đủ cả 3): **"➕ Tạo Mới"**
  (chỉ tạo hồ sơ + Kiểm Tra Nhân Sự Cũ, KHÔNG tự kéo theo xem được danh sách
  hồ sơ khác), **"👁️ Xem Toàn Bộ"** (xem đủ mọi hồ sơ kể cả field nhạy cảm,
  KHÔNG sửa được), **"✏️ Sửa"** (sửa được, và TỰ ĐỘNG xem được luôn — không
  sửa được cái mình không thấy). Kết hợp tự do (VD chỉ tick "Tạo Mới" cho vị
  trí thuần nhập liệu).
- **Cấu hình trường xem — 2 màn riêng, cùng nguyên tắc OPT-IN** (9/2026, 2 nút
  "⚙️" trong Quản Lý Hồ Sơ — CHỈ `hrProfileManage`/admin xem/sửa được, kể cả
  `hrProfileFullView` cũng không được sửa 2 cấu hình này): mặc định **KHÔNG
  trường nhạy cảm nào hiển thị** cho tới khi admin chủ động tick chọn —
  **"⚙️ Trường Xem Của Quản Lý Trực Tiếp"** áp dụng cho quản lý xem hồ sơ CẤP
  DƯỚI, **"⚙️ Trường Xem Của Tôi"** áp dụng cho chính nhân viên tự xem hồ sơ
  MÌNH ở "Hồ Sơ Của Tôi" — 2 cấu hình HOÀN TOÀN ĐỘC LẬP (mở trường nào ở màn
  này không tự động mở cho màn kia). Cả 2 liệt kê ĐỦ 15 trường nhạy cảm (ngày
  sinh, giới tính, email cá nhân, người liên hệ khẩn cấp + SĐT + quan hệ,
  CCCD, địa chỉ thường trú, địa chỉ hiện tại, số tài khoản ngân hàng, tên ngân
  hàng, số BHXH, mã số thuế, người phụ thuộc, học vấn) để admin tick chọn mở
  từng trường, áp dụng chung toàn hệ thống. Trước 9/2026 chỉ có cấu hình quản
  lý trực tiếp (9 trường, mặc định vẫn hiện sẵn 1 số trường "cơ bản" như ngày
  sinh/giới tính/email cá nhân) — nay đổi hẳn sang opt-in triệt để cho CẢ 2
  vai trò, theo đúng yêu cầu người dùng ("quyền được xem chỉ được xem khi tôi
  chọn trường ở đây").
- **Chức Vụ (chọn từ Cơ Cấu Tổ Chức)**: HR/admin gán/đổi "Chức Vụ" ngay trên
  Hồ Sơ Nhân Sự (ở màn "➕ Tạo Hồ Sơ Mới" — tuỳ chọn — lẫn ở Chi tiết hồ sơ đã
  có, nút **"🏷️ Gán/Đổi Chức Vụ"**) bằng cách **CHỌN từ bản Cơ Cấu Tổ Chức
  đang áp dụng** (mục 4.x Cơ Cấu Tổ Chức — không gõ tay), tránh sai lệch giữa
  chức danh ghi trên hồ sơ và vị trí thật trong cây tổ chức. Mỗi lần gán ghi
  **1 dòng lịch sử** (chức vụ cũ → mới, ngày hiệu lực, người thao tác, ghi
  chú) — lần gán ĐẦU TIÊN chính là "chức vụ ban đầu", các lần sau tự thành
  **lịch sử thăng chức/điều chuyển**. Không cho gán lại đúng chức vụ hiện tại
  (tránh spam lịch sử); chặn nếu vị trí chọn chưa gắn đúng Phòng Ban chuẩn
  trong Cơ Cấu Tổ Chức (trừ các chức vụ không thuộc phòng ban nào, VD Tổng
  Giám Đốc). Có thể **đính kèm Quyết định** (tệp PDF/Word/ảnh, tuỳ chọn) ngay
  lúc gán/đổi — hiển thị lại kèm liên kết tải ở từng dòng lịch sử chức vụ và ở
  khối "Lịch Sử Nhân Sự" gộp bên dưới, chỉ chính chủ hồ sơ/HR quản lý hồ
  sơ/admin xem/tải được (v17.6).
  - **Nếu hồ sơ đã liên kết tài khoản VPDT, hệ thống TỰ ĐỒNG BỘ ghi đè luôn
    Phòng Ban + Chức Danh của tài khoản đó** theo chức vụ vừa gán (đã xác
    nhận với người dùng, có ảnh hưởng tới phân quyền/hiển thị theo phòng ban
    ở nhiều module khác dùng `dept`/`jobTitle` của tài khoản — đây là hành vi
    **có chủ đích**, không phải tác dụng phụ ngoài ý muốn). **Từ 9/2026**:
    đồng bộ này cũng tự chạy ngay lúc **Liên Kết Tài Khoản** (thao tác riêng,
    khác "Gán/Đổi Chức Vụ") cho 1 hồ sơ ĐÃ có sẵn Chức Vụ nhưng CHƯA từng
    liên kết tài khoản trước đó — trước đây chỉ đồng bộ đúng lúc gán/đổi chức
    vụ, tài khoản mới liên kết không thừa hưởng đúng Chức Vụ/Phòng Ban đã có
    sẵn trên hồ sơ cho tới khi HR gán lại chức vụ 1 lần nữa.
  - **Liên kết tài khoản VPDT giờ chỉ còn vai trò MỐI LIÊN HỆ** (để tra cứu
    chéo/đăng nhập xem "Hồ Sơ Của Tôi"), KHÔNG còn là nguồn xác định chức
    vụ/phòng ban nữa — nguồn xác định chức vụ/phòng ban chính thức từ nay là
    Chức Vụ gán trên Hồ Sơ Nhân Sự (đồng bộ NGƯỢC xuống tài khoản, không phải
    chiều ngược lại).
  - **"Vị Trí Làm Việc" (Văn phòng/Siêu Thị) cũng đồng bộ theo, nếu đã cấu
    hình**: mỗi vị trí (POSITION node) trong Cơ Cấu Tổ Chức có thể gắn thêm
    thuộc tính "Vị Trí Làm Việc" (🏢 Văn phòng / 🏪 Siêu Thị, tuỳ chọn — vào
    Cơ Cấu Tổ Chức, mở Thêm/Sửa 1 vị trí để gắn). Việc này bổ sung sau khi
    phát hiện: module Công & Phép xác định mô hình chấm công (giờ hành chính
    hay theo ca) dựa vào field `posType` của tài khoản, mà trước đó cơ chế
    "Gán/Đổi Chức Vụ" chỉ đồng bộ Phòng Ban/Chức Danh — nếu HR đổi chức vụ 1
    nhân viên giữa vị trí Văn phòng ↔ Siêu Thị mà không cấu hình "Vị Trí Làm
    Việc" cho node đó, mô hình chấm công của họ ở Công & Phép sẽ KHÔNG tự đổi
    theo (vẫn cần vào màn "Người Dùng" sửa tay như trước). Với các vị trí ĐÃ
    gắn "Vị Trí Làm Việc", đồng bộ diễn ra tự động cùng lúc với Phòng Ban/Chức
    Danh khi gán chức vụ.
- **Lịch Sử Nhân Sự** (khối cuối Chi tiết hồ sơ, chỉ hiện ở chế độ "Quản Lý
  Hồ Sơ"): gộp hiển thị theo thời gian **5 nguồn** — lịch sử chức vụ (mục
  trên), **Lịch Sử Thay Đổi & Chỉnh Sửa Hồ Sơ** (9/2026 — mỗi lần tạo mới/sửa
  hồ sơ, liệt kê đúng tên trường đã đổi, chỉ ghi khi THỰC SỰ có giá trị thay
  đổi), **Tái Tuyển** (9/2026 — mục trên), lịch sử hợp đồng lao động (mục
  4.5.4 bên dưới: tạo/kích hoạt/thay hợp đồng mới/chấm dứt/sửa tay), và Phụ
  Lục hợp đồng (tăng lương, đổi vị trí...) — xem đủ "ai tăng lương/thăng
  chức/đổi hồ sơ/tái tuyển khi nào" mà không phải mở nhiều màn khác nhau,
  **luôn sắp mới nhất lên đầu** (tính theo thời gian thực, không phải so sánh
  chuỗi ngày giờ). **Yêu cầu CẢ 2 quyền** "🗂️ Quản Lý Hồ Sơ Nhân Sự" **VÀ**
  "📝 Quản Lý Hợp Đồng Lao Động" (hoặc admin) — chặt hơn từng module riêng
  lẻ, vì dữ liệu gộp có cả lương/hợp đồng (vốn chỉ người có quyền Hợp Đồng
  Lao Động được xem) lẫn chức vụ; người chỉ có 1 trong 2 quyền sẽ không thấy
  khối này.
- **"📊 Báo Cáo"** — số liệu tổng hợp trên dựa vào Hồ Sơ Nhân Sự + Hợp Đồng Lao
  Động, nhưng bản thân màn xem báo cáo **KHÔNG** nằm lồng trong "Hồ Sơ Nhân
  Sự" — từ 9/2026 đã dời thành **module con RIÊNG cấp Nhân Sự** ("Nhân Sự →
  📊 Báo Cáo" trong menu sidebar, ngang hàng Hồ Sơ Nhân Sự/Hợp Đồng Lao Động),
  xem mục 4.5.5 bên dưới — cùng yêu cầu CẢ 2 quyền như Lịch Sử Nhân Sự ở trên,
  vì employeeProfiles/laborContracts là nhóm dữ liệu cực nhạy cảm KHÔNG đi
  qua màn Báo Cáo dùng chung (mục 4.9).

#### 4.5.4. Hợp Đồng Lao Động

**Nhân Sự → Hợp Đồng Lao Động** — **vai trò**: theo dõi vòng đời hợp đồng lao
động (Thử việc → Xác định thời hạn → Vô thời hạn) của từng nhân viên. **KHÁC
HẲN** module "Hợp Đồng" ở mục 4.3 (hợp đồng mua bán/nhà cung cấp) — 2 khái
niệm hoàn toàn tách biệt, không chung dữ liệu/màn hình. **Tạo/sửa/kích hoạt/
chấm dứt hợp đồng vẫn HR-only** (quyền **"📝 Quản Lý Hợp Đồng Lao Động"**/
admin) — không đổi. Riêng **XEM** thì từ 9/2026 có thêm 1 tầng: nhân viên
được tự xem (chỉ xem, không sửa) ĐÚNG hợp đồng của CHÍNH MÌNH (đối chiếu theo
tài khoản đăng nhập gắn với hồ sơ), HR/admin vẫn xem được TOÀN BỘ hợp đồng
của mọi nhân viên như cũ — hợp đồng của nhân sự "ngoài hệ thống" (nhập mã
không gắn tài khoản đăng nhập nào, dùng cho trường hợp phát sinh ngoài luồng
Onboarding chuẩn) không có ai để tự xem, vẫn chỉ HR xem được. **Xoá hợp đồng**
(10/2026, đợt rà soát chuyên sâu — trước đây lỡ gác bằng cờ Quản Trị Viên
chung, KHÔNG nhất quán với sửa/kích hoạt/bổ sung/đổi trạng thái) từ nay cũng
gác đúng **CHỈ bằng quyền "📝 Quản Lý Hợp Đồng Lao Động"** giống mọi thao tác
khác của module này — 1 tài khoản Quản Trị Viên KHÔNG được cấp riêng quyền
này (đúng nguyên tắc 3 ngoại lệ dữ liệu nhân sự nhạy cảm, xem mục 6) sẽ KHÔNG
còn tự động xoá được hợp đồng lao động nữa.

- **Đa số hợp đồng do hệ thống TỰ TẠO** theo đúng 3 mốc trong checklist
  Onboarding (mục 4.5.2), HR không cần tạo tay:
  - Việc **"Gửi thư mời nhận việc & hợp đồng lao động"** hoàn thành → tự tạo
    hợp đồng **Thử việc**, trạng thái **Nháp**.
  - Việc **"Đón tiếp, ký hợp đồng chính thức"** (ngày đầu tiên đi làm) hoàn
    thành → tự **kích hoạt** hợp đồng thử việc (Nháp → Đang hiệu lực).
  - Việc **"Ra quyết định: ký chính thức/gia hạn/chấm dứt"** (cuối kỳ thử
    việc) hoàn thành → HR bắt buộc chọn kèm quyết định **"Ký hợp đồng chính
    thức"** (đóng hợp đồng thử việc, tự tạo hợp đồng Xác định thời hạn mới ở
    trạng thái Nháp — HR vào hoàn thiện lương/ngày hết hạn rồi kích hoạt) hoặc
    **"Chấm dứt sau thử việc"** (đóng hẳn, không tạo hợp đồng mới).
  - Quy trình **Offboarding hoàn tất** → tự đóng (Đã chấm dứt) hợp đồng đang
    hiệu lực của nhân viên đó.
  - Quy trình **Offboarding hoàn tất** (đợt rà soát bảo mật v17.5) → nếu nhân
    viên đó CÓ tài khoản đăng nhập hệ thống, tự động **khoá tài khoản**
    (chuyển "Đang hoạt động" → "Đã khoá") VÀ vô hiệu hoá NGAY mọi phiên đăng
    nhập đang mở của tài khoản đó — không cần HR/admin tự tay khoá thủ công
    sau khi hoàn tất quy trình nghỉ việc.
- **Gia hạn hợp đồng Xác định thời hạn về sau** (không còn gắn với 1 việc
  Onboarding cụ thể nữa) là thao tác **tay** của HR ở màn Hợp Đồng Lao Động —
  quá **2 lần gia hạn liên tiếp bắt buộc chuyển Vô thời hạn** theo luật.
- **Tạo tay** chỉ dùng cho trường hợp ngoại lệ (nhân viên cũ chưa có dữ liệu
  trong hệ thống, hợp đồng phát sinh ngoài luồng Onboarding chuẩn). **Mã Nhân
  Viên MẶC ĐỊNH bắt buộc chọn từ Hồ Sơ Nhân Sự** (ô tìm-chọn, tránh gõ sai mã —
  chặn cả ở server, không chỉ ở giao diện) — tick **"Không lấy từ hồ sơ (nhập
  mã ngoài hệ thống)"** mới chuyển sang ô nhập tay tự do, dùng cho nhân viên
  cũ/cộng tác viên chưa có hồ sơ trong hệ thống.
- Mỗi hợp đồng có thể **bổ sung thay đổi** (Phụ Lục) — loại thay đổi, **2 mốc
  thời gian riêng** ("Ngày áp dụng" — TUỲ CHỌN, khi quyết định được áp
  dụng/ban hành; và "Ngày hiệu lực" — BẮT BUỘC, khi thay đổi thật sự có hiệu
  lực, có thể trễ hơn ngày áp dụng), giá trị cũ/mới, ghi chú (VD tăng lương,
  đổi vị trí) — không giới hạn số lần, giữ nguyên lịch sử, **luôn hiển thị mới
  nhất lên đầu** (9/2026). Có thể **đính kèm Quyết định** (tệp PDF/Word/ảnh,
  tuỳ chọn) ngay khi thêm thay đổi — hiển thị lại kèm liên kết tải ở từng
  dòng Phụ Lục và ở khối "Lịch Sử Nhân Sự" gộp (mục 4.5.3), giúp tra soát có
  văn bản quyết định gốc đi kèm mỗi lần tăng lương/đổi vị trí giữa kỳ hợp
  đồng (v17.6).
  - **Định dạng tiền cho phụ lục** (9/2026, cập nhật lại theo phản hồi người
    dùng — đợt trước tự đoán theo nội dung ô "Loại thay đổi" có chứa chữ
    "lương" hay không, KHÔNG đáng tin vì người dùng có thể gõ Giá trị cũ/mới
    TRƯỚC khi gõ Loại thay đổi, giá trị gõ trước không được tự định dạng
    lại): thay bằng checkbox tường minh **"💰 Giá trị tiền"** ngay cạnh 2 ô
    Giá trị cũ/mới — **mặc định BẬT** (đa số phụ lục liên quan lương), gõ số
    vào là TỰ ĐỘNG hiện dấu chấm phân cách hàng nghìn ngay lập tức (giống ô
    Lương cơ bản), không phụ thuộc thứ tự gõ/nội dung ô Loại thay đổi nữa —
    tick TẮT khi thật sự cần gõ chữ tự do (VD đổi chức danh, ca làm...).
- **Tăng lương THẬT khác Phụ Lục ghi log** (9/2026, rà soát chuyên sâu — trước
  đây dễ nhầm lẫn: thêm 1 dòng Phụ Lục "tăng lương" chỉ LƯU LẠI văn bản/lịch
  sử để tra cứu, KHÔNG tự cập nhật số tiền hệ thống dùng để tính Lương hàng
  tháng, khiến kỳ Lương sau đó vẫn tính theo lương CŨ vô thời hạn dù HR tưởng
  đã tăng): hợp đồng **Đang hiệu lực** có thêm khối riêng **"💰 Cập Nhật Lương
  Cơ Bản"** — đây mới là cách DUY NHẤT đổi số tiền thật sự dùng để tính Lương
  (module 4.5.8), tách biệt hẳn với "➕ Thêm Thay Đổi" (chỉ ghi log).
- **Cảnh báo hết hạn màu sắc trên màn hình** (9/2026, khác hẳn job email
  60/45/30 ngày ở mục dưới — đây là badge hiển thị TRỰC TIẾP ở danh sách LẪN
  chi tiết hợp đồng): hợp đồng đang **Đang hiệu lực** còn **≤30 ngày** hiện
  badge **🟡 vàng**, **≤7 ngày hoặc đã quá hạn** hiện badge **🔴 đỏ**.
- **Sửa tay trực tiếp trên hợp đồng** (loại HĐ, ngày bắt đầu/hết hạn, lương cơ
  bản, phòng ban, tệp đính kèm) giờ cũng **tự ghi 1 dòng lịch sử** (giá trị cũ
  → mới từng trường thực sự đổi, người sửa, thời điểm) — trước đây chỉ các
  hành động hệ thống (tạo/kích hoạt/thay hợp đồng mới/chấm dứt/thêm Phụ Lục)
  mới ghi lịch sử, sửa tay không để lại dấu vết. Không ghi gì nếu submit mà
  không có trường nào thực sự thay đổi giá trị.
- **Cảnh báo hết hạn tự động** (job chạy mỗi 24h, mặc định ngưỡng 60/45/30
  ngày trước hạn — **admin tự sửa được danh sách ngưỡng** ở Hệ Thống > Quản
  Trị > Cấu Hình Email, mục 7.8, ô riêng cho Hợp Đồng Lao Động, tách biệt
  ngưỡng của Giấy Phép/Gia Hạn CNTT): gửi email tới HR **CỘNG** quản lý trực
  tiếp của nhân viên đó, nhắc gia hạn/đổi loại hợp đồng/khởi tạo Offboarding
  nếu không tiếp tục sử dụng lao động — không gửi trùng lặp cho cùng 1
  ngưỡng.
- **Không làm ở đợt này** (đã cân nhắc, không phải bỏ sót): chưa có tầng nhân
  viên tự xem hợp đồng lao động của chính mình; thời hạn thử việc theo từng
  loại vị trí (chuyên môn/kỹ thuật/mùa vụ) vẫn dùng chung 1 mốc ước tính 60
  ngày (tài liệu thiết kế gốc ghi rõ cần HR/pháp chế rà soát lại theo luật
  hiện hành trước khi cứng hoá — xem mục 4.5.2, chỉ là mốc HIỂN THỊ tham
  khảo, không phải ràng buộc validate).

#### 4.5.5. Báo Cáo (Nhân Sự)

**Nhân Sự → 📊 Báo Cáo** (9/2026, dời từ tab lồng bên trong "Hồ Sơ Nhân Sự" ra
**module con RIÊNG cấp Nhân Sự** — ngang hàng Hồ Sơ Nhân Sự/Hợp Đồng Lao Động
trong menu sidebar, không lồng bên trong Hồ Sơ Nhân Sự nữa; đợt sau (cùng
9/2026, theo phản hồi người dùng) dời tiếp xuống **VỊ TRÍ CUỐI CÙNG** trong
danh sách dropdown Nhân Sự, sau "💰 Lương") — **vai trò**: số
liệu tổng hợp nhân sự, lọc theo khoảng thời gian (Từ ngày/Đến ngày) + tình
trạng HĐLĐ, ra 8 chỉ số cơ bản — nhân sự vào làm/nghỉ việc, hợp đồng mới/gia
hạn, tăng lương, thay đổi HĐLĐ khác, thăng chức/đổi chức danh, và **"HĐ sắp
hết hạn (≤30 ngày)"** (mục này LUÔN tính từ ngày hiện tại, không phụ thuộc bộ
lọc thời gian). **KHÔNG tạo collection/route mới** — vẫn đọc từ Hồ Sơ Nhân Sự
+ Hợp Đồng Lao Động qua route thống kê riêng `GET /api/hr-profile/reports`,
chỉ đổi nơi hiển thị cho đúng cấp module. **Yêu cầu CẢ 2 quyền** "🗂️ Quản Lý
Hồ Sơ Nhân Sự" **VÀ** "📝 Quản Lý Hợp Đồng Lao Động" (hoặc admin) — cùng mức
chặt như Lịch Sử Nhân Sự (mục 4.5.3), vì employeeProfiles/laborContracts là
nhóm dữ liệu cực nhạy cảm KHÔNG đi qua màn Báo Cáo dùng chung (mục 4.9).

#### 4.5.6. Công & Phép

**Nhân Sự → Công & Phép** — **vai trò**: chấm công (qua máy chấm công vật lý)
+ quản lý phép năm + lịch phân ca/đổi ca cho nhân viên Siêu Thị. **Mở cho MỌI
người** đã đăng nhập (khối "Của Tôi" — khác hẳn Hợp Đồng Lao Động ở mục 4.5.4,
HR-only) vì ai cũng cần tự xem chấm công/phép năm/nộp đơn nghỉ phép của chính
mình; các khối quản lý bên trong (Duyệt Nghỉ Phép/Phân Ca Siêu Thị/Quản Lý &
Cấu Hình) tự ẩn/hiện theo đúng quyền.

- **2 mô hình chấm công, xác định tự động theo Vị Trí (HO/Siêu Thị) của nhân
  viên** (trường có sẵn trên hồ sơ Người Dùng, không thêm cấu hình mới):
  **Giờ Hành Chính** (nhân viên Văn Phòng — so với 1 khung giờ chuẩn công ty
  duy nhất, ví dụ 08:00-17:00) và **Theo Ca** (nhân viên Siêu Thị — so với ca
  cụ thể đã được phân trong **Lịch Phân Ca**, xem bên dưới).
- **Chấm công CHỈ đến từ máy chấm công vật lý/hệ thống trung gian** đẩy dữ
  liệu qua API riêng (xem "API Máy Chấm Công" bên dưới) — **không có nút
  Check-in/Check-out thủ công trong app**, giữ đúng 1 nguồn dữ liệu chính.
  Mỗi lượt quẹt tự ghi nhận giờ vào (lượt đầu trong ngày) và giờ ra (lượt
  cuối), tự đánh dấu **đi muộn/về sớm/tăng ca ngày lễ/tăng ca cuối tuần**
  theo cấu hình. HR sửa/bổ sung tay ở **"Quản Lý & Cấu Hình"** khi máy chấm
  công lỗi/nhân viên quên quẹt thẻ.
- **Đơn nghỉ phép** (Phép năm / Nghỉ không lương / Nghỉ ốm / **Nghỉ theo giờ**
  / **Việc riêng**) — nhân viên tự nộp cho CHÍNH MÌNH (chọn loại, từ ngày, đến
  ngày, lý do), nghỉ phép năm bị chặn ngay lúc nộp nếu vượt quá số ngày còn
  lại. **Nghỉ theo giờ** dùng form riêng (chọn đúng 1 ngày + giờ bắt đầu/kết
  thúc thay vì khoảng Từ ngày–Đến ngày) — không trừ vào phép năm, không sinh
  bản ghi chấm công nguyên ngày (chỉ ghi nhận khoảng giờ nghỉ). **Việc riêng**
  dùng chung khuôn Từ ngày–Đến ngày như Nghỉ không lương/Nghỉ ốm, cũng không
  trừ phép năm. Quản lý trực tiếp (cần thêm quyền
  **"✅ Duyệt Nghỉ Phép"**, không tự động có chỉ vì là quản lý) hoặc HR duyệt/
  từ chối; đơn được duyệt **tự động trừ phép năm** (chỉ loại Phép năm) và
  **tự sinh bản ghi chấm công loại nghỉ phép** cho từng ngày trong khoảng nghỉ
  (không ghi đè nếu ngày đó đã có loại nghỉ khác). Nhân viên tự huỷ được đơn
  đang chờ duyệt hoặc đã duyệt nhưng chưa tới ngày nghỉ. **Từ 9/2026**: huỷ 1
  đơn phép năm ĐÃ DUYỆT (còn trong tương lai) nay tự **hoàn lại đúng số ngày**
  đã trừ vào quỹ phép năm VÀ tự dọn lại các bản ghi chấm công đã sinh theo
  đơn đó về trạng thái trống — trước đây huỷ chỉ đổi trạng thái đơn, số ngày
  phép đã trừ và bản ghi chấm công vẫn còn nguyên, nhân viên mất oan ngày
  phép dù chưa hề nghỉ. **Duyệt phép tự huỷ ca đã phân trùng ngày (mô hình
  theo ca, 9/2026)**: nhân viên chấm công Theo Ca (SHIFT_BASED) — duyệt đơn
  phép của họ tự động huỷ (chuyển "Đã huỷ") mọi dòng phân ca ở "📅 Phân Ca
  Siêu Thị" trùng đúng khoảng ngày nghỉ, không cần quản lý ca vào huỷ tay
  từng dòng; trước đây ca trực vẫn hiện như chưa nghỉ.
- **Phép năm** — số ngày chuẩn 12 ngày/năm (+ 1 ngày mỗi 5 năm thâm niên),
  tính theo tỷ lệ số tháng còn lại nếu vào làm giữa năm; HR **tạo/điều chỉnh
  tay** ở "Quản Lý & Cấu Hình" (carry-over, quyết định riêng của công ty).
  **Tự động tạo bù sang năm mới** (9/2026, rà soát chuyên sâu — trước đây quỹ
  Phép Năm CHỈ được tạo đúng 1 lần lúc Onboarding hoàn tất, không có gì tự
  tạo lại cho năm sau, nhân viên bị chặn xin nghỉ Phép Năm từ 1/1 hàng năm
  tới khi HR nhớ tạo tay từng người): job nền chạy mỗi 24h tự quét MỌI nhân
  viên đang hoạt động (có hợp đồng lao động) chưa có quỹ phép năm hiện tại,
  tự tạo bù — dùng ngày hợp đồng SỚM NHẤT (kể cả hợp đồng thử việc cũ đã
  chuyển trạng thái) để tính đúng thâm niên, không phải ngày hợp đồng đang
  hiệu lực hiện tại (có thể chỉ là ngày ký lại/chuyển loại hợp đồng).
  Khi Offboarding hoàn tất, hệ thống tự tính **số tiền quy đổi phép chưa nghỉ
  tham khảo** (đơn giá ngày công × số ngày còn lại) gắn vào đúng việc "Tính
  lương, phép năm chưa nghỉ, khấu trừ" trong checklist (mục 4.5.2), hiển thị
  ngay trên dòng công việc đó — **chỉ tham khảo**, kế toán tự quyết định có
  thêm vào phiếu lương kỳ cuối của nhân viên hay không (dòng "Thưởng khác" ở
  module **Lương**, mục 4.5.8) chứ hệ thống không tự động ghi thẳng vào phiếu.
- **Lịch Phân Ca** (chỉ áp dụng Siêu Thị) — Quản Lý Siêu Thị (quyền **"📅 Quản
  Lý Lịch Phân Ca"**) hoặc HR lập lịch (chọn nhân viên, ngày, ca theo **Mẫu Ca
  Làm Việc** đã cấu hình sẵn, siêu thị), chặn phân trùng ngày cho cùng 1 nhân
  viên; huỷ được 1 dòng đã phân. **Xin Đổi Ca** — nhân viên tự xin đổi 1 ca
  của mình cho người khác (đổi **1 CHIỀU**: ca chuyển hẳn sang người nhận,
  không hoán đổi 2 chiều — 2 người muốn hoán đổi cho nhau thì mỗi người tự
  nộp 1 đơn xin đổi đúng ca của mình), Quản Lý Siêu Thị đúng siêu thị đó (quyền
  **"🔄 Duyệt Đổi Ca"**, tách riêng khỏi quyền lập lịch — 1 người có thể chỉ có
  1 trong 2) hoặc HR duyệt — duyệt đổi ca (9/2026) tự kiểm tra thêm người
  **NHẬN** ca có đang trùng lịch phân ca ngày đó không (trước đây chỉ chặn
  trùng lịch lúc TẠO phân ca, chưa chặn ở bước duyệt đổi ca), tránh 1 nhân
  viên vô tình bị gán 2 ca chồng nhau cùng ngày.
- **API Máy Chấm Công** (`POST /api/attendance/clock-punch`, xác thực bằng
  **API key RIÊNG** cấp ở "Quản Lý & Cấu Hình" — **KHÔNG dùng chung** API Xác
  Thực Ngoài ở Hệ Thống, mục 7.9 — tách riêng để giảm phạm vi ảnh hưởng nếu 1
  trong 2 loại key bị lộ, máy chấm công vật lý thường đặt ở nơi công cộng hơn):
  body `{"employeeCode","timestamp"}`, định danh nhân viên bằng **Mã Nhân
  Viên** (khớp Hồ Sơ Nhân Sự). Quản lý key (tạo/thu hồi/giới hạn IP nguồn)
  cùng khuôn API Xác Thực Ngoài, chỉ admin thấy được key thật (chỉ hiện đúng 1
  lần lúc tạo).
- **Cấu Hình** (HR, quyền **"🕐 Quản Lý Chấm Công"**) — Giờ Hành Chính (giờ
  vào/ra chuẩn công ty, thời gian trễ được phép), **Ngày Lễ/Nghỉ Cố Định**
  (loại trừ khỏi tính đi muộn/tính tăng ca ngày lễ), **Mẫu Ca Làm Việc** (mã
  ca, tên, giờ bắt đầu/kết thúc, số giờ chuẩn — dùng chung cho mọi siêu thị).
- **Phân quyền** (khối cây phân quyền Nhân Sự): **"🕐 Quản Lý Chấm Công"**
  (HR, toàn quyền — chấm công/phép năm/cấu hình toàn công ty), **"✅ Duyệt
  Nghỉ Phép"** (quản lý trực tiếp — CHỈ duyệt được đơn của nhân viên thực sự
  thuộc quyền quản lý, xác định qua đúng cây Quản Lý Trực Tiếp ở mục 4.5.1),
  **"📅 Quản Lý Lịch Phân Ca"** + **"🔄 Duyệt Đổi Ca"** (Quản Lý Siêu Thị —
  giới hạn đúng siêu thị của mình, 2 cờ độc lập).
- **Không làm ở đợt này** (đã cân nhắc, không phải bỏ sót): không có nút chấm
  công thủ công trong app (chỉ máy vật lý + HR sửa tay); đổi ca 1 chiều (không
  hoán đổi chéo 2 dòng); không tự động sinh lịch phân ca tuần đầu từ checklist
  Onboarding — Quản Lý Siêu Thị/HR tự lập lịch thủ công.

#### 4.5.7. Quản Lý & Phản Hồi Ý Kiến

Phía Nhân Sự của **🤝 HCRC Đồng Hành** (mục 4.1) — **vai trò**: nơi Nhân Sự
trả lời câu hỏi nhân viên gửi qua HCRC Đồng Hành, đúng khuôn **1 hỏi–1 đáp**
(không phải khung chat trao đổi nhiều lượt như hỗ trợ khách hàng thông thường
— gửi 1 câu hỏi, nhận đúng 1 câu trả lời, hết). Câu hỏi được phân loại theo
danh mục **"Chủ Đề"** (admin tự thêm/bớt/đổi nhãn ở màn Biểu Mẫu, mục 7.3) để
Nhân Sự lọc/phân công dễ hơn khi có nhiều câu hỏi. Thông báo có câu hỏi mới chỉ
qua **cờ chưa đọc** ngay trong giao diện (không gửi email) — thiết kế có chủ
đích vì đây là kênh nội bộ tần suất thấp, không cần thêm 1 lớp email dễ bị bỏ
quên/spam như các luồng phê duyệt khác.

- **Rút lại khi còn chờ phản hồi (9/2026)**: gửi nhầm/muốn rút lại câu hỏi
  trong khi Nhân Sự CHƯA trả lời thì nhân viên tự bấm "🚫 Rút lại" ngay tại
  mục "📨 Câu Hỏi Của Tôi" — chuyển sang "Đã rút lại", không xoá hẳn (giữ lịch
  sử). Nhân Sự đã trả lời rồi thì không rút lại được nữa, và ngược lại — câu
  hỏi ĐÃ RÚT thì Nhân Sự cũng không còn trả lời được nữa (tránh trả lời nhầm
  vào câu hỏi người gửi đã tự huỷ ý định hỏi).

#### 4.5.8. Lương

**Nhân Sự → Lương** — **vai trò**: lập/tính/duyệt/công bố phiếu lương hàng
tháng, tổng hợp từ Hợp Đồng Lao Động (lương cơ bản) + Công & Phép (làm thêm
giờ, nghỉ không lương) + Hồ Sơ Nhân Sự (người phụ thuộc giảm trừ thuế). Mở cho
**MỌI người** đã đăng nhập ở mức xem — mỗi nhân viên tự xem được phiếu lương
CỦA CHÍNH MÌNH (tab "Phiếu Lương Của Tôi", không tắt được); khối "Quản Lý Kỳ
Lương" (lập/tính/duyệt) tự ẩn/hiện theo đúng quyền.

- **3 tầng quyền TÁCH BIỆT** (nguyên tắc kiểm soát nội bộ kế toán — không ai
  vừa lập vừa tự duyệt lương của chính đợt mình lập): **"💰 Lập/Tính Lương"**
  (kế toán/HR — tạo kỳ, tính lương tự động, điều chỉnh tay từng dòng, gửi
  duyệt), **"✅ Duyệt Lương"** (thường là Giám Đốc/Kế Toán Trưởng cấp cao hơn
  — duyệt/từ chối/chốt kỳ/công bố), và quyền xem-của-mình mặc định BẬT cho
  mọi tài khoản không tắt được.
- **Vòng đời 1 kỳ lương**: **Nháp** (mới tạo, kế toán bấm "Tính Lương" để hệ
  thống tự tính hàng loạt cho toàn bộ nhân viên đang hoạt động, rà soát/điều
  chỉnh tay từng dòng nếu cần — VD thêm phụ cấp/thưởng/tạm ứng/phạt) →
  **Chờ Duyệt** (gửi duyệt, không sửa tay được nữa) → **Đã Duyệt** hoặc bị
  **Từ Chối** (quay lại Nháp, kèm lý do, sửa lại rồi gửi lại) → **Đã Chốt**
  (khoá hoàn toàn, không sửa được nữa) → **Đã Công Bố** (nhân viên bắt đầu
  xem được phiếu lương của mình + nhận **thông báo trong app**, xem chuông 🔔
  ở góc màn hình — module dùng chung cho mọi thông báo hệ thống từ nay về
  sau, không qua email). Có nút **"Mở Lại"** (bắt buộc nhập lý do) đưa kỳ đã
  Chốt/Công Bố về Nháp để sửa sai sót phát hiện muộn. **Xoá kỳ tạo nhầm
  (9/2026)**: kỳ lương tạo nhầm (sai tháng/năm/tên) hiện nút "🗑️ Xoá" ngay
  tại danh sách — CHỈ khi còn Nháp và CHƯA từng bấm "Tính Lương" lần nào; kỳ
  đã có dữ liệu tính lương hoặc đã qua bất kỳ bước duyệt nào phải giữ lại làm
  lịch sử, không xoá được.
- **Các dòng tự động tính** (có dữ liệu nguồn thật trong hệ thống): Lương cơ
  bản (theo Hợp Đồng Lao Động đang hiệu lực), Làm thêm giờ 150%/200%/300%
  (theo bản ghi chấm công loại Tăng ca ngày thường/cuối tuần/lễ tết), Trừ
  ngày nghỉ không lương, BHXH/BHYT/BHTN, Thuế TNCN (lũy tiến theo giảm trừ
  bản thân + người phụ thuộc khai ở Hồ Sơ Nhân Sự). **Các dòng nhập tay** (kế
  toán tự thêm lúc rà soát, vì công ty chưa xác nhận chính sách/hệ thống chưa
  có dữ liệu nguồn để tự tính đúng): phụ cấp ăn trưa/điện thoại/chức vụ/ca
  đêm/ngày lễ, thưởng KPI, thưởng khác, tạm ứng, phạt.
- **⚠️ Cấu Hình Tỷ Lệ** (nút riêng trong màn Lương, quyền Lập/Tính hoặc Duyệt)
  — %BHXH/BHYT/BHTN, biểu thuế TNCN 7 bậc, mức giảm trừ bản thân/người phụ
  thuộc, số ngày công chuẩn HO/Siêu thị, hệ số tăng ca: **toàn bộ là số THAM
  KHẢO admin phải tự xác nhận/sửa lại đúng số thật của công ty trước khi chạy
  lương thật lần đầu** — đặc biệt **trần lương đóng BHXH** đang để mặc định
  RẤT LỚN (coi như không giới hạn) vì đây là số thay đổi theo lương tối thiểu
  vùng từng thời kỳ, không có cơ sở đoán đúng.
- **Xuất phiếu lương PDF** — nhân viên tự xuất phiếu lương của mình (đã công
  bố) ra file PDF ngay tại trình duyệt (không qua server), giữ lại làm hồ sơ
  cá nhân.
- **Liên kết Offboarding**: khi hoàn tất việc "Tính lương, phép năm chưa nghỉ"
  trong checklist Offboarding (mục 4.5.2/4.5.6), số tiền quy đổi phép chưa
  nghỉ hiện thị tham khảo ngay trên dòng công việc đó — kế toán tự thêm vào
  phiếu lương kỳ cuối của nhân viên (dòng "Thưởng khác") nếu công ty quyết
  định chi trả, hệ thống không tự động ghi thẳng vào phiếu lương.
- **Nhân viên nghỉ việc GIỮA kỳ lương** (v17.6): trước đây "Tính Lương" chỉ
  lấy nhân viên đang "Đang làm việc" — ai hoàn tất Offboarding TRƯỚC khi kế
  toán bấm "Tính Lương" của kỳ đó bị bỏ sót hoàn toàn, không có phiếu lương
  nào dù đã làm việc một phần kỳ. Từ nay hệ thống VẪN đưa những nhân viên này
  vào tính (dò theo ngày nghỉ việc cuối cùng của quy trình Offboarding đã
  hoàn tất, nằm trong khoảng kỳ đang tính) — phiếu lương sinh ra có ghi chú rõ
  ngày nghỉ việc ở dòng Lương cơ bản. **Lưu ý quan trọng**: hệ thống KHÔNG tự
  trừ tương ứng số ngày không làm việc sau khi nghỉ (vẫn tính đủ 1 tháng lương
  cơ bản theo hợp đồng) — kế toán BẮT BUỘC tự rà soát và dùng "Điều chỉnh dòng
  lương" để trừ đúng phần chưa làm việc trước khi duyệt.
- **Nhân viên MỚI VÀO LÀM giữa kỳ lương** (9/2026, chiều NGƯỢC LẠI với mục
  "Nhân viên nghỉ việc GIỮA kỳ" ở trên — trước đây KHÔNG có cảnh báo tương tự,
  người mới vào làm giữa tháng vẫn được cộng đủ 1 tháng Lương cơ bản mà không
  ai biết cần rà soát): nếu ngày hợp đồng SỚM NHẤT của nhân viên (không phải
  hợp đồng ACTIVE hiện tại — tránh nhầm với ngày ký lại/chuyển loại hợp đồng
  giữa kỳ) rơi vào giữa kỳ đang tính, dòng Lương cơ bản tự ghi chú rõ ngày vào
  làm để kế toán tự rà soát + dùng "Điều chỉnh dòng lương" trừ đúng phần chưa
  vào làm nếu cần — hệ thống vẫn KHÔNG tự trừ.
- **Đổi Lương Cơ Bản GIỮA kỳ lương đang tính** (9/2026, cùng tinh thần 2 mục
  ở trên): nếu HR dùng "💰 Cập Nhật Lương Cơ Bản" sửa thẳng lương trên hợp
  đồng đang hiệu lực NGAY TRONG kỳ đang tính (thay vì tạo hợp đồng mới/phụ
  lục), dòng Lương cơ bản cũng tự ghi chú rõ ngày đổi, nhắc rằng mức đang
  hiển thị LÀ MỨC SAU KHI ĐỔI (chưa chia tỷ lệ theo ngày hiệu lực thật) —
  trước đây không có cảnh báo nào, phiếu lương vẫn tính đủ tháng theo mức
  MỚI dù đổi giữa kỳ. Hệ thống vẫn KHÔNG tự chia tỷ lệ — kế toán tự "Điều
  chỉnh dòng lương" nếu cần bù/trừ đúng phần chênh lệch.
- **Chặn Gửi Duyệt nếu có phiếu lương "Thực nhận" ÂM** (9/2026): thường do
  khấu trừ tạm ứng/phạt nhập tay ở "Điều chỉnh dòng lương" lớn hơn cả lương
  gộp — trước đây lọt qua được toàn bộ luồng Gửi Duyệt → Duyệt → Chốt → Công
  Bố mà không ai cảnh báo (công ty không thể trả lương âm cho nhân viên). Từ
  nay bấm "Gửi Duyệt" sẽ bị chặn, nêu rõ (các) mã nhân viên đang bị âm lương,
  kế toán phải sửa lại đúng số tiền ở "Điều Chỉnh" trước khi gửi duyệt được.
- **Mở Lại kỳ đã Công Bố tự xoá cờ "đã xem"** (9/2026): trước đây mở lại 1 kỳ
  ĐÃ CÔNG BỐ (VD phát hiện sai sót sau khi nhân viên đã xem phiếu) không xoá
  cờ "đã xem" trên các phiếu lương — sau khi kế toán sửa lại số liệu và Công
  Bố lại, phiếu vẫn hiện "đã xem" dù nhân viên chưa hề xem bản ĐÃ SỬA. Từ nay
  Mở Lại 1 kỳ đã Công Bố tự xoá cờ này trên mọi phiếu lương của kỳ đó, để
  nhân viên thấy lại đúng trạng thái "chưa xem" khi số liệu mới được Công Bố.
- **Tính lại 1 kỳ KHÔNG còn xoá mất phụ cấp/thưởng/tạm ứng/phạt đã nhập tay
  cho người khác** (v17.6): trước đây bấm "Tính Lương" lại (VD chỉ để bổ sung
  1 nhân viên mới sót/sửa lỗi chấm công của 1 người) xoá HẲN mọi phiếu lương
  cũ của kỳ rồi dựng lại từ đầu — mất luôn các dòng "Điều chỉnh dòng lương" đã
  nhập tay cho TẤT CẢ nhân viên khác trong kỳ đó. Từ nay các dòng điều chỉnh
  tay được giữ lại và gộp vào phiếu lương mới tính cho đúng người đó.
- **Không làm ở đợt này** (đã cân nhắc, không phải bỏ sót): chưa có danh mục
  thành phần lương admin tự thêm/bớt được (danh mục 17 mã hiện cố định trong
  code, sửa được nhanh khi có yêu cầu thật); chưa tự tính phụ cấp ca đêm/thưởng
  KPI (chưa có dữ liệu nguồn thật — cờ ca đêm/điểm KPI thật); chưa hỗ trợ tách
  lương Gross/Net theo từng nhân viên (mặc định tính theo mô hình Gross — nhân
  viên tự chịu BHXH/BHYT/BHTN/thuế trừ vào lương).

### 4.6. Báo Cáo Định Kỳ

Nhân viên nộp báo cáo (thường theo tuần) → người có quyền tổng hợp chọn + sắp
thứ tự + merge các báo cáo con → sửa tự do → phát hành (trình chiếu toàn màn
hình hoặc xuất PDF). Có 2 hình thức nhập: nhập trực tiếp trên form, hoặc ghép
file PDF đã có sẵn. **Lưu ý phân biệt**: đây là 1 quy trình nghiệp vụ chủ động
(nhân viên chủ động nộp theo kỳ) — khác hẳn module **Báo Cáo** (mục 5), vốn chỉ
là màn tổng hợp/giám sát số liệu đọc từ các module khác, không có luồng nghiệp
vụ riêng của nó.

**Nhắc hạn nộp báo cáo qua email (từ 9/2026)**: job nền quét mỗi 24h các kỳ
đang MỞ (`OPEN`) còn/đã qua hạn nộp (`endTime`) đúng ngưỡng **còn 3 ngày / còn
1 ngày / đã tới hạn** — với mỗi ngưỡng, gửi email tới đúng người có quyền
"Tạo/Nộp Báo Cáo" (`reportEntryCreate`) của TỪNG phòng ban còn thiếu báo cáo
(chưa có bản nộp `SUBMITTED` cho kỳ đó), không nhắc lại phòng đã nộp đủ. Trước
đây chỉ Giấy Phép/Hợp Đồng/Gia Hạn CNTT có nhắc hạn tự động, Báo Cáo Định Kỳ
hoàn toàn không có gì nhắc — người tổng hợp chỉ biết thiếu báo cáo khi tự vào
kiểm tra thủ công.

Ngoài bản tổng hợp CHÍNH THỨC (chọn+sắp+merge báo cáo con nhân viên tự nộp) còn
có box riêng **"🗂️ Đối Chiếu Theo Công Việc"** (sub-tab Tổng Hợp) — tự sinh 1
bản đối chiếu CHỈ XEM từ công việc thật ghi nhận trong module Công Việc
(`DB.tasks`), TÁCH RIÊNG hoàn toàn, không publish/không ảnh hưởng bản chính
thức. Mặc định gồm mọi việc trong phạm vi phòng ban của kỳ, mốc thời gian tự
suy ra từ chuỗi kỳ báo cáo (kỳ CLOSED liền trước → hạn chót kỳ này). Có thêm bộ
lọc (chỉ áp dụng NGAY LẦN BẤM NÚT, không lọc trực tiếp bảng đang xem):
- **Trạng thái**: Chưa bắt đầu/Đang thực hiện/Đã hoàn thành, hoặc **Quá hạn**
  (nhóm phái sinh — lọc theo cờ quá hạn module tự tính, không phải 1 trạng
  thái lưu trong dữ liệu).
- **Từ ngày/Đến ngày**: GHI ĐÈ mốc bắt đầu/kết thúc tự suy ra ở trên (không
  phải lọc thêm) — để trống cả 2 thì hành vi y hệt trước đây.

### 4.7. Checklist Đánh Giá Siêu Thị

Module ĐỘC LẬP HOÀN TOÀN về dữ liệu/quyền/route (không dùng chung bất kỳ gì
với module Vận Hành), mỗi collection (`checklistTemplates`/
`checklistSubmissions`) có 1 bảng SQL riêng (`dbo.ChecklistTemplates`/
`dbo.ChecklistSubmissions`, mỗi bản ghi 1 dòng), phân quyền HOÀN TOÀN PHẲNG
(không theo phòng ban như đa số module khác). Từ v17.0, nút điều hướng "✅ Checklist Đánh Giá" được GỘP CHUNG
dropdown sidebar `"⚙️ Vận Hành ▾"` cho gọn (thuần UI, không đổi dữ liệu/quyền)
— bấm vào vẫn mở đúng module này. 4 tab nội bộ: **Cấu Hình / Thực Hiện / Kết
Quả & Phản Hồi / Báo Cáo** — tab Báo Cáo ở đây CHỈ báo cáo cho module này,
tách biệt hoàn toàn với module **Báo Cáo** tổng hợp (mục 5).

**"Xem chéo" ở màn Báo Cáo tổng hợp (từ v23.29)**: theo yêu cầu người dùng —
cho phép người KHÔNG thuộc module này (không tự nộp bài, không
`checklistReportView`) vẫn xem được báo cáo TÓM TẮT (tổng số/trạng thái/Đạt-
Chưa đạt) qua đúng màn **📊 Báo Cáo** (nhóm Vận Hành, mục "✅ Checklist Đánh
Giá Siêu Thị"), bằng quyền `perms.reportViewAll` hoặc `reportExtraKeys` chứa
`'checklist'` (xem mục 5 "Mở Thêm Tab Báo Cáo") — **KHÔNG cấp thêm quyền vào
module Checklist thật** (không vào được 4 tab nội bộ ở trên). Đây là NGOẠI LỆ
DUY NHẤT trong cơ chế "xem chéo" chung: thấy TOÀN BỘ bài nộp mọi siêu thị
(không giữ nguyên phạm vi như các module khác) vì bản chất phân quyền
Checklist là PHẲNG theo "có tham gia hay không", không có khái niệm phạm vi
phòng ban để giữ nguyên. Báo cáo VSATTP chi tiết (cây hạng mục/điểm trừ) vẫn
CHỈ có ở tab Báo Cáo nội bộ (`checklistReportView` thật) — bản tóm tắt ở màn
Báo Cáo tổng hợp không lặp lại phần này.

**3 quyền phẳng** (khối cây phân quyền 23 "Checklist Đánh Giá Siêu Thị"):
- `checklistTemplateManage` — tạo/sửa/kích hoạt/nhân bản/xoá Mẫu Checklist
  (tab Cấu Hình).
- `checklistReportView` — xem tab Báo Cáo (thống kê + xuất Excel) của module
  này.
- `checklistAuditScope` — phạm vi **siêu thị được phân công kiểm soát**
  (dạng `{all, depts}` — field tên là `depts` dù chứa danh sách SIÊU THỊ,
  không phải phòng ban, để tái dùng cơ chế merge phẳng theo nhóm quyền có sẵn
  cho mọi field tên `depts`) — quyết định auditor được tạo/xem loại checklist
  **Kiểm Soát Viên** cho những siêu thị nào.

**Vòng đời mẫu — Nháp → Đang dùng → Lưu trữ, đủ nút theo trạng thái + quyền
(từ v23.4-v23.5)**: bảng "🛠️ Cấu Hình" hiện nút khác nhau tuỳ trạng thái:
- **Nháp**: Sửa (trực tiếp) / Kích Hoạt / Xoá (chỉ Admin).
- **Đang dùng**: Xem / ✏️ Sửa / ⏸️ Dừng / 🗑️ Xoá (chỉ Admin, khoá nếu đã có
  bài nộp) / Nhân Bản.
- **Lưu trữ**: Xem / ✏️ Sửa / 🔄 Kích Hoạt Lại / 🗑️ Xoá (chỉ Admin, khoá nếu
  đã có bài nộp) / Nhân Bản.

**Sửa mẫu ĐANG DÙNG/LƯU TRỮ**: KHÔNG sửa trực tiếp được (chặn 409) — các bài
đã làm cũ (`checklistSubmissions`) tham chiếu ngược lại `templateId` để tra
câu hỏi/lựa chọn gốc khi xem lại, sửa thẳng nội dung câu hỏi sẽ làm sai
lệch/mất ý nghĩa các bài đã chấm điểm trước đó. Nút **"✏️ Sửa"** (từ v23.4)
gộp sẵn 2 bước cũ thành 1 lần bấm: tự **Nhân Bản** (tạo 1 bản Nháp
`version+1`, mã `templateCode` giữ nguyên) rồi mở thẳng form sửa trên bản
Nháp đó — sửa xong bấm **"Kích Hoạt"** để đưa bản mới lên Đang dùng (tự
chuyển bản Đang dùng cũ sang Lưu Trữ cùng `templateCode`). Muốn sửa nội dung
mà KHÔNG cần tạo phiên bản mới → chỉ sửa trực tiếp được khi mẫu còn ở trạng
thái Nháp.

**⏸️ Dừng / 🔄 Kích Hoạt Lại (từ v23.4/v23.5)**: "⏸️ Dừng" chuyển 1 mẫu Đang
dùng sang Lưu Trữ thủ công mà KHÔNG cần kích hoạt bản thay thế ngay (VD
ngừng hẳn 1 loại đánh giá không còn áp dụng) — khác "Kích Hoạt" (tự lưu trữ
mọi bản Đang dùng khác cùng mã khi kích hoạt 1 bản MỚI). Muốn dùng LẠI đúng
mẫu vừa Dừng (không cần sửa gì) → bấm **"🔄 Kích Hoạt Lại"** ngay trên mẫu
Lưu Trữ đó — chuyển thẳng về Đang dùng, KHÔNG tạo dòng mới/KHÔNG tăng
`version` (khác Nhân Bản).

**🗑️ Xoá — chỉ Admin (từ v23.4)**: nút Xoá chỉ Quản Trị Viên (không còn đủ
`checklistTemplateManage`) mới thấy được, ở MỌI trạng thái. Nếu mẫu đã có
người nộp bài (`checklistSubmissions` tham chiếu `templateId`) thì bị chặn
409 (khoá mờ ở UI, kèm gợi ý dùng "⏸️ Dừng" thay thế) — tránh mồ côi dữ liệu
báo cáo cũ.

**Bug thật đã vá (v23.5)**: `UNIQUE INDEX` của `TemplateCode`
(`dbo.ChecklistTemplates`) trước đây khoá KHÔNG điều kiện (mọi dòng, mọi
trạng thái) — trong khi "Nhân Bản" (và "✏️ Sửa" gọi bên trong) CỐ TÌNH tạo
dòng mới CÙNG `TemplateCode` với dòng nguồn để giữ chung "gia đình phiên
bản". Hậu quả thật: MỌI lần Nhân Bản/Sửa trên 1 checklist đã tồn tại đều báo
lỗi `Cannot insert duplicate key row... 'UX_ChecklistTemplates_Code'` trên
SQL Server thật (sandbox không có SQL Server thật nên bộ test trước đó không
bắt được). Đã đổi `UNIQUE INDEX` sang **lọc theo `Status='ACTIVE'`** — đúng
nguyên tắc thật của module ("chỉ 1 bản Đang dùng tại 1 thời điểm cho mỗi
mã"), đồng thời thêm kiểm tra trùng mã riêng ở tầng ứng dụng cho mẫu MỚI
TẠO (không phải Nhân Bản) để vẫn chặn 2 mẫu không liên quan trùng mã nhau.
**Bắt buộc chạy lại `schema.sql`** sau khi cập nhật lên v23.5 (script tự an
toàn, chỉ đổi đúng 1 index của bảng này) — nếu không chạy lại, lỗi trùng khoá
này còn tiếp diễn.

**Xem mẫu ĐANG DÙNG/LƯU TRỮ (v17.3)**: mẫu `ACTIVE`/`ARCHIVED` có nút
**"👁️ Xem"** (thay cho nút "Sửa" chỉ có ở bản Nháp) mở màn hình chỉ đọc, hiển
thị đầy đủ mã/tên/loại/ngưỡng đạt + toàn bộ câu hỏi, lựa chọn, điểm, cờ
Đạt/Lỗi nghiêm trọng, điều kiện hiển thị phân nhánh — không cho sửa gì ở đây,
muốn sửa vẫn phải theo đúng luồng Nhân Bản → sửa bản Nháp → Kích Hoạt ở trên.

**2 loại Mẫu Checklist** (`templateType`), mỗi mẫu có bộ câu hỏi + thang điểm
riêng, chỉ 1 bản `ACTIVE` cho mỗi `templateCode` tại 1 thời điểm (kích hoạt
bản mới tự động lưu trữ bản cũ):
- **STORE_SELF** (Siêu thị tự đánh giá) — bất kỳ nhân viên `posType=STORE`
  nào cũng thực hiện được cho ĐÚNG siêu thị mình đang công tác; `storeCode`
  **server luôn tự suy từ `user.dept`, không bao giờ tin giá trị client gửi
  lên** (chặn giả mạo tự chấm hộ siêu thị khác).
- **CONTROL_AUDIT** (Kiểm soát viên đánh giá) — chỉ người có
  `checklistAuditScope` phù hợp mới thực hiện được, phải chọn đúng 1 siêu thị
  nằm trong phạm vi được phân công (server validate lại, không chỉ ẩn/hiện ở
  giao diện).

**Admin test Tự Đánh Giá (từ v17.1)**: tài khoản `admin` thường KHÔNG gắn Vị
Trí Siêu Thị (`posType` khác `STORE`) nên mặc định không thực hiện được
checklist STORE_SELF. Riêng admin được PHÉP tự chọn 1 siêu thị bất kỳ ở tab
Thực Hiện (khối "🧪 Test Tự Đánh Giá") để test mẫu vừa tạo/kích hoạt — server
tin `storeCode` admin gửi lên (khác hẳn quy tắc "luôn suy từ `user.dept`" áp
dụng cho người dùng thường, xem `resolveStoreCodeForSubmission()`
`lib/checklist.js`). Bài làm test này tạo `checklistSubmissions` THẬT (không
phải dữ liệu ảo) gắn `storeCode` của siêu thị được chọn — nên xoá đi sau khi
test xong nếu không muốn lẫn vào dữ liệu thật của siêu thị đó.

**Cấu trúc câu hỏi** — mỗi câu có nhiều lựa chọn, mỗi lựa chọn có thể đánh
dấu `isPassing`/`isCriticalFail`, và có thể **chỉ hiện khi** 1 lựa chọn cụ
thể của câu hỏi TRƯỚC ĐÓ được chọn (`showIfOptionId`, đánh số ID lựa chọn
LIÊN TỤC xuyên suốt toàn bộ mẫu chứ không reset theo từng câu, để chọn được
lựa chọn của bất kỳ câu nào trước đó, không chỉ câu liền trước). Câu/lựa
chọn đánh dấu **"Bắt buộc"** hoặc **"Lỗi nghiêm trọng" (Critical Fail)** thì
khi chọn lựa chọn Critical Fail bắt buộc phải đính kèm ảnh minh chứng mới
hoàn tất được bài đánh giá.

**Chấm điểm & kết luận** — khi hoàn tất (Kết Thúc & Nộp), hệ thống tự tính
`scorePercent` (tỉ lệ lựa chọn `isPassing`/tổng số câu bắt buộc) và
`isPassed`: **hễ có ÍT NHẤT 1 lựa chọn Critical Fail được chọn thì
`isPassed` LUÔN là `false` bất kể điểm số bao nhiêu** (lỗi nghiêm trọng phủ
quyết điểm số). Sau khi nộp, siêu thị liên quan xem được kết quả + phản hồi
lại (tab Kết Quả & Phản Hồi) — chỉ đúng siêu thị bị đánh giá mới phản hồi
được, không ai khác. **Sửa lại phản hồi/giải trình (9/2026)**: siêu thị gõ
nhầm hoặc muốn bổ sung phản hồi đã gửi thì bấm "✏️ Sửa" ngay cạnh phản hồi cũ
trước khi có kết quả duyệt — nội dung mới GHI ĐÈ nội dung cũ, không lưu lịch
sử các lần sửa trước.

**Tab Báo Cáo** (module-local, quyền `checklistReportView`) — lọc theo mẫu/
khoảng ngày, hiện thẻ thống kê (tổng số bài, điểm trung bình, tỉ lệ đạt, số
lượt Lỗi nghiêm trọng) + bảng chi tiết, xuất Excel. Đây là báo cáo RIÊNG cho
checklist — module **Báo Cáo** tổng hợp (mục 5) không đọc dữ liệu module
này.

**Chế Độ Chấm Điểm + trừ điểm (v20.9)** — mỗi mẫu chọn 1 trong 2 chế độ khi
tạo/sửa (tab Cấu Hình, ô "Chế Độ Chấm Điểm"):
- **Có chấm điểm** (mặc định, khớp mọi mẫu tạo trước v20.9) — như mô tả ở
  trên, có "Điểm Tối Đa"/"Điểm Đáp Án"/"Ngưỡng Điểm Đạt (%)". **Điểm đáp án
  cho phép nhập SỐ ÂM** để TRỪ điểm tổng khi chọn đáp án đó (VD đáp án "Không
  đạt" của 1 câu hỏi "yêu cầu vàng" quan trọng có thể đặt `-20` để trừ 20
  điểm) — không cần cờ/field riêng nào khác, tái dùng đúng field "Điểm Đáp
  Án" đã có. Tổng điểm/% **chặn sàn ở 0** (không hiển thị số âm dù cộng dồn
  nhiều lượt trừ ra kết quả âm) — hiển thị cho người xem luôn là 0% trở lên.
- **Chỉ Đạt / Chưa đạt** (không chấm điểm) — ẨN HẲN mọi ô nhập/hiển thị
  điểm (Điểm Tối Đa/Điểm Đáp Án/Ngưỡng Đạt %/số điểm ở kết quả/báo cáo), kể
  cả ở tầng SERVER (không chỉ ẩn giao diện — `maxScore`/`scoreValue` bị ép về
  0 và không lưu `totalScore`/`scorePercent` nào cả). Kết quả Đạt/Không đạt
  suy TRỰC TIẾP từ việc mọi câu trả lời đã chọn có phải đáp án "Đạt"
  (`isPassing`) hay không — độc lập hoàn toàn với điểm số. Cờ "Lỗi nghiêm
  trọng" vẫn hoạt động y hệt ở cả 2 chế độ (vẫn phủ quyết `isPassed=false`
  bất kể gì khác). Đổi chế độ của 1 mẫu ĐANG DÙNG phải qua đúng luồng Nhân
  Bản → sửa bản Nháp → Kích Hoạt như mọi thay đổi câu hỏi khác.

**Nhập/Tải Mẫu/Xuất Excel câu hỏi (v20.9)** — tab Cấu Hình, khi đang soạn 1
mẫu (tạo mới/sửa bản Nháp): **"⬇️ Tải Mẫu Excel"** tải file `.xlsx` có sẵn ví
dụ (kèm sheet "Ghi Chú" giải thích từng cột) để điền hàng loạt thay vì gõ tay
từng câu; **"📥 Nhập Câu Hỏi Từ Excel"** tải file đã điền lên để XEM TRƯỚC
(hiện bảng câu nào hợp lệ/lỗi kèm lý do) rồi bấm nạp — CHỈ nạp vào danh sách
câu hỏi đang soạn, vẫn phải bấm **"💾 Lưu Mẫu"** như bình thường sau đó (server
xác minh lại toàn bộ, không tin nguyên nội dung file); **"📥 Xuất Excel"**
xuất NGAY danh sách câu hỏi đang soạn (kể cả chưa lưu) ra cùng định dạng file
mẫu, dùng để sửa offline rồi nhập lại. Layout: **1 dòng = 1 đáp án**, các
dòng cùng 1 câu hỏi nhóm theo cột "STT Câu Hỏi" (thông tin câu hỏi chỉ cần
điền ở dòng đầu). Dùng CHUNG 1 file mẫu cho CẢ 2 Chế Độ Chấm Điểm — cột
"Điểm Tối Đa Câu Hỏi"/"Điểm Đáp Án" chỉ cần điền nếu mẫu **Có chấm điểm**, để
trống nếu mẫu **Chỉ Đạt/Chưa đạt** (server tự bỏ qua). File mẫu KHÔNG có cột
điều kiện hiển thị phân nhánh (`showIfOptionId`) — cấu hình tay lại sau khi
nhập nếu cần dùng tính năng đó.

**2 LOẠI MẪU CHECKLIST — chọn NGAY LÚC TẠO, bất biến sau đó (v21.0)** —
theo yêu cầu tách mẫu VSATTP (file Excel người dùng gửi) thành 1 loại mẫu
riêng thay vì gò vào khuôn câu hỏi/đáp án cũ. Bấm **"+ Tạo Mẫu Mới"** giờ
hiện bảng chọn 1 trong 2 loại (`templateKind`) trước khi mở khung soạn —
**loại đã chọn không đổi được nữa sau khi tạo** (kể cả khi sửa bản Nháp,
server chặn 400 nếu cố gửi `templateKind` khác đi):

- **📋 Câu Hỏi & Đáp Án (`QA`)** — chính là mô hình đã có từ trước (mục
  ở trên: câu hỏi/lựa chọn, Chế Độ Chấm Điểm, trừ điểm bằng điểm đáp án âm,
  Nhập/Xuất Excel...). Mọi mẫu tạo trước v21.0 tự hiểu là loại này
  (`templateKind` cũ để trống = `QA`).
- **📉 Trừ Điểm Theo Hạng Mục (`DEDUCTION`)** — mô hình MỚI, dựng đúng cấu
  trúc file Excel VSATTP người dùng gửi: cây 3 cấp **Hạng Mục Lớn** (có điểm
  tối đa, VD "CHẤT LƯỢNG SẢN PHẨM" 40đ) → **Hạng Mục Con** (có thể đặt điểm
  tối đa RIÊNG hoặc để trống để dùng chung trần của Hạng Mục Lớn, VD "Chất
  lượng cảm quan") → **Tiêu Chí Vi Phạm** (mô tả + ghi chú quy tắc tham khảo
  + điểm tham khảo/lần, KHÔNG ép buộc). Không có khái niệm Chế Độ Chấm
  Điểm/Ngưỡng Đạt %/Nhập-Xuất Excel như loại QA — 2 khối này ẨN HẲN khi soạn
  loại `DEDUCTION` (kể cả server: `scoringMode` luôn `null`).

**Làm bài loại `DEDUCTION`** — khác hẳn loại QA, hiện TOÀN BỘ cây hạng mục/
tiêu chí ngay từ đầu (không có nhánh hiển thị theo câu trả lời trước).
Người làm bài nhập, cho MỖI tiêu chí phát hiện vi phạm: **điểm trừ thực tế**
(người kiểm tra tự quyết định, không bị ép theo điểm tham khảo/lần đã cấu
hình ở mẫu), **mức độ rủi ro A/B/C** (**người kiểm tra TỰ CHỌN**, hệ thống
KHÔNG tự tính theo ngưỡng như công thức Excel gốc — quyết định thiết kế:
ngưỡng phân loại A/B/C trong file gốc khác nhau tuỳ dòng, tự động hoá dễ sai
lệch hơn là để người kiểm tra trực tiếp đánh giá), thời hạn hoàn thành, ghi
chú, và **ảnh minh chứng KHÔNG BẮT BUỘC** (khác hẳn loại QA — chọn đáp án
lỗi nghiêm trọng ở QA bắt buộc phải có ảnh mới nộp bài được, loại
`DEDUCTION` cho nộp bài dù không đính kèm ảnh nào, khớp đúng file gốc không
có ràng buộc này).

**Chấm điểm loại `DEDUCTION`** — với mỗi Hạng Mục Con: điểm = tối đa(0, trần
hiệu lực − tổng điểm đã trừ trong hạng mục con đó); "trần hiệu lực" là điểm
tối đa riêng của hạng mục con nếu có đặt, ngược lại dùng TRỌN VẸN trần của
Hạng Mục Lớn (không chia đều cho nhiều hạng mục con). Điểm Hạng Mục Lớn =
tổng điểm các hạng mục con của nó, nhưng **luôn bị chặn thêm 1 lớp trần ở
đúng điểm tối đa của Hạng Mục Lớn** (phòng trường hợp lỡ cấu hình tổng trần
các hạng mục con vượt quá trần hạng mục lớn). Tổng điểm bài làm = tổng điểm
mọi Hạng Mục Lớn. Không có khái niệm "lỗi nghiêm trọng"/"câu bắt buộc" như
QA — luôn ra 1 điểm số cụ thể (không có chế độ "Chỉ Đạt/Chưa đạt").

**2 lần kiểm tra (Lần 1/Lần 2) trong cùng 1 đợt** — file Excel gốc theo dõi
song song 2 lần kiểm tra trên cùng 1 sheet; hệ thống **KHÔNG** gộp 2 lần vào
1 bài làm — mỗi lần kiểm tra là **1 bài nộp riêng** (tạo bài mới ở tab Thực
Hiện), giữ đúng kiến trúc "1 bài nộp = 1 đợt đánh giá" sẵn có, xem lại/so
sánh 2 lần qua tab Báo Cáo hoặc Kết Quả như các checklist khác.

**Mẫu VSATTP dựng sẵn (seed tự động, v21.0)** — ngay lần khởi động server
đầu tiên sau khi cập nhật lên bản này, hệ thống **tự động tạo sẵn 1 mẫu**
đúng nội dung file Excel người dùng gửi (mã `CL_VSATTP`, tên "Checklist
Đánh Giá VSATTP (An Toàn Thực Phẩm)", loại `DEDUCTION`, 5 Hạng Mục Lớn/12
Hạng Mục Con/38 Tiêu Chí, tổng điểm tối đa 100) ở trạng thái **Nháp** —
KHÔNG tự kích hoạt. Vào tab Cấu Hình, xem lại nội dung (nút "Sửa" trên bản
Nháp này), chỉnh sửa nếu cần rồi bấm **"Kích Hoạt"** khi sẵn sàng dùng thật.
Việc dựng sẵn này chạy ĐÚNG 1 LẦN (idempotent theo mã `CL_VSATTP` — không
tạo trùng nếu server khởi động lại nhiều lần).

**Nhóm/Hạng mục cho câu hỏi loại QA (v21.1, tuỳ chọn)** — khi soạn câu hỏi
loại **Câu Hỏi & Đáp Án**, có thêm 1 ô **"Nhóm/Hạng mục"** không bắt buộc
(để trống = câu hỏi đứng độc lập, không thuộc nhóm nào — mọi mẫu tạo trước
v21.1 không có field này vẫn hoạt động y nguyên, xuất phẳng không có dòng
tiêu đề nhóm). Gắn cùng 1 tên nhóm cho nhiều câu hỏi liên tiếp (VD "1. Kiểm
soát cảnh quan chung") để **"Xuất Theo Mẫu Gốc"** (xem ngay dưới đây) in ra
đúng dòng tiêu đề nhóm (in đậm, nền cam nhạt) + tính đúng % Đạt riêng từng
nhóm ở sheet thống kê.

**Xuất Báo Cáo Theo Đúng Mẫu Excel Gốc (v21.1)** — tab **📊 Báo Cáo**, ngoài
nút "📥 Xuất Excel (bảng phẳng)" sẵn có (1 dòng/bài nộp, mọi mẫu/mọi loại
dùng chung 1 layout), có thêm khối **"📥 Xuất Theo Mẫu Gốc"** sinh file
`.xlsx` ĐÚNG layout mẫu Excel người dùng đang dùng thật ngoài đời (khác hẳn
bảng phẳng ở trên):
- **Bắt buộc chọn ĐÚNG 1 mẫu cụ thể** ở bộ lọc "Mẫu Checklist" phía trên
  (không hỗ trợ "Tất cả" — 2 loại mẫu có layout khác hẳn nhau, chọn "Tất cả"
  sẽ báo lỗi rõ ràng yêu cầu chọn lại).
- **Chọn 1, nhiều, hoặc để trống (= tất cả) siêu thị** đang có bài nộp khớp
  bộ lọc mẫu/ngày — **mỗi siêu thị ra 1 (nhóm) sheet riêng** trong CÙNG 1
  file, không cần xuất nhiều lần.
- **Loại Câu Hỏi & Đáp Án**: mỗi siêu thị ra 2 sheet — `<Tên ST> - Chi tiết`
  (1 dòng/câu hỏi: Thời gian báo cáo/Người gửi báo cáo/ST/Nội dung/Vấn đề
  cần xử lý [Đạt/Không đạt]/Mô tả lý do chưa đạt/Thời gian hoàn thành — có
  in dòng tiêu đề nhóm nếu câu hỏi có gắn "Nhóm/Hạng mục") và `<Tên ST> -
  Thống kê` (% Đạt theo từng nhóm, gộp mọi bài nộp khớp bộ lọc của siêu thị
  đó). Cột **"Thời gian hoàn thành" luôn để trống** — hệ thống hiện CHƯA có
  chỗ lưu trạng thái khắc phục riêng từng câu hỏi (chỉ có 1 ô "Phản hồi"
  chung cho cả bài ở tab Kết Quả & Phản Hồi) — quyết định đã chốt: không xây
  thêm tính năng này trong đợt này, cột này để trống cho người dùng tự điền
  tay sau khi xuất nếu cần theo dõi.
- **Loại Trừ Điểm Theo Hạng Mục (VSATTP)**: mỗi siêu thị ra 1 sheet, mirror
  đúng cây Hạng Mục Lớn/Hạng Mục Con/Tiêu Chí gốc + điểm tối đa hiệu lực +
  điểm trừ thực tế đã nhập + mô tả/mức độ rủi ro/thời hạn/ghi chú của từng
  lượt trừ điểm. Nhiều lượt kiểm tra (nhiều bài nộp) của cùng 1 siêu thị
  trong khoảng ngày lọc được xếp thành các khối riêng, mỗi khối có 1 dòng
  tóm tắt (ngày kiểm tra/người kiểm tra/tổng điểm) ngay phía trên.
- Quyền: `checklistReportView` (đúng quyền xem tab Báo Cáo hiện có, không
  cần thêm quyền riêng).

---

### 4.8. Mua Hàng (BAS — Cơ Sở Tính Chiết Khấu/Thưởng NCC)

Module riêng về dữ liệu/quyền (`purchasing`), Giai Đoạn 1
(10/2026) — quản lý **Nhà Cung Cấp (Vendors)** + **Điều Khoản Chiết Khấu/
Thưởng (RebateTerms)** ký với từng NCC, tính **ƯỚC TÍNH** số tiền chiết khấu
dựa trên dữ liệu mua hàng đồng bộ từ hệ thống ngoài **DSmart**. Đây là bước
**ước tính tham khảo**, KHÔNG PHẢI Sổ Cái đầy đủ theo dõi vòng đời ACCRUED →
CONFIRMED → SETTLED (đối chiếu/phê duyệt/ghi nhận chính thức) — phần đó là
Giai Đoạn 2, chưa triển khai.

**Vị trí trên sidebar (từ 9/2026):** vẫn là 1 dropdown TOP-LEVEL riêng (icon
🔗 — chuỗi, mua hàng tập trung toàn chuỗi siêu thị, thay cho 🛒 cũ vì trùng
"🛒 Mua Bán" của Văn Phòng Tổng Hợp), đặt ngay dưới **"⚙️ Vận Hành"** trong
danh sách sidebar (cùng khuôn dropdown Vận Hành/Hỗ Trợ IT). Bấm vào mở ra 2
mục con dạng "slide bar": **"🧮 BAS"** và **"📊 Báo Cáo"** — mở đúng 2 tab nội
bộ mô tả bên dưới.

- **Nhà Cung Cấp (Vendors)** — `vendorCode` do người dùng tự đặt (KHÔNG tự
  sinh mã như phần lớn module khác vì đổi ngầm mã 1 NCC là sai nghiệp vụ),
  duy nhất toàn hệ thống; có thể Ngừng/Kích Hoạt lại. Quyền: `rebateTermManage`
  (gộp chung quản lý Vendors + Terms, xem bên dưới).
- **Điều Khoản Chiết Khấu (RebateTerms)** — nhiều điều khoản độc lập/1 NCC,
  mỗi điều khoản tự mang:
  - **Loại** (`termType`): Chiết Khấu Theo Doanh Số (VOLUME_REBATE), Chiết
    Khấu Tăng Trưởng (GROWTH_REBATE), Trade Spend, Phí Niêm Yết (LISTING_FEE),
    Thanh Toán Sớm (EARLY_PAYMENT), Bồi Thường Hư Hỏng (DAMAGE_ALLOWANCE), Hỗ
    Trợ Mở Siêu Thị Mới (NEW_STORE_SUPPORT).
  - **Cơ sở tính** (`calcBasis`): trên Giá Trị Mua Hàng (PURCHASE_VALUE) hoặc
    Giá Trị Bán Ra (SELL_OUT_VALUE).
  - **Bậc thang (Tiers[], tối đa 20 bậc/điều khoản)** theo 2 chế độ hay bị
    nhầm lẫn trong thực tế hợp đồng NCC — **`tierMode`**:
    - **GRADUATED (lũy tiến từng phần)** — mỗi bậc chỉ tính % trên PHẦN doanh
      số nằm trong đúng bậc đó (giống thuế luỹ tiến).
    - **CLIFF (đạt mốc tính cả)** — đạt tới bậc nào thì % của bậc đó áp dụng
      cho TOÀN BỘ doanh số, không chỉ phần vượt. Quy ước ranh giới: đạt ĐÚNG
      BẰNG mốc dưới của 1 bậc coi là đã vào bậc đó (`>=`, không phải `>`).
  - **Phạm vi (Scopes[])**: giới hạn theo Định Dạng Siêu Thị (STORE_FORMAT —
    MART/MINIMART), 1 Siêu Thị cụ thể (STORE), hoặc Ngành Hàng (CATEGORY) —
    để trống Scopes = áp dụng toàn bộ giao dịch của NCC đó.
  - **Kỳ tính** (`periodType`): Tháng/Quý/Năm/1 Lần.
  - **Ngày Hiệu Lực Từ/Đến bắt buộc đúng khuôn `YYYY-MM-DD`** (rà soát 9/2026):
    nhập sai khuôn (VD `1/3/2026`, `2026-3-1`, chữ tự do) hoặc ngày không có
    thật (`2026-02-30`) bị chặn ngay khi Tạo/Sửa — vì mọi phép đối chiếu kỳ
    tính với thời hạn hiệu lực so sánh theo CHUỖI, chỉ cho kết quả đúng khi cả
    2 vế cùng khuôn này (trước đây lưu sai khuôn vẫn được, rồi âm thầm chặn/mở
    nhầm kỳ tính ở bước "Tính Ước Tính").
  - **NCC của điều khoản phải tồn tại và đang Hoạt động** (rà soát 9/2026):
    không tạo được điều khoản mới cho 1 NCC đã bị xoá hoặc đã Ngừng hoạt động —
    trước đây tạo được bình thường rồi mới báo lỗi muộn ở bước "Tính Ước Tính"
    (sau khi đã kích hoạt).
  - **Vòng đời**: Nháp (DRAFT) → Đang Hoạt Động (ACTIVE) → Hết Hạn (EXPIRED)/
    Lưu Trữ (ARCHIVED). **Nhân bản** 1 điều khoản ACTIVE tạo ra 1 bản DRAFT
    mới cùng `termCode` (tăng `version`) để sửa mà không đụng bản đang chạy.
    **Kích Hoạt bản Nhân Bản tự lưu trữ bản cũ (từ 9/2026)**: kích hoạt 1
    bản Nhân Bản (DRAFT) sẽ tự chuyển mọi bản ACTIVE khác cùng NCC+Mã Điều
    Khoản sang Lưu Trữ (ARCHIVED) TRƯỚC — trước đây có thể tồn tại 2 bản
    cùng ACTIVE song song, "Tính Ước Tính" có thể vô tình chọn nhầm bản CŨ
    đã lỗi thời; nay luôn chỉ đúng 1 bản ACTIVE cho mỗi NCC+Mã Điều Khoản.
  - **Tách biệt nhiệm vụ (mục 8 tài liệu gốc)**: người TẠO/sửa điều khoản
    (`rebateTermManage`) KHÔNG tự động có quyền KÍCH HOẠT (`rebateTermActivate`,
    quyền riêng) — vì liên quan trực tiếp số tiền lớn, tách 2 vai trò cố ý.
- **Đồng Bộ Dữ Liệu Mua Hàng (DSmart)** — nút "🔄 Đồng Bộ Ngay" (quyền
  `rebateTermManage`, có rate-limit riêng): gọi API DSmart thật (baseURL/API
  key CHỈ đọc từ biến môi trường `DSMART_API_BASE_URL`/`DSMART_API_KEY` phía
  server, KHÔNG BAO GIỜ nhận từ input người dùng — chống SSRF, OWASP A10), tự
  phân trang tới khi hết dữ liệu, tự retry lỗi tạm thời, nạp vào bảng trung
  gian `VendorPurchaseTransactions` (đánh dấu `DataConfidence='PROVISIONAL'`
  vì là dữ liệu tạm/chưa đối chiếu chính thức). Chưa cấu hình 2 biến môi
  trường trên thì nút này báo lỗi rõ ràng (503), các phần khác của module vẫn
  dùng bình thường. **Chống chạy chồng (từ 9/2026)**: chỉ 1 lượt đồng bộ chạy
  tại 1 thời điểm trên toàn hệ thống — 2 người (hoặc 2 tab) bấm gần như cùng
  lúc thì lượt thứ 2 nhận thông báo "đang có lượt đồng bộ khác chạy, vui lòng
  đợi" thay vì chạy song song rồi đâm nhau khi ghi dữ liệu. **Dữ liệu trả về
  sai khuôn từ DSmart** (thiếu/không phải danh sách) nay được coi là trang
  rỗng thay vì làm hỏng cả lượt đồng bộ. **UPSERT thật (từ 9/2026)**: đối chiếu theo mã tham
  chiếu gốc — dòng CHƯA có thì thêm mới, dòng ĐÃ có nhưng DSmart sửa lại nội
  dung (VD sửa số tiền/ngày mua của giao dịch đã đồng bộ trước đó) thì CẬP
  NHẬT LẠI tại chỗ, dòng y hệt lần trước thì bỏ qua (không ghi thừa) — trước
  đây dòng đã có luôn bị bỏ qua vô điều kiện, số liệu DSmart sửa lại sau khi
  đã đồng bộ lần đầu sẽ không bao giờ cập nhật, làm sai lệch vĩnh viễn kết
  quả Tính Ước Tính. Mỗi lượt đồng bộ ghi 1 dòng vào **Nhật Ký Đồng Bộ**
  (`PurchaseDataSyncLog` — thời điểm, số dòng lấy/nạp, người bấm, lỗi nếu có).
- **Nhập/Xuất Dữ Liệu Thủ Công** (9/2026) — phương án THAY THẾ khi DSmart tạm
  không sẵn sàng hoặc cần bổ sung tay 1 vài giao dịch lẻ, đặt ngay cạnh "Đồng
  Bộ Ngay" (cùng quyền `rebateTermManage`):
  - **📥 Tải File Mẫu** — file Excel mẫu đúng khuôn cột (Mã NCC/Mã Siêu Thị/
    Định Dạng/Mã Ngành Hàng/Ngày Mua/Số Tiền/Hàng Trả Lại).
    - **📤 Nhập File** — đọc file đã điền, ghi thẳng vào cùng bảng
    `VendorPurchaseTransactions` với `SourceSystem='MANUAL'` (khác `'DSMART'`)
    — TỰ SINH 1 khoá dedup ổn định (hash các trường nghiệp vụ then chốt) nên
    lỡ tải trùng nguyên 1 file cũ lên lần nữa KHÔNG tạo double-count giao
    dịch. Dòng lỗi (thiếu Mã NCC/Mã Siêu Thị, Ngày Mua/Số Tiền không hợp lệ)
    bị bỏ qua nhưng KHÔNG chặn cả file — các dòng hợp lệ khác vẫn được nạp,
    danh sách lỗi hiện ngay trong thông báo kết quả. Cũng ghi 1 dòng vào
    **Nhật Ký Đồng Bộ** (cột "Nguồn" phân biệt 🔄 DSmart / 📤 Thủ công).
  - **📊 Xuất File** — xuất lại dữ liệu đang có trong khoảng Từ Ngày/Đến Ngày
    chọn (mọi nguồn, tối đa 5000 dòng/lần) ra đúng khuôn cột file mẫu, để
    chỉnh sửa/bổ sung rồi tải lên lại qua Nhập File.
- **Tính Ước Tính Chiết Khấu** — chọn 1 điều khoản ACTIVE + khoảng ngày, hệ
  thống tự lọc đúng giao dịch khớp Scopes của điều khoản đó
  (`purchaseBasisAggregator.js`) rồi áp bậc thang (`tieredCalculator.js`) ra
  số tiền ước tính, lưu snapshot vào `RebateCalculations` (append-only, không
  sửa/xoá — muốn tính lại thì tính ước tính mới, không ghi đè). Quyền:
  `rebateTermManage`. **Kỳ tính phải nằm trong hiệu lực điều khoản (từ
  9/2026)**: kỳ tính (Từ ngày–Đến ngày) chọn lấn ra ngoài Ngày Hiệu Lực Từ/
  Đến của điều khoản bị từ chối (400), tránh gộp nhầm doanh số của các tháng
  KHÔNG thuộc phạm vi thoả thuận vào số ước tính. Lưu ý: điều khoản hết hiệu
  lực (qua Ngày Hiệu Lực Đến) KHÔNG tự chuyển sang "Hết Hạn" — người quản lý
  vẫn phải tự bấm "⏳ Hết Hạn"; guard kỳ tính ở trên hoạt động độc lập, không
  phụ thuộc việc đã đánh dấu hết hạn hay chưa, nên đây vẫn là lớp bảo vệ
  chính chống tính sai dù điều khoản chưa được đánh dấu Hết Hạn.
- **Báo Cáo** (tab riêng trong module + entry ở 📊 Báo Cáo tổng hợp) — liệt
  kê mọi lượt tính ước tính (lọc theo NCC/khoảng ngày), tổng doanh số căn cứ +
  tổng ước tính chiết khấu. Quyền xem: `rebateViewReport` (không cần
  `rebateTermManage` — đúng người chỉ cần xem báo cáo, không sửa điều khoản).
- **5 quyền phẳng** (khối cây phân quyền 25 "Mua Hàng"): `rebateTermManage`
  (quản lý NCC + Điều Khoản), `rebateTermActivate` (kích hoạt điều khoản),
  `rebateViewReport` (xem báo cáo), `rebateReconcile`/`rebateApprove` (khai
  báo sẵn cho Giai Đoạn 2 — đối chiếu/phê duyệt chính thức, CHƯA có luồng
  nghiệp vụ nào dùng ở Giai Đoạn 1). Có ít nhất 1 trong 5 quyền mới vào được
  module (đọc danh sách NCC/Điều Khoản cần cho mọi vai trò, kể cả người chỉ
  xem báo cáo).

---

## 5. Báo Cáo (Reports — dashboard tổng hợp)

Module **📊 Báo Cáo** (`reports`) là màn **tổng hợp/giám sát số liệu**, đọc dữ
liệu từ khoảng **19 module nghiệp vụ** khác (Tài Liệu/Văn Bản Trình/Công Việc/
Hợp Đồng/Biên Bản Họp/Hỗ Trợ IT/Báo Cáo Định Kỳ/Truyền Thông Nội Bộ/Phòng Họp/
Đăng Ký Xe/Văn Phòng Phẩm/Đồng Phục/Giấy Phép/Mua Bán-Sửa Chữa/Thanh Toán/Ngân
Sách/HCRC Đồng Hành/Onboarding-Offboarding/Vận Hành — 3 luồng Đơn Hàng/Mở Mới/
Sửa Chữa tính riêng) — bản thân nó không tạo/lưu hồ sơ riêng nào (khác hẳn Báo
Cáo Định Kỳ ở mục 4.6, vốn là 1 quy trình nghiệp vụ chủ động thật sự).

**Quy ước bắt buộc (v17.9+)**: module nghiệp vụ mới nào có tạo hồ sơ đều phải
thêm vào đây NGAY trong cùng đợt merge (xem `CLAUDE.md`) — **trừ** nhóm dữ
liệu cực nhạy cảm đã bị chặn hẳn khỏi `GET /api/data` chung (Hồ Sơ Nhân Sự,
Hợp Đồng Lao Động, Lương, Công & Phép) — 4 module Nhân Sự này **CHƯA có** ở
Báo Cáo (cần thiết kế route thống kê riêng, gác đúng quyền quản lý hiện có
của từng module, không đọc thẳng qua `DB.<collection>` như các module khác vì
collection tương ứng luôn rỗng phía client). Checklist Đánh Giá Siêu Thị
**cũng có tab Báo Cáo NỘI BỘ riêng, tách biệt hoàn toàn** (xem mục 4.7) —
nhưng từ v23.29 có thêm 1 mục TÓM TẮT ở màn Báo Cáo tổng hợp này (nhóm Vận
Hành) dành riêng cho nhu cầu "xem chéo" (xem chi tiết cơ chế + ngoại lệ bảo mật ở
mục 4.7), không thay thế tab nội bộ.

**Phân quyền hiện tab (từ v23.28)**: mỗi tab trong nav trái (`REPORT_NAV_TREE`,
`module-baocaoquantri.js`) chỉ hiện cho người ĐÃ có đúng quyền vào module thật
tương ứng (`isReportKeyVisible()`, tái dùng `hasModuleAccess()` như trước —
không đổi cơ chế phân quyền, chỉ đổi CÁCH GỌI). 2 cách mở rộng thêm (cây phân
quyền, khối "24. Nghiệp Vụ & Báo Cáo"): **"👁️ Xem Toàn Bộ Tab Báo Cáo"**
(`perms.reportViewAll`, bỏ qua giới hạn trên) và **"📊 Mở Thêm Tab Báo Cáo"**
(`user.reportExtraKeys`, ở màn Sửa Người Dùng — mở thêm TỪNG tab cụ thể).
**Lưu ý quan trọng**: 2 quyền này CHỈ ảnh hưởng tab nào HIỆN trên nav — dữ
liệu THẬT trả về vẫn luôn qua đúng `filter*ForUser()`/`canView*()` thật ở
`routes/reports.js` như trước (không bypass phạm vi phòng ban/quyền sở hữu
bản ghi thật của từng collection); người được mở thêm 1 tab qua
`reportExtraKeys` mà chưa có quyền xem dữ liệu module đó theo đúng nghĩa sẽ
thấy tab nhưng dữ liệu trống/thiếu, không phải lỗi. **Ngoại lệ DUY NHẤT**:
mục "checklist" (xem mục 4.7) — do bản chất phân quyền PHẲNG (không có phạm
vi phòng ban để giữ), `reportExtraKeys`/`reportViewAll` ở mục này thật sự
mở ra TOÀN BỘ dữ liệu (không phải tab rỗng), CỐ Ý khác các mục còn lại.

- **Thống kê chung theo module** — với 4 module có luồng phê duyệt nhiều bước
  (Tài Liệu/Văn Bản Trình/Xe/Văn Phòng): tổng số hồ sơ, phân theo trạng
  thái/phòng ban, và **thời gian xử lý trung bình** mỗi bước + mỗi hồ sơ hoàn
  tất (tính từ lịch sử xử lý của hồ sơ) — dùng để đánh giá quy trình duyệt có
  đang chậm ở bước nào.
- **🔍 2. Tra cứu chi tiết + chọn cột + xuất Excel** — bên dưới khối thống kê,
  mỗi module có 1 bảng lọc đa chiều theo **từng trường thực tế có trong dữ
  liệu** (tự suy ra từ chính bản ghi, không cần khai báo cứng danh sách trường
  cho từng module) — cho phép tự chọn cột muốn hiển thị/xuất, thứ tự cột giữ
  theo lựa chọn của người dùng, rồi xuất ra Excel. Trường lạ (không có nhãn
  tiếng Việt định sẵn) vẫn hiển thị được — tự tách theo chữ hoa thành nhãn đọc
  được thay vì làm hỏng cả bảng.
- **🖨️ 1. Tạo Báo Cáo Theo Yêu Cầu** — dùng ĐÚNG bộ lọc/cột đang chọn ở mục
  "Tra cứu chi tiết" phía trên (không phải khai báo lại từ đầu), bấm
  **"👁️ Xem Trước & Xuất"** để xem 1 bản xem trước dạng văn bản ngay trong
  trang, rồi có thể in trực tiếp (mở hộp thoại in thật của trình duyệt) hoặc
  xuất lại ra Excel — tiện khi cần 1 bản in nhanh để nộp/lưu giấy mà không cần
  mở lại Excel để tự định dạng.
- **Tổng Hợp (dashboard toàn công ty)** — các thẻ tổng số liệu gộp toàn công
  ty, phân quyền xem theo module con (VD Ngân Sách: quyền `budgetAggregate`
  xem mọi phòng ban, `budgetManage` xem thêm khối "Toàn Công Ty").

Không cần cấu hình gì đặc biệt để dùng — mọi nhân viên có quyền vào module nào
thì tự thấy đúng phần báo cáo tương ứng của module đó khi có quyền xem báo cáo
(quyền riêng, không tự động theo quyền tạo hồ sơ).

**Kỹ thuật (Bước 7d/7e/7h, v18.3-v18.6)**: TOÀN BỘ 21/21 module Báo Cáo (Tài
Liệu, Văn Bản Trình, Công Việc, 3 luồng Vận Hành — Đơn Hàng/Mở Mới/Sửa Chữa,
Hợp Đồng, Đăng Ký Xe, Văn Phòng Tổng Hợp, Phòng Họp, Biên Bản Họp, Truyền
Thông Nội Bộ, Hỗ Trợ IT, Giấy Phép, HCRC Đồng Hành, Onboarding/Offboarding,
Định Kỳ, Ngân Sách, Văn Phòng Phẩm, Thanh Toán, Đồng Phục) giờ đọc qua
`GET /api/reports/:collection` — lọc sẵn theo phòng ban/khoảng ngày ngay ở
CSDL thay vì tải nguyên cả danh sách về trình duyệt rồi mới lọc — vẫn áp
dụng ĐÚNG quyền xem như trước (không đổi ai thấy gì; các phần lọc nghiệp vụ
riêng ngoài dept/ngày — VD Giấy Phép chỉ đếm hồ sơ gốc, Truyền Thông Nội Bộ
không lọc theo phòng ban, Đồng Phục lọc theo NHIỀU siêu thị đã chọn thay vì
1 phòng ban — vẫn giữ nguyên, chỉ đổi nguồn tải ban đầu). Công Việc (`tasks`)
đọc từ bảng riêng `dbo.Tasks` (có từ Bước 6b, không thuộc 55 collection Bước
7) qua 1 hàm truy vấn riêng cùng khuôn. Nếu API này lỗi (mất mạng tạm thời,
server đang khởi động lại...), màn hình tự động rơi về cách đọc cũ (dữ liệu
đã tải sẵn qua `GET /api/data`) — không mất tính năng, chỉ mất phần tối ưu
tốc độ trong đúng lúc đó.

---

## 5b. Chống trùng lặp dữ liệu khi Nhập Excel (10/2026)

Theo yêu cầu người dùng: các màn "Nhập Excel"/"Import" (tải file .xlsx/.csv
lên để nhập hàng loạt, KHÁC hẳn upload file đính kèm thông thường của 1 hồ sơ
đơn lẻ) đều phải cảnh báo nếu dòng dữ liệu trong file có vẻ TRÙNG với dữ liệu
đã có sẵn, rồi để người dùng tự quyết định "vẫn nhập"/"ghi đè"/"bỏ qua" —
KHÔNG được âm thầm bỏ qua (dễ để lọt dòng dữ liệu quan trọng) và cũng KHÔNG
tự động chặn cứng (một số trường hợp người dùng cố ý muốn nhập lại). Cơ chế
dùng chung `server/lib/importDedup.js` (`markDuplicateItems()`/
`normalizeDedupKey()`), so trùng LUÔN giới hạn trong ĐÚNG 1 chức năng đang
nhập (không so chéo sang module khác) — mỗi màn xem trước hiện rõ dòng nghi
trùng (tô màu vàng nhạt) kèm 1 trong 2 kiểu điều khiển:

- **Checkbox "Nhập dòng này"** (Ngân Sách Đề Xuất/Phê Duyệt, Checklist Đánh
  Giá Siêu Thị, Ngân Hàng Câu Hỏi Đào Tạo, Vận Hành > Siêu Thị — Danh Mục Đầu
  Tư/Danh Sách Công Việc, Kế Hoạch Đào Tạo theo tháng) — dùng khi mỗi dòng là
  1 mục độc lập (không có "bản ghi đã có" cụ thể để ghi đè), mặc định BỎ CHỌN
  cho dòng nghi trùng, người dùng tự tick lại nếu vẫn muốn thêm.
- **Chọn "Bỏ qua"/"Ghi đè thông tin"** (Hồ Sơ Nhân Sự, Quản Lý Người Dùng) —
  dùng khi trùng đúng 1 bản ghi đã có sẵn (Mã Nhân Viên/Username) — "Ghi đè"
  CHỈ cập nhật đúng các field mà file Excel thu thập được (VD Hồ Sơ Nhân Sự:
  địa chỉ/SĐT khẩn cấp/ngân hàng..., KHÔNG BAO GIỜ đụng Mã Nhân Viên/Tài
  khoản VPDT/trạng thái; Người Dùng: chỉ họ tên/email/SĐT/phòng ban/chức
  danh, KHÔNG BAO GIỜ đụng username/mật khẩu/quyền hạn) — mặc định "Bỏ qua".

Khoá so trùng theo từng module (đều chuẩn hoá bỏ dấu-hoa/thường-khoảng trắng
thừa qua `normalizeDedupKey()`):

| Module | Khoá so trùng | Phạm vi so "đã có" |
|---|---|---|
| Hồ Sơ Nhân Sự | Mã Nhân Viên | Toàn bộ `employeeProfiles` |
| Quản Lý Người Dùng | Username | Toàn bộ `DB.users` (client tự so, không cần round-trip) |
| Ngân Sách (Đề Xuất/Phê Duyệt) | Năm+Tháng+Vị trí+Danh mục+Nội dung | CHỈ đúng stage (tab) đang nhập, dòng gốc |
| Checklist Đánh Giá Siêu Thị | Nội dung câu hỏi | Danh sách câu hỏi đang soạn dở trên màn (client tự so) |
| Ngân Hàng Câu Hỏi Đào Tạo | Nội dung câu hỏi | Danh sách câu hỏi đang soạn dở trên màn (client tự so) |
| Vận Hành — Danh Mục Đầu Tư | Nội dung hạng mục | Bảng hạng mục đang sửa của ĐÚNG hồ sơ (client tự so — route đọc file không biết đang sửa hồ sơ nào) |
| Vận Hành — Danh Sách Công Việc | Tên công việc | Danh sách công việc GỐC đang có của ĐÚNG hồ sơ (client tự so) |
| Kế Hoạch Đào Tạo (theo tháng) | Tháng+Chương Trình+Đơn Vị | Toàn bộ `trainingPlans` đã có (server tự so, route đã sẵn dữ liệu). **Từ 9/2026 đường NHẬP TAY cũng so trùng theo đúng khoá này** — khác đường nhập file ở chỗ nhập tay bị **CHẶN HẲN** (báo lỗi, không cho lưu) thay vì chỉ cảnh báo để người dùng tự quyết, vì mỗi lượt nhập tay là 1 dòng chủ động chứ không phải khối hàng trăm dòng cần xem trước |

Cột "Ghi Chú"/dòng "Mẫu Ngân Sách" (khai cột tuỳ biến) chỉ so trùng NGAY
TRONG file đang đọc (tên cột trùng lặp) — không có khái niệm "đã có sẵn" vì
đây là cấu hình khuôn cột, không phải dữ liệu nghiệp vụ tích luỹ.

---

## 5c. Siết luật nghiệp vụ cụm Nhân Sự (đợt rà soát chuyên sâu 10/2026)

Các quy tắc dưới đây được BỔ SUNG/SIẾT LẠI sau đợt rà soát chuyên sâu cụm
"Nhân Sự" — không thêm màn hình/quyền mới nào, chỉ chặt chẽ hơn ở đúng các
điểm ghi dữ liệu. Nêu ở đây để người dùng biết vì sao 1 thao tác trước đây
làm được nay bị chặn:

**Onboarding & Hồ Sơ Nhân Sự**
- Tạo quy trình **Onboarding** mà tự gõ "Mã Nhân Viên": mã đó BẮT BUỘC phải
  là hồ sơ **đã nghỉ việc** (luồng Tái Tuyển, chọn qua "🔍 Kiểm Tra Nhân Sự
  Cũ") — gõ mã của người đang làm việc bị chặn (409), gõ mã không có trong hệ
  thống bị chặn (400). Nhân viên MỚI: để TRỐNG ô Mã Nhân Viên như hướng dẫn
  (hệ thống tự sinh "BL....").
- **Huỷ/Xoá** 1 quy trình Onboarding: hồ sơ nhân sự còn ở trạng thái **Nháp**
  đã được đặt chỗ lúc tạo sẽ được **xoá theo** (ghi 1 dòng Nhật Ký Hệ Thống),
  giải phóng Mã Nhân Viên để dùng lại — trước đây mã đó bị khoá vĩnh viễn.
  Hồ sơ đã "Đang làm việc"/"Nghỉ dài hạn"/"Đã nghỉ việc" KHÔNG bao giờ bị đụng.
- **CCCD/CMND không được trùng** trên toàn bộ Hồ Sơ Nhân Sự — nay áp dụng cho
  CẢ 3 đường ghi: tạo mới, **sửa hồ sơ** (Chi tiết → Lưu) và **Nhập Excel chọn
  "Ghi đè thông tin"** (trước đây chỉ chặn lúc tạo). Trùng CCCD nghĩa là phải
  dùng Tái Tuyển thay vì lập hồ sơ thứ 2.
- **Người phụ thuộc / Học vấn**: Ngày sinh phải là ngày thật, không ở tương
  lai; Năm tốt nghiệp là số nguyên trong khoảng 1900 → (năm hiện tại + 10).
- **Xuất Excel Hồ Sơ Nhân Sự** nay ghi Nhật Ký Hệ Thống (ai xuất, lúc nào) và
  giới hạn 20 lần/5 phút cho mỗi tài khoản.
- Tắt module "Hồ Sơ Nhân Sự" (Khối 0 — Quyền Truy Cập Module) nay chặn THẬT
  toàn bộ API hồ sơ, không chỉ ẩn giao diện. Ngoại lệ duy nhất: danh sách
  chọn nhân viên dùng cho module Hợp Đồng Lao Động.

**Hợp Đồng Lao Động**
- Chỉ thêm được **Phụ lục** cho hợp đồng **đang hiệu lực**. Hợp đồng còn Nháp
  thì sửa trực tiếp nội dung rồi kích hoạt; hợp đồng đã chấm dứt/hết hạn/bị
  thay thế không sửa đổi được nữa.
- **Ngày chấm dứt** khi đóng hợp đồng tay: phải hợp lệ, không trước Ngày hiệu
  lực hợp đồng và không quá 1 năm kể từ hôm nay.
- **Nhân viên tự xem hợp đồng của mình**: hệ thống nay tự gắn tài khoản VPDT
  vào hợp đồng (lúc tạo, lúc sinh tự động theo Onboarding, và lúc HR liên
  kết/đổi tài khoản cho hồ sơ) — trước đây tính năng này không chạy vì liên
  kết chưa bao giờ được ghi.

**Công & Phép**
- Không nộp được đơn nghỉ phép **trùng khoảng ngày với đơn ĐÃ DUYỆT** (trước
  đây chỉ chặn trùng với đơn đang chờ duyệt — nguồn gốc lỗi trừ quỹ phép 2
  lần). Đơn đã huỷ/từ chối không tính là trùng.
- **Huỷ 1 đơn nghỉ phép đã duyệt** nay khôi phục lại các dòng **Lịch Phân Ca**
  mà lượt duyệt đã tự huỷ (song song với việc hoàn quỹ phép + dọn chấm công
  vốn đã có). Dòng phân ca bị huỷ vì lý do khác (huỷ tay, nghỉ việc) giữ nguyên.
- **API máy chấm công** (`POST /api/attendance/clock-punch`) từ chối mốc giờ ở
  tương lai (dung sai 5 phút) và mốc giờ rơi vào **kỳ lương đã Chốt/Công Bố**.

**Lương**
- **Thuế TNCN được tính lại** mỗi khi kế toán "Điều Chỉnh dòng lương" làm đổi
  thu nhập chịu thuế (thưởng/phụ cấp nhập tay) và mỗi khi "Tính Lương" lại cả
  kỳ — trước đây phần thu nhập nhập tay thoát thuế hoàn toàn. Dòng khấu trừ
  nhập tay (tạm ứng/phạt) KHÔNG làm giảm thu nhập chịu thuế.
- **Cấu Hình Lương**: Ngày công chuẩn (HO/Siêu Thị) và Số giờ công chuẩn/ngày
  bắt buộc > 0 (là mẫu số khi tính lương ngày/giờ); % BHXH/BHYT/BHTN phải nằm
  trong 0–100%.
- **Tính Lương Tự Động** nay xoá phiếu cũ + ghi phiếu mới trong ĐÚNG 1 giao
  dịch — lỗi giữa chừng không còn làm mất dữ liệu phiếu lương của kỳ.
- **Phiếu lương nhân viên tự xem** hiển thị kèm **ghi chú** của từng dòng điều
  chỉnh tay (giống màn kế toán) — nhân viên biết rõ lý do khoản cộng/trừ.

**Đào Tạo Tân Binh**
- Không xoá được **Lộ Trình** còn hồ sơ tiến độ đang tham chiếu (409, nêu rõ
  số hồ sơ) — xoá đi sẽ khiến các hồ sơ đó không xác nhận tiếp giai đoạn được.

---

## 6. Phân quyền (permission model)

**Hệ Thống → Quản Trị → Phân Quyền** — cây phân quyền chia thành các **khối**
đánh số, mỗi khối là 1 nhóm quyền gấp gọn được (có badge tóm tắt "đã cấp
X/Y" ngay trên tiêu đề):

```
0. Quyền Truy Cập Module        12. Văn Phòng Phẩm
1. Hệ Thống & Chung              13. Báo Cáo Định Kỳ
2. Tài Liệu                      15. Hỗ Trợ IT
3. Văn Bản Trình                 16. Đồng Phục
4. Hợp Đồng & Giấy Phép          18. Ngân Sách
5. Phòng Họp                     19. Đào Tạo
6. Đăng Ký Xe                    20. Giấy Phép
7. Văn Phòng (Mua/Sửa)           21. Nhân Sự
8. Truyền Thông Nội Bộ           22. Vận Hành
9. Biên Bản Họp & Công Việc      23. Checklist Đánh Giá Siêu Thị
10. Thanh Toán                   24. Nghiệp Vụ & Báo Cáo
                                  25. Mua Hàng
```

**Số thứ tự 11/14/17 KHÔNG còn trong cây phân quyền** (từ v23.65) — đây là 3
cấu hình CHUNG toàn hệ thống (không phải quyền theo từng người) nên đã dời
hẳn sang **Hệ Thống → 🔀 Quy Trình Nâng Cao**, mất số thứ tự cũ, còn giữ đúng
tên/nội dung: **🖋️ Nhóm Phê Duyệt Trình/HĐ** (gộp chung 2 khối cũ 11 "Nhóm Phê
Duyệt Trình" + 14 "Nhóm Phê Duyệt HĐ") và **🧩 Nhóm Quyền Đặc Biệt** (khối cũ
17, xem mục 3.3). Cây phân quyền (còn 23 khối, đánh số giữ nguyên có khoảng
trống ở 11/14/17) từ nay CHỈ còn quyền cấp riêng theo từng người/nhóm phân
quyền, không lẫn cấu hình chung nữa.

Mỗi checkbox 1 quyền cụ thể (đọc/tạo/sửa/duyệt/quản lý theo module) — nhiều
quyền còn có thêm phạm vi **theo phòng ban** (tick "Tất cả" hoặc chỉ chọn vài
phòng cụ thể). Khối "0. Quyền Truy Cập Module" quyết định người dùng có **vào
được module** hay không trước tiên — không có quyền vào module thì các quyền
chi tiết bên trong module đó (khối 2-22 tương ứng) vô nghĩa.

**Nhóm quyền (`permGroups`)** — thay vì tick tay từng quyền cho từng người,
admin có thể tạo 1 "nhóm phân quyền" mẫu (VD "Nhân viên phòng Kế Toán") gồm 1
bộ quyền cố định, rồi gán nhiều người dùng vào nhóm đó — nhóm đóng vai trò
**overlay cộng thêm**: quyền hiệu lực cuối cùng của 1 người = quyền cá nhân họ
được cấp **HỢP** với quyền của mọi nhóm họ thuộc về (không phải thay thế) —
sửa 1 nhóm là cập nhật quyền cho toàn bộ thành viên nhóm đó cùng lúc, tiện khi
quản lý nhiều người cùng vai trò.

**Gộp nhiều nhóm — khối "0. Quyền Truy Cập Module" (sửa từ đợt rà soát cụm Hệ
Thống/Admin/Cấu Hình)**: 1 người thuộc NHIỀU nhóm thì quyền của các nhóm được
HỢP lại theo từng loại dữ liệu (cờ bật/tắt lấy "có ở bất kỳ nhóm nào là có",
phạm vi phòng ban lấy hợp, mức xác thực người duyệt lấy mức cao nhất) — nhưng
riêng khối 0 trước đây bị lấy **nguyên trạng của nhóm được tick sau cùng**,
nên cùng 1 người có thể mất/được quyền vào module chỉ vì thứ tự tick nhóm khác
đi. Nay khối 0 cũng hợp theo **từng module một**: chỉ cần **một** nhóm mở
module đó là người này vào được; module chỉ bị chặn khi **mọi** nhóm đều chặn.

**Cấp quyền cho 1 nhân viên mới** (quy trình thường dùng):

1. Tạo tài khoản ở **Hệ Thống → Quản Trị → Người Dùng** (điền phòng ban, chức
   danh — 2 trường này còn ảnh hưởng tới chế độ duyệt "Theo vị trí" ở mục
   3.1). Có thể tạo NHIỀU tài khoản cùng lúc rồi lưu 1 lần — xem mục 7.
2. Nếu công ty đã có sẵn 1 nhóm phân quyền phù hợp vai trò của họ → gán vào
   nhóm đó ngay (mục "Nhóm phân quyền" ở form Sửa Người Dùng) — đủ dùng cho đa
   số trường hợp, không cần tick tay.
3. Cần quyền đặc thù riêng ngoài nhóm (VD được thêm quyền "Người duyệt" — mục
   3.2, hoặc quyền quản lý 1 module cụ thể) → mở cây phân quyền cá nhân, tìm
   đúng khối tương ứng (bảng số ở trên), tick thêm.
4. Muốn người này **duyệt được** hồ sơ ở 1 bước cụ thể qua chế độ Theo phòng
   ban/Theo vị trí → nhớ tick quyền **"Người duyệt"** (khối 1) — bước dễ quên
   nhất, xem cảnh báo ở mục 3.2.

### 6.1. Dữ liệu nhạy cảm Nhân Sự — admin KHÔNG tự động có quyền (từ v23.28)

Theo yêu cầu người dùng (10/2026): **Hồ Sơ Nhân Sự**, **Hợp Đồng Lao Động**,
**Lương** là 3 khu vực nhạy cảm nhất hệ thống — từ v23.28, quyền `perms.admin`
(tick "Quản Trị Viên") **không còn tự động mở** 3 khu vực này nữa (trước đây
mọi hàm `canManage*`/`canApprove*` liên quan đều có nhánh `|| perms.admin`).
Phải cấp đúng quyền cụ thể mới quản lý được:

- **Hồ Sơ Nhân Sự**: `hrProfileManage` (toàn quyền), hoặc tách nhỏ
  `hrProfileCreate`/`hrProfileFullView`/`hrProfileEdit` (khối 21, xem mục
  6 ở trên).
- **Hợp Đồng Lao Động**: `hrContractManage` (khối 21).
- **Lương**: `hrPayrollManage` (lập/tính) và/hoặc `hrPayrollApprove` (duyệt —
  tách biệt hoàn toàn với lập/tính, đúng nguyên tắc phân quyền kế toán,
  khối 21).

**Lưu ý quan trọng — tài khoản `admin` mặc định**: tài khoản có `username`
đúng là `"admin"` (id=1, xem `defaults.js`) bị **khoá cứng vĩnh viễn** ở CẢ
UI lẫn server (`routes/data.js::prepareUsersForSave()`) — quyền của tài
khoản này LUÔN CHỈ là `{ admin: true }`, không thể gán thêm
`hrProfileManage`/`hrContractManage`/`hrPayrollManage`/`hrPayrollApprove`
(hay bất kỳ quyền nào khác) qua bất kỳ đường nào, kể cả gán Nhóm Phân Quyền —
đây là thiết kế CỐ Ý để luôn còn đúng 1 tài khoản không thể bị khoá nhầm.
**Hệ quả**: tài khoản `admin` sẽ **KHÔNG BAO GIỜ** vào được 3 module trên kể
từ bản này. Nếu cần người thật sự quản lý các module này, hãy tạo/dùng 1 tài
khoản KHÁC (username khác `"admin"`) và cấp đúng quyền cụ thể ở trên —
kể cả tài khoản đó có tick thêm `perms.admin` (VD 1 "admin phụ") vẫn cấp
được bình thường vì không bị khoá cứng như tài khoản `admin` gốc.

**Từ đợt rà soát cụm Hệ Thống/Admin/Cấu Hình**: khoá này nay xét theo **bản
ghi đang lưu trong CSDL** chứ không theo tên đăng nhập client vừa gửi lên —
trước đây chỉ cần đổi `username` của chính tài khoản gốc (VD `admin` →
`quantri`) **trong cùng 1 lượt lưu** kèm quyền rỗng là gỡ được khoá hoàn toàn;
và ngược lại, sau khi tài khoản gốc đổi tên thì bất kỳ ai tự đổi tên mình
thành `admin` cũng được tự động phong toàn quyền. Hệ quả cho người dùng:
**không đổi được tên đăng nhập của tài khoản `admin` gốc nữa** (server tự giữ
lại tên `admin`) — muốn 1 tài khoản quản trị mang tên khác thì tạo tài khoản
riêng và cấp `perms.admin` như trên. Ngoài ra `id` của tài khoản cũng được
kiểm tra **duy nhất** ở server (trước đây chỉ kiểm tra trùng tên đăng nhập),
chặn trường hợp hiếm 2 tài khoản trùng id làm hợp nhất/xoá nhầm lẫn nhau.

**Nhật ký hệ thống (audit log)**: mọi thao tác THAY ĐỔI (không phải xem) ở 3
khu vực trên đều được ghi vào **Hệ Thống → Nhật Ký Hệ Thống** để đối chiếu —
Hồ Sơ Nhân Sự (tạo/sửa/đổi trạng thái/liên kết tài khoản/tái tuyển + log truy
cập lịch sử/báo cáo), Hợp Đồng Lao Động (sửa/kích hoạt/bổ sung/đổi trạng
thái), Lương (cấu hình tỷ lệ/tính lương/điều chỉnh phiếu/nộp-duyệt-từ chối-
chốt-mở lại kỳ/công bố).

---

## 7. Hệ Thống / Quản Trị

Nhóm màn cấu hình **chỉ admin dùng** — không phải "module nghiệp vụ" theo
nghĩa có luồng tạo/duyệt hồ sơ riêng, mà là nơi cấu hình mọi module ở mục 4-6.
Từ v23.63, mỗi mục ở đây đều có thêm bản tóm tắt trực quan (sơ đồ quy trình +
hướng dẫn click-by-click) ở tab **⚙️ Hệ Thống** trong **📘 Hướng Dẫn** (xem mục
2.5) — mục dưới đây vẫn là nguồn tham khảo đầy đủ và chi tiết nhất.

### 7.1. Quy Trình & Phê Duyệt

Xem đầy đủ ở mục 3 — đây chỉ là đường dẫn màn hình
(**Hệ Thống → 🔄 Quy Trình & Phê Duyệt**), cấu hình người duyệt cho từng bước
của hơn 15 module dùng chung engine phê duyệt.

### 7.2. Quản Lý Danh Mục

Nơi admin quản lý các danh mục "lõi" dùng chung toàn hệ thống: Phòng ban,
Chức danh, Siêu thị, Loại Giấy Phép, Loại Dịch Vụ CNTT, **🚗 Loại Xe Cụ Thể**/
**🚕 Hãng Taxi** (mục "Loại xe cụ thể"/"Hãng Taxi" ở "Phần Dành Cho Phòng Hành
Chính" của Đăng Ký Xe, xem mục 4.2), **🗺️ Vùng Giá Áp Dụng** (mục "Vùng Giá
Áp Dụng" ở form Phê Duyệt Giá Bán Lẻ, Hỗ Trợ IT, xem mục 4), **🗂️ Danh Mục
Phòng Họp** (từ v22.2 — trước đó nằm trong module Phòng Họp, xem mục 4),
**📲 Phím Tắt PWA** (chọn tối đa 4 module hiện nhanh khi cài ứng dụng lên màn
hình chính, xem mục 2.4)... Đa số danh mục **theo từng module riêng** (VD "Độ
Khẩn" của Văn Bản
Trình, "Mục Đích Sử Dụng" của Đăng Ký Xe, "Chủ Đề" của HCRC Đồng Hành) lại cấu
hình ở màn Biểu Mẫu (mục 7.3) thay vì ở đây — 2 màn có vai trò khác nhau: mục
này là danh mục LÕI dùng chéo nhiều module, Biểu Mẫu là tuỳ biến RIÊNG của
từng form.

**Sửa (✏️) một mục danh mục (từ v22.2)** — mọi card trong màn này giờ đều có
nút Sửa bên cạnh Xóa (trước đó phần lớn chỉ Xóa, phải xóa-tạo-lại nếu gõ sai
tên):
- **Phòng Ban/Phân Loại Tài Liệu**: sửa qua route riêng có **cascade** —
  đổi tên xong, mọi hồ sơ/tài khoản/cấu hình quy trình đang mang tên cũ
  được server tự cập nhật sang tên mới (cùng cơ chế đã có sẵn cho Siêu
  Thị/Chức Danh). Sau khi đổi, **tải lại trang** để thấy tên mới hiển thị
  đầy đủ ở mọi màn hình khác đang mở sẵn trong phiên.
  **Sửa lỗi 9/2026**: cascade này trước đây **bỏ sót cấu hình duyệt TÀI LIỆU**
  (map `deptWorkflows` — map duy nhất không mang hậu tố `<module>DeptWorkflows`
  nên bị lọt khi rà theo tên), khiến đổi tên 1 phòng ban xong là cấu hình duyệt
  Tài Liệu của phòng đó kẹt lại dưới tên CŨ: tài liệu mới tải lên (mang tên
  MỚI) rơi về quy trình mặc định, không ai duyệt được cho tới khi admin tự cấu
  hình lại từ đầu. Nay đã cascade đủ **11/11** map cấu hình duyệt theo phòng
  ban.
- **Các Loại Giấy Phép/Hãng Taxi/Vùng Giá Áp Dụng/Loại Đào Tạo**: đổi trực
  tiếp, KHÔNG cascade sang hồ sơ đã tạo trước đó (hồ sơ cũ giữ nguyên tên cũ
  làm nhãn hiển thị) — phù hợp vì đây là giá trị hiển thị tự do, không phải
  khoá phân quyền/định tuyến quy trình như Phòng Ban.
- **Loại Xe Cụ Thể/Từ Khoá Nhạy Cảm/Danh Mục Phòng Họp** (nhiều field/mục):
  sửa qua nhiều hộp thoại nhập liên tiếp (tên rồi tới field tiếp theo) thay
  vì 1 hộp duy nhất, vì mỗi mục ở đây có hơn 1 thông tin cần sửa.

**Xoá (🗑) một giá trị danh mục — cảnh báo tham chiếu treo (từ đợt rà soát cụm
Hệ Thống/Admin/Cấu Hình)**: hệ thống KHÔNG kiểm tra được hết nơi đang dùng 1
giá trị danh mục (hồ sơ đã tạo, cấu hình quy trình/phạm vi quyền theo phòng
ban, tài khoản người dùng... đều lưu dưới dạng chuỗi). Xoá xong, các nơi đó
vẫn giữ nguyên tên cũ thành **tham chiếu treo** (không chọn lại được trên
dropdown), và nếu sau này tạo lại **đúng tên cũ** thì các cấu hình đó tự động
có hiệu lực trở lại. Hộp thoại xác nhận khi xoá nay nêu rõ điều này và nhắc
dùng nút **✏️ Sửa** (đổi tên có cascade) nếu chỉ muốn sửa tên gõ sai.

### 7.3. Biểu Mẫu

**📋 Biểu Mẫu** — vai trò: cho phép admin tự tuỳ biến field của gần như mọi
form tạo hồ sơ trong hệ thống **mà không cần sửa code** — đổi nhãn hiển thị,
đổi field nào bắt buộc, sửa danh sách lựa chọn (dropdown) của field, và **thêm
hẳn field mới** vào form nếu công ty cần thu thập thêm thông tin riêng. Bao
phủ 23 nhóm module (Văn Bản Trình, Hợp Đồng, Đăng Ký Xe, Văn Phòng, Tài Liệu,
Biên Bản Họp, Đặt Phòng Họp, Truyền Thông Nội Bộ, Công Việc, VPP, Giấy Phép,
Hỗ Trợ IT, Thanh Toán, Ngân Sách, Báo Cáo Định Kỳ, Đồng Phục, Vận Hành, Đào
Tạo, Tuyển Dụng, HCRC Đồng Hành, Onboarding/Offboarding, **Hồ Sơ Nhân Sự**
["➕ Tạo Hồ Sơ Mới"], **Lương** ["✏️ Điều Chỉnh Phiếu Lương"], **Checklist
Đánh Giá Siêu Thị** [4 field cấp mẫu: Mã/Tên/Loại/Ngưỡng Đạt — riêng phần câu
hỏi/lựa chọn tự thêm-bớt bên trong mỗi mẫu KHÔNG tuỳ biến được ở đây, cùng lý
do với Ngân Hàng Câu Hỏi Đào Tạo]). Field tự thêm lưu trong `DB.formTemplates`,
hiện thêm ngay dưới các field mặc định của đúng form đó — không ảnh hưởng hồ
sơ cũ đã tạo trước khi thêm field.

### 7.4. Quản Lý Tệp File

**📎 Quản Lý Tệp File** — cấu hình 2 việc riêng theo TỪNG module có upload tệp:
**loại tệp được phép** (mặc định `.pdf/.docx/.xlsx` cho 8 module — Tài Liệu,
Văn Bản Trình, Hợp Đồng, Đăng Ký Xe, Đặt Phòng Họp, Biên Bản Họp, Tổng Hợp,
Truyền Thông Nội Bộ; riêng ảnh minh hoạ câu hỏi Đào Tạo chỉ nhận định dạng
ảnh) và **giới hạn dung lượng tối đa (MB)** riêng cho module đó — chỉ được
SIẾT chặt hơn, không vượt quá giới hạn chung toàn hệ thống `UPLOAD_MAX_MB`
(mặc định 20MB, cấu hình ở `.env`, xem `Huong-dan-trien-khai-PM2.md`/
`Huong-dan-trien-khai-PM2-Nginx.md`).

**Giới hạn tần suất TẢI tệp (9/2026)** — nút "Tải" của mọi module đi qua chung
1 route đóng dấu watermark cho tệp PDF (tốn CPU/RAM hơn hẳn thao tác thường),
nên route này có giới hạn riêng **60 lượt tải/phút cho mỗi tài khoản** (trước
đây chỉ có giới hạn chung 600 request/phút cho toàn bộ API, thực tế không bao
giờ chạm tới). Ngưỡng này dư cho thao tác tải thật kể cả nút "Tải tất cả tệp";
nếu ai đó vượt quá sẽ nhận thông báo "Bạn đang tải tệp quá nhiều, vui lòng thử
lại sau ít phút" — không cần cấu hình gì thêm.

### 7.5. Thùng Rác

**🗑️ Thùng Rác** — **chỉ admin** vào được (kiểm tra lại ở server, không chỉ
ẩn nút giao diện). Gom hồ sơ đã xoá từ gần như mọi module nghiệp vụ (khoảng
30 loại hồ sơ khác nhau) về 1 nơi để **khôi phục lại** nếu xoá nhầm, hoặc
**xoá vĩnh viễn** (yêu cầu xác thực lại — mật khẩu/OTP/vân tay tuỳ mức cấu
hình của admin đó) khi chắc chắn không cần nữa. Hồ sơ trong Thùng Rác **không
tự động dọn theo thời gian** — nằm mãi ở đây cho tới khi có người chủ động
khôi phục hoặc xoá vĩnh viễn.

**Khôi phục có để lại dấu vết (từ đợt rà soát cụm Hệ Thống/Admin/Cấu Hình)**:
mỗi lượt **Khôi phục** giờ tự sinh 1 dòng trong Nhật Ký Hệ Thống (mục 7.6) ghi
rõ ai khôi phục, hồ sơ nào (loại hồ sơ + mã), có kèm bao nhiêu bản ghi cùng
"họ" (phiên bản/phụ lục) — trước đây hồ sơ đã xoá có thể xuất hiện trở lại mà
không ai truy được người thực hiện.

### 7.6. Nhật Ký Hệ Thống (Log)

**📊 Log** — ghi lại mọi thao tác quan trọng (đăng nhập, tạo/sửa/xoá/duyệt hồ
sơ...) kèm người thực hiện, thời gian, module, kết quả. **Chỉ admin xem
được** và không giới hạn theo phòng ban (admin xem được nhật ký của TOÀN công
ty, không chỉ phòng mình). Bộ lọc: Phân Hệ (module), Sự Kiện (loại thao tác),
Trạng thái, và ô tìm nhanh theo từ khoá (khớp cả tên đăng nhập/địa chỉ IP/loại
thao tác/mô tả). Hệ thống tự động **chỉ giữ lại 5.000 dòng gần nhất** — nhật
ký cũ hơn tự bị dọn dần, không cần admin tự xoá tay; mỗi lượt tải cũng chỉ trả
tối đa 1.000 dòng/lần (dùng bộ lọc để thu hẹp thay vì tải hết).

**Nhật ký do SERVER tự ghi cho thao tác quản trị (từ đợt rà soát cụm Hệ Thống/
Admin/Cấu Hình)**: trước đây toàn bộ dòng nhật ký đều do trình duyệt tự gửi
lên sau khi lưu — nghĩa là thao tác gọi thẳng API (bỏ qua giao diện) không để
lại dấu vết nào, và ngược lại trình duyệt vẫn ghi được dòng "SUCCESS" cho 1
thao tác mà server đã từ chối. Nay **mỗi lượt ghi đè các collection quản trị
nhạy cảm** (người dùng & nhóm quyền, nhóm/cấp phê duyệt, mọi cấu hình quy
trình duyệt, cấu hình Email/API dsmart16/API key, nhóm quyền đặc biệt, cấu
hình tệp tải lên/biểu thuế lương/từ khoá nhạy cảm) đều sinh thêm 1 dòng
`CONFIG / ADMIN_DATA_WRITE` **ngay tại server**, chỉ khi ghi THÀNH CÔNG. Vì
vậy 1 thao tác qua giao diện có thể xuất hiện 2 dòng (1 của giao diện mô tả
nghiệp vụ chi tiết, 1 của server làm bằng chứng) — đây là hành vi có chủ đích.
Thao tác **Xoá toàn bộ nhật ký** cũng tự ghi lại 1 dòng "bia mộ"
(`SYSTEM / CLEAR_SYSTEM_LOGS`) làm dòng đầu tiên của nhật ký mới.

### 7.7. Người Dùng — tạo hàng loạt

Ở màn **Người Dùng**, ngoài tạo từng tài khoản 1, admin có thể điền xong 1
form rồi bấm thêm vào 1 **danh sách tạm** (chưa gửi lên server), lặp lại cho
nhiều người, rồi bấm **"Lưu Tất Cả Danh Sách"** để tạo TẤT CẢ cùng 1 lúc —
tiện khi nhận nhiều nhân viên mới cùng đợt (VD đầu năm học/mùa tuyển dụng) mà
không phải chờ tạo xong người này mới sang người kế tiếp. Trước khi lưu, hệ
thống tự kiểm tra trùng tên đăng nhập (cả trong danh sách tạm lẫn với tài
khoản đã có) và báo rõ nếu có trùng; server sau đó tự băm mật khẩu và xác
thực lại toàn bộ trước khi ghi.

### 7.8. Cấu Hình Email

**Hệ Thống → Quản Trị → Cấu Hình Email** — cấu hình **toàn bộ** trên web (Host/
Port/Kiểu mã hoá/Email người gửi/Bật-tắt/Tài khoản đăng nhập SMTP), không cần
sửa `.env` hay khởi động lại server cho các thay đổi này. Có 3 nút chọn nhanh
kiểu mã hoá (Không mã hoá/TLS/SSL, tự đổi Port sang giá trị chuẩn tương ứng
25/587/465) và nút "Gửi Thử" để xác minh cấu hình đúng trước khi Lưu. Mặc định
hệ thống chỉ **mô phỏng** gửi email (ghi Nhật ký hệ thống, không gửi thật) cho
tới khi nhập SMTP Server ở màn này.

**🔔 Thông Báo Email Phê Duyệt** — cho phép admin **tắt riêng** từng loại
email liên quan phê duyệt theo từng module, mà không đụng gì tới cấu hình SMTP
ở trên. Lý do: nhiều người đã thấy hồ sơ chờ duyệt qua Hộp Thư Phê Duyệt (mục
2.2) nên email "Cần phê duyệt" thường trùng lặp/gây spam, trong khi email "Kết
quả duyệt" (gửi người trình, vốn không theo dõi Hộp Thư) vẫn cần thiết — 2
nhóm sự kiện (family) tắt/bật **độc lập nhau**:

- **Cần phê duyệt** (`approvalNeeded`) — email gửi người duyệt khi có hồ sơ
  mới chờ xử lý. Mặc định **TẮT** cho module chưa từng cấu hình.
- **Kết quả duyệt** (`result`) — email gửi người trình khi hồ sơ được
  duyệt/từ chối. Mặc định **BẬT** cho module chưa từng cấu hình.

Module nào chưa có điểm gọi email tương ứng trong code thì ô đó hiện disabled
kèm ghi chú. **An toàn khi chưa cấu hình**: nếu admin chưa từng mở màn này để
Lưu, hệ thống **fail-open** — email vẫn gửi như hành vi gốc; chỉ khi admin đã
lưu rõ ràng giá trị tắt thì email mới thực sự bị chặn (vẫn ghi đầy đủ 1 dòng
Nhật ký hệ thống, chỉ khác không tốn lượt gọi SMTP thật).

### 7.9. API Đối Tác Ngoài (ExtAuth)

`lib/externalAuth.js` + `routes/externalAuthAdmin.js` (quản lý key, admin-only,
mount tại `/api/admin/external-api-keys`) + `routes/externalAuthVerify.js`
(API thật cho hệ thống ngoài gọi, mount tại `/api/external/...`) cho phép 1
ứng dụng **ngoài** hệ thống xác thực (hoặc đồng bộ danh bạ) người dùng HCRC
Workspace mà không cần tự lưu mật khẩu người dùng:

- `POST /api/external/verify-credentials` — xác thực 1 cặp tài khoản/mật khẩu
  HCRC Workspace, trả lời đúng/sai. **Không cấp phiên đăng nhập** (không trả
  cookie/JWT) — chỉ trả lời có đúng mật khẩu hay không, dùng cho ứng dụng khác
  muốn "đăng nhập hộ" bằng đúng tài khoản HCRC.
- `GET /api/external/users` — đồng bộ danh bạ nhân sự cơ bản (username/tên/
  điện thoại/phòng ban/chức danh) — chỉ trả field công khai nội bộ, **không
  bao giờ** kèm mật khẩu/PIN dù đã hash.

**Cấp/thu hồi key (admin)**: vào màn quản lý API key (Hệ Thống → Quản Trị) —
tạo key mới sinh 1 chuỗi ngẫu nhiên dạng `hcrc_` + 64 ký tự hex, **chỉ hiển thị
đúng 1 lần lúc tạo** (DB chỉ lưu bcrypt hash, không đọc lại được key thật kể cả
có toàn quyền truy cập DB) — phải copy lại ngay (nút "📋 Sao chép") và giao cho
bên tích hợp. Mỗi key có thể khai báo thêm **danh sách IP/CIDR được phép gọi**
(`allowedIps`, tuỳ chọn) — để trống = không hạn chế IP, key đúng gọi từ đâu
cũng được; khai báo rồi thì request từ IP ngoài danh sách bị chặn (403) dù key
đúng.

4 hành động cho 1 key đang **hoạt động**: **Sửa IP** (đổi `allowedIps`), **🔄
Tạo lại key** (từ v22.1 — xoay vòng bí mật mà KHÔNG mất lịch sử/allowedIps đã
cấu hình: key CŨ ngừng hoạt động NGAY LẬP TỨC, hộp hiện key mới bật lại kèm
nút "📋 Sao chép", phải cập nhật lại cho bên tích hợp ngay), và **Thu hồi**
(dừng vĩnh viễn, không có "kích hoạt lại"). 1 hành động cho key **đã thu hồi**:
**🗑️ Xóa** (từ v22.1 — xoá hẳn khỏi bảng hiển thị để dọn dẹp các key cũ tồn
đọng lâu ngày; Nhật ký hệ thống vẫn còn nguyên, không mất dấu vết) — chỉ xoá
được key ĐÃ thu hồi, buộc đi qua bước Thu hồi (đã có xác nhận riêng) trước khi
xoá, tránh bấm nhầm xoá luôn 1 key ứng dụng ngoài đang dùng.

Giới hạn số lần gọi: `EXTERNAL_AUTH_RATE_LIMIT_MAX` trong `.env` (mặc định
300 lần/15 phút/IP) — xem `Huong-dan-trien-khai-PM2-Nginx.md` để chỉnh khi cần.

> Một tài liệu đặc tả API đầy đủ (định dạng request/response, mã lỗi...) đã
> được soạn riêng cho đối tác trong 1 phiên làm việc trước (dạng Artifact) —
> mục này chỉ tóm tắt góc nhìn cấu hình/quản trị, không lặp lại toàn bộ đặc tả
> API ở đây.
