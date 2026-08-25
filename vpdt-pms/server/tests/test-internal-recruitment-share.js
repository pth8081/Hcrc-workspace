// tests/test-internal-recruitment-share.js — Truyền Thông Nội Bộ > Tuyển Dụng (RECRUITMENT) + Góc
// Chia Sẻ (SHARE). Both sub-tabs are smaller than News/Training so they share one file per the task.
//
// Tuyển Dụng: job posting creation, referral submission with CV upload, candidate status update,
// closing a job (and referrals to a closed job being rejected).
// Góc Chia Sẻ: any user can post, but it stays PENDING until an internalPostApprove holder
// approves/rejects it (internalPostApprove permission gate).
//
// Run: node server/tests/test-internal-recruitment-share.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8993;

function makeDummyCvFile() {
  const tmpPath = path.join(os.tmpdir(), 'cv-test.pdf');
  fs.writeFileSync(tmpPath, '%PDF-1.4 dummy cv content');
  return tmpPath;
}

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    const hr = makeUser({ username: 'hr.mai', name: 'Phạm Thị Mai', dept: 'Phòng Nhân Sự', perms: { internalRecruitmentCreate: true } });
    const staff = makeUser({ username: 'nv.binh', name: 'Lê Văn Bình', dept: 'Phòng CNTT', perms: {} });
    const approver = makeUser({ username: 'qtv.hoa', name: 'Ngô Thị Hoa', dept: 'Phòng Nhân Sự', perms: { internalPostApprove: true } });

    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((users) => { DB.users = users; }, [hr, staff, approver]);
    await page.evaluate((u) => finishLogin(u), hr);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('RECRUITMENT'); });

    let jobId = null;

    await run('HR (internalRecruitmentCreate) posts a job opening', async () => {
      await page.evaluate(() => {
        document.getElementById('rjTitle').value = 'Nhân viên Kế toán tổng hợp';
        document.getElementById('rjDescription').value = 'Phụ trách sổ sách kế toán và báo cáo thuế hàng tháng.';
        document.getElementById('rjRequirements').value = 'Tốt nghiệp Đại học chuyên ngành Kế toán, tối thiểu 1 năm kinh nghiệm.';
        document.getElementById('rjLocation').value = 'Trụ sở chính';
        document.getElementById('rjSlots').value = '1';
      });
      await page.evaluate(() => submitRecruitmentJob({ preventDefault() {}, target: { reset() {} } }));
      const jobs = await page.evaluate(() => DB.recruitmentJobs);
      assertEqual(jobs.length, 1, 'expected exactly 1 recruitment job');
      jobId = jobs[0].id;
      assertEqual(jobs[0].status, 'OPEN', 'new job should be OPEN');
      assertEqual(jobs[0].slots, 1, 'slots mismatch');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('Đã đăng tin tuyển dụng thành công')), 'expected success alert');
    });

    await run('staff without internalRecruitmentCreate is blocked from posting a job', async () => {
      await page.evaluate((u) => { currentUser = u; }, staff);
      await page.evaluate(() => { window.__alerts.length = 0; });
      await page.evaluate(() => {
        document.getElementById('rjTitle').value = 'Tin không được phép';
        document.getElementById('rjDescription').value = 'Nội dung...';
      });
      const countBefore = await page.evaluate(() => DB.recruitmentJobs.length);
      await page.evaluate(() => submitRecruitmentJob({ preventDefault() {}, target: { reset() {} } }));
      const countAfter = await page.evaluate(() => DB.recruitmentJobs.length);
      assertEqual(countAfter, countBefore, 'job count should not change when blocked');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('không có quyền đăng tin tuyển dụng')), `expected permission alert, got ${JSON.stringify(alerts)}`);
    });

    await run('any logged-in staff can refer a candidate with a CV upload', async () => {
      await page.evaluate((id) => { openRecruitmentReferModal(id); }, jobId);
      await page.evaluate(() => {
        document.getElementById('rrCandidateName').value = 'Nguyễn Thị Cẩm';
        document.getElementById('rrCandidatePhone').value = '0912345678';
        document.getElementById('rrCandidateEmail').value = 'cam.nguyen@example.com';
        document.getElementById('rrCandidateNote').value = 'Bạn cùng lớp đại học, làm kế toán 2 năm.';
      });
      await page.setInputFiles('#rrCvFile', makeDummyCvFile());
      await page.evaluate(() => submitRecruitmentReferral({ preventDefault() {} }));
      const referrals = await page.evaluate(() => DB.recruitmentReferrals);
      assertEqual(referrals.length, 1, 'expected exactly 1 referral');
      assertEqual(referrals[0].candidateName, 'Nguyễn Thị Cẩm', 'candidate name mismatch');
      assertEqual(referrals[0].status, 'NEW', 'new referral should start as NEW');
      assertEqual(referrals[0].jobTitle, 'Nhân viên Kế toán tổng hợp', 'jobTitle snapshot mismatch');
      assertEqual(referrals[0].referrerUsername, 'nv.binh', 'referrerUsername should be the logged-in user');
      assert(referrals[0].cvFileUrl && referrals[0].cvFileUrl.length > 0, 'cvFileUrl should be set from the upload');
    });

    await run('referral without a CV file is rejected client-side', async () => {
      await page.evaluate((id) => { openRecruitmentReferModal(id); }, jobId);
      await page.evaluate(() => {
        document.getElementById('rrCandidateName').value = 'Ứng Viên Không CV';
        document.getElementById('rrCandidatePhone').value = '0900000001';
      });
      await page.evaluate(() => { window.__alerts.length = 0; });
      const countBefore = await page.evaluate(() => DB.recruitmentReferrals.length);
      await page.evaluate(() => submitRecruitmentReferral({ preventDefault() {} }));
      const countAfter = await page.evaluate(() => DB.recruitmentReferrals.length);
      assertEqual(countAfter, countBefore, 'no referral should be created without a CV');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('Vui lòng tải lên CV')), `expected CV-required alert, got ${JSON.stringify(alerts)}`);
    });

    await run('HR updates the candidate status to CONTACTED with a note', async () => {
      await page.evaluate((u) => { currentUser = u; }, hr);
      const referralId = await page.evaluate(() => DB.recruitmentReferrals[0].id);
      await page.evaluate(() => { window.__promptQueue = ['Đã gọi điện hẹn phỏng vấn thứ 5 tuần này.']; });
      await page.evaluate((id) => setRecruitmentReferralStatusUi(id, 'CONTACTED'), referralId);
      const referral = await page.evaluate((id) => DB.recruitmentReferrals.find((r) => r.id === id), referralId);
      assertEqual(referral.status, 'CONTACTED', 'status should be updated to CONTACTED');
      assertEqual(referral.statusNote, 'Đã gọi điện hẹn phỏng vấn thứ 5 tuần này.', 'statusNote mismatch');
      assertEqual(referral.statusByName, 'Phạm Thị Mai', 'statusByName should be the HR user');
    });

    await run('HR closes the job posting', async () => {
      await page.evaluate((id) => closeRecruitmentJobUi(id), jobId);
      const job = await page.evaluate((id) => DB.recruitmentJobs.find((j) => j.id === id), jobId);
      assertEqual(job.status, 'CLOSED', 'job should be CLOSED');
    });

    await run('referring a candidate to a now-closed job is rejected', async () => {
      await page.evaluate((u) => { currentUser = u; }, staff);
      await page.evaluate((id) => { openRecruitmentReferModal(id); }, jobId);
      await page.evaluate(() => {
        document.getElementById('rrCandidateName').value = 'Ứng Viên Trễ Hạn';
        document.getElementById('rrCandidatePhone').value = '0900000002';
      });
      await page.setInputFiles('#rrCvFile', makeDummyCvFile());
      await page.evaluate(() => { window.__alerts.length = 0; });
      const countBefore = await page.evaluate(() => DB.recruitmentReferrals.length);
      await page.evaluate(() => submitRecruitmentReferral({ preventDefault() {} }));
      const countAfter = await page.evaluate(() => DB.recruitmentReferrals.length);
      assertEqual(countAfter, countBefore, 'no referral should be created for a closed job');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('đã đóng')), `expected closed-job alert, got ${JSON.stringify(alerts)}`);
    });

    let sharePostId = null;
    await run('any staff can post to Góc Chia Sẻ, but it stays PENDING until approved', async () => {
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('SHARE'); });
      await page.evaluate(() => {
        document.getElementById('internalTitle').value = 'Cảm nhận sau 1 năm gắn bó với công ty';
        document.getElementById('internalContent').value = 'Mình rất vui khi được làm việc cùng mọi người ở đây!';
      });
      await page.evaluate(() => submitInternalPost({ preventDefault() {}, target: { reset() {} } }));
      const posts = await page.evaluate(() => DB.internalPosts.filter((p) => p.type === 'SHARE'));
      assertEqual(posts.length, 1, 'expected exactly 1 SHARE post');
      sharePostId = posts[0].id;
      assertEqual(posts[0].status, 'PENDING', 'SHARE post from a non-approver should start PENDING');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('chờ được phê duyệt') || a.includes('sẽ hiển thị công khai sau khi được phê duyệt')), `expected pending-approval alert, got ${JSON.stringify(alerts)}`);
    });

    await run('a holder of internalPostApprove approves the pending SHARE post', async () => {
      await page.evaluate((u) => { currentUser = u; }, approver);
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('SHARE'); });
      await page.evaluate((id) => approveInternalPostAction(id), sharePostId);
      await page.evaluate(() => window.__runPendingConfirm());
      const post = await page.evaluate((id) => DB.internalPosts.find((p) => p.id === id), sharePostId);
      assertEqual(post.status, 'APPROVED', 'post should now be APPROVED');
      assertEqual(post.approvedByName, 'Ngô Thị Hoa', 'approvedByName should be the approver');
    });

    let secondSharePostId = null;
    await run('rejecting a pending SHARE post without a reason is blocked', async () => {
      await page.evaluate((u) => { currentUser = u; }, staff);
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('SHARE'); });
      await page.evaluate(() => {
        document.getElementById('internalTitle').value = 'Bài chia sẻ thứ hai';
        document.getElementById('internalContent').value = 'Nội dung bài chia sẻ thứ hai...';
      });
      await page.evaluate(() => submitInternalPost({ preventDefault() {}, target: { reset() {} } }));
      const posts = await page.evaluate(() => DB.internalPosts.filter((p) => p.type === 'SHARE' && p.status === 'PENDING'));
      assertEqual(posts.length, 1, 'expected exactly 1 still-pending SHARE post');
      secondSharePostId = posts[0].id;

      await page.evaluate((u) => { currentUser = u; }, approver);
      await page.evaluate(() => { window.__promptQueue = ['']; window.__alerts.length = 0; }); // empty reason
      await page.evaluate((id) => rejectInternalPostAction(id), secondSharePostId);
      const post = await page.evaluate((id) => DB.internalPosts.find((p) => p.id === id), secondSharePostId);
      assertEqual(post.status, 'PENDING', 'post should remain PENDING when no reject reason is given');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('Vui lòng nhập lý do từ chối')), `expected reason-required alert, got ${JSON.stringify(alerts)}`);
    });

    await run('rejecting with a reason moves the SHARE post to REJECTED', async () => {
      await page.evaluate(() => { window.__promptQueue = ['Nội dung chưa phù hợp với văn hoá công ty.']; });
      await page.evaluate((id) => rejectInternalPostAction(id), secondSharePostId);
      await page.evaluate(() => window.__runPendingConfirm());
      const post = await page.evaluate((id) => DB.internalPosts.find((p) => p.id === id), secondSharePostId);
      assertEqual(post.status, 'REJECTED', 'post should now be REJECTED');
      assertEqual(post.rejectReason, 'Nội dung chưa phù hợp với văn hoá công ty.', 'rejectReason mismatch');
      assertEqual(post.rejectedByName, 'Ngô Thị Hoa', 'rejectedByName should be the approver');
    });

    assertEqual(pageErrors.length, 0, `unexpected uncaught page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-internal-recruitment-share.js');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
