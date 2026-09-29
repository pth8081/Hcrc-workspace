// tests/test-training-auto-open-test.js — Đào Tạo: TỰ ĐỘNG mở modal "Vào Làm Bài Test" ngay sau khi
// học viên xem hết TOÀN BỘ tài liệu bắt buộc của lớp (video đạt ~95% / PDF hết mọi trang), thay vì bắt
// học viên tự tìm nút "📝 Vào Làm Bài Test" (module-internalcomms-daotao.js:
// maybeAutoOpenTrainingTestAfterDocsCompleted(), gọi từ trackTrainingDocumentProgress()).
//
// Logic chấm điểm tự động + luồng PENDING_ESSAY_GRADING đã có sẵn đầy đủ ở lib/recordActions.js — bài
// test này CHỈ xác nhận đúng bước TRIGGER mở popup (và các điều kiện chặn/không lặp lại), không đụng gì
// tới chấm điểm.
//
// Run: node server/tests/test-training-auto-open-test.js
const assert = require('assert');
const { setup, teardown, makeRunner, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8997;

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

    let testId = null;
    await run('[setup] trainer tạo 1 bài test 1 câu hỏi', async () => {
      await page.evaluate(() => {
        tbQuestions = [{ text: 'Câu hỏi ATLĐ', type: 'SINGLE', points: 1, options: [{ text: 'Đúng', correct: true }, { text: 'Sai', correct: false }] }];
        document.getElementById('ttTitle').value = 'Bài Test ATLĐ Tự Mở';
        document.getElementById('ttCategory').value = 'Nghiệp vụ';
      });
      await page.evaluate(() => submitTrainingTest({ preventDefault() {} }));
      const tests = await page.evaluate(() => DB.trainingTests);
      testId = tests[0].id;
      assert.ok(testId, 'expected the test to be created');
    });

    let docAId = null, docBId = null, classId = null;
    await run('[setup] lớp ONLINE với 2 video bắt buộc + gán bài test, endTime đã qua', async () => {
      const docs = await page.evaluate(() => {
        const a = { id: Date.now(), code: 'TL-VID-A', category: 'Nghiệp vụ', title: 'Video A', docType: 'VIDEO', mandatory: true, videoUrl: 'https://www.youtube.com/watch?v=aaa111', uploaderUsername: 'gv.linh', uploaderName: 'Trần Thị Linh' };
        const b = { id: Date.now() + 1, code: 'TL-VID-B', category: 'Nghiệp vụ', title: 'Video B', docType: 'VIDEO', mandatory: true, videoUrl: 'https://www.youtube.com/watch?v=bbb222', uploaderUsername: 'gv.linh', uploaderName: 'Trần Thị Linh' };
        DB.trainingDocuments.unshift(a, b);
        return [a, b];
      });
      docAId = docs[0].id; docBId = docs[1].id;

      await page.evaluate(({ tid, ids }) => {
        document.getElementById('tcCategory').value = 'Nghiệp vụ';
        document.getElementById('tcTitle').value = 'Lớp Tự Mở Bài Test';
        document.getElementById('tcStart').value = '2020-01-01T08:00';
        document.getElementById('tcEnd').value = '2020-01-01T10:00'; // đã qua từ lâu
        document.getElementById('tcMode').value = 'ONLINE';
        onTrainingClassModeChange();
        populateTrainingClassMultiSelects(); // nạp lại option của tcTestId/tcDocumentIds -> PHẢI gán giá trị SAU bước này
        document.getElementById('tcTestId').value = String(tid);
        document.getElementById('tcPassScore').value = '50';
        [...document.getElementById('tcDocumentIds').options].forEach((o) => { o.selected = ids.includes(Number(o.value)); });
      }, { tid: testId, ids: [docAId, docBId] });
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const cls = await page.evaluate(() => DB.trainingClasses.find((c) => c.title === 'Lớp Tự Mở Bài Test'));
      assert.ok(cls, 'expected the class to be created');
      classId = cls.id;
      assertEqual(cls.documentIds.length, 2, 'expected 2 mandatory documents');

      await page.evaluate((u) => { currentUser = u; }, nv1);
      await page.evaluate((id) => registerForTrainingClass(id), classId);
      // trang phải đứng ở tab "Đăng Ký Của Tôi" để renderTrainingMyRegs() không bị gọi vào lúc DB chưa
      // có dữ liệu (không bắt buộc cho logic auto-open nhưng khớp đúng trải nghiệm thật của học viên).
      await page.evaluate(() => setTrainingLmsTab('MY_REGS'));
    });

    await run('xem xong CHỈ 1/2 video bắt buộc -> modal bài test CHƯA tự mở (còn thiếu tài liệu)', async () => {
      await page.evaluate((docId) => trackTrainingDocumentProgress(docId, { kind: 'VIDEO', furthestSeconds: 195, durationSeconds: 200 }), docAId);
      await page.waitForFunction((docId) => DB.trainingDocumentProgress.some((p) => p.docId === docId && p.username === 'nv1' && p.completedAt), docAId, { timeout: 5000 });
      const modalHidden = await page.evaluate(() => document.getElementById('trainingTakeTestModal').classList.contains('hidden'));
      assert.ok(modalHidden, 'modal bài test không được tự mở khi còn 1 tài liệu bắt buộc chưa xem xong');
      const reg = await page.evaluate((cid) => DB.trainingRegistrations.find((r) => r.classId === cid && r.creator === 'nv1'), classId);
      assertEqual((reg.viewedDocumentIds || []).length, 1, 'chỉ 1/2 tài liệu được đánh dấu đã xem');
    });

    await run('xem NỐT video còn lại (đủ 2/2) -> modal bài test TỰ ĐỘNG mở, đúng bài test của lớp', async () => {
      await page.evaluate((docId) => trackTrainingDocumentProgress(docId, { kind: 'VIDEO', furthestSeconds: 195, durationSeconds: 200 }), docBId);
      await page.waitForFunction(() => !document.getElementById('trainingTakeTestModal').classList.contains('hidden'), null, { timeout: 5000 });
      const modalTitle = await page.evaluate(() => document.getElementById('ttTakeModalTitle').innerText);
      assert.ok(modalTitle.includes('Bài Test ATLĐ Tự Mở'), `expected the auto-opened modal to show the class's assigned test, got: ${modalTitle}`);
      const reg = await page.evaluate((cid) => DB.trainingRegistrations.find((r) => r.classId === cid && r.creator === 'nv1'), classId);
      assertEqual((reg.viewedDocumentIds || []).length, 2, 'cả 2 tài liệu phải được đánh dấu đã xem');
    });

    await run('học viên tự đóng modal -> KHÔNG tự mở lại (dù server báo completedNow lần nữa cho cùng lớp)', async () => {
      await page.evaluate(() => ttTakeExit()); // window.confirm() đã được stub trả về true trong harness
      const hiddenAfterClose = await page.evaluate(() => document.getElementById('trainingTakeTestModal').classList.contains('hidden'));
      assert.ok(hiddenAfterClose, 'modal phải đóng lại sau ttTakeExit()');

      // Gọi trực tiếp hàm trigger với đúng bản ghi ĐÃ hoàn thành (mô phỏng 1 lượt completedNow khác dội
      // về cho CÙNG lớp này, VD do 1 tài liệu bắt buộc khác cũng vừa đạt ngưỡng gần như đồng thời).
      await page.evaluate((cid) => {
        const reg = DB.trainingRegistrations.find((r) => r.classId === cid && r.creator === 'nv1');
        maybeAutoOpenTrainingTestAfterDocsCompleted([reg]);
      }, classId);
      const stillHidden = await page.evaluate(() => document.getElementById('trainingTakeTestModal').classList.contains('hidden'));
      assert.ok(stillHidden, 'modal KHÔNG được tự mở lại cho cùng 1 lớp trong cùng phiên sau khi học viên đã tự đóng 1 lần');
    });

    await run('nộp bài xong (đã có kết quả) -> gọi lại hàm trigger cũng KHÔNG tự mở (mySubmission/reg.result đã chặn)', async () => {
      await page.evaluate((id) => openTakeTestModal(id), classId);
      await page.evaluate(async () => {
        const total = ttTakeQuestions.length;
        for (let i = 0; i < total; i++) {
          const q = ttTakeQuestions[ttTakeIndex];
          q.correctOptionIds.forEach((optId) => ttTakeSelectOption(optId, true));
          await ttTakeGoNext();
        }
      });
      const reg = await page.evaluate((cid) => DB.trainingRegistrations.find((r) => r.classId === cid && r.creator === 'nv1'), classId);
      assertEqual(reg.result, 'PASSED', `expected nv1 to PASS, got ${reg.result}`);
      const hiddenAfterSubmit = await page.evaluate(() => document.getElementById('trainingTakeTestModal').classList.contains('hidden'));
      assert.ok(hiddenAfterSubmit, 'modal phải tự đóng lại sau khi nộp bài');

      await page.evaluate((cid) => {
        const r = DB.trainingRegistrations.find((x) => x.classId === cid && x.creator === 'nv1');
        maybeAutoOpenTrainingTestAfterDocsCompleted([r]);
      }, classId);
      const stillHiddenAfterResult = await page.evaluate(() => document.getElementById('trainingTakeTestModal').classList.contains('hidden'));
      assert.ok(stillHiddenAfterResult, 'đã có kết quả bài test (PASSED) thì không được tự mở lại nữa');
    });

    assertEqual(pageErrors.length, 0, `unexpected uncaught page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-training-auto-open-test.js');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
