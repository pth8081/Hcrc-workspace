// server/tests/test-hr-contract-amendment-ui.js
//
// Regression test cho 3 hàm THUẦN LOGIC mới thêm vào public/js/module-hopdonglaodong.js (9/2026, theo
// yêu cầu người dùng — sửa lỗi "nhập số tiền không có dấu chấm phân cách hàng nghìn" ở phụ lục hợp đồng
// + thêm cảnh báo màu sắc khi hợp đồng sắp/đã hết hiệu lực):
//   - hrcDaysUntilExpiry(endDate): số ngày còn lại tới hạn (âm = đã quá hạn).
//   - hrcExpiryBadgeHtml(c): badge màu (đỏ/vàng) theo hrcDaysUntilExpiry(), chỉ áp dụng hợp đồng ACTIVE.
//   - toggleHrcAmendmentMoneyMode(): bật/tắt class "money-input" cho 2 ô Giá trị cũ/mới của phụ lục theo
//     checkbox tường minh #hrcNewAmendmentIsMoney (9/2026 — thay cho đoán theo nội dung "Loại thay đổi",
//     không đáng tin vì người dùng có thể gõ Giá trị cũ/mới TRƯỚC khi gõ Loại thay đổi).
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
      contains(c) { return this._set.has(c); },
      toggle(c, force) {
        const on = force !== undefined ? force : !this._set.has(c);
        if (on) this._set.add(c); else this._set.delete(c);
        return on;
      }
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

  await run.run('toggleHrcAmendmentMoneyMode(): bật/tắt money-input theo checkbox tường minh (không đoán theo "Loại thay đổi" nữa)', () => {
    const { sandbox, elements } = loadSandbox();
    const oldEl = elements['hrcNewAmendmentOld'] = makeFakeElement();
    const newEl = elements['hrcNewAmendmentNew'] = makeFakeElement();
    const checkboxEl = elements['hrcNewAmendmentIsMoney'] = makeFakeElement();
    oldEl.value = '10000000';
    newEl.value = '12000000';

    // Checkbox BẬT (mặc định) -> money-input bật cho CẢ 2 ô, dù "Loại thay đổi" chưa gõ gì/không liên
    // quan lương -> đúng bug người dùng báo cáo (gõ Giá trị TRƯỚC khi gõ Loại thay đổi vẫn được định
    // dạng ngay, không còn phụ thuộc thứ tự gõ).
    checkboxEl.checked = true;
    sandbox.toggleHrcAmendmentMoneyMode();
    assertEqual(oldEl.classList.contains('money-input'), true, 'Checkbox bật -> money-input bật cho ô Giá trị cũ');
    assertEqual(newEl.classList.contains('money-input'), true, 'Checkbox bật -> money-input bật cho ô Giá trị mới');
    assertEqual(oldEl.value, '10.000.000', 'Phải tự định dạng lại giá trị đang có sẵn khi bật money mode');
    assertEqual(oldEl.placeholder, 'Giá trị cũ (đ)', 'Placeholder phải gợi ý đơn vị tiền tệ');

    // Người dùng tự TẮT checkbox (VD cần gõ chữ tự do như đổi chức danh) -> tắt money-input.
    checkboxEl.checked = false;
    sandbox.toggleHrcAmendmentMoneyMode();
    assertEqual(oldEl.classList.contains('money-input'), false, 'Checkbox tắt -> KHÔNG còn money-input (cho phép gõ chữ tự do)');
    assertEqual(oldEl.placeholder, 'Giá trị cũ', 'Placeholder phải trở lại trung tính');
  });

  // LỖI ĐÃ VÁ (rà soát chuyên sâu Nhân Sự, 9/2026): saveHrContractEdit() trước đây LUÔN đọc cả
  // #hrcEditEndDate lẫn #hrcEditBaseSalary bất kể form đang hiện đang có ô nào — an toàn khi cả 2 ô
  // cùng tồn tại (khối DRAFT "Hoàn thiện trước khi kích hoạt"), nhưng nếu tái dùng hàm cho 1 form CHỈ
  // có ô Lương cơ bản (khối ACTIVE mới thêm "💰 Cập Nhật Lương Cơ Bản") thì endDate bị đọc ra null rồi
  // GỬI LÊN payload — applyManualEdit() coi field có mặt trong payload (dù null) là lệnh xoá field đó,
  // nghĩa là mỗi lần HR chỉ định cập nhật lương cho hợp đồng ACTIVE sẽ vô tình XOÁ MẤT Ngày hết hạn hợp
  // đồng. Test này xác nhận payload gửi lên CHỈ chứa đúng field có mặt trên form.
  await run.run('saveHrContractEdit(): chỉ gửi field ĐANG CÓ trên form — không vô tình gửi endDate=null khi form chỉ có ô Lương cơ bản (khối ACTIVE)', async () => {
    const { sandbox, elements } = loadSandbox();
    // loadSandbox()'s document.getElementById() TỰ TẠO 1 element giả rỗng cho id chưa có (auto-vivify)
    // — khác hành vi document.getElementById() THẬT (trả về null nếu element không tồn tại trên trang).
    // Ghi đè lại ĐÚNG hành vi thật ở riêng bài test này để mô phỏng chính xác trường hợp khối ACTIVE
    // không render input #hrcEditEndDate ra DOM (không chỉ là "input rỗng").
    sandbox.document.getElementById = (id) => (id in elements ? elements[id] : null);
    const calls = [];
    sandbox.callRecordAction = async (collection, id, action, payload) => {
      calls.push({ collection, id, action, payload });
      return { item: { id, code: 'HD-TEST' } };
    };
    sandbox.getMoneyValue = (input) => {
      if (!input) return 0;
      return Number(String(input.value || '').replace(/\D/g, '')) || 0;
    };
    // Stub 2 hàm sau khi đã nạp module (ghi đè function declaration) để cô lập, không cần DOM/DB thật.
    sandbox.hrcApplyUpdate = () => {};
    sandbox.openHrContractDetailModal = () => {};

    // Kịch bản 1: form ACTIVE — CHỈ có ô Lương cơ bản, KHÔNG có ô Ngày hết hạn trên trang.
    elements['hrcEditBaseSalary'] = makeFakeElement();
    elements['hrcEditBaseSalary'].value = '15000000';
    await sandbox.saveHrContractEdit(42);
    assertEqual(calls.length, 1, 'phải gọi callRecordAction đúng 1 lần');
    assertEqual('endDate' in calls[0].payload, false, 'payload KHÔNG được có key "endDate" khi form không có ô Ngày hết hạn (tránh vô tình xoá)');
    assertEqual(calls[0].payload.baseSalary, 15000000, 'payload phải có đúng Lương cơ bản mới');
    assertEqual(calls[0].action, 'edit', 'phải gọi đúng action "edit"');

    // Kịch bản 2: form DRAFT — có CẢ 2 ô, cả 2 đều phải có mặt trong payload như hành vi cũ.
    calls.length = 0;
    elements['hrcEditEndDate'] = makeFakeElement();
    elements['hrcEditEndDate'].value = '2027-01-01';
    await sandbox.saveHrContractEdit(42);
    assertEqual('endDate' in calls[0].payload, true, 'form DRAFT có ô Ngày hết hạn -> payload phải có key "endDate"');
    assertEqual(calls[0].payload.endDate, '2027-01-01', 'endDate gửi lên phải đúng giá trị đã nhập');
    assertEqual(calls[0].payload.baseSalary, 15000000, 'baseSalary vẫn đúng khi cả 2 ô cùng có mặt');
  });

  run.summary();
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
