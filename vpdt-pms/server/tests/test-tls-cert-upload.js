// server/tests/test-tls-cert-upload.js
//
// Test cho tính năng Upload Chứng Chỉ TLS/HTTPS qua giao diện web (10/2026, yêu cầu người dùng: team IT
// tự tải private key/certificate để server tự phục vụ HTTPS không cần Nginx) — xem
// lib/tlsCertManager.js + routes/adminTlsCert.js.
//
// Sinh chứng chỉ THẬT bằng openssl lúc chạy test (cùng khuôn tests/test-ews-mailer.js) — 1 cặp
// key/cert HỢP LỆ (khớp nhau) để test luồng thành công, 1 cặp key/cert LỆCH NHAU (sinh từ 2 lần openssl
// độc lập) để test tls.createSecureContext() CHẶN THẬT (không phải giả lập).
//
// Phần route (admin-gate, multipart upload, không BAO GIỜ trả lại nội dung private key trong response)
// chạy router Express THẬT trong tiến trình Node, chỉ stub lib/auth (middleware) + lib/systemLogStore
// (tránh phải có SQL Server thật) — cùng khuôn tests/test-approval-email-config-admin-gate.js.
//
// Chạy: node server/tests/test-tls-cert-upload.js
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { execFileSync } = require('child_process');

const CERTS_DIR = path.join(__dirname, '..', 'certs');
const KEY_PATH = path.join(CERTS_DIR, 'tls-key.pem');
const CERT_PATH = path.join(CERTS_DIR, 'tls-cert.pem');
const CA_PATH = path.join(CERTS_DIR, 'tls-ca.pem');

// Dọn sạch certs/ (chỉ 3 tên file cố định tlsCertManager dùng) — chạy cả TRƯỚC lẫn SAU test để không
// để lại chứng chỉ test giả lỡ dính vào môi trường đang chạy, và để test không bị ảnh hưởng bởi chứng
// chỉ thật (nếu có) đã tồn tại từ trước lúc chạy sandbox này.
function wipeCertsDir() {
  for (const p of [KEY_PATH, CERT_PATH, CA_PATH]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function genKeyCertPair(tmpDir, tag, cn) {
  const keyPath = path.join(tmpDir, `${tag}-key.pem`);
  const certPath = path.join(tmpDir, `${tag}-cert.pem`);
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', `/CN=${cn}`
  ], { stdio: 'ignore' });
  return { keyPem: fs.readFileSync(keyPath, 'utf8'), certPem: fs.readFileSync(certPath, 'utf8') };
}

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', perms: { admin: true } };
const PLAIN = { username: 'nv1', name: 'Nhân Viên Thường', perms: {} };
const USERS = [ADMIN, PLAIN];
let CURRENT_USERNAME = ADMIN.username;
const SYSTEM_LOG_CALLS = [];

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});
stubModule('lib/systemLogStore', {
  insertSystemLog: async (entry) => { SYSTEM_LOG_CALLS.push(entry); return { id: SYSTEM_LOG_CALLS.length }; }
});

const express = require('express');
const { createRunner, assertEqual, assertIncludes } = require('./testHarness');
const tlsCertManager = require('../lib/tlsCertManager');
const adminTlsCertRoutes = require('../routes/adminTlsCert');

let PORT = 0;
function startApp() {
  const app = express();
  app.use('/api/admin/tls-cert', adminTlsCertRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function postMultipart(fields, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const form = new FormData();
  for (const [name, content] of Object.entries(fields)) {
    if (content != null) form.append(name, new Blob([content], { type: 'application/x-pem-file' }), `${name}.pem`);
  }
  const res = await fetch(`http://127.0.0.1:${PORT}/api/admin/tls-cert`, { method: 'POST', body: form });
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body };
}

async function getStatus(asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}/api/admin/tls-cert/status`);
  return { status: res.status, body: await res.json() };
}

async function doDelete(asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}/api/admin/tls-cert`, { method: 'DELETE' });
  return { status: res.status, body: await res.json() };
}

async function main() {
  wipeCertsDir();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpdt-tls-test-'));
  const good = genKeyCertPair(tmpDir, 'good', 'vpdt-test-good.local');
  const otherKey = genKeyCertPair(tmpDir, 'other', 'vpdt-test-other.local'); // key KHÁC — dùng để ghép lệch với good.certPem

  const run = createRunner();
  let server;

  try {
    // ===== 1. lib/tlsCertManager.js — logic validate/save/load THUẦN (không qua HTTP) =====
    await run.run('validateAndDescribe(): key+cert khớp nhau -> trả metadata đúng, có Subject/Issuer/hạn dùng', async () => {
      const meta = tlsCertManager.validateAndDescribe({ keyPem: good.keyPem, certPem: good.certPem });
      assertIncludes(meta.subject, 'vpdt-test-good.local', 'Subject phải khớp CN lúc sinh cert');
      assertEqual(meta.hasCaChain, false, 'Không gửi CA -> hasCaChain false');
      if (!meta.validFrom || !meta.validTo) throw new Error('Phải có validFrom/validTo');
    });

    await run.run('validateAndDescribe(): key LỆCH cert (2 cặp openssl độc lập) -> throw thật qua tls.createSecureContext()', async () => {
      let threw = false;
      try {
        tlsCertManager.validateAndDescribe({ keyPem: otherKey.keyPem, certPem: good.certPem });
      } catch (err) {
        threw = true;
        assertIncludes(err.message.toLowerCase(), 'key', 'Thông báo lỗi lệch key/cert phải nhắc tới "key" (từ chính tls.createSecureContext())');
      }
      if (!threw) throw new Error('PHẢI throw khi key không khớp cert — không được âm thầm chấp nhận');
    });

    await run.run('validateAndDescribe(): PEM giả/rác -> throw rõ ràng, không crash tiến trình', async () => {
      let threw = false;
      try {
        tlsCertManager.validateAndDescribe({ keyPem: 'không phải PEM', certPem: good.certPem });
      } catch (err) { threw = true; }
      if (!threw) throw new Error('PEM rác phải bị chặn ở bước kiểm định dạng (looksLikePem)');
    });

    await run.run('saveCertFiles() + loadHttpsCredentials(): round-trip ghi/đọc đúng, quyền file key là 0600', async () => {
      tlsCertManager.saveCertFiles({ keyPem: good.keyPem, certPem: good.certPem, caPem: null });
      assertEqual(tlsCertManager.hasCertFilesOnDisk(), true, 'Phải nhận ra đã có cert trên đĩa sau khi save');
      const creds = tlsCertManager.loadHttpsCredentials();
      assertEqual(creds.key, good.keyPem, 'Đọc lại key phải đúng nguyên văn đã lưu');
      assertEqual(creds.cert, good.certPem, 'Đọc lại cert phải đúng nguyên văn đã lưu');
      const mode = fs.statSync(KEY_PATH).mode & 0o777;
      assertEqual(mode, 0o600, 'File private key PHẢI chỉ 0600 (chỉ user chạy Node đọc được)');
    });

    await run.run('getCertMetadataFromDisk(): trả metadata AN TOÀN, KHÔNG BAO GIỜ chứa nội dung private key', async () => {
      const meta = tlsCertManager.getCertMetadataFromDisk();
      const asJson = JSON.stringify(meta);
      if (asJson.includes('PRIVATE KEY')) throw new Error('metadata rò rỉ nội dung private key — lỗi NGHIÊM TRỌNG');
      assertIncludes(meta.subject, 'vpdt-test-good.local', 'Metadata đọc lại từ đĩa phải đúng cert đã lưu');
    });

    await run.run('deleteCertFiles(): xoá sạch, hasCertFilesOnDisk() về false', async () => {
      tlsCertManager.deleteCertFiles();
      assertEqual(tlsCertManager.hasCertFilesOnDisk(), false, 'Sau khi xoá phải không còn cert nào trên đĩa');
      assertEqual(tlsCertManager.loadHttpsCredentials(), null, 'Chưa có cert -> loadHttpsCredentials() trả null (im lặng bỏ qua HTTPS, không throw)');
    });

    // ===== 2. routes/adminTlsCert.js — admin-gate + upload qua HTTP thật =====
    server = await startApp();

    await run.run('non-admin bị chặn 403 khi POST /api/admin/tls-cert, KHÔNG ghi file nào', async () => {
      wipeCertsDir();
      const res = await postMultipart({ privateKey: good.keyPem, certificate: good.certPem }, PLAIN);
      assertEqual(res.status, 403, 'Tài khoản thường phải bị 403');
      assertEqual(tlsCertManager.hasCertFilesOnDisk(), false, 'Bị chặn quyền thì KHÔNG được ghi file xuống đĩa');
    });

    await run.run('non-admin bị chặn 403 khi GET /api/admin/tls-cert/status', async () => {
      const res = await getStatus(PLAIN);
      assertEqual(res.status, 403, 'Tài khoản thường không được xem trạng thái chứng chỉ TLS');
    });

    await run.run('admin thiếu field certificate -> 400, không ghi file', async () => {
      wipeCertsDir();
      const res = await postMultipart({ privateKey: good.keyPem }, ADMIN);
      assertEqual(res.status, 400, 'Thiếu certificate phải bị 400');
      assertEqual(tlsCertManager.hasCertFilesOnDisk(), false, 'Thiếu field bắt buộc thì KHÔNG được ghi file');
    });

    await run.run('admin tải key LỆCH cert -> 400 với thông báo an toàn, KHÔNG ghi file, KHÔNG lộ private key trong response', async () => {
      wipeCertsDir();
      const res = await postMultipart({ privateKey: otherKey.keyPem, certificate: good.certPem }, ADMIN);
      assertEqual(res.status, 400, 'Key lệch cert phải bị 400');
      assertIncludes(res.body.error, 'không hợp lệ', 'Thông báo lỗi phải dễ hiểu cho admin');
      if (JSON.stringify(res.body).includes('PRIVATE KEY')) throw new Error('Response lỗi KHÔNG được lặp lại nội dung private key');
      assertEqual(tlsCertManager.hasCertFilesOnDisk(), false, 'Validate thất bại thì KHÔNG được ghi file xuống đĩa');
    });

    await run.run('admin tải key+cert KHỚP nhau -> 200, ghi file thật, response có metadata nhưng KHÔNG có private key, có ghi nhật ký hệ thống', async () => {
      wipeCertsDir();
      SYSTEM_LOG_CALLS.length = 0;
      const res = await postMultipart({ privateKey: good.keyPem, certificate: good.certPem }, ADMIN);
      assertEqual(res.status, 200, 'Key+cert khớp phải được chấp nhận');
      assertIncludes(res.body.certMetadata.subject, 'vpdt-test-good.local', 'Response phải trả đúng Subject cert vừa tải');
      assertIncludes(res.body.message, 'restart', 'Response phải nhắc rõ CẦN RESTART mới áp dụng (mô hình đã chọn, không hot-reload)');
      if (JSON.stringify(res.body).includes('PRIVATE KEY')) throw new Error('Response thành công KHÔNG được lặp lại nội dung private key đã tải lên');
      assertEqual(tlsCertManager.hasCertFilesOnDisk(), true, 'Phải ghi file thật xuống đĩa sau khi validate pass');
      assertEqual(SYSTEM_LOG_CALLS.length, 1, 'Phải ghi đúng 1 dòng nhật ký hệ thống cho hành động tải chứng chỉ');
      assertEqual(SYSTEM_LOG_CALLS[0].module, 'SYSTEM', 'Nhật ký phải đúng module SYSTEM');
      if (SYSTEM_LOG_CALLS[0].description.includes('PRIVATE KEY') || SYSTEM_LOG_CALLS[0].description.includes('BEGIN')) {
        throw new Error('Mô tả nhật ký hệ thống KHÔNG được chứa nội dung private key/cert PEM');
      }
    });

    await run.run('GET /status (admin): hasCertOnDisk=true sau khi đã tải, kèm đúng metadata', async () => {
      const res = await getStatus(ADMIN);
      assertEqual(res.status, 200, 'Admin phải xem được trạng thái');
      assertEqual(res.body.hasCertOnDisk, true, 'Phải phản ánh đúng đã có cert trên đĩa');
      assertIncludes(res.body.certMetadata.subject, 'vpdt-test-good.local', 'Metadata status phải khớp cert vừa tải');
      assertEqual(res.body.httpsListener.active, false, 'Chưa restart (test không gọi setHttpsStatus) -> httpsListener.active phải false, đúng mô hình restart thủ công');
    });

    await run.run('setHttpsStatus(true, port): GET /status phải phản ánh đúng listener đang chạy thật (giả lập server.js set lại sau restart)', async () => {
      tlsCertManager.setHttpsStatus(true, 3443);
      const res = await getStatus(ADMIN);
      assertEqual(res.body.httpsListener.active, true, 'Sau khi server.js set listener active, status phải phản ánh đúng');
      assertEqual(res.body.httpsListener.port, 3443, 'Phải đúng cổng đang chạy');
      tlsCertManager.setHttpsStatus(false, null); // reset cho các test sau
    });

    await run.run('DELETE /api/admin/tls-cert (admin): xoá thành công, status về hasCertOnDisk=false', async () => {
      const res = await doDelete(ADMIN);
      assertEqual(res.status, 200, 'Admin phải xoá được chứng chỉ đang có');
      const after = await getStatus(ADMIN);
      assertEqual(after.body.hasCertOnDisk, false, 'Sau khi xoá, status phải phản ánh đúng KHÔNG còn cert');
    });

    await run.run('DELETE khi chưa có cert nào -> 404', async () => {
      const res = await doDelete(ADMIN);
      assertEqual(res.status, 404, 'Xoá khi chưa có cert phải trả 404, không phải 200 giả');
    });

    await run.run('non-admin bị chặn 403 khi DELETE /api/admin/tls-cert', async () => {
      await postMultipart({ privateKey: good.keyPem, certificate: good.certPem }, ADMIN); // dựng lại 1 cert để test
      const res = await doDelete(PLAIN);
      assertEqual(res.status, 403, 'Tài khoản thường không được xoá chứng chỉ TLS');
      assertEqual(tlsCertManager.hasCertFilesOnDisk(), true, 'Bị chặn quyền thì cert vẫn còn nguyên, không bị xoá nhầm');
    });

  } finally {
    if (server) server.close();
    wipeCertsDir();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  run.summary();
}

main().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
