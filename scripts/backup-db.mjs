#!/usr/bin/env node
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const src = path.join(dir, 'korvex.db');
const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
let dst = path.join(dir, `korvex.db.bak_${ts}`);
for (let n = 2; fs.existsSync(dst); n++) dst = path.join(dir, `korvex.db.bak_${ts}_${n}`);
const db = new Database(src, { readonly: true, fileMustExist: true });
await db.backup(dst);
db.close();
fs.chmodSync(dst, 0o600);
console.log('backup:', path.basename(dst), fs.statSync(dst).size, 'bytes');
