import { and, desc, eq, sql } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import { sha256 } from './auth';
import { getDb, schema } from './db';
import type { ApiKey, User } from './db/schema';
import { getModel, getModels, isClaude, usableModel } from './models';
import { onJobFinished } from './jobs';

export const KEY_PREFIX = 'kx-';
export type KeyView = {
  id: string; name: string; prefix: string; models: string[]; levels: Record<string, string>; rpm: number; expiresAt: number | null; revokedAt: number | null;
  lastUsedAt: number | null; requests: number; promptTokens: number; completionTokens: number; createdAt: number; owner?: string; ownerId: string; status: 'active' | 'expired' | 'revoked';
};
const statusOf = (k: ApiKey, now = Date.now()): KeyView['status'] => (k.revokedAt ? 'revoked' : k.expiresAt && k.expiresAt <= now ? 'expired' : 'active');
export const view = (k: ApiKey, owner?: string): KeyView => ({
  id: k.id, name: k.name, prefix: k.prefix, models: k.models, levels: k.levels, rpm: k.rpm, expiresAt: k.expiresAt, revokedAt: k.revokedAt, lastUsedAt: k.lastUsedAt,
  requests: k.requests, promptTokens: k.promptTokens, completionTokens: k.completionTokens, createdAt: k.createdAt, owner, ownerId: k.userId, status: statusOf(k),
});

export type NewKey = { name: string; models: string[]; levels?: Record<string, string>; rpm?: number; expiresDays?: number | null };

export function createKey(owner: User, k: NewKey): { key: string; view: KeyView } | { error: string } {
  const models = [...new Set(k.models)].filter((id) => !!usableModel(id) && !isClaude(getModel(id)));
  if (!models.length) return { error: 'Выберите хотя бы одну модель' };
  const levels: Record<string, string> = {};
  for (const id of models) {
    const m = getModel(id)!;
    const want = k.levels?.[id];
    if (want && !m.levels.some((l) => l.id === want)) return { error: `У ${m.name} нет уровня «${want}»` };
    levels[id] = want ?? m.defaultLevel;
  }
  const rpm = Math.max(1, Math.min(600, Math.round(k.rpm ?? 20)));
  const key = KEY_PREFIX + randomBytes(30).toString('base64url');
  const now = Date.now();
  const row: ApiKey = {
    id: randomUUID(), userId: owner.id, name: k.name.trim().slice(0, 80) || 'Ключ', keyHash: sha256(key), prefix: key.slice(0, 9), models, levels, rpm,
    expiresAt: k.expiresDays ? now + k.expiresDays * 864e5 : null, revokedAt: null, lastUsedAt: null, requests: 0, promptTokens: 0, completionTokens: 0, createdAt: now,
  };
  getDb().insert(schema.apiKeys).values(row).run();
  return { key, view: view(row, owner.name) };
}

export function listKeys(u: User): KeyView[] {
  const db = getDb();
  const rows = u.role === 'admin'
    ? db.select({ k: schema.apiKeys, name: schema.users.name }).from(schema.apiKeys).innerJoin(schema.users, eq(schema.users.id, schema.apiKeys.userId)).orderBy(desc(schema.apiKeys.createdAt)).all()
    : db.select({ k: schema.apiKeys, name: schema.users.name }).from(schema.apiKeys).innerJoin(schema.users, eq(schema.users.id, schema.apiKeys.userId)).where(eq(schema.apiKeys.userId, u.id)).orderBy(desc(schema.apiKeys.createdAt)).all();
  return rows.map((r) => view(r.k, r.name));
}

export function revokeKey(u: User, id: string): boolean {
  const db = getDb();
  const k = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, id)).get();
  if (!k || (k.userId !== u.id && u.role !== 'admin')) return false;
  if (!k.revokedAt) db.update(schema.apiKeys).set({ revokedAt: Date.now() }).where(eq(schema.apiKeys.id, id)).run();
  return true;
}

export function authKey(req: Request): { key: ApiKey; user: User } | { status: 401; message: string; code: string } {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  if (!m) return { status: 401, message: 'Нет ключа: заголовок Authorization: Bearer <ключ>', code: 'missing_api_key' };
  const db = getDb();
  const row = db.select({ k: schema.apiKeys, u: schema.users }).from(schema.apiKeys).innerJoin(schema.users, eq(schema.users.id, schema.apiKeys.userId))
    .where(eq(schema.apiKeys.keyHash, sha256(m[1]))).get();
  if (!row) return { status: 401, message: 'Неверный ключ API', code: 'invalid_api_key' };
  const st = statusOf(row.k);
  if (st === 'revoked') return { status: 401, message: 'Ключ отозван', code: 'invalid_api_key' };
  if (st === 'expired') return { status: 401, message: 'Срок действия ключа истёк', code: 'invalid_api_key' };
  if (row.u.disabled) return { status: 401, message: 'Доступ владельца ключа отключён', code: 'invalid_api_key' };
  return { key: row.k, user: row.u };
}

const g = globalThis as unknown as { __kxRpm?: Map<string, number[]>; __kxKeyUse?: () => void };
export function rateLimit(keyId: string, rpm: number, now = Date.now()): number | null {
  g.__kxRpm ??= new Map();
  const arr = (g.__kxRpm.get(keyId) ?? []).filter((t) => now - t < 60_000);
  if (arr.length >= rpm) { g.__kxRpm.set(keyId, arr); return Math.max(1, Math.ceil((60_000 - (now - arr[0])) / 1000)); }
  arr.push(now);
  g.__kxRpm.set(keyId, arr);
  return null;
}

export function touchKey(keyId: string) {
  getDb().update(schema.apiKeys).set({ lastUsedAt: Date.now(), requests: sql`${schema.apiKeys.requests} + 1` }).where(eq(schema.apiKeys.id, keyId)).run();
}

export function registerKeyUsage() {
  if (g.__kxKeyUse) return;
  g.__kxKeyUse = onJobFinished((j) => {
    if (j.kind !== 'api' || !j.apiKeyId) return;
    const u = (j.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
    const pt = Math.round(Number(u.prompt_tokens) || 0), ct = Math.round(Number(u.completion_tokens) || 0);
    if (!pt && !ct) return;
    try {
      getDb().update(schema.apiKeys).set({ promptTokens: sql`${schema.apiKeys.promptTokens} + ${pt}`, completionTokens: sql`${schema.apiKeys.completionTokens} + ${ct}` })
        .where(and(eq(schema.apiKeys.id, j.apiKeyId))).run();
    } catch (e) { console.error('[api] usage', (e as Error).message); }
  });
}

const apiSlug = (s: string) => (s || '').trim().toLowerCase().replace(/[\s_]+/g, '-');

export function resolveApiModel(name: string) {
  const n = apiSlug(name);
  if (!n) return undefined;
  const all = getModels().filter((m) => !m.hidden && !isClaude(m));
  const base = all.filter((m) => !m.variantOf);
  return all.find((m) => (m.apiNames ?? []).some((x) => apiSlug(x) === n))
    ?? all.find((m) => m.id === n)
    ?? all.find((m) => apiSlug(m.upstreamModel) === n)
    ?? all.find((m) => apiSlug(m.fullName) === n)
    ?? base.find((m) => apiSlug(m.name) === n)
    ?? (n.length >= 5 ? base.filter((m) => apiSlug(m.fullName).startsWith(n + '-')) : []).find((_, i, a) => a.length === 1);
}
