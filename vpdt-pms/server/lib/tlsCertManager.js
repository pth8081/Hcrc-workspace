// lib/tlsCertManager.js — Quản lý chứng chỉ TLS/HTTPS tải lên qua màn Hệ Thống > Quản Trị > Chứng Chỉ
// TLS (10/2026, yêu cầu người dùng: cho phép team IT tải private key/cert trực tiếp từ giao diện web,
// để server.js tự phục vụ HTTPS KHÔNG cần Nginx — dành cho track triển khai PM2-only, xem
// deploy/Huong-dan-trien-khai-PM2.md). Mô hình đã xác nhận với người dùng:
//   1) Node tự chạy HTTPS (không qua Nginx) — module này chỉ chuẩn bị/đọc file chứng chỉ, server.js tự
//      khởi động 1 https.createServer() THÊM VÀO (không thay) app.listen(PORT) HTTP sẵn có.
//   2) Áp dụng bằng RESTART THỦ CÔNG (pm2 restart) — route upload CHỈ ghi file, KHÔNG tự hot-reload
//      HTTPS server đang chạy (tránh rủi ro/độ phức tạp chuyển 1 server đang chạy sang dùng cert mới mà
//      không có downtime).
//   3) Cổng HTTPS cấu hình qua .env (HTTPS_PORT) — KHÔNG ép cổng 443 (cần quyền root/setcap).
//
// Lưu file ở 3 TÊN CỐ ĐỊNH trong server/certs/ (ĐÃ thêm vào .gitignore — xem .gitignore, private key
// TUYỆT ĐỐI không được commit lên git) — bỏ qua tên file người dùng tải lên để tránh path traversal và
// để luôn biết chắc đọc đúng 3 file nào lúc khởi động.
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const crypto = require('crypto');

const CERTS_DIR = path.join(__dirname, '..', 'certs');
const KEY_PATH = path.join(CERTS_DIR, 'tls-key.pem');
const CERT_PATH = path.join(CERTS_DIR, 'tls-cert.pem');
const CA_PATH = path.join(CERTS_DIR, 'tls-ca.pem');

// Chặn PEM bất thường lớn (khoá/cert thật chỉ vài KB) — chặn sớm trước khi đưa vào tls.createSecureContext.
const MAX_PEM_BYTES = 64 * 1024;

// httpsStatus — trạng thái HTTPS listener THỰC TẾ của tiến trình đang chạy (server.js set lại ngay sau
// khi https.createServer().listen() thành công/thất bại lúc khởi động). Route GET status đọc biến này
// để phân biệt rõ 2 trường hợp dễ nhầm: "đã tải cert mới nhưng CHƯA restart nên vẫn áp dụng cert cũ/chưa
// có HTTPS" so với "đang chạy HTTPS thật với cert hiện có trên đĩa".
const httpsStatus = { active: false, port: null, startedAt: null };

function setHttpsStatus(active, port) {
  httpsStatus.active = !!active;
  httpsStatus.port = active ? port : null;
  httpsStatus.startedAt = active ? new Date().toISOString() : null;
}

function getHttpsStatus() {
  return { ...httpsStatus };
}

function looksLikePem(str) {
  return typeof str === 'string' && /-----BEGIN [A-Z0-9 ]+-----/.test(str) && /-----END [A-Z0-9 ]+-----/.test(str);
}

// validateAndDescribe({keyPem, certPem, caPem}) — kiểm tra THẬT bằng tls.createSecureContext() (chính
// cơ chế Node dùng để nạp HTTPS server — khớp/lệch key-cert hay PEM hỏng sẽ throw ngay ở đây, không cần
// tự viết parser riêng). Trả về metadata AN TOÀN (Subject/Issuer/hạn dùng) để hiển thị UI — KHÔNG BAO
// GIỜ trả lại nội dung private key trong kết quả này.
function validateAndDescribe({ keyPem, certPem, caPem }) {
  if (!looksLikePem(keyPem)) throw new Error('Private Key không đúng định dạng PEM (thiếu dòng -----BEGIN/END-----)');
  if (!looksLikePem(certPem)) throw new Error('Certificate không đúng định dạng PEM (thiếu dòng -----BEGIN/END-----)');
  if (caPem && !looksLikePem(caPem)) throw new Error('CA Chain không đúng định dạng PEM (thiếu dòng -----BEGIN/END-----)');

  // Ném lỗi rõ ràng (vd "key values mismatch", "unable to load key") nếu key không khớp cert hoặc PEM hỏng.
  tls.createSecureContext({ key: keyPem, cert: certPem, ca: caPem || undefined });

  const x509 = new crypto.X509Certificate(certPem);
  return {
    subject: x509.subject,
    issuer: x509.issuer,
    validFrom: x509.validFrom,
    validTo: x509.validTo,
    hasCaChain: !!caPem
  };
}

// saveCertFiles — validate xong mới ghi file (atomic-ish: ghi file tạm rồi rename, tránh để lại 1 bộ
// key/cert dở dang nếu tiến trình bị dừng giữa lúc ghi). Quyền file: key 0600 (chỉ user chạy Node đọc
// được), cert/ca 0644 (không nhạy cảm, chỉ chứa khoá CÔNG KHAI).
function saveCertFiles({ keyPem, certPem, caPem }) {
  const metadata = validateAndDescribe({ keyPem, certPem, caPem });
  fs.mkdirSync(CERTS_DIR, { recursive: true });

  const writeAtomic = (filePath, content, mode) => {
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, content, { mode });
    fs.renameSync(tmpPath, filePath);
  };
  writeAtomic(KEY_PATH, keyPem, 0o600);
  writeAtomic(CERT_PATH, certPem, 0o644);
  if (caPem) {
    writeAtomic(CA_PATH, caPem, 0o644);
  } else if (fs.existsSync(CA_PATH)) {
    fs.unlinkSync(CA_PATH); // không gửi CA chain lần này — xoá CA cũ, tránh lẫn với cert mới không liên quan.
  }
  return metadata;
}

function deleteCertFiles() {
  for (const p of [KEY_PATH, CERT_PATH, CA_PATH]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function hasCertFilesOnDisk() {
  return fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH);
}

// getCertMetadataFromDisk — đọc cert ĐANG LƯU trên đĩa để hiển thị UI (Subject/Issuer/hạn dùng), KHÔNG
// đọc/trả nội dung private key. Trả null nếu chưa có cert nào.
function getCertMetadataFromDisk() {
  if (!fs.existsSync(CERT_PATH)) return null;
  try {
    const certPem = fs.readFileSync(CERT_PATH, 'utf8');
    const x509 = new crypto.X509Certificate(certPem);
    return {
      subject: x509.subject,
      issuer: x509.issuer,
      validFrom: x509.validFrom,
      validTo: x509.validTo,
      hasCaChain: fs.existsSync(CA_PATH)
    };
  } catch (err) {
    return { error: `Cert trên đĩa lỗi/không đọc được: ${err.message}` };
  }
}

// loadHttpsCredentials — dùng lúc KHỞI ĐỘNG server.js. Trả null nếu chưa cấu hình cert nào (im lặng bỏ
// qua HTTPS, không coi là lỗi — HTTP vẫn chạy bình thường). THROW nếu cert có tồn tại nhưng hỏng/lệch
// key (server.js bắt lỗi này, log rõ, KHÔNG crash app — HTTP vẫn phải chạy được).
function loadHttpsCredentials() {
  if (!hasCertFilesOnDisk()) return null;
  const key = fs.readFileSync(KEY_PATH, 'utf8');
  const cert = fs.readFileSync(CERT_PATH, 'utf8');
  const ca = fs.existsSync(CA_PATH) ? fs.readFileSync(CA_PATH, 'utf8') : undefined;
  tls.createSecureContext({ key, cert, ca }); // throw nếu lệch/hỏng — chặn SỚM trước khi đưa cho https.createServer().
  return { key, cert, ca };
}

module.exports = {
  MAX_PEM_BYTES,
  validateAndDescribe,
  saveCertFiles,
  deleteCertFiles,
  hasCertFilesOnDisk,
  getCertMetadataFromDisk,
  loadHttpsCredentials,
  setHttpsStatus,
  getHttpsStatus
};
