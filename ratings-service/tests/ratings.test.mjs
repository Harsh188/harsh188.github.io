import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import worker, { PHOTO_IDS } from '../worker/index.js';
import { createDatabase } from './d1-sqlite.mjs';

const ORIGIN = 'https://harsh188.github.io';
const HOST = 'https://ratings.example.chatgpt.site';
const TEST_SECRET = 'test-only-secret-not-a-production-secret-32';
const FIRST_PHOTO = PHOTO_IDS[0];

function setup(t, extraEnv = {}) {
  const DB = createDatabase();
  t.after(() => DB.sqlite.close());
  const env = { DB, RATING_IP_SECRET: TEST_SECRET, ...extraEnv };
  return {
    DB, env,
    get: (path = '/api/ratings', headers = {}) => worker.fetch(new Request(HOST + path, { headers }), env),
    vote: async (body = {}, options = {}) => {
      const headers = { Origin: ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.14', ...options.headers };
      for (const key of Object.keys(headers)) if (headers[key] === null) delete headers[key];
      return worker.fetch(new Request((options.host || HOST) + '/api/ratings', {
        method: 'POST', headers,
        body: options.rawBody ?? JSON.stringify({ photoId: FIRST_PHOTO, rating: 5, voterId: randomUUID(), ...body }),
      }), env);
    },
  };
}

function totalVotes(DB) {
  return DB.sqlite.prepare('SELECT COUNT(*) AS count FROM photo_votes').get().count;
}

function frozenClock(t, milliseconds = 1793786400000) {
  const previous = Date.now;
  let current = milliseconds;
  Date.now = () => current;
  t.after(() => { Date.now = previous; });
  return value => { current = value; };
}

test('allowlist matches the 35-photo contract fixture and available frontend source, preserving sony prefixes', () => {
  const toId = asset => asset.split('/').at(-1).replace(/\.[^.]+$/, '').replace(/-v\d+$/, '');
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/published-photos.json', import.meta.url), 'utf8'));
  assert.equal(PHOTO_IDS.length, 35);
  assert.deepEqual(PHOTO_IDS, fixture.photos.map(toId));
  assert.equal(new Set(PHOTO_IDS).size, PHOTO_IDS.length);
  const source = process.env.PHOTO_GALLERY_SOURCE || new URL('../../portfolio/pictures.html', import.meta.url);
  if (process.env.PHOTO_GALLERY_SOURCE || existsSync(source)) {
    const html = readFileSync(source, 'utf8');
    const ids = Array.from(html.matchAll(/data-photo="([^"]+)"/g), match => toId(match[1]));
    assert.deepEqual(PHOTO_IDS, ids, 'Backend allowlist and live portfolio source must agree.');
  }
});

test('fresh database exposes honest empty ratings and no invented top photos', async t => {
  const { get } = setup(t);
  const res = await get('/api/ratings', { Origin: ORIGIN });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('vary'), 'Origin');
  assert.equal(res.headers.get('access-control-expose-headers'), 'Retry-After');
  const { ratings } = await res.json();
  assert.equal(ratings.length, 35);
  assert.ok(ratings.every(row => row.count === 0 && row.average === 0 && row.score === 3.5));
  assert.deepEqual(await (await get('/api/top?limit=4')).json(), { ratings: [] });
});

test('same browser updates one vote, retries do not add votes, another visitor on the same WiFi is independent', async t => {
  const { vote, DB, get } = setup(t);
  const voterId = randomUUID();
  let res = await vote({ voterId, rating: 5 });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    rating: { photoId: FIRST_PHOTO, count: 1, average: 5, score: 3.75 }, yourRating: 5,
  });
  res = await vote({ voterId: voterId.toUpperCase(), rating: 2 });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).rating.count, 1);
  await vote({ voterId, rating: 2 });
  assert.equal(totalVotes(DB), 1);
  res = await vote({ rating: 4 });
  const body = await res.json();
  assert.equal(body.rating.count, 2);
  assert.equal(body.rating.average, 3);
  assert.equal(totalVotes(DB), 2);
  const publicJson = await (await get()).text();
  assert.ok(!publicJson.includes(voterId));
  assert.ok(!publicJson.includes('203.0.113.14'));
  assert.ok(!publicJson.includes('token'));
  const columns = DB.sqlite.prepare('PRAGMA table_info(photo_votes)').all().map(row => row.name);
  assert.deepEqual(columns, ['photo_id', 'voter_id', 'rating', 'created_at', 'updated_at']);
});

test('invalid photo, rating and voter values never write a vote or rate counter', async t => {
  const { vote, DB } = setup(t);
  for (const body of [
    { photoId: 'free-spirit' }, { photoId: "x'); DROP TABLE photo_votes; --" },
    { photoId: null }, { rating: 0 }, { rating: 6 }, { rating: 2.5 }, { rating: '5' },
    { rating: null }, { voterId: 'not-a-uuid' }, { voterId: null },
  ]) {
    const res = await vote(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  assert.equal(totalVotes(DB), 0);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM rating_rate_limits').get().count, 0);
});

test('Origin and preflight permit only the public site and configured loopback origins', async t => {
  const { vote, get, env } = setup(t, {
    RATING_DEV_ORIGINS: 'http://127.0.0.1:8767,https://evil.example,http://localhost:8767/path',
  });
  for (const origin of ['https://evil.example', 'null', 'https://harsh188.github.io.evil.example', 'http://harsh188.github.io']) {
    const res = await vote({}, { headers: { Origin: origin } });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  }
  assert.equal((await vote({}, { headers: { Origin: null } })).status, 403);
  assert.equal((await get('/api/ratings', { Origin: 'http://localhost:8767' })).status, 403);
  const local = await get('/api/ratings', { Origin: 'http://127.0.0.1:8767' });
  assert.equal(local.status, 200);
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://127.0.0.1:8767');
  const preflight = headers => worker.fetch(new Request(HOST + '/api/ratings', {
    method: 'OPTIONS', headers: {
      Origin: ORIGIN, 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type', ...headers,
    },
  }), env);
  const res = await preflight();
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-credentials'), null);
  assert.equal((await preflight({ 'Access-Control-Request-Method': 'DELETE' })).status, 403);
  assert.equal((await preflight({ 'Access-Control-Request-Headers': 'Authorization' })).status, 403);
});

test('JSON payload is strict and bounded even without a Content-Length header', async t => {
  const { vote, DB } = setup(t);
  assert.equal((await vote({}, { rawBody: '{broken' })).status, 400);
  assert.equal((await vote({}, { rawBody: '[]' })).status, 400);
  assert.equal((await vote({}, { rawBody: 'null' })).status, 400);
  assert.equal((await vote({}, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await vote({}, { rawBody: ' '.repeat(1025) })).status, 413);
  assert.equal(totalVotes(DB), 0);
});

test('production requires the trusted edge IP and secret; a hosted dev flag cannot enable spoofed headers', async t => {
  const { vote, env, DB } = setup(t, { RATING_LOCAL_TEST_MODE: 'true' });
  const headers = { 'CF-Connecting-IP': null, 'X-Forwarded-For': '203.0.113.20', 'X-Rating-Test-IP': '203.0.113.20' };
  assert.equal((await vote({}, { headers })).status, 503);
  assert.equal((await vote({}, { headers: { 'CF-Connecting-IP': 'not an ip' } })).status, 503);
  assert.equal((await vote({}, { headers: { 'CF-Connecting-IP': '256.1.1.1' } })).status, 503);
  env.RATING_IP_SECRET = undefined;
  assert.equal((await vote()).status, 503);
  env.RATING_IP_SECRET = 'too-short';
  assert.equal((await vote()).status, 503);
  assert.equal(totalVotes(DB), 0);
  env.RATING_IP_SECRET = TEST_SECRET;
  const local = await vote({}, { host: 'http://127.0.0.1:8787', headers });
  assert.equal(local.status, 200);
});

test('concurrent attempts share an atomic 120/10-minute IP budget without changing a blocked vote', async t => {
  frozenClock(t);
  const { vote, DB } = setup(t);
  const voterIds = Array.from({ length: 121 }, () => randomUUID());
  const results = await Promise.all(voterIds.map(voterId => vote({ voterId })));
  assert.equal(results.filter(res => res.status === 200).length, 120);
  assert.equal(results.filter(res => res.status === 429).length, 1);
  assert.equal(totalVotes(DB), 120);
  const acceptedIndex = results.findIndex(res => res.status === 200);
  const blocked = await vote({ voterId: voterIds[acceptedIndex], rating: 1 });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0 && Number(blocked.headers.get('retry-after')) <= 600);
  assert.equal(DB.sqlite.prepare('SELECT rating FROM photo_votes WHERE voter_id = ?').get(voterIds[acceptedIndex]).rating, 5);
  assert.equal((await vote({}, { headers: { 'CF-Connecting-IP': '203.0.113.15' } })).status, 200);
  assert.equal(totalVotes(DB), 121);
});

test('IP tokens rotate per window, canonicalize IPv6 and expire through bounded cleanup', async t => {
  const setTime = frozenClock(t);
  const { vote, DB } = setup(t);
  const expanded = { 'CF-Connecting-IP': '2001:0db8:0000:0000:0000:0000:0000:0001' };
  const compact = { 'CF-Connecting-IP': '2001:db8::1' };
  assert.equal((await vote({}, { headers: expanded })).status, 200);
  assert.equal((await vote({}, { headers: compact })).status, 200);
  let tokens = DB.sqlite.prepare('SELECT * FROM rating_rate_limits').all();
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].attempts, 2);
  const firstToken = tokens[0].token;
  assert.match(firstToken, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(tokens).includes('2001:db8'));
  setTime(1793787000000);
  assert.equal((await vote({}, { headers: compact })).status, 200);
  tokens = DB.sqlite.prepare('SELECT * FROM rating_rate_limits').all();
  assert.equal(tokens.length, 1);
  assert.notEqual(tokens[0].token, firstToken);
  const insert = DB.sqlite.prepare('INSERT INTO rating_rate_limits (token, attempts, expires_at) VALUES (?, 1, 0)');
  for (let i = 0; i < 250; i++) insert.run('expired-' + i);
  await vote({}, { headers: compact });
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM rating_rate_limits WHERE expires_at = 0').get().count, 50);
  await vote({}, { headers: compact });
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM rating_rate_limits WHERE expires_at = 0').get().count, 0);
});

test('Bayesian ranking favors sustained high ratings over one five-star vote and excludes retired/unvoted photos', async t => {
  const { vote, get, DB } = setup(t);
  await vote({ photoId: 'wire', rating: 5 });
  for (let i = 0; i < 10; i++) await vote({ photoId: 'rooted', rating: i < 5 ? 4 : 5 });
  DB.sqlite.prepare('INSERT INTO photo_votes VALUES (?, ?, ?, ?, ?)').run('retired-photo', randomUUID(), 5, 0, 0);
  const { ratings } = await (await get('/api/top?limit=4')).json();
  assert.deepEqual(ratings.map(row => row.photoId), ['rooted', 'wire']);
  assert.equal(ratings[0].count, 10);
  assert.equal(ratings[0].average, 4.5);
  assert.equal(ratings[0].score, 4.166667);
  assert.equal(ratings[1].score, 3.75);
  assert.equal((await (await get('/api/top?limit=1')).json()).ratings.length, 1);
  for (const value of ['0', '13', 'four', '4.5', '-1']) {
    assert.equal((await get('/api/top?limit=' + value)).status, 400);
  }
});

test('database failure rolls back the rate increment and never leaks SQL, identifiers or IP data', async t => {
  const { vote, DB } = setup(t);
  DB.failNextVote();
  const res = await vote();
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), {
    error: { code: 'ratings_unavailable', message: 'Ratings are temporarily unavailable. Please try again later.' },
  });
  assert.equal(totalVotes(DB), 0);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM rating_rate_limits').get().count, 0);
  assert.equal((await vote()).status, 200);
});

test('unsupported paths/methods fail safely and unprovisioned database stays unavailable', async t => {
  const { get, env } = setup(t);
  assert.equal((await get('/api/private')).status, 404);
  const res = await worker.fetch(new Request(HOST + '/api/ratings', { method: 'DELETE', headers: { Origin: ORIGIN } }), env);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, POST, OPTIONS');
  env.DB = undefined;
  assert.equal((await get()).status, 503);
});
