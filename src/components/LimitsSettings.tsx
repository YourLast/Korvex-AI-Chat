'use client';
import type { WeekPhase } from '@/lib/week';
import { localeOf } from '@/lib/i18n/core';
import { useT } from '@/lib/i18n/react';
import { Group, KPage, Notice, Row } from './Kit';
import { Icon } from './Icon';
import '@/styles/limits.css';

export type LimitsData = { limited: boolean; pct: number; phase: WeekPhase; resetAt: number; tz: string; support: { tg: string; handle: string; email: string } };

const PHASE_TEXT = { warn: 'week.80', over: 'week.soft', blocked: 'week.hard' } as const;

function resetDate(ts: number, tz: string, locale: string): string {
  try { return new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'long', timeZone: tz }); } catch { return new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'long' }); }
}

export function LimitsSettings({ d }: { d: LimitsData }) {
  const t = useT();
  const shown = d.limited ? Math.min(100, Math.max(0, d.pct)) : Math.max(0, d.pct);
  const fill = Math.min(100, shown);
  const note = d.limited && d.phase !== 'ok' ? PHASE_TEXT[d.phase] : undefined;
  return (
    <KPage title={t('shell.limits')} testId="limits">
      <Group title={t('lim.week')} foot={t('lim.about')} testId="lim-week">
        <div className="lim-week" data-phase={d.limited ? d.phase : 'none'}>
          <div className="lim-top">
            <span className="lim-pct" data-testid="lim-pct">{d.limited ? t('lim.used', { pct: String(shown) }) : t('lim.none')}</span>
          </div>
          <div className="lim-bar" role="progressbar" aria-label={t('lim.week')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill} data-testid="lim-bar"><i style={{ width: `${fill}%` }} /></div>
          <span className="lim-sub" data-testid="lim-reset" suppressHydrationWarning>
            {d.limited ? t('lim.reset', { date: resetDate(d.resetAt, d.tz, localeOf(t.lang)) }) : t('lim.noneSub', { pct: String(shown) })}
          </span>
        </div>
      </Group>
      {note && <Notice tone="info" testId="lim-note">{t(note)}</Notice>}
      {d.limited && (
        <Group title={t('lim.support')} foot={d.phase === 'over' || d.phase === 'blocked' ? undefined : t('lim.help')} testId="lim-support">{}
          <a className="k-row" href={d.support.tg} target="_blank" rel="noopener noreferrer" data-testid="lim-tg">
            <span className="k-row-m"><span className="k-row-t">Telegram</span></span><span className="k-row-v">{d.support.handle}</span><Icon n="arrow-ur" sm className="k-chev" />
          </a>
          <a className="k-row" href={`mailto:${d.support.email}`} data-testid="lim-mail">
            <span className="k-row-m"><span className="k-row-t">{t('lim.email')}</span></span><span className="k-row-v">{d.support.email}</span><Icon n="arrow-ur" sm className="k-chev" />
          </a>
        </Group>
      )}
    </KPage>
  );
}

export function LimitsRowLink({ limited, pct }: { limited: boolean; pct: number }) {
  const t = useT();
  return (
    <Group>
      <Row title={t('shell.limits')} icon="gauge" value={limited ? `${Math.min(100, Math.max(0, pct))}%` : t('lim.none')} href="/settings/limits" chevron testId="settings-limits" />
    </Group>
  );
}
