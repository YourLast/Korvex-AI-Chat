// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { Markdown } from '@/components/Markdown';
import { SrcCtx, SrcList } from '@/components/SrcChip';
import { I18nProvider } from '@/lib/i18n/react';
import { _resetFileView, nearFile, setChatFiles } from '@/lib/fileView';
import { markerLoc, parseLocator, stripMarkers, type Source } from '@/lib/srcmark';
import { tr, type Lang } from '@/lib/i18n/core';

const PP = 'paypal-user-agreement-us-2026-11-04.pdf', CFR = 'CFR-2025-title26-vol1-4.pdf';
const FILES = [{ id: 'f1', name: PP, size: 1 }, { id: 'f2', name: CFR, size: 1 }, { id: 'f3', name: 'e4c9669fc964b9231286ffe9292ed80a-TermsandConditions-(WiseEuropeSA)-Wise.pdf', size: 1 }];
const M = (f: string, loc: string, q?: string) => `[[src:${f}|${loc}${q ? `|"${q}"` : ''}]]`;
const src = (o: Partial<Source> & Pick<Source, 'raw' | 'file' | 'kind'>): Source => ({ verified: true, ...o });
beforeEach(() => { _resetFileView(); setChatFiles(FILES); });
afterEach(() => { cleanup(); setChatFiles([]); });
const mount = (lang: Lang, text: string, ctx: { sources: Source[] | null; live: boolean }) =>
  render(createElement(I18nProvider, { lang, children: createElement(SrcCtx.Provider, { value: ctx }, createElement(Markdown, { text })) }));
const T = (lang: Lang) => ((k: string, p?: Record<string, string | number>) => tr(lang, k as never, p)) as never;

describe('локатор -> место -> подпись на языке интерфейса', () => {
  it('русские, английские и сербские написания разбираются в одно и то же место', () => {
    for (const s of ['стр. 19', 'p. 19', 'p.19', 'page 19', 'str. 19', 'страница 19', 'с. 19']) expect(parseLocator(s)).toMatchObject({ kind: 'page', page: 19 });
    for (const s of ['стр. 19–20', 'pp. 19–20', 'pages 19-20', 'p. 19—20']) expect(parseLocator(s)).toMatchObject({ kind: 'page', page: 19, page_to: 20 });
    expect(parseLocator('slides 4')).toMatchObject({ kind: 'slide', slide: 4 });
    expect(parseLocator('sheet Sales, row 12')).toMatchObject({ kind: 'row', sheet: 'Sales', row: 12 });
    expect(parseLocator('sheet Sales, cell F12')).toMatchObject({ kind: 'cell', sheet: 'Sales', col: 'F', row: 12 });
    expect(parseLocator('lines 40–52')).toMatchObject({ kind: 'line', line: 40, line_to: 52 });
    expect(parseLocator('p. 19.')).toMatchObject({ kind: 'page', page: 19 });
  });
  it('markerLoc: «стр. 19» в английском чате — «p. 19», в русском — «стр. 19», в сербском — «str. 19»; нераспознанное — пусто (слова модели не показываем)', () => {
    expect(markerLoc('стр. 19', T('en'))).toBe('p. 19');
    expect(markerLoc('p. 19', T('ru'))).toBe('стр. 19');
    expect(markerLoc('pp. 19–20', T('sr'))).toBe('str. 19–20');
    expect(markerLoc('лист Реализация, строка 5', T('en'))).toBe('sheet Реализация, row 5');
    expect(markerLoc('где-то в середине', T('en'))).toBe('');
    expect(markerLoc('', T('en'))).toBe('');
  });
  it('копирование ответа: место подписано на языке интерфейса; без языка (сервер) — как написала модель', () => {
    const t = `Нашёл ${M(PP, 'стр. 19', 'x')}.`;
    expect(stripMarkers(t, 'plain', 'en')).toBe(`Нашёл (${PP}, p. 19).`);
    expect(stripMarkers(t)).toBe(`Нашёл (${PP}, стр. 19).`);
    expect(stripMarkers(`a ${M(PP, 'слова модели')} b`, 'plain', 'en')).toBe(`a (${PP}) b`);
  });
  it('nearFile: искажённое имя вложенного файла — «почти» он; чужое имя — нет', () => {
    expect(nearFile(FILES, 'paypal-usr-agreement-us-2026-11-O4.pdf')).toBe(true);
    expect(nearFile(FILES, 'CFR-2025-tltle26-vol1-4.pdf')).toBe(true);
    expect(nearFile(FILES, 'Акты/CFR-2025-title26-vol1-4.pdf')).toBe(true);
    expect(nearFile(FILES, 'договор_поставки_2024.docx')).toBe(false);
  });
});

describe('английский чат: чипы и простой текст', () => {
  it('проверенный маркер с русским локатором: чип «p. 19»', () => {
    const raw = M(PP, 'стр. 19', 'quote');
    const { container } = mount('en', `See ${raw}.`, { sources: [src({ raw, file: PP, kind: 'page', page: 19, quote: 'quote' })], live: false });
    const chip = container.querySelector('button[data-testid=src-chip]')!;
    expect(chip.textContent).toBe('p. 19');
    expect(container.textContent).not.toMatch(/стр/);
  });
  it('пока идёт ответ и списка ещё нет: серый чип подписан на языке интерфейса, а не «стр. 19» из маркера', () => {
    const raw = M(PP, 'стр. 19', 'quote');
    const { container } = mount('en', `See ${raw}`, { sources: null, live: true });
    const wait = container.querySelector('[data-testid=src-chip][data-state=wait]')!;
    expect(wait.textContent).toContain('p. 19');
    expect(wait.textContent).not.toMatch(/стр/);
    expect(wait.textContent).not.toContain('[[src');
  });
  it('непроверенный маркер: простой текст «(файл, p. 33)» — место из списка серва на языке интерфейса; без чипа и без «[[src:»', () => {
    const raw = M(PP, 'стр. 33', 'text that is not on the page');
    const { container } = mount('en', `Not found ${raw}.`, { sources: [src({ raw, file: PP, kind: 'page', page: 33, verified: false })], live: false });
    expect(container.querySelector('button[data-testid=src-chip]')).toBeNull();
    const plain = container.querySelector('[data-testid=src-plain]')!;
    expect(plain.textContent).toBe(`(${PP}, p. 33)`);
    expect(container.textContent).not.toMatch(/стр|\[\[src/);
  });
  it('ответ закончился, списка нет: простой текст на языке интерфейса', () => {
    const { container } = mount('en', `Here ${M(PP, 'стр. 19–20', 'q')}.`, { sources: null, live: false });
    expect(container.querySelector('[data-testid=src-plain]')!.textContent).toBe(`(${PP}, p. 19–20)`);
  });
  it('искажённое имя файла (похоже на вложенный): ни чипа, ни искажённого имени, ни «[[src:» — только место; файл по похожему имени не угадывается', () => {
    const bad = M('paypal-usr-agreement-us-2026-11-O4.pdf', 'стр. 19', 'q'), bad2 = M('CFR-2025-tltle26-vol1-4.pdf', 'p. 19–20', 'q');
    const { container } = mount('en', `One ${bad} and two ${bad2}.`, { sources: [
      src({ raw: bad, file: 'paypal-usr-agreement-us-2026-11-O4.pdf', kind: 'page', page: 19, verified: false, reason: 'no_file' }),
      src({ raw: bad2, file: 'CFR-2025-tltle26-vol1-4.pdf', kind: 'page', page: 19, page_to: 20, verified: false, reason: 'no_file' }),
    ], live: false });
    expect(container.querySelector('button[data-testid=src-chip]')).toBeNull();
    const texts = [...container.querySelectorAll('[data-testid=src-plain]')].map((e) => e.textContent);
    expect(texts).toEqual(['(p. 19)', '(p. 19–20)']);
    expect(container.textContent).not.toMatch(/usr-agreement|tltle|\[\[src|стр/);
  });
  it('искажённое имя без записи в списке серва — то же: чистый текст из разобранного локатора', () => {
    const bad = M('paypal-usr-agreement-us-2026-11-O4.pdf', 'стр. 19', 'q');
    const { container } = mount('en', `One ${bad}.`, { sources: [], live: false });
    expect(container.querySelector('[data-testid=src-plain]')!.textContent).toBe('(p. 19)');
  });
  it('искажённое имя в маркере, но серв проверил и дал file_ref: чип ведёт на настоящий файл и называет его настоящим именем', () => {
    const raw = M('paypal_user_agreemnt.pdf', 'p. 29', 'q'), raw2 = M(CFR, 'p. 3', 'q');
    const { container } = mount('en', `A ${raw}. B ${raw2}.`, { sources: [src({ raw, file: 'paypal_user_agreemnt.pdf', file_ref: 'f1', kind: 'page', page: 29 }), src({ raw: raw2, file: CFR, kind: 'page', page: 3 })], live: false });
    const chips = [...container.querySelectorAll<HTMLButtonElement>('button[data-testid=src-chip]')];
    expect(chips.length).toBe(2);
    expect(chips[0].title).toBe(`${PP} · p. 29`);
    expect(chips[0].getAttribute('aria-label')).toContain(PP);
    expect(chips[0].textContent).not.toContain('agreemnt');
    expect(chips[0].querySelector('.src-n')?.textContent).toMatch(/^paypal/);
    expect(container.innerHTML).not.toContain('agreemnt');
  });
  it('незакрытый маркер в законченном ответе — ничего (не серый «…» навсегда и не сырой синтаксис)', () => {
    const { container } = mount('en', 'Answer [[src:file.pdf|p. 1', { sources: [], live: false });
    expect(container.querySelector('[data-testid=src-chip]')).toBeNull();
    expect(container.textContent).not.toContain('[[src');
    expect(container.textContent).not.toContain('…');
  });
  it('имя, непохожее ни на один вложенный файл (настоящий чужой файл), показывается простым текстом', () => {
    const raw = M('contract_2024.docx', 'p. 2', 'q');
    const { container } = mount('en', `Other ${raw}.`, { sources: [src({ raw, file: 'contract_2024.docx', kind: 'page', page: 2, verified: false })], live: false });
    expect(container.querySelector('[data-testid=src-plain]')!.textContent).toBe('(contract_2024.docx, p. 2)');
  });
  it('блок «Источники»: диапазон «pp. 19–20» и места на языке интерфейса', () => {
    const sources = [src({ raw: 'a', file: PP, kind: 'page', page: 19, page_to: 20, quote: 'q' }), src({ raw: 'b', file: PP, kind: 'page', page: 29, quote: 'q' })];
    const { container } = render(createElement(I18nProvider, { lang: 'en', children: createElement(SrcList, { sources, live: false }) }));
    const items = [...container.querySelectorAll('[data-testid=src-item] .srcl-p')].map((e) => e.textContent);
    expect(items).toEqual(['pp. 19–20', 'p. 29']);
  });
});

describe('блок «Источники»: счётчики склоняются по своим числам', () => {
  it('«1 file · 2 places» (не «1 files»), «2 files · 5 places», по-русски «1 файл · 2 места», «3 файла · 5 мест»', () => {
    const mk = (lang: Lang, files: Array<[string, number]>) => {
      const sources = files.flatMap(([f, n]) => Array.from({ length: n }, (_, i) => src({ raw: `${f}${i}`, file: f, kind: 'page', page: i + 1, quote: 'q' })));
      const { container, unmount } = render(createElement(I18nProvider, { lang, children: createElement(SrcList, { sources, live: false }) }));
      const t = container.querySelector('.srcl-head small')!.textContent; unmount(); return t;
    };
    expect(mk('en', [[PP, 2]])).toBe('1 file · 2 places');
    expect(mk('en', [[PP, 3], [CFR, 2]])).toBe('2 files · 5 places');
    expect(mk('ru', [[PP, 2]])).toBe('1 файл · 2 места');
    expect(mk('ru', [[PP, 3], [CFR, 2]])).toBe('2 файла · 5 мест');
    expect(mk('sr', [[PP, 1]])).toBe('1 fajl · 1 mesto');
  });
});
