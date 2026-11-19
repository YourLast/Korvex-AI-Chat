import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — .mjs без типов
import { buildCss, buildDoc } from '../scripts/gen-theme.mjs';
import { isTheme, pickTheme, schemeOf, THEMES } from '@/lib/theme';

const ROOT = path.join(__dirname, '..');
type Pal = { groups: { name: string; tokens: Record<string, [string, string, string]> }[]; darkScopes: string[]; contrast: [string, string, number][] };
const pal = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/styles/palette.json'), 'utf8')) as Pal;
const tok = (i: 0 | 1) => Object.fromEntries(pal.groups.flatMap((g) => Object.entries(g.tokens).map(([k, v]) => [k, v[i]])));

type RGBA = [number, number, number, number];
function parse(c: string): RGBA {
  const h = c.match(/^#([0-9a-f]{6})$/i);
  if (h) return [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16)).concat(1) as RGBA;
  const m = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([.\d]+))?\s*\)$/);
  if (!m) throw new Error('цвет: ' + c);
  return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
}
const over = (f: RGBA, b: RGBA): RGBA => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat(1) as RGBA;
const lum = (c: RGBA) => { const l = c.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
const ratio = (a: RGBA, b: RGBA) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('палитра', () => {
  it('theme.css и docs/THEME.md собраны из palette.json (node scripts/gen-theme.mjs)', () => {
    const norm = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\n/gm, '').replace(/[ \t]+$/gm, '');
    expect(norm(fs.readFileSync(path.join(ROOT, 'src/styles/theme.css'), 'utf8'))).toBe(norm(buildCss(pal)));
    expect(fs.readFileSync(path.join(ROOT, 'docs/THEME.md'), 'utf8')).toBe(buildDoc(pal));
  });
  it('у каждого токена два значения, светлая — не копия тёмной (кроме знаков проекта и формул)', () => {
    const d = tok(0), l = tok(1);
    for (const k of Object.keys(d)) expect(l[k], k).toBeTruthy();
    const same = Object.keys(d).filter((k) => d[k] === l[k]);
    expect(same.sort()).toEqual(['max-gradient', 'pj-gray']);
  });
  it('светлая выбирается и по устройству, и по выбору человека; тёмная по выбору человека не уступает устройству', () => {
    const css = buildCss(pal);
    expect(css).toContain('@media (prefers-color-scheme: light) {\n  :root:not([data-theme="dark"]) {');
    expect(css).toContain(':root[data-theme="light"] {');
    expect(css.match(/color-scheme: light;/g)).toHaveLength(2);
  });
  for (const [name, i] of [['тёмная', 0], ['светлая', 1]] as const) {
    it(`контраст WCAG AA: ${name}`, () => {
      const t = tok(i);
      const bad: string[] = [];
      for (const [fg, bg, min] of pal.contrast) {
        const b = over(parse(t[bg]), parse(t.bg));
        const r = ratio(over(parse(t[fg]), b), b);
        if (r < min) bad.push(`${fg} на ${bg}: ${r.toFixed(2)} < ${min}`);
      }
      expect(bad).toEqual([]);
    });
  }
});

describe('выбор темы', () => {
  it('человек -> cookie -> как на устройстве', () => {
    expect(THEMES).toEqual(['system', 'light', 'dark']);
    expect(pickTheme({})).toBe('system');
    expect(pickTheme({ cookie: 'light' })).toBe('light');
    expect(pickTheme({ user: '', cookie: 'dark' })).toBe('dark');
    expect(pickTheme({ user: 'system', cookie: 'dark' })).toBe('system');
    expect(pickTheme({ user: 'light', cookie: 'dark' })).toBe('light');
    expect(pickTheme({ user: 'weird', cookie: 'nope' })).toBe('system');
    expect(isTheme('dark')).toBe(true); expect(isTheme('auto')).toBe(false);
  });
  it('схема для статус-бара и манифеста: выбор, иначе подсказка устройства, иначе тёмная', () => {
    expect(schemeOf('light', 'dark')).toBe('light');
    expect(schemeOf('dark', 'light')).toBe('dark');
    expect(schemeOf('system', 'light')).toBe('light');
    expect(schemeOf('system', null)).toBe('dark');
  });
});

describe('стили без сырых цветов', () => {
  const FIXED = /^(\.xl|\.fv-p|\.fv-hl|\.iv(?!-thumb)\b|\.iv-(?!thumb)|\.ia\b|\.ia-|\.blv|\.sl|\.k-btn\.pj-danger)/;
  const SKIP = new Set(['theme.css', 'live-view.css']);
  it('цвет в CSS — только токен (var), rgba(var(--ink), …), затемнение с множителем темы или color-mix от токенов', () => {
    const dir = path.join(ROOT, 'src/styles');
    const bad: string[] = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.css') && !SKIP.has(x))) {
      const s = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of s.matchAll(/\{([^{}]*)\}/g)) {
        const sel = s.slice(0, m.index).split(/[{};]/).pop()!.trim();
        if (FIXED.test(sel)) continue;
        for (const d of m[1].split(';')) {
          if (/mask/.test(d)) continue;
          const raw = (d.match(/#[0-9a-f]{3,8}\b|rgba?\((?!var\()[^)]*\)/gi) ?? []).filter((c) => !/^rgba\(0, 0, 0, calc\(/.test(c));
          if (raw.length) bad.push(`${f}: ${sel.slice(0, 50)} { ${d.trim().slice(0, 90)} }`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
  it('нативные поля не прибиты к тёмной схеме', () => {
    const dir = path.join(ROOT, 'src/styles');
    const hits = fs.readdirSync(dir).filter((x) => x.endsWith('.css') && !SKIP.has(x)).filter((f) => /color-scheme:\s*dark/.test(fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')));
    expect(hits).toEqual([]);
  });
});
