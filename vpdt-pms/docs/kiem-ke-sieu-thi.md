# Đề xuất: Module "Kiểm Kê" cho Vận Hành

**Trạng thái: Chờ xác nhận phương án — tài liệu phân tích/đề xuất, CHƯA
triển khai code.**

Phạm vi: `Vận Hành → Kiểm Kê` (module mới, tách khỏi "Kiểm Soát Hàng Hóa"
đang có). Tài liệu chia 2 phần: **Phần A — Hướng Dẫn Sử Dụng** (cho nhân
viên/giám sát thao tác Gom Mã → Kiểm Đếm → Kiểm Soát → Báo Cáo) và **Phần
B — Hướng Dẫn Hệ Thống** (cho quản trị cấu hình phân quyền + kiến trúc lưu
trữ/online-offline).

Bản xem có hình minh hoạ (wireframe giao diện, biểu đồ màu):
https://claude.ai/artifact/7bwcVNmkG3MRBS73D1UnT2 — nội dung dưới đây là
bản văn bản đầy đủ, tự chứa (không cần mở link mới hiểu được).

---

## Phần A — Hướng Dẫn Sử Dụng

### A1. Bối cảnh & phân biệt với "Kiểm Soát Hàng Hóa"

Hệ thống hiện đã có **"Kiểm Soát Hàng Hóa"** (Vận Hành → 📦) — công cụ theo
dõi *liên tục*, mỗi lần quét là 1 lần ghi nhận riêng theo lô/hạn sử dụng,
dùng cho việc kiểm tra giá, hạn sử dụng, đối chiếu tồn hằng ngày.

**"Kiểm Kê"** là một nghiệp vụ khác: một **đợt kiểm đếm toàn bộ** theo chu
kỳ (tháng/quý), mục tiêu là ra được **1 con số tổng cuối cùng cho mỗi mã
hàng** tại 1 siêu thị, để so với Tồn Kho Hệ Thống và xử lý chênh lệch. Đây
là mô hình kiểm kê bán lẻ phổ biến (3 vòng: đếm nhanh → đếm chính thức →
soát lại các mã nghi vấn) — module này được thiết kế theo đúng mô hình đó.

### A2. Quy trình nghiệp vụ: 3 bước

```
📷 Gom Mã ─────┐
 (chọn quầy kệ  ├──► Tổng Hợp Kiểm Đếm ──► 🛡️ Kiểm Soát (ghi đè, chỉ mã đã soát) ──► 📊 Báo Cáo
  được phân quyền)   (SL theo Mã Hàng,          │
🔢 Kiểm Đếm ────┘      toàn siêu thị)            └──────────► 📊 Báo Cáo (mã chưa soát: giữ SL Kiểm Đếm)
 (theo từng quầy kệ)
```

Cả 3 bước đều bắt đầu bằng việc chọn 1 **Quầy Kệ** (trong số quầy kệ được
phân quyền cho đúng hành động đó) rồi mới quét mã.

| Bước | Hành động | Ý nghĩa |
|---|---|---|
| 1 | 📷 **Gom Mã** | Chọn Quầy Kệ (được phân quyền Gom Mã) → quét nhanh. Số liệu **chỉ để tham khảo**, không lên Báo Cáo cuối. |
| 2 | 🔢 **Kiểm Đếm** | Chọn Quầy Kệ (được phân quyền Kiểm Đếm) → quét/gõ mã → số lượng tự gộp. Đây là **số liệu chính thức**, trừ khi bị Kiểm Soát ghi đè. |
| 3 | 🛡️ **Kiểm Soát** | Chọn Quầy Kệ (được phân quyền Kiểm Soát) → chọn ra các mã cần kiểm tra kỹ, quét/nhập lại số — số này là **kết quả cuối cùng** cho đúng mã đó. |

### A3. Luồng quy trình đầy đủ: từ Gom Mã đến khi ra dữ liệu Báo Cáo

Toàn bộ hành trình 1 đợt kiểm kê, từ lúc mở đợt đến lúc có số liệu cuối
cùng — gộp cả 8 tab theo đúng trình tự thời gian thực tế sẽ diễn ra.

> ✅ **Xác nhận: 2 loại Kỳ, mỗi loại cho đúng 1 nhóm hành động.** Tab 1 "Kỳ
> Kiểm Kê" quản lý 2 **loại kỳ** độc lập, mỗi siêu thị có thể chạy cả 2
> cùng lúc (không bắt buộc chung 1 kỳ):
> - **Kỳ Gom Mã** — kích hoạt thì CHỈ cho phép thao tác Gom Mã. Thường mở
>   thường xuyên hơn (VD hàng tuần), phục vụ đối chiếu nhanh, không liên
>   quan đợt kiểm kê chính thức.
> - **Kỳ Thống Kê** — kích hoạt thì cho phép Kiểm Đếm + Kiểm Soát (+ Xác
>   Nhận đi kèm). Đây là đợt kiểm kê chính thức, ra số liệu lên Báo Cáo.
>
> Mỗi kỳ (dù loại nào) có **Báo Cáo riêng, độc lập** — không cộng gộp số
> liệu giữa 2 kỳ khác nhau, kể cả cùng loại hay khác loại.

| # | Bước | Chi tiết | Ai làm | Ở đâu | Trạng thái |
|---|---|---|---|---|---|
| 0 | **Tạo & Kích Hoạt Kỳ** (chọn đúng loại) | Quản lý siêu thị/Admin tạo 1 kỳ mới cho 1 siêu thị — chọn loại (Gom Mã hoặc Thống Kê), đặt tên + khoảng thời gian dự kiến (ban đầu: Nháp), rồi bấm "Kích Hoạt". Dù user đã có quyền ở Tab Cấu Hình Người Dùng, nếu siêu thị CHƯA có kỳ đúng loại đang hoạt động, tab tương ứng không cho chọn siêu thị đó. | Quản lý siêu thị/Admin | Tab Kỳ Kiểm Kê | Nháp → Đang hoạt động |
| 1 | **Gom Mã** (nhiều người song song) | Từng nhân viên được phân quyền Gom Mã chọn 1 quầy kệ, quét liên tục — số lượng tự gộp theo mã, mã vừa quét nhảy lên đầu danh sách. Có thể làm offline. Số liệu chỉ tham khảo, thuộc đúng Kỳ Gom Mã đang hoạt động. | Nhân viên được phân quyền Gom Mã | Tab Gom Mã | Cần Kỳ Gom Mã đang hoạt động |
| 2 | **Kiểm Đếm** (theo từng quầy kệ, song song) | Nhân viên được phân quyền Kiểm Đếm chọn quầy kệ, quét chính thức — cùng cơ chế gộp số lượng + mã mới lên đầu + ô tìm kiếm sửa tay. Có thể đối chiếu nhanh với số Gom Mã. | Nhân viên được phân quyền Kiểm Đếm | Tab Kiểm Đếm | Cần Kỳ Thống Kê đang hoạt động |
| 3 | **Xác Nhận Quầy Kệ** (khoá khi đếm xong) | Khi 1 quầy kệ đã đếm xong, người có quyền Kiểm Đếm quầy kệ đó bấm "Xác Nhận" → quầy kệ bị khoá ở Kiểm Đếm. Lặp Bước 2+3 cho từng quầy kệ còn lại. | Người có quyền Kiểm Đếm quầy kệ đó | Tab Xác Nhận | Khoá quầy kệ — ngừng quét Kiểm Đếm |
| 4 | **Kiểm Soát** (song song hoặc sau khi khoá) | Người có quyền Kiểm Soát quầy kệ đó xem lại danh sách mã đã Kiểm Đếm, chọn mã nghi vấn → quét/nhập lại số. Khoá ở Bước 3 KHÔNG chặn Kiểm Soát — vẫn soát lại được, miễn Kỳ Thống Kê còn Đang hoạt động. | Người có quyền Kiểm Soát quầy kệ đó | Tab Kiểm Soát | Ghi đè — chỉ đúng mã đã soát |
| 5 | **Xác Nhận Toàn Bộ Đợt → Đóng Kỳ Thống Kê** | Khi TẤT CẢ quầy kệ đã Xác Nhận, Quản lý siêu thị bấm "Xác Nhận Toàn Bộ Đợt Kiểm Kê" → Kỳ Thống Kê chuyển Đang hoạt động → **Đã chốt**. Kỳ đã chốt là **khoá tuyệt đối** — không ai thực hiện được bất kỳ thao tác nào nữa. Chỉ Admin có nút "↩️ Mở Lại Kỳ" để đưa kỳ về Đang hoạt động khi cần sửa. | Quản lý siêu thị (chốt) / Admin (mở lại) | Tab Xác Nhận · Tab Kỳ Kiểm Kê | Đã chốt = khoá tuyệt đối, Admin mở lại được |
| 6 | **Báo Cáo** — ra dữ liệu cuối cùng, theo đúng 1 kỳ | Vào Tab Báo Cáo, việc đầu tiên là chọn Kỳ ở bộ chọn "📅 Kỳ" đầu màn (liệt kê mọi kỳ Gom Mã/Thống Kê của siêu thị, kể cả đã chốt). Hệ thống tổng hợp theo mã hàng CHO ĐÚNG KỲ ĐÃ CHỌN: SL cuối cùng = SL Kiểm Soát (nếu có), ngược lại = SL Kiểm Đếm; so Tồn Kho Hệ Thống để tính chênh lệch. Đổi kỳ thì cả bảng và biểu đồ load lại theo kỳ đó. | Quản lý/người có quyền xem báo cáo | Tab Báo Cáo | Mỗi kỳ 1 báo cáo độc lập |

> ✅ **Xác nhận: xuất Excel — mỗi siêu thị 1 sheet riêng.** Khi người xuất
> chỉ có quyền đúng 1 siêu thị, file ra 1 sheet như bình thường. Khi người
> xuất (Admin/Giám Sát Vùng) có quyền nhiều siêu thị, file Excel xuất ra
> **nhiều sheet trong cùng 1 file**, mỗi sheet đặt tên theo đúng siêu thị,
> không trộn dữ liệu các siêu thị vào 1 bảng.
>
> | Sheet | Mã Vạch | Mã Hàng | Tên Mặt Hàng | Quầy Kệ | Số Lượng |
> |---|---|---|---|---|---|
> | **Siêu thị Quận 1** | 8935049...607 | SP001 | G7 Cà Phê 3in1 | Kệ A1 — Gia vị | 48 |
> | **Siêu thị Quận 1** | 8935024...310 | SP002 | Mì Hảo Hảo tôm chua cay | Kệ A2 — Mì, cháo | 108 |
> | Siêu thị Quận 2 | 8935024...096 | SP002 | Mì Hảo Hảo tôm chua cay | Kệ B1 — Sữa, nước | 35 |
>
> Mỗi dòng là 1 mã hàng tại 1 quầy kệ. Ngoài 5 cột yêu cầu (Mã Vạch, Mã
> Hàng, Tên Mặt Hàng, Quầy Kệ, Số Lượng — ở đây "Số Lượng" là SL Cuối
> Cùng, ưu tiên Kiểm Soát nếu có), giữ thêm: SL Gom Mã (tham khảo), SL
> Kiểm Đếm, SL Kiểm Soát, Tồn Kho Hệ Thống, Chênh Lệch. Kỹ thuật: tái dùng
> route xuất Excel dùng chung sẵn có trong hệ thống (hỗ trợ nhiều sheet
> trong 1 lần gọi), không cần xây route mới.

### A4. Cấu trúc 8 tab trong "📋 Kiểm Kê"

> Bổ sung so với yêu cầu gốc: ban đầu liệt kê 7 tab, nhưng thiếu 1 tab bắt
> buộc để module hoạt động được — **📅 Kỳ Kiểm Kê** (Tab 1). Không có tab
> này thì không có gì để Gom Mã/Kiểm Đếm/Kiểm Soát "thuộc vào", nên tổng
> số tab đúng là **8**.

| Tab | Tên | Mô tả | Ai dùng |
|---|---|---|---|
| 1 · MỚI | 📅 **Kỳ Kiểm Kê** | Tạo kỳ mới cho 1 siêu thị theo 2 loại — Kỳ Gom Mã (chỉ cho Gom Mã) hoặc Kỳ Thống Kê (cho Kiểm Đếm + Kiểm Soát) — rồi Kích Hoạt. Đóng kỳ = khoá tuyệt đối; Admin có thể Mở Lại. | Quản trị / Quản lý siêu thị |
| 2 | 📷 **Gom Mã** | Chọn quầy kệ (theo phân quyền) → quét, gộp số lượng theo mã, tham khảo. | Theo quyền từng quầy kệ/user |
| 3 | 🔢 **Kiểm Đếm** | Chọn quầy kệ (theo phân quyền) → quét → số liệu chính thức của đợt kiểm kê. | Theo quyền từng quầy kệ/user |
| 4 | 🛡️ **Kiểm Soát** | Chọn quầy kệ (theo phân quyền) → soát lại các mã nghi vấn, kết quả ghi đè Kiểm Đếm cho đúng mã đó. | Theo quyền từng quầy kệ/user |
| 5 | 🗄️ **Cấu Hình Quầy Kệ** | Khai báo/nhập Excel danh sách quầy kệ cho từng siêu thị (phục vụ Kiểm Đếm chọn quầy kệ). | Quản trị / Quản lý siêu thị |
| 6 | ✅ **Xác Nhận** | Xác nhận từng quầy kệ đã đếm xong (khoá quầy kệ) + xác nhận toàn đợt kiểm kê (tự chốt Kỳ Kiểm Kê). | Quản lý siêu thị |
| 7 | 📊 **Báo Cáo** | Đầu màn có bộ chọn "📅 Kỳ" (liệt kê mọi kỳ Gom Mã/Thống Kê, kể cả đã chốt) — chọn đúng 1 kỳ để xem, mỗi kỳ ra báo cáo + biểu đồ độc lập. Tổng hợp theo mã hàng + 3 biểu đồ (xem A7). Xuất Excel — nhiều siêu thị thì mỗi siêu thị 1 sheet. | Theo quyền xem báo cáo |
| 8 | 🔑 **Cấu Hình Người Dùng** | Gán cho từng user: được vào siêu thị/quầy kệ nào, được làm Gom Mã / Kiểm Đếm / Kiểm Soát. Không có dòng cấu hình = không vào được. | Quản trị hệ thống |

### A5. Luồng quét & gộp số lượng (Gom Mã / Kiểm Đếm / Kiểm Soát)

> ✅ **Xác nhận: bắt buộc chọn Quầy Kệ trước, mọi lần quét sau đó tự vào
> đúng quầy kệ đã chọn.** Áp dụng CHO CẢ 3 hành động Gom Mã, Kiểm Đếm,
> Kiểm Soát, không riêng gì Kiểm Đếm:
> 1. **Bắt buộc chọn Quầy Kệ trước** mới cho quét/gõ mã — không chọn
>    quầy kệ thì ô quét bị khoá/ẩn, không quét được.
> 2. Sau khi chọn, **mọi lần quét tiếp theo tự động ghi nhận vào đúng
>    quầy kệ đang chọn** — người quét không phải gõ lại quầy kệ cho từng
>    mã, chỉ đổi quầy kệ khi chuyển sang khu vực khác.
> 3. Bộ chọn "📍 Quầy Kệ" **chỉ hiện đúng những quầy kệ mà user đó được
>    phân quyền** cho hành động đang thao tác (Gom Mã/Kiểm Đếm/Kiểm Soát
>    riêng từng quyền — xem Tab 8 ở mục B1) — quầy kệ chưa được cấp quyền
>    sẽ không hiện ra để chọn.

**Quy tắc gộp:**
- Quét/gõ mã đã có trong phiên → **cộng dồn** số lượng vào dòng đó (không
  tạo dòng mới).
- Mã vừa quét **luôn nhảy lên đầu danh sách** (sắp xếp theo lần quét gần
  nhất — MRU), giúp xác nhận ngay số lượng vừa cộng.
- Tra mã dùng lại nguyên cơ chế đang có: khớp theo Mã Vạch chính + toàn bộ
  `dsMaVach` (mã vạch phụ) + khớp 6 số cuối — không cần xây lại.

**Thanh tìm kiếm:**
- Ô tìm kiếm cố định phía trên danh sách — gõ mã/tên để nhảy nhanh tới
  dòng cần sửa.
- Từ dòng tìm được: sửa tay số lượng (tăng/giảm/gõ số), hoặc xoá dòng nếu
  quét nhầm.
- Sửa tay không đẩy dòng đó lên đầu (chỉ quét mới mới tính là "gần nhất").

### A6. Quy tắc Kiểm Soát ghi đè

Kiểm Soát **chỉ thay thế đúng mã đã được soát**; mọi mã khác giữ nguyên số
Kiểm Đếm. Ví dụ với 4 mã sau, chỉ SP002 bị soát lại:

| Mã hàng | SL Kiểm Đếm | SL Kiểm Soát | SL Cuối Cùng (lên Báo Cáo) |
|---|---|---|---|
| SP001 — G7 Cà Phê 3in1 | 48 | chưa soát | **48** (Kiểm Đếm) |
| SP002 — Mì Hảo Hảo tôm chua cay | 120 | 108 | **108** (Kiểm Soát) |
| SP003 — Sữa tươi Vinamilk 1L | 76 | chưa soát | **76** (Kiểm Đếm) |
| SP004 — Nước giặt Omo 3.7kg | 22 | chưa soát | **22** (Kiểm Đếm) |

### A7. Biểu đồ trong Báo Cáo (Tab 7)

> ✅ **Xác nhận:** Báo Cáo (cả bảng số liệu và cả 3 biểu đồ dưới đây) luôn
> đi theo đúng **Kỳ đang chọn** ở bộ chọn "📅 Kỳ" đầu màn Tab 7 — đổi kỳ
> thì toàn bộ bảng + biểu đồ load lại theo đúng kỳ đó, không hiện số liệu
> gộp nhiều kỳ.

Tab 7 Báo Cáo có thêm 3 biểu đồ, giữ đúng quy ước màu xuyên suốt — **Tồn
Kho Hệ Thống** luôn là xanh dương, **Gom Mã** luôn là cam, **Kiểm
Đếm/Cuối Cùng** luôn là xanh ngọc — để nhìn biểu đồ nào cũng hiểu ngay màu
nào là gì, không bị đổi nghĩa giữa các biểu đồ. Bảng màu dùng theo chuẩn
thiết kế biểu đồ đã kiểm chứng an toàn cho người mù màu (CVD-safe) đang áp
dụng cho toàn hệ thống.

**1. So sánh Tồn Kho Hệ Thống vs Thực Tế (Gom Mã & Kiểm Đếm), theo mã
hàng** — biểu đồ cột nhóm, ví dụ minh hoạ:

| Mã hàng | Tồn Kho Hệ Thống | Gom Mã (tham khảo) | Kiểm Đếm / Cuối Cùng |
|---|---|---|---|
| SP001 — G7 Cà Phê 3in1 | 50 | 46 | 48 |
| SP002 — Mì Hảo Hảo tôm chua cay | 108 | 118 | 108 |
| SP003 — Sữa tươi Vinamilk 1L | 76 | 70 | 76 |
| SP004 — Nước giặt Omo 3.7kg | 24 | 20 | 22 |

SP001/SP004 thực tế thấp hơn hệ thống (lệch -2); SP002 Gom Mã cao hơn hẳn
số chính thức (118 vs 108) — dấu hiệu đếm trùng lúc Gom Mã, Kiểm Đếm đã
sửa đúng lại.

**2. Tiến độ Kiểm Đếm theo Mã Hàng** (biểu đồ donut, theo siêu thị) — ví
dụ Siêu thị Quận 1: trên tổng 230 mã hàng có trong Tồn Kho Hệ Thống, **186
mã đã kiểm đếm (81%)**, còn **44 mã chưa kiểm đếm**.

**3. So sánh tổng số lượng giữa các siêu thị** (biểu đồ cột, Tồn Kho Hệ
Thống vs Kiểm Đếm/Cuối Cùng) — ví dụ minh hoạ:

| Siêu thị | Tổng SL Tồn Kho Hệ Thống | Tổng SL Kiểm Đếm / Cuối Cùng |
|---|---|---|
| Siêu thị Quận 1 | 1.240 | 1.198 |
| Siêu thị Quận 2 | 860 | 845 |
| Siêu thị Quận 3 | 610 | 605 |

Lưu ý minh hoạ: khi lên code thật, mỗi biểu đồ sẽ có tooltip khi rê
chuột/chạm vào từng cột, bộ lọc theo Kỳ/siêu thị ở trên biểu đồ, và nút
"Xem dạng bảng" đi kèm.

---

## Phần B — Hướng Dẫn Hệ Thống

### B1. Mô hình phân quyền (chi tiết Tab 8 + khối quyền riêng)

> ✅ **Xác nhận: "📋 Kiểm Kê" có khối quyền riêng, tách khỏi khối Vận
> Hành.** Theo yêu cầu: quyền của Kiểm Kê **không nằm chung/lẫn vào trong
> khối quyền "Vận Hành"** đang có (nơi đang chứa quyền của Kiểm Soát Hàng
> Hóa, Giá Bán Buôn/Lẻ...). Ở màn Nhân Sự → Phân Quyền → Cây Phân Quyền,
> "📋 Kiểm Kê" là **1 khối lớn riêng, ngang hàng** với khối Vận
> Hành/Nhân Sự/Mua Hàng — để admin tìm và gán quyền cho dễ. Khối này có
> đúng **8 quyền, theo thứ tự Tab 1 → Tab 8**:
>
> | # | Khoá quyền (perm key) | Nhãn trên Cây Phân Quyền / Ma Trận |
> |---|---|---|
> | Tab 1 | `stocktakePeriodTab` | Kiểm Kê — Quản lý Kỳ Kiểm Kê (tạo/kích hoạt/đóng/mở lại) |
> | Tab 2 | `stocktakeGomMaTab` | Kiểm Kê — Gom Mã |
> | Tab 3 | `stocktakeKiemDemTab` | Kiểm Kê — Kiểm Đếm |
> | Tab 4 | `stocktakeKiemSoatTab` | Kiểm Kê — Kiểm Soát |
> | Tab 5 | `stocktakeShelfConfigTab` | Kiểm Kê — Cấu Hình Quầy Kệ |
> | Tab 6 | `stocktakeConfirmTab` | Kiểm Kê — Xác Nhận |
> | Tab 7 | `stocktakeReportTab` | Kiểm Kê — Báo Cáo |
> | Tab 8 | `stocktakeUserAccessTab` | Kiểm Kê — Cấu Hình Người Dùng |
>
> Đây là lớp **"được thấy/dùng tab nào"** (gán qua Cây Phân Quyền/Ma Trận
> chuẩn của hệ thống, giống mọi module khác) — tách biệt với lớp **"được
> thao tác đúng siêu thị/quầy kệ nào"** ở Tab 8 Cấu Hình Người Dùng bên
> dưới. Có `stocktakeGomMaTab` mới thấy menu Tab 2, nhưng vào rồi vẫn cần
> dòng cấu hình ở Tab 8 mới chọn được quầy kệ cụ thể để quét.

> ⚠️ **3 lớp kiểm tra độc lập, phải qua đủ cả 3 mới thao tác được (với Gom
> Mã/Kiểm Đếm/Kiểm Soát):**
> 1. **Quyền tab** ở khối "📋 Kiểm Kê" trên Cây Phân Quyền — user có quyền
>    `stocktake...Tab` tương ứng không.
> 2. **Tab 8 Cấu Hình Người Dùng** — user đó có được cấp quyền Gom
>    Mã/Kiểm Đếm/Kiểm Soát ở đúng siêu thị + quầy kệ này không.
> 3. **Tab 1 Kỳ Kiểm Kê** — siêu thị đó có đang trong 1 kỳ **đúng loại**
>    (Gom Mã cần Kỳ Gom Mã; Kiểm Đếm/Kiểm Soát cần Kỳ Thống Kê) ở trạng
>    thái **Đang hoạt động** không.
>
> Thiếu 1 trong 3 là không thao tác được. 5 tab còn lại (Kỳ Kiểm Kê, Cấu
> Hình Quầy Kệ, Xác Nhận, Báo Cáo, Cấu Hình Người Dùng) chỉ cần qua lớp
> (1) — không có khái niệm "theo quầy kệ" cho các tab quản trị này.

> ✅ **Xác nhận: đóng kỳ = khoá tuyệt đối, Admin mở lại được.** Kỳ ở trạng
> thái Đã chốt khoá hoàn toàn — không ai (kể cả người có đủ quyền ở Tab 8)
> thực hiện được bất kỳ thao tác nào thuộc kỳ đó (quét, sửa số, xác
> nhận...). Chỉ **Admin** có nút "↩️ Mở Lại Kỳ" ở Tab 1, đưa kỳ về Đang
> hoạt động để cho phép cập nhật/sửa lại thông tin khi cần (VD phát hiện
> sai sót sau khi đã chốt) — sau đó phải chốt lại thủ công như bình
> thường.

Phân quyền đi xuống tới mức **Quầy Kệ**, không chỉ mức Siêu Thị: mỗi dòng
cấu hình là **Siêu Thị + Quầy Kệ cụ thể** + 1-3 **hành động** được phép
(Gom Mã / Kiểm Đếm / Kiểm Soát) trên đúng quầy kệ đó.

Nếu user KHÔNG có bất kỳ dòng cấu hình nào cho 1 quầy kệ → quầy kệ đó
**không hiện trong bộ chọn "📍 Quầy Kệ"**, và nếu không có quầy kệ nào
thuộc 1 siêu thị thì siêu thị đó cũng không hiện — đúng nguyên tắc "không
cấu hình = không truy cập".

> ⚠️ **KHÔNG có cờ "siêu thị bất kỳ"/"tất cả" nào bỏ qua bước cấu hình** —
> kể cả Admin/Giám Sát Vùng. Đây là allowlist tuyệt đối: muốn 1 user vào
> được 1 siêu thị, siêu thị đó bắt buộc phải có ít nhất 1 dòng cấu hình rõ
> ràng cho đúng user đó (khác hẳn cờ "🔑 Được Chọn Siêu Thị Bất Kỳ" đang
> dùng ở Kiểm Soát Hàng Hóa — Kiểm Kê **không** tái dùng cơ chế đó). Cần
> vào nhiều siêu thị/quầy kệ thì phải có nhiều dòng cấu hình tương ứng,
> không có phím tắt nào bỏ qua.

Ví dụ minh hoạ:

| User | Siêu thị | Quầy kệ | Gom Mã | Kiểm Đếm | Kiểm Soát |
|---|---|---|---|---|---|
| Nguyễn Văn A (NV quầy) | Quận 1 | Kệ A1 — Gia vị | ✓ | ✓ | — |
| Nguyễn Văn A (NV quầy) | Quận 1 | Kệ A2 — Mì, cháo | ✓ | ✓ | — |
| Trần Thị B (Giám sát) | Quận 1 | Kệ A1 — Gia vị | ✓ | ✓ | ✓ |
| Trần Thị B (Giám sát) | Quận 1 | Kệ A2 — Mì, cháo | ✓ | ✓ | ✓ |
| Trần Thị B (Giám sát) | Quận 1 | Kệ B1 — Sữa, nước | ✓ | ✓ | ✓ |
| Trần Thị B (Giám sát) | Quận 2 | Kệ B1 — Sữa, nước | — | — | ✓ |
| … Admin/Giám Sát Vùng cần vào bao nhiêu siêu thị/quầy kệ thì có đúng bấy nhiêu dòng tương ứng — không có dòng "tất cả" gộp chung | | | | | |

Để đỡ phải tick tay từng dòng, màn Tab 8 vẫn có thể cho **chọn nhiều quầy
kệ cùng lúc rồi lưu 1 lần** — nhưng đây chỉ là tiện ích nhập liệu: hệ
thống vẫn lưu lại từng dòng tường minh, không lưu 1 cờ "tất cả" nào. Nếu
sau này thêm siêu thị/quầy kệ mới, user KHÔNG tự động có quyền ở đó — phải
cấu hình lại.

### B2. Kiến trúc Online / Offline

> ✅ **Xác nhận: offline vẫn quét được, tự đồng bộ khi có mạng lại.** Mất
> mạng **không chặn việc quét**. Cụ thể từng bước:
> 1. **Quét khi offline**: app tra cứu mã bằng cache Tồn Kho Hệ Thống đã
>    tải sẵn trên máy (từ lần đồng bộ gần nhất khi còn mạng) — không cần
>    gọi server, vẫn ra đúng tên hàng/mã vạch để gộp số lượng bình thường.
> 2. **Ghi nhận offline**: mỗi lần quét lưu ngay vào hàng đợi IndexedDB
>    trên máy (không phải biến tạm), dòng đó hiện ngay trên màn hình kèm
>    nhãn "⏳ chưa đồng bộ".
> 3. **Tự đồng bộ khi có mạng lại**: app tự phát hiện có mạng (không cần
>    người dùng bấm nút gì), tự đẩy toàn bộ bản ghi đang chờ lên server
>    theo đúng thứ tự, gỡ nhãn "chưa đồng bộ" khi server xác nhận đã nhận.
>
> Khi đang **online**, bỏ qua bước xếp hàng đợi — ghi thẳng lên server
> ngay mỗi lần quét, để các máy khác thấy số liệu mới nhất ngay lập tức.

Tái dùng **nguyên cơ chế offline-first đã chạy ổn định** ở "Ghi Nhận"
(Kiểm Soát Hàng Hóa): hàng đợi IndexedDB trên máy, tự đồng bộ lên server
khi có mạng lại, banner hiển thị số bản ghi đang chờ. Mã hàng để tra cứu
khi quét lấy từ cache Tồn Kho Hệ Thống đã đồng bộ sẵn trong app (không cần
nguồn dữ liệu mới).

```
📱 Quét mã ──ONLINE──► ☁️ Ghi thẳng Server (cập nhật ngay, mọi máy thấy)
📱 Quét mã ──OFFLINE─► 💾 Hàng đợi IndexedDB (tra mã bằng cache đã tải sẵn)
                              │ có mạng lại
                              ▼
                        🔄 Tự đồng bộ lên Server
```

**Thoát app khi đang offline — dữ liệu có mất không? Không mất.** Dữ liệu
chờ đồng bộ lưu vào **IndexedDB** — bộ nhớ trên đĩa của thiết bị, không
phải biến tạm trong RAM. Thoát app, tắt màn hình, mất mạng giữa chừng, bị
gọi điện ngắt ngang... đều không xoá dữ liệu này; mở lại app sau đó (dù đã
thoát hẳn) sẽ thấy đủ các bản ghi đang chờ và tự đồng bộ tiếp khi có
mạng, không cần làm gì thêm.

Dữ liệu chỉ mất nếu người dùng **chủ động xoá dữ liệu trình duyệt/app hoặc
gỡ cài đặt** trước khi bản ghi đó kịp đồng bộ — rủi ro cố hữu của mọi app
offline-first, giống đúng "Ghi Nhận" đang chạy thật hiện nay. Để giảm rủi
ro: (1) hiện rõ banner "còn N bản ghi chưa đồng bộ — đừng xoá dữ liệu/gỡ
app lúc này" trên mọi tab Kiểm Kê, giống Ghi Nhận; (2) xin quyền lưu trữ
bền trên thiết bị (nếu trình duyệt hỗ trợ) để giảm khả năng hệ điều hành
tự xoá khi thiếu dung lượng.

**Xung đột khi nhiều máy offline cùng quét trùng mã/quầy kệ:** vì bản
chất Kiểm Đếm là **cộng dồn** (mỗi lần quét = +1 hoặc +số lượng nhập), đề
xuất khi đồng bộ các lần quét từ nhiều máy offline đều được **cộng dồn
vào nhau** theo đúng tinh thần "quét trùng mã thì gộp số lượng" — không
ghi đè lẫn nhau. *(Câu hỏi mở #3 — xem mục cuối tài liệu.)*

### B3. Mô hình dữ liệu đề xuất

| Collection | Mô tả |
|---|---|
| `stocktakeSessions` | Chính là **Kỳ Kiểm Kê** (Tab 1): siêu thị, **loaiKy** (`GOM_MA` \| `THONG_KE`), khoảng thời gian, trạng thái **Nháp / Đang hoạt động / Đã chốt** (Đã chốt vẫn đưa về Đang hoạt động được qua "Mở Lại Kỳ" — không phải trạng thái cuối cùng cố định). Gom Mã chỉ hoạt động khi có kỳ `GOM_MA` Đang hoạt động cho đúng siêu thị; Kiểm Đếm/Kiểm Soát chỉ hoạt động khi có kỳ `THONG_KE` Đang hoạt động. Báo Cáo luôn gắn với đúng 1 `stocktakeSessions`, không gộp giữa các kỳ. |
| `stocktakeCounts` | 1 dòng / mã hàng / quầy kệ, gắn với đúng 1 `stocktakeSessions` (1 kỳ): slGomMa, slKiemDem, slKiemSoat, lastScannedAt, nguoiQuét. |
| `stocktakeShelfLocations` | Danh mục quầy kệ dùng cho Kiểm Kê — nhập từ Excel theo siêu thị (Tab 5). |
| `stocktakeUserAccess` | Phân quyền Tab 8: user × siêu thị × quầy kệ × {gomMa, kiemDem, kiemSoat}. |

Mã hàng/Mã vạch **không lưu trùng lặp** — chỉ tham chiếu `maHang`, dữ liệu
tên/tồn kho hệ thống lấy từ cache đồng bộ đối tác đã có sẵn.

---

## Câu hỏi cần xác nhận trước khi code

### Đã xác nhận (✓)

1. Cả 3 hành động Gom Mã / Kiểm Đếm / Kiểm Soát đều phân quyền và chọn
   theo **Quầy Kệ** (không chỉ theo Siêu Thị).
2. Thêm Tab 1 "📅 Kỳ Kiểm Kê" (module từ 7 lên **8 tab**) — phải Tạo +
   Kích Hoạt 1 kỳ cho siêu thị thì các tab Gom Mã/Kiểm Đếm/Kiểm Soát/Xác
   Nhận mới cho user vào thao tác, kể cả khi đã có quyền ở Tab 8.
3. KHÔNG có cờ "siêu thị bất kỳ"/"tất cả" nào ở Tab 8 — Kiểm Kê là
   allowlist tuyệt đối, mọi siêu thị/quầy kệ muốn vào đều phải có dòng
   cấu hình rõ ràng, kể cả Admin/Giám Sát Vùng.
4. 1 siêu thị có thể chạy tối đa **1 Kỳ Gom Mã + 1 Kỳ Thống Kê** đang
   hoạt động cùng lúc (2 loại độc lập) — không trộn vào 1 kỳ chung. Mỗi
   kỳ có Báo Cáo riêng.
5. Tab 7 Báo Cáo bắt buộc có bộ chọn "📅 Kỳ" ở đầu màn — xem báo cáo/biểu
   đồ của đúng 1 kỳ tại 1 thời điểm, đổi kỳ là đổi toàn bộ dữ liệu hiển
   thị, không gộp nhiều kỳ.
6. Thêm 3 biểu đồ vào Tab 7 Báo Cáo (xem A7) — màu giữ cố định theo ý
   nghĩa xuyên suốt theo chuẩn thiết kế biểu đồ của hệ thống.
7. Kỳ **Đã chốt** là khoá tuyệt đối — không ai thực hiện được bất kỳ thao
   tác nào trên kỳ đó, kể cả người có đủ quyền. Chỉ **Admin** có nút "↩️
   Mở Lại Kỳ" để đưa kỳ về Đang hoạt động khi cần sửa/cập nhật lại thông
   tin.
8. Bắt buộc **chọn Quầy Kệ trước** mới quét được, áp dụng cho cả Gom
   Mã/Kiểm Đếm/Kiểm Soát — sau khi chọn, mọi lần quét tự động ghi vào
   đúng quầy kệ đang chọn. Bộ chọn quầy kệ chỉ hiện đúng quầy kệ user
   được phân quyền cho hành động đó (xem A5).
9. "📋 Kiểm Kê" có **khối quyền riêng** trên Cây Phân Quyền (không lẫn
   vào khối Vận Hành), gồm đúng **8 quyền theo Tab 1 → Tab 8**
   (`stocktakePeriodTab` … `stocktakeUserAccessTab`, xem bảng ở mục B1).
   Đây là lớp "được thấy/dùng tab nào", tách biệt với lớp "theo siêu
   thị/quầy kệ" ở Tab 8 Cấu Hình Người Dùng.

### Còn mở (cần bạn trả lời)

- **#1 — Danh mục Quầy Kệ ở Tab 5**: tạo mới riêng cho Kiểm Kê, hay dùng
  chung với danh mục "🗄️ Quầy Kệ" đã có ở Kiểm Soát Hàng Hóa? *Đề xuất:
  dùng chung danh mục đã có, chỉ thêm import Excel nếu chưa có.*
- **#2 — Tab 6 "Xác Nhận"**: 1 tab với 2 chức năng (xác nhận quầy kệ +
  xác nhận toàn đợt), hay tách thành 2 tab riêng (tổng 9 tab)? Và ai được
  bấm "Xác nhận" 1 quầy kệ — cùng danh sách được Kiểm Đếm quầy kệ đó, hay
  cần 1 quyền riêng? *Đề xuất: giữ 1 tab với 2 khu vực (đúng 8 tab); người
  xác nhận = người có quyền Kiểm Đếm quầy kệ đó.*
- **#3 — Xung đột dữ liệu offline**: nhiều thiết bị offline cùng quét
  trùng mã/quầy kệ rồi đồng bộ sau — cộng dồn số lượng từng lần quét, hay
  lấy giá trị đồng bộ sau cùng? *Đề xuất: cộng dồn, không ghi đè.*
- **#4 — Lô/hạn sử dụng**: Kiểm Kê có cần phân biệt theo lô/hạn sử dụng
  như Kiểm Soát Hàng Hóa, hay chỉ cần tổng số lượng theo Mã Hàng? *Đề
  xuất: chỉ cần tổng theo Mã Hàng — nghiệp vụ kiểm kê bán lẻ thông thường
  không cần tách lô.*

---

*Nếu các phương án trên hợp lý, xác nhận lại (có thể kèm câu trả lời cho
4 câu hỏi còn mở, hoặc để mặc định theo đề xuất) để bắt đầu triển khai
code theo đúng quy trình chuẩn của hệ thống (phân trang, offline-first,
CSP, test kỹ trước khi merge — xem `../CLAUDE.md`).*
