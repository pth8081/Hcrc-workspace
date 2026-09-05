// tests/test-training-video-pdf-progress.js — Đào Tạo > Video 0.5x-1.5x + PDF phải xem hết mọi trang mới
// tính hoàn thành (Phần 2 + 3/3), tie-in "Bắt Buộc Hoàn Thành" giờ có logic thật thay vì chỉ là badge.
//
// Phần 1 (không cần trình duyệt): lib/recordActions.js computeTrainingDocumentProgressUpdate()/
// isTrainingVideoProgressComplete()/isTrainingPdfProgressComplete() — hàm THUẦN, test bằng buffer dữ liệu
// giả lập, không cần DB/trình duyệt.
//
// Phần 2 (Playwright, hàm THUẦN client): clampYoutubePlaybackRate()/computeYoutubeSeekSnapback()/
// computeYoutubeFurthestWatched() (module-internalcomms-daotao.js) — gọi trực tiếp qua page.evaluate(),
// KHÔNG cần dựng 1 iframe Youtube thật nào (mạng sandbox này không gọi ra được youtube.com).
//
// Phần 3 (Playwright, THẬT): dựng 1 file PDF thật (pdf-lib, 5 trang) phục vụ qua chính static server của
// harness, mở qua ĐÚNG viewTrainingPdfDoc() -> openFileProtectedView() -> renderPdfProtected() (PDF.js
// thật + IntersectionObserver thật) — cuộn TỪNG TRANG vào khung nhìn thật (không giả lập DOM), xác nhận:
// xem 1 phần thì CHƯA hoàn thành, xem hết mọi trang thì hoàn thành VÀ tự động đánh dấu "đã xem" cho đăng
// ký (trainingRegistrations.viewedDocumentIds) — không còn nút bấm tay nào cho loại tài liệu này.
//
// Phần 4 (Playwright): video — không dựng YT.Player thật được (mạng sandbox chặn youtube.com), nên gọi
// thẳng trackTrainingDocumentProgress() (đúng hàm mà vòng poll thật sẽ gọi) để xác nhận round-trip
// server (mock)/tie-in "Bắt Buộc Hoàn Thành" — cùng closeTrainingVideoModal()/CSP đã khai báo riêng.
//
// Run: node server/tests/test-training-video-pdf-progress.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { PDFDocument } = require('pdf-lib');
const { setup, teardown, makeRunner, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');
const {
  isTrainingVideoProgressComplete, isTrainingPdfProgressComplete, computeTrainingDocumentProgressUpdate
} = require('../lib/recordActions');

const PORT = 8994;

// ===================== Phần 1: lib/recordActions.js (không cần trình duyệt) =====================
async function runServerUnitTests(run) {
  await run('[server] isTrainingVideoProgressComplete(): ~95% ngưỡng, không tính đủ khi dưới ngưỡng', () => {
    assert.strictEqual(isTrainingVideoProgressComplete(94, 100), false);
    assert.strictEqual(isTrainingVideoProgressComplete(95, 100), true);
    assert.strictEqual(isTrainingVideoProgressComplete(0, 0), false, 'duration=0 (chưa biết) không bao giờ coi là hoàn thành');
  });

  await run('[server] isTrainingPdfProgressComplete(): phải có ĐỦ MỌI trang 1..N, không chỉ đủ SỐ LƯỢNG', () => {
    assert.strictEqual(isTrainingPdfProgressComplete([1, 2, 4, 5], 5), false, 'thiếu trang 3 dù đã đủ 4/5 trang');
    assert.strictEqual(isTrainingPdfProgressComplete([1, 2, 3, 4, 5], 5), true);
    assert.strictEqual(isTrainingPdfProgressComplete([1, 1, 1], 1), true, 'trang xem lại nhiều lần không tính trùng');
    assert.strictEqual(isTrainingPdfProgressComplete([], 0), false, 'pageCount=0 (chưa biết) không bao giờ hoàn thành');
  });

  await run('[server] computeTrainingDocumentProgressUpdate(): video — furthestSeconds CHỈ tăng, không bao giờ giảm (chống thụt lùi)', () => {
    const r1 = computeTrainingDocumentProgressUpdate(null, { kind: 'VIDEO', furthestSeconds: 50, durationSeconds: 200 });
    assertEqual(r1.fields.furthestSeconds, 50, 'lượt đầu tiên');
    assertEqual(r1.completedNow, false, '50/200 chưa đủ 95%');
    const r2 = computeTrainingDocumentProgressUpdate(r1.fields, { kind: 'VIDEO', furthestSeconds: 30, durationSeconds: 200 });
    assertEqual(r2.fields.furthestSeconds, 50, '1 lượt báo cáo TRỄ/thấp hơn không được xoá tiến độ đã ghi nhận trước đó');
  });

  await run('[server] computeTrainingDocumentProgressUpdate(): video — completedNow CHỈ true đúng 1 lần, ở lượt đạt ngưỡng đầu tiên', () => {
    const r1 = computeTrainingDocumentProgressUpdate(null, { kind: 'VIDEO', furthestSeconds: 190, durationSeconds: 200 });
    assertEqual(r1.completedNow, true, '190/200 = 95% đủ ngưỡng');
    assert.ok(r1.fields.completedAt, 'completedAt phải được gán');
    const r2 = computeTrainingDocumentProgressUpdate(r1.fields, { kind: 'VIDEO', furthestSeconds: 195, durationSeconds: 200 });
    assertEqual(r2.completedNow, false, 'đã hoàn thành từ lượt trước — lượt sau KHÔNG còn completedNow (tránh tự động đánh dấu lặp lại)');
    assertEqual(r2.fields.completedAt, r1.fields.completedAt, 'completedAt giữ nguyên mốc lần đầu, không cập nhật lại');
  });

  await run('[server] computeTrainingDocumentProgressUpdate(): PDF — hợp nhất mảng trang đã xem, không trùng lặp, sắp xếp tăng dần', () => {
    const r1 = computeTrainingDocumentProgressUpdate(null, { kind: 'PDF', viewedPages: [2, 1], pageCount: 3 });
    assert.deepStrictEqual(r1.fields.viewedPages, [1, 2]);
    assertEqual(r1.completedNow, false, 'thiếu trang 3/3');
    const r2 = computeTrainingDocumentProgressUpdate(r1.fields, { kind: 'PDF', viewedPages: [3, 1], pageCount: 3 });
    assert.deepStrictEqual(r2.fields.viewedPages, [1, 2, 3]);
    assertEqual(r2.completedNow, true, 'đủ 3/3 trang ở lượt này');
  });
}

// ===================== Playwright =====================
async function main() {
  await runServerUnitTests(async (name, fn) => {
    try { await fn(); console.log(`PASS  ${name}`); } catch (err) { console.error(`FAIL  ${name}\n      ${err.stack}`); process.exitCode = 1; }
  });

  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();
  const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
  const testPdfName = 'test-video-pdf-progress-demo.pdf';
  const testPdfPath = path.join(uploadsDir, testPdfName);
  let createdUploadsDir = false;

  try {
    // ===================== Phần 2: hàm THUẦN client (Youtube) =====================
    await run('[client] clampYoutubePlaybackRate(): chặn NGOÀI [0.5, 1.5], giữ nguyên TRONG khoảng', async () => {
      const results = await page.evaluate(() => [
        clampYoutubePlaybackRate(0.25), clampYoutubePlaybackRate(2), clampYoutubePlaybackRate(1), clampYoutubePlaybackRate(0.5), clampYoutubePlaybackRate(1.5)
      ]);
      assert.deepStrictEqual(results, [0.5, 1.5, 1, 0.5, 1.5]);
    });

    await run('[client] computeYoutubeSeekSnapback(): chặn tua VƯỢT điểm đã xem xa nhất + biên dung sai, cho phép tua lùi tự do', async () => {
      const results = await page.evaluate(() => [
        computeYoutubeSeekSnapback(100, 50), // vượt xa -> snap về 50
        computeYoutubeSeekSnapback(52, 50),  // trong biên dung sai (3s mặc định) -> không snap
        computeYoutubeSeekSnapback(10, 50),  // tua NGƯỢC về trước -> luôn cho phép
        computeYoutubeSeekSnapback(50, 50)   // đúng ngay điểm xa nhất -> không snap
      ]);
      assertEqual(results[0], 50, 'phải snap về đúng furthestWatched');
      assertEqual(results[1], null, 'trong biên dung sai không snap');
      assertEqual(results[2], null, 'tua lùi luôn được phép');
      assertEqual(results[3], null, 'đúng ngay điểm xa nhất không snap');
    });

    await run('[client] computeYoutubeFurthestWatched(): chỉ tăng, không giảm', async () => {
      const results = await page.evaluate(() => [computeYoutubeFurthestWatched(30, 50), computeYoutubeFurthestWatched(80, 50)]);
      assertEqual(results[0], 50, 'currentTime thấp hơn không kéo lùi furthestWatched');
      assertEqual(results[1], 80, 'currentTime cao hơn thì tăng furthestWatched');
    });

    // ===================== Phần 3: PDF thật, cuộn thật =====================
    const trainer = makeUser({ username: 'gv.linh', name: 'Trần Thị Linh', dept: 'Phòng Nhân Sự', perms: { trainingManage: true } });
    const nv1 = makeUser({ username: 'nv1', name: 'Học Viên Một', dept: 'Phòng CNTT', perms: {} });

    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((users) => { DB.users = users; }, [trainer, nv1]);
    await page.evaluate((u) => finishLogin(u), trainer);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); });
    // Viewport CAO để khung xem PDF (h-[65vh]) đủ chỗ hiện >=60% mỗi trang (IntersectionObserver
    // threshold 0.6 ở renderPdfProtected()) khi cuộn scrollIntoView({block:'center'}) — viewport mặc định
    // (nhỏ hơn) khiến trang PDF cao hơn khung xem, không bao giờ đạt tỉ lệ hiển thị 60% dù đã cuộn tới.
    await page.setViewportSize({ width: 1280, height: 2000 });

    await run('[setup] tạo file PDF thật (5 trang, khổ nhỏ) qua static server của harness', async () => {
      const pdfDoc = await PDFDocument.create();
      for (let i = 0; i < 5; i++) {
        const p = pdfDoc.addPage([300, 200]);
        p.drawText(`Trang ${i + 1}`, { x: 20, y: 150, size: 24 });
      }
      const bytes = await pdfDoc.save();
      if (!fs.existsSync(uploadsDir)) { fs.mkdirSync(uploadsDir, { recursive: true }); createdUploadsDir = true; }
      fs.writeFileSync(testPdfPath, bytes);
    });

    let pdfDocId = null;
    let classId = null;
    await run('[setup] tạo tài liệu PDF bắt buộc + lớp ONLINE dùng nó, đăng ký nv1', async () => {
      const doc = await page.evaluate((url) => {
        const d = { id: Date.now(), code: 'TL-PDF-1', category: 'Nghiệp vụ', title: 'Tài Liệu PDF 5 Trang', docType: 'DOCUMENT', mandatory: true, fileUrl: url, fileName: 'test.pdf', fileType: 'application/pdf', uploaderUsername: 'gv.linh', uploaderName: 'Trần Thị Linh' };
        DB.trainingDocuments.unshift(d);
        return d;
      }, `/uploads/${testPdfName}`);
      pdfDocId = doc.id;

      await page.evaluate((docId) => {
        document.getElementById('tcCategory').value = 'Nghiệp vụ';
        document.getElementById('tcTitle').value = 'Lớp PDF Bắt Buộc';
        document.getElementById('tcStart').value = '2020-01-01T08:00';
        document.getElementById('tcMode').value = 'ONLINE';
        onTrainingClassModeChange();
        populateTrainingClassMultiSelects();
        [...document.getElementById('tcDocumentIds').options].forEach((o) => { o.selected = Number(o.value) === docId; });
      }, pdfDocId);
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const cls = await page.evaluate(() => DB.trainingClasses.find((c) => c.title === 'Lớp PDF Bắt Buộc'));
      assert.ok(cls, 'expected the class to be created');
      classId = cls.id;
      assertEqual(cls.documentIds[0], pdfDocId, 'class should require the PDF document');

      await page.evaluate((u) => { currentUser = u; }, nv1);
      await page.evaluate((cid) => registerForTrainingClass(cid), classId);
    });

    await run('mở "Vào Lớp Học" của nv1: tài liệu PDF hiện nút "Xem Tài Liệu" (KHÔNG có nút "Đánh dấu đã xem" thủ công)', async () => {
      const reg = await page.evaluate(() => DB.trainingRegistrations.find((r) => r.creator === 'nv1'));
      await page.evaluate((regId) => openTrainingJoinClassModal(regId), reg.id);
      const bodyHTML = await page.evaluate(() => document.getElementById('trainingJoinClassBody').innerHTML);
      assert.ok(bodyHTML.includes('data-op="viewTrainingPdfDoc"'), 'expected the tracked "Xem Tài Liệu" button');
      assert.ok(!bodyHTML.includes('data-op="markTrainingDocumentViewedAction"'), 'a PDF document must NOT offer the old manual click-to-mark button anymore');
      assert.ok(bodyHTML.includes('Sẽ tự động đánh dấu'), 'expected the auto-tracking hint text');
    });

    await run('cuộn qua CHỈ 3/5 trang thật (PDF.js + IntersectionObserver thật) — CHƯA tính hoàn thành', async () => {
      await page.evaluate((docId) => viewTrainingPdfDoc(docId), pdfDocId);
      // renderPdfProtected() vẽ TỪNG TRANG tuần tự (await page.render() mỗi trang) — chờ tới khi ĐỦ cả 5
      // trang đã vào DOM, không chỉ trang đầu tiên xuất hiện.
      await page.waitForFunction(() => document.querySelectorAll('#viewModalContent [data-page-num]').length === 5, null, { timeout: 10000 });

      for (let p = 1; p <= 3; p++) {
        await page.evaluate((pn) => {
          document.querySelector(`#viewModalContent [data-page-num="${pn}"]`).scrollIntoView({ block: 'center' });
        }, p);
        await page.waitForTimeout(1100); // > 900ms dwell threshold ở renderPdfProtected()
      }
      await page.waitForFunction(() => {
        const p = DB.trainingDocumentProgress.find((x) => x.username === 'nv1');
        return p && p.viewedPages && p.viewedPages.length >= 3;
      }, null, { timeout: 5000 });

      const progress = await page.evaluate(() => DB.trainingDocumentProgress.find((p) => p.username === 'nv1'));
      assert.ok(progress, 'expected a progress row to exist for nv1');
      // >=3 trang đầu chắc chắn đã "đã xem" (đã cuộn dừng đủ lâu ở từng trang) — trang liền kề CÓ THỂ
      // cũng lọt qua ngưỡng hiển thị 60% tuỳ kích thước khung xem thật (không phải bug, chỉ là kích thước
      // khung/trang trong môi trường test không tách bạch tuyệt đối từng trang như 1 lượt đọc thật) —
      // điều THẬT SỰ cần khẳng định ở bước "chưa hoàn thành" là trang CUỐI (5) chưa từng được cuộn tới.
      assert.ok([1, 2, 3].every((p) => progress.viewedPages.includes(p)), `expected pages 1-3 to be viewed, got ${JSON.stringify(progress.viewedPages)}`);
      assert.ok(!progress.viewedPages.includes(5), `page 5 (never scrolled to) must not be marked viewed, got ${JSON.stringify(progress.viewedPages)}`);
      assert.ok(!progress.completedAt, 'must NOT be complete while page 5 has never been scrolled into view');
      const reg = await page.evaluate(() => DB.trainingRegistrations.find((r) => r.creator === 'nv1'));
      assert.ok(!(reg.viewedDocumentIds || []).length, 'the class registration must NOT be auto-marked as viewed yet');
    });

    await run('cuộn nốt 2 trang còn lại — hoàn thành, TỰ ĐỘNG đánh dấu "đã xem" cho đăng ký lớp, bài test mở khoá', async () => {
      for (const p of [4, 5]) {
        await page.evaluate((pn) => {
          document.querySelector(`#viewModalContent [data-page-num="${pn}"]`).scrollIntoView({ block: 'center' });
        }, p);
        await page.waitForTimeout(1100);
      }
      await page.waitForFunction(() => {
        const p = DB.trainingDocumentProgress.find((x) => x.username === 'nv1');
        return p && p.completedAt;
      }, null, { timeout: 5000 });

      const progress = await page.evaluate(() => DB.trainingDocumentProgress.find((p) => p.username === 'nv1'));
      assert.deepStrictEqual(progress.viewedPages, [1, 2, 3, 4, 5]);
      assert.ok(progress.completedAt, 'expected completedAt to be set once all 5 pages are viewed');

      await page.waitForFunction((docId) => {
        const reg = DB.trainingRegistrations.find((r) => r.creator === 'nv1');
        return reg && (reg.viewedDocumentIds || []).includes(docId);
      }, pdfDocId, { timeout: 5000 });
    });

    // ===================== Phần 4: video — round-trip qua trackTrainingDocumentProgress() (không dựng YT.Player thật) =====================
    let videoDocId = null;
    let videoClassId = null;
    await run('[setup] tài liệu VIDEO bắt buộc + lớp ONLINE riêng, đăng ký nv1', async () => {
      await page.evaluate((u) => { currentUser = u; }, trainer); // currentUser vẫn là nv1 từ bước xem PDF ở trên
      const doc = await page.evaluate(() => {
        const d = { id: Date.now() + 1, code: 'TL-VID-1', category: 'Nghiệp vụ', title: 'Video Bắt Buộc', docType: 'VIDEO', mandatory: true, videoUrl: 'https://www.youtube.com/watch?v=abc123XYZ', uploaderUsername: 'gv.linh', uploaderName: 'Trần Thị Linh' };
        DB.trainingDocuments.unshift(d);
        return d;
      });
      videoDocId = doc.id;
      await page.evaluate((docId) => {
        document.getElementById('tcCategory').value = 'Nghiệp vụ';
        document.getElementById('tcTitle').value = 'Lớp Video Bắt Buộc';
        document.getElementById('tcStart').value = '2020-01-01T08:00';
        document.getElementById('tcMode').value = 'ONLINE';
        onTrainingClassModeChange();
        populateTrainingClassMultiSelects();
        [...document.getElementById('tcDocumentIds').options].forEach((o) => { o.selected = Number(o.value) === docId; });
      }, videoDocId);
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const cls = await page.evaluate(() => DB.trainingClasses.find((c) => c.title === 'Lớp Video Bắt Buộc'));
      assert.ok(cls, 'expected the video class to be created');
      videoClassId = cls.id;
      await page.evaluate((u) => { currentUser = u; }, nv1);
      await page.evaluate((cid) => registerForTrainingClass(cid), videoClassId);
    });

    await run('trackTrainingDocumentProgress() báo tiến độ video một phần — chưa hoàn thành, chưa tự đánh dấu', async () => {
      await page.evaluate((docId) => trackTrainingDocumentProgress(docId, { kind: 'VIDEO', furthestSeconds: 40, durationSeconds: 200 }), videoDocId);
      await page.waitForFunction((docId) => DB.trainingDocumentProgress.some((p) => p.docId === docId && p.username === 'nv1'), videoDocId, { timeout: 5000 });
      const progress = await page.evaluate((docId) => DB.trainingDocumentProgress.find((p) => p.docId === docId && p.username === 'nv1'), videoDocId);
      assertEqual(progress.furthestSeconds, 40);
      assert.ok(!progress.completedAt, 'chỉ 40/200 giây, chưa đủ 95%');
      const reg = await page.evaluate((cid) => DB.trainingRegistrations.find((r) => r.classId === cid && r.creator === 'nv1'), videoClassId);
      assert.ok(!(reg.viewedDocumentIds || []).length, 'chưa được tự động đánh dấu');
    });

    await run('trackTrainingDocumentProgress() báo đủ ~95% -> hoàn thành, TỰ ĐỘNG đánh dấu đã xem cho đăng ký', async () => {
      await page.evaluate((docId) => trackTrainingDocumentProgress(docId, { kind: 'VIDEO', furthestSeconds: 195, durationSeconds: 200 }), videoDocId);
      await page.waitForFunction((docId) => {
        const p = DB.trainingDocumentProgress.find((x) => x.docId === docId && x.username === 'nv1');
        return p && p.completedAt;
      }, videoDocId, { timeout: 5000 });
      const reg = await page.waitForFunction(([cid, docId]) => {
        const r = DB.trainingRegistrations.find((x) => x.classId === cid && x.creator === 'nv1');
        return r && (r.viewedDocumentIds || []).includes(docId) ? r : false;
      }, [videoClassId, videoDocId], { timeout: 5000 });
      assert.ok(reg, 'the video class registration should now be auto-marked as viewed');
    });

    await run('trackTrainingDocumentProgress() vẫn TỪ CHỐI báo cáo 1 report thấp hơn LÀM GIẢM tiến độ (server thật xác nhận qua unit test — đây xác nhận client cũng phản ánh đúng furthestSeconds mới nhất không bị thụt lùi)', async () => {
      await page.evaluate((docId) => trackTrainingDocumentProgress(docId, { kind: 'VIDEO', furthestSeconds: 10, durationSeconds: 200 }), videoDocId);
      await page.waitForTimeout(300);
      const progress = await page.evaluate((docId) => DB.trainingDocumentProgress.find((p) => p.docId === docId && p.username === 'nv1'), videoDocId);
      assertEqual(progress.furthestSeconds, 195, 'furthestSeconds phải giữ nguyên giá trị cao nhất đã ghi nhận, không bị 1 lượt báo cáo thấp hơn kéo lùi');
    });

    assertEqual(pageErrors.length, 0, `unexpected uncaught page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    try { fs.unlinkSync(testPdfPath); } catch (e) { /* ignore */ }
    if (createdUploadsDir) { try { fs.rmdirSync(uploadsDir); } catch (e) { /* ignore, may not be empty */ } }
    await teardown({ server, browser });
  }

  summarize('test-training-video-pdf-progress.js');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
