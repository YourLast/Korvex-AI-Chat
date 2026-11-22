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
  it('действия: пять текстовых ссылок с готовой просьбой', async () => {
    const { QuickActions, QUICK } = await import('@/components/QuickActions');
    const { I18nProvider } = await import('@/lib/i18n/react');
    const html = renderToStaticMarkup(createElement(I18nProvider, { lang: 'ru' } as never, createElement(QuickActions, { onAct: () => {}, lead: 'Ещё:' })));
    expect(QUICK.map((q) => q.id)).toEqual(['recon', 'errors', 'registry', 'tax', 'deadlines']);
    for (const t of ['Сверить с банком', 'Найти ошибки и дубли', 'Реестр к оплате', 'Посчитать налог', 'Мои сроки']) expect(html).toContain(`>${t}</button>`);
    expect(html).toContain('class="ans-link"');
  });
});
