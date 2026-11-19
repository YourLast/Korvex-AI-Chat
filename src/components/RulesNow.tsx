'use client';
import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { useLive } from '@/lib/live';
import type { RulesView } from '@/lib/memoryRules';
import { Button } from './Kit';
import '@/styles/user-memory.css';

const POLL_MS = 3000;

export function RulesNow({ bump = 0 }: { bump?: number }) {
  const t = useT();
  const [v, setV] = useState<RulesView | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch('/api/memory/rules', { cache: 'no-store' }).catch(() => null);
    if (r?.ok) setV((await r.json()) as RulesView);
  }, []);
  useEffect(() => { void load(); }, [load, bump]);
  useLive((e) => { if (e.t === 'memory') void load(); });
  const live = v?.state === 'queued' || v?.state === 'running';
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => { void load(); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [live, load]);
  const act = async (action: 'now' | 'later' | 'seen') => {
    setBusy(true);
    try {
      const r = await fetch('/api/memory/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).catch(() => null);
      if (r?.ok) setV((await r.json()) as RulesView);
    } finally { setBusy(false); }
  };
  const open = async () => {
    await act('seen');
    window.setTimeout(() => document.querySelector('[data-testid=mem-sec-rules]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  if (!v || v.state === 'none') return null;
  const box = (title: string, sub: string | null, acts: React.ReactNode, spin = false) => (
    <div className="ii rn" data-testid="rules-now" data-state={v.state} role="status" aria-live="polite">
      <span className="ii-t"><b>{spin && <span className="k-spin rn-spin" aria-hidden="true" />}{title}</b>{sub && <small>{sub}</small>}</span>
      {acts && <span className="ii-acts">{acts}</span>}
    </div>
  );
  if (v.state === 'offer') return box(t('tools.memset.rn.t'), t('tools.memset.rn.s'), <>
    <Button kind="primary" busy={busy} disabled={busy} onClick={() => void act('now')} testId="rn-go">{t('tools.memset.rn.go')}</Button>
    <button type="button" className="ii-lnk" disabled={busy} onClick={() => void act('later')} data-testid="rn-later">{t('tools.memset.rn.later')}</button>
  </>);
  if (v.state === 'queued') return box(t('tools.memset.rn.queued'), t('tools.memset.rn.runS'), null, true);
  if (v.state === 'running') return box(t('tools.memset.rn.run'), t('tools.memset.rn.runS'), null, true);
  if (v.state === 'failed') return box(t('tools.memset.rn.fail'), null, <Button kind="secondary" busy={busy} disabled={busy} onClick={() => void act('now')} testId="rn-retry">{t('tools.memset.rn.retry')}</Button>);
  return v.n > 0
    ? box(t('tools.memset.rn.done', { n: v.n }), t('tools.memset.rn.doneS'), <Button kind="secondary" onClick={() => void open()} testId="rn-open">{t('tools.memset.rn.open')}</Button>)
    : box(t('tools.memset.rn.none'), null, <button type="button" className="ii-lnk" onClick={() => void act('seen')} data-testid="rn-ok">{t('tools.memset.rn.ok')}</button>);
}
