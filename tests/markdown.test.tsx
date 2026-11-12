import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Markdown } from '@/components/Markdown';

const html = (t: string) => renderToStaticMarkup(createElement(Markdown, { text: t }));

describe('Markdown', () => {
  it('KaTeX: inline $…$ и \\(…\\)', () => {
    expect(html('где $x^2$ и \\(y_1\\)').match(/class="katex"/g)?.length).toBe(2);
  });
  it('KaTeX: блочные $$…$$ и \\[…\\]', () => {
    expect(html('$$\nE=mc^2\n$$').includes('katex-display')).toBe(true);
    expect(html('вот\n\n\\[a+b\\]\n\nдальше').includes('katex-display')).toBe(true);
  });
  it('денежные доллары не становятся формулой', () => {
    expect(html('цена $5 и $10').includes('katex')).toBe(false);
  });
  it('подсветка кода с языком и кнопкой', () => {
    const h = html('```python\ndef f(x):\n    return x + 1\n```');
    expect(h.includes('hljs-keyword')).toBe(true);
    expect(h.includes('code-head')).toBe(true);
    expect(h.includes('python')).toBe(true);
  });
  it('сырой HTML не исполняется', () => {
    const h = html('<script>alert(1)</script> текст');
    expect(h.includes('<script')).toBe(false);
  });
  it('ссылка на файл модели — карточка «Скачать»', () => {
    const h = html('📎 [top3.csv](/out/9a4bbe9c972517656311b0e854fa1305/top3.csv) (64 B)');
    expect(h.includes('class="dl"')).toBe(true);
    expect(h.includes('Скачать')).toBe(true);
  });
  it('внешняя картинка не грузится', () => {
    expect(html('![x](https://evil.example/p.png)').includes('<img')).toBe(false);
  });

  it('серв кладёт и картинку, и вложение на тот же файл (--ws_image_links) — картинка одна, «Скачать» и размер подписью; другие вложения — как были', () => {
    const t = 'График нарисован.\n\n![y\\_x2.png](/out/99cba566aacc1632a2f153e0c41c1933/y_x2.png)\n\n📎 [y\\_x2.png](/out/99cba566aacc1632a2f153e0c41c1933/y_x2.png) (48 KB)\n\n📎 [итоги.txt](/out/2ad9e03adc03c3a2de237552ca262150/itogi.txt) (51 B)';
    const h = html(t);
    expect(h.match(/data-testid="out-image"/g)).toHaveLength(1);
    expect(h).toContain('data-testid="out-image-dl"');
    expect(h).toContain('y_x2.png · 48 KB');
    expect(h.match(/class="dl"/g)).toHaveLength(1);
    expect(h).toContain('itogi.txt');
    expect(h).not.toContain('kx-dl');
  });
  it('одна и та же картинка или вложение дважды — один раз; картинка без вложения — без подписи, как была', () => {
    const u = '/out/99cba566aacc1632a2f153e0c41c1933/a.png';
    expect(html(`![a](${u})\n\n![a](${u})`).match(/data-testid="out-image"/g)).toHaveLength(1);
    expect(html(`📎 [a.png](${u}) (1 KB)\n\n📎 [a.png](${u}) (1 KB)`).match(/data-testid="out-image"/g)).toHaveLength(1);
    expect(html(`![a](${u})`)).not.toContain('out-image-dl');
  });
});
