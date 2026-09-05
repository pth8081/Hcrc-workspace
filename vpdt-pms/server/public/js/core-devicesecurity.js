// ==========================================
// QUẢN LÝ THIẾT BỊ / 2FA (WebAuthn vân tay-Face ID + TOTP) — tách khỏi core.js (Hạ tầng: tách JS
// client, đợt 6). Gộp 4 khối gốc: (1) tự quản lý thiết bị vân tay của CHÍNH MÌNH (#pfWebauthnSection),
// (2) admin xem/gỡ hộ thiết bị vân tay CỦA NGƯỜI KHÁC (#uWebauthnWrap), (3) admin xem/gỡ hộ TOTP của
// người khác (#uTotpWrap) — cùng màn Sửa Người Dùng nên gộp cùng (1)+(2), và (4) màn bắt buộc thiết lập
// TOTP cho admin (#totpSetupWallModal). canShowBiometricLogin() dùng ở (1) khai báo trong core.js (nạp
// TRƯỚC file này) nên gọi được bình thường. Thuần cơ học, không đổi 1 dòng logic.
// ==========================================

// ==========================================
// QUẢN LÝ THIẾT BỊ VÂN TAY/FACE ID CỦA CHÍNH MÌNH (WebAuthn, #pfWebauthnSection ở profileModal) — xem
// lib/webauthn.js + routes/auth.js. canShowBiometricLogin() khai báo ở khối "ĐĂNG NHẬP BẰNG VÂN TAY"
// bên dưới (function declaration được hoisted trong cùng khối <script>, gọi được từ đây dù đứng sau).
// ==========================================
async function renderWebauthnDeviceList() {
  const wrap = document.getElementById('pfWebauthnListWrap');
  wrap.innerHTML = '<p class="text-gray-400 italic">Đang tải...</p>';
  try {
    const res = await fetch('/api/auth/webauthn/credentials');
    if (!res.ok) { wrap.innerHTML = '<p class="text-red-600 italic">Không tải được danh sách thiết bị.</p>'; return; }
    const list = await res.json();
    if (!list.length) {
      wrap.innerHTML = '<p class="text-gray-400 italic">Chưa đăng ký thiết bị nào.</p>';
      return list;
    }
    wrap.innerHTML = list.map(c => `
      <div class="flex justify-between items-center bg-gray-50 border rounded p-2">
        <div>
          <div class="font-semibold text-gray-700">${escapeHtml(c.deviceLabel || 'Thiết bị chưa đặt tên')}</div>
          <div class="text-[10px] text-gray-400">Đăng ký lúc: ${escapeHtml(c.createdAt || '')}</div>
        </div>
        <button type="button" data-op="deleteBiometricDevice" data-arg0="${c.id}" class="text-red-600 font-bold hover:underline">🗑️ Gỡ</button>
      </div>
    `).join('');
    return list;
  } catch (err) {
    wrap.innerHTML = '<p class="text-red-600 italic">Không tải được danh sách thiết bị.</p>';
  }
}

async function registerBiometricDevice() {
  const btn = document.getElementById('btnRegisterBiometricDevice');
  const btnOriginalHTML = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Đang đăng ký...'; }

  try {
    await loadVendorScript('/vendor/simplewebauthn/browser.min.js');

    const optRes = await fetch('/api/auth/webauthn/register-options', { method: 'POST' });
    if (!optRes.ok) {
      const body = await optRes.json().catch(() => ({}));
      return alert(`⛔ ${body.error || 'Không thể khởi tạo đăng ký thiết bị'}`);
    }
    const optionsJSON = await optRes.json();

    let attestation;
    try {
      attestation = await window.SimpleWebAuthnBrowser.startRegistration({ optionsJSON });
    } catch (e) {
      if (e.name === 'NotAllowedError') return; // người dùng tự huỷ hộp thoại — không báo lỗi
      return alert('⛔ Không đăng ký được vân tay/Face ID: ' + e.message);
    }

    const deviceLabel = document.getElementById('pfWebauthnDeviceLabel').value.trim();
    const verifyRes = await fetch('/api/auth/webauthn/register-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: attestation, deviceLabel })
    });
    if (!verifyRes.ok) {
      const body = await verifyRes.json().catch(() => ({}));
      return alert(`⛔ ${body.error || 'Không thể lưu thiết bị vân tay'}`);
    }

    document.getElementById('pfWebauthnDeviceLabel').value = '';
    await renderWebauthnDeviceList();
    // Nhớ tài khoản này cho MÁY hiện tại — lần sau mở trang đăng nhập sẽ tự ẩn ô gõ Tên đăng nhập, điền
    // sẵn luôn (xem initRememberedLoginUser() ở khối "ĐĂNG NHẬP BẰNG VÂN TAY"). proceedAfterAuth() đã tự
    // làm việc này ở MỌI lượt đăng nhập thành công rồi — gọi thêm ở đây vô hại (ghi đè cùng dữ liệu),
    // giữ lại để không đụng logic đăng ký thiết bị đang chạy ổn.
    setRecognizedLogin(currentUser.username, currentUser.name);
    alert('✅ Đã đăng ký thiết bị này — lần sau đăng nhập/xác thực khi Duyệt có thể dùng vân tay/Face ID.');
  } catch (err) {
    alert('⛔ Không thể kết nối tới máy chủ: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = btnOriginalHTML; }
  }
}

async function deleteBiometricDevice(id) {
  if (!confirm('Gỡ thiết bị vân tay này? Bạn sẽ không đăng nhập/xác thực bằng vân tay từ thiết bị này được nữa.')) return;
  try {
    const res = await fetch(`/api/auth/webauthn/credentials/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return alert(`⛔ ${body.error || 'Không thể gỡ thiết bị'}`);
    }
    const remaining = await renderWebauthnDeviceList();
    // Gỡ hết thiết bị đăng ký -> không còn cách nào dùng vân tay được nữa, xoá luôn tài khoản "đã nhớ"
    // trên máy này (nếu không, màn đăng nhập vẫn ẩn ô gõ Tên đăng nhập dù đăng nhập vân tay giờ chắc chắn
    // thất bại). Chỉ xoá khi biết CHẮC danh sách rỗng (remaining=[]) — bỏ qua nếu tải lại danh sách lỗi
    // (remaining=undefined), tránh xoá nhầm lúc mạng chập chờn.
    if (remaining && remaining.length === 0) setRecognizedLogin(null);
  } catch (err) {
    alert('⛔ Không thể kết nối tới máy chủ: ' + err.message);
  }
}

// ==========================================
// ADMIN XEM/GỠ HỘ THIẾT BỊ VÂN TAY CỦA NGƯỜI KHÁC (#uWebauthnWrap trong màn Sửa Người Dùng) — khác khối
// "CỦA CHÍNH MÌNH" ở trên (Hồ Sơ Cá Nhân). Dùng khi 1 tài khoản mất thiết bị (hoặc quên cả mật khẩu) nên
// không tự đăng nhập lại để tự gỡ — chỉ Quản Trị Viên gọi được (server tự chặn lại, xem GET/DELETE
// /api/auth/webauthn/credentials/:username ở routes/auth.js).
// ==========================================
async function renderAdminWebauthnDeviceList(username) {
  const wrap = document.getElementById('uWebauthnListWrap');
  wrap.innerHTML = '<p class="text-gray-400 italic">Đang tải...</p>';
  try {
    const res = await fetch(`/api/auth/webauthn/credentials/${encodeURIComponent(username)}`);
    if (!res.ok) { wrap.innerHTML = '<p class="text-red-600 italic">Không tải được danh sách thiết bị.</p>'; return; }
    const list = await res.json();
    if (!list.length) {
      wrap.innerHTML = '<p class="text-gray-400 italic">Chưa đăng ký thiết bị nào.</p>';
      return;
    }
    wrap.innerHTML = list.map(c => `
      <div class="flex justify-between items-center bg-gray-50 border rounded p-2">
        <div>
          <div class="font-semibold text-gray-700">${escapeHtml(c.deviceLabel || 'Thiết bị chưa đặt tên')}</div>
          <div class="text-[10px] text-gray-400">Đăng ký lúc: ${escapeHtml(c.createdAt || '')}</div>
        </div>
        <button type="button" data-op="deleteAdminBiometricDevice" data-arg0="${escapeHtml(username)}" data-arg1="${c.id}" class="text-red-600 font-bold hover:underline">🗑️ Gỡ</button>
      </div>
    `).join('');
  } catch (err) {
    wrap.innerHTML = '<p class="text-red-600 italic">Không tải được danh sách thiết bị.</p>';
  }
}

async function deleteAdminBiometricDevice(username, id) {
  if (!confirm(`Gỡ thiết bị vân tay này của "${username}"? Người đó sẽ không đăng nhập/xác thực bằng vân tay từ thiết bị này được nữa (mọi phiên đang mở của họ cũng bị đăng xuất ngay).`)) return;
  try {
    const res = await fetch(`/api/auth/webauthn/credentials/${encodeURIComponent(username)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return alert(`⛔ ${body.error || 'Không thể gỡ thiết bị'}`);
    }
    await renderAdminWebauthnDeviceList(username);
    logSystemAction('USER_MGM', 'REMOVE_WEBAUTHN_DEVICE', `Gỡ hộ thiết bị vân tay/Face ID của người dùng [${username}]`, 'SUCCESS', username);
  } catch (err) {
    alert('⛔ Không thể kết nối tới máy chủ: ' + err.message);
  }
}

// ==========================================
// ADMIN XEM/GỠ HỘ TOTP CỦA NGƯỜI KHÁC (#uTotpWrap trong màn Sửa Người Dùng) — cùng lý do/khuôn với khối
// vân tay ở trên, riêng cho TOTP (bắt buộc với admin, xem lib/totp.js). Dùng khi 1 admin mất điện thoại
// (cài Authenticator) nên không tự đăng nhập lại để tự gỡ — chỉ Quản Trị Viên khác gọi được (server tự
// chặn lại, xem GET/DELETE /api/auth/totp/:username ở routes/auth.js).
// ==========================================
async function renderAdminTotpStatus(username) {
  const wrap = document.getElementById('uTotpStatusWrap');
  wrap.innerHTML = '<p class="text-gray-400 italic">Đang tải...</p>';
  try {
    const res = await fetch(`/api/auth/totp/status/${encodeURIComponent(username)}`);
    if (!res.ok) { wrap.innerHTML = '<p class="text-red-600 italic">Không tải được trạng thái.</p>'; return; }
    const data = await res.json();
    if (data.totpEnabled) {
      wrap.innerHTML = `
        <div class="flex justify-between items-center bg-gray-50 border rounded p-2">
          <span class="text-emerald-700 font-semibold">✅ Đã bật</span>
          <button type="button" data-op="deleteAdminTotp" data-arg0="${escapeHtml(username)}" class="text-red-600 font-bold hover:underline">🗑️ Gỡ Hộ</button>
        </div>`;
    } else {
      wrap.innerHTML = '<p class="text-amber-700 font-semibold">⚠️ Chưa thiết lập — tài khoản sẽ bị chặn mọi thao tác nghiệp vụ cho tới khi tự thiết lập ở lần đăng nhập kế tiếp.</p>';
    }
  } catch (err) {
    wrap.innerHTML = '<p class="text-red-600 italic">Không tải được trạng thái.</p>';
  }
}

async function deleteAdminTotp(username) {
  if (!confirm(`Gỡ xác thực 2 lớp (TOTP) của "${username}"? Người đó sẽ bị bắt thiết lập lại NGAY ở lần đăng nhập kế tiếp (mọi phiên đang mở của họ cũng bị đăng xuất ngay).`)) return;
  try {
    const res = await fetch(`/api/auth/totp/${encodeURIComponent(username)}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return alert(`⛔ ${body.error || 'Không thể gỡ xác thực 2 lớp'}`);
    }
    await renderAdminTotpStatus(username);
    logSystemAction('USER_MGM', 'REMOVE_TOTP', `Gỡ hộ xác thực 2 lớp (TOTP) của người dùng [${username}]`, 'SUCCESS', username);
  } catch (err) {
    alert('⛔ Không thể kết nối tới máy chủ: ' + err.message);
  }
}

// ==========================================
// MÀN BẮT BUỘC THIẾT LẬP TOTP CHO ADMIN (xem #totpSetupWallModal + lib/totp.js) — gọi từ
// proceedAfterAuth() khi user.perms.admin && !user.totpEnabled. Cùng khuôn 2 bước với thiết lập TOTP tự
// chọn ở Hồ Sơ Cá Nhân (setProfileSubTab('TOTP')) nhưng KHÔNG có nút đóng ngang — bắt buộc hoàn tất.
// ==========================================
async function openTotpSetupWall(user) {
  document.getElementById('totpSetupBackupStep').classList.add('hidden');
  document.getElementById('totpSetupQrStep').classList.remove('hidden');
  const codeEl = document.getElementById('totpSetupCode');
  if (codeEl) codeEl.value = '';
  document.getElementById('totpSetupWallModal').classList.remove('hidden');
  try {
    const res = await fetch('/api/auth/totp/setup-options', { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return alert(body.error || '⛔ Không thể khởi tạo thiết lập xác thực 2 lớp');
    }
    const data = await res.json();
    document.getElementById('totpSetupQrImg').src = data.qrDataUrl;
    document.getElementById('totpSetupManualKey').value = data.secret;
    document.getElementById('totpSetupOtpauthLink').href = data.otpauthUri;
  } catch (e) {
    alert('⛔ Không thể kết nối tới máy chủ: ' + e.message);
  }
}

function copyTotpManualKey() {
  const el = document.getElementById('totpSetupManualKey');
  el.select();
  navigator.clipboard?.writeText(el.value).catch(() => { try { document.execCommand('copy'); } catch (e) {} });
}

async function submitTotpSetupVerify(e) {
  e.preventDefault();
  const code = document.getElementById('totpSetupCode').value.trim();
  if (!code) return;
  try {
    const res = await fetch('/api/auth/totp/setup-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return alert(body.error || '⛔ Không thể xác thực mã');
    }
    const data = await res.json();
    if (!data.ok) return alert('❌ Mã không đúng, vui lòng thử lại.');

    const wrap = document.getElementById('totpSetupBackupCodes');
    wrap.innerHTML = (data.backupCodes || []).map(c => `<div class="text-center py-1 bg-white border rounded">${c}</div>`).join('');
    document.getElementById('totpSetupQrStep').classList.add('hidden');
    document.getElementById('totpSetupBackupStep').classList.remove('hidden');
    logSystemAction('USER_MGM', 'TOTP_SETUP', 'Thiết lập xác thực 2 lớp (TOTP) thành công.', 'SUCCESS', currentUser?.username);
  } catch (err) {
    alert('⛔ Không thể kết nối tới máy chủ: ' + err.message);
  }
}

// Wrapper cho checkbox "Tôi đã lưu lại các mã khôi phục" ở #totpSetupBackupStep — thay cho
// onchange="document.getElementById('totpSetupContinueBtn').disabled = !this.checked" (phép gán DOM
// trực tiếp, không phải 1 lời gọi hàm đơn nên không map thẳng qua data-arg-value được — checkbox
// cần .checked chứ không phải .value, nên dùng data-arg-el="0" để nhận cả phần tử rồi tự đọc .checked).
function setTotpBackupConfirmState(checkboxEl) {
  document.getElementById('totpSetupContinueBtn').disabled = !checkboxEl.checked;
}

async function completeTotpSetupWall() {
  document.getElementById('totpSetupWallModal').classList.add('hidden');
  const res = await fetch('/api/auth/me').catch(() => null);
  if (!res || !res.ok) {
    return alert('⛔ Không thể tải lại thông tin tài khoản, vui lòng tải lại trang (F5).');
  }
  const updatedUser = await res.json();
  try {
    await proceedAfterAuth(updatedUser);
  } catch (e) {
    console.error('Lỗi khi vào giao diện chính sau khi thiết lập TOTP:', e);
    alert('⛔ Thiết lập thành công nhưng có lỗi khi tải giao diện chính. Vui lòng tải lại trang (F5).');
  }
}

// Tự gỡ TOTP của CHÍNH mình (Hồ Sơ Cá Nhân, xem #pfTotpSection) — đơn giản nhất là tải lại trang sau
// khi gỡ thành công: tryRestoreSession() (đầu script) sẽ tự gọi lại proceedAfterAuth() với user mới
// (totpEnabled=false), và nhánh admin-chưa-bật-TOTP ở đó tự đưa thẳng vào màn thiết lập lại — không cần
// viết lại luồng đó lần 2 ở đây.
async function removeMyTotp() {
  const password = document.getElementById('pfTotpRemovePassword').value;
  if (!password) return alert('Vui lòng nhập mật khẩu để xác nhận.');
  if (!confirm('Gỡ xác thực 2 lớp? Bạn sẽ phải thiết lập lại ngay ở lần đăng nhập/tải trang kế tiếp.')) return;
  try {
    const res = await fetch('/api/auth/totp', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return alert(body.error || '⛔ Không thể gỡ xác thực 2 lớp');
    }
    logSystemAction('USER_MGM', 'TOTP_SELF_REMOVE', 'Tự gỡ xác thực 2 lớp (TOTP) của chính mình.', 'SUCCESS', currentUser?.username);
    alert('✅ Đã gỡ xác thực 2 lớp. Trang sẽ tải lại để bạn thiết lập lại ngay.');
    location.reload();
  } catch (e) {
    alert('⛔ Không thể kết nối tới máy chủ: ' + e.message);
  }
}

// Thêm thiết bị Authenticator KHÁC mà không cần gỡ TOTP hiện tại — hiện lại ĐÚNG mã QR đang dùng (xem
// POST /api/auth/totp/reveal-secret ở routes/auth.js), quét thêm trên máy thứ 2 không ảnh hưởng máy thứ
// nhất vì cả 2 cùng giữ chung 1 bí mật TOTP.
async function revealTotpSecretForNewDevice() {
  const password = document.getElementById('pfTotpRevealPassword').value;
  if (!password) return alert('Vui lòng nhập mật khẩu để xác nhận.');
  try {
    const res = await fetch('/api/auth/totp/reveal-secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return alert(body.error || '⛔ Không thể hiện lại mã QR');
    }
    const data = await res.json();
    document.getElementById('pfTotpRevealQrImg').src = data.qrDataUrl;
    document.getElementById('pfTotpRevealManualKey').value = data.secret;
    document.getElementById('pfTotpRevealWrap').classList.remove('hidden');
    document.getElementById('pfTotpRevealPassword').value = '';
    logSystemAction('USER_MGM', 'TOTP_REVEAL_SECRET', 'Xem lại mã QR TOTP hiện tại để thêm thiết bị Authenticator khác.', 'SUCCESS', currentUser?.username);
  } catch (e) {
    alert('⛔ Không thể kết nối tới máy chủ: ' + e.message);
  }
}

function copyPfTotpRevealKey() {
  const el = document.getElementById('pfTotpRevealManualKey');
  el.select();
  navigator.clipboard?.writeText(el.value).catch(() => { try { document.execCommand('copy'); } catch (e) {} });
}
