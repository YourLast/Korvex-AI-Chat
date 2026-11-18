#!/usr/bin/env node
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const UNLIMITED_USES = 1_000_000_000;
const FOREVER_AT = 253_402_300_799_000;
const NOTE_ALL = 'Общая ссылка (локальная сеть)';
const NOTE_ADMIN = 'Админ (установка)';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const flag = (k) => args.includes(k);
const base = (arg('--base', '') || '').replace(/\/+$/, '');
const admin = (arg('--admin', '') || '').trim().toLowerCase();
const out = arg('--out', '');
const adminDays = Math.max(1, Math.min(365, Number(arg('--admin-days', '30')) || 30));
const rotate = flag('--rotate');
if (!/^https?:\/\/[^\s/]+/.test(base) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(admin) || !out) {
  console.error('нужно: --base http(s)://адрес --admin почта --out файл [--rotate] [--admin-days N]');
  process.exit(2);
}
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
for (const k of ['DATA_DIR', 'DATABASE_PATH']) {
  if (process.env[k] && !path.isAbsolute(process.env[k])) { console.error(`${k} — только абсолютный путь (сейчас: ${process.env[k]}); проще: webctl.sh setup …`); process.exit(2); }
}
const dir = process.env.DATA_DIR || path.join(root, 'data');
const file = process.env.DATABASE_PATH || path.join(dir, 'korvex.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
const sqlite = new Database(file);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');
migrate(drizzle(sqlite), { migrationsFolder: path.join(root, 'drizzle') });

const sha = (s) => createHash('sha256').update(s).digest('hex');
const now = Date.now();
const token = () => randomBytes(24).toString('base64url');

const res = sqlite.transaction(() => {
  let a = sqlite.prepare('select id, role, source, password_hash as ph from users where email = ?').get(admin);
  if (!a) {
    const any = sqlite.prepare('select count(*) c from users').get().c;
    if (any > 0) throw new Error('в БД уже есть люди, а такого админа нет: установка только на пустую БД (или укажите почту существующего админа)');
    const id = randomUUID();
    sqlite.prepare(`insert into users (id, email, name, password_hash, role, source, created_at) values (?, ?, ?, '', 'admin', 'setup', ?)`).run(id, admin, 'Администратор', now);
    a = { id, role: 'admin', source: 'setup', ph: '' };
  }
  if (a.role !== 'admin') throw new Error('эта почта есть в БД, но не админ');
  const live = (note) => sqlite.prepare('select id from invites where created_by = ? and note = ? and revoked_at is null and uses < max_uses and expires_at > ?').all(a.id, note, now);
  if (rotate) {
    sqlite.prepare('update invites set revoked_at = ? where created_by = ? and note in (?, ?) and revoked_at is null').run(now, a.id, NOTE_ALL, NOTE_ADMIN);
  }
  const ins = sqlite.prepare('insert into invites (id, token_hash, role, note, created_by, expires_at, max_uses, uses, created_at, email) values (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)');
  const made = {};
  if (!live(NOTE_ALL).length) {
    const t = token();
    ins.run(randomUUID(), sha(t), 'user', NOTE_ALL, a.id, FOREVER_AT, UNLIMITED_USES, now, null);
    made.all = t;
  }
  if (a.source === 'setup' && !a.ph && !live(NOTE_ADMIN).length) {
    const t = token();
    ins.run(randomUUID(), sha(t), 'admin', NOTE_ADMIN, a.id, now + adminDays * 864e5, 1, now, admin);
    made.admin = t;
  }
  return made;
})();
sqlite.close();

if (!res.all && !res.admin) {
  console.log('ссылки уже есть и действуют — новых нет (сделать новые и отозвать прежние: --rotate)');
  process.exit(0);
}
const lines = [`# Korvex, локальная сеть — ${new Date(now).toISOString()}. Файл не пересылать в чаты.`];
if (res.admin) lines.push(`admin (${admin}, одноразовая, ${adminDays} дн.): ${base}/invite/${res.admin}`);
if (res.all) lines.push(`all (бессрочная, без лимита людей): ${base}/invite/${res.all}`);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const prev = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trimEnd() + '\n' : '';
fs.writeFileSync(out, prev + lines.join('\n') + '\n', { mode: 0o600 });
fs.chmodSync(out, 0o600);
console.log(`ссылки записаны в ${path.resolve(out)} (${[res.admin && 'админская', res.all && 'общая'].filter(Boolean).join(' и ')}); в вывод они не попадают`);
