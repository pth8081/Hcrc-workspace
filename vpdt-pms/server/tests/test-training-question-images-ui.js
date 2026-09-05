// tests/test-training-question-images-ui.js — Đào Tạo > Ngân Hàng Câu Hỏi hỗ trợ ảnh minh hoạ câu hỏi
// (Phần 1/3, phần CLIENT — xem tests/test-training-question-images.js cho phần SERVER thuần Node).
//
// Kịch bản: (1) tải ảnh thật lên 1 câu hỏi qua đúng luồng file input -> uploadFileToServer() -> preview
// thumbnail -> xoá ảnh; (2) tạo bài test có ảnh, gán vào lớp, học viên làm bài -> ảnh hiển thị đúng ở màn
// làm bài (ttTakeQuestionImageWrap), không phá layout câu hỏi không có ảnh; (3) Nhập Câu Hỏi Từ Excel:
// tải ảnh picker trước, xem trước file đã điền, đối chiếu tên tệp -> nạp vào tbQuestions với đúng
// imageUrl đã tải, dòng có tên ảnh KHÔNG khớp thì cảnh báo và không gắn ảnh; (4) Xuất Excel đúng khuôn
// cột với template nhập (round-trip được).
//
// Run: node server/tests/test-training-question-images-ui.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8993;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    const trainer = makeUser({ username: 'gv.linh', name: 'Trần Thị Linh', dept: 'Phòng Nhân Sự', perms: { trainingManage: true } });
    const nv1 = makeUser({ username: 'nv1', name: 'Học Viên Một', dept: 'Phòng CNTT', perms: {} });

    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((users) => { DB.users = users; }, [trainer, nv1]);
    await page.evaluate((u) => finishLogin(u), trainer);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('TESTS'); });

    const tmpImgPath = path.join(os.tmpdir(), 'question-image-test.png');
    fs.writeFileSync(tmpImgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));

    let testId = null;

    await run('tbAddQuestion() + upload ảnh qua file input thật -> thumbnail hiển thị, imageUrl hợp lệ', async () => {
      await page.evaluate(() => {
        tbQuestions = [{ text: 'Biển báo này nghĩa là gì?', type: 'SINGLE', points: 1, imageUrl: '', options: [
          { text: 'Cấm rẽ trái', correct: true }, { text: 'Cấm rẽ phải', correct: false }
        ] }];
        renderTestBuilderQuestions();
      });
      const fileInputSelector = '#tbQuestionsContainer input[type="file"]';
      await page.waitForSelector(fileInputSelector);
      await page.setInputFiles(fileInputSelector, tmpImgPath);
      // input[type=file] onchange đi qua data-op-change (cspDispatchOp) — chờ tới khi tbQuestions[0].imageUrl
      // được gán (uploadFileToServer() là async).
      await page.waitForFunction(() => tbQuestions[0] && tbQuestions[0].imageUrl, { timeout: 5000 });
      const imageUrl = await page.evaluate(() => tbQuestions[0].imageUrl);
      assert(/^\/uploads\//.test(imageUrl), `expected a /uploads/... url, got ${imageUrl}`);
      const html = await page.evaluate(() => document.getElementById('tbQuestionsContainer').innerHTML);
      assert(html.includes('<img'), 'expected an <img> thumbnail preview after upload');
      assert(html.includes('Xoá Ảnh'), 'expected a remove-image button once an image is set');
    });

    await run('tbRemoveQuestionImage() clears the image and restores the file input', async () => {
      await page.evaluate(() => tbRemoveQuestionImage(0));
      assertEqual(await page.evaluate(() => tbQuestions[0].imageUrl), '', 'imageUrl should be cleared');
      const html = await page.evaluate(() => document.getElementById('tbQuestionsContainer').innerHTML);
      assert(html.includes('type="file"'), 'expected the file input to reappear after removing the image');
    });

    await run('re-upload the image, then create the test — imageUrl round-trips into DB.trainingTests', async () => {
      const fileInputSelector = '#tbQuestionsContainer input[type="file"]';
      await page.setInputFiles(fileInputSelector, tmpImgPath);
      await page.waitForFunction(() => tbQuestions[0] && tbQuestions[0].imageUrl, { timeout: 5000 });
      await page.evaluate(() => {
        document.getElementById('ttTitle').value = 'Bài Test Có Ảnh';
        document.getElementById('ttPassScore').value = '70';
      });
      await page.evaluate(() => submitTrainingTest({ preventDefault() {} }));
      const test = await page.evaluate(() => DB.trainingTests.find((t) => t.title === 'Bài Test Có Ảnh'));
      assert(test, 'expected the test to be created');
      testId = test.id;
      assert(/^\/uploads\//.test(test.questions[0].imageUrl), 'expected the created question to keep its imageUrl');
    });

    let classId = null;
    await run('assign the test to a class and register nv1', async () => {
      await page.evaluate(() => {
        document.getElementById('tcCategory').value = 'Nghiệp vụ';
        document.getElementById('tcTitle').value = 'Lớp Test Có Ảnh';
        document.getElementById('tcStart').value = '2026-01-01T08:00';
        document.getElementById('tcTestId').value = '';
        document.getElementById('tcDocumentIds').innerHTML = '';
      });
      await page.evaluate((tid) => { document.getElementById('tcTestId').innerHTML = `<option value="${tid}">t</option>`; document.getElementById('tcTestId').value = String(tid); }, testId);
      await page.evaluate(() => { document.getElementById('tcPassScore').value = '70'; });
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const cls = await page.evaluate(() => DB.trainingClasses.find((c) => c.title === 'Lớp Test Có Ảnh'));
      assert(cls, 'expected the class to be created');
      classId = cls.id;

      await page.evaluate((u) => { currentUser = u; }, nv1);
      await page.evaluate((cid) => registerForTrainingClass(cid), classId);
      const reg = await page.evaluate(() => DB.trainingRegistrations.find((r) => r.creator === 'nv1'));
      assert(reg, 'expected nv1 to be registered');
    });

    await run('taking the test shows the question image; a question without an image keeps the wrap hidden', async () => {
      await page.evaluate((cid) => openTakeTestModal(cid), classId);
      const imgWrapHTML = await page.evaluate(() => document.getElementById('ttTakeQuestionImageWrap').outerHTML);
      assert(imgWrapHTML.includes('<img'), `expected the question image to render in the take-test modal, got: ${imgWrapHTML}`);
      assert(!imgWrapHTML.includes('hidden'), 'the image wrap should NOT have the hidden class when an image is present');

      // Injecter 1 câu hỏi KHÔNG có ảnh ngay sau câu hiện tại để xác nhận wrap ẩn đi đúng cách (không giữ
      // lại ảnh câu trước — bug lớp phủ DOM cũ thường gặp).
      await page.evaluate(() => {
        ttTakeQuestions.push({ id: 999, text: 'Câu không ảnh', type: 'SINGLE', options: [{ id: 1, text: 'A' }, { id: 2, text: 'B' }] });
        ttTakeIndex = ttTakeQuestions.length - 1;
        ttTakeRenderQuestion();
      });
      const imgWrapHTML2 = await page.evaluate(() => document.getElementById('ttTakeQuestionImageWrap').outerHTML);
      assert(imgWrapHTML2.includes('hidden'), 'expected the image wrap to be hidden again for a question without an image');
      assert(!imgWrapHTML2.includes('<img'), 'expected no leftover <img> for a question without an image');
      await page.evaluate(() => { document.getElementById('trainingTakeTestModal').classList.add('hidden'); clearInterval(ttTakeTimerHandle); });
    });

    // ===================== Nhập Câu Hỏi Từ Excel =====================
    await run('Nhập Câu Hỏi Từ Excel: tải ảnh picker trước, rồi nạp câu hỏi khớp/không khớp tên ảnh', async () => {
      await page.evaluate(() => { tbQuestions = []; renderTestBuilderQuestions(); ttImportImagesStaged = []; renderTrainingTestImportImagesStagedList(); });
      await page.setInputFiles('#ttImportImageInput', tmpImgPath);
      await page.waitForFunction(() => ttImportImagesStaged.length === 1, { timeout: 5000 });
      const stagedName = await page.evaluate(() => ttImportImagesStaged[0].fileName);
      assertEqual(stagedName, 'question-image-test.png', 'staged image should keep the original file name');

      await page.evaluate((imgName) => {
        window.__testQuestionsParsePreset = [
          {
            text: 'Câu khớp ảnh đã tải', type: 'SINGLE', points: 1,
            options: ['A đúng', 'B sai'], correctIndexes: [1], imageRef: imgName,
            valid: true, errors: []
          },
          {
            text: 'Câu ảnh không khớp gì cả', type: 'SINGLE', points: 1,
            options: ['A', 'B'], correctIndexes: [1], imageRef: 'khong-ton-tai.png',
            valid: true, errors: []
          },
          {
            text: 'Câu lỗi thiếu đáp án đúng', type: 'SINGLE', points: 1,
            options: ['A', 'B'], correctIndexes: [], imageRef: '',
            valid: false, errors: ['chưa xác định đáp án đúng hợp lệ']
          }
        ];
      }, stagedName);

      // Giả lập chọn 1 file Excel bất kỳ (nội dung không quan trọng — mock /api/training/parse-test-questions
      // trả thẳng window.__testQuestionsParsePreset, xem tests/_mock-backend.js).
      const tmpXlsxPath = path.join(os.tmpdir(), 'cau-hoi-test.xlsx');
      fs.writeFileSync(tmpXlsxPath, Buffer.from('mock'));
      await page.setInputFiles('#ttImportFileInput', tmpXlsxPath);
      await page.waitForFunction(() => !document.getElementById('ttImportPreviewWrap').classList.contains('hidden'), { timeout: 5000 });

      const previewHTML = await page.evaluate(() => document.getElementById('ttImportPreviewBody').innerHTML);
      assert(previewHTML.includes('✅ đã có ảnh'), 'expected the matching-image row to show the matched badge');
      assert(previewHTML.includes('⚠️ không khớp ảnh nào đã tải'), 'expected the non-matching image reference to show a warning');
      assert(previewHTML.includes('⛔'), 'expected the invalid row to show its error');

      await page.evaluate(() => confirmTrainingTestImport());
      const questions = await page.evaluate(() => tbQuestions);
      assertEqual(questions.length, 2, 'only the 2 valid rows should be imported into tbQuestions');
      assert(/^\/uploads\//.test(questions[0].imageUrl), 'the matching-image question should carry the real uploaded fileUrl');
      assertEqual(questions[1].imageUrl, '', 'the non-matching image reference should NOT be attached (never a made-up URL)');
    });

    await run('exportTrainingTestQuestionsExcel() ships the same column shape as the import template', async () => {
      await page.evaluate(() => { window.__xlsxExports.length = 0; });
      await page.evaluate((tid) => exportTrainingTestQuestionsExcel(tid), testId);
      const exports = await page.evaluate(() => window.__xlsxExports.slice());
      assertEqual(exports.length, 1, 'expected exactly 1 export call');
      const cols = exports[0].columns.map((c) => c.header);
      assert(cols.includes('Nội Dung Câu Hỏi') && cols.includes('Ảnh (đường dẫn /uploads/... hoặc tên tệp đã tải ở bước 2)'),
        `export columns should match the import template shape, got: ${JSON.stringify(cols)}`);
      assertEqual(exports[0].rows.length, 1, 'expected exactly 1 exported question row');
      assert(/^\/uploads\//.test(exports[0].rows[0].image), 'exported image column should carry the real system fileUrl');
    });

    assertEqual(pageErrors.length, 0, `unexpected uncaught page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-training-question-images-ui.js');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
