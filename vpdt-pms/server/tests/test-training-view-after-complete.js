// tests/test-training-view-after-complete.js — Đào Tạo: sau khi đăng ký ĐÃ HOÀN THÀNH (reg.result =
// PASSED/FAILED), học viên vẫn phải vào XEM LẠI được tài liệu/thông tin buổi học đã học — chỉ là xem
// lại, KHÔNG được đổi trạng thái/kết quả/tiến độ đã có (xem phần "LỖI ĐÃ VÁ (10/2026...)" ngay phía trên
// testHTML trong renderTrainingMyRegs(), module-internalcomms-daotao.js).
//
// Trước đây: nút "Vào Lớp Học" (cũng là cửa duy nhất để mở modal xem tài liệu/video/thông tin buổi học)
// CHỈ hiện khi reg.result còn REGISTERED — ngay khi có kết quả thì nút biến mất hoàn toàn, học viên hết
// đường quay lại xem, dù viewedDocumentIds/trainingDocumentProgress vẫn còn nguyên trong DB.
//
// Run: node server/tests/test-training-view-after-complete.js
const assert = require('assert');
const { setup, teardown, makeRunner, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 9001;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    const trainer = makeUser({ username: 'gv.linh', name: 'Trần Thị Linh', dept: 'Phòng Nhân Sự', perms: { trainingManage: true } });
    const nv1 = makeUser({ username: 'nv1', name: 'Học Viên Một', dept: 'Phòng CNTT', perms: {} });

    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((users) => { DB.users = users; }, [trainer, nv1]);
    await page.evaluate((u) => finishLogin(u), trainer);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); });

    // ========== Kịch bản 1: lớp ONLINE, có giáo trình bắt buộc + bài test ==========
    let docId = null, onlineClassId = null, testId = null;
    await run('[setup ONLINE] tạo 1 bài test + 1 tài liệu VIDEO bắt buộc + 1 lớp ONLINE gán cả 2', async () => {
      await page.evaluate(() => {
        tbQuestions = [{ text: 'Câu hỏi ATLĐ', type: 'SINGLE', points: 1, options: [{ text: 'Đúng', correct: true }, { text: 'Sai', correct: false }] }];
        document.getElementById('ttTitle').value = 'Bài Test Xem Lại';
        document.getElementById('ttCategory').value = 'Nghiệp vụ';
      });
      await page.evaluate(() => submitTrainingTest({ preventDefault() {} }));
      testId = (await page.evaluate(() => DB.trainingTests))[0].id;

      docId = await page.evaluate(() => {
        const d = { id: Date.now(), code: 'TL-VID-XL', category: 'Nghiệp vụ', title: 'Video Xem Lại', docType: 'VIDEO', mandatory: true, videoUrl: 'https://www.youtube.com/watch?v=xem123', uploaderUsername: 'gv.linh', uploaderName: 'Trần Thị Linh' };
        DB.trainingDocuments.unshift(d);
        return d.id;
      });

      await page.evaluate(({ tid, did }) => {
        document.getElementById('tcCategory').value = 'Nghiệp vụ';
        document.getElementById('tcTitle').value = 'Lớp ONLINE Xem Lại';
        document.getElementById('tcStart').value = '2020-01-01T08:00';
        document.getElementById('tcEnd').value = '2020-01-01T10:00';
        document.getElementById('tcMode').value = 'ONLINE';
        onTrainingClassModeChange();
        populateTrainingClassMultiSelects();
        document.getElementById('tcTestId').value = String(tid);
        document.getElementById('tcPassScore').value = '50';
        [...document.getElementById('tcDocumentIds').options].forEach((o) => { o.selected = Number(o.value) === did; });
      }, { tid: testId, did: docId });
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const cls = await page.evaluate(() => DB.trainingClasses.find((c) => c.title === 'Lớp ONLINE Xem Lại'));
      assert.ok(cls, 'expected the ONLINE class to be created');
      onlineClassId = cls.id;

      await page.evaluate((u) => { currentUser = u; }, nv1);
      await page.evaluate((id) => registerForTrainingClass(id), onlineClassId);
      await page.evaluate(() => setTrainingLmsTab('MY_REGS'));
    });

    await run('[ONLINE] xem xong video -> test tự mở -> nộp bài ĐẠT', async () => {
      await page.evaluate((id) => trackTrainingDocumentProgress(id, { kind: 'VIDEO', furthestSeconds: 195, durationSeconds: 200 }), docId);
      await page.waitForFunction(() => !document.getElementById('trainingTakeTestModal').classList.contains('hidden'), null, { timeout: 5000 });
      await page.evaluate(async () => {
        const total = ttTakeQuestions.length;
        for (let i = 0; i < total; i++) {
          const q = ttTakeQuestions[ttTakeIndex];
          q.correctOptionIds.forEach((optId) => ttTakeSelectOption(optId, true));
          await ttTakeGoNext();
        }
      });
      const reg = await page.evaluate((cid) => DB.trainingRegistrations.find((r) => r.classId === cid && r.creator === 'nv1'), onlineClassId);
      assertEqual(reg.result, 'PASSED', `expected nv1 to PASS, got ${reg.result}`);
    });

    await run('[ONLINE] sau khi ĐÃ HOÀN THÀNH -> vẫn có nút "Xem Lại Tài Liệu" (KHÔNG phải nút thi lại)', async () => {
      await page.evaluate(() => renderTrainingMyRegs());
      const html = await page.evaluate(() => document.getElementById('trainingMyRegsTableBody').innerHTML);
      assert.ok(html.includes('Xem Lại Tài Liệu'), 'phải còn nút "Xem Lại Tài Liệu" sau khi đã Hoàn thành');
      assert.ok(html.includes('data-op="openTrainingJoinClassModal"'), 'nút xem lại vẫn phải mở đúng modal Vào Lớp Học');
      assert.ok(!html.includes('Vào Làm Bài Test'), 'KHÔNG được còn nút "Vào Làm Bài Test" sau khi đã có kết quả');
      assert.ok(!html.includes('Cần xem hết tài liệu'), 'KHÔNG được còn thông báo nhắc xem tài liệu sau khi đã Hoàn thành');
      assert.ok(!html.includes('Vào Lớp Học<'), 'nhãn nút phải đổi thành "Xem Lại", không còn hiện "Vào Lớp Học" (ngụ ý còn đang học dở)');
    });

    await run('[ONLINE] mở lại modal xem tài liệu sau khi Hoàn thành -> vẫn thấy đúng badge "Đã xem", KHÔNG đổi gì tiến độ', async () => {
      const reg = await page.evaluate((cid) => DB.trainingRegistrations.find((r) => r.classId === cid && r.creator === 'nv1'), onlineClassId);
      await page.evaluate((regId) => openTrainingJoinClassModal(regId), reg.id);
      const bodyHtml = await page.evaluate(() => document.getElementById('trainingJoinClassBody').innerHTML);
      assert.ok(bodyHtml.includes('✅ Đã xem'), 'modal vẫn phải hiện đúng badge "Đã xem" cho tài liệu đã hoàn thành trước đó');
      assert.ok(bodyHtml.includes('▶️ Xem Video'), 'vẫn phải bấm vào xem lại được video đã học');
      const progressBefore = await page.evaluate((did) => DB.trainingDocumentProgress.find((p) => p.docId === did && p.username === 'nv1').completedAt, docId);
      // Xem lại không được làm mất/đổi mốc hoàn thành đã ghi nhận trước đó.
      assert.ok(progressBefore, 'completedAt phải còn nguyên sau khi mở lại modal xem (chỉ hiển thị, không ghi gì mới)');
      await page.evaluate(() => closeTrainingJoinClassModal());
    });

    // ========== Kịch bản 2: lớp OFFLINE đã Kết Thúc + đã chấm kết quả ==========
    let offlineClassId = null;
    await run('[setup OFFLINE] tạo 1 lớp OFFLINE, nv1 đăng ký, giảng viên Bắt Đầu + Kết Thúc lớp, ghi nhận kết quả ĐẠT', async () => {
      await page.evaluate((u) => { currentUser = u; }, trainer);
      await page.evaluate(() => {
        document.getElementById('tcCategory').value = 'Nghiệp vụ';
        document.getElementById('tcTitle').value = 'Lớp OFFLINE Xem Lại';
        document.getElementById('tcStart').value = '2020-01-01T08:00';
        document.getElementById('tcEnd').value = '2020-01-01T10:00';
        document.getElementById('tcMode').value = 'OFFLINE';
        onTrainingClassModeChange();
        document.getElementById('tcLocation').value = 'Phòng họp A';
      });
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const cls = await page.evaluate(() => DB.trainingClasses.find((c) => c.title === 'Lớp OFFLINE Xem Lại'));
      assert.ok(cls, 'expected the OFFLINE class to be created');
      offlineClassId = cls.id;

      await page.evaluate((u) => { currentUser = u; }, nv1);
      await page.evaluate((id) => registerForTrainingClass(id), offlineClassId);

      await page.evaluate((u) => { currentUser = u; }, trainer);
      await page.evaluate((id) => startOfflineTrainingClassAction(id), offlineClassId);
      await page.evaluate((id) => endOfflineTrainingClassAction(id), offlineClassId);

      const reg = await page.evaluate((cid) => DB.trainingRegistrations.find((r) => r.classId === cid && r.creator === 'nv1'), offlineClassId);
      await page.evaluate(async (regId) => {
        const res = await callRecordAction('trainingRegistrations', regId, 'set-result', { result: 'PASSED', score: 90 });
        const idx = DB.trainingRegistrations.findIndex((x) => x.id === regId);
        if (idx !== -1) DB.trainingRegistrations[idx] = res.item;
      }, reg.id);
      const updated = await page.evaluate((cid) => DB.trainingRegistrations.find((r) => r.classId === cid && r.creator === 'nv1'), offlineClassId);
      assertEqual(updated.result, 'PASSED', 'expected the OFFLINE registration to be graded PASSED');
    });

    await run('[OFFLINE] sau khi lớp đã Kết Thúc + đã chấm ĐẠT -> vẫn có nút "Xem Lại Buổi Học"', async () => {
      await page.evaluate((u) => { currentUser = u; }, nv1);
      await page.evaluate(() => { setTrainingLmsTab('MY_REGS'); renderTrainingMyRegs(); });
      const html = await page.evaluate(() => document.getElementById('trainingMyRegsTableBody').innerHTML);
      assert.ok(html.includes('Xem Lại Buổi Học'), 'phải còn nút "Xem Lại Buổi Học" cho lớp OFFLINE đã hoàn thành');
      assert.ok(!html.includes('Kết Thúc Lớp') , 'KHÔNG được còn thông báo khoá bài test (lớp đã hoàn thành, không còn liên quan)');
    });

    assertEqual(pageErrors.length, 0, `unexpected uncaught page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-training-view-after-complete.js');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
