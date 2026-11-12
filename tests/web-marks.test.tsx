// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { Markdown } from '@/components/Markdown';
import { SrcCtx } from '@/components/SrcChip';
import { srcLinks } from '@/components/MarkdownBody';
import { setChatFiles } from '@/lib/fileView';
import { matchUrl, stripWebMarks, turnUrls, webTarget, webTargets } from '@/lib/webmark';
import { summarize } from '@/lib/summary';
import type { Source } from '@/lib/srcmark';

afterEach(() => { cleanup(); setChatFiles([]); });

const mount = (text: string, ctx: { sources?: Source[] | null; live?: boolean; urls?: string[] } = {}) =>
  render(createElement(SrcCtx.Provider, { value: { sources: ctx.sources ?? null, live: !!ctx.live, urls: ctx.urls } }, createElement(Markdown, { text, live: ctx.live })));
const chips = (c: HTMLElement) => [...c.querySelectorAll('[data-testid=web-chip]')].map((e) => ({ host: e.textContent, state: (e as HTMLElement).dataset.state, href: e.getAttribute('href') }));
const OWNER = 'Агент делает это сам, без лишних вопросов, но опасные действия требуют «approval» [[developers.openai.com]]. Бенчмарки мерят гвардейлами [[cryptopolitan.com]] [[beri.net]].';

describe('разбор веб-метки', () => {
  it('домен, несколько доменов, адрес — веб; вики-разметка, файлы, «src:», версии — нет', () => {
    expect(webTargets('developers.openai.com')).toEqual([{ host: 'developers.openai.com' }]);
    expect(webTargets('www.CryptoPolitan.com')).toEqual([{ host: 'cryptopolitan.com' }]);
    expect(webTargets('cryptopolitan.com, beri.net')?.map((t) => t.host)).toEqual(['cryptopolitan.com', 'beri.net']);
    expect(webTargets('cryptopolitan.com и beri.net')?.map((t) => t.host)).toEqual(['cryptopolitan.com', 'beri.net']);
    expect(webTargets('https://developers.openai.com/docs/guides/agents')).toEqual([{ host: 'developers.openai.com', url: 'https://developers.openai.com/docs/guides/agents', path: '/docs/guides/agents' }]);
    expect(webTargets('nbs.rs')?.[0].host).toBe('nbs.rs');
    expect(webTargets('новости.рф')?.[0].host).toBe('новости.рф');
    for (const s of ['Main Page', 'File:Example.jpg', 'Category:Banks', 'insert: итог.txt', 'src:Акт.pdf|стр. 3', 'отчёт.pdf', 'main.py', 'notes.md', 'Выгрузка.xlsx',
      'v2.5.1', 'Qwerty3.5', 'e.g', 'т.е', '1', 'think:junk', 'developers.openai.com is great', 'Node.js']) {
      expect(webTargets(s), s).toBeNull();
    }
    expect(webTarget('«beri.net».')?.host).toBe('beri.net');
  });

  it('адреса хода: ссылки Markdown и голые адреса без хвостовой пунктуации; сопоставление по домену и поддомену, путь — точнее', () => {
    const urls = turnUrls([
      'См. [гайд](https://developers.openai.com/docs/guides/agents) и https://www.cryptopolitan.com/news/ai-guardrails/.',
      'в размышлении: (https://en.wikipedia.org/wiki/Guardrail_(AI)) и https://platform.openai.com/docs.',
      null, undefined,
    ]);
    expect(urls).toEqual(['https://developers.openai.com/docs/guides/agents', 'https://www.cryptopolitan.com/news/ai-guardrails/', 'https://en.wikipedia.org/wiki/Guardrail_(AI)', 'https://platform.openai.com/docs']);
    expect(matchUrl({ host: 'cryptopolitan.com' }, urls)).toBe('https://www.cryptopolitan.com/news/ai-guardrails/');
    expect(matchUrl({ host: 'openai.com' }, urls)).toBe('https://developers.openai.com/docs/guides/agents');
    expect(matchUrl({ host: 'platform.openai.com', path: '/docs' }, urls)).toBe('https://platform.openai.com/docs');
    expect(matchUrl({ host: 'beri.net' }, urls)).toBeNull();
    expect(matchUrl({ host: 'x.org', url: 'https://x.org/a' }, [])).toBe('https://x.org/a');
  });
});

describe('отрисовка: сырых [[…]] нет', () => {
  it('ответ product 09.11: три чипа доменов, скобок в тексте нет; без адресов хода — чипы без ссылки', () => {
    const { container } = mount(OWNER);
    expect(container.textContent).not.toContain('[[');
    expect(container.textContent).not.toContain(']]');
    expect(chips(container)).toEqual([
      { host: 'developers.openai.com', state: 'plain', href: null },
      { host: 'cryptopolitan.com', state: 'plain', href: null },
      { host: 'beri.net', state: 'plain', href: null },
    ]);
    expect(container.querySelector('.prose')?.textContent).toContain('требуют «approval» developers.openai.com.');
  });

  it('адрес того же сайта в ходе — чип-ссылка в новой вкладке (noopener), нет — тихий чип', () => {
    const { container } = mount(OWNER, { urls: ['https://developers.openai.com/docs/guides/agents-safety', 'https://www.cryptopolitan.com/ai-guardrails-benchmark/'] });
    expect(chips(container)).toEqual([
      { host: 'developers.openai.com', state: 'link', href: 'https://developers.openai.com/docs/guides/agents-safety' },
      { host: 'cryptopolitan.com', state: 'link', href: 'https://www.cryptopolitan.com/ai-guardrails-benchmark/' },
      { host: 'beri.net', state: 'plain', href: null },
    ]);
    const a = container.querySelector('a[data-testid=web-chip]')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(a.getAttribute('aria-label')).toBe('Открыть источник в интернете: developers.openai.com');
  });

  it('несколько доменов в одной метке; полный адрес — ссылкой на него', () => {
    const { container } = mount('Источники: [[cryptopolitan.com, beri.net]] и [[https://developers.openai.com/docs/x]].');
    expect(container.textContent).not.toContain('[[');
    expect(chips(container)).toEqual([
      { host: 'cryptopolitan.com', state: 'plain', href: null },
      { host: 'beri.net', state: 'plain', href: null },
      { host: 'developers.openai.com', state: 'link', href: 'https://developers.openai.com/docs/x' },
    ]);
  });

  it('код не трогаем: блок ```, блок ~~~ и `инлайн` с «[[…]]» — как есть', () => {
    const text = 'Вики: `[[en.wikipedia.org]]` в строке.\n\n```\nsee [[developers.openai.com]] and [[Main Page]]\n```\n\n~~~\n[[beri.net]]\n~~~\n\n```md\n~~~ [[x.com]] внутри\n```\n\nА здесь — источник [[beri.net]].';
    const { container } = mount(text);
    const codes = [...container.querySelectorAll('pre code')].map((c) => c.textContent);
    expect(codes).toEqual(['see [[developers.openai.com]] and [[Main Page]]\n', '[[beri.net]]\n', '~~~ [[x.com]] внутри\n']);
    expect(container.querySelector('p code')?.textContent).toBe('[[en.wikipedia.org]]');
    expect(chips(container)).toEqual([{ host: 'beri.net', state: 'plain', href: null }]);
    expect(srcLinks(text)).toContain('```\nsee [[developers.openai.com]] and [[Main Page]]\n```');
  });

  it('вики-разметка и прочие «[[…]]» в тексте — как есть (не домен)', () => {
    const { container } = mount('Ссылка [[Main Page]] и [[File:Example.jpg|thumb]], файл [[отчёт.pdf]].');
    expect(container.textContent).toContain('[[Main Page]]');
    expect(container.textContent).toContain('[[File:Example.jpg|thumb]]');
    expect(container.textContent).toContain('[[отчёт.pdf]]');
    expect(chips(container)).toEqual([]);
  });

  it('файловые маркеры [[src:…]] — по-прежнему чип файла; [[src:домен]] (не файл чата) — чип домена', () => {
    setChatFiles([{ id: 'f1', name: 'Акт.pdf', size: 1 }]);
    const src: Source[] = [{ n: 1, raw: '[[src:Акт.pdf|стр. 3]]', file: 'Акт.pdf', kind: 'page', page: 3, verified: true }];
    const { container } = mount('Штраф 0,5 % [[src:Акт.pdf|стр. 3]], по данным [[src:developers.openai.com]].', { sources: src });
    expect(container.textContent).not.toContain('[[');
    expect(container.querySelector('[data-testid=src-chip]')?.textContent).toBe('стр. 3');
    expect(chips(container)).toEqual([{ host: 'developers.openai.com', state: 'plain', href: null }]);
  });

  it('поток: недописанная метка в конце не видна, дописанная — чип', () => {
    expect(srcLinks('по данным [[developers.open')).toBe('по данным […](#kxsrc "pending")');
    expect(srcLinks('по данным [[developers.openai.com]')).toBe('по данным […](#kxsrc "pending")');
    expect(srcLinks('по данным [[src:Акт.pdf|ст')).toBe('по данным […](#kxsrc "pending")');
    expect(srcLinks('по данным [[developers.openai.com]].')).toBe(`по данным [↗](#kxweb "${encodeURIComponent('developers.openai.com')}").`);
    const live = mount('Пишу: по данным [[developers.open', { live: true });
    expect(live.container.textContent).not.toContain('[[');
    live.unmount();
    const done = mount('Пишу: по данным [[developers.openai.com]]', { live: true });
    expect(chips(done.container)).toEqual([{ host: 'developers.openai.com', state: 'plain', href: null }]);
  });

  it('копирование и превью уведомления — без скобок', () => {
    expect(stripWebMarks(OWNER)).toBe('Агент делает это сам, без лишних вопросов, но опасные действия требуют «approval» (developers.openai.com). Бенчмарки мерят гвардейлами (cryptopolitan.com) (beri.net).');
    expect(stripWebMarks(OWNER, 'drop')).toBe('Агент делает это сам, без лишних вопросов, но опасные действия требуют «approval». Бенчмарки мерят гвардейлами.');
    expect(stripWebMarks('`[[a.com]]` и [[Main Page]]')).toBe('`[[a.com]]` и [[Main Page]]');
    expect(summarize('Опасные действия требуют подтверждения [[developers.openai.com]].')).toBe('Опасные действия требуют подтверждения.');
  });
});
