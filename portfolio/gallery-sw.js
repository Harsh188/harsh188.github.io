/* Offline copies belong only to the photographic folio, never the blog/work pages. */
const PREFIX = 'harshith-gallery-';
const META = `${PREFIX}meta-v1`;
const RUNTIME = `${PREFIX}viewed-v1`;
const BASE = self.registration.scope;
const key = (path) => new URL(path, BASE).href;
const STATE_KEY = key('.gallery-saved');
const CATALOG_KEY = key('gallery-manifest.json');
let saving = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function record(url) {
  const response = await (await caches.open(META)).match(url);
  return response ? response.json() : null;
}
async function writeRecord(url, value) {
  await (await caches.open(META)).put(url, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
}
function validate(manifest) {
  if (manifest?.version !== 1 || !/^[a-f0-9]{20}$/.test(manifest.revision) || !Array.isArray(manifest.resources) || !manifest.resources.length) throw new Error('Invalid gallery manifest');
  for (const item of manifest.resources) {
    const url = new URL(item.url, BASE);
    if (!url.href.startsWith(BASE) || url.origin !== self.location.origin || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid gallery resource');
  }
  return manifest;
}
async function status() {
  const saved = await record(STATE_KEY);
  if (!saved) return { saved: false };
  const cache = await caches.open(saved.cacheName);
  const entries = new Set((await cache.keys()).map((request) => request.url));
  const complete = saved.manifest.resources.every((resource) => entries.has(key(resource.url)));
  return { saved: complete, revision: saved.manifest.revision, photoCount: saved.manifest.photoCount, savedAt: saved.savedAt };
}
async function digest(response) {
  const hash = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function save(manifest, progress) {
  validate(manifest);
  const old = await record(STATE_KEY);
  const oldCache = old && await caches.open(old.cacheName);
  const oldResources = new Map(old?.manifest.resources.map((resource) => [resource.url, resource.sha256]) || []);
  const cacheName = `${PREFIX}saved-${manifest.revision}`;
  const cache = await caches.open(cacheName);
  let completed = 0;
  let completedBytes = 0;
  let cursor = 0;
  let failure;
  const report = () => progress({ type: 'progress', completed, total: manifest.resources.length, completedBytes, totalBytes: manifest.totalBytes });
  report();
  // A previous complete cache stays active until every new response is verified.
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (!failure && cursor < manifest.resources.length) {
      const item = manifest.resources[cursor++];
      try {
        let response = await cache.match(key(item.url));
        if (response && await digest(response) !== item.sha256) response = null;
        if (!response && oldResources.get(item.url) === item.sha256) response = await oldCache.match(key(item.url));
        if (!response) response = await fetch(key(item.url), { cache: 'reload', signal: AbortSignal.timeout(45000) });
        if (!response.ok || await digest(response) !== item.sha256) throw new Error('A gallery file could not be verified. Please retry when connected.');
        await cache.put(key(item.url), response);
        completed++; completedBytes += item.bytes; report();
      } catch (error) { failure = error; }
    }
  }));
  if (failure) throw failure;
  const savedAt = new Date().toISOString();
  await writeRecord(STATE_KEY, { cacheName, manifest, savedAt });
  await writeRecord(CATALOG_KEY, manifest);
  await caches.delete(RUNTIME);
  for (const name of await caches.keys()) {
    if (name.startsWith(`${PREFIX}saved-`) && name !== cacheName) await caches.delete(name);
  }
  return { saved: true, revision: manifest.revision, photoCount: manifest.photoCount, savedAt };
}
self.addEventListener('message', (event) => {
  const port = event.ports[0];
  if (!port) return;
  const send = (data) => port.postMessage(data);
  event.waitUntil((async () => {
    try {
      if (event.data.type === 'STATUS') {
        if (event.data.manifest) await writeRecord(CATALOG_KEY, validate(event.data.manifest));
        send({ type: 'done', ...await status() });
      } else if (event.data.type === 'SAVE') {
        if (saving) throw new Error('A gallery download is already running. Try again shortly.');
        saving = save(event.data.manifest, send);
        try { send({ type: 'done', ...await saving }); } finally { saving = null; }
      } else if (event.data.type === 'REMOVE') {
        if (saving) throw new Error('Please wait for the gallery download to finish.');
        for (const name of await caches.keys()) if (name.startsWith(`${PREFIX}saved-`) || name === RUNTIME) await caches.delete(name);
        await (await caches.open(META)).delete(STATE_KEY);
        send({ type: 'done', saved: false });
      }
    } catch (error) { send({ type: 'error', message: error.name === 'QuotaExceededError' ? 'Not enough browser storage. Free some space and try again.' : error.message, ...await status() }); }
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !url.href.startsWith(BASE) || url.origin !== self.location.origin) return;
  if (url.pathname === new URL('gallery-manifest.json', BASE).pathname || url.pathname === new URL('gallery-sw.js', BASE).pathname) return;
  event.respondWith((async () => {
    const saved = await record(STATE_KEY);
    const catalog = await record(CATALOG_KEY);
    let resourceURL = url.href;
    if (event.request.mode === 'navigate') {
      const home = new URL(BASE).pathname;
      if (url.pathname !== home && !['index.html', 'pictures.html'].some((page) => url.pathname === new URL(page, BASE).pathname)) return fetch(event.request);
      resourceURL = key(url.pathname === home ? 'index.html' : url.pathname.slice(home.length));
    }
    const expected = catalog?.resources.find((resource) => key(resource.url) === resourceURL);
    const oldExpected = saved?.manifest.resources.find((resource) => key(resource.url) === resourceURL);
    if (!expected && !oldExpected) return fetch(event.request);
    const pinned = saved && await (await caches.open(saved.cacheName)).match(resourceURL);
    const isPhoto = catalog?.photos.some((photo) => [photo.source, photo.preview].some((path) => key(path) === resourceURL));
    const runtime = await caches.open(RUNTIME);
    const runtimeKey = new URL(resourceURL);
    if (expected) runtimeKey.searchParams.set('__folio_sha', expected.sha256);
    const viewed = isPhoto && await runtime.match(runtimeKey.href);
    if (isPhoto && pinned) return pinned;
    // Never hold a previously saved photo behind a poor network connection.
    if (isPhoto && viewed) return viewed;
    const network = fetch(event.request);
    try {
      const response = await Promise.race([network, new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout')), 2500))]);
      if (!response.ok) throw new Error('Resource unavailable');
      if (isPhoto) event.waitUntil((async () => {
        await runtime.put(runtimeKey.href, response.clone());
        const requests = await runtime.keys();
        for (const request of requests.slice(0, Math.max(0, requests.length - 40))) await runtime.delete(request);
      })().catch(() => {}));
      return response;
    } catch (error) {
      if (pinned) return pinned;
      // An uncached first visit must still be allowed to finish on a slow network.
      return network;
    }
  })());
});
