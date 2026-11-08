// module-hraudit.js — "🔍 Audit Nhân Sự" (11/2026, theo yêu cầu người dùng). Gọi route RIÊNG
// /api/hr/profile-audit* (routes/hrProfileAudit.js) — CÙNG khuôn hiển thị "🔍 Audit Người Dùng"
// (module-hethong-tabs.js) nhưng findings có field employeeCode/name thay vì username/name, sống ở
// module Nhân Sự (không phải Hệ Thống > Quản Trị), nên có file riêng + bảng màu severity riêng (không
// require module-hethong-tabs.js — module đó chỉ nạp cho admin vào Hệ Thống, HR thường không có).
'use strict';

const HR_AUDIT_SEVERITY_STYLE = {
  CRITICAL: { border: 'border-rose-600', bg: 'bg-rose-50', badgeBg: 'bg-rose-600', label: 'NGHIÊM TRỌNG' },
  WARNING: { border: 'border-amber-500', bg: 'bg-amber-50', badgeBg: 'bg-amber-500', label: 'CẢNH BÁO' },
  INFO: { border: 'border-sky-400', bg: 'bg-sky-50', badgeBg: 'bg-sky-500', label: 'THÔNG TIN' }
};
function sortHrAuditFindingsBySeverity(findings) {
  const order = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  return [...findings].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
}

// Gọi khi vào tab "Audit Nhân Sự" (switchTab()) — CHỈ đọc cache tóm tắt + cấu hình (rẻ); quét THẬT chỉ
// xảy ra khi bấm "🔄 Quét Ngay" (runHrProfileAuditScan()).
async function renderHrProfileAuditPanel() {
  const sectionEl = document.getElementById('hrAuditSection');
  const lastScanEl = document.getElementById('hrAuditLastScan');
  const toggleEl = document.getElementById('hrAuditAutoScanToggle');
  const draftDaysEl = document.getElementById('hrAuditDraftStaleDays');
  const expiryDaysEl = document.getElementById('hrAuditExpirySoonDays');
  if (!sectionEl) return;
  try {
    const [summaryRes, cfgRes] = await Promise.all([
      fetch('/api/hr/profile-audit/summary'),
      fetch('/api/hr/profile-audit/config')
    ]);
    if (summaryRes.status === 403) { sectionEl.innerHTML = '<p class="text-sm text-gray-500 italic p-4">Bạn không có quyền xem Audit Nhân Sự.</p>'; return; }
    if (summaryRes.ok) {
      const summary = await summaryRes.json();
      renderHrProfileAuditSummary(summary);
      if (lastScanEl) {
        lastScanEl.innerText = summary.at
          ? `Lần quét gần nhất: ${new Date(summary.at).toLocaleString('vi-VN')} (tự động hằng ngày)`
          : 'Chưa quét lần nào — bấm "🔄 Quét Ngay" để bắt đầu.';
      }
    }
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      if (toggleEl) toggleEl.checked = cfg.autoScanEmailEnabled !== false;
      if (draftDaysEl) draftDaysEl.value = cfg.draftStaleDaysThreshold || 30;
      if (expiryDaysEl) expiryDaysEl.value = cfg.contractExpirySoonDays || 30;
    }
  } catch (err) {
    console.error('renderHrProfileAuditPanel() lỗi:', err);
  }
}

function renderHrProfileAuditSummary(summary) {
  const row = document.getElementById('hrAuditSummaryRow');
  if (!row) return;
  row.classList.toggle('hidden', !summary.at);
  const totalEl = document.getElementById('hrAuditTotalCount');
  const critEl = document.getElementById('hrAuditCriticalCount');
  const warnEl = document.getElementById('hrAuditWarningCount');
  if (totalEl) totalEl.innerText = summary.total || 0;
  if (critEl) critEl.innerText = summary.critical || 0;
  if (warnEl) warnEl.innerText = summary.warning || 0;
}

function renderHrProfileAuditFindingsList(findings) {
  const listEl = document.getElementById('hrAuditFindingsList');
  if (!listEl) return;
  if (!findings.length) {
    listEl.innerHTML = '<p class="text-xs text-emerald-700 font-semibold">✅ Không phát hiện nào.</p>';
    return;
  }
  listEl.innerHTML = sortHrAuditFindingsBySeverity(findings).map(f => {
    const style = HR_AUDIT_SEVERITY_STYLE[f.severity] || HR_AUDIT_SEVERITY_STYLE.INFO;
    return `
    <div class="border-l-4 ${style.border} ${style.bg} rounded p-2">
      <div class="flex items-start justify-between gap-2">
        <div class="text-xs font-bold">${escapeHtml(f.employeeCode)} ${f.name && f.name !== f.employeeCode ? `<span class="font-normal text-gray-500">(${escapeHtml(f.name)})</span>` : ''}</div>
        <span class="text-[9px] font-extrabold px-1.5 py-0.5 rounded shrink-0 ${style.badgeBg} text-white">${style.label}</span>
      </div>
      <div class="text-[11px] text-gray-600 mt-0.5">${escapeHtml(f.reason)}</div>
    </div>`;
  }).join('');
}

async function runHrProfileAuditScan() {
  const btn = document.querySelector('[data-op="runHrProfileAuditScan"]');
  const lastScanEl = document.getElementById('hrAuditLastScan');
  if (btn) { btn.disabled = true; btn.innerText = '⏳ Đang quét...'; }
  try {
    const res = await fetch('/api/hr/profile-audit');
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Lỗi máy chủ (${res.status})`);
    }
    const { at, findings } = await res.json();
    renderHrProfileAuditSummary({
      at, total: findings.length,
      critical: findings.filter(f => f.severity === 'CRITICAL').length,
      warning: findings.filter(f => f.severity === 'WARNING').length
    });
    if (lastScanEl) lastScanEl.innerText = `Lần quét gần nhất: ${new Date(at).toLocaleString('vi-VN')} (vừa quét tay)`;
    renderHrProfileAuditFindingsList(findings);
  } catch (err) {
    alert(`⛔ Quét Audit Nhân Sự thất bại: ${err.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = '🔄 Quét Ngay'; }
  }
}

// toggleHrProfileAuditAutoScan()/saveHrProfileAuditThresholds() — cùng đọc lại cấu hình hiện có TRƯỚC
// khi ghi đè (giữ nguyên field không có ô nhập ở UI này — ccEmails) để không vô tình xoá mất.
async function toggleHrProfileAuditAutoScan() {
  const toggleEl = document.getElementById('hrAuditAutoScanToggle');
  if (!toggleEl) return;
  const desired = toggleEl.checked;
  try {
    const cfgRes = await fetch('/api/hr/profile-audit/config');
    const currentCfg = cfgRes.ok ? await cfgRes.json() : { ccEmails: [], draftStaleDaysThreshold: 30, contractExpirySoonDays: 30 };
    const res = await fetch('/api/hr/profile-audit/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        autoScanEmailEnabled: desired, ccEmails: currentCfg.ccEmails || [],
        draftStaleDaysThreshold: currentCfg.draftStaleDaysThreshold || 30,
        contractExpirySoonDays: currentCfg.contractExpirySoonDays || 30
      })
    });
    if (!res.ok) throw new Error('Lưu cấu hình thất bại');
  } catch (err) {
    alert(`⛔ ${err.message}`);
    toggleEl.checked = !desired;
  }
}
async function saveHrProfileAuditThresholds() {
  const draftDaysEl = document.getElementById('hrAuditDraftStaleDays');
  const expiryDaysEl = document.getElementById('hrAuditExpirySoonDays');
  if (!draftDaysEl || !expiryDaysEl) return;
  try {
    const cfgRes = await fetch('/api/hr/profile-audit/config');
    const currentCfg = cfgRes.ok ? await cfgRes.json() : { autoScanEmailEnabled: true, ccEmails: [] };
    const res = await fetch('/api/hr/profile-audit/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        autoScanEmailEnabled: currentCfg.autoScanEmailEnabled !== false, ccEmails: currentCfg.ccEmails || [],
        draftStaleDaysThreshold: Number(draftDaysEl.value), contractExpirySoonDays: Number(expiryDaysEl.value)
      })
    });
    if (!res.ok) throw new Error('Lưu cấu hình thất bại');
  } catch (err) {
    alert(`⛔ ${err.message}`);
  }
}
