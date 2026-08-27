// routes/download.js — Route TẢI file đính kèm dùng chung cho TOÀN hệ thống (khác /uploads/ tĩnh ở
// server.js — chỗ đó dùng để XEM file trong Khung Xem Bảo Vệ qua PDF.js/mammoth/exceljs, giữ nguyên
// không đổi). Route này CHỈ phục vụ khi người dùng bấm "Tải" thật sự: nếu file là PDF thì đóng dấu
// watermark "Hệ thống văn phòng số Công ty HCRC" vào góc dưới-trái MỖI TRANG trước khi trả về — CHỈ vẽ
// thêm 1 dòng chữ đè lên (dùng pdf-lib), không dựng lại/không đổi nội dung gốc của trang nào, nên tài
// liệu (kể cả hợp đồng) vẫn giữ nguyên giá trị nội dung, chỉ thêm watermark nhận diện ở góc không đụng
// tới phần thân/nơi ký. Các loại file khác (Word/Excel/ảnh...) được trả về NGUYÊN VẸN, không qua bước
// đóng dấu — theo đúng phạm vi khách hàng xác nhận (chỉ PDF luôn có watermark khi tải).
const express = require('express');
const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { getAllForCollection } = require('../lib/recordStore');
const { getAllAppData } = require('../lib/appData');
const {
  canDownloadRecordFile, canViewInternalPost,
  canViewItPriceApproval, canViewReportEntry, canSeeReportCompilation, filterRecruitmentReferralsForUser
} = require('../lib/recordViewScope');

const router = express.Router();

// Tra ngược fileUrl -> bản ghi sở hữu nó — Tài Liệu, Văn Bản Trình, Hợp Đồng, Đăng Ký Xe, Văn Phòng
// Tổng Hợp đều dùng chung 1 khuôn quyền tải theo phòng ban ({all,depts}, cờ "<moduleKey>Download" +
// luôn cho phép chính chủ, xem canDownloadFile()/canDownloadRecordFile()). Biên bản họp KHÔNG có mặt ở
// đây — "Tải" của module đó xuất ra 1 phiếu dựng TỪ DỮ LIỆU bản ghi ngay ở trình duyệt (canvas/PDF),
// không có fileUrl nào đi qua /uploads/ để cần tra cứu ở route này (khớp đúng cơ chế "Tải phiếu" của
// Công Việc, không phải file người dùng tự tải lên). Nếu file không thuộc các collection dưới đây (VD
// bài truyền thông nội bộ) thì CHO PHÉP như trước (chưa rà logic canView riêng của module đó).
//
// internalPosts (Góc Chia Sẻ): KHÔNG dùng chung khuôn quyền tải theo phòng ban ở trên — bài PENDING/
// REJECTED chỉ tác giả/admin/internalPostApprove được XEM (canViewInternalPost(), lib/recordViewScope.js,
// dùng để lọc GET /api/data). Trước đây route này không tra tới internalPosts nên fileUrl của 1 bài
// đang chờ duyệt/đã bị từ chối (không hề hiện trên giao diện với người khác) vẫn tải được nếu URL bị lộ
// ra ngoài (dán vào chat, cache trình duyệt của người đã từng thấy...) — trả riêng owning = {internal:true,
// post} để caller gọi canViewInternalPost() thay vì canDownloadRecordFile() (2 khuôn quyền khác nhau).
//
// itPriceApprovals/reportEntries/reportPeriods/recruitmentReferrals: 3 module ra đời SAU route này nên
// chưa từng được tra tới ở đây — cùng lỗ hổng như internalPosts từng gặp (file không thuộc collection
// nào bên dưới thì rơi vào nhánh "CHO PHÉP như trước" ở router.get() bên dưới, không kiểm tra gì). File
// bảng giá IT (chỉ proposer/approver phòng ban/itManage được xem), file đính kèm slide Báo Cáo Định Kỳ
// (ẩn cho tới khi PUBLISHED), và CV ứng viên (chỉ người giới thiệu + tuyển dụng) đều là dữ liệu cần giới
// hạn đúng như canView*ForUser() đã lọc ở GET /api/data — thêm vào đây để URL bị lộ (share nhầm, dán vào
// chat...) không cho tải vượt phạm vi. Mỗi module trả owning riêng (itPrice/reportEntry/reportPeriod/
// recruitment) để caller gọi đúng hàm kiểm quyền tương ứng (khác chữ ký/tham số nhau).
async function findOwningRecord(fileUrl) {
  const [docs, submissions, contracts, carRegs, officeReqs, internalPosts, itPriceApprovals, reportEntries, reportPeriods, recruitmentReferrals] = await Promise.all([
    getAllForCollection('docs'),
    getAllForCollection('submissions'),
    getAllForCollection('contracts'),
    getAllForCollection('carRegs'),
    getAllForCollection('officeReqs'),
    getAllForCollection('internalPosts'),
    getAllForCollection('itPriceApprovals'),
    getAllForCollection('reportEntries'),
    getAllForCollection('reportPeriods'),
    getAllForCollection('recruitmentReferrals')
  ]);
  const doc = (docs || []).find(d => d.fileUrl === fileUrl);
  if (doc) return { moduleKey: 'doc', dept: doc.dept, ownerUsername: doc.uploader };
  const sub = (submissions || []).find(s => s.fileUrl === fileUrl || (s.extraFiles || []).some(ef => ef.fileUrl === fileUrl));
  if (sub) return { moduleKey: 'submission', dept: sub.dept, ownerUsername: sub.creator };
  const contract = (contracts || []).find(c => c.fileUrl === fileUrl || c.signedFileUrl === fileUrl);
  if (contract) return { moduleKey: 'contract', dept: contract.dept, custodianDept: contract.custodianDept, ownerUsername: contract.creator };
  const carReg = (carRegs || []).find(c => c.fileUrl === fileUrl);
  if (carReg) return { moduleKey: 'car', dept: carReg.dept, ownerUsername: carReg.creator };
  const officeReq = (officeReqs || []).find(o => o.fileUrl === fileUrl || o.signedFileUrl === fileUrl);
  if (officeReq) return { moduleKey: 'office', dept: officeReq.dept, ownerUsername: officeReq.creator };
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
  return null;
}
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans.ttf');

// Chữ tiếng Việt có dấu KHÔNG nằm trong bảng mã WinAnsi mà 14 font chuẩn (Helvetica...) của pdf-lib hỗ
// trợ — bắt buộc phải nhúng 1 font TTF Unicode riêng (qua fontkit) mới vẽ đúng được dấu, nếu không
// pdf-lib sẽ ném lỗi ngay khi drawText(). DejaVu Sans (giấy phép tự do, kèm theo trong assets/fonts/)
// có đủ bộ chữ Latin mở rộng cho tiếng Việt.
const WATERMARK_TEXT = 'Hệ thống văn phòng số Công ty HCRC';
let embeddedFontBytes = null;
function getFontBytes() {
  if (!embeddedFontBytes) embeddedFontBytes = fs.readFileSync(FONT_PATH);
  return embeddedFontBytes;
}

router.get('/', async (req, res) => {
  const fileUrl = String(req.query.fileUrl || '');
  // fileUrl luôn có dạng "/uploads/<tên-file-do-server-sinh-ra>" (xem routes/upload.js — tên file luôn
  // là <timestamp>-<16 hex>.<ext>, không chứa ký tự do người dùng nhập) — chặn path traversal bằng cách
  // chỉ nhận đúng 1 thành phần tên file (không có "/" hay "..") rồi resolve lại để chắc chắn vẫn nằm
  // trong đúng thư mục uploads/.
  const m = /^\/uploads\/([^/\\]+)$/.exec(fileUrl);
  if (!m) return res.status(400).json({ error: 'Đường dẫn tệp không hợp lệ' });

  const filePath = path.join(UPLOAD_DIR, m[1]);
  if (path.dirname(filePath) !== UPLOAD_DIR || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Không tìm thấy tệp' });
  }

  const owning = await findOwningRecord(fileUrl);
  if (owning && owning.internal && !canViewInternalPost(req.freshUser, owning.post)) {
    return res.status(403).json({ error: 'Bạn không có quyền tải tệp này' });
  }
  if (owning && owning.itPrice) {
    const appData = await getAllAppData();
    if (!canViewItPriceApproval(req.freshUser, owning.item, appData)) {
      return res.status(403).json({ error: 'Bạn không có quyền tải tệp này' });
    }
  }
  if (owning && owning.reportEntry && !canViewReportEntry(req.freshUser, owning.entry)) {
    return res.status(403).json({ error: 'Bạn không có quyền tải tệp này' });
  }
  if (owning && owning.reportPeriod && !canSeeReportCompilation(req.freshUser, owning.period)) {
    return res.status(403).json({ error: 'Bạn không có quyền tải tệp này' });
  }
  if (owning && owning.recruitment && !filterRecruitmentReferralsForUser([owning.referral], req.freshUser).length) {
    return res.status(403).json({ error: 'Bạn không có quyền tải tệp này' });
  }
  // custodianDept chỉ có mặt ở owning trả về cho hợp đồng (findOwningRecord() ở trên) — undefined cho
  // mọi module khác, nên nhánh OR dưới đây là no-op cho các module không có khái niệm custodian.
  if (owning && !owning.internal && !owning.itPrice && !owning.reportEntry && !owning.reportPeriod && !owning.recruitment) {
    const allowedByDept = canDownloadRecordFile(req.freshUser, owning.moduleKey, owning.dept, owning.ownerUsername);
    const allowedByCustodian = owning.custodianDept && owning.custodianDept !== owning.dept &&
      canDownloadRecordFile(req.freshUser, owning.moduleKey, owning.custodianDept, owning.ownerUsername);
    if (!allowedByDept && !allowedByCustodian) {
      return res.status(403).json({ error: 'Bạn không có quyền tải tệp này' });
    }
  }

  const downloadName = String(req.query.name || m[1]).replace(/[\r\n"]/g, '');
  const asciiFallback = downloadName.replace(/[^\x20-\x7E]/g, '_');
  res.setHeader('Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`);

  const ext = path.extname(m[1]).toLowerCase();
  if (ext !== '.pdf') {
    return res.sendFile(filePath);
  }

  try {
    const originalBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(originalBytes);
    pdfDoc.registerFontkit(fontkit);
    const font = await pdfDoc.embedFont(getFontBytes(), { subset: true });

    for (const page of pdfDoc.getPages()) {
      page.drawText(WATERMARK_TEXT, {
        x: 24,
        y: 14,
        size: 13,
        font,
        color: rgb(0.42, 0.42, 0.42),
        opacity: 0.8
      });
    }

    const stampedBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    return res.send(Buffer.from(stampedBytes));
  } catch (err) {
    console.error('⛔ GET /api/files/download: đóng dấu watermark PDF lỗi, trả về file gốc:', err.message);
    res.setHeader('Content-Type', 'application/pdf');
    return res.sendFile(filePath);
  }
});

module.exports = router;
