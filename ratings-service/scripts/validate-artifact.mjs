import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerPath = resolve(projectRoot, "dist/server/index.js");
const manifestPath = resolve(projectRoot, "dist/.openai/hosting.json");

const [source, manifest] = await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(manifestPath, "utf8"),
]);
assert.equal(JSON.parse(manifest).d1, 'DB', 'A durable DB binding is required.');

// A data URL forces ESM parsing even though the generated output has no package.json.
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const workerModule = await import(moduleUrl);
assert.equal(
  typeof workerModule.default?.fetch,
  "function",
  `${pathToFileURL(workerPath)} must export default.fetch`,
);

const migrationRoot = resolve(projectRoot, 'dist/.openai/drizzle');
const journal = JSON.parse(await readFile(resolve(migrationRoot, 'meta/_journal.json'), 'utf8'));
assert.equal(journal.dialect, 'sqlite');
assert.ok(journal.entries.length > 0, 'The published artifact needs a migration journal.');
const files = await readdir(migrationRoot);
for (const entry of journal.entries) {
  assert.ok(files.includes(`${entry.tag}.sql`), `Missing migration ${entry.tag}.sql`);
  const sql = await readFile(resolve(migrationRoot, `${entry.tag}.sql`), 'utf8');
  assert.ok(!/\b(?:INSERT|UPDATE|DELETE)\s/i.test(sql), 'Deploy migrations must be schema-only.');
}

const res = await workerModule.default.fetch(new Request('https://example.invalid/'));
assert.equal(res.status, 200);
assert.equal((await res.json()).service, 'Harshith photo ratings');

console.log("Artifact is valid ESM with a DB binding and complete schema-only migrations");
