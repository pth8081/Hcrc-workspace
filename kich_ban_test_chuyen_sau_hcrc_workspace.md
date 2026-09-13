# BỘ KỊCH BẢN TEST CHUYÊN SÂU — HCRC WORKSPACE (VPDT)

**Nguồn:** `Huong-dan-nghiep-vu.md` (bản đầy đủ). Test case tập trung vào **quy tắc nghiệp vụ tinh vi** dễ bị code sai hoặc bị phá vỡ khi sửa sau này — không liệt kê test hiển nhiên kiểu "bấm nút Lưu có lưu được không".

**Ký hiệu mức độ rủi ro:** 🔴 Cao (sai lệch dữ liệu tiền/pháp lý/bảo mật) · 🟡 Trung bình (sai UX/nghiệp vụ nhưng sửa được) · 🟢 Thấp (hiếm gặp/ảnh hưởng nhỏ)

---

## 0. NGUYÊN TẮC THIẾT KẾ BỘ TEST NÀY

Mỗi test case bám theo đúng 1 câu quy tắc **tường minh** trong tài liệu — vì đây chính là chỗ dev phải code logic đặc biệt (khác hành vi mặc định), nên xác suất sai cao hơn hẳn phần code "thẳng luồng". Ưu tiên test theo thứ tự:
1. **Ranh giới số** (mốc đúng bằng, tier giá trị) — lỗi off-by-one kinh điển.
2. **Thứ tự thao tác/race condition** (2 người cùng làm, làm sai thứ tự bước).
3. **Quyền chồng chéo** (đủ điều kiện A nhưng thiếu điều kiện B).
4. **Dữ liệu snapshot vs động** (sửa danh mục gốc có ảnh hưởng ngược dữ liệu cũ không).

---

## 1. TEST CROSS-CUTTING: ENGINE PHÊ DUYỆT CHUNG (mục 3)

| ID | Kịch bản | Bước thực hiện | Kết quả mong đợi | Rủi ro |
|---|---|---|---|---|
| WF-01 | Vị trí khớp nhưng thiếu quyền Người duyệt | Cấu hình bước "Theo vị trí" = Trưởng phòng Kế Toán; user A đúng chức danh/phòng ban nhưng KHÔNG tick `canBeApprover` | User A **không thấy nút Duyệt** dù đúng vị trí | 🔴 Đây là lỗi cấu hình thường gặp nhất theo chính tài liệu — phải test kỹ, không được "tự suy" có quyền vì đúng vị trí |
| WF-02 | Theo người — không tái kiểm tra quyền | Gán cứng user B (chế độ Theo người) làm người duyệt bước X, sau đó rút quyền `canBeApprover` của B | B **vẫn duyệt được** (hành vi cũ giữ nguyên, không tái kiểm tra) | 🟡 Ngược trực giác — nếu code "sửa cho nhất quán" thành luôn kiểm tra sẽ SAI so với đặc tả |
| WF-03 | Đổi vị trí giữa chừng | Bước "Theo vị trí" trỏ tới vị trí P; nhân viên đang giữ P bị đổi phòng ban ở màn Người Dùng | Hệ thống **tự tra lại đúng người mới** đang giữ P ở lần duyệt kế tiếp, không cần sửa cấu hình bước | 🔴 Nếu code cache sai người duyệt tại thời điểm tạo hồ sơ thay vì tra động lúc duyệt → sai |
| WF-04 | Vị trí kiêm nhiệm CHỈ ảnh hưởng đúng phạm vi khai báo | Gán "Vị Trí Kiêm Nhiệm" cho user C ở Ngân Sách; kiểm tra Quản Lý Trực Tiếp/KPI/Chấm công của C | 3 mục này **KHÔNG đổi** — chỉ ảnh hưởng đúng bước duyệt "Theo vị trí" ở module khác | 🔴 Rò rỉ phạm vi (leak) là lỗi nghiêm trọng vì kiêm nhiệm vốn thiết kế để KHÔNG đụng cơ chế chính |
| WF-05 | Nhiều người cùng giữ 1 vị trí (Theo phòng ban) | 2 nhân viên cùng chức danh+phòng ban đều có `canBeApprover` | **Cả 2** đều thấy hồ sơ ở Hộp Thư Phê Duyệt; **1 người duyệt xong hồ sơ biến mất khỏi hộp thư người còn lại** | 🔴 Race condition kinh điển — 2 người duyệt gần như đồng thời phải không tạo ra 2 lần chuyển bước |
| WF-06 | Duyệt tại Hub tương đương duyệt tại module gốc | Duyệt 1 hồ sơ Văn Bản Trình từ Hộp Thư Phê Duyệt | Email thông báo, chuyển bước, tự tạo Công Việc liên quan (nếu có)... chạy đầy đủ **giống hệt** duyệt tại module gốc | 🟡 Dễ sót side-effect nếu Hub gọi API rút gọn thay vì gọi đúng hàm xử lý gốc |
| WF-07 | Mã tự sinh trùng khi 2 người tạo gần như cùng lúc | 2 tab trình duyệt cùng tạo Tài Liệu cùng lúc | Server tự sinh 2 mã **khác nhau**, không mã nào bị trùng/lỗi | 🔴 Test tải đồng thời thật (không chỉ tuần tự) — lỗi race condition ẩn nếu server đọc "số lớn nhất" không có lock |
| WF-08 | Đơn vị tham gia quy trình lọc đúng | Cấu hình `workflowParticipatingDepts` chỉ gồm 2/10 phòng ban | Màn Quy Trình & Phê Duyệt chỉ hiện đúng 2 phòng đó; phòng khác **vẫn hoạt động bình thường** (chỉ ẩn khỏi danh sách cấu hình, không phải tắt quy trình) | 🟢 Dễ nhầm "lọc hiển thị" thành "chặn chức năng" |

---

## 2. TEST NHÓM 4.1: VĂN BẢN & TÁC NGHIỆP HẰNG NGÀY

| ID | Kịch bản | Bước thực hiện | Kết quả mong đợi | Rủi ro |
|---|---|---|---|---|
| DOC-01 | Cập nhật giữ mã, Nhập mới đổi mã | Cập nhật phiên bản 1 Tài Liệu vs Nhập mới 1 Tài Liệu khác | Cập nhật **giữ nguyên mã cũ**; Nhập mới **sinh mã khác** | 🟡 Nhầm 2 luồng dễ gây trùng/mất version |
| VBT-01 | Đề xuất thay thế file — hồ sơ bị khoá đúng cách | Lớp Trợ Lý/Thư Ký đề xuất thay file cho 1 tờ trình | Hồ sơ **khoá mọi thao tác khác** cho tới khi người trình Đồng ý/Không đồng ý | 🔴 Nếu không khoá đúng, người khác có thể duyệt/từ chối trong lúc đang chờ xử lý đề xuất → xung đột trạng thái |
| VBT-02 | Đồng ý đề xuất thay file | Người trình bấm "Đồng ý" | File mới áp dụng, **gửi duyệt lại từ bước 1** (không tiếp tục từ bước đang treo) | 🔴 Nếu tiếp tục từ bước cũ thay vì reset về bước 1 → người duyệt sau không biết nội dung đã đổi |
| VBT-03 | Không đồng ý đề xuất thay file | Người trình bấm "Không đồng ý" | Huỷ đề xuất, hồ sơ **về NHÁP** giống "Yêu cầu bổ sung" | 🟡 Kiểm tra đúng trạng thái NHÁP, không phải quay lại đúng bước đang treo |
| VBT-04 | Đề xuất thay file CHỈ áp dụng đúng layer quy định | Thử đề xuất thay file ở 1 bước KHÔNG phải lớp Trợ Lý/Thư Ký hoặc bước cuối | Nút đề xuất **không xuất hiện** | 🟡 Chặn nhầm phạm vi |
| VBT-05 | Bước cuối cùng động theo cấu hình | Tờ trình KHÔNG đi qua lớp Trợ Lý/Thư Ký, cấp cuối = GD_PGD | Nút đề xuất thay file (nếu có) áp dụng đúng bước cuối THẬT, không hardcode "bước N cố định" | 🔴 `currentStep === steps.length` phải tính động theo độ dài thực tế của từng tờ trình, không phải hằng số |
| ITSVC-01 | Ticket bị chặn khi đang chờ duyệt | Gửi yêu cầu phê duyệt cho 1 ticket đang "Chưa xử lý" | "🎯 Nhận Xử Lý" và "Cập nhật tiến độ" bị chặn **lỗi 409** trong lúc chờ/bị từ chối | 🔴 Test cả trường hợp IT cố tình gọi thẳng API bỏ qua giao diện |
| ITSVC-02 | Trạng thái xử lý KHÔNG đổi khi gửi phê duyệt | Gửi yêu cầu phê duyệt ticket | Trạng thái TODO/DOING của ticket **giữ nguyên**, chỉ trạng thái phê duyệt đổi | 🟢 2 state machine độc lập, dễ nhầm lẫn khi code chung 1 field |

---

## 3. TEST NHÓM 4.2: YÊU CẦU HÀNH CHÍNH TỰ PHỤC VỤ

| ID | Kịch bản | Bước thực hiện | Kết quả mong đợi | Rủi ro |
|---|---|---|---|---|
| XE-01 | Lịch Xe chỉ xem, không thao tác | Vào tab Lịch Xe, bấm vào 1 ô đỏ | Chỉ xem nhanh thông tin phiếu, **không đặt/kéo-chọn được** trực tiếp | 🟢 |
| XE-02 | Ô đỏ đúng định nghĩa "đang bận" | Phiếu đã bị Từ chối/Huỷ vẫn hiện ô đỏ? | Ô đỏ **chỉ** ứng với phiếu **chưa** bị từ chối/huỷ | 🟡 Dễ sót điều kiện lọc trạng thái |
| PH-01 | Chặn trùng lịch tính cả đơn CHỜ duyệt | Đăng ký phòng A khung giờ X (đang Chờ duyệt) → đăng ký tiếp phòng A cùng khung giờ X | Bị chặn **ngay lúc đăng ký**, không đợi tới lúc duyệt | 🔴 Nếu chỉ kiểm tra đơn ĐÃ duyệt sẽ dồn xung đột về tay người phê duyệt |
| PH-02 | Giao nhau 1 phần khung giờ | Đăng ký 9h-10h, đăng ký tiếp 9h30-10h30 cùng phòng | Vẫn bị chặn (giao nhau, không cần trùng khít) | 🔴 Lỗi logic so sánh khoảng thời gian rất dễ sai (dùng `<` thay vì `<=` hoặc ngược lại) |
| VPP-01 | Ngân sách phòng ban tự tính đúng công thức | Phòng có 8 nhân sự active, ngân sách/người = 500k | Ngân sách gợi ý = 4.000.000đ, admin sửa tay được số nhân sự | 🟡 |
| VPP-02 | Chức danh bị loại khỏi VPP không đăng ký được | User có chức danh nằm trong danh mục loại trừ | Không đăng ký được VPP, **không tính vào đầu người** khi tính ngân sách phòng | 🟡 Kiểm tra cả 2 chiều: chặn đăng ký VÀ loại khỏi mẫu số |
| DP-01 | Kho luôn tính động, không lưu bảng riêng | Sau nhiều lượt cấp phát/điều chuyển, đối chiếu "Đang Giữ" | Số liệu = phân bổ đã xác nhận **trừ** đã cấp phát — tính lại đúng dù không có bảng tồn kho | 🔴 Nếu code có cache tồn kho không đồng bộ → sai số ngầm, khó phát hiện bằng mắt |
| DP-02 | Chỉ đúng người được cấp mới xác nhận | User D thử xác nhận hộ phiếu cấp cho user E (sửa request tay) | Server **chặn**, không cho xác nhận thay | 🔴 Test bằng gọi API trực tiếp, không chỉ qua giao diện (giao diện có thể đã ẩn nút đúng) |
| DP-03 | Điều chuyển — hàng "lơ lửng" giữa 2 kho | Giám Đốc ST A tạo yêu cầu điều chuyển sang ST B, được duyệt | Kho A trừ ngay; **kho B CHƯA cộng** cho tới khi B xác nhận nhận hàng | 🔴 Test đúng lúc "khoảng giữa" — nếu dừng ở đây, tổng tồn kho toàn hệ thống phải khớp (không mất/thừa hàng) |
| DP-04 | Chỉ đúng Giám Đốc ST đích xác nhận | Giám Đốc ST khác (không phải B) thử xác nhận nhận hàng điều chuyển tới B | Bị chặn (`user.dept === transfer.targetDept`) | 🔴 |
| DP-05 | Báo cáo Đồng Phục — tổng khớp khi đổi lựa chọn | Chọn 3/10 siêu thị → xem "Tổng Cộng (3 siêu thị)" → bấm "Chọn Tất Cả" → so với "Tổng Cộng TẤT CẢ" | 2 số phải khớp khi chọn hết | 🟢 |
| GP-01 | Danh sách gia hạn mới nhất lên trước | 1 giấy phép có 3 lần gia hạn | Cả bảng con lẫn màn Chi Tiết đều sắp **mới nhất trước** | 🟢 |

---

## 4. TEST NHÓM 4.3: TÀI CHÍNH & HỢP ĐỒNG

| ID | Kịch bản | Bước thực hiện | Kết quả mong đợi | Rủi ro |
|---|---|---|---|---|
| HD-01 | Trạng thái thanh toán KHÔNG đổi ngay lúc bấm nút | Bấm "🧾 Lập Thanh Toán" trên 1 hợp đồng | Đề nghị sinh ra ở NHÁP; hợp đồng nguồn **vẫn "Chưa thanh toán"** | 🔴 Đây là thay đổi so với hành vi cũ — test kỹ tránh regression về hành vi "đổi ngay" |
| HD-02 | Chuyển "Chờ thanh toán" đúng thời điểm | Đề nghị NHÁP vừa tạo được duyệt xong theo phòng ban | Hợp đồng nguồn **lúc này mới** chuyển "Chờ thanh toán" | 🔴 |
| HD-03 | Thanh toán 1 lần — khoá cứng nút Lập Thanh Toán | Hợp đồng "1 lần" đã có 1 đề nghị PAID | Nút "🧾 Lập Thanh Toán" **không mở lại** | 🟡 |
| HD-04 | Thanh toán định kỳ — không cho 2 chu kỳ song song | Hợp đồng định kỳ đang có 1 đề nghị chưa PAID, thử Lập Thanh Toán tiếp | Bị chặn (kiểm tra bằng "còn đề nghị đang mở", không phải field `paymentStatus`) | 🔴 Nếu check nhầm field cũ `paymentStatus` (đã đổi cách hoạt động ở HD-01) → lọt |
| HD-05 | Đổi hình thức thanh toán — điều kiện hiện nút | Hợp đồng đã có ít nhất 1 đề nghị thanh toán, thử đổi hình thức | Nút "✏️ Đổi Hình Thức Thanh Toán" **không hiện** | 🔴 |
| HD-06 | Đổi hình thức thanh toán cần duyệt riêng | Gửi yêu cầu đổi hình thức | Badge "Chờ duyệt đổi hình thức" — **chưa áp dụng ngay**, đúng nhóm duyệt "Tài liệu ký" mới duyệt được | 🟡 |
| TT-01 | Số tiền đợt không bắt buộc khi NHÁP | Tạo đề nghị thanh toán từ hợp đồng, để trống số tiền 1 đợt, bấm "💾 Lưu" | Lưu thành công ở NHÁP | 🟢 |
| TT-02 | Bắt buộc số tiền khi chuyển Chờ duyệt | Cùng đề nghị trên, bấm "📨 Chuyển Xác Nhận Thanh Toán" khi còn đợt = 0 | Bị chặn **cả UI lẫn server** | 🔴 Luôn test server-side, đừng chỉ tin validate JS |
| TT-03 | Bắt buộc đính kèm tệp NGAY lúc gửi (v17.6+) | Chuyển NHÁP → Chờ duyệt mà chưa đính kèm "Hồ Sơ Đề Nghị Thanh Toán" | Bị chặn ngay bước này | 🔴 Đây là hành vi ĐẢO NGƯỢC so với thiết kế cũ — dễ sót nếu test theo tài liệu cũ/thói quen cũ |
| TT-04 | Bước Xác Nhận cuối không đòi thêm tệp | Tới bước "✅ Xác Nhận Đề Nghị Thanh Toán" | **Không** yêu cầu đính kèm thêm gì (đã bắt buộc ở TT-03 rồi) | 🟡 |
| TT-05 | Xác Nhận Toàn Bộ vs Xác nhận từng đợt | Hợp đồng "1 lần" vs hợp đồng "định kỳ"/nguồn khác | Đúng loại hiện đúng nút tương ứng — không lẫn lộn 2 luồng | 🔴 |
| TT-06 | Yêu Cầu Bổ Sung bị khoá sau khi xác nhận 1 đợt | Đề nghị đã xác nhận 1/3 đợt, thử "Yêu Cầu Bổ Sung" | Nút **biến mất** — không "rút lại" được khoản đã chi | 🔴 Test đúng ranh giới: 0 đợt xác nhận (được phép) vs ≥1 đợt (bị khoá) |
| NS-01 | 3 sub-tab Ngân Sách đúng luồng riêng | Ngân Sách Thực Hiện gửi đi | Đi thẳng "đã duyệt", **không qua bước duyệt** (khác Ngân Sách Phê Duyệt) | 🟡 |
| NS-02 | Phân quyền xem 3 mức | User chỉ có quyền xem phòng mình thử xem Tổng Hợp | Chỉ thấy đúng phòng mình, không thấy khối "Toàn Công Ty" | 🔴 |

---

## 5. TEST NHÓM 4.4: VẬN HÀNH (SIÊU THỊ)

| ID | Kịch bản | Bước thực hiện | Kết quả mong đợi | Rủi ro |
|---|---|---|---|---|
| DH-01 | **Ranh giới tier đúng bằng mốc — Siêu Thị** | Tạo đơn giá trị đúng **10.000.000đ** | Vào mức **"≤ 10 triệu"** (mức thấp hơn), không phải mức giữa | 🔴 **Test off-by-one kinh điển nhất trong toàn hệ thống** — thử cả 9.999.999đ / 10.000.000đ / 10.000.001đ |
| DH-02 | Ranh giới tier đúng bằng mốc — HO | Đơn giá trị đúng **100.000.000đ** | Vào mức **"≤ 100 triệu"** | 🔴 Cùng loại lỗi DH-01, test riêng vì 2 quy trình tách biệt hoàn toàn |
| DH-03 | Mức tính = MAX(2 số) | `amount` hệ thống tự tính = 50tr, nhưng "Tổng Giá Trị Thanh Toán" người dùng nhập = 120tr | Áp dụng mức theo **120tr** (số lớn hơn) | 🔴 Test ngược: amount=120tr, số nhập=50tr → vẫn phải áp mức 120tr — chặn hành vi "khai thấp né duyệt" |
| DH-04 | Khoá field sau khi đọc PDF thành công | Đọc PDF điền form thành công | Các field tự điền chuyển xám; Tiêu Đề/NCC/Ghi Chú **vẫn sửa được** | 🟡 |
| DH-05 | Nhập Lại Từ Đầu mở khoá đúng cách | Bấm "🔄 Nhập Lại Từ Đầu" | Mở khoá field + **xoá file PDF đã chọn** | 🟢 |
| DH-06 | Chặn trùng Số Đơn NCC ĐÚNG LOẠI | Đơn "Tại Siêu Thị" và đơn "Tại HO" dùng trùng `poNumber` | **Không** bị chặn (2 loại tách riêng hoàn toàn) | 🟡 Dễ code sai thành check chung 1 bảng |
| DH-07 | Trừ ngoại lệ khi trùng Số Đơn | Đơn cũ trùng `poNumber` đã ở trạng thái Từ chối/Đã hủy nhập | **Cho phép** tạo đơn mới trùng số đó | 🟡 |
| DH-08 | Nhiều file PDF — lỗi 1 file không chặn file khác | Upload 5 file PDF, 1 file bị lỗi đọc/trùng số đơn | 4 file còn lại **vẫn tạo đơn thành công**, bảng kết quả hiện rõ file nào lỗi/thành công | 🔴 Test đúng tính "độc lập từng file", không rollback toàn bộ khi 1 file lỗi |
| DH-09 | Duyệt Nhập/Huỷ tách quyền khỏi duyệt nội bộ | User chỉ có `operationOrderReceiptManage`, KHÔNG có quyền duyệt ngân sách | Vẫn xác nhận nhập/huỷ đơn được (đúng ở đúng phạm vi siêu thị được gán), nhưng **không thấy/không duyệt được** các bước duyệt nội bộ theo giá trị | 🔴 2 quyền độc lập hoàn toàn — test cả 2 chiều |
| API-DS16-01 | Lỗi 1 đơn không chặn đơn khác trong 1 lượt sync | 1 trong nhiều đơn đồng bộ lỗi (VD API đối tác timeout) | Đơn lỗi bị bỏ qua, **các đơn khác vẫn đồng bộ + đánh dấu thành công** | 🔴 |
| API-DS16-02 | Job tự bỏ qua nếu chưa tới chu kỳ | Chu kỳ cấu hình 30 phút, job chạy mỗi 5 phút | Chỉ thực sự gọi API ở đúng chu kỳ, các lần chạy giữa **tự bỏ qua** | 🟢 |
| VH-01 | Dự toán chưa duyệt khoá Thực hiện | Hồ sơ Mở Mới đã tạo (tự động "đã duyệt" ngay), Dự toán còn "Chờ duyệt" | Giai đoạn Thực hiện **vẫn khoá**, dù bản thân hồ sơ không cần duyệt | 🔴 Dễ nhầm 2 khái niệm: hồ sơ không cần duyệt ≠ Dự toán không cần duyệt |
| VH-02 | Việc LÁ — "Vẫn đang thực hiện" không đổi trạng thái | Đang "Đang thực hiện", chọn "Vẫn đang thực hiện", nhập ghi chú | Chỉ thêm dòng ghi chú tiến độ, trạng thái **giữ nguyên**, gọi lại được nhiều lần | 🟢 |
| VH-03 | Việc CÓ con — chặn cập nhật tay | Thử bấm "Cập Nhật Tiến Độ" trên 1 đầu mục lớn (có con) | Server **từ chối** — trạng thái chỉ tính lại tự động theo con | 🔴 Test qua API trực tiếp, không chỉ giao diện |
| VH-04 | Trạng thái cha tự tính đúng nhiều cấp | Cấu trúc cháu→con→cha, hoàn thành hết cháu | Con tự "Đang nghiệm thu" → sau khi con "Đã nghiệm thu" → cha tự cập nhật theo, đúng thứ tự lan truyền | 🔴 Test với cây ≥3 cấp, không chỉ 2 cấp đơn giản |
| VH-05 | Người phụ trách — chỉ thấy đúng phạm vi | User được gán "Người Phụ Trách" danh mục lớn A (không phải quản lý hồ sơ) | Thấy hồ sơ + toàn bộ mục A + con của A; **danh mục khác trong CÙNG hồ sơ bị ẩn** | 🔴 Test rò rỉ — vào thẳng URL/API danh mục B (không phụ trách) phải bị chặn |
| VH-06 | Người phụ trách — giới hạn thao tác | Người phụ trách A thử: xoá chính danh mục lớn A / thêm danh mục lớn mới / đổi danh sách người phụ trách | Cả 3 đều bị **chặn** — chỉ sửa nội dung A + quản lý con của A | 🔴 |
| VH-07 | Danh mục đầu tư — cha tự tính tổng con | Danh mục lớn có 3 con, sửa chi phí 1 con | Chi phí cha **tự động** = tổng 3 con | 🟡 |
| VH-08 | Không cộng đúp Tổng Danh Mục Đầu Tư | Tính "Ngân sách còn lại" | Chỉ cộng các danh mục LỚN — con **không cộng thêm lần nữa** | 🔴 Lỗi cộng đúp rất dễ xảy ra khi tính tổng qua vòng lặp không lọc đúng |
| VH-09 | Xoá cha cascade đúng con | Xoá 1 danh mục lớn đang có con | Toàn bộ con **bị xoá theo** | 🟡 |
| VH-10 | Liên kết phụ thuộc chặn bắt đầu | Việc B phụ thuộc việc A (A chưa "Đã nghiệm thu") | Việc B **chưa thể** bấm "Bắt đầu thực hiện" | 🔴 |
| VH-11 | Liên kết phụ thuộc tự mở khi đủ điều kiện | A vừa chuyển "Đã nghiệm thu" (liên kết cuối cùng) | Việc B **hết bị chặn ngay** không cần thao tác gì thêm | 🟡 |
| VH-12 | Chặn vòng lặp phụ thuộc | Thử liên kết A phụ thuộc B, B phụ thuộc A (trực tiếp hoặc qua C) | Bị **chặn** khi tạo liên kết gây vòng lặp | 🔴 Test cả vòng lặp gián tiếp (A→B→C→A), không chỉ vòng lặp trực tiếp |
| VH-13 | Cảnh báo quá hạn — 2 loại tách biệt đúng điều kiện | Việc quá "Hạn Hoàn Thành" mà "Chưa bắt đầu" vs "chưa hoàn thành" | Đúng nhãn 🔴/🟠 tương ứng; việc "Đã nghiệm thu" **không bao giờ** bị gắn cờ dù có quá hạn | 🟡 |

---

## 6. TEST NHÓM 4.5: NHÂN SỰ

### 6.1. Cơ Cấu Tổ Chức (Versioned)

| ID | Kịch bản | Bước thực hiện | Kết quả mong đợi | Rủi ro |
|---|---|---|---|---|
| ORG-01 | Sửa bản Nháp không ảnh hưởng hệ thống đang chạy | Tạo bản nháp mới, sửa cây (xoá 1 vị trí đang có người giữ) | Hệ thống **đang áp dụng** (bản cũ) hoàn toàn không đổi cho tới khi Áp Dụng | 🔴 |
| ORG-02 | Kiểm tra hợp lệ trước khi áp dụng | Bản nháp có node cha không tồn tại (mồ côi) | "Kiểm tra hợp lệ" **phát hiện và chặn** áp dụng | 🔴 |
| ORG-03 | Xoá node bị chặn nếu còn người giữ | Thử xoá 1 vị trí đang có nhân viên | Bị **chặn**, phải chuyển nhân viên trước | 🔴 |
| ORG-04 | "Ai giữ vị trí" suy ra động, không lưu riêng | Đổi Phòng Ban/Chức Danh 1 nhân viên ở màn Người Dùng | Nhân viên đó **tự động "chuyển vị trí"** trong cây mà không cần thao tác gì ở Cơ Cấu Tổ Chức | 🟡 |
| ORG-05 | Quản Lý Trực Tiếp chỉ tự tính khi tra ra ĐÚNG 1 người | Áp dụng 1 phiên bản mà vị trí cha có 0 hoặc ≥2 người giữ | `managerUsername` **giữ nguyên** (không suy đoán bừa), liệt kê rõ ở "Kết Quả Áp Dụng" | 🔴 Đây là quy tắc an toàn quan trọng — test cả 2 case (0 người và 2 người) |
| ORG-06 | Đồng Bộ Quản Lý Trực Tiếp thủ công | Đổi chức danh 1 nhân viên (không tạo bản nháp mới), sau đó bấm nút "🔄 Đồng Bộ" | `managerUsername` cập nhật đúng **mà không cần Áp Dụng lại phiên bản cây** | 🟡 |
| ORG-07 | Không cho gán lại đúng chức vụ hiện tại | Gán/Đổi Chức Vụ đúng bằng chức vụ đang có | Bị chặn, tránh spam lịch sử | 🟢 |

### 6.2. Onboarding / Offboarding

| ID | Kịch bản | Bước thực hiện | Kết quả mong đợi | Rủi ro |
|---|---|---|---|---|
| OB-01 | Quy trình tự "Hoàn tất" không cần nút thủ công | Hoàn thành/Bỏ qua hết mọi việc bắt buộc mọi giai đoạn | Quy trình **tự chuyển "Hoàn tất"** ngay | 🟡 |
| OB-02 | Bỏ qua việc bắt buộc yêu cầu lý do + đúng quyền | Thành viên thường thử "Bỏ qua" 1 việc bắt buộc | Bị chặn — **chỉ người quản lý quy trình** làm được, phải nhập lý do | 🔴 |
| OFF-01 | **Chặn Hoàn Tất nếu thiếu người kế nhiệm** | Mọi việc bắt buộc đã xong, nhưng người sắp nghỉ vẫn là `managerUsername` của ai đó active | Quy trình **giữ "Đang thực hiện"**, cảnh báo "Chờ chỉ định người kế nhiệm" | 🔴 Test case quan trọng nhất của Offboarding — kiểm tra SỐNG theo managerUsername thật, KHÔNG dựa vào ô tick "đang giữ vị trí quản lý" lúc tạo |
| OFF-02 | Chỉ định người kế nhiệm chuyển toàn bộ cấp dưới | Chỉ định người kế nhiệm F cho người sắp nghỉ | **Toàn bộ** người đang báo cáo trực tiếp cho người sắp nghỉ chuyển `managerUsername` sang F ngay lập tức | 🔴 |
| OFF-03 | Không tự nhận chính mình làm người kế nhiệm | Thử chọn chính người sắp nghỉ làm người kế nhiệm | Bị chặn | 🟢 |
| OFF-04 | Điều kiện cuối cùng tự hoàn tất ngay | Chỉ định người kế nhiệm là điều kiện thiếu DUY NHẤT còn lại | Quy trình **tự chuyển Hoàn Tất ngay** sau khi chỉ định, không cần thao tác thêm | 🟡 |
| OFF-05 | Ticket IT hoàn thành kích hoạt side-effect đầy đủ | Đội IT đánh dấu ticket "Hoàn thành" là việc IT cuối cùng khiến Offboarding đủ điều kiện | Phải kích hoạt **cả 2**: tự đóng hợp đồng lao động + khoá tài khoản — **giống hệt** khi hoàn thành trực tiếp trên giao diện | 🔴 Tài liệu ghi rõ đây là bug đã sửa (trước đó bị sót) — regression test bắt buộc |
| OB-03 | Đổi danh mục Checklist Mẫu không ảnh hưởng ngược | Sửa/xoá 1 việc trong Checklist Mẫu | Các quy trình **đã tạo trước đó** giữ nguyên checklist đã snapshot, không đổi theo | 🔴 |
| OB-04 | 4 cờ phân quyền độc lập | User chỉ có "📋 Quản Lý Checklist Mẫu" | **Không** tự có quyền tạo/quản lý quy trình Onboarding/Offboarding | 🟡 |
| OB-05 | Người liên quan luôn xem được dù không có cờ | User được giao riêng 1 việc trong quy trình (không có quyền quản lý nào) | Vẫn xem được đúng quy trình đó | 🟢 |

### 6.3. Hồ Sơ Nhân Sự

| ID | Kịch bản | Bước thực hiện | Kết quả mong đợi | Rủi ro |
|---|---|---|---|---|
| HSNS-01 | 3 tầng xem đúng dữ liệu ẩn | Quản lý trực tiếp xem hồ sơ nhân viên cấp dưới | CCCD/tài khoản NH/BHXH/mã số thuế/người phụ thuộc/học vấn **bị ẩn** | 🔴 |
| HSNS-02 | Không phân biệt "không tồn tại" vs "không có quyền" | User không liên quan tra mã nhân viên không tồn tại VÀ mã tồn tại nhưng không có quyền | **Cùng 1 thông báo lỗi** cho cả 2 trường hợp | 🔴 Chống dò mã nhân viên (enumeration attack) — kiểm tra kỹ message lỗi giống hệt nhau |
| HSNS-03 | Không đổi trạng thái tay DRAFT/Đã nghỉ việc | HR thử đổi tay trạng thái 1 hồ sơ đang DRAFT | Bị chặn — 2 trạng thái này chỉ hệ thống tự đặt | 🔴 |
| HSNS-04 | Đồng bộ NGƯỢC xuống tài khoản khi gán Chức Vụ | Gán Chức Vụ mới cho hồ sơ đã liên kết tài khoản | Phòng Ban + Chức Danh của **tài khoản VPDT tự ghi đè theo** | 🔴 Kiểm tra đúng chiều: Hồ Sơ Nhân Sự → Tài khoản, KHÔNG PHẢI chiều ngược |
| HSNS-05 | Vị Trí Làm Việc chỉ đồng bộ nếu đã cấu hình | Đổi chức vụ 1 nhân viên giữa Văn phòng ↔ Siêu Thị, node MỚI **chưa** gắn "Vị Trí Làm Việc" | Mô hình chấm công **KHÔNG tự đổi** — vẫn cần sửa tay ở Người Dùng | 🟡 Test đúng case "chưa cấu hình" — dễ nhầm tưởng luôn tự động |
| HSNS-06 | Không cho gán lại đúng chức vụ hiện tại | Gán lại đúng chức vụ đang có | Bị chặn | 🟢 |
| HSNS-07 | Chặn nếu vị trí chưa đúng Phòng Ban chuẩn | Gán 1 vị trí chưa gắn đúng Phòng Ban chuẩn trong Cơ Cấu Tổ Chức | Bị chặn, trừ chức vụ không thuộc phòng ban nào (VD TGĐ) | 🟡 |
| HSNS-08 | Lịch Sử Nhân Sự cần ĐỦ CẢ 2 quyền | User chỉ có "Quản Lý Hồ Sơ Nhân Sự" (thiếu "Quản Lý Hợp Đồng Lao Động") | Khối "Lịch Sử Nhân Sự" **không hiện** | 🔴 Test cả 2 chiều thiếu quyền |
| HSNS-09 | Không có nút Xoá hồ sơ | Kiểm tra giao diện Quản Lý Hồ Sơ | **Không tồn tại** nút Xoá ở bất kỳ đâu (kể cả admin) | 🟢 |
| HSNS-10 | Nhập Excel — dòng lỗi không chặn dòng khác | File Excel có 1 dòng sai định dạng | Dòng lỗi bị **bỏ qua**, các dòng hợp lệ khác vẫn nhập thành công | 🟡 |

### 6.4. Hợp Đồng Lao Động

| ID | Kịch bản | Bước thực hiện | Kết quả mong đợi | Rủi ro |
|---|---|---|---|---|
| HDLD-01 | Tự tạo đúng 3 mốc Onboarding | Hoàn thành lần lượt 3 việc: gửi thư mời → ký ngày đầu → quyết định cuối thử việc | Tương ứng: tạo HĐ Thử việc Nháp → kích hoạt (Đang hiệu lực) → tạo HĐ mới/chấm dứt theo đúng quyết định | 🔴 Test đủ 3 mốc, không chỉ mốc đầu |
| HDLD-02 | Offboarding tự đóng hợp đồng | Offboarding hoàn tất | Hợp đồng đang hiệu lực chuyển "Đã chấm dứt" | 🟡 |
| HDLD-03 | Offboarding tự khoá tài khoản + huỷ phiên đăng nhập | Offboarding hoàn tất, nhân viên đang có phiên đăng nhập mở ở thiết bị khác | Tài khoản chuyển "Đã khoá" **VÀ** phiên đăng nhập đang mở **bị vô hiệu ngay** (không phải chỉ khoá đăng nhập lần sau) | 🔴 Test bằng 2 thiết bị thật — phiên đang mở phải bị đá ra ngay, không chờ hết hạn JWT tự nhiên |
| HDLD-04 | Quá 2 lần gia hạn bắt buộc Vô thời hạn | Gia hạn hợp đồng Xác định thời hạn lần thứ 3 | Hệ thống **bắt buộc** chuyển loại Vô thời hạn, không cho gia hạn tiếp loại có thời hạn | 🔴 |
| HDLD-05 | Mã Nhân Viên bắt buộc chọn từ hồ sơ trừ khi tick ngoại lệ | Tạo tay hợp đồng, không tick "Không lấy từ hồ sơ", gõ tay mã không tồn tại | Bị chặn **cả server** | 🔴 |
| HDLD-06 | Sửa tay ghi lịch sử đúng — không ghi nếu không đổi gì | Mở form sửa hợp đồng, bấm Lưu mà không đổi trường nào | **Không** sinh dòng lịch sử mới | 🟡 Test tránh spam lịch sử rác |
| HDLD-07 | Sửa tay ghi lịch sử — chỉ ghi trường thực đổi | Sửa 1 trường (VD lương cơ bản) trong form có nhiều trường | Dòng lịch sử chỉ ghi đúng trường đã đổi (giá trị cũ→mới), không ghi khống các trường không đổi | 🟡 |
| HDLD-08 | Cảnh báo hết hạn không gửi trùng | Hợp đồng qua đúng ngưỡng 60 ngày trước hạn, job chạy nhiều lần trong ngày | Chỉ gửi **1 email** cho đúng ngưỡng đó, không gửi lặp lại | 🔴 |
| HDLD-09 | Cảnh báo gửi cả HR và quản lý trực tiếp | Tới ngưỡng cảnh báo | Cả 2 nhóm nhận được email | 🟢 |

### 6.5. Công & Phép

| ID | Kịch bản | Bước thực hiện | Kết quả mong đợi | Rủi ro |
|---|---|---|---|---|
| CP-01 | Không có nút Check-in/out thủ công | Kiểm tra giao diện | Chấm công **chỉ** qua API máy chấm công, không có nút thủ công cho nhân viên thường | 🟢 |
| CP-02 | Nghỉ phép năm chặn ngay khi vượt số ngày còn lại | Nộp đơn nghỉ Phép năm vượt số ngày còn | Bị chặn **ngay lúc nộp**, không phải lúc duyệt | 🔴 |
| CP-03 | Nghỉ theo giờ không trừ phép, không sinh bản ghi nguyên ngày | Nộp đơn Nghỉ theo giờ (2 tiếng) | Phép năm **không đổi**; bản ghi chấm công chỉ ghi khoảng giờ, không phải "nghỉ nguyên ngày" | 🔴 |
| CP-04 | Việc riêng không trừ phép năm | Nộp đơn Việc riêng 2 ngày | Phép năm **không đổi** (khác Phép năm dù cùng khuôn Từ-Đến ngày) | 🟡 Dễ nhầm với Phép năm vì cùng form |
| CP-05 | Duyệt tự trừ phép + tự sinh chấm công, không ghi đè | Duyệt đơn Phép năm 3 ngày, 1 trong 3 ngày đã có bản ghi loại khác (VD nghỉ ốm trước đó) | Trừ đúng 3 ngày phép; **không ghi đè** bản ghi chấm công ngày đã có sẵn loại khác | 🔴 Test case biên quan trọng — dữ liệu 2 nguồn xung đột trên cùng 1 ngày |
| CP-06 | Quyền Duyệt Nghỉ Phép KHÔNG tự động theo chức vụ quản lý | User là quản lý trực tiếp thật (đúng cây tổ chức) nhưng chưa được tick "✅ Duyệt Nghỉ Phép" | **Không** duyệt được | 🔴 |
| CP-07 | Duyệt Nghỉ Phép giới hạn đúng phạm vi quản lý | Quản lý trực tiếp A cố duyệt đơn của nhân viên KHÔNG thuộc quyền quản lý của A | Bị chặn | 🔴 |
| CP-08 | Tự huỷ đơn — đúng điều kiện thời gian | Nhân viên huỷ đơn đã duyệt nhưng **đã qua ngày nghỉ** | Bị chặn (chỉ huỷ được khi đang chờ duyệt hoặc đã duyệt nhưng CHƯA tới ngày nghỉ) | 🟡 |
| CA-01 | Mô hình chấm công tự xác định theo Vị Trí | Nhân viên Văn Phòng vs Siêu Thị | Đúng "Giờ Hành Chính" vs "Theo Ca" tương ứng, không cấu hình thêm | 🟡 |
| CA-02 | Chặn phân ca trùng ngày | Phân ca cho 1 nhân viên 2 ca khác nhau CÙNG 1 ngày | Bị chặn | 🔴 |
| CA-03 | **Đổi ca 1 CHIỀU, không hoán đổi** | Nhân viên G xin đổi ca của mình cho nhân viên H | Ca của G **chuyển hẳn** sang H; ca (nếu có) của H **không tự động** chuyển ngược lại G | 🔴 Test đúng bản chất "1 chiều" — 2 người muốn hoán đổi phải tự nộp 2 đơn riêng, không có API "swap 2 chiều" |
| CA-04 | Quyền Lập lịch và Duyệt đổi ca độc lập | User chỉ có "📅 Quản Lý Lịch Phân Ca", KHÔNG có "🔄 Duyệt Đổi Ca" | Không duyệt được đơn xin đổi ca | 🟡 |
| CA-05 | Giới hạn đúng phạm vi siêu thị quản lý | Quản Lý ST X thử duyệt đổi ca của nhân viên ST Y | Bị chặn | 🔴 |
| API-CC-01 | API Máy Chấm Công dùng key riêng, không chung ExtAuth | Gọi `/api/attendance/clock-punch` bằng key của API Xác Thực Ngoài (mục 7.9) | Bị **từ chối** — 2 loại key hoàn toàn tách biệt | 🔴 |
| API-CC-02 | Mỗi lượt quẹt ghi đúng giờ vào/ra | Nhân viên quẹt 3 lần trong ngày (vào - ra ăn trưa - vào lại - ra về, tổng 4 lượt) | Giờ vào = lượt **đầu tiên**, giờ ra = lượt **cuối cùng** trong ngày | 🟡 |
| PHEP-01 | Phép năm pro-rate đúng khi vào làm giữa năm | Nhân viên vào làm tháng 7 (còn 6 tháng trong năm) | Số phép năm = tỷ lệ đúng 6/12 tháng, không phải đủ 12 ngày | 🟡 |
| PHEP-02 | Quy đổi phép chưa nghỉ chỉ là số THAM KHẢO | Offboarding hoàn tất, xem việc "Tính lương, phép năm chưa nghỉ" | Hiện số tiền quy đổi, nhưng **không tự động** ghi vào phiếu lương — cần kế toán tự thêm tay | 🔴 Kiểm tra đúng ranh giới "tính toán hỗ trợ" vs "tự động thực thi" |

### 6.6. Lương

| ID | Kịch bản | Bước thực hiện | Kết quả mong đợi | Rủi ro |
|---|---|---|---|---|
| LUONG-01 | 3 tầng quyền tách biệt — không tự duyệt được | User chỉ có "💰 Lập/Tính Lương" thử tự Duyệt kỳ mình vừa lập | Bị chặn (thiếu quyền "✅ Duyệt Lương") | 🔴 Test đúng nguyên tắc kiểm soát nội bộ kế toán |
| LUONG-02 | Vòng đời đúng thứ tự, không nhảy cóc | Thử chuyển thẳng Nháp → Đã Chốt (bỏ qua Chờ Duyệt/Đã Duyệt) | Bị chặn | 🟡 |
| LUONG-03 | Không sửa tay được khi đã Chờ Duyệt | Kế toán thử sửa 1 dòng lương khi kỳ đang "Chờ Duyệt" | Bị chặn | 🔴 |
| LUONG-04 | Từ Chối quay lại Nháp kèm lý do | Người duyệt Từ Chối 1 kỳ | Kỳ về Nháp, **bắt buộc có lý do** hiển thị cho kế toán | 🟡 |
| LUONG-05 | Mở Lại bắt buộc lý do | Mở Lại 1 kỳ Đã Chốt/Đã Công Bố | Bắt buộc nhập lý do mới cho về Nháp | 🟡 |
| LUONG-06 | Công Bố sinh thông báo trong app, không email | Công Bố 1 kỳ | Nhân viên nhận thông báo qua **chuông 🔔 trong app**, không qua email | 🟡 |
| LUONG-07 | **Nhân viên nghỉ giữa kỳ vẫn được tính (v17.6)** | Nhân viên hoàn tất Offboarding ngày 15, kế toán bấm Tính Lương ngày 28 cùng tháng | Nhân viên này **vẫn xuất hiện** trong kỳ lương, có ghi chú ngày nghỉ việc ở dòng Lương cơ bản | 🔴 Regression test bắt buộc — đây là bug đã từng có, dễ tái phát nếu sửa code liên quan |
| LUONG-08 | KHÔNG tự trừ ngày không làm việc sau nghỉ | Cùng case LUONG-07, xem dòng Lương cơ bản | Vẫn tính **đủ** 1 tháng lương cơ bản (chưa trừ), cần kế toán tự Điều chỉnh | 🔴 Test đúng "không làm" chứ không phải thiếu sót — nếu code TỰ trừ sẽ SAI so với đặc tả hiện tại |
| LUONG-09 | **Tính lại KHÔNG xoá điều chỉnh tay của người khác (v17.6)** | Kỳ đã có điều chỉnh tay (thưởng/phạt) cho nhân viên A, bấm Tính Lương lại để bổ sung nhân viên B mới sót | Điều chỉnh tay của A **vẫn giữ nguyên**, không bị xoá và tính lại từ đầu | 🔴 Regression test quan trọng nhất của cả module Lương — bug cũ gây mất dữ liệu thật |
| LUONG-10 | Cấu Hình Tỷ Lệ chỉ 1 nơi, áp dụng toàn bộ tính toán | Đổi % BHXH ở Cấu Hình Tỷ Lệ | Lần "Tính Lương" **kế tiếp** áp dụng đúng tỷ lệ mới; các kỳ ĐÃ tính trước đó **không tự đổi ngược** | 🟡 Kiểm tra không hồi tố ngược các kỳ cũ |
| LUONG-11 | Phiếu lương của tôi luôn bật, không tắt được | Admin thử tắt quyền xem phiếu lương cá nhân của 1 user | Không có cờ nào tắt được — mặc định luôn bật | 🟢 |
| LUONG-12 | Xuất PDF tại trình duyệt, không qua server | Nhân viên xuất PDF phiếu lương đã công bố | File tạo **tại client**, không gửi dữ liệu lương qua thêm 1 request server không cần thiết | 🟢 (test bảo mật nhẹ — giảm bề mặt lộ dữ liệu) |

### 6.7. Quản Lý & Phản Hồi Ý Kiến

| ID | Kịch bản | Bước thực hiện | Kết quả mong đợi | Rủi ro |
|---|---|---|---|---|
| QAHR-01 | Đúng khuôn 1 hỏi - 1 đáp | Nhân viên gửi câu hỏi, Nhân Sự trả lời | Không cho trao đổi thêm lượt 2 trong cùng câu hỏi (đúng thiết kế, khác chat) | 🟢 |
| QAHR-02 | Không gửi email khi có câu hỏi mới | Nhân viên gửi câu hỏi mới | Nhân Sự chỉ thấy **cờ chưa đọc** trong giao diện, không nhận email | 🟢 |

---

## 7. TEST NHÓM 4.6: BÁO CÁO ĐỊNH KỲ

| ID | Kịch bản | Bước thực hiện | Kết quả mong đợi | Rủi ro |
|---|---|---|---|---|
| BCDK-01 | Đối Chiếu Theo Công Việc tách biệt bản chính thức | Xem "🗂️ Đối Chiếu Theo Công Việc" | Chỉ xem, **không publish/không ảnh hưởng** bản tổng hợp chính thức | 🟡 |
| BCDK-02 | Mốc thời gian tự suy đúng chuỗi kỳ | Không chỉnh Từ/Đến ngày | Mốc = kỳ CLOSED liền trước → hạn chót kỳ hiện tại | 🟢 |
| BCDK-03 | Filter Từ/Đến ngày GHI ĐÈ, không cộng thêm | Nhập Từ ngày/Đến ngày khác mốc tự suy | Dùng ĐÚNG khoảng người dùng nhập, không giao với mốc tự suy | 🟡 |
| BCDK-04 | Bộ lọc chỉ áp dụng khi bấm nút | Đổi bộ lọc nhưng chưa bấm nút | Bảng đang xem **không tự lọc lại ngay** | 🟢 |

---

## 8. TEST NHÓM 4.7: CHECKLIST ĐÁNH GIÁ SIÊU THỊ

| ID | Kịch bản | Bước thực hiện | Kết quả mong đợi | Rủi ro |
|---|---|---|---|---|
| CL-01 | StoreCode luôn tự suy, không tin client | STORE_SELF: sửa request gửi `storeCode` khác `user.dept` | Server **bỏ qua**, tự lấy theo `user.dept` | 🔴 Test bằng gọi API trực tiếp, đây là control chặn giả mạo quan trọng nhất module |
| CL-02 | CONTROL_AUDIT validate phạm vi ở server | Auditor sửa request chọn siêu thị ngoài `checklistAuditScope` | Bị chặn ở **server**, không chỉ ẩn ở UI | 🔴 |
| CL-03 | Admin test — CHỈ admin được tin storeCode gửi lên | Tài khoản thường (không phải admin) thử dùng cơ chế "Test Tự Đánh Giá" | Không thấy khối này / bị chặn nếu cố gọi thẳng API | 🔴 |
| CL-04 | Sửa mẫu ACTIVE bị chặn — bắt buộc luồng Nhân Bản | Thử sửa trực tiếp 1 mẫu đang ACTIVE | Lỗi **409**, bắt buộc Nhân Bản → sửa Nháp → Kích Hoạt | 🔴 |
| CL-05 | Kích hoạt bản mới tự lưu trữ bản cũ | Kích hoạt bản Nháp v2 của 1 `templateCode` đang có bản ACTIVE v1 | v1 tự chuyển **Lưu Trữ**, chỉ 1 bản ACTIVE tồn tại | 🟡 |
| CL-06 | Bài cũ giữ đúng câu hỏi gốc dù mẫu đã đổi | Xem lại 1 `checklistSubmission` cũ sau khi mẫu đã có version mới | Hiện đúng câu hỏi/lựa chọn của **version tại thời điểm làm bài**, không phải version mới nhất | 🔴 |
| CL-07 | showIfOptionId đánh số liên tục toàn mẫu | Cấu hình 1 câu chỉ hiện khi chọn lựa chọn của câu **cách 2 câu trước** (không phải liền trước) | Vẫn cấu hình/hoạt động được | 🟡 |
| CL-08 | Critical Fail phủ quyết điểm số bất kể cao thấp | Bài có 1 lựa chọn Critical Fail, còn lại toàn điểm tối đa | `isPassed` = **false** dù `scorePercent` gần 100% | 🔴 Test case cốt lõi nhất của module — điểm cao không cứu được khi có 1 lỗi nghiêm trọng |
| CL-09 | Bắt buộc ảnh khi chọn Critical Fail | Chọn 1 lựa chọn Critical Fail, không đính kèm ảnh, thử "Kết Thúc & Nộp" | Bị chặn | 🔴 |
| CL-10 | Chỉ đúng siêu thị bị đánh giá mới phản hồi được | User khác (không thuộc siêu thị đó) thử phản hồi | Bị chặn | 🔴 |
| CL-11 | 3 quyền phẳng độc lập | User có `checklistReportView` nhưng KHÔNG có `checklistTemplateManage` | Xem được Báo Cáo, **không** tạo/sửa được Mẫu | 🟡 |
| CL-12 | Báo cáo module này tách biệt module Báo Cáo tổng hợp | Kiểm tra module Báo Cáo (mục 5) | **Không** đọc dữ liệu Checklist — 2 màn báo cáo hoàn toàn độc lập | 🟢 |

---

## 9. TEST MỤC 5: BÁO CÁO (TỔNG HỢP)

| ID | Kịch bản | Bước thực hiện | Kết quả mong đợi | Rủi ro |
|---|---|---|---|---|
| RPT-01 | 4 module Nhân Sự nhạy cảm KHÔNG có ở đây | Tìm Hồ Sơ Nhân Sự/Hợp Đồng LĐ/Lương/Công&Phép trong module Báo Cáo | **Không tồn tại** — đây route riêng, không đọc `DB.<collection>` (luôn rỗng phía client cho các module này) | 🔴 Đây là kiểm soát bảo mật — test đảm bảo không có đường vòng nào lộ dữ liệu 4 module này qua Báo Cáo chung |
| RPT-02 | Trường lạ tự tách nhãn, không hỏng bảng | Thêm 1 field mới qua Biểu Mẫu cho 1 module, field đó chưa có nhãn tiếng Việt định sẵn | Bảng Tra cứu chi tiết **vẫn hiển thị đúng** (tự tách theo chữ hoa ra nhãn đọc được) | 🟡 |
| RPT-03 | Xuất Excel giữ đúng thứ tự cột đã chọn | Chọn cột theo thứ tự C, A, B | File Excel xuất ra **đúng thứ tự** C, A, B (không tự sắp lại) | 🟢 |
| RPT-04 | Quyền xem báo cáo tách khỏi quyền tạo hồ sơ | User có quyền tạo hồ sơ Tài Liệu nhưng KHÔNG có quyền xem báo cáo Tài Liệu | Không thấy phần báo cáo tương ứng | 🟡 |
| RPT-05 | Thời gian xử lý trung bình tính đúng | Đối chiếu số "thời gian xử lý trung bình mỗi bước" với lịch sử xử lý thật của vài hồ sơ mẫu | Số liệu khớp tính tay | 🟡 |

---

## 10. TEST MỤC 6: PHÂN QUYỀN

| ID | Kịch bản | Bước thực hiện | Kết quả mong đợi | Rủi ro |
|---|---|---|---|---|
| PQ-01 | Khối 0 chặn trước tiên | User bị tắt quyền truy cập module Hợp Đồng ở khối 0, nhưng vẫn có tick vài quyền chi tiết ở khối 4 | Vẫn **không vào được** module Hợp Đồng — quyền chi tiết vô nghĩa khi thiếu quyền truy cập | 🔴 |
| PQ-02 | Nhóm quyền là OVERLAY cộng thêm, không thay thế | User có quyền cá nhân A, thuộc nhóm có quyền B | Quyền hiệu lực = **A hợp B** (cả 2), không phải chỉ giữ 1 trong 2 | 🔴 |
| PQ-03 | Sửa 1 nhóm cập nhật toàn bộ thành viên ngay | Sửa quyền của 1 nhóm | Mọi thành viên nhóm đó có quyền mới **ngay lập tức**, không cần đăng nhập lại (hoặc đúng theo cơ chế JWT refresh của hệ thống) | 🟡 Kiểm tra rõ: quyền áp dụng ngay ở request tiếp theo hay phải chờ JWT hết hạn/refresh |
| PQ-04 | Tạo user mới thiếu quyền Người duyệt | Tạo user mới, gán đúng vị trí "Theo vị trí" của 1 bước duyệt, KHÔNG tick "Người duyệt" | Không duyệt được — đúng cảnh báo ở mục 3.2 | 🔴 (trùng WF-01, test lại từ góc nhìn tạo user mới) |
| PQ-05 | Badge "đã cấp X/Y" đúng số đếm | Tick 5/20 quyền trong 1 khối | Badge hiện đúng "5/20" | 🟢 |

---

## 11. TEST MỤC 7: HỆ THỐNG / QUẢN TRỊ

| ID | Kịch bản | Bước thực hiện | Kết quả mong đợi | Rủi ro |
|---|---|---|---|---|
| BM-01 | Field tự thêm không ảnh hưởng hồ sơ cũ | Thêm 1 field bắt buộc mới vào form Tài Liệu qua Biểu Mẫu | Hồ sơ **đã tạo trước đó** vẫn mở/xem được bình thường (không bị bắt buộc điền field mới hồi tố) | 🔴 |
| BM-02 | Checklist Đánh Giá Siêu Thị — chỉ 4 field cấp mẫu tuỳ biến được | Vào Biểu Mẫu, tìm Checklist Đánh Giá Siêu Thị | Chỉ tuỳ biến Mã/Tên/Loại/Ngưỡng Đạt; **câu hỏi/lựa chọn bên trong KHÔNG tuỳ biến được ở đây** | 🟡 |
| FILE-01 | Giới hạn dung lượng riêng module chỉ được SIẾT, không NỚI | Đặt giới hạn riêng cho 1 module = 50MB trong khi `UPLOAD_MAX_MB` chung = 20MB | Giới hạn thực tế áp dụng vẫn là **20MB** (không vượt giới hạn chung) | 🔴 |
| TRASH-01 | Chỉ admin vào Thùng Rác — kiểm tra cả server | User thường cố gọi thẳng API Thùng Rác | Bị chặn ở **server**, không chỉ ẩn nút | 🔴 |
| TRASH-02 | Khôi phục đúng dữ liệu, không tự dọn theo thời gian | Hồ sơ nằm trong Thùng Rác 6 tháng | Vẫn còn nguyên, khôi phục được bình thường | 🟢 |
| TRASH-03 | Xoá vĩnh viễn yêu cầu xác thực lại | Bấm xoá vĩnh viễn | Yêu cầu xác thực lại (mật khẩu/OTP/vân tay tuỳ cấu hình) trước khi xoá thật | 🔴 |
| LOG-01 | Admin xem toàn công ty, không giới hạn phòng ban | Admin phòng A xem Nhật Ký Hệ Thống | Thấy log của **mọi phòng ban**, không chỉ phòng A | 🟢 |
| LOG-02 | Tự động chỉ giữ 5.000 dòng gần nhất | Hệ thống có > 5.000 dòng log | Dòng cũ hơn **tự bị dọn**, không cần admin xoá tay | 🟡 |
| LOG-03 | Giới hạn 1.000 dòng/lần tải | Tải log không dùng bộ lọc, có > 1.000 dòng thoả điều kiện | Chỉ trả về tối đa 1.000 dòng | 🟢 |
| USER-BULK-01 | Kiểm tra trùng tên đăng nhập trong danh sách tạm | Thêm 2 người cùng username vào danh sách tạm trước khi Lưu Tất Cả | Báo lỗi trùng **trước khi** gửi lên server | 🟡 |
| USER-BULK-02 | Kiểm tra trùng với tài khoản đã có | Username trong danh sách tạm trùng với tài khoản đã tồn tại trong hệ thống | Báo lỗi rõ ràng, **không tạo** | 🔴 |
| EMAIL-01 | Mô phỏng gửi khi chưa cấu hình SMTP | Chưa nhập SMTP Server, kích hoạt 1 luồng gửi email | Chỉ ghi Nhật Ký Hệ Thống, **không gửi thật**, không lỗi crash | 🟡 |
| EMAIL-02 | Fail-open khi admin CHƯA từng lưu cấu hình tắt email | Module mới chưa từng cấu hình ở "🔔 Thông Báo Email Phê Duyệt" | Email **vẫn gửi** như hành vi gốc (fail-open, không phải fail-closed) | 🔴 Đây là quyết định an toàn có chủ đích — test đảm bảo không bị đảo ngược thành mặc định tắt |
| EMAIL-03 | Tắt rõ ràng vẫn ghi log dù không gọi SMTP | Admin đã lưu tắt "Cần phê duyệt" cho 1 module | Không gửi email thật, nhưng **vẫn ghi đầy đủ** 1 dòng Nhật Ký Hệ Thống | 🟡 |
| EMAIL-04 | 2 family email độc lập nhau | Tắt "Cần phê duyệt" nhưng để BẬT "Kết quả duyệt" cho cùng module | Người duyệt không nhận email nhắc duyệt; người trình **vẫn nhận** email kết quả | 🟡 |
| EXTAUTH-01 | Verify-credentials không cấp phiên đăng nhập | Gọi `/api/external/verify-credentials` đúng tài khoản/mật khẩu | Trả lời đúng/sai, **không có cookie/JWT** nào được set | 🔴 |
| EXTAUTH-02 | Users endpoint không bao giờ kèm mật khẩu | Gọi `/api/external/users` | Response **tuyệt đối không** có field mật khẩu/PIN dù đã hash | 🔴 |
| EXTAUTH-03 | API Key chỉ hiển thị đúng 1 lần | Tạo key mới, rồi tải lại trang/vào lại màn quản lý key | Không xem lại được key thật (chỉ DB hash) | 🔴 |
| EXTAUTH-04 | IP không nằm trong allowlist bị chặn dù key đúng | Gọi API bằng key đúng nhưng từ IP ngoài `allowedIps` đã khai báo | Bị từ chối **403** | 🔴 |
| EXTAUTH-05 | Để trống allowedIps = không hạn chế | Key không khai báo `allowedIps` | Gọi từ **bất kỳ IP nào** cũng được (key đúng là đủ) | 🟡 |
| EXTAUTH-06 | Rate limit đúng ngưỡng | Gọi vượt `EXTERNAL_AUTH_RATE_LIMIT_MAX` trong 15 phút từ cùng IP | Các request vượt ngưỡng bị chặn | 🟡 |
| 2FA-01 | TOTP bắt buộc tự động với admin | Tạo/đăng nhập lần đầu 1 tài khoản có quyền admin, chưa có TOTP | Màn thiết lập TOTP hiện ra **ngay, không thể bỏ qua** | 🔴 |
| 2FA-02 | Tài khoản thường không bị ép TOTP | Tài khoản thường đăng nhập lần đầu | **Không** bị bắt buộc thiết lập TOTP | 🟢 |
| 2FA-03 | WebAuthn cần đăng nhập mật khẩu ít nhất 1 lần trước | Tài khoản chưa từng đăng nhập bằng mật khẩu thử đăng ký vân tay ngay | Bị chặn/yêu cầu đăng nhập mật khẩu trước | 🟡 |
| 2FA-04 | WebAuthn/PWA cần HTTPS thật | Thử đăng ký vân tay trên server chỉ chạy `http://` LAN | Tính năng **không hoạt động** đúng như cảnh báo tài liệu | 🟢 (test môi trường, không phải logic nghiệp vụ) |
| 2FA-05 | Admin thu hồi hộ — chỉ áp dụng đúng phạm vi | Admin thử "bắt buộc bật TOTP" cho 1 tài khoản THƯỜNG | Không có thao tác này — chỉ áp dụng tự động cho `admin` | 🟢 |

---

## 12. BẢNG TỔNG HỢP ƯU TIÊN — TEST TRƯỚC KHI RELEASE (Top rủi ro cao nhất)

Nếu thời gian test có hạn, chạy đúng 20 test case này trước — đây là những chỗ **sai sẽ gây hậu quả tiền bạc/pháp lý/bảo mật thật**, không chỉ lỗi UX:

| Ưu tiên | ID | Vì sao ưu tiên cao nhất |
|---|---|---|
| 1 | LUONG-09 | Bug đã từng gây **mất dữ liệu lương thật** đã nhập tay — regression nghiêm trọng nhất |
| 2 | LUONG-07/08 | Nhân viên nghỉ giữa kỳ — sai sẽ ảnh hưởng **trực tiếp tới lương thật trả cho người lao động** |
| 3 | DH-01/02/03 | Sai ranh giới tier → đơn hàng giá trị lớn **né được lớp duyệt** cần thiết |
| 4 | CL-01/02 | Giả mạo checklist siêu thị khác nếu server tin client |
| 5 | CL-08 | Logic cốt lõi "lỗi nghiêm trọng phủ quyết điểm" sai → sai lệch toàn bộ kết luận kiểm soát |
| 6 | OFF-01/02 | Bỏ sót người kế nhiệm → cả đội nhân viên "mồ côi" quản lý, ảnh hưởng toàn bộ luồng duyệt "Theo vị trí"/KPI liên quan |
| 7 | HDLD-03 | Không khoá được tài khoản/huỷ phiên đăng nhập ngay khi nghỉ việc = **lỗ hổng bảo mật thật** |
| 8 | HD-01→HD-04, TT-03 | Sai luồng thanh toán → tiền chi sai quy trình duyệt |
| 9 | DP-03/04 | Sai mô hình "hàng lơ lửng" → thất thoát/trùng tồn kho đồng phục giữa 2 siêu thị |
| 10 | RPT-01 | Lộ dữ liệu Lương/Hồ Sơ Nhân Sự qua module Báo Cáo chung là rò rỉ dữ liệu nhạy cảm nghiêm trọng |
| 11 | EMAIL-02 | Đảo ngược fail-open thành fail-closed âm thầm chặn mọi email phê duyệt hệ thống |
| 12 | EXTAUTH-01/02 | Lộ mật khẩu/cấp phiên đăng nhập ngoài ý muốn qua API đối tác |
| 13 | WF-01, PQ-04 | Lỗi cấu hình phổ biến nhất theo chính tài liệu — ảnh hưởng gần như MỌI module dùng engine phê duyệt chung |
| 14 | VH-03 | Sai trạng thái tự tính theo cây công việc → báo cáo tiến độ dự án sai lệch |
| 15 | WF-07 | Trùng mã hồ sơ khi tải cao — ảnh hưởng toàn hệ thống, khó phát hiện qua test tuần tự thông thường |

---

## GHI CHÚ THỰC THI

- Nhiều test case ghi rõ **"test qua API trực tiếp"** — bắt buộc dùng Postman/curl thay vì chỉ thao tác qua giao diện, vì tài liệu nhấn mạnh nhiều lần "server tự kiểm tra lại, không chỉ ẩn/hiện nút" — nếu chỉ test qua UI sẽ không phát hiện được lỗ hổng nếu server thiếu kiểm tra.
- Các test case đánh dấu 🔴 liên quan **race condition** (WF-05, WF-07, DH-08...) cần công cụ giả lập tải đồng thời thật (không phải 2 tab tuần tự cách nhau vài giây).
- Các test case "quy tắc mới nhất (v17.x)" (HD-01, TT-03, OFF-05, LUONG-07, LUONG-09...) nên gắn thành **bộ regression test cố định**, chạy lại mỗi lần sửa code liên quan module đó — đây đều là các hành vi đã từng SAI ở version trước, dễ tái phát nếu refactor không cẩn thận.
