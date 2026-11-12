import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';

const TTL_MS = 5_000;
type Cache = { at: number; map: Map<string, unknown> };
const g = globalThis as unknown as { __kxSettings?: Cache };

function load(now = Date.now()): Map<string, unknown> {
  const c = g.__kxSettings;
  if (c && now - c.at < TTL_MS) return c.map;
  const map = new Map<string, unknown>();
  for (const r of getDb().select().from(schema.settings).all()) {
    try { map.set(r.key, JSON.parse(r.value)); } catch {  }
  }
  g.__kxSettings = { at: now, map };
  return map;
}

export function getSetting<T>(key: string, def: T): T {
  const m = load();
  return m.has(key) ? (m.get(key) as T) : def;
}

export function setSetting(key: string, value: unknown, by: string | null = null) {
  const v = JSON.stringify(value);
  const now = Date.now();
  getDb().insert(schema.settings).values({ key, value: v, updatedAt: now, updatedBy: by })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: v, updatedAt: now, updatedBy: by } }).run();
  g.__kxSettings = undefined;
}

export function deleteSetting(key: string) {
  getDb().delete(schema.settings).where(eq(schema.settings.key, key)).run();
  g.__kxSettings = undefined;
}

export function _resetSettingsCache() { g.__kxSettings = undefined; }
