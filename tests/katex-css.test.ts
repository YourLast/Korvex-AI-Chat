import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.join(__dirname, '..');
describe('KaTeX: CSS и рендер одной версии', () => {
  it('layout.tsx подключает katex.min.css из того katex, который берёт rehype-katex', () => {
    const layout = fs.readFileSync(path.join(ROOT, 'src/app/layout.tsx'), 'utf8');
    const imp = /import '([^']*katex[^']*\.css)'/.exec(layout)?.[1];
    expect(imp).toBeTruthy();
    const cssPkg = path.join(path.resolve(ROOT, 'src/app', imp!).replace(/\/dist\/katex\.min\.css$/, ''), 'package.json');
    const used = createRequire(path.join(ROOT, 'node_modules/rehype-katex/index.js')).resolve('katex/package.json');
    const v = (p: string) => (JSON.parse(fs.readFileSync(p, 'utf8')) as { version: string }).version;
    expect(v(cssPkg)).toBe(v(used));
  });
});
