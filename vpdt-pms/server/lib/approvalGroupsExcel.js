// lib/approvalGroupsExcel.js — Tải Mẫu/Nhập Excel cho "🖋️ Nhóm Phê Duyệt Trình/HĐ" (kind 'submission'/
// 'contract') + "🖊️ Nhóm Phê Duyệt Cuối" (10 kind EXTRA_APPROVAL, 1 module/quy trình mỗi kind) — 10/2026,
// dùng CHUNG engine lib/groupedExcelImport.js (gộp nhiều dòng thành 1 bản ghi theo mã lặp lại) — xem chú
// thích đầy đủ cơ chế gộp/parse ở đầu file đó, KHÔNG sửa file đó ở đây.
//
// NGUỒN DỮ LIỆU THẬT: APPROVAL_GROUPS_ADMIN_CONFIG (public/js/module-admin-submissiongroups.js) — 1
// "Nhóm" = {id,label,order,blocking?,singleApprover,allowFileReplacementProposal?,members,actionLabel?},
// 1 "Cấp" = {id,label,order,visibleGroupIds(null=tất cả),lockedGroupIds,isSystemDefault?}. File này CHỈ
// đọc/validate + trả preview {groupsByModule,levelsByModule,errors} — KHÔNG ghi gì vào CSDL. Client tự
// gộp vào DB.<groupsKey>/DB.<levelsKey> rồi ghi qua ĐÚNG con đường ghi hiện có (POST /api/data/<key>,
// validate thật ở lib/createValidation.js::assertApprovalGroupsSingleApproverCaps()/
// assertApprovalGroupsMembersCanBeApprover() — KHÔNG lặp lại 2 kiểm tra đó ở đây).
//
// QUYẾT ĐỊNH THIẾT KẾ quan trọng (bắt buộc đọc trước khi sửa) — cột "Mã Nhóm"/"Mã Cấp" PHẢI
// required:true (KHÁC với mô tả "để trống = tạo mới" nghe có vẻ hiển nhiên): lib/groupedExcelImport.js
// CHẶN CỨNG groupKeyCol trống ở CẢ 2 lớp (parse-theo-cột NẾU required:true, VÀ lớp gộp nhóm
// groupParsedRows() LUÔN LUÔN bất kể required — xem 2 test chuyên biệt "thiếu mã nhóm"/"groupKeyCol
// KHÔNG required... vẫn báo lỗi" ở tests/test-grouped-excel-import.js) — không có cách nào (mà không sửa
// file đó) để "trống" đi qua được tới lớp gộp. Tie-break THỰC TẾ ở đây vẫn ĐÚNG yêu cầu người dùng (khớp
// ĐÚNG mã đã có -> THAY THẾ; mã lạ/không khớp -> TẠO MỚI, server tự sinh id thật) — chỉ khác đúng 1 điểm:
// thay vì "để Ô TRỐNG HẲN", admin gõ 1 mã TẠM bất kỳ không trùng mã đã có (VD "MOI1") để các dòng cùng 1
// bản ghi mới (VD nhiều Thành Viên) nhận biết nhau trong lúc đọc file — mã tạm đó KHÔNG được giữ lại làm
// id thật (client tự sinh id mới qua approvalGroupsGenId(), xem module-admin-submissiongroups.js), đã nêu
// rõ trong ghi chú cột + sheet "Hướng Dẫn" của file mẫu.
//
// 10 "kind" EXTRA_APPROVAL dùng CHUNG 1 file mẫu/1 lần Nhập (gộp cả 10 module vào 1 file 2 sheet, thêm 1
// cột "Module" đầu tiên) vì cùng 1 MÀN "Nhóm Phê Duyệt Cuối", chỉ đổi dropdown module — xem
// routes/approvalGroupsExcelImport.js. groupKeyCol vẫn là 1 cột đơn 'code' (engine không hỗ trợ gộp theo
// tổ hợp nhiều cột) — nếu 2 dòng ở 2 module KHÁC NHAU tình cờ gõ TRÙNG "Mã Nhóm"/"Mã Cấp", lớp gộp của
// engine sẽ coi là CÙNG 1 bản ghi rồi so sánh field cha (bao gồm cả "Module") -> tự báo lỗi rõ ràng "khác
// với dòng đầu" (do Module chắc chắn khác nhau) nếu 2 bản ghi đó thật sự khác nhau — AN TOÀN (chặn rõ
// ràng, không âm thầm gộp sai) trong tuyệt đại đa số trường hợp (Xuất-rồi-Nhập-lại dùng id thật, prefix
// đã khác nhau theo từng module — xem groupIdPrefix/levelIdPrefix ở APPROVAL_GROUPS_ADMIN_CONFIG — nên
// không bao giờ trùng), chỉ rủi ro cực hiếm nếu admin tự gõ tay y hệt mã tạm cho 2 module khác nhau VÀ mọi
// field cha khác đều tình cờ giống hệt nhau — hướng dẫn admin dùng mã tạm riêng biệt mỗi dòng mới.
'use strict';
const { buildGroupedTemplateWorkbook, parseGroupedExcelFile } = require('./groupedExcelImport');

const KIND_SUBMISSION = 'submission';
const KIND_CONTRACT = 'contract';

// Trùng đúng EXTRA_APPROVAL_MODULE_LABELS ở module-admin-submissiongroups.js — đổi nhãn ở 1 bên nhớ đổi
// bên kia cho khớp (cùng quy ước đã ghi chú ở file đó).
const EXTRA_APPROVAL_MODULE_LABELS = {
  DOC: '📂 Tài Liệu', CAR: '🚗 Đăng Ký Xe', OFFICE_BUY: '🛒 Mua Bán VP', OFFICE_FIX: '🔧 Sửa Chữa VP',
  VPP: '🖇️ Văn Phòng Phẩm', PAYMENT: '💰 Thanh Toán',
  ITPRICE_RETAIL: '🏷️ Phê Duyệt Giá Bán Lẻ', ITPRICE_WHOLESALE: '🏪 Phê Duyệt Giá Bán Buôn',
  OPERATION_ORDER_STORE: '📦 Vận Hành - Đặt Hàng Tại Siêu Thị', OPERATION_ORDER_HO: '📦 Vận Hành - Đặt Hàng Tại HO'
};
const EXTRA_APPROVAL_MODULE_KEYS = Object.keys(EXTRA_APPROVAL_MODULE_LABELS);

// 12 "kind" hợp lệ — route dùng để trả 404 cho kind sai.
const VALID_APPROVAL_GROUPS_KINDS = [KIND_SUBMISSION, KIND_CONTRACT, ...EXTRA_APPROVAL_MODULE_KEYS];

function isExtraApprovalKind(kind) {
  return EXTRA_APPROVAL_MODULE_KEYS.includes(kind);
}

function isValidApprovalGroupsKind(kind) {
  return VALID_APPROVAL_GROUPS_KINDS.includes(kind);
}

// cfg khớp đúng shape APPROVAL_GROUPS_ADMIN_CONFIG[kind] (client) — chỉ cần 2 cờ hasBlocking/
// hasFileReplacement, route tự truyền vào (xem resolveApprovalGroupsKind() ở routes/).
function getApprovalGroupsCfg(kind) {
  if (kind === KIND_SUBMISSION) return { hasBlocking: true, hasFileReplacement: true };
  if (kind === KIND_CONTRACT) return { hasBlocking: false, hasFileReplacement: false };
  if (isExtraApprovalKind(kind)) return { hasBlocking: false, hasFileReplacement: false };
  return null;
}

const MODULE_COLUMN = {
  header: 'Module', key: 'moduleKey', type: 'enum', required: true, width: 30,
  options: EXTRA_APPROVAL_MODULE_KEYS.map((k) => ({ value: k, label: EXTRA_APPROVAL_MODULE_LABELS[k] })),
  note: 'Chọn ĐÚNG 1 trong 10 quy trình — mỗi dòng chỉ thuộc về 1 quy trình (module) duy nhất.'
};

const CODE_NOTE = 'Nếu đây là bản ghi ĐÃ CÓ (xem đúng cột này lúc Xuất Excel) — GIỮ NGUYÊN giá trị để THAY THẾ (cập nhật) đúng bản ghi đó. Nếu đây là bản ghi MỚI — gõ 1 mã TẠM bất kỳ (KHÔNG trùng mã đã có, VD "MOI1", "MOI2"...) để các dòng cùng 1 bản ghi (VD nhiều Thành Viên) nhận biết nhau khi đọc file — mã tạm này KHÔNG được giữ lại làm mã thật, hệ thống tự sinh mã mới khi lưu. Mỗi bản ghi MỚI dùng 1 mã tạm RIÊNG (không trùng mã tạm của bản ghi mới khác trong cùng file).';

// buildApprovalGroupsSpec(kind, cfg) -> spec cho buildGroupedTemplateWorkbook()/parseGroupedExcelFile().
// cfg: { hasBlocking, hasFileReplacement } (xem getApprovalGroupsCfg() ở trên).
function buildApprovalGroupsSpec(kind, cfg) {
  const extra = isExtraApprovalKind(kind);
  const moduleCols = extra ? [MODULE_COLUMN] : [];

  const groupColumns = [
    ...moduleCols,
    { header: 'Mã Nhóm', key: 'code', type: 'text', required: true, width: 16, note: CODE_NOTE },
    { header: 'Tên Nhóm', key: 'label', type: 'text', required: true, maxLength: 150, width: 28 },
    { header: 'Thứ Tự', key: 'order', type: 'int', required: true, min: 0, max: 9999, width: 10,
      note: 'Số thứ tự hiển thị/thực thi (0, 1, 2...) — số nhỏ hơn đứng trước.' },
    { header: 'Nhãn Phê Duyệt', key: 'actionLabel', type: 'text', maxLength: 60, width: 20,
      note: 'Chữ hiện trên nút bấm + chân ký khi hoàn tất bước này (VD "Xác Nhận", "Thẩm Định"...) — để trống dùng mặc định "Phê Duyệt".' },
    { header: 'Chỉ 1 Người?', key: 'singleApprover', type: 'bool', width: 14,
      note: 'Có = nhóm chỉ được gán tối đa 1 thành viên.' }
  ];
  if (cfg.hasBlocking) {
    groupColumns.push({ header: 'Chặn Quy Trình?', key: 'blocking', type: 'bool', default: true, width: 16,
      note: 'Không = nhóm chỉ là kênh tham khảo song song (VD Xin ý kiến), không cộng thêm bước duyệt nào.' });
  }
  if (cfg.hasFileReplacement) {
    groupColumns.push({ header: 'Đề Xuất Thay File?', key: 'allowFileReplacementProposal', type: 'bool', width: 16,
      note: 'Có = người duyệt ở bước của nhóm này có thêm lựa chọn đề xuất thay thế toàn bộ tệp tờ trình.' });
  }
  groupColumns.push({ header: 'Username Thành Viên', key: 'member', type: 'text', maxLength: 100, width: 22,
    note: 'Mỗi dòng 1 username — nhóm có N thành viên thì lặp lại N dòng CÙNG "Mã Nhóm" này, chỉ đổi cột này. Để trống nếu nhóm chưa có thành viên nào.' });

  const levelColumns = [
    ...moduleCols,
    { header: 'Mã Cấp', key: 'code', type: 'text', required: true, width: 16, note: CODE_NOTE },
    { header: 'Tên Cấp', key: 'label', type: 'text', required: true, maxLength: 150, width: 28 },
    { header: 'Thứ Tự', key: 'order', type: 'int', required: true, min: 0, max: 9999, width: 10 },
    { header: 'Mã Nhóm Bắt Buộc', key: 'lockedGroupIds', type: 'array', sep: ';', width: 40,
      note: 'Mã (hoặc Tên) các Nhóm bị KHOÁ BẮT BUỘC tick sẵn ở cấp này, cách nhau bằng dấu chấm phẩy ";" — PHẢI nằm trong "Mã Nhóm Hiển Thị" bên cạnh (hoặc để trống nếu cấp này hiển thị Tất cả nhóm). Để trống = không khoá nhóm nào.' },
    { header: 'Mã Nhóm Hiển Thị', key: 'groupId', type: 'text', width: 20,
      note: 'Mỗi dòng 1 Mã (hoặc Tên) Nhóm được PHÉP hiện ra ở cấp này — lặp lại nhiều dòng CÙNG "Mã Cấp" này, mỗi dòng 1 nhóm. ĐỂ TRỐNG Ở MỌI DÒNG của 1 "Mã Cấp" = áp dụng TẤT CẢ các nhóm (không được để trống xen kẽ dòng có giá trị).' }
  ];

  return {
    label: extra ? 'Nhóm Phê Duyệt Cuối' : (kind === KIND_SUBMISSION ? 'Nhóm Phê Duyệt Trình' : 'Nhóm Phê Duyệt HĐ'),
    extraGuideLines: [
      'Cột "Mã Nhóm"/"Mã Cấp": khớp ĐÚNG mã đã có (xem lúc Xuất Excel) -> THAY THẾ (cập nhật); mã TẠM/không khớp -> TẠO MỚI (hệ thống tự sinh mã thật, không giữ mã bạn gõ).',
      ...(extra ? ['File này DÙNG CHUNG cho CẢ 10 quy trình (cột "Module") — xoá/thêm dòng của quy trình nào không ảnh hưởng quy trình khác.'] : [])
    ],
    sheets: [
      {
        sheetName: 'Nhóm',
        note: 'Mỗi "Nhóm Phê Duyệt" có thể trải ra NHIỀU DÒNG (1 dòng/thành viên) — các dòng cùng 1 nhóm phải giống nhau ở mọi cột TRỪ "Username Thành Viên". Xem cột "Mã Nhóm" ở sheet "Hướng Dẫn" để biết quy tắc Thay Thế/Tạo Mới.',
        groupKeyCol: 'code',
        childKeys: ['member'],
        columns: groupColumns,
        sampleRows: extra
          ? [
            { moduleKey: EXTRA_APPROVAL_MODULE_KEYS[0], code: 'MOI1', label: 'Nhóm Mẫu', order: 0, actionLabel: '', singleApprover: false, member: 'user1' },
            { moduleKey: EXTRA_APPROVAL_MODULE_KEYS[0], code: 'MOI1', label: 'Nhóm Mẫu', order: 0, actionLabel: '', singleApprover: false, member: 'user2' }
          ]
          : [{ code: 'MOI1', label: 'Nhóm Mẫu', order: 0, actionLabel: '', singleApprover: false, member: 'user1' }]
      },
      {
        sheetName: 'Cấp',
        note: 'Mỗi "Cấp Phê Duyệt Cuối Cùng" có thể trải ra NHIỀU DÒNG (1 dòng/nhóm hiển thị) — các dòng cùng 1 cấp phải giống nhau ở mọi cột TRỪ "Mã Nhóm Hiển Thị". Để TRỐNG cột đó Ở MỌI DÒNG của 1 cấp = áp dụng Tất Cả Nhóm.',
        groupKeyCol: 'code',
        childKeys: ['groupId'],
        columns: levelColumns,
        sampleRows: extra
          ? [{ moduleKey: EXTRA_APPROVAL_MODULE_KEYS[0], code: 'MOICAP1', label: 'Cấp Mẫu', order: 0, lockedGroupIds: [], groupId: '' }]
          : [{ code: 'MOICAP1', label: 'Cấp Mẫu', order: 0, lockedGroupIds: [], groupId: '' }]
      }
    ]
  };
}

function buildApprovalGroupsTemplateWorkbook(kind, cfg) {
  return buildGroupedTemplateWorkbook(buildApprovalGroupsSpec(kind, cfg));
}

// parseApprovalGroupsFile(kind, cfg, buffer, ext) -> { groupsByModule, levelsByModule, errors }
// groupsByModule/levelsByModule: { '<moduleKey>': [...] } cho kind EXTRA_APPROVAL (10 moduleKey có thể
// xuất hiện), hoặc { '_single': [...] } cho kind 'submission'/'contract' (không phân module).
// errors: [{ sheet, row, column?, message }] — gộp cả lỗi parse-theo-cột lẫn lỗi gộp nhóm.
async function parseApprovalGroupsFile(kind, cfg, buffer, ext) {
  const extra = isExtraApprovalKind(kind);
  const spec = buildApprovalGroupsSpec(kind, cfg);
  const raw = await parseGroupedExcelFile(spec, buffer, ext);

  const errors = [];
  const groupsByModule = {};
  const levelsByModule = {};

  const nhom = raw['Nhóm'] || { groups: [], errors: [] };
  (nhom.errors || []).forEach((e) => errors.push({ sheet: 'Nhóm', ...e }));
  (nhom.groups || []).forEach((g) => {
    const moduleKey = extra ? g.moduleKey : '_single';
    if (extra && !EXTRA_APPROVAL_MODULE_KEYS.includes(moduleKey)) {
      errors.push({ sheet: 'Nhóm', row: g._firstRow, message: `Mã Nhóm "${g.code}": giá trị cột "Module" không hợp lệ` });
      return;
    }
    const members = (g._children || []).map((v) => String(v ?? '').trim()).filter(Boolean);
    const record = {
      code: g.code || '', label: g.label, order: g.order, actionLabel: g.actionLabel || '',
      singleApprover: !!g.singleApprover, members
    };
    if (cfg.hasBlocking) record.blocking = g.blocking !== false;
    if (cfg.hasFileReplacement) record.allowFileReplacementProposal = !!g.allowFileReplacementProposal;
    if (extra) record.moduleKey = moduleKey;
    (groupsByModule[moduleKey] = groupsByModule[moduleKey] || []).push(record);
  });

  const cap = raw['Cấp'] || { groups: [], errors: [] };
  (cap.errors || []).forEach((e) => errors.push({ sheet: 'Cấp', ...e }));
  (cap.groups || []).forEach((lv) => {
    const moduleKey = extra ? lv.moduleKey : '_single';
    if (extra && !EXTRA_APPROVAL_MODULE_KEYS.includes(moduleKey)) {
      errors.push({ sheet: 'Cấp', row: lv._firstRow, message: `Mã Cấp "${lv.code}": giá trị cột "Module" không hợp lệ` });
      return;
    }
    const childRaw = lv._children || [];
    const nonEmpty = childRaw.map((v, i) => ({ v: String(v ?? '').trim(), i })).filter((x) => x.v);
    let visibleGroupIds;
    if (!nonEmpty.length) {
      visibleGroupIds = null; // mọi dòng trống -> Tất cả nhóm
    } else if (nonEmpty.length === childRaw.length) {
      visibleGroupIds = nonEmpty.map((x) => x.v);
    } else {
      errors.push({
        sheet: 'Cấp', row: lv._firstRow,
        message: `Mã Cấp "${lv.code}": cột "Mã Nhóm Hiển Thị" không được để trống xen kẽ — hoặc để TRỐNG Ở MỌI DÒNG (áp dụng Tất Cả Nhóm) hoặc điền ĐẦY ĐỦ ở MỌI DÒNG.`
      });
      return;
    }
    const record = {
      code: lv.code || '', label: lv.label, order: lv.order,
      visibleGroupIds, lockedGroupIds: Array.isArray(lv.lockedGroupIds) ? lv.lockedGroupIds : []
    };
    if (extra) record.moduleKey = moduleKey;
    (levelsByModule[moduleKey] = levelsByModule[moduleKey] || []).push(record);
  });

  return { groupsByModule, levelsByModule, errors };
}

module.exports = {
  EXTRA_APPROVAL_MODULE_KEYS,
  EXTRA_APPROVAL_MODULE_LABELS,
  VALID_APPROVAL_GROUPS_KINDS,
  isExtraApprovalKind,
  isValidApprovalGroupsKind,
  getApprovalGroupsCfg,
  buildApprovalGroupsSpec,
  buildApprovalGroupsTemplateWorkbook,
  parseApprovalGroupsFile
};
