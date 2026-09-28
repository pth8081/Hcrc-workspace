// tests/test-formsplit-internalpost-office.js — đợt "biểu mẫu không dùng chung" (10/2026, theo yêu cầu
// người dùng rà soát bug Nhịp Sống HCRC + tách Biểu Mẫu):
//
// 1) BUG THẬT đã vá: #internalFile (Nhịp Sống HCRC/Góc Chia Sẻ) luôn gửi cứng moduleKey 'internal' khi
//    tải tệp đính kèm lên /api/upload — dù field này cũng dùng làm ẢNH BÌA bài viết. moduleKey 'internal'
//    ở "Quản Lý Tệp File" mặc định chỉ cho .pdf/.docx/.xlsx (không có ảnh), nên khi admin đã cấu hình
//    đúng như nhãn gợi ý, mọi ảnh bìa bị server từ chối ("ảnh chọn được nhưng ko đăng bài được"). Client
//    nay tự nhận diện qua file.type để chọn đúng moduleKey ('internalImage' cho ảnh, 'internal' còn lại).
// 2) Biểu Mẫu: CORE_FIELD_MANIFEST.INTERNAL_POST (1 coreKey chung Nhịp Sống HCRC + Góc Chia Sẻ) tách
//    thành INTERNAL_POST_NEWS/INTERNAL_POST_SHARE — mỗi loại 1 coreKey + 1 modKey "Trường Bổ Sung" riêng.
// 3) Biểu Mẫu: CORE_FIELD_MANIFEST.OFFICE (1 coreKey chung Mua Sắm + Sửa Chữa) tách thành
//    OFFICE_PROCUREMENT/OFFICE_REPAIR — field dùng chung thật (offCode/offDept/offTitle) lặp lại ở cả 2,
//    field riêng (offQty/offAmount/offSupplier chỉ Sửa Chữa, offUsageTime chỉ Mua Sắm) chỉ còn 1 bên.
// 4) migrateInternalPostFormTemplatesKeys()/migrateOfficeFormTemplatesKeys() — dữ liệu cũ (1 modKey
//    chung, từ TRƯỚC đợt tách) tự chuyển sang cả 2 modKey mới khi tải lại, không mất cấu hình admin cũ.
//
// Run: node server/tests/test-formsplit-internalpost-office.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8994;

function makeDummyImageFile() {
  const tmpPath = path.join(os.tmpdir(), 'anh-bia-test.png');
  // PNG header thật (đủ để File API gán type 'image/png' theo phần mở rộng — mock backend không kiểm
  // tra magic bytes, chỉ dùng file.name/file.type do trình duyệt tự suy ra từ đuôi file).
  fs.writeFileSync(tmpPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return tmpPath;
}
function makeDummyDocFile() {
  const tmpPath = path.join(os.tmpdir(), 'tai-lieu-test.pdf');
  fs.writeFileSync(tmpPath, '%PDF-1.4 dummy doc content');
  return tmpPath;
}

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    const author = makeUser({ username: 'nv.an', name: 'Nguyễn Văn An', dept: 'Phòng CNTT', perms: { internalNewsCreate: true } });
    const admin = makeUser({ username: 'admin1', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true } });

    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((users) => { DB.users = users; }, [author, admin]);
    await page.evaluate((u) => finishLogin(u), author);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('NEWS'); });

    // ===== 1) Upload moduleKey tự nhận diện theo file.type =====
    await run('#internalFile (Nhịp Sống HCRC): chọn ẢNH -> uploadFileToServer() gửi moduleKey "internalImage"', async () => {
      await page.evaluate(() => { window.__uploadModuleKeys = []; });
      await page.fill('#internalTitle', 'Tin có ảnh bìa');
      await page.fill('#internalContent', 'Nội dung tin tức có ảnh bìa đính kèm.');
      await page.selectOption('#internalPostCategory', { index: 1 });
      await page.setInputFiles('#internalFile', makeDummyImageFile());
      await page.click('#internalSubmitBtn');
      await page.waitForTimeout(200);
      const keys = await page.evaluate(() => window.__uploadModuleKeys);
      assert(keys.includes('internalImage'), `Phải gửi moduleKey 'internalImage' cho ảnh, thực tế: ${JSON.stringify(keys)}`);
      assertEqual(await page.evaluate(() => DB.internalPosts.length), 1, 'Phải đăng thành công post NEWS có ảnh bìa');
    });

    await run('#internalFile (Nhịp Sống HCRC): chọn TỆP VĂN BẢN -> uploadFileToServer() vẫn gửi moduleKey "internal" như cũ', async () => {
      await page.evaluate(() => { window.__uploadModuleKeys = []; DB.internalPosts = []; });
      await page.fill('#internalTitle', 'Tin có tài liệu đính kèm');
      await page.fill('#internalContent', 'Nội dung tin tức có tài liệu PDF đính kèm.');
      await page.selectOption('#internalPostCategory', { index: 1 });
      await page.setInputFiles('#internalFile', makeDummyDocFile());
      await page.click('#internalSubmitBtn');
      await page.waitForTimeout(200);
      const keys = await page.evaluate(() => window.__uploadModuleKeys);
      assert(keys.includes('internal'), `Phải vẫn gửi moduleKey 'internal' cho tệp văn bản, thực tế: ${JSON.stringify(keys)}`);
      assertEqual(await page.evaluate(() => DB.internalPosts.length), 1, 'Phải đăng thành công post NEWS có tài liệu đính kèm');
    });

    await run('#internalFile (Góc Chia Sẻ): chọn ẢNH cũng tự nhận diện đúng moduleKey "internalImage" (không chỉ riêng NEWS)', async () => {
      await page.evaluate(() => { window.__uploadModuleKeys = []; DB.internalPosts = []; });
      await page.evaluate(() => setInternalSubTab('SHARE'));
      await page.fill('#internalTitle', 'Chia sẻ có ảnh');
      await page.fill('#internalContent', 'Nội dung góc chia sẻ có ảnh.');
      await page.selectOption('#internalPostCategoryShare', { index: 1 });
      await page.setInputFiles('#internalFile', makeDummyImageFile());
      await page.click('#internalSubmitBtn');
      await page.waitForTimeout(200);
      const keys = await page.evaluate(() => window.__uploadModuleKeys);
      assert(keys.includes('internalImage'), `Phải gửi moduleKey 'internalImage' cho ảnh ở Góc Chia Sẻ, thực tế: ${JSON.stringify(keys)}`);
    });

    // ===== 1b) BUG THẬT NGHIÊM TRỌNG đã vá riêng: required "kẹt" trên field ẨN của loại bài KIA khiến
    // form KHÔNG THỂ submit qua HTML5 native validation dù đã điền đủ mọi ô đang hiện — đây là nguyên
    // nhân CHÍNH của "các nút thao tác ko sử dụng được" (bấm Đăng Ngay/Lưu Nháp không phản ứng gì, không
    // alert, không lỗi console — trình duyệt chặn submit hoàn toàn im lặng). Test PHIÊN MỚI HOÀN TOÀN
    // (chưa từng đụng tab kia) để không bị "che" bởi giá trị còn sót từ lượt đăng NEWS trước đó (CSS
    // display:none không tự miễn required khỏi constraint validation — chỉ input[type=hidden]/disabled/
    // readonly mới được miễn, xem setInternalSubTab() ở module-internalcomms-nhipsong.js). =====
    await run('Phiên MỚI đi thẳng Góc Chia Sẻ (chưa từng mở Nhịp Sống HCRC): form vẫn hợp lệ (không bị field ẩn internalPostCategory của NEWS chặn)', async () => {
      await page.evaluate((u) => finishLogin(u), author);
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('SHARE'); });
      await page.fill('#internalTitle', 'Chia sẻ phiên mới');
      await page.fill('#internalContent', 'Nội dung.');
      await page.selectOption('#internalPostCategoryShare', { index: 1 });
      const formValid = await page.evaluate(() => document.getElementById('internalPostForm').checkValidity());
      assert(formValid, 'Form phải HỢP LỆ (checkValidity()=true) ngay ở phiên đầu tiên trên Góc Chia Sẻ — field ẩn internalPostCategory (Nhịp Sống HCRC) không được required nữa');
    });

    await run('Phiên MỚI đi thẳng Nhịp Sống HCRC (chưa từng mở Góc Chia Sẻ): form vẫn hợp lệ (không bị field ẩn internalPostCategoryShare chặn)', async () => {
      await page.evaluate(() => { setInternalSubTab('NEWS'); });
      await page.selectOption('#internalPostCategory', { index: 1 });
      const formValid = await page.evaluate(() => document.getElementById('internalPostForm').checkValidity());
      assert(formValid, 'Form phải HỢP LỆ (checkValidity()=true) trên Nhịp Sống HCRC — field ẩn internalPostCategoryShare (Góc Chia Sẻ) không được required nữa');
    });

    // ===== 2) Biểu Mẫu: INTERNAL_POST tách 2 =====
    await page.evaluate((u) => finishLogin(u), admin);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('FORM'); });

    await run('Biểu Mẫu: tab "Nhịp Sống HCRC" chỉ liệt kê field internalPostCategory (KHÔNG lẫn internalPostCategoryShare)', async () => {
      await page.evaluate(() => switchFormTab('INTERNAL_POST_NEWS'));
      const html = await page.evaluate(() => document.getElementById('formFieldsTableBody').innerHTML);
      assert(html.includes('internalPostCategory') && !html.includes('internalPostCategoryShare'), 'Tab Nhịp Sống HCRC lẫn field của Góc Chia Sẻ');
    });

    await run('Biểu Mẫu: tab "Góc Chia Sẻ" chỉ liệt kê field internalPostCategoryShare (KHÔNG lẫn internalPostCategory)', async () => {
      await page.evaluate(() => switchFormTab('INTERNAL_POST_SHARE'));
      const html = await page.evaluate(() => document.getElementById('formFieldsTableBody').innerHTML);
      assert(html.includes('internalPostCategoryShare'), 'Thiếu field internalPostCategoryShare ở tab Góc Chia Sẻ');
      assert(!html.includes('>internalPostCategory<'), 'Không được lẫn field internalPostCategory (Nhịp Sống HCRC) sang tab Góc Chia Sẻ');
    });

    await run('Biểu Mẫu: đổi nhãn field của Nhịp Sống HCRC KHÔNG ảnh hưởng Góc Chia Sẻ (2 override riêng biệt)', async () => {
      await page.evaluate(() => switchFormTab('INTERNAL_POST_NEWS'));
      await page.evaluate(() => updateCoreFieldOverride('INTERNAL_POST_NEWS', 'internalPostCategory', 'label', 'Chuyên Đề Đã Đổi Tên'));
      const overrideNews = await page.evaluate(() => (DB.formTemplates.__core__INTERNAL_POST_NEWS || {}).internalPostCategory);
      const overrideShare = await page.evaluate(() => DB.formTemplates.__core__INTERNAL_POST_SHARE);
      assertEqual(overrideNews?.label, 'Chuyên Đề Đã Đổi Tên', 'Override phải lưu đúng vào __core__INTERNAL_POST_NEWS');
      assert(!overrideShare || !overrideShare.internalPostCategoryShare, 'Override của Nhịp Sống HCRC KHÔNG được rò rỉ sang __core__INTERNAL_POST_SHARE');
    });

    // ===== 3) Biểu Mẫu: OFFICE tách 2 =====
    await run('Biểu Mẫu: tab "Văn Phòng - Mua Bán" chỉ có offUsageTime, KHÔNG có offQty/offAmount/offSupplier', async () => {
      await page.evaluate(() => switchFormTab('MUA_BAN'));
      const html = await page.evaluate(() => document.getElementById('formFieldsTableBody').innerHTML);
      assert(html.includes('offUsageTime'), 'Thiếu offUsageTime ở tab Mua Bán');
      assert(!html.includes('offQty') && !html.includes('offAmount') && !html.includes('offSupplier'), 'Tab Mua Bán không được lẫn field riêng của Sửa Chữa');
      assert(html.includes('offCode') && html.includes('offDept') && html.includes('offTitle'), 'Tab Mua Bán vẫn phải có đủ 3 field dùng chung');
    });

    await run('Biểu Mẫu: tab "Văn Phòng - Sửa Chữa" có offQty/offAmount/offSupplier, KHÔNG có offUsageTime', async () => {
      await page.evaluate(() => switchFormTab('SUA_CHUA'));
      const html = await page.evaluate(() => document.getElementById('formFieldsTableBody').innerHTML);
      assert(html.includes('offQty') && html.includes('offAmount') && html.includes('offSupplier'), 'Thiếu field riêng của Sửa Chữa');
      assert(!html.includes('offUsageTime'), 'Tab Sửa Chữa không được lẫn field riêng của Mua Bán');
      assert(html.includes('offCode') && html.includes('offDept') && html.includes('offTitle'), 'Tab Sửa Chữa vẫn phải có đủ 3 field dùng chung');
    });

    // ===== 4) Migration key cũ -> 2 key mới =====
    await run('migrateInternalPostFormTemplatesKeys(): dữ liệu cũ INTERNAL_POST (chung) tự tách sang CẢ 2 modKey mới', async () => {
      const result = await page.evaluate(() => migrateInternalPostFormTemplatesKeys({
        INTERNAL_POST: [{ id: 'f_old1', label: 'Trường bổ sung cũ', type: 'text', options: [], required: false }],
        __core__INTERNAL_POST: { internalPostCategory: { label: 'Chuyên Đề (đã đổi)', required: true } }
      }));
      assert(Array.isArray(result.INTERNAL_POST_NEWS) && result.INTERNAL_POST_NEWS[0].label === 'Trường bổ sung cũ', 'Phải copy đúng field cũ sang INTERNAL_POST_NEWS');
      assert(Array.isArray(result.INTERNAL_POST_SHARE) && result.INTERNAL_POST_SHARE[0].label === 'Trường bổ sung cũ', 'Phải copy đúng field cũ sang INTERNAL_POST_SHARE');
      assert(result.INTERNAL_POST_NEWS !== result.INTERNAL_POST_SHARE, 'Không được dùng chung 1 tham chiếu mảng');
      assertEqual(result.__core__INTERNAL_POST_NEWS.internalPostCategory.label, 'Chuyên Đề (đã đổi)', 'Phải copy đúng override __core__');
      assert(!('INTERNAL_POST' in result) && !('__core__INTERNAL_POST' in result), 'Phải xoá hẳn 2 khoá cũ sau khi migrate');
    });

    await run('migrateOfficeFormTemplatesKeys(): dữ liệu cũ OFFICE (chung) tự tách sang CẢ 2 modKey mới', async () => {
      const result = await page.evaluate(() => migrateOfficeFormTemplatesKeys({
        __core__OFFICE: { offTitle: { label: 'Tên Hạng Mục (đã đổi)', required: true } }
      }));
      assertEqual(result.__core__OFFICE_PROCUREMENT.offTitle.label, 'Tên Hạng Mục (đã đổi)', 'Phải copy đúng override sang OFFICE_PROCUREMENT');
      assertEqual(result.__core__OFFICE_REPAIR.offTitle.label, 'Tên Hạng Mục (đã đổi)', 'Phải copy đúng override sang OFFICE_REPAIR');
      assert(!('__core__OFFICE' in result), 'Phải xoá hẳn khoá cũ sau khi migrate');
    });

    await run('migrateOfficeFormTemplatesKeys(): đã có khoá mới rồi thì KHÔNG migrate lại (idempotent)', async () => {
      const input = { __core__OFFICE: { offTitle: { label: 'Cũ', required: false } }, __core__OFFICE_PROCUREMENT: { offTitle: { label: 'Đã cấu hình riêng rồi', required: true } } };
      const result = await page.evaluate((inp) => migrateOfficeFormTemplatesKeys(inp), input);
      assertEqual(result.__core__OFFICE_PROCUREMENT.offTitle.label, 'Đã cấu hình riêng rồi', 'Không được ghi đè cấu hình MỚI đã có bằng dữ liệu cũ');
      assert('__core__OFFICE' in result, 'Không migrate thì khoá cũ vẫn còn nguyên');
    });

    assertEqual(pageErrors.length, 0, `Không được có lỗi JS chưa bắt: ${pageErrors.map(e => e.message).join('; ')}`);
    summarize('test-formsplit-internalpost-office');
  } finally {
    await teardown({ server, browser });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
