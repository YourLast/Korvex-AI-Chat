import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { tmpData } from './helpers';

const dir = tmpData();
const OUT = path.join(dir, 'out');
fs.mkdirSync(OUT);
process.env.KX_OUT_DIR = OUT;
const tok = () => randomBytes(16).toString('hex');
function mkTok(at?: number): string {
  const t = tok();
  fs.mkdirSync(path.join(OUT, t));
  fs.writeFileSync(path.join(OUT, t, 'a.png'), 'x');
  if (at) fs.utimesSync(path.join(OUT, t), new Date(at), new Date(at));
  return t;
}

let O: typeof import('@/lib/outfiles');
let db: ReturnType<typeof import('@/lib/db').getDb>, schema: typeof import('@/lib/db').schema;
beforeAll(async () => {
  O = await import('@/lib/outfiles');
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  for (const id of ['a', 'b']) db.insert(schema.users).values({ id, email: `${id}@t`, name: id, passwordHash: 'x', createdAt: 1 }).run();
});

describe('владение файлами модели', () => {
  it('токены из текста: без повторов, только 32 hex после /out/', () => {
    const t1 = tok(), t2 = tok();
    expect(O.tokensIn(`📎 [a](/out/${t1}/a.png) и ![b](/out/${t2}/b.png) снова /out/${t1}/c.png`, null, '/out/short/x')).toEqual([t1, t2]);
  });
  it('правило задачи: новый каталог — записан; старый — нет; занятый — не перезаписан; нет каталога — позже', () => {
    const now = Date.now();
    const fresh = mkTok(), old = mkTok(now - 3_600_000), slack = mkTok(now - 8_000), gone = tok();
    const r = O.claimTokens({ userId: 'a', threadId: null, messageId: 'm1', since: now, tokens: [fresh, old, slack, gone] });
    expect(r).toEqual({ [fresh]: 'claimed', [old]: 'old', [slack]: 'claimed', [gone]: 'missing' });
    expect(O.claimTokens({ userId: 'b', threadId: null, messageId: 'm2', since: now, tokens: [fresh] })).toEqual({ [fresh]: 'taken' });
    expect(O.claimTokens({ userId: 'a', threadId: null, messageId: 'm3', since: now, tokens: [fresh] })).toEqual({ [fresh]: 'mine' });
    expect(O.ownsToken('a', fresh)).toBe(true);
    expect(O.ownsToken('b', fresh)).toBe(false);
    expect(O.ownsToken('a', old)).toBe(false);
    expect(O.ownsToken('a', '../etc')).toBe(false);
  });
  it('символическая ссылка вместо каталога — не файл модели', () => {
    const t = tok();
    fs.symlinkSync(OUT, path.join(OUT, t));
    expect(O.tokenBorn(t)).toBeNull();
    expect(O.claimTokens({ userId: 'a', threadId: null, messageId: null, since: Date.now(), tokens: [t] })).toEqual({ [t]: 'missing' });
  });
  it('поток: ссылка, разрезанная между кусками, записывается, когда дошла целиком; finish — всё остальное', () => {
    const t = mkTok(), t2 = tok();
    const c = new O.OutClaimer({ userId: 'b', threadId: null, messageId: 'm', since: () => Date.now() });
    const link = `текст 📎 [a.png](/out/${t}/a.png) (1 KB)`;
    let text = '';
    for (let i = 0; i < link.length; i += 5) { const o = text.length; text += link.slice(i, i + 5); c.chunk(text, o); }
    expect(O.ownsToken('b', t)).toBe(true);
    const late = `/out/${t2}/z.png`;
    c.chunk(late, 0);
    expect(O.ownsToken('b', t2)).toBe(false);
    fs.mkdirSync(path.join(OUT, t2));
    c.finish(text, late);
    expect(O.ownsToken('b', t2)).toBe(true);
  });
});

describe('миграция 0012_out_files обратима', () => {
  it('откат с бэкапом убирает таблицу (сообщения на месте), следующий запуск накатывает снова', () => {
    const d3 = fs.mkdtempSync(path.join(dir, 'mg-'));
    const file = path.join(d3, 'korvex.db');
    const migrations = path.join(process.cwd(), 'drizzle');
    let s = new Database(file);
    migrate(drizzle(s), { migrationsFolder: migrations });
    s.exec(`insert into users (id, email, name, password_hash, role, created_at) values ('u','u@t','U','x','user',1);
      insert into threads (id, user_id, title, model_id, effort, created_at, updated_at) values ('t','u','T','alpha','off',1,1);
      insert into messages (id, thread_id, seq, role, content, created_at) values ('m','t',1,'assistant','x',1);
      insert into out_files (token, user_id, thread_id, message_id, source, created_at) values ('${'a'.repeat(32)}','u','t','m','job',1);`);
    s.close();
    execFileSync(process.execPath, ['scripts/db-rollback.mjs', '0012_out_files'], { env: { ...process.env, DATA_DIR: d3 }, stdio: 'pipe' });
    s = new Database(file);
    expect(s.prepare(`select count(*) c from sqlite_master where name = 'out_files'`).get()).toEqual({ c: 0 });
    expect(s.prepare(`select count(*) c from messages`).get()).toEqual({ c: 1 });
    expect(fs.readdirSync(d3).some((f) => f.startsWith('korvex.db.bak_'))).toBe(true);
    migrate(drizzle(s), { migrationsFolder: migrations });
    expect(s.prepare(`select count(*) c from sqlite_master where name = 'out_files'`).get()).toEqual({ c: 1 });
    s.close();
  });
});
