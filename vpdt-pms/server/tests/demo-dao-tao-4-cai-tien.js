// server/tests/demo-dao-tao-4-cai-tien.js
//
// DEMO thật (người dùng chủ động yêu cầu "demo cho mình để xác nhận") cho 4 cải tiến Đào Tạo vừa merge
// (v24.67, xem VERSION.md + deploy/Huong-dan-nghiep-vu.md mục 5e):
//   1. Lớp Học — nút vào thẳng lớp cho học viên đã đăng ký.
//   2. Kết Quả — đổi nhãn Đạt/Không đạt sang Hoàn thành/Chưa hoàn thành.
//   3. Lộ Trình Tân Binh — gán Tài Liệu Đính Kèm + Lớp Học Tham Chiếu (gợi ý kết quả thật ở GĐ1).
//   4. Kho Tài Liệu Đào Tạo — thumbnail (PDF/Video/Ảnh).
//
// Dùng tests/_harness.js (Chromium thật mở public/index.html thật + toàn bộ public/js/*.js thật) — data
// CẤY SẴN trực tiếp vào DB.* (bỏ qua luồng tạo qua UI, đã phủ đủ ở test-internal-training.js/
// test-onboarding.js/test-onboarding-path-edit.js), chỉ để CHỤP ẢNH đúng trạng thái "sau khi có dữ
// liệu" của từng tính năng. Thumbnail dùng data: URI (ảnh PNG nhỏ tự vẽ) thay vì đường dẫn thật/link
// Youtube thật — môi trường chạy demo không đảm bảo có Internet để tải ảnh ngoài, data: URI đảm bảo
// ảnh luôn hiện ra trong ảnh chụp bất kể mạng, phản ánh đúng CƠ CHẾ (ảnh được gán vào thumbnailUrl rồi
// hiển thị qua <img>), không phải nội dung ảnh thật.
//
// Chạy: node server/tests/demo-dao-tao-4-cai-tien.js
'use strict';
const fs = require('fs');
const path = require('path');
const { setup, teardown, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8993;
const OUT_DIR = process.env.DAOTAO_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'dao-tao-4-cai-tien');

// PNG 1x1 (đặc 1 màu, trình duyệt tự giãn theo class w-10 h-10 object-cover) tự sinh bằng zlib ngay bên
// dưới — tự vẽ đúng chuẩn PNG, không phụ thuộc file ngoài, không gõ tay base64 (dễ sai byte -> ảnh lỗi).
function makeSolidPng1x1(r, g, b) {
  function crc32(buf) {
    let c, crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      c = (crc ^ buf[i]) & 0xFF;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function makeChunk(type, data) {
    const typeBuf = Buffer.from(type);
    const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }
  const zlib = require('zlib');
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idatData = zlib.deflateSync(Buffer.from([0, r, g, b]));
  const png = Buffer.concat([sig, makeChunk('IHDR', ihdr), makeChunk('IDAT', idatData), makeChunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}
const DEMO_THUMB_RED = makeSolidPng1x1(220, 38, 38); // demo thumbnail PDF
const DEMO_THUMB_BLUE = makeSolidPng1x1(37, 99, 235); // demo thumbnail Youtube
const DEMO_THUMB_GREEN = makeSolidPng1x1(22, 163, 74); // demo "Ảnh" dùng thẳng fileUrl gốc làm thumbnail

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { server, browser, page, pageErrors } = await setup(PORT);

  try {
    const trainer = makeUser({ username: 'gv.linh', name: 'Trần Thị Linh', dept: 'Phòng Nhân Sự', perms: { trainingManage: true } });
    const nv1 = makeUser({ username: 'tb.minh', name: 'Nguyễn Văn Minh', dept: 'Phòng CNTT', perms: {} });

    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((users) => { DB.users = users; }, [trainer, nv1]);

    // ===== Seed dữ liệu: 1 lớp Tân Binh + 1 đăng ký đã Hoàn thành (PASSED) =====
    await page.evaluate(() => {
      DB.trainingClasses.push({
        id: 9001, code: 'LH-TB-001', category: 'Nghiệp vụ', title: 'Lớp Tân Binh Kho Q1/2026',
        mode: 'ONLINE', status: 'OPEN', capacity: 20, documentIds: [], testId: null,
        creator: 'gv.linh', creatorName: 'Trần Thị Linh'
      });
      DB.trainingRegistrations.push({
        id: 9101, classId: 9001, creator: 'tb.minh', creatorName: 'Nguyễn Văn Minh', result: 'PASSED'
      });
    });

    // ===== 1. Lớp Học — nút vào thẳng lớp (góc nhìn học viên "tb.minh") =====
    await page.evaluate((u) => { currentUser = u; finishLogin(u); }, nv1);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('CLASSES'); renderTrainingClasses(); });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '1-lop-hoc-nut-vao-lop.png'), fullPage: false });

    // ===== 2+3b. Kết Quả (Hoàn thành/Chưa hoàn thành) — góc nhìn giảng viên =====
    await page.evaluate((u) => { currentUser = u; finishLogin(u); }, trainer);
    await page.evaluate(() => {
      switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('CLASSES');
      openTrainingResultsModal(9001);
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '2-ket-qua-hoan-thanh.png'), fullPage: false });
    await page.evaluate(() => closeTrainingResultsModal());

    // ===== 4. Kho Tài Liệu Đào Tạo — thumbnail PDF/Video/Ảnh =====
    await page.evaluate((thumbs) => {
      DB.trainingDocuments.push(
        { id: 9201, docType: 'DOCUMENT', category: 'Nghiệp vụ', title: 'Nội Quy Công Ty 2026', description: '', mandatory: true, fileName: 'noi-quy-cong-ty.pdf', fileType: 'application/pdf', fileUrl: '/uploads/demo-noiquy.pdf', thumbnailUrl: thumbs.red, uploaderName: 'Trần Thị Linh' },
        { id: 9202, docType: 'VIDEO', category: 'Nghiệp vụ', title: 'Video Hướng Dẫn An Toàn Lao Động', description: '', mandatory: false, videoUrl: 'https://www.youtube.com/watch?v=demoVideoId01', durationSeconds: 300, thumbnailUrl: thumbs.blue, uploaderName: 'Trần Thị Linh' },
        { id: 9203, docType: 'IMAGE', category: 'Kỹ năng mềm', title: 'Sơ Đồ Quy Trình Nghỉ Phép', description: '', mandatory: false, fileName: 'so-do.png', fileType: 'image/png', fileUrl: thumbs.green, uploaderName: 'Trần Thị Linh' }
      );
    }, { red: DEMO_THUMB_RED, blue: DEMO_THUMB_BLUE, green: DEMO_THUMB_GREEN });
    await page.evaluate(() => { setTrainingLmsTab('DOCS'); renderTrainingDocuments(); });
    await page.evaluate(() => { document.getElementById('trainingDocumentsContainer')?.scrollIntoView({ block: 'start' }); });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '3-kho-tai-lieu-thumbnail.png'), fullPage: false });

    // ===== 3a+3b. Lộ Trình Tân Binh — Tài Liệu Đính Kèm + Lớp Học Tham Chiếu =====
    await page.evaluate(() => {
      DB.onboardingPaths.push({
        id: 9301, name: 'Lộ Trình Nhân Viên Kho',
        stage1Criteria: 'Nắm nội quy công ty, an toàn lao động, quy trình kho hàng.',
        stage2Criteria: 'Thành thạo quy trình nhập/xuất kho, sử dụng phần mềm quản lý kho.',
        stage3Criteria: 'Thái độ làm việc, tinh thần trách nhiệm.',
        stage1DocIds: [9201], stage2DocIds: [9202], linkedClassId: 9001,
        creator: 'gv.linh', creatorName: 'Trần Thị Linh'
      });
      DB.onboardingProgress.push({
        id: 9401, employeeUsername: 'tb.minh', employeeName: 'Nguyễn Văn Minh',
        pathId: 9301, pathName: 'Lộ Trình Nhân Viên Kho', startDate: '2026-09-01',
        stage1Result: null, stage2Result: null, stage3Evaluation: null, certificateIssued: false
      });
    });
    await page.evaluate(() => { setTrainingLmsTab('ONBOARDING'); renderOnboardingLms(); });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '4-lo-trinh-tan-binh-tai-lieu-dinh-kem.png'), fullPage: false });

    // Cuộn xuống bảng Theo Dõi Tiến Độ (GĐ1 hiện gợi ý kết quả thật từ lớp tham chiếu) để chụp riêng.
    await page.evaluate(() => {
      document.getElementById('onboardingProgressTableBody')?.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '5-tien-do-gd1-goi-y-ket-qua-that.png'), fullPage: false });

    console.log(`\nĐã chụp 5 ảnh demo vào: ${OUT_DIR}`);
    if (pageErrors.length) {
      console.log('\n⚠️  CẢNH BÁO: có lỗi JS trong trang khi chạy demo:');
      pageErrors.forEach((e) => console.log('  ', e.message));
      process.exitCode = 1;
    }
  } finally {
    await teardown({ server, browser });
  }
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy demo-dao-tao-4-cai-tien.js:', err);
  process.exitCode = 1;
});
