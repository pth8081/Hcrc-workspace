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
// ENTITY/CHANNEL thêm 10/2026 (mở rộng theo file Điều Khoản Thương Mại/Tính BAS người dùng cung cấp) —
// ENTITY lọc đúng phạm vi 1 pháp nhân (VD BRG/Fuji, xem Entity ở dbo.VendorPurchaseTransactions), CHANNEL
// lọc đúng phạm vi mua hàng qua Kho Trung Tâm (DC) hay mua trực tiếp (xem IsViaDC) — mirror đúng khuôn
// matchesScope() hiện có (lib/purchaseBasisAggregator.js), KHÔNG đổi 3 scopeType cũ.
const VALID_SCOPE_TYPES = ['STORE_FORMAT', 'STORE', 'CATEGORY', 'ENTITY', 'CHANNEL'];
const VALID_TERM_STATUSES = ['DRAFT', 'ACTIVE', 'EXPIRED', 'ARCHIVED'];
// amountMode thêm 10/2026: phần lớn điều khoản là % theo bậc thang trên doanh số (PERCENT_TIERED, hành vi
// GỐC — giữ nguyên mặc định để không đổi hành vi điều khoản cũ), nhưng nhiều dòng trong Điều Khoản Thương
// Mại thực tế là SỐ TIỀN CỐ ĐỊNH/kỳ (VD "Phí tạo mã mới", "Thuê mướn...") không phụ thuộc doanh số —
// FIXED_LUMP_SUM cho đúng nhóm này, có thể kèm phân bổ đa pháp nhân (allocationMode).
const VALID_AMOUNT_MODES = ['PERCENT_TIERED', 'FIXED_LUMP_SUM'];
// allocationMode CHỈ có ý nghĩa khi amountMode=FIXED_LUMP_SUM — chia 1 số tiền cố định cho nhiều pháp
// nhân (VD BRG/Fuji cùng hưởng 1 khoản hỗ trợ của NCC) theo đúng tỷ trọng thực nhập của mỗi pháp nhân
// trong kỳ (PRORATA_BY_ENTITY), hoặc gán nguyên 100% cho 1 pháp nhân chỉ định (FULL_TO_ENTITY) — đúng 2
// cách phân bổ quan sát được ở sheet "Tính BAS" (cột BF-BR) của file người dùng cung cấp.
const VALID_ALLOCATION_MODES = ['NONE', 'PRORATA_BY_ENTITY', 'FULL_TO_ENTITY'];

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
    // Mặc định GIỮ NGUYÊN hành vi gốc (PERCENT_TIERED/includedInBas=true/allocationMode=NONE) — mọi điều
    // khoản tạo TRƯỚC bản mở rộng 10/2026 đọc lại vẫn coi như các field này ở đúng giá trị mặc định này
    // (xem các điểm đọc `term.amountMode || 'PERCENT_TIERED'`/`term.includedInBas !== false` tương ứng).
    includedInBas: true,
    amountMode: 'PERCENT_TIERED',
    fixedAmount: 0,
    allocationMode: 'NONE',
    allocationEntities: [],
    allocationTargetEntity: null,
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
  // amountMode/allocationMode thêm 10/2026 — body?.amountMode thiếu (điều khoản cũ trước bản mở rộng,
  // hoặc client cũ chưa gửi field này) coi như 'PERCENT_TIERED' (hành vi gốc, giữ nguyên validateTiers
  // bắt buộc như trước), KHÔNG chặn lỗi vì thiếu field mới.
  const amountMode = body?.amountMode || 'PERCENT_TIERED';
  if (!VALID_AMOUNT_MODES.includes(amountMode)) return `Phương thức tính "${amountMode}" không hợp lệ`;
  if (amountMode === 'PERCENT_TIERED') {
    const tierErr = validateTiers(body?.tiers);
    if (tierErr) return tierErr;
  } else {
    // FIXED_LUMP_SUM: số tiền cố định/kỳ, KHÔNG cần bậc thang (đúng bản chất "Phí tạo mã mới"/"Thuê
    // mướn..." trong Điều Khoản Thương Mại — không phụ thuộc doanh số).
    const fixedAmount = Number(body?.fixedAmount);
    if (!Number.isFinite(fixedAmount) || fixedAmount < 0) return 'Vui lòng nhập Số Tiền Cố Định (số >= 0) cho điều khoản dạng Số Tiền Cố Định';
    const allocationMode = body?.allocationMode || 'NONE';
    if (!VALID_ALLOCATION_MODES.includes(allocationMode)) return `Cách phân bổ "${allocationMode}" không hợp lệ`;
    if (allocationMode === 'PRORATA_BY_ENTITY') {
      const entities = body?.allocationEntities;
      if (!Array.isArray(entities) || entities.length < 2 || entities.some(e => !e || !String(e).trim())) {
        return 'Phân bổ theo tỷ trọng cần khai báo ít nhất 2 pháp nhân (allocationEntities)';
      }
    }
    if (allocationMode === 'FULL_TO_ENTITY' && !String(body?.allocationTargetEntity || '').trim()) {
      return 'Vui lòng chọn Pháp Nhân nhận toàn bộ (allocationTargetEntity)';
    }
  }
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

// Tìm tỷ lệ % ĐÃ ĐẠT theo kiểu CLIFF (mốc cao nhất mà "value" đạt tới) — dùng RIÊNG cho GROWTH_REBATE
// (xem computeRebateEstimate() bên dưới): bậc thang của điều khoản tăng trưởng mang Ý NGHĨA KHÁC bậc
// thang VOLUME_REBATE thường (fromAmount ở đây là % TĂNG TRƯỞNG so kỳ liền trước, không phải số tiền mua
// hàng tuyệt đối) — KHÔNG gọi calculateTieredRebate() (lib/tieredCalculator.js, đã kiểm thử thật bởi
// người dùng, không sửa logic) vì hàm đó LUÔN nhân ngược "value" đầu vào với rate% để ra rebateAmount,
// sai đơn vị nếu value là % tăng trưởng thay vì số tiền. Luôn áp dụng kiểu CLIFF (đạt mốc nào tính rate đó
// cho toàn bộ) bất kể term.tierMode — GRADUATED không có ý nghĩa nghiệp vụ rõ ràng cho 1 mốc %, xác nhận
// lại với người dùng nếu cần hỗ trợ thêm sau này.
function findAchievedGrowthRate(growthPct, tiers) {
  const sorted = [...(tiers || [])].sort((a, b) => a.fromAmount - b.fromAmount);
  let rate = 0;
  for (const tier of sorted) {
    if (growthPct >= tier.fromAmount) rate = tier.ratePct;
  }
  return rate;
}

// Phân bổ 1 số tiền cố định (FIXED_LUMP_SUM) cho nhiều pháp nhân theo tỷ trọng thực nhập (PRORATA_BY_ENTITY)
// hoặc gán nguyên cho 1 pháp nhân (FULL_TO_ENTITY) — mirror đúng cột BF-BR "Tính BAS" (phân bổ fix amount
// cho riêng BRG, có khoản 100%, có khoản theo tỷ trọng) trong file người dùng cung cấp. CHỦ Ý CHỈ lọc theo
// ENTITY (không gộp thêm term.scopes khác) — matchesScope() ghép nhiều scope theo kiểu "khớp 1 trong các
// scope" (OR), ghép thêm điều kiện ENTITY vào scopes gốc sẽ biến thành "khớp Entity HOẶC khớp scope gốc"
// (sai ý "VÀ"), không phải hạn chế thật của nghiệp vụ — các điều khoản FIXED_LUMP_SUM quan sát được trong
// Điều Khoản Thương Mại thực tế đều không kèm scope phạm vi cửa hàng/ngành hàng khác.
function allocateFixedAmountByEntity(fixedAmount, term, purchaseTransactions, vendorCode, periodStart, periodEnd) {
  const allocationMode = term.allocationMode || 'NONE';
  if (allocationMode === 'FULL_TO_ENTITY' && term.allocationTargetEntity) {
    return [{ entity: term.allocationTargetEntity, purchaseAmount: null, ratio: 1, allocatedAmount: fixedAmount }];
  }
  if (allocationMode === 'PRORATA_BY_ENTITY' && Array.isArray(term.allocationEntities) && term.allocationEntities.length >= 2) {
    const totalsByEntity = {};
    let grandTotal = 0;
    for (const entity of term.allocationEntities) {
      const { basisAmount: entityBasis } = aggregateBasisAmount(purchaseTransactions, {
        vendorCode, periodStart, periodEnd, scopes: [{ scopeType: 'ENTITY', scopeValue: entity }]
      });
      totalsByEntity[entity] = entityBasis;
      grandTotal += entityBasis;
    }
    return term.allocationEntities.map(entity => {
      const ratio = grandTotal > 0 ? totalsByEntity[entity] / grandTotal : 0;
      return { entity, purchaseAmount: totalsByEntity[entity], ratio, allocatedAmount: fixedAmount * ratio };
    });
  }
  return null; // allocationMode='NONE' -> không chia, toàn bộ fixedAmount tính 1 khối cho NCC (không theo pháp nhân)
}

// purchaseTransactions: mảng { vendorCode, storeCode, storeFormat, categoryCode, purchaseDate, amount, isReturn }
// (đã đọc từ dbo.VendorPurchaseTransactions, xem lib/vendorPurchaseStore.js) — hàm này THUẦN, không tự
// đọc DB, để dễ kiểm thử độc lập (mirror đúng cách tieredCalculator.js/purchaseBasisAggregator.js đã
// được kiểm thử trong tài liệu gốc).
//
// previousPeriodStart/previousPeriodEnd (thêm 10/2026): CHỈ cần truyền khi term.termType==='GROWTH_REBATE'
// (routes/purchasing.js tự tính kỳ liền trước cùng độ dài trước khi gọi) — purchaseTransactions LÚC ĐÓ
// phải đã bao trùm CẢ kỳ hiện tại lẫn kỳ liền trước (route tự mở rộng khoảng truy vấn), hàm này tự lọc lại
// đúng từng kỳ qua 2 lượt gọi aggregateBasisAmount() riêng.
function computeRebateEstimate({ vendor, term, purchaseTransactions, periodStart, periodEnd, previousPeriodStart, previousPeriodEnd }) {
  const { basisAmount, detail } = aggregateBasisAmount(purchaseTransactions, {
    vendorCode: vendor.vendorCode, periodStart, periodEnd, scopes: term.scopes || []
  });

  if ((term.amountMode || 'PERCENT_TIERED') === 'FIXED_LUMP_SUM') {
    const fixedAmount = Number(term.fixedAmount) || 0;
    const entityAllocation = allocateFixedAmountByEntity(fixedAmount, term, purchaseTransactions, vendor.vendorCode, periodStart, periodEnd);
    return {
      basisAmount, aggregateDetail: detail, rebateAmount: fixedAmount,
      breakdown: entityAllocation ? [{ fixedAmount, entityAllocation }] : [{ fixedAmount }],
      entityAllocation
    };
  }

  if (term.termType === 'GROWTH_REBATE') {
    const prev = aggregateBasisAmount(purchaseTransactions, {
      vendorCode: vendor.vendorCode, periodStart: previousPeriodStart, periodEnd: previousPeriodEnd, scopes: term.scopes || []
    });
    const prevBasisAmount = prev.basisAmount;
    // prevBasisAmount=0: không có cơ sở so sánh % thật (chia 0) — coi như "tăng trưởng 100%" nếu kỳ này
    // có doanh số (NCC mới phát sinh/mới qua ngưỡng), hoặc 0% nếu cả 2 kỳ đều không có doanh số.
    const growthPct = prevBasisAmount > 0 ? ((basisAmount - prevBasisAmount) / prevBasisAmount) * 100 : (basisAmount > 0 ? 100 : 0);
    const achievedRatePct = findAchievedGrowthRate(growthPct, term.tiers || []);
    const rebateAmount = basisAmount * achievedRatePct / 100;
    return {
      basisAmount, aggregateDetail: detail, rebateAmount,
      breakdown: [{ prevBasisAmount, prevAggregateDetail: prev.detail, growthPct, achievedRatePct }]
    };
  }

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
//   - termType='GROWTH_REBATE' (Chiết Khấu Theo Tăng Trưởng): ĐÃ XÁC NHẬN với người dùng (10/2026) công
//     thức so với KỲ LIỀN TRƯỚC (không phải cùng kỳ năm trước) — xem computeRebateEstimate()/
//     findAchievedGrowthRate() phía trên: tính % tăng trưởng basisAmount kỳ này so kỳ liền trước cùng độ
//     dài (routes/purchasing.js tự tính previousPeriodStart/End), tra bậc thang CLIFF theo % tăng trưởng
//     đó ra rate đã đạt, áp dụng rate lên basisAmount KỲ NÀY (không áp lên phần tăng thêm) — ĐÃ GỠ khỏi
//     UNSUPPORTED_TERM_TYPES.
//   - periodType (MONTHLY/QUARTERLY/YEARLY/ONE_TIME): TRƯỚC ĐÂY hoàn toàn không đối chiếu với khoảng
//     periodStart/periodEnd người dùng chọn lúc "Tính Ước Tính" — chọn periodType=MONTHLY nhưng tính cho
//     nguyên 1 năm vẫn chạy bình thường không cảnh báo. Đây là phần DỄ SỬA ĐÚNG nhất (không cần thêm
//     nguồn dữ liệu/công thức mới, chỉ đối chiếu độ dài kỳ) — validatePeriodMatchesPeriodType() bên dưới,
//     gọi từ POST /terms/:id/calculate (routes/purchasing.js).
const UNSUPPORTED_CALC_BASIS = new Set(['SELL_OUT_VALUE']);
const UNSUPPORTED_TERM_TYPES = new Set([]);
function assertCalcBasisAndTermTypeSupported(calcBasis, termType) {
  if (UNSUPPORTED_CALC_BASIS.has(calcBasis)) {
    return `Căn cứ tính "Giá Trị Bán Ra" (SELL_OUT_VALUE) CHƯA được hệ thống hỗ trợ tính tự động (chưa có nguồn dữ liệu doanh số bán ra) — vui lòng chọn "Giá Trị Mua Hàng" (PURCHASE_VALUE), hoặc đối soát thủ công ngoài hệ thống cho tới khi được bổ sung.`;
  }
  if (UNSUPPORTED_TERM_TYPES.has(termType)) {
    return `Loại điều khoản "${termType}" CHƯA được hệ thống hỗ trợ tính tự động.`;
  }
  return null;
}

// Tính kỳ LIỀN TRƯỚC cùng độ dài với [periodStart, periodEnd] (cả 2 dạng YYYY-MM-DD) — dùng CHO
// GROWTH_REBATE (routes/purchasing.js gọi TRƯỚC khi truy vấn purchaseTransactions, để mở rộng khoảng
// truy vấn bao trùm luôn kỳ liền trước). VD kỳ 2026-03-01→2026-03-31 (31 ngày) -> kỳ liền trước
// 2026-01-29→2026-02-28 (31 ngày, kết thúc đúng 1 ngày trước periodStart).
function computePreviousPeriod(periodStart, periodEnd) {
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(`${periodEnd}T00:00:00Z`);
  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 24 * 3600 * 1000);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { previousPeriodStart: prevStart.toISOString().slice(0, 10), previousPeriodEnd: prevEnd.toISOString().slice(0, 10) };
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
  VALID_AMOUNT_MODES, VALID_ALLOCATION_MODES,
  canManageVendors, canManageTerms, canActivateTerm, canViewReport, canReconcile, canApprove,
  defaultVendor, validateVendorPayload,
  defaultRebateTerm, validateTiers, validateScopes, validateRebateTermPayload, checkDuplicateTermCode,
  assertValidTermTransition, cloneTermAsDraft,
  computeRebateEstimate, findAchievedGrowthRate, allocateFixedAmountByEntity, computePreviousPeriod,
  UNSUPPORTED_CALC_BASIS, UNSUPPORTED_TERM_TYPES, assertCalcBasisAndTermTypeSupported, validatePeriodMatchesPeriodType
};
