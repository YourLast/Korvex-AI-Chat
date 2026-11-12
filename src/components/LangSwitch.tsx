'use client';
import { LANGS, LANG_NAMES, type Lang } from '@/lib/i18n/core';
import { useLang, useSetLang, useT } from '@/lib/i18n/react';
import { Icon } from './Icon';

const CODE: Record<Lang, string> = { ru: 'RU', en: 'EN', sr: 'SR' };

export function LangSwitch() {
  const lang = useLang(), set = useSetLang(), t = useT();
  return (
    <div className="lp" role="group" aria-label={t('lang.pick')} data-testid="lang-switch">
      <Icon n="globe" sm className="lp-ic" />
      {LANGS.map((l) => (
        <button key={l} type="button" className="lp-b" lang={l === 'sr' ? 'sr-Latn' : l} title={LANG_NAMES[l]} aria-label={LANG_NAMES[l]} aria-pressed={l === lang} data-testid={`lang-${l}`}
          onClick={() => { if (l !== lang) void set(l); }}>{CODE[l]}</button>
      ))}
    </div>
  );
}
