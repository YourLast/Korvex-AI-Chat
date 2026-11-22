import fs from 'node:fs';
import type { RetiredModel } from './retired';
import path from 'node:path';
import { withTimezone } from './tz';
import { hasKey, tr, type Lang } from './i18n/core';
import { adminModelCfgs, providersRev } from './providers';
import { allowedBy, allowedForRole, ruleOf, whoOf } from './access';

export type Level = { id: string; label: string; effort: string | null; hint?: string; userHint?: string; mult?: number };
export type ModelCfg = {
  id: string;
  name: string;
  fullName: string;
  blurb?: string;
  tagline?: string;
  images?: boolean;
  upstreamModel: string;
  apiNames?: string[];
  baseUrl: string;
  maxConcurrent: number;
  defaultLevel: string;
  levelReset?: { n: number; from: string };
  mult?: number;
  multCalc?: { at: string; recheck: string };
  levels: Level[];
  systemPromptFile?: string;
  extract?: boolean;
  extractTimeoutSec?: number;
  extractKeyEnvFile?: string;
  extractKeyVar?: string;
  variantOf?: string;
  variantName?: string;
  variantHint?: string;
  unavailableText?: string;
  queue?: string;
  tools?: boolean;
  hidden?: boolean;
  contextTokens?: number;
  engineContextTokens?: number;
  maxOutputTokens?: number;
  provider?: 'anthropic';
  via?: string;
  providerId?: string;
  apiKeyEnv?: string;
  roles?: string[];
};
export type QueueCfg = { maxConcurrent: number };
export type PublicModel = Pick<ModelCfg, 'id' | 'name' | 'fullName' | 'blurb' | 'tagline' | 'images' | 'defaultLevel' | 'levelReset' | 'variantOf' | 'variantName' | 'variantHint'> & { levels: Pick<Level, 'id' | 'label' | 'hint' | 'mult'>[] };

let cache: ModelCfg[] | null = null;
let queuesCache: Record<string, QueueCfg> = {};
let keysCache: string[] = [];

export const envKey = (id: string) => `KORVEX_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_BASE_URL`;

export function _resetModelsForTests() { cache = null; merged = null; }

export function getModels(): ModelCfg[] {
  const base = configModels();
  const rev = providersRev();
  if (merged && merged.rev === rev && merged.base === base) return merged.list;
  let extra: ModelCfg[] = [];
  try { extra = adminModelCfgs(); } catch { extra = []; }
  const ids = new Set(extra.map((m) => m.id));
  const list = extra.length ? [...base.filter((m) => !ids.has(m.id)), ...extra] : base;
  merged = { rev, base, list };
  return list;
}
let merged: { rev: number; base: ModelCfg[]; list: ModelCfg[] } | null = null;

function configModels(): ModelCfg[] {
  if (cache) return cache;
  const file = process.env.MODELS_CONFIG || path.join(process.cwd(), 'models.config.json');
  let text = '{"models":[]}';
  try { text = fs.readFileSync(/*turbopackIgnore: true*/ file, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const raw = JSON.parse(text) as { models: ModelCfg[]; queues?: Record<string, QueueCfg>; anthropicKeys?: string[] };
  queuesCache = raw.queues ?? {};
  keysCache = Array.isArray(raw.anthropicKeys) ? raw.anthropicKeys.filter((x) => typeof x === 'string' && x.trim()) : [];
  cache = raw.models.map((m) => ({
    ...m,
    baseUrl: process.env[envKey(m.id)] || process.env[`KORVEX_${m.id.toUpperCase()}_BASE_URL`] || m.baseUrl,
  }));
  return cache;
}

export function anthropicKeyNames(): string[] { getModels(); return keysCache; }

export function variantLabel(modelId: string): string {
  const all = getModels();
  const m = all.find((x) => x.id === modelId);
  if (!m) return modelId;
  const fam = m.variantOf ?? m.id;
  return all.some((x) => x.variantOf === fam) && m.variantName ? `${m.name} ${m.variantName.toLowerCase()}` : m.name;
}

export function pairNames(parts: { modelId: string; levelId?: string | null }[]): string[] {
  const names = parts.map((x) => variantLabel(x.modelId));
  if (names.length < 2 || new Set(names).size > 1) return names;
  return parts.map((x, i) => {
    const lv = x.levelId ? getModel(x.modelId)?.levels.find((l) => l.id === x.levelId)?.label ?? x.levelId : '';
    return lv ? `${names[i]} · ${lv}` : names[i];
  });
}

export function queueOf(modelId: string): string {
  return getModel(modelId)?.queue || modelId;
}
export function queueLimit(key: string): number {
  getModels();
  const q = queuesCache[key]?.maxConcurrent;
  if (typeof q === 'number' && q >= 1) return Math.floor(q);
  const members = getModels().filter((m) => (m.queue || m.id) === key);
  return Math.max(1, Math.min(...(members.length ? members.map((m) => m.maxConcurrent ?? 1) : [1])));
}
export function queueMembers(key: string): ModelCfg[] {
  return getModels().filter((m) => (m.queue || m.id) === key);
}

export function getModel(id: string): ModelCfg | undefined {
  return getModels().find((m) => m.id === id);
}

export const isClaude = (m: Pick<ModelCfg, 'provider'> | null | undefined): boolean => m?.provider === 'anthropic';
export const viaGateway = (m: Pick<ModelCfg, 'provider' | 'via' | 'baseUrl'> | null | undefined): boolean => isClaude(m) && !!m?.via && !!m?.baseUrl;
export const isClaudeDirect = (m: Pick<ModelCfg, 'provider' | 'via' | 'baseUrl'> | null | undefined): boolean => isClaude(m) && !viaGateway(m);

export function modelAllowed(m: Pick<ModelCfg, 'roles' | 'id'> | null | undefined, role: string | null | undefined, userId?: string | null): boolean {
  return allowedWho(m, role, userId ? whoOf(userId) : null);
}
const normRole = (role: string | null | undefined) => (role === 'admin' || role === 'alpha' ? role : 'user');
function allowedWho(m: Pick<ModelCfg, 'roles' | 'id'> | null | undefined, role: string | null | undefined, who: ReturnType<typeof whoOf> | null): boolean {
  if (!m) return false;
  const rule = ruleOf('model', m.id);
  if (rule) return who ? allowedBy(rule, who) : allowedForRole(rule, normRole(role));
  return !m.roles || m.roles.includes(normRole(role));
}

export function usableModel(id: string, role?: string | null, userId?: string | null): ModelCfg | undefined {
  const m = getModel(id);
  return m && !m.hidden && (role === undefined || modelAllowed(m, role, userId)) ? m : undefined;
}

const loc = (lang: Lang | undefined, key: string, fallback: string | undefined): string | undefined => (lang && lang !== 'ru' && hasKey(key) ? tr(lang, key) : fallback);

export function levelHint(role: string, lang: Lang | undefined, l: Pick<Level, 'id' | 'hint' | 'userHint'>): string | undefined {
  const base = role === 'admin' ? l.hint : l.userHint ?? l.hint;
  return loc(lang, role === 'admin' && hasKey(`lvl.${l.id}.admin`) ? `lvl.${l.id}.admin` : `lvl.${l.id}`, base);
}

export function publicModels(role: string = 'user', lang?: Lang, access?: string | null, userId?: string | null): PublicModel[] {
  const who = userId ? whoOf(userId) : null;
  return getModels().filter((m) => !m.hidden && allowedWho(m, access ?? role, who)).map((m) => ({
    id: m.id,
    name: m.name,
    fullName: m.fullName,
    blurb: loc(lang, `model.blurb.${m.id}`, m.blurb),
    tagline: loc(lang, `model.tag.${m.id}`, m.tagline),
    images: m.images !== false,
    defaultLevel: m.defaultLevel,
    ...(m.levelReset ? { levelReset: m.levelReset } : {}),
    ...(m.variantOf ? { variantOf: m.variantOf } : {}),
    ...(m.variantName ? { variantName: loc(lang, `model.variant.${m.id}`, m.variantName) } : {}),
    ...(m.variantHint ? { variantHint: loc(lang, `model.variantHint.${m.id}`, m.variantHint) } : {}),
    levels: m.levels.map((l) => { const x = l.mult ?? m.mult; return { id: l.id, label: l.label, hint: levelHint(role, lang, l), ...(x ? { mult: x } : {}) }; }),
  }));
}

export function lockedFor(role: string | null | undefined, userId?: string | null): { id: string; name: string }[] {
  const who = userId ? whoOf(userId) : null;
  return getModels().filter((m) => !m.hidden && !m.variantOf && !allowedWho(m, role, who)).map((m) => ({ id: m.id, name: m.name }));
}

export function retiredModels(): RetiredModel[] {
  return getModels().filter((m) => m.hidden).map((m) => ({
    id: m.id, name: m.name, ...(m.variantOf ? { variantOf: m.variantOf } : {}), ...(m.variantName ? { variantName: m.variantName } : {}),
    levels: m.levels.map(({ id, label }) => ({ id, label })),
  }));
}

const sysCache = new Map<string, { mtime: number; text: string }>();
const sysWarned = new Set<string>();
export function systemPrompt(m: ModelCfg, tz?: string | null): string | null {
  const raw = systemPromptRaw(m);
  return raw ? withTimezone(raw, tz) : null;
}

function systemPromptRaw(m: ModelCfg): string | null {
  const f = m.systemPromptFile;
  if (!f) return null;
  try {
    const st = fs.statSync(f);
    const hit = sysCache.get(f);
    if (hit && hit.mtime === st.mtimeMs) return hit.text || null;
    const text = fs.readFileSync(f, 'utf8').trim();
    sysCache.set(f, { mtime: st.mtimeMs, text });
    return text || null;
  } catch (e) {
    if (!sysWarned.has(f)) { sysWarned.add(f); console.error(`[models] системный промпт ${m.id}: файл не читается (${(e as Error).message})`); }
    return sysCache.get(f)?.text || null;
  }
}

export const apiNameOf = (m: Pick<ModelCfg, 'id' | 'apiNames'>) => m.apiNames?.[0] ?? m.id;
