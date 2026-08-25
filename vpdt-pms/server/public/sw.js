// sw.js — Service Worker TỐI GIẢN, chỉ để trình duyệt coi trang là "cài đặt được" (PWA).
//
// CỐ Ý không cache bất kỳ gì (không offline-first) — app này tải dữ liệu nghiệp vụ real-time qua API
// (/api/*) và các file JS/CSS được deploy thường xuyên; nếu cache sẽ có rủi ro người dùng thấy dữ liệu
// cũ hoặc chạy bản JS cũ sau khi admin đã cập nhật server, rất khó phát hiện lỗi vì "trông vẫn chạy
// được". Chrome/Android chỉ yêu cầu có một Service Worker đăng ký với sự kiện "fetch" tồn tại, không bắt
// buộc phải cache gì — nên handler dưới đây chỉ gọi thẳng network, không can thiệp response.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
