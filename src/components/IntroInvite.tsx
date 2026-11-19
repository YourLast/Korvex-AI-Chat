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
  const [show, setShow] = useState(false);
  const [rules, setRules] = useState(0);
  const [ty, setTy] = useState(false);
  const [out, leave] = useLeave();
  useEffect(() => {
    let gone = false;
    void fetch('/api/memory/invite', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j: { show?: boolean; rules?: number; ty?: boolean } | null) => { if (!gone) { setShow(!!j?.show); setRules(j?.rules ?? 0); setTy(!!j?.ty); } }).catch(() => {});
    return () => { gone = true; };
  }, []);
  const post = (action: 'later' | 'never' | 'rules-seen') => { void fetch('/api/memory/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).catch(() => {}); };
  const act = (action: 'later' | 'never' | 'rules-seen') => { post(action); leave(() => { if (action === 'rules-seen') setRules(0); else setShow(false); }); };
  if (rules > 0) return (
    <Widget testId="rules-notice" role="status" out={out} title={t('tools.invite.rules', { n: rules })} sub={t('tools.invite.rulesS')} acts={<>
      <Button kind="primary" onClick={() => { post('rules-seen'); router.push('/settings/memory'); }} testId="rules-open">{t('tools.invite.rulesOpen')}</Button>
      <button type="button" className="icon-btn iiv-x" aria-label={t('tools.invite.rulesHide')} title={t('tools.invite.rulesHide')} onClick={() => act('rules-seen')} data-testid="rules-hide"><Icon n="x" sm /></button>
    </>} />
  );
  if (!show) return null;
  const go = () => { setShow(false); router.push('/settings/memory#intro'); };
  return (
    <Widget testId="intro-invite" out={out} title={t(ty ? 'tools.invite.vTTy' : 'tools.invite.vT')} sub={t(ty ? 'tools.invite.vSTy' : 'tools.invite.vS')} acts={<>
      <Button kind="primary" onClick={go} testId="invite-go">{t('tools.invite.vGoTime')}</Button>
      <button type="button" className="iiv-never" onClick={() => act('never')} data-testid="invite-never">{t('tools.invite.vNever')}</button>
      <button type="button" className="icon-btn iiv-x" aria-label={t('tools.invite.later')} title={t('tools.invite.later')} onClick={() => act('later')} data-testid="invite-later"><Icon n="x" sm /></button>
    </>} />
  );
}
