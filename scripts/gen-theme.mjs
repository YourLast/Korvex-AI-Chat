#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PALETTE = path.join(ROOT, 'src/styles/palette.json');
export const CSS_OUT = path.join(ROOT, 'src/styles/theme.css');
export const DOC_OUT = path.join(ROOT, 'docs/THEME.md');

const decl = (p, i, pad = '  ') => p.groups.flatMap((g) => [`${pad}/* ${g.name} */`, ...Object.entries(g.tokens).map(([k, v]) => `${pad}--${k}: ${v[i]};`)]).join('\n');

export function buildCss(p) {
  const L = decl(p, 1, '    ');
  return `/* Создано scripts/gen-theme.mjs из src/styles/palette.json — не править руками (node scripts/gen-theme.mjs). */

/* Тёмная (OLED) — по умолчанию и при data-theme="dark" */
:root {
  color-scheme: dark;
${decl(p, 0)}
}

/* Светлая — как на устройстве (смена на лету) */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    color-scheme: light;
${L}
  }
}

/* Светлая — выбрана человеком */
:root[data-theme="light"] {
    color-scheme: light;
${L}
}

/* Всегда тёмные области (как видеоплеер): живой показ браузера, просмотр картинок, рисунок установки */
${p.darkScopes.join(', ')} {
  color-scheme: dark;
${decl(p, 0)}
}
`;
}

export function buildDoc(p) {
  const rows = p.groups.flatMap((g) => [`| **${g.name}** | | | |`, ...Object.entries(g.tokens).map(([k, v]) => `| \`--${k}\` | \`${v[0]}\` | \`${v[1]}\` | ${v[2] || ''} |`)]);
  return `# Палитра Korvex: тёмная и светлая

Создано \`scripts/gen-theme.mjs\` из \`src/styles/palette.json\` (единственный источник; CSS — \`src/styles/theme.css\`).
По умолчанию тема как на устройстве (\`prefers-color-scheme\`, переключается на лету); в Настройках — «Как на устройстве / Светлая / Тёмная», выбор хранится у человека
(и в cookie \`kx-theme\` для страниц до входа). Контраст по WCAG AA проверяет \`tests/theme.test.ts\`: текст 4,5:1, элементы управления и знаки 3:1.
Живой показ браузера, просмотр картинок и рисунок установки всегда тёмные.

| Токен | Тёмная | Светлая | Где |
|---|---|---|---|
${rows.join('\n')}
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const p = JSON.parse(fs.readFileSync(PALETTE, 'utf8'));
  const want = [[CSS_OUT, buildCss(p)], [DOC_OUT, buildDoc(p)]];
  if (process.argv.includes('--check')) {
    const stale = want.filter(([f, s]) => !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== s);
    for (const [f] of stale) console.error('отстал от палитры:', path.relative(ROOT, f));
    process.exit(stale.length ? 1 : 0);
  }
  for (const [f, s] of want) fs.writeFileSync(f, s);
  console.log('theme.css и docs/THEME.md записаны');
}
