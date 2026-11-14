'use client';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { disablePush, enablePush, pushEnv, pushOn, testPush, type PushEnv } from '@/lib/pushClient';
import { deniedHint } from '@/lib/notifyPrompt';
import { Group, Row, SwitchRow } from './Kit';
import { TimeField } from './TimeField';
import { tzLabel } from './SettingsClient';

export function NotifySettings({ quiet: quiet0, timezone }: { quiet: string | null; timezone: string }) {
  const t = useT();
  const [quiet, setQuiet] = useState<string | null>(quiet0);
  const pad = (t: string) => t.replace(/^(\d):/, '0$1:');
  const [qa, qb] = (quiet ?? '23:00-08:00').split('-');
  const [env, setEnv] = useState<PushEnv | null>(null);
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setEnv(pushEnv()); void pushOn().then(setOn); }, []);

  const saveQuiet = async (v: string | null) => {
    const prev = quiet; setQuiet(v);
    const r = await fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notifyQuiet: v }) }).catch(() => null);
    if (!r?.ok) { setQuiet(prev); setMsg({ ok: false, text: t('tools.notify.quietFail') }); }
  };
  const iphoneTab = !!env && env.ios && !env.standalone;
  const denied = env?.permission === 'denied';
  const can = !!env && env.supported && !env.iosOld && !denied && !iphoneTab;
  const why = !env ? ''
    : iphoneTab ? t('tools.notify.iosTab')
    : env.iosOld ? t('tools.notify.iosOld')
    : !env.supported ? t('tools.notify.unsupported')
    : denied ? deniedHint(env, navigator.userAgent, t.lang)
    : '';

  const turnOn = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await enablePush(t.lang);
      setEnv(pushEnv());
      if (r.ok) { setOn(true); setMsg({ ok: true, text: t('tools.notify.enabled') }); } else setMsg({ ok: false, text: r.error ?? t('tools.notify.enableFail') });
    } finally { setBusy(false); }
  };
  const turnOff = async () => { setBusy(true); setMsg(null); try { await disablePush(); setOn(false); setMsg({ ok: true, text: t('tools.notify.disabled') }); } finally { setBusy(false); } };
  const test = async () => { setBusy(true); setMsg(null); try { const r = await testPush(t.lang); setMsg(r.ok ? { ok: true, text: t('tools.notify.sent') } : { ok: false, text: r.error ?? t('tools.notify.testFail') }); } finally { setBusy(false); } };

  return (
    <>
      <Group title={t('tools.notify.title')} testId="notify"
        foot={<>
          {msg && <span className={msg.ok ? 'k-ok' : 'k-neg'} role="status" data-testid="push-msg">{msg.text}<br /></span>}
          {why || t('tools.notify.foot')}
        </>}>
        <SwitchRow title={t('tools.notify.device')} sub={on ? undefined : t('tools.notify.deviceSub')} checked={!!on} disabled={busy || on === null || (!on && !can)}
          onChange={(v) => void (v ? turnOn() : turnOff())} testId={on ? 'push-off' : 'push-on'} />
        {on && <Row title={t('tools.notify.test')} onClick={test} disabled={busy} testId="push-test" />}
        <SwitchRow title={t('tools.notify.quiet')} sub={quiet ? t('tools.notify.quietSub') : undefined}
          checked={!!quiet} onChange={(v) => void saveQuiet(v ? '23:00-08:00' : null)} testId="quiet-switch" />
        {quiet && <>
          <Row title={t('tools.notify.from')} right={<TimeField value={pad(qa)} lang={t.lang} label={t('tools.notify.quietFrom')} testId="quiet-from" onChange={(v) => void saveQuiet(`${v}-${pad(qb)}`)} />} />
          <Row title={t('tools.notify.to')} right={<TimeField value={pad(qb)} lang={t.lang} label={t('tools.notify.quietTo')} testId="quiet-to" onChange={(v) => void saveQuiet(`${pad(qa)}-${v}`)} />} />
        </>}
      </Group>
      {iphoneTab && (
        <Group title={t('tools.notify.iosTitle')} testId="ios-hint" foot={undefined}>
          <Row title={t('tools.notify.ios1')} sub={t('tools.notify.ios1sub')} />
          <Row title={t('tools.notify.ios2')} sub={t('tools.notify.ios2sub')} />
          <Row title={t('tools.notify.ios3')} sub={t('tools.notify.ios3sub')} />
        </Group>
      )}
    </>
  );
}
