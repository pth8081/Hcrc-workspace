// scripts/copy-vendor-assets.js — Sao chép các thư viện JS phía trình duyệt (đã cài qua npm, dùng để
// tự lưu trên server thay vì gọi CDN — xem lib/securityHeaders.js CSP + các script <script src="/vendor/...">
// trong public/index.html) từ node_modules/ vào public/vendor/ để Express phục vụ tĩnh được.
//
// TẠI SAO CẦN SCRIPT NÀY: các thư viện này chỉ tồn tại trong node_modules/ (không commit vào git, đúng
// quy ước .gitignore chuẩn) — nhưng public/vendor/ LẠI PHẢI commit vào git (server chạy production
// KHÔNG tự "build" gì, chỉ git pull + copy code thẳng, xem HUONG_DAN_DEPLOY_UBUNTU.md mục 12). Trước
// đây bước "copy từ node_modules ra public/vendor" chưa từng được làm (thủ công lẫn tự động) nên
// public/vendor/ hoàn toàn trống trên mọi lần deploy — mọi tính năng phụ thuộc các thư viện này (xem
// PDF.js xem PDF bảo vệ, JSZip đọc .pptx, Mammoth xem Word, ExcelJS xuất Excel, jsPDF xuất PDF,
// html2canvas chụp ảnh, DOMPurify khử XSS cho mammoth) đều âm thầm lỗi "chưa tải xong thư viện..." mà
// không ai để ý cho tới khi thử đúng luồng đó (vd tải mẫu trình chiếu Báo Cáo bằng PDF/PowerPoint).
//
// Chạy tự động qua "postinstall" (package.json) — MỌI LẦN "npm install" (kể cả lần đầu, kể cả sau khi
// nâng cấp version 1 trong các thư viện này) đều tự đồng bộ lại public/vendor/, không cần nhớ làm thủ
// công. Kết quả CŨNG được commit thẳng vào git (không chỉ dựa vào postinstall) để 1 lần "git pull +
// pm2 restart" thông thường (không chạy lại npm install) vẫn có đủ file — an toàn cho cả 2 kịch bản.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// { from: đường dẫn tương đối trong node_modules/, to: đường dẫn tương đối trong public/vendor/ } —
// "to" phải khớp CHÍNH XÁC các đường dẫn "/vendor/..." mà public/index.html đang tham chiếu.
const ASSETS = [
  { from: 'pdfjs-dist/build/pdf.mjs', to: 'pdfjs/pdf.mjs' },
  { from: 'pdfjs-dist/build/pdf.worker.mjs', to: 'pdfjs/pdf.worker.mjs' },
  { from: 'jszip/dist/jszip.min.js', to: 'jszip/jszip.min.js' },
  { from: 'mammoth/mammoth.browser.min.js', to: 'mammoth/mammoth.browser.min.js' },
  { from: 'exceljs/dist/exceljs.min.js', to: 'exceljs/exceljs.min.js' },
  { from: 'jspdf/dist/jspdf.umd.min.js', to: 'jspdf/jspdf.umd.min.js' },
  { from: 'html2canvas/dist/html2canvas.min.js', to: 'html2canvas/html2canvas.min.js' },
  { from: 'pdf-lib/dist/pdf-lib.min.js', to: 'pdf-lib/pdf-lib.min.js' },
  { from: 'dompurify/dist/purify.min.js', to: 'dompurify/purify.min.js' },
  { from: '@simplewebauthn/browser/dist/bundle/index.umd.min.js', to: 'simplewebauthn/browser.min.js' }
];

let missing = 0;
for (const { from, to } of ASSETS) {
  const src = path.join(ROOT, 'node_modules', from);
  const dest = path.join(ROOT, 'public', 'vendor', to);
  if (!fs.existsSync(src)) {
    console.error(`⛔ Không tìm thấy ${from} trong node_modules — thư viện có thể đã đổi tên file build khi nâng cấp version. Cập nhật ASSETS trong scripts/copy-vendor-assets.js.`);
    missing++;
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`   ↳ vendor: ${to}`);
}

if (missing > 0) {
  console.error(`⛔ Thiếu ${missing} tệp vendor — các tính năng liên quan (xem PDF/Word, xuất Excel/PDF...) sẽ báo lỗi "chưa tải xong thư viện".`);
  process.exit(1);
}
console.log(`✅ Đã đồng bộ ${ASSETS.length} tệp thư viện vào public/vendor/`);
