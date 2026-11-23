import { MARK, type Tip } from './glint';
import { haptic as vibrate } from './haptic';

export type ELevel = { id: string; label: string; hint?: string; mult?: number };
export type EMult = { view: 'head' | 'cells' | 'warm'; fmt: (x: number) => string; note: (x: number, uniform: boolean) => string; tip?: (x: number) => string };
export type EOpts = {
  levels: ELevel[];
  value: string;
  caption: string;
  label: string;
  onChange: (id: string) => void;
  testId?: string;
  mult?: EMult;
};
export type ElasticHandle = { update(o: Partial<EOpts>): void; destroy(): void };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (x: number) => { const c = clamp01(x); return c * c * (3 - 2 * c); };
const ease = (x: number) => { const c = clamp01(x); return c < 0.5 ? 2 * c * c : 1 - (-2 * c + 2) ** 2 / 2; };
const f2 = (x: number) => (Math.round(x * 100) / 100).toString();


let iosSwitch: HTMLLabelElement | null = null;
export function haptic(strong: boolean) {
  if (typeof navigator === 'undefined') return;
  if (typeof navigator.vibrate === 'function') { vibrate(strong ? [10, 40, 16] : 8); return; }
  try {
    if (!/iP(hone|ad|od)/.test(navigator.userAgent) || typeof document === 'undefined') return;
    if (!iosSwitch) {
      const l = document.createElement('label');
      l.setAttribute('aria-hidden', 'true');
      l.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
      const i = document.createElement('input');
      i.type = 'checkbox'; i.setAttribute('switch', ''); i.tabIndex = -1;
      l.appendChild(i); document.body.appendChild(l); iosSwitch = l;
    }
    const a = document.activeElement as HTMLElement | null;
    iosSwitch.click();
    if (a && document.activeElement !== a) a.focus({ preventScroll: true });
  } catch {  }
}


type Sp = { x: number; v: number };
export function spring(s: Sp, target: number, w: number, z: number, dt: number, eps = 1e-4): boolean {
  let left = Math.min(dt, 0.05);
  while (left > 0) {
    const h = Math.min(left, 1 / 240);
    s.v += (w * w * (target - s.x) - 2 * z * w * s.v) * h;
    s.x += s.v * h;
    left -= h;
  }
  if (Math.abs(target - s.x) < eps && Math.abs(s.v) < eps * 10) { s.x = target; s.v = 0; return false; }
  return true;
}


const RANK = [1, 0, 3, 2];
export function powerD(power: number, open: number): string {
  const [cx, cy] = MARK.C, R = MARK.R;
  const tips = MARK.outer.map(([a, l], i): Tip => [a, lerp(0.17, l, ease(clamp01(power * 4 - RANK[i])))]);
  const ks = tips.map(([, L], i) => 1.35 * (L / MARK.outer[i][1]));
  const u = tips.map(([a]) => [Math.cos((a * Math.PI) / 180), -Math.sin((a * Math.PI) / 180)]);
  const pt = tips.map(([, L], i) => [cx + R * L * u[i][0], cy + R * L * u[i][1]]);
  let d = `M${f2(pt[0][0])} ${f2(pt[0][1])}`;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, a = MARK.outerCtl[2 * i] * ks[i], b = MARK.outerCtl[2 * i + 1] * ks[j];
    d += `C${f2(cx + a * u[i][0])} ${f2(cy + a * u[i][1])} ${f2(cx + b * u[j][0])} ${f2(cy + b * u[j][1])} ${f2(pt[j][0])} ${f2(pt[j][1])}`;
  }
  d += 'Z';
  if (open > 0.02) {
    const iu = MARK.inner.map(([a]) => [Math.cos((a * Math.PI) / 180), -Math.sin((a * Math.PI) / 180)]);
    const ip = MARK.inner.map(([, l], i) => [cx + R * l * open * iu[i][0], cy + R * l * open * iu[i][1]]);
    d += `M${f2(ip[0][0])} ${f2(ip[0][1])}`;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, a = MARK.innerCtl[2 * i] * open, b = MARK.innerCtl[2 * i + 1] * open;
      d += `C${f2(cx + a * iu[i][0])} ${f2(cy + a * iu[i][1])} ${f2(cx + b * iu[j][0])} ${f2(cy + b * iu[j][1])} ${f2(ip[j][0])} ${f2(ip[j][1])}`;
    }
    d += 'Z';
  }
  return d;
}


const NS = 'http://www.w3.org/2000/svg';
const TP = 3;
const VB = '280 140 452 735';
const MC = MARK.C;
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const div = (cls: string) => { const e = document.createElement('div'); e.className = cls; return e; };

export function mountElastic(host: HTMLElement, init: EOpts): ElasticHandle {
  let o: EOpts = { ...init };
  const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const uid = 'kxe' + Math.random().toString(36).slice(2, 8);

  const root = div('kxe');
  const head = div('kxe-head');
  const cap = document.createElement('span'); cap.className = 'kxe-cap';
  const val = document.createElement('span'); val.className = 'kxe-val';
  const valL = document.createElement('em'), valH = document.createElement('span');
  val.append(valL, valH);
  const pow = svg('svg', { class: 'kxe-pow', viewBox: VB, 'aria-hidden': 'true', focusable: 'false' });
  const powG = svg('linearGradient', { id: `${uid}-ps`, gradientUnits: 'userSpaceOnUse', x1: '0', y1: '0', x2: '0', y2: '0' });
  powG.append(svg('stop', { offset: '0', style: 'stop-color: var(--text-strong)', 'stop-opacity': '0' }), svg('stop', { offset: '.5', style: 'stop-color: var(--text-strong)', 'stop-opacity': '1' }), svg('stop', { offset: '1', style: 'stop-color: var(--text-strong)', 'stop-opacity': '0' }));
  const powClip = svg('clipPath', { id: `${uid}-pc` });
  const powClipP = svg('path', { d: '' });
  powClip.append(powClipP);
  const powDefs = svg('defs', {});
  powDefs.append(powG, powClip);
  const powP = svg('path', { class: 'kxe-pow-p', d: '', 'fill-rule': 'evenodd' });
  const powS = svg('rect', { x: '280', y: '140', width: '452', height: '735', fill: `url(#${uid}-ps)`, 'clip-path': `url(#${uid}-pc)`, opacity: '0' });
  pow.append(powDefs, powP, powS);
  const mul = document.createElement('span'); mul.className = 'kxe-mult';
  head.append(cap, val, mul, pow);
  const zone = div('kxe-zone');
  zone.setAttribute('role', 'slider'); zone.tabIndex = 0;
  zone.setAttribute('aria-orientation', 'horizontal'); zone.setAttribute('aria-valuemin', '0');
  zone.dataset.nodrag = ''; zone.dataset.navItem = 'level';
  const track = div('kxe-track');
  const pillBg = div('kxe-pill');
  const rowBase = div('kxe-row'), rowOn = div('kxe-row kxe-row--on');
  track.append(rowBase, pillBg, rowOn);
  track.setAttribute('aria-hidden', 'true');
  zone.append(track);
  const mrow = div('kxe-mrow'); mrow.setAttribute('aria-hidden', 'true');
  const note = document.createElement('p'); note.className = 'kxe-note';
  root.append(head, zone, mrow, note);
  host.append(root);

  let levels = o.levels, n = levels.length;
  const idxOf = (v: string) => Math.max(0, levels.findIndex((l) => l.id === v));
  const pOf = (i: number) => (n > 1 ? i / (n - 1) : 0);
  let near = idxOf(o.value);
  const X: Sp = { x: pOf(near), v: 0 };
  let target = X.x;
  const J: Sp = { x: 0, v: 0 };
  const S: Sp = { x: 1, v: 0 };
  const Pr: Sp = { x: 0, v: 0 };
  let sweepT = -1;
  let drag = false, pid = -1;
  let rect: DOMRect | null = null;
  let W = 0;
  const lastIsMax = () => levels[n - 1]?.id === 'max';
  const offFirst = () => levels[0]?.id === 'off';
  const maxness = (p: number) => (lastIsMax() && n > 1 ? smooth(clamp01(p) * (n - 1) - (n - 2)) : 0);
  const powerOf = (x: number) => (n < 2 ? 1 : offFirst() ? clamp01(x) : clamp01((clamp01(x) * (n - 1) + 1) / n));

  const mults = () => levels.map((l) => l.mult ?? 0);
  const uniform = () => { const ms = mults().filter((x) => x > 0); return ms.length > 0 && ms.every((x) => x === ms[0]) && ms.length === n; };
  const anyMult = () => !!o.mult && mults().some((x) => x > 0);
  const inCells = () => anyMult() && o.mult!.view === 'cells' && !uniform();
  const warmAt = () => (anyMult() && o.mult!.view === 'warm' && !uniform() ? levels.findIndex((l) => l.id === 'max' && (l.mult ?? 0) > 1) : -1);
  const buildMults = () => {
    mrow.textContent = '';
    const w = warmAt();
    if (w >= 0) {
      mrow.hidden = false;
      mrow.classList.add('kxe-mrow--warm');
      levels.forEach((l, i) => {
        if (i !== w) return;
        const c = document.createElement('span');
        c.className = 'kxe-m kxe-m--warm';
        {
          const b = document.createElement('span'); b.className = 'kxe-warm'; b.tabIndex = 0; b.dataset.testid = 'lvl-warm';
          b.innerHTML = '<svg class="i i--sm" aria-hidden="true" focusable="false"><use href="#i-warn"/></svg>';
          b.append(document.createTextNode(o.mult!.fmt(l.mult!)));
          const tip = o.mult!.tip?.(l.mult!);
          if (tip) { const t = document.createElement('span'); t.className = 'kxe-tip'; t.setAttribute('role', 'tooltip'); t.textContent = tip; b.append(t); b.setAttribute('aria-label', tip); }
          c.append(b);
        }
        mrow.append(c);
      });
      return;
    }
    mrow.classList.remove('kxe-mrow--warm');
    mrow.hidden = !inCells();
    if (!inCells()) return;
    for (const l of levels) {
      const c = document.createElement('span');
      c.className = `kxe-m${l.id === 'max' ? ' is-max' : ''}`;
      c.textContent = l.mult ? o.mult!.fmt(l.mult) : '';
      mrow.append(c);
    }
  };
  const buildLabels = () => {
    buildMults();
    rowBase.textContent = ''; rowOn.textContent = '';
    const pre = o.testId?.startsWith('levels-') ? `lvl-${o.testId.slice(7)}-` : null;
    levels.forEach((l) => {
      for (const row of [rowBase, rowOn]) {
        const c = document.createElement('span');
        c.className = 'kxe-cell';
        c.textContent = l.label;
        if (row === rowBase) {
          c.dataset.lvl = l.id;
          if (pre) c.dataset.testid = pre + l.id;
          c.addEventListener('click', () => {
            const i = levels.findIndex((x) => x.id === l.id);
            if (i < 0 || i === near) return;
            commit(i, false); target = pOf(near); kick();
          });
        }
        row.append(c);
      }
    });
    root.classList.toggle('kxe--dense', n >= 6);
    root.style.setProperty('--n', String(n));
  };
  const paintLabels = () => {
    const cs = rowBase.children;
    for (let i = 0; i < cs.length; i++) cs[i].className = `kxe-cell${i === near ? ' is-on' : ''}`;
    const ms = mrow.children;
    const w = warmAt();
    if (w >= 0) { const off = near !== w; mrow.classList.toggle('kxe-mrow--off', off); mrow.toggleAttribute('aria-hidden', off); return; }
    for (let i = 0; i < ms.length; i++) ms[i].classList.toggle('is-on', i === near);
  };
  const paintText = (animateIt: boolean) => {
    const l = levels[near];
    cap.textContent = o.caption;
    valL.textContent = l?.label ?? '';
    valH.textContent = l?.hint ?? '';
    const m = l?.mult && anyMult() && !inCells() && o.mult!.view !== 'warm' ? l.mult : 0;
    mul.textContent = m ? o.mult!.fmt(m) : '';
    mul.hidden = !m;
    mul.classList.toggle('is-max', !!m && l?.id === 'max' && !uniform());
    const nt = l?.mult && anyMult() ? o.mult!.note(l.mult, uniform()) : '';
    note.textContent = nt;
    note.hidden = !nt;
    zone.setAttribute('aria-label', o.label);
    zone.setAttribute('aria-valuemax', String(Math.max(0, n - 1)));
    zone.setAttribute('aria-valuenow', String(near));
    zone.setAttribute('aria-valuetext', l ? (l.hint ? `${l.label} — ${l.hint}` : l.label) : '');
    zone.dataset.level = l?.id ?? '';
    if (o.testId) zone.dataset.testid = o.testId;
    if (animateIt && !reduce() && typeof val.animate === 'function') val.animate([{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,0,0,1)' });
  };

  let raf = 0, last = 0;
  const hasRaf = typeof requestAnimationFrame === 'function';
  const kick = () => {
    if (!hasRaf) { render(); return; }
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  };
  const frame = (now: number) => {
    raf = 0;
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    const busy = step(dt);
    render();
    if (busy) raf = requestAnimationFrame(frame);
  };
  const span = () => Math.max(1, W - 2 * TP - (W - 2 * TP) / Math.max(1, n));
  const step = (dt: number): boolean => {
    if (reduce()) { X.x = target; X.v = 0; J.x = 0; J.v = 0; S.x = 1; S.v = 0; Pr.x = drag ? 1 : 0; Pr.v = 0; sweepT = -1; return false; }
    let busy = drag;
    busy = spring(X, target, drag ? 34 : 21, drag ? 0.82 : 0.6, dt) || busy;
    busy = spring(Pr, drag ? 1 : 0, 30, 0.6, dt) || busy;
    busy = spring(J, Math.min(0.22, Math.abs(X.v * span()) / 2600), 26, 0.28, dt, 1e-3) || busy;
    busy = spring(S, 1, 22, 0.36, dt, 1e-3) || busy;
    if (sweepT >= 0) { sweepT += dt / 0.7; if (sweepT > 1) sweepT = -1; busy = true; }
    return busy;
  };
  const render = () => {
    const mx = maxness(X.x), pw = powerOf(X.x), d = powerD(pw, mx * 1.12);
    powP.setAttribute('d', d);
    pow.style.opacity = f2(0.38 + 0.62 * smooth(pw * 4));
    pow.style.transform = S.x === 1 ? '' : `scale(${f2(S.x)})`;
    pow.style.filter = mx > 0.01 ? `drop-shadow(0 0 ${f2(3.5 * mx)}px rgba(var(--glint-rgb), calc(${f2(0.42 * mx)} * var(--glint-k))))` : '';
    if (sweepT >= 0) {
      powClipP.setAttribute('d', d);
      const c = lerp(-430, 430, ease(sweepT)), ux = Math.cos((62 * Math.PI) / 180), uy = -Math.sin((62 * Math.PI) / 180);
      powG.setAttribute('x1', f2(MC[0] + ux * (c - 110))); powG.setAttribute('y1', f2(MC[1] + uy * (c - 110)));
      powG.setAttribute('x2', f2(MC[0] + ux * (c + 110))); powG.setAttribute('y2', f2(MC[1] + uy * (c + 110)));
      powS.setAttribute('opacity', f2(Math.sin(Math.PI * sweepT)));
    } else powS.setAttribute('opacity', '0');
    if (!W) return;
    const p = clamp01(X.x), inner = W - 2 * TP, cw = inner / Math.max(1, n);
    const cx = TP + cw / 2 + p * (inner - cw);
    const sx = (1 + J.x) * (1 + 0.04 * Pr.x);
    const left = cx - (cw * sx) / 2, right = cx + (cw * sx) / 2;
    pillBg.style.transform = `translateX(${f2(left - TP)}px) scaleX(${f2(sx)})`;
    rowOn.style.clipPath = `inset(${TP}px ${f2(Math.max(0, W - right))}px ${TP}px ${f2(Math.max(0, left))}px round 999px)`;
  };

  const commit = (i: number, touch: boolean) => {
    if (i === near || !levels[i]) return;
    near = i;
    paintLabels(); paintText(true);
    const id = levels[i].id;
    if (touch) haptic(id === 'max');
    if (!reduce()) {
      J.v -= 1.2;
      S.v += 3.8;
      if (id === 'max' && lastIsMax()) sweepT = 0;
    }
    o.onChange(id);
    kick();
  };
  const fingerAt = (e: PointerEvent) => {
    const r = rect ?? zone.getBoundingClientRect();
    const inner = r.width - 2 * TP, cw = inner / Math.max(1, n);
    return clamp01((e.clientX - r.left - TP - cw / 2) / Math.max(1, inner - cw));
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = true; pid = e.pointerId;
    rect = zone.getBoundingClientRect();
    try { zone.setPointerCapture(e.pointerId); } catch {  }
    target = fingerAt(e);
    commit(Math.round(target * (n - 1)), true);
    kick();
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== pid) return;
    target = fingerAt(e);
    commit(Math.round(target * (n - 1)), true);
    kick();
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== pid) return;
    drag = false; pid = -1; rect = null;
    target = pOf(near);
    kick();
  };
  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    let i = -1;
    if (k === 'ArrowRight' || k === 'ArrowUp' || k === 'PageUp') i = Math.min(n - 1, near + 1);
    else if (k === 'ArrowLeft' || k === 'ArrowDown' || k === 'PageDown') i = Math.max(0, near - 1);
    else if (k === 'Home') i = 0;
    else if (k === 'End') i = n - 1;
    if (i < 0) return;
    e.preventDefault();
    if (i === near) return;
    commit(i, false);
    target = pOf(near);
    kick();
  };
  zone.addEventListener('pointerdown', onDown);
  zone.addEventListener('pointermove', onMove);
  zone.addEventListener('pointerup', onUp);
  zone.addEventListener('pointercancel', onUp);
  zone.addEventListener('lostpointercapture', onUp);
  zone.addEventListener('keydown', onKey);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { W = track.clientWidth; kick(); }) : null;
  ro?.observe(track);
  W = track.clientWidth;

  buildLabels(); paintLabels(); paintText(false);
  kick();

  return {
    update(u) {
      const key = () => levels.map((l) => `${l.id}:${l.mult ?? ''}`).join(',') + `|${o.mult?.view ?? ''}`;
      const prevIds = key(), prevVal = levels[near]?.id;
      o = { ...o, ...u };
      levels = o.levels; n = levels.length;
      const ids = key();
      if (ids !== prevIds) buildLabels();
      if (!drag) {
        near = idxOf(o.value);
        target = pOf(near);
        if (ids !== prevIds || prevVal !== o.value) { paintLabels(); paintText(levels[near]?.id !== prevVal); }
        else paintText(false);
      } else if (ids !== prevIds) paintLabels();
      kick();
    },
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      zone.removeEventListener('pointerdown', onDown);
      zone.removeEventListener('pointermove', onMove);
      zone.removeEventListener('pointerup', onUp);
      zone.removeEventListener('pointercancel', onUp);
      zone.removeEventListener('lostpointercapture', onUp);
      zone.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
