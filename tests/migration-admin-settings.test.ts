import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { tmpData } from './helpers';

const tables = (db: Database.Database) => (db.prepare(`select name from sqlite_master where type = 'table'`).all() as { name: string }[]).map((r) => r.name);

describe('миграции настроек администратора и провайдеров', () => {
  it('накат → данные → откат 0029 и 0028 с бэкапом → накат снова', () => {
    const dir = tmpData();
    const file = path.join(dir, 'korvex.db');
    const migrations = path.join(process.cwd(), 'drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };
    const w = Object.fromEntries(journal.entries.map((e) => [e.tag, e.when]));
    expect(w['0028_settings']).toBeGreaterThan(w['0027_deploy_owner']);
    expect(w['0029_providers']).toBeGreaterThan(w['0028_settings']);

    const open = () => { const s = new Database(file); s.pragma('foreign_keys = ON'); migrate(drizzle(s), { migrationsFolder: migrations }); return s; };
    let db = open();
    expect(tables(db)).toEqual(expect.arrayContaining(['settings', 'providers', 'admin_models']));
    db.prepare(`insert into users (id, email, name, password_hash, role, disabled, created_at) values ('a', 'a@t', 'Админ', 'x', 'admin', 0, 1)`).run();
    db.prepare(`insert into settings (key, value, updated_at) values ('feature.voice', 'false', 1)`).run();
    db.prepare(`insert into providers (id, name, kind, created_at, updated_at) values ('p', 'P', 'openai', 1, 1)`).run();
    db.prepare(`insert into admin_models (id, provider_id, upstream_model, name, levels, default_level, created_at, updated_at) values ('m', 'p', 'gpt', 'M', '[]', 'off', 1, 1)`).run();
    db.prepare(`delete from providers where id = 'p'`).run();
    expect((db.prepare(`select count(*) c from admin_models`).get() as { c: number }).c).toBe(0);
    db.close();

    const rollback = (tag: string) => execFileSync(process.execPath, ['scripts/db-rollback.mjs', tag], { env: { ...process.env, DATA_DIR: dir }, stdio: 'pipe' });
    rollback('0029_providers');
    db = new Database(file);
    expect(tables(db)).not.toEqual(expect.arrayContaining(['providers']));
    expect(tables(db)).toContain('settings');
    db.close();
    rollback('0028_settings');
    db = new Database(file);
    expect(tables(db)).not.toContain('settings');
    expect((db.prepare(`select count(*) c from users`).get() as { c: number }).c).toBe(1);
    db.close();
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('korvex.db.bak_')).length).toBeGreaterThanOrEqual(2);

    db = open();
    expect(tables(db)).toEqual(expect.arrayContaining(['settings', 'providers', 'admin_models']));
    db.close();
  });
});
