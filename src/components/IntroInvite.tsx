'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/react';
import { Button } from './Kit';
import { Icon } from './Icon';
import '@/styles/user-memory.css';

const OUT_MS = 180;

export function useLeave(): [boolean, (then: () => void) => void] {
  const [out, setOut] = useState(false);
  const tm = useRef<number | null>(null);
  useEffect(() => () => { if (tm.current) window.clearTimeout(tm.current); }, []);
  const leave = (then: () => void) => {
    let reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {  }
    setOut(true);
    tm.current = window.setTimeout(() => { setOut(false); then(); }, reduced ? 90 : OUT_MS);
  };
  return [out, leave];
}

export function Widget({ title, sub, acts, out, spin, testId, state, role = 'region' }: { title: string; sub?: string | null; acts?: ReactNode; out?: boolean; spin?: boolean; testId: string; state?: string; role?: 'region' | 'status' }) {
  return (
    <div className={`iiv${out ? ' is-out' : ''}`} data-testid={testId} data-state={state} role={role} aria-label={role === 'region' ? title : undefined} aria-live={role === 'status' ? 'polite' : undefined}>
      {spin ? <span className="k-spin iiv-spin" aria-hidden="true" /> : <span className="mark" aria-hidden="true" />}
      <span className="iiv-body" key={title}><b>{title}</b>{sub && <small>{sub}</small>}</span>
      {acts && <span className="iiv-acts">{acts}</span>}
    </div>
  );
}

export function IntroInvite() {
  const t = useT();
  const router = useRouter();
  const [rules, setRules] = useState(0);
  const [night, setNight] = useState<{ notes: number; norms: number; fixes?: { id: string; th: string; fix: string }[] } | null>(null);
  const [out, leave] = useLeave();
  useEffect(() => {
    let gone = false;
    void fetch('/api/memory/invite', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j: { rules?: number; night?: { notes: number; norms: number; fixes?: { id: string; th: string; fix: string }[] } | null } | null) => { if (!gone) { setRules(j?.rules ?? 0); setNight(j?.night ?? null); } }).catch(() => {});
    return () => { gone = true; };
  }, []);
  const send = (action: string) => { void fetch('/api/memory/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).catch(() => {}); };
  const post = () => send('rules-seen');
  if (rules <= 0 && night) {
    const fix = night.fixes?.[0];
    const parts = [night.notes ? t('tools.invite.nightNotes', { n: night.notes }) : '', night.norms ? t('tools.invite.nightNorms', { n: night.norms }) : ''].filter(Boolean);
    const sum = parts.length ? t('tools.invite.night', { a: parts.join(', ') }) : null;
    return (
    <Widget testId="night-notice" role="status" out={out} title={fix ? fix.fix : sum ?? ''} sub={fix ? sum : null} acts={<>
      <Button kind="primary" onClick={() => { send('night-seen'); router.push(fix ? `/c/${fix.th}#m-${fix.id}` : '/settings/memory'); }} testId="night-open">{t(fix ? 'tools.invite.nightChat' : 'tools.invite.rulesOpen')}</Button>
      <button type="button" className="icon-btn iiv-x" aria-label={t('tools.invite.rulesHide')} title={t('tools.invite.rulesHide')} onClick={() => { send('night-seen'); leave(() => setNight(null)); }} data-testid="night-hide"><Icon n="x" sm /></button>
    </>} />
    );
  }
  if (rules <= 0) return null;
  return (
    <Widget testId="rules-notice" role="status" out={out} title={t('tools.invite.rules', { n: rules })} sub={t('tools.invite.rulesS')} acts={<>
      <Button kind="primary" onClick={() => { post(); router.push('/settings/memory'); }} testId="rules-open">{t('tools.invite.rulesOpen')}</Button>
      <button type="button" className="icon-btn iiv-x" aria-label={t('tools.invite.rulesHide')} title={t('tools.invite.rulesHide')} onClick={() => { post(); leave(() => setRules(0)); }} data-testid="rules-hide"><Icon n="x" sm /></button>
    </>} />
  );
}
