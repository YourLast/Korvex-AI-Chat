'use client';
import { useT } from '@/lib/i18n/react';
import '@/styles/user-memory.css';

export type QuickId = 'recon' | 'errors' | 'registry' | 'tax' | 'deadlines' | 'inn';
export type QuickHow = 'send' | 'fill' | 'files';
export const ANSWER_SET: QuickId[] = ['recon', 'errors', 'registry', 'tax'];
export const AFTER_ALL_SET: QuickId[] = ['registry', 'tax'];
export const HOME_SET: { id: QuickId; how: QuickHow }[] = [{ id: 'deadlines', how: 'send' }, { id: 'inn', how: 'fill' }, { id: 'tax', how: 'files' }];

export function QuickActions({ ids, how, onAct, lead, testId = 'quick' }: {
  ids: QuickId[]; how?: (id: QuickId) => QuickHow; onAct: (text: string, how: QuickHow, id: QuickId) => void; lead?: string; testId?: string;
}) {
  const t = useT();
  return (
    <div className="ans-line quick" data-testid={testId}>
      {lead && <span>{lead} </span>}
      {ids.map((id, i) => (
        <span key={id}>{i > 0 && <span aria-hidden="true"> · </span>}
          <button type="button" className="ans-link" onClick={() => onAct(t(`quick.${id}.ask`), how?.(id) ?? 'send', id)} data-testid={`quick-${id}`}>{t(`quick.${id}`)}</button>
        </span>
      ))}
    </div>
  );
}
