// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GLINT_VIEWBOX, MARK, PRESETS, SHAPE_FULL, SHAPE_SMALL, glintPath, mountGlint, type GlintOptions } from '@/lib/glint';
import { MARK_FULL, MARK_SMALL, MARK_VIEWBOX } from '@/lib/thinkMark';

const ROW: GlintOptions = { live: false, preset: 'vivid', viewBox: MARK_VIEWBOX, base: 0.95, bodyBase: 1.35, openInner: true };
const ROW_P = { ...PRESETS.vivid, base: 0.95 };
const contours = (d: string) => d.match(/Z/g)?.length ?? 0;
const innerReach = (d: string) => {
  const inner = d.split('Z')[1] ?? '';
  const n = (inner.match(/-?\d+\.?\d*/g) ?? []).map(Number);
  let m = 0; for (let i = 0; i + 1 < n.length; i += 2) m = Math.max(m, Math.hypot(n[i] - MARK.C[0], n[i + 1] - MARK.C[1]));
  return m;
};

describe('glintPath: математика кадра', () => {
  it('glintPath(0, 0) — неподвижный полный знак, ровно путь public/korvex-mark.svg; без движения от времени не зависит', () => {
    expect(glintPath(0, 0).d).toBe(MARK_FULL);
    for (const P of [PRESETS.calm, PRESETS.vivid]) {
      expect(glintPath(0, 0, P).d).toBe(MARK_FULL);
      expect(glintPath(7.31, 0, P).d).toBe(MARK_FULL);
      expect(glintPath(7.31, 0, P).scale).toBe(1);
      expect(glintPath(7.31, 0, P).glow).toBe(0);
    }
  });
  it('живые кадры отличаются: от неподвижного, друг от друга и между пресетами; vivid движется заметнее и чуть уменьшает знак', () => {
    const still = glintPath(0, 0).d;
    const ts = [0.4, 1.3, 2.6, 3.9, 5.2];
    const frames = ts.map((t) => glintPath(t, 1, PRESETS.vivid).d);
    for (const d of frames) expect(d).not.toBe(still);
    expect(new Set(frames).size).toBe(frames.length);
    expect(glintPath(2.6, 1, PRESETS.calm).d).not.toBe(glintPath(2.6, 1, PRESETS.vivid).d);
    expect(glintPath(2.6, 1, PRESETS.vivid).scale).toBeLessThan(1);
    expect(glintPath(2.6, 1, PRESETS.calm).scale).toBe(1);
  });
  it('амплитуда плавная: на полпути кадр между неподвижным и полным; путь каждый раз — два замкнутых контура (внешний и внутренний)', () => {
    const half = glintPath(2.6, 0.5, PRESETS.vivid), full = glintPath(2.6, 1, PRESETS.vivid);
    expect(half.d).not.toBe(full.d);
    expect(Math.abs(half.scale - 1)).toBeLessThan(Math.abs(full.scale - 1));
    for (const t of [0, 0.7, 2.2, 9.9]) expect(glintPath(t, 1, PRESETS.vivid).d.match(/Z/g)?.length).toBe(2);
    expect(MARK.outer).toHaveLength(4); expect(MARK.inner).toHaveLength(4);
  });
  it('без NaN в кадре на любом времени и амплитуде, в обеих формах', () => {
    for (let t = 0; t < 60; t += 0.37) for (const amt of [0, 0.001, 0.3, 1]) for (const S of [SHAPE_FULL, SHAPE_SMALL]) expect(glintPath(t, amt, PRESETS.vivid, S).d).not.toMatch(/NaN|Infinity/);
  });
});

describe('glintPath: малый знак (строка «думает»)', () => {
  it('покой — ровно малый знак (public/korvex-mark-small.svg): один контур, без внутренней искры, от времени не зависит', () => {
    expect(glintPath(0, 0, ROW_P, SHAPE_SMALL).d).toBe(MARK_SMALL);
    for (const t of [0, 1.7, 7.31, 55]) expect(glintPath(t, 0, ROW_P, SHAPE_SMALL).d).toBe(MARK_SMALL);
    expect(contours(MARK_SMALL)).toBe(1);
    expect(glintPath(0, 0, ROW_P, SHAPE_SMALL).scale).toBe(1);
  });
  it('форма по умолчанию не изменилась: bodyBase 1, внутренняя искра всегда (полный знак в покое, два контура даже при amt = 0)', () => {
    expect(SHAPE_FULL).toEqual({ bodyBase: 1, openInner: false });
    expect(glintPath(0, 0).d).toBe(MARK_FULL);
    expect(contours(glintPath(0, 0).d)).toBe(2);
    expect(glintPath(2.6, 1, PRESETS.vivid).d).toBe(glintPath(2.6, 1, PRESETS.vivid, SHAPE_FULL).d);
  });
  it('внутренняя искра раскрывается с амплитудой (smoothstep): нет при 0, растёт при 0.05 → 0.3 → 0.6 → 1; контуров два, как только amt > 0', () => {
    expect(contours(glintPath(2.6, 0, ROW_P, SHAPE_SMALL).d)).toBe(1);
    const reach = [0.05, 0.3, 0.6, 1].map((amt) => innerReach(glintPath(2.6, amt, ROW_P, SHAPE_SMALL).d));
    for (let i = 1; i < reach.length; i++) expect(reach[i]).toBeGreaterThan(reach[i - 1]);
    expect(reach[0]).toBeLessThan(0.1 * reach[3]);
    for (const amt of [0.001, 0.05, 0.5, 1]) expect(contours(glintPath(2.6, amt, ROW_P, SHAPE_SMALL).d)).toBe(2);
    expect(glintPath(2.6, 1, ROW_P, SHAPE_SMALL).d.split('Z')[1]).toBe(glintPath(2.6, 1, ROW_P, SHAPE_FULL).d.split('Z')[1]);
  });
  it('тело при движении полнее (bodyBase 1,35) и всё равно живое: кадры отличаются друг от друга и от покоя', () => {
    const still = MARK_SMALL, fr = [0.4, 1.3, 2.6, 3.9].map((t) => glintPath(t, 1, ROW_P, SHAPE_SMALL).d);
    expect(new Set(fr).size).toBe(fr.length);
    for (const d of fr) expect(d).not.toBe(still);
    expect(fr[0].split('Z')[0]).not.toBe(glintPath(0.4, 1, ROW_P, SHAPE_FULL).d.split('Z')[0]);
  });
  it('base 0,95: живой масштаб не уходит под ~0,86 (у vivid по умолчанию — до ~0,78); на старте близко к 1', () => {
    let lo = 9; for (let t = 0; t < 40; t += 0.05) lo = Math.min(lo, glintPath(t, 1, ROW_P, SHAPE_SMALL).scale);
    let lo84 = 9; for (let t = 0; t < 40; t += 0.05) lo84 = Math.min(lo84, glintPath(t, 1, PRESETS.vivid, SHAPE_SMALL).scale);
    expect(lo).toBeGreaterThan(0.86); expect(lo84).toBeLessThan(0.82);
    expect(glintPath(1, 0.06, ROW_P, SHAPE_SMALL).scale).toBeGreaterThan(0.99);
  });
});

describe('mountGlint: жизненный цикл', () => {
  let clock = 0, q: Map<number, FrameRequestCallback>, nextId = 1;
  const flush = (ms: number) => { clock += ms; const run = [...q.values()]; q.clear(); run.forEach((cb) => cb(clock)); };
  const hide = (v: boolean) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); };
  const svgEl = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.innerHTML = `<path d="${MARK_SMALL}"/>`; document.body.appendChild(svg);
    return svg as SVGSVGElement;
  };
  beforeEach(() => {
    clock = 1000; q = new Map(); nextId = 1;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = nextId++; q.set(id, cb); return id; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { q.delete(id); });
    hide(false);
  });
  afterEach(() => { hide(false); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('не live: ни одного rAF, путь — rest (статичный малый знак), viewBox — наш плотный', () => {
    const svg = svgEl(), g = mountGlint(svg, ROW);
    expect(q.size).toBe(0);
    expect(svg.getAttribute('viewBox')).toBe(MARK_VIEWBOX);
    expect(svg.querySelector('path')!.getAttribute('d')).toBe(MARK_SMALL);
    g.destroy();
    expect(GLINT_VIEWBOX).not.toBe(MARK_VIEWBOX);
    const svg2 = svgEl(); mountGlint(svg2, { live: false }); expect(svg2.getAttribute('viewBox')).toBe(GLINT_VIEWBOX);
    expect(svg2.querySelector('path')!.getAttribute('d')).toBe(MARK_FULL);
  });
  it('в строке: на старте внутренняя искра раскрывается (один контур → два), при остановке закрывается и знак замирает ровно на малом знаке без скачка', () => {
    const svg = svgEl(), path = svg.querySelector('path')!, g = mountGlint(svg, ROW);
    expect(contours(path.getAttribute('d')!)).toBe(1);
    g.setLive(true);
    flush(16); const d1 = path.getAttribute('d')!;
    expect(contours(d1)).toBe(2); const r1 = innerReach(d1);
    for (let i = 0; i < 40; i++) flush(16);
    expect(innerReach(path.getAttribute('d')!)).toBeGreaterThan(3 * r1);
    g.setLive(false);
    let prev = innerReach(path.getAttribute('d')!), shrinking = 0;
    for (let i = 0; i < 120 && q.size; i++) { flush(16); const r = innerReach(path.getAttribute('d')!); if (r < prev) shrinking++; prev = r; }
    expect(shrinking).toBeGreaterThan(10);
    expect(q.size).toBe(0); expect(path.getAttribute('d')).toBe(MARK_SMALL);
    g.destroy();
  });
  it('live: кадр на каждый rAF (один path d), знак движется; setLive(false) — доезжает до rest за ~1 с и кадры прекращаются', () => {
    const svg = svgEl(), path = svg.querySelector('path')!;
    const g = mountGlint(svg, ROW);
    g.setLive(true);
    expect(q.size).toBe(1);
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) { flush(16); seen.add(path.getAttribute('d')!); expect(q.size).toBe(1); }
    expect(seen.size).toBeGreaterThan(20);
    expect(svg.style.transform).toMatch(/^scale\(/);
    g.setLive(false);
    for (let i = 0; i < 100 && q.size; i++) flush(16);
    expect(q.size).toBe(0);
    expect(path.getAttribute('d')).toBe(MARK_SMALL);
    expect(svg.style.transform).toBe(''); expect(svg.style.filter).toBe('');
    g.setLive(true); expect(q.size).toBe(1);
    g.destroy(); expect(q.size).toBe(0); expect(path.getAttribute('d')).toBe(MARK_SMALL);
  });
  it('вкладка скрыта — пауза (rAF отменён, новых нет); видна — продолжает', () => {
    const svg = svgEl(), g = mountGlint(svg, ROW);
    g.setLive(true); flush(16); expect(q.size).toBe(1);
    hide(true); expect(q.size).toBe(0);
    flush(500); expect(q.size).toBe(0);
    g.setLive(true); expect(q.size).toBe(0);
    hide(false); expect(q.size).toBe(1); flush(16); expect(q.size).toBe(1);
    g.destroy(); expect(q.size).toBe(0);
    hide(true); hide(false); expect(q.size).toBe(0);
  });
  it('destroy на ходу: кадров нет, знак в покое', () => {
    const svg = svgEl(), g = mountGlint(svg, ROW);
    g.setLive(true); for (let i = 0; i < 10; i++) flush(16);
    g.destroy(); expect(q.size).toBe(0);
    expect(svg.querySelector('path')!.getAttribute('d')).toBe(MARK_SMALL); expect(svg.style.transform).toBe('');
  });
  it('prefers-reduced-motion: кадров нет совсем, знак неподвижен', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: /reduce/.test(q), media: q }));
    const svg = svgEl(), g = mountGlint(svg, { live: true, preset: 'vivid', viewBox: MARK_VIEWBOX, rest: MARK_SMALL });
    g.setLive(true);
    expect(q.size).toBe(0);
    expect(svg.querySelector('path')!.getAttribute('d')).toBe(MARK_SMALL);
    g.destroy();
  });
});
