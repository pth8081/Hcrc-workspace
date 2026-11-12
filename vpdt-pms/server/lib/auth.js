// lib/auth.js — Xác thực người dùng thật ở phía server: hash mật khẩu (bcrypt), phát/kiểm tra
// JWT lưu trong cookie httpOnly, và middleware chặn truy cập API khi chưa đăng nhập / không phải
// admin. Trước đây "đăng nhập" chỉ là JS so sánh chuỗi ở trình duyệt — server tin tuyệt đối mọi
// request từ client, khiến GET/POST /api/data không có xác thực gì. Module này là gốc để vá lỗ đó.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getAppDataValue, getAppDataValueCached, withLockedAppDataValue } = require('./appData');

const COOKIE_NAME = 'vpdt_token';
// LỖI ĐÃ VÁ (10/2026, người dùng báo "cứ bị văng hết phiên nhiều lần" khi dùng trên điện thoại): hạn 1h
// cũ quá ngắn so với cách dùng thực tế trên mobile — trình duyệt di động TẠM DỪNG hẳn JS chạy ngầm (kể
// cả nhịp "giữ phiên" mỗi 10 phút ở startSessionKeepAlive(), core.js) khi người dùng chuyển sang app
// khác/khóa màn hình, nên chỉ cần rời app liên tục hơn 1h (rất dễ xảy ra giữa ngày làm việc) là token hết
// hạn THẬT, không có request nào kịp tự làm mới. Tăng lên 8h (đủ 1 ca hành chính) theo xác nhận người
// dùng — KHÔNG làm giảm an toàn đáng kể vì requireAuth() bên dưới vẫn tự tra lại trạng thái tài khoản
// THẬT (active/sessionVersion) ở MỌI request bất kể tuổi token — khóa tài khoản/đổi mật khẩu vẫn mất
// quyền ngay lập tức, không phụ thuộc hạn token; token dài hơn chỉ ảnh hưởng tới trường hợp hiếm là cookie
// httpOnly bị đánh cắp.
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8h — xem cơ chế "trượt hạn theo hoạt động" ở requireAuth() bên dưới
const TOKEN_TTL = '8h';
// Còn lại dưới mốc này (tính từ token hiện tại) thì requireAuth() tự cấp lại token mới đủ 8h — người
// dùng còn đang thao tác (còn gửi request) sẽ không bao giờ bị văng ra giữa chừng; chỉ thật sự hết hạn
// khi ngừng hoạt động liên tục quá 8h (không request nào trong suốt thời gian đó). Giữ nguyên 1h (không
// nhân tỉ lệ theo TTL) — đủ rộng hơn nhịp "giữ phiên" 10 phút để không bao giờ lỡ mốc, không cần renew
// gần như mọi request lúc token còn mới.
const TOKEN_RENEW_THRESHOLD_MS = 60 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('Thiếu JWT_SECRET trong .env — bắt buộc phải đặt trước khi chạy server (xem .env.example).');
  }
  return secret;
}

// Chuỗi trông có phải hash bcrypt hay không (luôn bắt đầu $2a$/$2b$/$2y$) — dùng để phân biệt mật
// khẩu CŨ còn ở dạng plaintext (di trú tự động) với mật khẩu ĐÃ hash rồi (bỏ qua, không hash lại).
function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$/.test(value);
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

async function verifyPassword(plain, hashOrPlain) {
  if (!plain || !hashOrPlain) return false;
  if (isBcryptHash(hashOrPlain)) {
    return bcrypt.compare(plain, hashOrPlain);
  }
  // Phòng trường hợp hiếm: bản ghi chưa kịp di trú (xem seedDefaults.js migratePlaintextPasswords)
  // — so sánh thẳng để không khoá user ra khỏi hệ thống, nhưng KHÔNG dùng đường này cho user mới.
  return plain === hashOrPlain;
}

// So khớp username KHÔNG phân biệt hoa/thường (theo xác nhận người dùng 10/2026: "cho phép user chữ
// hoa và chữ thường như nhau") — DÙNG CHO MỌI lượt tra cứu username THÔ do người dùng/đối tác ngoài tự
// gõ vào lúc xác thực (đăng nhập mật khẩu/TOTP/vân tay, API đối tác ngoài routes/externalAuthVerify.js)
// và lượt kiểm tra TRÙNG LẶP khi tạo/sửa tài khoản (routes/data.js prepareUsersForSave() — "User1" và
// "user1" giờ bị coi là CÙNG 1 tên đăng nhập, không cho phép tồn tại song song 2 tài khoản chỉ khác hoa/
// thường). KHÔNG áp dụng cho các lượt so username NỘI BỘ đã có sẵn (VD req.user.username lấy từ JWT đối
// chiếu lại với CHÍNH bản ghi đã tạo ra JWT đó) — các trường hợp đó luôn khớp tuyệt đối vì cùng 1 nguồn
// gốc, không cần bao hàm hàm này.
function usernameEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Tìm 1 user KHÔNG phân biệt hoa/thường trong mảng users — trả về đúng bản ghi (giữ nguyên hoa/thường
// ĐÃ LƯU trong CSDL), không phải giá trị người dùng vừa gõ. Nơi gọi PHẢI dùng lại `user.username` (bản
// ghi tìm được) cho các thao tác ghi tiếp theo trong CÙNG request (khoá tài khoản/tăng sessionVersion...)
// thay vì tiếp tục dùng biến username thô ban đầu, tránh lệch hoa/thường giữa 2 lượt tra cứu.
function findUserByUsernameCI(users, username) {
  return (users || []).find(u => usernameEquals(u.username, username));
}

// Mã PIN (xác thực bổ sung khi Duyệt, perms.approverAuthLevel = 'PIN') — dãy số, tối thiểu 4 chữ số.
// null = hợp lệ; string = lý do bị từ chối. Dùng chung cho cả admin đặt PIN cho người khác
// (routes/data.js prepareUsersForSave) lẫn người dùng tự đổi PIN của chính mình
// (routes/auth.js POST /change-pin) — trước đây chỉ định nghĩa ở routes/data.js.
function validatePin(pin) {
  if (!/^\d{4,}$/.test(pin)) return 'Mã PIN phải là dãy số, tối thiểu 4 chữ số';
  return null;
}

// Số phiên đăng nhập đồng thời tối đa của 1 tài khoản (11/2026, theo yêu cầu người dùng "cho phép có cái
// box cho phép user được login bao nhiêu phiên trên bao nhiêu máy tại một thời điểm") — field
// user.maxConcurrentSessions do admin gán qua form Sửa Người Dùng (ô "🔐 Số Phiên Đăng Nhập Đồng Thời Tối
// Đa", xem module-admin-submissiongroups.js). Không hợp lệ/để trống -> mặc định 1 (giữ nguyên hành vi gốc
// "1 tài khoản chỉ 1 kết nối tại 1 thời điểm" cho MỌI tài khoản chưa từng được cấp số khác).
function getMaxConcurrentSessions(user) {
  const n = parseInt(user && user.maxConcurrentSessions, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function signToken(user, jti) {
  return jwt.sign(
    // sv (sessionVersion): ký kèm giá trị hiện tại của user để requireAuth() bên dưới có thể phát hiện
    // token đã bị "vô hiệu hóa TOÀN BỘ từ xa" khi mật khẩu/PIN đổi, gỡ TOTP/vân tay... (xem routes/
    // auth.js change-pin/PATCH /me/DELETE totp/DELETE webauthn — các nơi này tăng sessionVersion để đá
    // NGAY mọi phiên đang mở, không phân biệt đang được phép bao nhiêu phiên đồng thời). Trước đây đổi
    // mật khẩu/PIN cho user khác (admin reset) hay chính user tự đổi không hề vô hiệu hóa các phiên JWT
    // ĐANG MỞ ở nơi khác (điện thoại bị mất, máy dùng chung...) — token cũ vẫn xác thực bình thường tới
    // tận khi hết hạn (tối đa 1h, có thể lâu hơn do trượt hạn theo hoạt động).
    //
    // jti (11/2026, hỗ trợ N phiên đồng thời — xem getMaxConcurrentSessions() ở trên): định danh RIÊNG
    // của ĐÚNG phiên đăng nhập này (1 giá trị ngẫu nhiên mới mỗi lần cấp phiên thật, xem
    // grantSessionAfterLogin() ở routes/auth.js) — requireAuth() bên dưới đối chiếu với
    // user.activeSessions (danh sách phiên đang được phép còn hiệu lực, giới hạn đúng
    // maxConcurrentSessions) để biết ĐÚNG phiên này còn sống hay đã bị đá (khi vượt quá số phiên cho
    // phép, phiên cũ nhất bị loại khỏi danh sách) — khác "sv" ở trên vốn chỉ có 2 trạng thái toàn-sống/
    // toàn-chết cho MỌI phiên của 1 tài khoản. Token ký TRƯỚC khi có trường này (đang là phiên đăng nhập
    // THẬT của người dùng thật ngay lúc triển khai tính năng) không có "jti" — requireAuth() cố ý CHO QUA
    // không kiểm theo danh sách (không có gì để đối chiếu), tự nhiên có "jti" khi đăng nhập lại hoặc khi
    // phiên đó được ký lại lúc trượt hạn — không ép ai phải đăng xuất ngay lúc vừa triển khai bản vá này.
    { sub: user.username, admin: !!(user.perms && user.perms.admin), sv: user.sessionVersion || 0, jti },
    getJwtSecret(),
    { expiresIn: TOKEN_TTL }
  );
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== 'false', // mặc định bật (HTTPS) — chỉ tắt khi dev local qua http
    sameSite: 'strict',
    maxAge: TOKEN_TTL_MS
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== 'false',
    sameSite: 'strict'
  });
}

// Chặn mọi request chưa có cookie phiên hợp lệ. Xác minh xong chữ ký JWT rồi còn tra CƯ TRẠNG THÁI
// HIỆN TẠI của tài khoản trong DB (không chỉ tin token) — vì token có hiệu lực tới 1h
// (TOKEN_TTL), nếu chỉ dựa vào token thì 1 tài khoản admin vừa VÔ HIỆU HÓA (nhân viên nghỉ việc) vẫn
// thao tác được bình thường suốt phiên đang mở cho tới khi token hết hạn — không đúng ý "vô hiệu hóa
// là mất quyền NGAY LẬP TỨC". Gắn req.user = { username, admin } (giữ nguyên shape cũ, dùng khắp nơi),
// req.freshUser = bản ghi user đầy đủ vừa đọc được, và req.allUsers = toàn bộ danh sách users cùng
// lượt đọc — để các route phía sau (create.js/workflow.js/records.js/meetingActions.js) không phải tự
// đọc lại DB thêm 1 lần nữa cho cùng mục đích (trước đây mỗi route tự viết lại y hệt đoạn này).
async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Phiên đăng nhập hết hạn hoặc không hợp lệ' });
  }

  try {
    // Dùng bản có cache ngắn hạn (vài giây, xem lib/appData.js) thay vì đọc DB ở MỌI request — đây là
    // middleware chạy trên gần như mọi API, nên đây từng là điểm nhân DB round-trip theo số request
    // (không phải số người dùng) khi tải cao. Vẫn "vô hiệu hóa gần như ngay lập tức" vì cache bị xoá
    // ngay khi có ghi (cùng tiến trình) và tự hết hạn rất nhanh nếu ghi từ tiến trình khác.
    const users = await getAppDataValueCached('users');
    const freshUser = (users || []).find(u => u.username === payload.sub);
    if (!freshUser) return res.status(401).json({ error: 'Tài khoản không còn tồn tại' });
    if (freshUser.active === false) {
      return res.status(401).json({ error: 'Tài khoản đã bị vô hiệu hóa — vui lòng liên hệ quản trị viên' });
    }
    // Mật khẩu/PIN đã đổi (bởi admin hoặc chính người dùng ở phiên/thiết bị khác) kể từ lúc token này
    // được ký -> sessionVersion trong DB đã tăng, không còn khớp "sv" đã ký cứng trong token -> buộc
    // đăng nhập lại thay vì tiếp tục tin 1 token biết chắc đã lỗi thời (xem signToken() ở trên).
    let effectiveUsers = users;
    let effectiveFreshUser = freshUser;
    if ((payload.sv || 0) !== (freshUser.sessionVersion || 0)) {
      // LỖI ĐÃ VÁ (11/2026, người dùng báo "vừa đăng nhập xong bị đăng xuất ngay" dù chỉ dùng ĐÚNG 1
      // thiết bị): PM2 cluster mode chạy nhiều tiến trình Node KHÔNG sticky session (xem chú thích
      // getAppDataValueCached() ở lib/appData.js) — mỗi tiến trình giữ 1 bản cache "users" RIÊNG, chỉ
      // đồng bộ qua tin nhắn IPC phát đi NGAY lúc có ghi (không đợi hết TTL), nhưng việc phát tin đó vẫn
      // cần vài mili-giây để tới các tiến trình còn lại. Request /verify-totp-login vừa CẤP PHIÊN MỚI
      // (tăng sessionVersion) ở 1 tiến trình, rồi client GỌI NGAY /api/auth/me để xác nhận — nếu request
      // đó rơi vào 1 tiến trình KHÁC chưa kịp nhận tin nhắn xoá cache, request đó vẫn đọc bản
      // sessionVersion CŨ từ cache, thấy lệch với "sv" (đã là bản MỚI) trong token vừa cấp -> hiểu
      // NHẦM thành "phiên đã bị đổi mật khẩu/đá bởi nơi khác", đăng xuất oan ngay sau khi vừa đăng nhập
      // thành công — dù không hề có thiết bị/phiên nào khác liên quan. Trước khi kết luận 401 thật, đọc
      // lại THẲNG TỪ CSDL (bỏ qua cache) đúng 1 lần để loại trừ khả năng cache tiến trình này đang trễ —
      // chỉ tốn thêm 1 lượt đọc DB cho đúng NHÁNH HIẾM này (lệch sessionVersion), không ảnh hưởng gì tới
      // đường đi bình thường (khớp ngay từ cache, không vào nhánh này).
      const freshFromDb = await getAppDataValue('users');
      const freshUserFromDb = (freshFromDb || []).find(u => u.username === payload.sub);
      if (!freshUserFromDb || (payload.sv || 0) !== (freshUserFromDb.sessionVersion || 0)) {
        return res.status(401).json({ error: 'Mật khẩu/PIN vừa được thay đổi — vui lòng đăng nhập lại' });
      }
      // Khớp khi đọc thẳng CSDL -> đúng là cache tiến trình này đang trễ (không phải đá thật) -> dùng
      // bản dữ liệu MỚI ĐỌC ĐƯỢC cho phần còn lại của request này (freshUser/allUsers bên dưới), không
      // tiếp tục dùng bản cache cũ nữa.
      effectiveUsers = freshFromDb;
      effectiveFreshUser = freshUserFromDb;
    }

    // Phiên này còn nằm trong danh sách phiên ĐANG ĐƯỢC PHÉP của tài khoản hay không (11/2026, hỗ trợ N
    // phiên đồng thời — xem getMaxConcurrentSessions()/jti ở signToken() phía trên) — khi 1 tài khoản
    // đăng nhập vượt quá số phiên cho phép (maxConcurrentSessions), phiên CŨ NHẤT bị loại khỏi
    // user.activeSessions (xem grantSessionAfterLogin(), routes/auth.js), nên dù "sv" (sessionVersion)
    // vẫn khớp (không phải lỗi đổi mật khẩu), phiên bị loại đó vẫn phải mất hiệu lực NGAY. Token ký
    // TRƯỚC khi tính năng này triển khai không có "jti" — CHO QUA không kiểm theo danh sách (không có gì
    // để đối chiếu, và đây là phiên ĐANG SỐNG THẬT của người dùng thật ngay lúc vừa deploy xong, ép đăng
    // xuất ngay là trải nghiệm tệ không cần thiết — tự nhiên có "jti" ở lượt đăng nhập/trượt hạn kế tiếp).
    let sessionEntry = null;
    if (payload.jti) {
      const sessionsNow = Array.isArray(effectiveFreshUser.activeSessions) ? effectiveFreshUser.activeSessions : [];
      sessionEntry = sessionsNow.find(s => s.jti === payload.jti) || null;
      if (!sessionEntry) {
        // Cùng lý do cache PM2 cluster trễ như nhánh "sv" ở trên — chỉ re-đọc DB nếu CHƯA re-đọc ở đó
        // (tránh đọc DB 2 lần vô ích trong CÙNG 1 request).
        if (effectiveUsers === users) {
          const freshFromDb = await getAppDataValue('users');
          const freshUserFromDb = (freshFromDb || []).find(u => u.username === payload.sub);
          if (freshUserFromDb) {
            effectiveUsers = freshFromDb;
            effectiveFreshUser = freshUserFromDb;
            sessionEntry = (freshUserFromDb.activeSessions || []).find(s => s.jti === payload.jti) || null;
          }
        }
        if (!sessionEntry) {
          return res.status(401).json({ error: 'Phiên đăng nhập này đã bị đăng xuất (có thể do đăng nhập ở thiết bị/máy khác) — vui lòng đăng nhập lại' });
        }
      }
    }

    req.user = { username: effectiveFreshUser.username, admin: !!effectiveFreshUser.perms?.admin };
    req.freshUser = effectiveFreshUser;
    req.allUsers = effectiveUsers || [];
    req.sessionJti = payload.jti || null; // dùng ở các route tự đổi mật khẩu/PIN/gỡ TOTP... của CHÍNH mình (giữ đúng phiên hiện tại khi ký lại token, xem routes/auth.js)

    // Trượt hạn theo hoạt động: token JWT tuyệt đối hết hạn sau 1h (TOKEN_TTL, xác minh ở verifyToken()
    // phía trên) — nhưng nếu người dùng còn đang thao tác (còn request nào đó tới trước khi hết hạn),
    // cấp lại 1 token mới đủ 1h ngay khi thời gian còn lại xuống dưới TOKEN_RENEW_THRESHOLD_MS. Chỉ
    // hết hạn thật khi không có request nào trong suốt 1h liên tục (đúng ý "đang hoạt động thì không
    // bị văng"). payload.exp tính bằng giây (chuẩn JWT), quy đổi ra mili giây để so sánh với Date.now().
    if (payload.exp && (payload.exp * 1000 - Date.now()) < TOKEN_RENEW_THRESHOLD_MS) {
      // Dùng effectiveFreshUser (không phải freshUser) — ở nhánh vừa tự đọc lại CSDL thật phía trên vì
      // lệch sessionVersion do cache trễ, freshUser (bản cache cũ) vẫn mang sessionVersion SAI, ký lại
      // token bằng nó sẽ tái tạo NGUYÊN lỗi vừa tự vá ở request kế tiếp.
      setAuthCookie(res, signToken(effectiveFreshUser, payload.jti));
      // LỖI ĐÃ VÁ (11/2026, người dùng báo "vào máy tính lúc điện thoại đang có phiên thì bị đá âm
      // thầm, không hỏi xác nhận như hướng ngược lại"): routes/auth.js shouldConfirmKick() quyết định
      // có hỏi xác nhận trước khi đá hay không dựa vào lastLoginAt — nhưng field đó trước đây CHỈ được
      // set lúc CẤP PHIÊN MỚI (đăng nhập thật), không hề được cập nhật ở đây mỗi lần trượt hạn. Hậu quả:
      // 1 phiên sống NHIỀU NGÀY liên tục nhờ đúng cơ chế trượt hạn này (NV dùng điện thoại vài ngày
      // không đăng xuất) có lastLoginAt ĐÓNG BĂNG tại lần đăng nhập gốc, nhanh chóng vượt quá
      // TOKEN_TTL_MS (8h) dù phiên đó RÕ RÀNG vẫn còn sống — khiến shouldConfirmKick() hiểu NHẦM "chắc
      // đã hết hạn từ lâu, không cần hỏi" và bỏ qua bước xác nhận y hệt hành vi CŨ (đá ngay không báo
      // trước). Cập nhật lastLoginAt NGAY ở đây (mỗi lần trượt hạn, không chỉ lúc đăng nhập gốc) để phản
      // ánh đúng "phiên này vẫn đang sống tính tới thời điểm nào" — fire-and-forget (không chặn request
      // hiện tại, dữ liệu này không ảnh hưởng gì tới việc xử lý response đang trả về).
      withLockedAppDataValue('users', (collection) => {
        const list = Array.isArray(collection) ? collection : [];
        const idx = list.findIndex(u => u.username === effectiveFreshUser.username);
        if (idx !== -1) {
          const next = { ...list[idx], lastLoginAt: new Date().toISOString() };
          // Cập nhật lastSeenAt của ĐÚNG phiên này trong activeSessions (song song lastLoginAt ở trên,
          // 11/2026) — để shouldConfirmKick()/grantSessionAfterLogin() (routes/auth.js) biết chính xác
          // phiên này "có thể còn sống" tới thời điểm nào khi cần quyết định đá phiên cũ nhất lúc đăng
          // nhập thêm ở thiết bị khác. Chỉ áp dụng khi token CÓ jti (bỏ qua phiên cũ ký trước khi có
          // tính năng này — xem payload.jti ở nhánh kiểm phía trên).
          if (payload.jti && Array.isArray(next.activeSessions)) {
            next.activeSessions = next.activeSessions.map(s => s.jti === payload.jti ? { ...s, lastSeenAt: new Date().toISOString() } : s);
          }
          list[idx] = next;
        }
        return list;
      }).catch(err => console.error('requireAuth: không cập nhật được lastLoginAt/lastSeenAt lúc trượt hạn:', err.message));
    }

    next();
  } catch (err) {
    console.error('requireAuth: lỗi khi xác minh trạng thái tài khoản:', err.message);
    res.status(500).json({ error: 'Không thể xác minh phiên đăng nhập' });
  }
}

// Dùng SAU requireAuth (cần req.freshUser đã gắn sẵn) — chặn mọi route NGHIỆP VỤ khi tài khoản đang
// bị đánh dấu bắt buộc đổi mật khẩu (mustChangePassword: admin vừa đặt/reset mật khẩu tạm cho user,
// hoặc tài khoản vẫn đang dùng đúng mật khẩu mặc định "123456" từ lúc khởi tạo hệ thống — xem
// seedDefaults.js flagKnownDefaultPasswords()), HOẶC khi tài khoản có quyền admin nhưng CHƯA thiết lập
// xác thực 2 lớp (TOTP) — bắt buộc theo yêu cầu "account có quyền admin bắt buộc phải xác thực hai yếu
// tố" (xem lib/totp.js). 2 điều kiện khác nhau nhưng dùng CHUNG 1 middleware (thay vì thêm middleware
// riêng) để không phải rà soát/thêm mount ở toàn bộ ~17 route file đã mount blockIfMustChangePassword —
// chỉ cần sửa ĐÚNG 1 chỗ này là áp dụng ngay cho mọi route nghiệp vụ hiện có. Không cần cờ lưu trữ riêng
// "cần thiết lập TOTP" — điều kiện được SUY RA ngay tại đây (perms.admin && !totpEnabled), tự động đúng
// ngay khi 1 tài khoản vừa được cấp quyền admin (routes/data.js prepareUsersForSave) mà chưa từng thiết
// lập, không cần bất kỳ bước ghi cờ thêm nào ở nơi cấp quyền.
// KHÔNG mount ở routes/auth.js (GET/PATCH /me, /logout, các route /totp/*) — đó chính là lối thoát duy
// nhất để đổi mật khẩu/thiết lập TOTP và gỡ các cờ này, chặn luôn ở đó sẽ tự khoá người dùng không lối
// ra. Cũng KHÔNG mount ở routes/systemLog.js — ghi nhật ký (kể cả lúc đang bị chặn) không rủi ro gì và
// có giá trị lưu vết, không cần chặn.
function blockIfMustChangePassword(req, res, next) {
  if (req.freshUser?.mustChangePassword) {
    return res.status(403).json({
      error: 'Bạn cần đổi mật khẩu trước khi tiếp tục sử dụng hệ thống.',
      mustChangePassword: true
    });
  }
  // Vân tay (WebAuthn) được phép thay thế TOTP khi đăng nhập (chủ đích thiết kế — tiện dùng trên mobile,
  // xem routes/auth.js POST /webauthn/login-verify không đòi thêm bước TOTP sau khi xác thực vân tay
  // thành công) — nên cổng bắt buộc thiết lập 2FA này cũng chấp nhận ĐÃ có ít nhất 1 thiết bị vân tay
  // đăng ký (req.freshUser.webauthnCredentials) làm đủ điều kiện, không chỉ riêng totpEnabled.
  const has2FA = !!req.freshUser?.totpEnabled || (req.freshUser?.webauthnCredentials || []).length > 0;
  if (req.freshUser?.perms?.admin && !has2FA) {
    return res.status(403).json({
      error: 'Tài khoản Quản Trị Viên bắt buộc phải thiết lập ít nhất 1 trong 2 lớp xác thực (TOTP hoặc vân tay/Face ID) trước khi tiếp tục sử dụng hệ thống.',
      totpSetupRequired: true
    });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  TOKEN_TTL_MS,
  getMaxConcurrentSessions,
  isBcryptHash,
  hashPassword,
  verifyPassword,
  usernameEquals,
  findUserByUsernameCI,
  validatePin,
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
  blockIfMustChangePassword
};
