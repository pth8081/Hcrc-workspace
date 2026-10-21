#!/usr/bin/env node
'use strict';

// ==========================================================================
// LỖI NGHIÊM TRỌNG ĐÃ VÁ (11/2026, người dùng báo "hôm nay phát sinh rất nhiều lỗi không lưu được khi
// cấu hình" NGAY SAU đợt vá 409 giả v27.92/v27.93 — xác nhận qua repro thật đây là MỘT LỚP LỖI KHÁC,
// không phải 409):
//
// Hộp Thư Phê Duyệt (Approval Hub) chạy 1 nhịp poll NGẦM mỗi 3 GIÂY (APPROVAL_POLL_INTERVAL_MS,
// runApprovalPollTick() ở core.js) — mỗi khi "chữ ký" danh sách chờ ký đổi (rất dễ xảy ra trong 1 hệ
// thống đang hoạt động, bất kỳ ai gửi/duyệt 1 hồ sơ bất kỳ ở module khác cũng đổi chữ ký này) VÀ không có
// modal nào đang mở, nhịp poll đó gọi initDatabase() — tự GET /api/data rồi GÁN THẲNG
// `DB[key] = data[key] || []` cho MỌI collection không thuộc nhóm lazy (depts/stores/jobTitles/
// formTemplates/emailConfig/... — chính xác các key đã vá baseline ở 2 đợt trước).
//
// Nếu nhịp poll đó rơi ĐÚNG vào khoảng đang gửi 1 lệnh lưu catalog/cấu hình khác (giữa lúc gửi POST và
// lúc nhận phản hồi — có độ trễ mạng thật), GET của poll đọc được bản server TỪ TRƯỚC KHI POST đó kịp
// tới nơi, poll ghi đè DB[key] bằng bản CŨ — khi POST đó sau đó ĐƯỢC SERVER CHẤP NHẬN (saved=true,
// KHÔNG hề có lỗi 409 hay bất kỳ alert nào), DB[key] trong bộ nhớ trình duyệt vẫn giữ bản CŨ poll vừa
// ghi đè, "mất" đúng phần admin vừa thêm/sửa dù ĐÃ lưu đúng trên server (F5 lại thấy đúng ngay — chỉ sai
// hiển thị TRONG PHIÊN hiện tại, khiến admin tưởng lưu thất bại dù hệ thống không báo lỗi gì).
//
// Đã có 1 đợt vá RIÊNG LẺ cho đúng 1 trường hợp (learnLicenseType() ở module-tailieu.js, dời cập nhật cục
// bộ xuống SAU mọi await) nhưng không tổng quát — MỌI hàm lưu catalog/cấu hình khác đều mở theo đúng
// khuôn race này.
//
// Bản vá (core.js, syncStorageOnce()): sau khi XÁC NHẬN server đã lưu đúng `payload` (biến đã chụp SẴN,
// chính nội dung gửi đi), GÁN LẠI `DB[key] = payload` (trừ "users", xem chú thích tại điểm vá) — bất kể
// poll có ghi đè gì ở giữa, kết quả CUỐI CÙNG vẫn luôn khớp ĐÚNG những gì vừa xác nhận lưu thành công.
//
// Test THUẦN CLIENT (cùng khuôn test-syncstorage-generalized-conflict-retry.js): mô phỏng ĐÚNG race —
// bắt đầu 1 lượt lưu (fetch POST có độ trễ giả lập), trong lúc đang "bay" thì tự mô phỏng đúng những gì
// initDatabase() thật làm (gán thẳng DB[key] bằng 1 snapshot CŨ), rồi chờ POST hoàn tất — xác nhận
// DB[key] cuối cùng vẫn đúng với những gì đã lưu, không bị poll "nuốt mất".
//
// Run: node server/tests/test-syncstorage-poll-overwrite-race.js
// ==========================================================================

const { setup, teardown, makeRunner, assert, assertEqual } = require('./_harness');

const PORT = 8996;

async function main() {
  const { server, browser, page } = await setup(PORT);
  const run = makeRunner();

  try {
    await run.run('MẢNG CHUỖI PHẲNG (depts): nhịp poll ghi đè DB.depts GIỮA LÚC lưu đang "bay" -> sau khi lưu THÀNH CÔNG, DB.depts vẫn phải còn mục mới thêm (không bị poll nuốt mất)', async () => {
      const r = await page.evaluate(async () => {
        let serverState = ['A'];
        let serverVersion = '100';
        const savedFetch = window.fetch;
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === '/api/data/depts' && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => serverState };
          }
          if (url === '/api/data/depts' && method === 'POST') {
            await new Promise((res) => setTimeout(res, 50)); // độ trễ mạng giả lập
            const ifMatch = opts.headers['If-Match'];
            if (ifMatch && ifMatch !== serverVersion) {
              return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
            }
            serverState = JSON.parse(opts.body);
            serverVersion = '101';
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => ({ ok: true, version: serverVersion }) };
          }
          return savedFetch(url, opts);
        };

        DB.depts = ['A'];
        DB._versions = DB._versions || {};
        DB._versions.depts = '100';

        const prevDepts = [...DB.depts];
        DB.depts.push('B'); // đúng khuôn saveDept() thật: mutate NGAY trước await
        const savePromise = syncStorage('depts', { baseline: prevDepts });

        await new Promise((res) => setTimeout(res, 10)); // để POST "đang bay" (còn ~40ms nữa mới xong)

        // Mô phỏng ĐÚNG initDatabase() (nhịp poll Hộp Thư Phê Duyệt) chạy giữa lúc POST trên in-flight.
        DB.depts = ['A'];
        DB._versions.depts = '100';

        const saved = await savePromise;
        const out = { saved, finalClientDepts: DB.depts.slice(), finalServerDepts: serverState.slice() };
        window.fetch = savedFetch;
        return out;
      });
      assert(r.saved === true, 'saved phải = true (server chấp nhận lưu, không có conflict thật): ' + JSON.stringify(r));
      assert(r.finalServerDepts.includes('B'), 'server phải có "B" (xác nhận lưu đúng): ' + JSON.stringify(r));
      assert(r.finalClientDepts.includes('B'), 'LỖI THẬT nếu thiếu: DB.depts trong bộ nhớ phải GIỮ "B" sau khi lưu thành công, không được để poll "nuốt mất": ' + JSON.stringify(r));
    });

    await run.run('OBJECT MAP (itPriceDeptWorkflows): nhịp poll ghi đè GIỮA lúc lưu đang "bay" -> sau khi lưu THÀNH CÔNG, phòng ban vừa cấu hình vẫn phải còn', async () => {
      const r = await page.evaluate(async () => {
        const key = 'itPriceDeptWorkflowsPollTest';
        let serverState = { 'Phòng A': { workflowId: 'WF_OLD' } };
        let serverVersion = '200';
        const savedFetch = window.fetch;
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === `/api/data/${key}` && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => serverState };
          }
          if (url === `/api/data/${key}` && method === 'POST') {
            await new Promise((res) => setTimeout(res, 50));
            const ifMatch = opts.headers['If-Match'];
            if (ifMatch && ifMatch !== serverVersion) {
              return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
            }
            serverState = JSON.parse(opts.body);
            serverVersion = '201';
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => ({ ok: true, version: serverVersion }) };
          }
          return savedFetch(url, opts);
        };

        DB[key] = { 'Phòng A': { workflowId: 'WF_OLD' } };
        DB._versions = DB._versions || {};
        DB._versions[key] = '200';

        const baseline = JSON.parse(JSON.stringify(DB[key]));
        DB[key] = { ...DB[key], 'Phòng B': { workflowId: 'WF_1STEP' } }; // admin cấu hình thêm Phòng B
        const savePromise = syncStorage(key, { baseline });

        await new Promise((res) => setTimeout(res, 10));
        DB[key] = { 'Phòng A': { workflowId: 'WF_OLD' } }; // poll ghi đè bằng bản CŨ (chưa thấy Phòng B)
        DB._versions[key] = '200';

        const saved = await savePromise;
        const out = { saved, finalClient: DB[key], finalServer: serverState };
        window.fetch = savedFetch;
        return out;
      });
      assert(r.saved === true, 'saved phải = true: ' + JSON.stringify(r));
      assert('Phòng B' in r.finalServer, 'server phải có "Phòng B": ' + JSON.stringify(r));
      assert('Phòng B' in r.finalClient, 'LỖI THẬT nếu thiếu: DB[key] phải GIỮ "Phòng B" sau khi lưu thành công: ' + JSON.stringify(r));
    });

    await run.run('users: KHÔNG bị gán đè bởi payload (giữ nguyên hành vi cũ — payload cố ý thiếu mustChangePassword, gán thẳng sẽ xoá nhầm cờ này của user khác)', async () => {
      const r = await page.evaluate(async () => {
        const savedFetch = window.fetch;
        let serverVersion = '300';
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === '/api/data/users' && method === 'POST') {
            serverVersion = '301';
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => ({ ok: true, version: serverVersion }) };
          }
          return savedFetch(url, opts);
        };
        DB.users = [
          { id: 1, username: 'u1', name: 'User 1', perms: {}, groupIds: [], active: true, mustChangePassword: true },
          { id: 2, username: 'u2', name: 'User 2', perms: {}, groupIds: [], active: true, mustChangePassword: false }
        ];
        DB._versions = DB._versions || {};
        DB._versions.users = '300';
        const prevUsers = DB.users.map(u => ({ ...u }));
        DB.users = DB.users.map(u => u.id === 1 ? { ...u, name: 'User 1 Sửa' } : u);
        const saved = await syncStorage('users', { baseline: prevUsers });
        const out = { saved, u1MustChange: DB.users.find(u => u.id === 1)?.mustChangePassword, u2MustChange: DB.users.find(u => u.id === 2)?.mustChangePassword, u1Name: DB.users.find(u => u.id === 1)?.name };
        window.fetch = savedFetch;
        return out;
      });
      assert(r.saved === true, 'saved phải = true: ' + JSON.stringify(r));
      assertEqual(r.u1MustChange, true, 'mustChangePassword của user 1 phải GIỮ NGUYÊN (true) — không bị payload (vốn không có field này) xoá mất: ' + JSON.stringify(r));
      assertEqual(r.u2MustChange, false, 'mustChangePassword của user 2 phải GIỮ NGUYÊN (false): ' + JSON.stringify(r));
      assertEqual(r.u1Name, 'User 1 Sửa', 'tên user 1 phải đã đổi đúng: ' + JSON.stringify(r));
    });

    run.summarize('test-syncstorage-poll-overwrite-race');
  } finally {
    await teardown({ server, browser });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
