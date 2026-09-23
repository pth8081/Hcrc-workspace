// server/tests/test-checklist-vsattp-dashboard-aggregation.js
//
// Unit test THUẦN cho lib/checklist.js::computeVsattpDashboardData() + các hàm con (10/2026, tính năng
// "Báo Cáo Đánh Giá VSATTP") — không cần server/DB, gọi thẳng hàm. Đây là NGUỒN SỰ THẬT dùng khi xuất
// Excel (routes/checklist.js POST /vsattp-dashboard/export) — phải đúng TUYỆT ĐỐI, không chỉ hiển thị.
//
// Kịch bản phủ:
//   1. Top 5 sắp đúng thứ tự cao->thấp/thấp->cao, giới hạn đúng 5 dòng dù có nhiều hơn.
//   2. Tách đúng ST/CH theo storeTypes, loại các đơn vị chưa phân loại khỏi Top 5/tỷ lệ vi phạm.
//   3. Áp dụng cho MỌI mẫu templateKind==='DEDUCTION' (không hardcode tên "VSATTP") — 2 mẫu khác nhau
//      cùng gộp vào 1 Dashboard, tiêu chí trùng id giữa 2 mẫu KHÔNG bị lẫn (key theo templateId:criteriaId).
//   4. Tỷ lệ vi phạm: mẫu số = số đơn vị PHÂN BIỆT đã kiểm tra trong kỳ (không phải tổng danh mục), đếm
//      đúng 1 lần dù 1 đơn vị vi phạm CÙNG 1 tiêu chí ở NHIỀU lượt kiểm tra khác nhau.
//   5. Điểm trung bình/đơn vị = trung bình scorePercent của mọi bài SUBMITTED (không tính bài DRAFT/không
//      có điểm).
//
// Chạy: node server/tests/test-checklist-vsattp-dashboard-aggregation.js
'use strict';
const checklist = require('../lib/checklist');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

const TEMPLATE_VSATTP = {
  id: 1, templateKind: 'DEDUCTION', templateName: 'Checklist Đánh Giá VSATTP',
  categories: [
    { name: 'Chất Lượng', maxDeduction: 30, subItems: [{ name: 'Cảm quan', criteria: [
      { id: 101, description: 'Sản phẩm hết hạn sử dụng' },
      { id: 102, description: 'Bao bì không nguyên vẹn' }
    ] }] }
  ]
};
// Mẫu DEDUCTION THỨ 2 (giả lập) — id tiêu chí TRÙNG với mẫu trên (101/102) nhưng mô tả KHÁC — kiểm tra
// key gộp theo templateId:criteriaId không bị lẫn giữa 2 mẫu (mục 3 ở trên).
const TEMPLATE_KHO = {
  id: 2, templateKind: 'DEDUCTION', templateName: 'Checklist Đánh Giá Kho Bãi',
  categories: [
    { name: 'An Toàn Kho', maxDeduction: 20, subItems: [{ name: 'PCCC', criteria: [
      { id: 101, description: 'Bình chữa cháy hết hạn' }
    ] }] }
  ]
};
const TEMPLATE_QA = { id: 3, templateKind: 'QA', templateName: 'Checklist Tự Đánh Giá' }; // KHÔNG phải DEDUCTION -> phải bị loại khỏi Dashboard

function sub(over) {
  return { templateId: 1, status: 'SUBMITTED', deductions: [], ...over };
}

async function main() {
  // ===== 1+5. Top 5 sắp đúng thứ tự + giới hạn 5 dòng + chỉ tính bài SUBMITTED có điểm =====
  {
    const storeTypes = {};
    const subs = [];
    for (let i = 1; i <= 8; i++) {
      storeTypes[`ST${i}`] = 'ST';
      subs.push(sub({ storeCode: `ST${i}`, scorePercent: 100 - i * 5 })); // ST1=95 cao nhất .. ST8=60 thấp nhất
    }
    subs.push(sub({ storeCode: 'ST_DRAFT', scorePercent: null, status: 'SUBMITTED' })); // không có điểm -> không vào avgMap
    storeTypes.ST_DRAFT = 'ST';
    const data = checklist.computeVsattpDashboardData(subs, [TEMPLATE_VSATTP], storeTypes);
    check('Top 5 ST cao nhất đúng 5 dòng, sắp giảm dần', data.topStHigh.length === 5 && data.topStHigh[0].storeCode === 'ST1' && data.topStHigh[4].storeCode === 'ST5', data.topStHigh);
    check('Top 5 ST thấp nhất đúng 5 dòng, sắp tăng dần', data.topStLow.length === 5 && data.topStLow[0].storeCode === 'ST8' && data.topStLow[4].storeCode === 'ST4', data.topStLow);
    check('Bài không có scorePercent (null) không vào Top 5', !data.topStHigh.some(r => r.storeCode === 'ST_DRAFT') && !data.topStLow.some(r => r.storeCode === 'ST_DRAFT'));
  }

  // ===== 2. Tách ST/CH + loại chưa phân loại =====
  {
    const storeTypes = { A: 'ST', B: 'CH' }; // 'C' KHÔNG có trong storeTypes -> chưa phân loại
    const subs = [
      sub({ storeCode: 'A', scorePercent: 90 }),
      sub({ storeCode: 'B', scorePercent: 80 }),
      sub({ storeCode: 'C', scorePercent: 70 })
    ];
    const data = checklist.computeVsattpDashboardData(subs, [TEMPLATE_VSATTP], storeTypes);
    check('ST chỉ gồm đúng "A"', data.stCodes.length === 1 && data.stCodes[0] === 'A', data.stCodes);
    check('CH chỉ gồm đúng "B"', data.chCodes.length === 1 && data.chCodes[0] === 'B', data.chCodes);
    check('"C" (chưa phân loại) vào unclassifiedCodes, KHÔNG vào ST/CH', data.unclassifiedCodes.includes('C') && !data.stCodes.includes('C') && !data.chCodes.includes('C'));
    check('Top 5 ST cao nhất KHÔNG lẫn "C" dù điểm thấp hơn "A"', !data.topStHigh.some(r => r.storeCode === 'C'));
  }

  // ===== 3. Áp dụng MỌI mẫu DEDUCTION, loại mẫu QA, không lẫn tiêu chí trùng id giữa 2 mẫu =====
  {
    const storeTypes = { A: 'ST', B: 'ST' };
    const subs = [
      sub({ templateId: 1, storeCode: 'A', scorePercent: 90, deductions: [{ criteriaId: 101, deductedPoints: 4 }] }), // mẫu VSATTP, tiêu chí 101 = "Sản phẩm hết hạn sử dụng"
      sub({ templateId: 2, storeCode: 'B', scorePercent: 85, deductions: [{ criteriaId: 101, deductedPoints: 2 }] }), // mẫu Kho Bãi, tiêu chí 101 = "Bình chữa cháy hết hạn" (id TRÙNG, mẫu KHÁC)
      // Bài của mẫu QA (templateId 3, không phải DEDUCTION) — PHẢI bị loại khỏi toàn bộ Dashboard. Theo
      // đúng hợp đồng của computeVsattpDashboardData() (submissions ĐÃ lọc sẵn TRƯỚC KHI gọi — xem chú
      // thích hàm), bước lọc templateKind===DEDUCTION diễn ra ở ĐÂY (mirror đúng route/client thật) chứ
      // KHÔNG phải bên trong hàm — đưa thẳng bài QA vào mà không lọc trước sẽ SAI hợp đồng gọi hàm, không
      // phải lỗi thật của hàm.
      { templateId: 3, status: 'SUBMITTED', storeCode: 'A', scorePercent: 50, answers: [] }
    ];
    const templates = [TEMPLATE_VSATTP, TEMPLATE_KHO, TEMPLATE_QA];
    const deductionIds = new Set(templates.filter(checklist.isDeductionTemplate).map(t => t.id));
    const filtered = subs.filter(s => deductionIds.has(s.templateId));
    check('isDeductionTemplate() lọc đúng: mẫu QA bị loại khỏi tập lọc', filtered.every(s => s.templateId !== 3));
    const data = checklist.computeVsattpDashboardData(filtered, templates, storeTypes);
    check('Mẫu QA (không phải DEDUCTION) không ảnh hưởng Điểm TB — "A" chỉ tính điểm mẫu VSATTP (90, không lẫn 50)', data.avgMap.get('A') === 90, data.avgMap.get('A'));
    const labels = data.violSt.rows.map(r => r.label).sort();
    check('2 tiêu chí id=101 của 2 mẫu KHÁC NHAU đều xuất hiện riêng biệt (không gộp nhầm theo id)', labels.includes('Sản phẩm hết hạn sử dụng') && labels.includes('Bình chữa cháy hết hạn') && labels.length === 2, labels);
  }

  // ===== 4. Tỷ lệ vi phạm: mẫu số = số đơn vị phân biệt trong kỳ, đếm 1 lần dù vi phạm nhiều lượt =====
  {
    const storeTypes = { A: 'ST', B: 'ST', C: 'ST' }; // 3 ST đã kiểm tra trong kỳ -> mẫu số = 3
    const subs = [
      sub({ storeCode: 'A', scorePercent: 90, deductions: [{ criteriaId: 101, deductedPoints: 4 }] }),
      sub({ storeCode: 'A', scorePercent: 88, deductions: [{ criteriaId: 101, deductedPoints: 4 }] }), // A vi phạm LẦN 2 cùng tiêu chí -> vẫn đếm A đúng 1 lần
      sub({ storeCode: 'B', scorePercent: 95, deductions: [] }), // B không vi phạm gì
      sub({ storeCode: 'C', scorePercent: 92, deductions: [{ criteriaId: 102, deductedPoints: 2 }] }) // C vi phạm tiêu chí KHÁC (102)
    ];
    const data = checklist.computeVsattpDashboardData(subs, [TEMPLATE_VSATTP], storeTypes);
    check('Mẫu số tỷ lệ vi phạm = 3 (số ST phân biệt đã kiểm tra trong kỳ)', data.violSt.denom === 3, data.violSt.denom);
    const row101 = data.violSt.rows.find(r => r.label === 'Sản phẩm hết hạn sử dụng');
    check('Tiêu chí 101: đếm ĐÚNG 1 đơn vị ("A") dù vi phạm 2 lượt -> tỷ lệ 1/3 = 33.3%', row101 && row101.count === 1 && Math.abs(row101.pct - 33.333) < 0.01, row101);
    const row102 = data.violSt.rows.find(r => r.label.includes('Bao bì') || r.label === undefined);
    // criteriaId 102 ở TEMPLATE_VSATTP mô tả là "Bao bì không nguyên vẹn" — kiểm tra đúng nhãn + tỷ lệ.
    const row102b = data.violSt.rows.find(r => r.count === 1 && r.label !== row101.label);
    check('Tiêu chí 102 (đơn vị "C" vi phạm): mẫu số vẫn dùng chung 3, tỷ lệ 1/3', row102b && Math.abs(row102b.pct - 33.333) < 0.01, row102b);
    check('Kết quả sắp giảm dần theo tỷ lệ %', data.violSt.rows.every((r, i) => i === 0 || data.violSt.rows[i - 1].pct >= r.pct));
  }

  // ===== Trường hợp rỗng: không có bài nào -> không lỗi, trả mảng rỗng =====
  {
    const data = checklist.computeVsattpDashboardData([], [TEMPLATE_VSATTP], {});
    check('Không có bài nào -> Top 5/tỷ lệ vi phạm đều rỗng, không throw', data.topStHigh.length === 0 && data.topChHigh.length === 0 && data.violSt.rows.length === 0 && data.violSt.denom === 0);
  }

  console.log('');
  console.log(`${pass}/${pass + fail} scenario(s) passed.`);
  if (fail > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
