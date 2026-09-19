// server/tests/test-purchasing-term-activate-archive.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 3, 9/2026): POST /api/purchasing/terms/:id/activate (routes/purchasing.js,
// module BAS) trước đây kích hoạt 1 bản Nhân Bản (DRAFT, clonedFromTermId trỏ về bản gốc) mà KHÔNG hề
// đụng tới bản ACTIVE CŨ cùng NCC+Mã Điều Khoản — 2 bản cùng ACTIVE song song, chọn nhầm bản CŨ (bậc
// thang đã lỗi thời) khi "Tính Ước Tính" vẫn chạy bình thường, không cảnh báo gì. Nay tự LƯU TRỮ
// (ARCHIVED) mọi bản ACTIVE khác cùng vendorId+termCode TRƯỚC khi kích hoạt bản này — đúng khuôn
// checklistTemplates (routes/checklist.js, templates/:id/activate) đã áp dụng.
//
// Test này KHÔNG mở trình duyệt Playwright — boot thẳng routes/purchasing.js thật, chỉ giả lập tầng lưu
// trữ (lib/recordStore) + xác thực (lib/auth), cùng khuôn tests/test-purchasing-rebate-calculate-period.js.
//
// Chạy: node server/tests/test-purchasing-term-activate-archive.js
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

async function main() {
  console.log('== POST /api/purchasing/terms/:id/activate phải tự lưu trữ bản ACTIVE cũ cùng NCC+Mã Điều Khoản ==');

  const STORE = {
    rebateTerms: [
      // v1 đang ACTIVE (id 10), bị Nhân Bản thành v2 (id 11, DRAFT, clonedFromTermId=10).
      { id: 10, termCode: 'DK-001', vendorId: 1, version: 1, status: 'ACTIVE', history: [] },
      { id: 11, termCode: 'DK-001', vendorId: 1, version: 2, status: 'DRAFT', clonedFromTermId: 10, history: [] },
      // Điều khoản KHÁC (vendorId khác, CÙNG termCode "DK-001") — KHÔNG được đụng vào dù trùng mã, vì
      // termCode chỉ duy nhất trong PHẠM VI 1 NCC (checkDuplicateTermCode(termCode, vendorId, ...)).
      { id: 12, termCode: 'DK-001', vendorId: 2, version: 1, status: 'ACTIVE', history: [] },
      // Điều khoản KHÁC hẳn mã (cùng vendorId 1) — không liên quan, không được đụng vào.
      { id: 13, termCode: 'DK-002', vendorId: 1, version: 1, status: 'ACTIVE', history: [] }
    ]
  };
  stubModule('lib/recordStore', {
    getAllForCollection: async (c) => (STORE[c] || []).slice(),
    withLockedRecordForCollection: async (c, id, mutatorFn) => {
      const list = STORE[c] || [];
      const idx = list.findIndex(x => x.id === Number(id));
      if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
      const result = await mutatorFn(list[idx]);
      list[idx] = result;
      return result;
    },
    withAppLock: async (key, fn) => fn()
  });
  stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
  const MANAGER = { username: 'qlmuahang', name: 'Quản Lý Mua Hàng', dept: 'Mua Hàng', perms: { rebateTermActivate: true }, active: true };
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const fresh = req.headers['x-demo-user'] === MANAGER.username ? MANAGER : null;
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh; req.allUsers = [MANAGER];
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });

  const purchasingRoutes = require('../routes/purchasing');
  const app = express();
  app.use(express.json());
  app.use('/api/purchasing', purchasingRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  async function activate(termId) {
    const res = await fetch(`http://127.0.0.1:${port}/api/purchasing/terms/${termId}/activate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-demo-user': MANAGER.username }
    });
    let body = null;
    try { body = await res.json(); } catch (e) {}
    return { status: res.status, body };
  }

  await test('Kích hoạt bản Nhân Bản (v2, DRAFT) -> thành công, chuyển ACTIVE', async () => {
    const res = await activate(11);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.item.status, 'ACTIVE');
  });

  await test('Bản ACTIVE CŨ cùng NCC+Mã Điều Khoản (v1, id 10) tự chuyển ARCHIVED — không còn 2 bản ACTIVE song song', () => {
    const v1 = STORE.rebateTerms.find(t => t.id === 10);
    assert.strictEqual(v1.status, 'ARCHIVED');
    assert.ok(v1.history.some(h => h.action === 'ARCHIVED'), 'Phải ghi lại lịch sử tự lưu trữ');
  });

  await test('Điều khoản KHÁC vendorId nhưng TRÙNG termCode (id 12) KHÔNG bị đụng vào (termCode chỉ duy nhất trong 1 NCC)', () => {
    const other = STORE.rebateTerms.find(t => t.id === 12);
    assert.strictEqual(other.status, 'ACTIVE', 'Không được lưu trữ nhầm điều khoản của NCC khác');
  });

  await test('Điều khoản KHÁC hẳn termCode (id 13, cùng vendorId) KHÔNG bị đụng vào', () => {
    const other = STORE.rebateTerms.find(t => t.id === 13);
    assert.strictEqual(other.status, 'ACTIVE');
  });

  await test('Chỉ đúng 1 bản ACTIVE còn lại cho NCC 1 + Mã Điều Khoản DK-001 sau khi kích hoạt', () => {
    const activeOnes = STORE.rebateTerms.filter(t => t.vendorId === 1 && t.termCode === 'DK-001' && t.status === 'ACTIVE');
    assert.strictEqual(activeOnes.length, 1);
    assert.strictEqual(activeOnes[0].id, 11);
  });

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
