import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const redirect = vi.fn((to: string) => { throw new Error(`redirect:${to}`); });
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/api-keys', redirect: (to: string) => redirect(to) }));
let who: { role: string } | null = { role: 'user' };
vi.mock('@/lib/auth', () => ({ currentUser: async () => who }));

describe('меню профиля', () => {
  it('обычный пользователь: Настройки, Память, API, Выйти — без GitHub (только «Альфа» и «Админ», 03.11), Администрирования и Диагностики', async () => {
    const { AccountMenu } = await import('@/components/Shell');
    const h = renderToStaticMarkup(createElement(AccountMenu, { name: 'Иван', email: 'e@x.ru', admin: false, initials: 'Е', onLogout: async () => {}, initialOpen: true }));
    for (const id of ['settings-link', 'memory-link', 'limits-link', 'api-link', 'logout']) expect(h).toContain(`data-testid="${id}"`);
    expect(h).not.toContain('github-link');
    const alpha = renderToStaticMarkup(createElement(AccountMenu, { name: 'Иван', admin: false, agents: true, initials: 'Е', onLogout: async () => {}, initialOpen: true }));
    expect(alpha).toContain('data-testid="github-link"');
    expect(alpha).not.toContain('admin-link');
    expect(h).not.toContain('admin-link');
    expect(h).not.toContain('vp-link');
    expect(h).not.toContain('Администрирование');
    expect(h).toContain('e@x.ru');
    expect(h).toMatch(/class="acct-item is-on"[^>]*aria-current="page"[^>]*data-testid="api-link"|aria-current="page"[^>]*data-testid="api-link"/);
  });
  it('API выведен из эксплуатации (api=false, KX_API != 1): пункта «API» нет ни у кого, остальное на месте', async () => {
    const { AccountMenu } = await import('@/components/Shell');
    for (const admin of [false, true]) {
      const h = renderToStaticMarkup(createElement(AccountMenu, { name: 'Иван', admin, api: false, initials: 'Е', onLogout: async () => {}, initialOpen: true }));
      expect(h).not.toContain('api-link');
      expect(h).toContain('data-testid="settings-link"');
    }
  });
  it('администратор: плюс Администрирование и Диагностика экрана', async () => {
    const { AccountMenu } = await import('@/components/Shell');
    const h = renderToStaticMarkup(createElement(AccountMenu, { name: 'Админ', admin: true, initials: 'А', onLogout: async () => {}, initialOpen: true }));
    expect(h).toContain('data-testid="admin-link"');
    expect(h).toContain('data-testid="vp-link"');
    expect(h).toContain('data-testid="github-link"');
  });
});
