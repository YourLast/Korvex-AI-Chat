import { beforeAll, describe, expect, it } from 'vitest';
import { tmpData } from './helpers';

tmpData();
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
const T0 = 1_790_000_000_000;

beforeAll(async () => {
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  db.insert(schema.users).values({ id: 'u1', email: 'u1@t', name: 'u1', passwordHash: 'x', role: 'user', createdAt: T0 }).run();
  const th = (id: string, title: string, temporary: number, at: number) =>
    db.insert(schema.threads).values({ id, userId: 'u1', title, modelId: 'alpha', effort: 'medium', temporary, createdAt: at, updatedAt: at }).run();
  th('t-normal', 'Обычный чат', 0, T0);
  th('t-temp', 'Временный разговор', 1, T0 + 1000);
});

describe('временный чат', () => {
  it('нет в меню чатов, обычный есть', async () => {
    const { threadList } = await import('@/lib/threadlist');
    const ids = threadList('u1').map((t) => t.id);
    expect(ids).toContain('t-normal');
    expect(ids).not.toContain('t-temp');
  });
});
