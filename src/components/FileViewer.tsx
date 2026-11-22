'use client';
import { useSimple } from './Shell';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useBackClose } from '@/lib/backClose';
import { closeFile, getChatFiles, openCompare, useChatFiles, useFileView, type FileTarget, type Place } from '@/lib/fileView';
import { comparable, viewKind, type ViewKind } from '@/lib/viewKind';
import { baseName, dirName } from '@/lib/upload/paths';
import { locLabel } from '@/lib/srcmark';
import { fmtBytes } from '@/lib/format';
import { fileTok, tokText, useExactTokens } from '@/lib/fileTokens';
import { sidebarWidth } from '@/lib/sidebar';
import { useT } from '@/lib/i18n/react';
import type { GridMeta } from '@/lib/gridview';
import { Icon } from './Icon';
import { SaveLink } from './SaveLink';
import { GridView } from './fileview/GridView';
import { TextView } from './fileview/TextView';
import '@/styles/fileview.css';

const PdfView = lazy(() => import('./fileview/PdfView').then((m) => ({ default: m.PdfView })));
const CompareView = lazy(() => import('./fileview/CompareView').then((m) => ({ default: m.CompareView })));

type Info =
  | { kind: ViewKind; state: 'ready'; size: number; meta?: GridMeta; total?: number; binary?: boolean; truncated?: boolean }
  | { kind: ViewKind; state: 'pending' }
  | { kind: ViewKind; state: 'error'; code?: string };

const INFO_KEEP = 24;
const infoCache = new Map<string, Info>();
export const _resetInfoCache = () => infoCache.clear();
function rememberInfo(id: string, j: Info) {
  infoCache.delete(id); infoCache.set(id, j);
  while (infoCache.size > INFO_KEEP) infoCache.delete(infoCache.keys().next().value as string);
}

function useInfo(id: string, name: string): { info: Info | null; err: boolean } {
  const [info, setInfo] = useState<Info | null>(() => infoCache.get(id) ?? null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let dead = false;
    setErr(false);
    const kind = viewKind(name);
    if (kind === 'pdf' || kind === 'convert') { setInfo({ kind, state: 'ready', size: 0 }); return; }
    const hit = infoCache.get(id);
    if (hit) { setInfo(hit); return; }
    setInfo(null);
    (async () => {
      for (let i = 0; i < 40 && !dead; i++) {
        const r = await fetch(`/api/files/${id}/view?wait=12000`);
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as Info;
        if (j.state === 'pending') { setInfo(j); continue; }
        if (j.state === 'ready') rememberInfo(id, j);
        if (!dead) setInfo(j);
        return;
      }
    })().catch(() => { if (!dead) setErr(true); });
    return () => { dead = true; };
  }, [id, name]);
  return { info, err };
}

function Empty({ id, name, why }: { id: string; name: string; why: 'none' | 'err' | 'bad' }) {
  const tx = useT();
  return (
    <div className="fv-empty" role={why === 'none' ? 'status' : 'alert'} data-testid="fv-empty" data-why={why}>
      <Icon n="file" />
      <b>{tx(why === 'none' ? 'files.noPreview' : 'files.err')}</b>
      <span>{tx('files.noPreviewHint')}</span>
      <SaveLink className="btn btn--primary" href={`/api/files/${id}`} name={name} testid="fv-empty-dl"><Icon n="download" sm />{tx('files.download')}</SaveLink>
    </div>
  );
}

function Body({ t, seq, onPlace }: { t: FileTarget; seq: number; onPlace: (s: string) => void }) {
  const tx = useT();
  const { info, err } = useInfo(t.id, t.name);
  const marks = useMemo<Place[]>(() => t.marks ?? [], [t.marks]);
  if (err) return <Empty id={t.id} name={t.name} why="err" />;
  if (!info) return <div className="fv-empty" role="status"><span className="up-spin fv-spin" /><span>{tx('files.loading')}</span></div>;
  if (info.state === 'pending') return <div className="fv-empty" role="status" data-testid="fv-pending"><span className="up-spin fv-spin" /><span>{tx('files.preparing')}</span></div>;
  if (info.state === 'error') return <Empty id={t.id} name={t.name} why="bad" />;
  if (info.kind === 'none') return <Empty id={t.id} name={t.name} why="none" />;
  if (info.kind === 'pdf' || info.kind === 'convert') {
    return <Suspense fallback={<div className="fv-empty"><span className="up-spin fv-spin" /></div>}><PdfView id={t.id} name={t.name} at={t.at} marks={marks} seq={seq} onPlace={onPlace} /></Suspense>;
  }
  if (info.kind === 'grid' && info.meta) {
    if (!info.meta.sheets.length) return <Empty id={t.id} name={t.name} why="bad" />;
    return <GridView id={t.id} meta={info.meta} at={t.at} marks={marks} onPlace={onPlace} />;
  }
  if ((info.kind === 'text' || info.kind === 'md' || info.kind === 'extracted') && typeof info.total === 'number') {
    return <TextView id={t.id} total={info.total} md={info.kind === 'md'} extracted={info.kind === 'extracted'} binary={!!info.binary} truncated={!!info.truncated} at={t.at} marks={marks} onPlace={onPlace} />;
  }
  return <Empty id={t.id} name={t.name} why="bad" />;
}

function PickOther({ t, onClose }: { t: FileTarget; onClose: () => void }) {
  const tx = useT();
  const files = useChatFiles().filter((f) => f.id !== t.id && comparable(f.name));
  return (
    <div className="fv-menu" role="menu" aria-label={tx('files.pickOther')} data-testid="pick-other">
      {files.length === 0 && <p className="fv-note">{tx('files.noOthers')}</p>}
      {files.slice(0, 80).map((f) => (
        <button key={f.id} type="button" role="menuitem" className="fv-mi" data-testid="pick-other-item" onClick={() => { onClose(); openCompare(t, { id: f.id, name: f.name }); }}>
          <Icon n="file-text" sm /><span>{f.name}</span>
        </button>
      ))}
    </div>
  );
}

const W_KEY = 'kx.fvw';
const W_MIN = 420;
const CHAT_MIN = 420;
const OVERLAY_MAX = 840;
const maxPanel = () => Math.max(W_MIN, window.innerWidth - sidebarWidth() - CHAT_MIN);
function usePanelWidth(open: boolean, kind: ViewKind) {
  const [full, setFull] = useState(false);
  const mine = useRef<number | null>(null);
  const apply = useCallback((w: number | null) => {
    const el = document.documentElement;
    if (w === null || window.innerWidth <= OVERLAY_MAX) el.style.removeProperty('--fv-w');
    else el.style.setProperty('--fv-w', `${Math.round(w)}px`);
  }, []);
  useEffect(() => {
    try { const v = Number(localStorage.getItem(W_KEY)); if (v >= W_MIN) mine.current = v; } catch {  }
  }, []);
  useEffect(() => {
    if (!open) { apply(null); setFull(false); return; }
    const w = mine.current ?? (kind === 'grid' ? Math.min(980, Math.max(560, window.innerWidth * 0.52)) : null);
    apply(w === null ? null : Math.min(w, maxPanel()));
    return () => apply(null);
  }, [open, kind, apply]);
  useEffect(() => { document.documentElement.classList.toggle('fv-full', open && full); return () => document.documentElement.classList.remove('fv-full'); }, [open, full]);
  const set = useCallback((w: number) => {
    const v = Math.min(maxPanel(), Math.max(W_MIN, w));
    mine.current = v; apply(v);
    try { localStorage.setItem(W_KEY, String(Math.round(v))); } catch {  }
  }, [apply]);
  return { full, setFull, set };
}

function ResizeHandle({ onSet }: { onSet: (w: number) => void }) {
  const tx = useT();
  const drag = useRef<{ x: number; w: number } | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const down = (e: RPointerEvent) => {
    const panel = el.current?.parentElement;
    if (!panel) return;
    drag.current = { x: e.clientX, w: panel.getBoundingClientRect().width };
    el.current!.setPointerCapture(e.pointerId);
    document.documentElement.classList.add('fv-resizing');
  };
  const move = (e: RPointerEvent) => { if (drag.current) onSet(drag.current.w + (drag.current.x - e.clientX)); };
  const up = (e: RPointerEvent) => { drag.current = null; try { el.current?.releasePointerCapture(e.pointerId); } catch {  } document.documentElement.classList.remove('fv-resizing'); };
  return (
    <div ref={el} className="fv-resize" role="separator" aria-orientation="vertical" aria-label={tx('files.resize')} tabIndex={0} data-testid="fv-resize"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onKeyDown={(e) => { const w = el.current?.parentElement?.getBoundingClientRect().width ?? 600; if (e.key === 'ArrowLeft') { e.preventDefault(); onSet(w + 32); } else if (e.key === 'ArrowRight') { e.preventDefault(); onSet(w - 32); } }} />
  );
}

export default function FileViewer() {
  const tx = useT();
  const simple = useSimple();
  const st = useFileView();
  const t = st.target;
  const cmp = st.compare;
  const [place, setPlace] = useState('');
  const [menu, setMenu] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuRef = useRef(false);
  menuRef.current = menu;
  const files = useChatFiles();
  const exactTok = useExactTokens();
  useBackClose(!!(t || cmp), () => closeFile());
  const panel = usePanelWidth(!!(t || cmp), t ? viewKind(t.name) : 'text');
  useEffect(() => { setPlace(''); setMenu(false); }, [t?.id, st.seq]);
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.('.fv-cmpwrap')) setMenu(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [menu]);
  useEffect(() => {
    if (!t && !cmp) return;
    const back = document.activeElement as HTMLElement | null;
    if (!window.matchMedia?.('(pointer: coarse)').matches) root.current?.querySelector<HTMLElement>('[data-fv-close]')?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.iv, .pop, .sheet')) return;
      e.preventDefault();
      if (menuRef.current) { setMenu(false); return; }
      closeFile();
    };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); back?.focus?.({ preventScroll: true }); };
  }, [!!(t || cmp)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t && !cmp) return null;
  if (cmp) {
    return (
      <aside className="fv fv--cmp" ref={root} role="dialog" aria-label={tx('files.cmpTitle')} data-testid="file-viewer" data-mode="compare" data-full={panel.full || undefined}>
        <ResizeHandle onSet={panel.set} />
        <header className="fv-top">
          <span className="fv-title"><b>{tx('files.cmpTitle')}</b></span>
          <button type="button" className="icon-btn fv-fullbtn" aria-pressed={panel.full} aria-label={tx(panel.full ? 'files.fullOff' : 'files.full')} title={tx(panel.full ? 'files.fullOff' : 'files.full')} data-testid="fv-full" onClick={() => panel.setFull((x) => !x)}><Icon n="expand" /></button>
          <button type="button" className="icon-btn" aria-label={tx('files.close')} data-fv-close data-testid="fv-close" onClick={closeFile}><Icon n="x" /></button>
        </header>
        <Suspense fallback={<div className="fv-empty"><span className="up-spin fv-spin" /></div>}><CompareView a={cmp.a} b={cmp.b} /></Suspense>
      </aside>
    );
  }
  const target = t!;
  const kind = viewKind(target.name);
  const chip = files.find((f) => f.id === target.id);
  const size = chip?.size;
  const tok = chip ? fileTok(chip, exactTok) : null;
  const a = target.at;
  const atLabel = a ? [a.attachment ? tx('files.attachment', { name: a.attachment }) : '', locLabel(a, tx as never)].filter(Boolean).join(', ') : '';
  const canCmp = comparable(target.name) && getChatFiles().some((f) => f.id !== target.id && comparable(f.name));
  return (
    <aside className="fv" ref={root} role="dialog" aria-label={tx('files.openFile', { name: target.name })} data-testid="file-viewer" data-mode="file" data-kind={kind} data-full={panel.full || undefined}>
      <ResizeHandle onSet={panel.set} />
      <header className="fv-top">
        <span className="fv-title" title={target.name}>
          <b>{baseName(target.name)}</b>
          <small>{[dirName(target.name), place || atLabel, size ? fmtBytes(size, tx.lang) : '', tok && !simple ? tokText(tx.lang, tok) : ''].filter(Boolean).join(' · ')}</small>
        </span>
        {canCmp && (
          <span className="fv-cmpwrap">
            <button type="button" className="btn" aria-haspopup="menu" aria-expanded={menu} data-testid="fv-compare" onClick={() => setMenu((x) => !x)}>{tx('files.compareWith')}</button>
            {menu && <PickOther t={target} onClose={() => setMenu(false)} />}
          </span>
        )}
        <button type="button" className="icon-btn fv-fullbtn" aria-pressed={panel.full} aria-label={tx(panel.full ? 'files.fullOff' : 'files.full')} title={tx(panel.full ? 'files.fullOff' : 'files.full')} data-testid="fv-full" onClick={() => panel.setFull((x) => !x)}><Icon n="expand" /></button>
        <SaveLink className="icon-btn" href={`/api/files/${target.id}`} name={target.name} testid="fv-download" label={tx('files.download')}><Icon n="download" /></SaveLink>
        <button type="button" className="icon-btn" aria-label={tx('files.close')} data-fv-close data-testid="fv-close" onClick={closeFile}><Icon n="x" /></button>
      </header>
      {}
      <div className="fv-body"><Body key={kind === 'pdf' || kind === 'convert' ? target.id : `${target.id}:${st.seq}`} t={target} seq={st.seq} onPlace={setPlace} /></div>
    </aside>
  );
}
