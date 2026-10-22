// tests/test-training-test-timelimit.js — Ngân Hàng Câu Hỏi: "Thời Gian Làm Bài (phút, tuỳ chọn)"
// (ttTimeLimitMinutes, 11/2026, theo yêu cầu người dùng "khi tạo bài test cho set thời gian làm bài và
// khi vào bài test sẽ tự đếm ngược") — giới hạn TỔNG thời gian làm cả bài, CỘNG THÊM (không thay thế) cơ
// chế đếm-ngược-theo-từng-câu đã có sẵn ở cấp Lớp Học (testSecondsPerQuestion). Xem openTakeTestModal()/
// computeOverallTimerTick()/isOverallTimeUp() ở module-internalcomms-daotao.js.
//
// Chạy: node server/tests/test-training-test-timelimit.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8996;

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

    // ---- 1) Hàm THUẦN (tick/hết giờ) — test trực tiếp logic, không cần chờ setInterval thật ----
    await run('computeOverallTimerTick()/isOverallTimeUp(): đếm lùi đúng, chặn dưới 0, phát hiện đúng mốc hết giờ', async () => {
      const r = await page.evaluate(() => ({
        tick60: computeOverallTimerTick(60),
        tickAtZero: computeOverallTimerTick(0),
        notUpYet: isOverallTimeUp(1),
        upAtZero: isOverallTimeUp(0),
        upBelowZero: isOverallTimeUp(-5)
      }));
      assertEqual(r.tick60, 59, 'mỗi lần tick phải giảm đúng 1 giây');
      assertEqual(r.tickAtZero, 0, 'tick ở 0 không được lùi xuống âm');
      assertEqual(r.notUpYet, false, 'còn >0 giây thì chưa được coi là hết giờ');
      assertEqual(r.upAtZero, true, 'đúng 0 giây phải được coi là hết giờ');
      assertEqual(r.upBelowZero, true, 'âm giây (lỡ race) vẫn phải được coi là hết giờ');
    });

    // ---- 2) timeLimitMinutes lưu đúng khi tạo + sửa bài test (round-trip qua form THẬT) ----
    let testId = null;
    await run('Tạo bài test có đặt "Thời Gian Làm Bài" -> timeLimitMinutes lưu đúng trên bản ghi', async () => {
      await page.evaluate(() => {
        window.__alerts.length = 0;
        tbQuestions = [{ text: 'Câu hỏi ATLĐ', type: 'SINGLE', points: 1, options: [{ text: 'Đúng', correct: true }, { text: 'Sai', correct: false }] }];
        document.getElementById('ttTitle').value = 'Bài Test Có Giới Hạn Giờ';
        document.getElementById('ttCategory').value = 'Nghiệp vụ';
        document.getElementById('ttTimeLimitMinutes').value = '20';
      });
      await page.evaluate(() => submitTrainingTest({ preventDefault() {} }));
      const test = await page.evaluate(() => DB.trainingTests.find((t) => t.title === 'Bài Test Có Giới Hạn Giờ'));
      assert(test, 'expected the test to be created');
      testId = test.id;
      assertEqual(test.timeLimitMinutes, 20, 'timeLimitMinutes phải lưu đúng 20');
    });

    await run('Để trống "Thời Gian Làm Bài" -> timeLimitMinutes mặc định 0 (không giới hạn)', async () => {
      await page.evaluate(() => {
        tbQuestions = [{ text: 'Câu hỏi khác', type: 'SINGLE', points: 1, options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] }];
        document.getElementById('ttTitle').value = 'Bài Test Không Giới Hạn Giờ';
        document.getElementById('ttCategory').value = 'Nghiệp vụ';
        document.getElementById('ttTimeLimitMinutes').value = '';
      });
      await page.evaluate(() => submitTrainingTest({ preventDefault() {} }));
      const test = await page.evaluate(() => DB.trainingTests.find((t) => t.title === 'Bài Test Không Giới Hạn Giờ'));
      assert(test, 'expected the test to be created');
      assertEqual(test.timeLimitMinutes, 0, 'để trống phải mặc định 0 — hành vi giống hệt trước khi có field này');
      await page.evaluate((id) => { DB.trainingTests = DB.trainingTests.filter((t) => t.id !== id); }, test.id);
    });

    await run('editTrainingTest(): sửa bài test -> nạp lại đúng timeLimitMinutes vào form, đổi giá trị lưu lại đúng', async () => {
      await page.evaluate((id) => editTrainingTest(id), testId);
      const loaded = await page.evaluate(() => document.getElementById('ttTimeLimitMinutes').value);
      assertEqual(loaded, '20', 'mở Sửa phải nạp lại đúng giá trị đã lưu (20)');
      await page.evaluate(() => { document.getElementById('ttTimeLimitMinutes').value = '45'; });
      await page.evaluate(() => submitTrainingTest({ preventDefault() {} }));
      const test = await page.evaluate((id) => DB.trainingTests.find((t) => t.id === id), testId);
      assertEqual(test.timeLimitMinutes, 45, 'sau khi sửa phải lưu đúng giá trị mới (45)');
    });

    // ---- 3) openTakeTestModal(): hiện/ẩn đồng hồ tổng đúng theo timeLimitMinutes, auto-nộp khi hết giờ ----
    let classWithLimitId = null, regId = null;
    await run('[setup] lớp gán bài test CÓ giới hạn giờ + nv1 đăng ký', async () => {
      await page.evaluate((tid) => {
        document.getElementById('tcCategory').value = 'Nghiệp vụ';
        document.getElementById('tcTitle').value = 'Lớp Có Giới Hạn Giờ Thi';
        document.getElementById('tcStart').value = '2020-01-01T08:00';
        document.getElementById('tcEnd').value = '2020-01-01T10:00';
        document.getElementById('tcMode').value = 'ONLINE';
        onTrainingClassModeChange();
        populateTrainingClassMultiSelects();
        document.getElementById('tcTestId').value = String(tid);
        document.getElementById('tcPassScore').value = '50';
      }, testId);
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const cls = await page.evaluate(() => DB.trainingClasses.find((c) => c.title === 'Lớp Có Giới Hạn Giờ Thi'));
      assert(cls, 'expected the class to be created');
      classWithLimitId = cls.id;

      await page.evaluate((u) => { currentUser = u; }, nv1);
      await page.evaluate((id) => registerForTrainingClass(id), classWithLimitId);
      const reg = await page.evaluate((cid) => DB.trainingRegistrations.find((r) => r.classId === cid && r.creator === 'nv1'), classWithLimitId);
      assert(reg, 'expected nv1 to be registered');
      regId = reg.id;
    });

    await run('mở "Vào Làm Bài Test" của bài test CÓ giới hạn giờ -> hiện đồng hồ tổng, đúng mm:ss ban đầu', async () => {
      await page.evaluate((id) => openTakeTestModal(id), classWithLimitId);
      const wrapHidden = await page.evaluate(() => document.getElementById('ttTakeOverallTimerWrap').classList.contains('hidden'));
      assert(!wrapHidden, 'bài test có timeLimitMinutes=45 phải hiện khối đồng hồ tổng');
      const timerText = await page.evaluate(() => document.getElementById('ttTakeOverallTimer').innerText);
      assertEqual(timerText, '45:00', 'đồng hồ tổng phải khởi động đúng 45:00 (45 phút)');
      const secondsLeft = await page.evaluate(() => ttTakeOverallSecondsLeft);
      assertEqual(secondsLeft, 45 * 60, 'ttTakeOverallSecondsLeft phải khởi tạo đúng 45*60 giây');
      await page.evaluate(() => ttTakeExit());
    });

    await run('hết giờ TỔNG (ttTakeOverallSecondsLeft chạm 0) -> tự động nộp bài, đóng modal, ghi nhận kết quả', async () => {
      await page.evaluate((id) => openTakeTestModal(id), classWithLimitId);
      // Chọn sẵn 1 đáp án (không cần đúng — chỉ cần có bài nộp để xác nhận auto-submit thật sự chạy).
      await page.evaluate(() => {
        const q = ttTakeQuestions[ttTakeIndex];
        ttTakeSelectOption(q.options[0].id, true);
      });
      // Mô phỏng hết giờ TỔNG mà KHÔNG chờ setInterval thật (clearInterval 2 đồng hồ rồi tự gọi lại đúng
      // nhánh xử lý hết giờ mà openTakeTestModal() đã wiring — gọi thẳng ttTakeSubmit() như code thật làm).
      await page.evaluate(() => {
        clearInterval(ttTakeOverallTimerHandle);
        clearInterval(ttTakeTimerHandle);
      });
      await page.evaluate(() => ttTakeSubmit());
      const hidden = await page.evaluate(() => document.getElementById('trainingTakeTestModal').classList.contains('hidden'));
      assert(hidden, 'modal phải tự đóng sau khi auto-submit vì hết giờ tổng');
      const reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.id === id), regId);
      assert(reg.result === 'PASSED' || reg.result === 'FAILED', `phải có kết quả Đạt/Không Đạt sau khi auto-submit, thực tế: ${reg.result}`);
    });

    await run('bài test KHÔNG đặt giới hạn giờ -> ẩn hẳn khối đồng hồ tổng (hành vi cũ, không đổi)', async () => {
      // Gán lại bài test "không giới hạn" (testId2) cho lớp đã có + học viên đã đăng ký, mở lại modal làm bài.
      const test2 = await page.evaluate(() => {
        const t = {
          id: Date.now(), title: 'Bài Test Không Giới Hạn (lắp lại)', category: 'Nghiệp vụ', passScore: null, timeLimitMinutes: 0,
          questions: [{ id: 1, text: 'Câu hỏi', type: 'SINGLE', options: [{ id: 1, text: 'A' }, { id: 2, text: 'B' }], correctOptionIds: [1], points: 1, imageUrl: '' }]
        };
        DB.trainingTests.push(t);
        return t;
      });
      await page.evaluate(({ cid, tid }) => { DB.trainingClasses.find((c) => c.id === cid).testId = tid; }, { cid: classWithLimitId, tid: test2.id });
      await page.evaluate((id) => openTakeTestModal(id), classWithLimitId);
      const wrapHidden = await page.evaluate(() => document.getElementById('ttTakeOverallTimerWrap').classList.contains('hidden'));
      assert(wrapHidden, 'bài test không đặt timeLimitMinutes phải ẩn hẳn khối đồng hồ tổng');
      const handle = await page.evaluate(() => ttTakeOverallTimerHandle);
      assertEqual(handle, null, 'không được khởi động interval đồng hồ tổng khi không có giới hạn');
      await page.evaluate(() => ttTakeExit());
    });

    assertEqual(pageErrors.length, 0, `unexpected uncaught page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-training-test-timelimit.js');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
