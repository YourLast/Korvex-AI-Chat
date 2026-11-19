import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { dataDir, getDb, schema } from './db';
import { INTRO, markIntroEnd, memoryMeta } from './memory';
import { kickRules, rulesView } from './memoryRules';

export type OpsOut = { status: number; body: Record<string, unknown> };

function introOwner(threadId: string): { userId: string } | OpsOut {
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) return { status: 400, body: { error: 'нужен id чата (uuid)' } };
  const t = getDb().select({ userId: schema.threads.userId, temporary: schema.threads.temporary }).from(schema.threads).where(eq(schema.threads.id, threadId)).get();
  if (!t) return { status: 404, body: { error: 'нет такого чата' } };
  if (t.temporary !== INTRO) return { status: 409, body: { error: 'это не чат знакомства' } };
  return { userId: t.userId };
}

function flags(userId: string) {
  const m = memoryMeta(userId), r = m.rules ?? {};
  return { user: userId.slice(0, 8), introEnd: m.introEnd ?? null, rules: { pending: r.pending ?? null, now: r.now ?? null, done: r.done ?? null, n: r.n ?? null, failed: r.failed ?? null }, view: rulesView(userId) };
}

export function opsIntroEnd(threadId: string): OpsOut {
  const o = introOwner(threadId);
  if ('status' in o) return o;
  const set = markIntroEnd(o.userId, 'ops', { now: true, chat: threadId });
  if (set) kickRules();
  return { status: 200, body: { set, ...flags(o.userId) } };
}
export function opsRules(threadId: string): OpsOut {
  const o = introOwner(threadId);
  if ('status' in o) return o;
  return { status: 200, body: flags(o.userId) };
}

export function opsKey(): string {
  const f = path.join(dataDir(), 'ops.key');
  try { const k = fs.readFileSync(f, 'utf8').trim(); if (k) return k; } catch {  }
  const k = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(f, k + '\n', { mode: 0o600 });
  return k;
}

export function registerOps() {
  const key = opsKey();
  const g = globalThis as unknown as { __kxOps?: unknown };
  g.__kxOps = {
    ok: (k: unknown) => typeof k === 'string' && k.length === key.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(key)),
    run: (name: string, q: URLSearchParams): OpsOut => {
      const chat = q.get('chat') ?? '';
      if (name === 'intro-end') return opsIntroEnd(chat);
      if (name === 'rules') return opsRules(chat);
      return { status: 404, body: { error: 'нет такого действия' } };
    },
  };
}
