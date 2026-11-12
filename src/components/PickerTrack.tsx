'use client';
import { useContext, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { PublicModel } from '@/lib/models';
import type { ModelState } from '@/lib/announce';
import { families, familyOf, readPrefs, variantFor, type Sel } from '@/lib/levels';
import { useT } from '@/lib/i18n/react';
import { Icon } from './Icon';
import { StateTag, StatusCtx } from './Announce';
import { ModelMark } from './ModelMark';
import { useLockedModels } from './Shell';
import { LevelBlock, LevelText, Named, levelLabel, manyModels, pairLabels, type PanelProps, type Pair, type Side } from './ModelPicker';
import '@/styles/kit.css';
import '@/styles/picker.css';
import '@/styles/picker-track.css';

export const TRACK_FOCUS = '[data-nav-item=model][aria-checked=true], [role=slider]';

function keyNav(e: KeyboardEvent, n: number, cur: number, go: (i: number) => void, kind: string) {
  const k = e.key;
  let i = -1;
  if (k === 'ArrowRight' || k === 'ArrowDown') i = Math.min(n - 1, cur + 1);
  else if (k === 'ArrowLeft' || k === 'ArrowUp') i = Math.max(0, cur - 1);
  else if (k === 'Home') i = 0;
  else if (k === 'End') i = n - 1;
  if (i < 0) return;
  e.preventDefault();
  if (i !== cur) go(i);
  const box = (e.currentTarget as HTMLElement).closest(`[data-nav="${kind}"]`);
  requestAnimationFrame(() => box?.querySelectorAll<HTMLElement>(`[data-nav-item="${kind}"]`)[i]?.focus());
}

type Row = { fam: string; id: string; base: PublicModel; on: boolean; st: ModelState | null };

function usePanel(p: PanelProps) {
  const tx = useT();
  const status = useContext(StatusCtx);
  const { models } = p;
  const fams = families(models);
  const prefs = typeof window === 'undefined' ? null : readPrefs(models);
  const cmp = p.compare && !!p.pair;
  const tab: Side = p.tab ?? 'a';
  const cur: Sel = p.sel;
  const activeFam = familyOf(models, cur.modelId);
  const rows: Row[] = fams.map((f) => {
    const on = f.id === activeFam;
    const id = on ? cur.modelId : variantFor(models, f.id, prefs);
    return { fam: f.id, id, base: f.base, on, st: status?.models[id]?.state ?? null };
  });
  const curIdx = Math.max(0, rows.findIndex((r) => r.on));
  const pickable = !cmp || (!!p.pairAny && fams.length > 1);
  const pick = (id: string) => {
    if (!models.some((m) => m.id === id) || familyOf(models, id) === activeFam) return;
    if (cmp) p.onPairModel?.(tab, id); else p.onModel(id);
  };
  const many = manyModels(models);
  const note = p.compareNote ?? (p.compare ? tx(many ? 'picker.cmpOnMany' : 'picker.cmpOnOne') : tx(many ? 'picker.cmpOffMany' : 'picker.cmpOffOne'));
  const canCompare = !!p.onCompare && (models.length > 1 || models.some((m) => m.levels.length > 1));
  const groupLabel = cmp ? tx('picker.sideModel', { side: tab.toUpperCase() }) : tx('picker.model');
  return { tx, p, models, rows, curIdx, cur, cmp, tab, pickable, pick, many, note, canCompare, groupLabel };
}
type P = ReturnType<typeof usePanel>;

const blurbOf = (m: PublicModel) => m.blurb ?? m.tagline ?? m.fullName;
const Sub = ({ r }: { r: Row }) => <>{blurbOf(r.base)}{r.st && r.st !== 'ok' && <StateTag state={r.st} className="pkv-st" />}</>;

function SideTabs({ models, pair, tab, onTab }: { models: PublicModel[]; pair: Pair; tab: Side; onTab?: (s: Side) => void }) {
  const tx = useT();
  const pl = pairLabels(models, pair.a, pair.b);
  const sides: Side[] = ['a', 'b'];
  const cur = sides.indexOf(tab);
  return (
    <div className="pkv-sides" role="tablist" aria-label={tx('picker.modelsCmp')} data-nav="side" style={{ ['--i' as string]: cur }}>
      <span className="pkv-sides-pill" aria-hidden="true" />
      {sides.map((s, i) => (
        <button key={s} type="button" role="tab" aria-selected={s === tab} tabIndex={s === tab ? 0 : -1} className="pkv-side" data-nav-item="side"
          data-testid={`tab-pick-${s}`} data-model={pair[s].modelId} onClick={() => onTab?.(s)} onKeyDown={(e) => keyNav(e, 2, cur, (j) => onTab?.(sides[j]), 'side')}>
          <span className="pkv-side-k" aria-hidden="true">{s.toUpperCase()}</span>
          <ModelMark id={pair[s].modelId} models={models} />
          <span className="pkv-side-t"><b><Named l={pl[i]} /></b><small><LevelText id={pair[s].levelId} label={pl[i].level} /></small></span>
        </button>
      ))}
    </div>
  );
}

function VariantPick({ P: { models, cur, cmp, tab, p, tx } }: { P: P }) {
  const fams = families(models);
  const fam = fams.find((f) => f.id === familyOf(models, cur.modelId));
  const show = !!fam && fam.variants.length > 1;
  const last = useRef(show ? fam! : null);
  if (show) last.current = fam!;
  const vf = last.current;
  const vm = vf ? models.find((m) => m.id === cur.modelId && familyOf(models, m.id) === vf.id) ?? vf.variants[0] : null;
  const pickVariant = (id: string) => (cmp ? p.onPairModel?.(tab, id) : p.onModel(id));
  if (!vf || !vm) return null;
  return (
    <div className="pk-var" data-open={show || undefined} aria-hidden={!show || undefined}>
      <div className="pk-var-in">
        <div className="k-seg k-seg--block pk-var-seg" role="radiogroup" aria-label={tx('picker.variantOf', { name: vf.base.name })}
          style={{ ['--n' as string]: vf.variants.length, ['--i' as string]: Math.max(0, vf.variants.findIndex((v) => v.id === vm.id)) }}>
          <span className="pk-var-pill" aria-hidden="true" />
          {vf.variants.map((v) => (
            <button type="button" key={v.id} role="radio" aria-checked={v.id === vm.id} tabIndex={show ? 0 : -1} onClick={() => v.id !== vm.id && pickVariant(v.id)} data-testid={`variant-${v.id}`}>{v.variantName ?? v.name}</button>
          ))}
        </div>
        <span className="pk-xf pk-var-hint">{vf.variants.map((v) => <span key={v.id} data-on={v.id === vm.id || undefined} aria-hidden={v.id !== vm.id || undefined}>{v.variantHint ?? v.fullName}</span>)}</span>
      </div>
    </div>
  );
}

function CompareAction({ P }: { P: P }) {
  const id = useRef(`pkv-cmp-${Math.random().toString(36).slice(2, 8)}`).current;
  if (!P.canCompare || !P.p.onCompare) return null;
  const on = P.p.compare;
  const label = on ? P.tx(P.many ? 'picker.v.cmpExit' : 'picker.v.cmpExitOne') : P.tx(P.many ? 'picker.v.cmpAdd' : 'picker.cmpTwo');
  return (
    <div className="pkv-cmp-wrap">
      <button type="button" className={`pkv-cmp${on ? ' is-on' : ''}`} onClick={() => P.p.onCompare?.(!on)} aria-describedby={on ? undefined : id} data-testid="compare-switch" data-on={on || undefined}>
        <Icon n={on ? 'x' : 'columns'} sm />
        <span className="pkv-cmp-t"><b>{label}</b></span>
      </button>
      {!on && <span id={id} className="pkv-sr">{P.note}</span>}
    </div>
  );
}

function ModelTrack({ P }: { P: P }) {
  const { rows, curIdx, models } = P;
  const locked = useLockedModels().filter((l) => !rows.some((r) => r.fam === l.id));
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const showLocked = (name: string) => {
    setMsg(P.tx('picker.locked', { model: name }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2600);
  };
  const n = rows.length + locked.length;
  return (
    <div className="pkv-mseg-box">
      <div className="pkv-mseg" role="radiogroup" aria-label={P.groupLabel} data-nav="model" style={{ ['--n' as string]: n, ['--i' as string]: curIdx }}>
        <span className="pkv-mseg-pill" aria-hidden="true" />
        {rows.map((r) => (
          <button key={r.fam} type="button" role="radio" aria-checked={r.on} tabIndex={r.on ? 0 : -1} className="pkv-mseg-opt" data-nav-item="model"
            data-testid={`model-${r.fam}`} data-model={r.id}
            onClick={() => { setMsg(null); P.pick(r.id); }} onKeyDown={(e) => keyNav(e, rows.length, curIdx, (j) => P.pick(rows[j].id), 'model')}>
            <ModelMark id={r.id} models={models} /><span>{r.base.name}</span>
          </button>
        ))}
        {locked.map((l) => (
          <button key={l.id} type="button" role="radio" aria-checked={false} aria-disabled="true" tabIndex={-1} className="pkv-mseg-opt is-locked"
            data-testid={`model-${l.id}`} data-locked="" aria-label={P.tx('picker.locked', { model: l.name })} onClick={() => showLocked(l.name)}>
            <ModelMark id={l.id} /><span>{l.name}</span>
          </button>
        ))}
      </div>
      <p className="pkv-blurb pk-xf" aria-live="polite" data-testid="model-blurb">
        {rows.map((r) => <span key={r.fam} data-on={(!msg && r.on) || undefined} aria-hidden={!!msg || !r.on || undefined}><Sub r={r} /></span>)}
        <span className="pkv-locked-msg" data-on={msg ? true : undefined} aria-hidden={!msg || undefined}>{msg}</span>
      </p>
    </div>
  );
}

export function TrackPanel(props: PanelProps) {
  const P = usePanel(props);
  const { rows, curIdx, models } = P;
  const lockedN = useLockedModels().length;
  const track = P.pickable && rows.length + lockedN > 1;
  return (
    <div className="pk pkv" data-testid="picker" data-mode={props.compare ? 'compare' : 'single'} data-variant="c">
      {P.cmp && props.pair && <SideTabs models={models} pair={props.pair} tab={P.tab} onTab={props.onTab} />}
      {track ? <ModelTrack P={P} /> : (
        <div className="pkv-sum">
          <ModelMark id={rows[curIdx].id} models={models} />
          <span className="pkv-row-t"><b><Named l={levelLabel(models, P.cur)} /></b><small><Sub r={rows[curIdx]} /></small></span>
        </div>
      )}
      <VariantPick P={P} />
      <LevelBlock models={models} sel={P.cur} onLevel={props.onLevel} />
      <CompareAction P={P} />
    </div>
  );
}
