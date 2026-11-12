import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AssistantMsg } from '@/components/Message';
import { ShellCtx } from '@/components/Shell';
import type { MsgView } from '@/lib/types';
import type { PublicModel } from '@/lib/models';

const models = [{ id: 'beta', name: 'Beta', fullName: 'Beta 0 4B', defaultLevel: 'off', levels: [{ id: 'off', label: 'off' }] }] as unknown as PublicModel[];
const msg = (meta: MsgView['meta'], content = ''): MsgView => ({ id: 'm1', role: 'assistant', content, meta: { modelId: 'beta', levelId: 'off', status: 'error', ...meta } });
const user = (m: MsgView) => renderToStaticMarkup(createElement(AssistantMsg, { m, models }));
const admin = (m: MsgView) => renderToStaticMarkup(createElement(ShellCtx.Provider, { value: { models, refresh: async () => {}, openDrawer: () => {}, threads: [], role: 'admin' } }, createElement(AssistantMsg, { m, models })));

const raw = 'Cannot connect to API: connect ECONNREFUSED 127.0.0.1:8099';
const friendly = 'Beta временно недоступна, попробуйте Alpha.';

describe('ошибка под ответом', () => {
  it('пользователь видит только фразу, без технических подробностей', () => {
    const h = user(msg({ error: raw, errorUser: friendly }));
    expect(h).toContain(friendly);
    expect(h).not.toContain('ECONNREFUSED');
    expect(h).not.toContain('err-tech');
  });
  it('администратор видит фразу и причину отдельной строкой', () => {
    const h = admin(msg({ error: raw, errorUser: friendly }));
    expect(h).toContain(friendly);
    expect(h).toContain('err-tech');
    expect(h).toContain('ECONNREFUSED');
  });
  it('обрыв посреди ответа: текст ответа остаётся, ниже пометка', () => {
    const h = user(msg({ error: 'terminated', errorUser: 'Ответ оборвался: Beta перестала отвечать. Показано то, что успело прийти.' }, 'Начало ответа'));
    expect(h).toContain('Начало ответа');
    expect(h).toContain('Ответ оборвался');
  });
  it('прочие ошибки — как раньше: пользователю общая фраза для сырых ответов, администратору — как есть', () => {
    expect(user(msg({ error: '502: upstream down' }))).toContain('Модель не ответила. Попробуйте ещё раз чуть позже.');
    expect(admin(msg({ error: '502: upstream down' }))).toContain('502: upstream down');
    expect(user(msg({ error: 'Лимит памяти чата исчерпан' }))).toContain('Лимит памяти чата исчерпан');
  });
});
