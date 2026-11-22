import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => '/' }));

describe('письмо клиенту и действия', () => {
  it('```letter с JSON (do_all) — блок: «Письмо клиенту · кому», тема, «Скопировать · В почту · Изменить», «Письмо · Сообщение»; без JSON — код', async () => {
    const { MarkdownBody } = await import('@/components/MarkdownBody');
    const { I18nProvider } = await import('@/lib/i18n/react');
    const L = { to: 'ООО «Магистраль-Тест»', subject: 'Документы для закрытия 3 квартала 2026', body: 'Добрый день!\n\nПришлите, пожалуйста, акт сверки.\n\nСпасибо!', short: 'Для закрытия 3 квартала не хватает акта сверки.' };
    const md = 'Не хватает документа.\n\n```letter\n' + JSON.stringify(L) + '\n```';
    const html = renderToStaticMarkup(createElement(I18nProvider, { lang: 'ru' } as never, createElement(MarkdownBody, { text: md })));
    expect(html).toContain('data-testid="letter"');
    expect(html).toContain('Письмо клиенту · ООО «Магистраль-Тест»');
    expect(html).toContain('Тема: Документы для закрытия 3 квартала 2026');
    for (const id of ['letter-copy', 'letter-mail', 'letter-edit', 'letter-body', 'letter-short']) expect(html).toContain(`data-testid="${id}"`);
    expect(html).toMatch(/href="mailto:\?subject=%D0%94[^"]*&amp;body=%D0%94/);
    expect(html).not.toContain('code-block');
    const plain = renderToStaticMarkup(createElement(I18nProvider, { lang: 'ru' } as never, createElement(MarkdownBody, { text: '```letter\nДобрый день! Просто текст.\n```' })));
    expect(plain).toContain('code-block');
    expect(plain).not.toContain('data-testid="letter"');
  });
  it('несколько писем — один список под ответом; ограждения из текста убираются', async () => {
    const { lettersIn, withoutLetters, LettersList } = await import('@/components/blocks/Letter');
    const { I18nProvider } = await import('@/lib/i18n/react');
    const one = (to: string) => '```letter\n' + JSON.stringify({ to, subject: 'Тема', body: 'Добрый день!\n\nСпасибо!', short: '' }) + '\n```';
    const md = `Итоги.\n\n${one('ООО «А»')}\n\n${one('ИП Б')}\n\n\`\`\`letter\nне json\n\`\`\``;
    expect(lettersIn(md).map((l) => l.to)).toEqual(['ООО «А»', 'ИП Б']);
    const rest = withoutLetters(md);
    expect(rest).toContain('Итоги.'); expect(rest).not.toContain('ООО «А»'); expect(rest).toContain('не json');
    const html = renderToStaticMarkup(createElement(I18nProvider, { lang: 'ru' } as never, createElement(LettersList, { list: lettersIn(md) })));
    expect(html).toContain('Письма: 2 клиентам');
    expect(html).toContain('data-testid="letters-copy"'); expect(html).toContain('data-testid="letters-xlsx"');
    expect((html.match(/data-testid="letters-row"/g) ?? []).length).toBe(2);
  });
  it('действия (тексты B): под ответом — четыре, после «сделать всё» — две; в пустом чате — сроки, контрагент, налог', async () => {
    const Q = await import('@/components/QuickActions');
    const { I18nProvider } = await import('@/lib/i18n/react');
    const render = (ids: typeof Q.ANSWER_SET) => renderToStaticMarkup(createElement(I18nProvider, { lang: 'ru' } as never, createElement(Q.QuickActions, { ids, onAct: () => {}, lead: 'Ещё:' })));
    const a = render(Q.ANSWER_SET);
    for (const t of ['Сверить с банком', 'Найти ошибки и дубли', 'Реестр к оплате', 'Посчитать налог']) expect(a).toContain(`>${t}</button>`);
    expect(a).toContain('class="ans-link"');
    expect(render(Q.AFTER_ALL_SET)).not.toContain('Сверить с банком');
    expect(Q.HOME_SET).toEqual([{ id: 'deadlines', how: 'send' }, { id: 'inn', how: 'fill' }, { id: 'tax', how: 'files' }]);
    expect(render(Q.HOME_SET.map((x) => x.id))).toContain('>Проверить контрагента</button>');
  });
});

