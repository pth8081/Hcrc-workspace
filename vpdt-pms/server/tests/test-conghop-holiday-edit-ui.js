// server/tests/test-conghop-holiday-edit-ui.js
//
// Test hồi quy cho nút "✏️ Sửa" mới thêm ở Công & Phép > Quản Lý & Cấu Hình > Danh Mục Ngày Lễ (10/2026 —
// trước đây chỉ có Xoá, gõ sai tên/ngày phải xoá tạo lại từ đầu, không sửa tại chỗ được). Đồng thời test
// luôn 1 lỗi TIỀM ẨN đã vá cùng lúc: renderHacHolidayTable() sort danh sách theo ngày để hiển thị nhưng
// deleteHacHoliday()/editHacHoliday() TRƯỚC ĐÂY nhận INDEX của mảng đã sort rồi lại filter/tìm trong
// DB.publicHolidays GỐC (chưa sort) — nếu các ngày lễ được thêm KHÔNG theo đúng thứ tự thời gian thì
// index lệch, xoá/sửa NHẦM ngày lễ khác với ngày hiển thị trên màn hình. Đã sửa bằng cách định danh theo
// h.date (khoá duy nhất, đã chặn trùng khi thêm/sửa) thay vì index — xem scenario "định danh theo NGÀY"
// bên dưới dựng đúng tình huống thêm lệch thứ tự để xác nhận không còn xoá/sửa nhầm.
//
// Chạy: node server/tests/test-conghop-holiday-edit-ui.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual
} = require('./testHarness');

const PORT = 8986;

const HR = { username: 'hr1', name: 'Nhân Sự Một', dept: 'Nhân Sự', posType: 'HO', perms: { hrAttendanceManage: true }, active: true };

const state = createMockState({
  depts: ['Nhân Sự'],
  stores: [],
  users: [HR],
  publicHolidays: [
    { date: '2026-01-01', name: 'Tết Dương Lịch' },
    { date: '2026-04-30', name: 'Giải Phóng Miền Nam' }
  ],
  attendanceHoConfig: { startTime: '08:00', endTime: '17:00', lateGraceMinutes: 0 }
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => {
    window.__resetCapture();
    await proceedAfterAuth(u);
  }, user);
}

async function openManageHolidayView(page) {
  await page.evaluate(async () => {
    await switchTab('hrAttendance');
    setHrAttendanceView('MANAGE');
  });
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await run.run('Chuẩn bị: HR vào được Công & Phép > Quản Lý & Cấu Hình, bảng Ngày Lễ hiện đúng 2 dòng seed', async () => {
      await loginAs(page, HR);
      await openManageHolidayView(page);
      const rows = await page.evaluate(() => document.querySelectorAll('#hacHolidayBody tr').length);
      assertEqual(rows, 2, 'Bảng Ngày Lễ phải hiện đúng 2 dòng đã seed');
    });

    await run.run('Danh Mục Ngày Lễ: nút "✏️ Sửa" populate đúng dữ liệu lên modal + đổi tiêu đề thành "Sửa Ngày Lễ"', async () => {
      const result = await page.evaluate(() => {
        editHacHoliday('2026-04-30');
        return {
          date: document.getElementById('hacHolidayDate').value,
          name: document.getElementById('hacHolidayName').value,
          title: document.getElementById('hacHolidayModalTitle').textContent,
          modalHidden: document.getElementById('hacHolidayModal').classList.contains('hidden')
        };
      });
      assertEqual(result.date, '2026-04-30', 'Modal phải populate đúng ngày của ngày lễ đang sửa');
      assertEqual(result.name, 'Giải Phóng Miền Nam', 'Modal phải populate đúng tên của ngày lễ đang sửa');
      assertEqual(result.title, '✏️ Sửa Ngày Lễ', 'Tiêu đề modal phải đổi thành "Sửa Ngày Lễ" khi đang sửa');
      assert(!result.modalHidden, 'Modal phải hiện ra khi bấm "✏️ Sửa"');
    });

    await run.run('Danh Mục Ngày Lễ: Cập Nhật tại chỗ - KHÔNG tạo dòng mới, sửa đúng đúng dòng đang chọn', async () => {
      const result = await page.evaluate(async () => {
        const before = DB.publicHolidays.length;
        document.getElementById('hacHolidayName').value = 'Ngày Giải Phóng Miền Nam (đã sửa)';
        await submitHacHoliday({ preventDefault() {} });
        return {
          before, after: DB.publicHolidays.length,
          item: DB.publicHolidays.find(h => h.date === '2026-04-30'),
          modalHidden: document.getElementById('hacHolidayModal').classList.contains('hidden')
        };
      });
      assertEqual(result.after, result.before, 'Cập Nhật KHÔNG được tạo thêm dòng mới trong danh mục ngày lễ');
      assertEqual(result.item?.name, 'Ngày Giải Phóng Miền Nam (đã sửa)', 'Tên phải được cập nhật tại đúng dòng cũ (theo ngày)');
      assert(result.modalHidden, 'Modal phải tự đóng sau khi Cập Nhật thành công');
    });

    await run.run('Danh Mục Ngày Lễ: sửa ngày trùng với ngày lễ KHÁC đã có bị chặn (không mất dữ liệu)', async () => {
      const result = await page.evaluate(async () => {
        window.__alerts = [];
        editHacHoliday('2026-04-30');
        document.getElementById('hacHolidayDate').value = '2026-01-01'; // trùng ngày Tết Dương Lịch đã có
        await submitHacHoliday({ preventDefault() {} });
        return {
          alerts: window.__alerts.slice(),
          stillHas0430: !!DB.publicHolidays.find(h => h.date === '2026-04-30'),
          modalHidden: document.getElementById('hacHolidayModal').classList.contains('hidden')
        };
      });
      assert(result.alerts.some(a => a.includes('đã có trong danh mục')), 'Phải cảnh báo trùng ngày với ngày lễ khác');
      assert(result.stillHas0430, 'Bản ghi gốc (30/04) KHÔNG được mất/đổi khi bị chặn do trùng ngày');
      assert(!result.modalHidden, 'Modal phải vẫn mở (không tự đóng) khi bị chặn do trùng ngày, để người dùng sửa lại');
    });

    await run.run('Danh Mục Ngày Lễ: đóng modal (Huỷ) không lưu thay đổi, mở "+ Thêm Ngày Lễ" tiếp theo phải về đúng chế độ Thêm Mới', async () => {
      const result = await page.evaluate(() => {
        editHacHoliday('2026-01-01');
        document.getElementById('hacHolidayName').value = 'Tên bị đổi nhưng không lưu';
        closeHacHolidayModal();
        const unchanged = DB.publicHolidays.find(h => h.date === '2026-01-01')?.name === 'Tết Dương Lịch';
        openHacHolidayModal();
        return {
          unchanged,
          nameField: document.getElementById('hacHolidayName').value,
          title: document.getElementById('hacHolidayModalTitle').textContent
        };
      });
      assert(result.unchanged, 'Đóng modal không lưu KHÔNG được thay đổi dữ liệu gốc');
      assertEqual(result.nameField, '', 'Mở "+ Thêm Ngày Lễ" sau khi huỷ sửa dở dang phải là form TRẮNG');
      assertEqual(result.title, '📅 Thêm Ngày Lễ', 'Mở lại bằng nút "+ Thêm" phải về đúng tiêu đề Thêm Mới, không kẹt ở "Sửa"');
    });

    await run.run('Danh Mục Ngày Lễ: ngày lễ đang sửa bị xoá ở nơi khác trước khi bấm Cập Nhật -> báo lỗi rõ ràng, không tạo hồ sơ rác', async () => {
      const result = await page.evaluate(async () => {
        window.__alerts = [];
        window.__confirms = [];
        editHacHoliday('2026-01-01');
        await deleteHacHoliday('2026-01-01'); // mô phỏng bị xoá "ở nơi khác" trong lúc modal vẫn đang mở để sửa
        const beforeCount = DB.publicHolidays.length;
        await submitHacHoliday({ preventDefault() {} }); // bấm "Lưu" sau khi ngày lễ đã bị xoá
        return {
          alerts: window.__alerts.slice(),
          countUnchanged: DB.publicHolidays.length === beforeCount,
          modalHidden: document.getElementById('hacHolidayModal').classList.contains('hidden')
        };
      });
      assert(result.alerts.some(a => a.includes('không còn tồn tại')), 'Phải cảnh báo rõ ràng ngày lễ đang sửa không còn tồn tại');
      assert(result.countUnchanged, 'KHÔNG được vô tình thêm mới/tạo lại ngày lễ vào danh mục sau lỗi này');
      assert(result.modalHidden, 'Modal phải tự đóng lại vì không còn gì để sửa');
    });

    await run.run('Danh Mục Ngày Lễ: định danh theo NGÀY (không theo index đã sort) - xoá đúng dòng dù thêm lệch thứ tự thời gian', async () => {
      const result = await page.evaluate(async () => {
        // Thêm 1 ngày lễ XA trong tương lai TRƯỚC, rồi 1 ngày GẦN hơn SAU -> DB.publicHolidays (thứ tự
        // thêm) và bảng hiển thị (đã sort theo ngày) LỆCH NHAU, đúng tình huống gây lỗi index cũ.
        DB.publicHolidays = [
          ...DB.publicHolidays,
          { date: '2026-12-25', name: 'Noel' },
          { date: '2026-09-02', name: 'Quốc Khánh' }
        ];
        renderHacHolidayTable();
        // Dòng hiển thị ĐẦU TIÊN trên bảng (đã sort) phải là ngày sớm nhất còn lại, KHÔNG phải 25/12
        // (thứ tự thêm) — xác nhận render đúng sort trước khi xoá theo đúng ngày đó.
        const firstRowDate = document.querySelector('#hacHolidayBody tr td')?.textContent;
        await deleteHacHoliday('2026-09-02'); // xoá đúng "Quốc Khánh" (thêm SAU nhưng ngày SỚM hơn 25/12)
        return {
          firstRowDate,
          hasNoel: !!DB.publicHolidays.find(h => h.date === '2026-12-25'),
          hasQuocKhanh: !!DB.publicHolidays.find(h => h.date === '2026-09-02')
        };
      });
      assert(result.hasNoel, 'Ngày lễ 25/12 (Noel) KHÔNG được bị xoá nhầm');
      assert(!result.hasQuocKhanh, 'Phải xoá ĐÚNG ngày lễ 02/09 (Quốc Khánh) đã yêu cầu, không lệch theo index hiển thị');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-conghop-holiday-edit-ui.js:', err);
  process.exitCode = 1;
});
