// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '@/lib/i18n/react';
import type { Lang } from '@/lib/i18n/core';
import { MemoryBody, MemoryLine } from '@/components/Memory';
import type { MemoryInfo } from '@/lib/types';

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(cleanup);

const mem = (o: Partial<MemoryInfo> = {}) => ({ v: 1, total_tokens: 12, files_tokens: 0, files: 0, chat_tokens: 12, chat_turns: 1, web_tokens: 0, limit_tokens: 5_767_168, remaining_tokens: 5_767_156, ...o }) as MemoryInfo;
const usage = { prompt_tokens: 10_302, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 9_328 } };
const wrap = (lang: Lang, el: React.ReactElement) => createElement(I18nProvider, { lang, children: el });

describe('панель памяти', () => {
  it('RU: «Память беседы: 12 ток. — ваши сообщения и ответы» и «Прочитано моделью за этот ответ: 10 302 ток. (из кэша 9 328)»', () => {
    render(wrap('ru', createElement(MemoryBody, { memory: mem(), usage })));
    const lines = [...screen.getByTestId('mem-lines').querySelectorAll('p')].map((p) => p.textContent!.replace(/ | /g, ' '));
    expect(lines).toEqual(['Память беседы: 12 ток. — ваши сообщения и ответы', 'Прочитано моделью за этот ответ: 10 302 ток. (из кэша 9 328)']);
  });
  it('нет usage у хода — только первая строка; нет кэша — без скобок; есть файлы — «сообщения, ответы и файлы чата»', () => {
    render(wrap('ru', createElement(MemoryBody, { memory: mem(), usage: null })));
    expect(screen.getByTestId('mem-lines').querySelectorAll('p')).toHaveLength(1);
    cleanup();
    render(wrap('ru', createElement(MemoryBody, { memory: mem({ files: 1, files_tokens: 800, total_tokens: 812 }), usage: { prompt_tokens: 5_000 } })));
    const t = screen.getByTestId('mem-lines').textContent!.replace(/ | /g, ' ');
    expect(t).toContain('Память беседы: 812 ток. — сообщения, ответы и файлы чата');
    expect(t).toContain('Прочитано моделью за этот ответ: 5 000 ток.'); expect(t).not.toContain('из кэша');
  });
  it('EN и SR', () => {
    render(wrap('en', createElement(MemoryBody, { memory: mem(), usage })));
    expect(screen.getByTestId('mem-lines').textContent).toContain('Chat memory: 12 tok — your messages and answers');
    expect(screen.getByTestId('mem-lines').textContent).toContain('Read by the model for this answer: 10,302 tok (from cache 9,328)');
    cleanup();
    render(wrap('sr', createElement(MemoryBody, { memory: mem(), usage })));
    expect(screen.getByTestId('mem-lines').textContent).toContain('Memorija čata: 12 tok — vaše poruke i odgovori');
    expect(screen.getByTestId('mem-lines').textContent).toContain('Model je pročitao za ovaj odgovor');
  });
});

describe('строка под ответом', () => {
  it('«Память беседы · 12 из 5,5M», без «ток» и без «Korvex»; подсказка — те же две строки', () => {
    render(wrap('ru', createElement(MemoryLine, { memory: mem(), usage })));
    const b = screen.getByTestId('mem-line');
    expect(b.textContent!.replace(/ | /g, ' ')).toMatch(/^Память беседы · 12 из 5,5M$/);
    expect(b.textContent).not.toContain('Korvex');
    expect(b.getAttribute('title')!.split('\n')).toHaveLength(2);
    expect(b.getAttribute('title')).toContain('Прочитано моделью за этот ответ');
  });
});
