// Run the production ratings client in separate tab contexts with shared storage.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../portfolio/gallery-ratings.js', import.meta.url), 'utf8');
const storageKey = 'folio-photo-ratings-v1';
const identityA = '12345678-1234-4123-8123-123456789abc';
const identityB = 'abcdef12-1234-4123-8123-123456789abc';
const row = (photoId, average, count = 1) => ({ photoId, average, count, score: average });
const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function environment() {
  const data = new Map();
  let queue = Promise.resolve();
  return {
    storage: { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), clear: () => data.clear() },
    locks: { request(_name, callback) {
      const result = queue.then(callback);
      queue = result.catch(() => {});
      return result;
    } },
  };
}

function tab(shared, { fetch, uuid = () => identityA, locks = true } = {}) {
  const events = new Map();
  const window = {
    PHOTO_RATINGS_CONFIG: { API_BASE: 'https://ratings.test' },
    addEventListener(name, listener) {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(listener);
    },
  };
  const context = vm.createContext({
    window, navigator: { onLine: true, ...(locks ? { locks: shared.locks } : {}) },
    document: { querySelectorAll: () => [], addEventListener() {}, dispatchEvent() {} },
    localStorage: shared.storage, crypto: { randomUUID: uuid }, fetch, URL, AbortController,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    setTimeout, clearTimeout,
  });
  vm.runInContext(source, context);
  return { api: window.PhotoRatings, event: (name, value) => events.get(name)?.forEach((listener) => listener(value)) };
}

{
  const shared = environment();
  const posts = [];
  const fetch = async (_url, options) => {
    const body = JSON.parse(options.body); posts.push(body);
    return json({ rating: row(body.photoId, body.rating), yourRating: body.rating });
  };
  // Both tabs initialize before any vote, and no storage event is delivered yet.
  const first = tab(shared, { fetch });
  const second = tab(shared, { fetch, uuid: () => identityB });
  assert.equal(shared.storage.getItem(storageKey), null, 'loading the page must not create an identity');
  await Promise.all([first.api.vote('rooted', 5), second.api.vote('wire', 4)]);
  assert.equal(new Set(posts.map((body) => body.voterId)).size, 1);
  assert.deepEqual(JSON.parse(shared.storage.getItem(storageKey)).votes, { rooted: 5, wire: 4 });
  // A tab with stale memory must merge the other tab's votes before persisting.
  await first.api.vote('easy-smile', 3);
  assert.deepEqual(JSON.parse(shared.storage.getItem(storageKey)).votes, { rooted: 5, wire: 4, 'easy-smile': 3 });
  let notifications = 0;
  first.api.subscribe(() => { notifications++; });
  first.event('storage', { key: storageKey });
  assert.equal(notifications, 1, 'another tab\'s vote must rerender the current tab');
  assert.equal(new Set(posts.map((body) => body.voterId)).size, 1);
  console.log('PASS: already-open tabs share one identity and merge their votes under Web Locks.');
}

{
  const shared = environment();
  let payload;
  const visitor = tab(shared, { locks: false, uuid() {
    // Another tab creates the identity between the first read and UUID creation.
    shared.storage.setItem(storageKey, JSON.stringify({ voterId: identityB, votes: { wire: 4 } }));
    return identityA;
  }, fetch: async (_url, options) => {
    payload = JSON.parse(options.body);
    return json({ rating: row(payload.photoId, payload.rating) });
  } });
  await visitor.api.vote('rooted', 5);
  assert.equal(payload.voterId, identityB);
  assert.deepEqual(JSON.parse(shared.storage.getItem(storageKey)).votes, { wire: 4, rooted: 5 });
  console.log('PASS: browsers without Web Locks reread an identity created by another tab.');
}

{
  const shared = environment();
  const pendingGet = deferred();
  const visitor = tab(shared, { fetch: async (_url, options) => options.method === 'POST' ?
    json({ rating: row('rooted', 5, 2) }) : pendingGet.promise });
  const aggregate = visitor.api.getSummaries();
  await visitor.api.vote('rooted', 5);
  pendingGet.resolve(json({ ratings: [row('rooted', 1), row('wire', 4)] }));
  await aggregate;
  const summaries = await visitor.api.getSummaries();
  assert.equal(summaries.find((value) => value.photoId === 'rooted').average, 5);
  assert.equal(summaries.find((value) => value.photoId === 'rooted').count, 2);
  assert.equal(summaries.find((value) => value.photoId === 'wire').average, 4);
  console.log('PASS: a stale GET preserves a newer successful vote and loads other photo summaries.');
}

{
  const shared = environment();
  const older = deferred();
  const newer = deferred();
  let gets = 0;
  const visitor = tab(shared, { fetch: () => (++gets === 1 ? older : newer).promise });
  const first = visitor.api.getSummaries();
  const second = visitor.api.getSummaries(true);
  newer.resolve(json({ ratings: [row('rooted', 5, 2)] }));
  await second;
  older.resolve(json({ ratings: [row('rooted', 1)] }));
  await first;
  assert.equal((await visitor.api.getSummaries())[0].average, 5);
  console.log('PASS: an older forced aggregate refresh cannot replace a newer refresh.');
}

{
  const shared = environment();
  const pending = deferred();
  const visitor = tab(shared, { fetch: () => pending.promise });
  const vote = visitor.api.vote('rooted', 5);
  // Let identity initialization and fetch start before storage is cleared.
  await new Promise((resolve) => setImmediate(resolve));
  shared.storage.clear();
  visitor.event('storage', { key: null });
  pending.resolve(json({ rating: row('rooted', 5) }));
  await vote;
  assert.equal(shared.storage.getItem(storageKey), null, 'a late response must not resurrect a cleared identity');
  console.log('PASS: clearing browser storage during a vote does not restore the removed identity.');
}
