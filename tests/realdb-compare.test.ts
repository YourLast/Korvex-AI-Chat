import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { tmpData } from './helpers';

const SRC = process.env.KX_REALDB;

describe.skipIf(!SRC)('миграция сравнения на копии настоящей БД', () => {
  it('все чаты и старые чаты сравнения открываются после миграции', async () => {
    const dir = tmpData();
    const src = new Database(SRC!, { readonly: true, fileMustExist: true });
    await src.backup(path.join(dir, 'korvex.db'));
    type T = { id: string; user_id: string; group_id: string | null; leaf_id: string | null };
    const before = src.prepare('select id, user_id, group_id, leaf_id from threads').all() as T[];
    const nMsg = (src.prepare('select count(*) c from messages').get() as { c: number }).c;
    src.close();
    const { getDb, schema } = await import('@/lib/db');
    const db = getDb();
    const L = await import('@/lib/load');
    const { analytics } = await import('@/lib/analytics');
    let opened = 0, groups = 0;
    const seen = new Set<string>();
    for (const t of before) {
      const d = L.loadThread(t.user_id, t.id, { turns: 500 });
      expect(d, t.id).not.toBeNull();
      expect(d!.compare).toBeNull();
      opened++;
      if (t.group_id && !seen.has(t.group_id)) {
        seen.add(t.group_id);
        const g = L.loadGroup(t.user_id, t.group_id);
        if (L.groupThreads(t.user_id, t.group_id)) { expect(g, t.group_id).not.toBeNull(); groups++; }
      }
    }
    const after = db.select({ id: schema.threads.id, leafId: schema.threads.leafId }).from(schema.threads).all();
    expect(new Map(after.map((t) => [t.id, t.leafId]))).toEqual(new Map(before.map((t) => [t.id, t.leaf_id])));
    expect(db.select().from(schema.messages).all().length).toBe(nMsg);
    const an = analytics(30);
    expect(an.compare.votes).toBe(0);
    console.log(`копия БД: чатов ${opened}, старых чатов сравнения ${groups}, сообщений ${nMsg}, вопросов парам за 30 дней ${an.compare.questions}`);
  }, 120_000);
});
