import { Kysely, sql } from 'kysely';
import type { DB } from './adapter.js';
import { migration001 } from './migrations/001_initial.js';

const migrations: Record<string, string> = {
  '001_initial': migration001,
};

export async function runMigrations(db: Kysely<DB>): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`.execute(db);

  for (const [name, sql_content] of Object.entries(migrations)) {
    const existing = await db
      .selectFrom('schema_migrations')
      .where('name', '=', name)
      .selectAll()
      .executeTakeFirst();

    if (existing) continue;

    console.log(`Running migration: ${name}`);

    const statements = sql_content
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
      try {
        await sql.raw(stmt + ';').execute(db);
      } catch (err) {
        console.error(`Migration ${name} failed on statement:`, stmt.substring(0, 100));
        throw err;
      }
    }

    await db
      .insertInto('schema_migrations')
      .values({ name, applied_at: new Date().toISOString() })
      .execute();

    console.log(`Migration ${name} applied`);
  }
}
