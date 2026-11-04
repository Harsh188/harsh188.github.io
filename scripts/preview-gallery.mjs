// Local-only preview: real ratings Worker + ephemeral SQLite; never writes live votes.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../ratings-service/worker/index.js';
import { createDatabase } from '../ratings-service/tests/d1-sqlite.mjs';

const option = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const port = Number(option('port', 8791));
const voteDelay = Number(option('vote-delay-ms', 0));
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !Number.isFinite(voteDelay) || voteDelay < 0 || voteDelay > 10000) {
  throw new Error('Use --port=1024..65535 and --vote-delay-ms=0..10000.');
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../docs');
const origin = `http://127.0.0.1:${port}`;
const config = `// Local preview only: votes disappear when this server stops.\nwindow.PHOTO_RATINGS_CONFIG = Object.freeze({ API_BASE: '${origin}' });\n`;
const DB = createDatabase();
const env = { DB, RATING_IP_SECRET: 'local-preview-only-not-a-production-secret',
  RATING_DEV_ORIGINS: origin, RATING_LOCAL_TEST_MODE: 'true' };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

const server = http.createServer(async (incoming, outgoing) => {
  try {
    if (incoming.headers.host !== `127.0.0.1:${port}`) { outgoing.writeHead(403).end(); return; }
    const url = new URL(incoming.url, origin);
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const chunk of incoming) {
        chunks.push(chunk);
        if (chunks.reduce((sum, value) => sum + value.length, 0) > 2048) {
          outgoing.writeHead(413).end(); return;
        }
      }
      const headers = new Headers(incoming.headers);
      headers.set('x-rating-test-ip', '127.0.0.1');
      if (incoming.method === 'POST' && voteDelay) await new Promise(done => setTimeout(done, voteDelay));
      const response = await worker.fetch(new Request(url, { method: incoming.method, headers,
        ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Buffer.concat(chunks) }) }), env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer())); return;
    }
    if (!['GET', 'HEAD'].includes(incoming.method)) { outgoing.writeHead(405).end(); return; }
    let body;
    if (url.pathname === '/ratings-config.js') body = Buffer.from(config);
    else if (url.pathname === '/gallery-manifest.json') {
      const manifest = JSON.parse(await readFile(resolve(root, 'gallery-manifest.json'), 'utf8'));
      const resource = manifest.resources.find(item => item.url.split('?')[0] === 'ratings-config.js');
      if (resource) {
        manifest.totalBytes += Buffer.byteLength(config) - resource.bytes;
        resource.bytes = Buffer.byteLength(config);
        resource.sha256 = createHash('sha256').update(config).digest('hex');
      }
      manifest.revision = createHash('sha256').update(JSON.stringify(manifest.resources)).digest('hex').slice(0, 20);
      body = Buffer.from(JSON.stringify(manifest));
    } else {
      const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!path.startsWith(root + sep)) { outgoing.writeHead(403).end(); return; }
      if (!(await stat(path)).isFile()) { outgoing.writeHead(404).end(); return; }
      body = await readFile(path);
    }
    outgoing.writeHead(200, { 'Content-Type': types[url.pathname === '/' ? '.html' : extname(url.pathname)] || 'application/octet-stream',
      'Cache-Control': 'no-store', 'Content-Length': body.length });
    outgoing.end(incoming.method === 'HEAD' ? undefined : body);
  } catch (error) {
    outgoing.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Preview resource unavailable.');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`${origin}/pictures.html — local test votes only; database resets on exit.`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { DB.sqlite.close(); process.exit(); }));
