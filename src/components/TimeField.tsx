'use client';
import { useEffect, useState } from 'react';
import { from12, hour12Of, parseHM, to12, toHM } from '@/lib/hourFormat';
import type { Lang } from '@/lib/i18n/core';

type Props = { value: string; onChange: (v: string) => void; lang: Lang; label: string; testId?: string };

export function TimeField({ value, onChange, lang, label, testId }: Props) {
  const [h12, setH12] = useState(lang === 'en');
  useEffect(() => { setH12(hour12Of(lang)); }, [lang]);
  const p = parseHM(value) ?? { h: 0, m: 0 };
  const t = to12(p.h);
  const shown = h12 ? t.h : p.h;
  const [hs, setHs] = useState(String(shown).padStart(2, '0'));
  const [ms, setMs] = useState(String(p.m).padStart(2, '0'));
  useEffect(() => { setHs(String(shown).padStart(2, '0')); setMs(String(p.m).padStart(2, '0')); }, [shown, p.m]);

  const commit = (hRaw: string, mRaw: string, pm = t.pm) => {
    const hn = Number(hRaw), mn = Number(mRaw);
    if (!/^\d{1,2}$/.test(hRaw) || !/^\d{1,2}$/.test(mRaw) || mn > 59) return;
    if (h12 ? hn < 1 || hn > 12 : hn > 23) return;
    const v = toHM(h12 ? from12(hn, pm) : hn, mn);
    if (v !== value) onChange(v);
  };
  const step = (part: 'h' | 'm', d: number) => {
    const total = (p.h * 60 + p.m + (part === 'h' ? d * 60 : d) + 1440) % 1440;
    onChange(toHM(Math.floor(total / 60), total % 60));
  };
  const key = (part: 'h' | 'm') => (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); step(part, e.key === 'ArrowUp' ? 1 : -1); }
  };
  const digits = (s: string) => s.replace(/\D/g, '').slice(0, 2);
  return (
    <span className="k-time" role="group" aria-label={label} data-testid={testId} data-value={value}>
      <input className="k-inl k-time-n" inputMode="numeric" maxLength={2} value={hs} aria-label={`${label}: ${lang === 'ru' ? 'часы' : lang === 'sr' ? 'sati' : 'hours'}`}
        onChange={(e) => { const v = digits(e.target.value); setHs(v); commit(v, ms); }} onBlur={() => setHs(String(shown).padStart(2, '0'))}
        onFocus={(e) => e.target.select()} onKeyDown={key('h')} data-testid={testId ? `${testId}-h` : undefined} />
      <span className="k-time-sep" aria-hidden="true">:</span>
      <input className="k-inl k-time-n" inputMode="numeric" maxLength={2} value={ms} aria-label={`${label}: ${lang === 'ru' ? 'минуты' : lang === 'sr' ? 'minuti' : 'minutes'}`}
        onChange={(e) => { const v = digits(e.target.value); setMs(v); commit(hs, v); }} onBlur={() => setMs(String(p.m).padStart(2, '0'))}
        onFocus={(e) => e.target.select()} onKeyDown={key('m')} data-testid={testId ? `${testId}-m` : undefined} />
      {h12 && (
        <button type="button" className="k-time-ap" aria-label={`${label}: AM/PM`} data-testid={testId ? `${testId}-ap` : undefined}
          onClick={() => onChange(toHM(from12(t.h, !t.pm), p.m))}>{t.pm ? 'PM' : 'AM'}</button>
      )}
    </span>
  );
}
