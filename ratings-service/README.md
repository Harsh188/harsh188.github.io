# Photo ratings service

A small, shared ratings backend for `https://harsh188.github.io`. The public gallery and homepage continue to run on GitHub Pages. This directory is a separate, dependency-free Cloudflare Worker ESM service with a Sites-managed D1 database; it neither serves nor replaces the portfolio frontend.

No votes are seeded. A fresh service returns all 35 approved photos with zero votes and an empty top-photo list. A top list is populated only by real visitors' submissions. The Worker publishes aggregate counts, averages, and ranking scores, never browser identifiers or rate-limit records.

## Browser contract

| Request | Response |
| --- | --- |
| `GET /api/ratings` | `{ "ratings": [{ "photoId": "wire", "count": 0, "average": 0, "score": 3.5 }, ...] }` for all current photo IDs |
| `GET /api/top?limit=4` | `{ "ratings": [...] }`, ranked, excluding unvoted photos; limit 1–12, default 4 |
| `POST /api/ratings` | Body `{ "photoId": "wire", "rating": 5, "voterId": "<random UUID v4>" }`; response `{ "rating": { "photoId": "wire", "count": 1, "average": 5, "score": 3.75 }, "yourRating": 5 }` |

Generate a random `crypto.randomUUID()` once per browser and retain it locally. Sending the same UUID/photo pair updates that one vote. Retries or changing a rating do not inflate the count. Shared WiFi visitors keep separate votes because an IP address is never the vote's identity. Ratings must be integers 1–5; the JSON body is limited to 1024 bytes.

The stable photo ID is the full-size asset basename without its file extension and trailing `-v<digits>`. In particular, keep `sony-by-the-water`, `sony-last-light`, `sony-reflections`, and `sony-small-details` with their `sony-` prefix. `PHOTO_IDS` in `worker/index.js` is the allowlist. Removed/orphaned assets cannot receive votes; old records for retired IDs are omitted from public lists.

Rank uses the Bayesian score `(ratingSum + 3.5 × 5) / (voteCount + 5)`. The five-vote prior discourages a single five-star vote from automatically overtaking photos with many consistently strong votes. Ties use count, average, then stable ID. Returned averages have two decimal places and scores six; unvoted photos have average 0 and score 3.5, and never appear in `/api/top`.

All responses use `Cache-Control: no-store`. The frontend should omit credentials, keep API responses out of the gallery's offline cache, and show a connectivity message when voting offline. Do not queue/replay ratings in a service worker. Errors use `{ "error": { "code": "...", "message": "..." } }`. A 429 response includes `Retry-After` in seconds, exposed to allowed cross-origin clients. A 503 means ratings are temporarily unavailable; do not display a successful vote until POST succeeds.

## Origin, IP handling, and limits

- Production browser Origin is exactly `https://harsh188.github.io`. No wildcard, credentials, or other remote origins are allowed. POST requires an allowed Origin and `application/json`; public GET requests without Origin are allowed. Preflight permits only the declared methods and Content-Type header. CORS constrains browsers, not determined clients or bots capable of forging request headers.
- The server reads only Cloudflare's `CF-Connecting-IP` header. It never trusts X-Forwarded-For or a visitor-supplied body field. Missing/invalid trusted IP fails closed for production writes.
- Before using the address, the Worker derives `HMAC-SHA256(RATING_IP_SECRET, "photo-rating-ip:v1:<windowStart>:<canonicalIP>")`. Raw addresses are never stored or explicitly logged. No IP or IP token is attached to a permanent vote. Tokens are pseudonymous abuse controls, not a claim of mathematical anonymity; hosting-platform access logs remain governed by the host.
- One connection may make 120 valid write attempts per fixed 10-minute window, enough for several visitors on the same WiFi to rate the collection. Updates and identical retries count toward that budget. The counter increment, conditional vote UPSERT, and summary run in a single D1 `batch()` transaction, preventing concurrency races. Rate denial does not modify an existing vote.
- Tokens expire at the end of their window, change between windows, and cannot be used as cross-window visitor identifiers. Each valid write deletes at most 200 expired rows using an indexed expiry query. Inactive periods can leave expired rows in storage until the next write; they no longer affect limits. No scheduled job is required. More aggressive retention can be added later with a supported scheduled bounded cleanup.
- This is a lightweight anonymous rating system, not one-person-one-vote identity verification. Clearing browser storage creates a new identifier; changing networks can evade a connection limit. Browser UUIDs and a short-window IP limit reduce accidental duplicates and casual abuse without requiring sign-in. A stronger abuse requirement would need an additional challenge or authenticated identity.

## Runtime bindings

Source `.openai/hosting.json` declares `"d1": "DB"` and `"r2": null`. The Site owner must persist the newly provisioned `project_id` in that manifest. This template intentionally does not invent a project identity.

Required:

- `DB`: Sites-provisioned D1 binding, with the committed Drizzle migration applied during deployment.
- `RATING_IP_SECRET`: a runtime secret containing at least 32 cryptographically random characters. Supply it through the Sites runtime environment tools. Never put the production value in source, a static JS config, a command argument, or a build artifact. Rotating it resets active IP rate windows; existing browser votes remain intact.

Optional local development:

- `RATING_DEV_ORIGINS`: comma-separated exact HTTP loopback origins, for example `http://127.0.0.1:8767,http://localhost:8767`. The parser ignores arbitrary remote origins and malformed values. Leave unset in production.
- `RATING_LOCAL_TEST_MODE=true`: allows `X-Rating-Test-IP` instead of CF-Connecting-IP **only when the Worker request URL itself is loopback**. This flag cannot enable that header on a hosted URL. Leave unset in production. `.dev.vars.example` documents a local-only configuration.

No admin endpoints, database contents, configuration values, cookies, or raw IP fields are exposed by this Worker.

## Checks and schema

Runtime requires no packages. Node 22.13+ is required for tests, which run the actual Worker with the generated schema and queries in `node:sqlite`. The pinned Drizzle packages are build-time migration tools only.

From this directory:

```sh
node --test tests/*.test.mjs
bash scripts/build.sh
node scripts/validate-artifact.mjs
```

The test suite checks duplicate updates, shared-WiFi independence, invalid input and Origins, strict/bounded payloads, trusted-IP restrictions, concurrent rate limiting, expiry and bounded cleanup, Bayesian ranking, and transaction rollback/error redaction. The allowlist parity test always checks the committed 35-photo contract fixture in `tests/fixtures/published-photos.json`. It additionally reads `../portfolio/pictures.html` when this service is nested in the portfolio repository. In a standalone service checkout, set `PHOTO_GALLERY_SOURCE` to the absolute source HTML path for that cross-repository integrity check. An explicitly configured missing source is a test failure; absence of the optional sibling portfolio does not skip any standalone tests.

For schema changes, install the pinned dependencies with the Sites dependency helper, edit `db/schema.js`, run `pnpm run db:generate`, inspect the generated SQL plus journal/snapshot, and commit them together. Keep already-applied SQL and migration metadata immutable. Migrations contain schema only, with no seed votes or runtime state. Local SQLite tests apply every migration in order; the hosted database is separate.

The build preserves the Worker ESM starter layout:

```text
dist/
  server/index.js
  .openai/hosting.json
  .openai/drizzle/*.sql
  .openai/drizzle/meta/*
```

The standard Sites source packager also copies root `drizzle/` into `dist/.openai/drizzle`, so migrations survive deployment packaging. The artifact validator verifies the DB binding, journal, corresponding SQL files, schema-only migration contents, and executable ESM entrypoint.

## Publishing

Keep the separate service Site identity and public audience. Copy this directory's source into its designated Sites source checkout while preserving that checkout's `project_id`. Use the standard Sites source workflow and these ordered commands from the service root:

```json
[
  ["node", "--test", "tests/ratings.test.mjs"],
  ["bash", "scripts/build.sh"],
  ["node", "scripts/validate-artifact.mjs"]
]
```

Sites applies the committed D1 migrations before uploading the Worker. Set the required secret through the runtime tools and verify GET/preflight responses on the resulting public URL before configuring the GitHub Pages frontend `apiBase`. Do not submit fake verification votes to the production database: POST is covered by local integration tests. Read-only production checks can inspect `/api/ratings` and `/api/top?limit=4` without creating any records.

When adding/removing portfolio photos, update the allowlist and captured-source fixture and redeploy the service with the frontend change. Image revisions under the same stable ID retain their votes.

Implementation references: [D1 prepared statements and transactional batch](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Cloudflare trusted request headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip).
