'use client';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useLive } from '@/lib/live';
import { useT } from '@/lib/i18n/react';
import type { Key } from '@/lib/i18n/core';

type Notice = { id: string; kind: string };
type Support = { handle: string; email: string };
const KEY: Record<string, Key> = { seat_warn: 'seat.warn', week80: 'week.80', week_soft: 'week.soft' };

export function SeatNotices() {
  const t = useT();
  const [list, setList] = useState<Notice[]>([]);
  const [sup, setSup] = useState<Support | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/seat', { cache: 'no-store' });
      if (!r.ok) return;
      const j = (await r.json()) as { notices?: Notice[]; support?: Support; week?: { phase?: string } | null };
      setWeekOver(j.week?.phase === 'over');
      setList((j.notices ?? []).filter((n) => KEY[n.kind]));
      if (j.support) setSup(j.support);
    } catch {  }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useLive((e) => { if (e.t === 'notice' || (e.t === 'job' && e.status === 'queued')) void load(); });
  const n = list[0];
  if (!n || !sup || typeof document === 'undefined') return null;
  const close = () => {
    setList((x) => x.filter((y) => y.id !== n.id));
    void fetch('/api/seat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dismiss: n.id }) }).catch(() => {});
  };
  return createPortal(
    <div className="k-alert-scrim" data-testid="seat-notice-scrim">
      <div className="k-alert" role="alertdialog" aria-modal="true" aria-label={t(KEY[n.kind])} data-testid="seat-notice" data-kind={n.kind}>
        <div className="k-alert-t">
          <p style={{ margin: 0 }}>{t(KEY[n.kind])}</p>
          <p className="t-cap" style={{ margin: 'var(--s-3) 0 0' }} data-testid="seat-notice-support">{t('support.line', { tg: sup.handle, email: sup.email })}</p>
        </div>
        <div className="k-alert-a">
          <button type="button" className="k-btn k-btn--primary k-btn--lg" onClick={close} data-testid="seat-notice-ok" autoFocus>{t('seat.ok')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

let weekOver = false;
const subs = new Set<() => void>();
const setWeekOver = (v: boolean) => { if (v !== weekOver) { weekOver = v; subs.forEach((f) => f()); } };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export function WeekLine() {
  const t = useT();
  const over = useSyncExternalStore(subscribe, () => weekOver, () => false);
  if (!over) return null;
  return <p className="t-cap week-line" role="note" data-testid="week-line" style={{ margin: '0 0 var(--s-2)', textAlign: 'center' }}>{t('week.line')}</p>;
}
