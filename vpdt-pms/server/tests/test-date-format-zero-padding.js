// server/tests/test-date-format-zero-padding.js
//
// Regression cho lỗi người dùng báo cáo (10/2026): định dạng ngày giờ hệ thống phải là dd/mm/yyyy (có số
// 0 đệm ở đầu ngày/tháng), nhưng new Date().toLocaleString('vi-VN') (dùng trong mọi hàm nowVN() server +
// mọi hiển thị ngày giờ phía client) KHÔNG đệm số 0 — VD "8:5:3 9/10/2026" thay vì "08:05:03 09/10/2026".
// Thứ tự ngày/tháng vốn đã đúng (vi-VN locale), chỉ thiếu đệm số 0.
//
// ĐÃ VÁ: mọi lệnh gọi `.toLocaleString('vi-VN')`/`.toLocaleDateString('vi-VN')` trên 1 giá trị Date (cả
// server lib/*.js, routes/*.js lẫn client public/js/*.js) nay truyền thêm option
// { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second:
// '2-digit', hour12: false } (bản toLocaleDateString chỉ cần day/month/year, không có giờ). CHỈ áp dụng
// cho lệnh gọi trên Date — các lệnh `.toLocaleString('vi-VN')` format SỐ TIỀN/SỐ LƯỢNG (Number) giữ
// NGUYÊN không đổi (thêm option ngày giờ vào 1 Number không đổi kết quả theo đặc tả ECMA-402, nhưng vẫn
// cố tình KHÔNG thêm vào các chỗ đó để code rõ nghĩa — xem lib/payroll.js, public/js/core.js
// formatMoneyDisplay()...).
//
// Không đổi 2 chỗ dùng toLocaleDateString('en-CA') (module-muahang.js/module-itsupport-price.js) — khác
// locale, phục vụ so sánh chuỗi DATE_RE phía server, không phải hiển thị.
//
// Chạy: node server/tests/test-date-format-zero-padding.js
'use strict';
const assert = require('assert');
const { defaultNotification } = require('../lib/notifications');

function check(results, name, cond, detail) { results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') }); }

function main() {
  const results = [];

  // Ngày/giờ có thành phần 1 chữ số (mùng 9, tháng 10 -> "9/10" không đệm; 8h đồng hồ/phút/giây 1 chữ số).
  const d = new Date(2026, 9, 9, 8, 5, 3); // 09/10/2026 08:05:03 (tháng 0-based)
  const out = d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  check(results, 'toLocaleString("vi-VN", opts) đệm số 0 cho ngày/tháng/giờ/phút/giây 1 chữ số',
    out === '08:05:03 09/10/2026', `thực tế "${out}"`);

  // nowVN() (server, lib/notifications.js, gọi gián tiếp qua defaultNotification()) phải khớp định dạng
  // "HH:MM:SS DD/MM/YYYY" đã đệm số 0.
  const now = defaultNotification('u1', 'TEST', 'Tiêu đề', 'Nội dung', null).createdAt;
  check(results, 'nowVN() (lib/notifications.js) sinh đúng khuôn "HH:MM:SS DD/MM/YYYY" (2 chữ số mỗi phần)',
    /^\d{2}:\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/.test(now), `thực tế "${now}"`);

  // parseVNDateTime() (lib/recordActions.js) vẫn đọc đúng chuỗi ĐÃ đệm số 0 (tương thích ngược 2 chiều —
  // chuỗi CŨ chưa đệm và chuỗi MỚI đã đệm đều parse ra cùng 1 thời điểm).
  const { parseVNDateTime } = (() => {
    // parseVNDateTime không export — sao y logic parse tối thiểu để đối chiếu round-trip (không tạo phụ
    // thuộc 2 chiều vào file nội bộ của lib/recordActions.js).
    function parseVNDateTime(str) {
      const parts = String(str).trim().split(' ');
      if (parts.length !== 2) return null;
      const [timePart, datePart] = parts;
      const [h, mi, s] = timePart.split(':').map(Number);
      const [d2, mo, y] = datePart.split('/').map(Number);
      return new Date(y, mo - 1, d2, h || 0, mi || 0, s || 0);
    }
    return { parseVNDateTime };
  })();
  const roundTrip = parseVNDateTime(out);
  check(results, 'Chuỗi đã đệm số 0 parse ngược lại ĐÚNG cùng thời điểm gốc (tương thích ngược)',
    roundTrip.getTime() === d.getTime(), `thực tế ${roundTrip && roundTrip.toISOString()}`);

  let pass = 0;
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}${r.pass ? '' : ' -> ' + r.detail}`);
    if (r.pass) pass++;
  }
  console.log(`\n${pass}/${results.length} passed.`);
  if (pass !== results.length) process.exit(1);
}

main();
