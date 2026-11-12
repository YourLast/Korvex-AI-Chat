import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { tmpData } from './helpers';

const names = (db: Database.Database, type: string) => (db.prepare(`select name from sqlite_master where type = ?`).all(type) as { name: string }[]).map((r) => r.name);

describe('миграция журнала просмотров администратора', () => {
  it('накат на БД с чатами, откат с бэкапом, накат снова; записи журнала переживают удаление человека', () => {
    const dir = tmpData();
    const file = path.join(dir, 'korvex.db');
    const migrations = path.join(process.cwd(), 'drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };
    const w = Object.fromEntries(journal.entries.map((e) => [e.tag, e.when]));
    expect(w['0019_admin_views']).toBeGreaterThan(w['0018_folder_color']);
    expect(Math.max(...journal.entries.map((e) => e.when))).toBeGreaterThanOrEqual(w['0019_admin_views']);
    const before = journal.entries.filter((e) => e.tag < '0019');
    const tmpMig = path.join(dir, 'mig');
    fs.mkdirSync(path.join(tmpMig, 'meta'), { recursive: true });
    for (const e of before) fs.copyFileSync(path.join(migrations, `${e.tag}.sql`), path.join(tmpMig, `${e.tag}.sql`));
    fs.writeFileSync(path.join(tmpMig, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: before }));
    let db = new Database(file);
    migrate(drizzle(db), { migrationsFolder: tmpMig });
    expect(names(db, 'table')).not.toContain('admin_views');
    db.prepare(`insert into users (id, email, name, password_hash, role, created_at) values ('u', 'u@t', 'U', 'x', 'user', 1)`).run();
    db.prepare(`insert into threads (id, user_id, title, model_id, effort, created_at, updated_at) values ('t', 'u', 'Склад', 'alpha', 'off', 1, 1)`).run();
    db.prepare(`insert into messages (id, thread_id, seq, parent_id, role, content, created_at) values ('q', 't', 1, null, 'user', 'вопрос', 1)`).run();
    db.close();

    const open = () => { const s = new Database(file); s.pragma('foreign_keys = ON'); migrate(drizzle(s), { migrationsFolder: migrations }); return s; };
    db = open();
    expect(names(db, 'table')).toContain('admin_views');
    expect(names(db, 'index')).toEqual(expect.arrayContaining(['admin_views_time_idx', 'admin_views_owner_idx']));
    expect((db.prepare(`select count(*) c from messages`).get() as { c: number }).c).toBe(1);
    db.prepare(`insert into admin_views (id, admin_id, owner_id, kind, target, thread_id, created_at) values ('v', 'adm', 'u', 'chat', 't', 't', 5)`).run();
    db.prepare(`delete from users where id = 'u'`).run();
    expect((db.prepare(`select count(*) c from threads`).get() as { c: number }).c).toBe(0);
    expect((db.prepare(`select count(*) c from admin_views`).get() as { c: number }).c).toBe(1);
    db.close();

    execFileSync(process.execPath, ['scripts/db-rollback.mjs', '0019_admin_views'], { env: { ...process.env, DATA_DIR: dir }, stdio: 'pipe' });
    db = new Database(file);
    expect(names(db, 'table')).not.toContain('admin_views');
    expect(names(db, 'table')).toEqual(expect.arrayContaining(['users', 'threads', 'messages', 'folders']));
    db.close();
    expect(fs.readdirSync(dir).some((f) => f.startsWith('korvex.db.bak_'))).toBe(true);

    db = open();
    expect(names(db, 'table')).toContain('admin_views');
    db.close();
  });
});
