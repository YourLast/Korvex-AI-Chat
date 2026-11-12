'use client';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { nearFile, openCompare, openFile, useChatFiles, resolveFile, type Place } from '@/lib/fileView';
import { peekLine, peekRow } from '@/lib/gridPeek';
import { useT } from '@/lib/i18n/react';
import { comparable, viewKind } from '@/lib/viewKind';
import { chipLabel, chipName, clauseOf, locLabel, markerLoc, parseLocator, parseMarker, quoteView, shortName, type Parsed, type Source } from '@/lib/srcmark';
import type { FileChip } from '@/lib/types';
import { matchUrl, webTarget, webTargets, type WebTarget } from '@/lib/webmark';
import { Icon } from './Icon';
import '@/styles/fileview.css';

export const SrcCtx = createContext<{ sources: Source[] | null; live: boolean; urls?: readonly string[] }>({ sources: null, live: false });

export function WebChips({ raw, ts: ts0 }: { raw?: string; ts?: readonly WebTarget[] }) {
  const t = useT();
  const { urls } = useContext(SrcCtx);
  const ts = (ts0 ?? webTargets(raw ?? '') ?? []).filter((x, i, a) => a.findIndex((y) => y.host === x.host && y.url === x.url && y.path === x.path) === i);
  if (!ts.length) return null;
  return (
    <span className="src-grp" data-testid="web-group" data-n={ts.length}>
      {ts.map((x, i) => {
        const u = matchUrl(x, urls ?? []);
        const body = <><Icon n="globe" /><span className="src-l">{x.host}</span></>;
        return u
          ? <a key={i} className="src-p src-web" href={u} target="_blank" rel="noopener noreferrer nofollow" title={u} aria-label={t('files.webOpen', { host: x.host })} data-testid="web-chip" data-state="link">{body}</a>
          : <span key={i} className="src-p src-web is-plain" title={x.host} data-testid="web-chip" data-state="plain">{body}</span>;
      })}
    </span>
  );
}

const place = (s: Source): Place => ({ kind: s.kind, sheet: s.sheet, page: s.page, page_to: s.page_to, row: s.row, row_to: s.row_to, col: s.col, slide: s.slide, line: s.line, line_to: s.line_to, attachment: s.attachment, quote: s.quote, snippet: s.snippet });
const squash = (s: string) => s.replace(/\\\|/g, '|').replace(/\s+/g, ' ').trim();
const rowOf = (s: Source) => (s.kind === 'row' || s.kind === 'cell' ? s.row : undefined);

export function findSource(list: Source[], raw: string): Source | null {
  const r = squash(raw);
  const byRaw = list.find((s) => s.raw && squash(s.raw) === r);
  if (byRaw) return byRaw;
  const inner = /^\[\[src:([\s\S]*)\]\]$/.exec(r)?.[1];
  if (!inner) return null;
  const p = parseMarker(inner), loc = parseLocator(p.loc);
  if (!loc) return null;
  const same = list.filter((s) => s.file === p.file && (s.kind === loc.kind || (['row', 'cell', 'line'].includes(loc.kind as string) && ['row', 'cell', 'line'].includes(s.kind))) && (loc.page ?? loc.slide ?? loc.line ?? loc.row) === (s.page ?? s.slide ?? s.line ?? s.row) && (!loc.sheet || s.sheet === loc.sheet));
  return (p.quote ? same.find((s) => s.quote && squash(s.quote) === squash(p.quote)) : undefined) ?? same[0] ?? null;
}

export function openSource(s: Source, list: Source[], files: readonly FileChip[]): boolean {
  const f = resolveFile(files, s);
  if (!f) return false;
  const marks = list.filter((x) => x.verified && resolveFile(files, x)?.id === f.id).map(place);
  openFile({ id: f.id, name: f.name, at: place(s), marks });
  return true;
}

function warmFile(f: FileChip | null) {
  if (!f) return;
  void import('./FileViewer').catch(() => {});
  void import('./fileview/PdfView').catch(() => {});
  if (viewKind(f.name) === 'pdf') void import('./fileview/pdfDocs').then((m) => m.prefetchPdf(f.id)).catch(() => {});
}

const isTouch = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

function useExcerpt(s: Source, fileId: string | null) {
  const [x, setX] = useState<{ head: string[]; cells: string[] } | string | null | undefined>(undefined);
  const row = rowOf(s);
  useEffect(() => {
    let dead = false;
    setX(undefined);
    const sv = s.row_values ? { head: s.row_values.header, cells: s.row_values.values } : null;
    if (row) { if (!fileId) setX(sv); else void peekRow(fileId, s.sheet, row).then((r) => { if (!dead) setX(r && r.cells.some((c) => c.trim()) ? r : sv ?? r); }); }
    else if (s.snippet) setX(s.snippet);
    else if (!fileId) setX(null);
    else if (s.kind === 'line' && s.line && !s.quote) void peekLine(fileId, s.line).then((r) => { if (!dead) setX(r); });
    else setX(null);
    return () => { dead = true; };
  }, [fileId, s, row]);
  return x;
}

function PeekBody({ s, fileId }: { s: Source; fileId: string | null }) {
  const tx = useT();
  const x = useExcerpt(s, fileId);
  const col = typeof s.col === 'string' ? s.col.toUpperCase().charCodeAt(0) - 64 : typeof s.col === 'number' ? s.col : 0;
  if (x && typeof x === 'object') {
    const n = Math.max(x.cells.length, x.head.length);
    const idx = Array.from({ length: n }, (_, i) => i).filter((i) => (x.cells[i] ?? '') !== '' || (x.head[i] ?? '') !== '').slice(0, 12);
    if (!idx.length) return <p className="peek-none">{tx('files.peekNone')}</p>;
    return (
      <dl className="peek-row" data-testid="peek-row">
        {idx.map((i) => (
          <div key={i} className={col && i + 1 === col ? 'is-hit' : undefined}>
            <dt title={x.head[i]}>{x.head[i] || String.fromCharCode(65 + (i % 26))}</dt>
            <dd title={x.cells[i]}>{x.cells[i] || '—'}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (typeof x === 'string' && x.trim()) return <blockquote className="peek-quote" data-testid="peek-quote">{x}</blockquote>;
  if (s.quote) return <blockquote className="peek-quote" data-testid="peek-quote">{quoteView(s.quote)}</blockquote>;
  if (x === undefined && (rowOf(s) || s.kind === 'line')) return <p className="peek-none" role="status">{tx('files.peekLoading')}</p>;
  return null;
}

function Peek({ s, name, fileId, rect, touch, onOpen, onEnter, onLeave }: { s: Source; name: string; fileId: string | null; rect: DOMRect; touch: boolean; onOpen: () => void; onEnter: () => void; onLeave: () => void }) {
  const tx = useT();
  const loc = locLabel(s, tx as never);
  const W = Math.min(360, window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - W - 8));
  const below = rect.bottom + 6;
  const style = window.innerHeight - rect.bottom > 220 ? { left, width: W, top: below } : { left, width: W, bottom: window.innerHeight - rect.top + 6 };
  return createPortal(
    <div className="peek" role="dialog" aria-label={`${shortName(name)}, ${loc}`} data-testid="peek" style={style} onPointerEnter={onEnter} onPointerLeave={onLeave}>
      <header><Icon n={viewKind(name) === 'grid' ? 'table' : 'file-text'} sm /><b title={name}>{shortName(name)}</b><small>{loc}</small></header>
      <PeekBody s={s} fileId={fileId} />
      {touch && <button type="button" className="btn btn--primary peek-open" data-testid="peek-open" onClick={onOpen}>{tx('files.peekOpen')}</button>}
    </div>,
    document.body,
  );
}

function Place({ s, list, showName, files, icon }: { s: Source; list: Source[]; showName: boolean; files: readonly FileChip[]; icon?: string }) {
  const tx = useT();
  const btn = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef(0);
  const f = resolveFile(files, s);
  const name = f?.name ?? s.file;
  const touch = isTouch();
  const label = chipLabel(s, tx as never);
  const clause = clauseOf(s);
  const full = locLabel(s, tx as never);
  const show = (delay: number) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => { if (btn.current) setRect(btn.current.getBoundingClientRect()); }, delay); };
  const hide = (delay: number) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setRect(null), delay); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!rect) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setRect(null); };
    const away = (e: PointerEvent) => { if (touch && !(e.target as Element | null)?.closest?.('.peek, .src-p')) setRect(null); };
    window.addEventListener('keydown', key); window.addEventListener('pointerdown', away);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', away); };
  }, [rect, touch]);
  const open = () => { setRect(null); openSource(s, list, files); };
  return (
    <>
      <button ref={btn} type="button" className="src-p" data-testid="src-chip" data-state="ok" aria-label={tx('files.srcOpen', { name: shortName(name), loc: full })} title={`${name} · ${full}`}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') { show(260); warmFile(f); } }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') hide(160); }}
        onFocus={() => { show(0); warmFile(f); }} onBlur={() => hide(120)}
        onClick={() => { if (touch && !rect) { show(0); return; } open(); }}>
        {icon && <Icon n={icon} />}{showName && <span className="src-n">{chipName(name)}</span>}<span className="src-l">{label}</span>{clause && <span className="src-c">{tx('files.chip.clause', { n: clause })}</span>}
      </button>
      {rect && <Peek s={s} name={name} fileId={f?.id ?? null} rect={rect} touch={touch} onOpen={open} onEnter={() => window.clearTimeout(timer.current)} onLeave={() => hide(160)} />}
    </>
  );
}

export function SrcChip({ raw }: { raw: string }) {
  const t = useT();
  const { sources, live } = useContext(SrcCtx);
  const files = useChatFiles();
  const raws = raw === 'pending' ? [] : raw.split('\u0001');
  const parsed = raws.map((r) => { const inner = /^\[\[src:([\s\S]*?)\]\]$/.exec(r)?.[1] ?? r; return { r, p: parseMarker(inner) as Parsed }; });
  const inner = (x: { p: Parsed }, s: Source | null): string => {
    const f = resolveFile(files, { file: x.p.file, file_ref: s?.file_ref });
    const name = f ? shortName(f.name) : nearFile(files, x.p.file) ? '' : shortName(x.p.file);
    return [name, s ? locLabel(s, t as never) : markerLoc(x.p.loc, t as never)].filter(Boolean).join(', ');
  };
  if (raw === 'pending') return live ? <span className="src-grp src-grp--wait" title={t('files.srcWait')} data-testid="src-chip" data-state="wait"><span className="src-n">…</span></span> : null;
  const webs = parsed.map((x) => (resolveFile(files, { file: x.p.file }) ? null : webTarget(x.p.file)));
  if (webs.every(Boolean)) return <WebChips ts={webs as WebTarget[]} />;
  if (!sources && live) {
    const f0 = resolveFile(files, { file: parsed[0].p.file });
    return (
      <span className="src-grp src-grp--wait" title={t('files.srcWait')} data-testid="src-chip" data-state="wait">
        <Icon n="file-text" />{f0 && <span className="src-n">{chipName(f0.name)}</span>}{parsed.map((x, i) => { const l = markerLoc(x.p.loc, t as never); return l ? <span key={i} className="src-l">{l}</span> : null; })}
      </span>
    );
  }
  if (!sources) { const txt = parsed.map((x) => inner(x, null)).filter(Boolean).join('; '); return txt ? <span className="src-plain" data-testid="src-plain">({txt})</span> : null; }
  const found = parsed.map((x) => ({ x, v: findSource(sources, x.r) })).map(({ x, v }) => ({ x, v, s: v && v.verified && resolveFile(files, v) ? v : null }));
  const good = found.filter((f) => f.s).map((f) => f.s!);
  const bad = found.filter((f) => !f.s);
  const names = new Set(sources.filter((s) => s.verified).map((s) => resolveFile(files, s)?.id ?? s.file));
  const showName = names.size > 1;
  return (
    <>
      {good.length > 0 && (
        <span className="src-grp" data-testid="src-group" data-n={good.length}>
          {good.map((s, i) => <Place key={i} s={s} list={sources} showName={showName && i === 0} files={files} icon={i === 0 ? (viewKind(resolveFile(files, good[0])?.name ?? good[0].file) === 'grid' ? 'table' : 'file-text') : undefined} />)}
        </span>
      )}
      {bad.map((b, i) => { const txt = inner(b.x, b.v); return txt ? <span key={i} className="src-plain" data-testid="src-plain" data-verified="false">({txt})</span> : null; })}
    </>
  );
}

function Excerpt({ s, fileId }: { s: Source; fileId: string | null }) {
  const x = useExcerpt(s, fileId);
  if (x && typeof x === 'object') {
    const vals = x.cells.map((c) => c.trim()).filter(Boolean);
    return <span className="srcl-x">{vals.join(' · ').slice(0, 160)}</span>;
  }
  if (typeof x === 'string' && x.trim()) return <span className="srcl-x">{x.trim().slice(0, 160)}</span>;
  if (s.quote) return <span className="srcl-x">«{quoteView(s.quote)}»</span>;
  return null;
}

const MORE = 8;
export function SrcList({ sources, live }: { sources: Source[] | null; live?: boolean }): ReactNode {
  const tx = useT();
  const files = useChatFiles();
  const groups = useMemo(() => {
    if (!sources) return [];
    const by = new Map<string, { f: FileChip; items: Source[] }>();
    for (const s of sources) {
      if (!s.verified) continue;
      const f = resolveFile(files, s);
      if (!f) continue;
      (by.get(f.id) ?? by.set(f.id, { f, items: [] }).get(f.id)!).items.push(s);
    }
    return [...by.values()];
  }, [sources, files]);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const [open, setOpen] = useState<boolean | null>(null);
  const [all, setAll] = useState<Record<string, boolean>>({});
  if (live || !sources || !total) return null;
  const isOpen = open ?? total <= 6;
  const pair = groups.filter((g) => comparable(g.f.name)).slice(0, 2);
  const marksOf = (g: { items: Source[] }) => g.items.map(place);
  return (
    <section className="srcl" data-testid="src-list" aria-label={tx('files.sources')}>
      <button type="button" className="srcl-head" aria-expanded={isOpen} data-testid="src-list-toggle" onClick={() => setOpen(!isOpen)}>
        <b>{tx('files.sources')}</b><small>{tx('files.sourcesFiles', { n: groups.length })} · {tx('files.sourcesPlaces', { n: total })}</small>
        <Icon n={isOpen ? 'chev-up' : 'chev-down'} sm />
      </button>
      {isOpen && (
        <div className="srcl-body">
          {groups.map((g) => {
            const items = all[g.f.id] ? g.items : g.items.slice(0, MORE);
            return (
              <div key={g.f.id} className="srcl-file" data-testid="src-file">
                <button type="button" className="srcl-name" title={g.f.name} onClick={() => openFile({ id: g.f.id, name: g.f.name, marks: marksOf(g) })}>
                  <Icon n={viewKind(g.f.name) === 'grid' ? 'table' : 'file-text'} sm /><span>{shortName(g.f.name)}</span>
                </button>
                <ul>
                  {items.map((s, i) => (
                    <li key={i}>
                      <button type="button" className="srcl-item" data-testid="src-item" title={locLabel(s, tx as never)} onClick={() => openSource(s, sources, files)}>
                        <span className="srcl-p">{chipLabel(s, tx as never)}</span><Excerpt s={s} fileId={g.f.id} />
                      </button>
                    </li>
                  ))}
                  {g.items.length > MORE && !all[g.f.id] && <li><button type="button" className="srcl-more" onClick={() => setAll((a) => ({ ...a, [g.f.id]: true }))}>{tx('files.sourcesMore', { n: g.items.length - MORE })}</button></li>}
                </ul>
              </div>
            );
          })}
          {pair.length === 2 && (
            <button type="button" className="btn src-cmp" data-testid="src-compare" onClick={() => openCompare({ id: pair[0].f.id, name: pair[0].f.name, marks: marksOf(pair[0]) }, { id: pair[1].f.id, name: pair[1].f.name, marks: marksOf(pair[1]) })}>
              <Icon n="columns" sm />{tx('files.srcCompare')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function SrcBar({ sources }: { sources: Source[] | null }): ReactNode {
  const t = useT();
  const files = useChatFiles();
  const pair = useMemo(() => {
    if (!sources) return null;
    const seen: FileChip[] = [];
    for (const s of sources) {
      if (!s.verified) continue;
      const f = resolveFile(files, s);
      if (f && comparable(f.name) && !seen.some((x) => x.id === f.id)) seen.push(f);
    }
    return seen.length >= 2 ? [seen[0], seen[1]] : null;
  }, [sources, files]);
  if (!pair || !sources) return null;
  const marksOf = (f: FileChip) => sources.filter((x) => x.verified && resolveFile(files, x)?.id === f.id).map(place);
  return (
    <button type="button" className="btn src-cmp" data-testid="src-compare" onClick={() => openCompare({ id: pair[0].id, name: pair[0].name, marks: marksOf(pair[0]) }, { id: pair[1].id, name: pair[1].name, marks: marksOf(pair[1]) })}>
      <Icon n="columns" sm />{t('files.srcCompare')}
    </button>
  );
}
