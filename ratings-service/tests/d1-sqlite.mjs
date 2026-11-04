import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// Execute real generated SQL and real Worker queries. This adapter supplies only
// the small D1 binding interface; SQLite, constraints and transactions are real.
export function createDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  const migrations = new URL('../drizzle/', import.meta.url);
  for (const filename of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(filename, migrations), 'utf8'));
  }
  let failNextVote = false;
  function prepare(sql, values = []) {
    return {
      bind(...bindings) { return prepare(sql, bindings); },
      async all() { return this.execute(); },
      async run() { return this.execute(); },
      execute() {
        if (failNextVote && sql.startsWith('INSERT INTO photo_votes')) {
          failNextVote = false;
          throw new Error('Simulated write failure contains private SQL and IP details.');
        }
        const results = sqlite.prepare(sql).all(...values).map(row => ({ ...row }));
        return { success: true, results };
      },
    };
  }
  return {
    sqlite,
    prepare,
    failNextVote() { failNextVote = true; },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
