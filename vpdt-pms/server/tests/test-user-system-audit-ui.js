// server/tests/test-user-system-audit-ui.js
//
// Regression UI (Playwright thật) cho 2 màn mới "🔍 Audit Người Dùng"/"🔍 Audit Hệ Thống" (Hệ Thống >
// Quản Trị > ⚙️ Quản Trị > 2 nút mới) — renderUserAuditPanel()/renderSystemAuditPanel()/
// runUserAuditScan()/runSystemAuditScan()/toggleUserAuditAutoScan()/toggleSystemAuditAutoScan()/
// saveUserAuditDormantDays() (module-hethong-tabs.js). CÙNG kỹ thuật test-workflow-audit-ui.js: bọc
// THÊM window.fetch sau launchPage() để tự trả lời 6 route mới (3 route/audit), không đụng
// testHarness.js dùng chung.
//
// Chạy: node server/tests/test-user-system-audit-ui.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual, assert } = require('./testHarness');

const PORT_UI = 8996;

async function main() {
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({ users: [ADMIN] });
  const { browser, page } = await launchPage(PORT_UI, state);
  const run = createRunner();

  await page.evaluate(() => {
    window.__userAuditMock = {
      summary: { at: null, total: 0, critical: 0, warning: 0, info: 0 },
      config: { autoScanEmailEnabled: true, ccEmails: [], dormantDaysThreshold: 90 },
      scanResult: { at: new Date().toISOString(), findings: [] },
      forbidden: false, scanCallCount: 0, configPostCalls: []
    };
    window.__systemAuditMock = {
      summary: { at: null, total: 0, critical: 0, warning: 0, info: 0 },
      config: { autoScanEmailEnabled: true, ccEmails: [] },
      scanResult: { at: new Date().toISOString(), findings: [] },
      forbidden: false, scanCallCount: 0, configPostCalls: []
    };
    const originalFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      for (const [prefix, m] of [['/api/admin/user-audit', window.__userAuditMock], ['/api/admin/system-audit', window.__systemAuditMock]]) {
        if (url === `${prefix}/summary` && method === 'GET') {
          if (m.forbidden) return { ok: false, status: 403, json: async () => ({ error: 'Chỉ Quản Trị Viên' }) };
          return { ok: true, status: 200, json: async () => m.summary };
        }
        if (url === `${prefix}/config` && method === 'GET') return { ok: true, status: 200, json: async () => m.config };
        if (url === `${prefix}/config` && method === 'POST') {
          const body = JSON.parse(opts.body);
          m.configPostCalls.push(body);
          m.config = Object.assign({}, m.config, body);
          return { ok: true, status: 200, json: async () => m.config };
        }
        if (url === prefix && method === 'GET') {
          m.scanCallCount++;
          return { ok: true, status: 200, json: async () => m.scanResult };
        }
      }
      return originalFetch(url, opts);
    };
  });

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('AUDITUSER'); });
    await page.waitForTimeout(150);

    await run.run('[Người Dùng] Vào sub-tab AUDITUSER -> load cache tóm tắt + cấu hình (chưa quét, ngưỡng 90 ngày)', async () => {
      const result = await page.evaluate(() => ({
        panelHidden: document.getElementById('adminSubAuditUser').classList.contains('hidden'),
        lastScanText: document.getElementById('userAuditLastScan').innerText,
        summaryRowHidden: document.getElementById('userAuditSummaryRow').classList.contains('hidden'),
        toggleChecked: document.getElementById('userAuditAutoScanToggle').checked,
        dormantValue: document.getElementById('userAuditDormantDays').value
      }));
      assertEqual(result.panelHidden, false, 'Panel phải hiện (admin)');
      assert(result.lastScanText.includes('Chưa quét lần nào'), `phải báo chưa quét, thực tế "${result.lastScanText}"`);
      assertEqual(result.summaryRowHidden, true, 'Chưa quét -> ẩn hàng tóm tắt');
      assertEqual(result.toggleChecked, true, 'Toggle phải khớp cấu hình mock (true)');
      assertEqual(result.dormantValue, '90', 'Ngưỡng ngày phải đọc đúng cấu hình mock');
    });

    await run.run('[Người Dùng] Bấm "Quét Ngay" -> hiện đủ 3 phát hiện (CRITICAL/WARNING/INFO), đúng badge', async () => {
      await page.evaluate(() => {
        window.__userAuditMock.scanResult = {
          at: new Date().toISOString(),
          findings: [
            { type: 'ACTIVE_AFTER_OFFBOARD', severity: 'CRITICAL', username: 'nv1', name: 'Nguyễn Văn A', reason: 'Hồ sơ đã nghỉ việc nhưng tài khoản vẫn active.' },
            { type: 'DORMANT_ACCOUNT', severity: 'WARNING', username: 'nv2', name: 'Trần Thị B', reason: 'Không đăng nhập 100 ngày.' },
            { type: 'ADMIN_ACCOUNT', severity: 'INFO', username: 'admin2', name: 'Admin 2', reason: 'Đang có quyền admin.' }
          ]
        };
      });
      await page.evaluate(() => runUserAuditScan());
      const result = await page.evaluate(() => ({
        total: document.getElementById('userAuditTotalCount').innerText,
        critical: document.getElementById('userAuditCriticalCount').innerText,
        warning: document.getElementById('userAuditWarningCount').innerText,
        findingsHtml: document.getElementById('userAuditFindingsList').innerHTML,
        callCount: window.__userAuditMock.scanCallCount
      }));
      assertEqual(result.total, '3');
      assertEqual(result.critical, '1');
      assertEqual(result.warning, '1');
      assert(result.findingsHtml.includes('nv1') && result.findingsHtml.includes('Nguyễn Văn A'), 'phải hiện username + tên finding CRITICAL');
      assert(result.findingsHtml.includes('NGHIÊM TRỌNG') && result.findingsHtml.includes('CẢNH BÁO') && result.findingsHtml.includes('THÔNG TIN'), 'phải có đủ 3 badge mức độ');
      assertEqual(result.callCount, 1, 'phải gọi đúng 1 lần route quét');
    });

    await run.run('[Người Dùng] Tick tắt auto-scan -> POST đúng autoScanEmailEnabled=false, GIỮ ccEmails/dormantDaysThreshold cũ', async () => {
      await page.evaluate(() => {
        window.__userAuditMock.config = { autoScanEmailEnabled: true, ccEmails: ['giu-nguyen@test.com'], dormantDaysThreshold: 45 };
        window.__userAuditMock.configPostCalls = [];
        document.getElementById('userAuditAutoScanToggle').checked = false;
        toggleUserAuditAutoScan();
      });
      await page.waitForTimeout(100);
      const calls = await page.evaluate(() => window.__userAuditMock.configPostCalls);
      assertEqual(calls.length, 1);
      assertEqual(calls[0].autoScanEmailEnabled, false);
      assert(calls[0].ccEmails.includes('giu-nguyen@test.com'), 'phải giữ nguyên ccEmails cũ');
      assertEqual(calls[0].dormantDaysThreshold, 45, 'phải giữ nguyên ngưỡng ngày cũ (không có ô riêng trong hàm này)');
    });

    await run.run('[Người Dùng] Đổi ngưỡng ngày -> POST đúng dormantDaysThreshold mới, GIỮ autoScanEmailEnabled/ccEmails cũ', async () => {
      await page.evaluate(() => {
        window.__userAuditMock.config = { autoScanEmailEnabled: false, ccEmails: ['a@test.com'], dormantDaysThreshold: 90 };
        window.__userAuditMock.configPostCalls = [];
        document.getElementById('userAuditDormantDays').value = '60';
        saveUserAuditDormantDays();
      });
      await page.waitForTimeout(100);
      const calls = await page.evaluate(() => window.__userAuditMock.configPostCalls);
      assertEqual(calls.length, 1);
      assertEqual(calls[0].dormantDaysThreshold, 60);
      assertEqual(calls[0].autoScanEmailEnabled, false, 'phải giữ nguyên giá trị cũ (false)');
    });

    await run.run('[Người Dùng] Không phải admin (403) -> ẩn hẳn panel', async () => {
      await page.evaluate(() => { window.__userAuditMock.forbidden = true; });
      await page.evaluate(() => renderUserAuditPanel());
      const hidden = await page.evaluate(() => document.getElementById('adminSubAuditUser').classList.contains('hidden'));
      assertEqual(hidden, true);
      await page.evaluate(() => { window.__userAuditMock.forbidden = false; });
    });

    // ===== Audit Hệ Thống =====
    await page.evaluate(() => { setAdminSubTab('AUDITSYSTEM'); });
    await page.waitForTimeout(100);

    await run.run('[Hệ Thống] Vào sub-tab AUDITSYSTEM -> load cache tóm tắt (chưa quét)', async () => {
      const result = await page.evaluate(() => ({
        panelHidden: document.getElementById('adminSubAuditSystem').classList.contains('hidden'),
        lastScanText: document.getElementById('systemAuditLastScan').innerText,
        toggleChecked: document.getElementById('systemAuditAutoScanToggle').checked
      }));
      assertEqual(result.panelHidden, false);
      assert(result.lastScanText.includes('Chưa quét lần nào'));
      assertEqual(result.toggleChecked, true);
    });

    await run.run('[Hệ Thống] Bấm "Quét Ngay" -> hiện 2 phát hiện (CRITICAL lỗi bất thường + WARNING file mất)', async () => {
      await page.evaluate(() => {
        window.__systemAuditMock.scanResult = {
          at: new Date().toISOString(),
          findings: [
            { type: 'ABNORMAL_ERROR_RATE', severity: 'CRITICAL', scopeLabel: 'Nhật Ký Lỗi Hệ Thống (ErrorLogs)', reason: 'Hôm nay 80 lỗi, trung bình 7 ngày trước 2 lỗi/ngày.' },
            { type: 'MISSING_FILE', severity: 'WARNING', scopeLabel: 'docs — #5', reason: 'Tham chiếu file "/uploads/abc.pdf" nhưng không còn tồn tại.' }
          ]
        };
      });
      await page.evaluate(() => runSystemAuditScan());
      const result = await page.evaluate(() => ({
        total: document.getElementById('systemAuditTotalCount').innerText,
        critical: document.getElementById('systemAuditCriticalCount').innerText,
        warning: document.getElementById('systemAuditWarningCount').innerText,
        findingsHtml: document.getElementById('systemAuditFindingsList').innerHTML,
        callCount: window.__systemAuditMock.scanCallCount
      }));
      assertEqual(result.total, '2');
      assertEqual(result.critical, '1');
      assertEqual(result.warning, '1');
      assert(result.findingsHtml.includes('ErrorLogs'), 'phải hiện scopeLabel finding CRITICAL');
      assert(result.findingsHtml.includes('docs — #5'), 'phải hiện scopeLabel finding WARNING');
      assertEqual(result.callCount, 1);
    });

    await run.run('[Hệ Thống] Quét lại 0 phát hiện -> thông báo "Không phát hiện nào"', async () => {
      await page.evaluate(() => { window.__systemAuditMock.scanResult = { at: new Date().toISOString(), findings: [] }; });
      await page.evaluate(() => runSystemAuditScan());
      const html = await page.evaluate(() => document.getElementById('systemAuditFindingsList').innerHTML);
      assert(html.includes('Không phát hiện'), 'phải hiện thông báo không có phát hiện');
    });

    await run.run('[Hệ Thống] Tick tắt auto-scan -> POST đúng autoScanEmailEnabled=false, giữ ccEmails', async () => {
      await page.evaluate(() => {
        window.__systemAuditMock.config = { autoScanEmailEnabled: true, ccEmails: ['sys@test.com'] };
        window.__systemAuditMock.configPostCalls = [];
        document.getElementById('systemAuditAutoScanToggle').checked = false;
        toggleSystemAuditAutoScan();
      });
      await page.waitForTimeout(100);
      const calls = await page.evaluate(() => window.__systemAuditMock.configPostCalls);
      assertEqual(calls.length, 1);
      assertEqual(calls[0].autoScanEmailEnabled, false);
      assert(calls[0].ccEmails.includes('sys@test.com'));
    });

    await run.run('[Hệ Thống] Không phải admin (403) -> ẩn hẳn panel', async () => {
      await page.evaluate(() => { window.__systemAuditMock.forbidden = true; });
      await page.evaluate(() => renderSystemAuditPanel());
      const hidden = await page.evaluate(() => document.getElementById('adminSubAuditSystem').classList.contains('hidden'));
      assertEqual(hidden, true);
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
