'use strict';

// tests/test-orgchart-diagram-missing-appdata-key-fix.js
//
// LỖI ĐÃ VÁ (báo cáo người dùng 11/2026, kèm ảnh chụp "⛔ Không thể thêm Phòng Ban" ngay lần đầu bấm
// "➕ Thêm Vào Sơ Đồ" ở tab "🖼️ Cây Sơ Đồ Tổ Chức" trên server THẬT đã triển khai): khoá AppData
// "orgChartDiagramNodes" (giới thiệu v29.78, lib/orgChartDiagramTree.js) bị BỎ SÓT khỏi DEFAULTS
// (defaults.js) — seedDefaults() (chạy mỗi lần khởi động/pm2 restart, xem seedDefaults.js) chỉ tự chèn 1
// dòng vào dbo.AppData cho khoá CÓ MẶT trong DEFAULTS, nên server đã triển khai TRƯỚC khi khoá này được
// thêm vào DEFAULTS sẽ KHÔNG BAO GIỜ tự có dòng đó. GET /api/org-chart/diagram-nodes vẫn chạy được
// (getAppDataValue(...) || [] — tự có giá trị mặc định khi ĐỌC) nên tab vẫn mở và hiện đúng danh sách
// rỗng, không ai nhận ra — nhưng POST/PATCH/DELETE đều qua withLockedAppDataValue(key, ...)
// (lib/appData.js), hàm này ĐÒI dòng phải tồn tại SẴN (throw "Key không tồn tại trong AppData" nếu
// chưa có) nên MỌI lượt ghi đều sập 500 ngay từ lần đầu.
//
// Test này mô phỏng ĐÚNG kịch bản triển khai thật của người dùng — dùng 1 dbMock giả lập bảng dbo.AppData
// (cùng khuôn tests/test-seed-defaults-fresh-install.js) đã có SẴN các khoá KHÁC (users/permGroups/...)
// nhưng CHƯA CÓ "orgChartDiagramNodes" (đúng trạng thái server đã chạy từ trước v29.78) — xác nhận:
//   1. TRƯỚC khi chạy lại seedDefaults() (vd server chưa kịp pm2 restart sau khi copy code bản vá):
//      POST /api/org-chart/diagram-nodes vẫn sập 500 với ĐÚNG thông báo người dùng đã gặp (tái hiện lỗi
//      thật, không chỉ suy luận lý thuyết).
//   2. SAU khi chạy seedDefaults() (= đúng thao tác người dùng sẽ làm: copy code bản vá + `pm2 restart`),
//      "orgChartDiagramNodes" tự có dòng [] trong dbo.AppData — KHÔNG cần thao tác thủ công nào khác trên
//      CSDL.
//   3. SAU bước 2: POST /api/org-chart/diagram-nodes (thêm Phòng Ban GỐC, không có cha — đúng kịch bản
//      người dùng mô tả "Ban Tổng giám đốc") thành công, trả về đúng node vừa tạo.
//
// Chạy: node server/tests/test-orgchart-diagram-missing-appdata-key-fix.js
const assert = require('assert');
const path = require('path');
const http = require('http');

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

// ===== dbMock: mô phỏng dbo.AppData thật, BẮT ĐẦU đã có vài khoá khác (giống server ĐANG CHẠY từ
// trước) nhưng KHÔNG có "orgChartDiagramNodes" — đúng trạng thái sau khi triển khai v29.78 TRƯỚC bản vá
// này (cùng khuôn makeFreshInstall() ở test-seed-defaults-fresh-install.js, chỉ khác điểm xuất phát). =====
const appDataStore = { users: JSON.stringify([{ username: 'admin', active: true, perms: { admin: true, orgChartManage: true } }]) };
const dbMock = {
  getPool: async () => ({
    request: () => {
      const inputs = {};
      const reqObj = {
        input(name, _type, value) { inputs[name] = value; return reqObj; },
        query: async (sqlText) => {
          if (/SELECT 1 FROM dbo\.AppData WHERE DataKey = @k/.test(sqlText)) {
            return { recordset: Object.prototype.hasOwnProperty.call(appDataStore, inputs.k) ? [{}] : [] };
          }
          if (/INSERT INTO dbo\.AppData/.test(sqlText)) {
            appDataStore[inputs.k] = JSON.stringify(JSON.parse(inputs.v));
            return { recordset: [] };
          }
          if (/SELECT DataValue FROM dbo\.AppData WITH \(UPDLOCK, HOLDLOCK\) WHERE DataKey = @k/.test(sqlText)) {
            if (!Object.prototype.hasOwnProperty.call(appDataStore, inputs.k)) return { recordset: [] };
            return { recordset: [{ DataValue: appDataStore[inputs.k] }] };
          }
          if (/^SELECT DataValue FROM dbo\.AppData WHERE DataKey = @k$/.test(sqlText)) {
            if (!Object.prototype.hasOwnProperty.call(appDataStore, inputs.k)) return { recordset: [] };
            return { recordset: [{ DataValue: appDataStore[inputs.k] }] };
          }
          if (/UPDATE dbo\.AppData SET DataValue = @v, UpdatedAt = SYSUTCDATETIME\(\) WHERE DataKey = @k/.test(sqlText)) {
            appDataStore[inputs.k] = inputs.v;
            return { recordset: [] };
          }
          if (/SELECT DataKey, DataValue FROM dbo\.AppData/.test(sqlText)) {
            return { recordset: Object.entries(appDataStore).map(([DataKey, DataValue]) => ({ DataKey, DataValue })) };
          }
          throw new Error(`Unexpected query trong dbMock: ${sqlText}`);
        }
      };
      return reqObj;
    }
  }),
  sql: {
    NVarChar: () => undefined, NVarChar2: () => undefined, MAX: undefined,
    Transaction: function (_pool) {
      return {
        begin: async () => {},
        commit: async () => {},
        rollback: async () => {}
      };
    },
    Request: function (_tx) {
      return dbMock.getPoolSyncRequest();
    }
  }
};
// sql.Request(tx) dùng CHUNG đúng request() ở trên (transaction mock không khoá dòng thật, chỉ cần đọc/
// ghi đúng object appDataStore cho mục đích test này).
dbMock.getPoolSyncRequest = () => {
  const inputs = {};
  const reqObj = {
    input(name, _type, value) { inputs[name] = value; return reqObj; },
    query: async (sqlText) => {
      if (/SELECT DataValue FROM dbo\.AppData WITH \(UPDLOCK, HOLDLOCK\) WHERE DataKey = @k/.test(sqlText)) {
        if (!Object.prototype.hasOwnProperty.call(appDataStore, inputs.k)) return { recordset: [] };
        return { recordset: [{ DataValue: appDataStore[inputs.k] }] };
      }
      if (/UPDATE dbo\.AppData SET DataValue = @v, UpdatedAt = SYSUTCDATETIME\(\) WHERE DataKey = @k/.test(sqlText)) {
        appDataStore[inputs.k] = inputs.v;
        return { recordset: [] };
      }
      throw new Error(`Unexpected query trong dbMock.Request: ${sqlText}`);
    }
  };
  return reqObj;
};
stubModule('db.js', dbMock);

let CURRENT_USERNAME = 'admin';
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    req.user = { username: CURRENT_USERNAME };
    req.freshUser = JSON.parse(appDataStore.users).find(u => u.username === CURRENT_USERNAME);
    req.allUsers = JSON.parse(appDataStore.users);
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
let PORT = 0;
async function startApp() {
  const orgChartRoutes = require('../routes/orgChart');
  const app = express();
  app.use(express.json());
  app.use('/api/org-chart', orgChartRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}
async function api(method, urlPath, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

async function main() {
  console.log('== Cây Sơ Đồ Tổ Chức: khoá AppData "orgChartDiagramNodes" bị thiếu trên server đã triển khai trước bản vá ==');
  assert.ok(!('orgChartDiagramNodes' in appDataStore), 'Điểm xuất phát: dbo.AppData CHƯA có dòng "orgChartDiagramNodes" (đúng server đã triển khai TRƯỚC bản vá)');
  const server = await startApp();
  try {
    await test('TRƯỚC khi chạy lại seedDefaults(): POST /diagram-nodes (thêm "Ban Tổng giám đốc", không có cha) sập 500 — TÁI HIỆN đúng lỗi người dùng gặp', async () => {
      const r = await api('POST', '/api/org-chart/diagram-nodes', { nodeName: 'Ban Tổng giám đốc', parentNodeId: null });
      assert.strictEqual(r.status, 500, JSON.stringify(r.body));
      assert.strictEqual(r.body?.error, 'Không thể thêm Phòng Ban', `Thông báo lỗi phải khớp ĐÚNG những gì người dùng đã chụp ảnh gửi, nhận: ${JSON.stringify(r.body)}`);
    });

    await test('Chạy lại seedDefaults() (= copy code bản vá + pm2 restart) -> "orgChartDiagramNodes" tự có dòng [] trong dbo.AppData, KHÔNG cần thao tác thủ công nào khác', async () => {
      // Chỉ cần đúng vòng lặp seed DEFAULTS chính (không cần toàn bộ seedDefaults() với các migration
      // khác không liên quan — require trực tiếp defaults.js + lặp qua đúng cơ chế seedDefaults.js dùng,
      // tránh phải mock thêm hàng chục dependency khác của seedDefaults() không liên quan tới test này).
      const { DEFAULTS } = require('../defaults');
      assert.ok('orgChartDiagramNodes' in DEFAULTS, 'Bản vá: DEFAULTS phải có "orgChartDiagramNodes" — nếu thiếu, cả bài test này vô nghĩa');
      for (const key of Object.keys(DEFAULTS)) {
        if (!Object.prototype.hasOwnProperty.call(appDataStore, key)) {
          appDataStore[key] = JSON.stringify(DEFAULTS[key]);
        }
      }
      assert.ok('orgChartDiagramNodes' in appDataStore, 'Sau khi seed: dbo.AppData phải đã có dòng "orgChartDiagramNodes"');
      assert.strictEqual(appDataStore.orgChartDiagramNodes, '[]', 'Giá trị mặc định phải đúng mảng rỗng []');
    });

    await test('SAU khi seed lại: POST /diagram-nodes (thêm "Ban Tổng giám đốc", Phòng Ban GỐC không cha) THÀNH CÔNG — đúng kịch bản người dùng mô tả', async () => {
      const r = await api('POST', '/api/org-chart/diagram-nodes', { nodeName: 'Ban Tổng giám đốc', parentNodeId: null });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body?.node?.nodeName, 'Ban Tổng giám đốc');
      assert.strictEqual(r.body?.node?.parentNodeId, null, 'Phòng Ban GỐC -> parentNodeId phải là null (không ép buộc phải có 1 "Công Ty" gốc duy nhất)');
    });

    await test('Thêm tiếp 1 Phòng Ban CON của "Ban Tổng giám đốc" vừa tạo -> thành công, parentNodeId đúng id vừa nhận', async () => {
      const list1 = await api('GET', '/api/org-chart/diagram-nodes');
      const rootId = list1.body.nodes.find(n => n.nodeName === 'Ban Tổng giám đốc').id;
      const r = await api('POST', '/api/org-chart/diagram-nodes', { nodeName: 'Phòng Kinh Doanh', parentNodeId: rootId });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body?.node?.parentNodeId, rootId);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
