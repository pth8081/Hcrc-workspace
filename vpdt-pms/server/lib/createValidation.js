// lib/createValidation.js — Bước 2 (phương án C bảo mật): server tự xác minh quyền TẠO hồ sơ mới
// theo đúng phạm vi phòng ban của người gọi, và tự gán người tạo từ phiên đăng nhập — trước đây
// (kể cả sau Bước 0/1) việc tạo mới vẫn đi qua POST /api/data/:key chung: client tự chọn dept trong
// dropdown đã được LỌC SẴN ở giao diện (getScopedDepts()), nhưng server chưa từng xác minh lại — 1
// request tự soạn (bỏ qua UI) vẫn có thể tạo hồ sơ cho phòng ban bất kỳ, và tự xưng "creator" là bất
// kỳ ai. Field "code" cũng chỉ được kiểm tra trùng lặp ở client (race nếu 2 người tạo cùng lúc).
//
// LƯU Ý BẢO TRÌ: scopeAllows() PHẢI giữ giống hệt hàm cùng tên trong index.html (2 cài đặt độc lập,
// xem lib/workflowEngine.js để biết lý do không import chung được).
const { HttpError: CreateError } = require('./httpErrors');
// vppCatalog.js là tiện ích THUẦN (không đọc DB, giống httpErrors.js) — an toàn require thẳng ở đây.
const { validateRegistrationItems: validateVppRegItems } = require('./vppCatalog');
const { sanitizePriceFileItems, sanitizeColumnLabels } = require('./priceFileParser');

function scopeAllows(user, scope, dept) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (scope?.all) return true;
  if (dept && user.dept === dept) return true;
  return !!(dept && Array.isArray(scope?.depts) && scope.depts.includes(dept));
}

// Sao y findMeetingConflict() trong index.html — chặn 2 lịch trùng phòng/khung giờ được tạo đồng
// thời (client chỉ kiểm tra lúc gõ form, không có gì ngăn 2 request cùng lúc đều "thấy" phòng trống).
function findMeetingConflict(meetings, room, startTime, endTime) {
  const newStart = new Date(startTime).getTime();
  const newEnd = new Date(endTime).getTime();
  return (meetings || []).find(m => {
    if (m.status === 'CANCELLED') return false;
    if (m.room !== room) return false;
    const mStart = new Date(m.startTime).getTime();
    const mEnd = new Date(m.endTime).getTime();
    // Giờ NaN (bản ghi cũ lỗi định dạng) so sánh với bất kỳ số nào cũng ra false — coi là "không
    // trùng" là KHÔNG AN TOÀN (chính là lỗ hổng đã phát hiện). Coi bản ghi lỗi định dạng là CÓ trùng
    // (an toàn hơn: chặn tạo mới cho tới khi bản ghi lỗi được xử lý) thay vì bỏ qua như trước.
    if (!Number.isFinite(mStart) || !Number.isFinite(mEnd)) return true;
    return newStart < mEnd && mStart < newEnd;
  });
}

// Đầu Tư (DAU_TU) đã bị xoá hoàn toàn khỏi module Tổng Hợp (tách thành luồng "Phê Duyệt Đơn Hàng" độc
// lập ở module Vận Hành) — bỏ khỏi map này khiến subType='DAU_TU' tự bị chặn ngay tại dòng
// "if (!flag) throw..." bên dưới, không cần thêm điều kiện chặn riêng nào khác.
const OFFICE_SUBTYPE_TO_PERM_FLAG = { MUA_BAN: 'officeBuy', SUA_CHUA: 'officeFix' };

// URL tệp/ảnh do CHÍNH hệ thống này sinh ra luôn có dạng "/uploads/<timestamp>-<16 hex>.<ext>" (xem
// routes/upload.js — tên file do server tự đặt, không chứa ký tự nào người dùng nhập). Các field URL
// "tuỳ chọn, client tự upload trước rồi gửi lại URL" (internalPosts.attachment.fileUrl,
// recruitmentJobs.bannerUrl, recruitmentReferrals.cvFileUrl) TRƯỚC ĐÂY được lưu NGUYÊN VĂN giá trị
// client gửi, rồi render ra `<a href="${escapeHtml(fileUrl)}">` / `<img src="${escapeHtml(url)}">` ở
// public/index.html. escapeHtml() chỉ vô hiệu hoá < > & " ' — KHÔNG hề vô hiệu hoá scheme
// "javascript:" (scheme này không cần bất kỳ ký tự nào trong số đó), nên 1 request tự soạn gửi
// fileUrl:"javascript:..." tạo ra 1 liên kết BẤM ĐƯỢC chạy JS trong phiên đã đăng nhập của người xem
// (stored XSS). Nguy hiểm nhất đúng với người kiểm duyệt bài Truyền Thông Nội Bộ và bộ phận tuyển
// dụng — họ chính là những người BẮT BUỘC phải mở các tệp này để xét duyệt. Chặn ở SERVER (không chỉ
// ẩn/lọc ở giao diện) bằng cách chỉ chấp nhận đúng khuôn URL mà endpoint tải lên của app sinh ra.
//
// ĐỢT 2 (rà soát 8/2026) — mở rộng cho MỌI field URL tệp còn lại của docs/submissions/contracts/
// carRegs/officeReqs/itPriceApprovals (cả TẠO lẫn SỬA, xem lib/recordActions.js). Ngoài stored XSS ở
// trên, việc lưu fileUrl nguyên văn còn phá đúng lớp phân quyền theo TỪNG HỒ SƠ mà lib/fileAuthz.js
// (PR #193) vừa dựng: findOwningRecord() tra ngược "/uploads/<tên-file>" -> hồ sơ bằng cách so KHỚP
// CHUỖI fileUrl, nên ai cũng có thể tạo/sửa 1 hồ sơ của CHÍNH MÌNH rồi tự gán fileUrl = đường dẫn tệp
// của hồ sơ phòng ban khác (đoán/nghe lỏm được) — hồ sơ giả trở thành "hồ sơ sở hữu" tệp đó và mở
// toang quyền xem/tải theo quyền của chính kẻ tấn công. Khuôn URL không ngăn được việc TRỎ tới tệp có
// thật của người khác, nhưng đây là điều kiện cần để 2 lớp còn lại (quyền theo hồ sơ + quyền theo
// module) làm việc đúng, và chặn hẳn nhánh javascript:/http:// ngoài hệ thống.
const UPLOADED_FILE_URL_RE = /^\/uploads\/[A-Za-z0-9._-]+$/;
// Tên tệp do routes/upload.js sinh ra chỉ ~30 ký tự; 500 là mức trần rộng rãi vẫn đủ chặn payload
// khổng lồ nhồi vào cột dữ liệu (regex ở trên không giới hạn độ dài phần tên tệp).
const UPLOADED_FILE_URL_MAX_LEN = 500;

// TỪ CHỐI hẳn (không âm thầm xoá field) để client trung thực thấy được lỗi thay vì mất tệp không rõ lý
// do. Giá trị rỗng/null/undefined vẫn hợp lệ — phần lớn field gọi hàm này là TUỲ CHỌN ở tầng này (nơi
// nào BẮT BUỘC phải có tệp thì đã có kiểm tra "thiếu tệp" riêng ngay trước đó, VD cvFileUrl trong
// recruitmentReferrals.extraValidate hay fileUrl trong editDocDraft()).
function assertUploadedFileUrl(value, fieldLabel) {
  if (value === undefined || value === null || value === '') return;
  const str = String(value);
  if (str.length > UPLOADED_FILE_URL_MAX_LEN || !UPLOADED_FILE_URL_RE.test(str)) {
    throw new CreateError(400, `${fieldLabel} không hợp lệ — chỉ chấp nhận tệp đã tải lên hệ thống`);
  }
}

// Danh sách tệp đính kèm dạng mảng ({fileUrl,...}[]) — submissions.extraFiles và itPriceApprovals.files
// dùng chung đúng 1 luật với field đơn ở trên. Bỏ qua phần tử không phải object (mảng lỗi định dạng đã
// bị các nhánh gọi tự chuẩn hoá riêng).
function assertUploadedFileUrlList(list, fieldLabel) {
  if (!Array.isArray(list)) return;
  list.forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object') return;
    assertUploadedFileUrl(entry.fileUrl, `${fieldLabel} #${idx + 1}`);
  });
}

// trainingDocuments.videoUrl (docType === 'VIDEO') — CÙNG lỗ hổng stored XSS scheme "javascript:" với
// assertUploadedFileUrl() ở trên, nhưng trước đây kiểm tra bằng /youtube\.com|youtu\.be/i, tức là chỉ
// dò CHUỖI CON ở bất kỳ đâu trong giá trị, không hề kiểm tra scheme/tên miền. Vì vậy
// "javascript:alert(document.cookie)//youtube.com" LỌT qua: phía hiển thị (trainingYoutubeEmbedUrl()
// ở public/index.html) không tách được videoId từ chuỗi này nên rơi về nhánh dự phòng
// `<a href="${escapeHtml(d.videoUrl)}">` — escapeHtml() KHÔNG vô hiệu hoá scheme "javascript:", thành
// 1 liên kết bấm được chạy JS trong phiên của mọi người xem kho tài liệu đào tạo.
//
// Kiểm tra chặt: PHẢI phân giải được thành URL thật, scheme ĐÚNG BẰNG "https:" (không nhận http:,
// javascript:, data:, vbscript:...), và hostname ĐÚNG BẰNG 1 trong 4 tên miền Youtube hợp lệ (so
// khớp toàn phần, không phải "kết thúc bằng" — chặn luôn "youtube.com.kevin.evil.tld").
const YOUTUBE_HOSTNAMES = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

function isValidYoutubeUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch (e) {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return YOUTUBE_HOSTNAMES.has(parsed.hostname.toLowerCase());
}

// Khớp đúng SUBMISSION_APPROVAL_LAYERS trong index.html — xem "LƯU Ý BẢO TRÌ" ở đầu file, 2 cài đặt
// độc lập vì client (trình duyệt) không import chung được với server (Node).
// "Loại Tờ Trình" giờ là dữ liệu (appData.submissionTypes, admin tự thêm/bớt ở màn Biểu Mẫu) thay vì
// hằng số gõ cứng — SUBMISSION_TYPES_FALLBACK chỉ dùng khi appData chưa có key này (dữ liệu cũ trước
// khi có tính năng, hoặc seed lỗi), khớp đúng giá trị seed mặc định trong defaults.js.
const SUBMISSION_TYPES_FALLBACK = [
  { key: 'CHU_TRUONG', label: 'Tờ trình xin chủ trương' },
  { key: 'KINH_PHI', label: 'Tờ trình duyệt kinh phí' },
  { key: 'NHAN_SU', label: 'Tờ trình nhân sự / bổ nhiệm' },
  { key: 'QUY_CHE', label: 'Tờ trình ban hành Quy chế / Quy định' },
  { key: 'KHAC', label: 'Tờ trình khác' }
];

// blocking:true = lớp trở thành 1 BƯỚC DUYỆT thật trong effectiveSteps (chặn quy trình, phải xử lý
// xong mới qua bước sau, theo ĐÚNG thứ tự xuất hiện trong mảng này). blocking:false (XIN_Y_KIEN) =
// kênh tham khảo song song — người được chọn để lại ý kiến vào opinionRequestees/opinionResponses
// của hồ sơ, KHÔNG tham gia effectiveSteps, KHÔNG có hành động Duyệt/Từ chối (xem
// buildEffectiveSubmissionWorkflowServer bên dưới).
const SUBMISSION_APPROVAL_LAYERS = [
  { key: 'DONG_TRINH', label: 'Đồng trình', blocking: true },
  { key: 'DONG_CAP', label: 'Phê duyệt đồng cấp', blocking: true },
  { key: 'XIN_Y_KIEN', label: 'Xin ý kiến', blocking: false },
  { key: 'GD_PGD', label: 'Giám Đốc/Phó Giám Đốc', blocking: true },
  { key: 'PTGD', label: 'Phó Tổng Giám Đốc', blocking: true },
  { key: 'TRO_LY_THU_KY', label: 'Bộ Phận Trợ Lý/Thư Ký', blocking: true },
  { key: 'TGD', label: 'Tổng Giám Đốc', blocking: true }
];

// Khớp đúng SUBMISSION_APPROVAL_LEVELS/SUBMISSION_APPROVAL_LEVEL_RULES trong index.html — xem "LƯU Ý
// BẢO TRÌ" ở đầu file. "Cấp Phê Duyệt Cuối Cùng" người trình chọn quyết định lớp nào được PHÉP tick
// (visible) và trong số đó lớp nào bị KHOÁ BẮT BUỘC (locked, con của visible) — server PHẢI tự áp lại
// đúng luật này, không tin approvalLevel/selectedApprovalLayers client gửi lên: từ chối tạo nếu có lớp
// ngoài visible, hoặc thiếu 1 lớp locked nào đó (xem buildEffectiveSubmissionWorkflowServer bên dưới).
const SUBMISSION_APPROVAL_LEVELS = ['TGD', 'PTGD', 'GD_PGD', 'KHAC'];
const SUBMISSION_APPROVAL_LEVEL_RULES = {
  TGD: { visible: ['DONG_TRINH', 'DONG_CAP', 'XIN_Y_KIEN', 'GD_PGD', 'PTGD', 'TRO_LY_THU_KY', 'TGD'], locked: ['TRO_LY_THU_KY', 'TGD'] },
  PTGD: { visible: ['DONG_TRINH', 'DONG_CAP', 'XIN_Y_KIEN', 'GD_PGD', 'PTGD'], locked: ['PTGD'] },
  GD_PGD: { visible: ['DONG_TRINH', 'DONG_CAP', 'XIN_Y_KIEN', 'GD_PGD'], locked: ['GD_PGD'] },
  KHAC: { visible: SUBMISSION_APPROVAL_LAYERS.map(l => l.key), locked: [] }
};

// Di chuyển thành viên nhóm phê duyệt admin đã gán TRƯỚC KHI đổi tên lớp (khoá "BGD" -> "GD_PGD",
// "TGD_CT" -> "TGD") sang đúng khoá mới — khớp đúng hàm cùng tên trong index.html (LƯU Ý BẢO TRÌ). Áp
// dụng ngay trong buildEffectiveSubmissionWorkflowServer() để không mất quyền của thành viên đã gán
// trước khi có tính năng "Cấp Phê Duyệt Cuối Cùng" (appData luôn đọc trực tiếp từ DB, chưa qua migrate
// nào khác ở tầng lưu trữ).
function migrateSubmissionApprovalGroupKeys(groups) {
  const migrated = { ...(groups || {}) };
  const RENAME_MAP = { BGD: 'GD_PGD', TGD_CT: 'TGD' };
  Object.entries(RENAME_MAP).forEach(([oldKey, newKey]) => {
    if (Array.isArray(migrated[oldKey]) && migrated[oldKey].length) {
      migrated[newKey] = [...new Set([...(migrated[newKey] || []), ...migrated[oldKey]])];
    }
    delete migrated[oldKey];
  });
  return migrated;
}

// Tự dựng lại TOÀN BỘ quy trình hiệu lực (steps/approvers) của 1 tờ trình mới từ dữ liệu ĐÃ XÁC MINH
// trong DB (quy trình phòng ban theo loại + thành viên nhóm phê duyệt do admin gán) — KHÔNG dùng
// effectiveSteps/effectiveApprovers client tự gửi lên (trước đây tin nguyên client, ai đó tự soạn
// request có thể nhét bất kỳ ai làm "người duyệt"). selectedLayerMembers[layerKey] là danh sách người
// người trình chọn cho lớp đó — bắt buộc phải là TẬP CON của DB.submissionApprovalGroups[layerKey],
// không thì từ chối tạo. approvalLevel bắt buộc phải là 1 trong SUBMISSION_APPROVAL_LEVELS, và
// selectedLayerKeys phải khớp đúng luật visible/locked của cấp đó (xem SUBMISSION_APPROVAL_LEVEL_RULES
// ở trên) — request tự soạn tick lớp ngoài phạm vi cho phép, hoặc bỏ bớt 1 lớp bắt buộc, đều bị từ
// chối ở đây. Khớp đúng buildEffectiveSubmissionWorkflow() + getSubmissionDeptWorkflowConfig() trong
// index.html.
function buildEffectiveSubmissionWorkflowServer(type, dept, selectedLayerKeys, selectedLayerMembers, appData, approvalLevel) {
  if (!SUBMISSION_APPROVAL_LEVELS.includes(approvalLevel)) {
    throw new CreateError(400, `Cấp phê duyệt cuối cùng không hợp lệ: ${approvalLevel}`);
  }
  const rule = SUBMISSION_APPROVAL_LEVEL_RULES[approvalLevel];
  const layerKeysInput = Array.isArray(selectedLayerKeys) ? [...new Set(selectedLayerKeys)] : [];
  const outOfScope = layerKeysInput.filter(k => !rule.visible.includes(k));
  if (outOfScope.length) {
    throw new CreateError(403, `Lớp phê duyệt không thuộc phạm vi cấp "${approvalLevel}": ${outOfScope.join(', ')}`);
  }
  const missingLocked = rule.locked.filter(k => !layerKeysInput.includes(k));
  if (missingLocked.length) {
    throw new CreateError(400, `Thiếu lớp phê duyệt bắt buộc theo cấp "${approvalLevel}": ${missingLocked.join(', ')}`);
  }
  const submissionTypes = (appData.submissionTypes && appData.submissionTypes.length) ? appData.submissionTypes : SUBMISSION_TYPES_FALLBACK;
  const typeEntry = submissionTypes.find(t => t.label === type);
  const typeKey = typeEntry ? typeEntry.key : 'KHAC';
  const typeMap = appData.submissionTypeDeptWorkflows || {};
  const deptMap = appData.submissionDeptWorkflows || {};
  const baseConfig = typeMap[typeKey]?.[dept] || deptMap[dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  const workflows = appData.workflows || [];
  const baseWf = workflows.find(w => w.id === baseConfig.workflowId) || { steps: [{ order: 1, name: 'Sếp duyệt' }] };

  const steps = baseWf.steps.map(s => ({ order: s.order, name: s.name }));
  const approvers = {};
  baseWf.steps.forEach(s => { approvers[s.order] = baseConfig.approvers?.[s.order] || []; });

  const groups = migrateSubmissionApprovalGroupKeys(appData.submissionApprovalGroups || {});
  // Sắp lại ĐÚNG thứ tự chuẩn SUBMISSION_APPROVAL_LAYERS (Đồng trình -> Đồng cấp -> ... -> TGĐ) — trước
  // đây ghép bước duyệt theo đúng thứ tự MẢNG client gửi lên, không tự sắp lại: giao diện bình thường
  // luôn gửi đúng thứ tự (checkbox render sẵn theo thứ tự chuẩn) nhưng request tự soạn có thể đảo thứ
  // tự (vd TGĐ trước Đồng trình/Đồng cấp), khiến TGĐ duyệt trước, ngược thứ bậc quy định.
  const canonicalOrder = SUBMISSION_APPROVAL_LAYERS.map(l => l.key);
  const layerKeys = [...layerKeysInput].sort((a, b) => canonicalOrder.indexOf(a) - canonicalOrder.indexOf(b));
  const opinionRequestees = [];

  layerKeys.forEach(layerKey => {
    const layer = SUBMISSION_APPROVAL_LAYERS.find(l => l.key === layerKey);
    if (!layer) throw new CreateError(400, `Lớp không hợp lệ: ${layerKey}`);

    const groupMembers = groups[layerKey] || [];
    const isLocked = rule.locked.includes(layerKey);
    let chosen;
    if (isLocked) {
      // Lớp bắt buộc theo cấp phê duyệt (vd. TGD, Trợ Lý/Thư Ký ở cấp TGD): không phải lựa chọn của
      // người trình, luôn dùng TOÀN BỘ nhóm được admin gán, không cho chọn subset.
      if (groupMembers.length === 0) {
        throw new CreateError(400, `Chưa gán thành viên nào cho lớp bắt buộc "${layer.label}"`);
      }
      chosen = [...groupMembers];
    } else {
      chosen = Array.isArray(selectedLayerMembers?.[layerKey]) ? [...new Set(selectedLayerMembers[layerKey])] : [];
      if (chosen.length === 0) {
        throw new CreateError(400, `Chưa chọn người cho lớp "${layer.label}"`);
      }
      const invalid = chosen.filter(u => !groupMembers.includes(u));
      if (invalid.length) {
        throw new CreateError(403, `Người được chọn cho lớp "${layer.label}" không thuộc nhóm được admin gán: ${invalid.join(', ')}`);
      }
    }

    if (layer.blocking) {
      const stepOrder = steps.length + 1;
      // layerKey: khớp đúng index.html buildEffectiveSubmissionWorkflow() — dùng ở client để hiện
      // cảnh báo "còn người chưa cho ý kiến" cho các bước nằm sau lớp Xin ý kiến.
      steps.push({ order: stepOrder, name: layer.label, layerKey: layer.key });
      approvers[stepOrder] = chosen;
    } else {
      // XIN_Y_KIEN (hoặc lớp không chặn khác trong tương lai): KHÔNG trở thành bước duyệt — chỉ ghi
      // nhận danh sách người được xin ý kiến, để lại comment tham khảo qua opinionResponses, không
      // ảnh hưởng tới effectiveSteps/effectiveApprovers và không có hành động Duyệt/Từ chối.
      opinionRequestees.push(...chosen);
    }
  });

  return { steps, approvers, layerKeys, opinionRequestees: [...new Set(opinionRequestees)] };
}

// Quy trình Phê Duyệt HĐ — CHẠY ĐỘNG giống Văn Bản Trình (quy trình gốc theo phòng ban + tối đa 4 lớp
// bổ sung tuỳ chọn theo "Cấp Phê Duyệt Cuối Cùng") nhưng TÁCH RIÊNG hoàn toàn: bỏ 3 lớp Đồng
// trình/Xin ý kiến/Phê duyệt đồng cấp (chỉ giữ lại 4 lớp cấp bậc), và dùng nhóm phê duyệt RIÊNG
// (appData.contractApprovalGroups, KHÔNG dùng chung DB.submissionApprovalGroups của Văn Bản Trình).
// Quy trình "Quản Lý HĐ" (Tài liệu ký) đơn giản hơn — theo phòng ban như Xe/Mua Bán/VPP, không có lớp
// tuỳ chọn, không snapshot lúc tạo (xem lib/workflowEngine.js resolveContractManageWorkflow).
const CONTRACT_APPROVAL_LAYERS = [
  { key: 'GD_PGD', label: 'Giám Đốc/Phó Giám Đốc' },
  { key: 'PTGD', label: 'Phó Tổng Giám Đốc' },
  { key: 'TRO_LY_THU_KY', label: 'Bộ Phận Trợ Lý/Thư Ký' },
  { key: 'TGD', label: 'Tổng Giám Đốc' }
];
const CONTRACT_APPROVAL_LEVELS = ['TGD', 'PTGD', 'GD_PGD', 'KHAC'];
const CONTRACT_APPROVAL_LEVEL_RULES = {
  TGD: { visible: ['GD_PGD', 'PTGD', 'TRO_LY_THU_KY', 'TGD'], locked: ['TRO_LY_THU_KY', 'TGD'] },
  PTGD: { visible: ['GD_PGD', 'PTGD'], locked: ['PTGD'] },
  GD_PGD: { visible: ['GD_PGD'], locked: ['GD_PGD'] },
  KHAC: { visible: CONTRACT_APPROVAL_LAYERS.map(l => l.key), locked: [] }
};

// Tự dựng lại quy trình Phê Duyệt HĐ hiệu lực (steps/approvers) cho 1 hợp đồng/phụ lục mới — cùng
// khuôn xác minh với buildEffectiveSubmissionWorkflowServer() ở trên (approvalLevel hợp lệ ->
// selectedLayerKeys đúng luật visible/locked -> mỗi lớp chọn phải là tập con của
// appData.contractApprovalGroups[layerKey]) nhưng KHÔNG có nhánh "Xin ý kiến" (cả 4 lớp đều chặn quy
// trình, không có opinionRequestees).
function buildEffectiveContractApprovalWorkflowServer(dept, selectedLayerKeys, selectedLayerMembers, appData, approvalLevel) {
  if (!CONTRACT_APPROVAL_LEVELS.includes(approvalLevel)) {
    throw new CreateError(400, `Cấp phê duyệt cuối cùng không hợp lệ: ${approvalLevel}`);
  }
  const rule = CONTRACT_APPROVAL_LEVEL_RULES[approvalLevel];
  const layerKeysInput = Array.isArray(selectedLayerKeys) ? [...new Set(selectedLayerKeys)] : [];
  const outOfScope = layerKeysInput.filter(k => !rule.visible.includes(k));
  if (outOfScope.length) {
    throw new CreateError(403, `Lớp phê duyệt không thuộc phạm vi cấp "${approvalLevel}": ${outOfScope.join(', ')}`);
  }
  const missingLocked = rule.locked.filter(k => !layerKeysInput.includes(k));
  if (missingLocked.length) {
    throw new CreateError(400, `Thiếu lớp phê duyệt bắt buộc theo cấp "${approvalLevel}": ${missingLocked.join(', ')}`);
  }

  const deptMap = appData.contractApprovalDeptWorkflows || {};
  const baseConfig = deptMap[dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  const workflows = appData.workflows || [];
  const baseWf = workflows.find(w => w.id === baseConfig.workflowId) || { steps: [{ order: 1, name: 'Sếp duyệt' }] };

  const steps = baseWf.steps.map(s => ({ order: s.order, name: s.name }));
  const approvers = {};
  baseWf.steps.forEach(s => { approvers[s.order] = baseConfig.approvers?.[s.order] || []; });

  const groups = appData.contractApprovalGroups || {};
  // Cùng lỗi/cùng cách sửa với buildEffectiveSubmissionWorkflowServer() ở trên — sắp lại đúng thứ tự
  // chuẩn CONTRACT_APPROVAL_LAYERS thay vì tin thứ tự mảng client gửi.
  const canonicalOrder = CONTRACT_APPROVAL_LAYERS.map(l => l.key);
  const layerKeys = [...layerKeysInput].sort((a, b) => canonicalOrder.indexOf(a) - canonicalOrder.indexOf(b));

  layerKeys.forEach(layerKey => {
    const layer = CONTRACT_APPROVAL_LAYERS.find(l => l.key === layerKey);
    if (!layer) throw new CreateError(400, `Lớp không hợp lệ: ${layerKey}`);

    const groupMembers = groups[layerKey] || [];
    const chosen = Array.isArray(selectedLayerMembers?.[layerKey]) ? [...new Set(selectedLayerMembers[layerKey])] : [];
    if (chosen.length === 0) {
      throw new CreateError(400, `Chưa chọn người cho lớp "${layer.label}"`);
    }
    const invalid = chosen.filter(u => !groupMembers.includes(u));
    if (invalid.length) {
      throw new CreateError(403, `Người được chọn cho lớp "${layer.label}" không thuộc nhóm được admin gán: ${invalid.join(', ')}`);
    }

    const stepOrder = steps.length + 1;
    steps.push({ order: stepOrder, name: layer.label, layerKey: layer.key });
    approvers[stepOrder] = chosen;
  });

  return { steps, approvers, layerKeys };
}

// Đối chiếu lại "required" của trường tuỳ biến (renderDynamicInputsForModule()/collectDynamicFieldsData()
// ở index.html) — trước đây ràng buộc này CHỈ có hiệu lực qua constraint-validation của trình duyệt
// (thuộc tính HTML "required" trên input), không nơi nào ở server đọc lại DB.formTemplates để xác
// nhận payload.customData thật sự đủ field bắt buộc hay không. collectDynamicFieldsData() khoá theo
// f.label (nhãn hiển thị, KHÔNG phải f.id) nên đối chiếu ở đây cũng phải theo đúng field "label".
function validateRequiredCustomData(customData, formTemplates, modKey) {
  const fields = (formTemplates || {})[modKey] || [];
  const data = customData || {};
  for (const f of fields) {
    if (!f.required) continue;
    const value = data[f.label];
    const missing = value === undefined || value === null || value === '' ||
      (Array.isArray(value) && value.length === 0);
    if (missing) {
      throw new CreateError(400, `Vui lòng nhập đầy đủ trường bắt buộc: "${f.label}"`);
    }
  }
}

// Mỗi module: khoá collection AppData, cách lấy phạm vi phòng ban được phép tạo ({all,depts}), tên
// field ghi người tạo, và kiểm tra bổ sung riêng (nếu có) — phần logic chung (xác minh dept, chặn mã
// trùng, gán người tạo) nằm ở validateAndPrepareCreate() bên dưới, dùng chung cho mọi module.
const CREATE_MODULE_CONFIGS = {
  submissions: {
    dbKey: 'submissions',
    getScope: (user) => user.perms?.submissionCreate,
    creatorField: 'creator', creatorNameField: 'creatorName',
    // Ghi đè effectiveSteps/effectiveApprovers/selectedApprovalLayers/selectedLayerMembers bằng bản
    // server tự dựng lại + xác minh (xem buildEffectiveSubmissionWorkflowServer) — payload là cùng 1
    // object được validateAndPrepareCreate() dùng để tạo record ngay sau đó, nên sửa tại chỗ ở đây là đủ.
    // appData (workflows/submissionDeptWorkflows/submissionTypeDeptWorkflows/submissionApprovalGroups)
    // do CALLER đọc sẵn từ DB rồi truyền vào (xem validateAndPrepareCreate) — file này không tự đọc DB,
    // để routes/create.js thật VÀ stub test (dùng data in-memory) đều gọi chung được hàm này.
    extraValidate: (payload, collection, user, appData) => {
      validateRequiredCustomData(payload.customData, appData?.formTemplates, 'SUBMISSION');
      // Tệp tờ trình + Tài Liệu Bổ Sung Theo Tờ Trình (#subFile/#subExtraFiles ở index.html) —
      // xem assertUploadedFileUrl().
      assertUploadedFileUrl(payload.fileUrl, 'Tệp tờ trình');
      assertUploadedFileUrlList(payload.extraFiles, 'Tài liệu bổ sung theo tờ trình');
      const effectiveWf = buildEffectiveSubmissionWorkflowServer(
        payload.type, payload.dept, payload.selectedApprovalLayers, payload.selectedLayerMembers, appData || {}, payload.approvalLevel
      );
      payload.selectedApprovalLayers = effectiveWf.layerKeys;
      payload.selectedLayerMembers = payload.selectedLayerMembers || {};
      payload.effectiveSteps = effectiveWf.steps;
      payload.effectiveApprovers = effectiveWf.approvers;
      // "Xin ý kiến" (blocking:false) — KHÔNG phải bước duyệt, ghi đè riêng để không tin danh sách
      // client tự gửi (cùng lý do với effectiveSteps/effectiveApprovers ở trên).
      payload.opinionRequestees = effectiveWf.opinionRequestees;
      payload.opinionResponses = [];
      // status/currentStep/history PHẢI gán cứng ở server (khớp doSubmitSubmissionReq() ở index.html,
      // dùng đúng thông tin XÁC THỰC của người gọi thay vì tin currentUser.name/username client tự
      // gửi) — trước đây module này không đụng tới 3 field trạng thái này, 1 request tự soạn (bỏ qua
      // UI) có thể tự đặt sẵn status:"APPROVED" cùng history giả để bỏ qua toàn bộ quy trình duyệt.
      payload.status = 'PENDING';
      payload.currentStep = 1;
      payload.history = [{
        step: 0,
        approver: user.name,
        username: user.username,
        action: 'CREATED',
        comment: 'Khởi tạo và trình duyệt tờ trình mới',
        time: new Date().toLocaleString('vi-VN')
      }];
    }
  },
  contracts: {
    dbKey: 'contracts',
    getScope: (user) => user.perms?.contractCreate,
    creatorField: 'creator', creatorNameField: null, // Hợp đồng KHÔNG có field creatorName (khớp index.html)
    // 2 luồng tạo hồ sơ hợp đồng/phụ lục (status GÁN Ở SERVER theo ĐÚNG luồng, không tin approvalStatus
    // client gửi — khớp internalPosts SHARE ở trên):
    // 1) isSignedImport=true ("Nhập Hợp Đồng/Phụ Lục Đã Ký" — tab Quản Lý HĐ, index.html
    //    onContractOpModeChange() mode IMPORT_CONTRACT/IMPORT_ADDENDUM): hồ sơ ĐÃ CÓ chữ ký thật ký
    //    ngoài hệ thống, nhập tay để lưu — luôn APPROVED ngay, KHÔNG qua hàng chờ Phê Duyệt, không có
    //    Đợt Thanh Toán riêng (tệp đính kèm CHÍNH LÀ tài liệu đã ký, gán luôn vào signedFileUrl).
    // 2) isSignedImport=false (mặc định — "Tạo Mới"/"Bổ Sung Phụ Lục" ở tab Phê Duyệt): CẢ 2 đều LUÔN
    //    vào hàng chờ PENDING và đi qua ĐÚNG quy trình Phê Duyệt HĐ đã cấu hình (xem
    //    buildEffectiveContractApprovalWorkflowServer ở trên) — KHÔNG còn tự duyệt ngay dù người tạo có
    //    quyền admin/contractApprove (trước đây có short-circuit này, gây đúng lỗi "chưa phê duyệt xong
    //    đã bị chuyển sang Quản Lý HĐ" mà nghiệp vụ yêu cầu sửa). CẢ 2 đều khai được Đợt Thanh Toán.
    // Phụ lục (isAddendum=true, áp dụng cho CẢ 2 luồng trên) chỉ gắn được vào 1 hợp đồng GỐC ĐÃ APPROVED
    // (xem index.html generateAddendumCode()/onContractAddendumTargetChange()).
    extraValidate: (payload, collection, user, appData) => {
      const isSignedImport = !!payload.isSignedImport;
      delete payload.isSignedImport; // chỉ là cờ tạm quyết định nhánh xử lý bên dưới, không lưu vào hồ sơ

      // Tệp hợp đồng + Tài liệu ký — kiểm TRƯỚC nhánh isSignedImport bên dưới (nhánh đó gán
      // signedFileUrl = fileUrl nên phải chắc chắn cả 2 đều hợp lệ trước khi sao chép), xem
      // assertUploadedFileUrl().
      assertUploadedFileUrl(payload.fileUrl, 'Tệp hợp đồng');
      assertUploadedFileUrl(payload.signedFileUrl, 'Tài liệu ký');

      // Trường bổ sung (Biểu Mẫu) — 2 tab CONTRACT_APPROVAL/CONTRACT_MANAGE chung coreKey 'CONTRACT'
      // nhưng RIÊNG danh sách trường bổ sung (xem FORM_TABS ở index.html), khớp đúng modKey client
      // dùng khi gọi collectDynamicFieldsData() theo isSignedImport.
      validateRequiredCustomData(payload.customData, appData?.formTemplates, isSignedImport ? 'CONTRACT_MANAGE' : 'CONTRACT_APPROVAL');

      // Khớp đúng 2 kiểm tra editContract() (lib/recordActions.js) đã có cho nhánh SỬA — trước đây
      // nhánh TẠO MỚI (áp dụng cho cả hợp đồng gốc lẫn phụ lục, cả 2 luồng isSignedImport) không có
      // ràng buộc nào, cho phép tạo hợp đồng "0 đồng"/âm hoặc hết hạn trước khi có hiệu lực đi hết cả
      // quy trình phê duyệt.
      if (payload.startDate && payload.endDate && payload.startDate > payload.endDate) {
        throw new CreateError(400, 'Ngày hiệu lực phải trước ngày hết hạn');
      }
      if (!(Number(payload.amount) > 0)) {
        throw new CreateError(400, 'Giá trị hợp đồng phải lớn hơn 0');
      }

      // custodianDept ("Đơn vị tiếp nhận theo dõi & thanh toán") — chốt NGAY LÚC TẠO, áp dụng CẢ 2
      // luồng (Phê Duyệt lẫn Nhập Đã Ký) vì canManageContractPayment()/canViewContract() (tương ứng ở
      // lib/recordActions.js/lib/recordViewScope.js) đọc field này bất kể hồ sơ tạo qua luồng nào.
      // Không chọn -> mặc định CHÍNH đơn vị tạo (payload.dept) theo dõi & thanh toán, khớp đúng yêu cầu
      // nghiệp vụ "không chọn đơn vị thì mặc định đơn vị mình sẽ theo dõi và thanh toán" — không bao giờ
      // để trống, tránh phải xử lý null rải rác ở mọi nơi đọc lại field này sau này.
      payload.custodianDept = (payload.custodianDept && String(payload.custodianDept).trim()) || payload.dept;
      // Trước đây KHÔNG validate custodianDept khi người tạo CHỦ ĐỘNG chọn 1 đơn vị KHÁC payload.dept —
      // chỉ là rủi ro nhập liệu (client tự do gõ/gửi thẳng), không leo thang quyền, nhưng đáng chặn cho
      // sạch dữ liệu. CHỈ validate khi khác payload.dept — trường hợp mặc định (không chọn, giữ nguyên
      // payload.dept) tin theo ĐÚNG mức đã tin payload.dept (bị ép về phòng ban người tạo ở
      // validateAndPrepareCreate(), không qua danh mục) để không validate 2 lần cùng 1 giá trị theo 2
      // tiêu chuẩn khác nhau. Cùng khuôn validDepts ở recruitmentJobs.hiringDept/trainingClasses.targetDept
      // trong file này — audit Đợt 5, Giai đoạn 4.
      if (payload.custodianDept !== payload.dept) {
        const validCustodianDepts = new Set([...(appData?.depts || []), ...(appData?.stores || [])]);
        if (!validCustodianDepts.has(payload.custodianDept)) {
          throw new CreateError(400, `Đơn vị tiếp nhận theo dõi & thanh toán không hợp lệ: ${payload.custodianDept}`);
        }
      }

      if (payload.isAddendum) {
        const root = (collection || []).find(c => c.id === payload.rootContractId && !c.isAddendum);
        if (!root) throw new CreateError(400, 'Hợp đồng gốc không tồn tại');
        if (root.approvalStatus !== 'APPROVED') throw new CreateError(409, 'Chỉ được bổ sung phụ lục cho hợp đồng đã được phê duyệt');
        if (payload.dept !== root.dept) throw new CreateError(400, 'Phòng ban của phụ lục phải khớp với hợp đồng gốc');
        payload.type = root.type;
        // Đơn vị theo dõi & thanh toán của phụ lục PHẢI khớp hợp đồng gốc — cùng 1 hồ sơ hợp đồng chỉ
        // nên có 1 đơn vị custodian xuyên suốt (gốc + mọi phụ lục), tránh phụ lục "trôi" sang custodian
        // khác khiến ai đang theo dõi hợp đồng gốc mất quyền thấy/thao tác phụ lục phát sinh của chính nó.
        if (payload.custodianDept !== root.custodianDept) {
          throw new CreateError(400, 'Đơn vị tiếp nhận theo dõi & thanh toán của phụ lục phải khớp với hợp đồng gốc');
        }
      }

      if (isSignedImport) {
        payload.approvalStatus = 'APPROVED';
        payload.paymentInstallments = [];
        payload.signedFileUrl = payload.fileUrl || null;
        // Tài liệu đã ký thật ngoài hệ thống, nhập tay để lưu — không cần qua bước duyệt tài liệu ký.
        payload.signedFileStatus = payload.signedFileUrl ? 'APPROVED' : null;
      } else {
        // paymentInstallments áp dụng cho CẢ hợp đồng gốc lẫn phụ lục — phụ lục có thể phát sinh thanh
        // toán riêng (VD bổ sung khối lượng/giá trị), khi đó "Xác nhận đề nghị thanh toán" sẽ hiện đúng
        // 2 dòng tách biệt (mã hợp đồng gốc + mã phụ lục), theo dõi/xác nhận độc lập nhau (xem
        // startContractPayment() ở lib/recordActions.js — sourceId/sourceCode luôn theo ĐÚNG bản ghi
        // đang chuyển sang thanh toán, gốc hay phụ lục không khác gì nhau).
        const rawInstallments = Array.isArray(payload.paymentInstallments) ? payload.paymentInstallments : [];
        payload.paymentInstallments = rawInstallments.map(it => ({
          description: (it?.description || '').trim(), amount: Number(it?.amount) || 0, dueDate: it?.dueDate || ''
        }));
        // Khớp buildPaymentInstallments()/confirmPaymentInstallment() ở lib/recordActions.js — khai
        // đủ hết các đợt (confirmed=true) là hệ thống coi hợp đồng "Đã thanh toán" toàn bộ, nên tổng
        // các đợt khai lúc tạo PHẢI khớp đúng giá trị hợp đồng, không thì có thể xác nhận "đã thanh
        // toán xong" dù mới thu một phần nhỏ.
        if (payload.paymentInstallments.length) {
          // Trước đây chỉ kiểm tra TỔNG khớp giá trị hợp đồng — cho phép khai 1 đợt "khống" giá trị
          // lớn và 1 đợt bù âm để tổng vẫn khớp, phá vỡ đúng mục đích của kiểm tra tổng (kế toán xác
          // nhận riêng từng đợt, không xét dấu). Mỗi đợt phải dương thì tổng khớp mới thật sự có ý nghĩa.
          if (payload.paymentInstallments.some(it => !(it.amount > 0))) {
            throw new CreateError(400, 'Mỗi đợt thanh toán phải có số tiền lớn hơn 0');
          }
          const sum = payload.paymentInstallments.reduce((s, it) => s + it.amount, 0);
          const total = Number(payload.amount) || 0;
          if (Math.abs(sum - total) > 1) {
            throw new CreateError(400, `Tổng các đợt thanh toán (${sum.toLocaleString('vi-VN')}) phải khớp với giá trị hợp đồng (${total.toLocaleString('vi-VN')})`);
          }
        }
        const effectiveWf = buildEffectiveContractApprovalWorkflowServer(
          payload.dept, payload.selectedApprovalLayers, payload.selectedLayerMembers, appData || {}, payload.approvalLevel
        );
        payload.approvalStatus = 'PENDING';
        payload.currentStep = 1;
        payload.history = [];
        payload.selectedApprovalLayers = effectiveWf.layerKeys;
        payload.selectedLayerMembers = payload.selectedLayerMembers || {};
        payload.effectiveSteps = effectiveWf.steps;
        payload.effectiveApprovers = effectiveWf.approvers;
      }
      // paymentStatus áp dụng cho CẢ hợp đồng gốc lẫn phụ lục (mỗi bản ghi theo dõi thanh toán độc lập
      // của chính nó) — hồ sơ nhập lại (đã ký sẵn ngoài hệ thống) coi như đã thanh toán từ trước, chỉ hồ
      // sơ đi qua đúng luồng Phê Duyệt -> Quản Lý HĐ mới bắt đầu ở trạng thái chưa thanh toán.
      payload.paymentStatus = isSignedImport ? 'DA_THANH_TOAN' : 'CHUA_THANH_TOAN';
    }
  },
  meetings: {
    dbKey: 'meetings',
    getScope: (user) => user.perms?.meetingBookScope,
    creatorField: 'creator', creatorNameField: 'creatorName',
    // Trùng phòng/khung giờ là kiểm tra khoảng thời gian CHỒNG LẤN — không diễn đạt được bằng 1 UNIQUE
    // INDEX như trùng "Code" ở các module khác, nên chỉ kiểm tra ở tầng ứng dụng (findMeetingConflict)
    // không đủ chặn 2 request tạo lịch trùng phòng CÙNG LÚC (race thật). getLockKey báo cho
    // routes/create.js biết cần khoá nghiêm túc theo PHÒNG HỌP (sp_getapplock, xem
    // lib/recordStore.js createForCollectionSerialized) trong suốt lúc đọc-kiểm tra-ghi, thay vì
    // createForCollection() thường (chỉ có DB unique index chặn trùng Code, không chặn được kiểu
    // trùng lặp này).
    getLockKey: (payload) => `meeting_room:${payload.room}`,
    // Trước đây "giờ bắt đầu < giờ kết thúc" chỉ được kiểm tra ở trình duyệt — request tự soạn gửi giờ
    // sai định dạng hoặc kết thúc trước bắt đầu vẫn qua được, và tệ hơn: new Date(...).getTime() trả về
    // NaN cho giờ sai định dạng, mọi phép so sánh với NaN đều false nên findMeetingConflict() (dưới)
    // kết luận "không trùng" cho MỌI trường hợp giờ lỗi định dạng — vượt qua luôn cơ chế khoá-theo-phòng.
    extraValidate: (payload, collection, user, appData) => {
      validateRequiredCustomData(payload.customData, appData?.formTemplates, 'MEETING_ROOM');
      const newStart = new Date(payload.startTime).getTime();
      const newEnd = new Date(payload.endTime).getTime();
      if (!Number.isFinite(newStart) || !Number.isFinite(newEnd)) {
        throw new CreateError(400, 'Thời gian bắt đầu/kết thúc không hợp lệ');
      }
      if (newStart >= newEnd) {
        throw new CreateError(400, 'Thời gian kết thúc phải sau thời gian bắt đầu');
      }
      const conflict = findMeetingConflict(collection, payload.room, payload.startTime, payload.endTime);
      if (conflict) {
        throw new CreateError(409, `Phòng "${payload.room}" đã có lịch trùng khung giờ này (${conflict.code})`);
      }
    }
  },
  carRegs: {
    dbKey: 'carRegs',
    getScope: (user) => user.perms?.carCreate,
    creatorField: 'creator', creatorNameField: 'creatorName',
    // Khớp đúng lỗ hổng đã vá cho meetings ở trên (findMeetingConflict + NaN) — carRegs cũng có
    // startTime/endTime (xem index.html #carStartTime/#carEndTime) nhưng trước đây CHƯA từng được kiểm
    // tra lại ở server: request tự soạn gửi giờ kết thúc trước giờ bắt đầu (hoặc sai định dạng) vẫn tạo
    // được phiếu đăng ký xe, và biển số gán sau đó ở bước duyệt (findCarPlateConflict()) dùng chính
    // startTime/endTime này để so trùng khung giờ — new Date(...).getTime() trả NaN cho giờ sai định
    // dạng khiến MỌI so sánh thời gian đều false, "chưa từng trùng" với bất kỳ phiếu nào khác.
    extraValidate: (payload, collection, user, appData) => {
      validateRequiredCustomData(payload.customData, appData?.formTemplates, 'CAR');
      // Phiếu đăng ký xe có field fileUrl trong mô hình dữ liệu (lib/fileAuthz.js tra ngược
      // carRegs theo fileUrl) — xem assertUploadedFileUrl().
      assertUploadedFileUrl(payload.fileUrl, 'Tệp đính kèm phiếu đăng ký xe');
      const newStart = new Date(payload.startTime).getTime();
      const newEnd = new Date(payload.endTime).getTime();
      if (!Number.isFinite(newStart) || !Number.isFinite(newEnd)) {
        throw new CreateError(400, 'Thời gian bắt đầu/kết thúc không hợp lệ');
      }
      if (newStart >= newEnd) {
        throw new CreateError(400, 'Thời gian kết thúc phải sau thời gian bắt đầu');
      }
      // Input client (#carKm) không có "min", parseFloat(...)||0 vẫn chấp nhận số âm bình thường —
      // server chưa từng kiểm tra lại, số km âm khi duyệt sẽ cộng dồn làm sai lệch "Tổng số km" ở
      // Dashboard (không có cách nào phát hiện qua giao diện thường).
      if (payload.km !== undefined && Number(payload.km) < 0) {
        throw new CreateError(400, 'Số KM dự kiến không được là số âm');
      }
      // Lộ trình nhiều điểm (Điểm xuất phát + N điểm tiếp theo) thay cho 1 ô text tự do trước đây — vẫn
      // tính lại payload.destination (nối các điểm bằng " → ") để KHÔNG phải sửa mọi chỗ đang đọc thẳng
      // c.destination để hiển thị (bảng danh sách, phiếu in, email thông báo...).
      const points = (Array.isArray(payload.routePoints) ? payload.routePoints : [])
        .map(p => String(p || '').trim()).filter(Boolean);
      if (points.length < 2) {
        throw new CreateError(400, 'Vui lòng nhập ít nhất Điểm xuất phát và 1 điểm đến');
      }
      payload.routePoints = points;
      payload.destination = points.join(' → ');
      // status/currentStep/history PHẢI gán cứng ở server (cùng khuôn docs/submissions/itPriceApprovals/
      // contracts ở trên) — trước đây module này KHÔNG đụng tới 3 field trạng thái này dù client vẫn gửi
      // kèm (xem confirmCreateCarReg() ở index.html), nên 1 request tự soạn (bỏ qua UI) có thể tự đặt
      // sẵn status:"APPROVED" cùng history giả để bỏ qua TOÀN BỘ quy trình duyệt xe của phòng ban.
      payload.status = 'PENDING';
      payload.currentStep = 1;
      payload.history = [];
    }
  },
  officeReqs: {
    dbKey: 'officeReqs',
    getScope: (user) => user.perms?.officeCreate,
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user, appData) => {
      const flag = OFFICE_SUBTYPE_TO_PERM_FLAG[payload.subType];
      if (!flag) throw new CreateError(400, `Loại đề xuất văn phòng không hợp lệ: ${payload.subType}`);
      if (!user.perms?.admin && !user.perms?.[flag]) {
        throw new CreateError(403, 'Bạn không có quyền tạo đề xuất văn phòng loại này');
      }
      // Trường bổ sung (Biểu Mẫu) — cả 2 sub-tab còn lại (MUA_BAN/SUA_CHUA) chung coreKey 'OFFICE' nhưng
      // RIÊNG danh sách trường bổ sung theo đúng subType, khớp modKey client dùng khi gọi
      // collectDynamicFieldsData(activeOfficeSubTab) (xem FORM_TABS ở index.html).
      validateRequiredCustomData(payload.customData, appData?.formTemplates, payload.subType);
      // Tệp đề xuất + Tài liệu ký (uploadOfficeSignedFile() ở lib/recordActions.js ghi vào cùng bản
      // ghi này, lib/fileAuthz.js tra ngược officeReqs theo CẢ 2 field) — xem assertUploadedFileUrl().
      assertUploadedFileUrl(payload.fileUrl, 'Tệp đính kèm đề xuất');
      assertUploadedFileUrl(payload.signedFileUrl, 'Tài liệu ký');
      // "Mua Sắm" tự tính amount = tổng (Số lượng × Đơn giá) của từng hạng mục ở CLIENT (xem
      // recalcOfficeItemsTotal() ở index.html) rồi gửi kèm cả amount lẫn items — trước đây server tin
      // nguyên payload.amount, không tính lại từ items: request tự soạn gửi items thật (số nhỏ) kèm
      // amount khống (số lớn hơn nhiều, hoặc âm) vẫn được lưu y nguyên. Tính lại từ items ở đây (không
      // tin số amount client gửi) khi có items; luôn chặn amount âm cho cả 2 nhánh (Mua Sắm/Sửa Chữa-
      // Đầu Tư, nhánh sau nhập tay 1 ô số nên parseFloat vẫn cho ra số âm bình thường).
      if (Array.isArray(payload.items) && payload.items.length) {
        payload.items = payload.items.map(it => {
          const qty = Number(it?.qty) || 0;
          const unitPrice = Number(it?.unitPrice) || 0;
          // Trước đây chỉ chặn TỔNG amount âm — cho phép 1 dòng "khống" âm bù cho 1 dòng dương để tổng
          // vẫn dương qua được kiểm tra, trong khi hạng mục hiển thị "Thành Tiền" âm vẫn hiện nguyên
          // trên phiếu duyệt (không có ý nghĩa nghiệp vụ nào — không phải chiết khấu, không có trường
          // đánh dấu riêng). Chặn ngay từng dòng thay vì chỉ chặn tổng.
          if (qty < 0 || unitPrice < 0) {
            throw new CreateError(400, `Hạng mục "${it?.name || ''}": Số lượng/Đơn giá không được là số âm`);
          }
          return { ...it, qty, unitPrice, amount: qty * unitPrice };
        });
        payload.amount = payload.items.reduce((sum, it) => sum + it.amount, 0);
      } else {
        payload.amount = Number(payload.amount) || 0;
      }
      if (payload.amount < 0) {
        throw new CreateError(400, 'Dự toán/Tổng chi phí không được là số âm');
      }
      // status/currentStep/history PHẢI gán cứng ở server — cùng lỗ hổng vừa vá cho carRegs ở trên
      // (client vẫn gửi kèm 3 field này trong confirmCreateOfficeReq(), nhưng server chưa từng xác minh
      // lại): request tự soạn đặt sẵn status:"APPROVED" + history giả bỏ qua được toàn bộ quy trình duyệt
      // Mua Bán/Sửa Chữa của phòng ban.
      payload.status = 'PENDING';
      payload.currentStep = 1;
      payload.history = [];
    }
  },
  // ===== VẬN HÀNH — 3 luồng ĐỘC LẬP (khác officeReqs: không dùng chung 1 collection theo subType, mỗi
  // luồng có quyền tạo riêng + dept-workflow riêng, xem lib/workflowEngine.js). Cùng khuôn budgetEntries/
  // vppRegistrations: forceOwnDept + getScope rỗng (không có khái niệm "tạo hộ phòng ban khác").
  operationOrders: {
    dbKey: 'operationOrders',
    getScope: () => ({}),
    forceOwnDept: true,
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user) => {
      if (!user.perms?.admin && !user.perms?.operationOrderCreate) {
        throw new CreateError(403, 'Bạn không có quyền tạo đơn hàng');
      }
      const title = String(payload.title || '').trim();
      if (!title) throw new CreateError(400, 'Vui lòng nhập tiêu đề đơn hàng');
      payload.title = title;
      payload.supplier = String(payload.supplier || '').trim();
      payload.note = String(payload.note || '').trim();
      assertUploadedFileUrl(payload.fileUrl, 'Tệp đính kèm đơn hàng');
      // Tự tính lại amount = tổng (Số lượng × Đơn giá) từng hạng mục — không tin số client gửi (cùng lý
      // do đã vá cho officeReqs.items ở trên).
      const items = Array.isArray(payload.items) ? payload.items : [];
      const validItems = items.map(it => {
        const name = String(it?.name || '').trim();
        const qty = Number(it?.qty) || 0;
        const unitPrice = Number(it?.unitPrice) || 0;
        if (qty < 0 || unitPrice < 0) throw new CreateError(400, `Hạng mục "${name}": Số lượng/Đơn giá không được là số âm`);
        return { name, unit: String(it?.unit || '').trim(), qty, unitPrice, amount: qty * unitPrice, note: String(it?.note || '').trim() };
      }).filter((it) => it.name && it.qty > 0);
      if (!validItems.length) throw new CreateError(400, 'Vui lòng nhập ít nhất 1 hạng mục hợp lệ (Tên hàng + Số lượng > 0)');
      payload.items = validItems;
      payload.amount = validItems.reduce((sum, it) => sum + it.amount, 0);
      payload.status = 'PENDING';
      payload.currentStep = 1;
      payload.history = [];
    }
  },
  operationStoreOpenings: {
    dbKey: 'operationStoreOpenings',
    getScope: () => ({}),
    forceOwnDept: true,
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user, appData) => {
      if (!user.perms?.admin && !user.perms?.operationStoreOpenCreate) {
        throw new CreateError(403, 'Bạn không có quyền tạo đề xuất mở mới siêu thị');
      }
      const storeName = String(payload.storeName || '').trim();
      if (!storeName) throw new CreateError(400, 'Vui lòng nhập tên siêu thị dự kiến');
      payload.storeName = storeName;
      const address = String(payload.address || '').trim();
      if (!address) throw new CreateError(400, 'Vui lòng nhập địa điểm dự kiến');
      payload.address = address;
      payload.area = Math.max(0, Number(payload.area) || 0);
      payload.estimatedBudget = Math.max(0, Number(payload.estimatedBudget) || 0);
      // "Ngân Sách Phê Duyệt" (đợt sửa theo phản hồi người dùng sau Vận Hành > Siêu Thị vòng đời mới) —
      // field RIÊNG, ĐỘC LẬP với estimatedBudget ở trên ("Chi Phí Phê Duyệt" — mục đích cũ, KHÔNG đụng).
      // Trước đây Danh Mục Đầu Tư (renderOperationEstimateList()/openOperationEstimateModal() ở
      // public/index.html) LẤY NHẦM estimatedBudget làm "Ngân sách phê duyệt/còn lại" — người dùng xác
      // nhận đây là 2 khái niệm khác nhau, phải nhập RIÊNG ngay lúc lập hồ sơ. Bắt buộc nhập (khác
      // estimatedBudget optional) vì đây chính là con số Danh Mục Đầu Tư dùng để tính "còn lại" — để
      // trống/0 vô nghĩa cho mục đích này. Hồ sơ CŨ trước bản vá này KHÔNG có field — đọc lại sẽ là
      // undefined/null, các nơi hiển thị (renderOperationEstimateList()...) tự xử lý hiện "(chưa nhập)"
      // thay vì 0/NaN, KHÔNG backfill ngược từ estimatedBudget (2 field độc lập, không suy ra nhau được).
      if (payload.approvedBudget === undefined || payload.approvedBudget === null || payload.approvedBudget === '') {
        throw new CreateError(400, 'Vui lòng nhập Ngân sách phê duyệt (dùng để tính Ngân sách còn lại ở Danh mục đầu tư)');
      }
      const approvedBudget = Number(payload.approvedBudget);
      if (!Number.isFinite(approvedBudget) || approvedBudget < 0) {
        throw new CreateError(400, 'Ngân sách phê duyệt không hợp lệ (phải là số không âm)');
      }
      payload.approvedBudget = approvedBudget;
      // Người Phụ Trách: ô chọn tài khoản hệ thống thật (pattern "sdd*") — payload.personInCharge giờ
      // là USERNAME, personInChargeName là tên hiển thị snapshot lúc tạo (không derive lúc render, cùng
      // triết lý assignedToName). Tương thích ngược: hồ sơ CŨ có personInCharge = tên tự do, xem
      // CLAUDE.md ghi chú "mọi nơi hiển thị dùng personInChargeName || personInCharge".
      const personInChargeUser = resolveOperationPersonInChargeUsername(payload.personInCharge, appData?.users);
      payload.personInCharge = personInChargeUser ? personInChargeUser.username : null;
      payload.personInChargeName = personInChargeUser ? personInChargeUser.name : null;
      payload.note = String(payload.note || '').trim();
      if (payload.expectedOpenDate) {
        const d = new Date(payload.expectedOpenDate);
        if (Number.isNaN(d.getTime())) throw new CreateError(400, 'Ngày dự kiến khai trương không hợp lệ');
        payload.expectedOpenDate = d.toISOString();
      } else {
        payload.expectedOpenDate = '';
      }
      assertUploadedFileUrl(payload.fileUrl, 'Tài liệu đính kèm');
      // Mục H (bỏ phê duyệt module Vận Hành > Siêu Thị): người lập hồ sơ tự xử lý hết, không còn ai
      // khác cần bấm Duyệt — hồ sơ vào thẳng APPROVED ngay lúc tạo (khác operationOrders "Phê Duyệt Đơn
      // Hàng", vẫn giữ nguyên PENDING/quy trình duyệt cũ, KHÔNG đụng tới). status/currentStep/history
      // GIỮ NGUYÊN field kỹ thuật (không đổi data model) để mọi nơi đọc lại (badge/filter/dashboard) tự
      // hoạt động đúng mà không cần sửa thêm — chỉ khác giá trị khởi tạo.
      payload.status = 'APPROVED';
      payload.currentStep = 0;
      payload.history = [{ step: 0, approver: 'Hệ thống (tự động)', username: 'system', action: 'AUTO_APPROVED', comment: 'Không yêu cầu phê duyệt — hồ sơ tự động hoàn tất ngay khi tạo', time: new Date().toLocaleString('vi-VN') }];
      // Giai đoạn "Danh mục đầu tư" — workflow ĐỘC LẬP, chạy song song với hồ sơ chính (không chờ status
      // ở trên APPROVED mới cho lập, xem lib/workflowEngine.js module ảo
      // operationStoreOpeningEstimate). Field FLAT có tiền tố estimate*, cùng kỹ thuật signedFileStatus*
      // của contracts — không lồng object để applyWorkflowAction() truy cập được bằng bracket-access.
      payload.estimateStatus = 'DRAFT';
      payload.estimateCurrentStep = 0;
      payload.estimateHistory = [];
      payload.estimateItems = [];
      payload.estimateTotalAmount = 0;
    }
  },
  operationRepairs: {
    dbKey: 'operationRepairs',
    getScope: () => ({}),
    forceOwnDept: true,
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user, appData) => {
      if (!user.perms?.admin && !user.perms?.operationRepairCreate) {
        throw new CreateError(403, 'Bạn không có quyền tạo đề xuất sửa chữa siêu thị');
      }
      const storeName = String(payload.storeName || '').trim();
      if (!storeName) throw new CreateError(400, 'Vui lòng nhập tên/địa điểm siêu thị cần sửa chữa');
      payload.storeName = storeName;
      const title = String(payload.title || '').trim();
      if (!title) throw new CreateError(400, 'Vui lòng nhập nội dung sửa chữa');
      payload.title = title;
      payload.description = String(payload.description || '').trim();
      payload.supplier = String(payload.supplier || '').trim();
      payload.amount = Number(payload.amount) || 0;
      if (payload.amount < 0) throw new CreateError(400, 'Số tiền không được là số âm');
      // "Ngân Sách Phê Duyệt" — cùng field mới/lý do đã thêm ở operationStoreOpenings ngay trên (2 khái
      // niệm khác nhau với amount ở trên, KHÔNG đụng amount).
      if (payload.approvedBudget === undefined || payload.approvedBudget === null || payload.approvedBudget === '') {
        throw new CreateError(400, 'Vui lòng nhập Ngân sách phê duyệt (dùng để tính Ngân sách còn lại ở Danh mục đầu tư)');
      }
      const approvedBudget = Number(payload.approvedBudget);
      if (!Number.isFinite(approvedBudget) || approvedBudget < 0) {
        throw new CreateError(400, 'Ngân sách phê duyệt không hợp lệ (phải là số không âm)');
      }
      payload.approvedBudget = approvedBudget;
      // Người Phụ Trách — field MỚI hoàn toàn cho operationRepairs (trước đây chưa từng có), cùng ô
      // chọn tài khoản hệ thống thật vừa thêm cho operationStoreOpenings ở trên.
      const personInChargeUser = resolveOperationPersonInChargeUsername(payload.personInCharge, appData?.users);
      payload.personInCharge = personInChargeUser ? personInChargeUser.username : null;
      payload.personInChargeName = personInChargeUser ? personInChargeUser.name : null;
      assertUploadedFileUrl(payload.fileUrl, 'Tệp đính kèm');
      // Mục H — cùng lý do/kỹ thuật đã thêm ở operationStoreOpenings ngay trên.
      payload.status = 'APPROVED';
      payload.currentStep = 0;
      payload.history = [{ step: 0, approver: 'Hệ thống (tự động)', username: 'system', action: 'AUTO_APPROVED', comment: 'Không yêu cầu phê duyệt — hồ sơ tự động hoàn tất ngay khi tạo', time: new Date().toLocaleString('vi-VN') }];
      // Giai đoạn "Danh mục đầu tư" — cùng lý do/kỹ thuật đã thêm ở operationStoreOpenings ngay trên.
      payload.estimateStatus = 'DRAFT';
      payload.estimateCurrentStep = 0;
      payload.estimateHistory = [];
      payload.estimateItems = [];
      payload.estimateTotalAmount = 0;
    }
  },
  // Vận Hành > "Siêu Thị" > "Thực hiện" — "Kỳ Thực Hiện": mỗi hồ sơ Mở mới/Sửa chữa có DANH SÁCH kỳ
  // RIÊNG (không dùng chung toàn hệ thống như vppPeriods/budgetPeriods), để tách bạch nhiều đợt thi công
  // theo thời gian trên cùng 1 hồ sơ. 2 trạng thái: CHUA_BAT_DAU (mặc định lúc tạo) -> DANG_THUC_HIEN
  // (qua startOperationExecutionPeriod() ở lib/recordActions.js) — công việc GỐC chỉ tạo được khi chọn
  // đúng kỳ đang DANG_THUC_HIEN (xem createOperationWorkItem() ở lib/recordActions.js, cùng nguyên tắc
  // "không tin dữ liệu client" như budgetEntries.periodId ở trên).
  operationExecutionPeriods: {
    dbKey: 'operationExecutionPeriods',
    forceOwnDept: true, // dept chỉ hiển thị "ai tạo kỳ" (phòng ban Vận Hành), không phải phạm vi xem
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user, appData) => {
      if (!user.perms?.admin && !user.perms?.operationExecutionManage) {
        throw new CreateError(403, 'Bạn không có quyền tạo Kỳ Thực Hiện');
      }
      const sourceType = payload.sourceType === 'OPERATION_REPAIR' ? 'OPERATION_REPAIR' : 'OPERATION_STORE_OPENING';
      const sourceId = Number(payload.sourceId);
      const sourceList = sourceType === 'OPERATION_REPAIR' ? appData?.operationRepairs : appData?.operationStoreOpenings;
      const sourceRecord = (sourceList || []).find(r => r.id === sourceId);
      if (!sourceRecord) throw new CreateError(404, 'Không tìm thấy hồ sơ Mở mới/Sửa chữa tương ứng');
      if (sourceRecord.estimateStatus !== 'APPROVED') {
        throw new CreateError(409, 'Dự toán của hồ sơ này chưa duyệt xong, chưa thể tạo Kỳ Thực Hiện');
      }
      const name = String(payload.name || '').trim();
      if (!name) throw new CreateError(400, 'Thiếu tên Kỳ Thực Hiện');
      payload.name = name.slice(0, 200);
      payload.sourceType = sourceType;
      payload.sourceId = sourceId;
      payload.status = 'CHUA_BAT_DAU';
      payload.startedBy = null; payload.startedByName = null; payload.startedAt = null;
    }
  },
  // Tài liệu dùng cặp field cũ uploadAll(bool)+uploadDepts(mảng) chứ không phải {all,depts} object
  // như 5 module trên — quy đổi tại chỗ để dùng chung scopeAllows(). Đây cũng là module HỞ NHẤT
  // trước Bước 2: dropdown chọn phòng ban ở form tải lên trước đây không hề lọc theo quyền gì cả.
  docs: {
    dbKey: 'docs',
    getScope: (user) => ({ all: !!user.perms?.uploadAll, depts: user.perms?.uploadDepts || [] }),
    creatorField: 'uploader', creatorNameField: 'uploaderName',
    // Khớp uploadDoc()/getDocFamily()/getDocFamilyLatest() ở index.html — nhánh "Cập nhật" (rootDocId
    // khác null) để CLIENT tự tính cat/displayCode/versionNumber/code rồi gửi nguyên payload lên, server
    // TRƯỚC ĐÂY (module docs không có extraValidate nào) không xác minh lại gì cả: 1 request tự soạn có
    // thể tự xưng rootDocId của tài liệu bất kỳ (kể cả phòng ban khác), tự đặt versionNumber tuỳ ý (đâm
    // ra 2 version trùng số hoặc "nhảy cóc"), hoặc bổ sung version cho tài liệu gốc CHƯA duyệt xong.
    extraValidate: (payload, collection, user, appData, trashedItems) => {
      validateRequiredCustomData(payload.customData, appData?.formTemplates, 'DOC');
      // Tệp tài liệu (#docFile ở index.html) — xem assertUploadedFileUrl().
      assertUploadedFileUrl(payload.fileUrl, 'Tệp tài liệu');
      if (payload.rootDocId != null) {
        const rootId = Number(payload.rootDocId);
        const root = (collection || []).find(d => d.id === rootId && d.rootDocId == null);
        if (!root) throw new CreateError(400, 'Tài liệu gốc không tồn tại');
        const family = (collection || []).filter(d => d.id === rootId || d.rootDocId === rootId)
          .sort((a, b) => (a.versionNumber || 1) - (b.versionNumber || 1));
        const latest = family[family.length - 1];
        // Chỉ chặn khi version mới nhất đang xử lý dở (PENDING: chờ duyệt, DRAFT: chờ sửa & trình lại) —
        // REJECTED là kết quả CUỐI của lượt đó nên KHÔNG chặn, nếu không tài liệu bị từ chối sẽ vĩnh viễn
        // không thể cập nhật được nữa (khớp isDocFamilyLatestBlocking() ở index.html).
        if (!latest || latest.status === 'PENDING' || latest.status === 'DRAFT') {
          throw new CreateError(409, 'Không thể cập nhật khi phiên bản mới nhất của tài liệu này đang chờ xử lý (chờ duyệt hoặc chờ sửa & trình lại)');
        }
        if (payload.dept !== root.dept) {
          throw new CreateError(400, 'Phòng ban của phiên bản mới phải khớp với tài liệu gốc');
        }
        // cat/displayCode/versionNumber/code PHẢI tự tính lại ở server, không tin giá trị client gửi.
        payload.cat = root.cat;
        payload.rootDocId = rootId;
        payload.displayCode = root.displayCode || root.code;
        payload.versionNumber = (latest.versionNumber || family.length) + 1;
        payload.code = `${payload.displayCode}-V${payload.versionNumber}`;
        if ((collection || []).some(d => d.code === payload.code)) {
          throw new CreateError(409, `Mã "${payload.code}" đã tồn tại`);
        }
        // Quét thêm Thùng Rác (trashedItems do routes/create.js đọc trước rồi truyền vào — xem chú
        // thích tham số trashedItems của validateAndPrepareCreate() ở trên): version code tính tự
        // động ở đây cũng phải tránh trùng với version đã bị xoá trước đó của CHÍNH tài liệu gốc này.
        if ((trashedItems || []).some(t => t.code === payload.code)) {
          throw new CreateError(409, `Mã "${payload.code}" đã từng được dùng cho 1 phiên bản đã xoá — vui lòng thử lại`);
        }
      } else {
        payload.versionNumber = 1;
        payload.rootDocId = null;
      }
      // status/currentStep/history PHẢI gán cứng ở server (khớp uploadDoc() ở index.html, dùng đúng
      // thông tin XÁC THỰC của người gọi thay vì tin currentUser.name/username client tự gửi) — trước
      // đây module này không đụng tới 3 field trạng thái này, 1 request tự soạn (bỏ qua UI) có thể tự
      // đặt sẵn status:"APPROVED" cùng history giả để bỏ qua toàn bộ quy trình duyệt.
      payload.status = 'PENDING';
      payload.currentStep = 1;
      payload.history = [{
        step: 0,
        stepName: 'Tải lên & Trình ký',
        approver: user.name,
        username: user.username,
        action: 'UPLOADED',
        time: new Date().toLocaleString('vi-VN')
      }];
    }
  },
  // Tin nội bộ (Bước 2b): KHÔNG có khái niệm phòng ban để chọn — dept trong hồ sơ chỉ là thông tin
  // hiển thị (phòng ban của người đăng), không phải phạm vi được cấp. forceOwnDept ép dept = phòng ban
  // thật của người đăng (bỏ qua giá trị client gửi) nên scopeAllows() luôn đi qua nhánh "own dept" —
  // quyền thật sự nằm ở extraValidate theo type (NEWS/TRAINING/REWARD cần cờ riêng, SHARE ai cũng được,
  // khớp canCreateInternalPost() ở index.html). Trước Bước 2b, type/dept/author đều do client tự gửi.
  internalPosts: {
    dbKey: 'internalPosts',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'author', creatorNameField: 'authorName',
    extraValidate: (payload, collection, user, appData) => {
      const type = payload.type;
      const allowed = !!(
        user.perms?.admin ||
        type === 'SHARE' ||
        (type === 'NEWS' && user.perms?.internalNewsCreate) ||
        (type === 'TRAINING' && user.perms?.trainingManage) ||
        (type === 'REWARD' && user.perms?.internalRewardCreate)
      );
      if (!allowed) throw new CreateError(403, 'Bạn không có quyền đăng bài ở phân hệ này');

      // Tệp đính kèm (tuỳ chọn) — chặn scheme "javascript:" trước khi lưu, xem assertUploadedFileUrl().
      assertUploadedFileUrl(payload.attachment?.fileUrl, 'Tệp đính kèm');

      // Trường bổ sung (Biểu Mẫu > Truyền Thông Nội Bộ - Chuyên Đề) — chỉ NEWS/SHARE còn hiện
      // #dynamicFieldsContainer_INTERNAL_POST ở client (xem CORE_FIELD_MANIFEST.INTERNAL_POST).
      if (type === 'NEWS' || type === 'SHARE') {
        validateRequiredCustomData(payload.customData, appData?.formTemplates, 'INTERNAL_POST');
      }

      // postCategory ("chuyên đề") — chỉ NEWS (Nhịp Sống HCRC) và SHARE (Góc Chia Sẻ) có, dùng CHUNG
      // tên field nhưng khác danh sách giá trị hợp lệ theo type (appData.internalNewsCategories vs
      // appData.internalShareCategories) — xem defaults.js. 2 type còn lại (TRAINING/REWARD) không có
      // khái niệm chuyên đề nên luôn xoá field này khỏi payload.
      if (type === 'NEWS' || type === 'SHARE') {
        const catList = type === 'NEWS' ? (appData.internalNewsCategories || []) : (appData.internalShareCategories || []);
        const catKey = (payload.postCategory || '').trim();
        if (!catKey || !catList.some(c => c.key === catKey)) {
          throw new CreateError(400, 'Vui lòng chọn chuyên đề hợp lệ cho bài viết');
        }
        payload.postCategory = catKey;
      } else {
        delete payload.postCategory;
      }

      // Lưu Nháp (Đợt 1 Nhịp Sống HCRC/Góc Chia Sẻ) — tác giả vẫn cần đúng quyền đăng bài theo type ở
      // trên, chỉ khác ở chỗ KHÔNG đưa vào hàng chờ duyệt/công khai ngay. submitInternalPostDraft() ở
      // lib/recordActions.js sẽ chuyển DRAFT -> PENDING/APPROVED sau, dùng lại đúng luật gán status bên
      // dưới (không lặp lại logic ở 2 chỗ).
      const isDraft = payload.draft === true;
      delete payload.draft;

      // Lịch đăng bài (Nhịp Sống HCRC) — publishAt để trống = đăng ngay, có giá trị = "Chờ đăng" cho tới
      // khi tới giờ (tính live ở canViewInternalPost/render, KHÔNG cron — giống pinExpiresAt bên dưới).
      // Chỉ NEWS mới đặt lịch được (SHARE/TRAINING/REWARD giữ nguyên hành vi đăng ngay khi duyệt xong).
      const publishAtRaw = payload.publishAt;
      if (type === 'NEWS' && publishAtRaw) {
        const ts = new Date(publishAtRaw).getTime();
        if (!Number.isFinite(ts)) throw new CreateError(400, 'Thời gian đăng bài không hợp lệ');
        payload.publishAt = new Date(ts).toISOString();
      } else {
        payload.publishAt = null;
      }

      if (isDraft) {
        payload.status = 'DRAFT';
      } else {
        // Góc Chia Sẻ (SHARE) cần người có quyền internalPostApprove/admin duyệt trước khi công khai —
        // status GÁN Ở SERVER (không tin giá trị client tự gửi). Người đăng đã có quyền duyệt thì không
        // cần tự duyệt lại bài của chính mình. 3 type còn lại không qua bước duyệt (đã gác quyền đăng ở
        // trên) nên luôn APPROVED.
        payload.status = (type === 'SHARE' && !user.perms?.admin && !user.perms?.internalPostApprove)
          ? 'PENDING' : 'APPROVED';
      }

      // Ghim lên trang chủ (Đợt E) — chỉ Tin tức/Đào tạo/Khen thưởng (Góc chia sẻ còn phải qua duyệt
      // mới công khai nên không ghim được), chỉ người có quyền internalPostApprove/admin. pinExpiresAt
      // TÍNH Ở SERVER từ số ngày client chọn (payload.pinDurationDays) — không tin thẳng timestamp
      // client tự gửi để tránh ghim vĩnh viễn/quá hạn cho phép.
      const PIN_DURATION_DAYS_ALLOWED = [3, 7, 14, 30];
      const pinDurationDaysRaw = payload.pinDurationDays;
      delete payload.pinDurationDays;
      const wantsPin = pinDurationDaysRaw !== undefined && pinDurationDaysRaw !== null && pinDurationDaysRaw !== '';
      if (wantsPin) {
        if (type === 'SHARE') throw new CreateError(400, 'Không thể ghim bài Góc Chia Sẻ lên trang chủ');
        if (!user.perms?.admin && !user.perms?.internalPostApprove) throw new CreateError(403, 'Bạn không có quyền ghim bài lên trang chủ');
        const days = Number(pinDurationDaysRaw);
        if (!PIN_DURATION_DAYS_ALLOWED.includes(days)) throw new CreateError(400, 'Thời hạn ghim không hợp lệ');
        payload.pinned = true;
        payload.pinExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        payload.pinnedBy = user.username;
      } else {
        payload.pinned = false;
        payload.pinExpiresAt = null;
        payload.pinnedBy = null;
      }
    }
  },
  // Đề nghị thanh toán TẠO THỦ CÔNG (module "Tổng Hợp" > "Thanh toán" > "Tạo đề nghị thủ công") —
  // không có dept-scope (kế toán tạo được cho bất kỳ phòng ban nào), chỉ cần quyền paymentManage.
  // Đề nghị tự sinh từ Hợp đồng/Mua Bán/Sửa Chữa/Đầu Tư (sourceModule khác 'MANUAL') KHÔNG đi qua
  // route này — chúng được tạo trực tiếp ở routes/records.js khi bấm "Chuyển Sang Thanh Toán" (xem
  // lib/recordActions.js startContractPayment()/startOfficePayment()).
  paymentRequests: {
    dbKey: 'paymentRequests',
    getScope: () => ({ all: true, depts: [] }),
    creatorField: 'createdBy', creatorNameField: 'createdByName',
    extraValidate: (payload, collection, user) => {
      if (!user.perms?.admin && !user.perms?.paymentManage) {
        throw new CreateError(403, 'Bạn không có quyền tạo đề nghị thanh toán');
      }
      // Đề nghị tạo thủ công (không có nguồn Hợp đồng/Mua Bán/Sửa Chữa để suy ra tên) — thiếu tiêu đề
      // để lại 1 hồ sơ trống trong danh sách chờ duyệt, khó nhận diện.
      payload.title = String(payload.title || '').trim();
      if (!payload.title) throw new CreateError(400, 'Vui lòng nhập tiêu đề đề nghị thanh toán');
      payload.sourceModule = 'MANUAL';
      payload.sourceId = null;
      payload.sourceCode = null;
      payload.status = 'PENDING';
      const installments = Array.isArray(payload.installments) ? payload.installments : [];
      if (!installments.length) throw new CreateError(400, 'Cần ít nhất 1 đợt thanh toán');
      payload.installments = installments.map(it => ({
        description: (it?.description || '').trim(), amount: Number(it?.amount) || 0, dueDate: it?.dueDate || '',
        confirmed: false, confirmedAt: null, confirmedBy: null
      }));
      // Mỗi đợt phải dương — không chỉ ràng buộc tổng (xem cùng lý do ở contracts.extraValidate).
      if (payload.installments.some(it => !(it.amount > 0))) {
        throw new CreateError(400, 'Mỗi đợt thanh toán phải có số tiền lớn hơn 0');
      }
      payload.amount = payload.installments.reduce((sum, it) => sum + it.amount, 0);
    }
  },
  // Văn phòng phẩm — "kỳ đăng ký": KHÔNG có khái niệm phòng ban để chọn (dùng chung toàn công ty),
  // dept trong hồ sơ chỉ để hiển thị "ai tạo kỳ này" — giống internalPosts, forceOwnDept + getScope
  // rỗng nên scopeAllows() luôn qua, quyền thật nằm ở extraValidate (chỉ vppManage/admin).
  vppPeriods: {
    dbKey: 'vppPeriods',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user) => {
      if (!user.perms?.admin && !user.perms?.vppManage) {
        throw new CreateError(403, 'Chỉ người có quyền quản lý Văn phòng phẩm mới được tạo kỳ đăng ký');
      }
      if (!payload.name || !String(payload.name).trim()) throw new CreateError(400, 'Thiếu tên kỳ đăng ký');
      const items = Array.isArray(payload.catalogItems) ? payload.catalogItems : [];
      const cleaned = items
        .map(it => ({
          code: String(it?.code || '').trim(),
          name: String(it?.name || '').trim(),
          unit: String(it?.unit || '').trim(),
          origin: String(it?.origin || '').trim(),
          spec: String(it?.spec || '').trim(),
          price: (it?.price === null || it?.price === undefined || it?.price === '') ? null
            : (Number.isFinite(Number(it.price)) ? Number(it.price) : null)
        }))
        .filter(it => it.name);
      if (!cleaned.length) throw new CreateError(400, 'Danh mục mặt hàng trống — vui lòng tải lên file danh mục hợp lệ');
      payload.catalogItems = cleaned;
      if (payload.startDate && payload.endDate && payload.endDate < payload.startDate) {
        throw new CreateError(400, 'Ngày kết thúc phải sau ngày bắt đầu');
      }
      // Ngân sách/người (VNĐ, tuỳ chọn — null/0 = không giới hạn): mức trần áp cho TỪNG CÁ NHÂN khi
      // "Gửi phê duyệt" (xem submitVppRegistration() ở lib/recordActions.js). deptHeadcounts là số
      // nhân sự từng phòng ban CHỐT (snapshot) tại thời điểm tạo kỳ — admin có thể sửa tay khác số
      // tài khoản đang hoạt động thật (VD người nghỉ dài hạn, nhân viên mới chưa có tài khoản) — CHỈ
      // dùng nhân với ngân sách/người ra "Ngân sách phòng ban" để THAM CHIẾU ở báo cáo, không dùng để
      // chặn đăng ký (mức chặn thật sự luôn áp cho từng người ở trên, tránh race condition tranh nhau
      // 1 quỹ chung — đã chốt với người yêu cầu tính năng).
      const perPersonBudgetRaw = payload.perPersonBudget;
      payload.perPersonBudget = (perPersonBudgetRaw === null || perPersonBudgetRaw === undefined || perPersonBudgetRaw === '')
        ? null : Math.max(0, Number(perPersonBudgetRaw) || 0);
      const headcountsRaw = (payload.deptHeadcounts && typeof payload.deptHeadcounts === 'object') ? payload.deptHeadcounts : {};
      const cleanedHeadcounts = {};
      Object.keys(headcountsRaw).forEach(dept => {
        const n = Math.max(0, Math.round(Number(headcountsRaw[dept]) || 0));
        if (dept && n > 0) cleanedHeadcounts[dept] = n;
      });
      payload.deptHeadcounts = cleanedHeadcounts;
      payload.status = 'OPEN';
      payload.closedAt = null;
      payload.closedBy = null;
    }
  },
  // Văn phòng phẩm — đăng ký của từng nhân viên cho 1 kỳ. Cũng forceOwnDept (dept = phòng ban thật của
  // người đăng ký, dùng để tra cứu quy trình duyệt theo phòng qua vppDeptWorkflows) — AI đã đăng nhập
  // đều đăng ký được (không cần cờ quyền riêng, giống internalPosts loại SHARE), quyền thật sự nằm ở
  // kiểm tra kỳ còn mở + chưa đăng ký trùng bên dưới. Phải tra cứu SANG collection vppPeriods — CALLER
  // (routes/create.js) đọc sẵn và gộp vào appData.vppPeriods TRƯỚC khi gọi (giống cách submissions dùng
  // appData.submissionDeptWorkflows) — file này KHÔNG tự đọc DB/collection khác, giữ đúng nguyên tắc cũ
  // (xem đầu file) để stub test vẫn tái dùng được y nguyên, không cần async.
  //
  // "Kết thúc chọn" (nút ở giao diện) LUÔN tạo hồ sơ ở trạng thái NHÁP — CHƯA vào quy trình duyệt (bấm
  // "Gửi" riêng mới chuyển NHÁP -> CHỜ DUYỆT, xem routes/records.js POST .../submit). NHÁP còn sửa được
  // (routes/records.js POST .../update, tái dùng đúng logic làm sạch mặt hàng ở dưới qua vppCatalog.js).
  vppRegistrations: {
    dbKey: 'vppRegistrations',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    // "1 hồ sơ/người/kỳ" (kiểm tra "duplicate" ở extraValidate bên dưới) là điều kiện trùng lặp GIỮA
    // NHIỀU bản ghi — không diễn đạt được bằng UNIQUE INDEX (Collection, Code) đơn giản như trùng mã,
    // giống hệt lý do meetings cần getLockKey ở trên: createForCollection() thường chỉ có unique index
    // đó chặn race, không chặn được 2 request tạo đăng ký CÙNG LÚC cho CÙNG 1 người ở CÙNG 1 kỳ (cả hai
    // đọc collection lúc "chưa ai đăng ký" trước khi request nào kịp ghi). Khoá theo cặp kỳ+người tạo.
    getLockKey: (payload, user) => `vpp_registration:${payload.periodId}:${user.username}`,
    extraValidate: (payload, collection, user, appData) => {
      // Người ĐĂNG KÝ được uỷ quyền theo phòng ban (xem checkbox "Người đăng ký" khối 12 cây phân
      // quyền) — trước đây module mở sẵn cho MỌI người đã đăng nhập, giờ chỉ người được uỷ quyền (hoặc
      // admin) mới đăng ký được, khớp yêu cầu "người đăng ký chịu trách nhiệm đăng ký cho phòng".
      if (!user.perms?.admin && !user.perms?.vppRegisterCreate) {
        throw new CreateError(403, 'Bạn không có quyền đăng ký Văn Phòng Phẩm — liên hệ người được uỷ quyền đăng ký của phòng mình');
      }
      const periodId = Number(payload.periodId);
      if (!Number.isFinite(periodId)) throw new CreateError(400, 'Thiếu kỳ đăng ký');
      const periods = appData?.vppPeriods || [];
      const period = periods.find(p => p.id === periodId);
      if (!period) throw new CreateError(404, 'Không tìm thấy kỳ đăng ký');
      const todayStr = new Date().toISOString().slice(0, 10);
      const pastEndDate = !!(period.endDate && todayStr > period.endDate);
      if (period.status !== 'OPEN' || pastEndDate) {
        throw new CreateError(409, 'Kỳ đăng ký này đã kết thúc, không thể đăng ký thêm');
      }
      // Chặn thật (không chỉ ẩn form ở client) — chức danh HIỆN TẠI của user nằm trong danh sách "Nhóm
      // Không Cấp Văn Phòng Phẩm" (vppExcludedJobTitles, khối 17 cây phân quyền, mảng chuỗi phẳng) thì
      // không đăng ký được, bất kể phòng ban. vppExcludedJobTitles là key AppData thường (không migrate
      // sang dbo.Records) nên đã có sẵn nguyên trong appData, không cần cross-load thêm gì. TRƯỚC ĐÂY
      // đây là 2 điều kiện lồng nhau (vppExcludeGroups[] + user.vppExcludeGroupIds[]) — xem
      // migrateVppExcludedJobTitles() ở seedDefaults.js cho lịch sử di trú.
      const excludedJobTitles = appData?.vppExcludedJobTitles || [];
      const isExcluded = !!user.jobTitle && excludedJobTitles.includes(user.jobTitle);
      if (isExcluded) throw new CreateError(403, 'Bạn không thuộc diện được đăng ký Văn phòng phẩm');
      // 1 hồ sơ/người/kỳ — kể cả đang NHÁP (sửa nháp phải đi qua route .../update, không tạo hồ sơ thứ 2).
      // Từ chối (REJECTED) là trạng thái kết thúc hẳn nên vẫn cho phép đăng ký lại từ đầu như trước.
      const duplicate = (collection || []).some(r =>
        r.periodId === periodId && r.creator === user.username && r.status !== 'REJECTED');
      if (duplicate) throw new CreateError(409, 'Bạn đã có đăng ký ở kỳ này rồi (chỉ 1 đăng ký/người/kỳ) — vui lòng sửa hồ sơ nháp hiện có');

      payload.items = validateVppRegItems(payload.items, period.catalogItems);
      payload.periodCode = period.code;
      payload.periodName = period.name;
      payload.status = 'DRAFT';
      payload.currentStep = 0;
      payload.history = [];
    }
  },
  // ===== BÁO CÁO ĐỊNH KỲ (module con "Điều Hành", thường dùng cho báo cáo tuần) =====
  // Mô hình 2 tầng giống hệt VPP (kỳ + hồ sơ từng người) ở trên: reportPeriods = "kỳ báo cáo" (tên +
  // hạn chót nộp + phòng ban áp dụng), reportEntries = báo cáo NHÁP/Gửi của TỪNG nhân viên cho 1 kỳ.
  // Khác VPP: (1) reportPeriods có deptScope (phòng ban nào phải nộp — VPP dùng chung toàn công ty,
  // không cần), (2) không có "Yêu cầu bổ sung" (đã chốt bỏ qua) — SUBMITTED là chốt hẳn, nhân viên
  // không sửa lại được nữa. reportEntries dùng forceOwnDept + getScope rỗng giống hệt vppRegistrations
  // (KHÔNG gắn quyền scope riêng — với forceOwnDept, scopeAllows() LUÔN cho qua hành động trên đúng
  // phòng ban của chính người dùng bất kể scope, nên 1 quyền scope ở đây sẽ là quyền "chết", không bao
  // giờ thực sự chặn được gì — xem lib/workflowEngine.js/index.html scopeAllows()). Quyền thật sự nằm
  // ở kiểm tra "phòng ban của bạn có thuộc phạm vi kỳ" bên dưới.
  // Khâu Tổng hợp (Merge)/Chỉnh sửa/Phát hành xử lý ở lib/recordActions.js + routes/records.js (không
  // đi qua đường "tạo mới" này) — xem closeReportPeriod/mergeReportPeriod/... ở đó.
  reportPeriods: {
    dbKey: 'reportPeriods',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user, appData) => {
      if (!user.perms?.admin && !user.perms?.reportManage) {
        throw new CreateError(403, 'Chỉ người có quyền quản lý Báo Cáo Định Kỳ mới được tạo kỳ báo cáo');
      }
      if (!payload.name || !String(payload.name).trim()) throw new CreateError(400, 'Thiếu tên kỳ báo cáo');
      if (!payload.endTime) throw new CreateError(400, 'Thiếu hạn chót nộp báo cáo');
      if (new Date(payload.endTime).getTime() <= Date.now()) {
        throw new CreateError(400, 'Hạn chót nộp báo cáo phải ở trong tương lai');
      }
      const deptScope = payload.deptScope || {};
      const cleanedDepts = Array.isArray(deptScope.depts) ? deptScope.depts.filter(d => typeof d === 'string' && d.trim()) : [];
      if (!deptScope.all && !cleanedDepts.length) {
        throw new CreateError(400, 'Vui lòng chọn ít nhất 1 phòng ban áp dụng, hoặc chọn "Tất cả phòng ban"');
      }
      payload.deptScope = { all: !!deptScope.all, depts: deptScope.all ? [] : cleanedDepts };
      payload.status = 'OPEN';
      payload.closedAt = null;
      payload.closedBy = null;
      payload.compilation = null;
      // taskCompilation: bản "Tổng Hợp Theo Công Việc" (đối chiếu) — TÁCH RIÊNG khỏi compilation ở trên
      // (bản tổng hợp CHÍNH THỨC từ báo cáo người dùng nộp) để 2 bên không đè lên nhau, xem
      // mergeReportPeriodByTasks() ở lib/recordActions.js.
      payload.taskCompilation = null;
      // pdfCompilation: bản tổng hợp ghép file PDF THẬT (song song compilation ở trên, vốn ghép từ
      // parsedSlides .pptx) — dành cho reportEntries.entryType==='PDF', xem mergeReportPeriodPdf()/
      // publishReportPeriodPdf() ở lib/recordActions.js.
      payload.pdfCompilation = null;
    }
  },
  reportEntries: {
    dbKey: 'reportEntries',
    forceOwnDept: true,
    // getScope() KHÔNG dùng {all,depts} như các module khác — forceOwnDept:true khiến scopeAllows()
    // LUÔN cho qua khi dept === user.dept (không cần xét scope permission), nên 1 permission dạng
    // scope gắn ở đây sẽ vĩnh viễn "chết" (đã phát hiện + gỡ bỏ hẳn 1 quyền dạng này trước đó). Cổng
    // "ai được nộp báo cáo" giờ dùng cờ boolean THẬT — reportEntryCreate — kiểm tra ngay trong
    // extraValidate bên dưới (không đặt ở getScope vì getScope chỉ nhận (dept) làm input, không có
    // chỗ chặn "không ai được tạo cả" một cách rõ ràng).
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    // Race y hệt lý do vppRegistrations/meetings/trainingRegistrations/budgetEntries cần getLockKey ở
    // trên: kiểm tra "duplicate" bên dưới chỉ đọc `collection` trong bộ nhớ tại lúc validate — 2 request
    // nộp báo cáo CÙNG LÚC của CÙNG 1 người cho CÙNG 1 kỳ đều có thể đọc thấy "chưa có báo cáo nào" rồi
    // cùng tạo thành công, phá vỡ luật "1 báo cáo/kỳ/người". Khoá theo đúng cặp (kỳ, người nộp).
    getLockKey: (payload, user) => `report_entry:${payload.periodId}:${user.username}`,
    extraValidate: (payload, collection, user, appData) => {
      if (!user.perms?.admin && !user.perms?.reportEntryCreate) {
        throw new CreateError(403, 'Bạn không có quyền nộp Báo Cáo Định Kỳ');
      }
      const periodId = Number(payload.periodId);
      if (!Number.isFinite(periodId)) throw new CreateError(400, 'Thiếu kỳ báo cáo');
      const periods = appData?.reportPeriods || [];
      const period = periods.find(p => p.id === periodId);
      if (!period) throw new CreateError(404, 'Không tìm thấy kỳ báo cáo');
      const scope = period.deptScope || {};
      const deptAllowed = !!scope.all || (Array.isArray(scope.depts) && scope.depts.includes(user.dept));
      if (!deptAllowed) throw new CreateError(403, 'Phòng ban của bạn không thuộc phạm vi kỳ báo cáo này');
      const pastDeadline = !!(period.endTime && Date.now() > new Date(period.endTime).getTime());
      if (period.status !== 'OPEN' || pastDeadline) {
        throw new CreateError(409, 'Kỳ báo cáo này đã kết thúc, không thể nộp báo cáo nữa');
      }
      if (!payload.title || !String(payload.title).trim()) throw new CreateError(400, 'Thiếu tiêu đề báo cáo');
      const duplicate = (collection || []).some(r => r.periodId === periodId && r.creator === user.username);
      if (duplicate) throw new CreateError(409, 'Bạn đã có báo cáo ở kỳ này rồi — vui lòng sửa báo cáo nháp hiện có');
      normalizeReportEntryPayload(payload);
      payload.periodName = period.name;
      payload.periodEndTime = period.endTime;
      payload.status = 'DRAFT';
    }
  },
  // ===== HỖ TRỢ IT — 2 sub-module tách biệt hoàn toàn, không chung dữ liệu =====
  // 1) "Phê Duyệt Giá" (itPriceApprovals): duyệt giá bán MẶT HÀNG TẠI SIÊU THỊ — KHÔNG phải phê duyệt
  //    mua sắm/chi phí (khác hẳn Đề Xuất Văn Phòng/Hợp Đồng, không sinh đề nghị Thanh Toán). Quy trình
  //    duyệt theo phòng ban dùng lại NGUYÊN engine chung ở lib/workflowEngine.js (giống docs/carRegs/
  //    officeReqs — xem itPriceDeptWorkflows). Sau khi APPROVED, người Hỗ Trợ IT (itManage) tự áp giá
  //    vào hệ thống bán hàng NGOÀI app này rồi bấm xác nhận hoàn thành ngay tại đây (field applied) —
  //    KHÔNG phải 1 bước duyệt thêm, chỉ là đánh dấu đã thực hiện xong (xem applyPriceApproval() ở
  //    lib/recordActions.js).
  itPriceApprovals: {
    dbKey: 'itPriceApprovals',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user, appData) => {
      if (!user.perms?.admin && !user.perms?.itPriceProposeCreate) {
        throw new CreateError(403, 'Bạn không có quyền đề xuất duyệt giá');
      }
      // priceType (RETAIL/WHOLESALE) — bắt buộc, client tự gắn đúng giá trị theo sub-tab "Bán Lẻ"/"Bán
      // Buôn" đang mở lúc gửi (KHÔNG có dropdown chọn tay, xem submitItPriceApproval() ở index.html),
      // không tin nguyên văn giá trị lạ nào khác client gửi kèm. Dùng để lọc đúng sub-tab hiển thị VÀ để
      // resolveWfConfig() (lib/workflowEngine.js) tra đúng nhánh approver theo cặp (dept, priceType).
      const priceType = payload.priceType === 'WHOLESALE' ? 'WHOLESALE' : (payload.priceType === 'RETAIL' ? 'RETAIL' : null);
      if (!priceType) throw new CreateError(400, 'Vui lòng chọn đúng loại giá (Bán Lẻ/Bán Buôn)');
      payload.priceType = priceType;
      // Bán Buôn: bỏ quy trình theo phòng ban, chuyển sang theo 1 trong 4 mức Margin/Chiết Khấu cố định
      // (đã chốt với người dùng — danh sách PHẲNG, không lồng nhau). RETAIL không dùng field này — không
      // tin giá trị lạ client cố tình gửi kèm (null hoá để resolveWfConfig() không đọc nhầm).
      const PRICE_TIER_VALUES = new Set(['MARGIN_LT5', 'MARGIN_GTE5', 'DISCOUNT_LTE5', 'DISCOUNT_GT5']);
      if (priceType === 'WHOLESALE') {
        if (!PRICE_TIER_VALUES.has(payload.priceTier)) {
          throw new CreateError(400, 'Vui lòng chọn đúng Mức Margin/Chiết Khấu áp dụng cho đề xuất Bán Buôn');
        }
      } else {
        payload.priceTier = null;
      }
      // Tài liệu bổ sung liên quan (#itPriceExtraFiles ở index.html) — mirror ĐÚNG khuôn
      // submissions.extraFiles (~380): chỉ kiểm khuôn URL rồi giữ nguyên payload.extraFiles, hoàn toàn
      // TUỲ CHỌN (mảng rỗng hợp lệ). Trần 20 tệp phòng payload khổng lồ.
      assertUploadedFileUrlList(payload.extraFiles, 'Tài liệu bổ sung liên quan');
      payload.extraFiles = Array.isArray(payload.extraFiles) ? payload.extraFiles.slice(0, 20) : [];
      // Đề xuất giờ nộp bằng cách tải lên 1 tệp Excel bảng giá (nhiều dòng/mặt hàng cùng lúc) thay vì
      // nhập tay 1 mặt hàng — client gọi POST /api/it-price/parse-file trước để server đọc + trả về
      // items có cấu trúc, rồi echo lại NGUYÊN VĂN vào đây (payload.files[0]) — cùng mức tin cậy với
      // cách VPP xử lý danh mục (xem lib/vppCatalog.js::validateRegistrationItems), sanitizePriceFileItems()
      // dưới đây chặn payload giả mạo/kiểu dữ liệu lạ trước khi ghi vào DB.
      const file = payload.files && payload.files[0];
      if (!file || !file.fileUrl) throw new CreateError(400, 'Vui lòng tải lên tệp bảng giá (.xlsx) cần duyệt');
      // TRƯỚC ĐÂY chỉ cắt còn 300 ký tự (slice bên dưới) — không hề kiểm khuôn, nên "javascript:..."
      // hay đường dẫn tệp của hồ sơ phòng ban khác vẫn lưu được nguyên vẹn. Xem assertUploadedFileUrl().
      assertUploadedFileUrl(file.fileUrl, 'Tệp bảng giá');
      const items = sanitizePriceFileItems(file.items);
      const columnLabels = sanitizeColumnLabels(file.columnLabels);

      // Mẫu Giá (tuỳ chọn, payload.masterListId) — người đề xuất tự chọn ĐÚNG mẫu áp dụng cho bảng giá
      // của mình lúc nộp (không suy luận tự động theo phòng ban, vì thực tế có thể có nhiều mẫu khác
      // nhau — xem defaults.js). Mẫu Giá giờ CHỈ còn là khuôn cột (columns[], không còn dữ liệu giá thật)
      // — dùng để dò/hiển thị đúng tên cột lúc nộp (xem routes/priceFile.js), KHÔNG còn dùng để đối
      // chiếu giá trị/tự động bỏ qua duyệt phòng ban nữa. Mọi đề xuất từ nay LUÔN đi qua đúng quy trình
      // duyệt theo phòng ban (itPriceDeptWorkflows), không còn nhánh autoApproved.
      const masterLists = appData?.itPriceMasterLists || [];
      const masterListId = payload.masterListId ? Number(payload.masterListId) : null;
      const masterList = masterListId ? masterLists.find(m => m.id === masterListId) : null;
      // Đã có ít nhất 1 Mẫu Giá trong hệ thống thì BẮT BUỘC người đề xuất phải chọn đúng 1 mẫu (không
      // còn tuỳ chọn "Không đối chiếu") — tự soạn request bỏ qua field này hoặc trỏ tới id không tồn tại
      // đều bị chặn ngay tại đây, không để lọt vào state máy tiếp theo.
      if (masterLists.length > 0 && !masterList) {
        throw new CreateError(400, 'Vui lòng chọn đúng Mẫu Giá Phê Duyệt trước khi gửi đề xuất');
      }
      payload.masterListId = masterList ? masterList.id : null;
      payload.masterListName = masterList ? masterList.name : null;

      payload.files = [{
        id: Date.now(),
        fileUrl: String(file.fileUrl), // đã qua assertUploadedFileUrl() ở trên (khuôn + trần độ dài)
        fileName: (String(file.fileName || '').trim() || 'bang-gia.xlsx').slice(0, 200),
        uploadedBy: user.username, uploadedByName: user.name,
        uploadedAt: new Date().toLocaleString('vi-VN'),
        items, columnLabels
      }];
      payload.reason = (payload.reason || '').trim();
      // Lịch sử "Yêu Cầu Bổ Sung" — có thể đến từ người duyệt phòng ban (trong lúc PENDING, qua hành
      // động REQUEST_INFO chung của lib/workflowEngine.js) HOẶC từ đội Hỗ Trợ IT (sau khi đã APPROVED,
      // trước khi áp giá — xem requestPriceInfoFromIt() ở lib/recordActions.js). Cả 2 nguồn dùng CHUNG
      // 1 mảng này để có đúng 1 chỗ kiểm tra "còn yêu cầu bổ sung chưa xử lý" (xem blockApproveIf ở
      // lib/workflowEngine.js và applyPriceApproval()/submitPriceSupplementFile() ở lib/recordActions.js).
      payload.infoRequests = [];
      // Kết quả chống giả mạo — request tự soạn không thể tự xưng đã áp giá xong ngay lúc tạo.
      payload.applied = false;
      payload.appliedBy = null;
      payload.appliedByName = null;
      payload.appliedAt = null;
      // Khoá "Tôi đang xử lý" — người trong đội Hỗ Trợ IT nhận việc áp giá, xem claimPriceApply()/
      // applyPriceApproval() ở lib/recordActions.js.
      payload.applyClaimedBy = null;
      payload.applyClaimedByName = null;
      payload.applyClaimedAt = null;

      // status/currentStep/history PHẢI gán cứng ở server (khớp docs/carRegs/officeReqs) — đây là 3
      // field mà lib/workflowEngine.js đọc để xác định hồ sơ đang ở bước nào/ai được duyệt tiếp; thiếu
      // bước này thì applyWorkflowAction() sẽ chặn ngay ("Hồ sơ không còn ở trạng thái chờ xử lý") vì
      // item.status không phải 'PENDING'. autoApproved giữ lại = false (field cũ, chỉ còn ý nghĩa với
      // hồ sơ lịch sử tạo trước khi bỏ tính năng đối chiếu tự động — xem itPriceStatusBadge() ở index.html).
      payload.status = 'PENDING';
      payload.currentStep = 1;
      payload.autoApproved = false;
      payload.history = [];
    }
  },
  // 2) "Hỗ Trợ Yêu Cầu" (itSupportTickets): ticket helpdesk IT nội bộ — MỞ CHO TOÀN BỘ NHÂN VIÊN, không
  //    cần quyền riêng để tạo (giống Góc Chia Sẻ) vì bất kỳ ai cũng có thể gặp sự cố IT cần hỗ trợ; chỉ
  //    người có itManage/admin mới nhận xử lý/cập nhật trạng thái (xem claimItTicket()/
  //    updateItTicketStatus() ở lib/recordActions.js). State machine đơn giản TODO→DOING→DONE, có thể
  //    CANCELLED bất kỳ lúc nào trước khi DONE.
  itSupportTickets: {
    dbKey: 'itSupportTickets',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, existingCollection, user, appData) => {
      if (!payload.title || !String(payload.title).trim()) throw new CreateError(400, 'Thiếu tiêu đề yêu cầu');
      payload.title = String(payload.title).trim();
      if (!payload.description || !String(payload.description).trim()) throw new CreateError(400, 'Thiếu mô tả sự cố/yêu cầu');
      payload.description = String(payload.description).trim();
      // Danh Mục — nguồn hợp lệ giờ đọc từ appData.itTicketCategories (CORE_FIELD_MANIFEST.IT_TICKET,
      // optionsKey, admin tự thêm/bớt/đổi nhãn ở màn Biểu Mẫu), cùng khuôn postCategory/internalNewsCategories
      // ở trên — KHÔNG còn Set cố định 5 giá trị, nhưng vẫn fallback về danh sách gốc nếu appData chưa
      // có (dữ liệu cũ trước khi seed defaults.js chạy).
      const categoryList = (appData?.itTicketCategories && appData.itTicketCategories.length)
        ? appData.itTicketCategories
        : [{ key: 'HARDWARE' }, { key: 'SOFTWARE' }, { key: 'NETWORK' }, { key: 'ACCOUNT' }, { key: 'OTHER' }];
      payload.category = categoryList.some(c => c.key === payload.category) ? payload.category : 'OTHER';
      // Trạng thái/người xử lý luôn khởi tạo rỗng ở server — request tự soạn không thể tự xưng đã có
      // người nhận xử lý hay đã hoàn thành ngay lúc tạo.
      payload.status = 'TODO';
      payload.assignee = null;
      payload.assigneeName = null;
      payload.resolutionNote = '';
      payload.comments = [];
      // Leo thang phê duyệt (tuỳ chọn, IT tự kích hoạt lúc đang xử lý — xem escalateItTicket() ở
      // lib/recordActions.js): null lúc tạo, request tự soạn không thể tự xưng đã có người duyệt.
      payload.approvalStatus = null;
      payload.approvalApprover = null;
      payload.approvalApproverName = null;
      payload.approvalReason = '';
      payload.approvalComment = '';
    }
  },
  // ===== NHÂN SỰ ("HCRC Đồng Hành" — hỏi & đáp chế độ/quy định công ty) =====
  // hrFeedback: câu hỏi nhân viên gửi bộ phận Nhân Sự — MỞ CHO TOÀN BỘ NHÂN VIÊN, không cần quyền
  // riêng để gửi (đúng khuôn itSupportTickets ở trên: ai cũng có thể có thắc mắc về chế độ/quy định);
  // chỉ người có nhanSuManage/admin mới trả lời được (xem respondToHrFeedback() ở lib/recordActions.js).
  // Mô hình 1 hỏi – 1 đáp, kết thúc: PENDING -> ANSWERED, không trao đổi qua lại nhiều lượt.
  // KHÁC internalPosts (bảng tin CÔNG KHAI có duyệt bài/kiểm duyệt bình luận): câu hỏi ở đây RIÊNG TƯ,
  // chỉ chính người hỏi + Nhân Sự đọc được (xem canViewHrFeedback() ở lib/recordViewScope.js).
  hrFeedback: {
    dbKey: 'hrFeedback',
    forceOwnDept: true, // không có khái niệm chọn phòng ban (luôn là phòng ban của chính người hỏi)
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload) => {
      if (!payload.question || !String(payload.question).trim()) throw new CreateError(400, 'Vui lòng nhập nội dung câu hỏi');
      payload.question = String(payload.question).trim().slice(0, 5000);
      const allowedCategories = new Set(['BENEFITS', 'POLICY', 'SALARY', 'OTHER']);
      payload.category = allowedCategories.has(payload.category) ? payload.category : 'OTHER';
      // Thời điểm gửi do SERVER gán (không tin client) — khác itSupportTickets ở trên vốn nhận
      // createdAt từ payload; đây là bản ghi 2 phía (nhân viên hỏi/Nhân Sự đáp) nên mốc thời gian
      // phải là mốc server ghi nhận thật.
      payload.createdAt = new Date().toLocaleString('vi-VN');
      // Trạng thái/phản hồi/cờ chưa đọc LUÔN khởi tạo rỗng ở server — request tự soạn không thể tự
      // xưng đã được Nhân Sự trả lời ngay lúc tạo, cũng không thể tự bật cờ chưa đọc của chính mình.
      payload.status = 'PENDING';
      payload.response = '';
      payload.respondedBy = null;
      payload.respondedByName = null;
      payload.respondedAt = null;
      payload.employeeUnread = false;
    }
  },
  // ===== ĐÀO TẠO (module con "Truyền Thông Nội Bộ" > Đào tạo) =====
  // Đợt 3: cờ trainingManage (đổi tên từ internalTrainingCreate cũ, tự động migrate — xem
  // public/index.html migrateLegacyPerms()) gác cả 4 việc TẠO MỚI: tải tài liệu vào kho, tạo lớp học,
  // tạo bài test, tạo lộ trình thăng tiến (+ xác nhận nhân viên hoàn thành lộ trình, routes/records.js).
  // trainingInstruct (quyền MỚI, hẹp hơn) KHÔNG tạo mới được gì ở đây — chỉ quản lý roster/kết quả của
  // ĐÚNG lớp học họ được gán làm giảng viên (xem canManageTrainingClass(), lib/recordActions.js).
  trainingDocuments: {
    dbKey: 'trainingDocuments',
    forceOwnDept: true, // không có khái niệm phòng ban để chọn (kho dùng chung toàn công ty)
    getScope: () => ({}),
    creatorField: 'uploaderUsername', creatorNameField: 'uploaderName',
    extraValidate: (payload, collection, user, appData) => {
      if (!user.perms?.admin && !user.perms?.trainingManage) {
        throw new CreateError(403, 'Bạn không có quyền tải lên tài liệu đào tạo');
      }
      if (!payload.category || !String(payload.category).trim()) throw new CreateError(400, 'Thiếu loại đào tạo');
      if (!payload.title || !String(payload.title).trim()) throw new CreateError(400, 'Thiếu tên tài liệu');
      payload.category = String(payload.category).trim();
      payload.title = String(payload.title).trim();

      // Đợt 4: Loại tài liệu — DOCUMENT (mặc định, giữ NGUYÊN hành vi cũ: bắt buộc fileUrl từ tải file
      // .pdf/.docx/.xlsx), VIDEO (MỚI — nhúng Youtube qua videoUrl thay vì tải file, kiểm tra chặt
      // scheme + tên miền qua isValidYoutubeUrl(), xem chú thích ở đầu file), IMAGE (MỚI — vẫn dùng đúng cơ chế tải file như
      // DOCUMENT, accept ảnh phía client, server không cần phân biệt thêm vì fileUrl đã là 1 file có
      // thật, chỉ khác cách hiển thị ở client — thumbnail thay vì link tải).
      const docType = (payload.docType === 'VIDEO' || payload.docType === 'IMAGE') ? payload.docType : 'DOCUMENT';
      payload.docType = docType;
      if (docType === 'VIDEO') {
        const videoUrl = String(payload.videoUrl || '').trim();
        if (!videoUrl) throw new CreateError(400, 'Vui lòng nhập link video Youtube');
        if (!isValidYoutubeUrl(videoUrl)) {
          throw new CreateError(400, 'Link video phải là link Youtube hợp lệ (bắt đầu bằng https:// và thuộc youtube.com hoặc youtu.be)');
        }
        payload.videoUrl = videoUrl;
        payload.fileUrl = null; payload.fileName = ''; payload.fileType = '';
      } else {
        if (!payload.fileUrl) {
          throw new CreateError(400, docType === 'IMAGE' ? 'Vui lòng chọn ảnh cần tải lên' : 'Vui lòng chọn tệp tài liệu cần tải lên');
        }
        // Cùng lỗ hổng stored-XSS scheme "javascript:" đã vá ở các module khác (fileUrl chưa từng được
        // xác minh chỉ trỏ về /uploads/... đã tải lên thật) — trainingManage tự soạn payload gọi thẳng
        // route tạo có thể gài fileUrl bất kỳ, hiển thị lại thành link/nút tải ở màn Tài Liệu đào tạo.
        assertUploadedFileUrl(payload.fileUrl, 'Tệp tài liệu đào tạo');
        payload.videoUrl = '';
      }

      // Bắt Buộc Hoàn Thành (mandatory, Đợt 4) — CHỈ là cờ hiển thị (badge) ở phase này, KHÔNG có logic
      // chặn/theo dõi hoàn thành nào đi kèm (nằm ngoài phạm vi đợt này, xem ghi chú PR).
      payload.mandatory = payload.mandatory === true || payload.mandatory === 'true';

      // Chương Trình (courseId, Đợt 4, tuỳ chọn) — gắn tài liệu vào 1 trainingCourses có thật nếu có
      // chọn (appData.trainingCourses do CALLER đọc sẵn, xem routes/create.js); để trống vẫn hợp lệ,
      // tài liệu cũ trước tính năng này không có field này vẫn hiển thị/hoạt động bình thường.
      const courseId = (payload.courseId === '' || payload.courseId == null) ? null : Number(payload.courseId);
      if (courseId != null) {
        const courses = appData?.trainingCourses || [];
        if (!Number.isFinite(courseId) || !courses.some(c => c.id === courseId)) {
          throw new CreateError(400, 'Chương trình được chọn không hợp lệ');
        }
      }
      payload.courseId = courseId;
    }
  },
  trainingClasses: {
    dbKey: 'trainingClasses',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user, appData) => {
      // Đợt 3: TẠO lớp mới luôn cần trainingManage (kể cả giảng viên đã có trainingInstruct từ trước
      // cũng không tự tạo lớp được — họ chỉ quản lý lớp đã được gán làm giảng viên, xem baseline).
      if (!user.perms?.admin && !user.perms?.trainingManage) {
        throw new CreateError(403, 'Bạn không có quyền tạo lớp học');
      }
      if (!payload.category || !String(payload.category).trim()) throw new CreateError(400, 'Thiếu loại đào tạo');
      if (!payload.title || !String(payload.title).trim()) throw new CreateError(400, 'Thiếu tên lớp học');
      if (!payload.startTime) throw new CreateError(400, 'Thiếu thời gian bắt đầu lớp học');
      if (payload.endTime && payload.startTime && payload.endTime < payload.startTime) {
        throw new CreateError(400, 'Thời gian kết thúc phải sau thời gian bắt đầu');
      }
      payload.category = String(payload.category).trim();
      payload.title = String(payload.title).trim();
      payload.capacity = Number(payload.capacity) > 0 ? Math.floor(Number(payload.capacity)) : 0;
      payload.documentIds = Array.isArray(payload.documentIds) ? payload.documentIds.map(Number).filter(Number.isFinite) : [];
      // Kiểu lớp: ONLINE (mặc định, theo giáo trình đọc bắt buộc) hay OFFLINE (giáo trình chỉ là tài
      // liệu tham khảo giảng viên tự mở khi lên lớp, học viên không bắt buộc phải đọc trước).
      payload.mode = payload.mode === 'OFFLINE' ? 'OFFLINE' : 'ONLINE';
      // Chương Trình (courseId, Đợt 4, tuỳ chọn) — gắn lớp vào 1 trainingCourses có thật nếu có chọn
      // (appData.trainingCourses do CALLER đọc sẵn, xem routes/create.js). Hoàn toàn KHÔNG thay thế
      // "title" (title vẫn là tên hiển thị riêng của LẦN CHẠY LỚP này, xem ghi chú đầu module) — để
      // trống vẫn hợp lệ, lớp cũ trước tính năng này không có field này vẫn hoạt động bình thường.
      const courseId = (payload.courseId === '' || payload.courseId == null) ? null : Number(payload.courseId);
      if (courseId != null) {
        const courses = appData?.trainingCourses || [];
        if (!Number.isFinite(courseId) || !courses.some(c => c.id === courseId)) {
          throw new CreateError(400, 'Chương trình được chọn không hợp lệ');
        }
      }
      payload.courseId = courseId;
      // Gán bài test (tuỳ chọn, chọn từ Ngân Hàng Câu Hỏi) — testId phải khớp 1 bài test có thật tại
      // thời điểm tạo lớp (appData.trainingTests do routes/create.js đọc kèm, xem lib/recordStore.js).
      const testId = payload.testId === '' || payload.testId == null ? null : Number(payload.testId);
      if (testId != null) {
        const tests = appData?.trainingTests || [];
        if (!Number.isFinite(testId) || !tests.some(t => t.id === testId)) {
          throw new CreateError(400, 'Bài test được chọn không hợp lệ');
        }
      }
      payload.testId = testId;
      // Điểm Đạt (%) — NGUỒN DUY NHẤT xác định ngưỡng đạt/không đạt khi chấm tự động (xem
      // gradeTrainingTestSubmission() ở lib/recordActions.js), lập ngay lúc TẠO LỚP. Ngân Hàng Câu Hỏi
      // (trainingTests) có 1 field passScore riêng nhưng CHỈ mang tính gợi ý autofill cho ô này ở client
      // (xem applyTrainingClassTestDefaultPassScore()) — không được server đọc lại lúc chấm điểm, vì 1
      // bài test có thể tái dùng cho nhiều lớp với ngưỡng đạt khác nhau. Lớp có gán bài test thì bắt buộc
      // phải có Điểm Đạt hợp lệ (1-100) ở CHÍNH lớp — không cho tạo/sửa lớp với test mà bỏ trống, tránh
      // rơi vào mặc định ngầm không ai biết.
      if (payload.testId != null) {
        const passScore = Number(payload.passScore);
        if (!Number.isFinite(passScore) || passScore <= 0 || passScore > 100) {
          throw new CreateError(400, 'Lớp có gán Bài Test cần nhập Điểm Đạt Yêu Cầu hợp lệ (1-100)');
        }
        payload.passScore = passScore;
      } else {
        payload.passScore = null;
      }
      // Số giây/câu khi làm bài test — mặc định 120s/câu, người tạo lớp được đổi lúc tạo lớp (xem yêu
      // cầu nghiệp vụ: đếm ngược mỗi câu, mặc định 2 phút).
      const secPerQ = Number(payload.testSecondsPerQuestion);
      payload.testSecondsPerQuestion = Number.isFinite(secPerQ) && secPerQ >= 10 ? Math.floor(secPerQ) : 120;
      payload.status = 'OPEN';

      // Giảng viên (Đợt 3) — instructor (tên hiển thị, chỉ để tương thích ngược với dữ liệu nhập tay
      // trước đây) + instructorUsername (tài khoản hệ thống thật, dùng để so quyền trainingInstruct
      // theo TỪNG lớp — xem canManageTrainingClass() ở lib/recordActions.js). Cùng khuôn
      // carAssignedDriverUsername (lib/workflowEngine.js): server tự tra lại tên hiển thị từ
      // appData.users thay vì tin nguyên "instructor" client tự gửi kèm, tránh lệch 2 trường. Để trống
      // (không gán giảng viên) là hợp lệ — lớp đó chỉ trainingManage quản lý được.
      const instructorUser = resolveTrainingInstructorUsername(payload.instructorUsername, appData?.users);
      payload.instructorUsername = instructorUser ? instructorUser.username : null;
      payload.instructor = instructorUser ? instructorUser.name : (payload.instructor ? String(payload.instructor).trim() : '');

      // Danh Sách Được Mời (tuỳ chọn, Đợt 3) — rỗng/không set = KHÔNG giới hạn, mở tự do cho mọi người
      // tự đăng ký (mặc định giữ nguyên hành vi mọi lớp đã có từ trước tính năng này) — xem enforce ở
      // trainingRegistrations.extraValidate bên dưới. Bulk-add của HR (bulkRegisterTrainingClass()) HOÀN
      // TOÀN không bị ảnh hưởng bởi danh sách này (là 1 quyền ghi đè riêng, xem baseline).
      payload.inviteList = normalizeInviteList(payload.inviteList);

      // Vòng đời trạng thái buổi học (Đợt 3) — KHÁC hẳn "status" ở trên (status = còn mở/đóng ĐĂNG KÝ,
      // sessionState = buổi học đã bắt đầu/kết thúc chưa, 2 khái niệm trực giao, không đụng vào nhau).
      // ONLINE tính sống theo giờ hệ thống ngay lúc hiển thị (không lưu — xem
      // getTrainingClassSessionState() ở index.html, cùng tinh thần pinExpiresAt/publishAt có sẵn) nên
      // để null ở đây. OFFLINE cần chuyển tay qua nút Bắt Đầu Lớp/Kết Thúc Lớp (xem
      // startOfflineTrainingClass()/endOfflineTrainingClass() ở lib/recordActions.js) nên khởi tạo
      // SCHEDULED.
      payload.sessionState = payload.mode === 'OFFLINE' ? 'SCHEDULED' : null;
    }
  },
  // Ngân Hàng Câu Hỏi — bài test tạo ĐỘC LẬP với lớp học (tạo trước, gán vào lớp sau qua
  // trainingClasses.testId ở trên), 1 bài test có thể dùng lại cho nhiều lớp khác nhau. Chấm điểm tự
  // động (xem gradeTrainingTestSubmission(), lib/recordActions.js) nên đáp án đúng PHẢI được chốt lại ở
  // server tại đây, không tin nguyên payload câu hỏi/đáp án đúng client tự gửi ngoài nội dung text.
  trainingTests: {
    dbKey: 'trainingTests',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user) => {
      if (!user.perms?.admin && !user.perms?.trainingManage) {
        throw new CreateError(403, 'Bạn không có quyền tạo bài test');
      }
      if (!payload.title || !String(payload.title).trim()) throw new CreateError(400, 'Thiếu tên bài test');
      const rawQuestions = Array.isArray(payload.questions) ? payload.questions : [];
      if (!rawQuestions.length) throw new CreateError(400, 'Bài test cần ít nhất 1 câu hỏi');
      if (rawQuestions.length > 100) throw new CreateError(400, 'Bài test tối đa 100 câu hỏi');
      const questions = rawQuestions.map((q, i) => {
        const text = String(q?.text || '').trim();
        if (!text) throw new CreateError(400, `Câu hỏi số ${i + 1} thiếu nội dung`);
        const type = q?.type === 'MULTI' ? 'MULTI' : 'SINGLE';
        const optionTexts = Array.isArray(q?.options) ? q.options.map(o => String(o?.text ?? o ?? '').trim()).filter(Boolean) : [];
        if (optionTexts.length < 2) throw new CreateError(400, `Câu hỏi số ${i + 1} cần ít nhất 2 đáp án`);
        if (optionTexts.length > 10) throw new CreateError(400, `Câu hỏi số ${i + 1} tối đa 10 đáp án`);
        const options = optionTexts.map((t, oi) => ({ id: oi + 1, text: t }));
        const correctOptionIds = Array.isArray(q?.correctOptionIds)
          ? [...new Set(q.correctOptionIds.map(Number))].filter(id => options.some(o => o.id === id))
          : [];
        if (!correctOptionIds.length) throw new CreateError(400, `Câu hỏi số ${i + 1} chưa chọn đáp án đúng`);
        if (type === 'SINGLE' && correctOptionIds.length > 1) {
          throw new CreateError(400, `Câu hỏi số ${i + 1} là loại 1 đáp án đúng nhưng lại chọn nhiều hơn 1`);
        }
        const points = Number(q?.points) > 0 ? Number(q.points) : 1;
        // imageUrl (tuỳ chọn, ảnh minh hoạ câu hỏi — VD hình sơ đồ/biểu mẫu cần nhận diện) — CÙNG lỗ hổng
        // stored-XSS scheme "javascript:" như mọi field URL tệp khác trong file này nếu KHÔNG xác minh:
        // trainingManage tự soạn payload gọi thẳng route tạo có thể gài imageUrl bất kỳ, hiển thị lại
        // thành <img src="..."> ở màn Test Builder/lúc học viên làm bài (ttTakeRenderQuestion(), client).
        // assertUploadedFileUrl() chỉ chấp nhận đúng khuôn "/uploads/<tên-file>" do routes/upload.js sinh
        // ra, KHÔNG chấp nhận URL ngoài hệ thống hay scheme javascript:/data: — mirror y hệt cách mọi
        // field file khác (fileUrl của trainingDocuments, licenses...) đã được vá ở đầu file này.
        const imageUrl = q?.imageUrl ? String(q.imageUrl).trim() : '';
        assertUploadedFileUrl(imageUrl, `Ảnh câu hỏi số ${i + 1}`);
        return { id: i + 1, text, type, options, correctOptionIds, points, imageUrl };
      });
      payload.title = String(payload.title).trim();
      payload.category = payload.category ? String(payload.category).trim() : '';
      payload.questions = questions;
      // passScore ở đây CHỈ là gợi ý (autofill) cho ô Điểm Đạt Yêu Cầu khi chọn bài test lúc tạo/sửa
      // lớp học (xem applyTrainingClassTestDefaultPassScore() ở client) — KHÔNG được đọc khi chấm điểm,
      // trainingClasses.passScore vẫn là nguồn quyết định DUY NHẤT (xem gradeTrainingTestSubmission()).
      const suggestedPassScore = Number(payload.passScore);
      payload.passScore = Number.isFinite(suggestedPassScore) && suggestedPassScore > 0 && suggestedPassScore <= 100
        ? suggestedPassScore : null;
    }
  },
  // Chương Trình (trainingCourses, Đợt 4) — catalog "Chương Trình" TÁI SỬ DỤNG được cho nhiều LỚP HỌC
  // khác nhau (trainingClasses.courseId, tuỳ chọn — xem extraValidate ở trên) và TÀI LIỆU
  // (trainingDocuments.courseId, tuỳ chọn — xem extraValidate ở trên), tách biệt với "title" của từng
  // lớp cụ thể (title vẫn là tên hiển thị riêng của LẦN CHẠY lớp đó, KHÔNG bị thay thế). Quản lý (tạo/
  // xoá) CHỈ trainingManage — đây là danh mục hệ thống dùng chung (systemwide catalog config), khác
  // trainingClasses/trainingTests (cũng trainingManage-only để TẠO nhưng trainingInstruct quản lý được
  // roster/kết quả SAU khi tạo): trainingInstruct KHÔNG có lý do quản lý catalog này, chỉ cần ĐỌC danh
  // sách khi tạo/sửa đúng lớp mình được gán (không gác gì thêm ở đây vì đọc dữ liệu qua GET /api/data
  // chung, không qua route tạo/xoá này).
  trainingCourses: {
    dbKey: 'trainingCourses',
    forceOwnDept: true, // không có khái niệm phòng ban riêng (danh mục dùng chung toàn công ty, giống trainingDocuments/trainingClasses)
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user) => {
      if (!user.perms?.admin && !user.perms?.trainingManage) {
        throw new CreateError(403, 'Bạn không có quyền tạo chương trình đào tạo');
      }
      if (!payload.name || !String(payload.name).trim()) throw new CreateError(400, 'Thiếu tên chương trình');
      if (!payload.category || !String(payload.category).trim()) throw new CreateError(400, 'Thiếu loại đào tạo');
      payload.name = String(payload.name).trim();
      payload.category = String(payload.category).trim();
      payload.description = payload.description ? String(payload.description).trim() : '';
    }
  },
  // Kế Hoạch Đào Tạo (trainingPlans, Đợt 5) — hồ sơ "Tháng X dự kiến mở bao nhiêu lớp/học viên/giờ" do
  // trainingManage lập TRƯỚC, đối chiếu với trainingClasses/trainingRegistrations THẬT phát sinh trong
  // đúng tháng đó (tính SỐNG ở client, xem index.html renderTrainingPlanDashboard() — KHÔNG lưu số thực
  // tế vào đây) để ra % hoàn thành. Đây là danh mục dùng chung toàn công ty do HR/Đào Tạo lập kế hoạch,
  // KHÔNG phải hồ sơ "thay mặt phòng ban mình tạo" — forceOwnDept:true chỉ để field "dept" (ai LẬP kế
  // hoạch) có giá trị hợp lệ theo đúng cơ chế chung (validateAndPrepareCreate() LUÔN ép dept = user.dept
  // khi forceOwnDept, xem cuối file), giống hệt trainingCourses/trainingClasses ở trên — KHÔNG liên quan
  // gì tới "targetDept" (đơn vị mà kế hoạch này NHẮM TỚI, người lập tự chọn) bên dưới. Cố tình đặt tên
  // "targetDept" thay vì tái dùng "dept" cho ý nghĩa này — dùng lại "dept" sẽ bị validateAndPrepareCreate()
  // ghi đè mất giá trị người lập chọn, ép về phòng ban CỦA NGƯỜI LẬP KẾ HOẠCH thay vì đơn vị họ chọn nhắm
  // tới (cùng cái bẫy đã gặp ở recruitmentJobs.hiringDept — xem giải thích đầy đủ ở đó).
  trainingPlans: {
    dbKey: 'trainingPlans',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user, appData) => {
      if (!user.perms?.admin && !user.perms?.trainingManage) {
        throw new CreateError(403, 'Bạn không có quyền lập kế hoạch đào tạo');
      }
      normalizeTrainingPlanFields(payload, appData);
    }
  },
  // Đào Tạo Tân Binh (Đợt 8 — đổi Giai đoạn 1/2 sang cùng khuôn Lộ Trình Thăng Tiến) — "Lộ Trình"
  // (onboardingPaths) là 1 catalog TÁI SỬ DỤNG được cho nhiều nhân viên mới khác nhau (tạo 1 lần, gán lại
  // nhiều lần qua onboardingProgress.pathId bên dưới) — KHÔNG phải hồ sơ theo từng nhân viên. Giai đoạn
  // 1/2 mỗi giai đoạn chọn 1+ CHƯƠNG TRÌNH HỌC bắt buộc (stage1RequiredCourseIds/stage2RequiredCourseIds
  // — trỏ vào trainingCourses, giống hệt careerPaths.stages[].requiredCourseIds): nhân viên phải tự đăng
  // ký + học lớp thuộc đúng chương trình đó, lớp BẮT BUỘC có gán bài test (setTrainingRegistrationResult()
  // ở lib/recordActions.js chặn chấm tay khi lớp có test) nên "Đạt" chỉ đến từ tự làm bài + tự động chấm.
  // Giai đoạn 3 KHÔNG đổi — vẫn là tiêu chí đánh giá dạng văn bản tự do (stage3Criteria) để quản lý trực
  // tiếp (onboardingEvaluate) chấm cảm quan, không gắn chương trình/bài test nào. Quản lý (tạo/sửa/xoá)
  // CHỈ trainingManage — cùng tinh thần "danh mục dùng chung toàn công ty" như trainingCourses/trainingPlans.
  onboardingPaths: {
    dbKey: 'onboardingPaths',
    forceOwnDept: true, // không có khái niệm phòng ban riêng (danh mục dùng chung toàn công ty)
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user, appData) => {
      if (!user.perms?.admin && !user.perms?.trainingManage) {
        throw new CreateError(403, 'Bạn không có quyền tạo lộ trình đào tạo tân binh');
      }
      normalizeOnboardingPathFields(payload, appData);
    }
  },
  // "Phân Công" (onboardingProgress) — 1 dòng = 1 nhân viên ĐƯỢC GÁN 1 onboardingPaths cụ thể, theo dõi
  // tiến độ 3 giai đoạn. startDate CHỤP LẠI (snapshot) từ hồ sơ user NGAY LÚC PHÂN CÔNG — cố tình KHÔNG
  // đọc sống lại user.startDate mỗi lần tính hạn (khác kiểu "tính sống" của trainingPlans actual ở
  // trên): nếu admin sửa lại startDate trên hồ sơ nhân viên sau khi đã phân công (vd sửa lỗi nhập liệu
  // của người KHÁC), 1 onboardingProgress đang chạy dở không bị dịch chuyển hạn 1/2/3 theo, tránh xáo
  // trộn 1 lộ trình đang được nhân viên/quản lý theo dõi giữa chừng. Phân công (tạo dòng) CHỈ
  // trainingManage — nhân viên/quản lý Giai đoạn 3 không tự tạo được, chỉ tương tác qua các action riêng
  // (confirmOnboardingStage/evaluateOnboardingStage3/issueOnboardingCertificate, lib/recordActions.js).
  onboardingProgress: {
    dbKey: 'onboardingProgress',
    forceOwnDept: true, // không có khái niệm phòng ban riêng ở CHÍNH hồ sơ phân công này (dept của NGƯỜI PHÂN CÔNG, chỉ metadata)
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    getLockKey: (payload, user) => `onboarding_progress:${payload?.employeeUsername}:${payload?.pathId}`,
    extraValidate: (payload, collection, user, appData) => {
      if (!user.perms?.admin && !user.perms?.trainingManage) {
        throw new CreateError(403, 'Bạn không có quyền phân công lộ trình đào tạo tân binh');
      }
      const employeeUsername = String(payload.employeeUsername || '').trim();
      if (!employeeUsername) throw new CreateError(400, 'Thiếu nhân viên cần phân công');
      const employee = (appData?.users || []).find(u => u.username === employeeUsername);
      if (!employee) throw new CreateError(404, 'Không tìm thấy tài khoản nhân viên này');
      // Tiền đề bắt buộc — không tính được hạn Giai đoạn 1/2/3 nếu thiếu mốc ngày vào làm (xem baseline:
      // startDate không tồn tại trên hồ sơ user trước Đợt 6, thêm mới ở form Quản Lý Người Dùng).
      if (!employee.startDate) {
        throw new CreateError(400, `Nhân viên "${employee.name}" chưa có Ngày Vào Làm Việc — vui lòng cập nhật hồ sơ nhân viên này ở Quản Lý Người Dùng trước khi phân công lộ trình đào tạo tân binh`);
      }
      const pathId = Number(payload.pathId);
      const path = Number.isFinite(pathId) ? (appData?.onboardingPaths || []).find(p => p.id === pathId) : null;
      if (!path) throw new CreateError(400, 'Lộ trình đào tạo tân binh được chọn không hợp lệ');
      // 1 nhân viên chỉ được phân công 1 lần cho ĐÚNG 1 lộ trình — cho phép nhiều LỘ TRÌNH KHÁC NHAU
      // cùng lúc (không chặn), cố tình dễ dãi đúng như baseline yêu cầu ("permissive, not a hard business
      // rule to over-engineer"). Race 2 request phân công cùng cặp (employeeUsername, pathId) cùng lúc
      // được chặn thêm ở tầng CSDL bằng getLockKey ở trên.
      const dup = (collection || []).some(p => p.employeeUsername === employeeUsername && p.pathId === pathId);
      if (dup) throw new CreateError(409, `Nhân viên "${employee.name}" đã được phân công lộ trình "${path.name}" từ trước rồi`);
      payload.employeeUsername = employeeUsername;
      payload.employeeName = employee.name;
      payload.pathId = pathId;
      payload.pathName = path.name;
      payload.startDate = employee.startDate; // snapshot — xem giải thích ở comment đầu config này
      payload.stage1Result = null; payload.stage1ConfirmedBy = null; payload.stage1ConfirmedByName = null; payload.stage1ConfirmedAt = null;
      payload.stage2Result = null; payload.stage2ConfirmedBy = null; payload.stage2ConfirmedByName = null; payload.stage2ConfirmedAt = null;
      payload.stage3Evaluation = null; payload.stage3EvaluatedBy = null; payload.stage3EvaluatedByName = null; payload.stage3EvaluatedAt = null; payload.stage3Note = '';
      payload.certificateIssued = false; payload.certificateIssuedAt = null; payload.certificateIssuedBy = null;
    }
  },
  // Đăng ký lớp học — khớp đúng khuôn vppRegistrations (khoá theo cặp lớp+người để chặn race 2 request
  // đăng ký cùng lúc), chỉ khác: cho phép đăng ký lại sau khi tự HUỶ (result='CANCELLED', không phải chỉ
  // REJECTED) — huỷ ở đây do chính người đăng ký chủ động (không qua quy trình duyệt nào).
  trainingRegistrations: {
    dbKey: 'trainingRegistrations',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    // Khoá theo LỚP (không phải lớp+người) — tuần tự hoá TOÀN BỘ lượt đăng ký cùng 1 lớp, không chỉ
    // chặn 1 người tự gửi trùng. Trước đây khoá theo cặp lớp+người: 2 người KHÁC NHAU cùng bấm đăng ký
    // vào chỗ trống cuối cùng gần như đồng thời đều đọc activeRegs.length < capacity trước khi bên nào
    // kịp ghi, cả 2 đều tạo thành công, lớp vượt sĩ số.
    getLockKey: (payload) => `training_registration:${payload.classId}`,
    extraValidate: (payload, collection, user, appData) => {
      const classId = Number(payload.classId);
      if (!Number.isFinite(classId)) throw new CreateError(400, 'Thiếu lớp học');
      const classes = appData?.trainingClasses || [];
      const cls = classes.find(c => c.id === classId);
      if (!cls) throw new CreateError(404, 'Không tìm thấy lớp học');
      if (cls.status !== 'OPEN') throw new CreateError(409, 'Lớp học này đã đóng đăng ký');
      const todayStr = new Date().toISOString().slice(0, 10);
      if (cls.registerDeadline && todayStr > cls.registerDeadline) {
        throw new CreateError(409, 'Đã hết hạn đăng ký lớp học này');
      }
      const activeRegs = (collection || []).filter(r => r.classId === classId && r.result !== 'CANCELLED');
      if (cls.capacity > 0 && activeRegs.length >= cls.capacity) {
        throw new CreateError(409, 'Lớp học đã đủ số lượng đăng ký');
      }
      if (activeRegs.some(r => r.creator === user.username)) {
        throw new CreateError(409, 'Bạn đã đăng ký lớp học này rồi');
      }
      // Danh Sách Được Mời (Đợt 3) — rỗng/không set = mở cho mọi người (mặc định, giữ hành vi cũ);
      // có danh sách -> CHỈ người trong đó được tự đăng ký. KHÔNG áp dụng cho admin/trainingManage tự
      // đăng ký hộ ai (trường hợp hiếm) và hoàn toàn không đụng tới bulkRegisterTrainingClass() (nhân sự
      // luôn ghi đè trực tiếp được, xem lib/recordActions.js).
      const inviteList = Array.isArray(cls.inviteList) ? cls.inviteList : [];
      if (inviteList.length && !inviteList.includes(user.username) && !user.perms?.admin) {
        throw new CreateError(403, 'Lớp học này giới hạn theo danh sách mời — bạn không có trong danh sách');
      }
      // Chốt lại theo đúng dữ liệu lớp học tại thời điểm đăng ký (snapshot) — không tin tên/mã lớp
      // client tự gửi.
      payload.className = cls.title;
      payload.classCode = cls.code;
      payload.category = cls.category;
      payload.classCreator = cls.creator;
      payload.result = 'REGISTERED';
      payload.score = null;
      payload.resultNote = '';
      payload.resultBy = null;
      payload.resultByName = null;
      payload.resultAt = null;
      // Đợt 9 — yêu cầu huỷ (do chính học viên gửi) phải chờ trainingManage/admin duyệt trước khi có
      // hiệu lực (xem cancelTrainingRegistration()/approveCancelTrainingRegistration(),
      // lib/recordActions.js); tài liệu giáo trình bắt buộc (cls.documentIds, chỉ áp dụng lớp ONLINE) học
      // viên tự đánh dấu đã xem từng cái qua markTrainingDocumentViewed() — bắt buộc xem hết mới được thi.
      payload.pendingCancellation = null;
      payload.viewedDocumentIds = [];
    }
  },
  // Lộ trình thăng tiến (Đợt 7) — GỒM NHIỀU CẤP BẬC TUẦN TỰ (payload.stages, thứ tự trong mảng CHÍNH LÀ
  // thứ tự cấp bậc, index 0 = cấp đầu tiên), mỗi cấp có 1 danh sách CHƯƠNG TRÌNH (trainingCourses,
  // requiredCourseIds) bắt buộc phải PASSED hết mới đủ điều kiện "Xác nhận" cấp đó (xem
  // confirmCareerPathForEmployee(), lib/recordActions.js — có thêm gác tuần tự: chỉ xác nhận được cấp N
  // khi cấp N-1 đã được xác nhận). ĐÃ ĐỔI từ requiredClassIds phẳng (trỏ thẳng vào 1 LẦN CHẠY lớp cụ
  // thể) sang requiredCourseIds theo TỪNG CẤP (trỏ vào chương trình tái sử dụng được, giống
  // trainingClasses/trainingDocuments/trainingPlans — Đạt BẤT KỲ lớp nào thuộc chương trình đó là tính,
  // xem confirmCareerPathForEmployee()) — thay đổi phá vỡ khả năng tương thích có chủ đích, KHÔNG có bản
  // ghi thật nào cần di trú (collection này chưa từng phát hành cho người dùng thật).
  careerPaths: {
    dbKey: 'careerPaths',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user, appData) => {
      if (!user.perms?.admin && !user.perms?.trainingManage) {
        throw new CreateError(403, 'Bạn không có quyền tạo lộ trình thăng tiến');
      }
      if (!payload.name || !String(payload.name).trim()) throw new CreateError(400, 'Thiếu tên lộ trình thăng tiến');
      payload.name = String(payload.name).trim();
      const courses = appData?.trainingCourses || [];
      const rawStages = Array.isArray(payload.stages) ? payload.stages : [];
      if (!rawStages.length) throw new CreateError(400, 'Vui lòng thêm ít nhất 1 cấp bậc cho lộ trình thăng tiến');
      payload.stages = rawStages.map((s, i) => {
        const name = String(s?.name || '').trim();
        if (!name) throw new CreateError(400, `Cấp bậc thứ ${i + 1} thiếu tên`);
        const requiredCourseIds = Array.isArray(s?.requiredCourseIds)
          ? [...new Set(s.requiredCourseIds.map(Number))].filter(Number.isFinite) : [];
        if (!requiredCourseIds.length) throw new CreateError(400, `Cấp bậc "${name}" cần chọn ít nhất 1 chương trình bắt buộc`);
        const invalid = requiredCourseIds.filter(id => !courses.some(c => c.id === id));
        if (invalid.length) throw new CreateError(400, `Cấp bậc "${name}" có chương trình được chọn không hợp lệ`);
        return { name, requiredCourseIds };
      });
      delete payload.requiredClassIds; // field cũ đã bỏ hẳn, không giữ tương thích ngược
    }
  },
  // Tuyển Dụng — thay thế mục "Khen Thưởng" cũ (chỉ là 1 loại bài đăng đơn giản trong internalPosts,
  // không đủ để mô hình hoá tin tuyển dụng + hồ sơ ứng viên). Dùng cờ quyền internalRecruitmentCreate
  // (đổi tên từ internalRewardCreate cũ, tự động migrate — xem public/index.html normalizeUserPermissions)
  // riêng cho việc ĐĂNG tin — GIỚI THIỆU ứng viên (recruitmentReferrals bên dưới) thì bất kỳ ai đã đăng
  // nhập đều làm được, không cần quyền riêng, đúng tinh thần "giới thiệu nội bộ".
  recruitmentJobs: {
    dbKey: 'recruitmentJobs',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user, appData) => {
      if (!user.perms?.admin && !user.perms?.internalRecruitmentCreate) {
        throw new CreateError(403, 'Bạn không có quyền đăng tin tuyển dụng');
      }
      if (!payload.title || !String(payload.title).trim()) throw new CreateError(400, 'Thiếu tên vị trí tuyển dụng');
      if (!payload.description || !String(payload.description).trim()) throw new CreateError(400, 'Thiếu mô tả công việc');
      // contactInfo (Đợt 2: Bản Tin Tuyển Dụng) — bắt buộc, cùng khuôn description/requirements ở trên,
      // vì tin đăng công khai luôn cần hiển thị được đầu mối liên hệ ứng viên (không tự suy ra được từ
      // creator, vì HR có thể muốn để SĐT/email chung của bộ phận thay vì cá nhân người đăng tin).
      if (!payload.contactInfo || !String(payload.contactInfo).trim()) throw new CreateError(400, 'Thiếu thông tin liên hệ');
      payload.title = String(payload.title).trim();
      payload.description = String(payload.description).trim();
      payload.requirements = payload.requirements ? String(payload.requirements).trim() : '';
      payload.location = payload.location ? String(payload.location).trim() : '';
      payload.contactInfo = String(payload.contactInfo).trim();
      payload.slots = Number(payload.slots) > 0 ? Math.floor(Number(payload.slots)) : 0;
      payload.deadline = payload.deadline || '';
      // Đợt (Tháng) — chuỗi "yyyy-mm" thẳng từ <input type=month>, không có bảng danh mục riêng (giống
      // cách hệ thống lưu các trường ngày/tháng dạng input khác, vd trainingClasses.registerDeadline).
      payload.month = payload.month ? String(payload.month).trim() : '';
      // Đơn vị/Siêu thị ĐĂNG TUYỂN — cố tình đặt tên KHÁC "dept" (đối chiếu DB.depts + DB.stores gộp
      // chung 1 danh sách, cùng cách rjDept/rjFilterDept gộp ở client): field "dept" trên MỌI collection
      // forceOwnDept:true (kể cả recruitmentJobs) luôn bị validateAndPrepareCreate() ép về ĐÚNG phòng ban
      // của người tạo (xem cuối file: `{ ...payload, id: Date.now(), dept }`, GHI ĐÈ payload.dept bất kể
      // extraValidate gán gì) — nếu dùng lại "dept" cho ý nghĩa "đơn vị đăng tuyển" thì giá trị người
      // đăng chọn sẽ luôn bị mất, thay bằng phòng ban CỦA NGƯỜI ĐĂNG TIN. KHÔNG bắt buộc nếu rỗng (một số
      // tin có thể đăng chung cho toàn công ty, không gắn 1 đơn vị cụ thể).
      const hiringDept = payload.hiringDept ? String(payload.hiringDept).trim() : '';
      if (hiringDept) {
        const validDepts = new Set([...(appData?.depts || []), ...(appData?.stores || [])]);
        if (!validDepts.has(hiringDept)) throw new CreateError(400, `Đơn vị/Siêu thị không hợp lệ: ${hiringDept}`);
      }
      payload.hiringDept = hiringDept;
      // Banner (tuỳ chọn) — client đã upload qua uploadFileToServer('internal') trước khi gửi payload
      // (cùng khuôn cvFileUrl/cvFileName của recruitmentReferrals bên dưới), ở đây chỉ nhận lại URL/tên.
      payload.bannerUrl = payload.bannerUrl ? String(payload.bannerUrl).trim() : '';
      // Banner được render ra `<img src="${escapeHtml(bannerUrl)}">` ở tin đăng công khai — cùng lỗ hổng
      // scheme "javascript:" như attachment của internalPosts, xem assertUploadedFileUrl().
      assertUploadedFileUrl(payload.bannerUrl, 'Ảnh banner tin tuyển dụng');
      payload.bannerFileName = payload.bannerFileName ? String(payload.bannerFileName).trim() : '';
      payload.status = 'OPEN';
      payload.filledBy = null;
      payload.filledByName = null;
      payload.filledAt = null;
    }
  },
  // Hồ sơ giới thiệu ứng viên — snapshot jobTitle từ tin tuyển dụng tại thời điểm giới thiệu (không tin
  // client tự gửi, cùng khuôn trainingRegistrations snapshot className/classCode ở trên) — chỉ nhận giới
  // thiệu vào tin còn OPEN. Người giới thiệu (creatorField) LUÔN là chính người đang đăng nhập, không
  // cho nhập tay ai khác — khớp yêu cầu nghiệp vụ "để lại thông tin người giới thiệu" (dùng để đối chiếu
  // thưởng giới thiệu về sau nếu công ty có chính sách này), tránh mạo danh giới thiệu hộ người khác.
  recruitmentReferrals: {
    dbKey: 'recruitmentReferrals',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'referrerUsername', creatorNameField: 'referrerName',
    extraValidate: (payload, collection, user, appData) => {
      const jobId = Number(payload.jobId);
      if (!Number.isFinite(jobId)) throw new CreateError(400, 'Thiếu tin tuyển dụng');
      const jobs = appData?.recruitmentJobs || [];
      const job = jobs.find(j => j.id === jobId);
      if (!job) throw new CreateError(404, 'Không tìm thấy tin tuyển dụng');
      if (job.status !== 'OPEN') throw new CreateError(409, 'Tin tuyển dụng này đã đóng, không nhận thêm giới thiệu');
      // Tin có ghi "Hạn nộp" hiển thị cho nhân viên (public/index.html) nhưng trước đây không có gì tự
      // đóng tin theo hạn đó — quá hạn tin vẫn OPEN, giới thiệu vẫn được nhận dù hiển thị "đã hết hạn".
      const todayStr = new Date().toISOString().slice(0, 10);
      if (job.deadline && todayStr > job.deadline) {
        throw new CreateError(409, 'Tin tuyển dụng này đã hết hạn giới thiệu');
      }

      const candidateName = String(payload.candidateName || '').trim();
      const candidatePhone = String(payload.candidatePhone || '').trim();
      if (!candidateName) throw new CreateError(400, 'Thiếu tên ứng viên');
      if (!candidatePhone) throw new CreateError(400, 'Thiếu số điện thoại ứng viên');
      if (!payload.cvFileUrl) throw new CreateError(400, 'Vui lòng tải lên CV của ứng viên');
      // CV là tệp mà bộ phận tuyển dụng BẮT BUỘC phải bấm mở để xét — cùng lỗ hổng scheme "javascript:"
      // như attachment/bannerUrl ở trên, xem assertUploadedFileUrl().
      assertUploadedFileUrl(payload.cvFileUrl, 'Tệp CV ứng viên');

      payload.jobId = jobId;
      payload.jobTitle = job.title;
      payload.candidateName = candidateName;
      payload.candidatePhone = candidatePhone;
      payload.candidateEmail = payload.candidateEmail ? String(payload.candidateEmail).trim() : '';
      payload.candidateNote = payload.candidateNote ? String(payload.candidateNote).trim() : '';
      payload.status = 'NEW';
      payload.statusNote = '';
      payload.statusBy = null;
      payload.statusByName = null;
      payload.statusAt = null;
    }
  },
  // ===== ĐỒNG PHỤC (module con của Hành Chính) =====
  // "Kỳ Cấp Phát Đồng Phục" — mỗi lần Hành Chính (uniformManage) phân bổ 1 lô đồng phục xuống 1 hoặc
  // nhiều siêu thị là 1 kỳ MỚI (không có khái niệm mở/đóng theo thời gian như kỳ VPP — kỳ ở đây chỉ là
  // nhãn theo dõi 1 lô, "có thể cấp tiếp" bằng cách tạo kỳ khác, không sửa lại kỳ cũ). `allocations` lồng
  // ngay trong kỳ (mảng nhỏ, mỗi phần tử = 1 siêu thị) — Giám Đốc Siêu Thị (uniformStoreManage) tự xác
  // nhận ĐÚNG phần tử của phòng ban mình qua confirmUniformAllocation() ở lib/recordActions.js, khoá theo
  // đúng bản ghi kỳ (withLockedRecordForCollection) như mọi nơi khác trong hệ thống — vài giám đốc khác
  // siêu thị xác nhận gần như đồng thời trên CÙNG 1 kỳ chỉ đơn thuần xếp hàng chờ khoá, không mất dữ liệu.
  uniformPeriods: {
    dbKey: 'uniformPeriods',
    forceOwnDept: true, // dept chỉ để hiển thị "phòng ban của người tạo kỳ" (Hành Chính), không phải phạm vi
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user, appData) => {
      if (!user.perms?.admin && !user.perms?.uniformManage) {
        throw new CreateError(403, 'Bạn không có quyền tạo kỳ cấp phát đồng phục');
      }
      if (!payload.name || !String(payload.name).trim()) throw new CreateError(400, 'Thiếu tên kỳ cấp phát');
      payload.name = String(payload.name).trim().slice(0, 200);
      payload.note = (payload.note || '').trim().slice(0, 1000);

      // Đối chiếu với Danh Mục Siêu Thị (DB.stores) — TÁCH RIÊNG khỏi DB.depts (xem defaults.js), vì
      // module này vốn chỉ dùng cho siêu thị chứ không phải phòng ban khối văn phòng.
      const validStores = new Set(appData?.stores || []);
      const rawAllocations = Array.isArray(payload.allocations) ? payload.allocations : [];
      if (!rawAllocations.length) throw new CreateError(400, 'Vui lòng phân bổ cho ít nhất 1 siêu thị');
      const allocations = [];
      for (const raw of rawAllocations) {
        const dept = String(raw?.dept || '').trim();
        if (!dept) continue;
        if (!validStores.has(dept)) throw new CreateError(400, `Siêu thị không hợp lệ: ${dept}`);
        const items = sanitizeUniformItems(raw?.items, appData?.uniformCatalog);
        allocations.push({
          id: Date.now() + allocations.length,
          dept, deptName: dept,
          items,
          status: 'PENDING_CONFIRM',
          confirmedBy: null, confirmedByName: null, confirmedAt: null
        });
      }
      if (!allocations.length) throw new CreateError(400, 'Vui lòng phân bổ cho ít nhất 1 siêu thị với danh mục hợp lệ');
      if (allocations.length > 100) throw new CreateError(400, 'Quá nhiều siêu thị trong 1 kỳ (tối đa 100)');
      payload.allocations = allocations;
      // Cổng duyệt Ở CẤP KỲ (Phase 2, MỚI) — người có quyền uniformApprove/admin duyệt/từ chối cả kỳ
      // 1 lần (xem approveUniformPeriod()/rejectUniformPeriod() ở lib/recordActions.js) TRƯỚC KHI Giám
      // Đốc Siêu Thị bắt đầu tự xác nhận từng phần phân bổ của mình (confirmUniformAllocation() vẫn giữ
      // nguyên state machine PENDING_CONFIRM/CONFIRMED cũ, chỉ bị CHẶN THÊM nếu approvalStatus chưa
      // APPROVED).
      payload.approvalStatus = 'PENDING_APPROVAL';
      payload.approvedBy = null;
      payload.approvedByName = null;
      payload.approvedAt = null;
      payload.rejectReason = '';
    }
  },
  // ===== NGÂN SÁCH (module con "Tổng Hợp") =====
  // Mỗi mẫu ngân sách là 1 danh sách CỘT ĐẦY ĐỦ, admin tự chọn/sắp xếp từ đầu — không phải kiểu "chỉ
  // thêm cột bổ sung vào cột cũ ẩn sẵn" như trước. Tên Hạng Mục/Số Tiền/Loại NS bắt buộc có mặt ở mọi
  // mẫu (đảm bảo Tổng Hợp Ngân Sách luôn cộng dồn được theo amount/budgetType dù đơn vị dùng mẫu khác
  // nhau); Mô Tả Chi Tiết tuỳ chọn; ngoài ra thêm bao nhiêu cột tuỳ biến cũng được — xem
  // sanitizeBudgetCustomFields()/BUDGET_CORE_FIELD_DEFS bên dưới.
  budgetTemplates: {
    dbKey: 'budgetTemplates',
    forceOwnDept: true, // không có khái niệm phòng ban (dùng chung toàn công ty)
    getScope: () => ({ all: true }),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user) => {
      if (!user.perms?.admin && !user.perms?.budgetManage) {
        throw new CreateError(403, 'Chỉ người có quyền quản lý Ngân Sách mới được tạo mẫu ngân sách');
      }
      if (!payload.name || !String(payload.name).trim()) throw new CreateError(400, 'Thiếu tên mẫu ngân sách');
      payload.name = String(payload.name).trim().slice(0, 150);
      payload.fields = sanitizeBudgetCustomFields(payload.fields);
    }
  },
  budgetPeriods: {
    dbKey: 'budgetPeriods',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user, appData) => {
      if (!user.perms?.admin && !user.perms?.budgetManage) {
        throw new CreateError(403, 'Chỉ người có quyền quản lý Ngân Sách mới được tạo kỳ ngân sách');
      }
      if (!payload.name || !String(payload.name).trim()) throw new CreateError(400, 'Thiếu tên kỳ ngân sách');
      payload.name = String(payload.name).trim().slice(0, 200);
      if (!payload.endTime) throw new CreateError(400, 'Thiếu hạn chót lập ngân sách');
      if (new Date(payload.endTime).getTime() <= Date.now()) {
        throw new CreateError(400, 'Hạn chót lập ngân sách phải ở trong tương lai');
      }
      const deptScope = payload.deptScope || {};
      const cleanedDepts = Array.isArray(deptScope.depts) ? deptScope.depts.filter(d => typeof d === 'string' && d.trim()) : [];
      if (!deptScope.all && !cleanedDepts.length) {
        throw new CreateError(400, 'Vui lòng chọn ít nhất 1 phòng ban áp dụng, hoặc chọn "Tất cả phòng ban"');
      }
      payload.deptScope = { all: !!deptScope.all, depts: deptScope.all ? [] : cleanedDepts };
      // Mẫu ngân sách là TUỲ CHỌN (khác reportPeriods.slideTemplateId bắt buộc) — không chọn thì mọi
      // dòng ngân sách của kỳ chỉ dùng 5 cột lõi mặc định.
      const templates = appData?.budgetTemplates || [];
      const templateId = payload.templateId ? Number(payload.templateId) : null;
      if (templateId !== null && (!Number.isFinite(templateId) || !templates.some(t => t.id === templateId))) {
        throw new CreateError(400, 'Mẫu ngân sách đã chọn không tồn tại');
      }
      payload.templateId = templateId;
      payload.status = 'OPEN';
      payload.closeHistory = [];
    }
  },
  budgetEntries: {
    dbKey: 'budgetEntries',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    // "1 bản ngân sách/PHÒNG BAN/kỳ/LOẠI" (kiểm tra "duplicate" ở extraValidate bên dưới) là điều kiện
    // trùng lặp GIỮA NHIỀU bản ghi — không diễn đạt được bằng UNIQUE INDEX (Collection, Code) như trùng
    // mã, giống hệt lý do vppRegistrations/meetings/trainingRegistrations cần getLockKey ở trên: quét
    // trong bộ nhớ ở extraValidate KHÔNG chặn được 2 request tạo ngân sách CÙNG LÚC cho CÙNG 1 phòng ban
    // ở CÙNG 1 kỳ + CÙNG 1 loại (cả hai đọc collection lúc "chưa có bản nào" trước khi request nào kịp
    // ghi) -> 2 bản ngân sách trùng phòng/kỳ/loại, cả hai cùng đi tiếp vào quy trình duyệt. Khoá theo bộ
    // ba kỳ+phòng ban+entryKind (KHÔNG theo người tạo — nhiều người cùng phòng đều có quyền budgetCreate,
    // xem chú thích ở updateBudgetEntryDraft() trong lib/recordActions.js), khớp đúng bộ cột mà duplicate
    // check dùng — entryKind trong khoá để 1 phòng ban lập được CẢ bản "Ngân Sách Phê Duyệt" (PLAN) LẪN
    // bản "Ngân Sách Thực Hiện" (ACTUAL) trong cùng 1 kỳ mà không đụng khoá của nhau.
    getLockKey: (payload, user) => `budget_entry:${payload.entryKind === 'ACTUAL' ? 'ACTUAL' : 'PLAN'}:${payload.periodId}:${user.dept}`,
    extraValidate: (payload, collection, user, appData) => {
      if (!user.perms?.admin && !user.perms?.budgetCreate) {
        throw new CreateError(403, 'Bạn không có quyền lập ngân sách');
      }
      // entryKind phân biệt 2 luồng dữ liệu độc lập trên CÙNG 1 collection (tái dùng nguyên state machine
      // DRAFT/PENDING/APPROVED/REJECTED + workflowEngine.js duyệt theo phòng ban cho cả 2, xem
      // lib/recordActions.js/lib/workflowEngine.js) — 'PLAN' = "Ngân Sách Phê Duyệt" (đơn vị lập ngân
      // sách trình duyệt), 'ACTUAL' = "Ngân Sách Thực Hiện" (đơn vị ghi nhận chi tiêu thực tế, cũng trình
      // duyệt Trưởng phòng để đảm bảo số liệu đối chiếu ở Tổng Hợp đáng tin). Tab "Tổng Hợp" chỉ cộng dồn
      // bản APPROVED của từng loại — xem renderBudgetSummaryResult() ở public/index.html.
      const entryKind = payload.entryKind === 'ACTUAL' ? 'ACTUAL' : 'PLAN';
      payload.entryKind = entryKind;
      const periodId = Number(payload.periodId);
      if (!Number.isFinite(periodId)) throw new CreateError(400, 'Thiếu kỳ ngân sách');
      const periods = appData?.budgetPeriods || [];
      const period = periods.find(p => p.id === periodId);
      if (!period) throw new CreateError(404, 'Không tìm thấy kỳ ngân sách');
      const scope = period.deptScope || {};
      const deptAllowed = !!scope.all || (Array.isArray(scope.depts) && scope.depts.includes(user.dept));
      if (!deptAllowed) throw new CreateError(403, 'Phòng ban của bạn không thuộc phạm vi kỳ ngân sách này');
      const pastDeadline = !!(period.endTime && Date.now() > new Date(period.endTime).getTime());
      if (period.status !== 'OPEN' || pastDeadline) {
        throw new CreateError(409, 'Kỳ ngân sách này đã kết thúc, không thể lập ngân sách nữa');
      }
      // Mỗi phòng ban CHỈ 1 bản ngân sách / kỳ / loại (khoá theo PHÒNG BAN chứ không theo người tạo —
      // nhiều người cùng phòng có quyền budgetCreate cùng sửa chung 1 bản nháp của đơn vị, xem
      // updateBudgetEntryDraft() ở lib/recordActions.js).
      const duplicate = (collection || []).some(r => r.periodId === periodId && r.dept === user.dept && (r.entryKind === 'ACTUAL' ? 'ACTUAL' : 'PLAN') === entryKind);
      if (duplicate) {
        throw new CreateError(409, entryKind === 'ACTUAL'
          ? 'Phòng ban bạn đã có ngân sách thực hiện ở kỳ này rồi — vui lòng sửa bản nháp hiện có'
          : 'Phòng ban bạn đã có ngân sách phê duyệt ở kỳ này rồi — vui lòng sửa bản nháp hiện có');
      }
      const templates = appData?.budgetTemplates || [];
      const customFields = getBudgetTemplateCustomFields(period.templateId, templates);
      payload.lines = sanitizeBudgetLines(payload.lines, customFields);
      payload.periodName = period.name;
      payload.periodEndTime = period.endTime;
      // status/currentStep/history gán cứng ở server — dòng ngân sách bắt đầu ở NHÁP, người lập tự Gửi
      // (submitBudgetEntry ở lib/recordActions.js) mới chuyển PENDING để lib/workflowEngine.js xử lý
      // bước duyệt Trưởng phòng theo appData.budgetDeptWorkflows[dept] (giống itPriceApprovals) — dùng
      // CHUNG 1 cấu hình duyệt theo phòng ban cho cả 2 entryKind.
      payload.status = 'DRAFT';
      payload.currentStep = 1;
      payload.history = [];
    }
  },
  // "Giấy Phép" (Hành Chính) — quản lý giấy phép kinh doanh/con của công ty theo địa điểm, có versioning
  // giống hệt "Tài Liệu" (docs) NHƯNG duyệt bằng 2 quyền PHẲNG (licenseCreate/licenseApprove), KHÔNG đi
  // qua engine duyệt theo phòng ban (lib/workflowEngine.js) — đúng yêu cầu nghiệp vụ "phân quyền ngay
  // trong module, không dùng quy trình phòng ban, phòng ban khác không truy cập được". forceOwnDept +
  // getScope rỗng (cùng khuôn internalPosts/itPriceApprovals ở trên) để field "dept" chỉ mang tính
  // hiển thị (phòng ban của người tạo), quyền thật nằm ở extraValidate.
  licenses: {
    dbKey: 'licenses',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user) => {
      if (!user.perms?.admin && !user.perms?.licenseCreate) {
        throw new CreateError(403, 'Bạn không có quyền tạo/tải lên giấy phép');
      }
      const requiredStringFields = [
        ['companyName', 'Tên công ty chủ quản'], ['locationName', 'Tên địa điểm'],
        ['licenseType', 'Loại giấy phép'], ['licenseNumber', 'Số giấy phép'],
        ['issuingAuthority', 'Cơ quan cấp phép']
      ];
      for (const [field, label] of requiredStringFields) {
        if (!payload[field] || !String(payload[field]).trim()) throw new CreateError(400, `Vui lòng nhập ${label}`);
        payload[field] = String(payload[field]).trim().slice(0, 300);
      }
      if (!['ACTIVE', 'CLOSED'].includes(payload.operatingStatus)) {
        throw new CreateError(400, 'Tình trạng hoạt động không hợp lệ');
      }
      if (!payload.issueDate) throw new CreateError(400, 'Vui lòng nhập Ngày cấp');
      if (!payload.expiryDate) throw new CreateError(400, 'Vui lòng nhập Ngày hết hạn');
      if (new Date(payload.expiryDate).getTime() < new Date(payload.issueDate).getTime()) {
        throw new CreateError(400, 'Ngày hết hạn phải sau Ngày cấp');
      }
      if (!payload.fileUrl) throw new CreateError(400, 'Vui lòng tải lên tệp giấy phép');
      // Cùng lỗ hổng stored-XSS scheme "javascript:" đã vá ở các module khác — fileUrl chưa từng được
      // xác minh chỉ trỏ về /uploads/... đã tải lên thật.
      assertUploadedFileUrl(payload.fileUrl, 'Tệp giấy phép');

      // Version — nhân bản đúng cơ chế docs.extraValidate ở trên: rootLicenseId null = bản gốc, khác
      // null = version mới cộng thêm vào 1 giấy phép đã có, chặn khi bản mới nhất còn PENDING (chờ
      // duyệt) — REJECTED không chặn (là kết quả cuối, không phải đang xử lý dở).
      if (payload.rootLicenseId != null) {
        const rootId = Number(payload.rootLicenseId);
        const root = (collection || []).find(l => l.id === rootId && l.rootLicenseId == null);
        if (!root) throw new CreateError(400, 'Giấy phép gốc không tồn tại');
        const family = (collection || []).filter(l => l.id === rootId || l.rootLicenseId === rootId)
          .sort((a, b) => (a.versionNumber || 1) - (b.versionNumber || 1));
        const latest = family[family.length - 1];
        if (!latest || latest.status === 'PENDING') {
          throw new CreateError(409, 'Không thể cập nhật khi phiên bản mới nhất của giấy phép này đang chờ duyệt');
        }
        payload.rootLicenseId = rootId;
        payload.displayCode = root.displayCode || root.code;
        payload.versionNumber = (latest.versionNumber || family.length) + 1;
        payload.code = `${payload.displayCode}-V${payload.versionNumber}`;
        if ((collection || []).some(l => l.code === payload.code)) {
          throw new CreateError(409, `Mã "${payload.code}" đã tồn tại`);
        }
      } else {
        payload.versionNumber = 1;
        payload.rootLicenseId = null;
        payload.displayCode = payload.code;
      }

      // status/lifecycleStatus/history/notifiedThresholds PHẢI gán cứng ở server, không tin client.
      payload.status = 'PENDING';
      payload.lifecycleStatus = null;
      payload.notifiedThresholds = [];
      payload.history = [{
        action: 'UPLOADED', by: user.username, byName: user.name, time: new Date().toLocaleString('vi-VN')
      }];
    }
  },
  // "Gia Hạn Dịch Vụ CNTT" (module con của Hỗ Trợ IT, itManage) — danh mục dịch vụ/hợp đồng CNTT cần
  // theo dõi ngày hết hạn để gia hạn (phần mềm/bản quyền, đường truyền Internet, tên miền, chứng chỉ
  // SSL...) — công cụ NỘI BỘ đội IT tự quản lý cho chính mình, KHÔNG qua bước duyệt nào (khác Giấy Phép
  // ở trên vốn là hồ sơ pháp lý cần người khác duyệt) — tạo xong hiệu lực ngay, sửa/gia hạn/xoá qua route
  // riêng (xem lib/recordActions.js + routes/records.js). forceOwnDept + getScope rỗng (cùng khuôn
  // licenses/internalPosts ở trên) vì field "dept" chỉ mang tính hiển thị, quyền thật là itManage phẳng,
  // không theo phòng ban. KHÔNG bắt buộc "code" (khác mọi module khác) — đây là danh mục nội bộ nhỏ,
  // không cần mã tra cứu chính thức, chỉ cần tên dịch vụ là đủ nhận diện.
  itServiceRenewals: {
    dbKey: 'itServiceRenewals',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user) => {
      if (!user.perms?.admin && !user.perms?.itManage) {
        throw new CreateError(403, 'Bạn không có quyền quản lý danh mục gia hạn dịch vụ CNTT');
      }
      const requiredStringFields = [['name', 'Tên dịch vụ'], ['category', 'Loại dịch vụ']];
      for (const [field, label] of requiredStringFields) {
        if (!payload[field] || !String(payload[field]).trim()) throw new CreateError(400, `Vui lòng nhập ${label}`);
        payload[field] = String(payload[field]).trim().slice(0, 200);
      }
      payload.vendor = String(payload.vendor || '').trim().slice(0, 200);
      payload.responsible = String(payload.responsible || '').trim().slice(0, 200);
      payload.note = String(payload.note || '').trim().slice(0, 1000);
      payload.fileUrl = payload.fileUrl ? String(payload.fileUrl).trim().slice(0, 300) : null;
      // Cùng lỗ hổng stored-XSS scheme "javascript:" đã vá ở trainingDocuments/licenses — chỉ cắt độ
      // dài (slice) chưa từng xác minh fileUrl chỉ trỏ về /uploads/... đã tải lên thật.
      assertUploadedFileUrl(payload.fileUrl, 'Tệp đính kèm gia hạn dịch vụ');
      payload.fileName = payload.fileUrl ? String(payload.fileName || '').trim().slice(0, 200) : null;

      const cost = (payload.cost === '' || payload.cost === null || payload.cost === undefined) ? null : Number(payload.cost);
      if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw new CreateError(400, 'Chi phí gia hạn không hợp lệ');
      payload.cost = cost;

      if (!payload.expiryDate) throw new CreateError(400, 'Vui lòng nhập Ngày hết hạn');
      payload.startDate = payload.startDate || null;
      if (payload.startDate && new Date(payload.expiryDate).getTime() < new Date(payload.startDate).getTime()) {
        throw new CreateError(400, 'Ngày hết hạn phải sau Ngày bắt đầu');
      }

      // notifiedThresholds/history PHẢI gán cứng ở server — jobs/itServiceRenewalReminder.js đọc
      // notifiedThresholds để không gửi email nhắc trùng lặp cho cùng 1 mốc ngày (khớp đúng khuôn
      // licenses/contracts ở trên).
      payload.notifiedThresholds = [];
      payload.history = [{
        action: 'CREATED', by: user.username, byName: user.name, time: new Date().toLocaleString('vi-VN')
      }];
    }
  }
};

// Làm sạch danh sách mặt hàng đồng phục (loại/size/số lượng) do client gửi — dùng chung cho cả kỳ cấp
// phát (uniformPeriods.allocations[].items) lẫn cấp phát cho nhân viên (uniformIssuances.items, xem
// buildUniformIssuance() ở lib/recordActions.js) để luôn cùng 1 cấu trúc {name, size, qty}.
// `catalog` (DB.uniformCatalog, dạng [{id, name, sizes:[string]}]) CHỈ truyền vào ở nơi cần chặn theo
// đúng Danh Mục Đồng Phục (hiện chỉ uniformPeriods lúc Hành Chính tạo kỳ cấp phát) — bỏ qua (undefined)
// thì giữ nguyên hành vi cũ, vì buildUniformIssuance() đã có lớp chặn riêng qua tồn kho thực tế của siêu
// thị (không thể cấp món chưa từng được phân bổ/xác nhận, xem computeUniformStock()).
function sanitizeUniformItems(rawItems, catalog) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const catalogMap = Array.isArray(catalog) ? new Map(catalog.map(c => [c.name, c])) : null;
  const cleaned = [];
  for (const it of items) {
    const name = String(it?.name || '').trim();
    const qty = Number(it?.qty);
    if (!name || !Number.isFinite(qty) || qty <= 0) continue;
    const size = String(it?.size || '').trim().slice(0, 30);
    if (catalogMap) {
      const catEntry = catalogMap.get(name);
      if (!catEntry) throw new CreateError(400, `Mặt hàng "${name}" không có trong Danh Mục Đồng Phục`);
      if (!size || !(catEntry.sizes || []).includes(size)) {
        throw new CreateError(400, `Size "${size || '(trống)'}" không hợp lệ cho "${name}"`);
      }
    }
    cleaned.push({ name: name.slice(0, 200), size, qty: Math.floor(qty) });
    if (cleaned.length >= 200) break;
  }
  if (!cleaned.length) throw new CreateError(400, 'Danh mục đồng phục trống hoặc không có dòng hợp lệ (thiếu tên hoặc số lượng)');
  return cleaned;
}

// ===== NGÂN SÁCH — helper chuẩn hoá mẫu (budgetTemplates.fields) + dòng ngân sách (budgetEntries.lines) =====
const BUDGET_TYPE_OPTIONS = ['OPEX', 'CAPEX'];
const BUDGET_FIELD_TYPES = new Set(['text', 'number', 'money', 'select', 'date']);

// 4 cột LÕI — LUÔN hiện diện tường minh trong danh sách field của MỌI mẫu (kể cả mẫu tạo trước khi có
// tính năng này, tự vá lúc đọc — xem sanitizeBudgetCustomFields()) thay vì ẩn đi rồi chỉ cho "thêm cột
// bổ sung" như trước. Admin chọn được thứ tự hiển thị + xoá/thêm cho MỌI cột, TRỪ "Tên Hạng Mục"/"Số
// Tiền"/"Loại NS" (removable:false) — 3 cột này bắt buộc có mặt ở mọi dòng vì bản thân dữ liệu 1 dòng
// ngân sách (budgetEntries.lines[]) vẫn lưu name/amount/budgetType ở property CỐ ĐỊNH riêng (không đổi
// cấu trúc lưu trữ để không phải viết script di trú dữ liệu cũ) — xem sanitizeBudgetLines() bên dưới.
// type/options/required/removable của 4 cột này LUÔN lấy từ định nghĩa gốc ở đây, KHÔNG tin dữ liệu
// client gửi lên cho các thuộc tính đó (chỉ label được phép đổi).
const BUDGET_CORE_FIELD_DEFS = {
  name: { coreKey: 'name', label: 'Tên Hạng Mục', type: 'text', required: true, removable: false },
  description: { coreKey: 'description', label: 'Mô Tả Chi Tiết', type: 'text', required: false, removable: true },
  amount: { coreKey: 'amount', label: 'Số Tiền', type: 'money', required: true, removable: false },
  budgetType: { coreKey: 'budgetType', label: 'Loại NS', type: 'select', options: BUDGET_TYPE_OPTIONS, required: true, removable: false }
};
const BUDGET_CORE_ORDER_DEFAULT = ['name', 'description', 'amount', 'budgetType'];

function defaultBudgetFields() {
  return BUDGET_CORE_ORDER_DEFAULT.map(k => ({ id: k, ...BUDGET_CORE_FIELD_DEFS[k] }));
}

// Chuẩn hoá TOÀN BỘ danh sách cột của 1 mẫu ngân sách — bao gồm cả 4 cột lõi (nếu client có gửi kèm,
// cùng khuôn formTemplates cho phần cột tuỳ biến: id/label/type/options/required) THAY VÌ chỉ nhận
// riêng cột bổ sung như trước. Tự vá cho 2 trường hợp dữ liệu cũ/thiếu:
// 1) Mẫu tạo TRƯỚC khi có tính năng này (fields hoàn toàn không có coreKey nào) — coi là "mẫu cũ", chèn
//    đủ 4 cột lõi mặc định (kể cả Mô Tả Chi Tiết) lên đầu, giữ ĐÚNG hành vi hiển thị cũ thay vì coi như
//    admin đã chủ động bỏ cột nào.
// 2) Mẫu đã ở dạng mới (có ít nhất 1 coreKey) nhưng thiếu 1 trong 3 cột KHÔNG được phép xoá (name/
//    amount/budgetType, có thể do lỗi client) — chèn bù đúng 3 cột đó, KHÔNG đụng tới Mô Tả Chi Tiết vì
//    admin có quyền chủ động bỏ cột này.
function sanitizeBudgetCustomFields(rawFields) {
  const rawList = Array.isArray(rawFields) ? rawFields : [];
  const isLegacyAllCustom = rawList.length > 0 && !rawList.some(f => typeof f?.coreKey === 'string' && BUDGET_CORE_FIELD_DEFS[f.coreKey]);

  const out = [];
  const seenCore = new Set();
  const seenCustomIds = new Set();
  for (const raw of rawList) {
    const coreKey = typeof raw?.coreKey === 'string' && BUDGET_CORE_FIELD_DEFS[raw.coreKey] ? raw.coreKey : null;
    if (coreKey) {
      if (seenCore.has(coreKey)) continue; // bỏ trùng, phòng client gửi lặp
      seenCore.add(coreKey);
      const def = BUDGET_CORE_FIELD_DEFS[coreKey];
      const label = String(raw?.label || '').trim().slice(0, 100) || def.label;
      out.push({ id: coreKey, coreKey, label, type: def.type, ...(def.options ? { options: def.options } : {}), required: def.required, removable: def.removable });
      continue;
    }
    const label = String(raw?.label || '').trim().slice(0, 100);
    if (!label) continue;
    const type = BUDGET_FIELD_TYPES.has(raw?.type) ? raw.type : 'text';
    const options = type === 'select'
      ? (Array.isArray(raw?.options) ? raw.options.map(o => String(o || '').trim()).filter(Boolean).slice(0, 50) : [])
      : [];
    // Giữ NGUYÊN id đã có thay vì sinh mới mỗi lần — hàm này chạy lại ở CẢ lúc đọc (xem
    // getBudgetTemplateCustomFields(), gọi lại mỗi GET /api/data lẫn mỗi lần validate dòng ngân sách
    // gửi lên), nếu luôn sinh id mới thì id lúc client hiển thị/nhập dữ liệu (budgetEntries.lines[].extra)
    // sẽ KHÁC id lúc server validate lại, làm mất trắng dữ liệu cột tuỳ biến đã nhập mà không báo lỗi gì
    // (extra[idMới] luôn undefined vì client chỉ gửi extra[idCũ]). Chỉ sinh id mới khi cột thực sự chưa
    // có id hợp lệ (lần đầu thêm cột) hoặc bị trùng id với 1 cột khác trong cùng mẫu.
    let id = typeof raw?.id === 'string' && raw.id.trim() && !BUDGET_CORE_FIELD_DEFS[raw.id.trim()] ? raw.id.trim() : null;
    if (!id || seenCustomIds.has(id)) id = 'f' + (Date.now() + out.length + Math.floor(Math.random() * 1000));
    seenCustomIds.add(id);
    out.push({ id, label, type, options, required: !!raw?.required, removable: true });
    if (out.length >= 34) break; // 4 cột lõi + tối đa 30 cột tuỳ biến
  }

  if (isLegacyAllCustom) return [...defaultBudgetFields(), ...out];
  const missingMandatory = BUDGET_CORE_ORDER_DEFAULT
    .filter(k => !BUDGET_CORE_FIELD_DEFS[k].removable && !seenCore.has(k))
    .map(k => ({ id: k, ...BUDGET_CORE_FIELD_DEFS[k] }));
  return [...missingMandatory, ...out];
}

// Trả về TOÀN BỘ danh sách cột (lõi + tuỳ biến, đúng thứ tự đã lưu) của mẫu đang chọn ở kỳ — không chọn
// mẫu thì dùng 4 cột lõi mặc định. Luôn chạy lại sanitizeBudgetCustomFields() ngay cả khi đọc (không chỉ
// lúc lưu) để tự vá những mẫu đã tồn tại từ TRƯỚC khi có tính năng "cột lõi tường minh" này — tránh phải
// viết script di trú dữ liệu, mẫu cũ tự nâng cấp ngay lần đọc kế tiếp.
function getBudgetTemplateCustomFields(templateId, templates) {
  if (!templateId) return defaultBudgetFields();
  const tpl = (templates || []).find(t => t.id === templateId);
  if (!tpl) return defaultBudgetFields();
  return sanitizeBudgetCustomFields(tpl.fields);
}

// 1 dòng ngân sách = name/description/amount/budgetType (cộng STT tự tính theo thứ tự dòng khi hiển thị
// — không lưu riêng, tránh lệch khi thêm/xoá/sắp lại dòng) + `extra` theo đúng CỘT TUỲ BIẾN (không phải
// cột lõi) của mẫu đã chọn ở kỳ. `fields` truyền vào là danh sách ĐẦY ĐỦ (lõi + tuỳ biến) từ
// getBudgetTemplateCustomFields() — chỉ lọc lấy phần không có coreKey để duyệt qua extra, phần lõi luôn
// validate cứng bên dưới bất kể mẫu có liệt kê hay không (đảm bảo Tổng Hợp Ngân Sách luôn cộng dồn được
// theo amount/budgetType dù đơn vị dùng mẫu khác nhau).
function sanitizeBudgetLines(rawLines, fields) {
  const lines = Array.isArray(rawLines) ? rawLines : [];
  if (!lines.length) throw new CreateError(400, 'Vui lòng nhập ít nhất 1 dòng ngân sách');
  if (lines.length > 500) throw new CreateError(400, 'Quá nhiều dòng ngân sách (tối đa 500 dòng/bản)');
  const customFields = (fields || []).filter(f => !f.coreKey);
  const out = [];
  for (const raw of lines) {
    const name = String(raw?.name || '').trim();
    if (!name) throw new CreateError(400, 'Mỗi dòng ngân sách phải có Tên hạng mục');
    const amount = Number(raw?.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new CreateError(400, `Số tiền không hợp lệ ở dòng "${name}"`);
    const budgetType = BUDGET_TYPE_OPTIONS.includes(raw?.budgetType) ? raw.budgetType : null;
    if (!budgetType) throw new CreateError(400, `Vui lòng chọn Loại ngân sách (OPEX/CAPEX) ở dòng "${name}"`);
    const extra = {};
    for (const f of customFields) {
      let v = raw?.extra ? raw.extra[f.id] : undefined;
      if (f.type === 'number' || f.type === 'money') {
        v = (v === '' || v === null || v === undefined) ? null : Number(v);
        if (f.required && (v === null || Number.isNaN(v))) throw new CreateError(400, `Thiếu giá trị bắt buộc "${f.label}" ở dòng "${name}"`);
        if (v !== null && Number.isNaN(v)) throw new CreateError(400, `Giá trị không hợp lệ cho "${f.label}" ở dòng "${name}"`);
      } else if (f.type === 'select') {
        v = String(v || '').trim();
        if (v && f.options.length && !f.options.includes(v)) throw new CreateError(400, `Giá trị không hợp lệ cho "${f.label}" ở dòng "${name}"`);
        if (f.required && !v) throw new CreateError(400, `Thiếu giá trị bắt buộc "${f.label}" ở dòng "${name}"`);
      } else {
        v = String(v || '').trim().slice(0, 2000);
        if (f.required && !v) throw new CreateError(400, `Thiếu giá trị bắt buộc "${f.label}" ở dòng "${name}"`);
      }
      extra[f.id] = v;
    }
    out.push({
      id: 'l' + (Date.now() + out.length) + Math.floor(Math.random() * 1000),
      name: name.slice(0, 200),
      description: String(raw?.description || '').trim().slice(0, 2000),
      amount, budgetType, extra
    });
  }
  return out;
}

// Chuẩn hoá + kiểm tra tối thiểu nội dung báo cáo — CHỈ nhận đúng 1 tệp .pptx (không còn nhập tay/đính
// nhiều loại tệp như trước). `parsedSlides` do TRÌNH DUYỆT tự đọc/phân tích tệp .pptx ngay lúc chọn tệp
// (JSZip + DOMParser gốc, xem parsePptxToSlideContents() ở index.html — KHÔNG xử lý gì trên server, tệp
// .pptx gốc dù có lưu qua /api/upload cũng chỉ để lưu vết/xem lại, KHÔNG dùng để dựng slide tổng hợp,
// mọi thứ dựng từ parsedSlides) — server chỉ kiểm tra LẠI hình dạng dữ liệu (không tin tưởng mù quáng
// dữ liệu từ client), không tự đọc/parse lại tệp gốc. Mỗi phần tử parsedSlides khớp đúng 1 slide gốc
// trong .pptx: `title` (tiêu đề, có thể rỗng nếu slide gốc không có), `bodyLines` (mảng dòng văn bản —
// sửa được trực tiếp ở bước Tổng Hợp), `images` (bảng/biểu đồ/ảnh nhúng đã được trình duyệt vẽ lại
// thành ảnh PNG dạng base64 — KHÔNG sửa được, chỉ hiển thị nguyên trạng). Dùng chung cho cả tạo mới
// (extraValidate ở trên) lẫn sửa nháp (updateReportEntryDraft ở lib/recordActions.js) để 2 luồng luôn
// validate giống hệt nhau.
function normalizeReportEntryPayload(payload) {
  // entryType 'PDF': nhân viên đã tự ghép nhiều file PDF thành 1 blob DUY NHẤT ngay trên trình duyệt
  // (pdf-lib) rồi mới tải lên — ở đây chỉ cần xác thực đường dẫn tệp, KHÔNG parse nội dung slide nào cả
  // (khác hẳn nhánh .pptx bên dưới). assertUploadedFileUrl() định nghĩa ở đầu file này.
  payload.entryType = payload.entryType === 'PDF' ? 'PDF' : 'PPTX';
  payload.fileName = String(payload.fileName || '').trim();
  payload.fileType = String(payload.fileType || '');
  if (payload.entryType === 'PDF') {
    if (!payload.fileUrl) throw new CreateError(400, 'Vui lòng chọn tệp báo cáo PDF (đã gộp) cần tải lên');
    assertUploadedFileUrl(payload.fileUrl, 'Tệp báo cáo PDF');
    payload.parsedSlides = [];
    return;
  }
  if (!payload.fileUrl) throw new CreateError(400, 'Vui lòng chọn tệp báo cáo (.pptx) cần tải lên');
  const rawSlides = Array.isArray(payload.parsedSlides) ? payload.parsedSlides : [];
  const IMAGE_KINDS = ['embedded', 'table', 'chart'];
  payload.parsedSlides = rawSlides.map((s, idx) => ({
    order: idx + 1,
    title: String(s?.title || '').trim(),
    bodyLines: (Array.isArray(s?.bodyLines) ? s.bodyLines : []).map(l => String(l || '').trim()).filter(Boolean),
    images: (Array.isArray(s?.images) ? s.images : [])
      .filter(im => im && typeof im.dataUrl === 'string' && im.dataUrl.startsWith('data:image/'))
      .map(im => ({ dataUrl: im.dataUrl, kind: IMAGE_KINDS.includes(im.kind) ? im.kind : 'embedded' }))
  }));
  if (!payload.parsedSlides.length) {
    throw new CreateError(400, 'Không đọc được nội dung nào từ tệp — chỉ đọc được định dạng .pptx (không đọc được .ppt nhị phân đời cũ), vui lòng lưu lại bằng .pptx rồi tải lên lại');
  }
}

// payload: dữ liệu hồ sơ client gửi lên (mọi field nghiệp vụ giữ nguyên) — chỉ id/creator/creatorName
// bị SERVER ghi đè bằng giá trị xác thực từ phiên đăng nhập, không tin bất kỳ giá trị nào client tự
// gửi cho các field này. appData (tuỳ chọn): snapshot toàn bộ AppData do CALLER đọc sẵn (getAllAppData())
// — chỉ module submissions cần dùng (dựng lại quy trình hiệu lực), các module khác bỏ qua tham số này.
// trashedItems (đợt rà soát audit vòng 3, mặc định [] — KHÔNG đổi hành vi cho mọi lời gọi cũ chưa
// biết tham số này, kể cả toàn bộ tests/test-*.js đang gọi hàm này trực tiếp/đồng bộ): dup-check
// "code" TRƯỚC ĐÂY chỉ so khớp với collection ĐANG SỐNG — code của 1 hồ sơ đã xoá (nằm trong
// dbo.TrashBin, index UNIQUE ở dbo.Records không với tới) coi như "còn trống", 1 hồ sơ HOÀN TOÀN
// không liên quan tạo sau đó có thể vô tình trùng đúng code cũ, khiến lịch sử/tham chiếu chéo (những
// chỗ hiển thị lại code thay vì tra theo id) đọc nhầm sang hồ sơ mới. Cố ý KHÔNG tự đọc Thùng Rác ở
// đây (sẽ phải đổi cả hàm này lẫn extraValidate của docs thành async — đụng tới rất nhiều nơi trong
// tests/*.js đang gọi hàm này ĐỒNG BỘ, kỳ vọng throw/return ngay) — CALLER (routes/create.js) tự đọc
// bất đồng bộ rồi TRUYỀN VÀO đây, hàm vẫn giữ nguyên chữ ký đồng bộ.
function validateAndPrepareCreate(moduleKey, payload, user, existingCollection, appData, trashedItems) {
  const config = CREATE_MODULE_CONFIGS[moduleKey];
  if (!config) throw new CreateError(400, `Module không hợp lệ: ${moduleKey}`);
  if (!payload || typeof payload !== 'object') throw new CreateError(400, 'Thiếu dữ liệu hồ sơ');

  const dept = config.forceOwnDept ? user.dept : payload.dept;
  if (!dept) throw new CreateError(400, 'Thiếu phòng ban');
  if (!scopeAllows(user, config.getScope(user), dept)) {
    throw new CreateError(403, 'Bạn không có quyền tạo hồ sơ cho phòng ban này');
  }

  if (payload.code) {
    const dup = (existingCollection || []).some(item => item.code === payload.code);
    if (dup) throw new CreateError(409, `Mã "${payload.code}" đã tồn tại`);
    if ((trashedItems || []).some(t => t.code === payload.code)) {
      throw new CreateError(409, `Mã "${payload.code}" đã từng được dùng cho 1 hồ sơ đã xoá — vui lòng chọn mã khác`);
    }
  }

  if (config.extraValidate) config.extraValidate(payload, existingCollection, user, appData, trashedItems);

  const record = { ...payload, id: Date.now(), dept };
  record[config.creatorField] = user.username;
  if (config.creatorNameField) record[config.creatorNameField] = user.name;
  return record;
}

// Giảng viên lớp học (Đợt 3) — resolve username client gửi lên thành 1 tài khoản hệ thống THẬT (đang
// active), cùng khuôn workflowEngine.js xử lý carAssignedDriverUsername. Dùng chung cho CẢ tạo lớp
// (trainingClasses.extraValidate ở trên) LẪN sửa lớp (editTrainingClass(), lib/recordActions.js) nên
// đặt ở đây (file đã có tiền lệ export scopeAllows cho recordActions.js require lại). Trả về null nếu
// input rỗng (không gán giảng viên — hợp lệ), throw nếu có nhập nhưng không khớp tài khoản nào.
function resolveTrainingInstructorUsername(rawUsername, users) {
  const username = String(rawUsername || '').trim();
  if (!username) return null;
  const found = (users || []).find(u => u.username === username && u.active !== false);
  if (!found) throw new CreateError(400, 'Không tìm thấy tài khoản giảng viên này (hoặc đã bị khoá)');
  return found;
}

// "Người Phụ Trách" (Vận Hành > Siêu Thị — operationStoreOpenings/operationRepairs, đợt đổi ô gõ tên tự
// do -> ô chọn tài khoản hệ thống thật, xem CLAUDE.md "sdd*") — cùng khuôn
// resolveTrainingInstructorUsername() ở trên nhưng KHÔNG tái dùng thẳng hàm đó vì thông điệp lỗi sai
// ngữ cảnh (giảng viên vs người phụ trách). Trả null nếu rỗng (field vẫn không bắt buộc), throw 400 nếu
// có nhập nhưng không khớp tài khoản active nào.
function resolveOperationPersonInChargeUsername(rawUsername, users) {
  const username = String(rawUsername || '').trim();
  if (!username) return null;
  const found = (users || []).find(u => u.username === username && u.active !== false);
  if (!found) throw new CreateError(400, 'Không tìm thấy tài khoản người phụ trách này (hoặc đã bị khoá)');
  return found;
}

// Danh Sách Được Mời (inviteList, Đợt 3) — chỉ chuẩn hoá thành mảng username duy nhất, không bắt buộc
// từng username phải là tài khoản có thật (nhập sai chỉ khiến người đó không tự đăng ký được, không
// gây lỗi dữ liệu gì) — dùng chung cho tạo lớp lẫn sửa lớp giống resolveTrainingInstructorUsername ở trên.
function normalizeInviteList(rawList) {
  if (!Array.isArray(rawList)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of rawList) {
    const username = String(raw || '').trim();
    if (!username || seen.has(username)) continue;
    seen.add(username);
    out.push(username);
    if (out.length >= 500) break;
  }
  return out;
}

// Chuẩn hoá + kiểm tra các field của 1 dòng Kế Hoạch Đào Tạo (trainingPlans, Đợt 5) — dùng CHUNG cho cả
// TẠO (extraValidate ở trên) LẪN SỬA (editTrainingPlan(), lib/recordActions.js), cùng lý do tách riêng
// như resolveTrainingInstructorUsername/normalizeInviteList ở trên (2 route khác nhau cùng cần đúng 1
// luật chuẩn hoá, không lặp lại logic). Ném lỗi ngay khi field không hợp lệ (tháng sai định dạng,
// courseId không khớp chương trình có thật, targetDept không khớp danh mục phòng ban/siêu thị) — số
// lượng (plannedClasses/plannedTrainees/plannedHours) KHÔNG chặn cứng (âm/chữ/để trống đều rơi về 0)
// vì đây chỉ là số KẾ HOẠCH, sai lệch không gây hỏng dữ liệu liên kết như courseId/targetDept.
function normalizeTrainingPlanFields(payload, appData) {
  const month = String(payload.month || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new CreateError(400, 'Tháng kế hoạch không hợp lệ (định dạng YYYY-MM, vd 2026-09)');
  }
  payload.month = month;

  const courseId = (payload.courseId === '' || payload.courseId == null) ? null : Number(payload.courseId);
  if (courseId != null) {
    const courses = appData?.trainingCourses || [];
    if (!Number.isFinite(courseId) || !courses.some(c => c.id === courseId)) {
      throw new CreateError(400, 'Chương trình được chọn không hợp lệ');
    }
  }
  payload.courseId = courseId;

  const targetDept = payload.targetDept ? String(payload.targetDept).trim() : '';
  if (targetDept) {
    const validDepts = new Set([...(appData?.depts || []), ...(appData?.stores || [])]);
    if (!validDepts.has(targetDept)) throw new CreateError(400, `Đơn vị không hợp lệ: ${targetDept}`);
  }
  payload.targetDept = targetDept;

  payload.audience = payload.audience ? String(payload.audience).trim().slice(0, 300) : '';

  const toNonNegInt = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
  const toNonNegNum = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  payload.plannedClasses = toNonNegInt(payload.plannedClasses);
  payload.plannedTrainees = toNonNegInt(payload.plannedTrainees);
  payload.plannedHours = toNonNegNum(payload.plannedHours);
}

// Chuẩn hoá + kiểm tra các field của 1 Lộ Trình Đào Tạo Tân Binh (onboardingPaths) — dùng CHUNG cho cả
// TẠO (extraValidate ở trên) LẪN SỬA (editOnboardingPath(), lib/recordActions.js), cùng lý do tách riêng
// như normalizeTrainingPlanFields ở trên. Đợt 8 — Giai đoạn 1/2 đổi từ (tài liệu + 1 bài test rời, không
// gắn lớp học) sang chọn CHƯƠNG TRÌNH HỌC bắt buộc (giống hệt careerPaths.stages[].requiredCourseIds) —
// "Đạt" 1 chương trình = có 1 trainingRegistrations PASSED ở 1 lớp thuộc đúng chương trình đó (xem
// confirmOnboardingStage(), lib/recordActions.js) — field cũ stage1DocumentIds/test1Id/stage2DocumentIds/
// test2Id bỏ hẳn, không giữ tương thích ngược (tính năng chưa phát hành cho người dùng thật).
function normalizeOnboardingPathFields(payload, appData) {
  if (!payload.name || !String(payload.name).trim()) throw new CreateError(400, 'Thiếu tên lộ trình đào tạo tân binh');
  payload.name = String(payload.name).trim();

  const courses = appData?.trainingCourses || [];
  const toRequiredCourseIds = (raw, label) => {
    const ids = Array.isArray(raw) ? [...new Set(raw.map(Number))].filter(Number.isFinite) : [];
    if (!ids.length) throw new CreateError(400, `Vui lòng chọn ít nhất 1 chương trình học bắt buộc cho ${label}`);
    const invalid = ids.filter(id => !courses.some(c => c.id === id));
    if (invalid.length) throw new CreateError(400, `${label} có chương trình được chọn không hợp lệ`);
    return ids;
  };
  payload.stage1RequiredCourseIds = toRequiredCourseIds(payload.stage1RequiredCourseIds, 'Giai đoạn 1');
  payload.stage2RequiredCourseIds = toRequiredCourseIds(payload.stage2RequiredCourseIds, 'Giai đoạn 2');

  payload.stage3Criteria = payload.stage3Criteria ? String(payload.stage3Criteria).trim().slice(0, 3000) : '';

  delete payload.stage1DocumentIds; delete payload.test1Id;
  delete payload.stage2DocumentIds; delete payload.test2Id;
}

module.exports = {
  CREATE_MODULE_CONFIGS, CreateError, validateAndPrepareCreate, scopeAllows, findMeetingConflict,
  validateRequiredCustomData,
  // Export cho lib/recordActions.js editInternalPost() — sửa bài cũng nhận lại attachment từ client nên
  // phải kiểm tra ĐÚNG luật như lúc tạo, nếu không lỗ hổng scheme "javascript:" chỉ bị vá 1 nửa.
  UPLOADED_FILE_URL_RE, UPLOADED_FILE_URL_MAX_LEN, assertUploadedFileUrl, assertUploadedFileUrlList,
  OFFICE_SUBTYPE_TO_PERM_FLAG, normalizeReportEntryPayload,
  CONTRACT_APPROVAL_LAYERS, CONTRACT_APPROVAL_LEVELS, CONTRACT_APPROVAL_LEVEL_RULES,
  buildEffectiveContractApprovalWorkflowServer,
  // Export thêm cho lib/recordActions.js editSubmissionDraft() (nút "Bổ Sung" -> sửa lại + gửi lại tờ
  // trình) — cần dựng lại effectiveSteps/effectiveApprovers giống hệt lúc TẠO khi người trình đổi loại/
  // phòng ban/lớp phê duyệt bổ sung trong lúc sửa.
  SUBMISSION_APPROVAL_LEVELS, buildEffectiveSubmissionWorkflowServer,
  sanitizeUniformItems,
  BUDGET_TYPE_OPTIONS, BUDGET_FIELD_TYPES, sanitizeBudgetLines, getBudgetTemplateCustomFields, sanitizeBudgetCustomFields,
  resolveTrainingInstructorUsername, normalizeInviteList,
  resolveOperationPersonInChargeUsername,
  normalizeTrainingPlanFields,
  normalizeOnboardingPathFields
};
