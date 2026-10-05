// server/tests/test-hr-profile-import-90fields.js
//
// Regression test cho đợt mở rộng Nhập/Xuất hàng loạt Hồ Sơ Nhân Sự lên ĐỦ 90 cột (10/2026, đối chiếu
// file Excel "Template_Quan_ly_ho_so_nhan_su_2.xlsx" người dùng cung cấp — xem lib/employeeProfileImport.js):
// 17 cột field mới ĐỌC/GHI qua Excel (emergencyContactAddress, legalEntity, workEmail,
// specialLaborStatus, currentWorkStatusDetail/*From/*To, lastInternalTransferUnit/Reason,
// joinDateAtPredecessorUnit, joinDateAtHcrc, concurrentJobTitle, resignationNoticeDate/*ExpectedDate,
// tenureBaseDate, careerHistoryNote, hrNote) + ~15 cột CHỈ XEM đọc LIVE từ hợp đồng ACTIVE lúc Xuất
// Excel. Test THUẦN (không HTTP), cùng khuôn tests/test-hr-profile-import-gd1-fields.js.
//
// Ngoài ra kiểm tra lại bản vá lỗi options-forwarding ở lib/employeeProfile.js::createManualProfile()/
// updateProfileFromImport() — trước đây chỉ forward employmentTypes/workSchedules vào
// applyProfileEdit(), bỏ sót legalEntities/specialLaborStatuses/currentWorkStatusDetails/
// nationalIdIssuePlaces mà CALLER (routes/employeeProfile.js) đã đọc đúng từ danh mục thật.
//
// Chạy: node server/tests/test-hr-profile-import-90fields.js
'use strict';

const assert = require('assert');
const employeeProfileImport = require('../lib/employeeProfileImport');
const employeeProfile = require('../lib/employeeProfile');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

async function buildBufferWithRow(overrides) {
  const wb = await employeeProfileImport.buildImportTemplateWorkbook();
  const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
  const row = sheet.getRow(2); // dòng ví dụ có sẵn trong mẫu
  for (const [key, val] of Object.entries(overrides)) row.getCell(key).value = val;
  return wb.xlsx.writeBuffer();
}

async function main() {
  await test('buildImportTemplateWorkbook(): mẫu có đủ 17 cột mới với dữ liệu ví dụ hợp lệ, đọc đúng qua parseImportExcelBuffer()', async () => {
    const buffer = await buildBufferWithRow({});
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, [], []);
    assert.strictEqual(items.length, 1);
    const it = items[0];
    assert.strictEqual(it.emergencyContactAddress, '123 Đường ABC, Q.1, TP.HCM');
    assert.strictEqual(it.legalEntity, 'Công ty TNHH HCRC');
    assert.strictEqual(it.workEmail, 'nguyenvana@hcrc.vn');
    assert.strictEqual(it.joinDateAtHcrc, '2020-01-10');
    assert.strictEqual(it.specialLaborStatus, null, 'Dòng ví dụ để trống -> null hợp lệ');
    assert.strictEqual(it.joinDateAtPredecessorUnit, null, 'Dòng ví dụ để trống -> null hợp lệ');
    assert.strictEqual(it.valid, true);
  });

  await test('parseImportExcelBuffer(): 3 field enum (legalEntity/specialLaborStatus/currentWorkStatusDetail) KHÔNG validate ở bước xem trước — giữ nguyên giá trị gõ dù không khớp danh mục', async () => {
    const buffer = await buildBufferWithRow({ legalEntity: 'Công ty lạ không có trong danh mục', specialLaborStatus: 'Giá trị tự do', currentWorkStatusDetail: 'Khác lạ' });
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, [], []);
    assert.strictEqual(items[0].valid, true, 'Enum field không bị chặn ở preview — để applyProfileEdit() chặn thật lúc bulk-import');
    assert.strictEqual(items[0].legalEntity, 'Công ty lạ không có trong danh mục');
    assert.strictEqual(items[0].specialLaborStatus, 'Giá trị tự do');
  });

  await test('parseImportExcelBuffer(): 7 field ngày mới bị đánh dấu lỗi khi không parse được, không chặn cả file', async () => {
    const buffer = await buildBufferWithRow({ joinDateAtHcrc: 'không-phải-ngày' });
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, [], []);
    assert.strictEqual(items[0].valid, false);
    assert.ok(/Ngày vào HCRC/.test(items[0].errors.join(';')), items[0].errors.join(';'));
  });

  await test('parseImportExcelBuffer(): để trống cả 17 cột mới vẫn hợp lệ (tuỳ chọn)', async () => {
    const buffer = await buildBufferWithRow({
      emergencyContactAddress: '', legalEntity: '', workEmail: '', specialLaborStatus: '',
      currentWorkStatusDetail: '', currentWorkStatusFrom: '', currentWorkStatusTo: '',
      lastInternalTransferUnit: '', lastInternalTransferReason: '',
      joinDateAtPredecessorUnit: '', joinDateAtHcrc: '', concurrentJobTitle: '',
      resignationNoticeDate: '', resignationExpectedDate: '', tenureBaseDate: '',
      careerHistoryNote: '', hrNote: ''
    });
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, [], []);
    assert.strictEqual(items[0].valid, true);
    assert.strictEqual(items[0].legalEntity, null);
    assert.strictEqual(items[0].joinDateAtHcrc, null);
  });

  await test('buildExportWorkbook(): xuất đúng 17 cột profile mới + ~15 cột HĐLĐ CHỈ XEM đọc LIVE từ hợp đồng ACTIVE', async () => {
    const profile = {
      employeeCode: 'NV999', status: 'ACTIVE',
      emergencyContactAddress: 'Số 1 Lê Lợi', legalEntity: 'Công ty TNHH HCRC', workEmail: 'a@hcrc.vn',
      specialLaborStatus: 'Nghỉ thai sản', currentWorkStatusDetail: 'Nghỉ thai sản',
      currentWorkStatusFrom: '2026-01-01', currentWorkStatusTo: '2026-07-01',
      lastInternalTransferUnit: 'Chi nhánh Hà Nội', lastInternalTransferReason: 'Điều động theo nhu cầu',
      joinDateAtPredecessorUnit: '2018-05-01', joinDateAtHcrc: '2020-01-10',
      concurrentJobTitle: 'Kiêm Trưởng nhóm QA', resignationNoticeDate: null, resignationExpectedDate: null,
      tenureBaseDate: '2018-05-01', careerHistoryNote: 'Từng công tác tại Chi nhánh Hà Nội', hrNote: 'Ghi chú nội bộ'
    };
    const contract = {
      employeeCode: 'NV999', status: 'ACTIVE', code: 'HDLD-NV999-1', contractType: 'INDEFINITE',
      startDate: '2020-01-10', endDate: null, baseSalary: 15000000,
      responsibilityAllowance: 500000, concurrentAllowance: 200000, hazardAllowance: 0,
      lunchAllowance: 700000, transportAllowance: 300000, phoneAllowance: 100000, otherAllowance: 0,
      terminationDate: null, terminationReason: null
    };
    const wb = await employeeProfileImport.buildExportWorkbook([profile], [], [], [contract]);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    const headerRow = sheet.getRow(1).values;
    const values = sheet.getRow(2).values;
    const idx = (label) => headerRow.indexOf(label);
    assert.strictEqual(values[idx('Địa Chỉ Người Liên Hệ Khẩn Cấp')], 'Số 1 Lê Lợi');
    assert.strictEqual(values[idx('Đơn Vị (Pháp Nhân)')], 'Công ty TNHH HCRC');
    assert.strictEqual(values[idx('Ngày Vào HCRC')], '2020-01-10');
    assert.strictEqual(values[idx('Kiêm Nhiệm Chức Danh (ghi chú)')], 'Kiêm Trưởng nhóm QA');
    assert.strictEqual(values[idx('Mã Hợp Đồng (CHỈ XEM)')], 'HDLD-NV999-1');
    assert.strictEqual(values[idx('Loại HĐLĐ (CHỈ XEM)')], 'Vô thời hạn');
    assert.strictEqual(values[idx('Trạng Thái HĐLĐ (CHỈ XEM)')], 'Đang hiệu lực');
    assert.strictEqual(values[idx('Lương Cơ Bản (CHỈ XEM)')], 15000000);
    assert.strictEqual(values[idx('Phụ Cấp Trách Nhiệm (CHỈ XEM)')], 500000);
    assert.strictEqual(values[idx('Hỗ Trợ Đi Lại (CHỈ XEM)')], 300000);
  });

  await test('buildExportWorkbook(): nhân viên KHÔNG có hợp đồng ACTIVE -> cột HĐLĐ CHỈ XEM để trống, không lỗi', async () => {
    const profile = { employeeCode: 'NV998', status: 'ACTIVE' };
    const wb = await employeeProfileImport.buildExportWorkbook([profile], [], [], []);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    const headerRow = sheet.getRow(1).values;
    const values = sheet.getRow(2).values;
    const idx = (label) => headerRow.indexOf(label);
    assert.strictEqual(values[idx('Mã Hợp Đồng (CHỈ XEM)')], '');
    assert.strictEqual(values[idx('Lương Cơ Bản (CHỈ XEM)')], '');
  });

  await test('buildExportWorkbook(): vẫn chạy được khi gọi KHÔNG truyền contracts (tương thích cũ)', async () => {
    const profile = { employeeCode: 'NV997', status: 'ACTIVE' };
    const wb = await employeeProfileImport.buildExportWorkbook([profile], [], []);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    assert.strictEqual(sheet.getRow(2).getCell(1).value, 'NV997');
  });

  await test('LỖI ĐÃ VÁ: createManualProfile() trước đây chỉ forward employmentTypes/workSchedules vào applyProfileEdit() — options.legalEntities THẬT phải được tôn trọng (không rơi về fallback cứng)', async () => {
    const list = [];
    // Chỉ cho phép "Legal Entity Test Co" qua danh mục THẬT — KHÔNG nằm trong fallback LEGAL_ENTITIES cứng
    // ("Công ty TNHH HCRC") -> nếu bug còn tồn tại (chỉ forward 2 field), field này sẽ bị chặn sai do rơi
    // về fallback Set cứng dù CALLER đã truyền đúng danh mục.
    const created = employeeProfile.createManualProfile(list, { employeeCode: 'NV900', legalEntity: 'Legal Entity Test Co' }, 'hr1', 'HR Một', {
      employmentTypes: [], workSchedules: [], legalEntities: ['Legal Entity Test Co']
    });
    assert.strictEqual(created.legalEntity, 'Legal Entity Test Co');
  });

  await test('LỖI ĐÃ VÁ: createManualProfile() vẫn CHẶN giá trị không khớp danh mục THẬT đã truyền (xác nhận options không bị bỏ qua hoàn toàn)', async () => {
    const list = [];
    assert.throws(() => {
      employeeProfile.createManualProfile(list, { employeeCode: 'NV901', legalEntity: 'Không Có Trong Danh Mục' }, 'hr1', 'HR Một', {
        employmentTypes: [], workSchedules: [], legalEntities: ['Legal Entity Test Co']
      });
    }, /Đơn vị \(pháp nhân\) không hợp lệ/);
  });

  await test('LỖI ĐÃ VÁ: updateProfileFromImport() (đường "Ghi đè thông tin" lúc import) cũng tôn trọng options.specialLaborStatuses THẬT', async () => {
    const list = [employeeProfile.createManualProfile([], { employeeCode: 'NV902' }, 'hr1', 'HR Một', {})];
    const updated = employeeProfile.updateProfileFromImport(list, 'NV902', { specialLaborStatus: 'Nhóm Đặc Biệt X' }, 'hr1', 'HR Một', {
      specialLaborStatuses: ['Nhóm Đặc Biệt X']
    });
    assert.strictEqual(updated.specialLaborStatus, 'Nhóm Đặc Biệt X');
    assert.throws(() => {
      employeeProfile.updateProfileFromImport(list, 'NV902', { specialLaborStatus: 'Không Khớp' }, 'hr1', 'HR Một', {
        specialLaborStatuses: ['Nhóm Đặc Biệt X']
      });
    }, /Đối tượng lao động đặc biệt không hợp lệ/);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
