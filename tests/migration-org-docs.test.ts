import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { tmpData } from './helpers';

const cols = (db: Database.Database) => (db.prepare(`pragma table_info(files)`).all() as { name: string }[]).map((r) => r.name);

describe('миграция библиотеки документов организации', () => {
  it('накат → данные → откат 0030 с бэкапом → накат снова', () => {
    const dir = tmpData();
    const file = path.join(dir, 'korvex.db');
    const migrations = path.join(process.cwd(), 'drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };
    const w = Object.fromEntries(journal.entries.map((e) => [e.tag, e.when]));
    expect(w['0030_org_docs']).toBeGreaterThan(w['0029_providers']);

    const open = () => { const s = new Database(file); s.pragma('foreign_keys = ON'); migrate(drizzle(s), { migrationsFolder: migrations }); return s; };
    let db = open();
    expect(cols(db)).toEqual(expect.arrayContaining(['folder_id', 'doc_type', 'doc_date', 'doc_from', 'doc_to']));
    db.prepare(`insert into users (id, email, name, password_hash, role, disabled, created_at) values ('u', 'u@t', 'U', 'x', 'user', 0, 1)`).run();
    db.prepare(`insert into folders (id, user_id, name, created_at, updated_at) values ('f', 'u', 'ООО Ромашка', 1, 1)`).run();
    db.prepare(`insert into files (id, user_id, thread_id, name, size, sha256, created_at, folder_id, doc_type, doc_date) values ('x', 'u', null, 'kl_to_1c.txt', 10, 'h', 1, 'f', 'statement', '2026-10-31')`).run();
    db.close();

    execFileSync(process.execPath, ['scripts/db-rollback.mjs', '0030_org_docs'], { env: { ...process.env, DATA_DIR: dir }, stdio: 'pipe' });
    db = new Database(file);
    expect(cols(db)).not.toContain('folder_id');
    expect((db.prepare(`select count(*) c from files`).get() as { c: number }).c).toBe(1);
    db.close();
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('korvex.db.bak_')).length).toBeGreaterThanOrEqual(1);

    db = open();
    expect(cols(db)).toContain('folder_id');
    db.close();
  });
});
