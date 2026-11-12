import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { tmpData } from './helpers';

const TAG = '0010_compare_inchat';
const cols = (db: Database.Database, t: string) => (db.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
const tables = (db: Database.Database) => (db.prepare(`select name from sqlite_master where type = 'table'`).all() as { name: string }[]).map((r) => r.name);

describe('миграция сравнения внутри чата', () => {
  it('накат → данные → откат с бэкапом → накат снова', () => {
    const dir = tmpData();
    const file = path.join(dir, 'korvex.db');
    const open = () => { const s = new Database(file); migrate(drizzle(s), { migrationsFolder: path.join(process.cwd(), 'drizzle') }); return s; };
    let db = open();
    expect(cols(db, 'threads')).toContain('compare');
    expect(tables(db)).toContain('compare_votes');
    db.prepare(`insert into users (id, email, name, password_hash, role, created_at) values ('u', 'u@t', 'U', 'x', 'user', 1)`).run();
    db.prepare(`insert into threads (id, user_id, title, model_id, effort, compare, created_at, updated_at) values ('t', 'u', 'T', 'beta', 'off', ?, 1, 1)`)
      .run(JSON.stringify({ on: true, a: { modelId: 'beta', levelId: 'off' }, b: { modelId: 'beta-plain', levelId: 'off' } }));
    const ins = db.prepare(`insert into messages (id, thread_id, seq, parent_id, role, content, meta, created_at) values (?, 't', ?, ?, ?, ?, ?, 1)`);
    ins.run('q', 1, null, 'user', 'вопрос', JSON.stringify({ pair: { a: 'x', b: 'y' } }));
    ins.run('x', 2, 'q', 'assistant', 'ответ A', JSON.stringify({ lane: 'a', modelId: 'beta' }));
    ins.run('y', 3, 'q', 'assistant', 'ответ B', JSON.stringify({ lane: 'b', modelId: 'beta-plain' }));
    db.prepare(`update threads set leaf_id = 'x' where id = 't'`).run();
    db.prepare(`insert into compare_votes (id, user_id, thread_id, question_id, message_a, message_b, winner, model_a, level_a, model_b, level_b, created_at, updated_at)
      values ('v', 'u', 't', 'q', 'x', 'y', 'b', 'beta', 'off', 'beta-plain', 'off', 1, 1)`).run();
    db.close();

    const before = fs.readdirSync(dir).filter((f) => f.startsWith('korvex.db.bak_')).length;
    execFileSync(process.execPath, ['scripts/db-rollback.mjs', TAG], { env: { ...process.env, DATA_DIR: dir }, stdio: 'pipe' });
    const baks = fs.readdirSync(dir).filter((f) => f.startsWith('korvex.db.bak_'));
    expect(baks.length).toBe(before + 1);
    const bak = new Database(path.join(dir, baks.sort().at(-1)!), { readonly: true });
    expect((bak.prepare('select winner from compare_votes').get() as { winner: string }).winner).toBe('b');
    bak.close();

    db = new Database(file);
    expect(cols(db, 'threads')).not.toContain('compare');
    expect(tables(db)).not.toContain('compare_votes');
    expect((db.prepare('select count(*) c from messages').get() as { c: number }).c).toBe(3);
    expect((db.prepare(`select leaf_id l from threads where id = 't'`).get() as { l: string }).l).toBe('x');
    db.close();

    db = open();
    expect(cols(db, 'threads')).toContain('compare');
    expect(tables(db)).toContain('compare_votes');
    expect((db.prepare('select count(*) c from compare_votes').get() as { c: number }).c).toBe(0);
    db.close();
  });
});
