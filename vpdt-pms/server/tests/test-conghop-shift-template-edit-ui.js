// server/tests/test-conghop-shift-template-edit-ui.js
//
// Test hồi quy cho nút "✏️ Sửa" mới thêm ở Công & Phép > Quản Lý & Cấu Hình > Mẫu Ca Làm Việc (Siêu Thị)
// (10/2026 — trước đây chỉ có Thêm/Ngừng dùng, gõ sai giờ/tên/số giờ chuẩn không sửa tại chỗ được; làm
// TRƯỚC phần Nhập Excel danh mục ca vì Excel gộp theo Mã Ca vào đúng bản ghi hiện có). Cùng khuôn
// test-conghop-holiday-edit-ui.js (editHacHoliday()).
//
// Chạy: node server/tests/test-conghop-shift-template-edit-ui.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual
} = require('./testHarness');

const PORT = 8944;

const HR = { username: 'hr1', name: 'Nhân Sự Một', dept: 'Nhân Sự', posType: 'HO', perms: { hrAttendanceManage: true }, active: true };

const state = createMockState({
  depts: ['Nhân Sự'],
  stores: [],
  users: [HR],
  publicHolidays: [],
  shiftTemplates: [
    { id: 1, shiftCode: 'CA1', shiftName: 'Ca sáng', startTime: '06:00', endTime: '14:00', breakMinutes: 30, isNightShift: false, standardHours: 7.5, isActive: true },
    { id: 2, shiftCode: 'CA2', shiftName: 'Ca đêm', startTime: '22:00', endTime: '06:00', breakMinutes: 0, isNightShift: true, standardHours: 8, isActive: false }
  ],
  attendanceHoConfig: { startTime: '08:00', endTime: '17:00', lateGraceMinutes: 0 }
});

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await run.run('Chuẩn bị: HR vào Công & Phép > Quản Lý & Cấu Hình, bảng Mẫu Ca có đúng 2 dòng, mỗi dòng có nút "✏️ Sửa"', async () => {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, HR);
      await page.evaluate(async () => { await switchTab('hrAttendance'); setHrAttendanceView('MANAGE'); });
      const r = await page.evaluate(() => ({
        rows: document.querySelectorAll('#hacShiftTemplateBody tr').length,
        editBtns: document.querySelectorAll('#hacShiftTemplateBody button[data-op="editHacShiftTemplate"]').length,
        inlineHandlers: /\son[a-z]+="/i.test(document.getElementById('hacShiftTemplateBody').innerHTML)
      }));
      assertEqual(r.rows, 2, 'Bảng Mẫu Ca phải hiện 2 dòng seed');
      assertEqual(r.editBtns, 2, 'Mỗi dòng phải có nút Sửa (data-op="editHacShiftTemplate")');
      assert(!r.inlineHandlers, 'Không được dùng on*="..." nội tuyến (CSP)');
    });

    await run.run('Bấm "✏️ Sửa" (qua data-op + bindCspDelegation thật) -> modal điền sẵn đúng dữ liệu + tiêu đề "Sửa"', async () => {
      const r = await page.evaluate(async () => {
        document.querySelector('#hacShiftTemplateBody button[data-op="editHacShiftTemplate"][data-arg0="2"]').click();
        await new Promise(res => setTimeout(res, 50));
        return {
          code: document.getElementById('hacStShiftCode').value,
          name: document.getElementById('hacStShiftName').value,
          start: document.getElementById('hacStStartTime').value,
          end: document.getElementById('hacStEndTime').value,
          brk: document.getElementById('hacStBreakMinutes').value,
          hours: document.getElementById('hacStStandardHours').value,
          night: document.getElementById('hacStIsNightShift').checked,
          title: document.getElementById('hacShiftTemplateModalTitle').textContent,
          hidden: document.getElementById('hacShiftTemplateModal').classList.contains('hidden')
        };
      });
      assertEqual(r.code, 'CA2');
      assertEqual(r.name, 'Ca đêm');
      assertEqual(r.start, '22:00');
      assertEqual(r.end, '06:00');
      assertEqual(r.brk, '0');
      assertEqual(r.hours, '8');
      assertEqual(r.night, true);
      assertEqual(r.title, '✏️ Sửa Mẫu Ca Làm Việc');
      assert(!r.hidden, 'Modal phải hiện');
    });

    await run.run('Lưu khi đang sửa -> cập nhật ĐÚNG bản ghi (giữ id + isActive), KHÔNG tạo bản ghi trùng', async () => {
      const r = await page.evaluate(async () => {
        const before = DB.shiftTemplates.length;
        document.getElementById('hacStShiftName').value = 'Ca đêm (đã sửa)';
        document.getElementById('hacStStandardHours').value = '7.5';
        document.getElementById('hacStBreakMinutes').value = '45';
        await submitHacShiftTemplate({ preventDefault() {} });
        return {
          before, after: DB.shiftTemplates.length,
          item: DB.shiftTemplates.find(t => t.id === 2),
          countCA2: DB.shiftTemplates.filter(t => t.shiftCode === 'CA2').length,
          hidden: document.getElementById('hacShiftTemplateModal').classList.contains('hidden'),
          rowText: document.getElementById('hacShiftTemplateBody').textContent
        };
      });
      assertEqual(r.after, r.before, 'Không được thêm bản ghi mới');
      assertEqual(r.countCA2, 1, 'Không được có 2 mẫu ca cùng mã CA2');
      assertEqual(r.item.shiftName, 'Ca đêm (đã sửa)');
      assertEqual(r.item.standardHours, 7.5);
      assertEqual(r.item.breakMinutes, 45);
      assertEqual(r.item.isNightShift, true, 'Field không sửa phải giữ nguyên');
      assertEqual(r.item.isActive, false, 'isActive (bật/tắt bằng nút riêng) phải giữ nguyên khi sửa');
      assert(r.hidden, 'Modal tự đóng sau khi lưu thành công');
      assert(r.rowText.includes('Ca đêm (đã sửa)'), 'Bảng phải vẽ lại với tên mới');
    });

    await run.run('Sửa giữ nguyên Mã Ca của chính nó không bị coi là trùng; đổi sang Mã Ca của mẫu KHÁC bị chặn, dữ liệu không đổi', async () => {
      const r = await page.evaluate(async () => {
        window.__alerts = [];
        editHacShiftTemplate(1);
        document.getElementById('hacStShiftCode').value = 'ca2'; // trùng CA2 (sau khi IN HOA)
        await submitHacShiftTemplate({ preventDefault() {} });
        const blocked = window.__alerts.slice();
        const ca1After = DB.shiftTemplates.find(t => t.id === 1);
        const modalOpen = !document.getElementById('hacShiftTemplateModal').classList.contains('hidden');
        document.getElementById('hacStShiftCode').value = 'CA1';
        document.getElementById('hacStStartTime').value = '06:30';
        window.__alerts = [];
        await submitHacShiftTemplate({ preventDefault() {} });
        return { blocked, ca1After, modalOpen, alertsSecond: window.__alerts.slice(), ca1Final: DB.shiftTemplates.find(t => t.id === 1), total: DB.shiftTemplates.length };
      });
      assert(r.blocked.some(a => a.includes('đã tồn tại')), 'Phải cảnh báo trùng Mã Ca');
      assertEqual(r.ca1After.shiftCode, 'CA1', 'Bị chặn thì bản ghi gốc giữ nguyên mã');
      assert(r.modalOpen, 'Bị chặn thì modal vẫn mở để sửa lại');
      assertEqual(r.alertsSecond.length, 0, 'Giữ nguyên mã của chính nó KHÔNG bị coi là trùng');
      assertEqual(r.ca1Final.startTime, '06:30');
      assertEqual(r.ca1Final.id, 1);
      assertEqual(r.total, 2);
    });

    await run.run('Đổi Mã Ca sang mã mới chưa dùng -> cập nhật tại chỗ (giữ id), không sinh bản ghi mới', async () => {
      const r = await page.evaluate(async () => {
        editHacShiftTemplate(1);
        document.getElementById('hacStShiftCode').value = 'ca1s';
        await submitHacShiftTemplate({ preventDefault() {} });
        return { total: DB.shiftTemplates.length, item: DB.shiftTemplates.find(t => t.id === 1) };
      });
      assertEqual(r.total, 2);
      assertEqual(r.item.shiftCode, 'CA1S');
    });

    await run.run('Huỷ sửa rồi bấm "➕ Thêm Mẫu Ca" -> form trắng, tiêu đề "Thêm", lưu tạo bản ghi MỚI (id mới, isActive true)', async () => {
      const r = await page.evaluate(async () => {
        editHacShiftTemplate(2);
        document.getElementById('hacStShiftName').value = 'Đổi nhưng không lưu';
        closeHacShiftTemplateModal();
        const unchanged = DB.shiftTemplates.find(t => t.id === 2).shiftName === 'Ca đêm (đã sửa)';
        openHacShiftTemplateModal();
        const blank = document.getElementById('hacStShiftCode').value === '' && document.getElementById('hacStShiftName').value === '';
        const title = document.getElementById('hacShiftTemplateModalTitle').textContent;
        document.getElementById('hacStShiftCode').value = 'CA3';
        document.getElementById('hacStShiftName').value = 'Ca chiều';
        document.getElementById('hacStStartTime').value = '14:00';
        document.getElementById('hacStEndTime').value = '22:00';
        document.getElementById('hacStStandardHours').value = '8';
        await submitHacShiftTemplate({ preventDefault() {} });
        return { unchanged, blank, title, total: DB.shiftTemplates.length, added: DB.shiftTemplates.find(t => t.shiftCode === 'CA3') };
      });
      assert(r.unchanged, 'Đóng modal không lưu KHÔNG được đổi dữ liệu');
      assert(r.blank, 'Mở Thêm sau khi huỷ sửa phải là form trắng');
      assertEqual(r.title, '🕒 Thêm Mẫu Ca Làm Việc');
      assertEqual(r.total, 3);
      assertEqual(r.added.id, 3);
      assertEqual(r.added.isActive, true);
    });

    await run.run('Mẫu ca đang sửa bị xoá ở nơi khác trước khi lưu -> báo lỗi rõ ràng, không tạo bản ghi rác', async () => {
      const r = await page.evaluate(async () => {
        window.__alerts = [];
        editHacShiftTemplate(3);
        DB.shiftTemplates = DB.shiftTemplates.filter(t => t.id !== 3);
        const before = DB.shiftTemplates.length;
        await submitHacShiftTemplate({ preventDefault() {} });
        return { alerts: window.__alerts.slice(), before, after: DB.shiftTemplates.length, hidden: document.getElementById('hacShiftTemplateModal').classList.contains('hidden') };
      });
      assert(r.alerts.some(a => a.includes('không còn tồn tại')), 'Phải báo mẫu ca không còn tồn tại');
      assertEqual(r.after, r.before, 'Không được tạo lại bản ghi');
      assert(r.hidden, 'Modal tự đóng');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-conghop-shift-template-edit-ui.js:', err);
  process.exitCode = 1;
});
