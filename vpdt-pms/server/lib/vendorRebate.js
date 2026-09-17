// lib/vendorRebate.js — Nghiệp vụ module "🛒 Mua Hàng" > BAS (Basis — Cơ Sở Tính Chiết Khấu/Thưởng NCC),
// v23.30, Giai đoạn 1 theo tài liệu người dùng cung cấp (vendor_rebate_full.md). Quản lý NCC (Vendors) +
// Điều Khoản Chiết Khấu (RebateTerms, có versioning + vòng đời Draft->Active->Expired/Archived, mỗi điều
// khoản tự mang Tiers[]/Scopes[] — xem mục 2.1/0.2 tài liệu) + orchestrator gọi
// purchaseBasisAggregator.js/tieredCalculator.js để tính ước tính (RebateCalculations, snapshot append-
// only — KHÔNG PHẢI Sổ Cái ACCRUED/CONFIRMED/SETTLED đầy đủ, đó là Giai đoạn 2 chưa làm ở đợt này).
//
// PHÁT HIỆN theo tài liệu mục 8 "Phân quyền": người TẠO điều khoản KHÔNG tự động có quyền KÍCH HOẠT hay
// DUYỆT — tách biệt nhiệm vụ rõ ràng vì liên quan trực tiếp số tiền lớn (rebateTermManage != rebateTermActivate
// != rebateApprove). KHÁC quy tắc "admin không tự động có quyền" vừa áp dụng cho Hồ Sơ Nhân Sự/HĐLĐ/
// Lương (10/2026) — module này CHƯA có yêu cầu tương tự từ người dùng nên GIỮ NGUYÊN pattern chung của
// hệ thống (admin luôn có mọi quyền thao tác), chỉ tách biệt nhiệm vụ giữa các quyền THƯỜNG với nhau.

const VALID_TERM_TYPES = ['VOLUME_REBATE', 'GROWTH_REBATE', 'TRADE_SPEND', 'LISTING_FEE', 'EARLY_PAYMENT', 'DAMAGE_ALLOWANCE', 'NEW_STORE_SUPPORT'];
const VALID_CALC_BASIS = ['PURCHASE_VALUE', 'SELL_OUT_VALUE'];
const VALID_TIER_MODES = ['GRADUATED', 'CLIFF'];
const VALID_PERIOD_TYPES = ['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME'];
const VALID_SCOPE_TYPES = ['STORE_FORMAT', 'STORE', 'CATEGORY'];
const VALID_TERM_STATUSES = ['DRAFT', 'ACTIVE', 'EXPIRED', 'ARCHIVED'];

// ===================== Phân quyền (mục 8 tài liệu) =====================
function canManageVendors(user) {
  return !!(user?.perms?.admin || user?.perms?.rebateTermManage);
}
function canManageTerms(user) {
  return !!(user?.perms?.admin || user?.perms?.rebateTermManage);
}
function canActivateTerm(user) {
  return !!(user?.perms?.admin || user?.perms?.rebateTermActivate);
}
function canViewReport(user) {
  return !!(user?.perms?.admin || user?.perms?.rebateViewReport);
}
// canReconcile/canApprove (rebateReconcile/rebateApprove) khai báo sẵn quyền ở cây phân quyền (mục 8 tài
// liệu liệt kê đủ 5 quyền) nhưng CHƯA có luồng nghiệp vụ nào dùng tới ở Giai đoạn 1 (đối chiếu NCC/phê
// duyệt thuộc Giai đoạn 2-3) — khai báo hàm sẵn để Giai đoạn 2 gắn thẳng vào, không đổi tên quyền giữa chừng.
function canReconcile(user) {
  return !!(user?.perms?.admin || user?.perms?.rebateReconcile);
}
function canApprove(user) {
  return !!(user?.perms?.admin || user?.perms?.rebateApprove);
}

// ===================== Vendors =====================
function defaultVendor(vendorCode) {
  return {
    id: Date.now(),
    vendorCode: String(vendorCode || '').trim(),
    status: 'ACTIVE',
    vendorName: '',
    taxCode: '',
    contactOwnerUsername: null
  };
}

function validateVendorPayload(body, existingVendors, excludeId) {
  const vendorCode = String(body?.vendorCode || '').trim();
  const vendorName = String(body?.vendorName || '').trim();
  if (!vendorCode) return 'Vui lòng nhập Mã NCC';
  if (vendorCode.length > 30) return 'Mã NCC tối đa 30 ký tự';
  if (!/^[A-Za-z0-9_-]+$/.test(vendorCode)) return 'Mã NCC chỉ gồm chữ/số/gạch ngang/gạch dưới';
  if (!vendorName) return 'Vui lòng nhập Tên NCC';
  const dup = (existingVendors || []).find(v => v.vendorCode === vendorCode && v.id !== excludeId);
  if (dup) return `Mã NCC "${vendorCode}" đã tồn tại`;
  const taxCode = body?.taxCode ? String(body.taxCode).trim() : '';
  if (taxCode) {
    const dupTax = (existingVendors || []).find(v => v.taxCode && v.taxCode === taxCode && v.id !== excludeId);
    if (dupTax) return `Mã số thuế "${taxCode}" đã gán cho NCC khác`;
  }
  return null;
}

// ===================== RebateTerms (+ Tiers[]/Scopes[] nhúng trong Payload) =====================
function defaultRebateTerm(vendorId) {
  return {
    id: Date.now(),
    vendorId,
    status: 'DRAFT',
    termType: 'VOLUME_REBATE',
    termCode: '', termName: '',
    calcBasis: 'PURCHASE_VALUE',
    tierMode: 'GRADUATED',
    periodType: 'MONTHLY',
    version: 1,
    effectiveFrom: null, effectiveTo: null,
    isRetroactive: false,
    clonedFromTermId: null,
    tiers: [], scopes: [],
    history: []
  };
}

function validateTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return 'Điều khoản cần ít nhất 1 bậc thang';
  if (tiers.length > 20) return 'Tối đa 20 bậc thang cho 1 điều khoản';
  const seen = new Set();
  for (const t of tiers) {
    const from = Number(t?.fromAmount);
    const rate = Number(t?.ratePct);
    if (!Number.isFinite(from) || from < 0) return 'Mốc "Từ số tiền" của mỗi bậc phải là số >= 0';
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return 'Tỷ lệ % mỗi bậc phải trong khoảng 0-100';
    if (seen.has(from)) return `Trùng mốc "Từ số tiền" = ${from} giữa 2 bậc — mỗi bậc phải có mốc bắt đầu khác nhau`;
    seen.add(from);
  }
  return null;
}

function validateScopes(scopes) {
  if (!Array.isArray(scopes)) return 'Phạm vi áp dụng không hợp lệ';
  if (scopes.length > 50) return 'Tối đa 50 dòng phạm vi cho 1 điều khoản';
  for (const s of scopes) {
    if (!VALID_SCOPE_TYPES.includes(s?.scopeType)) return `Loại phạm vi "${s?.scopeType}" không hợp lệ`;
    if (!s?.scopeValue || !String(s.scopeValue).trim()) return 'Giá trị phạm vi không được để trống';
  }
  return null;
}

function validateRebateTermPayload(body) {
  const termCode = String(body?.termCode || '').trim();
  const termName = String(body?.termName || '').trim();
  if (!termCode) return 'Vui lòng nhập Mã Điều Khoản';
  if (termCode.length > 50) return 'Mã Điều Khoản tối đa 50 ký tự';
  if (!termName) return 'Vui lòng nhập Tên Điều Khoản';
  if (!VALID_TERM_TYPES.includes(body?.termType)) return `Loại điều khoản "${body?.termType}" không hợp lệ`;
  if (!VALID_CALC_BASIS.includes(body?.calcBasis)) return `Căn cứ tính "${body?.calcBasis}" không hợp lệ`;
  if (!VALID_TIER_MODES.includes(body?.tierMode)) return `Chế độ bậc thang "${body?.tierMode}" không hợp lệ`;
  if (!VALID_PERIOD_TYPES.includes(body?.periodType)) return `Kỳ tính "${body?.periodType}" không hợp lệ`;
  if (!body?.effectiveFrom) return 'Vui lòng chọn Ngày Hiệu Lực Từ';
  if (body?.effectiveTo && new Date(body.effectiveTo) < new Date(body.effectiveFrom)) {
    return 'Ngày Hiệu Lực Đến không được trước Ngày Hiệu Lực Từ';
  }
  const tierErr = validateTiers(body?.tiers);
  if (tierErr) return tierErr;
  const scopeErr = validateScopes(body?.scopes);
  if (scopeErr) return scopeErr;
  return null;
}

function checkDuplicateTermCode(termCode, vendorId, existingTerms, excludeId) {
  // TermCode duy nhất TRONG PHẠM VI 1 NCC (mục 2.1 tài liệu — 2 NCC khác nhau được phép trùng mã).
  const dup = (existingTerms || []).find(t => t.vendorId === vendorId && t.termCode === termCode && t.id !== excludeId);
  return dup ? `Mã Điều Khoản "${termCode}" đã tồn tại cho NCC này` : null;
}

// Vòng đời: DRAFT -> ACTIVE (rebateTermActivate riêng) -> EXPIRED (tự động khi qua effectiveTo, hoặc admin
// đánh dấu) / ARCHIVED (ngừng dùng thủ công). KHÔNG cho sửa Tiers/Scopes của điều khoản đã ACTIVE trực
// tiếp — phải "Nhân Bản" (Version+1, DRAFT) rồi kích hoạt bản mới, GIỮ NGUYÊN bản cũ để không làm sai
// lệch RebateCalculations đã tính trước đó (BasisAmountAtCalc/breakdown snapshot theo đúng Tiers tại thời
// điểm tính — sửa ngược Tiers của điều khoản cũ sẽ làm sai ý nghĩa các lần tính trước, cùng nguyên tắc đã
// áp dụng cho Checklist Đánh Giá Siêu Thị/mẫu Đang Dùng, xem Huong-dan-nghiep-vu.md mục 4.7).
function assertValidTermTransition(term, nextStatus) {
  const transitions = { DRAFT: ['ACTIVE', 'ARCHIVED'], ACTIVE: ['EXPIRED', 'ARCHIVED'], EXPIRED: ['ARCHIVED'], ARCHIVED: [] };
  if (!VALID_TERM_STATUSES.includes(nextStatus)) throw new (require('./httpErrors').HttpError)(400, `Trạng thái "${nextStatus}" không hợp lệ`);
  if (!(transitions[term.status] || []).includes(nextStatus)) {
    throw new (require('./httpErrors').HttpError)(409, `Không thể chuyển điều khoản từ "${term.status}" sang "${nextStatus}"`);
  }
}

function cloneTermAsDraft(term, username) {
  const clone = JSON.parse(JSON.stringify(term));
  clone.id = Date.now();
  clone.status = 'DRAFT';
  clone.version = (term.version || 1) + 1;
  clone.clonedFromTermId = term.id;
  clone.history = [...(term.history || []), { action: 'CLONED', by: username, time: new Date().toLocaleString('vi-VN'), detail: `Nhân bản từ điều khoản #${term.id} (v${term.version || 1})` }];
  return clone;
}

// ===================== Tính toán (Aggregator + Calculator) =====================
const { aggregateBasisAmount } = require('./purchaseBasisAggregator');
const { calculateTieredRebate } = require('./tieredCalculator');

// purchaseTransactions: mảng { vendorCode, storeCode, storeFormat, categoryCode, purchaseDate, amount, isReturn }
// (đã đọc từ dbo.VendorPurchaseTransactions, xem lib/vendorPurchaseStore.js) — hàm này THUẦN, không tự
// đọc DB, để dễ kiểm thử độc lập (mirror đúng cách tieredCalculator.js/purchaseBasisAggregator.js đã
// được kiểm thử trong tài liệu gốc).
function computeRebateEstimate({ vendor, term, purchaseTransactions, periodStart, periodEnd }) {
  const { basisAmount, detail } = aggregateBasisAmount(purchaseTransactions, {
    vendorCode: vendor.vendorCode, periodStart, periodEnd, scopes: term.scopes || []
  });
  const { rebateAmount, breakdown } = calculateTieredRebate(basisAmount, term.tiers || [], term.tierMode);
  return { basisAmount, aggregateDetail: detail, rebateAmount, breakdown };
}

module.exports = {
  VALID_TERM_TYPES, VALID_CALC_BASIS, VALID_TIER_MODES, VALID_PERIOD_TYPES, VALID_SCOPE_TYPES, VALID_TERM_STATUSES,
  canManageVendors, canManageTerms, canActivateTerm, canViewReport, canReconcile, canApprove,
  defaultVendor, validateVendorPayload,
  defaultRebateTerm, validateTiers, validateScopes, validateRebateTermPayload, checkDuplicateTermCode,
  assertValidTermTransition, cloneTermAsDraft,
  computeRebateEstimate
};
