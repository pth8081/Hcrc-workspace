// server/tests/test-orgchart-headcount-breakdown-columns.js
//
// Đợt việc 11/2026 (theo yêu cầu người dùng, kèm ảnh chụp "Báo Cáo Định Biên Nhân Sự bạn còn thiếu
// các cột..."): bổ sung 3 cột breakdown vào "📋 Báo Cáo Định Biên Nhân Sự" — Kiêm Nhiệm / Đang Bàn Giao
// Nghỉ Việc / Thai Sản-Nghỉ Ốm. Trải qua 2 vòng demo xác nhận (gửi ảnh + file Excel thật qua SendUserFile
// trước khi code, đúng quy trình người dùng yêu cầu):
//   ĐỢT 2 (quyết định ban đầu, qua AskUserQuestion + demo HTML công tắc so sánh công thức): Thực Tế GIỮ
//     NGUYÊN (gồm cả Kiêm Nhiệm×0.5), chỉ đổi công thức Chênh Lệch để KHÔNG trừ Kiêm Nhiệm.
//   ĐỢT 3 (sau khi xem ảnh demo THẬT với số liệu cụ thể, người dùng phát hiện ĐỢT 2 vẫn sai): "cột thực tế
//     bạn ko nên cộng kiêm nhiệm vào. Báo cáo định biên lấy từ cấu hình định biên nhân sự mà trên cấu hình
//     này ko có kiêm nhiệm, kiêm nhiệm chỉ có ở hồ sơ nhân sự nên cột thực tế là cột không có kiêm nhiệm"
//     — ĐỔI LẠI: Thực Tế (actualTotal) = active+onLeave+offboarding, KHÔNG còn cộng Kiêm Nhiệm nữa; Chênh
//     Lệch quay về công thức ĐƠN GIẢN "Định Biên − Thực Tế" (nhất quán trở lại, không cần trừ riêng Kiêm
//     Nhiệm vì Thực Tế đã không chứa nó). Kiêm Nhiệm CHỈ còn là 1 cột RIÊNG hoàn toàn tách biệt, không ảnh
//     hưởng Thực Tế/Chênh Lệch, chỉ cộng tổng để báo cáo — ĐÂY LÀ QUYẾT ĐỊNH CUỐI, test dưới đây theo ĐỢT 3.
//   Các quyết định khác GIỮ NGUYÊN cả 2 đợt: chỉ 3 cột mới (không phải 4 — "cột nghỉ thai sản tiếp theo"
//   trong yêu cầu chỉ là lời dẫn); áp dụng ở CẢ 4 nơi: màn xem (#orgChartHeadcountTableBody), Xuất Excel
//   (buildFlatHeadcountReportWorkbook), Tải Mẫu Định Biên (buildHeadcountTemplateWorkbook — 3 cột THAM
//   KHẢO, không đọc lại lúc nhập), Nhập Định Biên (parseHeadcountTemplateBuffer không đổi gì).
//
// Phạm vi test:
//   1. computePositionStats() (qua computeHeadcountReport()): Thực Tế (actualTotal) KHÔNG còn gồm Kiêm
//      Nhiệm; Chênh Lệch (variance) = Định Biên − Thực Tế (đơn giản, nhất quán).
//   2. Cộng dồn (DEPARTMENT/COMPANY) cũng áp dụng ĐÚNG công thức mới (không chỉ node lá).
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
  // kiêm nhiệm (secondary=0.5, KHÔNG cộng vào Thực Tế) -> actualTotal (Thực Tế) = 5+1+1 = 7; Chênh Lệch =
  // Định Biên − Thực Tế = 7-7 = 0.
  const employeeProfiles = [
    { username: 'u1', positionKey: posBanHang.positionKey, status: 'ACTIVE' },
    { username: 'u2', positionKey: posBanHang.positionKey, status: 'ACTIVE' },
    { username: 'u3', positionKey: posBanHang.positionKey, status: 'ACTIVE' },
    { username: 'u4', positionKey: posBanHang.positionKey, status: 'ACTIVE' },
    { username: 'u5', positionKey: posBanHang.positionKey, status: 'ACTIVE' },
    { username: 'u6', positionKey: posBanHang.positionKey, status: 'ACTIVE' }, // offboarding (qua hrProcesses)
    { username: 'u7', positionKey: posBanHang.positionKey, status: 'ON_LEAVE' },
    // Thu ngân (quota=4): 1 đang làm việc, 2 người kiêm nhiệm (secondary=1.0, KHÔNG cộng vào Thực Tế) ->
    // actualTotal (Thực Tế) = 1; Chênh Lệch = 4-1 = 3.
    { username: 'u8', positionKey: posThuNgan.positionKey, status: 'ACTIVE' }
  ];
  const hrProcesses = [{ processType: 'OFFBOARDING', status: 'IN_PROGRESS', employeeUsername: 'u6' }];
  const users = [
    { username: 'u9', active: true, secondaryPositions: [{ jobTitle: 'Nhân viên bán hàng', dept: 'Phòng Kinh Doanh' }] },
    { username: 'u10', active: true, secondaryPositions: [{ jobTitle: 'Thu ngân', dept: 'Phòng Kinh Doanh' }] },
    { username: 'u11', active: true, secondaryPositions: [{ jobTitle: 'Thu ngân', dept: 'Phòng Kinh Doanh' }] }
  ];

  await run.run('1. computePositionStats() (qua computeHeadcountReport): Thực Tế KHÔNG gồm Kiêm Nhiệm, Chênh Lệch = Định Biên − Thực Tế', () => {
    const { rows } = computeHeadcountReport(v, employeeProfiles, hrProcesses, users);
    const rBanHang = rows.find(r => r.nodeId === posBanHang.nodeId);
    assertEqual(rBanHang.active, 5, 'Nhân viên bán hàng: 5 đang làm việc');
    assertEqual(rBanHang.offboarding, 1, 'Nhân viên bán hàng: 1 đang bàn giao nghỉ việc');
    assertEqual(rBanHang.onLeave, 1, 'Nhân viên bán hàng: 1 thai sản/nghỉ ốm');
    assertEqual(rBanHang.secondary, 0.5, 'Nhân viên bán hàng: 1 người kiêm nhiệm × 0.5 (chỉ để báo cáo riêng)');
    assertEqual(rBanHang.actualTotal, 7, 'Thực Tế = 5+1+1 = 7, KHÔNG cộng 0.5 Kiêm Nhiệm nữa');
    assertEqual(rBanHang.variance, 0, 'Chênh Lệch = Định Biên − Thực Tế = 7-7 = 0');

    const rThuNgan = rows.find(r => r.nodeId === posThuNgan.nodeId);
    assertEqual(rThuNgan.active, 1, 'Thu ngân: 1 đang làm việc');
    assertEqual(rThuNgan.secondary, 1.0, 'Thu ngân: 2 người kiêm nhiệm × 0.5 = 1.0 (chỉ để báo cáo riêng)');
    assertEqual(rThuNgan.actualTotal, 1, 'Thực Tế = 1, KHÔNG cộng 1.0 Kiêm Nhiệm nữa');
    assertEqual(rThuNgan.variance, 3, 'Chênh Lệch = Định Biên − Thực Tế = 4-1 = 3');
  });

  await run.run('2. Cộng dồn DEPARTMENT/COMPANY cũng áp dụng ĐÚNG công thức mới (không chỉ node lá)', () => {
    const { rows } = computeHeadcountReport(v, employeeProfiles, hrProcesses, users);
    const rPhong = rows.find(r => r.nodeId === phong.nodeId);
    // Tổng active=5+1=6, offboarding=1, onLeave=1, secondary=0.5+1.0=1.5 (chỉ để báo cáo), quota=7+4=11.
    assertEqual(rPhong.actualTotal, 8, 'Thực Tế cộng dồn = 6+1+1 = 8, KHÔNG cộng 1.5 Kiêm Nhiệm cộng dồn');
    assertEqual(rPhong.variance, 3, 'Chênh Lệch cộng dồn = Định Biên − Thực Tế = 11-8 = 3');
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
    assertEqual(banHangRow.getCell(9).value, 7, 'Cột I (Thực tế) = 7, KHÔNG gồm Kiêm Nhiệm');
    assertEqual(banHangRow.getCell(10).value, 0.5, 'Cột J (Kiêm Nhiệm) = 0.5');
    assertEqual(banHangRow.getCell(11).value, 1, 'Cột K (Đang Bàn Giao Nghỉ Việc) = 1');
    assertEqual(banHangRow.getCell(12).value, 1, 'Cột L (Thai Sản/Nghỉ Ốm) = 1');
    assertEqual(banHangRow.getCell(13).value, 0, 'Cột M (Chênh lệch) = Định Biên − Thực Tế = 7-7 = 0');
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
