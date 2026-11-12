'use client';
import type { ReactNode } from 'react';
import { reasonLabel } from '@/lib/rating';
import { relTime } from '@/lib/schedule';
import { Icon } from './Icon';
import '@/styles/admin-view.css';

export const when = (ts: number | null | undefined, tz: string) => (ts ? relTime(ts, tz) : '—');

export function RateCounts({ up, down, className, upFirst }: { up: number; down: number; className?: string; upFirst?: boolean }) {
  if (!up && !down) return null;
  const dn = down > 0 && <span className="adm-rate adm-rate--down" title="Плохих оценок"><Icon n="thumb" sm className="flip" /><b className="tnum">{down}</b><span className="sr">плохих</span></span>;
  const upEl = up > 0 && <span className="adm-rate adm-rate--up" title="Хороших оценок"><Icon n="thumb" sm /><b className="tnum">{up}</b><span className="sr">хороших</span></span>;
  return (
    <span className={`adm-rates${className ? ' ' + className : ''}`} data-testid="rate-counts">
      {upFirst ? <>{upEl}{dn}</> : <>{dn}{upEl}</>}
    </span>
  );
}

export function ReasonTags({ reasons, comment }: { reasons: string[]; comment?: string }) {
  if (!reasons.length && !comment) return null;
  return (
    <span className="k-tags">
      {reasons.map((r) => <span key={r} className="k-tag">{reasonLabel(r)}</span>)}
      {comment && <span className="k-quote">«{comment}»</span>}
    </span>
  );
}

export function ExtRow({ title, sub, sub2, value, icon, href, testId }: { title: ReactNode; sub?: ReactNode; sub2?: ReactNode; value?: ReactNode; icon?: string; href: string; testId?: string }) {
  return (
    <a className="k-row" href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}>
      {icon && <span className="k-row-i"><Icon n={icon} sm /></span>}
      <span className="k-row-m"><span className="k-row-t">{title}</span>{sub && <span className="k-row-s">{sub}</span>}{sub2 && <span className="k-row-s">{sub2}</span>}</span>
      {value !== undefined && value !== null && value !== '' && <span className="k-row-v">{value}</span>}
      <Icon n="arrow-ur" sm className="k-chev" />
    </a>
  );
}

export function ExtButton({ href, children, kind = 'secondary', testId }: { href: string; children: ReactNode; kind?: 'primary' | 'secondary' | 'plain'; testId?: string }) {
  return <a className={`k-btn k-btn--${kind}`} href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}><span>{children}</span></a>;
}
