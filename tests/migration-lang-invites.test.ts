import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { tmpData } from './helpers';

const cols = (db: Database.Database, t: string) => (db.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((r) => r.name);

describe('миграция языка и групповых приглашений', () => {
  it('накат на БД со старыми приглашениями, откат с бэкапом, накат снова', () => {
    const dir = tmpData();
    const file = path.join(dir, 'korvex.db');
    const migrations = path.join(process.cwd(), 'drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };
    const w = Object.fromEntries(journal.entries.map((e) => [e.tag, e.when]));
    expect(w['0020_lang_invite_uses']).toBeGreaterThan(w['0019_admin_views']);
    expect(Math.max(...journal.entries.map((e) => e.when))).toBeGreaterThanOrEqual(w['0020_lang_invite_uses']);
    const before = journal.entries.filter((e) => e.tag < '0020');
    const tmpMig = path.join(dir, 'mig');
    fs.mkdirSync(path.join(tmpMig, 'meta'), { recursive: true });
    for (const e of before) fs.copyFileSync(path.join(migrations, `${e.tag}.sql`), path.join(tmpMig, `${e.tag}.sql`));
    fs.writeFileSync(path.join(tmpMig, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: before }));
    let db = new Database(file);
    migrate(drizzle(db), { migrationsFolder: tmpMig });
    expect(cols(db, 'users')).not.toContain('lang');
    db.prepare(`insert into users (id, email, name, password_hash, role, created_at) values ('a', 'a@t', 'Админ', 'x', 'admin', 1), ('u', 'u@t', 'Анна', 'x', 'user', 1)`).run();
    db.prepare(`insert into invites (id, token_hash, role, note, created_by, expires_at, used_by, used_at, created_at) values ('i1', 'h1', 'user', 'Анна', 'a', 9e12, 'u', 5, 1)`).run();
    db.prepare(`insert into invites (id, token_hash, role, note, created_by, expires_at, created_at) values ('i2', 'h2', 'user', 'свободная', 'a', 9e12, 1)`).run();
    db.close();

    const open = () => { const s = new Database(file); s.pragma('foreign_keys = ON'); migrate(drizzle(s), { migrationsFolder: migrations }); return s; };
    db = open();
    expect(cols(db, 'users')).toContain('lang');
    expect(cols(db, 'invites')).toEqual(expect.arrayContaining(['max_uses', 'uses', 'revoked_at']));
    expect((db.prepare(`select lang from users order by id`).all() as { lang: string }[]).map((r) => r.lang)).toEqual(['ru', 'ru']);
    const inv = db.prepare(`select id, max_uses m, uses u from invites order by id`).all() as { id: string; m: number; u: number }[];
    expect(inv).toEqual([{ id: 'i1', m: 1, u: 1 }, { id: 'i2', m: 1, u: 0 }]);
    expect(db.prepare(`select invite_id, user_id, name from invite_uses`).all()).toEqual([{ invite_id: 'i1', user_id: 'u', name: 'Анна' }]);
    db.close();

    execFileSync(process.execPath, ['scripts/db-rollback.mjs', '0020_lang_invite_uses'], { env: { ...process.env, DATA_DIR: dir }, stdio: 'pipe' });
    db = new Database(file);
    expect(cols(db, 'users')).not.toContain('lang');
    expect(cols(db, 'invites')).not.toContain('uses');
    expect((db.prepare(`select name from sqlite_master where type = 'table'`).all() as { name: string }[]).map((r) => r.name)).not.toContain('invite_uses');
    expect((db.prepare(`select count(*) c from invites`).get() as { c: number }).c).toBe(2);
    db.close();
    expect(fs.readdirSync(dir).some((f) => f.startsWith('korvex.db.bak_'))).toBe(true);

    db = open();
    expect(cols(db, 'users')).toContain('lang');
    db.close();
  });
});
