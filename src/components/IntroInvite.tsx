'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/react';
import { Button } from './Kit';
import '@/styles/user-memory.css';

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
