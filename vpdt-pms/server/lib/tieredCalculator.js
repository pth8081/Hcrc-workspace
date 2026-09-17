// lib/tieredCalculator.js — Lõi tính chiết khấu/thưởng theo bậc thang (Mua Hàng > BAS, v23.30).
// Nguyên văn theo tài liệu người dùng cung cấp (vendor_rebate_full.md mục 5.3 + file đính kèm
// tieredCalculator.js) — đã kiểm thử thật bởi người dùng (xem Mục 6.1 tài liệu), KHÔNG sửa logic.
//
// Hỗ trợ 2 chế độ hay bị nhầm lẫn nhất trong thực tế hợp đồng NCC:
//   GRADUATED (lũy tiến từng phần) - mỗi bậc chỉ tính % trên PHẦN nằm trong bậc đó
//   CLIFF (đạt mốc tính cả)        - đạt tới bậc nào thì % của bậc đó áp dụng cho TOÀN BỘ doanh số

function calculateTieredRebate(purchaseAmount, tiers, mode = 'GRADUATED') {
  const sortedTiers = [...tiers].sort((a, b) => a.fromAmount - b.fromAmount);

  if (mode === 'CLIFF') {
    // Tìm bậc cao nhất mà purchaseAmount đạt tới, áp dụng % đó cho TOÀN BỘ
    let applicableTier = null;
    for (const tier of sortedTiers) {
      if (purchaseAmount >= tier.fromAmount) applicableTier = tier;
    }
    if (!applicableTier) return { rebateAmount: 0, breakdown: [] };
    const rebateAmount = purchaseAmount * applicableTier.ratePct / 100;
    return { rebateAmount, breakdown: [{ tier: applicableTier, taxableInTier: purchaseAmount, rebateInTier: rebateAmount }] };
  }

  // GRADUATED: cộng dồn từng phần theo đúng bậc chứa nó
  // Quy ước ranh giới THỐNG NHẤT với chế độ CLIFF: đạt ĐÚNG BẰNG fromAmount coi là đã vào bậc đó (>=, không phải >)
  let totalRebate = 0;
  const breakdown = [];

  for (let i = 0; i < sortedTiers.length; i++) {
    const tier = sortedTiers[i];
    const nextTierFrom = sortedTiers[i + 1] ? sortedTiers[i + 1].fromAmount : Infinity;
    if (purchaseAmount < tier.fromAmount) break;       // chưa chạm tới bậc này (nghiêm ngặt <, không phải <=)

    const amountInThisTier = Math.min(purchaseAmount, nextTierFrom) - tier.fromAmount;
    if (amountInThisTier <= 0) continue;
    const rebateInTier = amountInThisTier * tier.ratePct / 100;
    totalRebate += rebateInTier;
    breakdown.push({ tier, taxableInTier: amountInThisTier, rebateInTier });
  }
  return { rebateAmount: totalRebate, breakdown };
}

module.exports = { calculateTieredRebate };
