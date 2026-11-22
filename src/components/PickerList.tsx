'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PublicModel } from '@/lib/models';
import type { Sel } from '@/lib/levels';
import { useT } from '@/lib/i18n/react';
import { modelMult, timesFew, warmMult } from '@/lib/levelMult';
import { Icon } from './Icon';
import { ModelMark } from './ModelMark';
import { useLockedModels } from './Shell';
import { useIsMobile } from './Popover';
import { CompareAction, SideTabs, Sub, VariantPick, usePanel, type P } from './PickerTrack';
import type { PanelProps } from './ModelPicker';
import '@/styles/kit.css';
import '@/styles/picker.css';
import '@/styles/picker-track.css';
import '@/styles/picker-list.css';

type T = ReturnType<typeof useT>;
const num = (x: number, lang: string) => new Intl.NumberFormat(lang === 'en' ? 'en-US' : lang === 'sr' ? 'sr-Latn' : 'ru-RU', { maximumFractionDigits: 2 }).format(x);
const times = (t: T, n: number) => t(timesFew(n) ? 'picker.timesFew' : 'picker.timesMany');

function ModelList({ P }: { P: P }) {
  const { rows, models, tx } = P;
  const locked = useLockedModels().filter((l) => !rows.some((r) => r.fam === l.id));
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div className="pkl-models" role="radiogroup" aria-label={P.groupLabel} data-nav="model">
      {rows.map((r) => {
        const m = models.find((x) => x.id === r.id) ?? r.base;
        const x = modelMult(m);
        return (
          <button key={r.fam} type="button" role="radio" aria-checked={r.on} className={`pkl-row${r.on ? ' is-on' : ''}`} data-nav-item="model" data-testid={`model-${r.fam}`} data-model={r.id}
            disabled={!P.pickable && !r.on} onClick={() => P.pick(r.id)}>
            <ModelMark id={r.id} models={models} />
            <span className="pkl-row-t"><b>{r.base.name}</b><small><Sub r={r} /></small>
              {x && <small className="pkl-mult" data-testid={`model-mult-${r.fam}`}>{tx('picker.multModel', { n: num(x, tx.lang), w: times(tx, x) })}</small>}</span>
            {r.on && <Icon n="check" sm className="pkl-ok" />}
          </button>
        );
      })}
      {locked.map((l) => (
        <button key={l.id} type="button" role="radio" aria-checked={false} aria-disabled="true" className="pkl-row is-locked" data-testid={`model-${l.id}`} data-locked=""
          onClick={() => { setMsg(tx('picker.locked', { model: l.name })); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setMsg(null), 2600); }}>
          <ModelMark id={l.id} />
          <span className="pkl-row-t"><b>{l.name}</b><small aria-live="polite">{msg && msg.startsWith(l.name) ? msg : tx('picker.lockedShort')}</small></span>
        </button>
      ))}
    </div>
  );
}

function Levels({ m, sel, onLevel }: { m: PublicModel; sel: Sel; onLevel: (id: string) => void }) {
  const tx = useT();
  return (
    <div className="pkl-lvs" role="radiogroup" aria-label={tx('picker.thinkLevelOf', { model: m.name })}>
      <p className="pkl-lv-note">{tx('picker.lvNote')}</p>
      {m.levels.map((l) => {
        const on = l.id === sel.levelId;
        const warm = warmMult(m, l.id);
        const tip = warm ? tx('picker.maxTip', { model: m.name, n: num(warm, tx.lang), w: times(tx, warm) }) : undefined;
        return (
          <button key={l.id} type="button" role="radio" aria-checked={on} className={`pkl-lv${on ? ' is-on' : ''}`} data-testid={`lvl-${m.id}-${l.id}`} aria-description={tip}
            onClick={() => onLevel(l.id)}>
            <span className="pkl-lv-t">{l.label}</span>
            {l.id === m.defaultLevel && <span className="pkl-rec">{tx('picker.recommended')}</span>}
            {warm && <span className="pkl-warm" data-testid="lvl-warm"><Icon n="warn" sm />{tx('picker.multMore', { n: num(warm, tx.lang) })}</span>}
            {on && <Icon n="check" sm className="pkl-ok" />}
            {tip && <span className="pkl-tip" role="tooltip">{tip}</span>}
          </button>
        );
      })}
    </div>
  );
}

function LevelRow({ P, onLevel }: { P: P; onLevel: (id: string) => void }) {
  const { tx, models, cur } = P;
  const m = models.find((x) => x.id === cur.modelId) ?? models[0];
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; flip: boolean } | null>(null);
  const hover = useRef(0);
  useLayoutEffect(() => {
    if (!open || mobile || !row.current) return;
    const place = () => {
      const r = row.current!.getBoundingClientRect(), pop = row.current!.closest('.pop')?.getBoundingClientRect() ?? r;
      const w = 300, gap = 6, flip = pop.right + gap + w > window.innerWidth - 8;
      setPos({ left: flip ? pop.left - gap - w : pop.right + gap, top: Math.max(8, Math.min(r.top - 52, window.innerHeight - 340)), flip });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, mobile]);
  useEffect(() => () => window.clearTimeout(hover.current), []);
  if (m.levels.length < 2) return null;
  const cl = m.levels.find((l) => l.id === cur.levelId) ?? m.levels[0];
  const warm = warmMult(m, cl.id);
  const pick = (id: string) => { onLevel(id); if (mobile) setOpen(false); };
  const enter = () => { if (mobile) return; window.clearTimeout(hover.current); setOpen(true); };
  const leave = () => { if (mobile) return; window.clearTimeout(hover.current); hover.current = window.setTimeout(() => setOpen(false), 260); };
  return (
    <div className="pkl-lvrow-box" data-open={open || undefined}>
      <button ref={row} type="button" className={`pkl-lvrow${open ? ' is-open' : ''}`} aria-haspopup="true" aria-expanded={open} data-testid="level-row"
        onClick={() => setOpen((o) => !o)} onPointerEnter={enter} onPointerLeave={leave} onKeyDown={(e) => { if (e.key === 'ArrowRight') { e.preventDefault(); setOpen(true); } }}>
        <span className="pkl-lvrow-t">{tx('picker.level')}</span>
        <span className="pkl-lvrow-v">{cl.label}{warm && <Icon n="warn" sm className="pkl-warn-ic" />}</span>
        <Icon n={mobile ? (open ? 'chev-up' : 'chev-down') : 'chev-right'} sm className="pkl-chev" />
      </button>
      {mobile ? (
        <div className="pkl-acc" data-open={open || undefined} aria-hidden={!open || undefined}>
          <div className="pkl-acc-in">{open && <Levels m={m} sel={cur} onLevel={pick} />}</div>
        </div>
      ) : open && pos && createPortal(
        <div className={`pkl-sub${pos.flip ? ' is-flip' : ''}`} style={{ left: pos.left, top: pos.top }} data-pop-keep="" data-testid="level-sub"
          onPointerEnter={enter} onPointerLeave={leave} onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'Escape') { e.stopPropagation(); setOpen(false); row.current?.focus(); } }}>
          <Levels m={m} sel={cur} onLevel={pick} />
        </div>, document.body)}
    </div>
  );
}

export function ListPanel(props: PanelProps) {
  const P = usePanel(props);
  return (
    <div className="pk pkl" data-testid="picker" data-mode={props.compare ? 'compare' : 'single'} data-variant="list">
      {P.cmp && props.pair && <SideTabs models={P.models} pair={props.pair} tab={P.tab} onTab={props.onTab} />}
      <ModelList P={P} />
      <VariantPick P={P} />
      <hr className="pkl-sep" />
      <LevelRow P={P} onLevel={props.onLevel} />
      <CompareAction P={P} />
    </div>
  );
}
