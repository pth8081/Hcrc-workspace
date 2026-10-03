// tests/test-internal-media-server.js — Nhịp Sống HCRC/Góc Chia Sẻ (9/2026): nội dung định dạng (HTML
// sanitize allowlist ở SERVER bằng sanitize-html), nhiều ảnh + ảnh đại diện (images[]/coverImage), video
// (videos[] + làn tải video riêng ở routes/upload.js + chữ ký nhị phân mp4/webm ở lib/fileSignature.js),
// và tra quyền xem tệp (lib/fileAuthz.js) cho 3 field mới. Test thuần Node, chạy CODE SERVER THẬT
// (lib/createValidation.js, lib/recordActions.js, routes/upload.js, lib/fileAuthz.js) — chỉ thay các module
// chạm SQL Server bằng bản giả cắm vào require.cache (cùng khuôn tests/test-uploads-file-authz.js).
//
// Chạy: node tests/test-internal-media-server.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

function stubModule(relPath, exportsObj) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, children: [], paths: [], exports: exportsObj };
}

// ---- dữ liệu giả cho fileAuthz ----
const PENDING_SHARE = {
  id: 7001, type: 'SHARE', author: 'tac_gia', status: 'PENDING',
  images: [{ fileUrl: '/uploads/pending-img-1.png', fileName: 'a.png' }, { fileUrl: '/uploads/pending-img-2.png', fileName: 'b.png' }],
  coverImage: { fileUrl: '/uploads/pending-img-2.png', fileName: 'b.png' },
  videos: [{ fileUrl: '/uploads/pending-video.mp4', fileName: 'v.mp4' }]
};
const COLLECTIONS = { internalPosts: [PENDING_SHARE] };
stubModule('../lib/recordStore', {
  getAllForCollection: async (name) => COLLECTIONS[name] || [],
  getAllForCollectionCached: async (name) => COLLECTIONS[name] || [],
  getAllTrashItemsCached: async () => []
});
stubModule('../lib/appData', {
  getAllAppData: async () => ({ deptWorkflows: {} }),
  getAppDataValue: async () => ({}),
  getAppDataValueCached: async () => ({})
});
stubModule('../lib/operationWorkItemStore', { getAllWorkItems: async () => [], getAllWorkItemsCached: async () => [], getWorkItemsBySource: async () => [] });
stubModule('../lib/uploadedFiles', { recordUploadedFile: async () => {}, assertPayloadFileUrlsOwnedByUser: async () => {} });

const cv = require('../lib/createValidation');
const ra = require('../lib/recordActions');
const { verifyFileSignature } = require('../lib/fileSignature');
const { authorizeFileAccess } = require('../lib/fileAuthz');
const uploadRouter = require('../routes/upload');

let passed = 0, failed = 0;
async function run(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (err) { failed++; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

const ADMIN = { username: 'admin1', name: 'Admin', dept: 'Phòng CNTT', perms: { admin: true } };
const APP_DATA = { internalNewsCategories: [{ key: 'HOAT_DONG_CHUNG', label: 'Hoạt động chung' }], internalShareCategories: [{ key: 'CONG_VIEC', label: 'Góc công việc' }], formTemplates: {} };
const img = (n) => ({ fileUrl: `/uploads/1-abc${n}.png`, fileName: `anh${n}.png` });
const vid = (n, ext = 'mp4') => ({ fileUrl: `/uploads/1-vid${n}.${ext}`, fileName: `video${n}.${ext}` });

function createNews(extra) {
  const payload = Object.assign({ type: 'NEWS', title: 'Tiêu đề', content: 'Nội dung', postCategory: 'HOAT_DONG_CHUNG' }, extra);
  cv.CREATE_MODULE_CONFIGS.internalPosts.extraValidate(payload, [], ADMIN, APP_DATA);
  return payload;
}
function expectStatus(fn, status, msgRe) {
  try { fn(); } catch (err) {
    assert.strictEqual(err.status || err.statusCode, status, `sai mã lỗi: ${err.message}`);
    if (msgRe) assert.ok(msgRe.test(err.message), `sai thông điệp: ${err.message}`);
    return;
  }
  throw new Error('Phải ném lỗi nhưng không ném');
}

async function main() {
  // ===== Sanitize HTML (XSS lưu trữ) =====
  await run('sanitize: <script>, onerror=, javascript:, iframe, style=, onclick= đều bị lọc sạch; chỉ còn thẻ allowlist', async () => {
    const p = createNews({
      contentFormat: 'html',
      content: '<p>Xin <b>chào</b> <strong onclick="steal()">mọi</strong> <i>người</i> <em style="color:red">nhé</em></p>' +
        '<script>alert(document.cookie)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">bấm</a>' +
        '<iframe src="https://evil.example"></iframe><svg onload=alert(1)><script>alert(2)</script></svg>' +
        '<ul><li data-x="1">một</li></ul><ol><li>hai</li></ol><div>dòng mới<br>xuống dòng</div><span style="x">kệ</span>'
    });
    const html = p.content;
    assert.ok(!/<script|onerror|onclick|onload|javascript:|<iframe|<img|<svg|<a\b|style=|data-x|<span|<div/i.test(html), `còn sót nội dung nguy hiểm: ${html}`);
    assert.ok(html.includes('<b>chào</b>') && html.includes('<strong>mọi</strong>') && html.includes('<i>người</i>') && html.includes('<em>nhé</em>'), `mất định dạng hợp lệ: ${html}`);
    assert.ok(html.includes('<ul><li>một</li></ul>') && html.includes('<ol><li>hai</li></ol>'), `mất danh sách: ${html}`);
    assert.ok(html.includes('<p>dòng mới<br />xuống dòng</p>'), `<div> phải đổi thành <p>, giữ <br>: ${html}`);
    assert.ok(!html.includes('alert'), `nội dung script/svg không được giữ lại dạng chữ: ${html}`);
    assert.strictEqual(p.contentFormat, 'html');
  });

  await run('sanitize: nội dung HTML chỉ có thẻ rỗng (<p><br></p>) bị coi là RỖNG -> 400', async () => {
    expectStatus(() => createNews({ contentFormat: 'html', content: '<p><br></p><script>x</script>' }), 400, /nội dung/i);
  });

  await run('sanitize: nội dung HTML vượt 20.000 ký tự -> 400 (không âm thầm cắt HTML giữa chừng)', async () => {
    expectStatus(() => createNews({ contentFormat: 'html', content: '<p>' + 'a'.repeat(20001) + '</p>' }), 400, /quá dài/i);
  });

  await run('tương thích ngược: bài KHÔNG có contentFormat giữ nguyên văn bản thuần (không sanitize, không đổi "<b>")', async () => {
    const p = createNews({ content: '  1 < 2 và <b>không phải thẻ</b>\ndòng 2  ' });
    assert.strictEqual(p.content, '1 < 2 và <b>không phải thẻ</b>\ndòng 2');
    assert.ok(!('contentFormat' in p), 'bài văn bản thuần không được gắn contentFormat');
  });

  await run('contentFormat lạ (không phải "html") bị bỏ, xử lý như văn bản thuần', async () => {
    const p = createNews({ contentFormat: 'markdown', content: '<script>x</script>' });
    assert.ok(!('contentFormat' in p));
    assert.strictEqual(p.content, '<script>x</script>'); // văn bản thuần — client escapeHtml() lúc hiển thị
  });

  // ===== images[] + coverImage =====
  await run('images: tối đa 8 ảnh (9 ảnh -> 400), coverImage mặc định = ảnh đầu', async () => {
    const eight = [1, 2, 3, 4, 5, 6, 7, 8].map(img);
    const p = createNews({ images: eight });
    assert.strictEqual(p.images.length, 8);
    assert.deepStrictEqual(p.coverImage, eight[0]);
    expectStatus(() => createNews({ images: [...eight, img(9)] }), 400, /tối đa 8/i);
  });

  await run('coverImage: chọn ảnh thứ 3 làm đại diện -> giữ đúng; ảnh không thuộc images[] -> 400', async () => {
    const imgs = [img(1), img(2), img(3)];
    const p = createNews({ images: imgs, coverImage: { fileUrl: imgs[2].fileUrl, fileName: 'x' } });
    assert.deepStrictEqual(p.coverImage, imgs[2]);
    expectStatus(() => createNews({ images: imgs, coverImage: img(99) }), 400, /đại diện/i);
    expectStatus(() => createNews({ images: [], coverImage: img(1) }), 400, /đại diện/i);
  });

  await run('images: mỗi phần tử phải đúng dạng {fileUrl:string, fileName:string}, đúng tệp đã tải lên, đúng đuôi ảnh', async () => {
    expectStatus(() => createNews({ images: 'abc' }), 400);
    expectStatus(() => createNews({ images: ['/uploads/1-a.png'] }), 400);
    expectStatus(() => createNews({ images: [{ fileUrl: '/uploads/1-a.png' }] }), 400);
    expectStatus(() => createNews({ images: [{ fileUrl: 123, fileName: 'a' }] }), 400);
    expectStatus(() => createNews({ images: [{ fileUrl: 'javascript:alert(1)', fileName: 'a.png' }] }), 400);
    expectStatus(() => createNews({ images: [{ fileUrl: 'https://evil.example/a.png', fileName: 'a.png' }] }), 400);
    expectStatus(() => createNews({ images: [{ fileUrl: '/uploads/1-a.pdf', fileName: 'a.pdf' }] }), 400, /định dạng/i);
    const p = createNews({ images: [{ fileUrl: '/uploads/1-a.png', fileName: 'a.png', evil: '<script>' }] });
    assert.deepStrictEqual(p.images, [{ fileUrl: '/uploads/1-a.png', fileName: 'a.png' }], 'field lạ phải bị bỏ');
  });

  await run('attachment CŨ không bị đụng tới khi thêm images[] (2 field tách biệt)', async () => {
    // fileType ẢNH (không phải application/pdf): từ "Việc E" (11/2026), NEWS/SHARE chỉ còn được đính kèm
    // ảnh qua attachment (ô #internalFile tài liệu đã bỏ) — đổi fixture sang ảnh để không bị chặn nhầm ở
    // lớp luật MỚI đó, bài test này chỉ đang kiểm 2 field attachment/images[] tách biệt nhau.
    const att = { fileName: 'doc.jpg', fileType: 'image/jpeg', fileUrl: '/uploads/1-doc.jpg' };
    const p = createNews({ attachment: att, images: [img(1)] });
    assert.deepStrictEqual(p.attachment, att);
    assert.deepStrictEqual(p.coverImage, img(1));
  });

  // ===== videos[] =====
  await run('videos: tối đa 2 (3 -> 400), chỉ .mp4/.webm, tách biệt khỏi images[]', async () => {
    const p = createNews({ videos: [vid(1), vid(2, 'webm')] });
    assert.strictEqual(p.videos.length, 2);
    assert.deepStrictEqual(p.images, []);
    expectStatus(() => createNews({ videos: [vid(1), vid(2), vid(3)] }), 400, /tối đa 2/i);
    expectStatus(() => createNews({ videos: [{ fileUrl: '/uploads/1-x.png', fileName: 'x.png' }] }), 400, /định dạng/i);
    expectStatus(() => createNews({ images: [vid(1)] }), 400, /định dạng/i);
  });

  // ===== videos[] — nhúng YouTube (9/2026): {type:'youtube', youtubeUrl} song song {type:'upload', ...} =====
  const yt = (url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ') => ({ type: 'youtube', youtubeUrl: url });

  await run('YouTube (a): 1 video YouTube hợp lệ được chấp nhận, lưu đúng dạng {type, youtubeUrl} (bỏ field lạ/fileUrl)', async () => {
    const p = createNews({ videos: [Object.assign(yt('  https://youtu.be/dQw4w9WgXcQ  '), { fileUrl: '/uploads/1-x.mp4', evil: '<script>' })] });
    assert.deepStrictEqual(p.videos, [{ type: 'youtube', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' }]);
    for (const u of ['https://www.youtube.com/watch?v=abcDEF12345', 'https://m.youtube.com/watch?v=abcDEF12345', 'https://youtube.com/shorts/abcDEF12345']) {
      assert.strictEqual(createNews({ videos: [yt(u)] }).videos[0].youtubeUrl, u);
    }
  });

  await run('YouTube (b): link YouTube không hợp lệ bị từ chối 400 với thông báo rõ ràng', async () => {
    const bad = ['http://www.youtube.com/watch?v=abc', 'javascript:alert(1)//youtube.com', 'https://youtube.com.evil.tld/watch?v=abc',
      'https://vimeo.com/123', 'khong phai url', '', 'https://www.youtube.com/watch?v=' + 'a'.repeat(600)];
    for (const u of bad) expectStatus(() => createNews({ videos: [yt(u)] }), 400, /link YouTube không hợp lệ/i);
    expectStatus(() => createNews({ videos: [{ type: 'youtube' }] }), 400, /link YouTube không hợp lệ/i);
    expectStatus(() => createNews({ videos: [{ type: 'youtube', youtubeUrl: 123 }] }), 400, /link YouTube không hợp lệ/i);
    // images[] KHÔNG bao giờ nhận YouTube (chỉ videos[] mới bật nhánh này).
    expectStatus(() => createNews({ images: [yt()] }), 400);
  });

  await run('YouTube (c): dữ liệu CŨ (videos[] không có type) vẫn là video tải lên — bắt buộc fileUrl như trước', async () => {
    const p = createNews({ videos: [vid(1)] });
    assert.deepStrictEqual(p.videos, [{ type: 'upload', fileUrl: vid(1).fileUrl, fileName: vid(1).fileName }]);
    // Thiếu type + chỉ có youtubeUrl -> KHÔNG được coi là YouTube (không đảo mặc định), bị từ chối vì thiếu fileUrl.
    expectStatus(() => createNews({ videos: [{ youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' }] }), 400, /không hợp lệ/i);
    // type lạ -> cũng đi nhánh upload.
    expectStatus(() => createNews({ videos: [{ type: 'vimeo', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' }] }), 400, /không hợp lệ/i);
    // type 'upload' tường minh vẫn validate tệp như cũ (đuôi/nguồn).
    expectStatus(() => createNews({ videos: [{ type: 'upload', fileUrl: 'https://evil.example/a.mp4', fileName: 'a.mp4' }] }), 400);
    expectStatus(() => createNews({ videos: [{ type: 'upload', fileUrl: '/uploads/1-x.png', fileName: 'x.png' }] }), 400, /định dạng/i);
  });

  await run('YouTube (d): 1 upload + 1 YouTube = 2 được nhận; thêm phần tử thứ 3 (loại nào cũng vậy) -> 400 trần 2', async () => {
    const p = createNews({ videos: [vid(1), yt()] });
    assert.deepStrictEqual(p.videos.map(v => v.type), ['upload', 'youtube']);
    expectStatus(() => createNews({ videos: [vid(1), yt(), yt('https://youtu.be/abcDEF12345')] }), 400, /tối đa 2/i);
    expectStatus(() => createNews({ videos: [vid(1), yt(), vid(2)] }), 400, /tối đa 2/i);
    expectStatus(() => createNews({ videos: [yt(), yt('https://youtu.be/a1'), yt('https://youtu.be/a2')] }), 400, /tối đa 2/i);
    // Trùng link YouTube -> gộp 1 (như trùng fileUrl).
    assert.strictEqual(createNews({ videos: [yt(), yt()] }).videos.length, 1);
  });

  await run('YouTube (e): SỬA bài cũ có video YouTube (+ upload cũ không type) -> lưu lại giữ nguyên đúng dữ liệu', async () => {
    const post = Object.assign(createNews({ draft: true, videos: [yt('https://youtu.be/dQw4w9WgXcQ')] }), { id: 11, author: 'admin1' });
    assert.deepStrictEqual(post.videos, [{ type: 'youtube', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' }]);
    // Sửa field khác, KHÔNG gửi videos -> vẫn giữ nguyên video YouTube.
    ra.editInternalPost({ title: 'Tiêu đề mới', draft: true }, ADMIN, post, APP_DATA);
    assert.deepStrictEqual(post.videos, [{ type: 'youtube', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' }]);
    // Client gửi lại đúng danh sách đã nạp (YouTube + 1 upload CŨ không có type) -> giữ nguyên YouTube, upload gắn type.
    ra.editInternalPost({ videos: [yt('https://youtu.be/dQw4w9WgXcQ'), vid(1)], draft: true }, ADMIN, post, APP_DATA);
    assert.deepStrictEqual(post.videos, [
      { type: 'youtube', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' },
      { type: 'upload', fileUrl: vid(1).fileUrl, fileName: vid(1).fileName }
    ]);
    // Bản ghi CŨ trong DB (videos không có type) sửa field khác -> vẫn hợp lệ, coi là upload.
    const legacy = Object.assign(createNews({ draft: true }), { id: 12, author: 'admin1', videos: [vid(2)] });
    ra.editInternalPost({ title: 'Sửa bài cũ', draft: true }, ADMIN, legacy, APP_DATA);
    assert.deepStrictEqual(legacy.videos, [{ type: 'upload', fileUrl: vid(2).fileUrl, fileName: vid(2).fileName }]);
    // SỬA mà gửi link YouTube hỏng -> 400, như lúc TẠO.
    expectStatus(() => ra.editInternalPost({ videos: [yt('https://evil.example/watch?v=x')], draft: true }, ADMIN, post, APP_DATA), 400, /link YouTube không hợp lệ/i);
  });

  await run('fileAuthz: phần tử YouTube (không có fileUrl) không làm lỗi tra quyền tệp của bài', async () => {
    const postWithYt = { id: 7002, type: 'SHARE', author: 'tac_gia', status: 'PENDING', videos: [yt(), { fileUrl: '/uploads/pending-video-2.mp4', fileName: 'v2.mp4' }] };
    COLLECTIONS.internalPosts.push(postWithYt);
    try {
      assert.strictEqual(await authorizeFileAccess({ username: 'nguoi_ngoai', dept: 'X', perms: {} }, '/uploads/pending-video-2.mp4', 'view'), false);
      assert.strictEqual(await authorizeFileAccess({ username: 'tac_gia', dept: 'X', perms: {} }, '/uploads/pending-video-2.mp4', 'view'), true);
    } finally {
      COLLECTIONS.internalPosts.pop();
    }
  });

  // ===== Đường SỬA (editInternalPost) dùng cùng luật =====
  await run('SỬA bài nháp: sanitize lại content HTML + validate images/coverImage/videos như lúc TẠO', async () => {
    const post = Object.assign(createNews({ draft: true }), { id: 1, author: 'admin1' });
    assert.strictEqual(post.status, 'DRAFT');
    ra.editInternalPost({ content: '<p>ok <b>đậm</b><img src=x onerror=alert(1)></p>', contentFormat: 'html', images: [img(1), img(2)], coverImage: img(2), videos: [vid(1)], draft: true }, ADMIN, post, APP_DATA);
    assert.strictEqual(post.content, '<p>ok <b>đậm</b></p>');
    assert.deepStrictEqual(post.coverImage, img(2));
    assert.strictEqual(post.videos.length, 1);
    const post2 = Object.assign(createNews({ draft: true }), { id: 2, author: 'admin1' });
    expectStatus(() => ra.editInternalPost({ images: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(img), draft: true }, ADMIN, post2, APP_DATA), 400, /tối đa 8/i);
  });

  await run('SỬA bài CŨ (văn bản thuần) không gửi contentFormat -> vẫn là văn bản thuần như trước', async () => {
    const post = Object.assign(createNews({ draft: true, content: 'a < b' }), { id: 3, author: 'admin1' });
    ra.editInternalPost({ title: 'Mới', draft: true }, ADMIN, post, APP_DATA);
    assert.strictEqual(post.content, 'a < b');
    assert.ok(!post.contentFormat);
  });

  // ===== Chữ ký nhị phân video =====
  const mp4Head = (brand = 'isom') => { const b = Buffer.alloc(64); b.writeUInt32BE(32, 0); b.write('ftyp', 4); b.write(brand, 8); b.write('isommp41', 16); return b; };
  const ebml = (doc) => { const d = Buffer.from(doc); const body = Buffer.concat([Buffer.from([0x42, 0x82, 0x80 | d.length]), d]); return Buffer.concat([Buffer.from([0x1A, 0x45, 0xDF, 0xA3, 0x80 | body.length]), body, Buffer.alloc(32)]); };
  const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000000', 'hex');

  await run('fileSignature: mp4 thật/webm thật qua; PNG/văn bản đổi đuôi .mp4/.webm, MOV/MKV giả dạng bị chặn', async () => {
    assert.strictEqual((await verifyFileSignature(mp4Head(), '.mp4')).ok, true);
    assert.strictEqual((await verifyFileSignature(ebml('webm'), '.webm')).ok, true);
    assert.strictEqual((await verifyFileSignature(PNG, '.mp4')).ok, false);
    assert.strictEqual((await verifyFileSignature(Buffer.from('not a video at all, just text'), '.webm')).ok, false);
    assert.strictEqual((await verifyFileSignature(mp4Head('qt  '), '.mp4')).ok, false);
    assert.strictEqual((await verifyFileSignature(ebml('matroska'), '.webm')).ok, false);
  });

  // ===== routes/upload.js — làn video thật qua HTTP =====
  const app = express();
  app.use((req, res, next) => { req.freshUser = { username: 'admin1', perms: { admin: true } }; next(); });
  app.use('/api/upload', uploadRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = server.address().port;
  const created = [];
  const post = (url, fields, fileName, fileBuf) => new Promise((resolve, reject) => {
    const boundary = '----t' + Math.random().toString(16).slice(2);
    const parts = [];
    for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    parts.push(fileBuf, Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(parts);
    const req = http.request({ host: '127.0.0.1', port, path: url, method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length } }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => {
        let json = {}; try { json = JSON.parse(data); } catch (_) { /* ignore */ }
        if (json.fileUrl) created.push(json.fileUrl);
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });

  try {
    await run('upload: hằng số giới hạn video rõ ràng = 200MB, moduleKey internalVideo mặc định chỉ .mp4/.webm', async () => {
      assert.strictEqual(uploadRouter.INTERNAL_VIDEO_MAX_MB, 200);
      assert.deepStrictEqual(uploadRouter.MODULE_DEFAULT_ALLOWED_EXT.internalVideo, ['.mp4', '.webm']);
      assert.strictEqual(uploadRouter.MODULE_DEFAULT_MAX_MB.internalVideo, 200);
    });

    await run('upload: mp4 hợp lệ qua làn video (?module=internalVideo) -> 200, lưu đúng đuôi .mp4', async () => {
      const r = await post('/api/upload?module=internalVideo', { module: 'internalVideo' }, 'clip.mp4', Buffer.concat([mp4Head(), Buffer.alloc(4096)]));
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.ok(/^\/uploads\/[A-Za-z0-9._-]+\.mp4$/.test(r.json.fileUrl), r.json.fileUrl);
    });

    await run('upload: webm hợp lệ qua làn video -> 200', async () => {
      const r = await post('/api/upload?module=internalVideo', { module: 'internalVideo' }, 'clip.webm', ebml('webm'));
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    });

    await run('upload: ảnh PNG đổi đuôi thành .mp4 bị chặn bởi kiểm tra chữ ký (400)', async () => {
      const r = await post('/api/upload?module=internalVideo', { module: 'internalVideo' }, 'fake.mp4', PNG);
      assert.strictEqual(r.status, 400);
      assert.ok(/không khớp/i.test(r.json.error), r.json.error);
    });

    await run('upload: làn video chỉ nhận .mp4/.webm (.png/.pdf qua làn video -> 400)', async () => {
      const r = await post('/api/upload?module=internalVideo', { module: 'internalVideo' }, 'a.png', PNG);
      assert.strictEqual(r.status, 400);
    });

    await run('upload: mượn làn video với module body khác -> 400', async () => {
      const r = await post('/api/upload?module=internalVideo', { module: 'doc' }, 'clip.mp4', mp4Head());
      assert.strictEqual(r.status, 400);
      assert.ok(/làn tải video/i.test(r.json.error), r.json.error);
    });

    await run('upload: .mp4 qua làn THƯỜNG (không ?module=internalVideo) vẫn bị chặn như cũ (định dạng không hỗ trợ)', async () => {
      const r = await post('/api/upload', { module: 'internalVideo' }, 'clip.mp4', mp4Head());
      assert.strictEqual(r.status, 400);
      assert.ok(/không được hỗ trợ/i.test(r.json.error), r.json.error);
    });

    await run('upload: video vượt 200MB bị chặn (LIMIT_FILE_SIZE -> 400, báo đúng 200MB)', async () => {
      const big = Buffer.alloc(200 * 1024 * 1024 + 1024);
      mp4Head().copy(big, 0);
      const r = await post('/api/upload?module=internalVideo', { module: 'internalVideo' }, 'big.mp4', big);
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert.ok(/200MB/.test(r.json.error), r.json.error);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const u of created) { try { fs.unlinkSync(path.join(__dirname, '..', u)); } catch (_) { /* ignore */ } }
  }

  // ===== fileAuthz — ảnh/video bài CHỜ DUYỆT không được rơi vào FAIL-OPEN =====
  await run('fileAuthz: images[]/coverImage/videos[] của bài Góc Chia Sẻ CHỜ DUYỆT chỉ tác giả/admin xem được', async () => {
    const outsider = { username: 'nguoi_ngoai', dept: 'X', perms: {} };
    const author = { username: 'tac_gia', dept: 'X', perms: {} };
    for (const u of ['/uploads/pending-img-1.png', '/uploads/pending-img-2.png', '/uploads/pending-video.mp4']) {
      assert.strictEqual(await authorizeFileAccess(outsider, u, 'view'), false, `người ngoài không được xem ${u}`);
      assert.strictEqual(await authorizeFileAccess(author, u, 'view'), true, `tác giả phải xem được ${u}`);
      assert.strictEqual(await authorizeFileAccess(ADMIN, u, 'view'), true, `admin phải xem được ${u}`);
    }
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
