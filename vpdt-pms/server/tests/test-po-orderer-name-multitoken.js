// server/tests/test-po-orderer-name-multitoken.js
//
// Regression cho bug "Người đặt" bị cắt mất từ cuối khi import PDF Phiếu Đặt Hàng NCC (Vận Hành >
// 📦 Đơn Hàng, module-vanhanh.js) — người dùng báo cáo kèm 2 ảnh chụp độc lập (HCRC-KSCSVH-DH-HO-004 và
// -001) đều hiện "Người đặt: Nguyễn Thị Huyền" trong khi tên đầy đủ trên header là "Nguyễn Thị Huyền
// Nhung". Gốc rễ: poFindValueAfterLabel() (hàm CŨ) chỉ lấy ĐÚNG 1 token ngay sau nhãn "Người đặt:" —
// đúng với đa số phiếu vì PDF.js thường gộp cả cụm tên vào 1 text-run/1 token (xem fixture thật
// operation-order-po-sample-2.pdf: "Nguyễn Thị Hương" ra đúng 1 token), nhưng 1 số phiếu (tuỳ engine
// xuất PDF của NCC) tách tên thành NHIỀU text-run liền kề trên cùng 1 dòng — từ cuối bị cắt mất.
//
// Bản vá: poFindMultiTokenValueAfterLabel() ghép mọi token liên tiếp sau nhãn cho tới khi gặp 1 token
// khác trông như nhãn trường kế tiếp (kết thúc bằng ':') hoặc hết dòng — áp dụng cho ordererName.
//
// Test THUẦN đơn vị (không cần PDF thật) — nạp đúng khối mã PO_* từ module-vanhanh.js vào vm.Context
// (cùng kỹ thuật tests/test-operation-order-pdf-hdmuachung.js) rồi gọi trực tiếp các hàm trên `lines`
// giả lập, mô phỏng CHÍNH XÁC cách poExtractLines() tách PDF content-stream thành dòng/token.
//
// Chạy: node server/tests/test-po-orderer-name-multitoken.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function check(results, name, cond, detail) { results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') }); }

function loadPoFunctions() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'module-vanhanh.js'), 'utf8');
  const start = src.indexOf('const PO_CHAR_FIXED_MAP');
  const end = src.indexOf('// Điền field đơn');
  if (start === -1 || end === -1) throw new Error('Không tìm thấy khối mã PO_* trong module-vanhanh.js (có thể đã đổi tên/cấu trúc)');
  const snippet = src.slice(start, end);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(snippet, sandbox);
  return sandbox;
}

function main() {
  const results = [];
  const fns = loadPoFunctions();

  // ===== 1) Đúng kịch bản lỗi người dùng báo cáo: tên bị PDF tách thành 2 token liền kề trên cùng 1
  // dòng với nhãn — "Nguyễn Thị Huyền" (token 1) + "Nhung" (token 2) =====
  const linesSplitName = [
    ['Mã số thuế:', '0108432911'],
    ['Người đặt:', 'Nguyễn Thị Huyền', 'Nhung'],
    ['phiếu đặt hàng', 'Tại trạm:', 'BRVANHANH19'],
  ];
  check(results, 'poFindMultiTokenValueAfterLabel: ghép đủ tên bị PDF tách 2 token ("Nguyễn Thị Huyền Nhung")',
    fns.poFindMultiTokenValueAfterLabel(linesSplitName, 'Người đặt:') === 'Nguyễn Thị Huyền Nhung',
    `thực tế "${fns.poFindMultiTokenValueAfterLabel(linesSplitName, 'Người đặt:')}"`);
  // Hàm CŨ (còn giữ, dùng cho field khác) vẫn cắt mất — xác nhận ĐÚNG hành vi lỗi cũ để đối chiếu, không
  // phải lỗi của bản vá nếu assertion này pass (nó CHỨNG MINH bug tồn tại trước khi vá đúng chỗ nghi ngờ).
  check(results, 'poFindValueAfterLabel (hàm cũ): xác nhận ĐÚNG là nó cắt mất từ cuối (lý do cần hàm mới)',
    fns.poFindValueAfterLabel(linesSplitName, 'Người đặt:') === 'Nguyễn Thị Huyền',
    `thực tế "${fns.poFindValueAfterLabel(linesSplitName, 'Người đặt:')}"`);

  // ===== 2) Tên dài hơn, bị tách thành 3 token (giả định engine xuất PDF tách theo mỗi lần đổi
  // font/kerning) — vẫn phải ghép đủ =====
  const linesSplit3 = [['Người đặt:', 'Trần Văn', 'Minh', 'Đức']];
  check(results, 'poFindMultiTokenValueAfterLabel: ghép đủ tên bị tách 3 token ("Trần Văn Minh Đức")',
    fns.poFindMultiTokenValueAfterLabel(linesSplit3, 'Người đặt:') === 'Trần Văn Minh Đức',
    `thực tế "${fns.poFindMultiTokenValueAfterLabel(linesSplit3, 'Người đặt:')}"`);

  // ===== 3) Phòng thủ: nếu nhãn trường KHÁC lỡ nằm chung 1 dòng ngay sau tên (kịch bản không xảy ra ở 2
  // mẫu PDF đã xác nhận, nhưng đề phòng mẫu khác trong tương lai) — PHẢI dừng lại đúng chỗ, không nuốt
  // nhầm "Tại trạm:"/giá trị của nó vào tên =====
  const linesSharedLine = [['Người đặt:', 'Nguyễn Thị Huyền', 'Nhung', 'Tại trạm:', 'BRVANHANH19']];
  check(results, 'poFindMultiTokenValueAfterLabel: dừng đúng chỗ khi 1 nhãn khác (":") nằm chung dòng, không nuốt nhầm field kế tiếp',
    fns.poFindMultiTokenValueAfterLabel(linesSharedLine, 'Người đặt:') === 'Nguyễn Thị Huyền Nhung',
    `thực tế "${fns.poFindMultiTokenValueAfterLabel(linesSharedLine, 'Người đặt:')}"`);

  // ===== 4) Trường hợp đa số hiện tại — chỉ 1 token (PDF gộp sẵn cả cụm tên) — PHẢI giống hệt hành vi
  // cũ, không có gì thay đổi (regression an toàn) =====
  const linesSingleToken = [['Người đặt:', 'Nguyễn Thị Hương']];
  check(results, 'poFindMultiTokenValueAfterLabel: trường hợp 1 token (đa số hiện tại) không đổi hành vi',
    fns.poFindMultiTokenValueAfterLabel(linesSingleToken, 'Người đặt:') === 'Nguyễn Thị Hương',
    `thực tế "${fns.poFindMultiTokenValueAfterLabel(linesSingleToken, 'Người đặt:')}"`);

  // ===== 5) Không tìm thấy nhãn -> chuỗi rỗng, không throw =====
  check(results, 'poFindMultiTokenValueAfterLabel: không có nhãn -> rỗng, không throw',
    fns.poFindMultiTokenValueAfterLabel([['Khác:', 'X']], 'Người đặt:') === '', 'khác rỗng');

  // ===== 6) Tích hợp đầy đủ qua parsePoLinesToFields() — xác nhận field ordererName thật sự đã đổi sang
  // dùng hàm mới (không chỉ hàm con đúng mà quên wire vào chỗ gọi) =====
  const fullLines = [
    ['Số Đơn:', 'HCRC-TEST-001'],
    ['Người đặt:', 'Nguyễn Thị Huyền', 'Nhung'],
    ['Tại trạm:', 'BRVANHANH19'],
  ];
  const f = fns.parsePoLinesToFields(fullLines);
  check(results, 'parsePoLinesToFields(): f.ordererName dùng đúng hàm mới, ghép đủ tên',
    f.ordererName === 'Nguyễn Thị Huyền Nhung', `thực tế "${f.ordererName}"`);
  check(results, 'parsePoLinesToFields(): các field khác không bị ảnh hưởng (stationCode vẫn đọc đúng)',
    f.stationCode === 'BRVANHANH19', `thực tế "${f.stationCode}"`);

  let pass = 0;
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}${r.pass ? '' : ' -> ' + r.detail}`);
    if (r.pass) pass++;
  }
  console.log(`\n${pass}/${results.length} passed.`);
  if (pass !== results.length) process.exit(1);
}

main();
