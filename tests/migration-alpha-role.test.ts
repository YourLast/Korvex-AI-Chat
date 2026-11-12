import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { tmpData } from './helpers';

describe('миграция роли «Альфа»', () => {
  it('накат: alpha тем, кто пользуется агентами; журнал; откат с бэкапом; накат снова', () => {
    const dir = tmpData();
    const file = path.join(dir, 'korvex.db');
    const migrations = path.join(process.cwd(), 'drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };
    const w = Object.fromEntries(journal.entries.map((e) => [e.tag, e.when]));
    expect(w['0023_alpha_role']).toBeGreaterThan(w['0022_serve_forget']);
    expect(Math.max(...journal.entries.map((e) => e.when))).toBeGreaterThanOrEqual(w['0023_alpha_role']);
    const before = journal.entries.filter((e) => e.tag < '0023');
    const tmpMig = path.join(dir, 'mig');
    fs.mkdirSync(path.join(tmpMig, 'meta'), { recursive: true });
    for (const e of before) fs.copyFileSync(path.join(migrations, `${e.tag}.sql`), path.join(tmpMig, `${e.tag}.sql`));
    fs.writeFileSync(path.join(tmpMig, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: before }));
    let db = new Database(file);
    migrate(drizzle(db), { migrationsFolder: tmpMig });
    const u = db.prepare(`insert into users (id, email, name, password_hash, role, disabled, created_at) values (?, ?, ?, 'x', ?, ?, 1)`);
    u.run('adm', 'adm@t', 'Админ', 'admin', 0); u.run('gh', 'gh@t', 'С GitHub', 'user', 0); u.run('auto', 'auto@t', 'С автоматизацией', 'user', 0);
    u.run('code', 'code@t', 'С кодом', 'user', 0); u.run('off', 'off@t', 'Заблокирован, с GitHub', 'user', 1); u.run('plain', 'plain@t', 'Просто чат', 'user', 0);
    const t = db.prepare(`insert into threads (id, user_id, title, model_id, effort, created_at, updated_at) values (?, ?, 'Чат', 'alpha', 'low', 1, 1)`);
    for (const x of ['adm', 'auto', 'code', 'plain']) t.run(`t-${x}`, x);
    const gh = db.prepare(`insert into github_accounts (user_id, login, token_enc, created_at, checked_at) values (?, ?, 'x', 1, 1)`);
    gh.run('adm', 'a'); gh.run('gh', 'g'); gh.run('off', 'o');
    db.prepare(`insert into automations (id, user_id, name, prompt, model_id, level_id, cron, timezone, target_thread_id, created_at) values ('a1', 'auto', 'Сводка', 'p', 'alpha', 'low', '0 9 * * *', 'UTC', 't-auto', 1)`).run();
    db.prepare(`insert into code_sessions (thread_id, user_id, repo, base_branch, created_at, updated_at) values ('t-code', 'code', 'o/r', 'main', 1, 1)`).run();
    db.prepare(`insert into invites (id, token_hash, role, note, created_by, expires_at, created_at) values ('inv', 'h', 'user', '', 'adm', 9e15, 1)`).run();
    db.close();

    const open = () => { const s = new Database(file); s.pragma('foreign_keys = ON'); migrate(drizzle(s), { migrationsFolder: migrations }); return s; };
    const roles = (s: Database.Database) => Object.fromEntries((s.prepare(`select id, role from users`).all() as { id: string; role: string }[]).map((r) => [r.id, r.role]));
    db = open();
    expect(roles(db)).toEqual({ adm: 'admin', gh: 'alpha', auto: 'alpha', code: 'alpha', off: 'alpha', plain: 'user' });
    const audit = db.prepare(`select admin_id, action, target_id, target_name, detail, at from admin_audit order by target_id`).all() as { admin_id: string; action: string; target_id: string; target_name: string; detail: string; at: number }[];
    expect(audit.map((a) => a.target_id)).toEqual(['auto', 'code', 'gh', 'off']);
    expect(audit.every((a) => a.admin_id === 'system' && a.action === 'role' && a.detail.startsWith('Пользователь → Альфа') && a.at > 1.7e12)).toBe(true);
    db.prepare(`update invites set role = 'alpha' where id = 'inv'`).run();
    db.prepare(`update users set role = 'alpha' where id = 'plain'`).run();
    db.close();

    execFileSync(process.execPath, ['scripts/db-rollback.mjs', '0023_alpha_role'], { env: { ...process.env, DATA_DIR: dir }, stdio: 'pipe' });
    db = new Database(file);
    expect(roles(db)).toEqual({ adm: 'admin', gh: 'user', auto: 'user', code: 'user', off: 'user', plain: 'user' });
    expect((db.prepare(`select role from invites`).get() as { role: string }).role).toBe('user');
    expect((db.prepare(`select count(*) c from admin_audit`).get() as { c: number }).c).toBe(0);
    expect((db.prepare(`select count(*) c from github_accounts`).get() as { c: number }).c).toBe(3);
    expect((db.prepare(`select count(*) c from automations`).get() as { c: number }).c).toBe(1);
    db.close();
    expect(fs.readdirSync(dir).some((f) => f.startsWith('korvex.db.bak_'))).toBe(true);

    db = open();
    expect(roles(db)).toEqual({ adm: 'admin', gh: 'alpha', auto: 'alpha', code: 'alpha', off: 'alpha', plain: 'user' });
    db.close();
  });
});
