'use client';
import { useState } from 'react';
import { fmtBytes } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { openFile } from '@/lib/fileView';
import { fileTok, sumTok, tokText, useExactTokens } from '@/lib/fileTokens';
import { baseName, dirName, type FolderGroup, type Origin } from '@/lib/upload/paths';
import type { FileChip } from '@/lib/types';
import { Icon } from './Icon';
import '@/styles/upload.css';

const SHOW = 400;

export function FolderCard({ g }: { g: FolderGroup<FileChip> }) {
  const tx = useT();
  const [open, setOpen] = useState(false);
  const o = g.items.map((f) => (f.info as { origin?: Origin } | undefined)?.origin).find(Boolean);
  const ex = useExactTokens();
  const total = sumTok(g.items, ex);
  const title = g.kind === 'zip' ? tx('files.zip', { name: o?.archive ?? g.root }) : tx('files.folder', { name: g.root });
  return (
    <div className="fcard" data-testid="folder-card" data-open={open || undefined}>
      <button type="button" className="fcard-head" aria-expanded={open} aria-label={`${title}. ${tx(open ? 'files.collapse' : 'files.expand')}`} data-testid="folder-toggle" onClick={() => setOpen((x) => !x)}>
        <span className="ficon"><Icon n={g.kind === 'zip' ? 'layers' : 'folder'} /></span>
        <span className="fmeta"><b title={g.root}>{title}</b><small>{[tx('files.nFiles', { n: g.items.length }), tx('files.nTypes', { n: g.types }), fmtBytes(g.bytes, tx.lang), total ? tokText(tx.lang, total) : ''].filter(Boolean).join(' · ')}</small></span>
        <Icon n={open ? 'chev-up' : 'chev-down'} sm />
      </button>
      {open && (
        <ul className="fcard-list" data-testid="folder-list">
          {[...g.items].sort((a, b) => a.name.localeCompare(b.name, tx.lang, { numeric: true })).slice(0, SHOW).map((f) => (
            <li key={f.id}>
              <button type="button" className="fcard-file" title={f.name} aria-label={tx('files.openFile', { name: f.name })} data-testid="folder-file" onClick={() => openFile({ id: f.id, name: f.name })}>
                <span>{baseName(f.name)}{dirName(f.name).slice(g.root.length + 1) ? <small> · {dirName(f.name).slice(g.root.length + 1)}</small> : null}</span>
                <small>{[fmtBytes(f.size, tx.lang), (() => { const t = fileTok(f, ex); return t ? tokText(tx.lang, t) : ''; })()].filter(Boolean).join(' · ')}</small>
              </button>
            </li>
          ))}
          {g.items.length > SHOW && <li><small className="ucard-line">… {tx('files.nFiles', { n: g.items.length - SHOW })}</small></li>}
        </ul>
      )}
    </div>
  );
}
