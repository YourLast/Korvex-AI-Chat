import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => '/' }));

describe('письмо клиенту и действия', () => {
  it('```letter — абзацы письма и тихая ссылка копирования, не блок кода', async () => {
    const { MarkdownBody } = await import('@/components/MarkdownBody');
    const { I18nProvider } = await import('@/lib/i18n/react');
    const md = 'Не хватает двух документов.\n\n```letter\nДобрый день!\n\nПришлите, пожалуйста, акт сверки за октябрь.\nСпасибо.\n```';
    const html = renderToStaticMarkup(createElement(I18nProvider, { lang: 'ru' } as never, createElement(MarkdownBody, { text: md })));
    expect(html).toContain('data-testid="letter"');
    expect(html).toContain('<p><span>Добрый день!</span></p>');
    expect(html).toContain('Пришлите, пожалуйста, акт сверки за октябрь.</span><span><br/>Спасибо.');
    expect(html).toMatch(/data-testid="letter-copy"[^>]*>Скопировать письмо</);
    expect(html).not.toContain('code-block');
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

describe('письмо от кода навыка (do_all)', () => {
  it('раздел «Письмо клиенту»: от «Добрый день!» до «Спасибо!», без «>» и жирного; без раздела или с ```letter — нет', async () => {
    const { letterOf } = await import('@/components/AnswerLines');
    const md = '**Чего не хватает — 2**\n1. Акт сверки\n\n**Письмо клиенту**\n> Добрый день!\n>\n> Разбираем документы ООО «Тест». Чтобы закрыть проверку, не хватает:\n> 1. **акта сверки**\n>\n> Спасибо!\n\nДальше — итоги.';
    expect(letterOf(md)).toBe('Добрый день!\n\nРазбираем документы ООО «Тест». Чтобы закрыть проверку, не хватает:\n1. акта сверки\n\nСпасибо!');
    expect(letterOf('Добрый день! Вот ответ. Спасибо!')).toBeNull();
    expect(letterOf('Письмо клиенту\n```letter\nДобрый день!\nСпасибо!\n```')).toBeNull();
  });
});
