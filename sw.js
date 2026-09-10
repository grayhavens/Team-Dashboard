/* Minimal service worker: keeps a copy of the static shell so the app
   still opens (from cache) when launched offline. Anything not on this
   origin — i.e. the TheSportsDB API calls in js/app.js — is left alone
   and always goes straight to the network; we never cache or intercept
   those. The shell itself is network-first: every load fetches the
   latest deployed files and refreshes the cache, falling back to the
   cache only when there's no connectivity — a cache-first strategy
   here would keep serving whatever shipped the day this first
   installed, forever, since nothing else invalidates it. */
const CACHE_NAME = 'boxscore-v3';
const SHELL_FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/data.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if(event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return res;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});
