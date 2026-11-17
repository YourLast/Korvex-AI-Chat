'use client';
import { useEffect, useState } from 'react';
import { errText } from '@/lib/i18n/errors';
import { useT } from '@/lib/i18n/react';
import type { Key } from '@/lib/i18n/core';
import type { InviteState } from '@/lib/invites';
import { Button, EmptyState, Field, Group, KSolo, Notice } from './Kit';

const BAD: Record<Exclude<InviteState, 'ok'>, { title: Key; text: Key }> = {
  unknown: { title: 'auth.invite.unknown', text: 'auth.invite.unknownText' },
  expired: { title: 'auth.invite.expired', text: 'auth.invite.expiredText' },
  used_up: { title: 'auth.invite.usedUp', text: 'auth.invite.usedUpText' },
  revoked: { title: 'auth.invite.revoked', text: 'auth.invite.revokedText' },
};
const CODE: Record<string, Key> = { unknown: 'e.inviteBad', expired: 'e.inviteExpired', used_up: 'e.inviteUsedUp', revoked: 'e.inviteRevoked', email_taken: 'e.emailTaken', email_mismatch: 'e.inviteEmail' };

export function InviteForm({ token, state, seats: seatsIn = null, email: bound = null }: { token: string; state: InviteState; seats?: { left: number; max: number } | null; email?: string | null }) {
  const t = useT();
  const [email, setEmail] = useState(bound ?? '');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [gone, setGone] = useState<InviteState | null>(null);
  const [busy, setBusy] = useState(false);
  const [seats, setSeats] = useState(seatsIn);
  const group = !!seatsIn;
  useEffect(() => {
    if (!group) return;
    let off = false;
    const pull = async () => {
      try {
        const r = await fetch(`/api/auth/invite?t=${encodeURIComponent(token)}`, { cache: 'no-store' });
        if (!r.ok || off) return;
        const j = await r.json() as { state: InviteState; left?: number; max?: number };
        if (off) return;
        if (j.state !== 'ok') setGone(j.state); else setSeats((x) => ({ left: j.left ?? 0, max: j.max ?? x?.max ?? 0 }));
      } catch {  }
    };
    const tick = () => { if (document.visibilityState === 'visible') void pull(); };
    const id = window.setInterval(tick, 15_000);
    document.addEventListener('visibilitychange', tick);
    return () => { off = true; window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [token, group]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await fetch('/api/auth/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, email, name, password: pw, lang: t.lang }) });
      const j = await r.json().catch(() => ({})) as { error?: string; code?: string };
      if (!r.ok) {
        if (r.status === 410 && j.code && j.code in BAD) { setGone(j.code as InviteState); return; }
        setErr(j.code && CODE[j.code] ? t(CODE[j.code]) : j.error ? errText(t.lang, j.error) : t('common.failCode', { code: r.status })); setBusy(false); return;
      }
      window.location.href = '/';
    } catch { setErr(t('common.noNet')); setBusy(false); }
  };
  const bad = gone ?? (state === 'ok' ? null : state);
  if (bad && bad !== 'ok') return (
    <KSolo testId="invite-bad">
      <EmptyState icon="lock" title={t(BAD[bad].title)} text={t(BAD[bad].text)} testId={`invite-${bad}`}>
        <Button kind="secondary" size="lg" href="/login">{t('auth.toLoginPage')}</Button>
      </EmptyState>
    </KSolo>
  );
  const short = !!pw && pw.length < 8;
  return (
    <KSolo>
      <form className="k-stack k-auth" onSubmit={submit} data-testid="invite-register">
        <span className="mark" aria-hidden="true" style={{ ['--mark' as string]: '40px' }} />
        <div className="inv-hero">
          <h1>{t('auth.inviteTitle')}</h1>
          <p className="inv-pitch" data-testid="invite-pitch">{t('auth.pitch')}</p>
          {seats && <p className="inv-seats" role="status" data-testid="invite-seats">{t('auth.seatsLeft', { left: seats.left, max: seats.max })}</p>}
        </div>
        <Group foot={short ? <span className="k-neg">{t('auth.pwShort')}</span> : t('auth.pwHint')}>
          <Field label={t('auth.email')} type="email" inputMode="email" required value={email} onChange={setEmail} autoComplete="email" placeholder={t('auth.emailPh')} testId="inv-email" id="e" readOnly={!!bound} />
          <Field label={t('auth.name')} value={name} onChange={setName} autoComplete="name" placeholder={t('auth.nameFullPh')} id="n" />
          <Field label={t('auth.password')} type="password" required minLength={8} value={pw} onChange={setPw} autoComplete="new-password" testId="inv-password" id="p" invalid={short} />
        </Group>
        {err && <Notice>{err}</Notice>}
        <Button type="submit" kind="primary" size="lg" block busy={busy} testId="inv-submit">{t('auth.createAccount')}</Button>
      </form>
    </KSolo>
  );
}
