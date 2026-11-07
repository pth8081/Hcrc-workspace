// server/tests/test-approval-poll-itsupport.js
//
// Regression test cho "Auto Refresh Hỗ Trợ IT" (11/2026, theo yêu cầu người dùng — "đội IT nhà tôi họ
// phải nhìn vào đấy là họ hỗ trợ mà... để có ticket người ta biết ngay. Và có yêu cầu người ta biết
// ngay"): runApprovalPollTick() (core.js) được mở rộng tự vẽ lại ĐÚNG sub-tab đang đứng của màn "Hỗ Trợ
// IT" (itSupportSection) — "💲 Phê Duyệt Giá" (renderItPriceApprovals()) và "🎫 Yêu Cầu Hỗ Trợ IT"
// (renderItTickets()) — KHÔNG cần F5/chuyển tab ra vào, cùng khuôn test-approval-poll-subtabs.js (9
// module)/"Việc B" (Ngân Sách).
//
// Khác 2 nhánh kia: itSupportTickets thuộc nhóm lazy 'itSupport' (LAZY_DATA_GROUPS, routes/data.js) —
// initDatabase() (bước (c) của runApprovalPollTick()) KHÔNG tải lại nó, nên nhánh "🎫 Yêu Cầu Hỗ Trợ IT"
// PHẢI tự xoá cache rồi loadDataGroup('itSupport') ép tải lại thật TRƯỚC khi renderItTickets() — bài test
// này mock CẢ 2 route (/api/approvals/pending-signature VÀ /api/data/lazy/itSupport) để xác nhận đúng dây
// nối, không chỉ riêng route pending-signature như test-approval-poll-subtabs.js.
//
// Chạy: node server/tests/test-approval-poll-itsupport.js
'use strict';

const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8996;

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };

const RENDER_FN_NAMES = ['renderItPriceApprovals', 'renderItTickets'];

async function setupPage() {
  const state = createMockState({ depts: ['Ban Giám Đốc'], users: [ADMIN] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
  // Dừng nhịp poll THẬT (setInterval 3s) — bài test tự gọi runApprovalPollTick() tay từng lượt.
  await page.evaluate(() => stopApprovalPolling());

  await page.evaluate((names) => {
    window.__renderCalls = {};
    names.forEach((name) => {
      const orig = window[name];
      window.__renderCalls[name] = [];
      window[name] = function (...args) {
        window.__renderCalls[name].push(args);
        return orig.apply(this, args);
      };
    });
    // Đếm riêng số lần /api/data/lazy/itSupport được gọi thật — xác nhận ĐÚNG "xoá cache rồi tải lại
    // thật" (không dùng Promise cache cũ của loadDataGroup()), cùng khuôn
    // tests/test-module-refresh-button-generic.js (__lazyFetchCalls).
    window.__itSupportLazyFetchCalls = 0;
    window.__pollSigCounter = 0;
    const baseFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (url === '/api/approvals/pending-signature') {
        // Mỗi lượt gọi trả 1 khoá DUY NHẤT -> luôn vượt qua 2 lớp early-return của runApprovalPollTick(),
        // cùng lý do test-approval-poll-subtabs.js.
        const key = `test:${window.__pollSigCounter++}`;
        return { ok: true, status: 200, json: async () => ({ count: 1, keys: [key], budgetSignature: '', itSupportSignature: '' }) };
      }
      if (url === '/api/data/lazy/itSupport') {
        window.__itSupportLazyFetchCalls++;
        return { ok: true, status: 200, json: async () => ({ itServiceRenewals: [], itSupportTickets: [{ id: 9001, dept: 'Ban Giám Đốc', status: 'TODO' }] }) };
      }
      return baseFetch(url, opts);
    };
  }, RENDER_FN_NAMES);

  return { server, browser, page };
}

function resetCounters(page) {
  return page.evaluate((names) => {
    names.forEach((n) => { window.__renderCalls[n] = []; });
    window.__itSupportLazyFetchCalls = 0;
  }, RENDER_FN_NAMES);
}

function readCounters(page) {
  return page.evaluate((names) => {
    const out = {};
    names.forEach((n) => { out[n] = window.__renderCalls[n].length; });
    out.itSupportLazyFetchCalls = window.__itSupportLazyFetchCalls;
    return out;
  }, RENDER_FN_NAMES);
}

function assertOnlyCalled(counters, expectedNames, label) {
  for (const name of RENDER_FN_NAMES) {
    const expected = expectedNames.includes(name) ? 1 : 0;
    assertEqual(counters[name], expected, `${label}: ${name} phải được gọi đúng ${expected} lần, thực tế ${counters[name]} (toàn bộ: ${JSON.stringify(counters)})`);
  }
}

async function main() {
  const run = createRunner();
  const { server, browser, page } = await setupPage();

  try {
    await run.run('Tab "🛠️ Hỗ Trợ IT" sub-tab "💲 Phê Duyệt Giá" (PRICE) đang mở -> poll tick tự vẽ lại renderItPriceApprovals(), KHÔNG gọi renderItTickets()/KHÔNG tải lại nhóm lazy itSupport', async () => {
      await page.evaluate(() => switchTab('itSupport'));
      await page.evaluate(() => setItSupportSubTab('PRICE'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      const counters = await readCounters(page);
      assertOnlyCalled(counters, ['renderItPriceApprovals'], 'tab itSupport/PRICE');
      assertEqual(counters.itSupportLazyFetchCalls, 0, 'itPriceApprovals thuộc payload chính, KHÔNG được ép tải lại nhóm lazy itSupport');
    });

    await run.run('Tab "🛠️ Hỗ Trợ IT" sub-tab "🎫 Yêu Cầu Hỗ Trợ IT" (TICKET) đang mở -> poll tick ÉP TẢI LẠI THẬT nhóm lazy itSupport rồi tự vẽ lại renderItTickets(), KHÔNG gọi renderItPriceApprovals()', async () => {
      await page.evaluate(() => switchTab('itSupport'));
      await page.evaluate(() => setItSupportSubTab('TICKET'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      const counters = await readCounters(page);
      assertOnlyCalled(counters, ['renderItTickets'], 'tab itSupport/TICKET');
      assertEqual(counters.itSupportLazyFetchCalls, 1, 'phải tải lại THẬT đúng 1 lần nhóm lazy itSupport (không dùng cache Promise cũ)');
      const ticketIds = await page.evaluate(() => DB.itSupportTickets.map(t => t.id));
      assert(ticketIds.includes(9001), 'DB.itSupportTickets phải được cập nhật từ lượt tải lại mới (ticket 9001 từ mock)');
    });

    await run.run('Tab "🛠️ Hỗ Trợ IT" sub-tab "🎫 Yêu Cầu Hỗ Trợ IT" -> gọi LẠI poll tick lần 2 -> VẪN ép tải lại thật (không bị cache Promise giữ lại từ lượt trước)', async () => {
      await page.evaluate(() => switchTab('itSupport'));
      await page.evaluate(() => setItSupportSubTab('TICKET'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      await page.evaluate(() => runApprovalPollTick());
      const counters = await readCounters(page);
      assertEqual(counters.itSupportLazyFetchCalls, 2, 'mỗi lượt poll tick đứng đúng màn TICKET đều phải tải lại thật, không bị cache Promise giữ lại');
      assertEqual(counters.renderItTickets, 2, 'renderItTickets() phải được gọi lại ở cả 2 lượt');
    });

    await run.run('Đứng ở tab khác (không phải Hỗ Trợ IT) -> poll tick KHÔNG gọi renderItPriceApprovals()/renderItTickets(), KHÔNG tải lại nhóm lazy itSupport', async () => {
      await page.evaluate(() => switchTab('doc'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      const counters = await readCounters(page);
      assertOnlyCalled(counters, [], 'tab doc');
      assertEqual(counters.itSupportLazyFetchCalls, 0, 'đứng tab khác thì KHÔNG được tải lại nhóm lazy itSupport');
    });

    await run.run('Lỗi mạng khi tải lại nhóm lazy itSupport (giả lập /api/data/lazy/itSupport lỗi) -> poll tick KHÔNG văng lỗi/KHÔNG unhandled rejection, chỉ bỏ lỡ đúng lượt vẽ lại đó', async () => {
      await page.evaluate(() => switchTab('itSupport'));
      await page.evaluate(() => setItSupportSubTab('TICKET'));
      await resetCounters(page);
      await page.evaluate(() => {
        const baseFetch = window.fetch;
        window.__origFetchForErrTest = baseFetch;
        window.fetch = async (url, opts) => {
          if (url === '/api/data/lazy/itSupport') return { ok: false, status: 500, json: async () => ({}) };
          return baseFetch(url, opts);
        };
      });
      let threw = false;
      try {
        await page.evaluate(() => runApprovalPollTick());
      } catch (e) { threw = true; }
      assert(!threw, 'runApprovalPollTick() không được ném lỗi ra ngoài dù nhóm lazy itSupport tải lỗi');
      const counters = await readCounters(page);
      assertEqual(counters.renderItTickets, 0, 'lỗi tải lại -> KHÔNG gọi renderItTickets() với dữ liệu cũ/rỗng, chờ lượt poll kế tiếp');
    });

  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
