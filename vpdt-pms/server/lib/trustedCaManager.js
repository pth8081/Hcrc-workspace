// lib/trustedCaManager.js — Quản lý danh sách CA (Certificate Authority) NỘI BỘ được "tin cậy" cho
// các lượt GỌI RA NGOÀI qua HTTPS của chính server này (10/2026, yêu cầu người dùng: khi PM2 gọi API
// sang hệ thống khác dùng HTTPS, cần "nhận diện" được chứng chỉ phía đó — cụ thể là khi hệ thống đích
// dùng chứng chỉ do 1 CA NỘI BỘ công ty cấp, không phải CA công khai Node đã tin sẵn).
//
// KHÁC HẲN lib/tlsCertManager.js (chứng chỉ server này dùng để tự phục vụ HTTPS — hướng VÀO) — đây là
// hướng NGƯỢC LẠI: server này là CLIENT gọi ra ngoài (dsmart16, DSmart API, EWS, bất kỳ API ngoài nào
// sau này), và "chứng chỉ tin cậy" ở đây là CHỨNG CHỈ CÔNG KHAI của CA (không phải private key — hoàn
// toàn không nhạy cảm, ai cũng xem được chứng chỉ gốc của 1 CA công khai lẫn CA nội bộ).
//
// Cơ chế áp dụng — ĐÃ KIỂM CHỨNG THẬT (không chỉ suy luận) bằng cách dựng 1 CA nội bộ giả lập +
// server HTTPS ký bằng CA đó, test cả fetch() lẫn module https:
//   1. NODE_EXTRA_CA_CERTS (biến môi trường, có từ Node rất lâu — KHÔNG phải tính năng mới/kém ổn định)
//      trỏ tới 1 FILE chứa các chứng chỉ CA cộng thêm — áp dụng CHO CẢ fetch() VÀ module https, hoàn
//      toàn KHÔNG cần sửa 1 dòng code nào ở lib/ewsMailer.js/lib/dsmartApiClient.js/
//      jobs/operationOrderApiSync.js. NHƯNG biến này CHỈ được đọc lúc Node KHỞI ĐỘNG (xác nhận bằng
//      test: set process.env.NODE_EXTRA_CA_CERTS từ code đang chạy KHÔNG có tác dụng) — phải là biến
//      môi trường THẬT lúc `pm2 start`, không đặt được qua server/.env (dotenv chỉ set process.env SAU
//      khi Node đã khởi động, quá trễ). Trỏ tới file KHÔNG TỒN TẠI/RỖNG chỉ in cảnh báo, KHÔNG crash.
//   2. tls.setDefaultCACertificates() (API mới hơn, Node >=22.9 — feature-detect, KHÔNG bắt buộc có) —
//      cho phép áp dụng NGAY tại runtime cho tiến trình đang chạy (không cần đợi restart), xác nhận
//      fetch() NHẬN đúng danh sách mới ngay sau khi gọi. Dùng làm lớp "best-effort" bổ sung — KHÔNG
//      thay thế NODE_EXTRA_CA_CERTS (PM2 cluster mode chạy NHIỀU tiến trình, API này chỉ áp dụng cho
//      ĐÚNG 1 tiến trình gọi nó — các tiến trình khác vẫn cần restart để đọc lại NODE_EXTRA_CA_CERTS).
//
// Lưu trữ: KHÔNG qua lib/appData.js (dbo.AppData) — GET /api/data (bulk) đọc TOÀN BỘ bảng AppData
// không qua allowlist nào (xem routes/data.js getAllAppData()), nên 1 key AppData mới sẽ tự động lộ ra
// cho MỌI người dùng đã đăng nhập qua API đó nếu không tự tay thêm logic ẩn riêng. Thay vào đó, lưu
// trực tiếp ra file JSON trong server/certs/ (ĐÃ gitignore, cùng thư mục lib/tlsCertManager.js dùng) —
// tự quản lý hoàn toàn, không đụng tới routes/data.js, đúng pattern đã chọn cho chứng chỉ TLS server.
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const crypto = require('crypto');

const CERTS_DIR = path.join(__dirname, '..', 'certs');
const REGISTRY_PATH = path.join(CERTS_DIR, 'trusted-ca-registry.json');
const BUNDLE_PATH = path.join(CERTS_DIR, 'trusted-ca-bundle.pem');

const MAX_PEM_BYTES = 64 * 1024;

function writeAtomic(filePath, content, mode) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, content, { mode });
  fs.renameSync(tmpPath, filePath);
}

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function saveRegistry(list) {
  fs.mkdirSync(CERTS_DIR, { recursive: true });
  writeAtomic(REGISTRY_PATH, JSON.stringify(list, null, 2), 0o644);
}

function nextId(list) {
  return (list || []).reduce((max, c) => Math.max(max, Number(c.id) || 0), 0) + 1;
}

// Tách 1 file tải lên có thể chứa NHIỀU khối "-----BEGIN CERTIFICATE-----...-----END CERTIFICATE-----"
// (VD admin tải 1 file gồm cả CA gốc + CA trung gian trong CÙNG 1 lượt) thành từng chứng chỉ riêng —
// mỗi khối sẽ thành 1 entry riêng trong registry, giúp xoá/quản lý từng cái độc lập sau này.
function splitPemCertificates(raw) {
  const matches = String(raw || '').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  return matches || [];
}

// validateCaCertPem() — kiểm tra THẬT bằng crypto.X509Certificate (không tự viết parser riêng), BẮT
// BUỘC phải là chứng chỉ CA (trường X509v3 Basic Constraints CA:TRUE) — chặn sớm trường hợp admin tải
// nhầm 1 chứng chỉ SERVER/LEAF (VD export nhầm cert của chính website đích) vào đây, vốn không có tác
// dụng gì khi dùng làm "CA bổ sung" (NODE_EXTRA_CA_CERTS chỉ dùng để mở rộng danh sách CA gốc tin cậy,
// không phải danh sách "server cụ thể được phép").
function validateCaCertPem(pem) {
  let x509;
  try {
    x509 = new crypto.X509Certificate(pem);
  } catch (err) {
    throw new Error(`Không đọc được chứng chỉ (PEM sai định dạng/hỏng): ${err.message}`);
  }
  if (!x509.ca) {
    throw new Error(`Đây là chứng chỉ SERVER (leaf), không phải chứng chỉ CA (Subject: ${x509.subject}) — chỉ chấp nhận chứng chỉ CA gốc/trung gian (X509v3 Basic Constraints CA:TRUE).`);
  }
  return {
    subject: x509.subject,
    issuer: x509.issuer,
    validFrom: x509.validFrom,
    validTo: x509.validTo,
    fingerprint256: x509.fingerprint256
  };
}

function rebuildBundleFile(list) {
  fs.mkdirSync(CERTS_DIR, { recursive: true });
  const content = (list || []).map(c => c.pem.trim()).join('\n') + '\n';
  writeAtomic(BUNDLE_PATH, content, 0o644);
}

// applyRuntimeTrust() — best-effort, KHÔNG BAO GIỜ throw. Chỉ có tác dụng cho ĐÚNG tiến trình Node gọi
// hàm này (xem chú thích đầu file về PM2 cluster mode) — vẫn cần restart để áp dụng cho MỌI tiến trình.
function applyRuntimeTrust(list) {
  try {
    if (typeof tls.setDefaultCACertificates !== 'function') return false;
    const defaults = typeof tls.getCACertificates === 'function' ? tls.getCACertificates('default') : tls.rootCertificates;
    const extra = (list || []).map(c => c.pem.trim());
    tls.setDefaultCACertificates([...defaults, ...extra]);
    return true;
  } catch (err) {
    console.error('⚠️ applyRuntimeTrust() thất bại (bỏ qua, không ảnh hưởng tới HTTP/HTTPS hiện có):', err.message);
    return false;
  }
}

function syncOnStartup() {
  const list = loadRegistry();
  rebuildBundleFile(list);
  applyRuntimeTrust(list);
  return list;
}

function listCaCertificates() {
  return loadRegistry().map(({ pem, ...meta }) => meta);
}

// addCaCertificates() — nhận RAW nội dung file tải lên (có thể nhiều chứng chỉ ghép), validate TỪNG
// khối, CHỈ lưu khi TẤT CẢ đều hợp lệ (tránh lưu nửa chừng rồi báo lỗi gây khó hiểu trạng thái hiện tại).
function addCaCertificates({ rawPem, name, addedBy, addedByName }) {
  const blocks = splitPemCertificates(rawPem);
  if (blocks.length === 0) {
    throw new Error('Không tìm thấy chứng chỉ CA nào trong file (cần đúng định dạng PEM, có dòng -----BEGIN CERTIFICATE-----/-----END CERTIFICATE-----)');
  }
  const metas = blocks.map(validateCaCertPem); // throw ngay nếu có 1 khối không hợp lệ/không phải CA
  const list = loadRegistry();
  const added = [];
  blocks.forEach((pem, i) => {
    const id = nextId(list) + added.length;
    const entry = {
      id, name: blocks.length > 1 ? `${name || 'CA'} #${i + 1}` : (name || metas[i].subject),
      pem, subject: metas[i].subject, issuer: metas[i].issuer,
      validFrom: metas[i].validFrom, validTo: metas[i].validTo, fingerprint256: metas[i].fingerprint256,
      addedBy, addedByName, addedAt: new Date().toISOString()
    };
    list.push(entry);
    added.push(entry);
  });
  saveRegistry(list);
  rebuildBundleFile(list);
  applyRuntimeTrust(list);
  return added.map(({ pem, ...meta }) => meta);
}

function deleteCaCertificate(id) {
  const list = loadRegistry();
  const idx = list.findIndex(c => c.id === id);
  if (idx === -1) throw new Error('NOT_FOUND');
  const [removed] = list.splice(idx, 1);
  saveRegistry(list);
  rebuildBundleFile(list);
  applyRuntimeTrust(list);
  return removed;
}

// Trạng thái cấu hình biến môi trường NODE_EXTRA_CA_CERTS của TIẾN TRÌNH ĐANG CHẠY — chỉ mang tính
// CHẨN ĐOÁN (đọc process.env, KHÔNG set được qua đây, xem chú thích đầu file) — giúp UI báo rõ admin
// đã làm bước cấu hình 1 LẦN qua ecosystem.config.js/systemd hay chưa, thay vì để tự mò.
function getEnvConfigStatus() {
  const current = process.env.NODE_EXTRA_CA_CERTS || null;
  return {
    bundlePath: BUNDLE_PATH,
    nodeExtraCaCertsCurrent: current,
    isConfiguredCorrectly: !!current && path.resolve(current) === path.resolve(BUNDLE_PATH)
  };
}

module.exports = {
  MAX_PEM_BYTES, BUNDLE_PATH,
  validateCaCertPem, splitPemCertificates,
  listCaCertificates, addCaCertificates, deleteCaCertificate,
  rebuildBundleFile, applyRuntimeTrust, syncOnStartup,
  getEnvConfigStatus
};
