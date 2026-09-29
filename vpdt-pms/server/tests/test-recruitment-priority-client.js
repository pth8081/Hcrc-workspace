// tests/test-recruitment-priority-client.js — Tuyển Dụng (9/2026), phía CLIENT (renderRecruitmentJobs()):
//  - Thu Nhập (#rjIncome): nhập -> payload -> hiện IN ĐẬM trên thẻ; Sửa nạp lại.
//  - 🔥 Đẩy ưu tiên / Bỏ đẩy ưu tiên: nút chỉ cho người quản lý; tin ưu tiên nổi lên ĐẦU danh sách chính
//    (pinnedAt mới nhất trước), phần còn lại giữ sort id giảm dần; badge "🔥 Tin ưu tiên".
//  - Lọc "Vị trí đang tuyển" (#rjFilterTitle) — mirror populateRecruitmentJobsMonthFilter().
//  - Thẻ 2 cột: ảnh vuông object-contain (placeholder khi không có banner), nhãn-giá trị in đậm,
//    Mô tả/Yêu cầu ẩn mặc định + nút "Xem chi tiết ▾" mở/thu tại chỗ.
//
// Run: node tests/test-recruitment-priority-client.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8974;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();
  try {
    const hr = makeUser({ username: 'hr1', name: 'Nhân Sự', dept: 'Phòng Nhân Sự', perms: { internalRecruitmentCreate: true } });
    const staff = makeUser({ username: 'nv1', name: 'Nhân Viên', dept: 'Phòng Kế Toán', perms: {} });
    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate(([a, b]) => {
      DB.users = [a, b];
      DB.recruitmentReferrals = [];
      DB.recruitmentJobs = [
        { id: 101, title: 'Bảo vệ', description: 'Mô tả bảo vệ', requirements: 'Yêu cầu BV', contactInfo: '0901', status: 'OPEN', creator: 'hr1', creatorName: 'Nhân Sự', slots: 2, location: 'Q1', income: '7 triệu', bannerUrl: '/uploads/bv.png' },
        { id: 102, title: 'Thu ngân', description: 'Mô tả thu ngân', contactInfo: '0902', status: 'OPEN', creator: 'hr1', creatorName: 'Nhân Sự', slots: 0 },
        { id: 103, title: 'Bảo vệ', description: 'Mô tả BV đợt 2', contactInfo: '0903', status: 'OPEN', creator: 'hr1', creatorName: 'Nhân Sự' },
        { id: 104, title: 'Kho', description: 'Mô tả kho', contactInfo: '0904', status: 'OPEN', creator: 'hr1', creatorName: 'Nhân Sự' }
      ];
    }, [hr, staff]);
    await page.evaluate((u) => finishLogin(u), hr);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('RECRUITMENT'); setRecruitmentTab('JOBS'); });

    const order = () => page.evaluate(() => [...document.querySelectorAll('#recruitmentJobsContainer .rj-card')].map(c => Number(c.dataset.jobId)));

    await run('sort mặc định: không có tin ưu tiên -> id giảm dần', async () => {
      assertEqual(JSON.stringify(await order()), JSON.stringify([104, 103, 102, 101]), 'thứ tự');
    });

    await run('người quản lý thấy nút "🔥 Đẩy ưu tiên"; bấm -> tin nổi lên đầu + badge "🔥 Tin ưu tiên"', async () => {
      const btns = await page.evaluate(() => document.querySelectorAll('#recruitmentJobsContainer [data-op="pinRecruitmentJobUi"]').length);
      assertEqual(btns, 4, 'mỗi tin OPEN có 1 nút đẩy ưu tiên');
      // #internalRecruitmentSection lồng trong #internalSection (2 gốc CSP) — 1 click chỉ được hỏi xác nhận
      // ĐÚNG 1 lần và gọi API đúng 1 lần (không lần thứ 2 dính 409 "đã được đẩy ưu tiên").
      await page.evaluate(() => { window.__confirmCount = 0; window.__alerts.length = 0; window.confirm = () => { window.__confirmCount++; return true; }; });
      await page.click('.rj-card[data-job-id="102"] [data-op="pinRecruitmentJobUi"]');
      await page.waitForFunction(() => DB.recruitmentJobs.find(j => j.id === 102).pinned === true);
      await page.waitForTimeout(150);
      const dup = await page.evaluate(() => ({ confirms: window.__confirmCount, alerts: window.__alerts.slice() }));
      assertEqual(dup.confirms, 1, 'chỉ hỏi xác nhận 1 lần');
      assertEqual(dup.alerts.length, 0, `không được có lỗi gọi trùng: ${JSON.stringify(dup.alerts)}`);
      assertEqual(JSON.stringify(await order()), JSON.stringify([102, 104, 103, 101]), 'tin 102 lên đầu');
      const badge = await page.evaluate(() => document.querySelector('.rj-card[data-job-id="102"]').innerHTML.includes('🔥 Tin ưu tiên'));
      assert(badge, 'phải có badge Tin ưu tiên');
      const unpinBtn = await page.evaluate(() => !!document.querySelector('.rj-card[data-job-id="102"] [data-op="unpinRecruitmentJobUi"]'));
      assert(unpinBtn, 'tin đã đẩy phải có nút Bỏ đẩy ưu tiên');
    });

    await run('đẩy thêm tin 101 (mới hơn) -> 101 đứng trước 102 (pinnedAt mới nhất trước), còn lại id giảm dần', async () => {
      await page.waitForTimeout(20);
      await page.click('.rj-card[data-job-id="101"] [data-op="pinRecruitmentJobUi"]');
      await page.waitForFunction(() => DB.recruitmentJobs.find(j => j.id === 101).pinned === true);
      assertEqual(JSON.stringify(await order()), JSON.stringify([101, 102, 104, 103]), 'thứ tự ưu tiên');
    });

    await run('Bỏ đẩy ưu tiên tin 101 -> quay về đúng vị trí theo id', async () => {
      await page.click('.rj-card[data-job-id="101"] [data-op="unpinRecruitmentJobUi"]');
      await page.waitForFunction(() => !DB.recruitmentJobs.find(j => j.id === 101).pinned);
      assertEqual(JSON.stringify(await order()), JSON.stringify([102, 104, 103, 101]), 'thứ tự sau khi bỏ');
    });

    await run('nhân viên thường: KHÔNG thấy nút đẩy/bỏ ưu tiên, vẫn thấy badge; gọi thẳng action bị 403', async () => {
      await page.evaluate((u) => { currentUser = u; renderRecruitmentJobs(); }, staff);
      const r = await page.evaluate(() => ({
        pinBtns: document.querySelectorAll('[data-op="pinRecruitmentJobUi"],[data-op="unpinRecruitmentJobUi"]').length,
        badge: document.querySelector('.rj-card[data-job-id="102"]').innerHTML.includes('🔥 Tin ưu tiên')
      }));
      assertEqual(r.pinBtns, 0, 'không được thấy nút');
      assert(r.badge, 'vẫn thấy badge');
      const err = await page.evaluate(() => callRecordAction('recruitmentJobs', 104, 'pin', {}).then(() => null, e => e.message));
      assert(err && err.includes('quyền'), `phải bị chặn: ${err}`);
      await page.evaluate((u) => { currentUser = u; renderRecruitmentJobs(); }, hr);
    });

    await run('lọc "Vị trí đang tuyển": các tiêu đề khác nhau, chọn "Bảo vệ" chỉ còn 2 tin Bảo vệ', async () => {
      const opts = await page.evaluate(() => [...document.querySelectorAll('#rjFilterTitle option')].map(o => o.value));
      assertEqual(JSON.stringify(opts), JSON.stringify(['', 'Bảo vệ', 'Kho', 'Thu ngân']), 'danh sách vị trí (không trùng, sắp A-Z)');
      await page.selectOption('#rjFilterTitle', 'Bảo vệ');
      assertEqual(JSON.stringify(await order()), JSON.stringify([103, 101]), 'chỉ còn Bảo vệ');
      await page.selectOption('#rjFilterTitle', '');
    });

    await run('thẻ 2 cột: ảnh vuông object-contain khi có banner, placeholder khi không; nhãn-giá trị in đậm', async () => {
      const r = await page.evaluate(() => {
        const withBanner = document.querySelector('.rj-card[data-job-id="101"]');
        const noBanner = document.querySelector('.rj-card[data-job-id="104"]');
        const img = withBanner.querySelector('.rj-thumb img');
        return {
          imgClass: img && img.className, imgSrc: img && img.getAttribute('src'),
          thumbBoxClass: withBanner.querySelector('.rj-thumb').className,
          placeholder: !!noBanner.querySelector('.rj-thumb-placeholder') && !noBanner.querySelector('.rj-thumb img'),
          labels: [...withBanner.querySelectorAll('.rj-field')].map(f => [f.querySelector('.rj-field-label').textContent.trim(), f.querySelector('.rj-field-value').textContent.trim(), f.querySelector('.rj-field-value').className.includes('font-bold')])
        };
      });
      assert(r.imgClass.includes('object-contain') && !r.imgClass.includes('object-cover'), `ảnh phải object-contain: ${r.imgClass}`);
      assertEqual(r.imgSrc, '/uploads/bv.png', 'nguồn ảnh');
      assert(/w-2\d|w-3\d/.test(r.thumbBoxClass) && /h-2\d|h-3\d/.test(r.thumbBoxClass), `khung ảnh vuông cố định: ${r.thumbBoxClass}`);
      assert(r.placeholder, 'tin không banner phải có placeholder');
      const map = Object.fromEntries(r.labels.map(([l, v]) => [l, v]));
      assertEqual(map['Thu nhập'], '7 triệu', 'Thu nhập');
      assert(map['Địa chỉ'].includes('Q1'), 'Địa chỉ');
      assertEqual(map['Số lượng'], '2 người', 'Số lượng');
      assertEqual(map['Liên hệ'], '0901', 'Liên hệ');
      assert(r.labels.every(x => x[2]), 'mọi giá trị phải in đậm');
      const title = await page.evaluate(() => document.querySelector('.rj-card[data-job-id="101"] h4').className);
      assert(title.includes('font-bold'), 'tiêu đề in đậm');
    });

    await run('Mô tả/Yêu cầu ẩn mặc định; "Xem chi tiết ▾" mở tại chỗ, bấm lại thu gọn; giữ trạng thái khi render lại', async () => {
      const hidden = await page.evaluate(() => document.querySelector('.rj-card[data-job-id="101"] .rj-detail').classList.contains('hidden'));
      assert(hidden, 'mặc định phải ẩn');
      await page.click('.rj-card[data-job-id="101"] [data-op="toggleRecruitmentJobDetail"]');
      let s = await page.evaluate(() => { const c = document.querySelector('.rj-card[data-job-id="101"]'); return { hidden: c.querySelector('.rj-detail').classList.contains('hidden'), text: c.querySelector('.rj-detail').textContent, btn: c.querySelector('[data-op="toggleRecruitmentJobDetail"]').textContent }; });
      assert(!s.hidden && s.text.includes('Mô tả bảo vệ') && s.text.includes('Yêu cầu BV'), 'phải hiện mô tả + yêu cầu');
      assert(s.btn.includes('Thu gọn'), `nút đổi nhãn: ${s.btn}`);
      await page.evaluate(() => renderRecruitmentJobs());
      s = await page.evaluate(() => document.querySelector('.rj-card[data-job-id="101"] .rj-detail').classList.contains('hidden'));
      assert(!s, 'render lại vẫn giữ trạng thái mở');
      await page.click('.rj-card[data-job-id="101"] [data-op="toggleRecruitmentJobDetail"]');
      s = await page.evaluate(() => document.querySelector('.rj-card[data-job-id="101"] .rj-detail').classList.contains('hidden'));
      assert(s, 'bấm lại phải thu gọn');
    });

    await run('Đăng tin mới có Thu Nhập -> payload/DB có income, thẻ hiện; Sửa nạp lại #rjIncome', async () => {
      await page.evaluate(() => {
        document.getElementById('rjTitle').value = 'Nhân viên bán hàng';
        document.getElementById('rjDescription').value = 'Bán hàng';
        document.getElementById('rjContactInfo').value = '0909';
        document.getElementById('rjIncome').value = '8-10 triệu';
      });
      await page.evaluate(() => submitRecruitmentJob({ preventDefault() {} }));
      const job = await page.evaluate(() => DB.recruitmentJobs.find(j => j.title === 'Nhân viên bán hàng'));
      assert(job, 'tin phải được tạo');
      assertEqual(job.income, '8-10 triệu', 'income');
      assertEqual(job.pinned, false, 'tin mới không ưu tiên');
      const cardText = await page.evaluate((id) => document.querySelector(`.rj-card[data-job-id="${id}"]`).textContent, job.id);
      assert(cardText.includes('8-10 triệu'), 'thẻ phải hiện thu nhập');
      await page.evaluate((id) => openEditRecruitmentJob(id), job.id);
      assertEqual(await page.evaluate(() => document.getElementById('rjIncome').value), '8-10 triệu', 'Sửa nạp lại income');
      await page.evaluate(() => cancelEditRecruitmentJob());
    });

    await run('Biểu Mẫu: CORE_FIELD_MANIFEST.RECRUITMENT_JOB có rjIncome', async () => {
      const ok = await page.evaluate(() => CORE_FIELD_MANIFEST.RECRUITMENT_JOB.some(f => f.id === 'rjIncome'));
      assert(ok, 'thiếu rjIncome trong manifest');
    });

    await run('không có on*=/style= nội tuyến trong danh sách tin', async () => {
      const html = await page.evaluate(() => document.getElementById('recruitmentJobsContainer').innerHTML);
      assert(!/\son[a-z]+="/i.test(html), 'on*= nội tuyến');
      assert(!/\sstyle="/i.test(html), 'style= nội tuyến');
    });

    assertEqual(pageErrors.length, 0, `unexpected page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
    summarize('test-recruitment-priority-client.js');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
