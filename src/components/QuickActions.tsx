'use client';
import { useT } from '@/lib/i18n/react';
import '@/styles/user-memory.css';

export const QUICK = [
  { id: 'recon', files: true }, { id: 'errors', files: true }, { id: 'registry', files: true }, { id: 'tax', files: true }, { id: 'deadlines', files: false },
] as const;
export type QuickId = (typeof QUICK)[number]['id'];

export function QuickActions({ onAct, lead, testId = 'quick' }: { onAct: (text: string, needsFiles: boolean, id: QuickId) => void; lead?: string; testId?: string }) {
  const t = useT();
  return (
    <div className="ans-line quick" data-testid={testId}>
      {lead && <span>{lead} </span>}
      {QUICK.map((a, i) => (
        <span key={a.id}>{i > 0 && <span aria-hidden="true"> · </span>}
          <button type="button" className="ans-link" onClick={() => onAct(t(`quick.${a.id}.ask`), a.files, a.id)} data-testid={`quick-${a.id}`}>{t(`quick.${a.id}`)}</button>
        </span>
      ))}
    </div>
  );
}
