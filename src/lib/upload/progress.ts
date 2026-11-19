import type { UpProgress } from '../uploadProgress';
import type { TFn } from '../i18n/core';

export type { UpProgress };

export function newPid(): string {
  const hex = (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`).replace(/[^0-9a-f]/gi, '');
  return `up-${hex.slice(0, 32).padEnd(16, '0')}`;
}

export function pollProgress(id: string, on: (p: UpProgress) => void, o: { fetch?: typeof fetch; firstMs?: number; everyMs?: number } = {}): () => void {
  const f = o.fetch ?? fetch;
  let stopped = false, tm: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    if (stopped) return;
    let p: UpProgress | null = null;
    try { const r = await f(`/api/files/progress?id=${encodeURIComponent(id)}`, { cache: 'no-store' }); if (r.ok) p = (await r.json()) as UpProgress; } catch {  }
    if (stopped) return;
    if (p?.state === 'none') { stopped = true; return; }
    if (p) on(p);
    tm = setTimeout(tick, o.everyMs ?? 2000);
  };
  tm = setTimeout(tick, o.firstMs ?? 1500);
  return () => { stopped = true; if (tm) clearTimeout(tm); };
}

export function progText(tx: TFn, p: UpProgress | null | undefined): string | null {
  if (!p) return null;
  const eta = p.eta != null && p.eta > 0 ? (p.eta < 60 ? tx('up.p.etaLt1') : tx('up.p.eta', { n: Math.round(p.eta / 60) })) : '';
  switch (p.state) {
    case 'queued': return tx('up.p.queued');
    case 'parsing': return tx('up.p.parsing');
    case 'reading': {
      if (!p.pages) return tx('comp.reading');
      const page = tx('up.p.page', { n: Math.min((p.done ?? 0) + 1, p.pages), m: p.pages });
      if ((p.eyes ?? 0) > 0 && (p.waited ?? 0) >= 5) return `${page} · ${tx('up.p.waitEyes')}`;
      return eta ? `${page} · ${eta}` : page;
    }
    case 'checking': return tx('up.p.checking');
    case 'done': return tx('up.p.done');
    default: return null;
  }
}
