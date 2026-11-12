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
const n = (db: Database.Database, sql: string) => (db.prepare(sql).get() as { c: number }).c;

describe('миграция поиска и названий', () => {
  it('накат на БД с чатами → очередь индекса; откат с бэкапом → накат снова', () => {
    const dir = tmpData();
    const file = path.join(dir, 'korvex.db');
    const migrations = path.join(process.cwd(), 'drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };
    const before = journal.entries.filter((e) => e.tag < '0011');
    const tmpMig = path.join(dir, 'mig');
    fs.mkdirSync(path.join(tmpMig, 'meta'), { recursive: true });
    for (const e of before) fs.copyFileSync(path.join(migrations, `${e.tag}.sql`), path.join(tmpMig, `${e.tag}.sql`));
    fs.writeFileSync(path.join(tmpMig, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: before }));
    let db = new Database(file);
    migrate(drizzle(db), { migrationsFolder: tmpMig });
    db.prepare(`insert into users (id, email, name, password_hash, role, created_at) values ('u', 'u@t', 'U', 'x', 'user', 1)`).run();
    db.prepare(`insert into threads (id, user_id, title, model_id, effort, created_at, updated_at) values ('t', 'u', 'Мой чат', 'alpha', 'off', 1, 1)`).run();
    db.prepare(`insert into messages (id, thread_id, seq, parent_id, role, content, created_at) values ('q', 't', 1, null, 'user', 'вопрос', 1), ('a', 't', 2, 'q', 'assistant', 'ответ', 1)`).run();
    db.prepare(`insert into files (id, user_id, thread_id, name, size, sha256, created_at) values ('f', 'u', 't', 'отчёт.xlsx', 1, 'x', 1)`).run();
    db.close();

    const open = () => { const s = new Database(file); migrate(drizzle(s), { migrationsFolder: migrations }); return s; };
    db = open();
    expect(cols(db, 'threads')).toEqual(expect.arrayContaining(['title_manual', 'title_gen']));
    expect(names(db, 'table')).toEqual(expect.arrayContaining(['search_docs', 'search_dirty', 'search_meta', 'search_fts']));
    expect(names(db, 'trigger')).toHaveLength(9);
    expect(n(db, 'select count(*) c from search_dirty')).toBe(4);
    db.prepare(`update threads set title = 'Название от модели', title_gen = 1 where id = 't'`).run();
    db.close();

    const baks = () => fs.readdirSync(dir).filter((f) => f.startsWith('korvex.db.bak_')).length;
    const b0 = baks();
    execFileSync(process.execPath, ['scripts/db-rollback.mjs', '0011_titles_search'], { env: { ...process.env, DATA_DIR: dir }, stdio: 'pipe' });
    expect(baks()).toBe(b0 + 1);
    db = new Database(file);
    expect(cols(db, 'threads')).not.toContain('title_manual');
    expect(names(db, 'table').filter((x) => x.startsWith('search'))).toEqual([]);
    expect(names(db, 'trigger')).toEqual([]);
    expect((db.prepare(`select title from threads where id = 't'`).get() as { title: string }).title).toBe('Название от модели');
    expect(n(db, 'select count(*) c from messages')).toBe(2);
    expect(n(db, 'select count(*) c from files')).toBe(1);
    db.close();

    db = open();
    expect(cols(db, 'threads')).toContain('title_gen');
    expect(n(db, 'select count(*) c from search_dirty')).toBe(4);
    db.close();

    const prev = before.at(-1)!.tag;
    if (fs.existsSync(path.join(migrations, 'rollback', `${prev}.down.sql`))) {
      execFileSync(process.execPath, ['scripts/db-rollback.mjs', prev], { env: { ...process.env, DATA_DIR: dir }, stdio: 'pipe' });
      db = new Database(file);
      expect(cols(db, 'threads')).not.toContain('title_gen');
      db.close();
      db = open();
      expect(cols(db, 'threads')).toContain('title_gen');
      db.close();
    }
  });
});
