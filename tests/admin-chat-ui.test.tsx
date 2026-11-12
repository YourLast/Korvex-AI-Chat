import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AdminChat } from '@/components/AdminChat';
import { ShellCtx } from '@/components/Shell';
import type { AdminChatData, Mark } from '@/lib/adminTypes';
import type { MsgView } from '@/lib/types';
import type { PublicModel } from '@/lib/models';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/admin/chat/t1' }));

const models = [{ id: 'alpha', name: 'Alpha', fullName: 'Alpha', defaultLevel: 'low', levels: [{ id: 'low', label: 'low' }] }] as unknown as PublicModel[];
const T0 = 1_760_000_000_000;
const mk = (id: string, messageId: string, value: 1 | -1, onPath: boolean, reasons: string[] = [], comment = ''): Mark => ({ id, messageId, value, reasons, comment, at: T0 + 500, onPath, model: 'alpha' });
const user = (id: string, content: string): MsgView => ({ id, role: 'user', content });
const ans = (id: string, content: string, rating?: MsgView['rating']): MsgView => ({ id, role: 'assistant', content, meta: { modelId: 'alpha', levelId: 'low' }, rating: rating ?? null });

const data = (over: Partial<AdminChatData> = {}): AdminChatData => ({
  thread: { id: 't1', title: 'Отчёт по скважинам', modelId: 'alpha', effort: 'low', createdAt: T0, updatedAt: T0, temporary: false, compareGroup: false, folder: null },
  owner: { id: 'u', name: 'Анна Тестова', email: 'anna@test.local' },
  messages: [
    user('u1', 'Сделай сводку'), ans('a1', 'Первая сводка', { value: -1, reasons: ['wrong'], comment: 'Цифра не та' }),
    user('u2', 'А за август?'), ans('a2', 'Август: 1188 т', { value: 1, reasons: [], comment: '' }),
    user('u3', 'Выводы?'), ans('a3', 'Выводы: падает', { value: -1, reasons: ['incomplete', 'format'], comment: 'Нет таблицы' }),
  ],
  times: { u1: T0, a1: T0 + 1000, u2: T0 + 2000, a2: T0 + 3000, u3: T0 + 90_000_000, a3: T0 + 90_001_000 },
  marks: [mk('r1', 'a1', -1, true, ['wrong'], 'Цифра не та'), mk('r2', 'a2', 1, true), mk('r3', 'a3', -1, true, ['incomplete', 'format'], 'Нет таблицы'), mk('r1b', 'a1b', -1, false)],
  compare: null, fileNames: [], otherBranch: false, ...over,
});
const html = (d: AdminChatData, focus: string | null = null) => renderToStaticMarkup(createElement(ShellCtx.Provider,
  { value: { models, refresh: async () => {}, openDrawer: () => {}, threads: [], role: 'admin' } }, createElement(AdminChat, { data: d, tz: 'Europe/Moscow', focus })));
const count = (h: string, s: string) => h.split(s).length - 1;

describe('просмотр чата администратором', () => {
  it('вся переписка тем же видом: вопросы и ответы, имя человека и «только чтение»', () => {
    const h = html(data());
    for (const t of ['Сделай сводку', 'Первая сводка', 'А за август?', 'Август: 1188 т', 'Выводы: падает']) expect(h).toContain(t);
    expect(h).toContain('Анна Тестова');
    expect(h).toContain('только чтение');
    expect(h).toContain('/admin/users/u');
  });

  it('никаких действий от имени человека: нет оценки, повтора, продолжения, правки и поля ввода', () => {
    const h = html(data());
    for (const bad of ['rate-up', 'rate-down', 'data-testid="regen"', 'data-testid="continue"', 'data-testid="edit"', 'edit-input', 'composer', 'data-testid="pair-vote"']) expect(h).not.toContain(bad);
  });

  it('отметки у ответов: знак, причины, комментарий и «оценка N из M»; полоса слева у оценённых ответов', () => {
    const h = html(data());
    expect(count(h, 'data-testid="admin-mark"')).toBe(3);
    expect(count(h, 'data-rated="down"')).toBe(2);
    expect(count(h, 'data-rated="up"')).toBe(1);
    expect(h).toContain('оценка 1 из 3');
    expect(h).toContain('оценка 3 из 3');
    expect(h).toContain('Цифра не та');
    expect(h).toContain('Нет таблицы');
    expect(h).toContain('неверно');
    expect(h).toContain('не доделал');
    expect(h).toContain('формат');
  });

  it('карта оценок: метка на каждую оценку ветки, 👎 и 👍 разными классами, в порядке чата', () => {
    const h = html(data());
    expect(h).toContain('data-testid="rating-rail"');
    expect(count(h, 'data-testid="rail-tick"')).toBe(3);
    expect(count(h, 'adm-tick--down')).toBe(2);
    expect(count(h, 'adm-tick--up')).toBe(1);
    const ids = [...h.matchAll(/data-testid="rail-tick" data-mark="(r\d)"/g)].map((m) => m[1]);
    expect(ids).toEqual(['r1', 'r2', 'r3']);
    const pos = [...h.matchAll(/--p:([\d.]+)/g)].map((m) => Number(m[1]));
    expect(pos).toHaveLength(3);
    expect(pos[0]).toBeLessThan(pos[1]); expect(pos[1]).toBeLessThan(pos[2]);
  });

  it('шапка: счётчики 👎 и 👍 по чату (с учётом других версий), кнопки «Пред.» и «След.», фильтр', () => {
    const h = html(data());
    expect(h).toMatch(/data-testid="sum-down">3</);
    expect(h).toMatch(/data-testid="sum-up">1</);
    expect(h).toContain('data-testid="mark-prev"');
    expect(h).toContain('data-testid="mark-next"');
    expect(h).toContain('1 из 3');
    for (const f of ['mf-all', 'mf-down', 'mf-up']) expect(h).toContain(`data-testid="${f}"`);
    expect(h).not.toContain('disabled=""><svg');
  });

  it('оценка на другой версии ответа: отдельная строка со ссылкой на нужную ветку', () => {
    const h = html(data());
    expect(h).toContain('data-testid="other-marks"');
    expect(h).toContain('/admin/chat/t1?m=a1b');
    expect(html(data({ marks: data().marks.filter((m) => m.onPath) }))).not.toContain('other-marks');
  });

  it('открыта не активная ветка — об этом сказано и есть ссылка на активную', () => {
    const h = html(data({ otherBranch: true }));
    expect(h).toContain('data-testid="other-branch"');
    expect(h).toContain('Показать активную');
    expect(html(data())).not.toContain('other-branch');
  });

  it('чат без оценок: карты и кнопок нет, сказано прямо', () => {
    const d = data({ marks: [], messages: data().messages.map((m) => ({ ...m, rating: null })) });
    const h = html(d);
    expect(h).toContain('В этом чате оценок нет');
    expect(h).not.toContain('rating-rail');
    expect(h).not.toContain('mark-next');
    expect(count(h, 'data-testid="admin-mark"')).toBe(0);
  });

  it('смена дня в чате отмечена разделителем с датой', () => {
    expect(count(html(data()), 'data-testid="day-sep"')).toBe(2);
  });

  it('пара сравнения: два ответа без голосования и выбора; голос человека — строкой; у каждого ответа своя отметка', () => {
    const q: MsgView = { ...user('qp', 'Сравни'), pair: { a: 'pa', b: 'pb', pick: null, vote: 'b' } };
    const pa = { ...ans('pa', 'Ответ дорожки A', { value: -1, reasons: [], comment: '' }), meta: { modelId: 'alpha', levelId: 'low', lane: 'a' as const } };
    const pb = { ...ans('pb', 'Ответ дорожки B', { value: 1, reasons: [], comment: '' }), meta: { modelId: 'alpha', levelId: 'low', lane: 'b' as const } };
    const d = data({ messages: [q, pa, pb], marks: [mk('p1', 'pa', -1, true), mk('p2', 'pb', 1, true)], times: {} });
    const h = html(d);
    expect(h).toContain('Ответ дорожки A');
    expect(h).toContain('Ответ дорожки B');
    expect(h).toContain('data-testid="pair-vote-ro"');
    expect(h).not.toContain('data-testid="pair-vote"');
    expect(h).not.toContain('data-testid="pick-a"');
    expect(count(h, 'data-testid="admin-mark"')).toBe(2);
  });
});
