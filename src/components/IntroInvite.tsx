'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/react';
import { Button } from './Kit';
import { Icon } from './Icon';
import '@/styles/user-memory.css';

function variant(): string {
  try { const v = localStorage.getItem('kx.iiv'); return v === 'a' || v === 'b' || v === 'c' ? v : ''; } catch { return ''; }
}

export function IntroInvite() {
  const t = useT();
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [rules, setRules] = useState(0);
  useEffect(() => {
    let gone = false;
    void fetch('/api/memory/invite', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j: { show?: boolean; rules?: number } | null) => { if (!gone) { setShow(!!j?.show); setRules(j?.rules ?? 0); } }).catch(() => {});
    return () => { gone = true; };
  }, []);
  const act = (action: 'later' | 'never' | 'rules-seen') => { if (action === 'rules-seen') setRules(0); else setShow(false); void fetch('/api/memory/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).catch(() => {}); };
  if (rules > 0) return (
    <div className="ii" data-testid="rules-notice" role="status">
      <span className="ii-t"><b>{t('tools.invite.rules', { n: rules })}</b><small>{t('tools.invite.rulesS')}</small></span>
      <span className="ii-acts">
        <Button kind="secondary" onClick={() => { act('rules-seen'); router.push('/settings/memory'); }} testId="rules-open">{t('tools.invite.rulesOpen')}</Button>
        <button type="button" className="ii-lnk" onClick={() => act('rules-seen')} data-testid="rules-hide">{t('tools.invite.rulesHide')}</button>
      </span>
    </div>
  );
  if (!show) return null;
  const v = variant();
  const go = () => { setShow(false); router.push('/settings/memory#intro'); };
  if (v === 'a') return (
    <div className="iiv iiv-a" data-testid="intro-invite" data-variant="a" role="region" aria-label={t('tools.invite.vT')}>
      <span className="iiv-tile" aria-hidden="true"><span className="mark" /></span>
      <span className="iiv-body">
        <span className="iiv-h"><b>{t('tools.invite.vT')}</b><span className="iiv-time"><Icon n="clock" sm />{t('tools.invite.vTime')}</span></span>
        <small>{t('tools.invite.vS')}</small>
        <span className="iiv-quiet">
          <button type="button" onClick={() => act('later')} data-testid="invite-later">{t('tools.invite.later')}</button>
          <span aria-hidden="true">·</span>
          <button type="button" onClick={() => act('never')} data-testid="invite-never">{t('tools.invite.vNever')}</button>
        </span>
      </span>
      <Button kind="primary" onClick={go} testId="invite-go">{t('tools.invite.go')}</Button>
    </div>
  );
  if (v === 'b') return (
    <div className="iiv iiv-b" data-testid="intro-invite" data-variant="b" role="region" aria-label={t('tools.invite.vT')}>
      <span className="mark" aria-hidden="true" />
      <span className="iiv-body"><b>{t('tools.invite.vT')}</b><small>{t('tools.invite.vS')}</small></span>
      <Button kind="primary" onClick={go} testId="invite-go">{t('tools.invite.vGoTime')}</Button>
      <span className="iiv-more">
        <button type="button" className="iiv-never" onClick={() => act('never')} data-testid="invite-never">{t('tools.invite.vNever')}</button>
        <button type="button" className="icon-btn iiv-x" aria-label={t('tools.invite.later')} title={t('tools.invite.later')} onClick={() => act('later')} data-testid="invite-later"><Icon n="x" sm /></button>
      </span>
    </div>
  );
  if (v === 'c') return (
    <div className="iiv iiv-c" data-testid="intro-invite" data-variant="c" role="region" aria-label={t('tools.invite.vT')}>
      <button type="button" className="icon-btn iiv-x" aria-label={t('tools.invite.later')} title={t('tools.invite.later')} onClick={() => act('later')} data-testid="invite-later"><Icon n="x" sm /></button>
      <span className="iiv-h"><span className="mark" aria-hidden="true" /><b>{t('tools.invite.vT')}</b></span>
      <small>{t('tools.invite.vS')}</small>
      <span className="iiv-steps">{t('tools.invite.vSteps')}</span>
      <span className="iiv-row">
        <Button kind="primary" onClick={go} testId="invite-go">{t('tools.invite.go')}</Button>
        <span className="iiv-time"><Icon n="clock" sm />{t('tools.invite.vTime')}</span>
        <button type="button" className="iiv-never" onClick={() => act('never')} data-testid="invite-never">{t('tools.invite.vNever')}</button>
      </span>
    </div>
  );
  return (
    <div className="ii" data-testid="intro-invite" role="region" aria-label={t('tools.invite.t')}>
      <span className="ii-t"><b>{t('tools.invite.t')}</b><small>{t('tools.invite.s')}</small></span>
      <span className="ii-acts">
        <Button kind="primary" onClick={() => { setShow(false); router.push('/settings/memory#intro'); }} testId="invite-go">{t('tools.invite.go')}</Button>
        <button type="button" className="ii-lnk" onClick={() => act('later')} data-testid="invite-later">{t('tools.invite.later')}</button>
        <button type="button" className="ii-lnk" onClick={() => act('never')} data-testid="invite-never">{t('tools.invite.never')}</button>
      </span>
    </div>
  );
}
