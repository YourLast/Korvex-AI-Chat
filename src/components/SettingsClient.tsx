'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { disablePush } from '@/lib/pushClient';
import { deviceId } from '@/lib/live';
import { LANGS, LANG_NAMES } from '@/lib/i18n/core';
import { errText } from '@/lib/i18n/errors';
import { useSetLang, useT } from '@/lib/i18n/react';
import { useCanInstall } from './InstallPrompt';
import { Button, Confirm, Field, Group, KPage, PickerRow, ReadField, Row, SelectRow, toast } from './Kit';

type Me = { name: string; email: string; timezone: string; role: string };

const FALLBACK_TZ = ['Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka', 'Europe/Minsk', 'Asia/Almaty', 'Asia/Dubai', 'Europe/Belgrade', 'Europe/Berlin', 'Europe/London', 'UTC'];
export const tzLabel = (z: string) => z.replace(/_/g, ' ');

export function SettingsClient({ me, children }: { me: Me; children?: ReactNode }) {
  const router = useRouter();
  const t = useT();
  const setLang = useSetLang();
  const canInstall = useCanInstall();
  const [name, setName] = useState(me.name);
  const [tz, setTz] = useState(me.timezone);
  const [saved, setSaved] = useState(me);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [ask, setAsk] = useState(false);
  const zones = useMemo(() => {
    let list: string[] = FALLBACK_TZ;
    try { list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? FALLBACK_TZ; } catch {  }
    return (list.includes(me.timezone) ? list : [me.timezone, ...list]).map((z) => ({ value: z, label: tzLabel(z) }));
  }, [me.timezone]);
  const browserTz = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } }, []);
  const dirty = name.trim() !== saved.name || tz !== saved.timezone;

  const save = async () => {
    if (!name.trim()) { toast(t('set.nameEmpty'), 'error'); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, timezone: tz }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; name?: string; timezone?: string };
      if (!r.ok) { toast(j.error ? errText(t.lang, j.error) : t('set.notSaved'), 'error'); return; }
      setSaved({ ...saved, name: j.name ?? saved.name, timezone: j.timezone ?? saved.timezone });
      setName(j.name ?? name);
      toast(t('set.saved'));
      router.refresh();
    } catch { toast(t('set.noNet'), 'error'); } finally { setBusy(false); }
  };
  const logout = async () => {
    setLeaving(true);
    await Promise.race([disablePush(), new Promise((r) => setTimeout(r, 1500))]);
    const r = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: deviceId() }) }).catch(() => null);
    if (r && !r.ok && r.status !== 401) { setLeaving(false); setAsk(false); toast(t('set.logoutFail'), 'error'); return; }
    window.location.href = '/login';
  };

  return (
    <KPage title={t('set.title')} sub={saved.email}  testId="settings">
      <Group title={t('set.account')} foot={browserTz && browserTz !== tz && zones.some((z) => z.value === browserTz)
        ? <>{t('set.tzHere', { tz: tzLabel(browserTz) })}<button type="button" className="k-link" onClick={() => setTz(browserTz)} data-testid="set-tz-browser">{t('set.tzUse')}</button></>
        : null}>
        <Field label={t('set.name')} value={name} maxLength={80} autoComplete="name" onChange={setName} testId="set-name" invalid={!name.trim()} />
        <ReadField label={t('set.email')} value={saved.email} testId="set-email" />
        <SelectRow title={t('set.tz')} value={tz} options={zones} onChange={setTz} testId="set-tz" />
      </Group>
      {dirty && (
        <div className="k-acts k-acts--end" data-testid="set-dirty">
          <Button kind="plain" onClick={() => { setName(saved.name); setTz(saved.timezone); }}>{t('set.revert')}</Button>
          <Button kind="primary" onClick={save} busy={busy} disabled={!name.trim()} testId="set-save">{t('common.save')}</Button>
        </div>
      )}

      <Group title={t('lang.setting')} foot={t('lang.settingSub')} testId="set-lang-group">
        <PickerRow title={t('lang.pick')} value={t.lang} testId="set-lang" onChange={(l) => { void setLang(l); }}
          options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l], testId: `set-lang-${l}` }))} />
      </Group>

      {canInstall && (
        <Group foot={t('install.menuSub')}>
          <Row title={t('install.menu')} icon="download" onClick={() => window.dispatchEvent(new CustomEvent('kx:install-open'))} testId="set-install" />
        </Group>
      )}

      {children}

      <Group foot={t('set.thisDevice')}>
        <Row title={t('set.logout')} icon="lock" onClick={() => setAsk(true)} disabled={leaving} testId="set-logout" />
        <Confirm open={ask} title={t('shell.logoutTitle')} message={t('shell.logoutText')} action={t('shell.logout')} busy={leaving}
          onCancel={() => setAsk(false)} onConfirm={logout} />
      </Group>
    </KPage>
  );
}
