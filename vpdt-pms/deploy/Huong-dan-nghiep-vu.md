# HƯỚNG DẪN NGHIỆP VỤ — HCRC WORKSPACE (VPDT)

Mô tả nghiệp vụ + hướng dẫn sử dụng/cấu hình các tính năng nghiệp vụ, API, báo
cáo của ứng dụng. Đây là tài liệu **sống** — theo quy ước ở `CLAUDE.md`, bất kỳ
thay đổi nghiệp vụ nào (module mới, luồng phê duyệt mới, cấu hình API/báo cáo
mới...) đều phải cập nhật vào file này.

> Tài liệu triển khai (cài đặt server, SQL Server, PM2, Nginx...) nằm ở
> [`Huong-dan-trien-khai.md`](./Huong-dan-trien-khai.md) — không lặp lại ở đây.

### Mục lục

- [1. Tổng quan](#1-tổng-quan)
- [2. Mô hình quy trình phê duyệt chung](#2-mô-hình-quy-trình-phê-duyệt-chung)
- [3. Danh sách module nghiệp vụ theo nhóm](#3-danh-sách-module-nghiệp-vụ-theo-nhóm)
- [4. Cấu hình Báo Cáo (Reports module)](#4-cấu-hình-báo-cáo-reports-module)
- [5. API cho đối tác bên ngoài (ExtAuth)](#5-api-cho-đối-tác-bên-ngoài-extauth)
- [6. Cấu hình Email thông báo](#6-cấu-hình-email-thông-báo)
- [7. Phân quyền (permission model)](#7-phân-quyền-permission-model)

---

## 1. Tổng quan

**HCRC Workspace** (tên nội bộ trước đây: VPDT — Văn Phòng Điện Tử) là hệ
thống quản lý nghiệp vụ/văn bản nội bộ dùng chung cho toàn công ty — mọi nhân
viên dùng để trình/duyệt văn bản, đăng ký xe/phòng họp/văn phòng phẩm, quản lý
hợp đồng/giấy phép, báo cáo công việc, tra cứu chính sách nhân sự...; admin/
quản lý dùng để cấu hình quy trình phê duyệt, phân quyền, báo cáo tổng hợp và
theo dõi toàn bộ hoạt động qua Nhật ký hệ thống.

**Kiến trúc tóm tắt** (chi tiết triển khai xem `Huong-dan-trien-khai.md`):
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
[SQL Server] — dbo.AppData (cấu hình) + dbo.SystemLogs/Tasks/Records (hồ sơ nghiệp vụ)
```

Ai dùng gì: **mọi nhân viên** — Tài Liệu, Văn Bản Trình, Công Việc, Truyền
Thông Nội Bộ, Hỗ Trợ IT (ticket), đăng ký Xe/Phòng Họp/VPP đều mở sẵn (có thể
admin tắt riêng từng module qua "0. Quyền Truy Cập Module"). **Trưởng
phòng/người được gán quyền duyệt** — xử lý hồ sơ chờ duyệt của phòng/bước mình
phụ trách qua Hộp Thư Phê Duyệt (mục 2). **Admin/Quản trị** — toàn bộ mục 2-7
dưới đây.

---

## 2. Mô hình quy trình phê duyệt chung

Đây là cơ chế **cross-cutting** quan trọng nhất hệ thống — hơn 15 module dùng
chung 1 khuôn quy trình phê duyệt theo phòng ban/tier (`WF_MODULE_CONFIG` ở
`public/js/module-workflow.js`, engine thật ở `lib/workflowEngine.js`): Tài
Liệu, Văn Bản Trình (theo từng loại tờ trình), Đăng Ký Xe, Mua Sắm/Sửa Chữa Văn
Phòng, Văn Phòng Phẩm, Hợp Đồng (2 quy trình tách riêng: Phê Duyệt gốc và Quản
Lý HĐ/tài liệu ký), Hỗ Trợ IT (Phê Duyệt Giá bán lẻ theo phòng ban + bán buôn
theo 4 mức Margin/Chiết khấu cố định), Ngân Sách, và các luồng Vận Hành (Mở
Mới/Sửa Chữa Siêu Thị, Đặt Hàng theo mức giá trị đơn hàng).

Admin cấu hình tất cả các quy trình này tại **Hệ Thống → 🔄 Quy Trình & Phê
Duyệt** — mỗi module 1 màn riêng, mỗi bước duyệt của mỗi phòng ban/tier cấu
hình độc lập.

### 2.1. 3 cách gán người duyệt cho 1 bước

Mỗi bước duyệt (của mỗi phòng ban/tier) chọn đúng 1 trong 3 chế độ:

| Chế độ | Cách hoạt động | Ghi chú |
|---|---|---|
| **Theo người** (PEOPLE — mặc định) | Admin chọn tay 1 hoặc nhiều người cụ thể làm người duyệt bước đó | Không tự tái kiểm tra quyền "Người duyệt" tại thời điểm duyệt — người đã được thêm vẫn duyệt được kể cả nếu sau đó bị rút quyền (hành vi cũ, giữ nguyên) |
| **Theo phòng ban** | Toàn bộ người có quyền "Người duyệt" (xem 2.2) đang thuộc phòng ban cấu hình cho bước đó | Dùng cho các bước kiểu "ai trong phòng X có quyền duyệt cũng duyệt được" |
| **Theo vị trí** (POSITION — mới từ v10.5) | Bật toggle "🧭 Theo vị trí" ở bước đó, chọn 1 hoặc nhiều **vị trí** (cặp chức danh + phòng ban, xem 2.3) thay vì chọn tay người cụ thể | Hệ thống **tự tra động** người thật đang giữ đúng vị trí đó mỗi lần cần duyệt — luôn phản ánh đúng ai đang giữ chức vụ hiện tại, không cần admin sửa lại khi nhân sự đổi vị trí |

**Điểm bảo mật cốt lõi của chế độ Theo vị trí**: khớp đúng vị trí **chỉ là
điều kiện lọc bớt** — người đó vẫn phải có quyền "Người duyệt" (`canBeApprover`,
xem 2.2) mới thực sự duyệt được. Nếu **không** bật "Theo vị trí", bước đó vẫn
dùng chế độ Theo người/Theo phòng ban như trước — không có gì thay đổi, và vẫn
luôn cần quyền "Người duyệt" mới duyệt được (trừ chế độ Theo người, vốn không
tái kiểm tra quyền này như đã nêu ở bảng trên).

### 2.2. Quyền "Người duyệt" (`canBeApprover`)

Đây là 1 checkbox trong cây phân quyền của từng người dùng (khối "1. Hệ Thống
& Chung") — **điều kiện cần** để 1 người thực sự duyệt được hồ sơ (ở chế độ
Theo phòng ban/Theo vị trí — chế độ Theo người không tái kiểm tra, xem 2.1).
Một người có tên/vị trí đúng như cấu hình bước duyệt nhưng **chưa được cấp**
quyền này thì vẫn không duyệt được gì — đây là lỗi cấu hình thường gặp nhất:
"đã chọn đúng vị trí ở Quy Trình & Phê Duyệt nhưng người đó vẫn không thấy nút
Duyệt" → kiểm tra lại quyền "Người duyệt" của người đó trước.

### 2.3. Danh mục "Nhóm Quyền Đặc Biệt" (mục 17 cây phân quyền)

Tại **Hệ Thống → Quản Trị → Phân Quyền → khối 17 "Nhóm Quyền Đặc Biệt"** có 3
danh mục dùng ô "chọn nhiều thật" (gõ tìm, bấm chọn, chip xoá được ngay trong ô):

1. **Đơn vị tham gia quy trình** (`workflowParticipatingDepts`) — lọc bớt danh
   sách phòng ban hiển thị ở màn Quy Trình & Phê Duyệt (để trống = hiện đầy đủ
   mọi phòng ban như mặc định).
2. **Chức danh bị loại khỏi VPP** (`vppExcludedJobTitles`) — chức danh không
   được cấp Văn Phòng Phẩm (không tính vào đầu người/ngân sách VPP của phòng).
3. **🧭 Vị Trí Tham Gia Quy Trình** (`workflowParticipatingPositions`, mới từ
   v10.5) — danh mục các **cặp (chức danh, phòng ban)** admin tự dựng, vì chức
   danh trong hệ thống vốn generic (VD "Trưởng phòng" không tự phân biệt được
   "Trưởng phòng IT" với "Trưởng phòng Nhân Sự") — mỗi cặp là 1 "vị trí" độc
   lập, dùng làm nguồn chọn cho bước duyệt "Theo vị trí" (2.1). Có thể khai
   báo trước cả khi chưa có ai thực sự giữ đúng vị trí đó.

### 2.4. Hộp Thư Phê Duyệt (Approval Hub)

**Hệ Thống → ✅ Phê Duyệt** — hộp thư tổng hợp **1 nơi duy nhất** cho mọi hồ sơ
đang chờ đúng người dùng hiện tại duyệt, gom từ toàn bộ module có luồng phê
duyệt (không phải chuyển qua từng module để tìm hồ sơ cần xử lý). Từ v10.4 tự
làm mới định kỳ (polling nhẹ, không cần bấm F5, không dùng WebSocket) — hồ sơ
mới cần duyệt hiện lên gần như ngay lập tức. Nút Duyệt/Từ chối ở đây gọi thẳng
lại đúng hàm xử lý gốc của module đó — duyệt ở Hub và duyệt tại màn module gốc
là **hoàn toàn tương đương**, không có rủi ro lệch hành vi (email thông báo,
chuyển bước, tự tạo Công việc liên quan... vẫn chạy đầy đủ như duyệt tại module
gốc).

### 2.5. Ví dụ cấu hình cụ thể

**Yêu cầu**: "Trưởng phòng Pháp Chế duyệt bước 2 của quy trình Hợp Đồng."

1. Vào **Hệ Thống → Quản Trị → Phân Quyền → khối 17 → 🧭 Vị Trí Tham Gia Quy
   Trình** — gõ tìm "Trưởng phòng — Pháp Chế" (chức danh × phòng ban), nếu
   chưa có thì thêm chức danh "Trưởng phòng" (nếu phòng "Pháp Chế" và chức danh
   "Trưởng phòng" đã tồn tại trong danh mục chung), bấm chọn, bấm **Lưu**.
2. Vào **Hệ Thống → 🔄 Quy Trình & Phê Duyệt → Hợp đồng - Phê duyệt**, tìm
   đúng bước 2 của quy trình, bật toggle **"🧭 Theo vị trí"**, chọn vị trí vừa
   thêm ở bước 1, bấm **Lưu**.
3. Xác nhận người thật đang giữ chức danh "Trưởng phòng" tại phòng "Pháp Chế"
   đã được cấp quyền **"Người duyệt"** (`canBeApprover`, xem 2.2) ở form Sửa
   Người Dùng của họ — nếu chưa, họ sẽ khớp đúng vị trí nhưng vẫn không duyệt
   được (xem cảnh báo ở 2.2).
4. Kiểm tra lại: màn cấu hình bước duyệt sẽ hiện ngay bản xem trước "đã tra ra
   người thật" nếu đúng người đang giữ vị trí này có sẵn quyền Người duyệt.

**Bảng tra nhanh khi hồ sơ "không ai duyệt được"**: bước đang ở chế độ nào
(Theo người/Theo phòng ban/Theo vị trí) → nếu Theo vị trí: đã có ai thật sự
giữ đúng vị trí đó chưa (form Sửa Người Dùng có ô Chức danh + Phòng ban) → nếu
có người giữ vị trí: người đó đã có quyền "Người duyệt" chưa (2.2) → nếu Theo
phòng ban: có ai trong phòng đó có quyền "Người duyệt" chưa.

---

## 3. Danh sách module nghiệp vụ theo nhóm

Danh sách module thật (nguồn: `BUSINESS_MODULES` ở `public/js/core.js`) —
nhóm lại theo nghiệp vụ để dễ tra cứu, không phản ánh đúng thứ tự sidebar.

### 3.1. Văn Phòng Điện Tử

- **Tài Liệu** — quản lý văn bản nội bộ theo mã tự sinh + quản lý phiên bản
  (Cập nhật giữ mã, Nhập mới tạo mã khác); có luồng phê duyệt theo phòng ban.
- **Văn Bản Trình / Tờ Trình** — trình văn bản lên cấp trên duyệt; quy trình
  duyệt cấu hình **riêng theo từng loại tờ trình** (không chỉ theo phòng ban
  chung một khuôn) — admin tự thêm/bớt loại tờ trình ở màn Biểu Mẫu. Có bản
  xem trước quy trình duyệt ngay trước khi gửi.
- **Công Việc** — giao việc, theo dõi tiến độ; có thể tự sinh từ ý kiến chỉ
  đạo trong Văn Bản Trình (xác nhận thủ công, không tự động tạo âm thầm).
- **Biên Bản Họp** — lập biên bản, có thể chọn 1 lịch Đặt Phòng Họp có sẵn để
  tự điền thông tin cơ bản.

### 3.2. Truyền Thông & Nhân Sự Nội Bộ

- **Truyền Thông Nội Bộ** — 5 sub-tab dùng chung 1 collection bài đăng, phân
  biệt bằng loại: 📰 Nhịp Sống HCRC (tin tức công ty), 🎓 Đào Tạo (thông báo
  lớp học, liên kết LMS bên dưới), 💼 Tuyển Dụng (đăng tin + nhân viên giới
  thiệu ứng viên), 💬 Góc Chia Sẻ, 🤝 HCRC Đồng Hành (hỏi & đáp riêng tư 1-1
  với Nhân Sự — nhân viên gửi câu hỏi về chế độ/quy định, Nhân Sự trả lời,
  1 hỏi–1 đáp không trao đổi nhiều lượt). Bình luận/thả tim/ghi nhận đã xem mở
  cho mọi người; chỉ việc **đăng bài** mới cần quyền riêng theo từng loại.
  - **Đào Tạo (LMS)** — Lớp Học (tạo/danh sách/ghi kết quả) + Đăng Ký Của Tôi +
    Kho Tài Liệu + Lộ Trình Thăng Tiến (danh sách lớp bắt buộc, chỉ xác nhận
    hoàn thành khi đã Đạt hết) + Ngân Hàng Câu Hỏi. 2 mức quyền: quản lý toàn
    quyền (tạo lớp/tài liệu/bài test/lộ trình) và giảng viên (chỉ quản lý
    roster/kết quả đúng lớp được gán).
- **Nhân Sự** — module con **Cơ Cấu Tổ Chức** (sơ đồ tổ chức theo quản lý trực
  tiếp + Cấu Hình KPI Theo Vị Trí: cấp nào đánh giá cấp nào, không cấu hình
  tiêu chí) và tab **Quản Lý & Phản Hồi Ý Kiến** (phía Nhân Sự của "HCRC Đồng
  Hành" ở trên).

### 3.3. Tài Chính

- **Hợp Đồng** — 2 sub-tab: **Phê Duyệt** (tạo mới hồ sơ gốc HOẶC phụ lục, cả
  hai đều qua hàng chờ duyệt trừ khi người tạo có quyền tự duyệt) và **Quản Lý
  Hợp Đồng & Giấy Phép** (nhập tay hồ sơ đã có chữ ký thật ký ngoài hệ thống,
  tự động ở trạng thái đã duyệt ngay, không qua hàng chờ). Có thể khai Đợt
  Thanh Toán ngay khi tạo hồ sơ (liên kết sang module Thanh Toán).
- **Tổng Hợp** — module cha gồm 2 luồng Mua Sắm/Sửa Chữa văn phòng (mẫu
  BM-TS01) qua quy trình duyệt theo phòng ban, cộng 2 module con:
  - **Thanh Toán** — tổng hợp đề nghị thanh toán tự sinh từ Hợp Đồng/Mua
    Bán/Sửa Chữa/Đầu Tư (nút "Chuyển Sang Thanh Toán") hoặc tạo thủ công. Vòng
    đời: Chờ xử lý (sửa được) → [Cần bổ sung thông tin (sửa được)] → Đã duyệt
    (xác nhận từng đợt) → Đã thanh toán (khoá cứng, không sửa được nữa).
  - **Ngân Sách** — 3 sub-tab dùng chung 1 collection, tham số hoá theo loại
    bản ghi: **Ngân Sách Phê Duyệt** (bản kế hoạch, qua Trưởng phòng duyệt),
    **Ngân Sách Thực Hiện** (bản thực chi, KHÔNG qua bước duyệt — "Gửi" đi
    thẳng vào trạng thái đã duyệt, quản lý ngân sách vẫn xem/sửa/kiểm soát
    được), **Tổng Hợp** (so sánh Phê Duyệt vs Thực Hiện, phân theo 3 mức
    quyền: chỉ xem phòng mình / xem mọi phòng ban / xem thêm khối "Toàn Công
    Ty").

### 3.4. Hành Chính

- **Đăng Ký Xe** — đăng ký sử dụng xe công ty, qua quy trình duyệt theo phòng ban.
- **Đặt Phòng Họp** — tự chặn trùng lịch ngay từ lúc đăng ký (kiểm tra cả lịch
  đang chờ duyệt lẫn đã duyệt là đang "chiếm chỗ" cùng phòng/khung giờ giao
  nhau) — không để dồn nhiều yêu cầu trùng giờ về người phê duyệt rồi mới phát
  hiện xung đột.
- **Văn Phòng Phẩm (VPP)** — theo **kỳ đăng ký**: admin tạo kỳ + danh mục mặt
  hàng có đơn giá, mỗi phòng ban có **ngân sách phòng ban mặc định** = số nhân
  sự đang hoạt động của phòng × "ngân sách/người" (admin có thể sửa tay lại số
  nhân sự gợi ý này). Chức danh nằm trong danh mục "Chức danh bị loại khỏi
  VPP" (2.3) không được tính vào đầu người/không đăng ký được.
- **Đồng Phục** — 2 vai trò: Hành Chính tạo "kỳ cấp phát" phân bổ đồng phục
  xuống từng siêu thị, Giám Đốc Siêu Thị xác nhận đã nhận rồi cấp phát tiếp cho
  nhân viên. "Kho" không lưu bảng riêng — luôn tính động từ số đã phân bổ đã
  xác nhận trừ đi số đã cấp phát cho nhân viên.
- **Giấy Phép** — hồ sơ pháp lý (giấy phép kinh doanh, chứng chỉ...), phân
  quyền hoàn toàn riêng ngay trong module (tạo/duyệt/xem tách biệt), không đi
  qua quy trình duyệt theo phòng ban ở mục 2. Có theo dõi hiệu lực + nhắc hết
  hạn qua email.

### 3.5. Vận Hành

Module top-level mới, **3 luồng độc lập hoàn toàn** về dữ liệu (không chung gì
với "Tổng Hợp"):

- **Đơn Hàng** (Đặt Hàng Tại Siêu Thị / Đặt Hàng Tại HO) — duyệt theo **mức
  giá trị đơn hàng** (tier cố định), không theo phòng ban, 2 quy trình tách
  riêng hoàn toàn: **Đặt Hàng Tại Siêu Thị** 3 mức **≤ 10 triệu / > 10 triệu
  và ≤ 100 triệu / > 100 triệu** (đổi từ v11.0 theo yêu cầu người dùng — mốc
  đúng bằng rơi vào mức THẤP hơn, VD đúng 10.000.000đ tính là "≤ 10 triệu");
  **Đặt Hàng Tại HO** 2 mức **≤ 100 triệu / > 100 triệu** (đổi từ v11.1 —
  audit theo yêu cầu người dùng phát hiện HO đang dùng CÙNG 1 lớp lỗi quy ước
  biên giới vừa sửa ở STORE, nay đồng bộ cùng quy ước: mốc đúng bằng
  100.000.000đ rơi vào mức THẤP hơn "≤ 100 triệu", KHÔNG còn "< 100 triệu /
  ≥ 100 triệu" như trước — giá trị mốc 100 triệu KHÔNG đổi, chỉ đổi mốc đúng
  bằng thuộc mức nào). Mức tính từ `MAX(amount, "Tổng Giá Trị Thanh Toán
  (VNĐ)")` — số lớn hơn giữa tổng hạng mục hệ thống tự tính và số người dùng
  tự gõ/đọc từ PDF phiếu đặt hàng NCC, để field tự gõ không thể khai thấp hơn
  nhằm né bớt lớp duyệt (áp dụng chung cho cả STORE lẫn HO).
- **Mở Mới / Sửa Chữa Siêu Thị** — pipeline 4 giai đoạn **Dự toán → Thực hiện
  → Nghiệm thu → Báo cáo**: lập danh mục đầu tư dự toán (được duyệt mới mở
  khoá Thực hiện) → lập/theo dõi cây công việc thực hiện thực tế (độc lập,
  không tự đồng bộ theo danh mục dự toán) → nghiệm thu khi toàn bộ công việc
  đã xong (ngay hoặc sau N ngày) → báo cáo tổng kết. **Lưu ý**: 2 luồng này
  hiện KHÔNG còn qua bước phê duyệt nữa (đã dừng từ 1 đợt trước) — hồ sơ đi
  thẳng trạng thái đã duyệt ngay lúc tạo; màn cấu hình quy trình duyệt phòng
  ban cho 2 luồng này vẫn còn ở Hệ Thống → Quy Trình & Phê Duyệt nhưng không
  có đường xử lý nào thực sự tiêu thụ cấu hình đó nữa.
  - **Cây công việc Thực hiện/Nghiệm thu, cập nhật tiến độ (từ v10.7)**: mỗi
    công việc LÁ (không có việc con) có nút "🔄 Cập Nhật Tiến Độ" mirror ĐÚNG
    UX modal "Cập Nhật Tiến Độ" của module Công Việc công ty — khi đang "Đang
    thực hiện", dropdown có 2 lựa chọn: "Vẫn đang thực hiện" (chỉ ghi thêm 1
    dòng ghi chú tiến độ, BẮT BUỘC nhập ghi chú, KHÔNG đổi trạng thái — gọi
    được nhiều lần liên tiếp) hoặc "Hoàn thành — Nộp nghiệm thu" (đổi hẳn sang
    "Đang nghiệm thu"). Chỉ khi CHỦ ĐỘNG chọn vế sau trạng thái mới thực sự
    đổi — không còn bị ép chọn "hoàn thành" mỗi lần chỉ muốn ghi tiến độ.
  - **Công việc CÓ việc con** (đầu mục lớn) không bao giờ tự tay cập nhật/
    nghiệm thu được (server luôn từ chối) — trạng thái LUÔN tính lại và
    chuyển TỰ ĐỘNG theo con: khi tất cả con đã "hoàn thành" cha tự chuyển
    "Đang nghiệm thu", khi tất cả con đã "Đã nghiệm thu" cha tự chuyển "Đã
    nghiệm thu" — đúng nhiều cấp (cháu → con → cha → ông...). Dòng của đầu
    mục lớn hiện "Tự cập nhật theo việc con" khi còn con dở, và đổi thành
    "✅ Đã tự động hoàn thành (theo việc con)" ngay khi tự hoàn thành xong —
    hoàn toàn tự động, không có/không cần nút bấm tay nào cho đầu mục lớn.
  - **Nghiệm thu — "🔄 Bổ Sung" (từ v10.9)**: người nghiệm thu (toàn quyền
    hoặc đúng người được CHỈ ĐỊNH nghiệm thu việc đó) có 2 lựa chọn khi công
    việc lá đang "Đang nghiệm thu": "✅ Nghiệm Thu" (chốt xong, đổi trạng thái
    "Đã nghiệm thu") hoặc "🔄 Bổ Sung" (chỉ ghi lý do cần sửa/bổ sung, công
    việc GIỮ NGUYÊN "Đang nghiệm thu" — có thể bấm nhiều lần, không ép phải
    chốt Nghiệm Thu/Từ Chối ngay).
  - **"📜 Xem Lịch Sử" (từ v10.9)**: mỗi dòng công việc (cả Thực Hiện lẫn
    Nghiệm Thu, mọi cấp) có nút "📜" mở bảng lịch sử đầy đủ (hành động/người
    thực hiện/thời gian/ghi chú) — mirror bảng lịch sử của module Công Việc.
    **Sửa 1 lỗi thật phát hiện qua audit**: trước v10.9, mọi ghi chú "cập
    nhật tiến độ liên tục" (Thực Hiện) và lý do bắt buộc nhập lúc "🔄 Bổ Sung"/
    "✅ Nghiệm Thu" (Nghiệm Thu) được lưu vào hệ thống nhưng KHÔNG có màn nào
    hiển thị lại được — người phụ trách/người nghiệm thu gõ lý do xong là mất
    hẳn, không ai đọc lại được. Nút "📜" khắc phục đúng lỗ hổng này.
  - **Gỡ bỏ hẳn field "Chi Phí Phê Duyệt" (từ v11.2)**: form lập hồ sơ Mở Mới
    và Sửa Chữa trước đây có 2 field ngân sách song song dễ gây nhầm lẫn —
    "Chi Phí Phê Duyệt" (tuỳ chọn, không dùng cho tính toán gì) và "Ngân Sách
    Phê Duyệt — Danh Mục Đầu Tư" (bắt buộc, dùng để tính "Ngân sách còn lại"
    ở Danh mục đầu tư). Đã gỡ hẳn field "Chi Phí Phê Duyệt" khỏi cả 2 form —
    giờ chỉ còn đúng 1 field ngân sách DUY NHẤT ("Ngân Sách Phê Duyệt — Danh
    Mục Đầu Tư", vẫn bắt buộc nhập). Cột hiển thị tương ứng ở bảng danh sách
    Mở Mới/Sửa Chữa và modal xem chi tiết cũng đổi sang đọc field còn lại
    này. Hồ sơ CŨ đã lỡ lưu "Chi Phí Phê Duyệt" trước đợt này KHÔNG bị xoá dữ
    liệu (field cũ vẫn còn nguyên trong bản ghi, chỉ không còn nơi nào ghi/
    đọc/hiển thị nó nữa).

### 3.6. Hỗ Trợ IT

- **🏷️ Phê Duyệt Giá** — duyệt giá bán mặt hàng siêu thị: **Bán Lẻ** theo
  phòng ban (dùng chung engine quy trình phòng ban ở mục 2), **Bán Buôn**
  theo 4 mức Margin/Chiết khấu cố định (không theo phòng ban).
- **🎫 Hỗ Trợ Yêu Cầu** — ticket helpdesk IT nội bộ, mở cho toàn bộ nhân viên,
  vòng đời đơn giản Chưa xử lý → Đang xử lý → Hoàn thành/Đã huỷ, không qua
  duyệt.
- **Gia Hạn Dịch Vụ CNTT** — module con chỉ đội IT thấy được, quản lý nội bộ
  danh mục dịch vụ/hợp đồng CNTT của chính đội IT (tên miền, hosting, license
  phần mềm...), không qua bước duyệt nào, có nhắc hết hạn qua email cùng khuôn
  Giấy Phép.

### 3.7. Báo Cáo Định Kỳ

Nhân viên nộp báo cáo (thường theo tuần) → người có quyền tổng hợp chọn + sắp
thứ tự + merge các báo cáo con → sửa tự do → phát hành (trình chiếu toàn màn
hình hoặc xuất PDF). Có 2 hình thức nhập: nhập trực tiếp trên form, hoặc ghép
file PDF đã có sẵn. **Lưu ý phân biệt**: đây là 1 quy trình nghiệp vụ chủ động
(nhân viên chủ động nộp theo kỳ) — khác hẳn module **Báo Cáo** (mục 4), vốn chỉ
là màn tổng hợp/giám sát số liệu đọc từ các module khác, không có luồng nghiệp
vụ riêng của nó.

### 3.8. Hệ Thống / Quản Trị

Nhóm màn cấu hình dùng cho admin — không phải "module nghiệp vụ" theo nghĩa có
luồng tạo/duyệt hồ sơ riêng, nhưng là nơi cấu hình mọi module ở trên: 🔄 Quy
Trình & Phê Duyệt (mục 2), ✅ Phê Duyệt/Hộp Thư tổng hợp (2.4), 📊 Báo Cáo Quản
Trị (mục 4), Cấu Hình Email (mục 6), Phân Quyền (mục 7), Quản Lý Danh Mục
(phòng ban, chức danh, loại tờ trình, loại hợp đồng, loại giấy phép, siêu
thị...), API đối tác ngoài (mục 5).

---

## 4. Cấu hình Báo Cáo (Reports module)

Module **📊 Báo Cáo** (`reports`) là màn **tổng hợp/giám sát số liệu**, đọc dữ
liệu từ khoảng hơn 10 module nghiệp vụ khác — bản thân nó không tạo/lưu hồ sơ
riêng nào.

- **Thống kê chung theo module** — với 4 module có luồng phê duyệt nhiều bước
  (Tài Liệu/Văn Bản Trình/Xe/Văn Phòng): tổng số hồ sơ, phân theo trạng
  thái/phòng ban, và **thời gian xử lý trung bình** mỗi bước + mỗi hồ sơ hoàn
  tất (tính từ lịch sử xử lý của hồ sơ) — dùng để đánh giá quy trình duyệt có
  đang chậm ở bước nào.
- **Tra cứu chi tiết + chọn cột + xuất Excel** — bên dưới khối thống kê, mỗi
  module có 1 bảng lọc đa chiều theo **từng trường thực tế có trong dữ liệu**
  (tự suy ra từ chính bản ghi, không cần khai báo cứng danh sách trường cho
  từng module) — cho phép tự chọn cột muốn hiển thị/xuất, thứ tự cột giữ theo
  lựa chọn của người dùng, rồi xuất ra Excel. Trường lạ (không có nhãn tiếng
  Việt định sẵn) vẫn hiển thị được — tự tách theo chữ hoa thành nhãn đọc được
  thay vì làm hỏng cả bảng.
- **Tổng Hợp (dashboard toàn công ty)** — các thẻ tổng số liệu gộp toàn công
  ty, phân quyền xem theo module con (VD Ngân Sách: quyền `budgetAggregate`
  xem mọi phòng ban, `budgetManage` xem thêm khối "Toàn Công Ty").

Không cần cấu hình gì đặc biệt để dùng — mọi nhân viên có quyền vào module nào
thì tự thấy đúng phần báo cáo tương ứng của module đó khi có quyền xem báo cáo
(quyền riêng, không tự động theo quyền tạo hồ sơ).

---

## 5. API cho đối tác bên ngoài (ExtAuth)

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
có toàn quyền truy cập DB) — phải copy lại ngay và giao cho bên tích hợp, mất
thì phải thu hồi key cũ + tạo key mới. Mỗi key có thể khai báo thêm **danh sách
IP/CIDR được phép gọi** (`allowedIps`, tuỳ chọn) — để trống = không hạn chế IP,
key đúng gọi từ đâu cũng được; khai báo rồi thì request từ IP ngoài danh sách
bị chặn (403) dù key đúng.

Giới hạn số lần gọi: `EXTERNAL_AUTH_RATE_LIMIT_MAX` trong `.env` (mặc định
300 lần/15 phút/IP) — xem `Huong-dan-trien-khai.md` để chỉnh khi cần.

> Một tài liệu đặc tả API đầy đủ (định dạng request/response, mã lỗi...) đã
> được soạn riêng cho đối tác trong 1 phiên làm việc trước (dạng Artifact) —
> mục này chỉ tóm tắt góc nhìn cấu hình/quản trị, không lặp lại toàn bộ đặc tả
> API ở đây.

---

## 6. Cấu hình Email thông báo

### 6.1. Cấu Hình Email (SMTP) — bắt buộc trước để gửi email thật

**Hệ Thống → Quản Trị → Cấu Hình Email** — cấu hình **toàn bộ** trên web (Host/
Port/Kiểu mã hoá/Email người gửi/Bật-tắt/Tài khoản đăng nhập SMTP), không cần
sửa `.env` hay khởi động lại server cho các thay đổi này. Có 3 nút chọn nhanh
kiểu mã hoá (Không mã hoá/TLS/SSL, tự đổi Port sang giá trị chuẩn tương ứng
25/587/465) và nút "Gửi Thử" để xác minh cấu hình đúng trước khi Lưu. Mặc định
hệ thống chỉ **mô phỏng** gửi email (ghi Nhật ký hệ thống, không gửi thật) cho
tới khi nhập SMTP Server ở màn này.

### 6.2. 🔔 Thông Báo Email Phê Duyệt — bật/tắt riêng theo module + loại sự kiện

**Hệ Thống → Quản Trị → 🔔 Thông Báo Email Phê Duyệt** (từ v10.2) — cho phép
admin **tắt riêng** từng loại email liên quan phê duyệt theo từng module, mà
không đụng gì tới cấu hình SMTP ở 6.1. Lý do: nhiều người đã thấy hồ sơ chờ
duyệt qua Hộp Thư Phê Duyệt (2.4) nên email "Cần phê duyệt" thường trùng
lặp/gây spam, trong khi email "Kết quả duyệt" (gửi người trình, vốn không theo
dõi Hộp Thư) vẫn cần thiết — 2 nhóm sự kiện (family) tắt/bật **độc lập nhau**:

- **Cần phê duyệt** (`approvalNeeded`) — email gửi người duyệt khi có hồ sơ
  mới chờ xử lý. Mặc định **TẮT** cho module chưa từng cấu hình.
- **Kết quả duyệt** (`result`) — email gửi người trình khi hồ sơ được
  duyệt/từ chối. Mặc định **BẬT** (giữ hành vi gốc trước khi có tính năng
  này) cho module chưa từng cấu hình.

Module nào chưa có điểm gọi email tương ứng trong code (VD Giấy Phép hiện
không gửi email khi duyệt/từ chối) thì ô đó hiện disabled kèm ghi chú — tích
vào cũng không có tác dụng vì chưa có email nào để tắt.

**An toàn khi chưa cấu hình**: nếu admin chưa từng mở màn này để Lưu (CSDL
mới, hoặc phiên chưa từng chỉnh), hệ thống **fail-open** — coi như chưa có ý
định tắt gì, email vẫn gửi như hành vi gốc. Chỉ khi admin **đã lưu rõ ràng**
giá trị tắt cho đúng module/loại sự kiện đó thì email mới thực sự bị chặn —
email bị chặn vẫn ghi đầy đủ 1 dòng Nhật ký hệ thống như bình thường (chỉ khác
không tốn lượt gọi SMTP thật), tránh mất dấu vết sự kiện đã xảy ra.

---

## 7. Phân quyền (permission model)

**Hệ Thống → Quản Trị → Phân Quyền** — cây phân quyền chia thành các **khối**
đánh số, mỗi khối là 1 nhóm quyền gấp gọn được (có badge tóm tắt "đã cấp
X/Y" ngay trên tiêu đề):

```
0. Quyền Truy Cập Module        12. Văn Phòng Phẩm
1. Hệ Thống & Chung              13. Báo Cáo Định Kỳ
2. Tài Liệu                      14. Nhóm Phê Duyệt HĐ (Hợp Đồng)
3. Văn Bản Trình                 15. Hỗ Trợ IT
4. Hợp Đồng & Giấy Phép          16. Đồng Phục
5. Phòng Họp                     17. Nhóm Quyền Đặc Biệt (mục 2.3)
6. Đăng Ký Xe                    18. Ngân Sách
7. Văn Phòng (Mua/Sửa)           19. Đào Tạo
8. Truyền Thông Nội Bộ           20. Giấy Phép
9. Biên Bản Họp & Công Việc      21. Nhân Sự
10. Thanh Toán                   22. Vận Hành
11. Nhóm Phê Duyệt Trình (Văn Bản Trình)
```

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

**Cấp quyền cho 1 nhân viên mới** (quy trình thường dùng):

1. Tạo tài khoản ở **Hệ Thống → Quản Trị → Người Dùng** (điền phòng ban, chức
   danh — 2 trường này còn ảnh hưởng tới chế độ duyệt "Theo vị trí" ở mục 2.1).
2. Nếu công ty đã có sẵn 1 nhóm phân quyền phù hợp vai trò của họ → gán vào
   nhóm đó ngay (mục "Nhóm phân quyền" ở form Sửa Người Dùng) — đủ dùng cho đa
   số trường hợp, không cần tick tay.
3. Cần quyền đặc thù riêng ngoài nhóm (VD được thêm quyền "Người duyệt" — mục
   2.2, hoặc quyền quản lý 1 module cụ thể) → mở cây phân quyền cá nhân, tìm
   đúng khối tương ứng (bảng số ở trên), tick thêm.
4. Muốn người này **duyệt được** hồ sơ ở 1 bước cụ thể qua chế độ Theo phòng
   ban/Theo vị trí → nhớ tick quyền **"Người duyệt"** (khối 1) — bước dễ quên
   nhất, xem cảnh báo ở mục 2.2.
