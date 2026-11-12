// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { I18nProvider } from '@/lib/i18n/react';
import type { Lang } from '@/lib/i18n/core';
import { LoginForm } from '@/components/LoginForm';
import { InviteForm } from '@/components/InviteForm';
import { QueueCard } from '@/components/QueueCard';
import { LangSwitch } from '@/components/LangSwitch';
import { LangSuggest } from '@/components/LangSuggest';
import { busyText, downNotice, loadBanner } from '@/lib/announce';
import type { InviteState } from '@/lib/invites';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => '/login' }));
vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode }) => createElement('a', { href: p.href }, p.children) }));

const html = (lang: Lang, el: React.ReactElement) => renderToStaticMarkup(createElement(I18nProvider, { lang, children: el }));
beforeEach(() => { document.cookie = 'kx_lang=; path=/; max-age=0'; localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('страницы до входа на трёх языках', () => {
  it('вход: заголовок, поля и кнопка', () => {
    expect(html('ru', createElement(LoginForm, { signupOpen: false, firstUser: false }))).toContain('Вход в Korvex AI');
    const en = html('en', createElement(LoginForm, { signupOpen: false, firstUser: false }));
    expect(en).toContain('Sign in to Korvex AI'); expect(en).toContain('Ask the administrator to invite you'); expect(en).toContain('>Sign in<');
    const sr = html('sr', createElement(LoginForm, { signupOpen: true, firstUser: false }));
    expect(sr).toContain('Prijava u Korvex AI'); expect(sr).toContain('Registrujte se'); expect(sr).toContain('Lozinka'); expect(sr.replaceAll('Русский', '')).not.toMatch(/[А-Яа-я]/);
  });
  it('приглашение: подача, форма и все четыре причины «ссылка не работает» — по-русски, по-английски, по-сербски', () => {
    const f = (lang: Lang, state: InviteState) => html(lang, createElement(InviteForm, { token: 'tok-tok-tok-tok', state }));
    expect(f('sr', 'ok')).toContain('Pozivnica za Korvex AI');
    expect(f('sr', 'ok')).toContain('AI sa memorijom za duge dokumente');
    expect(f('sr', 'ok')).toContain('Napravi nalog');
    expect(f('en', 'ok')).toContain('AI with memory for long documents');
    expect(f('ru', 'ok')).toContain('ИИ с памятью на длинные документы');
    expect(f('sr', 'ok')).not.toContain('inv-feats');
    const want: Record<Exclude<InviteState, 'ok'>, [string, string, string]> = {
      unknown: ['Ссылка недействительна', 'This link isn’t valid', 'Link nije važeći'],
      expired: ['Срок ссылки истёк', 'This link has expired', 'Link je istekao'],
      used_up: ['Все места по ссылке заняты', 'All places on this link are taken', 'Sva mesta na ovom linku su zauzeta'],
      revoked: ['Ссылка отозвана', 'This link was revoked', 'Link je povučen'],
    };
    for (const [state, [ru, en, sr]] of Object.entries(want) as [Exclude<InviteState, 'ok'>, [string, string, string]][]) {
      expect(f('ru', state), state).toContain(ru);
      expect(f('en', state), state).toContain(en);
      expect(f('sr', state), state).toContain(sr);
      expect(f('sr', state), state).toContain('data-testid="invite-' + state + '"');
    }
  });
  it('без провайдера (прежние тесты и страницы) — русский', () => {
    expect(renderToStaticMarkup(createElement(QueueCard, { ahead: 2, eta: 40 }))).toContain('Вы в очереди — 3-й');
  });
});

describe('карточка очереди и баннеры', () => {
  it('очередь: три языка, порядковые и ожидание', () => {
    expect(html('en', createElement(QueueCard, { ahead: 2, eta: 40 }))).toContain('You’re in the queue — 3rd');
    expect(html('en', createElement(QueueCard, { ahead: 2, eta: 40 }))).toContain('~40 s');
    expect(html('sr', createElement(QueueCard, { ahead: 2, eta: 40 }))).toContain('Vi ste u redu — 3. mesto');
    expect(html('sr', createElement(QueueCard, { ahead: 0 }))).toContain('Vi ste sledeći');
    expect(html('ru', createElement(QueueCard, { ahead: 0 }))).toContain('Вы следующий');
  });
  it('баннер высокой нагрузки, «модель недоступна», «идёт обучение» — на языке человека', () => {
    expect(busyText(90, 'ru')).toBe('Сейчас высокая нагрузка — ответы могут задерживаться (~2 мин). Сообщения обрабатываются по очереди, место в очереди видно в чате.');
    expect(busyText(90, 'en')).toContain('Heavy load right now — answers may be delayed (~2 min).');
    expect(busyText(10, 'sr')).toBe('Trenutno je veliko opterećenje — odgovori mogu kasniti. Poruke se obrađuju redom, a mesto u redu vidi se u čatu.');
    const alpha = { id: 'alpha', name: 'Alpha' }, beta = { id: 'beta', name: 'Beta' };
    const now = Date.UTC(2026, 10, 9, 12, 0);
    expect(downNotice(alpha, null, beta, 'UTC', now, 'ru')).toBe('Alpha временно недоступна. Попробуйте Beta.');
    expect(downNotice(alpha, null, beta, 'UTC', now, 'en')).toBe('Alpha is temporarily unavailable. Try Beta.');
    expect(downNotice(alpha, now + 3_600_000, null, 'UTC', now, 'sr')).toMatch(/^Alpha je privremeno nedostupan do ~\d\d:\d\d\. Pokušajte malo kasnije\.$/);
    const load = { '*': { state: 'training' as const, until: null, rev: 1, at: now } };
    expect(loadBanner([alpha, beta], load, {}, 'UTC', now, 'ru')!.text).toBe('Идёт дообучение моделей — ответы могут приходить медленнее');
    expect(loadBanner([alpha, beta], load, {}, 'UTC', now, 'en')!.text).toBe('The models are being fine-tuned — answers may be slower');
    const down = { '*': { state: 'down' as const, until: null, rev: 2, at: now } };
    expect(loadBanner([alpha], down, {}, 'UTC', now, 'sr')!.text).toContain('je privremeno nedostupan (obuka)');
    expect(loadBanner([alpha, beta], down, {}, 'UTC', now, 'sr')!.text).toContain('su privremeno nedostupni (obuka)');
  });
});

describe('выбор языка', () => {
  it('переключатель: три языка, текущий отмечен; выбор пишет cookie и localStorage', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, reload }, writable: true });
    render(createElement(I18nProvider, { lang: 'en', children: createElement(LangSwitch) }));
    expect(screen.getByTestId('lang-en').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('lang-sr').textContent).toBe('SR');
    expect(screen.getByTestId('lang-sr').getAttribute('aria-label')).toBe('Srpski');
    await act(async () => { fireEvent.click(screen.getByTestId('lang-sr')); });
    expect(document.cookie).toContain('kx_lang=sr');
    expect(localStorage.getItem('kx.lang')).toBe('sr');
    expect(reload).toHaveBeenCalled();
  });
  it('вопрос «переключить?»: язык устройства другой — карточка на языке устройства; «Нет» запоминается и больше не спрашивает', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'languages', { value: ['sr-RS', 'sr', 'en'], configurable: true });
    const view = render(createElement(I18nProvider, { lang: 'ru', children: createElement(LangSuggest) }));
    await act(async () => { vi.advanceTimersByTime(2500); });
    expect(screen.getByTestId('lang-suggest').textContent).toContain('Vaš telefon je na srpskom — prebaciti Korvex na srpski?');
    expect(screen.getByTestId('lang-suggest-yes').textContent).toBe('Prebaci');
    await act(async () => { fireEvent.click(screen.getByTestId('lang-suggest-no')); });
    expect(screen.queryByTestId('lang-suggest')).toBeNull();
    expect(localStorage.getItem('kx.langAsk')).toBe('sr');
    view.unmount();
    render(createElement(I18nProvider, { lang: 'ru', children: createElement(LangSuggest) }));
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByTestId('lang-suggest')).toBeNull();
    vi.useRealTimers();
  });
  it('язык устройства совпал с языком Korvex или не поддерживается — не спрашиваем', async () => {
    vi.useFakeTimers();
    for (const [dev, cur] of [[['ru-RU'], 'ru'], [['de-DE', 'en'], 'ru'], [['uk-UA'], 'en']] as [string[], Lang][]) {
      Object.defineProperty(navigator, 'languages', { value: dev, configurable: true });
      const v = render(createElement(I18nProvider, { lang: cur, children: createElement(LangSuggest) }));
      await act(async () => { vi.advanceTimersByTime(5000); });
      expect(screen.queryByTestId('lang-suggest'), dev.join()).toBeNull();
      v.unmount();
    }
    vi.useRealTimers();
  });
});
