// server/tests/test-report-period-by-tasks-filters.js
//
// Test THUẦN (không cần Playwright/SQL Server/HTTP) cho tham số filters mới của
// mergeReportPeriodByTasks() (lib/recordActions.js) — bộ lọc "Trạng thái" + "Từ ngày/Đến ngày" ở
// #prSubAggregate, box "🗂️ Đối chiếu với công việc thật (DB.tasks)" (xem public/index.html +
// public/js/module-baocaodinhky-trinhchieu.js mergeReportPeriodByTasksAction()). Gọi thẳng hàm THẬT
// (không mock lại logic), khớp nguyên tắc chung của thư mục tests/ (vd
// test-operation-danhmuc-dautu-units.js).
//
//   1. Không truyền filters (chữ ký cũ, caller khác chưa cập nhật) -> hành vi Y HỆT trước đây: mốc tự
//      suy ra từ chuỗi kỳ, cảnh báo "khoảng trống ranh giới" vẫn nổ khi có kỳ liền trước chưa đóng.
//   2. filters.status='DONE' -> chỉ còn đúng việc DONE.
//   3. filters.status='TODO' -> chỉ còn đúng việc TODO.
//   4. filters.status='OVERDUE' (nhóm PHÁI SINH, không phải raw.status thật) -> gồm CẢ việc TODO lẫn
//      DOING đã quá hạn so với mốc kỳ, KHÔNG gồm việc DONE (không bao giờ "quá hạn").
//   5. filters.fromDate ghi đè startBoundary -> loại việc DONE hoàn thành trước mốc mới, KHÔNG đụng gì
//      tới việc còn mở (đúng bán chất "không có cận dưới" của việc mở) — và bỏ cảnh báo ranh giới.
//   6. filters.toDate ghi đè endBoundary (fromDate bỏ trống -> startBoundary vẫn giữ nguyên mốc tự suy
//      ra) -> loại việc còn mở có hạn chót sau mốc mới, việc DONE trong khoảng vẫn giữ nguyên.
//   7. filters.status + fromDate/toDate cùng lúc -> áp dụng đồng thời.
//   8. Ghi đè khiến phạm vi rỗng hẳn -> vẫn báo lỗi 400 rõ ràng (không crash).
//
// Chạy: node server/tests/test-report-period-by-tasks-filters.js
const recordActions = require('../lib/recordActions');
const { createRunner, assert, assertEqual } = require('./testHarness');

const AGG_USER = { username: 'agg1', name: 'Tổng Hợp Viên', perms: { reportAggregate: true }, active: true };
const DEPT_USER = { username: 'emp1', name: 'Nhân Viên Kinh Doanh', dept: 'Kinh Doanh', active: true };

// 4 công việc: 1 DONE (hoàn thành 20/1/2025), 1 TODO hạn 1/3/2025, 1 DOING hạn 1/4/2025 (cả 2 việc mở
// đều "quá hạn" so với endBoundary mặc định 30/4/2025 — đúng bản chất mergeReportPeriodByTasks(): bất
// kỳ việc mở nào còn được tính vào kỳ (hạn <= endBoundary) đều coi là quá hạn so với kỳ, TRỪ khi hạn
// trùng khít endBoundary), 1 CANCELLED (luôn bị loại bất kể filter).
function freshTasks() {
  return [
    { id: 1, title: 'Việc đã xong', status: 'DONE', assignedTo: 'emp1', history: [{ action: 'STATUS_DONE', time: '10:00:00 20/1/2025' }] },
    { id: 2, title: 'Việc chưa bắt đầu', status: 'TODO', assignedTo: 'emp1', deadline: '2025-03-01T00:00:00Z' },
    { id: 3, title: 'Việc đang thực hiện', status: 'DOING', assignedTo: 'emp1', deadline: '2025-04-01T00:00:00Z' },
    { id: 4, title: 'Việc đã hủy', status: 'CANCELLED', assignedTo: 'emp1', deadline: '2025-02-01T00:00:00Z' }
  ];
}

function freshPeriods() {
  // periodA: kỳ CLOSED xa hơn (dùng làm startBoundary tự suy ra). periodB: kỳ liền trước periodC
  // nhưng CHƯA đóng -> gây "khoảng trống ranh giới" (immediatePrior != startBoundary) khi KHÔNG override.
  const periodA = { id: 901, name: 'Kỳ A (đã đóng, xa hơn)', status: 'CLOSED', endTime: '2025-01-15T23:59:59' };
  const periodB = { id: 902, name: 'Kỳ B (liền trước, chưa đóng)', status: 'OPEN', endTime: '2025-02-01T23:59:59' };
  const periodC = { id: 903, name: 'Kỳ C (kỳ đang đối chiếu)', status: 'CLOSED', endTime: '2025-04-30T23:59:59', deptScope: { all: true } };
  return { periodA, periodB, periodC, allPeriods: [periodA, periodB, periodC] };
}

function taskItemsOf(period) {
  const tasksSlide = period.taskCompilation.slides.find(s => s.kind === 'TASKS');
  return tasksSlide ? tasksSlide.items : [];
}

async function main() {
  const run = createRunner();

  await run.run('Không truyền filters (chữ ký cũ) — hành vi y hệt trước đây, có cảnh báo ranh giới', () => {
    const { periodC, allPeriods } = freshPeriods();
    const { period, warning } = recordActions.mergeReportPeriodByTasks(AGG_USER, periodC, freshTasks(), [DEPT_USER], allPeriods);
    const items = taskItemsOf(period);
    assertEqual(items.length, 3, 'Mặc định (không filter) phải gồm đủ 3 việc chưa hủy (DONE+TODO+DOING)');
    assert(warning && warning.includes('Kỳ B'), 'Phải có cảnh báo khoảng trống ranh giới khi kỳ liền trước chưa đóng và không override mốc');
  });

  await run.run('filters.status=DONE — chỉ còn đúng việc DONE', () => {
    const { periodC, allPeriods } = freshPeriods();
    const { period } = recordActions.mergeReportPeriodByTasks(AGG_USER, periodC, freshTasks(), [DEPT_USER], allPeriods, { status: 'DONE' });
    const items = taskItemsOf(period);
    assertEqual(items.length, 1, 'Lọc status=DONE phải còn đúng 1 việc');
    assertEqual(items[0].content, 'Việc đã xong', 'Phải đúng việc DONE');
  });

  await run.run('filters.status=TODO — chỉ còn đúng việc TODO', () => {
    const { periodC, allPeriods } = freshPeriods();
    const { period } = recordActions.mergeReportPeriodByTasks(AGG_USER, periodC, freshTasks(), [DEPT_USER], allPeriods, { status: 'TODO' });
    const items = taskItemsOf(period);
    assertEqual(items.length, 1, 'Lọc status=TODO phải còn đúng 1 việc');
    assertEqual(items[0].content, 'Việc chưa bắt đầu', 'Phải đúng việc TODO');
  });

  await run.run('filters.status=OVERDUE (nhóm phái sinh) — gồm TODO+DOING quá hạn, KHÔNG gồm DONE', () => {
    const { periodC, allPeriods } = freshPeriods();
    const { period } = recordActions.mergeReportPeriodByTasks(AGG_USER, periodC, freshTasks(), [DEPT_USER], allPeriods, { status: 'OVERDUE' });
    const items = taskItemsOf(period);
    assertEqual(items.length, 2, 'Lọc status=OVERDUE phải gồm đúng 2 việc (TODO+DOING quá hạn)');
    const contents = items.map(i => i.content).sort();
    assertEqual(JSON.stringify(contents), JSON.stringify(['Việc chưa bắt đầu', 'Việc đang thực hiện']), 'Phải đúng 2 việc TODO+DOING, không lẫn việc DONE');
  });

  await run.run('filters.fromDate ghi đè startBoundary — loại DONE trước mốc mới, KHÔNG đụng việc mở, bỏ cảnh báo ranh giới', () => {
    const { periodC, allPeriods } = freshPeriods();
    const { period, warning } = recordActions.mergeReportPeriodByTasks(AGG_USER, periodC, freshTasks(), [DEPT_USER], allPeriods, { fromDate: '2025-02-10' });
    const items = taskItemsOf(period);
    assertEqual(items.length, 2, 'fromDate=10/2/2025 phải loại việc DONE hoàn thành 20/1/2025 (trước mốc mới), còn lại 2 việc mở');
    assert(!items.some(i => i.content === 'Việc đã xong'), 'Việc DONE hoàn thành trước fromDate phải bị loại');
    assert(items.some(i => i.content === 'Việc chưa bắt đầu') && items.some(i => i.content === 'Việc đang thực hiện'), 'Cả 2 việc mở vẫn phải còn (không có cận dưới)');
    assertEqual(warning, null, 'Có override mốc thì phải bỏ cảnh báo khoảng trống ranh giới');
  });

  await run.run('filters.toDate ghi đè endBoundary (fromDate để trống) — loại việc mở có hạn sau mốc mới, DONE trong khoảng vẫn giữ', () => {
    const { periodC, allPeriods } = freshPeriods();
    const { period, warning } = recordActions.mergeReportPeriodByTasks(AGG_USER, periodC, freshTasks(), [DEPT_USER], allPeriods, { toDate: '2025-03-15' });
    const items = taskItemsOf(period);
    assertEqual(items.length, 2, 'toDate=15/3/2025 phải loại việc DOING hạn 1/4/2025 (sau mốc mới), còn việc DONE (20/1) + TODO (hạn 1/3) trong khoảng');
    assert(!items.some(i => i.content === 'Việc đang thực hiện'), 'Việc DOING hạn sau toDate phải bị loại');
    assert(items.some(i => i.content === 'Việc đã xong'), 'Việc DONE trong khoảng [startBoundary tự suy ra, toDate mới] vẫn phải còn — startBoundary KHÔNG bị xoá khi chỉ override toDate');
    assert(items.some(i => i.content === 'Việc chưa bắt đầu'), 'Việc TODO hạn trước toDate vẫn phải còn');
    assertEqual(warning, null, 'Chỉ cần 1 trong 2 mốc được override cũng phải bỏ cảnh báo ranh giới');
  });

  await run.run('Kết hợp status + date-range cùng lúc', () => {
    const { periodC, allPeriods } = freshPeriods();
    const { period } = recordActions.mergeReportPeriodByTasks(AGG_USER, periodC, freshTasks(), [DEPT_USER], allPeriods, { status: 'DONE', fromDate: '2025-01-01', toDate: '2025-04-30' });
    const items = taskItemsOf(period);
    assertEqual(items.length, 1, 'Kết hợp lọc status=DONE + khoảng ngày bao trùm phải còn đúng 1 việc DONE');
    assertEqual(items[0].content, 'Việc đã xong', 'Phải đúng việc DONE');
  });

  await run.run('Ghi đè khiến phạm vi rỗng hẳn -> báo lỗi 400 rõ ràng, không crash', () => {
    const { periodC, allPeriods } = freshPeriods();
    let threw = null;
    try {
      recordActions.mergeReportPeriodByTasks(AGG_USER, periodC, freshTasks(), [DEPT_USER], allPeriods, { toDate: '2025-01-01' });
    } catch (err) { threw = err; }
    assert(threw, 'Phải ném lỗi khi không còn việc nào phù hợp phạm vi sau khi override');
    assertEqual(threw.status, 400, 'Phải là lỗi 400 (nghiệp vụ), không phải crash');
    assert(threw.message.includes('Không có công việc nào phù hợp'), 'Thông báo lỗi phải đúng như hành vi cũ');
  });

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
