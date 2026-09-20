// server/tests/test-internalpost-comment-own-edit-delete.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): deleteInternalPostComment() (lib/recordActions.js)
// trước đây CHỈ người kiểm duyệt (canApproveInternalPost) xoá được bình luận — tác giả gõ nhầm/muốn
// rút lại chính bình luận của mình không có cách nào tự xử lý. Nay cho phép tác giả tự SỬA
// (editInternalPostComment(), mới thêm) hoặc XOÁ đúng bình luận của chính mình, TRỪ khi bình luận đang
// pendingModeration (đã bị hệ thống gắn cờ, chờ người kiểm duyệt xử lý) — không cho "phi tang" trước
// khi được xem xét.
//
// addInternalPostComment()/editInternalPostComment()/deleteInternalPostComment() đều THUẦN — gọi thẳng.
//
// Chạy: node server/tests/test-internalpost-comment-own-edit-delete.js
'use strict';
const assert = require('assert');
const { addInternalPostComment, editInternalPostComment, deleteInternalPostComment } = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const AUTHOR = { username: 'nv1', name: 'Nhân Viên 1' };
const OTHER = { username: 'nv2', name: 'Nhân Viên 2' };
const MODERATOR = { username: 'hc1', name: 'Hành Chính', perms: { internalPostApprove: true } };
const SENSITIVE_KEYWORDS = [{ term: 'lương thưởng nội bộ', category: 'NHAY_CAM' }];

function makePost() {
  const post = { id: 1, title: 'Bài viết test', comments: [] };
  addInternalPostComment({ content: 'Bình luận gốc của tôi' }, AUTHOR, post, []);
  return post;
}

test('LỖI ĐÃ VÁ: tác giả tự SỬA bình luận của chính mình -> thành công, có editedAt', () => {
  const post = makePost();
  const commentId = post.comments[0].id;
  editInternalPostComment({ content: 'Nội dung đã sửa' }, AUTHOR, post, commentId, []);
  assert.strictEqual(post.comments[0].content, 'Nội dung đã sửa');
  assert.ok(post.comments[0].editedAt, 'Phải ghi nhận thời điểm sửa');
});

test('Người KHÁC (không phải tác giả, không phải kiểm duyệt) SỬA bình luận của người khác -> 403', () => {
  const post = makePost();
  const commentId = post.comments[0].id;
  assert.throws(() => editInternalPostComment({ content: 'Sửa hộ' }, OTHER, post, commentId, []), /403|chỉ có thể sửa/);
});

test('LỖI ĐÃ VÁ: tác giả tự XOÁ bình luận của chính mình -> thành công', () => {
  const post = makePost();
  const commentId = post.comments[0].id;
  deleteInternalPostComment(AUTHOR, post, commentId);
  assert.strictEqual(post.comments.length, 0);
});

test('Người KHÁC (không phải tác giả, không phải kiểm duyệt) XOÁ bình luận của người khác -> vẫn 403 như trước', () => {
  const post = makePost();
  const commentId = post.comments[0].id;
  assert.throws(() => deleteInternalPostComment(OTHER, post, commentId), /403|quyền/);
});

test('Người kiểm duyệt vẫn xoá được bình luận của người khác như cũ (không đổi hành vi cũ)', () => {
  const post = makePost();
  const commentId = post.comments[0].id;
  deleteInternalPostComment(MODERATOR, post, commentId);
  assert.strictEqual(post.comments.length, 0);
});

test('Bình luận đang pendingModeration (bị gắn cờ) -> tác giả KHÔNG tự sửa/xoá được, phải chờ kiểm duyệt', () => {
  const post = { id: 2, title: 'Bài viết 2', comments: [] };
  addInternalPostComment({ content: 'Bình luận có từ khoá lương thưởng nội bộ' }, AUTHOR, post, SENSITIVE_KEYWORDS);
  const commentId = post.comments[0].id;
  assert.strictEqual(post.comments[0].pendingModeration, true, 'Setup: bình luận phải đang chờ kiểm duyệt');
  assert.throws(() => editInternalPostComment({ content: 'Sửa né kiểm duyệt' }, AUTHOR, post, commentId, SENSITIVE_KEYWORDS), /409|chờ kiểm duyệt/);
  assert.throws(() => deleteInternalPostComment(AUTHOR, post, commentId), /409|chờ kiểm duyệt/);
  // Người kiểm duyệt vẫn xử lý được bình thường dù đang pendingModeration.
  deleteInternalPostComment(MODERATOR, post, commentId);
  assert.strictEqual(post.comments.length, 0);
});

test('Tác giả sửa bình luận SẠCH thành nội dung khớp từ khoá nhạy cảm -> vẫn bị đưa vào chờ kiểm duyệt (không né được)', () => {
  const post = makePost();
  const commentId = post.comments[0].id;
  editInternalPostComment({ content: 'Bàn về lương thưởng nội bộ nhé' }, AUTHOR, post, commentId, SENSITIVE_KEYWORDS);
  assert.strictEqual(post.comments[0].pendingModeration, true, 'Sửa thành nội dung nhạy cảm phải bị gắn cờ như bình luận mới');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
