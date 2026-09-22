// server/tests/demo-sua-buttons-2.js
//
// Demo (theo yêu cầu người dùng "Bạn thực hiện xong và merge sau đó gửi ảnh demo nhé") — chụp ảnh màn
// hình 4 nút "✏️ Sửa" mới thêm (đợt rà soát tiếp theo #223-229, v23.88):
//   1. Lộ Trình Thăng Tiến — Truyền Thông Nội Bộ > Đào Tạo (module-internalcomms-daotao.js)
//   2. Tin Tuyển Dụng — Truyền Thông Nội Bộ > Tuyển Dụng (module-internalcomms-nhipsong.js)
//   3. Việc Con (subtask) — Công Việc, modal "Cập Nhật Tiến Độ" (module-congviec.js)
//   4. Kỳ Cấp Phát Đồng Phục — Đồng Phục (module-dongphuc.js)
//
// Dùng testHarness.js (đăng nhập thật qua proceedAfterAuth(), điều hướng thật qua switchTab()/setXxxSubTab())
// cho hạ tầng chung. uniformPeriods:edit đã có sẵn trong buildActionHandlers() của testHarness.js (gọi
// THẲNG recordActions.editUniformPeriod() thật, không cần lớp giả). careerPaths/edit, recruitmentJobs/edit,
// tasks/:id/edit-subtask CHƯA có trong testHarness.js dùng chung (chỉ có trong _mock-backend.js của
// _harness.js, hạ tầng khác) — thêm 1 lớp window.fetch mỏng CHỈ cho demo này (không sửa testHarness.js
// dùng chung cho mọi test khác, cùng đúng tinh thần demo-sua-buttons.js gốc), merge nông y hệt.
//
// Chạy: node server/tests/demo-sua-buttons-2.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8992;
const OUT_DIR = process.env.SUA_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'sua-buttons-2');

const DEMO_USER = {
  username: 'demo_admin', name: 'Quản Trị Viên Demo', dept: 'Phòng Nhân Sự',
  perms: { admin: true }, totpEnabled: true, active: true
};

const state = createMockState({
  depts: ['Phòng Nhân Sự', 'Phòng IT'],
  stores: ['Siêu Thị Hội An', 'Siêu Thị Đà Nẵng'],
  users: [
    DEMO_USER,
    { username: 'staff.it', name: 'Nhân Viên IT', dept: 'Phòng IT', active: true, perms: {} }
  ],
  trainingCourses: [
    { id: 1, code: 'CT-1', name: 'Kỹ Năng Giao Tiếp', category: 'Kỹ Năng Mềm' },
    { id: 2, code: 'CT-2', name: 'Quản Lý Đội Nhóm', category: 'Nghiệp Vụ' }
  ],
  careerPaths: [
    {
      id: 1, code: 'LT-1', name: 'Lộ Trình Vận Hành', targetTitle: 'Trưởng Phòng Vận Hành',
      description: 'Lộ trình mẫu cho demo.',
      stages: [
        { name: 'Trưởng Nhóm', requiredCourseIds: [1] },
        { name: 'Trưởng Phòng', requiredCourseIds: [2] }
      ],
      creator: 'demo_admin', creatorName: 'Quản Trị Viên Demo', dept: 'Phòng Nhân Sự'
    }
  ],
  careerPathConfirmations: [],
  recruitmentJobs: [
    {
      id: 1, title: 'Nhân Viên Kế Toán Tổng Hợp', description: 'Phụ trách sổ sách kế toán và báo cáo thuế hàng tháng.',
      requirements: 'Tốt nghiệp Đại học chuyên ngành Kế toán.', location: 'Trụ sở chính',
      slots: 1, deadline: '2027-03-01', month: '2027-02', hiringDept: 'Phòng Nhân Sự',
      contactInfo: 'hr.demo@company.com - 0900000010', bannerUrl: '', bannerFileName: '',
      status: 'OPEN', filledBy: null, filledByName: null, filledAt: null,
      creator: 'demo_admin', creatorName: 'Quản Trị Viên Demo', dept: 'Phòng Nhân Sự'
    }
  ],
  recruitmentReferrals: [],
  tasks: [
    {
      id: 1, title: 'Chuẩn bị hồ sơ dự thầu', description: 'Tổng hợp hồ sơ năng lực.',
      assignedTo: 'demo_admin', assignedToName: 'Quản Trị Viên Demo',
      assignedBy: 'demo_admin', assignedByName: 'Quản Trị Viên Demo',
      status: 'DOING', deadline: '2027-06-30', startedAt: '01/01/2027 08:00:00',
      collaboratorAccepts: [], subtasks: [{ id: 1, title: 'Xin báo giá nhà cung cấp', dueDate: '2027-06-20', done: false }],
      progressHistory: [], extensionCount: 0, lateCount: 0, pendingExtension: null, pendingCancellation: null
    }
  ],
  uniformCatalog: [
    { id: 1, name: 'Áo Sơ Mi Nam', sizes: ['M', 'L'], codesBySize: { M: 'AS-M', L: 'AS-L' } }
  ],
  uniformPeriods: [
    {
      id: 1, name: 'Đợt hè 2027', note: 'Cấp phát định kỳ.', approvalStatus: 'APPROVED',
      allocations: [{ dept: 'Siêu Thị Hội An', status: 'PENDING_CONFIRM', items: [{ name: 'Áo Sơ Mi Nam', size: 'M', qty: 10 }] }],
      creator: 'demo_admin', creatorName: 'Quản Trị Viên Demo', createdAt: '01/01/2027 08:00:00'
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

  // Lớp thêm window.fetch — CHỈ cho 3 route chưa có trong testHarness.js dùng chung (xem chú thích đầu
  // file). uniformPeriods/:id/edit KHÔNG cần ở đây — đã có sẵn trong testHarness.js, gọi thẳng
  // recordActions.editUniformPeriod() thật.
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const bodyStr = (opts && typeof opts.body === 'string') ? opts.body : null;
      let body = {};
      try { body = bodyStr ? JSON.parse(bodyStr) : {}; } catch (e) { body = {}; }

      let m = url.match(/^\/api\/records\/careerPaths\/(\d+)\/edit$/);
      if (m) {
        const id = Number(m[1]);
        const idx = DB.careerPaths.findIndex(x => x.id === id);
        const merged = Object.assign({}, DB.careerPaths[idx], body, { id });
        return { ok: true, status: 200, json: async () => ({ ok: true, item: merged }) };
      }
      m = url.match(/^\/api\/records\/recruitmentJobs\/(\d+)\/edit$/);
      if (m) {
        const id = Number(m[1]);
        const idx = DB.recruitmentJobs.findIndex(x => x.id === id);
        const merged = Object.assign({}, DB.recruitmentJobs[idx], body, { id });
        return { ok: true, status: 200, json: async () => ({ ok: true, item: merged }) };
      }
      m = url.match(/^\/api\/records\/tasks\/(\d+)\/edit-subtask$/);
      if (m) {
        const id = Number(m[1]);
        const task = DB.tasks.find(x => x.id === id);
        const sub = (task.subtasks || []).find(s => s.id === body.subtaskId);
        if (sub) { sub.title = body.title; sub.dueDate = body.dueDate; }
        return { ok: true, status: 200, json: async () => ({ ok: true, item: task }) };
      }
      return originalFetch(url, opts);
    };
  });

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, DEMO_USER);
    await page.waitForTimeout(150);

    // ===== 1) Lộ Trình Thăng Tiến (Truyền Thông Nội Bộ > Đào Tạo) =====
    await page.evaluate(async () => {
      await switchTab('internal');
      setInternalSubTab('TRAINING');
      setTrainingLmsTab('PATHS');
    });
    await page.waitForTimeout(150);
    await shot(page, '#trainingLmsPathsPanel', '1-lotrinh-danh-sach.png');
    await page.evaluate(() => { document.querySelector('[data-op="openEditCareerPath"][data-arg0="1"]').click(); });
    await page.waitForTimeout(150);
    await shot(page, '#careerPathForm', '2-lotrinh-form-sua.png');
    await page.evaluate(() => { document.getElementById('cpName').value = 'Lộ Trình Vận Hành (đã cập nhật)'; });
    await page.evaluate(async () => { await submitCareerPath({ preventDefault() {}, target: { reset() {} } }); });
    await page.waitForTimeout(150);
    await shot(page, '#trainingLmsPathsPanel', '3-lotrinh-sau-khi-luu.png');

    // ===== 2) Tin Tuyển Dụng (Truyền Thông Nội Bộ > Tuyển Dụng) =====
    await page.evaluate(async () => {
      await switchTab('internal');
      setInternalSubTab('RECRUITMENT');
    });
    await page.waitForTimeout(150);
    await shot(page, '#recruitmentJobsContainer', '4-tuyendung-danh-sach.png');
    await page.evaluate(() => { document.querySelector('[data-op="openEditRecruitmentJob"][data-arg0="1"]').click(); });
    await page.waitForTimeout(150);
    await shot(page, '#recruitmentJobForm', '5-tuyendung-form-sua.png');
    await page.evaluate(() => { document.getElementById('rjTitle').value = 'Nhân Viên Kế Toán Tổng Hợp (đã cập nhật)'; });
    await page.evaluate(async () => { await submitRecruitmentJob({ preventDefault() {}, target: { reset() {} } }); });
    await page.waitForTimeout(150);
    await shot(page, '#recruitmentJobsContainer', '6-tuyendung-sau-khi-luu.png');

    // ===== 3) Việc Con (Công Việc > modal Cập Nhật Tiến Độ) =====
    await page.evaluate(async () => { await switchTab('task'); });
    await page.waitForTimeout(150);
    await page.evaluate(() => { openTaskProgressModal(1); });
    await page.waitForTimeout(150);
    await shot(page, '#taskProgressModal', '7-viecon-danh-sach.png');
    await page.evaluate(() => { openEditSubtask(1); });
    await page.waitForTimeout(150);
    await shot(page, '#progressSubtasksWrap', '8-viecon-form-sua.png');
    await page.evaluate(() => { document.getElementById('newSubtaskTitle').value = 'Xin báo giá nhà cung cấp (đã cập nhật)'; });
    await page.evaluate(async () => { await addSubtaskAction(); });
    await page.waitForTimeout(150);
    await shot(page, '#progressSubtasksWrap', '9-viecon-sau-khi-luu.png');

    // ===== 4) Kỳ Cấp Phát Đồng Phục (Đồng Phục) =====
    await page.evaluate(async () => {
      await switchTab('uniform');
      setUniformSubTab('PERIODS');
    });
    await page.waitForTimeout(150);
    await shot(page, '#uniformPeriodsListWrap', '10-dongphuc-ky-danh-sach.png');
    await page.evaluate(() => { document.querySelector('[data-op="openEditUniformPeriod"][data-arg0="1"]').click(); });
    await page.waitForTimeout(150);
    await shot(page, '#genericConfirmModal', '11-dongphuc-ky-modal-sua.png');
    await page.evaluate(() => { document.getElementById('uniformPeriodEditName').value = 'Đợt hè 2027 (đã cập nhật)'; });
    await page.evaluate(() => { document.getElementById('genericConfirmOkBtn').click(); });
    await page.waitForTimeout(150);
    await shot(page, '#uniformPeriodsListWrap', '12-dongphuc-ky-sau-khi-luu.png');

    console.log('\n✅ Hoàn tất, ảnh lưu tại:', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => {
  console.error('Lỗi khi chạy demo-sua-buttons-2.js:', err);
  process.exitCode = 1;
});
