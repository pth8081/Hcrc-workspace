// tests/test-recruitment-worktime-filter.js — Tuyển Dụng (10/2026, theo yêu cầu người dùng):
//  - Thời Gian Làm Việc (#rjWorkTime): nhập -> payload -> hiện trên thẻ (chỉ khi có nhập); Sửa nạp lại.
//  - Lọc "Trạng Thái" (#rjFilterStatus): enum cố định OPEN/FILLED/CLOSED (KHÔNG thêm trạng thái mới, đã
//    chốt với người dùng "chỉ cần Đang tuyển/Đã tuyển đủ/Đã đóng").
//  - Biểu Mẫu: CORE_FIELD_MANIFEST.RECRUITMENT_JOB có rjWorkTime.
//
// Run: node tests/test-recruitment-worktime-filter.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8975;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();
  try {
    const hr = makeUser({ username: 'hr1', name: 'Nhân Sự', dept: 'Phòng Nhân Sự', perms: { internalRecruitmentCreate: true } });
    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((u) => {
      DB.users = [u];
      DB.recruitmentReferrals = [];
      DB.recruitmentJobs = [
        { id: 201, title: 'Thu ngân', description: 'Mô tả', contactInfo: '0901', status: 'OPEN', creator: 'hr1', creatorName: 'Nhân Sự', workTime: 'Toàn thời gian' },
        { id: 202, title: 'Bảo vệ', description: 'Mô tả', contactInfo: '0902', status: 'FILLED', creator: 'hr1', creatorName: 'Nhân Sự' },
        { id: 203, title: 'Kho', description: 'Mô tả', contactInfo: '0903', status: 'CLOSED', creator: 'hr1', creatorName: 'Nhân Sự' }
      ];
    }, hr);
    await page.evaluate((u) => finishLogin(u), hr);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('RECRUITMENT'); setRecruitmentTab('JOBS'); });

    const order = () => page.evaluate(() => [...document.querySelectorAll('#recruitmentJobsContainer .rj-card')].map(c => Number(c.dataset.jobId)));

    await run('thẻ có Thời gian LV khi job.workTime có nhập; KHÔNG hiện dòng khi rỗng', async () => {
      const r = await page.evaluate(() => {
        const withWt = document.querySelector('.rj-card[data-job-id="201"]');
        const noWt = document.querySelector('.rj-card[data-job-id="202"]');
        const map = (card) => Object.fromEntries([...card.querySelectorAll('.rj-field')].map(f => [f.querySelector('.rj-field-label').textContent.trim(), f.querySelector('.rj-field-value').textContent.trim()]));
        return { withWt: map(withWt), noWt: map(noWt) };
      });
      assertEqual(r.withWt['Thời gian LV'], 'Toàn thời gian', 'phải hiện Thời gian LV');
      assert(!('Thời gian LV' in r.noWt), 'không nhập thì không hiện dòng Thời gian LV');
    });

    await run('lọc Trạng Thái: options đúng OPEN/FILLED/CLOSED, không có "đang xử lý"', async () => {
      const opts = await page.evaluate(() => [...document.querySelectorAll('#rjFilterStatus option')].map(o => o.value));
      assertEqual(JSON.stringify(opts), JSON.stringify(['', 'OPEN', 'FILLED', 'CLOSED']), 'danh sách trạng thái');
    });

    await run('lọc Trạng Thái = FILLED -> chỉ còn tin 202', async () => {
      await page.selectOption('#rjFilterStatus', 'FILLED');
      assertEqual(JSON.stringify(await order()), JSON.stringify([202]), 'chỉ còn tin đã tuyển đủ');
      await page.selectOption('#rjFilterStatus', '');
      assertEqual(JSON.stringify(await order()), JSON.stringify([203, 202, 201]), 'bỏ lọc trả lại đủ 3 tin');
    });

    await run('Đăng tin mới có Thời Gian Làm Việc -> payload/DB lưu workTime; Sửa nạp lại #rjWorkTime', async () => {
      await page.evaluate(() => {
        document.getElementById('rjTitle').value = 'Nhân viên kho';
        document.getElementById('rjDescription').value = 'Xếp hàng kho';
        document.getElementById('rjContactInfo').value = '0909';
        document.getElementById('rjWorkTime').value = 'Ca sáng 7h-15h';
      });
      await page.evaluate(() => submitRecruitmentJob({ preventDefault() {} }));
      const job = await page.evaluate(() => DB.recruitmentJobs.find(j => j.title === 'Nhân viên kho'));
      assert(job, 'tin phải được tạo');
      assertEqual(job.workTime, 'Ca sáng 7h-15h', 'workTime');
      const cardText = await page.evaluate((id) => document.querySelector(`.rj-card[data-job-id="${id}"]`).textContent, job.id);
      assert(cardText.includes('Ca sáng 7h-15h'), 'thẻ phải hiện thời gian làm việc');
      await page.evaluate((id) => openEditRecruitmentJob(id), job.id);
      assertEqual(await page.evaluate(() => document.getElementById('rjWorkTime').value), 'Ca sáng 7h-15h', 'Sửa nạp lại workTime');
      await page.evaluate(() => cancelEditRecruitmentJob());
    });

    await run('Biểu Mẫu: CORE_FIELD_MANIFEST.RECRUITMENT_JOB có rjWorkTime', async () => {
      const ok = await page.evaluate(() => CORE_FIELD_MANIFEST.RECRUITMENT_JOB.some(f => f.id === 'rjWorkTime'));
      assert(ok, 'thiếu rjWorkTime trong manifest');
    });

    await run('không có on*=/style= nội tuyến trong danh sách tin', async () => {
      const html = await page.evaluate(() => document.getElementById('recruitmentJobsContainer').innerHTML);
      assert(!/\son[a-z]+="/i.test(html), 'on*= nội tuyến');
      assert(!/\sstyle="/i.test(html), 'style= nội tuyến');
    });

    assertEqual(pageErrors.length, 0, `unexpected page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
    summarize('test-recruitment-worktime-filter.js');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
