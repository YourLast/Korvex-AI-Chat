'use client';
import { useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { fmtEta, fmtWait, ordinal } from '@/lib/queueEta';
import '@/styles/queue-card.css';

export function QueueCard({ ahead, eta }: { ahead: number; eta?: number }) {
  const t = useT();
  const { position, fill, next } = useQueuePlace(ahead);
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

function useQueuePlace(ahead: number) {
  const position = Math.max(0, Math.floor(ahead)) + 1;
  const [far, setFar] = useState(position);
  if (position > far) setFar(position);
  return { position, fill: far <= 1 ? 1 : (far - position + 1) / far, next: position === 1 };
}

export function ServeQueueCard({ ahead, eta, reason }: { ahead: number; eta?: number | null; reason?: 'own_running' | 'kv' }) {
  const t = useT();
  const { position, fill, next } = useQueuePlace(ahead);
  const [pre, post] = t('squeue.in', { n: '\u0000' }).split('\u0000');
  const wait = eta && eta > 0 ? fmtWait(eta, t.lang) : null;
  return (
    <div className={`qcard${next ? ' is-next' : ''}`} role="status" aria-live="polite" data-testid="squeued" data-ahead={position - 1}>
      {}
      <p className="qcard-t" data-testid="squeued-title" data-reason={reason}>{reason === 'own_running' ? t('squeue.own', { n: position }) : next ? t('squeue.next') : <>{pre}<span className="tnum">{position - 1}</span>{post}</>}</p>
      {eta && eta > 0 ? <p className="qcard-s" data-testid="squeued-sub">{wait ? t('squeue.wait', { t: wait }) : t('squeue.soon')}</p> : reason === 'kv' ? <p className="qcard-s" data-testid="squeued-sub">{t('squeue.kv')}</p> : null}
      <div className="qcard-bar" role="progressbar" aria-label={t('queue.progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fill * 100)} aria-valuetext={t('queue.place', { n: position })} data-testid="squeued-bar">
        <i style={{ width: `${Math.round(fill * 100)}%` }} />
      </div>
      <p className="qcard-n">{t('squeue.note')}</p>
    </div>
  );
}
