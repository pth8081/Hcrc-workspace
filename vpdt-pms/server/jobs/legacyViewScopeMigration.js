// jobs/legacyViewScopeMigration.js — Di trú + tự dọn quyền phẳng CŨ submissionView/contractView/
// carView/officeView.all (hoặc .depts có phòng ban KHÁC phòng ban chính mình) sang
// deptViewScopeConfig.submission/contract/car/office.extraViewers — CHẠY Ở SERVER lúc khởi động,
// KHÔNG phụ thuộc việc ai đăng nhập (mirror đúng logic di trú ở public/js/core.js initDatabase(),
// "Việc D"/"Việc D mở rộng", 11/2026, nhưng vá thêm 2 gap client không tự vá được).
//
// "Việc D mở rộng" (10/2026): carView/officeView bị bỏ hẳn (giống submissionView/contractView trước
// đó) — deptViewScopeConfig.car/office là cơ chế DUY NHẤT còn lại quyết định ai xem được Đăng Ký Xe/
// Văn Phòng ngoài phòng ban của chính mình. Thêm car/office vào job này để có đúng 2 lớp an toàn mà
// submission/contract đã có (dọn dư thừa + không phụ thuộc admin đăng nhập).
//
// LỖI ĐÃ VÁ #1 (mức Trung bình, rà soát v24.74→v24.90, 10/2026): di trú ở core.js (client) CHỈ lưu lên
// server khi NGƯỜI VỪA ĐĂNG NHẬP là Admin (ghi "deptViewScopeConfig" yêu cầu quyền Admin ở server, xem
// ADMIN_ONLY_KEYS ở routes/data.js). Một user THƯỜNG đang có quyền "xem xuyên phòng ban" hợp lệ (legacy
// submissionView/contractView.all=true) mà đăng nhập TRƯỚC KHI có admin nào đăng nhập lần nào sau khi
// tính năng này triển khai sẽ KHÔNG được di trú lên server: phía client của chính họ tính đúng (hiển thị
// đủ trong session đó, vì tính lại từ `data.users` mỗi lần tải trang) nhưng server — canViewSubmission()/
// canViewContract() (lib/recordViewScope.js) ĐÃ BỎ HẲN đọc submissionView/contractView, chỉ còn đọc
// deptViewScopeConfig — vẫn lọc theo cấu hình CHƯA di trú, nên GET /api/data trả về THIẾU hồ sơ của họ
// (quyền đã cấp nhưng vô hiệu ở đúng nơi quan trọng nhất). Chạy di trú này Ở SERVER lúc khởi động, ghi
// trực tiếp qua lib/appData.js (không qua lớp gác Admin của route HTTP) để không còn phụ thuộc "có admin
// nào đăng nhập chưa".
//
// LỖI ĐÃ VÁ #2 (mức Trung bình, cùng đợt rà soát): bản vá v24.83 (comment đầy đủ ở core.js
// initDatabase()) chỉ SIẾT điều kiện "cần di trú" (từ "có .depts không rỗng" sang "có .depts chứa ít
// nhất 1 phòng ban KHÁC phòng ban hiện tại") để không migrate dư thừa NỮA — nhưng không dọn lại username
// ĐÃ bị migrate dư thừa (thêm nhầm vào extraViewers) TỪ TRƯỚC khi bản vá đó triển khai (nếu có admin đăng
// nhập trong khoảng giữa lúc bug chưa vá và lúc đã vá, lưu nhầm đã kịp lên server). Tự dọn lại 1 lần,
// idempotent: username nào ĐANG có trong extraViewers NHƯNG (a) KHÔNG còn khớp điều kiện di trú hiện tại
// VÀ (b) legacy flag (submissionView/contractView) của họ CÓ shape ĐÚNG kiểu lỗi cũ (.depts không rỗng
// nhưng MỌI phần tử đều = dept hiện tại của họ) — tín hiệu đủ riêng biệt để chắc chắn entry này chỉ có
// thể do đúng bug cũ thêm vào, không đụng tới entry admin tự tay thêm qua Ma Trận UI (không có lý do
// trùng khớp đúng shape ngẫu nhiên này). Hạ cánh an toàn kể cả nếu nhận định sai: username đó vẫn luôn
// xem được đúng phòng ban của chính mình qua mode=DEPT (deptAutoViewOn()) — gỡ entry extraViewers dư thừa
// không làm mất quyền xem THẬT nào của họ (vì .depts của họ chỉ từng trùng đúng phòng ban chính họ).
const { getAppDataValue, withLockedAppDataValue } = require('../lib/appData');

const LEGACY_PERM_KEY_BY_MODULE = { submission: 'submissionView', contract: 'contractView', car: 'carView', office: 'officeView' };

function computeLegacyViewerSets(users) {
  const legacy = { submission: new Set(), contract: new Set(), car: new Set(), office: new Set() };
  const overBroadLegacy = { submission: new Set(), contract: new Set(), car: new Set(), office: new Set() };
  for (const u of (users || [])) {
    if (!u?.username) continue;
    for (const moduleKey of Object.keys(LEGACY_PERM_KEY_BY_MODULE)) {
      const pv = u.perms?.[LEGACY_PERM_KEY_BY_MODULE[moduleKey]];
      if (pv?.all || (Array.isArray(pv?.depts) && pv.depts.some(d => d !== u.dept))) legacy[moduleKey].add(u.username);
      else if (Array.isArray(pv?.depts) && pv.depts.length && pv.depts.every(d => d === u.dept)) overBroadLegacy[moduleKey].add(u.username);
    }
  }
  return { legacy, overBroadLegacy };
}

// Ghép thêm username hợp lệ (correctSet) + gỡ bỏ ĐÚNG username từng bị thêm dư do bug cũ
// (overBroadSet, KHÔNG còn khớp correctSet) — không đụng tới username khác trong extraViewers (admin tự
// tay thêm qua Ma Trận UI, hoặc hợp lệ vì lý do khác không liên quan 2 flag legacy này).
function reconcileModuleConfig(cfg, correctSet, overBroadSet) {
  const normalized = (cfg && typeof cfg === 'object' && !Array.isArray(cfg))
    ? { mode: cfg.mode === 'CREATOR_ONLY' ? 'CREATOR_ONLY' : 'DEPT', extraViewers: Array.isArray(cfg.extraViewers) ? [...cfg.extraViewers] : [], managerCanView: !!cfg.managerCanView }
    : { mode: 'DEPT', extraViewers: [], managerCanView: false };
  let changed = false;
  correctSet.forEach(un => { if (!normalized.extraViewers.includes(un)) { normalized.extraViewers.push(un); changed = true; } });
  normalized.extraViewers = normalized.extraViewers.filter(un => {
    if (correctSet.has(un)) return true;
    if (overBroadSet.has(un)) { changed = true; return false; }
    return true;
  });
  return { normalized, changed };
}

const VIEW_SCOPE_MODULES = Object.keys(LEGACY_PERM_KEY_BY_MODULE);

async function migrateLegacyViewScopeViewers() {
  try {
    const users = await getAppDataValue('users');
    if (!Array.isArray(users) || !users.length) return;
    const { legacy, overBroadLegacy } = computeLegacyViewerSets(users);
    const anyLegacyFlag = VIEW_SCOPE_MODULES.some(m => legacy[m].size || overBroadLegacy[m].size);
    if (!anyLegacyFlag) return;

    // Đọc trước KHÔNG khoá, chỉ để kiểm tra có THẬT SỰ cần ghi hay không, TRƯỚC khi vào
    // withLockedAppDataValue() — hàm đó LUÔN ghi lại DataValue + bump UpdatedAt dù giá trị mới trùng giá
    // trị cũ (xem lib/appData.js), sẽ vô tình làm admin đang sửa "Ma Trận Phạm Vi Xem Theo Phòng Ban" ở
    // tab khác gặp conflict (version mismatch) do UpdatedAt bị bump KHÔNG CẦN THIẾT ở MỌI LẦN KHỞI ĐỘNG
    // SERVER — 2 seed user ks_kiemsoat/sep_duyet (defaults.js) luôn mang submissionView/contractView.all
    // =true VĨNH VIỄN, nên legacy.submission/contract CHẮC CHẮN > 0 ở mọi lần chạy, kể cả khi KHÔNG còn
    // gì để sửa thật.
    const peekCfg = (await getAppDataValue('deptViewScopeConfig')) || {};
    const anyPeekChanged = VIEW_SCOPE_MODULES.some(m => reconcileModuleConfig(peekCfg[m], legacy[m], overBroadLegacy[m]).changed);
    if (!anyPeekChanged) return;

    await withLockedAppDataValue('deptViewScopeConfig', (current) => {
      const cfg = { ...(current || {}) };
      for (const m of VIEW_SCOPE_MODULES) {
        const { normalized, changed } = reconcileModuleConfig(cfg[m], legacy[m], overBroadLegacy[m]);
        if (changed) cfg[m] = normalized;
      }
      return cfg;
    });
    console.log('✅ [Di trú quyền Xem cũ] Đã đồng bộ deptViewScopeConfig.submission/contract/car/office.extraViewers từ quyền phẳng cũ submissionView/contractView/carView/officeView ngay ở server (không phụ thuộc admin đăng nhập).');
  } catch (err) {
    console.error('⛔ [Di trú quyền Xem cũ] Lỗi khi đồng bộ deptViewScopeConfig:', err.message);
  }
}

module.exports = { migrateLegacyViewScopeViewers, computeLegacyViewerSets, reconcileModuleConfig };
