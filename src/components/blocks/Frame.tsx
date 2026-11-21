'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/lib/i18n/react';
import { copyText } from '@/lib/clipboard';
import { blockText } from '@/lib/blocks/text';
import { plural } from '@/lib/blocks/words';
import { chipName, markerLoc, parseLocator, parseMarker } from '@/lib/srcmark';
import { openFile, resolveFile, useChatFiles } from '@/lib/fileView';
import type { Block } from '@/lib/blocks/schema';
import { Icon } from '../Icon';
import { BlockHold } from './KxEmbed';

export type FrameProps = { block: Block; actions?: ReactNode; foot?: ReactNode; children: ReactNode; expand?: boolean; onPlain?: () => void; sub?: ReactNode };

function host(u?: string) { try { return u ? new URL(u).host.replace(/^www\./, '') : ''; } catch { return ''; } }

export function SrcTag({ raw }: { raw: string }) {
  const t = useT();
  const files = useChatFiles();
  const inner = /^\[\[src:([\s\S]*?)\]\]$/.exec(raw)?.[1] ?? raw;
  const p = parseMarker(inner);
  const f = resolveFile(files, { file: p.file });
  const loc = markerLoc(p.loc, t as never);
  const label = <><Icon n="file-text" sm /><span className="kxs-n">{chipName(f?.name ?? p.file, 22)}</span>{loc && <span className="kxs-l">{loc}</span>}</>;
  if (!f) return <span className="kxs" title={p.file} data-testid="kxb-src">{label}</span>;
  const at = parseLocator(p.loc) ?? undefined;
  return <button type="button" className="kxs kxs--on" title={f.name} onClick={() => openFile({ id: f.id, name: f.name, ...(at ? { at: at as never } : {}) })} data-testid="kxb-src">{label}</button>;
}

export const Unverified = ({ text }: { text?: string }) => { const t = useT(); return <span className="kxu" data-testid="kxb-unv-mark"><i aria-hidden="true" />{text ?? t('blk.notVerified')}</span>; };

export function SourceLine({ block, extra, rows }: { block: Block; extra?: ReactNode; rows?: boolean }) {
  const tx = useT();
  const s = block.source;
  const src = s.kind === 'calc' ? tx('blk.calc', { basis: s.basis ?? '' })
    : s.kind === 'web' ? tx('blk.src.web', { host: host(s.url) })
    : s.kind === 'official' ? (s.url ? `${tx('blk.src.official')} · ${host(s.url)}` : tx('blk.src.official'))
    : tx('blk.src.file');
  const n = block.unverified ?? 0;
  const unv = n > 0 ? tx(plural(n, tx.lang, rows ? 'blk.unvRow1' : 'blk.unvVal1', rows ? 'blk.unvRow2' : 'blk.unvVal2', rows ? 'blk.unvRow5' : 'blk.unvVal5') as 'blk.unvRow1', { n: String(n) }) : null;
  return (
    <div className="kxb-foot" data-testid="kxb-foot">
      <span>{src}{s.kind === 'file' && s.src ? <> <SrcTag raw={s.src} /></> : null}</span>
      {unv && <span className="kxb-unv" data-testid="kxb-unverified">⚠ {unv}</span>}
      {extra}
    </div>
  );
}

function Menu({ items }: { items: { label: string; icon: string; on: () => void; id: string }[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', off); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="kxm" ref={box}>
      <button type="button" className="kxb-ib" aria-label={t('blk.menu')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="kxb-menu"><Icon n="more" sm /></button>
      {open && (
        <div className="kxm-pop" role="menu">
          {items.map((x) => (
            <button key={x.id} type="button" role="menuitem" className="kxm-i" onClick={() => { setOpen(false); x.on(); }} data-testid={`kxb-${x.id}`}><Icon n={x.icon} sm /><span>{x.label}</span></button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Frame({ block, actions, foot, children, expand, onPlain, sub }: FrameProps) {
  const tx = useT();
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!full) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    document.addEventListener('keydown', k);
    document.documentElement.classList.add('kxb-full-open');
    return () => { document.removeEventListener('keydown', k); document.documentElement.classList.remove('kxb-full-open'); };
  }, [full]);
  const copy = () => { void copyText(blockText(block, tx.lang)).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1400); } }); };
  const items = [
    { id: 'copy', label: tx('blk.copyText'), icon: 'copy', on: copy },
    ...(onPlain ? [{ id: 'plain', label: tx('blk.asTable'), icon: 'table', on: onPlain }] : []),
    ...(expand && !full ? [{ id: 'expand', label: tx('blk.expand'), icon: 'expand', on: () => setFull(true) }] : []),
  ];
  const body = (
    <section className={`kxb kxb--${block.type}${full ? ' kxb--full' : ''}`} aria-label={block.title} data-testid={`kxb-${block.type}`}>
      <header className="kxb-head">
        <div className="kxb-ht">
          <h3 className="kxb-title">{block.title}</h3>
          {sub && <span className="kxb-sub">{sub}</span>}
        </div>
        <div className="kxb-acts">
          {copied && <span className="kxb-ok" role="status"><Icon n="check" sm />{tx('blk.copied')}</span>}
          {actions}
          {full ? <button type="button" className="kxb-ib" aria-label={tx('blk.collapse')} onClick={() => setFull(false)} data-testid="kxb-collapse"><Icon n="x" sm /></button> : <Menu items={items} />}
        </div>
      </header>
      {children}
      {foot ?? <SourceLine block={block} />}
    </section>
  );
  if (!full) return body;
  return (
    <>
      <div className="kxb-full-ph" aria-hidden="true"><BlockHold type={block.type} /></div>
      {createPortal(<div className="kxb-full-scrim" role="dialog" aria-modal="true" aria-label={block.title} onClick={(e) => { if (e.target === e.currentTarget) setFull(false); }}>{body}</div>, document.body)}
    </>
  );
}
