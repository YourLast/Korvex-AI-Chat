import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { tmpData } from './helpers';

const cols = (db: Database.Database, t: string) => (db.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((r) => r.name);
const tables = (db: Database.Database) => (db.prepare(`select name from sqlite_master where type = 'table'`).all() as { name: string }[]).map((r) => r.name);

describe('миграция блокировки людей и журнала', () => {
  it('накат: закрытый доступ -> пауза, новые колонки и журнал; откат с бэкапом; накат снова', () => {
    const dir = tmpData();
    const file = path.join(dir, 'korvex.db');
    const migrations = path.join(process.cwd(), 'drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };
    const w = Object.fromEntries(journal.entries.map((e) => [e.tag, e.when]));
    expect(w['0021_moderation']).toBeGreaterThan(w['0020_lang_invite_uses']);
    const before = journal.entries.filter((e) => e.tag < '0021');
    const tmpMig = path.join(dir, 'mig');
    fs.mkdirSync(path.join(tmpMig, 'meta'), { recursive: true });
    for (const e of before) fs.copyFileSync(path.join(migrations, `${e.tag}.sql`), path.join(tmpMig, `${e.tag}.sql`));
    fs.writeFileSync(path.join(tmpMig, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: before }));
    let db = new Database(file);
    migrate(drizzle(db), { migrationsFolder: tmpMig });
    expect(cols(db, 'users')).not.toContain('block_kind');
    db.prepare(`insert into users (id, email, name, password_hash, role, disabled, created_at) values ('a', 'a@t', 'Админ', 'x', 'admin', 0, 1), ('u', 'u@t', 'Анна', 'x', 'user', 1, 1), ('v', 'v@t', 'Вера', 'x', 'user', 0, 1)`).run();
    db.close();

    const open = () => { const s = new Database(file); s.pragma('foreign_keys = ON'); migrate(drizzle(s), { migrationsFolder: migrations }); return s; };
    db = open();
    expect(cols(db, 'users')).toEqual(expect.arrayContaining(['block_kind', 'block_reason', 'blocked_at', 'blocked_by', 'source']));
    expect(tables(db)).toContain('admin_audit');
    expect(db.prepare(`select id, disabled, block_kind k, source from users order by id`).all()).toEqual([
      { id: 'a', disabled: 0, k: '', source: '' }, { id: 'u', disabled: 1, k: 'pause', source: '' }, { id: 'v', disabled: 0, k: '', source: '' }]);
    db.prepare(`insert into admin_audit (id, at, admin_id, action) values ('x', 1, 'a', 'ban')`).run();
    db.close();

    execFileSync(process.execPath, ['scripts/db-rollback.mjs', '0021_moderation'], { env: { ...process.env, DATA_DIR: dir }, stdio: 'pipe' });
    db = new Database(file);
    expect(cols(db, 'users')).not.toContain('block_kind');
    expect(cols(db, 'users')).not.toContain('source');
    expect(tables(db)).not.toContain('admin_audit');
    expect((db.prepare(`select disabled from users where id = 'u'`).get() as { disabled: number }).disabled).toBe(1);
    db.close();
    expect(fs.readdirSync(dir).some((f) => f.startsWith('korvex.db.bak_'))).toBe(true);

    db = open();
    expect(cols(db, 'users')).toContain('block_kind');
    db.close();
  });
});
