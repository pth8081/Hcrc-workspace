// server/tests/test-orgchart-headcount-breakdown-columns.js
//
// Đợt việc 11/2026 ĐỢT 2 (theo yêu cầu người dùng, kèm ảnh chụp "Báo Cáo Định Biên Nhân Sự bạn còn thiếu
// các cột..."): bổ sung 3 cột breakdown vào "📋 Báo Cáo Định Biên Nhân Sự" — Kiêm Nhiệm / Đang Bàn Giao
// Nghỉ Việc / Thai Sản-Nghỉ Ốm — tách ra từ đúng số đã gộp sẵn trong "Thực Tế" (computePositionStats() ở
// lib/headcountReport.js, không đổi cách tính). Xác nhận qua AskUserQuestion (demo HTML kèm công tắc so
// sánh 2 công thức) với 4 quyết định:
//   1. Cột "Thực Tế" GIỮ NGUYÊN ý nghĩa cũ (tổng tất cả, gồm cả Kiêm Nhiệm×0.5) — không đổi số đang hiện.
//   2. Cột "Chênh Lệch" đổi công thức: KHÔNG còn trừ Kiêm Nhiệm nữa — Chênh Lệch = Định Biên − (Đang làm
//      việc + Đang bàn giao nghỉ việc + Thai sản/nghỉ ốm). Từ đợt này, Chênh Lệch KHÔNG còn khớp số học
//      với "Định Biên − Thực Tế" nữa (cố ý, Thực Tế vẫn gồm Kiêm Nhiệm còn Chênh Lệch thì không).
//   3. Chỉ 3 cột mới (không phải 4) — "cột nghỉ thai sản tiếp theo" trong yêu cầu chỉ là lời dẫn, không
//      phải 1 cột riêng.
//   4. Áp dụng ở CẢ 4 nơi: màn xem (#orgChartHeadcountTableBody), Xuất Excel (buildFlatHeadcountReportWorkbook),
//      Tải Mẫu Định Biên (buildHeadcountTemplateWorkbook — 3 cột THAM KHẢO, không đọc lại lúc nhập), Nhập
//      Định Biên (parseHeadcountTemplateBuffer không đổi gì — vẫn chỉ đọc "ID"/"Định Biên Mới").
//
// Phạm vi test:
//   1. computePositionStats() (qua computeHeadcountReport()): Thực Tế (actualTotal) KHÔNG đổi (vẫn gồm
//      Kiêm Nhiệm); Chênh Lệch (variance) đổi công thức, KHÔNG trừ Kiêm Nhiệm nữa — xác nhận 2 cột KHÔNG
//      còn khớp số học khi Kiêm Nhiệm > 0.
//   2. Cộng dồn (DEPARTMENT/COMPANY) cũng áp dụng ĐÚNG công thức Chênh Lệch mới (không chỉ node lá).
//   3. buildFlatHeadcountReportWorkbook(): đủ 3 cột mới đúng vị trí (sau "Thực tế", trước "Chênh lệch"),
//      đúng giá trị ở dòng root/group/position.
//   4. buildHeadcountTemplateWorkbook(): đủ 3 cột THAM KHẢO đúng giá trị, "Định Biên Mới (*)" vẫn ở cột
//      cuối, parseHeadcountTemplateBuffer() round-trip vẫn hoạt động bình thường (bỏ qua 3 cột tham khảo,
//      không bị ảnh hưởng gì bởi việc thêm cột).
//
// Chạy: node server/tests/test-orgchart-headcount-breakdown-columns.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');
const orgChart = require('../lib/orgChart');
const { computeHeadcountReport, buildFlatGroupedHeadcountReport, buildFlatHeadcountReportWorkbook } = require('../lib/headcountReport');
const { buildHeadcountTemplateWorkbook, parseHeadcountTemplateBuffer } = require('../lib/orgChartHeadcountImport');

function buildVersion() {
  const v = { id: 1, versionName: 'Test', status: 'DRAFT', nodes: [], kpiFlow: [] };
  const root = orgChart.addNode(v, { parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty' });
  const phong = orgChart.addNode(v, { parentNodeId: root.nodeId, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kinh Doanh', departmentRef: 'Phòng Kinh Doanh' });
  const posBanHang = orgChart.addNode(v, { parentNodeId: phong.nodeId, nodeType: 'POSITION', jobTitle: 'Nhân viên bán hàng', headcountQuota: 7 });
  const posThuNgan = orgChart.addNode(v, { parentNodeId: phong.nodeId, nodeType: 'POSITION', jobTitle: 'Thu ngân', headcountQuota: 4 });
  return { v, phong, posBanHang, posThuNgan };
}

async function main() {
  const run = createRunner();
  const { v, phong, posBanHang, posThuNgan } = buildVersion();

  // Nhân viên bán hàng (quota=7): 5 đang làm việc, 1 đang bàn giao nghỉ việc, 1 thai sản/nghỉ ốm, 1 người
  // kiêm nhiệm (secondary = 0.5) -> actualTotal (Thực Tế) = 5+1+1+0.5 = 7.5; Chênh Lệch MỚI = 7-(5+1+1) = 0.
  const employeeProfiles = [
    { username: 'u1', positionKey: posBanHang.positionKey, status: 'ACTIVE' },
    { username: 'u2', positionKey: posBanHang.positionKey, status: 'ACTIVE' },
    { username: 'u3', positionKey: posBanHang.positionKey, status: 'ACTIVE' },
    { username: 'u4', positionKey: posBanHang.positionKey, status: 'ACTIVE' },
    { username: 'u5', positionKey: posBanHang.positionKey, status: 'ACTIVE' },
    { username: 'u6', positionKey: posBanHang.positionKey, status: 'ACTIVE' }, // offboarding (qua hrProcesses)
    { username: 'u7', positionKey: posBanHang.positionKey, status: 'ON_LEAVE' },
    // Thu ngân (quota=4): 1 đang làm việc, 2 người kiêm nhiệm (secondary=1.0) -> actualTotal=1+1=2;
    // Chênh Lệch MỚI = 4-1 = 3 (KHÔNG trừ 2 kiêm nhiệm); Chênh Lệch CŨ (nếu còn trừ) sẽ là 4-2=2.
    { username: 'u8', positionKey: posThuNgan.positionKey, status: 'ACTIVE' }
  ];
  const hrProcesses = [{ processType: 'OFFBOARDING', status: 'IN_PROGRESS', employeeUsername: 'u6' }];
  const users = [
    { username: 'u9', active: true, secondaryPositions: [{ jobTitle: 'Nhân viên bán hàng', dept: 'Phòng Kinh Doanh' }] },
    { username: 'u10', active: true, secondaryPositions: [{ jobTitle: 'Thu ngân', dept: 'Phòng Kinh Doanh' }] },
    { username: 'u11', active: true, secondaryPositions: [{ jobTitle: 'Thu ngân', dept: 'Phòng Kinh Doanh' }] }
  ];

  await run.run('1. computePositionStats() (qua computeHeadcountReport): Thực Tế GIỮ NGUYÊN (gồm Kiêm Nhiệm), Chênh Lệch KHÔNG còn trừ Kiêm Nhiệm', () => {
    const { rows } = computeHeadcountReport(v, employeeProfiles, hrProcesses, users);
    const rBanHang = rows.find(r => r.nodeId === posBanHang.nodeId);
    assertEqual(rBanHang.active, 5, 'Nhân viên bán hàng: 5 đang làm việc');
    assertEqual(rBanHang.offboarding, 1, 'Nhân viên bán hàng: 1 đang bàn giao nghỉ việc');
    assertEqual(rBanHang.onLeave, 1, 'Nhân viên bán hàng: 1 thai sản/nghỉ ốm');
    assertEqual(rBanHang.secondary, 0.5, 'Nhân viên bán hàng: 1 người kiêm nhiệm × 0.5');
    assertEqual(rBanHang.actualTotal, 7.5, 'Thực Tế GIỮ NGUYÊN = 5+1+1+0.5 = 7.5 (gồm cả Kiêm Nhiệm, không đổi hành vi cũ)');
    assertEqual(rBanHang.variance, 0, 'Chênh Lệch MỚI = 7 - (5+1+1) = 0, KHÔNG trừ 0.5 Kiêm Nhiệm (khác Định Biên-Thực Tế=-0.5)');

    const rThuNgan = rows.find(r => r.nodeId === posThuNgan.nodeId);
    assertEqual(rThuNgan.active, 1, 'Thu ngân: 1 đang làm việc');
    assertEqual(rThuNgan.secondary, 1.0, 'Thu ngân: 2 người kiêm nhiệm × 0.5 = 1.0');
    assertEqual(rThuNgan.actualTotal, 2, 'Thực Tế GIỮ NGUYÊN = 1+1.0 = 2');
    assertEqual(rThuNgan.variance, 3, 'Chênh Lệch MỚI = 4 - 1 = 3 (KHÔNG trừ 1.0 Kiêm Nhiệm, khác Định Biên-Thực Tế=2)');
  });

  await run.run('2. Cộng dồn DEPARTMENT/COMPANY cũng áp dụng ĐÚNG công thức Chênh Lệch mới (không chỉ node lá)', () => {
    const { rows } = computeHeadcountReport(v, employeeProfiles, hrProcesses, users);
    const rPhong = rows.find(r => r.nodeId === phong.nodeId);
    // Tổng active=5+1=6, offboarding=1, onLeave=1, secondary=0.5+1.0=1.5, quota=7+4=11.
    assertEqual(rPhong.actualTotal, 9.5, 'Thực Tế cộng dồn GIỮ NGUYÊN = 6+1+1+1.5 = 9.5');
    assertEqual(rPhong.variance, 3, 'Chênh Lệch cộng dồn MỚI = 11 - (6+1+1) = 3, KHÔNG trừ 1.5 Kiêm Nhiệm cộng dồn');
  });

  await run.run('3. buildFlatHeadcountReportWorkbook(): đủ 3 cột mới đúng vị trí + giá trị', () => {
    const report = buildFlatGroupedHeadcountReport(v, employeeProfiles, hrProcesses, users, {});
    const wb = buildFlatHeadcountReportWorkbook(report);
    const sheet = wb.getWorksheet('Định Biên Nhân Sự');
    const headerRow = sheet.getRow(1);
    const headers = [];
    headerRow.eachCell((c) => headers.push(c.value));
    assertEqual(JSON.stringify(headers), JSON.stringify(['STT', 'BAN/PHÒNG', 'BAN/PHÒNG/BỘ PHẬN', 'BỘ PHẬN/NHÓM', 'CHỨC DANH', 'CẤP BẬC', 'Mã vị trí', 'Định biên', 'Thực tế', 'Kiêm Nhiệm', 'Đang Bàn Giao Nghỉ Việc', 'Thai Sản/Nghỉ Ốm', 'Chênh lệch']), '3 cột mới nằm ĐÚNG sau "Thực tế", trước "Chênh lệch"');

    let banHangRow = null;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1 && row.getCell(5).value === 'Nhân viên bán hàng') banHangRow = row;
    });
    assert(!!banHangRow, 'Phải tìm thấy dòng "Nhân viên bán hàng"');
    assertEqual(banHangRow.getCell(8).value, 7, 'Cột H (Định biên) = 7');
    assertEqual(banHangRow.getCell(9).value, 7.5, 'Cột I (Thực tế) = 7.5 (GIỮ NGUYÊN, gồm Kiêm Nhiệm)');
    assertEqual(banHangRow.getCell(10).value, 0.5, 'Cột J (Kiêm Nhiệm) = 0.5');
    assertEqual(banHangRow.getCell(11).value, 1, 'Cột K (Đang Bàn Giao Nghỉ Việc) = 1');
    assertEqual(banHangRow.getCell(12).value, 1, 'Cột L (Thai Sản/Nghỉ Ốm) = 1');
    assertEqual(banHangRow.getCell(13).value, 0, 'Cột M (Chênh lệch) = 0 (công thức MỚI, không trừ Kiêm Nhiệm)');
  });

  await run.run('4. buildHeadcountTemplateWorkbook(): đủ 3 cột THAM KHẢO đúng giá trị, "Định Biên Mới (*)" vẫn ở cột cuối, round-trip nhập lại vẫn hoạt động', async () => {
    const wb = await buildHeadcountTemplateWorkbook(v, employeeProfiles, hrProcesses, users);
    const sheet = wb.getWorksheet('Định Biên Nhân Sự');
    const headerRow = sheet.getRow(1);
    assertEqual(headerRow.getCell(6).value, 'Kiêm Nhiệm (tham khảo)', 'Cột F = Kiêm Nhiệm (tham khảo)');
    assertEqual(headerRow.getCell(7).value, 'Đang Bàn Giao Nghỉ Việc (tham khảo)', 'Cột G = Đang Bàn Giao Nghỉ Việc (tham khảo)');
    assertEqual(headerRow.getCell(8).value, 'Thai Sản/Nghỉ Ốm (tham khảo)', 'Cột H = Thai Sản/Nghỉ Ốm (tham khảo)');
    assertEqual(headerRow.getCell(9).value, 'Định Biên Mới (*)', 'Cột I (cuối) vẫn là Định Biên Mới (*), không đổi vị trí cột ghi được');

    let banHangRow = null;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1 && row.getCell(3).value === 'Nhân viên bán hàng') banHangRow = row;
    });
    assert(!!banHangRow, 'Phải tìm thấy dòng "Nhân viên bán hàng" trong mẫu');
    assertEqual(banHangRow.getCell(6).value, 0.5, 'Cột F (Kiêm Nhiệm tham khảo) = 0.5, đúng số thật');
    assertEqual(banHangRow.getCell(7).value, 1, 'Cột G (Đang Bàn Giao tham khảo) = 1');
    assertEqual(banHangRow.getCell(8).value, 1, 'Cột H (Thai Sản tham khảo) = 1');
    assertEqual(banHangRow.getCell(9).value, 7, 'Cột I (Định Biên Mới) pre-fill = Định Biên hiện tại = 7');

    // Round-trip: sửa ĐÚNG cột "Định Biên Mới" (I) — 3 cột tham khảo không bị đọc lại, không ảnh hưởng.
    banHangRow.getCell(9).value = 10;
    const buf = await wb.xlsx.writeBuffer();
    const { updates, errors } = await parseHeadcountTemplateBuffer(buf, v);
    assertEqual(errors.length, 0, 'Không có dòng nào bị lỗi dù file có thêm 3 cột tham khảo mới');
    const u = updates.find(x => x.nodeId === posBanHang.nodeId);
    assertEqual(u.headcountQuota, 10, 'parseHeadcountTemplateBuffer() vẫn đọc ĐÚNG "Định Biên Mới" dù vị trí cột đã đổi (khớp theo header text, không theo thứ tự cột)');
  });

  run.summary();
}

main();
