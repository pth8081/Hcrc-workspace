#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression test: Phân Quyền > các khối "Xem/Tạo mới/Tải Xuống theo phòng ban" (2. Tài Liệu, 3. Văn Bản
// Trình, 4. Hợp Đồng & Giấy Phép, 6. Đăng Ký Xe, 7. Văn Phòng) — đợt 10/2026, đổi từ lưới
// checkbox 2-4 cột hẹp cạnh nhau (mỗi cột LẶP LẠI toàn bộ danh sách phòng ban) sang 1 bảng/khối, MỖI DÒNG
// là 1 phòng ban (tên chỉ hiện 1 lần, đủ rộng không bị "truncate" mất chữ — phản hồi người dùng thật
// 9/2026, ý tưởng người dùng đề xuất trực tiếp: "theo chiều ngang từng dòng").
//
// LƯU Ý (10/2026, "6-module" làm gọn phân quyền): khối "5. Phòng Họp" đã bỏ HẲN bảng phòng ban (gộp
// meetingView+meetingBookScope thành 1 quyền phẳng boolean DUY NHẤT meetingBook, tự khoá đúng phòng ban
// người dùng — KHÔNG còn `pMeetingDeptTableBody`/`pMeetingBookDept_N`/`pMeetingViewDept_N` trong DOM nữa,
// xem systemSection.html "5. Phòng Họp"). Cột "Tạo mới" của khối "4. Hợp Đồng & Giấy Phép" cũng đã gộp
// tương tự thành quyền phẳng contractCreate (`pContractCreate`, KHÔNG còn `pContractCreateDept_N`) — bảng
// pContractDeptTableBody giờ CHỈ còn đúng 1 cột "Tải xuống" (pContractDownload). Cột "Tạo mới" của khối
// "7. Văn Phòng" cũng đã gộp tương tự thành quyền phẳng officeCreate (`pOfficeCreate`, KHÔNG còn
// `pOfficeCreateDept_N`) — bảng pOfficeDeptTableBody giờ CHỈ còn 2 cột "Xem"/"Tải xuống"
// (pOfficeDownload). Cột "Tải Lên" của khối "2. Tài Liệu" cũng đã gộp tương tự thành quyền
// phẳng uploadAll (TÊN GIỮ NGUYÊN, KHÔNG còn `pUploadDept_N`) — bảng pDocDeptTableBody giờ CHỈ còn đúng
// 1 cột "Tải Tài Liệu" (pDocDownload). Các scenario dưới đây đã được cập nhật để KHÔNG còn tham chiếu các
// id/field đã bị gỡ này — thay bằng cột/khối còn giữ bảng phòng ban thật
// (pDocDownload/pContractDownload/pCarDownload/pOfficeDownload).
//
// LƯU Ý TIẾP (10/2026, "Việc D" mở rộng sang Đăng Ký Xe/Văn Phòng): cột "Xem" (pCarView/pOfficeView,
// {all,depts}) của 2 khối "6. Đăng Ký Xe"/"7. Văn Phòng" cũng đã BỊ BỎ HẲN — người tạo/lái xe được gán/
// người duyệt LUÔN xem được mặc định, các trường hợp còn lại cấu hình ở "Phạm Vi Xem Theo Phòng Ban"
// (deptViewScopeConfig) — 2 bảng này giờ CHỈ còn đúng 1 cột "Tải xuống" (pCarDownload/pOfficeDownload),
// cùng khuôn pContractDeptTableBody.
//
// Kiểm tra:
//   1. renderDeptCheckboxes() render đúng 1 <tr> mỗi phòng ban vào tbody của cả 6 khối, tên phòng ban đủ
//      dài KHÔNG bị cắt (không còn class "truncate", text đầy đủ nằm trong DOM).
//   2. Mỗi ô checkbox vẫn giữ ĐÚNG định dạng id cũ (`${prefix}Dept_${idx}`, VD "pUploadDept_0") — không
//      phá vỡ collectPermsFromForm()/populatePermsForm()/toggleScopeGroup() (module-admin-permtree.js)
//      vốn tra theo id pattern, không phụ thuộc cấu trúc DOM cha-con.
//   3. Round-trip THẬT qua UI: tick checkbox trong bảng mới -> collectPermsFromForm() đọc đúng.
//   4. populatePermsForm() đổ dữ liệu cũ lên đúng ô trong bảng mới.
//   5. toggleScopeGroup() (bấm "ALL") vẫn khoá đúng các checkbox phòng ban trong bảng mới.
//   6. computePermTreeNodeCount()/refreshPermTreeBadges() (badge "đã cấp X/Y") đọc ĐÚNG qua
//      data-scope-group (khuôn mới, không còn container DOM riêng bọc 1 cột) — không bị đếm sai/đếm
//      trùng (checkbox phòng ban không được tính là "1 mục" riêng, chỉ gộp vào ALL).
//
// Playwright thật, load thẳng public/index.html thật (KHÔNG mock DOM) — cùng hạ tầng
// tests/test-perm-tree-store-scope-widget.js (markup #permFieldsContainer tĩnh có sẵn, không cần đăng nhập).
//
// Run: node server/tests/test-perm-tree-dept-table.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8996;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.startsWith('/js/') || urlPath.startsWith('/fragments/')) {
        const PUBLIC_DIR = path.join(__dirname, '..', 'public');
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          res.writeHead(200, { 'Content-Type': urlPath.startsWith('/js/') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
          res.end(data);
        });
      }
      fs.readFile(INDEX_HTML_PATH, (err, data) => {
        if (err) { res.writeHead(500); res.end(String(err)); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  if (pass) console.log(`PASS: ${name}`);
  else console.log(`FAIL: ${name}${detail ? ' -- ' + detail : ''}`);
}
async function scenario(name, fn) {
  try {
    await fn();
    record(name, true);
  } catch (e) {
    record(name, false, 'threw: ' + (e && e.message ? e.message : String(e)));
  }
}

const DEPT_NAMES = ['Phòng Nhân Sự & Hành Chính Tổng Hợp Khối Văn Phòng', 'Phòng Kế Toán', 'Phòng IT'];

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));
  await page.waitForTimeout(150);

  await page.evaluate((depts) => { window.DB = window.DB || {}; DB.depts = depts; }, DEPT_NAMES);

  try {
    await scenario('renderDeptCheckboxes() dựng đúng 1 <tr>/phòng ban cho cả 5 bảng còn lại (Phòng Họp đã gộp phẳng, không còn bảng), tên KHÔNG bị cắt (không class truncate)', async () => {
      const r = await page.evaluate((depts) => {
        renderDeptCheckboxes();
        const tbodyIds = ['pDocDeptTableBody', 'pSubDeptTableBody', 'pContractDeptTableBody', 'pCarDeptTableBody', 'pOfficeDeptTableBody'];
        return tbodyIds.map(id => {
          const el = document.getElementById(id);
          if (!el) return { id, missing: true };
          const rows = el.querySelectorAll('tr');
          const hasTruncateClass = !!el.querySelector('.truncate');
          const longNameCellText = rows[0]?.querySelector('td')?.textContent || '';
          return { id, rowCount: rows.length, hasTruncateClass, longNameCellText };
        });
      }, DEPT_NAMES);
      r.forEach(t => {
        if (t.missing) throw new Error(`Thiếu tbody #${t.id}`);
        if (t.rowCount !== DEPT_NAMES.length) throw new Error(`#${t.id}: kỳ vọng ${DEPT_NAMES.length} dòng, được ${t.rowCount}`);
        if (t.hasTruncateClass) throw new Error(`#${t.id}: vẫn còn class "truncate" (chưa giải quyết gốc rễ cắt tên)`);
        if (t.longNameCellText !== DEPT_NAMES[0]) throw new Error(`#${t.id}: tên phòng ban dài bị cắt/sai — được "${t.longNameCellText}"`);
      });
    });

    await scenario('Id checkbox từng dòng vẫn đúng khuôn cũ "${prefix}Dept_${idx}" + có data-scope-group', async () => {
      const r = await page.evaluate(() => ({
        // uploadAll đã gộp phẳng (10/2026, "6-module") — pDocDeptTableBody giờ CHỈ còn cột "Tải Tài
        // Liệu" (pDocDownload), dùng cột đó thay cho pUploadDept_0 đã bị gỡ.
        docDownload0: document.getElementById('pDocDownloadDept_0')?.getAttribute('data-scope-group'),
        // contractCreate đã gộp phẳng (10/2026, "6-module") — pContractDeptTableBody giờ CHỈ còn cột
        // "Tải xuống" (pContractDownload), dùng cột đó thay cho pContractCreateDept_1 đã bị gỡ.
        contractDownload1: document.getElementById('pContractDownloadDept_1')?.getAttribute('data-scope-group'),
        carDownload2: document.getElementById('pCarDownloadDept_2')?.getAttribute('data-scope-group'),
      }));
      if (r.docDownload0 !== 'pDocDownload') throw new Error(`pDocDownloadDept_0 data-scope-group sai: ${r.docDownload0}`);
      if (r.contractDownload1 !== 'pContractDownload') throw new Error(`pContractDownloadDept_1 data-scope-group sai: ${r.contractDownload1}`);
      if (r.carDownload2 !== 'pCarDownload') throw new Error(`pCarDownloadDept_2 data-scope-group sai: ${r.carDownload2}`);
    });

    await scenario('Round-trip thật qua UI: tick checkbox trong bảng mới -> collectPermsFromForm() đọc đúng docDownload.depts/contractDownload.depts', async () => {
      const r = await page.evaluate((depts) => {
        document.getElementById('pDocDownloadDept_1').checked = true; // Phòng Kế Toán
        document.getElementById('pContractDownloadDept_2').checked = true; // Phòng IT
        const perms = collectPermsFromForm();
        return { docDownloadDepts: perms.docDownload.depts, contractDownloadDepts: perms.contractDownload.depts };
      }, DEPT_NAMES);
      if (JSON.stringify(r.docDownloadDepts) !== JSON.stringify([DEPT_NAMES[1]])) throw new Error(`docDownload.depts sai: ${JSON.stringify(r.docDownloadDepts)}`);
      if (JSON.stringify(r.contractDownloadDepts) !== JSON.stringify([DEPT_NAMES[2]])) throw new Error(`contractDownload.depts sai: ${JSON.stringify(r.contractDownloadDepts)}`);
    });

    await scenario('populatePermsForm() đổ đúng dữ liệu cũ lên ô checkbox trong bảng mới (carDownload/officeDownload)', async () => {
      const r = await page.evaluate((depts) => {
        // Reset sạch trước khi đổ dữ liệu mới để không dính trạng thái từ scenario trước.
        document.querySelectorAll('#permFieldsContainer input[type="checkbox"]').forEach(cb => { cb.checked = false; });
        // carView/officeView ĐÃ BỎ HẲN (10/2026, "Việc D" mở rộng) — không còn truyền ở đây nữa.
        // docDownload PHẢI có mặt: "p.docDownload === undefined" là dấu hiệu RIÊNG cho 1 nhánh di trú CỰC
        // CŨ (field downloadAll/downloadDepts DÙNG CHUNG trước khi tách "Tải xuống" theo từng module) —
        // thiếu nó sẽ bị GHI ĐÈ carDownload về rỗng ngay cả khi đã truyền giá trị thật ở đây.
        populatePermsForm({
          docDownload: { all: false, depts: [] },
          // carCreate (10/2026, "6-module"): đã gộp phẳng, KHÔNG còn pCarCreateDept_N — dùng carDownload
          // (vẫn giữ nguyên {all,depts}) để kiểm tra populatePermsForm() đổ đúng dữ liệu lên bảng mới.
          carDownload: { all: false, depts: [depts[0], depts[2]] },
          officeDownload: { all: true, depts: [] },
        });
        return {
          carCreate0: document.getElementById('pCarDownloadDept_0').checked,
          carCreate1: document.getElementById('pCarDownloadDept_1').checked,
          carCreate2: document.getElementById('pCarDownloadDept_2').checked,
          officeDownloadAll: document.getElementById('pOfficeDownloadAll').checked,
        };
      }, DEPT_NAMES);
      if (!r.carCreate0 || r.carCreate1 || !r.carCreate2) throw new Error(`populatePermsForm() đổ sai carCreate.depts lên bảng: ${JSON.stringify(r)}`);
      if (!r.officeDownloadAll) throw new Error('populatePermsForm() không set đúng pOfficeDownloadAll=true');
    });

    await scenario('toggleScopeGroup() (bấm "ALL") vẫn khoá đúng checkbox phòng ban trong bảng mới', async () => {
      // officeCreate đã gộp phẳng (10/2026, "6-module") — không còn pOfficeCreateAll/pOfficeCreateDept_N,
      // dùng pOfficeDownload (vẫn giữ nguyên {all,depts}) thay thế để kiểm toggleScopeGroup().
      const r = await page.evaluate(() => {
        document.getElementById('pOfficeDownloadAll').checked = true;
        toggleScopeGroup('pOfficeDownloadAll', 'pOfficeDownloadDept');
        const disabledAfterOn = [0, 1, 2].map(i => document.getElementById(`pOfficeDownloadDept_${i}`).disabled);
        document.getElementById('pOfficeDownloadAll').checked = false;
        toggleScopeGroup('pOfficeDownloadAll', 'pOfficeDownloadDept');
        const disabledAfterOff = [0, 1, 2].map(i => document.getElementById(`pOfficeDownloadDept_${i}`).disabled);
        return { disabledAfterOn, disabledAfterOff };
      });
      if (!r.disabledAfterOn.every(Boolean)) throw new Error(`Bật ALL phải khoá hết checkbox phòng ban: ${JSON.stringify(r.disabledAfterOn)}`);
      if (r.disabledAfterOff.some(Boolean)) throw new Error(`Tắt ALL phải mở khoá hết checkbox phòng ban: ${JSON.stringify(r.disabledAfterOff)}`);
    });

    await scenario('computePermTreeNodeCount()/refreshPermTreeBadges(): tick 1 checkbox phòng ban (không bật ALL) vẫn được badge đếm là ĐÃ CẤP qua data-scope-group, không đếm trùng/đếm riêng lẻ', async () => {
      // Dùng khối "4. Hợp Đồng & Giấy Phép" (permTreeBadge_contract) thay cho "5. Phòng Họp" — khối
      // Phòng Họp đã gộp phẳng (10/2026, "6-module"), KHÔNG còn bảng phòng ban nào để tick nữa.
      const r = await page.evaluate(() => {
        document.querySelectorAll('#permFieldsContainer input[type="checkbox"]').forEach(cb => { cb.checked = false; });
        document.getElementById('pContractDownloadDept_0').checked = true; // chỉ tick 1 phòng ban, KHÔNG bật ALL
        refreshPermTreeBadges();
        const badge = document.getElementById('permTreeBadge_contract').textContent;
        return badge;
      });
      const [granted, total] = r.split('/').map(Number);
      if (granted < 1) throw new Error(`Badge "4. Hợp Đồng & Giấy Phép" phải đếm ÍT NHẤT 1 mục đã cấp (do đã tick 1 phòng ban ở cột Tải xuống), được "${r}"`);
      if (!(total >= 2)) throw new Error(`Badge "4. Hợp Đồng & Giấy Phép" total phải >= 2 (Tạo hồ sơ + Tải xuống, chưa tính Nhập Đã Ký), được "${r}"`);
    });

    console.log('');
    const passed = results.filter(r => r.pass).length;
    const total = results.length;
    const failed = total - passed;
    console.log(`==== ${passed}/${total} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
