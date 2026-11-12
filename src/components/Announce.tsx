'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ModelState, StatusView } from '@/lib/announce';
import { useT } from '@/lib/i18n/react';
import { browserTimeZone } from '@/lib/tz';
import { Icon } from './Icon';

export const StatusCtx = createContext<StatusView | null>(null);

export function useModelState(modelId: string): ModelState | null {
  return useContext(StatusCtx)?.models[modelId]?.state ?? null;
}

const POLL_MS = 20_000;
const KEY = 'kx.ann.hidden';

export function useStatusPoll(initial: StatusView | null): StatusView | null {
  const [st, setSt] = useState<StatusView | null>(initial);
  const busy = useRef(false);
  const load = useCallback(async () => {
    if (busy.current || document.visibilityState === 'hidden') return;
    busy.current = true;
    try {
      const tz = browserTimeZone();
      const r = await fetch(`/api/status${tz ? `?tz=${encodeURIComponent(tz)}` : ''}`, { cache: 'no-store' });
      if (r.ok) setSt((await r.json()) as StatusView);
    } catch {  } finally { busy.current = false; }
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { void load(); }, POLL_MS);
    const on = () => { void load(); };
    document.addEventListener('visibilitychange', on);
    window.addEventListener('online', on);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', on); window.removeEventListener('online', on); };
  }, [load]);
  return st;
}

function readHidden(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, string>; } catch { return {}; }
}

export function Announce() {
  const t = useT();
  const st = useContext(StatusCtx);
  const [hidden, setHidden] = useState<Record<string, string>>({});
  useEffect(() => setHidden(readHidden()), []);
  const hide = (id: string, sig: string) => {
    const next = { ...readHidden(), [id]: sig };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {  }
    setHidden(next);
  };
  const shown = (st?.banners ?? []).filter((b) => hidden[b.id] !== b.sig);
  if (!shown.length) return null;
  return (
    <div className="ann-wrap" data-testid="announce">
      {shown.map((b) => (
        <div key={b.id} className={`ann ann--${b.level}`} role={b.level === 'warn' ? 'alert' : 'status'} data-testid={`ann-${b.id}`} data-level={b.level}>
          <i className="ann-dot" aria-hidden="true" />
          <span className="ann-t">{b.text}</span>
          <button type="button" className="icon-btn ann-x" aria-label={t('shell.annHide')} data-testid={`ann-hide-${b.id}`} onClick={() => hide(b.id, b.sig)}><Icon n="x" sm /></button>
        </div>
      ))}
    </div>
  );
}

export function StateTag({ state, full, className }: { state: ModelState; full?: boolean; className?: string }) {
  const t = useT();
  return <span className={`st st--${state}${className ? ' ' + className : ''}`} data-state={state}><i className="st-dot" aria-hidden="true" /><span className="st-w">{full ? t(`state.${state}`) : t(`state.${state}Short`)}</span></span>;
}
