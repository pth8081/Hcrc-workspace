// server/tests/test-car-dashboard-status-filter.js
//
// LỖI THẬT (phản hồi người dùng, 9/2026): Dashboard Đăng Ký Xe — bấm thẻ "Đã Hủy Chuyến"/"Chờ Đánh Giá"
// (và tương tự "Đang Thực Hiện"/"Hoàn Thành") KHÔNG lọc được danh sách, bấm không có phản ứng gì.
//
// Nguyên nhân: applyDashboardCardFilter() (core.js) set filter bằng cách gán thẳng
// `document.getElementById(id).value = value` — nếu <select> không có sẵn <option value="...">
// tương ứng, trình duyệt ÂM THẦM bỏ qua việc gán (value giữ nguyên, không báo lỗi gì). #filterStatusCar
// (fragments/carSection.html) trước đây chỉ có 4/7 trạng thái (rỗng/APPROVED/PENDING/REJECTED) — thiếu
// hẳn IN_PROGRESS/CANCELLED/AWAITING_EVALUATION/COMPLETED, đúng 4 trạng thái mà carDashCards
// (module-dangkyxe.js) có thẻ riêng. Vá: bổ sung đủ 7 <option>.
//
// Chạy: node server/tests/test-car-dashboard-status-filter.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8997;

const ADMIN = { username: 'admin1', name: 'Admin', dept: 'Ban Giám Đốc', role: 'STAFF', phone: '0900000001', email: 'admin1@company.com', jobTitle: 'Người điều hành xe', perms: { carDispatch: true }, active: true };

function carReg(id, status, extra) {
  return Object.assign({
    id, code: `HCRC-DASH-${id}`, dept: 'Ban Giám Đốc', status, currentStep: 99, history: [],
    type: 'Xe 5 chỗ', km: '20', passengers: '2', purpose: 'Công tác',
    startTime: '2026-09-30T14:34', endTime: '2026-09-30T17:34', destination: 'Hà Nội -> Sài Đồng',
    creator: 'admin1', creatorName: 'Admin'
  }, extra || {});
}

const CAR_PENDING = carReg(1, 'PENDING');
const CAR_APPROVED = carReg(2, 'APPROVED');
const CAR_IN_PROGRESS = carReg(3, 'IN_PROGRESS');
const CAR_CANCELLED = carReg(4, 'CANCELLED');
const CAR_AWAITING_EVAL = carReg(5, 'AWAITING_EVALUATION');
const CAR_COMPLETED = carReg(6, 'COMPLETED');
const ALL_CARS = [CAR_PENDING, CAR_APPROVED, CAR_IN_PROGRESS, CAR_CANCELLED, CAR_AWAITING_EVAL, CAR_COMPLETED];

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function main() {
  const state = createMockState({ depts: ['Ban Giám Đốc'], users: [ADMIN], carRegs: ALL_CARS });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await loginAs(page, ADMIN);
    await page.evaluate(() => { switchTab('car'); });
    await page.waitForTimeout(150);

    await run.run('#filterStatusCar phải có đủ 7 <option> (trước đây thiếu 4: IN_PROGRESS/CANCELLED/AWAITING_EVALUATION/COMPLETED)', async () => {
      const values = await page.evaluate(() => Array.from(document.getElementById('filterStatusCar').options).map((o) => o.value));
      ['', 'PENDING', 'APPROVED', 'IN_PROGRESS', 'AWAITING_EVALUATION', 'COMPLETED', 'CANCELLED', 'REJECTED'].forEach((v) => {
        assert(values.includes(v), `#filterStatusCar phải có <option value="${v}">, hiện có: ${JSON.stringify(values)}`);
      });
    });

    const scenarios = [
      { key: 'CANCELLED', code: CAR_CANCELLED.code, label: 'Đã Hủy Chuyến' },
      { key: 'AWAITING_EVALUATION', code: CAR_AWAITING_EVAL.code, label: 'Chờ Đánh Giá' },
      { key: 'IN_PROGRESS', code: CAR_IN_PROGRESS.code, label: 'Đang Thực Hiện' },
      { key: 'COMPLETED', code: CAR_COMPLETED.code, label: 'Hoàn Thành' }
    ];

    for (const sc of scenarios) {
      await run.run(`LỖI ĐÃ VÁ: bấm thẻ Dashboard "${sc.label}" (${sc.key}) -> #filterStatusCar phải đổi giá trị + bảng chỉ còn đúng phiếu ${sc.key}`, async () => {
        await page.evaluate((key) => { filterCarByCard(key); }, sc.key);
        await page.waitForTimeout(100);
        const result = await page.evaluate(() => ({
          filterValue: document.getElementById('filterStatusCar').value,
          rows: document.getElementById('carTableBody').innerText
        }));
        assertEqual(result.filterValue, sc.key, `Bấm thẻ phải set được #filterStatusCar='${sc.key}' (trước đây bị trình duyệt âm thầm bỏ qua vì thiếu <option>)`);
        assert(result.rows.includes(sc.code), `Bảng phải hiện đúng phiếu trạng thái ${sc.key} (${sc.code})`);
        ALL_CARS.filter((c) => c.status !== sc.key).forEach((c) => {
          assert(!result.rows.includes(c.code), `Bảng KHÔNG được hiện phiếu khác trạng thái (${c.code}, status=${c.status})`);
        });
      });
    }

    await run.run('Bấm lại thẻ "Tổng Đăng Ký" (key rỗng) -> bỏ lọc, hiện lại đủ cả 6 phiếu', async () => {
      await page.evaluate(() => { filterCarByCard(''); });
      await page.waitForTimeout(100);
      const rows = await page.evaluate(() => document.getElementById('carTableBody').innerText);
      ALL_CARS.forEach((c) => assert(rows.includes(c.code), `Bỏ lọc phải hiện lại đủ phiếu ${c.code}`));
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exitCode = 1;
});
