// routes/purchasing.js — Module TOP-LEVEL "🛒 Mua Hàng" > BAS (Basis — Cơ Sở Tính Chiết Khấu/Thưởng NCC),
// v23.30. Route RIÊNG (không qua routes/records.js chung, mirror đúng lý do routes/checklist.js đã tách
// riêng) vì có nhiều hành động vòng đời + 2 tác vụ nặng đặc thù (đồng bộ DSmart, tính ước tính rebate)
// không khớp khuôn CRUD sinh/sửa/xoá đơn giản của routes/records.js.
//
// POST /api/create/vendors và /api/create/rebateTerms (routes/create.js, generic) TẠO MỚI — mọi thao tác
// còn lại (sửa/kích hoạt/lưu trữ/nhân bản điều khoản; đồng bộ dữ liệu mua hàng; tính ước tính rebate) ở
// đây. vendors/rebateTerms/rebateCalculations bị loại khỏi vòng phát TOÀN BỘ của GET /api/data (xem
// routes/data.js) — MỌI đường đọc dữ liệu ở module này đều đi qua route có gác quyền bên dưới, không có
// đường nào phát company-wide không kiểm tra quyền (OWASP A01 — Broken Access Control).
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError, sendServerError } = require('../lib/errorResponse');
const { getAllForCollection, insertRecord, withLockedRecordForCollection, withAppLock } = require('../lib/recordStore');
const { insertSystemLog } = require('../lib/systemLogStore');
const vendorRebate = require('../lib/vendorRebate');
const { fetchAllPurchases } = require('../lib/dsmartApiClient');
const {
  bulkInsertPurchaseTransactions, queryPurchaseTransactionsForVendor, queryPurchaseTransactionsForExport,
  insertPurchaseSyncLog, getRecentPurchaseSyncLogs, getLastSuccessfulSyncStart
} = require('../lib/vendorPurchaseStore');
const {
  buildPurchaseTransactionTemplateWorkbook, parsePurchaseTransactionImportXlsx, buildPurchaseTransactionExportWorkbook
} = require('../lib/purchasingManualImport');
const { verifyFileSignature } = require('../lib/fileSignature');
const uploadRateLimiter = require('../lib/uploadRateLimiter');

router.use(requireAuth, blockIfMustChangePassword);

function requireManageVendors(req, res, next) {
  if (!vendorRebate.canManageVendors(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý Nhà Cung Cấp' });
  }
  next();
}
function requireManageTerms(req, res, next) {
  if (!vendorRebate.canManageTerms(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý Điều Khoản Chiết Khấu' });
  }
  next();
}
function requireActivateTerm(req, res, next) {
  if (!vendorRebate.canActivateTerm(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền kích hoạt Điều Khoản Chiết Khấu' });
  }
  next();
}
// Đọc danh sách/lịch sử (không sửa gì): CHO PHÉP bất kỳ quyền nào trong 5 quyền module này — đúng người
// chỉ được cấp rebateViewReport vẫn cần xem được Vendors/Terms để đọc hiểu báo cáo, không riêng gì người
// quản lý/kích hoạt.
function requireAnyPurchasingAccess(req, res, next) {
  const u = req.freshUser;
  const ok = vendorRebate.canManageVendors(u) || vendorRebate.canManageTerms(u) || vendorRebate.canActivateTerm(u)
    || vendorRebate.canViewReport(u) || vendorRebate.canReconcile(u) || vendorRebate.canApprove(u);
  if (!ok) return res.status(403).json({ error: 'Bạn không có quyền truy cập module Mua Hàng' });
  next();
}
router.use(requireAnyPurchasingAccess);

function logPurchasing(req, actionType, targetObject, description) {
  insertSystemLog({
    username: req.freshUser.username, fullName: req.freshUser.name,
    ipAddress: req.ip, module: 'PURCHASING', actionType, targetObject, description, status: 'SUCCESS'
  }).catch(err => console.error('Ghi log Mua Hàng lỗi:', err.message));
}

// ===================== Vendors =====================
router.get('/vendors', async (req, res) => {
  try {
    const vendors = await getAllForCollection('vendors');
    res.json({ ok: true, items: vendors });
  } catch (err) { sendServerError(res, 500, err, 'GET /api/purchasing/vendors'); }
});

// LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Thấp — phát hiện #12): getAllForCollection('vendors') +
// validateVendorPayload() (kiểm trùng Mã Số Thuế) TRƯỚC ĐÂY chạy TRƯỚC withLockedRecordForCollection() —
// đọc XONG rồi mới khoá, nên 2 request sửa 2 NCC KHÁC NHAU thành CÙNG 1 taxCode gần như đồng thời đều đọc
// được danh sách "chưa ai trùng MST này" trước khi cái nào kịp ghi, cả 2 đều qua được check rồi cùng ghi
// -> 2 NCC trùng MST (không có UNIQUE INDEX cấp DB cho TaxCode vì field này optional, nhiều NCC có thể để
// trống). Di chuyển kiểm tra trùng MST vào BÊN TRONG 1 khoá ghi chung (withAppLock('vendors_write')) —
// đọc lại danh sách vendors FRESH ngay trong khoá trước khi validate trùng, khoá này giữ tới hết khi ghi
// xong (withLockedRecordForCollection lồng bên trong dùng khoá khác theo id, không xung đột resource).
router.post('/vendors/:id/edit', requireManageVendors, async (req, res) => {
  const vendorId = Number(req.params.id);
  if (!Number.isFinite(vendorId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const updated = await withAppLock('vendors_write', async () => {
      const vendors = await getAllForCollection('vendors');
      const err = vendorRebate.validateVendorPayload(req.body, vendors, vendorId);
      if (err) throw new HttpError(err.includes('đã tồn tại') || err.includes('đã gán') ? 409 : 400, err);
      return withLockedRecordForCollection('vendors', vendorId, (v) => ({
        ...v,
        vendorName: String(req.body.vendorName).trim(),
        taxCode: req.body.taxCode ? String(req.body.taxCode).trim().slice(0, 20) : '',
        contactOwnerUsername: req.body.contactOwnerUsername || null
      }));
    });
    logPurchasing(req, 'EDIT_VENDOR', updated.vendorCode, `Sửa thông tin NCC ${updated.vendorCode}`);
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, `vendors/${req.params.id}/edit`); }
});

router.post('/vendors/:id/deactivate', requireManageVendors, async (req, res) => {
  const vendorId = Number(req.params.id);
  if (!Number.isFinite(vendorId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const updated = await withLockedRecordForCollection('vendors', vendorId, (v) => {
      if (v.status !== 'ACTIVE') throw new HttpError(409, 'Chỉ ngừng được NCC đang Hoạt động');
      return { ...v, status: 'INACTIVE' };
    });
    logPurchasing(req, 'DEACTIVATE_VENDOR', updated.vendorCode, `Ngừng hoạt động NCC ${updated.vendorCode}`);
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, `vendors/${req.params.id}/deactivate`); }
});

router.post('/vendors/:id/activate', requireManageVendors, async (req, res) => {
  const vendorId = Number(req.params.id);
  if (!Number.isFinite(vendorId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const updated = await withLockedRecordForCollection('vendors', vendorId, (v) => {
      if (v.status !== 'INACTIVE') throw new HttpError(409, 'Chỉ mở lại được NCC đang Ngừng hoạt động');
      return { ...v, status: 'ACTIVE' };
    });
    logPurchasing(req, 'ACTIVATE_VENDOR', updated.vendorCode, `Mở lại NCC ${updated.vendorCode}`);
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, `vendors/${req.params.id}/activate`); }
});

// ===================== RebateTerms =====================
router.get('/terms', async (req, res) => {
  try {
    const terms = await getAllForCollection('rebateTerms');
    res.json({ ok: true, items: terms });
  } catch (err) { sendServerError(res, 500, err, 'GET /api/purchasing/terms'); }
});

// Sửa: CHỈ khi còn DRAFT (đã ACTIVE/EXPIRED/ARCHIVED phải Nhân Bản — mirror đúng khoá vòng đời checklistTemplates)
router.post('/terms/:id/edit', requireManageTerms, async (req, res) => {
  const termId = Number(req.params.id);
  if (!Number.isFinite(termId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const updated = await withLockedRecordForCollection('rebateTerms', termId, (term) => {
      if (term.status !== 'DRAFT') {
        throw new HttpError(409, 'Chỉ sửa được điều khoản đang ở trạng thái Nháp — điều khoản đã Kích Hoạt/Hết Hạn/Lưu Trữ phải Nhân Bản thành bản mới để sửa');
      }
      const err = vendorRebate.validateRebateTermPayload(req.body);
      if (err) throw new HttpError(400, err);
      return {
        ...term,
        termName: String(req.body.termName).trim(),
        termType: req.body.termType, calcBasis: req.body.calcBasis, tierMode: req.body.tierMode, periodType: req.body.periodType,
        effectiveFrom: req.body.effectiveFrom, effectiveTo: req.body.effectiveTo || null,
        isRetroactive: !!req.body.isRetroactive,
        tiers: req.body.tiers, scopes: req.body.scopes
      };
    });
    logPurchasing(req, 'EDIT_TERM', updated.termCode, `Sửa điều khoản ${updated.termCode} (v${updated.version})`);
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, `terms/${req.params.id}/edit`); }
});

// Nhân bản (từ ACTIVE/EXPIRED/ARCHIVED, tạo bản DRAFT version+1) — TÁCH BIỆT NHIỆM VỤ: người sửa/nhân
// bản (rebateTermManage) KHÔNG tự động kích hoạt được bản mới, phải người có rebateTermActivate riêng.
router.post('/terms/:id/clone', requireManageTerms, async (req, res) => {
  const termId = Number(req.params.id);
  if (!Number.isFinite(termId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const terms = await getAllForCollection('rebateTerms');
    const source = terms.find(t => t.id === termId);
    if (!source) return res.status(404).json({ error: 'Không tìm thấy điều khoản' });
    if (source.status === 'DRAFT') return res.status(409).json({ error: 'Điều khoản Nháp đã sửa trực tiếp được — không cần nhân bản' });
    const clone = vendorRebate.cloneTermAsDraft(source, req.freshUser.username);
    const inserted = await insertRecord('rebateTerms', clone);
    logPurchasing(req, 'CLONE_TERM', inserted.termCode, `Nhân bản điều khoản ${inserted.termCode} từ #${source.id} (v${source.version || 1}) thành v${inserted.version}`);
    res.json({ ok: true, item: inserted });
  } catch (err) { sendCatchError(res, err, `terms/${req.params.id}/clone`); }
});

// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 3, 9/2026): kích hoạt 1 bản Nhân Bản (DRAFT, clonedFromTermId trỏ về
// bản gốc) trước đây KHÔNG hề đụng tới bản ACTIVE cũ cùng NCC+Mã Điều Khoản — 2 bản cùng ACTIVE song
// song, "Tính Ước Tính" chọn nhầm bản CŨ (bậc thang đã lỗi thời) vẫn chạy bình thường không cảnh báo gì.
// Nay tự LƯU TRỮ (ARCHIVED) mọi bản ACTIVE khác CÙNG vendorId+termCode TRƯỚC khi kích hoạt bản này —
// đúng khuôn checklistTemplates (routes/checklist.js, templates/:id/activate) đã áp dụng cho tình huống
// giống hệt.
router.post('/terms/:id/activate', requireActivateTerm, async (req, res) => {
  const termId = Number(req.params.id);
  if (!Number.isFinite(termId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    // LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Trung bình — phát hiện #5): khoá TRƯỚC ĐÂY đặt theo
    // termId của bản ĐANG kích hoạt (`rebate_term_activate:${termId}`) — nhưng bất biến cần bảo vệ là
    // "chỉ 1 bản ACTIVE cho mỗi cặp (vendorId, termCode)", KHÔNG phải theo từng termId riêng lẻ. 2 request
    // kích hoạt 2 bản DRAFT KHÁC id nhưng CÙNG vendorId+termCode (VD 2 lượt Nhân Bản khác nhau của cùng 1
    // điều khoản, hoặc 2 tab cùng bấm kích hoạt 2 bản nháp khác nhau gần như đồng thời) sẽ nhận 2 khoá
    // KHÁC NHAU (khác termId) -> chạy song song, cả 2 đều đọc "chưa có bản ACTIVE khác" trước khi bản kia
    // kịp lưu trữ (ARCHIVED) các bản ACTIVE cũ -> có thể ra 2 bản ACTIVE cùng lúc cho cùng vendorId+termCode.
    // Đổi khoá theo ĐÚNG cặp vendorId+termCode (đọc trước khi vào khoá để biết cặp này — không đổi hành vi
    // đọc lại "chưa có bản ACTIVE nào khác" vẫn BÊN TRONG khoá mới như cũ).
    const preTerms = await getAllForCollection('rebateTerms');
    const preTarget = preTerms.find(t => t.id === termId);
    if (!preTarget) throw new HttpError(404, 'Không tìm thấy điều khoản');
    const updated = await withAppLock(`rebate_term_activate:${preTarget.vendorId}:${preTarget.termCode}`, async () => {
      const terms = await getAllForCollection('rebateTerms');
      const target = terms.find(t => t.id === termId);
      if (!target) throw new HttpError(404, 'Không tìm thấy điều khoản');
      vendorRebate.assertValidTermTransition(target, 'ACTIVE');
      // LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Cao — phát hiện #3): phòng vệ SÂU cho các bản DRAFT
      // đã lỡ tạo TRƯỚC bản vá validateRebateTermPayload() (nay đã chặn calcBasis='SELL_OUT_VALUE'/
      // termType='GROWTH_REBATE' ngay từ lúc tạo/sửa) — không cho KÍCH HOẠT các bản còn sót giá trị chưa
      // được hỗ trợ tính tự động, tránh 1 điều khoản ACTIVE mà không ai tính được (hoặc tệ hơn, ai đó sau
      // này gỡ tạm bản vá validate mà quên gỡ luôn chỗ này).
      const unsupportedErr = vendorRebate.assertCalcBasisAndTermTypeSupported(target.calcBasis, target.termType);
      if (unsupportedErr) throw new HttpError(409, unsupportedErr);
      const others = terms.filter(t => t.id !== termId && t.vendorId === target.vendorId && t.termCode === target.termCode && t.status === 'ACTIVE');
      for (const other of others) {
        await withLockedRecordForCollection('rebateTerms', other.id, (t) => ({
          ...t, status: 'ARCHIVED',
          history: [...(t.history || []), { action: 'ARCHIVED', by: req.freshUser.username, time: new Date().toLocaleString('vi-VN'), detail: `Tự lưu trữ khi kích hoạt bản mới hơn (#${termId})` }]
        }));
      }
      return withLockedRecordForCollection('rebateTerms', termId, (t) => ({
        ...t, status: 'ACTIVE',
        history: [...(t.history || []), { action: 'ACTIVATED', by: req.freshUser.username, time: new Date().toLocaleString('vi-VN') }]
      }));
    });
    logPurchasing(req, 'ACTIVATE_TERM', updated.termCode, `Kích hoạt điều khoản ${updated.termCode} (v${updated.version})`);
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, `terms/${req.params.id}/activate`); }
});

router.post('/terms/:id/archive', requireManageTerms, async (req, res) => {
  const termId = Number(req.params.id);
  if (!Number.isFinite(termId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const updated = await withLockedRecordForCollection('rebateTerms', termId, (t) => {
      vendorRebate.assertValidTermTransition(t, 'ARCHIVED');
      return { ...t, status: 'ARCHIVED', history: [...(t.history || []), { action: 'ARCHIVED', by: req.freshUser.username, time: new Date().toLocaleString('vi-VN') }] };
    });
    logPurchasing(req, 'ARCHIVE_TERM', updated.termCode, `Lưu trữ điều khoản ${updated.termCode}`);
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, `terms/${req.params.id}/archive`); }
});

router.post('/terms/:id/expire', requireManageTerms, async (req, res) => {
  const termId = Number(req.params.id);
  if (!Number.isFinite(termId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const updated = await withLockedRecordForCollection('rebateTerms', termId, (t) => {
      vendorRebate.assertValidTermTransition(t, 'EXPIRED');
      return { ...t, status: 'EXPIRED', history: [...(t.history || []), { action: 'EXPIRED', by: req.freshUser.username, time: new Date().toLocaleString('vi-VN') }] };
    });
    logPurchasing(req, 'EXPIRE_TERM', updated.termCode, `Đánh dấu hết hạn điều khoản ${updated.termCode}`);
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, `terms/${req.params.id}/expire`); }
});

// ===================== Tính ước tính Rebate (BasisAmount + tiered) =====================
router.post('/terms/:id/calculate', requireManageTerms, async (req, res) => {
  const termId = Number(req.params.id);
  if (!Number.isFinite(termId)) return res.status(400).json({ error: 'id không hợp lệ' });
  const { periodStart, periodEnd } = req.body || {};
  if (!periodStart || !periodEnd) return res.status(400).json({ error: 'Thiếu kỳ tính (periodStart/periodEnd)' });
  // LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): trước đây không ép định dạng periodStart/periodEnd —
  // client cũ dùng prompt() tự do nên chuỗi ngày sai định dạng (VD "20/9/2026", chữ tuỳ ý...) vẫn lọt qua
  // rồi mới vỡ khó hiểu ở tầng SQL (new Date(...) parse sai/Invalid Date). Ép đúng YYYY-MM-DD như mọi nơi
  // khác trong hệ thống, báo lỗi rõ ràng ngay tại đây.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!DATE_RE.test(periodStart) || !DATE_RE.test(periodEnd)) {
    return res.status(400).json({ error: 'periodStart/periodEnd phải đúng định dạng YYYY-MM-DD' });
  }
  if (new Date(periodEnd) < new Date(periodStart)) return res.status(400).json({ error: 'periodEnd không được trước periodStart' });
  try {
    const [terms, vendors] = await Promise.all([getAllForCollection('rebateTerms'), getAllForCollection('vendors')]);
    const term = terms.find(t => t.id === termId);
    if (!term) return res.status(404).json({ error: 'Không tìm thấy điều khoản' });
    if (term.status !== 'ACTIVE') return res.status(409).json({ error: 'Chỉ tính được cho điều khoản đang Hoạt động' });
    // LỖI ĐÃ VÁ (rà soát chuyên sâu Vận Hành/Mua Hàng, 9/2026): trước đây KHÔNG hề đối chiếu kỳ tính với
    // effectiveFrom/effectiveTo của điều khoản — nếu chọn kỳ bao trùm cả những tháng NGOÀI thời hạn hiệu
    // lực thật (VD điều khoản chỉ áp dụng Q1 nhưng tính cho cả năm), hệ thống vẫn tính ước tính dựa trên
    // TOÀN BỘ doanh số mua hàng trong khoảng đó, ra số sai lệch với thoả thuận thật mà không cảnh báo gì.
    if (term.effectiveFrom && periodStart < term.effectiveFrom) {
      return res.status(400).json({ error: `Kỳ tính bắt đầu trước Ngày Hiệu Lực Từ của điều khoản (${term.effectiveFrom}) — vui lòng chọn lại kỳ tính nằm trong thời hạn hiệu lực` });
    }
    if (term.effectiveTo && periodEnd > term.effectiveTo) {
      return res.status(400).json({ error: `Kỳ tính kết thúc sau Ngày Hiệu Lực Đến của điều khoản (${term.effectiveTo}) — vui lòng chọn lại kỳ tính nằm trong thời hạn hiệu lực` });
    }
    // LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Cao — phát hiện #3): (a) đối chiếu periodType với ĐỘ
    // DÀI periodStart/periodEnd — trước đây không hề kiểm; (b) phòng vệ SÂU (defense-in-depth) chặn tính
    // cho các điều khoản ACTIVE TỪ TRƯỚC bản vá này mà calcBasis/termType chưa được hỗ trợ tính tự động
    // (validate ở tạo/sửa đã chặn TỪ NAY, nhưng điều khoản cũ đã lỡ ACTIVE trước đó vẫn có thể gọi thẳng
    // route này) — xem assertCalcBasisAndTermTypeSupported()/validatePeriodMatchesPeriodType() ở
    // lib/vendorRebate.js cho lý do đầy đủ.
    const unsupportedErr = vendorRebate.assertCalcBasisAndTermTypeSupported(term.calcBasis, term.termType);
    if (unsupportedErr) return res.status(409).json({ error: unsupportedErr });
    const periodTypeErr = vendorRebate.validatePeriodMatchesPeriodType(term.periodType, periodStart, periodEnd);
    if (periodTypeErr) return res.status(400).json({ error: periodTypeErr });
    const vendor = vendors.find(v => v.id === term.vendorId);
    if (!vendor) return res.status(404).json({ error: 'Không tìm thấy NCC của điều khoản này' });

    const purchaseTransactions = await queryPurchaseTransactionsForVendor(vendor.vendorCode, periodStart, periodEnd);
    const result = vendorRebate.computeRebateEstimate({ vendor, term, purchaseTransactions, periodStart, periodEnd });

    const record = {
      id: Date.now(),
      termId: term.id, vendorId: vendor.id,
      termCode: term.termCode, vendorCode: vendor.vendorCode,
      periodStart, periodEnd,
      basisAmount: result.basisAmount, aggregateDetail: result.aggregateDetail,
      rebateAmount: result.rebateAmount, breakdown: result.breakdown,
      // Snapshot Tiers TẠI THỜI ĐIỂM TÍNH — không tham chiếu ngược tới term.tiers hiện tại, đúng nguyên
      // tắc lib/vendorRebate.js đã ghi ở assertValidTermTransition(): điều khoản có thể bị Nhân Bản/sửa
      // sau này, con số đã tính ra không được đổi theo.
      tierModeAtCalc: term.tierMode, tiersAtCalc: term.tiers,
      calculatedBy: req.freshUser.username, calculatedByName: req.freshUser.name
    };
    const inserted = await insertRecord('rebateCalculations', record);
    logPurchasing(req, 'CALCULATE_REBATE', term.termCode, `Tính ước tính rebate ${term.termCode} kỳ ${periodStart}→${periodEnd}: ${result.rebateAmount.toLocaleString('vi-VN')}đ`);
    res.json({ ok: true, item: inserted });
  } catch (err) { sendCatchError(res, err, `terms/${req.params.id}/calculate`); }
});

router.get('/calculations', async (req, res) => {
  try {
    const calcs = await getAllForCollection('rebateCalculations');
    const termId = req.query.termId ? Number(req.query.termId) : null;
    const items = termId ? calcs.filter(c => c.termId === termId) : calcs;
    res.json({ ok: true, items });
  } catch (err) { sendServerError(res, 500, err, 'GET /api/purchasing/calculations'); }
});

// ===================== Đồng bộ dữ liệu mua hàng từ DSmart =====================
// Siết riêng chặt hơn hẳn CRUD thường (mirror đúng lý do routes/reports.js reportsRateLimiter) — đây là
// tác vụ NẶNG (gọi API ngoài + ghi hàng nghìn dòng), không nên để 1 phiên hợp lệ dội liên tục.
const syncRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Bạn vừa đồng bộ dữ liệu mua hàng quá nhiều lần, vui lòng thử lại sau ít phút.' },
  // router.use(requireAuth) ở trên đảm bảo req.freshUser LUÔN có ở đây (nhánh req.ip chỉ là fallback lý
  // thuyết không bao giờ chạy tới) — vẫn bọc ipKeyGenerator() đúng khuyến nghị express-rate-limit để
  // tránh cảnh báo IPv6 (nhiều dạng biểu diễn cùng 1 địa chỉ IPv6 có thể lách qua giới hạn nếu so sánh
  // chuỗi thô).
  keyGenerator: (req) => req.freshUser?.username || ipKeyGenerator(req.ip)
});

router.post('/sync', requireManageTerms, syncRateLimiter, async (req, res) => {
  // baseUrl/apiKey LUÔN đọc từ biến môi trường — KHÔNG BAO GIỜ nhận từ req.body/query, chống SSRF
  // (OWASP A10, xem chú thích đầu lib/dsmartApiClient.js).
  const baseUrl = process.env.DSMART_API_BASE_URL;
  const apiKey = process.env.DSMART_API_KEY;
  if (!baseUrl || !apiKey) {
    return res.status(503).json({ error: 'Chưa cấu hình kết nối DSmart (DSMART_API_BASE_URL/DSMART_API_KEY) — liên hệ quản trị hệ thống' });
  }
  const startedAt = new Date();
  try {
    // LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Cao): route này TRƯỚC ĐÂY chỉ có rate-limit THEO
    // USERNAME (syncRateLimiter ở trên) — hoàn toàn không có gì ngăn 2 lượt đồng bộ CHẠY CHỒNG lên nhau
    // (2 người có quyền cùng bấm, hoặc 1 người mở 2 tab, hoặc bấm lại khi lượt trước còn đang chạy vài
    // phút). Cả 2 lượt cùng tính sinceDate từ CÙNG lần thành công gần nhất, cùng kéo về CÙNG tập dòng
    // rồi cùng ghi -> đâm nhau ở UNIQUE index (SourceSystem, SourceRefId) của bảng giao dịch mua hàng,
    // lượt thua báo lỗi 502 khó hiểu và ghi 1 dòng nhật ký FAILED dù dữ liệu không hề sai. Khoá đúng
    // khuôn jobs/operationOrderApiSync.js ('dsmart16_sync'): withAppLock() dùng sp_getapplock nên hiệu
    // lực CROSS-PROCESS thật (production chạy PM2 cluster, cờ in-memory không đủ) — lượt thứ 2 chờ tối
    // đa 15s rồi nhận 409 rõ ràng thay vì chạy song song.
    return await withAppLock('purchasing_dsmart_sync', async () => {
      const lastSuccess = await getLastSuccessfulSyncStart('DSMART');
      // Lùi lại 1 ngày so với lần thành công gần nhất làm biên an toàn (dữ liệu DSmart có thể vào muộn) —
      // bulkInsertPurchaseTransactions() tự dedup theo SourceRefId nên chồng lấn không tạo trùng.
      const sinceDate = lastSuccess ? new Date(new Date(lastSuccess).getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10) : null;

      const { items, pagesFetched } = await fetchAllPurchases({ baseUrl, apiKey, sinceDate });
      // LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Trung bình — phát hiện #7): items.map() TRƯỚC ĐÂY bê
      // thẳng field từ DSmart vào INSERT theo lô 200 dòng (bulkInsertPurchaseTransactions(), INSERT_CHUNK_SIZE
      // ở lib/vendorPurchaseStore.js) dù VendorCode/StoreCode/PurchaseDate/Amount là cột NOT NULL (xem
      // sql/schema.sql) — 1 item DSmart trả về thiếu field (API ngoài không đảm bảo tuyệt đối sạch dữ
      // liệu) sẽ làm SQL báo lỗi constraint cho CẢ LÔ 200 dòng đó, có thể fail cả lượt đồng bộ dù đa số
      // dòng hợp lệ. Validate TỪNG DÒNG trước khi đưa vào batch insert — dòng lỗi thì SKIP + ghi vào
      // rowErrors, các dòng khác vẫn nạp bình thường — cùng khuôn cô lập lỗi đã có ở
      // parsePurchaseTransactionImportXlsx() (lib/purchasingManualImport.js, Nhập File thủ công) và vòng
      // lặp try/catch từng đơn hàng ở jobs/operationOrderApiSync.js.
      const DATE_RE_ROW = /^\d{4}-\d{2}-\d{2}$/;
      const rows = [];
      const rowErrors = [];
      items.forEach((it, idx) => {
        const vendorCode = String(it?.vendorCode || '').trim();
        const storeCode = String(it?.storeCode || '').trim();
        const purchaseDate = it?.purchaseDate != null ? String(it.purchaseDate).slice(0, 10) : '';
        const amount = Number(it?.amount);
        const refLabel = it?.refId || it?.id || '(không có refId)';
        const errs = [];
        if (!vendorCode) errs.push('thiếu vendorCode');
        if (!storeCode) errs.push('thiếu storeCode');
        if (!DATE_RE_ROW.test(purchaseDate) || Number.isNaN(new Date(purchaseDate).getTime())) errs.push('purchaseDate không hợp lệ/thiếu');
        if (!Number.isFinite(amount) || amount < 0) errs.push('amount không hợp lệ/thiếu');
        if (errs.length) {
          rowErrors.push({ rowIndex: idx, refId: refLabel, message: `Dòng ${idx + 1} (refId ${refLabel}): ${errs.join(', ')} — đã bỏ qua` });
          return;
        }
        rows.push({
          vendorCode, storeCode, storeFormat: it.storeFormat, categoryCode: it.categoryCode,
          purchaseDate, amount, isReturn: !!it.isReturn,
          sourceSystem: 'DSMART', sourceRefId: it.refId || it.id || null, dataConfidence: 'PROVISIONAL'
        });
      });
      const { rowsInserted, rowsUpdated, rowsSkippedDuplicate } = await bulkInsertPurchaseTransactions(rows);

      await insertPurchaseSyncLog({
        startedAt, finishedAt: new Date(), sourceSystem: 'DSMART', status: rowErrors.length ? 'PARTIAL' : 'SUCCESS',
        rowsFetched: items.length, rowsInserted, pagesFetched, triggeredBy: req.freshUser.username,
        errorMessage: rowErrors.length ? rowErrors.map(e => e.message).join('; ') : null
      });
      logPurchasing(req, 'SYNC_DSMART', 'DSMART', `Đồng bộ DSmart: ${items.length} dòng lấy về, ${rowsInserted} dòng mới, ${rowsUpdated} dòng cập nhật lại (DSmart sửa dữ liệu cũ), ${rowsSkippedDuplicate} trùng bỏ qua, ${rowErrors.length} dòng lỗi bị bỏ qua`);
      res.json({ ok: true, rowsFetched: items.length, rowsInserted, rowsUpdated, rowsSkippedDuplicate, rowErrors, pagesFetched });
    });
  } catch (err) {
    // Không lấy được khoá (đang có lượt đồng bộ khác chạy) -> KHÔNG ghi nhật ký FAILED (lượt này chưa
    // hề bắt đầu đồng bộ gì), chỉ báo 409 rõ ràng cho người bấm.
    if (err instanceof HttpError && err.status === 409) {
      return res.status(409).json({ error: 'Một lượt đồng bộ dữ liệu mua hàng khác đang chạy — vui lòng đợi lượt đó xong rồi thử lại.' });
    }
    await insertPurchaseSyncLog({
      startedAt, finishedAt: new Date(), sourceSystem: 'DSMART', status: 'FAILED',
      triggeredBy: req.freshUser.username, errorMessage: err.message
    }).catch(() => {});
    sendServerError(res, 502, err, 'POST /api/purchasing/sync', 'Đồng bộ dữ liệu từ DSmart thất bại, vui lòng thử lại sau');
  }
});

// LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Trung bình — phát hiện #8): route này chỉ gác bởi
// requireAnyPurchasingAccess (router.use() ở đầu file — CHO PHÉP bất kỳ quyền nào trong 5 quyền module,
// kể cả CHỈ có rebateViewReport/rebateReconcile/rebateApprove, KHÔNG được phép đồng bộ) — nhưng
// toSyncLogEntry() (lib/vendorPurchaseStore.js) trả nguyên errorMessage (có thể chứa hostname/IP nội bộ,
// phản hồi thô từ hệ thống DSmart ngoài) cho MỌI người xem được log, không phân biệt có quyền đồng bộ
// thật hay không. Cùng khuôn sanitizeOperationOrderApiConfig() (routes/data.js) đã đóng cho
// operationOrderApiConfig ở vòng rà soát 1: chỉ trả errorMessage chi tiết cho người CÓ quyền đồng bộ thật
// (canManageTerms — admin/rebateTermManage, đúng quyền gác POST /sync ở trên), người khác chỉ thấy trạng
// thái chung chung.
function sanitizePurchaseSyncLogs(logs, canSeeDetail) {
  if (canSeeDetail) return logs;
  return logs.map(({ errorMessage, ...rest }) => ({
    ...rest,
    errorMessage: errorMessage ? 'Đồng bộ/nhập dữ liệu thất bại — liên hệ người có quyền quản lý Điều Khoản Chiết Khấu để xem chi tiết' : null
  }));
}
router.get('/sync-logs', async (req, res) => {
  try {
    const logs = await getRecentPurchaseSyncLogs(50);
    const canSeeDetail = vendorRebate.canManageTerms(req.freshUser);
    res.json({ ok: true, items: sanitizePurchaseSyncLogs(logs, canSeeDetail) });
  } catch (err) { sendServerError(res, 500, err, 'GET /api/purchasing/sync-logs'); }
});

// ===================== Nhập/Xuất dữ liệu mua hàng THỦ CÔNG (thay thế đồng bộ DSmart khi cần) =====================
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '20', 10);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const manualImportStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.xlsx`)
});
const manualImportUpload = multer({
  storage: manualImportStorage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/\.xlsx$/i.test(file.originalname)) return cb(new HttpError(400, 'Chỉ chấp nhận file Excel (.xlsx)'));
    cb(null, true);
  }
});

// GET /api/purchasing/manual-import-template — file mẫu Excel để nhập tay giao dịch mua hàng.
router.get('/manual-import-template', requireManageTerms, async (req, res) => {
  try {
    const wb = await buildPurchaseTransactionTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Giao_Dich_Mua_Hang.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/purchasing/manual-import-template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// POST /api/purchasing/manual-import — đọc file đã điền, GHI THẲNG vào dbo.VendorPurchaseTransactions
// (cùng cách POST /sync ở trên xử lý dữ liệu DSmart, KHÔNG phải luồng preview-rồi-client-tự-gộp).
// LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Trung bình — phát hiện #6): route này TRƯỚC ĐÂY hoàn toàn
// KHÔNG có khoá chống chạy chồng — trong khi /sync (DSmart) ĐÃ có withAppLock('purchasing_dsmart_sync')
// đúng lý do 2 lượt ghi cùng lúc vào bulkInsertPurchaseTransactions() có thể đâm nhau ở UNIQUE index
// (SourceSystem, SourceRefId). Route này ghi vào CÙNG hàm bulkInsertPurchaseTransactions() (chỉ khác
// sourceSystem='MANUAL') nên chịu ĐÚNG rủi ro y hệt nếu 2 lượt Nhập File thủ công chạy chồng, HOẶC 1 lượt
// Nhập File chạy chồng với 1 lượt Đồng Bộ DSmart đang chạy — dùng CHUNG đúng 1 khoá 'purchasing_dsmart_sync'
// với /sync để chặn chồng chéo giữa CẢ 2 route (không phải 2 khoá riêng biệt — cả 2 cùng ghi 1 bảng).
router.post('/manual-import', requireManageTerms, uploadRateLimiter, (req, res) => {
  manualImportUpload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, 'POST /api/purchasing/manual-import');
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp cần tải lên' });

    const startedAt = new Date();
    try {
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, '.xlsx');
      if (!check.ok) return res.status(400).json({ error: check.reason });

      const { rows, rowErrors } = await parsePurchaseTransactionImportXlsx(buffer);
      let result;
      try {
        result = await withAppLock('purchasing_dsmart_sync', async () => bulkInsertPurchaseTransactions(rows));
      } catch (lockErr) {
        if (lockErr instanceof HttpError && lockErr.status === 409) {
          return res.status(409).json({ error: 'Một lượt đồng bộ/nhập dữ liệu mua hàng khác đang chạy — vui lòng đợi lượt đó xong rồi thử lại.' });
        }
        throw lockErr;
      }
      const { rowsInserted, rowsUpdated, rowsSkippedDuplicate } = result;

      await insertPurchaseSyncLog({
        startedAt, finishedAt: new Date(), sourceSystem: 'MANUAL', status: rowErrors.length ? 'PARTIAL' : 'SUCCESS',
        rowsFetched: rows.length, rowsInserted, triggeredBy: req.freshUser.username,
        errorMessage: rowErrors.length ? rowErrors.map(e => e.message).join('; ') : null
      });
      logPurchasing(req, 'MANUAL_IMPORT', 'MANUAL', `Nhập file thủ công: ${rows.length} dòng hợp lệ, ${rowsInserted} dòng mới, ${rowsUpdated} dòng cập nhật lại, ${rowsSkippedDuplicate} trùng bỏ qua, ${rowErrors.length} dòng lỗi`);
      res.json({ ok: true, rowsFetched: rows.length, rowsInserted, rowsUpdated, rowsSkippedDuplicate, rowErrors, fileName: req.file.originalname });
    } catch (parseErr) {
      await insertPurchaseSyncLog({
        startedAt, finishedAt: new Date(), sourceSystem: 'MANUAL', status: 'FAILED',
        triggeredBy: req.freshUser.username, errorMessage: parseErr.message
      }).catch(() => {});
      sendCatchError(res, parseErr, 'POST /api/purchasing/manual-import');
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  });
});

// GET /api/purchasing/manual-import-export?from&to — xuất lại dữ liệu đang có (mọi nguồn, trừ khi lọc
// sourceSystem) để chỉnh sửa/bổ sung rồi tải lên lại qua Nhập File — mirror module-vpp.js "Xuất Excel".
router.get('/manual-import-export', requireManageTerms, async (req, res) => {
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'Thiếu/sai định dạng khoảng ngày (from/to, dạng YYYY-MM-DD)' });
  }
  try {
    const sourceSystem = req.query.sourceSystem ? String(req.query.sourceSystem).trim() : null;
    const transactions = await queryPurchaseTransactionsForExport({ from, to, sourceSystem });
    const wb = await buildPurchaseTransactionExportWorkbook(transactions);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Giao_Dich_Mua_Hang_${from}_${to}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/purchasing/manual-import-export lỗi:', err.message);
    res.status(500).json({ error: 'Không thể xuất file' });
  }
});

module.exports = router;
