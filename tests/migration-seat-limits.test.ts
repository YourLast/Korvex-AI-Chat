import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { tmpData } from './helpers';

const cols = (db: Database.Database, t: string) => (db.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((r) => r.name);
const tables = (db: Database.Database) => (db.prepare(`select name from sqlite_master where type = 'table'`).all() as { name: string }[]).map((r) => r.name);

describe('миграция 0026', () => {
  it('накат: колонки и таблицы, множитель 1 у всех; откат; накат снова', () => {
    const dir = tmpData();
    const mig = path.join(process.cwd(), 'drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(mig, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };
    const w = Object.fromEntries(journal.entries.map((e) => [e.tag, e.when]));
    expect(w['0026_seat_limits']).toBeGreaterThan(w['0025_memory_v2']);
    const before = journal.entries.filter((e) => e.tag < '0026');
    const tmpMig = path.join(dir, 'mig');
    fs.mkdirSync(path.join(tmpMig, 'meta'), { recursive: true });
    for (const e of before) fs.copyFileSync(path.join(mig, `${e.tag}.sql`), path.join(tmpMig, `${e.tag}.sql`));
    fs.writeFileSync(path.join(tmpMig, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: before }));
    const db = new Database(path.join(dir, 'k.db'));
    db.pragma('foreign_keys = ON');
    migrate(drizzle(db), { migrationsFolder: tmpMig });
    db.prepare(`insert into users (id, email, name, password_hash, created_at) values ('u', 'u@t', 'U', 'x', 1)`).run();
    migrate(drizzle(db), { migrationsFolder: mig });
    expect(cols(db, 'users')).toEqual(expect.arrayContaining(['week_mult', 'week_reset_at', 'seat_reset_at']));
    expect(cols(db, 'jobs')).toContain('card_s');
    expect(tables(db)).toEqual(expect.arrayContaining(['seat_signals', 'seat_events', 'seat_strikes', 'user_notices']));
    expect(db.prepare(`select week_mult m, week_reset_at r from users`).get()).toEqual({ m: 1, r: null });
    db.prepare(`insert into seat_events (id, user_id, day, kind, at) values ('e', 'u', '2026-11-01', 'switch', 1)`).run();
    db.prepare(`delete from users where id = 'u'`).run();
    expect(db.prepare(`select count(*) c from seat_events`).get()).toEqual({ c: 0 });
    db.exec(fs.readFileSync(path.join(mig, 'rollback', '0026_seat_limits.down.sql'), 'utf8'));
    expect(cols(db, 'users')).not.toContain('week_mult');
    expect(cols(db, 'jobs')).not.toContain('card_s');
    expect(tables(db)).not.toContain('seat_signals');
  });
});
