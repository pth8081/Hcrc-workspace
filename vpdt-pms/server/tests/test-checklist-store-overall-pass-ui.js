// server/tests/test-checklist-store-overall-pass-ui.js
//
// Regression test UI (Chromium thật mở public/index.html + public/js/*.js thật) cho khối MỚI "📋 Đạt
// Chung Theo Siêu Thị" ở tab Báo Cáo > Checklist Siêu Thị/Cửa Hàng (10/2026, yêu cầu người dùng): siêu
// thị làm bao nhiêu mẫu STORE_SELF tuỳ ý trong kỳ, "Đạt" tính trên SỐ MẪU ĐÃ HOÀN THÀNH — KHÔNG phải
// tổng số mẫu đang có. Test phần logic thuần (computeChecklistStoreOverallPass) đã có riêng ở
// tests/test-checklist-store-overall-pass.js — bài này CHỈ xác minh lớp render DOM + hành vi quan trọng
// nhất dễ bị vỡ: bộ lọc "Mẫu Checklist" (chỉ 1 mẫu cụ thể) KHÔNG được ảnh hưởng tới khối Đạt Chung (mục
// đích của khối này là gộp NHIỀU mẫu của CÙNG 1 siêu thị, nên phải luôn tính trên TOÀN BỘ mẫu bất kể bộ
// lọc "Mẫu Checklist" đang chọn gì).
//
// Chạy: node server/tests/test-checklist-store-overall-pass-ui.js
'use strict';
const {
  startStaticServer, createMockState, launchPage, createRunner, assertEqual, assertIncludes
} = require('./testHarness');

const PORT = 8988;

const REPORTER = { username: 'bc3', name: 'Người Xem Báo Cáo 3', dept: 'Phòng Vận Hành', perms: { checklistReportView: true }, active: true };

const TEMPLATE_1 = { id: 701, templateCode: 'CL_1', templateName: 'Checklist Vệ Sinh', templateType: 'STORE_SELF', templateKind: 'QA', status: 'ACTIVE' };
const TEMPLATE_2 = { id: 702, templateCode: 'CL_2', templateName: 'Checklist An Toàn', templateType: 'STORE_SELF', templateKind: 'QA', status: 'ACTIVE' };

const SUBMISSIONS = [
  // Siêu thị A: hoàn thành CẢ 2 mẫu, cả 2 Đạt -> Đạt Chung
  { id: 1, templateId: 701, storeCode: 'Siêu thị A', status: 'SUBMITTED', isPassed: true, submittedAt: '08:00:00 5/9/2026', submittedByUsername: 'nv_a', submittedByName: 'NV A' },
  { id: 2, templateId: 702, storeCode: 'Siêu thị A', status: 'SUBMITTED', isPassed: true, submittedAt: '09:00:00 5/9/2026', submittedByUsername: 'nv_a', submittedByName: 'NV A' },
  // Siêu thị B: CHỈ hoàn thành 1 mẫu (701), Đạt -> vẫn phải tính Đạt Chung (không bị phạt vì thiếu mẫu 702)
  { id: 3, templateId: 701, storeCode: 'Siêu thị B', status: 'SUBMITTED', isPassed: true, submittedAt: '08:00:00 6/9/2026', submittedByUsername: 'nv_b', submittedByName: 'NV B' },
  // Siêu thị C: hoàn thành 2 mẫu, 1 KHÔNG đạt -> Chưa đạt
  { id: 4, templateId: 701, storeCode: 'Siêu thị C', status: 'SUBMITTED', isPassed: true, submittedAt: '08:00:00 6/9/2026', submittedByUsername: 'nv_c', submittedByName: 'NV C' },
  { id: 5, templateId: 702, storeCode: 'Siêu thị C', status: 'SUBMITTED', isPassed: false, submittedAt: '09:00:00 6/9/2026', submittedByUsername: 'nv_c', submittedByName: 'NV C' }
];

const state = createMockState({
  depts: ['Phòng Vận Hành'], stores: ['Siêu thị A', 'Siêu thị B', 'Siêu thị C'],
  users: [REPORTER], checklistTemplates: [TEMPLATE_1, TEMPLATE_2], checklistSubmissions: SUBMISSIONS
});

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err && err.stack || String(err)));

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, REPORTER);
    await page.evaluate(() => { switchTab('checklist'); setChecklistSubTab('REPORT'); });

    await run.run('Khối "Đạt Chung Theo Siêu Thị" render đúng 3 dòng khi bộ lọc "Tất cả" (không chọn mẫu cụ thể)', async () => {
      const html = await page.evaluate(() => document.getElementById('checklistReportStoreOverallWrap').innerHTML);
      assertIncludes(html, 'Siêu thị A');
      assertIncludes(html, 'Siêu thị B');
      assertIncludes(html, 'Siêu thị C');
      assertIncludes(html, '2/3', 'Phải hiện đúng 2/3 siêu thị Đạt Chung (A và B đạt, C chưa đạt)');
    });

    await run.run('Siêu thị B CHỈ hoàn thành 1/2 mẫu nhưng Đạt -> vẫn phải tính "Đạt Chung" (không bị phạt vì thiếu mẫu còn lại)', async () => {
      const rowText = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#checklistReportStoreOverallWrap tbody tr')];
        const row = rows.find(r => r.textContent.includes('Siêu thị B'));
        return row ? row.textContent : null;
      });
      assertIncludes(rowText, '✓ Đạt', 'Siêu thị B chỉ làm 1 mẫu (đạt) vẫn phải hiện Đạt Chung');
      assertIncludes(rowText, '100.0%', 'Tỉ lệ phải tính trên 1 mẫu đã hoàn thành (100%), không phải trên 2 mẫu đang có (50%)');
    });

    await run.run('Siêu thị C có 1 mẫu Không đạt -> "Chưa đạt"', async () => {
      const rowText = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#checklistReportStoreOverallWrap tbody tr')];
        const row = rows.find(r => r.textContent.includes('Siêu thị C'));
        return row ? row.textContent : null;
      });
      assertIncludes(rowText, '✗ Chưa đạt');
    });

    await run.run('QUAN TRỌNG: chọn bộ lọc "Mẫu Checklist" = CHỈ 1 mẫu cụ thể -> khối "Đạt Chung" KHÔNG bị ảnh hưởng, vẫn gộp CẢ 2 mẫu', async () => {
      await page.evaluate(() => {
        document.getElementById('checklistReportTemplateFilter').value = '701';
        applyChecklistReportFilter();
      });
      const html = await page.evaluate(() => document.getElementById('checklistReportStoreOverallWrap').innerHTML);
      assertIncludes(html, '2/3', 'Dù bộ lọc đang chọn ĐÚNG 1 mẫu (701), khối Đạt Chung vẫn phải gộp CẢ mẫu 702 — không được lọc theo bộ lọc này');
      const rowTextC = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#checklistReportStoreOverallWrap tbody tr')];
        const row = rows.find(r => r.textContent.includes('Siêu thị C'));
        return row ? row.textContent : null;
      });
      assertIncludes(rowTextC, '✗ Chưa đạt', 'Siêu thị C vẫn phải hiện Chưa đạt (mẫu 702 không đạt) dù bộ lọc đang chỉ chọn mẫu 701');
    });

    await run.run('Không có lỗi JS (pageerror) nào phát sinh trong suốt bài test', () => {
      assertEqual(jsErrors.length, 0, jsErrors.join('\n'));
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
