// server/tests/test-workflow-audit-ui.js
//
// Regression UI (Playwright thật) cho màn "🔍 Audit Quy Trình" (Hệ Thống > Quản Trị > 🔄 Quy Trình & Phê
// Duyệt) — renderWorkflowAuditPanel()/runWorkflowAuditScan()/toggleWorkflowAuditAutoScan()
// (module-workflow.js). testHarness.js's createDispatcher() KHÔNG xử lý 3 route mới
// (/api/admin/workflow-audit*, routes/workflowAudit.js) — test này BỌC THÊM window.fetch ngay sau
// launchPage() để tự trả lời ĐÚNG 3 route đó bằng dữ liệu giả lập có kiểm soát, giữ nguyên fetch gốc
// (đi qua dispatcher thật) cho MỌI url khác — không đụng gì tới testHarness.js dùng chung.
//
// Chạy: node server/tests/test-workflow-audit-ui.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual, assert } = require('./testHarness');

const PORT_UI = 8997;

async function main() {
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({ users: [ADMIN] });
  const { browser, page } = await launchPage(PORT_UI, state);
  const run = createRunner();

  // Mock state RIÊNG cho 3 route Audit — chỉnh được giữa các kịch bản qua page.evaluate() gọi
  // window.__setWorkflowAuditMock(...), không cần restart browser.
  await page.evaluate(() => {
    window.__workflowAuditMock = {
      summary: { at: null, total: 0, critical: 0, warning: 0 },
      config: { autoScanEmailEnabled: true, ccEmails: [] },
      scanResult: { at: new Date().toISOString(), findings: [] },
      forbidden: false,
      scanCallCount: 0,
      configPostCalls: []
    };
    const originalFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const m = window.__workflowAuditMock;
      if (url === '/api/admin/workflow-audit/summary' && method === 'GET') {
        if (m.forbidden) return { ok: false, status: 403, json: async () => ({ error: 'Chỉ Quản Trị Viên' }) };
        return { ok: true, status: 200, json: async () => m.summary };
      }
      if (url === '/api/admin/workflow-audit/config' && method === 'GET') {
        return { ok: true, status: 200, json: async () => m.config };
      }
      if (url === '/api/admin/workflow-audit/config' && method === 'POST') {
        const body = JSON.parse(opts.body);
        m.configPostCalls.push(body);
        m.config = { autoScanEmailEnabled: body.autoScanEmailEnabled, ccEmails: body.ccEmails || [] };
        return { ok: true, status: 200, json: async () => m.config };
      }
      if (url === '/api/admin/workflow-audit' && method === 'GET') {
        m.scanCallCount++;
        return { ok: true, status: 200, json: async () => m.scanResult };
      }
      return originalFetch(url, opts);
    };
  });

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('WORKFLOW'); });
    await page.waitForTimeout(150);

    await run.run('Vào tab WORKFLOW -> tự load cache tóm tắt (chưa quét lần nào) + đọc đúng cấu hình auto-scan', async () => {
      const result = await page.evaluate(() => ({
        panelHidden: document.getElementById('workflowAuditPanel').classList.contains('hidden'),
        lastScanText: document.getElementById('workflowAuditLastScan').innerText,
        summaryRowHidden: document.getElementById('workflowAuditSummaryRow').classList.contains('hidden'),
        toggleChecked: document.getElementById('workflowAuditAutoScanToggle').checked
      }));
      assertEqual(result.panelHidden, false, 'Panel phải hiện (admin)');
      assert(result.lastScanText.includes('Chưa quét lần nào'), `phải báo chưa quét lần nào, thực tế "${result.lastScanText}"`);
      assertEqual(result.summaryRowHidden, true, 'Chưa có lần quét (at=null) -> ẩn hàng tóm tắt số liệu');
      assertEqual(result.toggleChecked, true, 'Toggle auto-scan phải khớp cấu hình mock (true)');
    });

    await run.run('Bấm "🔄 Quét Ngay" -> hiện đủ 2 lỗ hổng (1 CRITICAL + 1 WARNING), đúng badge/màu/nội dung', async () => {
      await page.evaluate(() => {
        window.__workflowAuditMock.scanResult = {
          at: new Date().toISOString(),
          findings: [
            { module: 'docs', moduleLabel: '📄 Tài Liệu', scopeLabel: '📄 Tài Liệu — Phòng Kế Toán', stepOrder: 1, stepName: 'Duyệt', severity: 'CRITICAL', reason: 'Chưa gắn người duyệt nào.' },
            { module: 'submissions', moduleLabel: '🧾 Văn Bản Trình', scopeLabel: '🧾 Văn Bản Trình — Nhóm "Xin ý kiến"', stepOrder: null, stepName: 'Xin ý kiến', severity: 'WARNING', reason: 'Chưa gán thành viên nào.' }
          ]
        };
      });
      await page.evaluate(() => runWorkflowAuditScan());
      const result = await page.evaluate(() => ({
        total: document.getElementById('workflowAuditTotalCount').innerText,
        critical: document.getElementById('workflowAuditCriticalCount').innerText,
        warning: document.getElementById('workflowAuditWarningCount').innerText,
        summaryRowHidden: document.getElementById('workflowAuditSummaryRow').classList.contains('hidden'),
        findingsHtml: document.getElementById('workflowAuditFindingsList').innerHTML,
        lastScanText: document.getElementById('workflowAuditLastScan').innerText,
        callCount: window.__workflowAuditMock.scanCallCount
      }));
      assertEqual(result.total, '2', 'Tổng phải là 2');
      assertEqual(result.critical, '1', 'Nghiêm trọng phải là 1');
      assertEqual(result.warning, '1', 'Cảnh báo phải là 1');
      assertEqual(result.summaryRowHidden, false, 'Đã có lần quét -> hiện hàng tóm tắt số liệu');
      assert(result.findingsHtml.includes('Phòng Kế Toán'), 'phải hiện đúng tên phòng ban của finding CRITICAL');
      assert(result.findingsHtml.includes('NGHIÊM TRỌNG'), 'phải có badge "NGHIÊM TRỌNG"');
      assert(result.findingsHtml.includes('CẢNH BÁO'), 'phải có badge "CẢNH BÁO"');
      assert(result.findingsHtml.includes('bg-rose-600') || result.findingsHtml.includes('border-rose-600'), 'finding CRITICAL phải tô màu đỏ (rose)');
      assert(result.findingsHtml.includes('bg-amber-500') || result.findingsHtml.includes('border-amber-500'), 'finding WARNING phải tô màu vàng (amber)');
      assert(!result.lastScanText.includes('Chưa quét lần nào'), 'phải cập nhật lại mốc quét (không còn "Chưa quét lần nào")');
      assertEqual(result.callCount, 1, 'phải gọi ĐÚNG 1 lần route quét thật khi bấm 1 lần');
    });

    await run.run('Quét lại khi KHÔNG còn lỗ hổng nào -> hiện đúng thông báo "Không phát hiện lỗ hổng"', async () => {
      await page.evaluate(() => {
        window.__workflowAuditMock.scanResult = { at: new Date().toISOString(), findings: [] };
      });
      await page.evaluate(() => runWorkflowAuditScan());
      const result = await page.evaluate(() => ({
        total: document.getElementById('workflowAuditTotalCount').innerText,
        findingsHtml: document.getElementById('workflowAuditFindingsList').innerHTML
      }));
      assertEqual(result.total, '0', 'Tổng phải về 0');
      assert(result.findingsHtml.includes('Không phát hiện lỗ hổng'), 'phải hiện thông báo không còn lỗ hổng');
    });

    await run.run('Tick tắt "Tự động quét hằng ngày" -> gọi ĐÚNG POST config với autoScanEmailEnabled=false, GIỮ NGUYÊN ccEmails cũ', async () => {
      await page.evaluate(() => {
        window.__workflowAuditMock.config = { autoScanEmailEnabled: true, ccEmails: ['giu-nguyen@test.com'] };
        window.__workflowAuditMock.configPostCalls = [];
        const el = document.getElementById('workflowAuditAutoScanToggle');
        el.checked = false;
        toggleWorkflowAuditAutoScan();
      });
      await page.waitForTimeout(100);
      const result = await page.evaluate(() => window.__workflowAuditMock.configPostCalls);
      assertEqual(result.length, 1, 'phải gọi đúng 1 lần POST config');
      assertEqual(result[0].autoScanEmailEnabled, false, 'phải gửi đúng autoScanEmailEnabled=false');
      assert(Array.isArray(result[0].ccEmails) && result[0].ccEmails.includes('giu-nguyen@test.com'), 'phải GIỮ NGUYÊN ccEmails đã có trước đó, không xoá mất');
    });

    await run.run('Không phải admin (route trả 403) -> ẩn HẲN panel, không hiện UI vỡ', async () => {
      await page.evaluate(() => { window.__workflowAuditMock.forbidden = true; });
      await page.evaluate(() => renderWorkflowAuditPanel());
      const hidden = await page.evaluate(() => document.getElementById('workflowAuditPanel').classList.contains('hidden'));
      assertEqual(hidden, true, 'Panel phải tự ẩn khi route báo 403 (không phải admin)');
      await page.evaluate(() => { window.__workflowAuditMock.forbidden = false; });
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
