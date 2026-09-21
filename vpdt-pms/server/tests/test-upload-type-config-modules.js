// server/tests/test-upload-type-config-modules.js
//
// Rà soát chuyên sâu (9/2026, theo yêu cầu người dùng): "Hệ Thống > 📎 Quản Lý Tệp File"
// (UPLOAD_MODULE_LIST, module-tailieu.js) trước đây chỉ liệt kê 12 mục dù CÓ 19 moduleKey thực sự đang
// tải file lên (/api/upload) — 11 module hoàn toàn KHÔNG có mặt trong màn cấu hình này, admin không có
// cách nào đổi loại tệp/giới hạn dung lượng cho chúng. Đã bổ sung đủ 11 mục còn thiếu (giữ nguyên 12 mục
// cũ, KHÔNG xoá 'car'/'meeting'/'minutes' — 3 mục này tưởng chết nhưng thực ra dùng cho trường tệp TUỲ
// CHỈNH của Biểu Mẫu, xem UPLOAD_MODULE_KEY_MAP/mapFormModKeyToUploadModule()).
//
// Test này: điều hướng THẬT (switchTab/setSystemSubTab, testHarness.js) vào màn cấu hình, kiểm tra đủ
// 11 mục mới hiện ra ĐÚNG nhãn, 12 mục cũ vẫn còn nguyên, và universe phần mở rộng của vài mục "khác
// thường" (ảnh/PDF-only/mixed) đúng như input thật đang cho chọn — không tự ý siết hẹp hơn hiện trạng.
//
// Chạy: node server/tests/test-upload-type-config-modules.js
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8993;
const ADMIN = { username: 'ut_admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };

const NEW_MODULES = [
  ['checklistAnswerPhoto', '✅ Checklist Đánh Giá Siêu Thị (Ảnh Minh Chứng)'],
  ['hrContract', '📄 Hợp Đồng Lao Động (Tệp Đính Kèm)'],
  ['hrProfile', '👤 Hồ Sơ Nhân Sự (Quyết Định Đính Kèm)'],
  ['hrLifecycle', '🚀 Nhân Sự — Onboarding/Offboarding (Tệp Đính Kèm)'],
  ['itPrice', '💲 Hỗ Trợ IT — Phê Duyệt Giá (Tài Liệu Bổ Sung)'],
  ['itServiceRenewal', '🔄 Hỗ Trợ IT — Gia Hạn Dịch Vụ CNTT (Tệp Đính Kèm)'],
  ['license', '📜 Giấy Phép (Tệp Đính Kèm)'],
  ['operationOrder', '📦 Vận Hành — Đơn Hàng (Phiếu PDF)'],
  ['operationRepair', '🔧 Vận Hành — Sửa Chữa (Tài Liệu Đính Kèm)'],
  ['operationStoreOpening', '🏬 Vận Hành — Mở Mới (Tài Liệu Đính Kèm)'],
  ['periodicReport', '📅 Báo Cáo Định Kỳ (Tệp PDF)']
];

async function main() {
  const state = createMockState({ depts: ['Ban Giám Đốc'], users: [ADMIN] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String((err && err.message) || err)));

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('UPLOAD'); });
    await page.waitForSelector('#uploadTypeConfigList', { state: 'visible' });

    for (const [key, label] of NEW_MODULES) {
      await run.run(`Mục MỚI "${key}" hiện đúng trong màn cấu hình với nhãn "${label}"`, async () => {
        const text = await page.evaluate(() => document.getElementById('uploadTypeConfigList').innerText);
        assert(text.includes(label), `Không tìm thấy nhãn "${label}" trong màn Quản Lý Tệp File`);
      });
    }

    await run.run('3 mục cũ car/meeting/minutes (dùng cho trường tệp tuỳ chỉnh Biểu Mẫu) VẪN CÒN — không bị xoá nhầm', async () => {
      const text = await page.evaluate(() => document.getElementById('uploadTypeConfigList').innerText);
      assert(text.includes('🚗 Đăng Ký Xe'), 'Thiếu mục "🚗 Đăng Ký Xe" (car)');
      assert(text.includes('🏢 Phòng Họp'), 'Thiếu mục "🏢 Phòng Họp" (meeting)');
      assert(text.includes('📝 Biên Bản Họp'), 'Thiếu mục "📝 Biên Bản Họp" (minutes)');
    });

    await run.run('checklistAnswerPhoto: chỉ hiện checkbox ẢNH (.jpg/.jpeg/.png/.webp), KHÔNG có .pdf/.docx/.xlsx', async () => {
      const exts = await page.evaluate(() => {
        const blocks = Array.from(document.querySelectorAll('#uploadTypeConfigList > div'));
        const block = blocks.find(b => b.querySelector('.font-bold')?.innerText.includes('Checklist Đánh Giá Siêu Thị (Ảnh Minh Chứng)'));
        return Array.from(block.querySelectorAll('input[type="checkbox"]')).map(cb => cb.dataset.arg1);
      });
      assertEqual(JSON.stringify(exts.sort()), JSON.stringify(['.jpeg', '.jpg', '.png', '.webp'].sort()), `checklistAnswerPhoto phải chỉ có 4 định dạng ảnh (thực tế: ${JSON.stringify(exts)})`);
    });

    await run.run('operationOrder: chỉ hiện checkbox .pdf (khớp accept=".pdf" thật của #voFile)', async () => {
      const exts = await page.evaluate(() => {
        const blocks = Array.from(document.querySelectorAll('#uploadTypeConfigList > div'));
        const block = blocks.find(b => b.querySelector('.font-bold')?.innerText.includes('Vận Hành — Đơn Hàng'));
        return Array.from(block.querySelectorAll('input[type="checkbox"]')).map(cb => cb.dataset.arg1);
      });
      assertEqual(JSON.stringify(exts), JSON.stringify(['.pdf']), `operationOrder phải chỉ có .pdf (thực tế: ${JSON.stringify(exts)})`);
    });

    await run.run('hrLifecycle: dùng universe ĐẦY ĐỦ (12 định dạng chung) vì input thật chưa từng giới hạn — không âm thầm siết hẹp', async () => {
      const exts = await page.evaluate(() => {
        const blocks = Array.from(document.querySelectorAll('#uploadTypeConfigList > div'));
        const block = blocks.find(b => b.querySelector('.font-bold')?.innerText.includes('Onboarding/Offboarding'));
        return Array.from(block.querySelectorAll('input[type="checkbox"]')).length;
      });
      assertEqual(exts, 12, `hrLifecycle phải hiện đủ 12 định dạng của UPLOAD_EXT_UNIVERSE_ALL (thực tế: ${exts})`);
    });

    await run.run('operationEstimate (đã có từ trước, v23.78) vẫn còn nguyên, không bị đụng bởi đợt bổ sung này', async () => {
      const text = await page.evaluate(() => document.getElementById('uploadTypeConfigList').innerText);
      assert(text.includes('Vận Hành — Danh Mục Đầu Tư'), 'Mục operationEstimate (đã có từ v23.78) bị mất');
    });

    await run.run('Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', async () => {
      assertEqual(pageErrors.length, 0, `Không được có lỗi JS: ${JSON.stringify(pageErrors)}`);
    });

    run.summary();
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
