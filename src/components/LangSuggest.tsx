'use client';
import { useEffect, useState } from 'react';
import { suggestLang, tr, type Lang } from '@/lib/i18n/core';
import { langAsked, setLangAsked, useSetLang, useT } from '@/lib/i18n/react';
import { Icon } from './Icon';

export function LangSuggest() {
  const t = useT();
  const setLang = useSetLang();
  const [dev, setDev] = useState<Lang | null>(null);
  useEffect(() => {
    const list = navigator.languages?.length ? navigator.languages : [navigator.language];
    const d = suggestLang(list);
    if (!d || d === t.lang || langAsked(d)) return;
    let tm = 0;
    const show = () => {
      if (document.querySelector('.sheet, .scrim, .pop, .np, .ins-scrim, [role=dialog][aria-modal=true]')) { tm = window.setTimeout(show, 1500); return; }
      setDev(d);
    };
    tm = window.setTimeout(show, 2200);
    return () => window.clearTimeout(tm);
  }, [t.lang]);
  if (!dev) return null;
  const say = (k: Parameters<typeof tr>[1]) => tr(dev, k);
  return (
    <div className="lsg" role="region" aria-label={t('lang.pick')} lang={dev === 'sr' ? 'sr-Latn' : dev} data-testid="lang-suggest">
      <span className="lsg-ic" aria-hidden="true"><Icon n="globe" sm /></span>
      <p className="lsg-t">{say('lang.suggest')}</p>
      <div className="lsg-acts">
        <button type="button" className="btn btn--primary" data-testid="lang-suggest-yes" onClick={() => { setLangAsked(dev); setDev(null); void setLang(dev); }}>{say('lang.suggestYes')}</button>
        <button type="button" className="btn btn--ghost" data-testid="lang-suggest-no" onClick={() => { setLangAsked(dev); setDev(null); }}>{say('lang.suggestNo')}</button>
      </div>
    </div>
  );
}
