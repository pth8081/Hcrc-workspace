// sw.js — Service Worker cho PWA, kèm cache stale-while-revalidate CHỈ cho thư mục /vendor/ (~5MB thư
// viện bên thứ 3: pdfjs/jspdf/exceljs/html2canvas/mammoth/jszip/simplewebauthn/dompurify) và
// /tailwind.css — 2 loại tài nguyên này nặng nhưng gần như không đổi giữa các lần deploy. MỌI request
// khác (đặc biệt index.html và /api/*) CỐ Ý bỏ qua cache, đi thẳng network — index.html + các file JS
// nghiệp vụ được deploy thường xuyên, cache sẽ có rủi ro người dùng thấy code cũ sau khi admin đã cập
// nhật server; /api/* cần dữ liệu real-time. Đợt trước SW hoàn toàn không cache gì (chỉ để trình duyệt
// coi trang "cài đặt được") — PWA vì vậy tải lại nguyên 5MB vendor mỗi lần mở dù nội dung không đổi,
// đây là nguyên nhân chính khiến app cảm giác chậm khi mở lại. stale-while-revalidate vẫn giữ được yêu
// cầu "không bao giờ kẹt code cũ vĩnh viễn": lần mở NÀY dùng bản cache (nhanh), đồng thời âm thầm tải
// bản mới về ghi đè cache cho lần mở SAU — chậm nhất là lệch 1 lần mở, không phải lệch vĩnh viễn.
const CACHE_NAME = 'hcrc-vendor-cache-v1';

function isCacheable(url) {
  return url.pathname.startsWith('/vendor/') || url.pathname === '/tailwind.css';
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/PUT/DELETE... luôn đi thẳng network, không can thiệp
  const url = new URL(req.url);
  if (!isCacheable(url)) {
    event.respondWith(fetch(req));
    return;
  }
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(req).then((cached) => {
        const fetchAndUpdate = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => cached); // mất mạng mà đã có cache -> vẫn dùng được cache cũ thay vì báo lỗi
        return cached || fetchAndUpdate;
      })
    )
  );
});
