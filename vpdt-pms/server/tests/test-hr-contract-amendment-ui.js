// server/tests/test-hr-contract-amendment-ui.js
//
// Regression test cho 3 hàm THUẦN LOGIC mới thêm vào public/js/module-hopdonglaodong.js (9/2026, theo
// yêu cầu người dùng — sửa lỗi "nhập số tiền không có dấu chấm phân cách hàng nghìn" ở phụ lục hợp đồng
// + thêm cảnh báo màu sắc khi hợp đồng sắp/đã hết hiệu lực):
//   - hrcDaysUntilExpiry(endDate): số ngày còn lại tới hạn (âm = đã quá hạn).
//   - hrcExpiryBadgeHtml(c): badge màu (đỏ/vàng) theo hrcDaysUntilExpiry(), chỉ áp dụng hợp đồng ACTIVE.
//   - toggleHrcAmendmentMoneyMode(typeValue): bật/tắt class "money-input" cho 2 ô Giá trị cũ/mới của
//     phụ lục theo nội dung ô "Loại thay đổi" có chứa "lương" hay không (không phân biệt dấu/hoa-thường).
//
// module-hopdonglaodong.js là script trình duyệt THUẦN (không module.exports, phụ thuộc DOM/window toàn
// cục) — KHÔNG require() thẳng được. Nạp qua vm.runInContext() với 1 "document" giả tối thiểu (chỉ
// getElementById() trả về 1 object thuần lưu state, đủ cho 3 hàm trên — các hàm KHÁC trong file phụ
// thuộc DB/currentUser/fetch/... không được gọi tới trong bài test này nên không cần stub thêm).
// KHÔNG thay thế được kiểm thử qua trình duyệt thật (sandbox này không có SQL Server nên không dựng được
// server thật để Playwright đăng nhập — xem tests/_harness-contract.js chỉ hỗ trợ 3 module đã có sẵn mock
// backend, chưa có laborContracts) — chỉ xác nhận ĐÚNG LOGIC thuần, không xác nhận layout/CSS thật.
//
// Chạy: node server/tests/test-hr-contract-amendment-ui.js
'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { createRunner, assertEqual } = require('./testHarness');

function makeFakeElement() {
  return {
    value: '', placeholder: '',
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); }
    }
  };
}

function loadSandbox() {
  const elements = {};
  const sandbox = {
    document: { getElementById: (id) => (elements[id] || (elements[id] = makeFakeElement())) },
    console
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/module-hopdonglaodong.js'), 'utf8');
  // formatMoneyDisplay() thật nằm ở core.js (dùng CHUNG toàn hệ thống) — module-hopdonglaodong.js gọi nó
  // như 1 global có sẵn khi chạy trong trình duyệt thật (core.js nạp trước). Stub lại ĐÚNG NGUYÊN VĂN
  // logic ở public/js/core.js::formatMoneyDisplay() (chỉ 1 hàm 3 dòng, ổn định lâu năm) để tránh phải
  // nạp toàn bộ core.js (file rất lớn, có code top-level đụng DOM thật ngoài phạm vi bài test này).
  sandbox.formatMoneyDisplay = (raw) => {
    const digits = String(raw ?? '').replace(/\D/g, '');
    return digits ? Number(digits).toLocaleString('vi-VN') : '';
  };
  vm.runInContext(src, sandbox, { filename: 'module-hopdonglaodong.js' });
  return { sandbox, elements };
}

async function main() {
  const run = createRunner();

  await run.run('hrcDaysUntilExpiry(): tính đúng số ngày còn lại (dương = còn hạn, âm = đã quá hạn)', () => {
    const { sandbox } = loadSandbox();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const iso = (d) => d.toISOString().slice(0, 10);
    const in10 = new Date(today); in10.setDate(in10.getDate() + 10);
    const ago5 = new Date(today); ago5.setDate(ago5.getDate() - 5);
    assertEqual(sandbox.hrcDaysUntilExpiry(iso(today)), 0, 'Đúng hôm nay -> 0 ngày');
    assertEqual(sandbox.hrcDaysUntilExpiry(iso(in10)), 10, 'Còn 10 ngày -> trả đúng 10');
    assertEqual(sandbox.hrcDaysUntilExpiry(iso(ago5)), -5, 'Đã quá 5 ngày -> trả đúng -5 (âm)');
    assertEqual(sandbox.hrcDaysUntilExpiry(null), null, 'Không có endDate -> null');
    assertEqual(sandbox.hrcDaysUntilExpiry('không-phải-ngày'), null, 'Chuỗi không hợp lệ -> null (không throw)');
  });

  await run.run('hrcExpiryBadgeHtml(): chỉ cảnh báo hợp đồng ACTIVE có endDate, đúng ngưỡng màu đỏ/vàng', () => {
    const { sandbox } = loadSandbox();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const iso = (offsetDays) => { const d = new Date(today); d.setDate(d.getDate() + offsetDays); return d.toISOString().slice(0, 10); };

    assertEqual(sandbox.hrcExpiryBadgeHtml({ status: 'ACTIVE', endDate: null }), '', 'Vô thời hạn (endDate null) -> không cảnh báo');
    assertEqual(sandbox.hrcExpiryBadgeHtml({ status: 'DRAFT', endDate: iso(3) }), '', 'Hợp đồng DRAFT (chưa hiệu lực) -> không cảnh báo dù gần hạn');
    assertEqual(sandbox.hrcExpiryBadgeHtml({ status: 'TERMINATED', endDate: iso(-5) }), '', 'Hợp đồng đã TERMINATED -> không cảnh báo (đã xử lý xong)');

    const farBadge = sandbox.hrcExpiryBadgeHtml({ status: 'ACTIVE', endDate: iso(60) });
    assertEqual(farBadge, '', 'Còn 60 ngày (xa hạn) -> chưa cảnh báo');

    const amberBadge = sandbox.hrcExpiryBadgeHtml({ status: 'ACTIVE', endDate: iso(20) });
    assertEqual(amberBadge.includes('amber'), true, 'Còn 20 ngày (≤30) -> phải là badge màu VÀNG (amber)');
    assertEqual(amberBadge.includes('20 ngày'), true, 'Phải nêu đúng số ngày còn lại');

    const redSoonBadge = sandbox.hrcExpiryBadgeHtml({ status: 'ACTIVE', endDate: iso(3) });
    assertEqual(redSoonBadge.includes('red'), true, 'Còn 3 ngày (≤7) -> phải là badge màu ĐỎ (khẩn cấp)');

    const redExpiredBadge = sandbox.hrcExpiryBadgeHtml({ status: 'ACTIVE', endDate: iso(-4) });
    assertEqual(redExpiredBadge.includes('red'), true, 'Đã quá hạn 4 ngày -> phải là badge màu ĐỎ');
    assertEqual(redExpiredBadge.includes('Đã hết hạn'), true, 'Đã quá hạn -> phải ghi rõ "Đã hết hạn"');
  });

  await run.run('toggleHrcAmendmentMoneyMode(): bật money-input khi "Loại thay đổi" nhắc tới lương, tắt khi không', () => {
    const { sandbox, elements } = loadSandbox();
    const oldEl = elements['hrcNewAmendmentOld'] = makeFakeElement();
    const newEl = elements['hrcNewAmendmentNew'] = makeFakeElement();
    oldEl.value = '10000000';
    newEl.value = '12000000';

    sandbox.toggleHrcAmendmentMoneyMode('Tăng lương');
    assertEqual(oldEl.classList.contains('money-input'), true, '"Tăng lương" -> bật money-input cho ô Giá trị cũ');
    assertEqual(newEl.classList.contains('money-input'), true, '"Tăng lương" -> bật money-input cho ô Giá trị mới');
    assertEqual(oldEl.value, '10.000.000', 'Phải tự định dạng lại giá trị đang có sẵn khi bật money mode');
    assertEqual(oldEl.placeholder, 'Lương cũ (đ)', 'Placeholder phải đổi thành gợi ý tiền tệ');

    // Không dấu (gõ không bỏ dấu tiếng Việt) vẫn phải nhận diện đúng.
    sandbox.toggleHrcAmendmentMoneyMode('dieu chinh luong co ban');
    assertEqual(oldEl.classList.contains('money-input'), true, 'Không dấu ("luong") vẫn phải nhận diện đúng là liên quan lương');

    // Loại thay đổi KHÔNG liên quan lương -> tắt money-input, giữ nguyên giá trị đã gõ.
    sandbox.toggleHrcAmendmentMoneyMode('Thay đổi chức danh');
    assertEqual(oldEl.classList.contains('money-input'), false, '"Thay đổi chức danh" -> KHÔNG bật money-input (tránh phá dữ liệu chữ)');
    assertEqual(oldEl.placeholder, 'Giá trị cũ', 'Placeholder phải trở lại trung tính');

    sandbox.toggleHrcAmendmentMoneyMode('');
    assertEqual(oldEl.classList.contains('money-input'), false, 'Loại thay đổi rỗng -> mặc định KHÔNG bật money-input');
  });

  run.summary();
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
