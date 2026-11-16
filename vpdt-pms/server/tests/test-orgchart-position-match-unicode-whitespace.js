// tests/test-orgchart-position-match-unicode-whitespace.js — Regression cho LỖI ĐÃ VÁ (12/2026, người
// dùng báo "Nhập Excel Gán Chức Vụ Hàng Loạt" báo KHÔNG khớp vị trí dù nhìn bằng mắt giống hệt tên trong
// Cơ Cấu Tổ Chức đang áp dụng, VD "Trưởng Quầy (TPTS)" tại "Siêu thị số 275 Nguyễn Trãi"): so khớp CŨ ở
// orgChart.findPositionNodeForUser() dùng `!==`/`===` NGUYÊN VĂN (byte-exact) — 2 chuỗi giống hệt trên
// màn hình vẫn có thể khác byte vì khoảng trắng kép/NBSP (hay dính khi copy từ Excel) hoặc khác DẠNG
// CHUẨN HOÁ UNICODE (NFC/NFD, cùng 1 chữ có dấu nhưng khác chuỗi byte tuỳ nguồn tạo ra). Đã vá bằng
// normalizeMatchText() (chuẩn hoá NFC + gộp khoảng trắng + trim) áp dụng cho CẢ 2 vế trước khi so khớp.
//
// Chạy: node tests/test-orgchart-position-match-unicode-whitespace.js
'use strict';
const orgChart = require('../lib/orgChart');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const deptNameNFC = 'Siêu thị số 275 Nguyễn Trãi'.normalize('NFC');
const jobTitleNFC = 'Trưởng Quầy (TPTS)'.normalize('NFC');
const version = {
  nodes: [
    { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY' },
    { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', departmentRef: deptNameNFC },
    { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', jobTitle: jobTitleNFC, requiresDept: true }
  ]
};

const deptFromExcel = 'Siêu thị số  275 Nguyễn Trãi'.normalize('NFD'); // khoảng trắng kép + NFD
const jobTitleFromExcel = ('Trưởng Quầy' + ' ' + '(TPTS)').normalize('NFD'); // NBSP + NFD

check('Khớp được vị trí dù khác chuẩn hoá Unicode (NFC/NFD) + khoảng trắng kép/NBSP (LỖI ĐÃ VÁ)',
  orgChart.findPositionNodeForUser(version, { dept: deptFromExcel, jobTitle: jobTitleFromExcel })?.nodeId === 3);

check('Tên chức danh THỰC SỰ khác (không phải vấn đề Unicode) vẫn KHÔNG khớp nhầm',
  orgChart.findPositionNodeForUser(version, { dept: deptNameNFC, jobTitle: 'Trưởng quầy' }) === null);

check('Phòng ban THỰC SỰ khác vẫn KHÔNG khớp nhầm',
  orgChart.findPositionNodeForUser(version, { dept: 'Siêu thị khác', jobTitle: jobTitleNFC }) === null);

// requiresDept === false (VD Tổng Giám Đốc) vẫn khớp đúng dù dept truyền vào khác chuẩn hoá/khoảng trắng
const versionNoDept = {
  nodes: [
    { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY' },
    { nodeId: 2, parentNodeId: 1, nodeType: 'POSITION', jobTitle: 'Tổng Giám Đốc'.normalize('NFC'), requiresDept: false }
  ]
};
check('Vị trí requiresDept=false vẫn khớp đúng khi jobTitle khác chuẩn hoá Unicode',
  orgChart.findPositionNodeForUser(versionNoDept, { jobTitle: ('Tổng  Giám Đốc').normalize('NFD') })?.nodeId === 2);

console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
process.exitCode = fail ? 1 : 0;
