// ==========================================
// PWA: CÀI ĐẶT ỨNG DỤNG + SERVICE WORKER — tách khỏi core.js (Hạ tầng: tách JS client, đợt 6).
// Mục lục gốc + lý do tách xem VERSION.md. Thuần cơ học, không đổi 1 dòng logic — tự chứa (không
// module nào khác phụ thuộc các hàm ở đây; applyPwaShortcutParam() do finishLogin() gọi, switchTab()/
// window[setterName]() tra bằng TÊN HÀM lúc chạy nên không phát sinh phụ thuộc thứ tự nạp file mới).
// ==========================================

// ================== PWA: CÀI ĐẶT ỨNG DỤNG + SERVICE WORKER ==================
// Đăng ký sw.js — bắt buộc phải TỒN TẠI để Chrome/Android coi trang là "cài đặt được", nhưng bản thân
// nó không cache gì (xem comment đầu file public/sw.js) nên đăng ký xong là xong, không cần chờ hay xử
// lý gì thêm ở đây.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.warn('Không đăng ký được Service Worker (không ảnh hưởng chức năng chính):', err.message));
  });
}

// Android/Chrome: trình duyệt tự bắn sự kiện này khi trang đủ điều kiện cài đặt — PHẢI preventDefault()
// + giữ lại để tự quyết định lúc nào hiện nút cài (ở đây là khi mở "⚙️ Cá Nhân Hóa"), thay vì để trình
// duyệt tự hiện banner cài đặt riêng của nó.
let pwaDeferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  pwaDeferredInstallPrompt = e;
});
window.addEventListener('appinstalled', () => {
  pwaDeferredInstallPrompt = null;
});

// Safari iOS không có sự kiện beforeinstallprompt (Apple chưa hỗ trợ) — chỉ có thể phát hiện gián tiếp
// qua User-Agent để hiện hướng dẫn cài thủ công thay vì nút bấm.
function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
// display-mode:standalone (Android/desktop) hoặc navigator.standalone (iOS Safari, thuộc tính riêng của
// Apple không có trong chuẩn) — 2 cách kiểm tra khác nhau tùy nền tảng, phải OR cả hai.
function isPwaInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function initPwaInstallUI() {
  const elInstalled = document.getElementById('pfPwaInstalled');
  const elReady = document.getElementById('pfPwaInstallReady');
  const elIos = document.getElementById('pfPwaInstallIos');
  const elUnsupported = document.getElementById('pfPwaInstallUnsupported');
  [elInstalled, elReady, elIos, elUnsupported].forEach(el => el?.classList.add('hidden'));

  if (isPwaInstalled()) {
    elInstalled?.classList.remove('hidden');
  } else if (pwaDeferredInstallPrompt) {
    elReady?.classList.remove('hidden');
  } else if (isIosDevice()) {
    elIos?.classList.remove('hidden');
  } else {
    elUnsupported?.classList.remove('hidden');
  }
}

async function triggerPwaInstall() {
  if (!pwaDeferredInstallPrompt) return;
  pwaDeferredInstallPrompt.prompt();
  await pwaDeferredInstallPrompt.userChoice;
  // Chrome chỉ cho gọi prompt() 1 lần trên mỗi sự kiện beforeinstallprompt — dùng xong phải bỏ, dù
  // người dùng chọn Cài hay Hủy, tự vẽ lại UI (sẽ rơi về nhánh "unsupported/iOS" cho tới lần sau trình
  // duyệt bắn sự kiện mới, hoặc nhánh "đã cài" nếu vừa đồng ý).
  pwaDeferredInstallPrompt = null;
  initPwaInstallUI();
}

// Phím tắt PWA (?shortcut=<moduleKey> hoặc <moduleKey>:<subTabKey>, do manifest shortcuts[] điều hướng
// tới — xem routes/pwaManifest.js) — đọc 1 lần lúc tải trang, ÁP DỤNG sau khi finishLogin() hoàn tất (lúc
// đó switchTab mới có tác dụng vì nav/permissions đã sẵn sàng), rồi dọn khỏi URL để refresh sau đó không
// bị nhảy tab lại ngoài ý muốn. Phần "subTabKey" (nếu có) gọi tiếp đúng hàm setXSubTab() của module đó —
// PWA_SUBTAB_SETTERS bên dưới PHẢI khớp đúng module nào đang có key dạng "module:subTab" trong
// PWA_SHORTCUT_CATALOG_CLIENT.
const pwaShortcutParam = new URLSearchParams(window.location.search).get('shortcut');
const PWA_SUBTAB_SETTERS = {
  contract: 'setContractSubTab', internal: 'setInternalSubTab',
  office: 'setOfficeSubTab', itSupport: 'setItSupportSubTab', vanHanh: 'setVanHanhSubTab'
};
function applyPwaShortcutParam() {
  if (!pwaShortcutParam) return;
  const [moduleKey, subTabKey] = pwaShortcutParam.split(':');
  window.history.replaceState({}, '', window.location.pathname);
  if (typeof switchTab !== 'function') return;
  try {
    switchTab(moduleKey);
    const setterName = subTabKey && PWA_SUBTAB_SETTERS[moduleKey];
    if (setterName && typeof window[setterName] === 'function') window[setterName](subTabKey);
  } catch (e) { console.warn('Không mở được phím tắt PWA:', pwaShortcutParam, e.message); }
}
