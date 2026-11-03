#!/usr/bin/env node
'use strict';

// ==========================================================================
// LỖI THẬT đã vá (11/2026, người dùng báo kèm ảnh chụp màn hình cảnh báo "⚠️ Đúng bản ghi người dùng
// bạn đang sửa vừa bị thay đổi ở nơi khác... vui lòng tải lại trang" — yêu cầu rõ: "chỉ nên báo xung đột
// khi 2 admin cùng sửa TRÙNG đúng 1 phần phân quyền, còn không thì cho lưu thoải mái"):
//
// retryUsersSaveAfterConflict() (core.js) TRƯỚC ĐÂY so sánh NGUYÊN 1 bản ghi user (trừ 4 field nền hệ
// thống tự quản — sessionVersion/failedLoginAttempts/lockedUntil/mustChangePassword) — admin A sửa field
// X (VD số điện thoại), nếu BẤT KỲ field nào khác của ĐÚNG người đó thay đổi ở server (admin B sửa field
// Y không liên quan, HOẶC chính người dùng tự đăng ký thiết bị WebAuthn mới, HOẶC tự đổi mật khẩu) đều bị
// coi là "conflict thật" — chặn lưu + bắt tải lại trang, MẤT nội dung admin A vừa gõ dù hoàn toàn không
// đụng field nào trùng với admin B.
//
// Bản vá: mergeUserRecordFieldLevel() (core.js) đối chiếu TỪNG FIELD — field admin A không đụng tới
// luôn lấy bản mới nhất từ server (merge im lặng); CHỈ báo xung đột thật khi ĐÚNG field admin A vừa sửa
// bị đổi sang giá trị KHÁC ở nơi khác. Field "perms" (object quyền hạn) còn được lùi thêm 1 cấp — 2 admin
// bật/tắt 2 QUYỀN CON khác nhau trên CÙNG 1 người cũng tự gộp được, không báo nhầm.
//
// Run: node server/tests/test-users-field-level-conflict-merge.js
// ==========================================================================

const { setup, teardown, makeRunner, assert, assertEqual } = require('./_harness');

const PORT = 8999;

async function main() {
  const { server, browser, page } = await setup(PORT);
  const run = makeRunner();

  try {
    await run.run('Admin sửa SĐT, server đã đổi EMAIL (admin khác, field KHÁC) -> tự gộp, KHÔNG báo xung đột', async () => {
      const r = await page.evaluate(async () => {
        const baseUser = { id: 1, username: 'nv1', name: 'Nguyễn Văn A', dept: 'Phòng IT', phone: '0900000001', email: 'a@old.com', perms: { admin: false }, active: true };
        DB.users = [JSON.parse(JSON.stringify(baseUser))];
        DB._versions = DB._versions || {};
        DB._versions.users = '1';
        const savedFetch = window.fetch;
        let serverState = [JSON.parse(JSON.stringify(baseUser))];
        let serverVersion = '1';
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === '/api/data/users' && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => serverState };
          }
          if (url === '/api/data/users' && method === 'POST') {
            const ifMatch = opts.headers['If-Match'];
            if (ifMatch && ifMatch !== serverVersion) return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
            serverState = JSON.parse(opts.body);
            serverVersion = String(Number(serverVersion) + 1);
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => ({ ok: true, version: serverVersion }) };
          }
          return savedFetch(url, opts);
        };

        const baseline = JSON.parse(JSON.stringify(DB.users));
        DB.users[0].phone = '0900000099'; // admin đổi SĐT

        // Admin khác (hoặc self-service) đã đổi EMAIL ở server, field KHÁC hoàn toàn.
        serverState = [{ ...baseUser, email: 'a@changed-by-other.com' }];
        serverVersion = '2';

        window.__alerts = [];
        window.alert = (m) => window.__alerts.push(String(m));
        const saved = await syncStorage('users', { baseline });
        const out = { saved, finalServerUser: serverState[0], alerts: window.__alerts.slice() };
        window.fetch = savedFetch;
        return out;
      });
      assert(r.saved === true, 'LỖI NẾU FALSE: sửa field KHÔNG trùng phải tự gộp được, không bị chặn: ' + JSON.stringify(r));
      assertEqual(r.finalServerUser.phone, '0900000099', 'Server phải có đúng SĐT mới của admin: ' + JSON.stringify(r));
      assertEqual(r.finalServerUser.email, 'a@changed-by-other.com', 'Server phải GIỮ NGUYÊN email của admin khác (không bị admin hiện tại ghi đè mất): ' + JSON.stringify(r));
      assertEqual(r.alerts.length, 0, 'KHÔNG được hiện alert xung đột nào: ' + JSON.stringify(r));
    });

    await run.run('Admin bật quyền "paymentManage", server đã đổi quyền "licenseApprove" KHÁC (2 quyền con khác nhau CÙNG 1 người) -> tự gộp cả 2', async () => {
      const r = await page.evaluate(async () => {
        const baseUser = { id: 2, username: 'nv2', name: 'Trần Thị B', dept: 'Phòng Kế Toán', perms: { paymentManage: false, licenseApprove: false, admin: false }, active: true };
        DB.users = [JSON.parse(JSON.stringify(baseUser))];
        DB._versions = DB._versions || {};
        DB._versions.users = '10';
        const savedFetch = window.fetch;
        let serverState = [JSON.parse(JSON.stringify(baseUser))];
        let serverVersion = '10';
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === '/api/data/users' && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => serverState };
          }
          if (url === '/api/data/users' && method === 'POST') {
            const ifMatch = opts.headers['If-Match'];
            if (ifMatch && ifMatch !== serverVersion) return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
            serverState = JSON.parse(opts.body);
            serverVersion = String(Number(serverVersion) + 1);
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => ({ ok: true, version: serverVersion }) };
          }
          return savedFetch(url, opts);
        };

        const baseline = JSON.parse(JSON.stringify(DB.users));
        DB.users[0].perms.paymentManage = true; // admin A bật quyền Quản Lý Thanh Toán

        // Admin B bật quyền Duyệt Giấy Phép (quyền con KHÁC) trên CÙNG người này.
        serverState = [{ ...baseUser, perms: { ...baseUser.perms, licenseApprove: true } }];
        serverVersion = '11';

        window.__alerts = [];
        window.alert = (m) => window.__alerts.push(String(m));
        const saved = await syncStorage('users', { baseline });
        const out = { saved, finalPerms: serverState[0].perms, alerts: window.__alerts.slice() };
        window.fetch = savedFetch;
        return out;
      });
      assert(r.saved === true, 'LỖI NẾU FALSE: 2 quyền con khác nhau trên cùng 1 người phải tự gộp được: ' + JSON.stringify(r));
      assertEqual(r.finalPerms.paymentManage, true, 'Server phải có đúng quyền paymentManage admin A vừa bật: ' + JSON.stringify(r));
      assertEqual(r.finalPerms.licenseApprove, true, 'Server phải GIỮ NGUYÊN quyền licenseApprove admin B vừa bật (không bị ghi đè mất): ' + JSON.stringify(r));
      assertEqual(r.alerts.length, 0, 'KHÔNG được hiện alert xung đột nào: ' + JSON.stringify(r));
    });

    await run.run('Xung đột THẬT: cả 2 admin cùng sửa ĐÚNG field "dept" của CÙNG 1 người, khác giá trị -> vẫn phải chặn + báo rõ tên người + tên field', async () => {
      const r = await page.evaluate(async () => {
        const baseUser = { id: 3, username: 'nv3', name: 'Lê Văn C', dept: 'Phòng Kinh Doanh', perms: { admin: false }, active: true };
        DB.users = [JSON.parse(JSON.stringify(baseUser))];
        DB._versions = DB._versions || {};
        DB._versions.users = '20';
        const savedFetch = window.fetch;
        let serverState = [JSON.parse(JSON.stringify(baseUser))];
        let serverVersion = '20';
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === '/api/data/users' && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => serverState };
          }
          if (url === '/api/data/users' && method === 'POST') {
            const ifMatch = opts.headers['If-Match'];
            if (ifMatch && ifMatch !== serverVersion) return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
            serverState = JSON.parse(opts.body);
            serverVersion = String(Number(serverVersion) + 1);
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => ({ ok: true, version: serverVersion }) };
          }
          return savedFetch(url, opts);
        };

        const baseline = JSON.parse(JSON.stringify(DB.users));
        DB.users[0].dept = 'Phòng Marketing'; // admin A đổi Phòng Ban

        // Admin B CŨNG đổi ĐÚNG field dept, sang giá trị KHÁC.
        serverState = [{ ...baseUser, dept: 'Phòng Nhân Sự' }];
        serverVersion = '21';

        window.__alerts = [];
        window.alert = (m) => window.__alerts.push(String(m));
        const saved = await syncStorage('users', { baseline });
        const out = { saved, finalServerUser: serverState[0], alerts: window.__alerts.slice() };
        window.fetch = savedFetch;
        return out;
      });
      assertEqual(r.saved, false, 'Xung đột THẬT (cùng field, khác giá trị) vẫn phải chặn lưu: ' + JSON.stringify(r));
      assertEqual(r.finalServerUser.dept, 'Phòng Nhân Sự', 'Server KHÔNG được bị admin A ghi đè — giữ nguyên bản của admin B để admin A tự quyết định: ' + JSON.stringify(r));
      assertEqual(r.alerts.length, 1, 'Phải hiện ĐÚNG 1 alert cảnh báo: ' + JSON.stringify(r));
      assert(r.alerts[0].includes('nv3'), `Alert phải nêu rõ TÊN ĐĂNG NHẬP người bị xung đột (nv3): ${r.alerts[0]}`);
      assert(r.alerts[0].includes('Phòng Ban'), `Alert phải nêu rõ TÊN FIELD xung đột (Phòng Ban/Siêu Thị): ${r.alerts[0]}`);
    });

    await run.run('Xung đột THẬT ở cấp quyền con: 2 admin cùng đổi ĐÚNG 1 quyền con "approverAuthLevel" sang 2 giá trị KHÁC NHAU -> vẫn chặn, báo rõ tên quyền', async () => {
      const r = await page.evaluate(async () => {
        // Dùng field chuỗi (không phải boolean) để có thể tạo 3 giá trị PHÂN BIỆT thật sự (base/admin A
        // đổi/admin B đổi) — boolean chỉ có 2 trạng thái nên không mô phỏng được đúng kịch bản "2 người
        // CÙNG đổi 1 quyền con sang 2 giá trị khác nhau, cả 2 đều khác giá trị gốc".
        const baseUser = { id: 4, username: 'nv4', name: 'Phạm Thị D', dept: 'Phòng Kế Toán', perms: { paymentManage: false, approverAuthLevel: 'PASSWORD', admin: false }, active: true };
        DB.users = [JSON.parse(JSON.stringify(baseUser))];
        DB._versions = DB._versions || {};
        DB._versions.users = '30';
        const savedFetch = window.fetch;
        let serverState = [JSON.parse(JSON.stringify(baseUser))];
        let serverVersion = '30';
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === '/api/data/users' && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => serverState };
          }
          if (url === '/api/data/users' && method === 'POST') {
            const ifMatch = opts.headers['If-Match'];
            if (ifMatch && ifMatch !== serverVersion) return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
            serverState = JSON.parse(opts.body);
            serverVersion = String(Number(serverVersion) + 1);
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => ({ ok: true, version: serverVersion }) };
          }
          return savedFetch(url, opts);
        };

        const baseline = JSON.parse(JSON.stringify(DB.users));
        DB.users[0].perms.approverAuthLevel = 'WEBAUTHN'; // admin A nâng mức xác thực

        // Admin B CŨNG đổi ĐÚNG quyền con này, nhưng sang giá trị KHÁC (OTP, không phải PASSWORD gốc,
        // không phải WEBAUTHN của admin A) -> 2 giá trị MỚI thật sự khác nhau trên CÙNG 1 quyền con.
        serverState = [{ ...baseUser, perms: { ...baseUser.perms, approverAuthLevel: 'OTP' } }];
        serverVersion = '31';

        window.__alerts = [];
        window.alert = (m) => window.__alerts.push(String(m));
        const saved = await syncStorage('users', { baseline });
        const out = { saved, alerts: window.__alerts.slice() };
        window.fetch = savedFetch;
        return out;
      });
      assertEqual(r.saved, false, 'Xung đột THẬT ở quyền con vẫn phải chặn lưu: ' + JSON.stringify(r));
      assertEqual(r.alerts.length, 1, 'Phải hiện ĐÚNG 1 alert: ' + JSON.stringify(r));
      assert(r.alerts[0].includes('nv4'), `Alert phải nêu tên đăng nhập: ${r.alerts[0]}`);
      assert(r.alerts[0].includes('approverAuthLevel'), `Alert phải nêu rõ tên quyền con xung đột: ${r.alerts[0]}`);
    });

    await run.run('Xung đột quyền con "khác nhau" (paymentManage vs approverAuthLevel) trên CÙNG 1 người vẫn tự gộp — không bị hàng xóm quyền con làm sai lệch', async () => {
      const r = await page.evaluate(async () => {
        const baseUser = { id: 44, username: 'nv44', name: 'Phạm Thị D2', dept: 'Phòng Kế Toán', perms: { paymentManage: false, approverAuthLevel: 'PASSWORD', admin: false }, active: true };
        DB.users = [JSON.parse(JSON.stringify(baseUser))];
        DB._versions = DB._versions || {};
        DB._versions.users = '32';
        const savedFetch = window.fetch;
        let serverState = [JSON.parse(JSON.stringify(baseUser))];
        let serverVersion = '32';
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === '/api/data/users' && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => serverState };
          }
          if (url === '/api/data/users' && method === 'POST') {
            const ifMatch = opts.headers['If-Match'];
            if (ifMatch && ifMatch !== serverVersion) return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
            serverState = JSON.parse(opts.body);
            serverVersion = String(Number(serverVersion) + 1);
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => ({ ok: true, version: serverVersion }) };
          }
          return savedFetch(url, opts);
        };

        const baseline = JSON.parse(JSON.stringify(DB.users));
        DB.users[0].perms.paymentManage = true; // admin A bật quyền Thanh Toán

        // Admin B đổi mức xác thực (quyền con KHÁC) trên CÙNG người này.
        serverState = [{ ...baseUser, perms: { ...baseUser.perms, approverAuthLevel: 'WEBAUTHN' } }];
        serverVersion = '33';

        window.__alerts = [];
        window.alert = (m) => window.__alerts.push(String(m));
        const saved = await syncStorage('users', { baseline });
        const out = { saved, finalPerms: serverState[0].perms, alerts: window.__alerts.slice() };
        window.fetch = savedFetch;
        return out;
      });
      assert(r.saved === true, 'LỖI NẾU FALSE: 2 quyền con khác nhau phải tự gộp được: ' + JSON.stringify(r));
      assertEqual(r.finalPerms.paymentManage, true, 'Server phải có đúng quyền paymentManage admin A vừa bật: ' + JSON.stringify(r));
      assertEqual(r.finalPerms.approverAuthLevel, 'WEBAUTHN', 'Server phải GIỮ NGUYÊN mức xác thực admin B vừa đổi: ' + JSON.stringify(r));
      assertEqual(r.alerts.length, 0, 'KHÔNG được hiện alert xung đột nào: ' + JSON.stringify(r));
    });

    await run.run('Tự đổi mật khẩu/đăng nhập lại giữa chừng (field nền mustChangePassword/sessionVersion đổi) KHÔNG được coi là xung đột dù admin sửa field khác', async () => {
      const r = await page.evaluate(async () => {
        const baseUser = { id: 5, username: 'nv5', name: 'Hoàng Văn E', dept: 'Phòng IT', phone: '0900000005', mustChangePassword: true, sessionVersion: 1, active: true };
        DB.users = [JSON.parse(JSON.stringify(baseUser))];
        DB._versions = DB._versions || {};
        DB._versions.users = '40';
        const savedFetch = window.fetch;
        let serverState = [JSON.parse(JSON.stringify(baseUser))];
        let serverVersion = '40';
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === '/api/data/users' && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => serverState };
          }
          if (url === '/api/data/users' && method === 'POST') {
            const ifMatch = opts.headers['If-Match'];
            if (ifMatch && ifMatch !== serverVersion) return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
            // mustChangePassword KHÔNG BAO GIỜ nằm trong body POST thật (syncStorageOnce() cố ý loại ra
            // trước khi gửi, xem chú thích tại đó) — mô phỏng ĐÚNG hành vi: server tự giữ giá trị riêng
            // của NÓ cho field này, không đọc từ payload gửi lên.
            const body = JSON.parse(opts.body);
            serverState = body.map(u => ({ ...u, mustChangePassword: (serverState.find(s => s.id === u.id) || {}).mustChangePassword }));
            serverVersion = String(Number(serverVersion) + 1);
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => ({ ok: true, version: serverVersion }) };
          }
          return savedFetch(url, opts);
        };

        const baseline = JSON.parse(JSON.stringify(DB.users));
        DB.users[0].phone = '0900009999'; // admin sửa SĐT

        // Chính user này tự đổi mật khẩu thành công (server gỡ mustChangePassword) + đăng nhập lại (sessionVersion tăng).
        serverState = [{ ...baseUser, mustChangePassword: false, sessionVersion: 2 }];
        serverVersion = '41';

        window.__alerts = [];
        window.alert = (m) => window.__alerts.push(String(m));
        const saved = await syncStorage('users', { baseline });
        // Kiểm tra DB.users (bản hiển thị PHÍA CLIENT sau khi merge) — KHÔNG kiểm "server POST body" vì
        // field này theo thiết kế SẴN CÓ không bao giờ xuất hiện trong payload gửi lên (xem comment ngay
        // trên) — đây là hành vi ĐÃ CÓ TỪ TRƯỚC, không phải điều bản vá field-level-merge này thay đổi.
        const out = { saved, clientUser: DB.users.find(u => u.id === 5), alerts: window.__alerts.slice() };
        window.fetch = savedFetch;
        return out;
      });
      assert(r.saved === true, 'LỖI NẾU FALSE: tự đổi mật khẩu/đăng nhập lại KHÔNG được chặn lưu field khác: ' + JSON.stringify(r));
      assertEqual(r.clientUser.phone, '0900009999', 'DB.users (client) phải có đúng SĐT mới: ' + JSON.stringify(r));
      assertEqual(r.clientUser.mustChangePassword, false, 'DB.users (client) KHÔNG được ghi đè lùi cờ "chưa đổi mật khẩu" (server vừa gỡ đúng lúc) — vẫn phải hiện đúng trạng thái mới nhất: ' + JSON.stringify(r));
      assertEqual(r.alerts.length, 0, 'KHÔNG được hiện alert xung đột nào: ' + JSON.stringify(r));
    });

    run.summarize('users-field-level-conflict-merge');
  } finally {
    await teardown({ server, browser });
  }
}

main().catch((err) => {
  console.error('FATAL:', (err && err.stack) || err);
  process.exitCode = 1;
});
