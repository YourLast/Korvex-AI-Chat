// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, act, within } from '@testing-library/react';
import { AdminPeople, sourcesOf } from '@/components/AdminPeople';
import { UserModeration } from '@/components/UserModeration';
import type { PersonRow } from '@/lib/adminTypes';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => '/admin' }));
vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode; className?: string; 'data-testid'?: string }) => createElement('a', { href: p.href, className: p.className, 'data-testid': p['data-testid'] }, p.children) }));

const calls: { url: string; body: Record<string, unknown> }[] = [];
let reply: { status: number; json: unknown } = { status: 200, json: { ok: true } };
beforeEach(() => {
  calls.length = 0; reply = { status: 200, json: { ok: true } };
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) }); return { ok: reply.status < 400, status: reply.status, json: async () => reply.json } as Response; }));
  window.history.replaceState(null, '', '/admin');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const T0 = 1_760_000_000_000;
const SRC = { cls: { key: 'inv:i1', kind: 'invite', label: 'Класс (Сербия)', inviteId: 'i1' }, tt: { key: 'inv:i2', kind: 'invite', label: 'Пост TT', inviteId: 'i2' }, adm: { key: 'admin', kind: 'admin', label: 'создан админом' }, none: { key: 'none', kind: 'none', label: 'без ссылки' } } as const;
const p = (o: Partial<PersonRow>): PersonRow => ({ id: 'u1', email: 'anna@t.rs', name: 'Анна Орлова', role: 'user', disabled: false, createdAt: T0, chats: 1, messages: 2, files: 0, up: 0, down: 0, lastAt: T0, blockKind: '', blockReason: '', blockedAt: null, source: SRC.cls, ...o });
const users = [
  p({}), p({ id: 'u2', email: 'boris@t.rs', name: 'Борис Зайцев', disabled: true, blockKind: 'ban', blockReason: 'спам', blockedAt: T0 }),
  p({ id: 'u3', email: 'vera@t.rs', name: 'Вера Седова', source: SRC.tt }), p({ id: 'u4', email: 'gleb@t.rs', name: 'Глеб', source: SRC.adm, disabled: true, blockKind: 'pause' }),
  p({ id: 'u5', email: 'dasha@t.rs', name: 'Дарья', source: SRC.none, role: 'admin' }),
];
const people = () => render(createElement(AdminPeople, { users, meId: 'u5', tz: 'Europe/Moscow', onSettings: () => {} }));
const rowsOf = () => screen.getAllByTestId(/^user-[a-z]+@t\.rs$/).map((e) => e.getAttribute('data-testid')!.slice(5));

describe('список людей: источники', () => {
  it('значок «откуда» у каждого; у закрытых — «заблокирован» / «доступ забран»', () => {
    people();
    expect(screen.getAllByTestId('user-source').map((e) => e.textContent)).toEqual(['Класс (Сербия)', 'Класс (Сербия)', 'Пост TT', 'создан админом', 'без ссылки']);
    expect(screen.getAllByTestId('user-block').map((e) => e.textContent)).toEqual(['заблокирован', 'доступ забран']);
  });
  it('источники и числа: ссылки по названию, «создан админом», «без ссылки»; в списке выбора — сколько заблокировано', () => {
    expect(sourcesOf(users).map((s) => [s.label, s.n, s.blocked])).toEqual([['Класс (Сербия)', 2, 1], ['Пост TT', 1, 0], ['создан админом', 1, 1], ['без ссылки', 1, 0]]);
    people();
    const opts = [...(screen.getByTestId('people-source') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(opts).toEqual(['Все · 5', 'Класс (Сербия) · 2 (заблокировано 1)', 'Пост TT · 1', 'создан админом · 1 (заблокировано 1)', 'без ссылки · 1']);
  });
  it('фильтр по источнику; «Закрыт доступ»; счётчик «N из M»', () => {
    people();
    fireEvent.change(screen.getByTestId('people-source'), { target: { value: 'inv:i1' } });
    expect(rowsOf().sort()).toEqual(['anna@t.rs', 'boris@t.rs']);
    expect(screen.getByTestId('users-table').textContent).toContain('2 из 5');
    fireEvent.change(screen.getByTestId('people-source'), { target: { value: 'all' } });
    fireEvent.click(screen.getByTestId('people-blocked'));
    expect(rowsOf().sort()).toEqual(['boris@t.rs', 'gleb@t.rs']);
  });
  it('группировка по источникам: заголовки с числами и заблокированными', () => {
    people();
    fireEvent.click(screen.getByTestId('people-by-source'));
    const heads = [...document.querySelectorAll('.adm-ghead')].map((e) => e.textContent);
    expect(heads).toEqual(['Класс (Сербия)2 · заблокировано 1', 'Пост TT1', 'создан админом1 · заблокировано 1', 'без ссылки1']);
  });
  it('ссылка /admin?src=inv:i2 открывает список уже с фильтром', () => {
    window.history.replaceState(null, '', '/admin?src=inv:i2');
    people();
    expect(rowsOf()).toEqual(['vera@t.rs']);
    expect((screen.getByTestId('people-source') as HTMLSelectElement).value).toBe('inv:i2');
  });
});

describe('окна действий с человеком', () => {
  const view = (o: Partial<PersonRow> = {}, meId = 'adm') => { const changed = vi.fn(); render(createElement(UserModeration, { user: p(o), meId, tz: 'UTC', onChanged: changed })); return changed; };
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

  it('«Заблокировать»: окно с последствиями и необязательной причиной, отправка с причиной', async () => {
    const changed = view();
    fireEvent.click(screen.getByTestId('mod-ban'));
    const sheet = screen.getByTestId('mod-sheet-ban');
    expect(sheet.textContent).toContain('сразу закрываются все его сессии'); expect(sheet.textContent).toContain('идущие ответы останавливаются');
    fireEvent.change(screen.getByTestId('mod-reason'), { target: { value: ' спам ' } });
    fireEvent.click(screen.getByTestId('mod-submit')); await flush();
    expect(calls).toEqual([{ url: '/api/admin/users/u1/moderate', body: { action: 'ban', reason: 'спам' } }]);
    expect(changed).toHaveBeenCalled();
  });
  it('«Забрать доступ»: без причины можно; тот же путь с action=pause', async () => {
    view();
    fireEvent.click(screen.getByTestId('mod-pause'));
    expect(screen.getByTestId('mod-sheet-pause').textContent).toContain('Временная мера');
    fireEvent.click(screen.getByTestId('mod-submit')); await flush();
    expect(calls[0].body).toEqual({ action: 'pause' });
  });
  it('«Удалить аккаунт»: кнопка неактивна, пока не введено имя (регистр не важен); почта тоже подходит', async () => {
    const changed = view();
    fireEvent.click(screen.getByTestId('mod-delete'));
    const ok = screen.getByTestId('mod-submit') as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('mod-confirm-name'), { target: { value: 'анна' } });
    expect(ok.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('mod-confirm-name'), { target: { value: 'анна ОРЛОВА' } });
    expect(ok.disabled).toBe(false);
    fireEvent.click(ok); await flush();
    expect(calls[0].body).toMatchObject({ action: 'delete', confirm: 'анна ОРЛОВА' });
    expect(changed).toHaveBeenCalled();
  });
  it('ошибка сервера — показана в окне, окно не закрывается, список не обновляется', async () => {
    reply = { status: 409, json: { error: 'Должен остаться хотя бы один действующий администратор' } };
    const changed = view({ role: 'admin' });
    fireEvent.click(screen.getByTestId('mod-ban')); fireEvent.click(screen.getByTestId('mod-submit')); await flush();
    expect(screen.getByTestId('mod-error').textContent).toContain('хотя бы один действующий администратор');
    expect(changed).not.toHaveBeenCalled();
  });
  it('заблокированный: статус с причиной, «Разблокировать» (у паузы — «Вернуть доступ»); блокировать повторно нельзя', async () => {
    view({ disabled: true, blockKind: 'ban', blockReason: 'спам', blockedAt: T0 });
    expect(screen.getByTestId('mod-status').textContent).toContain('Заблокирован'); expect(screen.getByTestId('mod-status').textContent).toContain('спам');
    expect(screen.queryByTestId('mod-ban')).toBeNull();
    expect(screen.getByTestId('mod-unblock').textContent).toContain('Разблокировать');
    fireEvent.click(screen.getByTestId('mod-unblock')); fireEvent.click(screen.getByTestId('mod-submit')); await flush();
    expect(calls[0].body).toEqual({ action: 'unblock' });
    cleanup();
    view({ disabled: true, blockKind: 'pause' });
    expect(screen.getByTestId('mod-status').textContent).toContain('Доступ забран'); expect(screen.getByTestId('mod-unblock').textContent).toContain('Вернуть доступ');
  });
  it('свой аккаунт: все действия неактивны, объяснено почему', () => {
    view({ id: 'adm' }, 'adm');
    for (const id of ['mod-ban', 'mod-pause', 'mod-delete']) expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('user-moderation').textContent).toContain('Свой аккаунт заблокировать или удалить нельзя');
  });
});
void within;
