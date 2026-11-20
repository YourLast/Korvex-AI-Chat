import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { prepMath } from '@/lib/mathprep';
import { Markdown } from '@/components/Markdown';

const html = (t: string) => renderToStaticMarkup(createElement(Markdown, { text: t }));
const plain = (h: string) => h.replace(/<span class="katex[\s\S]*?<\/span><\/span><\/span>/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const BROKEN_FRAC = '$\\frac{1}{2;\\ \\frac{1}{4};\\ \\frac{1}{6};\\ \\frac{1}{8};\\ \\frac{1}{10}$';
const GARBAGE = '1; $\\dfrac{1}{8}$; $\\dfrac{1}{27}$; $\\dfrac{1}{64}$; $\\dollar}';

describe('prepMath', () => {
  it('переводит \\( \\) и \\[ \\] в доллары', () => {
    expect(prepMath('это \\(x^2\\) и всё')).toBe('это $x^2$ и всё');
    expect(prepMath('вот \\[a+b\\] дальше')).toBe('вот \n\n$$\na+b\n$$\n\n дальше');
  });
  it('не трогает код', () => {
    const s = 'код `\\(x\\)` и\n```\n\\[y\\] $5 и $6\n```';
    expect(prepMath(s)).toBe(s);
  });
  it('экранирует денежные доллары', () => {
    expect(prepMath('цена $5 и $10 за штуку')).toBe('цена \\$5 и \\$10 за штуку');
    expect(prepMath('вышло $ 5')).toBe('вышло \\$ 5');
  });
  it('оставляет настоящие формулы', () => {
    expect(prepMath('где $x = 5$ и $y$.')).toBe('где $x = 5$ и $y$.');
    expect(prepMath('итог $$17 \\times 23 = 391$$ в строке')).toBe('итог $$17 \\times 23 = 391$$ в строке');
    expect(prepMath('Итого:\n\n$$17 \\times 23 = 391$$\n\nдальше')).toBe('Итого:\n\n\n$$\n17 \\times 23 = 391\n$$\n\n\nдальше');
    expect(prepMath('$$\nE = mc^2\n$$')).toBe('$$\nE = mc^2\n$$');
  });
  it('закрывающий $ перед цифрой — не формула', () => {
    expect(prepMath('$a$1')).toBe('\\$a\\$1');
  });
  it('незакрытый $$ при стриме не падает', () => {
    expect(prepMath('начало $$x + ')).toBe('начало $$x + ');
  });
  it('текст без формул возвращается как есть', () => {
    expect(prepMath('просто текст ₽')).toBe('просто текст ₽');
  });

  it('верные формулы не меняются ни на байт (в том числе блоки, \\left…\\right, окружения)', () => {
    for (const f of [
      'где $x = 5$ и $y$.', 'итог $$17 \\times 23 = 391$$ в строке', '$$\nE = mc^2\n$$', 'дробь $\\frac{a^2+b^2}{c}$ и $\\dfrac{1}{8}$',
      '$$\n\\begin{align} a &= b \\\\ c &= d \\end{align}\n$$', '$\\left( \\frac{1}{2} \\right)$', 'скобки $\\{a, b\\}$ и $\\sum_{i=1}^{n} x_i$',
    ]) expect(prepMath(f), f).toBe(f);
  });
});

describe('prepMath: сломанные формулы', () => {
  it('не хватает закрывающей скобки — она добавляется перед закрывающим $', () => {
    expect(prepMath(BROKEN_FRAC)).toBe('$\\frac{1}{2;\\ \\frac{1}{4};\\ \\frac{1}{6};\\ \\frac{1}{8};\\ \\frac{1}{10}}$');
    expect(prepMath('вот $a_{1$ тут')).toBe('вот $a_{1}$ тут');
    expect(prepMath('$\\sqrt{\\frac{1}{2}$')).toBe('$\\sqrt{\\frac{1}{2}}$');
    expect(prepMath('$x^{y^{2$')).toBe('$x^{y^{2}}$');
  });
  it('исправленная формула рисуется формулой, красной ошибки нет', () => {
    const h = html(BROKEN_FRAC);
    expect(h.includes('katex-error')).toBe(false);
    expect(h.match(/class="katex"/g)?.length).toBe(1);
  });
  it('блок $$…$$ без скобки: скобка — до перевода строки перед закрывающим $$, блок остаётся блоком', () => {
    expect(prepMath('$$\n\\frac{1}{2\n$$')).toBe('$$\n\\frac{1}{2}\n$$');
    const h = html('текст\n\n$$\n\\frac{a}{b\n$$\n\nдальше');
    expect(h.includes('katex-error')).toBe(false);
    expect(h.includes('katex-display')).toBe(true);
  });
  it('мусор вместо формулы — обычным текстом, доллары на месте, красного нет; верные формулы рядом остаются формулами', () => {
    const h = html(GARBAGE);
    expect(h.includes('katex-error')).toBe(false);
    expect(h.includes('#ee7d73')).toBe(false);
    expect(h.match(/class="katex"/g)?.length).toBe(3);
    expect(plain(h)).toContain('$\\dollar}');
    expect(prepMath(GARBAGE)).toBe('1; $\\dfrac{1}{8}$; $\\dfrac{1}{27}$; $\\dfrac{1}{64}$; \\$\\dollar}');
  });
  it('закрытая мусорная формула: целиком обычным текстом вместе с $, Markdown её не ест', () => {
    const t = '$\\dollar}$';
    expect(prepMath(t)).toBe('\\$\\\\dollar}\\$');
    const h = html('до ' + t + ' после');
    expect(h.includes('katex')).toBe(false);
    expect(plain(h)).toContain('до $\\dollar}$ после');
    const m = html('$a_1 * b_2 \\unknown [x](y)$');
    expect(m.includes('<em>')).toBe(false);
    expect(m.includes('<a ')).toBe(false);
    expect(plain(m)).toContain('$a_1 * b_2 \\unknown [x](y)$');
  });
  it('неизвестная команда и лишняя скобка — не чинятся (угадывать нечего), показываются текстом', () => {
    for (const f of ['$\\unknowncmd{3}$', '$a}$', '$\\left( x$']) {
      const h = html('раз ' + f + ' два');
      expect(h.includes('katex-error'), f).toBe(false);
      expect(plain(h), f).toContain(f);
    }
  });
  it('{align} только в режиме блока: в строке — текстом, в блоке — формулой', () => {
    const body = '\\begin{align} a &= b \\end{align}';
    expect(html('вот $' + body + '$').includes('katex-error')).toBe(false);
    expect(html('вот $' + body + '$').includes('katex')).toBe(false);
    const blk = html('вот\n\n$$\n' + body + '\n$$\n');
    expect(blk.includes('katex-display')).toBe(true);
    expect(blk.includes('katex-error')).toBe(false);
  });
  it('закрывающий $$ не на своей строке — не блок: проверка как строчной формулы', () => {
    const h = html('$$\n\\begin{align} a &= b \\end{align}\n$$ и дальше');
    expect(h.includes('katex-error')).toBe(false);
    expect(plain(h)).toContain('и дальше');
  });
  it('\\( … \\) и \\[ … \\] тоже проверяются', () => {
    expect(html('вот \\(\\frac{1}{2\\) дальше').includes('katex-error')).toBe(false);
    expect(html('вот \\(\\frac{1}{2\\) дальше').includes('class="katex"')).toBe(true);
    expect(html('вот\n\n\\[\\bogus{1}\\]\n\nдальше').includes('katex-error')).toBe(false);
  });
  it('деньги и код — как прежде, даже рядом со сломанной формулой', () => {
    expect(prepMath('цена $5 и $10, а $\\frac{1}{2$')).toBe('цена \\$5 и \\$10, а $\\frac{1}{2}$');
    const code = 'код `$\\frac{1}{2$` и\n```\n$\\frac{1}{2$ $\\bad}$\n```';
    expect(prepMath(code)).toBe(code);
  });
  it('повтор той же формулы берётся из кэша: тот же результат', () => {
    const a = prepMath('$\\frac{1}{3$'), b = prepMath('другое $\\frac{1}{3$');
    expect(a).toBe('$\\frac{1}{3}$');
    expect(b).toBe('другое $\\frac{1}{3}$');
  });
});
