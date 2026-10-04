// lib/purchaseBasisAggregator.js — Gộp dữ liệu mua hàng thô (dbo.VendorPurchaseTransactions, hiện từ
// DSmart, sau này có thể thêm nguồn khác) thành 1 con số "doanh số làm căn cứ" (BasisAmount) đúng phạm
// vi từng điều khoản (RebateTerm.scopes[]), để đưa vào tieredCalculator.js — lớp KẾT NỐI giữa dữ liệu
// mua hàng và engine tính rebate (Mua Hàng > BAS, v23.30).
//
// Nguyên văn theo tài liệu người dùng cung cấp (vendor_rebate_full.md mục 5.2 + file đính kèm
// purchaseBasisAggregator.js) — đã kiểm thử thật bởi người dùng (xem Mục 6.2 tài liệu), KHÔNG sửa logic.

// scopes: mảng rỗng = áp dụng toàn hệ thống; có phần tử = chỉ cộng đúng phạm vi khai báo
//
// ENTITY/CHANNEL thêm 10/2026 (mở rộng theo file Điều Khoản Thương Mại/Tính BAS người dùng cung cấp) —
// CHỈ THÊM 2 nhánh mới, 3 nhánh STORE_FORMAT/STORE/CATEGORY gốc giữ NGUYÊN VẸN không đổi 1 ký tự (phần
// này đã được người dùng kiểm thử thật, xem chú thích đầu file — không sửa logic cũ).
function matchesScope(purchaseLine, scopes) {
  if (!scopes || scopes.length === 0) return true; // không giới hạn phạm vi -> tính hết
  return scopes.some(scope => {
    if (scope.scopeType === 'STORE_FORMAT') return purchaseLine.storeFormat === scope.scopeValue;
    if (scope.scopeType === 'STORE') return purchaseLine.storeCode === scope.scopeValue;
    if (scope.scopeType === 'CATEGORY') return purchaseLine.categoryCode === scope.scopeValue;
    // ENTITY: lọc đúng 1 pháp nhân (VD BRG/Fuji) — dùng cho cả giới hạn basisAmount theo pháp nhân (VD
    // "Tổng Nhập BRG" làm căn cứ % có-điều-kiện/không-điều-kiện) lẫn tính tỷ trọng phân bổ fix amount
    // (xem allocateFixedAmountByEntity() ở lib/vendorRebate.js).
    if (scope.scopeType === 'ENTITY') return purchaseLine.entity === scope.scopeValue;
    // CHANNEL: 'DC' = chỉ tính giao dịch mua qua Kho Trung Tâm (isViaDC=true), 'DIRECT' = chỉ tính giao
    // dịch mua trực tiếp (isViaDC=false/null) — mirror đúng cột riêng "BAS qua DC" trong file Tính BAS.
    if (scope.scopeType === 'CHANNEL') {
      const lineChannel = purchaseLine.isViaDC ? 'DC' : 'DIRECT';
      return lineChannel === scope.scopeValue;
    }
    return false;
  });
}

function aggregateBasisAmount(purchaseLines, { vendorCode, periodStart, periodEnd, scopes = [] }) {
  const periodStartTime = new Date(periodStart).getTime();
  const periodEndTime = new Date(periodEnd).getTime();

  let total = 0;
  let matchedCount = 0, skippedOutOfPeriod = 0, skippedWrongVendor = 0, skippedOutOfScope = 0, skippedReturns = 0;

  for (const line of purchaseLines) {
    if (line.vendorCode !== vendorCode) { skippedWrongVendor++; continue; }
    const lineTime = new Date(line.purchaseDate).getTime();
    if (lineTime < periodStartTime || lineTime > periodEndTime) { skippedOutOfPeriod++; continue; }
    if (!matchesScope(line, scopes)) { skippedOutOfScope++; continue; }
    if (line.isReturn) { skippedReturns++; total -= line.amount; continue; } // hàng trả lại -> TRỪ khỏi căn cứ tính
    total += line.amount;
    matchedCount++;
  }

  return {
    basisAmount: Math.max(0, total),
    detail: { matchedCount, skippedOutOfPeriod, skippedWrongVendor, skippedOutOfScope, skippedReturns },
  };
}

module.exports = { aggregateBasisAmount, matchesScope };
