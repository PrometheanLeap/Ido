import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, sql } from 'kysely';
import type { DB } from './adapter.js';
import { config } from '../config.js';
import { runMigrations } from './migrate.js';

let db: Kysely<DB>;

export function getDb(): Kysely<DB> {
  if (db) return db;

  const dbPath = config.sqlitePath;
  const sqliteDb = new Database(dbPath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');

  db = new Kysely<DB>({
    dialect: new SqliteDialect({ database: sqliteDb }),
  });

  return db;
}

export async function initDatabase(): Promise<Kysely<DB>> {
  const database = getDb();
  await runMigrations(database);
  return database;
}
