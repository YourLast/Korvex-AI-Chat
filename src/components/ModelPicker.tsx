'use client';
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode, type RefObject } from 'react';
import type { PublicModel } from '@/lib/models';
import { families, familyOf, intensityOf, pairFor, readPair, readPrefs, rememberLevel, variantFor, type Sel } from '@/lib/levels';
import '@/styles/kit.css';
import '@/styles/picker.css';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { StateTag, StatusCtx } from './Announce';
import type { ModelState } from '@/lib/announce';
import { useT, type T } from '@/lib/i18n/react';
import { retiredModel } from '@/lib/retired';
import { ModelMark } from './ModelMark';
import { TRACK_FOCUS, TrackPanel } from './PickerTrack';
import { ElasticLevelBlock } from './LevelElastic';
import { PICKER_VARIANT, levelControl } from '@/lib/pickerVariant';

export type { Sel };
export type Side = 'a' | 'b';
export type Pair = { a: Sel; b: Sel };

export function levelLabel(models: PublicModel[], s: Sel) {
  const m = models.find((x) => x.id === s.modelId) ?? retiredModel(s.modelId);
  const base = m ? models.find((x) => x.id === familyOf(models, m.id)) : undefined;
  const suffix = m && base && base.id !== m.id && m.name === base.name && m.variantName ? ` · ${m.variantName.toLowerCase()}` : '';
  const name = m?.name ?? s.modelId;
  return { model: name + suffix, name, suffix, level: m?.levels.find((l) => l.id === s.levelId)?.label ?? s.levelId };
}
export type SideLabel = ReturnType<typeof levelLabel> & { short: string };
export function pairLabels(models: PublicModel[], a: Sel, b: Sel): [SideLabel, SideLabel] {
  const la = levelLabel(models, a), lb = levelLabel(models, b);
  const ma = models.find((x) => x.id === a.modelId), mb = models.find((x) => x.id === b.modelId);
  if (ma && mb && ma.id !== mb.id && familyOf(models, ma.id) === familyOf(models, mb.id) && ma.name === mb.name && ma.variantName && mb.variantName) {
    const sa = ` · ${ma.variantName.toLowerCase()}`, sb = ` · ${mb.variantName.toLowerCase()}`;
    return [
      { ...la, model: ma.name + sa, name: ma.name, suffix: sa, short: ma.variantName },
      { ...lb, model: mb.name + sb, name: mb.name, suffix: sb, short: mb.variantName },
    ];
  }
  return [{ ...la, short: la.model }, { ...lb, short: lb.model }];
}

const baseMs = () => {
  if (typeof document === 'undefined') return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-base').trim();
  const ms = raw.endsWith('ms') ? parseFloat(raw) : raw.endsWith('s') ? parseFloat(raw) * 1000 : 200;
  return Number.isFinite(ms) ? ms : 200;
};
const SOFT = 'cubic-bezier(.4, 0, .2, 1)';
const calm = () => !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

export function ModelName({ name, suffix = '' }: { name: string; suffix?: string }) {
  const x = useRef<HTMLSpanElement>(null);
  const kept = useRef(suffix);
  const [, bump] = useState(0);
  if (suffix) kept.current = suffix;
  const text = suffix || kept.current;
  const was = useRef(suffix);
  const width = useRef(0);
  const anim = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const el = x.current, prev = was.current;
    was.current = suffix;
    if (prev === suffix) { width.current = el?.offsetWidth ?? 0; return; }
    const seen = anim.current?.playState === 'running' && el ? el.offsetWidth : width.current;
    anim.current?.cancel(); anim.current = null;
    const natural = el?.offsetWidth ?? 0;
    const ms = baseMs();
    const run = !!el && ms > 0 && calm() && typeof el.animate === 'function';
    const opt = { duration: ms, easing: SOFT };
    if (!suffix) {
      const done = () => { anim.current = null; if (!was.current) { kept.current = ''; width.current = 0; bump((n) => n + 1); } };
      if (!run || !el) { done(); return; }
      const a = el.animate([{ width: `${seen || natural}px`, opacity: seen ? 1 : 0 }, { width: '0px', opacity: 0 }], { ...opt, fill: 'forwards' });
      a.onfinish = done; anim.current = a;
      return;
    }
    width.current = natural;
    if (!run || !el) return;
    const a = el.animate([{ width: `${seen}px`, opacity: seen ? 0.4 : 0 }, { width: `${natural}px`, opacity: 1 }], opt);
    a.onfinish = () => { if (anim.current === a) anim.current = null; };
    anim.current = a;
  }, [suffix]);
  useLayoutEffect(() => () => { anim.current?.cancel(); }, []);
  return <span className="mn">{name}{text && <span className="mn-x" ref={x}>{text}</span>}</span>;
}
export const Named = ({ l }: { l: { name: string; suffix: string } }) => <ModelName name={l.name} suffix={l.suffix} />;
export const LevelText = ({ id, label }: { id: string; label: string }) => <em className={id === 'max' ? 'lv-max' : undefined}>{label}</em>;

function arrowNav(e: KeyboardEvent, n: number, cur: number, go: (i: number) => void) {
  const k = e.key;
  let i = -1;
  if (k === 'ArrowRight' || k === 'ArrowDown') i = Math.min(n - 1, cur + 1);
  else if (k === 'ArrowLeft' || k === 'ArrowUp') i = Math.max(0, cur - 1);
  else if (k === 'Home') i = 0;
  else if (k === 'End') i = n - 1;
  if (i < 0) return;
  e.preventDefault();
  if (i !== cur) go(i);
  const box = (e.currentTarget as HTMLElement).closest('[role=radiogroup],[role=tablist]');
  requestAnimationFrame(() => box?.querySelectorAll<HTMLElement>('[role=radio],[role=tab]')[i]?.focus());
}

export function LevelRow({ model, value, onChange }: { model: PublicModel; value: string; onChange: (levelId: string) => void }) {
  const tx = useT();
  const lv = model.levels;
  const n = lv.length;
  const idx = Math.max(0, lv.findIndex((l) => l.id === value));
  const t = intensityOf(model, lv[idx]?.id ?? '');
  const drag = useRef<{ id: number; x: number; y: number; on: boolean; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  const at = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left) / Math.max(1, r.width)) * n)));
  };
  const onDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false, moved: false };
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.on) {
      if (box.current?.closest('.sheet[data-drag="active"]')) return;
      const dx = Math.abs(e.clientX - d.x), dy = Math.abs(e.clientY - d.y);
      if (dx < 8 || dx < dy) return;
      d.on = true;
      try { box.current?.setPointerCapture(e.pointerId); } catch {  }
    }
    d.moved = true;
    const i = at(e.clientX);
    if (lv[i].id !== value) onChange(lv[i].id);
  };
  const onUp = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.on) { suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0); }
    drag.current = null;
  };

  return (
    <div ref={box} className={`lvr${lv[idx]?.id === 'max' ? ' is-max' : ''}${n >= 6 ? ' lvr--dense' : ''}`} role="radiogroup" aria-label={tx('picker.thinkLevelOf', { model: model.name })}
      style={{ ['--n' as string]: n, ['--i' as string]: idx, ['--t' as string]: t.toFixed(3) }}
      data-testid={`levels-${model.id}`} data-level={lv[idx]?.id}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }}>
      <span className="lvr-fill" aria-hidden="true" />
      <span className="lvr-thumb" aria-hidden="true" />
      <span className="lvr-ghosts" aria-hidden="true" />
      {lv.map((l, i) => (
        <button key={l.id} type="button" role="radio" aria-checked={i === idx} tabIndex={i === idx ? 0 : -1} data-lvl={l.id}
          className={`lvr-opt${i < idx ? ' is-lit' : ''}${l.id === 'max' ? ' is-maxopt' : ''}`} data-testid={`lvl-${model.id}-${l.id}`} aria-label={`${l.label}: ${l.hint ?? ''}`}
          onClick={() => { if (!suppressClick.current) onChange(l.id); }}
          onKeyDown={(e) => arrowNav(e, n, idx, (j) => onChange(lv[j].id))}>
          {l.id === 'max' && i !== idx ? <span className="lv-max">{l.label}</span> : l.label}
        </button>
      ))}
    </div>
  );
}

const OPT = '.lvr-opt:not(.lvr-ghost)';
type Snap = { key: string; fam: string; opts: { id: string; x: number; w: number; html: string; cls: string }[]; thumb: { x: number; w: number }; fill: number; forHtml: string; hintHtml: string };
const MORPH_MS = 220;
const MORPH_EASE = 'cubic-bezier(.2, 0, 0, 1)';

function useLevelMorph(box: RefObject<HTMLElement | null>, key: string) {
  const snap = useRef<Snap | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const prev = snap.current;
    if (prev && prev.key !== key && typeof el.animate === 'function') morph(el, prev);
    snap.current = take(el, key);
  });
}
function take(el: HTMLElement, key: string): Snap {
  const row = el.querySelector<HTMLElement>('.lvr');
  const th = row?.querySelector<HTMLElement>('.lvr-thumb');
  return {
    key,
    fam: el.querySelector<HTMLElement>('.pk-for-now')?.dataset.fam ?? '',
    opts: [...(row?.querySelectorAll<HTMLElement>(OPT) ?? [])].map((b) => ({ id: b.dataset.lvl ?? '', x: b.offsetLeft, w: b.offsetWidth, html: b.innerHTML, cls: b.className })),
    thumb: { x: th?.offsetLeft ?? 0, w: th?.offsetWidth ?? 1 },
    fill: row?.querySelector<HTMLElement>('.lvr-fill')?.offsetWidth ?? 1,
    forHtml: el.querySelector('.pk-for-now')?.innerHTML ?? '',
    hintHtml: el.querySelector('.pk-hint-now')?.innerHTML ?? '',
  };
}
function morph(el: HTMLElement, prev: Snap) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const o = { duration: MORPH_MS, easing: MORPH_EASE };
  const fadeIn = (n: Element, d = MORPH_MS) => n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: d, easing: MORPH_EASE });
  const ghost = (host: Element | null, html: string, cls: string, style: Partial<CSSStyleDeclaration>) => {
    if (!host || !html) return;
    const g = document.createElement('span');
    g.className = cls; g.innerHTML = html; Object.assign(g.style, style);
    host.appendChild(g);
    const a = g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduce ? MORPH_MS : MORPH_MS * 0.7, easing: MORPH_EASE, fill: 'forwards' });
    a.onfinish = () => g.remove(); a.oncancel = () => g.remove();
  };
  const row = el.querySelector<HTMLElement>('.lvr');
  if (row) {
    row.classList.add('is-morph');
    window.setTimeout(() => row.classList.remove('is-morph'), MORPH_MS + 40);
    const now = [...row.querySelectorAll<HTMLElement>(OPT)];
    for (const b of now) {
      const p = prev.opts.find((x) => x.id === b.dataset.lvl);
      if (p && !reduce) {
        const dx = p.x + p.w / 2 - (b.offsetLeft + b.offsetWidth / 2);
        if (Math.abs(dx) > 0.5) b.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], o);
      } else if (!p) fadeIn(b);
    }
    const ghosts = row.querySelector('.lvr-ghosts');
    for (const p of prev.opts) if (!now.some((b) => b.dataset.lvl === p.id)) ghost(ghosts, p.html, `${p.cls} lvr-ghost`, { left: `${p.x}px`, width: `${p.w}px` });
    const th = row.querySelector<HTMLElement>('.lvr-thumb'), fill = row.querySelector<HTMLElement>('.lvr-fill');
    if (th && !reduce) th.animate([{ transform: `translateX(${prev.thumb.x - th.offsetLeft}px) scaleX(${prev.thumb.w / Math.max(1, th.offsetWidth)})` }, { transform: 'none' }], o);
    if (fill && !reduce) fill.animate([{ transform: `scaleX(${prev.fill / Math.max(1, fill.offsetWidth)})` }, { transform: 'none' }], o);
    if (reduce && th) fadeIn(th);
  }
  for (const [now, html] of [[el.querySelector('.pk-for-now'), prev.forHtml], [el.querySelector('.pk-hint-now'), prev.hintHtml]] as const) {
    if (!now || now.innerHTML === html) continue;
    if (now.classList.contains('pk-for-now') && (now as HTMLElement).dataset.fam === prev.fam) continue;
    ghost(now.parentElement?.querySelector('.pk-ghost-host') ?? null, html, 'pk-ghost', {});
    fadeIn(now);
  }
}

export function LevelBlock(props: { models: PublicModel[]; sel: Sel; onLevel: (levelId: string) => void }) {
  return levelControl() === 'pill' ? <PillLevelBlock {...props} /> : <ElasticLevelBlock {...props} />;
}

function PillLevelBlock({ models, sel, onLevel }: { models: PublicModel[]; sel: Sel; onLevel: (levelId: string) => void }) {
  const tx = useT();
  const m = models.find((x) => x.id === sel.modelId) ?? models[0];
  const l = m.levels.find((x) => x.id === sel.levelId) ?? m.levels[0];
  const box = useRef<HTMLElement>(null);
  useLevelMorph(box, m.id);
  return (
    <section className="pk-level" aria-label={tx('picker.thinkLevel')} ref={box}>
      <div className="pk-sec"><span>{tx('picker.thinkLevel')}</span>
        <span className="pk-xfh"><span className="pk-for pk-for-now" data-fam={familyOf(models, m.id)}><ModelMark id={m.id} models={models} /><Named l={levelLabel(models, sel)} /></span><span className="pk-ghost-host pk-for" aria-hidden="true" /></span></div>
      <LevelRow model={m} value={l.id} onChange={onLevel} />
      <p className="pk-hint pk-xfh" aria-live="polite" data-testid="level-hint"><span className="pk-hint-now"><LevelText id={l.id} label={l.label} /><span className="pk-dash">—</span>{l.hint}</span><span className="pk-ghost-host" aria-hidden="true" /></p>
    </section>
  );
}

export type PanelProps = {
  models: PublicModel[];
  compare: boolean;
  sel: Sel;
  pair?: Pair;
  tab?: Side;
  onModel: (modelId: string) => void;
  onTab?: (side: Side) => void;
  onLevel: (levelId: string) => void;
  onPairModel?: (side: Side, modelId: string) => void;
  onCompare?: (on: boolean) => void;
  compareNote?: string;
  pageCompare?: boolean;
  pairAny?: boolean;
};

export const manyModels = (models: PublicModel[]) => families(models).length > 1;

export function PickerPanel({ models, compare, sel, pair, tab = 'a', onModel, onTab, onLevel, onPairModel, onCompare, compareNote, pageCompare = compare, pairAny = false }: PanelProps) {
  const tx = useT();
  const sides: Side[] = ['a', 'b'];
  const status = useContext(StatusCtx);
  const fams = families(models);
  const prefs = typeof window === 'undefined' ? null : readPrefs(models);
  const cards = compare && pair
    ? sides.map((s) => ({ key: s, id: pair[s].modelId, sel: pair[s], active: s === tab }))
    : fams.map((f) => {
      const on = familyOf(models, sel.modelId) === f.id;
      const id = on ? sel.modelId : variantFor(models, f.id, prefs);
      return { key: f.id, id, sel: { modelId: id, levelId: on ? sel.levelId : prefs?.levels[id] ?? '' }, active: on };
    });
  const dupName = compare && !!pair && familyOf(models, pair.a.modelId) === familyOf(models, pair.b.modelId);
  const cur = Math.max(0, cards.findIndex((c) => c.active));
  const activeId = cards[cur]?.id ?? sel.modelId;
  const fam = fams.find((f) => f.id === familyOf(models, activeId));
  const lastVar = useRef(fam && fam.variants.length > 1 ? fam : null);
  if (fam && fam.variants.length > 1) lastVar.current = fam;
  const vf = lastVar.current;
  const showVar = !!fam && fam.variants.length > 1;
  const pickVariant = (id: string) => (compare ? onPairModel?.(tab, id) : onModel(id));
  const vm = vf ? models.find((m) => m.id === activeId && familyOf(models, m.id) === vf.id) ?? vf.variants[0] : null;
  const many = manyModels(models);
  const offText = !pageCompare ? compareNote ?? (many ? tx('picker.cmpOffMany') : tx('picker.cmpOffOne')) : (many ? tx('picker.cmpOffMany') : tx('picker.cmpOffOnePage'));
  const onText = pageCompare ? compareNote ?? tx('picker.cmpOnMany') : (many ? tx('picker.cmpOnMany') : tx('picker.cmpOnOne'));
  return (
    <div className="pk" data-testid="picker" data-mode={compare ? 'compare' : 'single'}>
      <div className="pk-models" role={compare ? 'tablist' : 'radiogroup'} aria-label={compare ? tx('picker.modelsCmp') : tx('picker.model')} style={{ ['--cols' as string]: cards.length }}>
        {cards.map((c, i) => {
          const m = models.find((x) => x.id === c.id) ?? models[0];
          const f = fams.find((x) => x.id === familyOf(models, m.id));
          const base = f?.base ?? m;
          const lvl = m.levels.find((l) => l.id === c.sel.levelId) ?? m.levels.find((l) => l.id === m.defaultLevel);
          const st = status?.models[m.id]?.state;
          const pick = () => (compare ? onTab?.(c.key as Side) : onModel(m.id));
          const variant = f && f.variants.length > 1 && m.id !== f.id ? (m.variantName ?? m.name).toLowerCase() : '';
          return (
            <button key={i} type="button" className={`pk-card${c.active ? ' is-on' : ''}${compare ? ' is-used' : ''}`}
              role={compare ? 'tab' : 'radio'} {...(compare ? { 'aria-selected': c.active } : { 'aria-checked': c.active })} tabIndex={c.active ? 0 : -1}
              data-testid={compare ? `tab-pick-${c.key}` : `model-${base.id}`} data-model={m.id}
              onClick={pick} onKeyDown={(e) => arrowNav(e, cards.length, cur, (j) => (compare ? onTab?.(cards[j].key as Side) : onModel(cards[j].id)))}>
              <span className="pk-card-top"><ModelMark id={m.id} models={models} /><b>{base.name}</b><span className="pk-check" aria-hidden="true"><Icon n="check" sm /></span></span>
              <span className="pk-xf">
                <span className="pk-card-sub" data-on={!compare || undefined} aria-hidden={compare || undefined}>{base.blurb ?? base.tagline ?? base.fullName}</span>
                <span className="pk-card-sub pk-card-side" data-on={compare || undefined} aria-hidden={!compare || undefined} title={variant ? `${variant} · ${lvl?.label ?? ''}` : undefined}>{dupName ? `${c.key.toUpperCase()} · ` : ''}{variant ? <><span className="pk-card-var">{variant}</span>{' · '}</> : tx('picker.levelWord')}{lvl && <LevelText id={lvl.id} label={lvl.label} />}</span>
              </span>
              {st && st !== 'ok' && <StateTag state={st} full className="pk-st" />}
            </button>
          );
        })}
      </div>
      {compare && pair && pairAny && fams.length > 1 && (
        <div className="k-seg k-seg--block pk-var-seg pk-fam-seg" role="radiogroup" aria-label={tx('picker.sideModel', { side: tab.toUpperCase() })} data-testid="pair-family">
          {fams.map((f) => {
            const on = familyOf(models, activeId) === f.id;
            return (
              <button type="button" key={f.id} role="radio" aria-checked={on} tabIndex={on ? 0 : -1} data-testid={`fam-${f.id}`}
                onClick={() => { if (!on) onPairModel?.(tab, variantFor(models, f.id, prefs)); }}><ModelMark id={f.id} models={models} />{f.base.name}</button>
            );
          })}
        </div>
      )}
      <div className="pk-var" data-open={showVar || undefined} aria-hidden={!showVar || undefined}>
        <div className="pk-var-in">
          {vf && vm && (
            <>
              <div className="k-seg k-seg--block pk-var-seg" role="radiogroup" aria-label={tx('picker.variantOf', { name: vf.base.name })}
                style={{ ['--n' as string]: vf.variants.length, ['--i' as string]: Math.max(0, vf.variants.findIndex((v) => v.id === vm.id)) }}>
                <span className="pk-var-pill" aria-hidden="true" />
                {vf.variants.map((v) => (
                  <button type="button" key={v.id} role="radio" aria-checked={v.id === vm.id} tabIndex={showVar ? 0 : -1} onClick={() => v.id !== vm.id && pickVariant(v.id)} data-testid={`variant-${v.id}`}>{v.variantName ?? v.name}</button>
                ))}
              </div>
              <span className="pk-xf pk-var-hint">{vf.variants.map((v) => <span key={v.id} data-on={v.id === vm.id || undefined} aria-hidden={v.id !== vm.id || undefined}>{v.variantHint ?? v.fullName}</span>)}</span>
            </>
          )}
        </div>
      </div>
      {}
      {onCompare && (models.length > 1 || models.some((m) => m.levels.length > 1)) && (
        <button type="button" className="pk-cmp" role="switch" aria-checked={compare} data-testid="compare-switch" onClick={() => onCompare(!compare)}>
          <span className="pk-cmp-t"><b>{manyModels(models) ? tx('picker.cmpBoth') : tx('picker.cmpTwo')}</b>
            <span className="pk-xf"><small data-on={!compare || undefined} aria-hidden={compare || undefined}>{offText}</small><small data-on={compare || undefined} aria-hidden={!compare || undefined} data-testid="compare-note">{onText}</small></span>
          </span>
          <span className="k-switch" data-on={compare || undefined} aria-hidden="true" />
        </button>
      )}
      <PillLevelBlock models={models} sel={sel} onLevel={onLevel} />
    </div>
  );
}

const Done = ({ onClick }: { onClick: () => void }) => {
  const tx = useT();
  return <button type="button" className="btn btn--primary pk-done" onClick={onClick} data-testid="picker-done">{tx('picker.done')}</button>;
};

export type CompareNext = { sel: Sel; pair: Pair; tab: Side };
export const exitMs = () => {
  const raw = typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue('--dur-exit').trim();
  const ms = raw.endsWith('ms') ? parseFloat(raw) : raw.endsWith('s') ? parseFloat(raw) * 1000 : 220;
  return (Number.isFinite(ms) ? ms : 220) + 30;
};

export function PickerButton({ models, compare = false, sel, pair, tab, onModel, onTab, onLevel, onPairModel, onCompare, compareNote, disabled, open: openProp, onOpenChange, instant, pending, pairAny }: Omit<PanelProps, 'onCompare' | 'pageCompare'> & {
  onCompare?: (on: boolean, next: CompareNext) => void; disabled?: boolean; open?: boolean; onOpenChange?: (o: boolean) => void; instant?: boolean; pending?: boolean;
}) {
  const tx = useT();
  const pv = PICKER_VARIANT;
  const ref = useRef<HTMLButtonElement>(null);
  const [openSelf, setOpenSelf] = useState(false);
  const open = openProp ?? openSelf;
  const setOpen = useCallback((o: boolean) => { if (onOpenChange) onOpenChange(o); else setOpenSelf(o); }, [onOpenChange]);
  const close = useCallback(() => setOpen(false), [setOpen]);
  const status = useContext(StatusCtx);
  const stateOf = (id: string): ModelState | null => status?.models[id]?.state ?? null;

  const toggleCompare = (on: boolean) => {
    if (on === compare || !onCompare) return;
    if (on) {
      const p = rememberLevel(models, sel, true);
      const r = pairFor(models, p, sel, pair ?? null, readPair(models));
      onCompare(true, { sel, pair: r.pair, tab: r.tab });
    } else if (pair) {
      const t = tab ?? 'a';
      onCompare(false, { sel: pair[t], pair, tab: t });
    }
  };

  const pl = compare && pair ? pairLabels(models, pair.a, pair.b) : null;
  const part = (s: Sel, word: boolean, side?: Side) => {
    const lab = pl && side ? pl[side === 'a' ? 0 : 1] : levelLabel(models, s), level = lab.level;
    const st = stateOf(s.modelId);
    return (
      <span className="mc-part"><ModelMark id={s.modelId} models={models} /><span className="mc-name"><Named l={lab} /></span><span className="mc-dot" aria-hidden="true">·</span><LevelText id={s.levelId} label={level} />
        {st && st !== 'ok' && (!word ? <i className={`st-dot st-dot--${st}`} title={tx(`state.${st}`)} data-state={st} data-testid={`chip-state-${s.modelId}`} /> : <StateTag state={st} className="mc-st" />)}
      </span>
    );
  };
  const stateNote = (s: Sel) => { const st = stateOf(s.modelId); return st && st !== 'ok' ? `, ${tx(`state.${st}`)}` : ''; };
  const label = compare && pair && pl
    ? tx('picker.chipPair', { a: `${pl[0].model} ${pl[0].level}${stateNote(pair.a)}`, b: `${pl[1].model} ${pl[1].level}${stateNote(pair.b)}` })
    : tx('picker.chip', { model: levelLabel(models, sel).model, level: levelLabel(models, sel).level, state: stateNote(sel) });
  return (
    <>
      <button ref={ref} type="button" disabled={disabled} className={`model-chip model-chip--btn${compare ? ' model-chip--pair' : ''}${pending ? ' is-pending' : ''}${pv === 0 ? '' : ' model-chip--calm'}`} data-st={compare ? undefined : stateOf(sel.modelId) ?? undefined} aria-haspopup="dialog" aria-expanded={open}
        aria-label={label} onClick={() => (open ? close() : setOpen(true))} data-testid="picker-btn">
        <span className="mc-body">
          {compare && pair ? <>{part(pair.a, false, 'a')}<span className="mc-plus" aria-hidden="true">+</span>{part(pair.b, false, 'b')}</> : part(sel, true)}
        </span>
        <Icon n="chev-down" sm />
      </button>
      {pv === 0 ? (
        <Popover anchor={ref.current} open={open} onClose={close} title={tx('picker.title')} side="top" className="pop--picker" sheetClass="sheet--picker" bodyClass="pk-body"
          focusFirst={'.pk-card.is-on'} instant={instant} testId="picker-pop" foot={<Done onClick={close} />}>
          <PickerPanel models={models} compare={compare} sel={sel} pair={pair} tab={tab} onModel={onModel} onTab={onTab} onLevel={onLevel} onPairModel={onPairModel} onCompare={onCompare ? toggleCompare : undefined} compareNote={compareNote} pageCompare={compare} pairAny={pairAny} />
        </Popover>
      ) : (
        <Popover anchor={ref.current} open={open} onClose={close} title={tx('picker.title')} side="top" className="pop--picker pop--pkv" sheetClass="sheet--picker sheet--pkv" bodyClass="pk-body"
          focusFirst={TRACK_FOCUS} instant={instant} testId="picker-pop">
          <TrackPanel models={models} compare={compare} sel={sel} pair={pair} tab={tab} onModel={onModel} onTab={onTab} onLevel={onLevel} onPairModel={onPairModel} onCompare={onCompare ? toggleCompare : undefined} compareNote={compareNote} pageCompare={compare} pairAny={pairAny} />
        </Popover>
      )}
    </>
  );
}

export function LevelButton({ models, sel, onLevel, align = 'left', disabled, side }: { models: PublicModel[]; sel: Sel; onLevel: (levelId: string) => void; align?: 'left' | 'right'; disabled?: boolean; side: Side }) {
  const tx = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const lab = levelLabel(models, sel), { model, level } = lab;
  const own = PICKER_VARIANT === 0;
  return (
    <>
      <button ref={ref} type="button" disabled={disabled} className={`lvl-btn${own ? '' : ' lvl-btn--calm'}`} aria-haspopup="dialog" aria-expanded={open} aria-label={tx('picker.levelOf', { model, level })}
        onClick={() => setOpen(!open)} data-testid={`lvl-btn-${side}`}>
        <ModelMark id={sel.modelId} models={models} /><Named l={lab} /><LevelText id={sel.levelId} label={level} />
        <Icon n="chev-down" sm />
      </button>
      <Popover anchor={ref.current} open={open} onClose={close} title={tx('picker.levelTitle', { model })} side="bottom" align={align}
        className={own ? 'pop--picker' : 'pop--picker pop--pkv'} sheetClass={own ? 'sheet--picker' : 'sheet--picker sheet--pkv'} bodyClass="pk-body"
        focusFirst={own ? '.lvr-opt[aria-checked=true]' : '[role=slider]'} testId="level-pop" foot={own ? <Done onClick={close} /> : undefined}>
        <div className={own ? 'pk' : 'pk pkv'}><LevelBlock models={models} sel={sel} onLevel={onLevel} /></div>
      </Popover>
    </>
  );
}
