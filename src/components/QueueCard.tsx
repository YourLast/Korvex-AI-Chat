'use client';
import { useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { fmtEta, ordinal } from '@/lib/queueEta';
import '@/styles/queue-card.css';

export function QueueCard({ ahead, eta }: { ahead: number; eta?: number }) {
  const t = useT();
  const position = Math.max(0, Math.floor(ahead)) + 1;
  const [far, setFar] = useState(position);
  if (position > far) setFar(position);
  const fill = far <= 1 ? 1 : (far - position + 1) / far;
  const next = position === 1;
  const wait = eta && eta > 0 ? fmtEta(eta, t.lang) : '';
  return (
    <div className={`qcard${next ? ' is-next' : ''}`} role="status" aria-live="polite" data-testid="queued" data-ahead={position - 1} data-position={position}>
      <p className="qcard-t" data-testid="queued-title">{next ? t('queue.next') : t('queue.in', { pos: ordinal(position, t.lang) })}</p>
      <p className="qcard-s" data-testid="queued-sub">{next ? t('queue.waitFree') : <>{t('queue.before', { n: '\u0000' }).split('\u0000')[0]}<span className="tnum">{position - 1}</span>{t('queue.before', { n: '\u0000' }).split('\u0000')[1]}</>}{wait ? ` · ${wait}` : ''}</p>
      <div className="qcard-bar" role="progressbar" aria-label={t('queue.progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fill * 100)} aria-valuetext={t('queue.place', { n: position })} data-testid="queued-bar">
        <i style={{ width: `${Math.round(fill * 100)}%` }} />
      </div>
      <p className="qcard-n">{t('queue.note')}</p>
    </div>
  );
}
