'use client';
import { useSimple } from './Shell';
import { useLayoutEffect, useRef } from 'react';
import { fmtBytes } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { previewKind } from '@/lib/previewKind';
import type { FileChip } from '@/lib/types';
import { Icon } from './Icon';
import { openDoc } from './iv';
import { thumbClick } from './OutImage';
import { openFile } from '@/lib/fileView';
import { tokText, useFileTok } from '@/lib/fileTokens';
import { viewKind } from '@/lib/viewKind';
import { groupByFolder } from '@/lib/upload/paths';
import { progText, type UpProgress } from '@/lib/upload/progress';

export type Up = { tmp: string; name: string; size: number; status: 'uploading' | 'ready' | 'error'; chip?: FileChip; error?: string; preview?: string; edit?: boolean; img?: boolean; w?: number; h?: number;
   started?: boolean;
   prog?: UpProgress;
   errKind?: import('@/lib/upload/errKind').FileErrKind };

export function viewSrc(u: Up): string | undefined {
  if (u.status === 'ready' && u.chip) return `/api/files/${u.chip.id}`;
  return u.preview?.startsWith('blob:') ? u.preview : undefined;
}

function Remove({ u, onRemove, doc }: { u: Up; onRemove: (u: Up) => void; doc?: boolean }) {
  const tx = useT();
  return (
    <button type="button" className={doc ? 'icon-btn' : 'up-x'} aria-label={tx('comp.removeNamed', { name: u.name })} title={tx('comp.removeFile')} data-testid="up-remove" onClick={() => onRemove(u)}>
      {doc ? <Icon n="x" sm /> : <span className="up-x-dot"><Icon n="x" sm /></span>}
    </button>
  );
}

function ImgTile({ u, onRemove }: { u: Up; onRemove: (u: Up) => void }) {
  const tx = useT();
  const src = viewSrc(u);
  const w = Number(u.w ?? u.chip?.info?.w) || undefined, h = Number(u.h ?? u.chip?.info?.h) || undefined;
  return (
    <div className={`up-chip up-img${u.status === 'error' ? ' is-err' : ''}`} data-testid="up-chip" data-name={u.name} data-status={u.status}>
      <button type="button" className="up-open iv-thumb" disabled={!src} title={`${u.name} · ${fmtBytes(u.size, tx.lang)}`} aria-label={tx('msg.openImage', { name: u.name })}
        {...(src ? { 'data-iv': '', 'data-iv-src': src, 'data-iv-name': u.name, 'data-iv-size': fmtBytes(u.size, tx.lang), 'data-iv-w': w, 'data-iv-h': h } : {})}
        onClick={(e) => { if (src) thumbClick(e, src); }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {u.preview ? <img className="up-thumb" src={u.preview} alt="" draggable={false} decoding="async" /> : <span className="up-ph" />}
      </button>
      {u.status === 'uploading' && <span className="up-state" role="status" aria-label={tx('comp.uploading')} data-testid="up-state"><span className="up-spin" /></span>}
      {u.status === 'error' && <span className="up-state is-err" title={u.error} data-testid="up-state"><Icon n="alert" /></span>}
      <Remove u={u} onRemove={onRemove} />
    </div>
  );
}

function DocChip({ u, onRemove }: { u: Up; onRemove: (u: Up) => void }) {
  const tx = useT();
  const simple = useSimple();
  const kind = u.status === 'ready' && u.chip ? previewKind(u.name) : null;
  const tok = useFileTok({ name: u.name, tokens: u.chip?.tokens, mime: u.chip?.mime, info: u.chip?.info });
  const parts = u.status === 'ready' ? [fmtBytes(u.size, tx.lang), tok && !simple ? tokText(tx.lang, tok) : ''].filter(Boolean) : [fmtBytes(u.size, tx.lang)];
  const prog = u.status === 'uploading' ? progText(tx, u.prog) : null;
  const pieces = (xs: string[]) => xs.map((x, i) => <span key={i}>{i > 0 ? ' ' : ''}<span className="fm-nb">{x}{i < xs.length - 1 ? '\u00a0·' : ''}</span></span>);
  const meta = prog ? pieces(prog.split(' · ')) : u.status === 'uploading' ? tx('comp.reading') : u.status === 'error' ? u.error : pieces(parts);
  const body = (
    <>
      <span className="ficon"><Icon n={u.status === 'error' ? 'alert' : kind === 'slides' ? 'slides' : 'file-text'} sm /></span>
      <span className="fmeta"><b>{u.name}</b><small className={u.status === 'ready' || prog ? 'fm-wrap' : undefined} title={u.status === 'error' ? u.error : prog ?? undefined} data-testid={prog ? 'up-prog' : undefined}>{meta}</small></span>
    </>
  );
  return (
    <div className={`up-chip up-doc${u.status === 'error' ? ' is-err' : ''}`} data-testid="up-chip" data-name={u.name} data-status={u.status}>
      {kind ? (
        <button type="button" className="up-doc-in up-doc-open" aria-label={tx('doc.open', { name: u.name })} data-testid="up-doc-open"
          onClick={(e) => openDoc({ href: `/api/files/${u.chip!.id}`, name: u.name, kind }, e.currentTarget)}>{body}</button>
      ) : u.status === 'ready' && u.chip && viewKind(u.name) !== 'none' ? (
        <button type="button" className="up-doc-in up-doc-open" aria-label={tx('files.openFile', { name: u.name })} data-testid="up-doc-open"
          onClick={() => openFile({ id: u.chip!.id, name: u.name })}>{body}</button>
      ) : <div className="up-doc-in">{body}</div>}
      <Remove u={u} onRemove={onRemove} doc />
    </div>
  );
}

function FolderChipUp({ name, n, ups, onRemove }: { name: string; n: number; ups: Up[]; onRemove: (u: Up) => void }) {
  const tx = useT();
  return (
    <div className="up-chip up-doc" data-testid="up-chip" data-name={name} data-status="ready" data-folder="">
      <div className="up-doc-in">
        <span className="ficon"><Icon n="folder" sm /></span>
        <span className="fmeta"><b>{tx('files.folder', { name })}</b><small>{tx('files.nFiles', { n })}</small></span>
      </div>
      <button type="button" className="icon-btn" aria-label={tx('files.removeBatch', { name })} data-testid="up-remove" onClick={() => ups.forEach((u) => onRemove(u))}><Icon n="x" sm /></button>
    </div>
  );
}

export function UpRow({ items, onRemove }: { items: Up[]; admin?: boolean ; onRemove: (u: Up) => void }) {
  const tx = useT();
  const folded = items.length > 12 ? groupByFolder(items.filter((u) => u.status === 'ready' && u.chip).map((u) => ({ name: u.name, size: u.size, u }))) : { groups: [], rest: [] as { name: string; size: number; u: Up }[] };
  const inGroup = new Set(folded.groups.flatMap((g) => g.items.map((x) => x.u)));
  if (folded.groups.length) items = items.filter((u) => !inGroup.has(u));
  const row = useRef<HTMLDivElement>(null);
  const n = useRef(items.length);
  useLayoutEffect(() => {
    const el = row.current;
    if (el && items.length === n.current + 1) el.scrollLeft = el.scrollWidth;
    n.current = items.length;
  }, [items.length]);
  if (!items.length) return null;
  return (
    <>
      <div className="up-row" ref={row} role="group" aria-label={tx('comp.attachments')} data-iv-scope="" data-testid="up-row">
        {folded.groups.map((g) => <FolderChipUp key={'g-' + g.root} name={g.root} n={g.items.length} ups={g.items.map((x) => x.u)} onRemove={onRemove} />)}
        {items.map((u) => (u.img ? <ImgTile key={u.tmp} u={u} onRemove={onRemove} /> : <DocChip key={u.tmp} u={u} onRemove={onRemove} />))}
      </div>
      {items.filter((u) => u.img && u.status === 'error').map((u) => (
        <div className="up-note" role="alert" data-testid="up-err" key={'e-' + u.tmp}><Icon n="alert" sm /><span>{u.name}: {u.error}</span></div>
      ))}
    </>
  );
}
