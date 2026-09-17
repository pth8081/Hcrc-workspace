// tests/test-audit-round3-internalposts-edit.js — 2 lỗi phát hiện ở đợt audit chuyên sâu lần 3
// (lib/recordActions.js editInternalPost()):
// 1) Sửa bài ĐÀO TẠO (training) không còn xoá sạch registeredUsers khi client không gửi kèm danh sách.
// 2) Sửa bài NEWS/SHARE nay đối chiếu lại postCategory theo danh mục + validate customData bắt buộc.
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
const author = { username: 'gv1', perms: { trainingManage: true } };

// ---- 1. Training registeredUsers không bị xoá ----
check('Sửa bài Đào Tạo KHÔNG gửi kèm registeredUsers -> giữ nguyên danh sách cũ', () => {
  const post = {
    id: 1, type: 'TRAINING', author: 'gv1', status: 'DRAFT',
    training: { date: '2026-01-01', location: 'HO', capacity: 20, registeredUsers: ['nv1', 'nv2'] }
  };
  const payload = { training: { date: '2026-02-01', location: 'HO2', capacity: 30 } };
  const result = editInternalPost(payload, author, post, {});
  assert.deepStrictEqual(result.training.registeredUsers, ['nv1', 'nv2']);
  assert.strictEqual(result.training.date, '2026-02-01');
});

check('Sửa bài Đào Tạo CÓ gửi kèm registeredUsers mới -> dùng danh sách client gửi (không ép giữ cũ)', () => {
  const post = {
    id: 2, type: 'TRAINING', author: 'gv1', status: 'DRAFT',
    training: { date: '2026-01-01', location: 'HO', capacity: 20, registeredUsers: ['nv1'] }
  };
  const payload = { training: { date: '2026-01-01', location: 'HO', capacity: 20, registeredUsers: ['nv1', 'nv3'] } };
  const result = editInternalPost(payload, author, post, {});
  assert.deepStrictEqual(result.training.registeredUsers, ['nv1', 'nv3']);
});

check('Tạo mới (post.training chưa có sẵn registeredUsers) vẫn hoạt động bình thường', () => {
  const post = { id: 3, type: 'TRAINING', author: 'gv1', status: 'DRAFT', training: {} };
  const payload = { training: { date: '2026-03-01', location: 'HO', capacity: 10 } };
  const result = editInternalPost(payload, author, post, {});
  assert.deepStrictEqual(result.training.registeredUsers, []);
});

// ---- 2. NEWS/SHARE postCategory + customData re-validation ----
const appData = {
  internalNewsCategories: [{ key: 'TIN_TUC', label: 'Tin Tức' }],
  internalShareCategories: [{ key: 'CHIA_SE', label: 'Chia Sẻ' }],
  formTemplates: { INTERNAL_POST: [{ label: 'Ghi chú', required: true, type: 'text' }] }
};

check('Sửa bài NEWS với postCategory rác (không nằm trong danh mục) -> bị chặn', () => {
  const post = { id: 4, type: 'NEWS', author: 'gv1', status: 'DRAFT', postCategory: 'TIN_TUC', customData: { 'Ghi chú': 'x' } };
  const payload = { postCategory: 'RAC_KHONG_TON_TAI' };
  let threw = false;
  try { editInternalPost(payload, author, post, appData); } catch (e) { threw = true; assert.strictEqual(e.status, 400); }
  assert.strictEqual(threw, true);
});

check('Sửa bài NEWS bỏ trống customData bắt buộc -> bị chặn', () => {
  const post = { id: 5, type: 'NEWS', author: 'gv1', status: 'DRAFT', postCategory: 'TIN_TUC', customData: { 'Ghi chú': 'x' } };
  const payload = { customData: {} };
  let threw = false;
  try { editInternalPost(payload, author, post, appData); } catch (e) { threw = true; assert.strictEqual(e.status, 400); }
  assert.strictEqual(threw, true);
});

check('Sửa bài NEWS hợp lệ (postCategory + customData đều đúng) -> thành công', () => {
  const post = { id: 6, type: 'NEWS', author: 'gv1', status: 'DRAFT', postCategory: 'TIN_TUC', customData: { 'Ghi chú': 'x' } };
  const payload = { title: 'Tiêu đề mới' };
  const result = editInternalPost(payload, author, post, appData);
  assert.strictEqual(result.title, 'Tiêu đề mới');
});

check('Sửa bài TRAINING/REWARD không bị áp luật postCategory/customData của NEWS/SHARE', () => {
  const post = { id: 7, type: 'TRAINING', author: 'gv1', status: 'DRAFT', training: { registeredUsers: [] } };
  const result = editInternalPost({ title: 'Đào tạo mới' }, author, post, appData);
  assert.strictEqual(result.title, 'Đào tạo mới');
});

console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
process.exit(fail ? 1 : 0);
