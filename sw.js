// sw.js — Service Worker tối thiểu cho truyendichai
// Mục đích chính: (1) cho phép Chrome/Edge Android hiện nút "Cài đặt app" (PWA installability
// yêu cầu phải có SW đăng ký fetch handler), (2) cache app-shell để load nhanh hơn ở các lần sau
// và có thể mở lại (không có mạng) tối thiểu là trang chính.
//
// CHIẾN LƯỢC: stale-while-revalidate cho toàn bộ file tĩnh — luôn trả về bản cache ngay lập tức
// (nhanh), đồng thời âm thầm tải bản mới nhất ở nền và ghi đè cache cho lần mở sau. Nhờ vậy
// KHÔNG cần đổi CACHE_NAME thủ công mỗi lần deploy — cache tự "tự chữa lành" sau tối đa 1 lần
// tải lại. (CACHE_NAME vẫn giữ để dọn dẹp cache rác nếu sau này bạn đổi kiến trúc file.)
//
// LƯU Ý: cache này chỉ chứa các file code (html/js/css/icon), KHÔNG đụng tới localStorage —
// bản dịch, tiến độ đọc, cài đặt của người dùng lưu ở localStorage nên không bị ảnh hưởng
// dù cache có bị xoá/đổi tên.

const CACHE_NAME = 'truyendichai-shell-v6';
const APP_SHELL = [
  '/',
  '/index.html',
  '/tts.css',
  '/tts.js',
  '/character-memory.css',
  '/character-memory.js',
  '/manifest.json',
  '/favicon.svg',
  '/favicon-48.png',
  '/favicon-512.png',
  '/icon-192.png',
  '/apple-touch-icon.png',
  '/spellcheck.js',
  '/dict/vi-syllables.txt'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll sẽ fail toàn bộ nếu 1 file 404 — dùng allSettled để an toàn hơn
      return Promise.allSettled(
        APP_SHELL.map((url) => cache.add(url).catch(() => {}))
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Trang HTML (navigation): network-first — luôn cố lấy bản mới nhất khi có mạng,
  // chỉ fallback về cache khi mất mạng.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() => caches.match(req).then((res) => res || caches.match('/index.html')))
    );
    return;
  }

  // File tĩnh khác (js/css/icon...): stale-while-revalidate — trả cache ngay cho nhanh,
  // đồng thời fetch bản mới ở nền và ghi đè cache cho lần sau. Không cần bump CACHE_NAME.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(req).then((cached) => {
        const networkFetch = fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            cache.put(req, res.clone());
          }
          return res;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    )
  );
});

