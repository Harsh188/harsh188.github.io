// Exercise the actual service worker with browser API stand-ins, without a browser.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';

const base = 'https://gallery.test/';
const handlers = new Map();
const stores = new Map();
let online = true;
const files = new Map();
const downloads = [];
const caches = {
  async open(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    const url = (value) => typeof value === 'string' ? value : value.url;
    return {
      async match(request) { return store.get(url(request))?.clone(); },
      async put(request, response) { store.set(url(request), response.clone()); },
      async keys() { return Array.from(store.keys(), (value) => new Request(value)); },
      async delete(request) { return store.delete(url(request)); },
    };
  },
  async keys() { return Array.from(stores.keys()); },
  async delete(name) { return stores.delete(name); },
};
const context = vm.createContext({
  self: { registration: { scope: base }, location: { origin: new URL(base).origin },
    addEventListener(type, callback) { handlers.set(type, callback); }, skipWaiting() {}, clients: { claim() {} } },
  caches, crypto: webcrypto, Response, Request, URL, AbortSignal, console,
  // Unref watchdogs so successful tests do not wait for network timeout timers.
  setTimeout(fn, ms) { return setTimeout(fn, ms).unref(); },
  async fetch(request) {
    const url = typeof request === 'string' ? request : request.url;
    downloads.push(url);
    if (!online) throw new Error('Offline');
    return files.has(url) ? new Response(files.get(url)) : new Response('Missing', { status: 404 });
  },
});
vm.runInContext(await readFile(new URL('../portfolio/gallery-sw.js', import.meta.url), 'utf8'), context);
const sha = (body) => createHash('sha256').update(body).digest('hex');
function manifest(version, images) {
  const entries = { 'index.html': 'Home', 'pictures.html': `Gallery ${version}`, ...images };
  const resources = Object.entries(entries).map(([url, body]) => {
    files.set(new URL(url, base).href, body);
    return { url, sha256: sha(body), bytes: Buffer.byteLength(body) };
  });
  return { version: 1, revision: sha(JSON.stringify(resources)).slice(0, 20), resources,
    photoCount: Object.keys(images).length, totalBytes: resources.reduce((sum, entry) => sum + entry.bytes, 0),
    photos: Object.keys(images).map((source) => ({ source, preview: source })) };
}
async function message(type, manifest) {
  let operation;
  const replies = [];
  handlers.get('message')({ data: { type, manifest }, ports: [{ postMessage(data) { replies.push(data); } }],
    waitUntil(promise) { operation = promise; } });
  await operation;
  return replies.at(-1);
}
async function resource(path, navigate = false) {
  let operation;
  const pending = [];
  handlers.get('fetch')({ request: { url: new URL(path, base).href, method: 'GET', mode: navigate ? 'navigate' : 'cors' },
    respondWith(promise) { operation = promise; }, waitUntil(promise) { pending.push(promise); } });
  const response = await operation;
  await Promise.all(pending);
  return response;
}

const first = manifest(1, { 'assets/first.jpg': 'photo one', 'assets/retired.jpg': 'old photo' });
assert.equal((await message('SAVE', first)).saved, true);
online = false;
assert.equal(await (await resource('pictures.html?v=anything', true)).text(), 'Gallery 1');
assert.equal(await (await resource('/', true)).text(), 'Home');
assert.equal(await (await resource('assets/first.jpg')).text(), 'photo one');
assert.equal((await message('STATUS')).saved, true);
console.log('PASS: saved pages, homepage alias, query URLs and photos work offline.');

online = true;
const second = manifest(2, { 'assets/first.jpg': 'photo one', 'assets/new.jpg': 'new photo' });
files.set(new URL('assets/new.jpg', base).href, 'stale CDN bytes');
assert.equal((await message('SAVE', second)).type, 'error');
assert.equal((await message('STATUS')).revision, first.revision);
online = false;
assert.equal(await (await resource('pictures.html', true)).text(), 'Gallery 1');
console.log('PASS: interrupted or stale updates preserve the previous complete gallery.');

online = true;
files.set(new URL('assets/new.jpg', base).href, 'new photo');
downloads.length = 0;
assert.equal((await message('SAVE', second)).revision, second.revision);
assert(!downloads.some((url) => url.endsWith('first.jpg')));
assert(!(await caches.keys()).some((name) => name.endsWith(first.revision)));
online = false;
assert.equal(await (await resource('assets/new.jpg')).text(), 'new photo');
console.log('PASS: retries reuse verified files, publish atomically, and remove retired versions.');

const saved = await caches.open(`harshith-gallery-saved-${second.revision}`);
await saved.delete(new URL('assets/new.jpg', base).href);
assert.equal((await message('STATUS')).saved, false);
assert.equal((await message('REMOVE')).saved, false);
assert(!(await caches.keys()).some((name) => name.startsWith('harshith-gallery-saved-')));
console.log('PASS: partial eviction is detected and offline copies can be removed.');

online = true;
await message('STATUS', second);
assert.equal(await (await resource('assets/new.jpg')).text(), 'new photo');
online = false;
assert.equal(await (await resource('assets/new.jpg')).text(), 'new photo');
online = true;
const third = manifest(3, { 'assets/new.jpg': 're-edited photo' });
await message('STATUS', third);
assert.equal(await (await resource('assets/new.jpg')).text(), 're-edited photo');
console.log('PASS: viewed-photo caching works and same-filename re-edits invalidate the old preview.');
