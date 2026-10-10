// lib/workflowStepsExcel.js — Tải Mẫu/Nhập/Xuất Excel cho "🛠️ Định Nghĩa Các Mẫu Bước Phê Duyệt"
// (Hệ Thống > 🔄 Quy Trình & Phê Duyệt, bảng #workflowTableBody). 10/2026, 1 trong 4 nhánh song song
// dùng chung lib/groupedExcelImport.js (đọc kỹ NOTE đầu file đó trước khi sửa gì ở đây — KHÔNG đổi API
// của engine dùng chung).
//
// DB.workflows (AppData key 'workflows', admin-only — xem ADMIN_ONLY_KEYS ở routes/data.js) có cấu trúc
// { id, name, steps: [{order, name, actionLabel}] }. Mỗi "Mẫu Quy Trình" trải ra NHIỀU DÒNG Excel (1 dòng
// = 1 bước) — gộp lại qua groupKeyCol 'code' (-> field 'id' thật khi build bản ghi cuối).
//
// CHỈ build file mẫu + parse/validate trả {records, errors} — KHÔNG đọc/ghi DB.workflows ở đây. Đối
// chiếu với DB.workflows hiện có (mã nào đã tồn tại -> THAY THẾ, mã nào mới -> THÊM, cảnh báo đổi số bước
// đang được dùng ở nơi khác) do CLIENT tự làm (importWorkflowStepsExcel(), module-itsupport-tier.js) —
// tái dùng ĐÚNG collectWorkflowTemplateUsages()/syncStorage('workflows') đã có, giống hệt tinh thần
// saveWorkflowTemplate(). Lib này không nhận existingWorkflows vì việc gộp/cảnh báo đó cần nhiều hàm
// client-only (confirm(), collectWorkflowTemplateUsages() đọc WF_MODULE_CONFIG/DB chỉ có ở client).
'use strict';
const { buildGroupedTemplateWorkbook, parseGroupedExcelFile } = require('./groupedExcelImport');

const SHEET_NAME = 'Mẫu Quy Trình';

const WORKFLOW_STEPS_SPEC = {
  label: 'Mẫu Quy Trình (Bước Phê Duyệt)',
  sheets: [{
    sheetName: SHEET_NAME,
    note: 'Mỗi DÒNG = 1 BƯỚC phê duyệt. Mã WF LẶP LẠI ở các dòng cùng 1 quy trình để gộp thành 1 bản ghi — Tên Quy Trình phải GIỐNG NHAU ở mọi dòng cùng Mã WF. Thứ Tự Bước dùng để sắp xếp (không cần liên tục, hệ thống tự đánh lại số thứ tự 1,2,3... khi nhập).',
    groupKeyCol: 'code',
    childKeys: ['stepOrder', 'stepName', 'actionLabel'],
    columns: [
      { header: 'Mã WF', key: 'code', type: 'text', required: true, width: 14 },
      { header: 'Tên Quy Trình', key: 'name', type: 'text', required: true, width: 32 },
      { header: 'Thứ Tự Bước', key: 'stepOrder', type: 'int', required: true, min: 1, width: 12 },
      { header: 'Tên Bước', key: 'stepName', type: 'text', required: true, width: 26 },
      { header: 'Nhãn Hành Động', key: 'actionLabel', type: 'text', width: 20, note: 'Để trống = mặc định "Phê Duyệt"' }
    ],
    sampleRows: [
      { code: 'WF_1STEP', name: 'Quy trình 1 bước (Sếp duyệt)', stepOrder: 1, stepName: 'Phê duyệt 1', actionLabel: '' },
      { code: 'WF_2STEP', name: 'Quy trình 2 bước (Trưởng phòng -> BGD)', stepOrder: 1, stepName: 'Trưởng Phòng', actionLabel: '' },
      { code: 'WF_2STEP', name: 'Quy trình 2 bước (Trưởng phòng -> BGD)', stepOrder: 2, stepName: 'Ban Giám Đốc', actionLabel: '' }
    ]
  }],
  extraGuideLines: [
    'Mã WF trùng với mẫu quy trình ĐÃ CÓ sẵn trong hệ thống sẽ THAY THẾ toàn bộ các bước của mẫu đó.',
    'Mã WF chưa từng có sẽ được THÊM MỚI.'
  ]
};

function buildWorkflowStepsTemplateWorkbook() {
  return buildGroupedTemplateWorkbook(WORKFLOW_STEPS_SPEC);
}

// buildWorkflowStepsRecordsFromGroups(groups) — groups là kết quả parseGroupedExcelFile(...)[SHEET_NAME].groups
// (mỗi group: {code, name, _children:[{stepOrder,stepName,actionLabel}], _order, _firstRow}). Trả
// { records: [{id,name,steps}], errors: [{row?,message}] } ĐÚNG khuôn DB.workflows thật.
function buildWorkflowStepsRecordsFromGroups(groups) {
  const records = [];
  const errors = [];
  (groups || []).forEach((g) => {
    const children = g._children || [];
    if (!children.length) {
      errors.push({ row: g._firstRow, message: `Mã WF "${g.code}" không có bước nào` });
      return;
    }
    const countByOrder = new Map();
    children.forEach((c) => {
      const k = c.stepOrder;
      countByOrder.set(k, (countByOrder.get(k) || 0) + 1);
    });
    const dupOrders = [...countByOrder.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    if (dupOrders.length) {
      errors.push({ row: g._firstRow, message: `Mã WF "${g.code}": có nhiều bước trùng Thứ Tự Bước (${dupOrders.join(', ')}) — mỗi bước phải có 1 số thứ tự riêng` });
      return;
    }
    const sorted = children.slice().sort((a, b) => (Number(a.stepOrder) || 0) - (Number(b.stepOrder) || 0));
    const steps = sorted.map((c, idx) => ({
      order: idx + 1,
      name: c.stepName,
      actionLabel: c.actionLabel ? c.actionLabel : null
    }));
    records.push({ id: g.code, name: g.name, steps });
  });
  return { records, errors };
}

// parseWorkflowStepsFile(buffer, ext) -> { records, errors } (gộp lỗi parse/gộp nhóm của engine chung +
// lỗi thứ tự bước ở trên). KHÔNG ghi gì vào CSDL — xem chú thích đầu file.
async function parseWorkflowStepsFile(buffer, ext) {
  const parsed = await parseGroupedExcelFile(WORKFLOW_STEPS_SPEC, buffer, ext);
  const sheetResult = parsed[SHEET_NAME] || { groups: [], errors: [] };
  const { records, errors: recordErrors } = buildWorkflowStepsRecordsFromGroups(sheetResult.groups);
  return { records, errors: [...(sheetResult.errors || []), ...recordErrors] };
}

module.exports = {
  SHEET_NAME,
  WORKFLOW_STEPS_SPEC,
  buildWorkflowStepsTemplateWorkbook,
  buildWorkflowStepsRecordsFromGroups,
  parseWorkflowStepsFile
};
