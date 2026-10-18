// server/tests/test-upload-type-config-table-filter.js
//
// Regression test cho Giai đoạn 2b "HCRC Workspace Refresh" (11/2026) — màn "Hệ Thống > 📎 Quản Lý Tệp
// File" đổi từ 25 card xếp dọc (trang cực dài) sang 1 bảng gọn + ô tìm kiếm (renderUploadTypeConfig()/
// filterUploadTypeConfig(), module-tailieu.js). Test này kiểm riêng phần MỚI (bảng + tìm kiếm) —
// test-upload-type-config-modules.js đã phủ đủ nội dung/universe từng module, không lặp lại ở đây.
//
//   (A) #uploadTypeConfigList là <tbody> thật, mỗi module render đúng 1 <tr> (không còn 25 <div> card).
//   (B) Gõ từ khoá khớp TÊN module -> chỉ hàng khớp còn hiện, các hàng khác ẩn (display:none thật).
//   (C) Gõ từ khoá khớp 1 ĐỊNH DẠNG (vd ".pdf") -> lọc đúng theo nội dung hàng, không chỉ theo tên.
//   (D) Xoá hết từ khoá -> toàn bộ hàng hiện lại.
//   (E) ĐỐI CHỨNG: checkbox/ô giới hạn dung lượng vẫn hoạt động đúng data-op sau khi đổi sang bảng.
//
// Chạy: node server/tests/test-upload-type-config-table-filter.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual } = require('./testHarness');

const PORT_UI = 8991;

async function main() {
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({ users: [ADMIN] });
  const { browser, page } = await launchPage(PORT_UI, state);
  const run = createRunner();

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('UPLOAD'); });
    await page.waitForTimeout(150);

    await run.run('#uploadTypeConfigList là <tbody> thật, mỗi module render đúng 1 <tr> (≥ 20 module)', async () => {
      const info = await page.evaluate(() => {
        const list = document.getElementById('uploadTypeConfigList');
        return { tag: list.tagName, rowCount: list.querySelectorAll(':scope > tr').length, divCount: list.querySelectorAll(':scope > div').length };
      });
      assertEqual(info.tag, 'TBODY', '#uploadTypeConfigList phải là <tbody> (nằm trong <table> thật)');
      assertEqual(info.divCount, 0, 'KHÔNG còn <div> card nào là con trực tiếp (đã đổi hết sang <tr>)');
      assertEqual(info.rowCount >= 20, true, `phải có ít nhất 20 hàng module (UPLOAD_MODULE_LIST hiện có 24+ mục), đang là ${info.rowCount}`);
    });

    await run.run('Gõ từ khoá khớp tên module ("Checklist") -> chỉ hàng khớp còn hiện', async () => {
      await page.fill('#uploadTypeConfigSearch', 'Checklist');
      await page.evaluate(() => filterUploadTypeConfig());
      const result = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('#uploadTypeConfigList > tr'));
        const visible = rows.filter(r => getComputedStyle(r).display !== 'none');
        return { total: rows.length, visibleCount: visible.length, visibleText: visible.map(r => r.innerText.split('\n')[0]) };
      });
      assertEqual(result.visibleCount < result.total, true, 'Phải lọc bớt — không còn hiện hết toàn bộ hàng');
      assertEqual(result.visibleText.every(t => /checklist/i.test(t)), true, `Mọi hàng còn hiện phải khớp "Checklist", đang là: ${result.visibleText.join(' | ')}`);
    });

    await run.run('Gõ từ khoá khớp 1 định dạng (".mp4") -> lọc đúng theo NỘI DUNG hàng, không chỉ tên', async () => {
      await page.fill('#uploadTypeConfigSearch', '.mp4');
      await page.evaluate(() => filterUploadTypeConfig());
      const result = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('#uploadTypeConfigList > tr'));
        const visible = rows.filter(r => getComputedStyle(r).display !== 'none');
        return visible.map(r => r.innerText.split('\n')[0]);
      });
      assertEqual(result.length, 1, `Chỉ đúng 1 module có định dạng .mp4 (Truyền Thông Nội Bộ — Video), đang khớp: ${result.join(' | ')}`);
    });

    await run.run('Xoá hết từ khoá -> toàn bộ hàng hiện lại', async () => {
      await page.fill('#uploadTypeConfigSearch', '');
      await page.evaluate(() => filterUploadTypeConfig());
      const result = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('#uploadTypeConfigList > tr'));
        return rows.every(r => getComputedStyle(r).display !== 'none');
      });
      assertEqual(result, true, 'Xoá từ khoá phải hiện lại TOÀN BỘ hàng');
    });

    await run.run('ĐỐI CHỨNG: checkbox định dạng + ô giới hạn dung lượng vẫn đúng data-op sau khi đổi sang bảng', async () => {
      const info = await page.evaluate(() => {
        const row = Array.from(document.querySelectorAll('#uploadTypeConfigList > tr')).find(r => r.innerText.includes('Tài Liệu'));
        const cb = row.querySelector('input[type="checkbox"]');
        const sizeInput = row.querySelector('input[type="number"]');
        return {
          cbOp: cb?.dataset.opChange, cbArg0: cb?.dataset.arg0,
          sizeOp: sizeInput?.dataset.opChange, sizeArg0: sizeInput?.dataset.arg0
        };
      });
      assertEqual(info.cbOp, 'toggleUploadTypeExtFromCheckbox', 'Checkbox phải giữ đúng data-op-change gốc');
      assertEqual(info.cbArg0, 'doc', 'Checkbox hàng "Tài Liệu" phải đúng data-arg0="doc"');
      assertEqual(info.sizeOp, 'updateUploadSizeLimit', 'Ô giới hạn dung lượng phải giữ đúng data-op-change gốc');
      assertEqual(info.sizeArg0, 'doc', 'Ô giới hạn dung lượng hàng "Tài Liệu" phải đúng data-arg0="doc"');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
