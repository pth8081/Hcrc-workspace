// server/tests/test-checklist-store-overall-pass.js
//
// Regression test cho tính năng "Đạt Chung Theo Siêu Thị" (10/2026, yêu cầu người dùng): trước đây siêu
// thị phải hoàn thành TẤT CẢ mẫu STORE_SELF đang ACTIVE, "Tỉ Lệ Đạt" ở Báo Cáo chỉ tính trên số BÀI NỘP
// (không có khái niệm "đạt chung của 1 siêu thị"). Người dùng yêu cầu: siêu thị làm bao nhiêu mẫu tuỳ ý
// trong kỳ, "Đạt" tính TRÊN SỐ MẪU ĐÃ HOÀN THÀNH đó — mẫu CHƯA làm trong kỳ không bị trừ gì, đơn giản
// không nằm trong mẫu số ("chưa đạt chỉ tính khi CHƯA kết thúc bài của mẫu đó, kết thúc bao nhiêu thì
// tính trên 100% của chính số đó" — nguyên văn xác nhận của người dùng).
//
// Chạy: node server/tests/test-checklist-store-overall-pass.js
'use strict';
const { createRunner, assertEqual } = require('./testHarness');
const checklist = require('../lib/checklist');

const run = createRunner();

function sub({ storeCode, templateId, isPassed }) {
  return { storeCode, templateId, isPassed };
}

async function main() {

await run.run('computeChecklistStoreOverallPass(): mảng rỗng -> trả về mảng rỗng', () => {
  assertEqual(JSON.stringify(checklist.computeChecklistStoreOverallPass([])), '[]');
  assertEqual(JSON.stringify(checklist.computeChecklistStoreOverallPass(null)), '[]');
});

await run.run('computeChecklistStoreOverallPass(): 1 siêu thị hoàn thành 2 mẫu, CẢ 2 Đạt -> Đạt Chung 100%', () => {
  const result = checklist.computeChecklistStoreOverallPass([
    sub({ storeCode: 'ST A', templateId: 1, isPassed: true }),
    sub({ storeCode: 'ST A', templateId: 2, isPassed: true })
  ]);
  assertEqual(result.length, 1);
  assertEqual(result[0].completedCount, 2);
  assertEqual(result[0].passedCount, 2);
  assertEqual(result[0].passRate, 100);
  assertEqual(result[0].overallStatus, 'PASS');
});

await run.run('computeChecklistStoreOverallPass(): hoàn thành 3 mẫu, 1 mẫu KHÔNG đạt -> Đạt Chung = FAIL, tỉ lệ tính trên 3 (không phải tổng mẫu đang có)', () => {
  const result = checklist.computeChecklistStoreOverallPass([
    sub({ storeCode: 'ST B', templateId: 1, isPassed: true }),
    sub({ storeCode: 'ST B', templateId: 2, isPassed: true }),
    sub({ storeCode: 'ST B', templateId: 3, isPassed: false })
  ]);
  assertEqual(result[0].completedCount, 3, 'Mẫu số PHẢI là 3 (số mẫu đã hoàn thành), không phải tổng số mẫu đang có trong hệ thống');
  assertEqual(result[0].passedCount, 2);
  assertEqual(Math.round(result[0].passRate * 10) / 10, 66.7);
  assertEqual(result[0].overallStatus, 'FAIL');
});

await run.run('computeChecklistStoreOverallPass(): CHỈ hoàn thành 1 mẫu duy nhất (ít hơn nhiều so với tổng mẫu đang có) và Đạt -> vẫn tính Đạt Chung 100% (không bị phạt vì chưa làm các mẫu khác)', () => {
  const result = checklist.computeChecklistStoreOverallPass([
    sub({ storeCode: 'ST C', templateId: 5, isPassed: true })
  ]);
  assertEqual(result[0].completedCount, 1);
  assertEqual(result[0].passRate, 100);
  assertEqual(result[0].overallStatus, 'PASS', 'Chỉ hoàn thành 1 mẫu và Đạt thì PHẢI tính Đạt Chung — không bị trừ vì các mẫu khác chưa làm');
});

await run.run('computeChecklistStoreOverallPass(): CÙNG 1 mẫu nộp bài 2 LẦN trong kỳ (làm lại) -> chỉ tính 1 lần (bài SAU CÙNG), không đếm trùng', () => {
  const result = checklist.computeChecklistStoreOverallPass([
    sub({ storeCode: 'ST D', templateId: 9, isPassed: false }), // lần 1: không đạt
    sub({ storeCode: 'ST D', templateId: 9, isPassed: true })   // lần 2 (sau cùng): đã khắc phục, đạt
  ]);
  assertEqual(result[0].completedCount, 1, 'Cùng 1 mẫu nộp 2 lần KHÔNG được đếm thành 2 mẫu đã hoàn thành');
  assertEqual(result[0].passedCount, 1);
  assertEqual(result[0].overallStatus, 'PASS', 'Phải lấy bài nộp SAU CÙNG (đã đạt) làm đại diện, không phải bài đầu tiên');
});

await run.run('computeChecklistStoreOverallPass(): nhiều siêu thị -> tách đúng riêng biệt, không trộn lẫn, sắp xếp theo tên', () => {
  const result = checklist.computeChecklistStoreOverallPass([
    sub({ storeCode: 'ST Z', templateId: 1, isPassed: true }),
    sub({ storeCode: 'ST A', templateId: 1, isPassed: false }),
    sub({ storeCode: 'ST A', templateId: 2, isPassed: true })
  ]);
  assertEqual(result.map(r => r.storeCode).join(','), 'ST A,ST Z', 'Phải sắp xếp theo tên siêu thị');
  const stA = result.find(r => r.storeCode === 'ST A');
  const stZ = result.find(r => r.storeCode === 'ST Z');
  assertEqual(stA.completedCount, 2); assertEqual(stA.overallStatus, 'FAIL');
  assertEqual(stZ.completedCount, 1); assertEqual(stZ.overallStatus, 'PASS');
});

run.summary();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
