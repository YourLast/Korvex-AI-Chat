'use client';
import { useEffect, useState } from 'react';
import { errText } from '@/lib/i18n/errors';
import { useT } from '@/lib/i18n/react';
import { localeOf } from '@/lib/i18n/core';
import { hour12Of } from '@/lib/hourFormat';
import { Icon } from './Icon';
import { Button, Field, Group, KSolo, Notice } from './Kit';

export function LoginForm({ signupOpen, firstUser, support }: { signupOpen: boolean; firstUser: boolean; support?: { handle: string; email: string } }) {
  const t = useT();
  const [mode, setMode] = useState<'in' | 'up'>(firstUser ? 'up' : 'in');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!support) return;
    const q = new URLSearchParams(window.location.search);
    if (!q.has('seat')) return;
    const until = Number(q.get('seat')) || 0;
    let tz = q.get('tz') || undefined;
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { tz = undefined; }
    const when = until ? new Intl.DateTimeFormat(localeOf(t.lang), { timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: hour12Of(t.lang) }).format(new Date(until)) : '';
    setErr(`${until ? t('seat.pause24', { when }) : t('seat.pause')}\n\n${t('support.line', { tg: support.handle, email: support.email })}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await fetch(mode === 'in' ? '/api/auth/login' : '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw, name, lang: t.lang, timezone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ? errText(t.lang, (j as { error?: string }).error) : r.status === 401 ? t('e.badCreds') : t('auth.loginFail', { code: r.status }));
      window.location.href = '/';
    } catch (x) { setErr((x as Error).message === 'Failed to fetch' ? t('common.noNet') : (x as Error).message); setBusy(false); }
  };

  return (
    <KSolo>
      <form className="k-stack k-auth" onSubmit={submit} data-testid="login-form">
        <span className="mark" aria-hidden="true" style={{ ['--mark' as string]: '40px' }} />
        <div><h1>{mode === 'in' ? t('auth.loginTitle') : firstUser ? t('auth.firstAdmin') : t('auth.signupTitle')}</h1>
          <p className="k-lead">{mode === 'in' ? t('auth.loginLead') : t('auth.signupLead')}</p></div>
        <Group>
          {mode === 'up' && <Field label={t('auth.name')} value={name} onChange={setName} autoComplete="name" placeholder={t('auth.namePh')} id="name" />}
          <Field label={t('auth.email')} type="email" inputMode="email" required value={email} onChange={setEmail} autoComplete="email" placeholder={t('auth.emailPh')} testId="email" id="email" />
          <Field label={t('auth.password')} type={show ? 'text' : 'password'} required minLength={mode === 'up' ? 8 : 1} value={pw} onChange={setPw} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} placeholder="••••••••" testId="password" id="pw"
            trailing={<button type="button" className="k-icon-btn" aria-label={show ? t('auth.hidePw') : t('auth.showPw')} aria-pressed={show} onClick={(e) => { e.preventDefault(); setShow((s) => !s); }}><Icon n="eye" sm /></button>} />
        </Group>
        {err && <Notice><span style={{ whiteSpace: 'pre-line' }}>{err}</span></Notice>}
        <Button type="submit" kind="primary" size="lg" block busy={busy} testId="submit">{mode === 'in' ? t('auth.signIn') : t('auth.createAccount')}</Button>
        {!signupOpen && <p className="k-sec-foot k-center">{t('auth.noAccess')}</p>}
        {signupOpen && !firstUser && (
          <p className="k-sec-foot k-center">{mode === 'in' ? t('auth.noAccount') : t('auth.haveAccount')}
            <button type="button" className="k-link" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr(''); }}>{mode === 'in' ? t('auth.toSignup') : t('auth.toLogin')}</button></p>
        )}
      </form>
    </KSolo>
  );
}
