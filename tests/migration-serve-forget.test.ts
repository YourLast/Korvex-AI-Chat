import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { tmpData } from './helpers';

const tables = (db: Database.Database) => (db.prepare(`select name from sqlite_master where type = 'table'`).all() as { name: string }[]).map((r) => r.name);

describe('миграция очереди «забыть чат»', () => {
  it('накат: таблица и уникальность; откат с бэкапом (прочие данные целы); накат снова', () => {
    const dir = tmpData();
    const file = path.join(dir, 'korvex.db');
    const migrations = path.join(process.cwd(), 'drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };
    const w = Object.fromEntries(journal.entries.map((e) => [e.tag, e.when]));
    expect(w['0022_serve_forget']).toBeGreaterThan(w['0021_moderation']);
    const before = journal.entries.filter((e) => e.tag < '0022');
    const tmpMig = path.join(dir, 'mig');
    fs.mkdirSync(path.join(tmpMig, 'meta'), { recursive: true });
    for (const e of before) fs.copyFileSync(path.join(migrations, `${e.tag}.sql`), path.join(tmpMig, `${e.tag}.sql`));
    fs.writeFileSync(path.join(tmpMig, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: before }));
    let db = new Database(file);
    migrate(drizzle(db), { migrationsFolder: tmpMig });
    expect(tables(db)).not.toContain('serve_forget');
    db.prepare(`insert into users (id, email, name, password_hash, role, disabled, created_at) values ('a', 'a@t', 'Админ', 'x', 'admin', 0, 1)`).run();
    db.close();

    const open = () => { const s = new Database(file); s.pragma('foreign_keys = ON'); migrate(drizzle(s), { migrationsFolder: migrations }); return s; };
    db = open();
    expect(tables(db)).toContain('serve_forget');
    expect((db.prepare(`select count(*) c from users`).get() as { c: number }).c).toBe(1);
    const ins = db.prepare(`insert into serve_forget (id, chat_id, base_url, created_at, next_at) values (?, ?, ?, 1, 1)`);
    ins.run('1', 'chat', 'http://x/v1'); ins.run('2', 'chat', 'http://y/v1');
    expect(() => ins.run('3', 'chat', 'http://x/v1')).toThrow(/UNIQUE/);
    expect(db.prepare(`select tries, last_error e from serve_forget where id = '1'`).get()).toEqual({ tries: 0, e: '' });
    db.close();

    execFileSync(process.execPath, ['scripts/db-rollback.mjs', '0022_serve_forget'], { env: { ...process.env, DATA_DIR: dir }, stdio: 'pipe' });
    db = new Database(file);
    expect(tables(db)).not.toContain('serve_forget');
    expect((db.prepare(`select count(*) c from users`).get() as { c: number }).c).toBe(1);
    db.close();
    expect(fs.readdirSync(dir).some((f) => f.startsWith('korvex.db.bak_'))).toBe(true);

    db = open();
    expect(tables(db)).toContain('serve_forget');
    db.close();
  });
});
