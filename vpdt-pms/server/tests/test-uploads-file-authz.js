// server/tests/test-uploads-file-authz.js
//
// Regression test cho lỗ hổng: GET /uploads/<tên-file> (express.static ở server.js) TRƯỚC ĐÂY chỉ gác
// bằng requireAuth — BẤT KỲ người dùng nào đã đăng nhập, kể cả nhân viên phòng khác hoàn toàn không
// được cấp quyền xem module đó, chỉ cần biết/đoán đúng URL là đọc trọn vẹn nội dung file. Toàn bộ phân
// quyền theo hồ sơ mà GET /api/files/download đã dựng công phu bị vô hiệu hoá qua đường vòng này. URL
// rất dễ lộ (dán vào chat, lịch sử duyệt web, cache trình duyệt của người từng xem hợp lệ, log proxy).
//
// Bản vá gom phần tra ngược file -> hồ sơ + kiểm quyền vào lib/fileAuthz.js để CẢ HAI lối vào dùng
// chung 1 nguồn sự thật, với 2 chế độ khác nhau:
//   - mode 'download' (GET /api/files/download): quyền "<moduleKey>Download" theo phòng ban — GIỮ
//     NGUYÊN khuôn cũ.
//   - mode 'view' (/uploads, Khung Xem Bảo Vệ): khuôn canView* của từng module.
//
// ĐIỂM PHẢI BẢO VỆ CHẶT NHẤT (kịch bản 3): "Xem" và "Tải" là 2 quyền TÁCH RIÊNG trong hệ thống. Nếu bản
// vá lười mà bê nguyên phép kiểm của route tải (canDownloadRecordFile) sang gác /uploads, thì mọi người
// dùng chỉ được cấp quyền XEM (không có cờ Download) sẽ bị chặn luôn cả Khung Xem Bảo Vệ — vá xong lỗ
// hổng nhưng làm hỏng chức năng xem tài liệu của gần hết người dùng thường. Test này khoá chặt cả 2
// chiều: vá thật (người ngoài phạm vi bị chặn) VÀ không chặn nhầm (người có quyền xem vẫn xem được).
//
// Test thuần Node (không Playwright): phần sửa nằm hoàn toàn ở server, không có mặt nào ở giao diện.
// Không có SQL Server khi chạy test nên lib/recordStore + lib/appData được thay bằng bản giả cắm thẳng
// vào require.cache TRƯỚC khi require lib/fileAuthz — nhờ vậy lib/recordViewScope.js (nơi chứa các hàm
// canView* thật) vẫn được nạp và chạy như production code, không phải bản chép lại.
//
// Chạy: node server/tests/test-uploads-file-authz.js
const path = require('path');
const express = require('express');
const assert = require('assert');

// ===================== Seed dữ liệu =====================
const DEPT_A = 'Kinh Doanh';   // phòng ban sở hữu hồ sơ
const DEPT_B = 'Marketing';    // phòng ban NGOÀI phạm vi

const DOC = {
  id: 'doc-1', fileUrl: '/uploads/doc-a.pdf', dept: DEPT_A,
  uploader: 'owner_doc', status: 'APPROVED'
};
const POST_PENDING = {
  id: 'post-1', author: 'author_post', status: 'PENDING',
  attachment: { fileUrl: '/uploads/post-pending.pdf' }
};
const LICENSE = { id: 'lic-1', fileUrl: '/uploads/license.pdf', creator: 'owner_lic' };
const IT_RENEWAL = { id: 'itr-1', fileUrl: '/uploads/it-renewal.pdf', creator: 'someone' };

// Hỗ Trợ IT — Phê Duyệt Giá: "Tài liệu bổ sung liên quan" (item.extraFiles, mục A đợt sau) — 2 ĐIỂM
// SECURITY-CRITICAL bị vá ở lib/fileAuthz.js:
//   1) findOwningRecord() PHẢI khớp CẢ item.extraFiles (không chỉ item.files) — nếu không, file mới
//      upload rơi vào nhánh FAIL-OPEN (bất kỳ ai đăng nhập cũng đọc được).
//   2) authorizeFileAccess() nhánh owning.itPrice, mode 'download': luật "chỉ file đã duyệt mới tải
//      được" CHỈ áp dụng cho item.files (bảng giá Excel) — KHÔNG áp dụng cho item.extraFiles.
// files[] có 2 phần tử để phân biệt rõ "file đã duyệt" (mới nhất, id 2) với "file KHÔNG phải file đã
// duyệt" (bản gốc, id 1) — đúng luật resolveApprovedFileId()/resolveApprovedFileUrl() (lib/recordActions.js).
const IT_PRICE_ITEM = {
  id: 'itp-1', dept: DEPT_A, creator: 'owner_itp', status: 'APPROVED', currentStep: 1, infoRequests: [],
  files: [
    { id: 1, fileUrl: '/uploads/itprice-sheet-orig.xlsx' },
    { id: 2, fileUrl: '/uploads/itprice-sheet-latest.xlsx' }
  ],
  extraFiles: [{ id: 1, fileUrl: '/uploads/itprice-extra.pdf', fileName: 'extra.pdf' }]
};

const COLLECTIONS = {
  docs: [DOC],
  internalPosts: [POST_PENDING],
  licenses: [LICENSE],
  itServiceRenewals: [IT_RENEWAL],
  itPriceApprovals: [IT_PRICE_ITEM]
};

// ===================== Người dùng =====================
const ADMIN = { username: 'admin', dept: 'Ban Giám Đốc', perms: { admin: true } };
const OWNER_DOC = { username: 'owner_doc', dept: DEPT_A, perms: {} };
// NHÂN VẬT CHÍNH của kịch bản 3: được cấp quyền XEM tài liệu đã duyệt của DEPT_A, nhưng KHÔNG có cờ
// docDownload. Ở phòng ban KHÁC (DEPT_B) — quan trọng, vì scopeAllows() tự cho qua khi user.dept trùng
// dept hồ sơ, nếu để cùng phòng thì nhánh "không có quyền tải" không bao giờ được kiểm thật.
const VIEWER_NO_DOWNLOAD = {
  username: 'viewer_nodl', dept: DEPT_B, perms: { viewApprovedDepts: [DEPT_A] }
};
// Người ngoài hoàn toàn: đã đăng nhập nhưng không được cấp quyền gì — chính là kẻ tấn công trong lỗ
// hổng cũ (biết URL là đọc được file).
const OUTSIDER = { username: 'outsider', dept: DEPT_B, perms: {} };
const IT_MANAGER = { username: 'it_mgr', dept: 'CNTT', perms: { itManage: true } };
const OWNER_ITP = { username: 'owner_itp', dept: DEPT_A, perms: {} };

// ===================== Cắm bản giả cho recordStore + appData =====================
// Phải làm TRƯỚC require('../lib/fileAuthz') — nếu không, lib/recordStore sẽ kéo theo lib/db.js và thử
// nối SQL Server (không có khi chạy test).
function stubModule(relPath, exportsObj) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true, children: [], paths: [], exports: exportsObj
  };
}
// getAllTrashItemsCached: lib/fileAuthz.js nay còn tra thêm Thùng Rác trước khi rơi vào nhánh FAIL-OPEN (hồ sơ
// đã xoá không được để file của nó lộ rộng hơn lúc chưa xoá — xem findOwningTrashItem()). Ở bộ test này
// thùng rác luôn rỗng, để mọi kịch bản bên dưới giữ nguyên ý nghĩa cũ; kịch bản Thùng Rác được kiểm
// riêng ở tests/test-audit-round2-cluster6.js.
stubModule('../lib/recordStore', {
  getAllForCollection: async (name) => COLLECTIONS[name] || [],
  getAllTrashItemsCached: async () => []
});
// deptWorkflows rỗng -> resolveDocApproversServer() trả {} -> nhánh "đang là người duyệt" của
// canViewDoc() không cho ai qua, để test chỉ xét đúng nhánh phạm vi phòng ban đang cần khoá.
stubModule('../lib/appData', {
  getAllAppData: async () => ({ deptWorkflows: {} }),
  getAppDataValue: async () => ({})
});

const { authorizeFileAccess, parseUploadsFileUrl, uploadsAuthz } = require('../lib/fileAuthz');

// ===================== Runner nhỏ =====================
let passed = 0, failed = 0;
async function run(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}

async function main() {
  // ===== 1) Lỗ hổng gốc: người đã đăng nhập nhưng ngoài phạm vi KHÔNG còn xem được file =====
  await run('Người ngoài phạm vi (đã đăng nhập) KHÔNG xem được file tài liệu qua /uploads', async () => {
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, DOC.fileUrl, 'view'), false);
  });

  await run('Người ngoài phạm vi cũng KHÔNG tải được qua /api/files/download (hành vi cũ giữ nguyên)', async () => {
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, DOC.fileUrl, 'download'), false);
  });

  // ===== 2) Không chặn nhầm người hợp lệ =====
  await run('Chính chủ (uploader) xem và tải được file của mình', async () => {
    assert.strictEqual(await authorizeFileAccess(OWNER_DOC, DOC.fileUrl, 'view'), true);
    assert.strictEqual(await authorizeFileAccess(OWNER_DOC, DOC.fileUrl, 'download'), true);
  });

  await run('Admin xem và tải được', async () => {
    assert.strictEqual(await authorizeFileAccess(ADMIN, DOC.fileUrl, 'view'), true);
    assert.strictEqual(await authorizeFileAccess(ADMIN, DOC.fileUrl, 'download'), true);
  });

  // ===== 3) MẤU CHỐT: "Xem" và "Tải" là 2 quyền tách riêng =====
  await run('Người CHỈ có quyền XEM (không có cờ docDownload) VẪN xem được qua /uploads — Khung Xem Bảo Vệ không bị vá làm hỏng', async () => {
    assert.strictEqual(await authorizeFileAccess(VIEWER_NO_DOWNLOAD, DOC.fileUrl, 'view'), true);
  });

  await run('...nhưng người đó KHÔNG tải được — quyền Tải vẫn tách riêng như cũ', async () => {
    assert.strictEqual(await authorizeFileAccess(VIEWER_NO_DOWNLOAD, DOC.fileUrl, 'download'), false);
  });

  // ===== 4) Module có khuôn quyền riêng (không theo phòng ban) =====
  await run('Bài Góc Chia Sẻ đang CHỜ DUYỆT: người khác không xem được file đính kèm, tác giả thì được', async () => {
    const url = POST_PENDING.attachment.fileUrl;
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, url, 'view'), false);
    assert.strictEqual(await authorizeFileAccess({ username: 'author_post', perms: {} }, url, 'view'), true);
  });

  await run('Giấy Phép: chỉ người tạo / licenseView / admin xem được', async () => {
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, LICENSE.fileUrl, 'view'), false);
    assert.strictEqual(await authorizeFileAccess({ username: 'owner_lic', perms: {} }, LICENSE.fileUrl, 'view'), true);
  });

  // Khoá luôn lỗi ĐÃ CÓ SẴN trước bản vá: canViewItServiceRenewal() được định nghĩa trong
  // lib/recordViewScope.js nhưng QUÊN xuất ra module.exports -> routes/download.js require về
  // `undefined` và ném TypeError ("is not a function") -> 500 cho MỌI lượt tải file Gia Hạn Dịch Vụ
  // CNTT. Nếu export bị bỏ lại lần nữa, 2 assert dưới đây sẽ vỡ ngay (ném TypeError, không phải false).
  await run('Gia Hạn Dịch Vụ CNTT: chỉ itManage/admin xem được (khoá lỗi thiếu export canViewItServiceRenewal)', async () => {
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, IT_RENEWAL.fileUrl, 'view'), false);
    assert.strictEqual(await authorizeFileAccess(IT_MANAGER, IT_RENEWAL.fileUrl, 'view'), true);
    assert.strictEqual(await authorizeFileAccess(IT_MANAGER, IT_RENEWAL.fileUrl, 'download'), true);
  });

  // ===== 4b) Hỗ Trợ IT — Phê Duyệt Giá: "Tài liệu bổ sung liên quan" (item.extraFiles, mục A đợt sau) =====
  await run('extraFiles: findOwningRecord() khớp ĐÚNG hồ sơ sở hữu (không rơi FAIL-OPEN) — người ngoài phạm vi bị chặn cả view lẫn download', async () => {
    const url = IT_PRICE_ITEM.extraFiles[0].fileUrl;
    // Nếu findOwningRecord() BỎ SÓT extraFiles (lỗ hổng mục A), owning sẽ là null -> rơi FAIL-OPEN ->
    // authorizeFileAccess() trả true cho MỌI người kể cả OUTSIDER. Assert false ở đây khẳng định file đã
    // tra ra ĐÚNG hồ sơ sở hữu và đi qua nhánh owning.itPrice (canViewItPriceApproval) như mọi module khác.
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, url, 'view'), false);
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, url, 'download'), false);
  });

  await run('extraFiles: người có quyền xem hồ sơ (chính chủ) xem VÀ tải được', async () => {
    const url = IT_PRICE_ITEM.extraFiles[0].fileUrl;
    assert.strictEqual(await authorizeFileAccess(OWNER_ITP, url, 'view'), true);
    assert.strictEqual(await authorizeFileAccess(OWNER_ITP, url, 'download'), true);
  });

  await run('extraFiles: KHÔNG bị chặn bởi luật "chỉ file đã duyệt mới tải được" — khác hẳn item.files', async () => {
    // Hồ sơ IT_PRICE_ITEM đã APPROVED, "file đã duyệt" (resolveApprovedFileUrl) là files[1] (mới nhất) —
    // extraFiles[0] KHÔNG PHẢI là file đã duyệt đó, nhưng vẫn phải tải được bình thường vì luật "chỉ file
    // đã duyệt mới tải được" chỉ áp dụng cho item.files (bảng giá), không áp dụng cho extraFiles.
    const extraUrl = IT_PRICE_ITEM.extraFiles[0].fileUrl;
    assert.strictEqual(await authorizeFileAccess(OWNER_ITP, extraUrl, 'download'), true, 'extraFiles phải tải được dù không phải "file đã duyệt"');

    // Đối chứng: ĐÚNG hành vi cũ vẫn giữ nguyên cho item.files (bảng giá) — bản GỐC (không phải file mới
    // nhất/đã duyệt) vẫn bị chặn tải, chỉ file MỚI NHẤT (đã duyệt) mới tải được.
    const origSheetUrl = IT_PRICE_ITEM.files[0].fileUrl;
    const latestSheetUrl = IT_PRICE_ITEM.files[1].fileUrl;
    assert.strictEqual(await authorizeFileAccess(OWNER_ITP, origSheetUrl, 'download'), false, 'Bản gốc (KHÔNG phải file đã duyệt) phải tiếp tục bị chặn tải — hành vi cũ không đổi');
    assert.strictEqual(await authorizeFileAccess(OWNER_ITP, latestSheetUrl, 'download'), true, 'File mới nhất (đã duyệt) vẫn tải được như cũ');
    // mode 'view' không bị giới hạn "chỉ file đã duyệt" cho CẢ 2 loại (chỉ 'download' mới giới hạn).
    assert.strictEqual(await authorizeFileAccess(OWNER_ITP, origSheetUrl, 'view'), true, 'Xem (view, Khung Xem Bảo Vệ) không bị giới hạn "chỉ file đã duyệt" — chỉ hành động Tải mới giới hạn');
  });

  // ===== 5) Fail-open có chủ ý cho file không tra ra hồ sơ nào =====
  await run('File không thuộc hồ sơ nào (ảnh đại diện, logo...) vẫn cho phép — fail-open CÓ CHỦ Ý, giữ đúng hành vi cũ', async () => {
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, '/uploads/avatar-xyz.png', 'view'), true);
  });

  // ===== 6) Chặn path traversal, dùng chung 1 luật cho cả 2 lối vào =====
  await run('parseUploadsFileUrl chặn path traversal và đường dẫn nhiều thành phần', async () => {
    assert.strictEqual(parseUploadsFileUrl('/uploads/a.pdf'), 'a.pdf');
    assert.strictEqual(parseUploadsFileUrl('/uploads/../server.js'), null);
    assert.strictEqual(parseUploadsFileUrl('/uploads/sub/a.pdf'), null);
    assert.strictEqual(parseUploadsFileUrl('/uploads/..'), null);
    assert.strictEqual(parseUploadsFileUrl('/etc/passwd'), null);
    assert.strictEqual(parseUploadsFileUrl(''), null);
  });

  // ===== 7) Middleware thật, qua HTTP thật =====
  // Dựng đúng chuỗi middleware như server.js (bỏ requireAuth — thay bằng gán sẵn req.freshUser, vì ở
  // đây đang kiểm phần PHÂN QUYỀN THEO HỒ SƠ, không phải phần đăng nhập đã có test riêng).
  await run('HTTP thật: /uploads trả 403 cho người ngoài phạm vi, 200 cho người có quyền xem', async () => {
    const app = express();
    let currentUser = OUTSIDER;
    app.use('/uploads', (req, _res, next) => { req.freshUser = currentUser; next(); }, uploadsAuthz,
      express.static(path.join(__dirname, 'fixtures-uploads-authz')));
    // Không cần file thật trên đĩa: nếu middleware CHO QUA thì express.static không tìm thấy file và
    // trả 404 — vẫn phân biệt rõ với 403 do bị chặn quyền, đủ để khẳng định middleware xử đúng.
    const server = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
    const port = server.address().port;
    try {
      const res403 = await fetch(`http://127.0.0.1:${port}/uploads/doc-a.pdf`);
      assert.strictEqual(res403.status, 403, `người ngoài phạm vi phải bị 403, nhận ${res403.status}`);

      currentUser = VIEWER_NO_DOWNLOAD;
      const resOk = await fetch(`http://127.0.0.1:${port}/uploads/doc-a.pdf`);
      assert.notStrictEqual(resOk.status, 403, 'người có quyền XEM không được bị 403 (Khung Xem Bảo Vệ)');
      assert.strictEqual(resOk.status, 404, `qua được middleware thì static trả 404, nhận ${resOk.status}`);

      currentUser = OUTSIDER;
      const resPost = await fetch(`http://127.0.0.1:${port}/uploads/post-pending.pdf`);
      assert.strictEqual(resPost.status, 403, 'file bài chờ duyệt phải bị chặn với người khác');
    } finally {
      await new Promise(res => server.close(res));
    }
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed) process.exit(1);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
