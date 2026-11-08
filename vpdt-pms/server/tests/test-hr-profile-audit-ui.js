// server/tests/test-hr-profile-audit-ui.js
//
// Regression UI (Playwright thật) cho "🔍 Audit Nhân Sự" (module con MỚI của Nhân Sự, 11/2026) —
// renderHrProfileAuditPanel()/runHrProfileAuditScan()/toggleHrProfileAuditAutoScan()/
// saveHrProfileAuditThresholds() (module-hraudit.js). CÙNG kỹ thuật test-user-system-audit-ui.js: bọc
// THÊM window.fetch sau launchPage() để tự trả lời route mới, không đụng testHarness.js dùng chung.
// KHÁC 3 audit admin-only: test với tài khoản CHỈ có hrReportView (không phải admin) để xác nhận đúng
// yêu cầu người dùng "nhân sự sẽ được phân quyền chứ admin không phân quyền đâu".
//
// Chạy: node server/tests/test-hr-profile-audit-ui.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual, assert } = require('./testHarness');

const PORT_UI = 8997;

async function main() {
  const HR_USER = { username: 'hrviewer', name: 'Nhân Viên Nhân Sự Test', dept: 'Phòng Nhân Sự', perms: { hrReportView: true }, totpEnabled: false, active: true };

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({ users: [HR_USER] });
  const { browser, page } = await launchPage(PORT_UI, state);
  const run = createRunner();

  await page.evaluate(() => {
    window.__hrAuditMock = {
      summary: { at: null, total: 0, critical: 0, warning: 0 },
      config: { autoScanEmailEnabled: true, ccEmails: [], draftStaleDaysThreshold: 30, contractExpirySoonDays: 30 },
      scanResult: { at: new Date().toISOString(), findings: [] },
      forbidden: false, scanCallCount: 0, configPostCalls: []
    };
    const originalFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const m = window.__hrAuditMock;
      const prefix = '/api/hr/profile-audit';
      if (url === `${prefix}/summary` && method === 'GET') {
        if (m.forbidden) return { ok: false, status: 403, json: async () => ({ error: 'Bạn không có quyền xem Audit Nhân Sự' }) };
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
      return originalFetch(url, opts);
    };
  });

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, HR_USER);

    await run.run('Tài khoản chỉ có hrReportView -> nút sidebar "Audit Nhân Sự" hiện ra (không bắt buộc admin)', async () => {
      const hidden = await page.evaluate(() => document.getElementById('btnHrAuditNav').classList.contains('hidden'));
      assertEqual(hidden, false, 'Nút điều hướng phải hiện cho người có hrReportView');
    });

    await page.evaluate(() => { switchTab('hrAudit'); });
    await page.waitForTimeout(150);

    await run.run('Vào tab hrAudit -> load cache tóm tắt + cấu hình (chưa quét, ngưỡng mặc định 30 ngày)', async () => {
      const result = await page.evaluate(() => ({
        sectionHidden: document.getElementById('hrAuditSection').classList.contains('hidden'),
        lastScanText: document.getElementById('hrAuditLastScan').innerText,
        summaryRowHidden: document.getElementById('hrAuditSummaryRow').classList.contains('hidden'),
        toggleChecked: document.getElementById('hrAuditAutoScanToggle').checked,
        draftDaysValue: document.getElementById('hrAuditDraftStaleDays').value,
        expiryDaysValue: document.getElementById('hrAuditExpirySoonDays').value
      }));
      assertEqual(result.sectionHidden, false, 'Section phải hiện cho người có quyền HR');
      assert(result.lastScanText.includes('Chưa quét lần nào'), `phải báo chưa quét, thực tế "${result.lastScanText}"`);
      assertEqual(result.summaryRowHidden, true, 'Chưa quét -> ẩn hàng tóm tắt');
      assertEqual(result.toggleChecked, true, 'Toggle phải khớp cấu hình mock (true)');
      assertEqual(result.draftDaysValue, '30');
      assertEqual(result.expiryDaysValue, '30');
    });

    await run.run('Bấm "Quét Ngay" -> hiện đủ 2 phát hiện (CRITICAL + WARNING), đúng badge + employeeCode/name', async () => {
      await page.evaluate(() => {
        window.__hrAuditMock.scanResult = {
          at: new Date().toISOString(),
          findings: [
            { type: 'NO_ACTIVE_CONTRACT', severity: 'CRITICAL', employeeCode: 'BL0099', name: 'Nguyễn Văn A', reason: 'Không có hợp đồng nào đang hiệu lực.' },
            { type: 'STALE_DRAFT_PROFILE', severity: 'WARNING', employeeCode: 'BL0100', name: 'Trần Thị B', reason: 'Hồ sơ Nháp tồn đọng 45 ngày.' }
          ]
        };
      });
      await page.evaluate(() => runHrProfileAuditScan());
      const result = await page.evaluate(() => ({
        total: document.getElementById('hrAuditTotalCount').innerText,
        critical: document.getElementById('hrAuditCriticalCount').innerText,
        warning: document.getElementById('hrAuditWarningCount').innerText,
        findingsHtml: document.getElementById('hrAuditFindingsList').innerHTML,
        callCount: window.__hrAuditMock.scanCallCount
      }));
      assertEqual(result.total, '2');
      assertEqual(result.critical, '1');
      assertEqual(result.warning, '1');
      assert(result.findingsHtml.includes('BL0099') && result.findingsHtml.includes('Nguyễn Văn A'), 'phải hiện employeeCode + tên finding CRITICAL');
      assert(result.findingsHtml.includes('NGHIÊM TRỌNG') && result.findingsHtml.includes('CẢNH BÁO'), 'phải có đủ 2 badge mức độ');
      assertEqual(result.callCount, 1, 'phải gọi đúng 1 lần route quét');
    });

    await run.run('Quét lại 0 phát hiện -> thông báo "Không phát hiện nào"', async () => {
      await page.evaluate(() => { window.__hrAuditMock.scanResult = { at: new Date().toISOString(), findings: [] }; });
      await page.evaluate(() => runHrProfileAuditScan());
      const html = await page.evaluate(() => document.getElementById('hrAuditFindingsList').innerHTML);
      assert(html.includes('Không phát hiện'), 'phải hiện thông báo không có phát hiện');
    });

    await run.run('Tick tắt auto-scan -> POST đúng autoScanEmailEnabled=false, GIỮ ccEmails/2 ngưỡng cũ', async () => {
      await page.evaluate(() => {
        window.__hrAuditMock.config = { autoScanEmailEnabled: true, ccEmails: ['giu-nguyen@test.com'], draftStaleDaysThreshold: 45, contractExpirySoonDays: 20 };
        window.__hrAuditMock.configPostCalls = [];
        document.getElementById('hrAuditAutoScanToggle').checked = false;
        toggleHrProfileAuditAutoScan();
      });
      await page.waitForTimeout(100);
      const calls = await page.evaluate(() => window.__hrAuditMock.configPostCalls);
      assertEqual(calls.length, 1);
      assertEqual(calls[0].autoScanEmailEnabled, false);
      assert(calls[0].ccEmails.includes('giu-nguyen@test.com'), 'phải giữ nguyên ccEmails cũ');
      assertEqual(calls[0].draftStaleDaysThreshold, 45, 'phải giữ nguyên ngưỡng Nháp cũ');
      assertEqual(calls[0].contractExpirySoonDays, 20, 'phải giữ nguyên ngưỡng sắp hết hạn cũ');
    });

    await run.run('Đổi 2 ngưỡng ngày -> POST đúng giá trị mới, GIỮ autoScanEmailEnabled/ccEmails cũ', async () => {
      await page.evaluate(() => {
        window.__hrAuditMock.config = { autoScanEmailEnabled: false, ccEmails: ['a@test.com'], draftStaleDaysThreshold: 30, contractExpirySoonDays: 30 };
        window.__hrAuditMock.configPostCalls = [];
        document.getElementById('hrAuditDraftStaleDays').value = '60';
        document.getElementById('hrAuditExpirySoonDays').value = '15';
        saveHrProfileAuditThresholds();
      });
      await page.waitForTimeout(100);
      const calls = await page.evaluate(() => window.__hrAuditMock.configPostCalls);
      assertEqual(calls.length, 1);
      assertEqual(calls[0].draftStaleDaysThreshold, 60);
      assertEqual(calls[0].contractExpirySoonDays, 15);
      assertEqual(calls[0].autoScanEmailEnabled, false, 'phải giữ nguyên giá trị cũ (false)');
    });

    await run.run('Không có quyền (403) -> hiện thông báo không có quyền, không crash', async () => {
      await page.evaluate(() => { window.__hrAuditMock.forbidden = true; });
      await page.evaluate(() => renderHrProfileAuditPanel());
      const text = await page.evaluate(() => document.getElementById('hrAuditSection').innerText);
      assert(text.includes('không có quyền'), 'phải hiện thông báo không có quyền');
      await page.evaluate(() => { window.__hrAuditMock.forbidden = false; });
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
