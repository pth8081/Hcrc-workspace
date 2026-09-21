// server/tests/test-operation-estimate-attachments-multifile.js
//
// "Multi-file thật" cho Tệp Đính Kèm Danh Mục Đầu Tư (Vận Hành > QLDA) — theo yêu cầu người dùng: trước
// đây input "+ Thêm tệp" chỉ nhận 1 file/lần bấm (không có "multiple") dù nghiệp vụ cho phép nhiều tệp/
// danh mục lớn — người dùng phải bấm lặp lại cho từng file. Đã sửa onOperationEstimateAttachmentFileChange()
// (module-vanhanh.js) sang xử lý HÀNG LOẠT (chọn nhiều file 1 lần, tải tuần tự, gộp báo lỗi/bỏ qua sau
// khi xong cả đợt) — mirror khuôn handleOperationOrderMultiFilePdfUpload() đã có sẵn cho Đơn Hàng.
//
// Dùng Chromium thật (Playwright, testHarness.js) — window.fetch('/api/upload') đã được giả lập sẵn
// (fakeUploadResponse, luôn trả OK dựa theo tên file thật) nên không cần server thật; test này tự override
// thêm window.fetch để giả lập ĐÚNG 1 file lỗi (kiểm nhánh gộp báo lỗi không chặn các file còn lại).
//
// Chạy: node server/tests/test-operation-estimate-attachments-multifile.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8994;

const MANAGER = { username: 'vh_mf_mgr', name: 'Quản Lý Hồ Sơ', dept: 'Vận Hành', perms: { operationRecordManageAll: true }, active: true };

const RECORD = {
  id: 9101, code: 'MMST-9101', storeName: 'Siêu Thị Demo Multi-File', dept: 'Vận Hành', creator: 'vh_mf_mgr',
  estimateStatus: 'APPROVED',
  estimateItems: [
    { id: 1, parentId: null, content: 'Nội thất trưng bày', description: '', amount: 0, note: '', assignedToUsernames: [], assignedToNames: [], attachments: [] }
  ]
};

// Tạo sẵn 1 thư mục tệp mẫu tạm (nội dung không quan trọng — fakeUploadResponse chỉ đọc tên/size, không
// đọc nội dung thật) — dọn sạch ở finally.
function makeSampleFiles(dir, names) {
  return names.map((name) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, `dummy content for ${name}`);
    return p;
  });
}

async function main() {
  const state = createMockState({ depts: ['Vận Hành'], users: [MANAGER], operationStoreOpenings: [RECORD] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qlda-multifile-'));
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String((err && err.message) || err)));

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, MANAGER);
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('OPEN'); openOperationEstimateModal('operationStoreOpenings', 9101); });
    await page.waitForSelector('#operationEstimateItemsTableBody', { state: 'visible' });

    const fileInputSelector = 'input[data-op-change="onOperationEstimateAttachmentFileChange"]';
    await page.waitForSelector(fileInputSelector, { state: 'attached' });

    await run.run('Input "+ Thêm tệp" đã có thuộc tính multiple (chọn nhiều file 1 lần)', async () => {
      const hasMultiple = await page.evaluate((sel) => document.querySelector(sel)?.multiple === true, fileInputSelector);
      assert(hasMultiple, 'Input tệp đính kèm phải có thuộc tính "multiple"');
    });

    await run.run('Chọn 3 file CÙNG LÚC -> cả 3 tự tải lên và thêm vào attachments, KHÔNG cần bấm lặp lại từng file', async () => {
      const files = makeSampleFiles(tmpDir, ['bao-gia-1.pdf', 'bao-gia-2.docx', 'bao-gia-3.xlsx']);
      await page.evaluate(() => window.__resetCapture());
      await page.setInputFiles(fileInputSelector, files);
      await page.waitForFunction(() => operationEstimateItems[0]?.attachments?.length === 3, { timeout: 10000 });
      const result = await page.evaluate(() => ({
        count: operationEstimateItems[0].attachments.length,
        names: operationEstimateItems[0].attachments.map(a => a.fileName),
        alerts: window.__alerts.length
      }));
      assertEqual(result.count, 3, 'Cả 3 file phải được thêm vào attachments trong 1 lượt chọn');
      assert(result.names.includes('bao-gia-1.pdf') && result.names.includes('bao-gia-2.docx') && result.names.includes('bao-gia-3.xlsx'), `Tên tệp phải khớp cả 3 file đã chọn (thực tế: ${JSON.stringify(result.names)})`);
      assertEqual(result.alerts, 0, 'Chọn nhiều file thành công hết KHÔNG được bật alert nào (không có lỗi/vượt hạn mức)');
    });

    await run.run('Chọn thêm 9 file (đã có 3, cap 10) -> CHỈ 7 file đầu được tải, 2 file cuối bị bỏ qua kèm cảnh báo rõ ràng', async () => {
      const files = makeSampleFiles(tmpDir, Array.from({ length: 9 }, (_, i) => `them-${i + 1}.pdf`));
      await page.evaluate(() => window.__resetCapture());
      await page.setInputFiles(fileInputSelector, files);
      await page.waitForFunction(() => operationEstimateItems[0]?.attachments?.length === 10, { timeout: 10000 });
      const result = await page.evaluate(() => ({
        count: operationEstimateItems[0].attachments.length,
        alerts: window.__alerts
      }));
      assertEqual(result.count, 10, 'Tổng attachments phải dừng lại ĐÚNG 10 (cap tối đa/danh mục lớn)');
      assertEqual(result.alerts.length, 1, 'Phải có đúng 1 alert cảnh báo về việc bỏ qua bớt file');
      assert(result.alerts[0].includes('Bỏ qua 2 tệp'), `Alert phải nêu rõ số file bị bỏ qua do vượt cap (thực tế: "${result.alerts[0]}")`);
    });

    await run.run('Danh mục ĐÃ ĐỦ 10 tệp -> chọn thêm 1 file MỚI bị chặn ngay từ đầu, không gọi upload nào, attachments giữ nguyên 10', async () => {
      const files = makeSampleFiles(tmpDir, ['file-thua.pdf']);
      await page.evaluate(() => window.__resetCapture());
      await page.setInputFiles(fileInputSelector, files);
      await page.waitForFunction(() => window.__alerts && window.__alerts.length > 0, { timeout: 10000 });
      const result = await page.evaluate(() => ({
        count: operationEstimateItems[0].attachments.length,
        alerts: window.__alerts
      }));
      assertEqual(result.count, 10, 'Attachments phải giữ nguyên 10, không vượt cap');
      assert(result.alerts[0].includes('tối đa 10 tệp'), `Alert phải nêu rõ đã đạt tối đa (thực tế: "${result.alerts[0]}")`);
    });

    await run.run('1 file lỗi giữa chừng (server/network từ chối) KHÔNG chặn các file còn lại trong CÙNG đợt — gộp báo lỗi sau khi xong', async () => {
      // Xoá bớt cho còn 8 tệp (còn 2 chỗ trống) để có thể thử lại 1 lượt 2 file: 1 lỗi + 1 thành công.
      await page.evaluate(() => { operationEstimateItems[0].attachments = operationEstimateItems[0].attachments.slice(0, 8); });
      // Ghi đè window.fetch tạm thời NGAY TRONG TRANG — chặn đúng 1 tên file cụ thể, các request khác
      // (kể cả /api/upload của file còn lại) vẫn đi qua fakeUploadResponse gốc như bình thường.
      await page.evaluate(() => {
        const originalFetch = window.fetch;
        window.__origFetchBeforeFailTest = originalFetch;
        window.fetch = async (url, opts) => {
          if (url === '/api/upload' && opts?.method === 'POST') {
            const file = opts.body.get('file');
            if (file && file.name === 'loi-mang.pdf') {
              return { ok: false, status: 400, json: async () => ({ error: 'Tệp vượt quá dung lượng cho phép' }) };
            }
          }
          return originalFetch(url, opts);
        };
      });
      const files = makeSampleFiles(tmpDir, ['loi-mang.pdf', 'thanh-cong.pdf']);
      await page.evaluate(() => window.__resetCapture());
      await page.setInputFiles(fileInputSelector, files);
      await page.waitForFunction(() => operationEstimateItems[0]?.attachments?.length === 9, { timeout: 10000 });
      const result = await page.evaluate(() => ({
        count: operationEstimateItems[0].attachments.length,
        names: operationEstimateItems[0].attachments.map(a => a.fileName),
        alerts: window.__alerts
      }));
      await page.evaluate(() => { window.fetch = window.__origFetchBeforeFailTest; });
      assertEqual(result.count, 9, 'File thành công (thanh-cong.pdf) vẫn phải được thêm dù file kia lỗi (8 cũ + 1 mới = 9)');
      assert(result.names.includes('thanh-cong.pdf'), 'File tải thành công phải có mặt trong attachments');
      assert(!result.names.includes('loi-mang.pdf'), 'File lỗi KHÔNG được thêm vào attachments');
      assertEqual(result.alerts.length, 1, 'Phải có đúng 1 alert gộp báo lỗi sau khi xong cả đợt');
      assert(result.alerts[0].includes('loi-mang.pdf') && result.alerts[0].includes('Tệp vượt quá dung lượng'), `Alert phải nêu rõ tên file lỗi + lý do (thực tế: "${result.alerts[0]}")`);
    });

    await run.run('Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', async () => {
      assertEqual(pageErrors.length, 0, `Không được có lỗi JS: ${JSON.stringify(pageErrors)}`);
    });

    run.summary();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await browser.close();
    await server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
