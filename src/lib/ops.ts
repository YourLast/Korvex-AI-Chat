import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { dataDir, getDb, schema } from './db';
import { INTRO, listMemory, markIntroEnd, memoryMeta } from './memory';
import { kickRules, rulesView } from './memoryRules';
import { deleteUser } from './moderation';

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

const TEST_EMAIL = /^[a-z0-9._+-]+@example\.com$/i;
export function opsTestUser(email: string, o: { dry: boolean; now?: number }): OpsOut {
  if (!TEST_EMAIL.test(email)) return { status: 400, body: { error: 'только адреса @example.com' } };
  const u = getDb().select().from(schema.users).where(eq(schema.users.email, email.toLowerCase())).get();
  if (!u) return { status: 404, body: { error: 'нет такой учетки' } };
  const now = o.now ?? Date.now();
  if (u.role !== 'user' || now - u.createdAt > 24 * 3600_000) return { status: 409, body: { error: 'не тестовая учетка: роль не user или создана раньше суток назад' } };
  const chats = getDb().select({ id: schema.threads.id }).from(schema.threads).where(eq(schema.threads.userId, u.id)).all().length;
  const memory = listMemory(u.id).length;
  const files = getDb().select({ id: schema.files.id }).from(schema.files).where(eq(schema.files.userId, u.id)).all().length;
  const counts = { user: u.id.slice(0, 8), email: u.email, chats, memory, files };
  if (o.dry) return { status: 200, body: { dry: true, ...counts } };
  const r = deleteUser('system:ops', u.id, { confirm: u.email, reason: 'тестовая учетка проверки (служебный вызов)' });
  if (!r.ok) return { status: 409, body: { error: 'не удалена', ...counts } };
  const left = getDb().select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, u.id)).get();
  return { status: 200, body: { deleted: !left, ...counts } };
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
      if (name === 'test-user') return opsTestUser(q.get('email') ?? '', { dry: q.get('delete') !== '1' });
      return { status: 404, body: { error: 'нет такого действия' } };
    },
  };
}
