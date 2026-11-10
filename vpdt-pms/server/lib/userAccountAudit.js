// lib/userAccountAudit.js — "🔍 Audit Người Dùng" (11/2026, mở rộng từ "Audit Quy Trình" theo yêu cầu
// người dùng: "thử xem với audit về người dùng này, audit về các hệ thống này để có thể chủ động hỗ
// trợ tốt hơn"). 4 mục đã xác nhận với người dùng (A1-A4), KHÔNG làm "hết hạn mật khẩu" (không có field
// `passwordChangedAt` trong hệ thống — làm được sẽ là 1 tính năng nghiệp vụ mới, ngoài phạm vi audit).
'use strict';

const {
  DEPT_OR_TIER_WORKFLOW_MAP_KEYS, NESTED_DEPT_WORKFLOW_MAP_KEYS
} = require('./workflowEngine');

const EXTRA_APPROVAL_SUFFIXES = [
  'DOC', 'CAR', 'OFFICE_BUY', 'OFFICE_FIX', 'VPP', 'PAYMENT',
  'ITPRICE_RETAIL', 'ITPRICE_WHOLESALE', 'OPERATION_ORDER_STORE', 'OPERATION_ORDER_HO'
];

function pushFinding(out, type, severity, username, name, reason) {
  out.push({ type, severity, username, name: name || username, reason });
}

// A1 (NGHIÊM TRỌNG NHẤT — lỗ hổng bảo mật thật, không phải audit lý thuyết): tài khoản vẫn active dù hồ
// sơ Nhân Sự đã ghi nhận NGHỈ VIỆC. Offboarding hoàn tất CHỈ đổi employeeProfile.status (xem
// applyProcessCompletion(), lib/employeeProfile.js) — KHÔNG tự khoá users.active, hoàn toàn thủ công,
// dễ quên. Liên kết user<->profile qua CHUỖI username (employeeProfile.username === users.username,
// không phải id) — xem lib/employeeProfile.js.
function auditActiveAfterOffboard(out, appData) {
  const users = appData.users || [];
  const profiles = appData.employeeProfiles || [];
  const profileByUsername = new Map(profiles.filter(p => p && p.username).map(p => [p.username, p]));
  users.forEach(u => {
    if (!u || !u.username || u.active === false) return;
    const profile = profileByUsername.get(u.username);
    if (profile && profile.status === 'INACTIVE') {
      pushFinding(out, 'ACTIVE_AFTER_OFFBOARD', 'CRITICAL', u.username, u.name,
        'Hồ sơ Nhân Sự đã ghi NGHỈ VIỆC (INACTIVE) nhưng tài khoản đăng nhập vẫn đang ACTIVE — rà soát và khoá tài khoản nếu đúng là đã nghỉ việc thật.');
    }
  });
}

// A2 (CẢNH BÁO — rủi ro, không phải lỗ hổng chắc chắn): tài khoản active nhưng lâu không đăng nhập.
// Ngưỡng ngày cấu hình được (dormantDaysThreshold, mặc định 90) qua userAuditJobConfig. Chỉ xét user có
// lastLoginAt (users.lastLoginAt, cập nhật ở routes/auth.js lúc đăng nhập) — user CHƯA TỪNG đăng nhập
// (lastLoginAt rỗng, VD vừa tạo tài khoản) KHÔNG bị tính vào đây (không đủ căn cứ "đã từng dùng rồi bỏ").
function auditDormantAccounts(out, appData, dormantDays) {
  const users = appData.users || [];
  const cutoff = Date.now() - dormantDays * 24 * 60 * 60 * 1000;
  users.forEach(u => {
    if (!u || !u.username || u.active === false || !u.lastLoginAt) return;
    const t = new Date(u.lastLoginAt).getTime();
    if (!Number.isFinite(t) || t >= cutoff) return;
    const days = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
    pushFinding(out, 'DORMANT_ACCOUNT', 'WARNING', u.username, u.name,
      `Không đăng nhập ${days} ngày (ngưỡng cấu hình: ${dormantDays} ngày) — rà soát xem còn cần tài khoản này không.`);
  });
}

// A3 (THÔNG TIN — không phải lỗ hổng, chỉ là rà soát định kỳ chủ động): liệt kê mọi tài khoản admin.
// perms.admin bỏ qua MỌI kiểm tra quyền khác ở hàng trăm route (xem defaults.js) — rà soát định kỳ ai
// đang có "siêu quyền" là biện pháp bảo mật chủ động hợp lý theo đúng yêu cầu người dùng.
function auditAdminAccounts(out, appData) {
  (appData.users || []).forEach(u => {
    if (!u || !u.username || !u.perms?.admin) return;
    pushFinding(out, 'ADMIN_ACCOUNT', 'INFO', u.username, u.name,
      u.active === false ? 'Đang có quyền Quản Trị Viên (admin) — tài khoản ĐÃ KHOÁ.' : 'Đang có quyền Quản Trị Viên (admin) — rà soát định kỳ.');
  });
}

// Thu thập (best-effort) mọi username/"vị trí" (jobTitle+dept) THỰC SỰ được gán làm người duyệt ở bất
// kỳ đâu trong toàn bộ cấu hình quy trình — dùng cho A4. CỐ Ý quét theo 3 hình dạng CỤ THỂ đã xác nhận
// (không đoán thêm hình dạng khác để tránh gộp nhầm chuỗi không liên quan, VD tên Siêu Thị trong
// rule.stores[], thành "đã dùng"):
//   - config.approvers = {stepOrder: [username,...]} (PEOPLE mode, mọi *DeptWorkflows/*TierWorkflows)
//   - config.approversByPosition = {stepOrder: [{jobTitle,dept},...]} (POSITION mode)
//   - group.members = [username,...] (Nhóm Phê Duyệt/Nhóm Phê Duyệt Cuối)
//   - rule.mode==='PERSON' && rule.username (Quy Trình Hỗn Hợp PERSON) / rule.jobTitle+rule.jobTitleDept
//     (Quy Trình Hỗn Hợp JOBTITLE)
// GIỚI HẠN ĐÃ BIẾT: đây là audit THÔNG TIN (severity INFO, không chặn thao tác nào) — thiếu sót ở đây
// chỉ khiến A4 bỏ lọt 1 vài trường hợp (ít báo động giả hơn là báo nhầm), không phải lỗ hổng bảo mật.
function collectReferencedApprovers(appData) {
  const usernames = new Set();
  const positionPairs = [];

  function addApproversObj(approvers) {
    if (!approvers || typeof approvers !== 'object') return;
    Object.values(approvers).forEach(arr => {
      if (Array.isArray(arr)) arr.forEach(u => { if (typeof u === 'string' && u) usernames.add(u); });
    });
  }
  function addApproversByPositionObj(approversByPosition) {
    if (!approversByPosition || typeof approversByPosition !== 'object') return;
    Object.values(approversByPosition).forEach(arr => {
      if (!Array.isArray(arr)) return;
      arr.forEach(pair => { if (pair && pair.jobTitle) positionPairs.push({ jobTitle: pair.jobTitle, dept: pair.dept || '' }); });
    });
  }
  function walkConfigNode(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walkConfigNode); return; }
    if (node.approvers) addApproversObj(node.approvers);
    if (node.approversByPosition) addApproversByPositionObj(node.approversByPosition);
    // Quy Trình Hỗn Hợp (mảng rule PERSON/JOBTITLE) có thể nằm lồng ở đây nếu sau này gộp chung config —
    // hiện tại 2 mảng mixed rule nằm ở AppData key riêng, xử lý ở dưới — nhánh này chỉ phòng hờ cấu trúc
    // lồng sâu hơn (itPriceDeptWorkflows có thêm cấp RETAIL/WHOLESALE).
    Object.values(node).forEach(v => { if (v && typeof v === 'object') walkConfigNode(v); });
  }

  DEPT_OR_TIER_WORKFLOW_MAP_KEYS.forEach(key => walkConfigNode(appData[key]));
  NESTED_DEPT_WORKFLOW_MAP_KEYS.forEach(key => walkConfigNode(appData[key]));

  ['submissionApprovalGroups', 'contractApprovalGroups'].forEach(key => {
    (appData[key] || []).forEach(g => (g?.members || []).forEach(u => { if (typeof u === 'string' && u) usernames.add(u); }));
  });
  EXTRA_APPROVAL_SUFFIXES.forEach(suffix => {
    (appData[`extraApprovalGroups_${suffix}`] || []).forEach(g => (g?.members || []).forEach(u => { if (typeof u === 'string' && u) usernames.add(u); }));
  });

  ['operationOrderStoreMixedApprovalRules', 'itPriceWholesaleStoreMixedApprovalRules'].forEach(key => {
    (appData[key] || []).forEach(rule => {
      if (!rule) return;
      if (rule.mode === 'PERSON' && typeof rule.username === 'string' && rule.username) usernames.add(rule.username);
      if (rule.mode === 'JOBTITLE' && rule.jobTitle) positionPairs.push({ jobTitle: rule.jobTitle, dept: rule.jobTitleDept || '' });
    });
  });

  (appData.workflowParticipatingPositions || []).forEach(p => {
    if (p && p.jobTitle) positionPairs.push({ jobTitle: p.jobTitle, dept: p.dept || '' });
  });

  return { usernames, positionPairs };
}

// LỖI ĐÃ VÁ (xác nhận với người dùng, 11/2026 — xem chú thích đầy đủ ở lib/positionApprovers.js::
// matchesPositionPair()/lib/workflowEngine.js::userHasMixedApprovalPosition()): loại trừ vị trí kiêm
// nhiệm source 'HR_PROFILE' khỏi phép khớp — audit A4 (canBeApprover dư thừa) phải tính NHẤT QUÁN với
// đúng những gì 2 điểm tra cứu approver thật đang tính, nếu không sẽ báo "còn khớp" cho 1 người thực ra
// KHÔNG còn là approver thật (chỉ vì giữ đúng Vị Trí Kiêm Nhiệm đồng bộ từ Hồ Sơ Nhân Sự).
function userMatchesAnyPositionPair(user, positionPairs) {
  const eligibleSecondary = (user.secondaryPositions || []).filter(sp => sp && sp.source !== 'HR_PROFILE');
  return positionPairs.some(pair => {
    if (!pair.dept) {
      if (user.jobTitle === pair.jobTitle) return true;
      return eligibleSecondary.some(sp => sp.jobTitle === pair.jobTitle);
    }
    if (user.jobTitle === pair.jobTitle && user.dept === pair.dept) return true;
    return eligibleSecondary.some(sp => sp.jobTitle === pair.jobTitle && sp.dept === pair.dept);
  });
}

// A4 (THÔNG TIN — quyền thừa, không phải lỗ hổng bảo mật): có quyền canBeApprover nhưng KHÔNG xuất hiện
// (theo PEOPLE mode) lẫn không khớp (theo POSITION mode) bất kỳ bước duyệt/nhóm phê duyệt nào đang cấu
// hình — rà soát để thu hồi quyền không dùng tới (giảm diện tích tấn công), KHÔNG phải lỗi hệ thống.
function auditUnusedApproverPerm(out, appData) {
  const users = appData.users || [];
  const { usernames, positionPairs } = collectReferencedApprovers(appData);
  users.forEach(u => {
    if (!u || !u.username || !u.perms?.canBeApprover) return;
    if (usernames.has(u.username)) return;
    if (userMatchesAnyPositionPair(u, positionPairs)) return;
    pushFinding(out, 'UNUSED_APPROVER_PERM', 'INFO', u.username, u.name,
      'Đang có quyền "Người Duyệt" (canBeApprover) nhưng chưa khớp bất kỳ bước/nhóm phê duyệt nào đang cấu hình — có thể thu hồi quyền nếu không còn cần.');
  });
}

function auditUserAccountGaps(appData, config) {
  const dormantDays = Number(config?.dormantDaysThreshold) > 0 ? Number(config.dormantDaysThreshold) : 90;
  const out = [];
  try { auditActiveAfterOffboard(out, appData); } catch (err) { console.error('⛔ [Audit Người Dùng] auditActiveAfterOffboard lỗi:', err.message); }
  try { auditDormantAccounts(out, appData, dormantDays); } catch (err) { console.error('⛔ [Audit Người Dùng] auditDormantAccounts lỗi:', err.message); }
  try { auditAdminAccounts(out, appData); } catch (err) { console.error('⛔ [Audit Người Dùng] auditAdminAccounts lỗi:', err.message); }
  try { auditUnusedApproverPerm(out, appData); } catch (err) { console.error('⛔ [Audit Người Dùng] auditUnusedApproverPerm lỗi:', err.message); }
  return out;
}

// Cùng khuôn computeFindingsSignature() của lib/workflowApproverAudit.js — không gồm `reason` (text có
// thể đổi câu chữ mà không đổi bản chất), chỉ gồm phần ĐỊNH DANH.
function computeFindingsSignature(findings) {
  return (findings || []).map(f => `${f.type}::${f.username}::${f.severity}`).sort().join('|');
}

module.exports = { auditUserAccountGaps, computeFindingsSignature };
