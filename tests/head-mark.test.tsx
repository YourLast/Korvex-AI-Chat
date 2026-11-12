// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { HeadMark } from '@/components/HeadMark';
import { HM, checkD, errorD, hmAdvance, hmDue, hmProps, hmStart, morphD, morphPair, poseDrawD, type HmProps, type HmState } from '@/lib/headMark';
import { align, parsePath, resample, signedArea, type Pt } from '@/lib/morph';
import { MARK_SMALL } from '@/lib/thinkMark';
import { tickerReset, tickerState } from '@/lib/ticker';

const LIVE: HmProps = { live: true, end: null };
const DONE: HmProps = { live: false, end: 'check' };

describe('автомат знака (чистый)', () => {
  it('думает → ход кончился → in (рисуется 380 мс) → hold (ровно 3,0 с) → out (620 мс) → rest', () => {
    let s = hmStart(LIVE, 0);
    expect(s.phase).toBe('think');
    s = hmProps(s, LIVE, DONE, 1000);
    expect(s).toEqual({ phase: 'in', pose: 'check', at: 1000 });
    expect(hmAdvance(s, 1000 + HM.DRAW - 1).phase).toBe('in');
    s = hmAdvance(s, 1000 + HM.DRAW);
    expect(s).toEqual({ phase: 'hold', pose: 'check', at: 1380 });
    expect(hmDue(s)).toBe(1380 + 3000);
    expect(hmAdvance(s, 1380 + 2999).phase).toBe('hold');
    s = hmAdvance(s, 1380 + 3000);
    expect(s.phase).toBe('out');
    expect(hmAdvance(s, 4380 + HM.BACK - 1).phase).toBe('out');
    expect(hmAdvance(s, 4380 + HM.BACK)).toEqual({ phase: 'rest', pose: null, at: 4380 + HM.BACK });
    expect(HM.HOLD).toBe(3000);
    expect(HM.DRAW).toBeGreaterThanOrEqual(300); expect(HM.DRAW).toBeLessThanOrEqual(400);
    expect(HM.BACK).toBeGreaterThanOrEqual(500); expect(HM.BACK).toBeLessThanOrEqual(700);
  });
  it('большой скачок времени (вкладка была скрыта) проходит все фазы разом', () => {
    const s = hmProps(hmStart(LIVE, 0), LIVE, DONE, 0);
    expect(hmAdvance(s, 60_000).phase).toBe('rest');
  });
  it('новый ход, пока видна поза (in / hold / out), — snap 220 мс и сразу думает; в покое — сразу думает', () => {
    for (const at of [100, 1000, 3500]) {
      let s = hmAdvance(hmProps(hmStart(LIVE, 0), LIVE, DONE, 0), at);
      expect(['in', 'hold', 'out']).toContain(s.phase);
      s = hmProps(s, DONE, LIVE, at);
      expect(s.phase).toBe('snap');
      expect(hmAdvance(s, at + HM.SNAP).phase).toBe('think');
    }
    const rest = hmStart(DONE, 0);
    expect(rest.phase).toBe('rest');
    expect(hmProps(rest, DONE, LIVE, 5).phase).toBe('think');
  });
  it('ошибка пришла после галочки — поза меняется (in заново); та же поза повторно — не перезапускается; ход без позы — искра затихает', () => {
    let s: HmState = hmAdvance(hmProps(hmStart(LIVE, 0), LIVE, DONE, 0), 1000);
    expect(s.phase).toBe('hold');
    s = hmProps(s, DONE, { live: false, end: 'error' }, 1200);
    expect(s).toEqual({ phase: 'in', pose: 'error', at: 1200 });
    expect(hmProps(s, { live: false, end: 'error' }, { live: false, end: 'error' }, 1300)).toBe(s);
    expect(hmProps(hmStart(LIVE, 0), LIVE, { live: false, end: null }, 10).phase).toBe('rest');
    expect(hmProps(hmStart(DONE, 0), DONE, { live: false, end: 'error' }, 10).phase).toBe('in');
  });
  it('prefers-reduced-motion: поза сразу (без in), через 3,0 с — сразу искра (без out), новый ход — сразу думает', () => {
    let s = hmProps(hmStart(LIVE, 0, false, true), LIVE, DONE, 1000, true);
    expect(s).toEqual({ phase: 'hold', pose: 'check', at: 1000 });
    expect(hmAdvance(s, 3999, true).phase).toBe('hold');
    expect(hmAdvance(s, 4000, true).phase).toBe('rest');
    s = hmProps(s, DONE, LIVE, 1500, true);
    expect(s.phase).toBe('think');
    expect(hmStart(DONE, 0, true, true).phase).toBe('hold');
  });
});

describe('формы и перетекание', () => {
  const pts = (d: string) => parsePath(d).flatMap((x) => x.pts);
  it('галочка прорисовывается от нуля до целой: путь растёт, на 1 — целая; луч ошибки так же; без NaN', () => {
    expect(checkD(0)).toBe('');
    const sizes = [0.1, 0.4, 0.7, 1].map((k) => { const p = pts(checkD(k)); return Math.max(...p.map((q) => q[0])) - Math.min(...p.map((q) => q[0])); });
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
    expect(checkD(1)).toBe(checkD(0.9999));
    for (let k = 0; k <= 1; k += 0.05) { expect(checkD(k)).not.toMatch(/NaN|Infinity/); expect(errorD(k)).not.toMatch(/NaN|Infinity/); }
    expect(poseDrawD('error', 1).dot).toBeGreaterThan(40);
    expect(poseDrawD('error', 0.3).dot).toBe(0);
  });
  it('пары «поза → искра»: одинаковое число точек (120), одно направление обхода, кончики идут в кончики лучей; концы перетекания — поза и малый знак', () => {
    const dense = parsePath(MARK_SMALL, 48)[0].pts;
    const onGlint = (q: Pt) => { let m = Infinity; for (let i = 0; i < dense.length; i++) { const a = dense[i], b = dense[(i + 1) % dense.length]; const dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); m = Math.min(m, Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1])); } return m; };
    const tips: Pt[] = [[708.9, 502.9], [704.3, 148.2], [292.0, 511.9], [333.1, 864.9]];
    for (const p of ['check', 'error', 'stop'] as const) {
      const [a, b] = morphPair(p);
      expect(a).toHaveLength(120); expect(b).toHaveLength(120);
      expect(Math.sign(signedArea(a))).toBe(Math.sign(signedArea(b)));
      for (const q of b) expect(onGlint(q)).toBeLessThan(0.5);
      for (const tip of tips) expect(Math.min(...b.map((q) => Math.hypot(q[0] - tip[0], q[1] - tip[1])))).toBeLessThan(1);
      const start = pts(morphD(p, 0)), end = pts(morphD(p, 1));
      expect(start).toHaveLength(120); expect(end).toHaveLength(120);
      start.forEach((q, i) => { expect(Math.hypot(q[0] - a[i][0], q[1] - a[i][1])).toBeLessThan(0.2); });
      end.forEach((q, i) => { expect(Math.hypot(q[0] - b[i][0], q[1] - b[i][1])).toBeLessThan(0.2); });
      for (let k = 0; k <= 1; k += 0.1) expect(morphD(p, k)).not.toMatch(/NaN|Infinity/);
    }
    const [a, b] = morphPair('check');
    const iLong = a.findIndex((q) => Math.hypot(q[0] - 738, q[1] - 330) < 3), iShort = a.findIndex((q) => Math.hypot(q[0] - 322, q[1] - 522) < 3);
    expect(Math.hypot(b[iLong][0] - 704.3, b[iLong][1] - 148.2)).toBeLessThan(1);
    expect(Math.hypot(b[iShort][0] - 292.0, b[iShort][1] - 511.9)).toBeLessThan(1);
  });
  it('align: тот же контур со сдвинутым началом и обратным обходом находит исходное соответствие', () => {
    const ring: Pt[] = Array.from({ length: 40 }, (_, i) => [Math.cos((i / 40) * 2 * Math.PI) * (1 + 0.3 * Math.cos((3 * i / 40) * 2 * Math.PI)), Math.sin((i / 40) * 2 * Math.PI)]);
    const moved = [...ring.slice(13), ...ring.slice(0, 13)].reverse();
    const back = align(ring, moved);
    back.forEach((q, i) => { expect(q[0]).toBeCloseTo(ring[i][0], 9); expect(q[1]).toBeCloseTo(ring[i][1], 9); });
    expect(() => align(ring, ring.slice(1))).toThrow();
    expect(resample(ring, 64)).toHaveLength(64);
  });
});

describe('HeadMark на таймерах', () => {
  beforeEach(() => {
    tickerReset();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); tickerReset(); });
  const mount = (p: { live: boolean; end?: 'check' | 'error' | 'stop' | null; play?: boolean }) => {
    const r = render(createElement(HeadMark, p));
    const svg = r.container.querySelector('svg')!;
    return { ...r, svg, g: svg.querySelector('.hm-g')!, pose: svg.querySelector('.hm-p')!, dot: svg.querySelector('.hm-d')! };
  };

  it('думает → галочка рисуется (~0,38 с) → держится 3,0 с → перетекает в искру (~0,62 с); в паузе кадров нет', () => {
    const m = mount({ live: true });
    vi.advanceTimersByTime(500);
    expect(m.svg.dataset.phase).toBe('think');
    m.rerender(createElement(HeadMark, { live: false, end: 'check' }));
    expect(m.svg.dataset.phase).toBe('in');
    expect(m.svg.dataset.pose).toBe('check');
    vi.advanceTimersByTime(200);
    const partial = m.pose.getAttribute('d')!;
    expect(partial.length).toBeGreaterThan(20);
    vi.advanceTimersByTime(200);
    expect(m.svg.dataset.phase).toBe('hold');
    expect(m.pose.getAttribute('d')).toBe(checkD(1));
    expect(m.g.getAttribute('opacity')).toBe('0');
    expect(tickerState().active).toBe(0);
    vi.advanceTimersByTime(2950);
    expect(m.svg.dataset.phase).toBe('hold');
    vi.advanceTimersByTime(60);
    expect(m.svg.dataset.phase).toBe('out');
    expect(m.svg.dataset.pose).toBeUndefined();
    vi.advanceTimersByTime(300);
    expect(m.pose.getAttribute('d')).not.toBe(checkD(1));
    vi.advanceTimersByTime(400);
    expect(m.svg.dataset.phase).toBe('rest');
    expect(m.g.getAttribute('d')).toBe(MARK_SMALL);
    expect(m.g.hasAttribute('opacity')).toBe(false);
    expect(m.pose.hasAttribute('d')).toBe(false);
    expect(tickerState().active).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('новый ход во время паузы — сразу к живой искре (snap 0,22 с), галочка не дожидается трёх секунд', () => {
    const m = mount({ live: true });
    m.rerender(createElement(HeadMark, { live: false, end: 'check' }));
    vi.advanceTimersByTime(1500);
    expect(m.svg.dataset.phase).toBe('hold');
    m.rerender(createElement(HeadMark, { live: true, end: null }));
    expect(m.svg.dataset.phase).toBe('snap');
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
    vi.advanceTimersByTime(240);
    expect(m.svg.dataset.phase).toBe('think');
    expect(m.pose.hasAttribute('d')).toBe(false);
    const a = m.g.getAttribute('d'); vi.advanceTimersByTime(100);
    expect(m.g.getAttribute('d')).not.toBe(a);
  });
  it('ошибка — «!» (луч и точка), стоп — квадрат; потом обратно в искру', () => {
    for (const end of ['error', 'stop'] as const) {
      const m = mount({ live: true });
      m.rerender(createElement(HeadMark, { live: false, end }));
      expect(m.svg.dataset.pose).toBe(end);
      vi.advanceTimersByTime(400);
      expect(m.svg.dataset.phase).toBe('hold');
      if (end === 'error') expect(m.dot.getAttribute('d')).toMatch(/^M/); else expect(m.dot.hasAttribute('d')).toBe(false);
      vi.advanceTimersByTime(3000 + 700);
      expect(m.svg.dataset.phase).toBe('rest');
      expect(m.g.getAttribute('d')).toBe(MARK_SMALL);
      m.unmount();
    }
  });
  it('старый ход (без live при появлении) — просто искра, без галочки; бар «Готово» (play) — галочка сразу', () => {
    const old = mount({ live: false, end: 'check' });
    expect(old.svg.dataset.phase).toBe('rest');
    expect(old.pose.hasAttribute('d')).toBe(false);
    expect(tickerState().active).toBe(0);
    old.unmount();
    const bar = mount({ live: false, end: 'check', play: true });
    expect(bar.svg.dataset.phase).toBe('in');
    vi.advanceTimersByTime(400);
    expect(bar.pose.getAttribute('d')).toBe(checkD(1));
  });
  it('unmount во время паузы и во время рисования — ни таймеров, ни кадров', () => {
    const a = mount({ live: true });
    a.rerender(createElement(HeadMark, { live: false, end: 'check' }));
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(1);
    a.unmount();
    expect(vi.getTimerCount()).toBe(0);
    const b = mount({ live: true });
    b.rerender(createElement(HeadMark, { live: false, end: 'check' }));
    vi.advanceTimersByTime(100);
    b.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(tickerState()).toEqual({ active: 0, raf: false });
  });
  it('prefers-reduced-motion: петли нет (ни одного кадра), галочка — сразу, через 3,0 с — сразу искра', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: /reduce/.test(q), media: q }));
    const m = mount({ live: true });
    expect(tickerState().active).toBe(0);
    expect(m.g.getAttribute('d')).toBe(MARK_SMALL);
    m.rerender(createElement(HeadMark, { live: false, end: 'check' }));
    expect(m.svg.dataset.phase).toBe('hold');
    expect(m.pose.getAttribute('d')).toBe(checkD(1));
    expect(tickerState().active).toBe(0);
    vi.advanceTimersByTime(2999);
    expect(m.svg.dataset.phase).toBe('hold');
    vi.advanceTimersByTime(1);
    expect(m.svg.dataset.phase).toBe('rest');
    expect(m.g.getAttribute('d')).toBe(MARK_SMALL);
    expect(m.pose.hasAttribute('d')).toBe(false);
    expect(tickerState().active).toBe(0);
  });
});
