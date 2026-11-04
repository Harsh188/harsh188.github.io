// Dependency-free Cloudflare Worker. Keep this module self-contained: the Sites
// Worker ESM starter publishes this file as dist/server/index.js.
export const PHOTO_IDS = Object.freeze([
  'easy-smile', 'kodak-carousel', 'rooted', 'wire',
  'the-long-way-down', 'above-it-all', 'moon-over-the-city', 'a-shared-view',
  'setting-sutro', 'sunset-overlook', 'violet-bloom', 'chris-moon',
  'golden-gate-1', 'golden-gate-2', 'puffy-morning', 'hardly-strictly-bluegrass',
  'performative', 'after-midnight', 'sony-by-the-water', 'sony-last-light',
  'sony-reflections', 'sony-small-details', 'home', 'sunrise-webs',
  'curious-eevee', 'what-if', 'glowing-lanterns', 'amelie-after-dark',
  'pastel-clouds', '19th', 'peaking', 'salesforce-framed', 'blush',
  'cherry-starburst', 'amber',
]);

const ALLOWED_PHOTOS = new Set(PHOTO_IDS);
const PUBLIC_ORIGIN = 'https://harsh188.github.io';
const WINDOW_SECONDS = 600;
const MAX_ATTEMPTS = 120;
const CLEANUP_LIMIT = 200;
const MAX_BODY_BYTES = 1024;
const PRIOR_MEAN = 3.5;
const PRIOR_WEIGHT = 5;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function isLoopback(hostname) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

function allowedOrigins(env) {
  const origins = new Set([PUBLIC_ORIGIN]);
  // No configurable production wildcard or arbitrary remote origin. Local
  // development must be explicitly enabled with exact comma-separated origins.
  for (const value of String(env.RATING_DEV_ORIGINS || '').split(',')) {
    try {
      const candidate = value.trim();
      const url = new URL(candidate);
      if (url.origin === candidate && url.protocol === 'http:' && isLoopback(url.hostname)) {
        origins.add(candidate);
      }
    } catch { /* Ignore malformed configuration, never broaden access. */ }
  }
  return origins;
}

function response(body, status = 200, origin = null, headers = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(body === null ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...(origin ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Expose-Headers': 'Retry-After',
      } : {}),
      ...headers,
    },
  });
}

function summary(photoId, row) {
  const count = Number(row?.count || 0);
  const total = Number(row?.total || 0);
  return {
    photoId,
    count,
    average: count ? Math.round((total / count) * 100) / 100 : 0,
    score: Math.round(((total + PRIOR_MEAN * PRIOR_WEIGHT) / (count + PRIOR_WEIGHT)) * 1e6) / 1e6,
  };
}

async function readSummaries(db) {
  const { results } = await db.prepare(
    'SELECT photo_id, COUNT(*) AS count, SUM(rating) AS total FROM photo_votes GROUP BY photo_id',
  ).all();
  const byId = new Map(results.map(row => [row.photo_id, row]));
  // Only current photos are public, even if retired votes remain in storage.
  return PHOTO_IDS.map(photoId => summary(photoId, byId.get(photoId)));
}

async function readBody(request) {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'json_required', 'Send the rating as application/json.');
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) {
    throw new HttpError(413, 'body_too_large', 'The request is too large.');
  }
  if (!request.body) throw new HttpError(400, 'invalid_json', 'A JSON rating is required.');
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, 'body_too_large', 'The request is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError(400, 'invalid_json', 'A valid JSON rating is required.');
  }
}

function validateVote(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_rating', 'A photo, a rating, and a browser identifier are required.');
  }
  if (!ALLOWED_PHOTOS.has(body.photoId)) {
    throw new HttpError(400, 'unknown_photo', 'That photo is not in the current gallery.');
  }
  if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
    throw new HttpError(400, 'invalid_rating', 'Choose a whole-number rating from 1 to 5.');
  }
  if (typeof body.voterId !== 'string' || !UUID_V4.test(body.voterId)) {
    throw new HttpError(400, 'invalid_voter', 'A valid random browser identifier is required.');
  }
  return { photoId: body.photoId, rating: body.rating, voterId: body.voterId.toLowerCase() };
}

function normalizeIp(value) {
  if (typeof value !== 'string' || value.length > 45) return null;
  if (value.includes(':')) {
    try {
      // WHATWG URL validates and canonicalizes IPv6, including IPv4-mapped IPv6.
      return new URL(`http://[${value}]/`).hostname.slice(1, -1);
    } catch { return null; }
  }
  const octets = value.split('.');
  return octets.length === 4 && octets.every(octet => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
    ? value : null;
}

function trustedIp(request, env) {
  const url = new URL(request.url);
  // This bypass cannot activate on a hosted URL, even with a stray dev env flag.
  const localTest = env.RATING_LOCAL_TEST_MODE === 'true' && isLoopback(url.hostname);
  return normalizeIp(localTest
    ? request.headers.get('x-rating-test-ip')
    : request.headers.get('cf-connecting-ip'));
}

async function windowToken(secret, ip, windowStart) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`photo-rating-ip:v1:${windowStart}:${ip}`),
  ));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function recordVote(request, env, db) {
  const vote = validateVote(await readBody(request));
  const ip = trustedIp(request, env);
  if (!ip) throw new HttpError(503, 'ratings_unavailable', 'Ratings are temporarily unavailable. Please try again later.');
  const secret = env.RATING_IP_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new HttpError(503, 'ratings_unavailable', 'Ratings are temporarily unavailable. Please try again later.');
  }
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / WINDOW_SECONDS) * WINDOW_SECONDS;
  const windowEnd = windowStart + WINDOW_SECONDS;
  const token = await windowToken(secret, ip, windowStart);
  // D1 batch is one transaction. The vote's WHERE checks the incremented counter
  // in that same batch, so concurrent isolates cannot race past the limit.
  // No IP or IP token is attached to a permanent vote record.
  const results = await db.batch([
    db.prepare(`DELETE FROM rating_rate_limits WHERE token IN (
      SELECT token FROM rating_rate_limits WHERE expires_at <= ? ORDER BY expires_at LIMIT ?
    )`).bind(now, CLEANUP_LIMIT),
    db.prepare(`INSERT INTO rating_rate_limits (token, attempts, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(token) DO UPDATE SET attempts = MIN(rating_rate_limits.attempts + 1, ?)
      RETURNING attempts`).bind(token, windowEnd, MAX_ATTEMPTS + 1),
    db.prepare(`INSERT INTO photo_votes (photo_id, voter_id, rating, created_at, updated_at)
      SELECT ?, ?, ?, ?, ? WHERE (
        SELECT attempts FROM rating_rate_limits WHERE token = ?
      ) <= ?
      ON CONFLICT(photo_id, voter_id) DO UPDATE SET rating = excluded.rating,
        updated_at = excluded.updated_at`).bind(
      vote.photoId, vote.voterId, vote.rating, now, now, token, MAX_ATTEMPTS,
    ),
    db.prepare('SELECT COUNT(*) AS count, SUM(rating) AS total FROM photo_votes WHERE photo_id = ?')
      .bind(vote.photoId),
  ]);
  if (Number(results[1].results[0]?.attempts) > MAX_ATTEMPTS) {
    throw new HttpError(429, 'rate_limited', 'Too many ratings from this connection. Please try again shortly.', {
      'Retry-After': String(Math.max(1, windowEnd - now)),
    });
  }
  return { rating: summary(vote.photoId, results[3].results[0]), yourRating: vote.rating };
}

export default {
  async fetch(request, env = {}) {
    let corsOrigin = null;
    try {
      const origin = request.headers.get('origin');
      if (origin !== null) {
        if (!allowedOrigins(env).has(origin)) {
          throw new HttpError(403, 'origin_not_allowed', 'This origin is not allowed.');
        }
        corsOrigin = origin;
      }
      const url = new URL(request.url);
      const isRatings = url.pathname === '/api/ratings';
      const isTop = url.pathname === '/api/top';
      if (url.pathname === '/' && request.method === 'GET') {
        return response({ service: 'Harshith photo ratings', endpoints: ['/api/ratings', '/api/top?limit=4'] }, 200, corsOrigin);
      }
      if (!isRatings && !isTop) throw new HttpError(404, 'not_found', 'Not found.');
      const methods = isRatings ? 'GET, POST, OPTIONS' : 'GET, OPTIONS';
      if (request.method === 'OPTIONS') {
        const requestedMethod = request.headers.get('access-control-request-method');
        const requestedHeaders = (request.headers.get('access-control-request-headers') || '')
          .split(',').map(header => header.trim().toLowerCase()).filter(Boolean);
        if (!origin || !methods.split(', ').includes(requestedMethod) || requestedHeaders.some(header => header !== 'content-type')) {
          throw new HttpError(403, 'preflight_not_allowed', 'This request is not allowed.');
        }
        return response(null, 204, corsOrigin, {
          'Access-Control-Allow-Methods': methods,
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '600',
        });
      }
      if (request.method !== 'GET' && !(isRatings && request.method === 'POST')) {
        throw new HttpError(405, 'method_not_allowed', 'This method is not allowed.', { Allow: methods });
      }
      if (request.method === 'POST' && !origin) {
        throw new HttpError(403, 'origin_required', 'An allowed browser origin is required.');
      }
      const db = env.DB;
      if (!db?.prepare || !db?.batch) {
        throw new HttpError(503, 'ratings_unavailable', 'Ratings are temporarily unavailable. Please try again later.');
      }
      if (request.method === 'POST') return response(await recordVote(request, env, db), 200, corsOrigin);
      let limit = 4;
      if (isTop && url.searchParams.has('limit')) {
        const raw = url.searchParams.get('limit');
        if (!/^[1-9]\d?$/.test(raw || '') || Number(raw) > 12) {
          throw new HttpError(400, 'invalid_limit', 'Choose a limit from 1 to 12.');
        }
        limit = Number(raw);
      }
      let ratings = await readSummaries(db);
      if (isTop) {
        ratings = ratings.filter(row => row.count > 0).sort((a, b) =>
          b.score - a.score || b.count - a.count || b.average - a.average || a.photoId.localeCompare(b.photoId),
        ).slice(0, limit);
      }
      return response({ ratings }, 200, corsOrigin);
    } catch (error) {
      if (error instanceof HttpError) {
        return response({ error: { code: error.code, message: error.message } }, error.status, corsOrigin, error.headers);
      }
      // Never serialize SQL errors, request headers, voter IDs, or IP data.
      console.error('Photo ratings request failed.');
      return response({ error: { code: 'ratings_unavailable', message: 'Ratings are temporarily unavailable. Please try again later.' } }, 503, corsOrigin);
    }
  },
};
