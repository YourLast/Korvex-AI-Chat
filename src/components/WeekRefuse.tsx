'use client';
import { Icon } from './Icon';

export function WithDate({ text, date }: { text: string; date?: string | null }) {
  const i = date ? text.indexOf(date) : -1;
  if (!date || i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<b className="wk-date">{date}</b>{text.slice(i + date.length)}</>;
}

export function WeekRefuse({ text, date }: { text: string; date?: string | null }) {
  return (
    <p className="week-refuse" role="status" data-testid="week-refuse">
      <Icon n="clock" sm />
      <span><WithDate text={text} date={date} /></span>
    </p>
  );
}
