#!/usr/bin/env node
'use strict';

// ==========================================================================
// Rà soát toàn hệ thống trước go-live (11/2026, theo yêu cầu người dùng "rà soát lại một lần nữa các
// chức năng bên trong modules hệ thống xem có bị lỗi tương tự không"): ngoài 7 chỗ đã vá ở v27.92
// (object-map *DeptWorkflows/*TierWorkflows), rà soát bằng 4 agent song song phát hiện THÊM ~50 lệnh
// gọi syncStorage() khác trên toàn hệ thống thiếu `baseline` dù đã có sẵn snapshot — rơi vào 2 hình
// dạng dữ liệu MÀ cơ chế retry cũ (chỉ xử lý mảng object có `.id`, hoặc object-map) KHÔNG xử lý đúng:
//
//   1. MẢNG CHUỖI PHẲNG (depts/stores/jobTitles/cats/licenseTypes/priceZones/15 danh mục
//      GENERIC_SIMPLE_CATALOGS...) — phần tử là string thuần, không có `.id`.
//   2. MẢNG OBJECT khoá theo field KHÁC `.id` (workflowParticipatingPositions khoá jobTitle+dept,
//      storeJobTitles khoá label, jobTitleGradeDefaults khoá jobTitle, positionTypes khoá `.key`).
//
// (OBJECT CẤU HÌNH ĐƠN dạng phẳng như emailConfig/operationOrderApiConfig HOÁ RA dùng được NGAY cơ chế
// OBJECT MAP có sẵn — mỗi field cấu hình tự nhiên là 1 "khoá" hợp lệ để merge độc lập, không cần thêm
// chế độ riêng — xem test riêng bên dưới.)
//
// Bản vá (core.js): `defaultArrayItemKey()` (object có `.id` -> `.id`, còn lại -> CHÍNH giá trị — tự
// động xử lý đúng dạng 1 mà không cần sửa gì ở nơi gọi); `diffArrayForConflictRetry()`/
// `retryArraySaveAfterConflict()` nhận thêm `opts.keyFn` cho dạng 2 (nơi gọi tự truyền qua
// `syncStorage(key, {baseline, arrayKeyFn})`). Đồng thời vá `silent:true` + baseline trước đây TẮT hẳn
// nhánh retry (deptViewScopeConfig/pwaShortcutModules) — giờ retry vẫn chạy, chỉ khác silent thì
// console.warn thay vì alert() khi conflict thật.
//
// Test THUẦN CLIENT (cùng khuôn test-syncstorage-missing-baseline-fix.js): gọi THẲNG
// syncStorage(key, opts) với "server" giả lập ngay trong window.fetch, xác nhận ĐÚNG các cơ chế mới
// hoạt động, và KHÔNG phá vỡ cơ chế mảng-có-id cũ (users/permGroups/...).
//
// Run: node server/tests/test-syncstorage-generalized-conflict-retry.js
// ==========================================================================

const path = require('path');
const { setup, teardown, makeRunner, assert, assertEqual } = require('./_harness');

const PORT = 8994;

async function main() {
  const { server, browser, page } = await setup(PORT);
  const run = makeRunner();

  try {
    await page.evaluate(() => { window.__alerted = []; window.__origAlert = window.alert; window.alert = (m) => window.__alerted.push(String(m)); });

    // ---- Dạng 1: MẢNG CHUỖI PHẲNG (depts/stores/jobTitles/cats/licenseTypes/priceZones/...) ----
    await run.run('MẢNG CHUỖI PHẲNG (depts): 409 do hoạt động KHÔNG liên quan -> tự lưu lại thành công, giữ đúng mục không liên quan', async () => {
      const r = await page.evaluate(async () => {
        window.__alerted.length = 0;
        const key = 'depts';
        let serverState = ['Kế Toán', 'Kinh Doanh'];
        let serverVersion = 5000;
        const savedFetch = window.fetch;
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === `/api/data/${key}` && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? String(serverVersion) : null }, json: async () => serverState };
          }
          if (url === `/api/data/${key}` && method === 'POST') {
            const ifMatch = opts.headers['If-Match'];
            if (ifMatch && parseInt(ifMatch, 10) !== serverVersion) {
              return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
            }
            serverState = JSON.parse(opts.body);
            serverVersion++;
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? String(serverVersion) : null }, json: async () => ({ ok: true }) };
          }
          return savedFetch(url, opts);
        };
        const baseline = ['Kế Toán', 'Kinh Doanh'];
        DB.depts = baseline.slice();
        DB._versions = DB._versions || {};
        DB._versions.depts = String(4999);
        // "server" đã có 1 phòng ban KHÁC được thêm bởi hoạt động không liên quan.
        serverState = ['Kế Toán', 'Kinh Doanh', 'Phòng Mới Admin Khác Thêm'];
        // "mình" thêm 1 phòng ban của riêng mình.
        DB.depts.push('Phòng Của Mình');
        const saved = await syncStorage('depts', { baseline });
        const out = { saved, alerts: window.__alerted.slice(), finalClientState: DB.depts.slice() };
        window.fetch = savedFetch;
        return out;
      });
      assert(r.saved === true, 'saved phải = true: ' + JSON.stringify(r));
      assert(!r.alerts.some(a => a.includes('vừa bị người khác thay đổi')), 'không được alert: ' + JSON.stringify(r.alerts));
      assert(r.finalClientState.includes('Phòng Của Mình'), 'phải có phòng ban MỚI của mình: ' + JSON.stringify(r.finalClientState));
      assert(r.finalClientState.includes('Phòng Mới Admin Khác Thêm'), 'phải GIỮ phòng ban không liên quan admin khác thêm: ' + JSON.stringify(r.finalClientState));
    });

    await run.run('MẢNG CHUỖI PHẲNG (depts): ĐÚNG mục mình xoá bị admin khác XOÁ/ĐỔI cùng lúc -> conflict thật, không tự ý ghi đè', async () => {
      const r = await page.evaluate(async () => {
        window.__alerted.length = 0;
        const key = 'depts';
        let serverVersion = 5000;
        const savedFetch = window.fetch;
        let serverState = ['Kế Toán', 'Kinh Doanh'];
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === `/api/data/${key}` && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? String(serverVersion) : null }, json: async () => serverState };
          }
          if (url === `/api/data/${key}` && method === 'POST') {
            const ifMatch = opts.headers['If-Match'];
            if (ifMatch && parseInt(ifMatch, 10) !== serverVersion) {
              return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
            }
            return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) };
          }
          return savedFetch(url, opts);
        };
        const baseline = ['Kế Toán', 'Kinh Doanh'];
        DB.depts = baseline.slice();
        DB._versions = DB._versions || {};
        DB._versions.depts = String(4999);
        // Mình XOÁ "Kinh Doanh" khỏi danh sách của mình.
        DB.depts = ['Kế Toán'];
        // "server" đã bị admin khác ĐỔI TÊN đúng "Kinh Doanh" (không còn y hệt baseline).
        serverState = ['Kế Toán', 'Kinh Doanh (Đổi Tên)'];
        const saved = await syncStorage('depts', { baseline });
        const out = { saved, alerts: window.__alerted.slice() };
        window.fetch = savedFetch;
        return out;
      });
      assert(r.saved === false, 'saved phải = false (conflict thật): ' + JSON.stringify(r));
      assert(r.alerts.some(a => a.includes('vừa bị thay đổi') || a.includes('vừa bị người khác thay đổi')), 'phải báo lỗi rõ ràng: ' + JSON.stringify(r.alerts));
    });

    // ---- Dạng 2: MẢNG OBJECT khoá theo field KHÁC .id (arrayKeyFn tuỳ chỉnh) ----
    await run.run('MẢNG OBJECT khoá KHÁC .id (storeJobTitles, khoá=label): 409 do hoạt động KHÔNG liên quan -> tự lưu lại thành công', async () => {
      const r = await page.evaluate(async () => {
        window.__alerted.length = 0;
        const key = 'storeJobTitles';
        let serverVersion = 5000;
        const savedFetch = window.fetch;
        const baseline = [{ label: 'Cửa Hàng Trưởng' }, { label: 'Nhân Viên Bán Hàng' }];
        let serverState = JSON.parse(JSON.stringify(baseline));
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === `/api/data/${key}` && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? String(serverVersion) : null }, json: async () => serverState };
          }
          if (url === `/api/data/${key}` && method === 'POST') {
            const ifMatch = opts.headers['If-Match'];
            if (ifMatch && parseInt(ifMatch, 10) !== serverVersion) {
              return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
            }
            serverState = JSON.parse(opts.body);
            serverVersion++;
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? String(serverVersion) : null }, json: async () => ({ ok: true }) };
          }
          return savedFetch(url, opts);
        };
        DB.storeJobTitles = JSON.parse(JSON.stringify(baseline));
        DB._versions = DB._versions || {};
        DB._versions.storeJobTitles = String(4999);
        // "server" đã có 1 chức danh KHÁC được thêm bởi hoạt động không liên quan.
        serverState = [...JSON.parse(JSON.stringify(baseline)), { label: 'Giám Sát Khu Vực (Admin Khác Thêm)' }];
        // "mình" thêm 1 chức danh của riêng mình.
        DB.storeJobTitles.push({ label: 'Giám Đốc Siêu Thị (Của Mình)' });
        const saved = await syncStorage('storeJobTitles', { baseline, arrayKeyFn: (x) => x.label });
        const out = { saved, alerts: window.__alerted.slice(), finalClientState: DB.storeJobTitles };
        window.fetch = savedFetch;
        return out;
      });
      assert(r.saved === true, 'saved phải = true: ' + JSON.stringify(r));
      assert(!r.alerts.some(a => a.includes('vừa bị người khác thay đổi')), 'không được alert: ' + JSON.stringify(r.alerts));
      assert(r.finalClientState.some(x => x.label === 'Giám Đốc Siêu Thị (Của Mình)'), 'phải có chức danh MỚI của mình: ' + JSON.stringify(r.finalClientState));
      assert(r.finalClientState.some(x => x.label === 'Giám Sát Khu Vực (Admin Khác Thêm)'), 'phải GIỮ chức danh không liên quan: ' + JSON.stringify(r.finalClientState));
    });

    // ---- Dạng 3: OBJECT CẤU HÌNH ĐƠN dạng phẳng (emailConfig-kiểu) — dùng được NGAY cơ chế OBJECT MAP
    // mặc định (không cần chế độ riêng): mỗi field cấu hình (smtpHost/smtpPort/enabled/...) tự nhiên là
    // 1 "khoá" hợp lệ để merge ĐỘC LẬP — admin sửa field A, nơi khác (job nền/admin khác) ghi field B
    // KHÔNG LIÊN QUAN thì vẫn gộp êm; chỉ báo conflict thật khi ĐÚNG field mình sửa bị đổi.
    await run.run('OBJECT CẤU HÌNH ĐƠN dạng phẳng (emailConfig-kiểu): nơi khác đổi field KHÁC (lastSyncStatus-kiểu) -> tự gộp thành công, giữ cả 2 thay đổi', async () => {
      const r = await page.evaluate(async () => {
        window.__alerted.length = 0;
        const key = 'emailConfigTestKey';
        let serverVersion = 5000;
        const savedFetch = window.fetch;
        const baseline = { smtpHost: 'smtp.cu.vn', smtpPort: 587, enabled: true, lastSyncStatus: 'SUCCESS' };
        let serverState = JSON.parse(JSON.stringify(baseline));
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === `/api/data/${key}` && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? String(serverVersion) : null }, json: async () => serverState };
          }
          if (url === `/api/data/${key}` && method === 'POST') {
            const ifMatch = opts.headers['If-Match'];
            if (ifMatch && parseInt(ifMatch, 10) !== serverVersion) {
              return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
            }
            serverState = JSON.parse(opts.body);
            serverVersion++;
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? String(serverVersion) : null }, json: async () => ({ ok: true }) };
          }
          return savedFetch(url, opts);
        };
        DB[key] = JSON.parse(JSON.stringify(baseline));
        DB._versions = DB._versions || {};
        DB._versions[key] = String(4999);
        // 1 job nền (hoặc admin khác) vừa ghi field KHÁC (lastSyncStatus) — không đụng gì tới smtpPort.
        serverState = { ...baseline, lastSyncStatus: 'FAILED' };
        serverVersion = 5001;
        // "mình" đổi smtpPort — field hoàn toàn khác, không liên quan.
        DB[key].smtpPort = 2525;
        const saved = await syncStorage(key, { baseline });
        const out = { saved, alerts: window.__alerted.slice(), finalClientState: DB[key] };
        window.fetch = savedFetch;
        return out;
      });
      assert(r.saved === true, 'saved phải = true: ' + JSON.stringify(r));
      assert(!r.alerts.some(a => a.includes('vừa bị người khác thay đổi') || a.includes('vừa bị thay đổi')), 'không được alert: ' + JSON.stringify(r.alerts));
      assertEqual(r.finalClientState.smtpPort, 2525, 'phải áp đúng field của mình: ' + JSON.stringify(r.finalClientState));
      assertEqual(r.finalClientState.lastSyncStatus, 'FAILED', 'phải GIỮ field job nền vừa ghi, không bị ghi đè mất: ' + JSON.stringify(r.finalClientState));
    });

    await run.run('OBJECT CẤU HÌNH ĐƠN dạng phẳng (emailConfig-kiểu): ĐÚNG field mình sửa bị đổi ở nơi khác -> conflict thật, báo lỗi rõ ràng', async () => {
      const r = await page.evaluate(async () => {
        window.__alerted.length = 0;
        const key = 'emailConfigTestKey2';
        let serverVersion = 5000;
        const savedFetch = window.fetch;
        const baseline = { smtpHost: 'smtp.cu.vn', smtpPort: 587, enabled: true };
        let serverState = JSON.parse(JSON.stringify(baseline));
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === `/api/data/${key}` && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? String(serverVersion) : null }, json: async () => serverState };
          }
          if (url === `/api/data/${key}` && method === 'POST') {
            const ifMatch = opts.headers['If-Match'];
            if (ifMatch && parseInt(ifMatch, 10) !== serverVersion) {
              return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
            }
            return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) };
          }
          return savedFetch(url, opts);
        };
        DB[key] = JSON.parse(JSON.stringify(baseline));
        DB._versions = DB._versions || {};
        DB._versions[key] = String(4999);
        DB[key].smtpPort = 2525;
        // Admin KHÁC đã đổi THẬT ĐÚNG field mình đang sửa (smtpPort) — không an toàn để tự áp lại.
        serverState = { smtpHost: 'smtp.cu.vn', smtpPort: 465, enabled: true };
        serverVersion = 5001;
        const saved = await syncStorage(key, { baseline });
        const out = { saved, alerts: window.__alerted.slice() };
        window.fetch = savedFetch;
        return out;
      });
      assert(r.saved === false, 'saved phải = false (conflict thật): ' + JSON.stringify(r));
      assert(r.alerts.some(a => a.includes('vừa bị thay đổi') || a.includes('vừa bị người khác thay đổi')), 'phải báo lỗi rõ ràng: ' + JSON.stringify(r.alerts));
    });

    // ---- silent:true + baseline: retry vẫn chạy, chỉ khác cách báo lỗi khi conflict thật ----
    await run.run('silent:true + baseline: 409 do hoạt động KHÔNG liên quan -> retry VẪN chạy, tự lưu lại thành công (trước đây bị tắt hẳn retry)', async () => {
      const r = await page.evaluate(async () => {
        window.__alerted.length = 0;
        const key = 'pwaShortcutModulesTestKey';
        let serverVersion = 5000;
        const savedFetch = window.fetch;
        const baseline = ['itTicket', 'vpp'];
        let serverState = baseline.slice();
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === `/api/data/${key}` && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? String(serverVersion) : null }, json: async () => serverState };
          }
          if (url === `/api/data/${key}` && method === 'POST') {
            const ifMatch = opts.headers['If-Match'];
            if (ifMatch && parseInt(ifMatch, 10) !== serverVersion) {
              return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
            }
            serverState = JSON.parse(opts.body);
            serverVersion++;
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? String(serverVersion) : null }, json: async () => ({ ok: true }) };
          }
          return savedFetch(url, opts);
        };
        DB[key] = baseline.slice();
        DB._versions = DB._versions || {};
        DB._versions[key] = String(4999);
        serverState = [...baseline, 'meeting']; // admin khác vừa thêm 1 shortcut KHÔNG liên quan
        DB[key].push('car'); // mình thêm shortcut của mình
        const saved = await syncStorage(key, { baseline, silent: true });
        const out = { saved, alerts: window.__alerted.slice(), finalClientState: DB[key] };
        window.fetch = savedFetch;
        return out;
      });
      assert(r.saved === true, 'saved phải = true (silent nhưng vẫn retry thành công): ' + JSON.stringify(r));
      assert(r.alerts.length === 0, 'silent không bao giờ alert: ' + JSON.stringify(r.alerts));
      assert(r.finalClientState.includes('car') && r.finalClientState.includes('meeting'), 'phải gộp đúng cả 2: ' + JSON.stringify(r.finalClientState));
    });

    await run.run('silent:true + baseline: conflict THẬT -> console.warn (không alert), KHÔNG âm thầm ghi đè mất thay đổi người khác', async () => {
      const r = await page.evaluate(async () => {
        window.__alerted.length = 0;
        window.__warned = [];
        const origWarn = console.warn;
        console.warn = (...args) => { window.__warned.push(args.join(' ')); };
        const key = 'pwaShortcutModulesTestKey2';
        let serverVersion = 5000;
        const savedFetch = window.fetch;
        const baseline = ['itTicket', 'vpp'];
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === `/api/data/${key}` && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? String(serverVersion) : null }, json: async () => ['itTicket'] }; // "vpp" đã bị admin khác XOÁ
          }
          if (url === `/api/data/${key}` && method === 'POST') {
            return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
          }
          return savedFetch(url, opts);
        };
        DB[key] = baseline.slice();
        DB._versions = DB._versions || {};
        DB._versions[key] = String(4999);
        DB[key] = ['itTicket', 'vpp (sửa bởi mình)']; // mình SỬA đúng "vpp" -> bị admin khác xoá mất -> conflict thật
        const saved = await syncStorage(key, { baseline, silent: true });
        const out = { saved, alerts: window.__alerted.slice(), warned: window.__warned.slice() };
        window.fetch = savedFetch;
        console.warn = origWarn;
        return out;
      });
      assert(r.saved === false, 'saved phải = false: ' + JSON.stringify(r));
      assert(r.alerts.length === 0, 'silent không bao giờ alert: ' + JSON.stringify(r.alerts));
      assert(r.warned.some(w => w.includes('Bỏ qua lưu ngầm')), 'phải console.warn: ' + JSON.stringify(r.warned));
    });

    run.summarize('test-syncstorage-generalized-conflict-retry');
  } finally {
    await teardown({ server, browser });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
