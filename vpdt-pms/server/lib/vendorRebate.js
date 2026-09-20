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
    // LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): Number(null)/Number(undefined) trả về 0 (hữu hạn, hợp
    // lệ trong khoảng 0-100) — nếu client gửi lên ratePct thiếu/null (VD do JSON.stringify(NaN)=>null khi
    // gõ sai định dạng có dấu phẩy thập phân) thì guard cũ ÂM THẦM chấp nhận thành 0% thay vì báo lỗi rõ
    // ràng. Chặn rõ giá trị null/undefined/rỗng TRƯỚC khi ép kiểu số, không để lẫn với "cố ý nhập 0%" hợp lệ.
    if (t?.ratePct === null || t?.ratePct === undefined || t?.ratePct === '') {
      return 'Vui lòng nhập Tỷ lệ % cho mỗi bậc thang';
    }
    const rate = Number(t.ratePct);
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
  // LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Cao — phát hiện #3): chặn NGAY tại validate chung (áp
  // dụng CẢ tạo mới lẫn sửa) — xem chú thích đầy đủ ở assertCalcBasisAndTermTypeSupported() phía dưới.
  const unsupportedErr = assertCalcBasisAndTermTypeSupported(body?.calcBasis, body?.termType);
  if (unsupportedErr) return unsupportedErr;
  if (!VALID_TIER_MODES.includes(body?.tierMode)) return `Chế độ bậc thang "${body?.tierMode}" không hợp lệ`;
  if (!VALID_PERIOD_TYPES.includes(body?.periodType)) return `Kỳ tính "${body?.periodType}" không hợp lệ`;
  if (!body?.effectiveFrom) return 'Vui lòng chọn Ngày Hiệu Lực Từ';
  // LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Trung bình): 2 field này TRƯỚC ĐÂY không hề ép định
  // dạng — nhưng mọi nơi TIÊU THỤ chúng lại so sánh bằng CHUỖI lexicographic (POST /terms/:id/calculate
  // ở routes/purchasing.js: `periodStart < term.effectiveFrom`/`periodEnd > term.effectiveTo`), vốn chỉ
  // đúng thứ tự thời gian khi CẢ 2 vế cùng khuôn YYYY-MM-DD. Một điều khoản lỡ lưu "1/3/2026" hay
  // "2026-3-1" sẽ làm phép so sánh ra kết quả SAI ÂM THẦM (VD "2026-03-01" > "1/3/2026" luôn đúng ->
  // chặn/mở sai kỳ tính). Ép đúng YYYY-MM-DD ngay tại điểm validate chung của CẢ tạo mới (createValidation.js
  // rebateTerms.extraValidate) lẫn sửa (POST /terms/:id/edit) — cùng khuôn DATE_RE đã dùng cho
  // periodStart/periodEnd ở routes/purchasing.js.
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const isRealDate = (s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  };
  if (!ISO_DATE_RE.test(String(body.effectiveFrom)) || !isRealDate(String(body.effectiveFrom))) {
    return 'Ngày Hiệu Lực Từ phải đúng định dạng YYYY-MM-DD (VD 2026-03-01)';
  }
  if (body?.effectiveTo && (!ISO_DATE_RE.test(String(body.effectiveTo)) || !isRealDate(String(body.effectiveTo)))) {
    return 'Ngày Hiệu Lực Đến phải đúng định dạng YYYY-MM-DD (VD 2026-12-31)';
  }
  if (body?.effectiveTo && String(body.effectiveTo) < String(body.effectiveFrom)) {
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

// Vòng đời: DRAFT -> ACTIVE (rebateTermActivate riêng) -> EXPIRED (CHỈ admin tự đánh dấu qua
// POST /terms/:id/expire) / ARCHIVED (ngừng dùng thủ công).
// LỖI ĐÃ VÁ (rà soát chuyên sâu Vận Hành/Mua Hàng, 9/2026): comment cũ ở đây từng ghi nhầm "EXPIRED tự
// động khi qua effectiveTo" nhưng KHÔNG hề có job/cron nào làm việc này — điều khoản qua effectiveTo vẫn
// giữ nguyên status ACTIVE vô thời hạn tới khi người quản lý tự bấm "⏳ Hết Hạn". Để bù lại việc KHÔNG
// tự chuyển trạng thái, POST /terms/:id/calculate (routes/purchasing.js) tự chặn/từ chối nếu kỳ tính
// (periodStart/periodEnd) nằm NGOÀI effectiveFrom/effectiveTo của điều khoản — không phụ thuộc status
// ACTIVE có còn đúng hay đã bị bỏ quên chưa đánh dấu hết hạn.
// KHÔNG cho sửa Tiers/Scopes của điều khoản đã ACTIVE trực
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

// ===================== LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Cao — phát hiện #3) =====================
// computeRebateEstimate() TRƯỚC ĐÂY luôn gộp từ dbo.VendorPurchaseTransactions (dữ liệu MUA HÀNG) rồi áp
// bậc thang PHẲNG, bất kể calcBasis/termType/periodType/isRetroactive:
//   - calcBasis='SELL_OUT_VALUE' (Giá Trị Bán Ra): KHÔNG nơi nào trong hệ thống có nguồn dữ liệu "doanh
//     số bán ra" (đã grep toàn bộ lib/routes, chỉ có VendorPurchaseTransactions = dữ liệu MUA HÀNG từ
//     DSmart/nhập tay) — chọn calcBasis này rồi tính vẫn ÂM THẦM dùng dữ liệu MUA HÀNG, ra số SAI hẳn ý
//     nghĩa nghiệp vụ mà không ai biết. QUYẾT ĐỊNH: CHẶN chọn calcBasis='SELL_OUT_VALUE' ở validate (tạo/
//     sửa điều khoản) — an toàn hơn tính sai âm thầm; khi hệ thống có nguồn dữ liệu Giá Trị Bán Ra thật,
//     gỡ chặn ở đây + bổ sung aggregator riêng cho SELL_OUT_VALUE.
//   - termType='GROWTH_REBATE' (Chiết Khấu Theo Tăng Trưởng): công thức đúng cần SO SÁNH VỚI KỲ TRƯỚC
//     (basisAmount kỳ này so với kỳ liền trước cùng độ dài) nhưng computeRebateEstimate() tính Y HỆT
//     VOLUME_REBATE (bỏ qua hoàn toàn việc so kỳ trước) — ngữ nghĩa CHÍNH XÁC của "tăng trưởng" (so % hay
//     so số tuyệt đối, "kỳ trước" là kỳ liền kề hay cùng kỳ năm trước) chưa được xác nhận rõ với người
//     dùng, và tự suy đoán rồi cài đặt có thể SAI theo hướng khác — an toàn hơn là CHẶN tương tự
//     SELL_OUT_VALUE cho tới khi xác nhận đúng công thức nghiệp vụ, tránh 1 lựa chọn âm thầm tính sai.
//   - periodType (MONTHLY/QUARTERLY/YEARLY/ONE_TIME): TRƯỚC ĐÂY hoàn toàn không đối chiếu với khoảng
//     periodStart/periodEnd người dùng chọn lúc "Tính Ước Tính" — chọn periodType=MONTHLY nhưng tính cho
//     nguyên 1 năm vẫn chạy bình thường không cảnh báo. Đây là phần DỄ SỬA ĐÚNG nhất (không cần thêm
//     nguồn dữ liệu/công thức mới, chỉ đối chiếu độ dài kỳ) — validatePeriodMatchesPeriodType() bên dưới,
//     gọi từ POST /terms/:id/calculate (routes/purchasing.js).
const UNSUPPORTED_CALC_BASIS = new Set(['SELL_OUT_VALUE']);
const UNSUPPORTED_TERM_TYPES = new Set(['GROWTH_REBATE']);
function assertCalcBasisAndTermTypeSupported(calcBasis, termType) {
  if (UNSUPPORTED_CALC_BASIS.has(calcBasis)) {
    return `Căn cứ tính "Giá Trị Bán Ra" (SELL_OUT_VALUE) CHƯA được hệ thống hỗ trợ tính tự động (chưa có nguồn dữ liệu doanh số bán ra) — vui lòng chọn "Giá Trị Mua Hàng" (PURCHASE_VALUE), hoặc đối soát thủ công ngoài hệ thống cho tới khi được bổ sung.`;
  }
  if (UNSUPPORTED_TERM_TYPES.has(termType)) {
    return `Loại điều khoản "Chiết Khấu Theo Tăng Trưởng" (GROWTH_REBATE) CHƯA được hệ thống hỗ trợ tính tự động (cần so sánh với kỳ trước, chưa xác nhận đúng công thức nghiệp vụ) — vui lòng chọn loại điều khoản khác, hoặc đối soát thủ công ngoài hệ thống cho tới khi được bổ sung.`;
  }
  return null;
}

// LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Cao — phát hiện #3, phần periodType): đối chiếu ĐỘ DÀI kỳ
// tính (periodStart/periodEnd người dùng chọn lúc "Tính Ước Tính") với periodType đã khai báo trên điều
// khoản — chặn nếu kỳ tính không khớp đúng 1 tháng/1 quý/1 năm dương lịch tương ứng. ONE_TIME không ràng
// buộc gì (đúng bản chất "1 lần", độ dài tuỳ ý theo thoả thuận).
function validatePeriodMatchesPeriodType(periodType, periodStart, periodEnd) {
  if (periodType === 'ONE_TIME') return null;
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(`${periodEnd}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null; // đã ép định dạng ở tầng route, không lặp lại validate ở đây
  const sy = start.getUTCFullYear(), sm = start.getUTCMonth();
  const ey = end.getUTCFullYear(), em = end.getUTCMonth();
  if (periodType === 'MONTHLY') {
    if (sy !== ey || sm !== em) {
      return `Điều khoản có Kỳ Tính "Hàng Tháng" — periodStart/periodEnd (${periodStart} → ${periodEnd}) phải nằm trong CÙNG 1 tháng dương lịch`;
    }
    return null;
  }
  if (periodType === 'QUARTERLY') {
    const sq = Math.floor(sm / 3), eq = Math.floor(em / 3);
    if (sy !== ey || sq !== eq) {
      return `Điều khoản có Kỳ Tính "Hàng Quý" — periodStart/periodEnd (${periodStart} → ${periodEnd}) phải nằm trong CÙNG 1 quý dương lịch`;
    }
    return null;
  }
  if (periodType === 'YEARLY') {
    if (sy !== ey) {
      return `Điều khoản có Kỳ Tính "Hàng Năm" — periodStart/periodEnd (${periodStart} → ${periodEnd}) phải nằm trong CÙNG 1 năm dương lịch`;
    }
    return null;
  }
  return null;
}

module.exports = {
  VALID_TERM_TYPES, VALID_CALC_BASIS, VALID_TIER_MODES, VALID_PERIOD_TYPES, VALID_SCOPE_TYPES, VALID_TERM_STATUSES,
  canManageVendors, canManageTerms, canActivateTerm, canViewReport, canReconcile, canApprove,
  defaultVendor, validateVendorPayload,
  defaultRebateTerm, validateTiers, validateScopes, validateRebateTermPayload, checkDuplicateTermCode,
  assertValidTermTransition, cloneTermAsDraft,
  computeRebateEstimate,
  UNSUPPORTED_CALC_BASIS, UNSUPPORTED_TERM_TYPES, assertCalcBasisAndTermTypeSupported, validatePeriodMatchesPeriodType
};
