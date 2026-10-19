/* jpnotes.dev service worker — long-term caching that GitHub Pages can't do
 * (it serves everything with max-age=600 and the headers can't be changed).
 *
 *   /audio/s{hash}.mp3   cache-first, kept for good: the file name is a hash of
 *                        the sentence, so a given URL never changes. Range
 *                        requests (Safari's <audio> always sends one) are
 *                        answered with 206 slices of the cached file.
 *   *.js?v={hash}        cache-first: the ?v= changes whenever the file does.
 *   search-index.json    stale-while-revalidate.
 *   page navigations     network-first (fresh content after every deploy),
 *                        falling back to the cached copy when offline.
 *
 * Everything else (cross-origin: GA, giscus, AI providers; non-GET) is not
 * touched. Kill switch: replace this file with one that calls
 * self.registration.unregister() and deletes the caches.
 */
'use strict';

var V = 'v1';
var AUDIO = 'audio-' + V, ASSETS = 'assets-' + V, PAGES = 'pages-' + V;
var LIMITS = {};
LIMITS[AUDIO] = 600; LIMITS[ASSETS] = 20; LIMITS[PAGES] = 120;

self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    var keep = [AUDIO, ASSETS, PAGES];
    var names = await caches.keys();
    await Promise.all(names.filter(function (n) { return keep.indexOf(n) < 0; }).map(function (n) { return caches.delete(n); }));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

// Drop the oldest entries (cache.keys() is in insertion order).
async function trim(name) {
  var cache = await caches.open(name), keys = await cache.keys();
  for (var i = 0; i < keys.length - LIMITS[name]; i++) await cache.delete(keys[i]);
}

async function put(name, key, res) {
  var cache = await caches.open(name);
  await cache.put(key, res);
  await trim(name);
}

async function audio(e) {
  var url = e.request.url, cache = await caches.open(AUDIO);
  var res = await cache.match(url);
  if (!res) {
    res = await fetch(url);                     // whole file, no Range
    if (!res.ok) return res;
    e.waitUntil(put(AUDIO, url, res.clone()));
  }
  var range = e.request.headers.get('range');
  var m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m) return res;
  var buf = await res.arrayBuffer(), size = buf.byteLength;
  var start, end;
  if (m[1] === '') { start = Math.max(0, size - +m[2]); end = size - 1; }   // suffix: bytes=-N
  else { start = +m[1]; end = m[2] === '' ? size - 1 : Math.min(+m[2], size - 1); }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes'
    }
  });
}

async function cacheFirst(e, name) {
  var hit = await caches.match(e.request, { cacheName: name });
  if (hit) return hit;
  var res = await fetch(e.request);
  if (res.ok) e.waitUntil(put(name, e.request, res.clone()));
  return res;
}

async function staleWhileRevalidate(e, name) {
  var hit = await caches.match(e.request, { cacheName: name });
  var fresh = fetch(e.request).then(function (res) {
    if (res.ok) return put(name, e.request, res.clone()).then(function () { return res; });
    return res;
  });
  if (hit) { e.waitUntil(fresh.catch(function () {})); return hit; }
  return fresh;
}

async function page(e) {
  try {
    var res = (await e.preloadResponse) || await fetch(e.request);
    if (res.ok && res.type === 'basic' && /text\/html/.test(res.headers.get('Content-Type') || '')) e.waitUntil(put(PAGES, stripHash(e.request.url), res.clone()));
    return res;
  } catch (err) {
    var hit = await caches.match(stripHash(e.request.url), { cacheName: PAGES, ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

function stripHash(u) { return u.split('#')[0]; }

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (/^\/audio\/s[0-9a-f]+\.mp3$/.test(url.pathname)) e.respondWith(audio(e));
  else if (/\.js$/.test(url.pathname) && url.searchParams.has('v')) e.respondWith(cacheFirst(e, ASSETS));
  else if (url.pathname === '/search-index.json') e.respondWith(staleWhileRevalidate(e, ASSETS));
  else if (req.mode === 'navigate') e.respondWith(page(e));
});
