import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const REPO = 'https://github.com/YourLast/Korvex-AI-Chat';
afterEach(() => { vi.resetModules(); vi.doUnmock('@/ext/client'); });

async function render(powered: boolean, brand?: { name: string; short: string }) {
  vi.doMock('@/ext/client', async (orig) => ({ ...(await orig<object>()), POWERED_BY: powered ? { text: 'Powered by Korvex', long: 'Powered by Korvex AI Chat', href: REPO, mail: 'hello@example.com' } : null }));
  const { FootNote } = await import('@/components/FootNote');
  const { BrandProvider } = await import('@/components/BrandCtx');
  const { setBrandNames } = await import('@/lib/brandCore');
  const el = createElement(FootNote, { text: 'Korvex AI может ошибаться. Проверяйте важные цифры.' });
  const h = renderToStaticMarkup(brand ? createElement(BrandProvider, { value: { ...brand, footer: '', logoUrl: null }, children: el }) : el);
  setBrandNames(null);
  return h;
}

describe('строка Powered by Korvex', () => {
  it('открытая версия без бренда: «Ассистент может ошибаться · Powered by Korvex», ссылка на репозиторий', async () => {
    const h = await render(true);
    expect(h).toContain('Ассистент может ошибаться · ');
    expect(h).toContain(`<a href="${REPO}" target="_blank" rel="noopener">Powered by Korvex</a>`);
    expect(h).not.toContain('Проверяйте');
  });
  it('с брендом партнёра первая часть — его имя, «Powered by Korvex» не заменяется', async () => {
    const h = await render(true, { name: 'Acme Assist', short: 'Acme' });
    expect(h).toContain('Acme Assist может ошибаться · ');
    expect(h).toContain('>Powered by Korvex</a>');
    expect(h).not.toContain('Powered by Acme');
  });
  it('живой Korvex (POWERED_BY = null): прежняя сноска без строки', async () => {
    const h = await render(false);
    expect(h).toBe('<div class="foot-note">Korvex AI может ошибаться. Проверяйте важные цифры.</div>');
  });
});
