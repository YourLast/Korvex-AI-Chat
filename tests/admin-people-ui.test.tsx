import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AdminPeople, matchPerson, statsLine } from '@/components/AdminPeople';
import { AdminUser } from '@/components/AdminUser';
import { RateCounts } from '@/components/AdminBits';
import type { PersonRow } from '@/lib/adminTypes';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/admin' }));
vi.mock('@/components/Shell', () => ({ Topbar: () => null, useShell: () => ({ openDrawer: () => {} }) }));

const T0 = 1_760_000_000_000;
const p = (o: Partial<PersonRow>): PersonRow => ({ id: 'u1', email: 'anna@test.local', name: 'Анна Тестова', role: 'user', disabled: false, createdAt: T0, chats: 12, messages: 340, files: 5, up: 4, down: 3, lastAt: T0, blockKind: '', blockReason: '', blockedAt: null, source: { key: 'none', kind: 'none', label: 'без ссылки' }, ...o });
const users = [p({}), p({ id: 'u2', email: 'boris@test.local', name: 'Борис Тестов', chats: 1, messages: 2, files: 0, up: 0, down: 0, lastAt: null, disabled: true })];

describe('список людей', () => {
  it('строка человека: имя, почта, роль, числа, оценки, ссылка в карточку и шестерёнка', () => {
    const h = renderToStaticMarkup(createElement(AdminPeople, { users, meId: 'me', tz: 'Europe/Moscow', onSettings: () => {} }));
    expect(h).toContain('href="/admin/users/u1"');
    expect(h).toContain('href="/admin/users/u2"');
    expect(h).toContain('12 чатов · 340 сообщений · 5 файлов');
    expect(h).toContain('1 чат · 2 сообщения');
    expect(h).toContain('доступ забран');
    expect(h).toContain('ещё ничего не писал(а)');
    expect(h).toContain('data-testid="people-search"');
    expect(h).toContain('Роль и доступ: Анна Тестова');
    expect(h).toContain('С плохими оценками · 1');
    expect(h).toMatch(/data-testid="rate-counts"/);
  });
  it('поиск по имени и почте без учёта регистра; числа — с правильными окончаниями', () => {
    expect(matchPerson(users[0], 'АННА')).toBe(true);
    expect(matchPerson(users[0], 'test.local')).toBe(true);
    expect(matchPerson(users[0], 'борис')).toBe(false);
    expect(matchPerson(users[0], '  ')).toBe(true);
    expect(statsLine({ chats: 21, messages: 22, files: 0 })).toBe('21 чат · 22 сообщения');
  });
  it('числа оценок: нулевые не показываются', () => {
    expect(renderToStaticMarkup(createElement(RateCounts, { up: 0, down: 0 }))).toBe('');
    const h = renderToStaticMarkup(createElement(RateCounts, { up: 0, down: 2 }));
    expect(h).toContain('adm-rate--down');
    expect(h).not.toContain('adm-rate--up');
  });
});

describe('карточка человека', () => {
  it('три раздела, числа и пометка «только чтение»; первая страница чатов с сервера', () => {
    const chats = [{ id: 't1', title: 'Отчёт по складу', modelId: 'alpha', createdAt: T0, updatedAt: T0, messages: 7, up: 1, down: 3, folder: null, compare: false, temporary: false }];
    const h = renderToStaticMarkup(createElement(AdminUser, { person: users[0], models: [{ id: 'alpha', name: 'Alpha', levels: [] }], tz: 'Europe/Moscow', initial: { rows: chats, total: 1 }, isMe: false, meId: 'me' }));
    for (const t of ['ut-chats', 'ut-files', 'ut-ratings']) expect(h).toContain(`data-testid="${t}"`);
    expect(h).toContain('только чтение'); expect(h).toContain('data-testid="user-moderation"');
    expect(h).toContain('href="/admin/chat/t1"');
    expect(h).toContain('Отчёт по складу');
    expect(h).toContain('Alpha · 7 сообщений');
  });
});
