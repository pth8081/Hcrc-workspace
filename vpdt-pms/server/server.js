// server.js — Điểm khởi chạy chính của ứng dụng VPDT (Văn Phòng Điện Tử)
require('dotenv').config();
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const path = require('path');
const securityHeaders = require('./lib/securityHeaders');
const { version: APP_VERSION } = require('./package.json');
const { getPool } = require('./db');
const { seedDefaults } = require('./seedDefaults');
const { requireAuth, blockIfMustChangePassword, verifyToken, COOKIE_NAME } = require('./lib/auth');
// Kiểm quyền truy cập file đính kèm — dùng CHUNG với routes/download.js, xem chú thích ở /uploads bên dưới.
const { uploadsAuthz } = require('./lib/fileAuthz');
const authRoutes = require('./routes/auth');
const dataRoutes = require('./routes/data');
const workflowRoutes = require('./routes/workflow');
const createRoutes = require('./routes/create');
const meetingActionsRoutes = require('./routes/meetingActions');
const recordsRoutes = require('./routes/records');
const systemLogRoutes = require('./routes/systemLog');
const uploadRoutes = require('./routes/upload');
const emailRoutes = require('./routes/email');
const vppCatalogRoutes = require('./routes/vppCatalog');
const priceFileRoutes = require('./routes/priceFile');
const trainingRosterRoutes = require('./routes/trainingRoster');
const trainingPlanImportRoutes = require('./routes/trainingPlanImport');
const adminExportRoutes = require('./routes/adminExport');
const adminCatalogRoutes = require('./routes/adminCatalog');
const storeCatalogImportRoutes = require('./routes/storeCatalogImport');
const uniformEmployeesRoutes = require('./routes/uniformEmployees');
const pwaManifestRoutes = require('./routes/pwaManifest');
const budgetTemplateImportRoutes = require('./routes/budgetTemplateImport');
const downloadRoutes = require('./routes/download');
const trashRoutes = require('./routes/trash');
const { isCaptchaEnabled, generateCaptcha } = require('./lib/captcha');
const { checkContractExpiryReminders } = require('./jobs/contractExpiryReminder');
const { checkLicenseExpiryReminders } = require('./jobs/licenseExpiryReminder');
const { checkItServiceRenewalReminders } = require('./jobs/itServiceRenewalReminder');

const app = express();
const PORT = process.env.PORT || 3000;

// 'trust proxy' — CHỈ bật khi server chạy SAU một reverse proxy thật (ví dụ Nginx theo hướng dẫn
// deploy, mục 8). Mặc định TẮT (không đặt biến môi trường) để tránh lỗ hổng giả mạo IP: rate-limit +
// khoá tài khoản khi đăng nhập sai nhiều lần (routes/auth.js) dựa vào req.ip — nếu bật 'trust proxy' khi
// server không thực sự đứng sau proxy, kẻ tấn công có thể tự đặt header X-Forwarded-For để giả IP khác
// nhau mỗi lần, né được giới hạn. Đặt TRUST_PROXY=1 trong .env nếu deploy đúng 1 lớp Nginx phía trước.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : parseInt(process.env.TRUST_PROXY, 10));
}

// CORS — whitelist tường minh qua ALLOWED_ORIGINS (.env, phân tách bằng dấu phẩy). Trước đây KHÔNG hề
// cấu hình gì (không phải "mở toang *" — Express không tự thêm header CORS nào nên trình duyệt áp
// same-origin mặc định — nhưng đó là an toàn NGẪU NHIÊN, không tường minh). Mặc định KHÔNG đặt biến
// này thì vẫn giữ nguyên hành vi cũ (chỉ same-origin, không có Origin nào được whitelist) — chỉ khi
// cần 1 frontend khác domain gọi tới (hiện chưa có) mới cần khai báo. KHÔNG BAO GIỜ dùng "*": ứng dụng
// xác thực bằng cookie (Allow-Credentials bắt buộc true), origin "*" + credentials bị chính trình
// duyệt từ chối, và nếu cho qua được thì tương đương vô hiệu hoá same-origin policy hoàn toàn.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-Match');
    return res.sendStatus(204);
  }
  next();
});

// Nén gzip cho MỌI response văn bản (HTML/JS/JSON) — trước đây KHÔNG có tầng nén nào (cả ở Node lẫn
// Nginx mẫu ở HUONG_DAN_DEPLOY_UBUNTU.md mục 9b đều chưa bật gzip), nên public/index.html (đã hơn
// 1.3MB do gộp rất nhiều module vào 1 file HTML/JS duy nhất qua nhiều đợt tính năng) và snapshot JSON
// trả về từ GET /api/data đều truyền qua mạng NGUYÊN VĂN không nén — đây là nguyên nhân hợp lý nhất
// khiến ứng dụng "vào chậm dần" theo thời gian khi file càng lớn, không phải do riêng 1 đợt cập nhật
// nào. compression() nén tự động khi client gửi "Accept-Encoding: gzip" (mọi trình duyệt hiện đại),
// giảm được ~70-85% dung lượng với nội dung dạng text như HTML/JS/JSON — không đổi nội dung phản hồi,
// chỉ nén trên đường truyền.
app.use(compression());

app.use(securityHeaders);

// Tài liệu/hồ sơ không còn nhúng base64 trong JSON — file đính kèm được tải lên qua
// POST /api/upload và lưu ra ổ đĩa (thư mục uploads/), collection JSON chỉ giữ fileUrl.
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());

// Rate limit TOÀN CỤC cho mọi /api/* — trước đây chỉ có /api/auth/login (routes/auth.js) được giới
// hạn, mọi API còn lại (đọc/ghi dữ liệu, tải file, gửi email...) không giới hạn tần suất, 1 tài khoản
// hợp lệ (dù quyền thấp) vẫn có thể gọi API dồn dập không giới hạn. Ngưỡng đủ rộng cho thao tác bình
// thường của 1 người dùng thật (SPA tải nhiều đợt dữ liệu khi chuyển tab/lọc/tìm kiếm) nhưng vẫn chặn
// được lạm dụng bằng script. Route nhạy cảm hơn (login, upload, gửi email) đã/sẽ có limiter RIÊNG chặt
// hơn nằm chồng lên (xem routes/auth.js, routes/upload.js, routes/email.js).
//
// Khoá theo USERNAME đã đăng nhập (giải mã thẳng từ cookie JWT, KHÔNG tra DB — chỉ để định danh, việc
// xác thực thật vẫn do requireAuth() lo sau) thay vì theo IP khi có phiên hợp lệ — nhiều người dùng
// thật trong cùng công ty thường ra Internet qua CHUNG 1 IP (NAT văn phòng), khoá thuần theo IP dễ
// khiến cả văn phòng cùng bị tính chung 1 hạn mức, người này dùng nhiều thì người khác bị chặn oan.
// Chưa có/không còn phiên hợp lệ (trước khi đăng nhập, hoặc token đã hết hạn) thì rơi về khoá theo IP
// như cũ (ipKeyGenerator() chuẩn hoá đúng theo IPv4/IPv6, tránh cảnh báo/đụng độ dải mạng của thư viện).
const globalApiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Bạn đang gửi quá nhiều yêu cầu, vui lòng thử lại sau ít phút.' },
  keyGenerator: (req, res) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) {
      try {
        const payload = verifyToken(token);
        if (payload?.sub) return `u:${payload.sub}`;
      } catch { /* token hết hạn/không hợp lệ — rơi về khoá theo IP bên dưới */ }
    }
    return ipKeyGenerator(req.ip);
  }
});
app.use('/api', globalApiRateLimiter);

// API — /api/auth (đăng nhập/đăng xuất) đứng ngoài yêu cầu đăng nhập vì đó CHÍNH LÀ chỗ đăng nhập;
// mọi API còn lại bắt buộc có phiên hợp lệ (requireAuth) — trước đây hoàn toàn không có bước này.
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/workflow', workflowRoutes);
app.use('/api/create', createRoutes);
app.use('/api/meetings', meetingActionsRoutes);
app.use('/api/records', recordsRoutes);
app.use('/api/log', systemLogRoutes);
app.use('/api/upload', requireAuth, blockIfMustChangePassword, uploadRoutes);
app.use('/api/send-email', requireAuth, blockIfMustChangePassword, emailRoutes);
app.use('/api/vpp', vppCatalogRoutes);
app.use('/api/it-price', priceFileRoutes);
app.use('/api/training', trainingRosterRoutes);
app.use('/api/training', trainingPlanImportRoutes);
app.use('/api/admin', adminExportRoutes);
app.use('/api/admin', adminCatalogRoutes);
app.use('/api/stores', storeCatalogImportRoutes);
app.use('/api/uniform', uniformEmployeesRoutes);
app.use('/api/budget', budgetTemplateImportRoutes);
// Route TẢI file đính kèm dùng chung (khác /uploads/ tĩnh bên dưới — chỗ đó dùng để XEM trong Khung Xem
// Bảo Vệ): PDF được đóng dấu watermark trước khi trả về, xem chi tiết ở routes/download.js.
app.use('/api/files/download', requireAuth, blockIfMustChangePassword, downloadRoutes);
app.use('/api/trash', trashRoutes);

// Phục vụ file đính kèm đã tải lên — PHẢI đăng nhập VÀ phải có quyền XEM đúng hồ sơ chứa file đó.
// Trước đây chỉ có requireAuth: BẤT KỲ ai đã đăng nhập (kể cả nhân viên phòng khác hoàn toàn không
// được cấp quyền xem module đó) chỉ cần biết/đoán đúng URL /uploads/<tên-file> là đọc trọn vẹn nội
// dung file, vô hiệu hoá toàn bộ phân quyền theo hồ sơ mà GET /api/files/download đã dựng. URL rất dễ
// lộ (dán vào chat, lịch sử duyệt web, cache trình duyệt của người từng xem hợp lệ, log proxy...).
//
// uploadsAuthz dùng CHUNG lib/fileAuthz.js với routes/download.js, nhưng gọi ở mode 'view' — kiểm theo
// khuôn canView* của từng module, KHÔNG theo cờ "<moduleKey>Download". Đây là điểm mấu chốt: nếu bê
// nguyên phép kiểm của route tải sang đây thì mọi người CHỈ có quyền XEM (không được cấp quyền Tải) sẽ
// bị chặn luôn cả Khung Xem Bảo Vệ — tức là hỏng chức năng xem tài liệu của gần hết người dùng thường.
// Watermark KHÔNG áp dụng ở đây (chỉ route "Tải" mới đóng dấu): Khung Xem Bảo Vệ vẫn nhận file gốc để
// PDF.js/mammoth/exceljs dựng hình như cũ, hành vi hiển thị không đổi.
//
// File không tra ra hồ sơ nào (ảnh đại diện, logo, đính kèm của module chưa rà quyền riêng) vẫn được
// CHO PHÉP — fail-open có chủ ý, giữ đúng hành vi cũ, xem ghi chú ở lib/fileAuthz.js.
app.use('/uploads', requireAuth, blockIfMustChangePassword, uploadsAuthz, express.static(path.join(__dirname, 'uploads')));

// Thư viện vendor lấy thẳng từ node_modules theo đúng bản đã `npm install` — nội dung chỉ đổi khi
// đổi phiên bản package (đi kèm redeploy), nên cache dài hạn được an toàn ở trình duyệt thay vì tải
// lại nguyên file (vài trăm KB - vài MB mỗi thư viện) ở mỗi phiên/mỗi người dùng.
const VENDOR_STATIC_OPTS = { maxAge: '7d', immutable: true };

// Phục vụ PDF.js (tự lưu trên server, không qua CDN) — dùng để vẽ PDF ra <canvas> ở Khung Xem Bảo Vệ
// thay vì plugin PDF gốc của trình duyệt (bị Chrome/Edge chặn khi nằm trong modal có lớp nền mờ, và
// không thể ẩn thanh công cụ In/Tải có sẵn của plugin). Lấy trực tiếp từ node_modules nên luôn khớp
// phiên bản đã cài qua npm, không cần bước copy thủ công.
app.use('/vendor/pdfjs', express.static(path.join(__dirname, 'node_modules', 'pdfjs-dist', 'legacy', 'build'), VENDOR_STATIC_OPTS));

// Phục vụ jsPDF + html2canvas (tự lưu trên server, không qua CDN — cùng lý do với pdfjs ở trên) — dùng
// để XUẤT PDF thật ở Báo Cáo Định Kỳ (chụp từng slide đã render sẵn bằng HTML/CSS thành ảnh rồi ghép
// vào 1 file PDF nhiều trang), thay cho cách cũ dùng window.print() qua iframe ẩn (mở hộp thoại in của
// trình duyệt, không phải tải file thật — xem downloadPrPdf() ở index.html).
app.use('/vendor/jspdf', express.static(path.join(__dirname, 'node_modules', 'jspdf', 'dist'), VENDOR_STATIC_OPTS));
app.use('/vendor/html2canvas', express.static(path.join(__dirname, 'node_modules', 'html2canvas', 'dist'), VENDOR_STATIC_OPTS));

// Phục vụ pdf-lib (tự lưu trên server, không qua CDN — cùng lý do với jspdf/html2canvas ở trên) — dùng
// để GHÉP NHIỀU FILE PDF THẬT thành 1 file duy nhất NGAY TRONG trình duyệt người nộp báo cáo (Báo Cáo
// Định Kỳ, entryType 'PDF') trước khi tải lên — giữ nguyên vẹn định dạng/font/vector gốc, khác hẳn cách
// jsPDF+html2canvas ở trên "chụp ảnh" từng slide. pdf-lib đã sẵn là server dependency (đóng dấu watermark
// hợp đồng/tải file, ghép file Báo Cáo Định Kỳ dạng PDF — xem routes/download.js, lib/reportPdfMerge.js)
// nên dùng lại đúng bản đã cài, không cần thêm gì.
app.use('/vendor/pdf-lib', express.static(path.join(__dirname, 'node_modules', 'pdf-lib', 'dist'), VENDOR_STATIC_OPTS));

// Phục vụ exceljs + mammoth (tự lưu trên server, không qua CDN — cùng lý do với pdfjs/jspdf ở trên) —
// dùng để xem trực tiếp file Excel/Word đính kèm NGAY TRONG trình duyệt người xem (Khung Xem Bảo Vệ),
// thay vì chỉ "Tải về" như trước — xử lý HOÀN TOÀN phía trình duyệt, không có bước xử lý nào chạy trên
// máy chủ, nên không tốn thêm tài nguyên server dù có bao nhiêu người xem cùng lúc (giống hệt cách
// PDF.js/jsPDF/html2canvas ở trên đã làm). exceljs đã sẵn là dependency server-side (đọc/ghi Excel cho
// module Văn phòng phẩm + Quản trị) nên dùng lại đúng file .min.js có sẵn, không cần cài thêm gì.
app.use('/vendor/exceljs', express.static(path.join(__dirname, 'node_modules', 'exceljs', 'dist'), VENDOR_STATIC_OPTS));
app.use('/vendor/mammoth', express.static(path.join(__dirname, 'node_modules', 'mammoth'), VENDOR_STATIC_OPTS));

// Phục vụ DOMPurify — lọc HTML do mammoth.js sinh ra (đọc trực tiếp nội dung .docx người dùng tải lên)
// trước khi gán vào innerHTML, chặn XSS nếu ai đó tải lên 1 file .docx được chế để chứa liên kết
// javascript: hoặc thuộc tính sự kiện (onerror=...) trong nội dung. Đã có sẵn qua jspdf (transitive
// dependency) nên khai báo thẳng làm dependency riêng cho rõ ràng, cùng cách làm với jszip ở dưới.
app.use('/vendor/dompurify', express.static(path.join(__dirname, 'node_modules', 'dompurify', 'dist'), VENDOR_STATIC_OPTS));

// Phục vụ JSZip (tự lưu trên server, không qua CDN — cùng lý do với các thư viện trên) — dùng để giải
// nén file .pptx NGAY TRONG trình duyệt người nộp báo cáo lúc chọn tệp (parsePptxToSlideContents() ở
// index.html, module Báo Cáo Định Kỳ) rồi đọc XML bên trong bằng DOMParser gốc của trình duyệt (không
// cần thêm thư viện XML riêng) — xử lý HOÀN TOÀN phía trình duyệt, giống hệt cách mammoth/exceljs ở
// trên đã làm. jszip đã sẵn là dependency gián tiếp (qua exceljs/mammoth) nên khai báo thẳng làm
// dependency riêng cho rõ ràng, không phụ thuộc ngầm vào cách 2 gói kia cài đặt.
app.use('/vendor/jszip', express.static(path.join(__dirname, 'node_modules', 'jszip', 'dist'), VENDOR_STATIC_OPTS));

// Health check (dùng cho giám sát / load balancer / kiểm tra nhanh sau khi deploy). "version" luôn
// trả về ngay cả khi DB lỗi — dùng để xác nhận server đang chạy ĐÚNG bản code vừa deploy (so khớp với
// package.json trên máy), độc lập với tình trạng kết nối SQL Server.
app.get('/api/health', async (req, res) => {
  try {
    await getPool();
    res.json({ status: 'ok', db: 'connected', version: APP_VERSION });
  } catch (err) {
    console.error('⛔ GET /api/health: kết nối DB lỗi:', err.message);
    const isProd = process.env.NODE_ENV === 'production';
    res.status(500).json({
      status: 'error', db: 'disconnected', version: APP_VERSION,
      ...(isProd ? {} : { detail: err.message })
    });
  }
});

// CAPTCHA số ở trang đăng nhập (KHÔNG cần xác thực — phải gọi được TRƯỚC khi đăng nhập, xem
// lib/captcha.js). CHỈ bật khi CAPTCHA_ENABLED=true (.env); tắt thì trả 404 — client dựa vào đó để ẩn
// hẳn khung nhập CAPTCHA, không hiện dở dang. Giới hạn riêng (không dùng chung globalApiRateLimiter bên
// dưới vì route này KHÔNG cần đăng nhập, phải chặn spam sinh mã tràn bộ nhớ độc lập).
const captchaRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Yêu cầu CAPTCHA quá nhiều lần, vui lòng thử lại sau ít phút.' }
});
app.get('/api/captcha', captchaRateLimiter, (req, res) => {
  if (!isCaptchaEnabled()) return res.status(404).json({ error: 'CAPTCHA chưa được bật' });
  res.json(generateCaptcha());
});

// manifest.json cho PWA (KHÔNG cần xác thực, xem routes/pwaManifest.js — phải sinh động vì có phần
// "shortcuts" đọc cấu hình admin) — đăng ký TRƯỚC static/catch-all bên dưới để không bị index.html nuốt.
app.use(pwaManifestRoutes);

// Phục vụ frontend tĩnh (file index.html đã chuyển đổi sang gọi API thay vì localStorage)
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  try {
    console.log('⏳ Đang kết nối SQL Server...');
    await getPool();
    console.log('⏳ Đang kiểm tra / khởi tạo dữ liệu mặc định...');
    await seedDefaults();
    app.listen(PORT, () => {
      console.log(`✅ VPDT server đang chạy tại http://localhost:${PORT}`);
    });

    // Nhắc hết hạn hợp đồng: kiểm tra ngay lúc khởi động, sau đó lặp lại mỗi 24h.
    // Không phụ thuộc việc có ai mở trình duyệt hay không.
    // CHỈ chạy ở 1 tiến trình khi deploy nhiều tiến trình (PM2 cluster mode, xem
    // ecosystem.config.js/HUONG_DAN_DEPLOY_UBUNTU.md mục 9a) — PM2 gán NODE_APP_INSTANCE=0,1,2...
    // cho từng tiến trình trong cluster; không đặt biến này khi chạy 1 tiến trình (fork mode, mặc
    // định trước đây) nên vẫn chạy như cũ. Không chặn ở đây thì mỗi tiến trình đều tự lặp lại job này,
    // gửi trùng email nhắc hạn N lần (N = số tiến trình).
    const isSchedulerInstance = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
    if (isSchedulerInstance) {
      checkContractExpiryReminders();
      setInterval(checkContractExpiryReminders, 24 * 60 * 60 * 1000);
      checkLicenseExpiryReminders();
      setInterval(checkLicenseExpiryReminders, 24 * 60 * 60 * 1000);
      checkItServiceRenewalReminders();
      setInterval(checkItServiceRenewalReminders, 24 * 60 * 60 * 1000);
    }
  } catch (err) {
    console.error('⛔ Không thể khởi động server:', err.message);
    process.exit(1);
  }
}

start();
