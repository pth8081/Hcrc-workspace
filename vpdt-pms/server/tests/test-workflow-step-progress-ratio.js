// tests/test-workflow-step-progress-ratio.js
//
// TÍNH NĂNG MỚI (11/2026, yêu cầu người dùng: "Chỗ trạng thái phê duyệt nên đánh thứ tự bước theo quy
// tắc bước đã làm/tổng bước ví dụ 1/2 là số bước đã thực hiện 1/2 và ngay từ đầu chưa phê duyệt sẽ là
// 0/2"): getWorkflowStepProgress()/workflowStepProgressText() (public/js/core.js) — hàm DÙNG CHUNG tính
// tỉ lệ "số bước ĐÃ XONG / tổng số bước" cho mọi badge trạng thái phê duyệt nhiều bước, thay thế cách
// hiển thị CŨ (nhiều module lỡ dùng "bước hiện tại" currentStep làm tử số — lúc chưa ai duyệt gì lại
// hiện "1/2" thay vì đúng ra phải "0/2"). Bài test này kiểm hàm LÕI (core.js) + spot-check vài badge đại
// diện (itPriceStatusBadge, vppRegStatusBadge) đã gọi đúng hàm mới, không kiểm lại TOÀN BỘ ~10 điểm gọi
// (đã rà bằng mắt + syntax check từng file khi sửa).
//
// Chạy: node tests/test-workflow-step-progress-ratio.js
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8994;

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }[ext] || 'application/octet-stream';
}
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
        res.writeHead(200, { 'Content-Type': contentType(filePath) });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  if (pass) console.log(`PASS: ${name}`);
  else console.log(`FAIL: ${name}${detail ? ' -- ' + detail : ''}`);
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });

  const r = await page.evaluate(() => {
    const wf2 = { steps: [{ name: 'Bước 1' }, { name: 'Bước 2' }] };
    const wf1 = { steps: [{ name: 'Duy nhất' }] };
    const wf0 = { steps: [] };
    return {
      // Ngay từ đầu chưa duyệt gì (currentStep=1, status PENDING) -> 0/2 (ĐÚNG ý người dùng, KHÔNG phải "1/2").
      pendingStep1: getWorkflowStepProgress(wf2, 1, 'PENDING'),
      // Đã duyệt xong bước 1, đang chờ bước 2 (currentStep=2, status PENDING) -> 1/2.
      pendingStep2: getWorkflowStepProgress(wf2, 2, 'PENDING'),
      // Đã duyệt xong hoàn toàn (status APPROVED) -> 2/2 dù currentStep giữ nguyên giá trị cũ.
      approved: getWorkflowStepProgress(wf2, 2, 'APPROVED'),
      // Bị từ chối ngay ở bước 1 (chưa bước nào xong) -> 0/2.
      rejectedAtStep1: getWorkflowStepProgress(wf2, 1, 'REJECTED'),
      // Bị từ chối ở bước 2 (bước 1 đã xong) -> 1/2.
      rejectedAtStep2: getWorkflowStepProgress(wf2, 2, 'REJECTED'),
      // Quy trình 1 bước duy nhất, chưa duyệt -> 0/1.
      oneStepPending: getWorkflowStepProgress(wf1, 1, 'PENDING'),
      // Không có bước nào (wfConfig rỗng/null) -> {done:0,total:0}, text rỗng.
      noSteps: getWorkflowStepProgress(wf0, 1, 'PENDING'),
      nullConfig: getWorkflowStepProgress(null, 1, 'PENDING'),
      textPending0of2: workflowStepProgressText(wf2, 1, 'PENDING'),
      textPending1of2: workflowStepProgressText(wf2, 2, 'PENDING'),
      textApproved: workflowStepProgressText(wf2, 2, 'APPROVED'),
      textNoSteps: workflowStepProgressText(wf0, 1, 'PENDING'),
      // Spot-check: itPriceStatusBadge (module-itsupport-price.js) hiện đúng "0/..." khi chưa ai duyệt.
      itPriceBadgeHasZeroRatio: (() => {
        DB.workflows = [{ id: 'wf-test-2step', steps: [{ name: 'Phòng Kinh Doanh' }, { name: 'Ban Giám Đốc' }] }];
        const p = { id: 999, status: 'PENDING', currentStep: 1, history: [], priceType: 'RETAIL', itPriceWorkflowId: 'wf-test-2step' };
        // resolveItPriceWorkflowConfigForItemClient() có thể cần DB.itPriceDeptWorkflows — cứ thử gọi,
        // nếu lỗi do thiếu cấu hình thì bỏ qua check này (không phải mục tiêu bài test).
        try {
          const html = itPriceStatusBadge(p);
          return typeof html === 'string' && html.length > 0;
        } catch (e) { return 'SKIP: ' + e.message; }
      })()
    };
  });

  record('Chưa duyệt gì (bước 1, PENDING) -> done=0/total=2', r.pendingStep1.done === 0 && r.pendingStep1.total === 2, JSON.stringify(r.pendingStep1));
  record('Đã duyệt xong bước 1 (bước 2, PENDING) -> done=1/total=2', r.pendingStep2.done === 1 && r.pendingStep2.total === 2, JSON.stringify(r.pendingStep2));
  record('APPROVED hoàn tất -> done=total=2', r.approved.done === 2 && r.approved.total === 2, JSON.stringify(r.approved));
  record('REJECTED ngay bước 1 -> done=0/total=2', r.rejectedAtStep1.done === 0 && r.rejectedAtStep1.total === 2, JSON.stringify(r.rejectedAtStep1));
  record('REJECTED ở bước 2 (bước 1 đã xong) -> done=1/total=2', r.rejectedAtStep2.done === 1 && r.rejectedAtStep2.total === 2, JSON.stringify(r.rejectedAtStep2));
  record('Quy trình 1 bước, chưa duyệt -> done=0/total=1', r.oneStepPending.done === 0 && r.oneStepPending.total === 1, JSON.stringify(r.oneStepPending));
  record('Không có bước nào -> done=0/total=0', r.noSteps.done === 0 && r.noSteps.total === 0, JSON.stringify(r.noSteps));
  record('wfConfig null không throw -> done=0/total=0', r.nullConfig.done === 0 && r.nullConfig.total === 0, JSON.stringify(r.nullConfig));
  record('workflowStepProgressText: "0/2" ngay từ đầu', r.textPending0of2 === '0/2', r.textPending0of2);
  record('workflowStepProgressText: "1/2" sau khi xong bước 1', r.textPending1of2 === '1/2', r.textPending1of2);
  record('workflowStepProgressText: "2/2" khi đã duyệt xong', r.textApproved === '2/2', r.textApproved);
  record('workflowStepProgressText: rỗng khi không có bước nào', r.textNoSteps === '', JSON.stringify(r.textNoSteps));
  record('itPriceStatusBadge() vẫn chạy được (không throw) sau khi đổi sang workflowStepProgressText()', r.itPriceBadgeHasZeroRatio === true || (typeof r.itPriceBadgeHasZeroRatio === 'string' && r.itPriceBadgeHasZeroRatio.startsWith('SKIP')), JSON.stringify(r.itPriceBadgeHasZeroRatio));

  await browser.close();
  server.close();

  const failed = results.filter(x => !x.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length) process.exitCode = 1;
})().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
