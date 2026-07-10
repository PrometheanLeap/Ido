import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { DB } from './adapter.js';
import { config } from '../config.js';
import { pgMigration001 } from './pg-migrations.js';

let db: Kysely<DB>;

export async function getDb(): Promise<Kysely<DB>> {
  if (db) return db;

  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.pgPoolMax,
    idleTimeoutMillis: config.pgIdleTimeoutMs,
  });

  db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  });

  // Run PostgreSQL-compatible migration
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )`.execute(db);

  const existing = await db.selectFrom('schema_migrations')
    .where('name', '=', 'pg_001_init')
    .selectAll().executeTakeFirst();

  if (!existing) {
    console.log('Running PostgreSQL migration: pg_001_init');
    // Split and run each statement
    const statements = pgMigration001
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    for (const stmt of statements) {
      await sql.raw(stmt + ';').execute(db);
    }
    await db.insertInto('schema_migrations').values({
      name: 'pg_001_init',
      applied_at: new Date().toISOString(),
    }).execute();
    console.log('PostgreSQL migration complete');
  }

  return db;
}
