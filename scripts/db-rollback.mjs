#!/usr/bin/env node
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
const tag = process.argv[2];
if (!tag) { console.error('укажите тег миграции, например 0011_titles_search'); process.exit(2); }
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const journal = JSON.parse(fs.readFileSync(path.join(root, 'drizzle', 'meta', '_journal.json'), 'utf8'));
const entry = journal.entries.find((e) => e.tag === tag);
if (!entry) { console.error('нет такой миграции:', tag); process.exit(2); }
const dir = process.env.DATA_DIR || path.join(root, 'data');
const file = process.env.DATABASE_PATH || path.join(dir, 'korvex.db');
const db = new Database(file, { fileMustExist: true });
const applied = new Set(db.prepare('SELECT created_at FROM __drizzle_migrations').all().map((r) => Number(r.created_at)));
const todo = journal.entries.filter((e) => e.when >= entry.when && applied.has(e.when)).sort((a, b) => b.when - a.when);
if (!todo.length) { console.error('миграция не применена:', tag); process.exit(2); }
const downOf = (t) => path.join(root, 'drizzle', 'rollback', `${t}.down.sql`);
const missing = todo.filter((e) => !fs.existsSync(downOf(e.tag)));
if (missing.length) { console.error('нет файла отката:', missing.map((e) => e.tag).join(', ')); process.exit(2); }
const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
let bak = `${file}.bak_${ts}_rollback_${tag}`;
for (let n = 2; fs.existsSync(bak); n++) bak = `${file}.bak_${ts}_rollback_${tag}_${n}`;
await db.backup(bak);
fs.chmodSync(bak, 0o600);
console.log('backup:', path.basename(bak));
db.pragma('foreign_keys = OFF');
db.transaction(() => {
  for (const e of todo) {
    db.exec(fs.readFileSync(downOf(e.tag), 'utf8'));
    const r = db.prepare('DELETE FROM __drizzle_migrations WHERE created_at = ?').run(e.when);
    console.log('откат', e.tag, '— записей миграции удалено:', r.changes);
  }
})();
db.close();
