'use strict';
// Demo cho phần mở rộng BAS (10/2026, mirror file "Điều Khoản Thương Mại/Tính BAS" người dùng cung cấp)
// — module "🛒 Mua Hàng" > BAS: GROWTH_REBATE đã hỗ trợ tính tự động, FIXED_LUMP_SUM + phân bổ đa pháp
// nhân, cờ includedInBas, 4 báo cáo mới (Tổng Hợp Theo NCC/Đạt Bậc Thang/So Sánh Kỳ + cột mới ở Chi Tiết
// Điều Khoản). Cùng khuôn harness tests/demo-muahang-module.js (serve public/index.html tĩnh + mock
// window.fetch đúng route routes/purchasing.js) nhưng mock /terms/:id/calculate trả về số liệu KHÁC NHAU
// theo từng loại điều khoản để minh hoạ đúng 4 báo cáo mới — logic tính THẬT đã có test riêng thuần
// (tests/test-vendorrebate-bas-extension-10-2026.js), demo này chỉ minh hoạ UI/báo cáo render đúng.
//
// calculateMhTerm() dùng showConfirmModal() (không còn window.prompt(), xem Gap 17 đang xử lý riêng) —
// demo này lái đúng modal thật: gọi calculateMhTerm() mở modal, gán giá trị 2 input ngày, rồi gọi
// runConfirmedAction() để xác nhận (mirror đúng cách người dùng bấm nút "Tính Ước Tính" trên modal).
//
// Run: node server/tests/demo-muahang-bas-extension-10-2026.js
// Ảnh chụp: server/tests/.tmp-assets/muahang-bas-ext-*.png (gitignored)

const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8969;
const SHOT_DIR = path.join(__dirname, '.tmp-assets');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let results;
  let jsErrors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
    page.on('pageerror', (e) => jsErrors.push(String(e)));

    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
    await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

    results = await page.evaluate(async () => {
      const results = [];
      function check(name, cond, detail) { results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') }); }
      window.alert = () => {};
      window.confirm = () => true;

      let nextId = 9000;
      const mock = { vendors: [], terms: [], calcs: [] };
      window.fetch = async (url, opts = {}) => {
        const method = opts.method || 'GET';
        let body = {};
        if (typeof opts.body === 'string') { try { body = JSON.parse(opts.body); } catch (e) {} }
        const ok = (item) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify({ ok: true, ...item })) });

        if (url === '/api/purchasing/vendors' && method === 'GET') return ok({ items: mock.vendors });
        if (url === '/api/purchasing/terms' && method === 'GET') return ok({ items: mock.terms });
        if (url === '/api/purchasing/calculations' && method === 'GET') return ok({ items: mock.calcs });
        if (url === '/api/purchasing/sync-logs' && method === 'GET') return ok({ items: [] });
        if (url === '/api/create/vendors' && method === 'POST') {
          const item = { id: nextId++, status: 'ACTIVE', ...body };
          mock.vendors.unshift(item);
          return ok({ item });
        }
        if (url === '/api/create/rebateTerms' && method === 'POST') {
          const item = { id: nextId++, status: 'DRAFT', version: 1, clonedFromTermId: null, history: [], ...body };
          mock.terms.unshift(item);
          return ok({ item });
        }
        let m = url.match(/^\/api\/purchasing\/terms\/(\d+)\/(edit|activate|calculate)$/);
        if (m && method === 'POST') {
          const t = mock.terms.find(x => x.id === Number(m[1]));
          if (!t) return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
          if (m[2] === 'edit') Object.assign(t, body);
          if (m[2] === 'activate') t.status = 'ACTIVE';
          if (m[2] === 'calculate') {
            const priorCalcs = mock.calcs.filter(c => c.termId === t.id).length;
            let basisAmount, rebateAmount, breakdown, entityAllocation = null;
            if (t.termType === 'GROWTH_REBATE') {
              basisAmount = 700000000;
              const growthPct = priorCalcs === 0 ? 12 : 25;
              const achievedRatePct = growthPct >= 20 ? 2 : (growthPct >= 10 ? 1 : 0);
              rebateAmount = basisAmount * achievedRatePct / 100;
              breakdown = [{ prevBasisAmount: 600000000, growthPct, achievedRatePct }];
            } else if ((t.amountMode || 'PERCENT_TIERED') === 'FIXED_LUMP_SUM') {
              basisAmount = 0;
              rebateAmount = Number(t.fixedAmount) || 0;
              entityAllocation = (t.allocationEntities || []).map((entity, idx) => {
                const ratio = idx === 0 ? 0.62 : 0.38;
                return { entity, purchaseAmount: null, ratio, allocatedAmount: rebateAmount * ratio };
              });
              breakdown = [{ fixedAmount: rebateAmount, entityAllocation }];
            } else {
              basisAmount = priorCalcs === 0 ? 650000000 : 950000000;
              rebateAmount = priorCalcs === 0 ? 13000000 : 24500000;
              breakdown = [];
            }
            const calc = {
              id: nextId++, termId: t.id, vendorId: t.vendorId, termCode: t.termCode,
              vendorCode: (mock.vendors.find(v => v.id === t.vendorId) || {}).vendorCode,
              periodStart: body.periodStart, periodEnd: body.periodEnd,
              basisAmount, rebateAmount, breakdown, entityAllocation,
              calculatedBy: 'admin', calculatedByName: 'Quản Trị Viên'
            };
            mock.calcs.unshift(calc);
            return ok({ item: calc });
          }
          return ok({ item: t });
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      };

      Object.assign(DB, { depts: ['Phòng Mua Hàng'], cats: [], stores: [], jobTitles: [], deptAbbrs: {}, workflows: [], deptWorkflows: {}, permGroups: [] });
      const adminUser = {
        username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng Mua Hàng', role: 'admin',
        jobTitle: 'Trưởng Phòng', email: 'admin@hcrc.vn', phone: '0900000001', perms: { admin: true }
      };
      DB.users = [adminUser];
      finishLogin(adminUser);
      switchTab('muaHang');
      await new Promise(r => setTimeout(r, 30));

      // ---- Vendor ----
      openMhVendorForm();
      document.getElementById('mhVendorCode').value = 'PNG-BAS';
      document.getElementById('mhVendorName').value = 'Công Ty P&G Việt Nam';
      await submitMhVendorForm({ preventDefault() {} });
      check('Tạo NCC demo', mock.vendors.length === 1);
      const vendorId = mock.vendors[0].id;
      setMhBasSubTab('TERM');

      // ---- Term 1: VOLUME_REBATE (bậc thang doanh số, cho Đạt Bậc Thang + So Sánh Kỳ) ----
      openMhTermForm();
      document.getElementById('mhTermVendorId').value = String(vendorId);
      document.getElementById('mhTermCode').value = 'DK-DS-2026';
      document.getElementById('mhTermName').value = 'Chiết khấu theo doanh số';
      document.getElementById('mhTermFrom').value = '2026-01-01';
      mhTierRows = [{ fromAmount: '0', ratePct: '0' }, { fromAmount: '600000000', ratePct: '1.5' }, { fromAmount: '900000000', ratePct: '2.5' }];
      mhRenderTierRows();
      await submitMhTermForm({ preventDefault() {} });
      const termVolumeId = mock.terms.find(t => t.termCode === 'DK-DS-2026').id;

      // ---- Term 2: GROWTH_REBATE (nay đã hỗ trợ, bậc thang mang nghĩa % tăng trưởng) ----
      openMhTermForm();
      document.getElementById('mhTermVendorId').value = String(vendorId);
      document.getElementById('mhTermCode').value = 'DK-TANGTRUONG-2026';
      document.getElementById('mhTermName').value = 'Chiết khấu theo tăng trưởng';
      document.getElementById('mhTermType').value = 'GROWTH_REBATE';
      document.getElementById('mhTermFrom').value = '2026-01-01';
      mhTierRows = [{ fromAmount: '0', ratePct: '0' }, { fromAmount: '10', ratePct: '1' }, { fromAmount: '20', ratePct: '2' }];
      mhRenderTierRows();
      check('Dropdown Loại Điều Khoản cho chọn GROWTH_REBATE (không còn disabled)',
        document.getElementById('mhTermType').value === 'GROWTH_REBATE');

      window.__mhTestState = { results, check, mock, vendorId, termVolumeId, stage: 'before-growth-submit' };
      return { results, screenshotNow: 'muahang-bas-ext-1-growth-term-form.png' };
    });
    if (results.screenshotNow) await page.screenshot({ path: path.join(SHOT_DIR, results.screenshotNow), fullPage: true }).catch(() => {});

    results = await page.evaluate(async () => {
      const { results, check, mock, vendorId, termVolumeId } = window.__mhTestState;
      await submitMhTermForm({ preventDefault() {} });
      const termGrowthId = mock.terms.find(t => t.termCode === 'DK-TANGTRUONG-2026').id;

      // ---- Term 3: FIXED_LUMP_SUM + phân bổ theo tỷ trọng đa pháp nhân (mirror "Phí tạo mã mới") ----
      openMhTermForm();
      document.getElementById('mhTermVendorId').value = String(vendorId);
      document.getElementById('mhTermCode').value = 'DK-PHITAOMA-2026';
      document.getElementById('mhTermName').value = 'Phí tạo mã mới';
      document.getElementById('mhTermType').value = 'LISTING_FEE';
      document.getElementById('mhTermFrom').value = '2026-01-01';
      document.getElementById('mhTermAmountMode').value = 'FIXED_LUMP_SUM';
      mhOnTermAmountModeChange();
      document.getElementById('mhTermFixedAmount').value = '50.000.000';
      document.getElementById('mhTermAllocationMode').value = 'PRORATA_BY_ENTITY';
      mhOnTermAllocationModeChange();
      document.getElementById('mhTermAllocationEntities').value = 'BRG,FUJI';
      document.getElementById('mhTermIncludedInBas').checked = true;
      check('Chọn FIXED_LUMP_SUM -> ẩn khối Bậc Thang, hiện khối Số Tiền Cố Định',
        document.getElementById('mhTiersSectionWrap').classList.contains('hidden') &&
        !document.getElementById('mhFixedAmountSectionWrap').classList.contains('hidden'));
      check('Chọn PRORATA_BY_ENTITY -> hiện ô Danh Sách Pháp Nhân',
        !document.getElementById('mhAllocationEntitiesWrap').classList.contains('hidden'));

      window.__mhTestState = { results, check, mock, vendorId, termVolumeId, termGrowthId };
      return { results, screenshotNow: 'muahang-bas-ext-2-fixed-lumpsum-term-form.png' };
    });
    if (results.screenshotNow) await page.screenshot({ path: path.join(SHOT_DIR, results.screenshotNow), fullPage: true }).catch(() => {});

    results = await page.evaluate(async () => {
      const { results, check, mock, vendorId, termVolumeId, termGrowthId } = window.__mhTestState;
      await submitMhTermForm({ preventDefault() {} });
      const termFixedId = mock.terms.find(t => t.termCode === 'DK-PHITAOMA-2026').id;
      check('Điều khoản FIXED_LUMP_SUM lưu đúng allocationEntities 2 pháp nhân',
        JSON.stringify(mock.terms.find(t => t.id === termFixedId).allocationEntities) === JSON.stringify(['BRG', 'FUJI']));

      // ---- Kích hoạt cả 3 điều khoản ----
      await activateMhTerm(termVolumeId);
      await activateMhTerm(termGrowthId);
      await activateMhTerm(termFixedId);
      check('Cả 3 điều khoản đã ACTIVE', mock.terms.every(t => t.status === 'ACTIVE'));

      window.__demoDoCalculate = async (id, from, to) => {
        calculateMhTerm(id);
        document.getElementById('mhCalcPeriodStart').value = from;
        document.getElementById('mhCalcPeriodEnd').value = to;
        runConfirmedAction();
        await new Promise(r => setTimeout(r, 20));
      };
      // 2 lượt tính cho điều khoản doanh số + tăng trưởng (phục vụ "So Sánh Kỳ"/"Đạt Bậc Thang")
      await window.__demoDoCalculate(termVolumeId, '2026-01-01', '2026-01-31');
      await window.__demoDoCalculate(termVolumeId, '2026-02-01', '2026-02-28');
      await window.__demoDoCalculate(termGrowthId, '2026-01-01', '2026-01-31');
      await window.__demoDoCalculate(termGrowthId, '2026-02-01', '2026-02-28');
      await window.__demoDoCalculate(termFixedId, '2026-01-01', '2026-01-31');
      check('Đã có đủ lượt tính (5) cho 3 điều khoản', mock.calcs.length === 5, mock.calcs.length);

      setPurchasingSubTab('REPORT');
      await new Promise(r => setTimeout(r, 30));

      check('Chi Tiết Điều Khoản NCC: hiện cột Loại/Phương Thức/Tính BAS',
        document.getElementById('mhReportTableWrap').innerHTML.includes('LISTING_FEE') &&
        document.getElementById('mhReportTableWrap').innerHTML.includes('Số Tiền Cố Định'));
      check('Tổng Hợp BAS Theo NCC Theo Kỳ: có dữ liệu',
        document.getElementById('mhReportByVendorWrap').innerHTML.includes('PNG-BAS'));
      check('Đạt Bậc Thang: hiện cả điều khoản doanh số lẫn tăng trưởng',
        document.getElementById('mhReportTierWrap').innerHTML.includes('DK-DS-2026') &&
        document.getElementById('mhReportTierWrap').innerHTML.includes('DK-TANGTRUONG-2026'));
      check('So Sánh Kỳ: hiện chênh lệch giữa 2 lượt tính',
        document.getElementById('mhReportTrendWrap').innerHTML.includes('DK-DS-2026'));

      return { results, screenshotNow: 'muahang-bas-ext-3-report-tab.png' };
    });
    if (results.screenshotNow) await page.screenshot({ path: path.join(SHOT_DIR, results.screenshotNow), fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.results.filter(r => !r.pass);
  results.results.forEach(r => console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
  if (jsErrors.length) console.log('JS errors (uncaught exceptions):', jsErrors);
  console.log(`\n${results.results.length - failed.length}/${results.results.length} passed.`);
  if (failed.length || jsErrors.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
