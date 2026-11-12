import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { tmpData } from './helpers';

const cols = (db: Database.Database, t: string) => (db.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
const names = (db: Database.Database, type: string) => (db.prepare(`select name from sqlite_master where type = ?`).all(type) as { name: string }[]).map((r) => r.name);

describe('миграции папок и переписки агентов', () => {
  it('накат на БД с чатами → папки, set null; откат с бэкапом → накат снова', () => {
    const dir = tmpData();
    const file = path.join(dir, 'korvex.db');
    const migrations = path.join(process.cwd(), 'drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };
    const w = Object.fromEntries(journal.entries.map((e) => [e.tag, e.when]));
    expect(w['0013_folders']).toBeGreaterThan(w['0012_out_files']);
    expect(w['0014_agent_msgs']).toBeGreaterThan(w['0013_folders']);
    const before = journal.entries.filter((e) => e.tag < '0013');
    const tmpMig = path.join(dir, 'mig');
    fs.mkdirSync(path.join(tmpMig, 'meta'), { recursive: true });
    for (const e of before) fs.copyFileSync(path.join(migrations, `${e.tag}.sql`), path.join(tmpMig, `${e.tag}.sql`));
    fs.writeFileSync(path.join(tmpMig, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: before }));
    let db = new Database(file);
    migrate(drizzle(db), { migrationsFolder: tmpMig });
    db.prepare(`insert into users (id, email, name, password_hash, role, created_at) values ('u', 'u@t', 'U', 'x', 'user', 1)`).run();
    db.prepare(`insert into threads (id, user_id, title, model_id, effort, created_at, updated_at) values ('t', 'u', 'Склад', 'alpha', 'off', 1, 1)`).run();
    db.prepare(`insert into messages (id, thread_id, seq, parent_id, role, content, created_at) values ('q', 't', 1, null, 'user', 'вопрос', 1)`).run();
    db.close();

    const open = () => { const s = new Database(file); s.pragma('foreign_keys = ON'); migrate(drizzle(s), { migrationsFolder: migrations }); return s; };
    db = open();
    expect(cols(db, 'threads')).toContain('folder_id');
    expect(names(db, 'table')).toEqual(expect.arrayContaining(['folders', 'agent_msgs']));
    expect(names(db, 'trigger').length).toBeGreaterThanOrEqual(9);
    db.prepare(`insert into folders (id, user_id, name, created_at, updated_at) values ('f', 'u', 'Запуск', 1, 1)`).run();
    db.prepare(`update threads set folder_id = 'f' where id = 't'`).run();
    db.prepare(`delete from folders where id = 'f'`).run();
    expect((db.prepare(`select folder_id from threads where id = 't'`).get() as { folder_id: string | null }).folder_id).toBeNull();
    db.prepare(`insert into folders (id, user_id, name, created_at, updated_at) values ('f2', 'u', 'Запуск', 1, 1)`).run();
    db.prepare(`update threads set folder_id = 'f2' where id = 't'`).run();
    db.prepare(`insert into agent_msgs (id, user_id, kind, from_thread, to_thread, question, status, created_at) values ('m', 'u', 'ask', 't', 't2', '?', 'asking', 1)`).run();
    db.close();

    execFileSync(process.execPath, ['scripts/db-rollback.mjs', '0013_folders'], { env: { ...process.env, DATA_DIR: dir }, stdio: 'pipe' });
    db = new Database(file);
    expect(cols(db, 'threads')).not.toContain('folder_id');
    expect(names(db, 'table')).not.toContain('folders');
    expect(names(db, 'table')).not.toContain('agent_msgs');
    expect((db.prepare(`select count(*) c from threads`).get() as { c: number }).c).toBe(1);
    expect((db.prepare(`select count(*) c from messages`).get() as { c: number }).c).toBe(1);
    db.close();

    db = open();
    expect(cols(db, 'threads')).toContain('folder_id');
    expect(names(db, 'table')).toEqual(expect.arrayContaining(['folders', 'agent_msgs']));
    db.close();
  });
});
