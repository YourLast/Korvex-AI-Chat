'use client';
import { useState, useSyncExternalStore } from 'react';
import { fmtBytes } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import type { Key } from '@/lib/i18n/core';
import { Batch, type Job, type Snap } from '@/lib/upload/queue';
import { baseName, dirName } from '@/lib/upload/paths';
import { Icon } from './Icon';
import { openFile } from '@/lib/fileView';
import '@/styles/upload.css';

const useSnap = (b: Batch): Snap => useSyncExternalStore(b.subscribe, b.getSnap, b.getSnap);

export function useWhy() {
  const tx = useT();
  return (code: string) => { const k = `files.why.${code}` as Key; const s = tx(k); return s === k ? code : s; };
}

function JobRow({ j }: { j: Job }) {
  const tx = useT();
  const st = j.status === 'error' ? j.error : j.status === 'uploading' ? tx('files.stRun') : j.status === 'cancelled' ? tx('files.stCancel') : j.status === 'skipped' ? tx('files.stDup') : j.status === 'queued' ? tx('files.stWait') : '';
  const dir = dirName(j.path);
  const name = (
    <>
      <b>{baseName(j.path)}</b>{dir && <small>{dir}</small>}
    </>
  );
  return (
    <li className={`ucard-job is-${j.status}`} data-testid="ucard-job" data-status={j.status}>
      <span className="ucard-job-ic" aria-hidden="true">
        {j.status === 'ready' ? <Icon n="check" sm /> : j.status === 'error' ? <Icon n="alert" sm /> : j.status === 'uploading' ? <span className="up-spin ucard-spin" /> : <i className="ucard-dot" />}
      </span>
      {j.status === 'ready' && j.chip ? (
        <button type="button" className="ucard-job-name" title={j.path} onClick={() => openFile({ id: j.chip!.id, name: j.path })}>{name}</button>
      ) : <span className="ucard-job-name" title={j.path}>{name}</span>}
      {st && <small className="ucard-job-st" title={j.status === 'error' ? j.error : undefined}>{st}</small>}
    </li>
  );
}

export function UploadCard({ batch, onRemove }: { batch: Batch; onRemove: () => void }) {
  const tx = useT();
  const why = useWhy();
  const s = useSnap(batch);
  const [open, setOpen] = useState(false);
  const loading = s.phase !== 'idle';
  const rest = s.failed + s.cancelled;
  const title = s.kind === 'zip' ? tx('files.zip', { name: s.label }) : s.kind === 'folder' ? tx('files.folder', { name: s.label }) : tx('files.set');
  const by = new Map<string, number>();
  for (const k of s.skipped) by.set(k.why, (by.get(k.why) ?? 0) + 1);
  const skipN = s.skipped.length;
  const skipWhy = [...by].map(([w, n]) => `${why(w)} (${n})`).join(', ');
  const sub = s.phase === 'unpacking' ? tx('files.unpacking')
    : loading ? tx('files.progress', { done: s.ready + s.failed, total: s.total, size: fmtBytes(s.bytesDone, tx.lang) })
    : [tx('files.nFiles', { n: s.ready }), tx('files.nTypes', { n: s.types }), fmtBytes(s.bytesDone, tx.lang)].join(' · ');
  const pct = s.total ? Math.round(((s.ready + s.failed) / s.total) * 100) : 0;
  return (
    <div className={`ucard${s.failed || s.err ? ' has-err' : ''}`} data-testid="upload-card" data-kind={s.kind} data-phase={s.phase}>
      <div className="ucard-head">
        <span className="ficon"><Icon n={s.kind === 'zip' ? 'layers' : 'folder'} /></span>
        <span className="fmeta"><b title={s.label}>{title}</b><small data-testid="ucard-sub">{sub}</small></span>
        {loading && <button type="button" className="btn btn--ghost ucard-btn" data-testid="ucard-cancel" onClick={() => batch.cancel()}>{tx('files.stop')}</button>}
        {!loading && rest > 0 && (
          <button type="button" className="btn ucard-btn" data-testid="ucard-retry" onClick={() => { void batch.retry(); }}>
            <Icon n="retry" sm />{tx(s.failed ? 'files.retry' : 'files.continue', { n: rest })}
          </button>
        )}
        {s.jobs.length > 0 && (
          <button type="button" className="icon-btn" aria-expanded={open} aria-label={tx(open ? 'files.collapse' : 'files.expand')} data-testid="ucard-toggle" onClick={() => setOpen((x) => !x)}>
            <Icon n={open ? 'chev-up' : 'chev-down'} sm />
          </button>
        )}
        <button type="button" className="icon-btn" aria-label={tx('files.removeBatch', { name: s.label })} title={tx('comp.removeFile')} data-testid="ucard-remove" onClick={onRemove}><Icon n="x" sm /></button>
      </div>
      {loading && s.total > 0 && <div className="ucard-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>}
      {!loading && s.cancelled > 0 && <p className="ucard-line">{tx('files.stopped', { done: s.ready, total: s.total })}</p>}
      {!loading && s.failed > 0 && <p className="ucard-line is-err" role="alert" data-testid="ucard-result">{tx('files.result', { done: s.ready, failed: s.failed })}</p>}
      {s.err && <p className="ucard-line is-err" role="alert" data-testid="ucard-err">{s.err}</p>}
      {skipN > 0 && <p className="ucard-line" data-testid="ucard-skipped">{tx('files.skipped', { n: skipN, why: skipWhy })}</p>}
      {open && (
        <ul className="ucard-list" data-testid="ucard-list">
          {[...s.jobs].sort((a, b) => a.path.localeCompare(b.path, tx.lang, { numeric: true })).slice(0, 400).map((j) => <JobRow key={j.key} j={j} />)}
          {s.jobs.length > 400 && <li className="ucard-job"><small>… {tx('files.nFiles', { n: s.jobs.length - 400 })}</small></li>}
        </ul>
      )}
    </div>
  );
}
