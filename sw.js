// Minimal service worker: makes the page installable as an app. Nothing is cached:
// rooms and search need the server anyway, and caching would only serve stale versions of the page.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;   // let the browser handle everything else directly
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;background:#141218;color:#e6e0e9;padding:24px">' +
    '<h2>You’re offline</h2><p>Listen Together needs an internet connection. Reconnect and reopen the app.</p>',
    { headers: { 'content-type': 'text/html; charset=utf-8' } })));
});
