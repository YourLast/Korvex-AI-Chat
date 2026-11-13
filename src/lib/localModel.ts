import { cfg } from './cfg';
import { getSetting, setSetting } from './settings';
import { saveAdminModel, saveProvider } from './providers';
import { tr, type Lang } from './i18n/core';
import type { BannerView } from './announce';

export const LOCAL_ID = 'local';
const FAILS_SHOWN = 3;

type Pull = { state: 'idle' | 'pulling' | 'ready' | 'error'; done: number; total: number; error: string; fails: number };
type G = { pull: Pull; started: boolean; timer?: ReturnType<typeof setTimeout> };
const g = globalThis as unknown as { __kxLocal?: G };
const st = (): G => (g.__kxLocal ??= { pull: { state: 'idle', done: 0, total: 0, error: '', fails: 0 }, started: false });

export function localConf(): { url: string; model: string } | null {
  const url = cfg('KX_OLLAMA_URL').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
  const model = cfg('KX_LOCAL_MODEL').trim();
  return url && model ? { url, model } : null;
}

export const localPull = (): Pull => ({ ...st().pull });

export function prettyName(model: string): string {
  const [name, tag = ''] = model.split(':');
  const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w);
  const words = name.replace(/([a-z])(\d)/gi, '$1 $2').split(/[-_\s]+/).filter(Boolean).map(cap);
  if (tag && tag !== 'latest') words.push(/^[a-z]?\d+(\.\d+)?[bm]$/i.test(tag) ? tag.toUpperCase() : tag.split(/[-_]/).map(cap).join(' '));
  return words.join(' ');
}

export function ensureLocalEntries(c: { url: string; model: string }) {
  if (getSetting<boolean>('local.added', false)) return;
  const providerId = saveProvider({ name: 'Local (Ollama)', kind: 'ollama', baseUrl: c.url + '/v1' });
  saveAdminModel({ id: LOCAL_ID, providerId, upstreamModel: c.model, name: prettyName(c.model), fullName: `${prettyName(c.model)} (local)`,
    blurb: 'Runs on this server, no API key', tools: true, contextTokens: 8192, maxOutputTokens: 2048, maxConcurrent: 1 });
  setSetting('local.added', true);
}

const has = (models: { name?: string; model?: string }[] | undefined, want: string) =>
  (models ?? []).some((m) => [m.name, m.model].some((n) => n === want || n === `${want}:latest`));

export async function pullOnce(c: { url: string; model: string }, doFetch: typeof fetch = fetch): Promise<void> {
  const s = st();
  const tags = (await (await doFetch(c.url + '/api/tags', { signal: AbortSignal.timeout(10_000) })).json()) as { models?: { name?: string; model?: string }[] };
  if (has(tags.models, c.model)) { s.pull = { state: 'ready', done: 0, total: 0, error: '', fails: 0 }; return; }
  const r = await doFetch(c.url + '/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: c.model, stream: true }) });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const total = new Map<string, number>();
  const done = new Map<string, number>();
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  s.pull = { state: 'pulling', done: 0, total: 0, error: '', fails: s.pull.fails };
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const j = JSON.parse(line) as { status?: string; digest?: string; total?: number; completed?: number; error?: string };
      if (j.error) throw new Error(j.error);
      if (j.digest && j.total) { total.set(j.digest, j.total); done.set(j.digest, j.completed ?? 0); }
      s.pull = { ...s.pull, done: sum(done), total: sum(total) };
      if (j.status === 'success') { s.pull = { state: 'ready', done: 0, total: 0, error: '', fails: 0 }; return; }
    }
  }
  throw new Error('download interrupted');
}

export async function attempt(c: { url: string; model: string }, doFetch: typeof fetch = fetch): Promise<boolean> {
  try { await pullOnce(c, doFetch); return st().pull.state === 'ready'; } catch (e) {
    const p = st().pull;
    st().pull = { ...p, state: 'error', error: (e as Error).message.slice(0, 120), fails: p.fails + 1 };
    return false;
  }
}

export function startLocalModel() {
  const c = localConf();
  const s = st();
  if (!c || s.started) return;
  s.started = true;
  try { ensureLocalEntries(c); } catch (e) { console.error('[local] admin entries', (e as Error).message); }
  const loop = async (delay: number) => {
    if (await attempt(c)) return;
    s.timer = setTimeout(() => void loop(Math.min(delay * 2, 300_000)), delay);
    s.timer.unref?.();
  };
  void loop(5_000);
}

export const localReady = (): boolean => !localConf() || st().pull.state === 'ready';

export function localBanner(lang: Lang): BannerView | null {
  const c = localConf();
  if (!c) return null;
  const p = st().pull;
  const model = prettyName(c.model);
  if (p.state === 'pulling') {
    const pct = p.total ? Math.min(99, Math.floor((p.done / p.total) * 100)) : 0;
    return { id: 'local', sig: 'local-pull', level: 'info', text: tr(lang, 'srv.localPull', { model, pct: String(pct) }) };
  }
  if (p.state === 'error' && p.fails >= FAILS_SHOWN) return { id: 'local', sig: 'local-fail', level: 'warn', text: tr(lang, 'srv.localFail', { model, err: p.error }) };
  return null;
}

export function _resetLocalForTests() { if (g.__kxLocal?.timer) clearTimeout(g.__kxLocal.timer); g.__kxLocal = undefined; }
