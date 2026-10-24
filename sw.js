// 幸とソロQ：ホーム画面から開いたとき、電波がなくても前に開いた画面を出すためのサービスワーカー
// ページはネット優先（更新をすぐ反映）、同じサイトのファイルはキャッシュを使いつつ裏で更新
// BGM（bgm/*.mp3、全部で約9MB）は最初から入れない。一度流した曲だけ、裏で丸ごと取ってきて別のキャッシュにしまう
const VERSION = 'soloq-v5';
const BGM_CACHE = 'soloq-bgm-1'; // 曲を作り直したら数字を上げる
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'app.js', 'voice/lines.json', 'audio/index.json', 'bgm/index.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== BGM_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const filling = new Map();
function fillBgm(key) {
  if (filling.has(key)) return filling.get(key);
  const p = fetch(key).then(r => r.ok ? caches.open(BGM_CACHE).then(c => c.put(key, r)) : null).catch(() => {}).finally(() => filling.delete(key));
  filling.set(key, p);
  return p;
}
// audio 要素は Range で少しずつ取りに来るので、しまってある曲から切り出して 206 で返す
async function bgmResponse(e, key) {
  const hit = await caches.match(key, { cacheName: BGM_CACHE });
  if (!hit) { e.waitUntil(fillBgm(key)); return fetch(e.request); }
  const range = e.request.headers.get('range');
  if (!range) return hit;
  const buf = await hit.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] ? +m[1] : 0, end = m[2] ? +m[2] : buf.byteLength - 1;
  if (!m[1] && m[2]) { start = Math.max(0, buf.byteLength - +m[2]); end = buf.byteLength - 1; }
  end = Math.min(end, buf.byteLength - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${buf.byteLength}` } });
  return new Response(buf.slice(start, end + 1), { status: 206, headers: {
    'Content-Type': 'audio/mpeg', 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`, 'Accept-Ranges': 'bytes' } });
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put('index.html', cp)); return r; }).catch(() => caches.match('index.html')));
    return;
  }
  if (url.origin !== location.origin) return;
  if (/\/bgm\/[^/]+\.mp3$/.test(url.pathname)) { e.respondWith(bgmResponse(e, url.origin + url.pathname)); return; }
  if (req.headers.has('range')) return;
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
