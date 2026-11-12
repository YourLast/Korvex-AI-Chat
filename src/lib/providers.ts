import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import { open, seal } from './github/secret';
import type { Level, ModelCfg } from './models';

export const PROVIDER_KINDS = ['openai-compatible', 'openai', 'anthropic', 'openrouter', 'ollama', 'lmstudio'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export const PRESETS: Record<ProviderKind, { label: string; baseUrl: string; needsKey: boolean }> = {
  'openai-compatible': { label: 'OpenAI-compatible', baseUrl: '', needsKey: false },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true },
  anthropic: { label: 'Anthropic', baseUrl: '', needsKey: true },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true },
  ollama: { label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', needsKey: false },
  lmstudio: { label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', needsKey: false },
};

export type ProviderView = { id: string; name: string; kind: ProviderKind; baseUrl: string; hasKey: boolean; models: number };

const g = globalThis as unknown as { __kxProv?: { rev: number; at: number } };
const st = () => (g.__kxProv ??= { rev: 0, at: 0 });
export const providersRev = (): number => { const s = st(); if (Date.now() - s.at > 5_000) { s.at = Date.now(); s.rev++; } return s.rev; };
const bump = () => { const s = st(); s.rev++; s.at = Date.now(); };

export function listProviders(): ProviderView[] {
  const db = getDb();
  const count = new Map<string, number>();
  for (const m of db.select({ p: schema.adminModels.providerId }).from(schema.adminModels).all()) count.set(m.p, (count.get(m.p) ?? 0) + 1);
  return db.select().from(schema.providers).all().map((p) => ({ id: p.id, name: p.name, kind: p.kind as ProviderKind, baseUrl: p.baseUrl, hasKey: !!p.keyEnc, models: count.get(p.id) ?? 0 }));
}

export function saveProvider(p: { id?: string; name: string; kind: ProviderKind; baseUrl?: string; key?: string | null }): string {
  const db = getDb();
  const now = Date.now();
  const id = p.id || randomUUID();
  const baseUrl = (p.baseUrl ?? '').trim().replace(/\/+$/, '') || PRESETS[p.kind].baseUrl;
  const keyEnc = p.key === undefined ? undefined : p.key === null || !p.key.trim() ? null : seal(p.key.trim(), `provider:${id}`);
  const exists = db.select({ id: schema.providers.id }).from(schema.providers).where(eq(schema.providers.id, id)).get();
  if (exists) db.update(schema.providers).set({ name: p.name, kind: p.kind, baseUrl, ...(keyEnc !== undefined ? { keyEnc } : {}), updatedAt: now }).where(eq(schema.providers.id, id)).run();
  else db.insert(schema.providers).values({ id, name: p.name, kind: p.kind, baseUrl, keyEnc: keyEnc ?? null, createdAt: now, updatedAt: now }).run();
  bump();
  return id;
}

export function deleteProvider(id: string) { getDb().delete(schema.providers).where(eq(schema.providers.id, id)).run(); bump(); }

export function providerKey(id: string): string | null {
  const p = getDb().select({ k: schema.providers.keyEnc }).from(schema.providers).where(eq(schema.providers.id, id)).get();
  if (!p?.k) return null;
  try { return open(p.k, `provider:${id}`); } catch { return null; }
}

export type AdminModelIn = { id: string; providerId: string; upstreamModel: string; name: string; fullName?: string; blurb?: string; levels?: Level[]; defaultLevel?: string;
  images?: boolean; tools?: boolean; contextTokens?: number; maxOutputTokens?: number; maxConcurrent?: number; hidden?: boolean; sort?: number };

export const PLAIN_LEVELS: Level[] = [{ id: 'off', label: 'off', effort: null }];

export function saveAdminModel(m: AdminModelIn) {
  const db = getDb();
  const now = Date.now();
  const levels = m.levels?.length ? m.levels : PLAIN_LEVELS;
  const row = { providerId: m.providerId, upstreamModel: m.upstreamModel.trim(), name: m.name.trim(), fullName: (m.fullName ?? '').trim(), blurb: (m.blurb ?? '').trim(),
    levels, defaultLevel: m.defaultLevel && levels.some((l) => l.id === m.defaultLevel) ? m.defaultLevel : levels[0].id, images: m.images ? 1 : 0, tools: m.tools ? 1 : 0,
    contextTokens: m.contextTokens ?? 32768, maxOutputTokens: m.maxOutputTokens ?? 4096, maxConcurrent: m.maxConcurrent ?? 4, hidden: m.hidden ? 1 : 0, sort: m.sort ?? 0, updatedAt: now };
  const exists = db.select({ id: schema.adminModels.id }).from(schema.adminModels).where(eq(schema.adminModels.id, m.id)).get();
  if (exists) db.update(schema.adminModels).set(row).where(eq(schema.adminModels.id, m.id)).run();
  else db.insert(schema.adminModels).values({ id: m.id, ...row, createdAt: now }).run();
  bump();
}

export function deleteAdminModel(id: string) { getDb().delete(schema.adminModels).where(eq(schema.adminModels.id, id)).run(); bump(); }

export function adminModelCfgs(): ModelCfg[] {
  const db = getDb();
  const prov = new Map(db.select().from(schema.providers).all().map((p) => [p.id, p]));
  return db.select().from(schema.adminModels).all().sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)).flatMap((m): ModelCfg[] => {
    const p = prov.get(m.providerId);
    if (!p) return [];
    return [{
      id: m.id, name: m.name, fullName: m.fullName || m.name, ...(m.blurb ? { blurb: m.blurb } : {}), upstreamModel: m.upstreamModel,
      baseUrl: p.baseUrl || PRESETS[p.kind as ProviderKind]?.baseUrl || '', maxConcurrent: m.maxConcurrent, defaultLevel: m.defaultLevel, levels: m.levels,
      images: !!m.images, tools: !!m.tools, contextTokens: m.contextTokens, maxOutputTokens: m.maxOutputTokens, ...(m.hidden ? { hidden: true } : {}),
      providerId: p.id, ...(p.kind === 'anthropic' ? { provider: 'anthropic' as const } : {}),
    }];
  });
}

export function modelKey(m: Pick<ModelCfg, 'providerId' | 'apiKeyEnv'>): string | null {
  if (m.providerId) return providerKey(m.providerId);
  if (m.apiKeyEnv) return process.env[m.apiKeyEnv]?.trim() || null;
  return null;
}

export async function testProvider(p: { kind: ProviderKind; baseUrl: string; key: string | null }, doFetch: typeof fetch = fetch): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  const base = (p.baseUrl || PRESETS[p.kind].baseUrl).replace(/\/+$/, '');
  if (p.kind === 'anthropic') {
    try {
      const r = await doFetch((base || 'https://api.anthropic.com') + '/v1/models', { headers: { 'x-api-key': p.key ?? '', 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      const j = (await r.json()) as { data?: { id?: string }[] };
      return { ok: true, models: (j.data ?? []).map((x) => x.id ?? '').filter(Boolean) };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  }
  if (!base) return { ok: false, error: 'нет адреса' };
  try {
    const r = await doFetch(base + '/models', { headers: p.key ? { Authorization: `Bearer ${p.key}` } : {}, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const j = (await r.json()) as { data?: { id?: string }[]; models?: { name?: string }[] };
    return { ok: true, models: [...(j.data ?? []).map((x) => x.id ?? ''), ...(j.models ?? []).map((x) => x.name ?? '')].filter(Boolean) };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
