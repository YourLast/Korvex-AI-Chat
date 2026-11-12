import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema';

type Db = BetterSQLite3Database<typeof schema>;
const g = globalThis as unknown as { __kxDb?: Db };

export function dataDir(): string {
  // turbopackIgnore: data/ — данные (БД, бэкапы, файлы людей), не код; без пометки сборка читала весь каталог (4,7 ГБ на боевом) — OOM выкатки 12.11
  return process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
}

export function getDb(): Db {
  if (g.__kxDb) return g.__kxDb;
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = process.env.DATABASE_PATH || path.join(dir, 'korvex.db');
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  sqlite.exec('CREATE INDEX IF NOT EXISTS jobs_user_status_idx ON jobs (user_id, status)');
  g.__kxDb = db;
  return db;
}

export { schema };
