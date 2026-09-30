// tests/test-internalpost-share-video-restriction.js — Góc Chia Sẻ (SHARE) KHÔNG cho phép tải file video
// lên server, CHỈ cho nhúng link YouTube (10/2026, theo yêu cầu người dùng: "góc chia sẻ hông cho phép up
// file video có thể nhúng link youtube"). Nhịp Sống HCRC (NEWS) vẫn cho cả 2 cách như trước — test dưới
// đây xác nhận luật MỚI chỉ áp dụng đúng phạm vi SHARE, không ảnh hưởng NEWS.
//
// Test THUẦN gọi thẳng 2 hàm server thật (không HTTP, không mock SQL) — cùng khuôn
// tests/test-audit-round3-internalposts-edit.js:
//   - createValidation.js internalPosts.extraValidate() — đường TẠO.
//   - recordActions.js editInternalPost() — đường SỬA (có "grandfather" cho video tải lên CŨ đã lưu
//     TRƯỚC đợt siết này, xem chú thích tại đó).
const assert = require('assert');
const cv = require('../lib/createValidation');
const { editInternalPost } = require('../lib/recordActions');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`PASS: ${name}`); }
  catch (e) { fail++; console.log(`FAIL: ${name} — ${e.message}`); }
}
function expectThrows400(fn, msgRe) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; assert.strictEqual(e.status || e.statusCode, 400, `sai mã lỗi: ${e.message}`); if (msgRe) assert.ok(msgRe.test(e.message), `sai thông điệp: ${e.message}`); }
  assert.strictEqual(threw, true, 'phải ném lỗi 400 nhưng không ném');
}

const admin = { username: 'admin1', perms: { admin: true } };
const APP_DATA = {
  internalNewsCategories: [{ key: 'TIN_TUC', label: 'Tin Tức' }],
  internalShareCategories: [{ key: 'CHIA_SE', label: 'Chia Sẻ' }],
  formTemplates: {}
};
const upload = (n) => ({ type: 'upload', fileUrl: `/uploads/1-vid${n}.mp4`, fileName: `video${n}.mp4` });
const yt = (id) => ({ type: 'youtube', youtubeUrl: `https://www.youtube.com/watch?v=${id}` });

function createPost(type, extra) {
  const payload = Object.assign({
    type, title: 'Tiêu đề', content: 'Nội dung',
    postCategory: type === 'NEWS' ? 'TIN_TUC' : 'CHIA_SE'
  }, extra);
  cv.CREATE_MODULE_CONFIGS.internalPosts.extraValidate(payload, [], admin, APP_DATA);
  return payload;
}

// ===== Đường TẠO =====
check('TẠO SHARE + video tải lên (type upload) -> 400, không cho', () => {
  expectThrows400(() => createPost('SHARE', { videos: [upload(1)] }), /Góc Chia Sẻ.*YouTube/i);
});

check('TẠO SHARE + video YouTube -> vẫn tạo được bình thường', () => {
  const p = createPost('SHARE', { videos: [yt('dQw4w9WgXcQ')] });
  assert.strictEqual(p.videos.length, 1);
  assert.strictEqual(p.videos[0].type, 'youtube');
});

check('TẠO SHARE + trộn 1 upload + 1 youtube -> vẫn bị chặn (còn 1 phần tử upload là đủ để từ chối)', () => {
  expectThrows400(() => createPost('SHARE', { videos: [upload(1), yt('dQw4w9WgXcQ')] }));
});

check('TẠO NEWS + video tải lên -> KHÔNG bị ảnh hưởng bởi luật mới (vẫn cho như trước)', () => {
  const p = createPost('NEWS', { videos: [upload(1)] });
  assert.strictEqual(p.videos.length, 1);
  assert.strictEqual(p.videos[0].type, 'upload');
});

// ===== Đường SỬA =====
function sharePostWithLegacyUpload() {
  return {
    id: 100, type: 'SHARE', author: 'nv1', status: 'DRAFT', title: 'Bài cũ', content: 'Nội dung',
    postCategory: 'CHIA_SE', videos: [upload(9)] // video tải lên có TRƯỚC đợt siết luật (giả lập dữ liệu cũ)
  };
}
const shareAuthor = { username: 'nv1', perms: {} };

check('SỬA bài SHARE cũ (có sẵn video tải lên) chỉ đổi tiêu đề, KHÔNG đụng videos -> vẫn lưu được, giữ nguyên video cũ', () => {
  const post = sharePostWithLegacyUpload();
  const result = editInternalPost({ title: 'Tiêu đề mới' }, shareAuthor, post, APP_DATA);
  assert.strictEqual(result.title, 'Tiêu đề mới');
  assert.strictEqual(result.videos.length, 1);
  assert.strictEqual(result.videos[0].fileUrl, '/uploads/1-vid9.mp4');
});

check('SỬA bài SHARE cũ: xoá hẳn video tải lên cũ (videos: []) -> cho phép (gỡ bỏ luôn hợp lệ)', () => {
  const post = sharePostWithLegacyUpload();
  const result = editInternalPost({ videos: [] }, shareAuthor, post, APP_DATA);
  assert.strictEqual(result.videos.length, 0);
});

check('SỬA bài SHARE cũ: giữ video tải lên cũ + thêm 1 video YouTube mới -> cho phép (chỉ chặn upload MỚI)', () => {
  const post = sharePostWithLegacyUpload();
  const result = editInternalPost({ videos: [upload(9), yt('dQw4w9WgXcQ')] }, shareAuthor, post, APP_DATA);
  assert.strictEqual(result.videos.length, 2);
});

check('SỬA bài SHARE cũ: thêm 1 video tải lên MỚI (khác video cũ) -> 400, không cho', () => {
  const post = sharePostWithLegacyUpload();
  expectThrows400(() => editInternalPost({ videos: [upload(9), upload(10)] }, shareAuthor, post, APP_DATA));
});

check('SỬA bài SHARE KHÔNG có video cũ nào: thêm video tải lên MỚI -> 400', () => {
  const post = { id: 101, type: 'SHARE', author: 'nv1', status: 'DRAFT', title: 'Bài', content: 'Nội dung', postCategory: 'CHIA_SE', videos: [] };
  expectThrows400(() => editInternalPost({ videos: [upload(1)] }, shareAuthor, post, APP_DATA));
});

check('SỬA bài NEWS + thêm video tải lên -> KHÔNG bị ảnh hưởng (vẫn cho như trước)', () => {
  const post = { id: 102, type: 'NEWS', author: 'nv1', status: 'DRAFT', title: 'Tin', content: 'Nội dung', postCategory: 'TIN_TUC', videos: [] };
  const newsAuthor = { username: 'nv1', perms: { internalNewsCreate: true } };
  const result = editInternalPost({ videos: [upload(1)] }, newsAuthor, post, APP_DATA);
  assert.strictEqual(result.videos.length, 1);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
