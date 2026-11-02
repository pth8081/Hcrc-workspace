// tests/test-internalpost-edit-approved.js
//
// LỖI ĐÃ VÁ (11/2026, yêu cầu người dùng: "đã phân quyền sửa, xóa bài viết trong Nhịp Sống HCRC/Góc
// Chia Sẻ nhưng vẫn không thấy nút Sửa, chỉ có Xóa"): editInternalPost() (lib/recordActions.js) trước
// đây CHỈ cho sửa bài khi còn status DRAFT/NEED_INFO — bài đã ĐĂNG CÔNG KHAI (APPROVED) bị khoá CỨNG cả
// client (canEditInternalPostUI(), module-internalcomms-nhipsong.js) lẫn server cho MỌI người kể cả
// admin, không phải lỗi thiếu quyền. Theo xác nhận của người dùng: mở thêm cho APPROVED, sửa xong GIỮ
// NGUYÊN trạng thái (không quay lại hàng chờ duyệt/PENDING).
//
// Chạy: node tests/test-internalpost-edit-approved.js
const assert = require('assert');
const { editInternalPost } = require('../lib/recordActions');

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS: ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL: ${name} — ${e.message}`);
  }
}

const admin = { username: 'admin1', perms: { admin: true } };
const newsAuthor = { username: 'author1', perms: { internalNewsCreate: true } };
const newsManager = { username: 'manager1', perms: { internalNewsManage: true } };
const shareAuthor = { username: 'author2', perms: { internalShareCreate: true } };
const outsider = { username: 'outsider1', perms: {} };

function approvedNewsPost(overrides) {
  return Object.assign({
    id: 1, type: 'NEWS', author: 'author1', status: 'APPROVED', title: 'Tin cũ', content: 'Nội dung cũ',
    postCategory: 'CAT1', images: [], coverImage: null, videos: [], customData: {}
  }, overrides);
}

const appData = {
  formTemplates: [],
  internalNewsCategories: [{ key: 'CAT1', label: 'Chuyên đề 1' }, { key: 'CAT2', label: 'Chuyên đề 2' }]
};

check('[Admin] Sửa bài NEWS đã APPROVED -> KHÔNG còn bị chặn 409, status GIỮ NGUYÊN APPROVED (không về PENDING/DRAFT)', () => {
  const post = approvedNewsPost();
  const payload = { title: 'Tin đã sửa', content: 'Nội dung mới', contentFormat: 'html', postCategory: 'CAT2' };
  const result = editInternalPost(payload, admin, post, appData);
  assert.strictEqual(result.status, 'APPROVED', 'status phải giữ nguyên APPROVED sau khi sửa');
  assert.strictEqual(result.title, 'Tin đã sửa');
  assert.strictEqual(result.postCategory, 'CAT2');
});

check('[internalNewsManage] Sửa bài NEWS APPROVED của NGƯỜI KHÁC (không phải tác giả) -> được phép, status giữ nguyên', () => {
  const post = approvedNewsPost({ author: 'author1' });
  const payload = { title: 'Sửa hộ bởi quản lý NEWS', content: 'Nội dung', contentFormat: 'html', postCategory: 'CAT1' };
  const result = editInternalPost(payload, newsManager, post, appData);
  assert.strictEqual(result.status, 'APPROVED');
  assert.strictEqual(result.title, 'Sửa hộ bởi quản lý NEWS');
});

check('[Chính tác giả] Sửa bài NEWS APPROVED của chính mình -> được phép, status giữ nguyên', () => {
  const post = approvedNewsPost();
  const payload = { title: 'Tác giả tự sửa', content: 'Nội dung', contentFormat: 'html', postCategory: 'CAT1' };
  const result = editInternalPost(payload, newsAuthor, post, appData);
  assert.strictEqual(result.status, 'APPROVED');
});

check('[ĐỐI CHỨNG] Người KHÔNG phải tác giả/admin/internalNewsManage vẫn bị chặn 403 dù bài APPROVED', () => {
  const post = approvedNewsPost();
  const payload = { title: 'X', content: 'Y', contentFormat: 'html', postCategory: 'CAT1' };
  assert.throws(() => editInternalPost(payload, outsider, post, appData), /403|quyền/i);
});

check('[ĐỐI CHỨNG] payload.draft=true KHÔNG còn hạ bài APPROVED xuống DRAFT (không có khái niệm "Lưu Nháp" cho bài đã đăng công khai)', () => {
  const post = approvedNewsPost();
  const payload = { title: 'X', content: 'Y', contentFormat: 'html', postCategory: 'CAT1', draft: true };
  const result = editInternalPost(payload, admin, post, appData);
  assert.strictEqual(result.status, 'APPROVED', 'draft:true phải bị bỏ qua khi sửa bài đã APPROVED, không được hạ xuống DRAFT');
});

check('[SHARE không có quyền duyệt] Sửa bài SHARE APPROVED của chính mình -> vẫn giữ nguyên APPROVED (KHÔNG rơi về PENDING như luồng Gửi Lại cũ)', () => {
  const post = {
    id: 2, type: 'SHARE', author: 'author2', status: 'APPROVED', title: 'Chia sẻ cũ', content: 'Nội dung cũ',
    postCategory: 'CAT1', images: [], coverImage: null, videos: [], customData: {}
  };
  const shareAppData = { formTemplates: [], internalShareCategories: [{ key: 'CAT1', label: 'Chuyên đề' }] };
  const payload = { title: 'Chia sẻ đã sửa', content: 'Nội dung mới', contentFormat: 'html', postCategory: 'CAT1' };
  const result = editInternalPost(payload, shareAuthor, post, shareAppData);
  assert.strictEqual(result.status, 'APPROVED', 'SHARE không có quyền duyệt khi sửa lại KHÔNG được rơi về PENDING vì bài này ĐÃ đăng công khai rồi, chỉ sửa tại chỗ');
});

check('[ĐỐI CHỨNG hành vi cũ] Bài còn DRAFT (chưa từng đăng) vẫn hoạt động y hệt trước đây — resubmit về APPROVED', () => {
  const post = approvedNewsPost({ status: 'DRAFT' });
  const payload = { title: 'Gửi lần đầu', content: 'Nội dung', contentFormat: 'html', postCategory: 'CAT1' };
  const result = editInternalPost(payload, newsAuthor, post, appData);
  assert.strictEqual(result.status, 'APPROVED');
});

check('[ĐỐI CHỨNG hành vi cũ] Bài còn NEED_INFO vẫn hoạt động y hệt trước đây — resubmit về APPROVED, xoá infoRequestComment', () => {
  const post = approvedNewsPost({ status: 'NEED_INFO', infoRequestComment: 'Bổ sung ảnh' });
  const payload = { title: 'Gửi lại sau bổ sung', content: 'Nội dung', contentFormat: 'html', postCategory: 'CAT1' };
  const result = editInternalPost(payload, newsAuthor, post, appData);
  assert.strictEqual(result.status, 'APPROVED');
  assert.strictEqual(result.infoRequestComment, null);
});

check('[ĐỐI CHỨNG hành vi cũ] Bài REJECTED/PENDING khác vẫn bị chặn 409 (không mở rộng ngoài APPROVED)', () => {
  for (const status of ['REJECTED', 'PENDING']) {
    const post = approvedNewsPost({ status });
    const payload = { title: 'X', content: 'Y', contentFormat: 'html', postCategory: 'CAT1' };
    assert.throws(() => editInternalPost(payload, admin, post, appData), /409|trạng thái/i, `status=${status} phải vẫn bị chặn`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
