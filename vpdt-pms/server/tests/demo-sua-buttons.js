// server/tests/demo-sua-buttons.js
//
// Demo (theo yêu cầu người dùng "Demo xem các nút sửa làm nhé") — chụp ảnh màn hình 6 nút "✏️ Sửa" mới
// thêm (đợt #223-227, xem CLAUDE.md: chỉ làm demo khi người dùng chủ động yêu cầu):
//   1. Quy Trình Đặt Hàng Siêu Thị — Cấu Hình Người Duyệt Theo Bước (mixed approval, module-workflow.js)
//   2. Danh Mục Đồng Phục (module-dongphuc.js)
//   3. Ngày Lễ — Công & Phép > Quản Lý & Cấu Hình (module-conghop.js)
//   4. Danh Mục Loại Dịch Vụ — Hỗ Trợ IT > Gia Hạn Dịch Vụ (module-itsupport-renewal.js)
//   5-7. Chương Trình / Bài Test / Kho Tài Liệu — Truyền Thông Nội Bộ > Đào Tạo (module-internalcomms-daotao.js)
//
// Dùng testHarness.js (đăng nhập thật qua proceedAfterAuth(), điều hướng thật qua switchTab()/setXxxSubTab())
// cho hạ tầng chung, nhưng LỚP THÊM 1 tầng window.fetch phía trên bản testHarness đã gán sẵn cho đúng 3
// endpoint mock gốc CHƯA hỗ trợ (không sửa testHarness.js dùng chung cho mọi test khác):
//   - POST /api/data/operationOrderStoreMixedApprovalRules (syncStorage() ghi thẳng, chỉ cần {ok:true})
//   - POST /api/admin/renameCatalogEntry (renameCatalogEntryClient() ĐỌC body.catalog để cập nhật DB)
//   - POST /api/records/(trainingCourses|trainingTests|trainingDocuments)/:id/edit (3 hàm submit*
//     ĐỌC result.item để cập nhật DB) — testHarness.js chưa có route thật này (chỉ test-internal-training.js
//     dùng hạ tầng _harness.js riêng mới có).
// Mọi request khác rơi về đúng dispatcher thật của testHarness.js (originalFetch), không tự bịa hành vi.
//
// Chạy: node server/tests/demo-sua-buttons.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8993;
const OUT_DIR = process.env.SUA_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'sua-buttons');

const DEMO_USER = {
  username: 'demo_admin', name: 'Quản Trị Viên Demo', dept: 'Phòng IT',
  perms: { admin: true }, totpEnabled: true, active: true
};

const state = createMockState({
  depts: ['Phòng IT', 'Ban Giám Đốc', 'Siêu Thị Q1'],
  stores: ['Siêu Thị Q1', 'Siêu Thị Q3'],
  jobTitles: ['Phó Tổng Giám Đốc'],
  storeJobTitles: [{ label: 'Giám Đốc siêu thị' }],
  users: [
    DEMO_USER,
    { username: 'gd.q1', name: 'GĐ Q1', jobTitle: 'Giám Đốc siêu thị', dept: 'Siêu Thị Q1', active: true, perms: {} },
    { username: 'ptgd', name: 'Phó TGĐ', jobTitle: 'Phó Tổng Giám Đốc', dept: 'Ban Giám Đốc', active: true, perms: {} }
  ],
  operationOrderStoreMixedApprovalRules: [
    { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc siêu thị', username: null, stores: [] }
  ],
  uniformCatalog: [
    { id: 1, name: 'Áo Sơ Mi Nam', sizes: ['M', 'L'], codesBySize: { M: 'AS-M', L: 'AS-L' } }
  ],
  publicHolidays: [
    { date: '2027-01-01', name: 'Tết Dương Lịch' }
  ],
  attendanceHoConfig: { startTime: '08:00', endTime: '17:00', lateGraceMinutes: 0 },
  itRenewalCategories: ['Domain', 'Hosting'],
  trainingCategories: ['Kỹ Năng Mềm', 'Nghiệp Vụ'],
  trainingCourses: [
    { id: 1, code: 'CT-1', name: 'Kỹ Năng Giao Tiếp', category: 'Kỹ Năng Mềm', description: 'Khoá học cơ bản cho nhân viên mới.' }
  ],
  trainingTests: [
    {
      id: 1, title: 'Kiểm Tra An Toàn Lao Động', category: 'Nghiệp Vụ', passScore: 70,
      questions: [
        { id: 1, text: 'Khi phát hiện cháy, việc đầu tiên cần làm là gì?', type: 'SINGLE', points: 10, imageUrl: '', options: [{ id: 1, text: 'Báo động ngay' }, { id: 2, text: 'Bỏ chạy' }], correctOptionIds: [1] }
      ]
    }
  ],
  trainingDocuments: [
    {
      id: 1, code: 'TL-DT-1', title: 'Sổ Tay Nhân Viên', category: 'Nghiệp Vụ',
      description: 'Tài liệu bắt buộc đọc khi vào công ty.', mandatory: true, courseId: '',
      docType: 'DOCUMENT', fileUrl: '/uploads/fake_sotay.pdf', fileName: 'sotay-nhan-vien.pdf',
      fileType: 'application/pdf', createdAt: '01/01/2027 08:00:00'
    }
  ]
});

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1100, height: 900 });

  // Lớp thêm window.fetch — xem chú thích đầu file. Đặt SAU launchPage() để originalFetch chính là
  // window.fetch mà testHarness.js đã gán (nối dây __apiDispatch), không phải fetch gốc của trình duyệt.
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const bodyStr = (opts && typeof opts.body === 'string') ? opts.body : null;
      let body = {};
      try { body = bodyStr ? JSON.parse(bodyStr) : {}; } catch (e) { body = {}; }

      if (url === '/api/data/operationOrderStoreMixedApprovalRules' && method === 'POST') {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url === '/api/admin/renameCatalogEntry' && method === 'POST') {
        const arr = (DB[body.catalogKey] || []).map(v => v === body.oldValue ? body.newValue : v);
        return { ok: true, status: 200, json: async () => ({ catalog: arr }) };
      }
      const m = url.match(/^\/api\/records\/(trainingCourses|trainingTests|trainingDocuments)\/(\d+)\/edit$/);
      if (m && method === 'POST') {
        const modKey = m[1], id = Number(m[2]);
        const list = DB[modKey] || [];
        const idx = list.findIndex(x => x.id === id);
        const merged = Object.assign({}, list[idx], body, { id });
        return { ok: true, status: 200, json: async () => ({ ok: true, item: merged }) };
      }
      return originalFetch(url, opts);
    };
  });

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, DEMO_USER);
    await page.waitForTimeout(150);

    // GHI CHÚ (phát hiện phụ khi dựng demo, KHÔNG liên quan tới 6 nút Sửa đợt này): initDatabase()
    // (core.js) thiếu hẳn dòng "DB.operationOrderStoreMixedApprovalRules = data.operationOrderStoreMixedApprovalRules
    // || []" — MỌI collection khác đều có dòng gán tường minh này, riêng field này thì không, và 'system'
    // cũng không nằm trong TAB_DATA_GROUPS (lazy-load) — nghĩa là sau khi đăng nhập THẬT (tải lại trang),
    // bảng "Quy Trình Đặt Hàng Siêu Thị" trống dù server vẫn còn dữ liệu (chỉ tự "hồi lại" trong đúng phiên
    // trình duyệt đó sau khi admin thêm/sửa 1 dòng, vì renderMixedApprovalSection() tự init "[]" rồi
    // syncStorage() ghi đè). Test có sẵn (test-mixed-approval-edit-ui.js) né lỗi này bằng cách gán thẳng
    // DB.operationOrderStoreMixedApprovalRules trong page — demo ở đây làm y hệt để lên đúng ảnh, KHÔNG
    // tự ý vá lỗi này (ngoài phạm vi yêu cầu demo lần này, đã báo riêng cho người dùng).
    await page.evaluate((rules) => { DB.operationOrderStoreMixedApprovalRules = rules; }, state.operationOrderStoreMixedApprovalRules);

    // ===== 1) Quy Trình Đặt Hàng Siêu Thị — Cấu Hình Người Duyệt Theo Bước (mixed approval) =====
    await page.evaluate(async () => {
      await switchTab('system');
      setSystemSubTab('ADVWORKFLOW');
      setAdvWorkflowSubTab('MIXED');
    });
    await page.waitForTimeout(150);
    await shot(page, '#mixedApprovalSection', '1-mixed-approval-danh-sach.png');
    await page.evaluate(() => { document.querySelector('[data-op="editMixedApprovalRule"][data-arg0="1"]').click(); });
    await page.waitForTimeout(150);
    await shot(page, '#mixedApprovalSection', '2-mixed-approval-form-sua.png');
    await page.evaluate(async () => { document.getElementById('maNewStoresPicker'); await addMixedApprovalRule(); });
    await page.waitForTimeout(150);
    await shot(page, '#mixedApprovalSection', '3-mixed-approval-sau-khi-luu.png');

    // ===== 2) Danh Mục Đồng Phục =====
    await page.evaluate(async () => {
      await switchTab('uniform');
      setUniformSubTab('PERIODS');
    });
    await page.waitForTimeout(150);
    await shot(page, '#uniformCatalogListWrap', '4-dongphuc-danh-sach.png');
    await page.evaluate(() => { document.querySelector('[data-op="editUniformCatalogItem"][data-arg0="1"]').click(); });
    await page.waitForTimeout(150);
    await shot(page, '#uniformCatalogAdminForm', '5-dongphuc-form-sua.png');
    await page.evaluate(async () => { await saveUniformCatalogItem(); });
    await page.waitForTimeout(150);
    await shot(page, '#uniformCatalogListWrap', '6-dongphuc-sau-khi-luu.png');

    // ===== 3) Ngày Lễ (Công & Phép > Quản Lý & Cấu Hình) =====
    await page.evaluate(async () => {
      await switchTab('hrAttendance');
      setHrAttendanceView('MANAGE');
    });
    await page.waitForTimeout(150);
    await shot(page, '#hacViewManage', '7-ngayle-danh-sach.png');
    await page.evaluate(() => { editHacHoliday('2027-01-01'); });
    await page.waitForTimeout(150);
    await shot(page, '#hacHolidayModal', '8-ngayle-modal-sua.png');
    await page.evaluate(async () => { await submitHacHoliday({ preventDefault() {} }); });
    await page.waitForTimeout(150);
    await shot(page, '#hacViewManage', '9-ngayle-sau-khi-luu.png');

    // ===== 4) Danh Mục Loại Dịch Vụ (9/2026: DỜI sang Hệ Thống > Quản Trị > 🗂️ Quản Lý Danh Mục — không
    // còn nằm ở màn nghiệp vụ "Hỗ Trợ IT > Gia Hạn Dịch Vụ" nữa, xem chú thích renderItRenewalCategoryList()
    // ở module-itsupport-renewal.js — #itRenewalCategoryAdminBox không còn tồn tại, khối HTML mới cũng
    // không có id riêng nên chụp thẳng #itRenewalCategoryList, ul liệt kê danh mục). =====
    await page.evaluate(() => { window.__promptAnswer = 'Domain & SSL'; });
    await page.evaluate(async () => {
      await switchTab('system');
      setSystemSubTab('ADMIN');
      setAdminSubTab('CATALOG');
    });
    await page.waitForTimeout(150);
    await shot(page, '#itRenewalCategoryList', '10-loaidichvu-danh-sach.png');
    await page.evaluate(async () => { await renameItRenewalCategory('Domain'); });
    await page.waitForTimeout(150);
    await shot(page, '#itRenewalCategoryList', '11-loaidichvu-sau-khi-doi-ten.png');

    // ===== 5) Đào Tạo — Chương Trình =====
    await page.evaluate(async () => {
      await switchTab('internal');
      setInternalSubTab('TRAINING');
      setTrainingLmsTab('COURSES');
    });
    await page.waitForTimeout(150);
    await shot(page, '#trainingLmsCoursesPanel', '12-chuongtrinh-danh-sach.png');
    await page.evaluate(() => { document.querySelector('[data-op="editTrainingCourse"][data-arg0="1"]').click(); });
    await page.waitForTimeout(150);
    await shot(page, '#trainingLmsCoursesPanel', '13-chuongtrinh-form-sua.png');
    await page.evaluate(async () => { await submitTrainingCourse({ preventDefault() {} }); });
    await page.waitForTimeout(150);
    await shot(page, '#trainingLmsCoursesPanel', '14-chuongtrinh-sau-khi-luu.png');

    // ===== 6) Đào Tạo — Ngân Hàng Câu Hỏi (bài test) =====
    await page.evaluate(() => { setTrainingLmsTab('TESTS'); });
    await page.waitForTimeout(150);
    await shot(page, '#trainingLmsTestsPanel', '15-bantest-danh-sach.png');
    await page.evaluate(() => { document.querySelector('[data-op="editTrainingTest"][data-arg0="1"]').click(); });
    await page.waitForTimeout(150);
    await shot(page, '#trainingLmsTestsPanel', '16-bantest-form-sua.png');
    await page.evaluate(async () => { await submitTrainingTest({ preventDefault() {} }); });
    await page.waitForTimeout(150);
    await shot(page, '#trainingLmsTestsPanel', '17-bantest-sau-khi-luu.png');

    // ===== 7) Đào Tạo — Kho Tài Liệu =====
    await page.evaluate(() => { setTrainingLmsTab('DOCS'); });
    await page.waitForTimeout(150);
    await shot(page, '#trainingLmsDocsPanel', '18-kholieu-danh-sach.png');
    await page.evaluate(() => { document.querySelector('[data-op="editTrainingDocument"][data-arg0="1"]').click(); });
    await page.waitForTimeout(150);
    await shot(page, '#trainingLmsDocsPanel', '19-kholieu-form-sua.png');
    await page.evaluate(async () => { await submitTrainingDocument({ preventDefault() {} }); });
    await page.waitForTimeout(150);
    await shot(page, '#trainingLmsDocsPanel', '20-kholieu-sau-khi-luu.png');

    console.log('\n✅ Hoàn tất, ảnh lưu tại:', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => {
  console.error('Lỗi khi chạy demo-sua-buttons.js:', err);
  process.exitCode = 1;
});
