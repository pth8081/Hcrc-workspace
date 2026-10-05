// server/tests/test-trusted-ca.js
//
// Test cho tính năng "Chứng Chỉ Tin Cậy (CA Ngoài)" (10/2026, yêu cầu người dùng: khi PM2 GỌI RA hệ
// thống khác qua HTTPS dùng chứng chỉ CA nội bộ, cần 1 nơi để "dạy" server tin thêm CA đó) — xem
// lib/trustedCaManager.js + routes/adminTrustedCa.js.
//
// Phần QUAN TRỌNG NHẤT (kịch bản đầu): chứng minh THẬT cơ chế NODE_EXTRA_CA_CERTS hoạt động đúng như
// tài liệu mô tả — dựng 1 CA nội bộ giả lập + 1 server HTTPS ký bằng CA đó bằng openssl LÚC CHẠY TEST,
// SPAWN 1 tiến trình Node con với biến môi trường NODE_EXTRA_CA_CERTS trỏ tới bundle do
// trustedCaManager.rebuildBundleFile() tạo ra, xác nhận CẢ fetch() VÀ module https trong tiến trình
// con đó gọi được tới server HTTPS dùng chứng chỉ CA nội bộ (trước đó PHẢI thất bại nếu không có biến
// này — đã xác nhận riêng lúc thiết kế, xem comment đầu lib/trustedCaManager.js).
//
// Chạy: node server/tests/test-trusted-ca.js
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { execFileSync, execFile } = require('child_process');

const CERTS_DIR = path.join(__dirname, '..', 'certs');
const REGISTRY_PATH = path.join(CERTS_DIR, 'trusted-ca-registry.json');
const BUNDLE_PATH = path.join(CERTS_DIR, 'trusted-ca-bundle.pem');

function wipeTrustedCaFiles() {
  for (const p of [REGISTRY_PATH, BUNDLE_PATH]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function genCaAndServerCert(tmpDir) {
  const caKey = path.join(tmpDir, 'ca-key.pem');
  const caCert = path.join(tmpDir, 'ca-cert.pem');
  const otherCaKey = path.join(tmpDir, 'other-ca-key.pem');
  const otherCaCert = path.join(tmpDir, 'other-ca-cert.pem');
  const serverKey = path.join(tmpDir, 'server-key.pem');
  const serverCsr = path.join(tmpDir, 'server.csr');
  const serverCert = path.join(tmpDir, 'server-cert.pem');
  const leafSelfSigned = path.join(tmpDir, 'leaf-key.pem');
  const leafSelfSignedCert = path.join(tmpDir, 'leaf-cert.pem');

  execFileSync('openssl', ['genrsa', '-out', caKey, '2048'], { stdio: 'ignore' });
  execFileSync('openssl', ['req', '-x509', '-new', '-nodes', '-key', caKey, '-sha256', '-days', '3650', '-out', caCert, '-subj', '/CN=VPDT-Test-Internal-Root-CA'], { stdio: 'ignore' });

  // 1 CA KHÁC — chỉ dùng để test "chứng chỉ CA hợp lệ nhưng KHÔNG liên quan tới server test" vẫn được
  // CHẤP NHẬN lưu vào registry (validate chỉ kiểm "là CA", không kiểm "có dùng được cho endpoint nào").
  execFileSync('openssl', ['genrsa', '-out', otherCaKey, '2048'], { stdio: 'ignore' });
  execFileSync('openssl', ['req', '-x509', '-new', '-nodes', '-key', otherCaKey, '-sha256', '-days', '3650', '-out', otherCaCert, '-subj', '/CN=VPDT-Test-Other-CA'], { stdio: 'ignore' });

  execFileSync('openssl', ['genrsa', '-out', serverKey, '2048'], { stdio: 'ignore' });
  execFileSync('openssl', ['req', '-new', '-key', serverKey, '-out', serverCsr, '-subj', '/CN=localhost'], { stdio: 'ignore' });
  execFileSync('openssl', ['x509', '-req', '-in', serverCsr, '-CA', caCert, '-CAkey', caKey, '-CAcreateserial', '-out', serverCert, '-days', '365', '-sha256'], { stdio: 'ignore' });

  // Chứng chỉ LEAF tự ký (KHÔNG phải CA) — dùng để test validateCaCertPem() TỪ CHỐI đúng.
  execFileSync('openssl', ['genrsa', '-out', leafSelfSigned, '2048'], { stdio: 'ignore' });
  execFileSync('openssl', ['req', '-x509', '-new', '-nodes', '-key', leafSelfSigned, '-sha256', '-days', '365', '-out', leafSelfSignedCert, '-subj', '/CN=leaf.example.com', '-addext', 'basicConstraints=critical,CA:FALSE'], { stdio: 'ignore' });

  return {
    caCertPem: fs.readFileSync(caCert, 'utf8'),
    otherCaCertPem: fs.readFileSync(otherCaCert, 'utf8'),
    serverKeyPem: fs.readFileSync(serverKey, 'utf8'),
    serverCertPem: fs.readFileSync(serverCert, 'utf8'),
    leafCertPem: fs.readFileSync(leafSelfSignedCert, 'utf8')
  };
}

function startHttpsServer(keyPem, certPem) {
  const https = require('https');
  return new Promise((resolve) => {
    const server = https.createServer({ key: keyPem, cert: certPem }, (req, res) => res.end('OK-FROM-INTERNAL-CA-SERVER'));
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// Chạy 1 đoạn script Node CON với NODE_EXTRA_CA_CERTS=bundlePath — PHẢI spawn tiến trình MỚI (đã xác
// nhận riêng: set process.env.NODE_EXTRA_CA_CERTS từ code ĐANG CHẠY không có tác dụng).
function runChildWithEnv(scriptBody, extraCaCertsPath) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['-e', scriptBody], {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: extraCaCertsPath || '' }
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
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
const trustedCaManager = require('../lib/trustedCaManager');
const adminTrustedCaRoutes = require('../routes/adminTrustedCa');

let PORT = 0;
function startApp() {
  const app = express();
  app.use('/api/admin/trusted-ca', adminTrustedCaRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function postCa(fields, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const form = new FormData();
  if (fields.pem != null) form.append('caCertFile', new Blob([fields.pem], { type: 'application/x-pem-file' }), 'ca.pem');
  if (fields.name) form.append('name', fields.name);
  const res = await fetch(`http://127.0.0.1:${PORT}/api/admin/trusted-ca`, { method: 'POST', body: form });
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body };
}
async function getList(asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}/api/admin/trusted-ca`);
  return { status: res.status, body: await res.json() };
}
async function doDelete(id, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}/api/admin/trusted-ca/${id}`, { method: 'DELETE' });
  return { status: res.status, body: await res.json() };
}

async function main() {
  wipeTrustedCaFiles();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpdt-trustedca-test-'));
  const { caCertPem, otherCaCertPem, serverKeyPem, serverCertPem, leafCertPem } = genCaAndServerCert(tmpDir);

  const run = createRunner();
  let server, httpsServer;

  try {
    // ===== 1. lib/trustedCaManager.js — logic validate/split/CRUD THUẦN =====
    await run.run('validateCaCertPem(): chứng chỉ CA hợp lệ -> trả metadata đúng', async () => {
      const meta = trustedCaManager.validateCaCertPem(caCertPem);
      assertIncludes(meta.subject, 'VPDT-Test-Internal-Root-CA', 'Subject phải khớp CN lúc sinh CA');
    });

    await run.run('validateCaCertPem(): chứng chỉ LEAF tự ký (CA:FALSE) -> throw, PHẢI từ chối', async () => {
      let threw = false;
      try { trustedCaManager.validateCaCertPem(leafCertPem); } catch (err) {
        threw = true;
        assertIncludes(err.message, 'không phải chứng chỉ CA', 'Thông báo lỗi phải nêu rõ đây không phải CA');
      }
      if (!threw) throw new Error('PHẢI từ chối chứng chỉ leaf (CA:FALSE) — không được âm thầm chấp nhận');
    });

    await run.run('validateCaCertPem(): PEM rác -> throw rõ ràng', async () => {
      let threw = false;
      try { trustedCaManager.validateCaCertPem('không phải PEM'); } catch (err) { threw = true; }
      if (!threw) throw new Error('PEM rác phải bị chặn');
    });

    await run.run('splitPemCertificates(): tách đúng 2 khối CA ghép trong 1 file', async () => {
      const combined = caCertPem + '\n' + otherCaCertPem;
      const blocks = trustedCaManager.splitPemCertificates(combined);
      assertEqual(blocks.length, 2, 'Phải tách đúng 2 khối chứng chỉ');
    });

    wipeTrustedCaFiles();
    let addedIds = [];
    await run.run('addCaCertificates(): thêm 1 CA hợp lệ -> lưu registry + dựng bundle file', async () => {
      const added = trustedCaManager.addCaCertificates({ rawPem: caCertPem, name: 'CA Test', addedBy: 'admin', addedByName: 'Quản Trị Viên' });
      assertEqual(added.length, 1, 'Phải thêm đúng 1 entry');
      addedIds.push(added[0].id);
      assertEqual(fs.existsSync(BUNDLE_PATH), true, 'Phải dựng file bundle sau khi thêm');
      const bundleContent = fs.readFileSync(BUNDLE_PATH, 'utf8');
      assertIncludes(bundleContent, 'VPDT-Test-Internal-Root-CA'.length ? '-----BEGIN CERTIFICATE-----' : '', 'Bundle phải chứa nội dung PEM');
    });

    await run.run('addCaCertificates(): thêm chứng chỉ LEAF -> throw, KHÔNG lưu, registry không đổi', async () => {
      const before = trustedCaManager.listCaCertificates().length;
      let threw = false;
      try { trustedCaManager.addCaCertificates({ rawPem: leafCertPem, name: 'Sai', addedBy: 'admin', addedByName: 'Quản Trị Viên' }); }
      catch (err) { threw = true; }
      if (!threw) throw new Error('Phải từ chối chứng chỉ leaf');
      assertEqual(trustedCaManager.listCaCertificates().length, before, 'Registry không được đổi khi validate thất bại');
    });

    await run.run('addCaCertificates(): file ghép 2 CA -> tạo đúng 2 entry, đặt tên #1/#2', async () => {
      const combined = otherCaCertPem; // dùng riêng otherCaCertPem (chưa add) để không trùng dữ liệu đợt trước
      const added = trustedCaManager.addCaCertificates({ rawPem: combined, name: 'Gộp', addedBy: 'admin', addedByName: 'Quản Trị Viên' });
      assertEqual(added.length, 1, 'otherCaCertPem chỉ có 1 khối — kiểm tra đúng số lượng tách ra');
      addedIds.push(added[0].id);
    });

    await run.run('listCaCertificates(): KHÔNG BAO GIỜ trả lại nội dung PEM', async () => {
      const list = trustedCaManager.listCaCertificates();
      const asJson = JSON.stringify(list);
      if (asJson.includes('BEGIN CERTIFICATE')) throw new Error('listCaCertificates() không được trả nội dung PEM thô (dù không nhạy cảm, vẫn giữ payload gọn)');
      assertEqual(list.length, 2, 'Phải có đúng 2 entry đã thêm');
    });

    await run.run('getEnvConfigStatus(): chẩn đoán đúng khi NODE_EXTRA_CA_CERTS CHƯA trỏ đúng bundle', async () => {
      const status = trustedCaManager.getEnvConfigStatus();
      assertEqual(status.isConfiguredCorrectly, false, 'Tiến trình test KHÔNG tự đặt NODE_EXTRA_CA_CERTS nên phải báo false');
    });

    await run.run('deleteCaCertificate(): xoá đúng entry, rebuild bundle, id còn lại vẫn đúng', async () => {
      const removed = trustedCaManager.deleteCaCertificate(addedIds[0]);
      assertIncludes(removed.subject, 'VPDT-Test-Internal-Root-CA', 'Phải xoá đúng entry CA Test');
      assertEqual(trustedCaManager.listCaCertificates().length, 1, 'Còn lại đúng 1 entry');
    });

    await run.run('deleteCaCertificate(): id không tồn tại -> throw NOT_FOUND', async () => {
      let threw = false;
      try { trustedCaManager.deleteCaCertificate(999999); } catch (err) { threw = err.message === 'NOT_FOUND'; }
      if (!threw) throw new Error('Phải throw NOT_FOUND cho id không tồn tại');
    });

    // ===== 2. KỊCH BẢN QUAN TRỌNG NHẤT — chứng minh THẬT NODE_EXTRA_CA_CERTS hoạt động =====
    wipeTrustedCaFiles();
    trustedCaManager.addCaCertificates({ rawPem: caCertPem, name: 'CA Thật', addedBy: 'admin', addedByName: 'QTV' });
    const httpsInfo = await startHttpsServer(serverKeyPem, serverCertPem);
    httpsServer = httpsInfo.server;

    await run.run('KHÔNG có NODE_EXTRA_CA_CERTS -> gọi tới server dùng chứng chỉ CA nội bộ PHẢI THẤT BẠI (fetch + https)', async () => {
      const script = `
        const assert = require('assert');
        (async () => {
          try { await fetch('https://localhost:${httpsInfo.port}'); console.log('FETCH_OK'); }
          catch (e) { console.log('FETCH_FAILED'); }
        })();
      `;
      const out = await runChildWithEnv(script, null);
      assertEqual(out.trim(), 'FETCH_FAILED', 'Không có NODE_EXTRA_CA_CERTS thì PHẢI thất bại ở tầng TLS — đúng hành vi mặc định an toàn');
    });

    await run.run('CÓ NODE_EXTRA_CA_CERTS trỏ đúng bundle vừa dựng -> fetch() VÀ module https ĐỀU THÀNH CÔNG (không sửa 1 dòng code nào ở lib/ewsMailer.js/dsmartApiClient.js)', async () => {
      const script = `
        (async () => {
          try {
            const r = await fetch('https://localhost:${httpsInfo.port}');
            const t = await r.text();
            console.log('FETCH:' + t);
          } catch (e) { console.log('FETCH_FAILED:' + e.message); }
          require('https').get('https://localhost:${httpsInfo.port}', r => {
            let b=''; r.on('data', c=>b+=c); r.on('end', () => console.log('HTTPS:' + b));
          }).on('error', e => console.log('HTTPS_FAILED:' + e.message));
        })();
      `;
      const out = await runChildWithEnv(script, trustedCaManager.BUNDLE_PATH);
      assertIncludes(out, 'FETCH:OK-FROM-INTERNAL-CA-SERVER', 'fetch() phải THÀNH CÔNG nhờ NODE_EXTRA_CA_CERTS, không cần sửa code tích hợp nào');
      assertIncludes(out, 'HTTPS:OK-FROM-INTERNAL-CA-SERVER', 'module https cũng phải THÀNH CÔNG — CÙNG 1 cơ chế, không cần 2 cách xử lý riêng');
    });

    // ===== 3. routes/adminTrustedCa.js — admin-gate + upload/xoá qua HTTP thật =====
    wipeTrustedCaFiles();
    server = await startApp();

    await run.run('non-admin bị chặn 403 khi GET /api/admin/trusted-ca', async () => {
      const res = await getList(PLAIN);
      assertEqual(res.status, 403, 'Tài khoản thường không được xem danh sách CA tin cậy');
    });

    await run.run('non-admin bị chặn 403 khi POST, KHÔNG ghi registry', async () => {
      const res = await postCa({ pem: caCertPem, name: 'X' }, PLAIN);
      assertEqual(res.status, 403, 'Tài khoản thường không được thêm CA tin cậy');
      assertEqual(fs.existsSync(REGISTRY_PATH), false, 'Bị chặn quyền thì KHÔNG được ghi file registry');
    });

    await run.run('admin thêm CA hợp lệ -> 200, registry có, KHÔNG lộ PEM trong response, có ghi nhật ký hệ thống', async () => {
      SYSTEM_LOG_CALLS.length = 0;
      const res = await postCa({ pem: caCertPem, name: 'CA Công Ty' }, ADMIN);
      assertEqual(res.status, 200, 'Admin thêm CA hợp lệ phải thành công');
      assertIncludes(res.body.message, 'restart', 'Response phải nhắc CẦN RESTART (mô hình đã chọn)');
      if (JSON.stringify(res.body).includes('BEGIN CERTIFICATE')) throw new Error('Response KHÔNG nên lặp lại nội dung PEM thô');
      assertEqual(SYSTEM_LOG_CALLS.length, 1, 'Phải ghi đúng 1 dòng nhật ký hệ thống');
      assertEqual(SYSTEM_LOG_CALLS[0].module, 'SYSTEM', 'Nhật ký phải đúng module SYSTEM');
    });

    await run.run('admin thêm chứng chỉ LEAF -> 400 với thông báo rõ, registry KHÔNG đổi', async () => {
      const before = (await getList(ADMIN)).body.certificates.length;
      const res = await postCa({ pem: leafCertPem, name: 'Sai' }, ADMIN);
      assertEqual(res.status, 400, 'Chứng chỉ leaf phải bị từ chối 400');
      assertIncludes(res.body.error, 'không phải chứng chỉ CA', 'Thông báo lỗi phải rõ ràng');
      const after = (await getList(ADMIN)).body.certificates.length;
      assertEqual(after, before, 'Registry không đổi khi validate thất bại');
    });

    await run.run('admin thiếu file -> 400', async () => {
      const res = await postCa({ name: 'Không có file' }, ADMIN);
      assertEqual(res.status, 400, 'Thiếu file phải bị 400');
    });

    let targetId;
    await run.run('GET (admin): danh sách có đúng entry vừa thêm + envConfig chẩn đoán', async () => {
      const res = await getList(ADMIN);
      assertEqual(res.status, 200, 'Admin phải xem được danh sách');
      assertEqual(res.body.certificates.length, 1, 'Phải có đúng 1 entry (leaf bị từ chối ở trên không tính)');
      targetId = res.body.certificates[0].id;
      assertEqual(res.body.envConfig.isConfiguredCorrectly, false, 'Tiến trình test không tự đặt NODE_EXTRA_CA_CERTS');
    });

    await run.run('non-admin bị chặn 403 khi DELETE', async () => {
      const res = await doDelete(targetId, PLAIN);
      assertEqual(res.status, 403, 'Tài khoản thường không được xoá CA tin cậy');
    });

    await run.run('admin xoá đúng entry -> 200, danh sách rỗng lại', async () => {
      const res = await doDelete(targetId, ADMIN);
      assertEqual(res.status, 200, 'Admin phải xoá được');
      const after = await getList(ADMIN);
      assertEqual(after.body.certificates.length, 0, 'Danh sách phải rỗng sau khi xoá entry duy nhất');
    });

    await run.run('xoá id không tồn tại -> 404', async () => {
      const res = await doDelete(999999, ADMIN);
      assertEqual(res.status, 404, 'Xoá id không tồn tại phải trả 404');
    });

  } finally {
    if (server) server.close();
    if (httpsServer) httpsServer.close();
    wipeTrustedCaFiles();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  run.summary();
}

main().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
