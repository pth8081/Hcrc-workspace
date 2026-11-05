// server/tests/test-approval-poll-subtabs.js
//
// Regression test cho "Việc A" (11/2026, người dùng phản hồi "có yêu cầu rồi mà ko thấy phê duyệt, có
// phê duyệt nhưng chưa thấy để xử lý tiếp"): runApprovalPollTick() (core.js) được mở rộng tự vẽ lại ĐÚNG
// sub-tab "Phê duyệt" riêng của 9 module (Tài liệu/Văn bản trình/Hợp đồng/Phòng Họp/Đăng ký xe/VPP/
// Văn Phòng-Mua Bán+Sửa Chữa/Thanh Toán/Vận Hành-Đơn Hàng), KHÔNG cần F5/chuyển tab ra vào.
//
// + "Việc B" (MỚI, 11/2026) — Ngân Sách KHÔNG nằm trong 9 module trên (quyết định v23.0, đã gỡ khỏi Hộp
// Thư Phê Duyệt) nhưng vẫn cần tự vẽ lại tab "✅ Duyệt"/"📝 Đề Xuất" NẾU người dùng đang đứng đúng đó, qua
// 1 "chữ ký" RIÊNG (budgetSignature, routes/approvals.js computeMyPendingBudgetSignature()) gộp vào chữ
// ký tổng CHỈ để làm trigger (KHÔNG gộp vào 'keys'/badge Hub) — xem các kịch bản "Ngân Sách" bên dưới.
//
// Test này KHÔNG kiểm tra lại logic lọc/hiển thị bên trong từng hàm render (đã có bộ test riêng của từng
// module) — chỉ kiểm tra ĐÚNG "dây nối": khi người dùng đang đứng ở đúng sub-tab nào thì runApprovalPollTick()
// gọi ĐÚNG hàm render đó (và KHÔNG gọi các hàm của sub-tab khác/section đang ẩn), bằng cách bọc (wrap) từng
// hàm render thật với 1 bộ đếm lệnh gọi (vẫn gọi qua hàm thật, không stub rỗng).
//
// Chạy: node server/tests/test-approval-poll-subtabs.js
'use strict';

const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8997;

// totpEnabled: true — tránh màn "Bắt buộc thiết lập TOTP cho Admin" (#totpSetupWallModal, mở tự động ở
// proceedAfterAuth() khi user.perms.admin && !user.totpEnabled) tự mở chặn NGANG isAnyModalOpen() của
// runApprovalPollTick() ngay từ bước (b) — không liên quan gì tới tính năng đang test, chỉ là tài khoản
// Admin THẬT trên production đã luôn thiết lập 2FA từ lâu, mirror đúng trạng thái thật.
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };

const RENDER_FN_NAMES = [
  'renderDocs', 'renderSubmissionReqs', 'renderContracts', 'renderMeetings', 'renderCarRegs',
  'renderVppRegistrations', 'renderOfficeReqs', 'renderPaymentRequests', 'renderPaymentManageTab',
  'renderOperationList', 'renderBudgetLineList'
];

async function setupPage() {
  const state = createMockState({ depts: ['Ban Giám Đốc'], users: [ADMIN] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
  // Dừng nhịp poll THẬT (setInterval 3s) — bài test tự gọi runApprovalPollTick() tay từng lượt, không cần
  // (và không muốn) nhịp nền chạy song song gây đếm lệch.
  await page.evaluate(() => stopApprovalPolling());

  // Bọc từng hàm render THẬT bằng 1 bộ đếm — vẫn gọi qua hàm gốc (không mất hành vi thật/không vỡ DOM),
  // chỉ thêm đếm số lần gọi. Gắn vào `window.<name>` vì đây là script cổ điển (không phải module) — toàn
  // bộ lời gọi KHÔNG đủ tên (`renderDocs()`) trong core.js vẫn phân giải đúng vào property này của global
  // object, y hệt cách gán lại 1 biến top-level.
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
    // Mock riêng cho GET /api/approvals/pending-signature (routes/approvals.js) — testHarness.js chưa hỗ
    // trợ endpoint này (chỉ dùng cho Part B của test-approval-polling.js, chạy thẳng router Express thật,
    // không qua launchPage()). Mỗi lượt gọi trả 1 khoá DUY NHẤT (không trùng lượt trước) để CHẮC CHẮN
    // vượt qua 2 lớp "early return nếu chữ ký không đổi" của runApprovalPollTick() (lastSeenApprovalSignature/
    // lastAppliedApprovalSignature) ở MỌI lượt gọi trong bài test này, không cần biết giá trị hiện tại.
    window.__pollSigCounter = 0;
    // __budgetSigOverride (MỚI, "Việc B"): null (mặc định) = mỗi lượt vẫn trả 1 budgetSignature DUY NHẤT
    // (tăng dần, cùng lý do __pollSigCounter — không ảnh hưởng các kịch bản A vốn chỉ quan tâm 'keys').
    // Set thành 1 hàm () => string để bài test tự kiểm soát budgetSignature CHÍNH XÁC qua từng lượt gọi
    // (vd giữ nguyên 'keys' nhưng đổi budgetSignature, chứng minh đúng thiết kế "gộp chữ ký" ở core.js).
    window.__budgetSigCounter = 0;
    window.__budgetSigOverride = null;
    const baseFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (url === '/api/approvals/pending-signature') {
        const key = `test:${window.__pollSigCounter++}`;
        const budgetSignature = typeof window.__budgetSigOverride === 'function'
          ? window.__budgetSigOverride()
          : `budget-test:${window.__budgetSigCounter++}`;
        return { ok: true, status: 200, json: async () => ({ count: 1, keys: [key], budgetSignature }) };
      }
      return baseFetch(url, opts);
    };
  }, RENDER_FN_NAMES);

  return { server, browser, page };
}

function resetCounters(page) {
  return page.evaluate((names) => { names.forEach((n) => { window.__renderCalls[n] = []; }); }, RENDER_FN_NAMES);
}

function readCounters(page) {
  return page.evaluate((names) => {
    const out = {};
    names.forEach((n) => { out[n] = window.__renderCalls[n].length; });
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
    await run.run('Tab "📄 Tài Liệu" đang mở -> poll tick tự vẽ lại renderDocs(), KHÔNG đụng 9 hàm khác', async () => {
      await page.evaluate(() => switchTab('doc'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      assertOnlyCalled(await readCounters(page), ['renderDocs'], 'tab doc');
    });

    await run.run('Tab "📝 Văn Bản Trình" đang mở -> poll tick tự vẽ lại renderSubmissionReqs()', async () => {
      await page.evaluate(() => switchTab('submission'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      assertOnlyCalled(await readCounters(page), ['renderSubmissionReqs'], 'tab submission');
    });

    await run.run('Tab "📜 Hợp Đồng" đang mở -> poll tick tự vẽ lại renderContracts()', async () => {
      await page.evaluate(() => switchTab('contract'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      assertOnlyCalled(await readCounters(page), ['renderContracts'], 'tab contract');
    });

    await run.run('Tab "📅 Phòng Họp" đang mở -> poll tick tự vẽ lại renderMeetings()', async () => {
      await page.evaluate(() => switchTab('meeting'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      assertOnlyCalled(await readCounters(page), ['renderMeetings'], 'tab meeting');
    });

    await run.run('Tab "🚗 Đăng Ký Xe" đang mở -> poll tick tự vẽ lại renderCarRegs()', async () => {
      await page.evaluate(() => switchTab('car'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      assertOnlyCalled(await readCounters(page), ['renderCarRegs'], 'tab car');
    });

    await run.run('Tab "🖊️ VPP" đang mở -> poll tick tự vẽ lại renderVppRegistrations()', async () => {
      await page.evaluate(() => switchTab('vpp'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      assertOnlyCalled(await readCounters(page), ['renderVppRegistrations'], 'tab vpp');
    });

    await run.run('Tab "🏢 Văn Phòng" sub-tab Mua Bán đang mở -> poll tick tự vẽ lại renderOfficeReqs(), KHÔNG gọi 2 hàm Thanh Toán', async () => {
      await page.evaluate(() => switchTab('office'));
      await page.evaluate(() => setOfficeSubTab('MUA_BAN'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      assertOnlyCalled(await readCounters(page), ['renderOfficeReqs'], 'tab office/MUA_BAN');
    });

    await run.run('Tab "🏢 Văn Phòng" sub-tab Sửa Chữa đang mở -> poll tick vẫn tự vẽ lại renderOfficeReqs() (dùng chung bảng với Mua Bán)', async () => {
      await page.evaluate(() => switchTab('office'));
      await page.evaluate(() => setOfficeSubTab('SUA_CHUA'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      assertOnlyCalled(await readCounters(page), ['renderOfficeReqs'], 'tab office/SUA_CHUA');
    });

    await run.run('Tab "🏢 Văn Phòng" sub-tab "💰 Thanh Toán" đang mở -> poll tick tự vẽ lại renderPaymentRequests()+renderPaymentManageTab(), KHÔNG gọi renderOfficeReqs() (bảng đó đang ẨN)', async () => {
      await page.evaluate(() => switchTab('office'));
      await page.evaluate(() => setOfficeSubTab('PAYMENT'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      assertOnlyCalled(await readCounters(page), ['renderPaymentRequests', 'renderPaymentManageTab'], 'tab office/PAYMENT');
    });

    await run.run('Tab "🏭 Vận Hành" sub-tab Đơn Hàng > Danh Sách (STORE) đang mở -> poll tick tự vẽ lại renderOperationList(\'operationOrders\')', async () => {
      await page.evaluate(() => switchTab('vanHanh'));
      await page.evaluate(() => setVanHanhSubTab('ORDERS'));
      await page.evaluate(() => setOperationOrderSubTab('STORE'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      const counters = await readCounters(page);
      assertOnlyCalled(counters, ['renderOperationList'], 'tab vanHanh/ORDERS/STORE');
      const args = await page.evaluate(() => window.__renderCalls.renderOperationList[0]);
      assertEqual(args[0], 'operationOrders', 'renderOperationList() phải được gọi với đúng tham số \'operationOrders\'');
    });

    await run.run('Tab "🏭 Vận Hành" sub-tab Đơn Hàng > Danh Sách (HO) đang mở -> poll tick vẫn tự vẽ lại renderOperationList(\'operationOrders\')', async () => {
      await page.evaluate(() => switchTab('vanHanh'));
      await page.evaluate(() => setVanHanhSubTab('ORDERS'));
      await page.evaluate(() => setOperationOrderSubTab('HO'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      assertOnlyCalled(await readCounters(page), ['renderOperationList'], 'tab vanHanh/ORDERS/HO');
    });

    await run.run('Tab "🏭 Vận Hành" sub-tab Đơn Hàng > Báo Cáo (REPORT, KHÔNG phải bảng chờ duyệt) đang mở -> poll tick KHÔNG gọi renderOperationList() (tránh vẽ lại bảng đang ẨN)', async () => {
      await page.evaluate(() => switchTab('vanHanh'));
      await page.evaluate(() => setVanHanhSubTab('ORDERS'));
      await page.evaluate(() => setOperationOrderSubTab('REPORT'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      assertOnlyCalled(await readCounters(page), [], 'tab vanHanh/ORDERS/REPORT');
    });

    await run.run('Tab "🏭 Vận Hành" sub-tab Siêu Thị (STORE, KHÔNG phải Đơn Hàng) đang mở -> poll tick KHÔNG gọi renderOperationList()', async () => {
      await page.evaluate(() => switchTab('vanHanh'));
      await page.evaluate(() => setVanHanhSubTab('STORE'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      assertOnlyCalled(await readCounters(page), [], 'tab vanHanh/STORE');
    });

    await run.run('Tab "📊 Ngân Sách" sub-tab "✅ Duyệt" (APPROVE) đang mở -> poll tick tự vẽ lại renderBudgetLineList(\'APPROVED\')', async () => {
      await page.evaluate(() => switchTab('budget'));
      await page.evaluate(() => setBudgetLineTab('APPROVE'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      assertOnlyCalled(await readCounters(page), ['renderBudgetLineList'], 'tab budget/APPROVE');
      const args = await page.evaluate(() => window.__renderCalls.renderBudgetLineList[0]);
      assertEqual(args[0], 'APPROVED', 'renderBudgetLineList() phải được gọi với đúng tham số \'APPROVED\'');
    });

    await run.run('Tab "📊 Ngân Sách" sub-tab "📝 Đề Xuất" (PROPOSE) đang mở -> poll tick tự vẽ lại renderBudgetLineList(\'PROPOSED\')', async () => {
      await page.evaluate(() => switchTab('budget'));
      await page.evaluate(() => setBudgetLineTab('PROPOSE'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      assertOnlyCalled(await readCounters(page), ['renderBudgetLineList'], 'tab budget/PROPOSE');
      const args = await page.evaluate(() => window.__renderCalls.renderBudgetLineList[0]);
      assertEqual(args[0], 'PROPOSED', 'renderBudgetLineList() phải được gọi với đúng tham số \'PROPOSED\'');
    });

    await run.run('Tab "📊 Ngân Sách" sub-tab "💳 Sử Dụng" (USED, KHÔNG phải Đề Xuất/Duyệt) đang mở -> poll tick KHÔNG gọi renderBudgetLineList()', async () => {
      await page.evaluate(() => switchTab('budget'));
      await page.evaluate(() => setBudgetLineTab('USED'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      assertOnlyCalled(await readCounters(page), [], 'tab budget/USED');
    });

    await run.run('Đứng ở tab khác (không phải Ngân Sách) -> poll tick KHÔNG gọi renderBudgetLineList() dù budgetSignature đổi', async () => {
      await page.evaluate(() => switchTab('doc'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      assertOnlyCalled(await readCounters(page), ['renderDocs'], 'tab doc (budgetSignature cũng đổi nhưng budgetSection đang ẩn)');
    });

    await run.run('ĐÚNG thiết kế "gộp chữ ký": keys KHÔNG đổi nhưng budgetSignature đổi -> poll tick VẪN tự vẽ lại (không bị 2 lớp early-return chặn oan)', async () => {
      await page.evaluate(() => switchTab('budget'));
      await page.evaluate(() => setBudgetLineTab('APPROVE'));
      // Khoá CỨNG 'keys' (không đổi giữa 2 lượt) — chỉ budgetSignature đổi qua __budgetSigOverride.
      await page.evaluate(() => {
        const baseFetch = window.fetch;
        let n = 0;
        window.fetch = async (url, opts) => {
          if (url === '/api/approvals/pending-signature') {
            return { ok: true, status: 200, json: async () => ({ count: 1, keys: ['fixed-key'], budgetSignature: `fixed-but-changing:${n++}` }) };
          }
          return baseFetch(url, opts);
        };
      });
      await page.evaluate(() => runApprovalPollTick()); // lượt 1 — thiết lập lastAppliedApprovalSignature cho chữ ký gộp lượt 1.
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick()); // lượt 2 — 'keys' giống hệt lượt 1, CHỈ budgetSignature đổi.
      assertOnlyCalled(await readCounters(page), ['renderBudgetLineList'], 'keys cố định, chỉ budgetSignature đổi');
    });

    await run.run('Đứng ở Dashboard (không phải bất kỳ 9 tab nào) -> poll tick KHÔNG gọi BẤT KỲ hàm nào trong 9 hàm trên', async () => {
      await page.evaluate(() => switchTab('dashboard'));
      await resetCounters(page);
      await page.evaluate(() => runApprovalPollTick());
      assertOnlyCalled(await readCounters(page), [], 'tab dashboard');
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
