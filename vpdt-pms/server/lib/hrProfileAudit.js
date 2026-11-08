// lib/hrProfileAudit.js — "🔍 Audit Nhân Sự" (11/2026, theo yêu cầu người dùng: "rà soát hồ sơ chưa
// active/hợp đồng chưa active, hợp đồng hết hạn/sau hết hạn, hồ sơ thiếu thông tin"). KHÁC 3 audit đã có
// (Quy Trình/Người Dùng/Hệ Thống — đều admin-only, sống ở Hệ Thống > Quản Trị): audit này sống TRONG
// module Nhân Sự, gác theo quyền HR (canFullViewProfiles/canManageContracts/hrReportView — xem
// routes/hrProfileAudit.js), KHÔNG bắt buộc admin, đúng yêu cầu "nhân sự sẽ được phân quyền chứ admin
// không phân quyền đâu". 4 nhóm đã xác nhận với người dùng:
//   H1: hồ sơ DRAFT tồn đọng quá lâu (Onboarding có thể đã bị bỏ quên).
//   H2: hồ sơ ACTIVE nhưng thiếu hợp đồng ACTIVE tương ứng (chưa có hợp đồng nào, hoặc hợp đồng gần
//       nhất còn DRAFT/đã đóng mà chưa có hợp đồng kế tiếp).
//   H3: hợp đồng ACTIVE đã hết hạn nhưng chưa xử lý (CRITICAL) + sắp hết hạn (WARNING) — song song với
//       jobs/laborContractExpiryReminder.js (chỉ gửi email nhắc), ở đây cho xem TRỰC TIẾP cả danh sách.
//   H4: hồ sơ ACTIVE thiếu thông tin quan trọng (CCCD, SĐT, địa chỉ, số TK ngân hàng, MST, số BHXH).
'use strict';

const { resolveProfileDisplayName, PROFILE_FIELD_LABELS } = require('./employeeProfile');
const { findActiveContractByEmployeeCode, findContractsByEmployeeCode } = require('./laborContract');
const { getAllForCollection } = require('./recordStore');

function pushFinding(out, type, severity, employeeCode, name, reason) {
  out.push({ type, severity, employeeCode, name: name || employeeCode, reason });
}

// Bản sao tối giản parseVNDateTimeLocal() của lib/employeeProfile.js (nowVN() sinh chuỗi "HH:mm:ss
// d/M/yyyy") — KHÔNG require thẳng lib/recordActions.js (file rất lớn), cùng lý do employeeProfile.js
// đã tự giữ 1 bản sao riêng (đọc chú thích đầy đủ ở đó).
function parseVNDateTimeLocal(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().split(' ');
  if (parts.length !== 2) return null;
  const [timePart, datePart] = parts;
  const timeBits = timePart.split(':').map(Number);
  const dateBits = datePart.split('/').map(Number);
  if (dateBits.length !== 3 || dateBits.some(isNaN)) return null;
  const [h, mi, s] = timeBits;
  const [d, mo, y] = dateBits;
  const dt = new Date(y, mo - 1, d, h || 0, mi || 0, s || 0);
  return isNaN(dt.getTime()) ? null : dt;
}
function daysSince(dateStr) {
  const d = parseVNDateTimeLocal(dateStr);
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
// Cùng công thức daysUntil() của jobs/laborContractExpiryReminder.js (so theo ngày lịch, bỏ giờ/phút).
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const end = new Date(dateStr);
  if (isNaN(end.getTime())) return null;
  const now = new Date();
  const startOfEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((startOfEnd - startOfNow) / 86400000);
}

// H1: hồ sơ DRAFT tồn đọng quá lâu. Loại trừ onboardingQueueStatus==='CANCELLED' — hồ sơ ứng viên đã
// chủ động "Hủy" (không nhận việc) CỐ Ý giữ nguyên DRAFT mãi (xem cancelOnboardingQueueProfile(),
// lib/employeeProfile.js) để còn phục vụ báo cáo, KHÔNG phải "bị bỏ quên" — báo ở đây sẽ là báo động giả.
function auditStaleDraftProfiles(out, appData, staleDays) {
  const profiles = appData.employeeProfiles || [];
  profiles.forEach(p => {
    if (!p || p.status !== 'DRAFT') return;
    if (p.onboardingQueueStatus === 'CANCELLED') return;
    const days = daysSince(p.createdAt);
    if (days === null || days < staleDays) return;
    const name = resolveProfileDisplayName(p, appData.users, appData.hrProcesses);
    pushFinding(out, 'STALE_DRAFT_PROFILE', 'WARNING', p.employeeCode, name,
      `Hồ sơ còn ở trạng thái Nháp (chưa hoàn tất) đã ${days} ngày (ngưỡng cấu hình: ${staleDays} ngày) — rà soát xem quy trình Onboarding còn đang xử lý hay đã bị bỏ quên.`);
  });
}

// H2: hồ sơ ACTIVE (đang làm việc) nhưng thiếu hợp đồng ACTIVE tương ứng — hoặc chưa có hợp đồng nào,
// hoặc hợp đồng gần nhất vẫn ở DRAFT (chưa kích hoạt), hoặc hợp đồng gần nhất đã đóng mà chưa thấy hợp
// đồng kế tiếp (TERMINATED/EXPIRED/SUPERSEDED không kèm 1 bản ACTIVE mới — rủi ro hành chính/pháp lý).
function auditMissingOrDraftContract(out, appData, contracts) {
  const profiles = appData.employeeProfiles || [];
  profiles.forEach(p => {
    if (!p || p.status !== 'ACTIVE') return;
    const family = findContractsByEmployeeCode(contracts, p.employeeCode);
    const name = resolveProfileDisplayName(p, appData.users, appData.hrProcesses);
    if (!family.length) {
      pushFinding(out, 'NO_CONTRACT', 'CRITICAL', p.employeeCode, name,
        'Hồ sơ đang ACTIVE nhưng chưa có bất kỳ hợp đồng lao động nào trong hệ thống.');
      return;
    }
    if (findActiveContractByEmployeeCode(contracts, p.employeeCode)) return;
    const latest = family.reduce((a, b) => ((b.id || 0) > (a.id || 0) ? b : a));
    if (latest.status === 'DRAFT') {
      pushFinding(out, 'DRAFT_CONTRACT_NOT_ACTIVATED', 'WARNING', p.employeeCode, name,
        `Hồ sơ đang ACTIVE nhưng hợp đồng gần nhất (${latest.code || '?'}) vẫn ở trạng thái Nháp, chưa được kích hoạt.`);
    } else {
      const statusLabel = latest.status === 'TERMINATED' ? 'chấm dứt' : latest.status === 'EXPIRED' ? 'hết hạn' : 'bị thay thế';
      pushFinding(out, 'NO_ACTIVE_CONTRACT', 'CRITICAL', p.employeeCode, name,
        `Hồ sơ đang ACTIVE nhưng không có hợp đồng nào đang hiệu lực (hợp đồng gần nhất "${latest.code || '?'}" đã ${statusLabel}).`);
    }
  });
}

// H3: hợp đồng ACTIVE đã hết hạn nhưng chưa xử lý (CRITICAL — endDate đã qua mà status vẫn ACTIVE,
// KHÔNG tự chuyển EXPIRED, xem lib/laborContract.js) + sắp hết hạn trong X ngày tới (WARNING).
function auditContractExpiry(out, contracts, soonDays) {
  contracts.forEach(c => {
    if (!c || c.status !== 'ACTIVE') return;
    const diff = daysUntil(c.endDate);
    if (diff === null) return; // Vô thời hạn (endDate null) hoặc endDate hỏng
    if (diff < 0) {
      pushFinding(out, 'CONTRACT_EXPIRED_UNPROCESSED', 'CRITICAL', c.employeeCode, c.code,
        `Hợp đồng "${c.code}" đã hết hạn ${Math.abs(diff)} ngày (${c.endDate}) nhưng vẫn đang ở trạng thái Đang hiệu lực — chưa gia hạn/chấm dứt.`);
    } else if (diff <= soonDays) {
      pushFinding(out, 'CONTRACT_EXPIRING_SOON', 'WARNING', c.employeeCode, c.code,
        `Hợp đồng "${c.code}" còn ${diff} ngày là hết hạn (${c.endDate}, ngưỡng cấu hình: ${soonDays} ngày).`);
    }
  });
}

// H4: hồ sơ ACTIVE thiếu thông tin quan trọng. CCCD/CMND tách riêng CRITICAL (định danh pháp lý cốt
// lõi, cần cho BHXH/thuế/hợp đồng) — 5 field còn lại gộp 1 WARNING/hồ sơ (tránh phình danh sách).
const REQUIRED_IDENTITY_FIELD = 'nationalId';
const REQUIRED_OTHER_FIELDS = ['contactPhone', 'permanentAddress', 'bankAccountNo', 'taxCode', 'socialInsuranceNo'];
function isEmptyField(v) { return v === null || v === undefined || String(v).trim() === ''; }
function auditIncompleteProfiles(out, appData) {
  const profiles = appData.employeeProfiles || [];
  profiles.forEach(p => {
    if (!p || p.status !== 'ACTIVE') return;
    const name = resolveProfileDisplayName(p, appData.users, appData.hrProcesses);
    if (isEmptyField(p[REQUIRED_IDENTITY_FIELD])) {
      pushFinding(out, 'MISSING_NATIONAL_ID', 'CRITICAL', p.employeeCode, name,
        `Hồ sơ đang ACTIVE nhưng thiếu ${PROFILE_FIELD_LABELS.nationalId || 'CCCD/CMND'}.`);
    }
    const missingOthers = REQUIRED_OTHER_FIELDS.filter(f => isEmptyField(p[f]));
    if (missingOthers.length) {
      const labels = missingOthers.map(f => PROFILE_FIELD_LABELS[f] || f).join(', ');
      pushFinding(out, 'MISSING_PROFILE_INFO', 'WARNING', p.employeeCode, name,
        `Hồ sơ đang ACTIVE nhưng còn thiếu: ${labels}.`);
    }
  });
}

async function auditHrProfileGaps(appData, config) {
  const draftStaleDays = Number(config?.draftStaleDaysThreshold) > 0 ? Number(config.draftStaleDaysThreshold) : 30;
  const expirySoonDays = Number(config?.contractExpirySoonDays) > 0 ? Number(config.contractExpirySoonDays) : 30;
  const out = [];
  let contracts = [];
  try { contracts = await getAllForCollection('laborContracts'); }
  catch (err) { console.error('⛔ [Audit Nhân Sự] Không đọc được Hợp Đồng Lao Động:', err.message); }
  try { auditStaleDraftProfiles(out, appData, draftStaleDays); } catch (err) { console.error('⛔ [Audit Nhân Sự] auditStaleDraftProfiles lỗi:', err.message); }
  try { auditMissingOrDraftContract(out, appData, contracts); } catch (err) { console.error('⛔ [Audit Nhân Sự] auditMissingOrDraftContract lỗi:', err.message); }
  try { auditContractExpiry(out, contracts, expirySoonDays); } catch (err) { console.error('⛔ [Audit Nhân Sự] auditContractExpiry lỗi:', err.message); }
  try { auditIncompleteProfiles(out, appData); } catch (err) { console.error('⛔ [Audit Nhân Sự] auditIncompleteProfiles lỗi:', err.message); }
  return out;
}

// Cùng khuôn computeFindingsSignature() của 3 audit trước — không gồm `reason`, chỉ gồm phần ĐỊNH DANH.
function computeFindingsSignature(findings) {
  return (findings || []).map(f => `${f.type}::${f.employeeCode}::${f.severity}`).sort().join('|');
}

module.exports = { auditHrProfileGaps, computeFindingsSignature };
