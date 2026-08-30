// lib/fileAuthz.js — Kiểm quyền truy cập FILE ĐÍNH KÈM dùng chung cho CẢ 2 đường vào file trong hệ
// thống, để 2 chỗ không còn lệch nhau như trước:
//
//   1) GET /api/files/download (routes/download.js) — bấm "Tải" thật sự, PDF được đóng dấu watermark.
//   2) GET /uploads/<tên-file> (express.static ở server.js) — Khung Xem Bảo Vệ đọc file để vẽ ra màn
//      hình bằng PDF.js/mammoth/exceljs (XEM tại chỗ, không tải về).
//
// Trước đây CHỈ (1) tra ngược file -> hồ sơ sở hữu để kiểm quyền; (2) chỉ có requireAuth, nghĩa là BẤT
// KỲ người dùng nào đã đăng nhập — kể cả nhân viên phòng khác hoàn toàn không được cấp quyền xem module
// đó — chỉ cần biết/đoán đúng URL /uploads/<tên-file> là đọc được trọn vẹn nội dung file, vô hiệu hoá
// toàn bộ phân quyền Xem/Tải theo hồ sơ mà (1) đã dựng công phu. URL rất dễ lộ (dán vào chat, lịch sử
// duyệt web, cache trình duyệt của người từng được xem hợp lệ, log proxy...). File này gom phần tra
// ngược + kiểm quyền vào 1 chỗ để cả 2 lối vào dùng CHUNG một nguồn sự thật.
//
// KHÁC BIỆT QUAN TRỌNG giữa 2 chế độ (tham số `mode`) — không thể dùng chung y hệt 1 phép kiểm:
//   - mode 'download': giữ NGUYÊN khuôn cũ của routes/download.js — quyền "<moduleKey>Download" theo
//     phòng ban (canDownloadRecordFile), vì "được xem" và "được tải về máy" là 2 quyền TÁCH RIÊNG mà
//     khách hàng đã cấp phát riêng trong Quản Trị người dùng.
//   - mode 'view': dùng khuôn canView* của đúng module (canViewDoc/canViewSubmission/canViewContract/
//     canViewCarReg/canViewOfficeReq) — KHÔNG được dùng canDownloadRecordFile ở đây, nếu không mọi
//     người chỉ có quyền XEM (không có cờ Download) sẽ bị chặn luôn cả Khung Xem Bảo Vệ, tức là làm
//     hỏng chức năng xem tài liệu của gần hết người dùng thường. Đây chính là lý do phải tách `mode`
//     thay vì bê nguyên phép kiểm của route tải sang static /uploads.
//
// Các module có khuôn quyền PHẲNG/riêng (Góc Chia Sẻ, bảng giá IT, Báo Cáo Định Kỳ, CV ứng viên, Giấy
// Phép, Gia Hạn Dịch Vụ CNTT) dùng CHUNG một phép kiểm canView* cho cả 2 mode — vì bản thân các module
// đó không có khái niệm quyền "tải riêng", ai xem được thì tải được.
const { getAllForCollection } = require('./recordStore');
const { getAllAppData } = require('./appData');
const {
  canDownloadRecordFile, canViewInternalPost,
  canViewItPriceApproval, canViewReportEntry, canSeeReportCompilation, filterRecruitmentReferralsForUser,
  canViewLicense, canViewItServiceRenewal,
  canViewDoc, canViewSubmission, canViewContract, canViewCarReg, canViewOfficeReq
} = require('./recordViewScope');

// Tra ngược fileUrl -> bản ghi sở hữu nó — Tài Liệu, Văn Bản Trình, Hợp Đồng, Đăng Ký Xe, Văn Phòng
// Tổng Hợp đều dùng chung 1 khuôn quyền tải theo phòng ban ({all,depts}, cờ "<moduleKey>Download" +
// luôn cho phép chính chủ, xem canDownloadFile()/canDownloadRecordFile()). Biên bản họp KHÔNG có mặt ở
// đây — "Tải" của module đó xuất ra 1 phiếu dựng TỪ DỮ LIỆU bản ghi ngay ở trình duyệt (canvas/PDF),
// không có fileUrl nào đi qua /uploads/ để cần tra cứu ở route này (khớp đúng cơ chế "Tải phiếu" của
// Công Việc, không phải file người dùng tự tải lên). Nếu file không thuộc các collection dưới đây (VD
// ảnh đại diện, logo, file của module chưa rà quyền riêng) thì CHO PHÉP như trước — xem ghi chú
// "FAIL-OPEN" ở authorizeFileAccess() bên dưới.
//
// internalPosts (Góc Chia Sẻ): KHÔNG dùng chung khuôn quyền tải theo phòng ban ở trên — bài PENDING/
// REJECTED chỉ tác giả/admin/internalPostApprove được XEM (canViewInternalPost(), lib/recordViewScope.js,
// dùng để lọc GET /api/data) — trả riêng owning = {internal:true, post} để caller gọi canViewInternalPost()
// thay vì canDownloadRecordFile() (2 khuôn quyền khác nhau).
//
// itPriceApprovals/reportEntries/reportPeriods/recruitmentReferrals: file bảng giá IT (chỉ proposer/
// approver phòng ban/itManage được xem), file đính kèm slide Báo Cáo Định Kỳ (ẩn cho tới khi PUBLISHED),
// và CV ứng viên (chỉ người giới thiệu + tuyển dụng) đều là dữ liệu cần giới hạn đúng như canView*ForUser()
// đã lọc ở GET /api/data. Mỗi module trả owning riêng (itPrice/reportEntry/reportPeriod/recruitment) để
// caller gọi đúng hàm kiểm quyền tương ứng (khác chữ ký/tham số nhau).
//
// `record` được trả kèm ở nhóm 5 module "theo phòng ban" (doc/submission/contract/car/office) — CẦN cho
// mode 'view' vì canViewDoc()/canViewSubmission()/... nhận nguyên bản ghi (phải tra deptWorkflows để xét
// nhánh "đang là người duyệt"), khác canDownloadRecordFile() chỉ cần (moduleKey, dept, ownerUsername).
async function findOwningRecord(fileUrl) {
  const [docs, submissions, contracts, carRegs, officeReqs, internalPosts, itPriceApprovals, reportEntries, reportPeriods, recruitmentReferrals, licenses, itServiceRenewals] = await Promise.all([
    getAllForCollection('docs'),
    getAllForCollection('submissions'),
    getAllForCollection('contracts'),
    getAllForCollection('carRegs'),
    getAllForCollection('officeReqs'),
    getAllForCollection('internalPosts'),
    getAllForCollection('itPriceApprovals'),
    getAllForCollection('reportEntries'),
    getAllForCollection('reportPeriods'),
    getAllForCollection('recruitmentReferrals'),
    getAllForCollection('licenses'),
    getAllForCollection('itServiceRenewals')
  ]);
  const doc = (docs || []).find(d => d.fileUrl === fileUrl);
  if (doc) return { moduleKey: 'doc', dept: doc.dept, ownerUsername: doc.uploader, record: doc };
  const sub = (submissions || []).find(s => s.fileUrl === fileUrl || (s.extraFiles || []).some(ef => ef.fileUrl === fileUrl));
  if (sub) return { moduleKey: 'submission', dept: sub.dept, ownerUsername: sub.creator, record: sub };
  const contract = (contracts || []).find(c => c.fileUrl === fileUrl || c.signedFileUrl === fileUrl);
  if (contract) return { moduleKey: 'contract', dept: contract.dept, custodianDept: contract.custodianDept, ownerUsername: contract.creator, record: contract };
  const carReg = (carRegs || []).find(c => c.fileUrl === fileUrl);
  if (carReg) return { moduleKey: 'car', dept: carReg.dept, ownerUsername: carReg.creator, record: carReg };
  const officeReq = (officeReqs || []).find(o => o.fileUrl === fileUrl || o.signedFileUrl === fileUrl);
  if (officeReq) return { moduleKey: 'office', dept: officeReq.dept, ownerUsername: officeReq.creator, record: officeReq };
  const post = (internalPosts || []).find(p => p.attachment && p.attachment.fileUrl === fileUrl);
  if (post) return { internal: true, post };
  const priceItem = (itPriceApprovals || []).find(p => (p.files || []).some(f => f.fileUrl === fileUrl));
  if (priceItem) return { itPrice: true, item: priceItem };
  const entry = (reportEntries || []).find(e => e.fileUrl === fileUrl);
  if (entry) return { reportEntry: true, entry };
  const period = (reportPeriods || []).find(p => (p.compilation?.slides || []).some(s => s.fileUrl === fileUrl));
  if (period) return { reportPeriod: true, period };
  const referral = (recruitmentReferrals || []).find(r => r.cvFileUrl === fileUrl);
  if (referral) return { recruitment: true, referral };
  // licenses (Giấy Phép): quyền phẳng riêng module (licenseCreate/licenseApprove/licenseView), khác hẳn
  // canDownloadRecordFile theo phòng ban — trả owning riêng để caller gọi canViewLicense().
  const license = (licenses || []).find(l => l.fileUrl === fileUrl);
  if (license) return { license: true, item: license };
  // itServiceRenewals (Hỗ Trợ IT — Gia Hạn Dịch Vụ CNTT): quyền phẳng itManage, cùng khuôn licenses ở trên.
  const itRenewal = (itServiceRenewals || []).find(r => r.fileUrl === fileUrl);
  if (itRenewal) return { itServiceRenewal: true, item: itRenewal };
  return null;
}

// Chỉ nhận đúng dạng "/uploads/<tên-file>" với tên file là MỘT thành phần duy nhất (không "/", không
// "\", không ".."), khớp đúng tên do routes/upload.js sinh ra (<timestamp>-<16 hex>.<ext>). Trả về tên
// file đã tách, hoặc null nếu không hợp lệ — dùng chung cho cả route tải lẫn middleware /uploads để 2
// chỗ chặn path traversal theo CÙNG một luật.
function parseUploadsFileUrl(fileUrl) {
  const m = /^\/uploads\/([^/\\]+)$/.exec(String(fileUrl || ''));
  if (!m) return null;
  if (m[1] === '.' || m[1] === '..') return null;
  return m[1];
}

// Phép kiểm quyền dùng chung. Trả về true nếu `user` được phép truy cập file `fileUrl` theo `mode`
// ('view' cho Khung Xem Bảo Vệ qua /uploads, 'download' cho GET /api/files/download).
//
// FAIL-OPEN CÓ CHỦ Ý (giữ nguyên hành vi cũ của routes/download.js): file KHÔNG tra ra bản ghi nào ở
// findOwningRecord() thì CHO PHÉP. Đây là điểm còn lại chưa vá — trong hệ thống còn nhiều loại file
// khác đi qua /uploads mà findOwningRecord() chưa tra tới (ảnh đại diện người dùng, logo/ảnh cấu hình,
// đính kèm của Đồng Phục/VPP/Ngân Sách/Hỗ Trợ IT/Công Việc/Biên bản...). Nếu đổi sang FAIL-CLOSED ngay
// tại đây thì các module đó sẽ đứt ngay lập tức (người dùng hợp lệ cũng không xem/tải được file của
// chính mình), nên KHÔNG đổi trong phạm vi lần sửa này — vá lỗ hổng "ai đăng nhập cũng đọc được file
// của module đã rà quyền" trước, còn việc phủ nốt các collection còn lại cần rà từng module một
// (mỗi module một khuôn canView* khác nhau) và nên làm ở một lần sửa riêng, có test riêng cho từng cái.
async function authorizeFileAccess(user, fileUrl, mode) {
  const owning = await findOwningRecord(fileUrl);
  if (!owning) return true; // FAIL-OPEN có chủ ý — xem ghi chú ở trên.

  // ——— Nhóm module có khuôn quyền riêng: dùng CHUNG canView* cho cả 'view' lẫn 'download' ———
  if (owning.internal) return canViewInternalPost(user, owning.post);
  if (owning.itPrice) {
    const appData = await getAllAppData();
    return canViewItPriceApproval(user, owning.item, appData);
  }
  if (owning.reportEntry) return canViewReportEntry(user, owning.entry);
  if (owning.reportPeriod) return canSeeReportCompilation(user, owning.period);
  if (owning.recruitment) return filterRecruitmentReferralsForUser([owning.referral], user).length > 0;
  if (owning.license) return canViewLicense(user, owning.item);
  if (owning.itServiceRenewal) return canViewItServiceRenewal(user);

  // ——— Nhóm 5 module "theo phòng ban" (doc/submission/contract/car/office) ———
  if (mode === 'download') {
    // Giữ NGUYÊN khuôn cũ của routes/download.js: quyền "<moduleKey>Download" theo phòng ban.
    // custodianDept chỉ có mặt ở owning của hợp đồng — undefined cho mọi module khác, nên nhánh OR
    // dưới đây là no-op cho các module không có khái niệm custodian.
    const allowedByDept = canDownloadRecordFile(user, owning.moduleKey, owning.dept, owning.ownerUsername);
    const allowedByCustodian = owning.custodianDept && owning.custodianDept !== owning.dept &&
      canDownloadRecordFile(user, owning.moduleKey, owning.custodianDept, owning.ownerUsername);
    return !!(allowedByDept || allowedByCustodian);
  }

  // mode 'view' — dùng đúng khuôn canView* của từng module (KHÔNG dùng cờ Download, xem đầu file).
  // appData chỉ cần cho 3 module có quy trình duyệt theo phòng ban, đọc muộn để 2 module còn lại
  // (doc/submission) không phải tải cả khối cấu hình.
  switch (owning.moduleKey) {
    case 'doc': return await canViewDoc(user, owning.record);
    case 'submission': return await canViewSubmission(user, owning.record);
    case 'contract': return canViewContract(user, owning.record, await getAllAppData());
    case 'car': return canViewCarReg(user, owning.record, await getAllAppData());
    case 'office': return canViewOfficeReq(user, owning.record, await getAllAppData());
    default: return true; // không tới được (5 nhánh trên đã phủ hết moduleKey của nhóm này).
  }
}

// Middleware gác express.static('/uploads') ở server.js. Để Ở ĐÂY (thay vì viết thẳng trong server.js)
// vì server.js lắng nghe cổng ngay khi require -> không test trực tiếp được; tách ra đây thì bộ test
// gọi được ĐÚNG middleware đang chạy thật, không phải một bản chép lại gần giống.
//
// Dùng mode 'view': kiểm theo khuôn canView* của từng module, KHÔNG theo cờ "<moduleKey>Download" —
// nếu không, người chỉ được cấp quyền XEM sẽ bị chặn luôn cả Khung Xem Bảo Vệ (xem ghi chú đầu file).
async function uploadsAuthz(req, res, next) {
  try {
    // req.path ở đây là phần CÒN LẠI sau tiền tố mount ("/abc.pdf"), và còn nguyên mã hoá %XX — phải
    // decode trước khi so khớp với fileUrl đã lưu trong hồ sơ. decodeURIComponent() ném lỗi với chuỗi
    // %XX hỏng, nên bọc trong try/catch chung ở dưới.
    const fileUrl = '/uploads' + decodeURIComponent(req.path);
    if (!parseUploadsFileUrl(fileUrl)) return res.status(400).send('Đường dẫn tệp không hợp lệ');
    if (!(await authorizeFileAccess(req.freshUser, fileUrl, 'view'))) {
      return res.status(403).send('Bạn không có quyền xem tệp này');
    }
    return next();
  } catch (err) {
    console.error('⛔ GET /uploads: kiểm quyền tệp lỗi:', err.message);
    return res.status(400).send('Đường dẫn tệp không hợp lệ');
  }
}

module.exports = { findOwningRecord, parseUploadsFileUrl, authorizeFileAccess, uploadsAuthz };
