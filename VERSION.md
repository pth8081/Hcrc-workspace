# Phiên bản hiện tại

**1.86.2** — đã merge vào `main` (nguồn: `server/package.json`, field `version`, cũng là số hiển thị ở
badge góc màn hình + `/api/health`).

## Cập nhật gần nhất (PR #181 → #183, nhánh `claude/chao-ban-oo5ijl`)

Tính năng: **Văn Bản Trình — Bộ phận Trợ Lý/Thư Ký đề xuất thay thế toàn bộ tờ trình**

| PR | Version | Nội dung |
|----|---------|----------|
| [#181](https://github.com/pth8081/vpdt-dms/pull/181) | 1.86.0 | Tính năng chính: ở bước Bộ phận Trợ Lý/Thư Ký, nút "Yêu Cầu Bổ Sung" mở hộp lựa chọn — Hủy (luồng cũ) / Đồng ý (upload tệp thay thế, người trình xác nhận). |
| [#182](https://github.com/pth8081/vpdt-dms/pull/182) | 1.86.1 | Fix: form upload tệp tự đóng khi thiếu tệp (phát hiện qua kiểm thử giao diện thật). |
| [#183](https://github.com/pth8081/vpdt-dms/pull/183) | 1.86.2 | Gắn tên tệp trực tiếp vào từng dòng lịch sử để lưu vết đầy đủ (đề xuất/đồng ý/từ chối). |

Đã kiểm thử: 25 file `tests/test-*.js` (525+ kịch bản) pass sau mỗi lần merge, cộng thêm 2 vòng kiểm tra
trực quan trên giao diện thật (Playwright, click UI thật) xác nhận toàn bộ luồng chạy đúng cả 2 nhánh.

## Deploy impact
- Không đổi `server/sql/schema.sql`.
- Không thêm biến môi trường mới.
- Không thêm/đổi `dependencies` trong `server/package.json` (chỉ đổi field `version`).
- Chỉ cần copy code + `pm2 restart` theo quy trình cập nhật hiện có.

---
_File này được cập nhật thủ công mỗi lần merge — xem lịch sử commit trên GitHub để biết chi tiết đầy đủ hơn._
