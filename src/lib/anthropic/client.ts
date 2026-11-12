import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../db';
import { anthropicKeyNames } from '../models';
import { providerKey } from '../providers';

export const RETRY_NO_FUNDS_MS = () => Number(process.env.KX_ANTHROPIC_NOFUNDS_RETRY_MS) || 30 * 60_000;

export class NoKeyError extends Error {}

export function keyFiles(): string[] {
  const env = process.env.KX_ANTHROPIC_KEY_FILES;
  const names = env ? env.split(',').map((s) => s.trim()).filter(Boolean) : anthropicKeyNames();
  return names.map((n) => (path.isAbsolute(n) ? n : path.join(dataDir(), 'keys', n)));
}

type KeyState = { noFundsAt: Record<string, number>; active: number | null; switchedAt: number | null; lastSwitch: { from: number; to: number; at: number; why: string } | null };
type G = { __kxClaudeClients?: Map<string, { client: Anthropic; sig: string; last4: string }>; __kxClaudeTest?: ((key: number) => Anthropic) | null; __kxClaudeKeys?: KeyState; __kxClaudeKeysFile?: string };
const g = globalThis as unknown as G;

const stateFile = () => path.join(dataDir(), 'claude_keys.json');
function st(): KeyState {
  const f = stateFile();
  if (g.__kxClaudeKeys && g.__kxClaudeKeysFile === f) return g.__kxClaudeKeys;
  let s: KeyState = { noFundsAt: {}, active: null, switchedAt: null, lastSwitch: null };
  try { s = { ...s, ...(JSON.parse(fs.readFileSync(f, 'utf8')) as Partial<KeyState>) }; } catch {  }
  g.__kxClaudeKeys = s; g.__kxClaudeKeysFile = f;
  return s;
}
function save(s: KeyState) { try { fs.writeFileSync(stateFile(), JSON.stringify(s), { mode: 0o600 }); } catch (e) { console.error('[claude] состояние ключей не записано', (e as Error).message); } }

export function setClaudeClientForTests(f: ((key: number) => Anthropic) | null) { g.__kxClaudeTest = f; g.__kxClaudeClients = new Map(); }
export function _resetClaudeKeys() { g.__kxClaudeKeys = undefined; g.__kxClaudeClients = new Map(); try { fs.rmSync(stateFile(), { force: true }); } catch {  } }

function clientFor(i: number): { client: Anthropic; last4: string } {
  if (g.__kxClaudeTest) return { client: g.__kxClaudeTest(i), last4: `k${i + 1}` };
  const f = keyFiles()[i];
  let fst: fs.Stats;
  try { fst = fs.statSync(f); } catch { throw new NoKeyError(`ключ ${i + 1}: файла нет`); }
  const base = process.env.KX_ANTHROPIC_BASE_URL || '';
  const sig = `${f}\u0000${fst.mtimeMs}\u0000${fst.size}\u0000${base}`;
  const map = (g.__kxClaudeClients ??= new Map());
  const hit = map.get(f);
  if (hit && hit.sig === sig) return hit;
  const apiKey = fs.readFileSync(f, 'utf8').trim();
  if (!apiKey) throw new NoKeyError(`ключ ${i + 1}: файл пуст`);
  const client = new Anthropic({
    apiKey,
    authToken: null,
    baseURL: base || 'https://api.anthropic.com',
    maxRetries: Number(process.env.KX_ANTHROPIC_RETRIES ?? 3),
    timeout: 15 * 60_000,
  });
  const v = { client, sig, last4: apiKey.slice(-4) };
  map.set(f, v);
  return v;
}

export function pickKey(now = Date.now()): number {
  const n = g.__kxClaudeTest ? Math.max(1, keyFiles().length) : keyFiles().length;
  if (!n) throw new NoKeyError('ключей Claude API нет в конфигурации');
  const s = st();
  for (let i = 0; i < n; i++) { const t = s.noFundsAt[String(i)]; if (!t || now - t >= RETRY_NO_FUNDS_MS()) return i; }
  let best = 0;
  for (let i = 1; i < n; i++) if ((s.noFundsAt[String(i)] ?? 0) < (s.noFundsAt[String(best)] ?? 0)) best = i;
  return best;
}

export function claudeClient(now = Date.now()): { client: Anthropic; key: number } {
  const key = pickKey(now);
  return { client: clientFor(key).client, key };
}

export function isNoFunds(e: unknown): boolean {
  if (!(e instanceof Anthropic.APIError)) return false;
  const t = (e as { type?: string | null }).type ?? (e.error as { error?: { type?: string } } | undefined)?.error?.type;
  return t === 'billing_error' || e.status === 402 || (e.status === 400 && /credit balance/i.test(e.message || ''));
}

export function keyOk(key: number, now = Date.now()) {
  const s = st();
  let dirty = false;
  if (s.noFundsAt[String(key)]) { delete s.noFundsAt[String(key)]; dirty = true; console.log(`[claude] ключ ${key + 1}: снова работает`); }
  if (s.active !== key) {
    if (s.active !== null) { s.lastSwitch = { from: s.active, to: key, at: now, why: key < s.active ? 'вернулся на основной' : 'без денег' }; s.switchedAt = now; }
    s.active = key; dirty = true;
  }
  if (dirty) save(s);
}

export function keyNoFunds(key: number, now = Date.now()): boolean {
  const s = st();
  s.noFundsAt[String(key)] = now;
  save(s);
  const next = pickKey(now);
  const other = next !== key;
  if (other) { s.lastSwitch = { from: key, to: next, at: now, why: 'без денег' }; s.switchedAt = now; s.active = next; save(s); }
  console.error(`[claude] ключ ${key + 1}: деньги кончились (billing_error)${other ? ` — переключаюсь на ключ ${next + 1}` : ' — других ключей с деньгами нет'}`);
  if (other) void import('./keyAlert').then((m) => m.alertAdmins(key, next)).catch((e) => console.error('[claude] push о ключе', (e as Error).message));
  return other;
}

export function keysView(now = Date.now()) {
  const files = keyFiles();
  const s = st();
  const cur = (() => { try { return pickKey(now); } catch { return null; } })();
  const last4 = (i: number) => { try { return clientFor(i).last4; } catch { return null; } };
  return {
    count: files.length,
    active: cur === null ? null : { n: cur + 1, last4: last4(cur), main: cur === 0 },
    switchedAt: s.switchedAt, lastSwitch: s.lastSwitch ? { from: s.lastSwitch.from + 1, to: s.lastSwitch.to + 1, at: s.lastSwitch.at, why: s.lastSwitch.why } : null,
    noFunds: Object.entries(s.noFundsAt).map(([k, at]) => ({ n: Number(k) + 1, last4: last4(Number(k)), at, retryAt: at + RETRY_NO_FUNDS_MS() })),
  };
}

export function providerClaudeClient(providerId: string, baseUrl?: string): Anthropic {
  if (g.__kxClaudeTest) return g.__kxClaudeTest(0);
  const apiKey = providerKey(providerId);
  if (!apiKey) throw new NoKeyError('у провайдера не задан ключ');
  const sig = `provider:${providerId}\u0000${apiKey.slice(-6)}\u0000${baseUrl ?? ''}`;
  const map = (g.__kxClaudeClients ??= new Map());
  const hit = map.get(sig);
  if (hit) return hit.client;
  const client = new Anthropic({ apiKey, authToken: null, baseURL: baseUrl || 'https://api.anthropic.com', maxRetries: Number(process.env.KX_ANTHROPIC_RETRIES ?? 3), timeout: 15 * 60_000 });
  map.set(sig, { client, sig, last4: apiKey.slice(-4) });
  return client;
}
