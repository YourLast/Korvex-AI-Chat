import { describe, expect, it } from 'vitest';
import type { Message } from '@/lib/db/schema';
import { activePath, deepestLatest, sessionOfPath, siblingsOf } from '@/lib/tree';

const m = (id: string, parentId: string | null, role: 'user' | 'assistant', seq: number, session: string | null = null): Message =>
  ({ id, threadId: 't', seq, parentId, session, role, content: id, reasoning: null, reasoningMs: null, meta: null, createdAt: seq });

const all = [m('u1', null, 'user', 1, 't'), m('a1', 'u1', 'assistant', 2), m('a1b', 'u1', 'assistant', 3), m('u2', null, 'user', 4, 't:f1'), m('a2', 'u2', 'assistant', 5)];

describe('дерево сообщений', () => {
  it('активная ветка — от листа к корню', () => {
    expect(activePath(all, 'a1b').map((x) => x.id)).toEqual(['u1', 'a1b']);
    expect(activePath(all, 'a2').map((x) => x.id)).toEqual(['u2', 'a2']);
    expect(activePath(all, null)).toEqual([]);
  });
  it('версии: те же роль и родитель, по порядку создания', () => {
    expect(siblingsOf(all, all[1]).map((x) => x.id)).toEqual(['a1', 'a1b']);
    expect(siblingsOf(all, all[0]).map((x) => x.id)).toEqual(['u1', 'u2']);
  });
  it('переключение версии открывает самую свежую ветку под узлом', () => {
    expect(deepestLatest(all, 'u1')).toBe('a1b');
    expect(deepestLatest(all, 'u2')).toBe('a2');
    expect(deepestLatest(all, 'a1')).toBe('a1');
  });
  it('сессия серва: у правки своя, дальше наследуется', () => {
    expect(sessionOfPath(activePath(all, 'a1b'), 't')).toBe('t');
    expect(sessionOfPath(activePath(all, 'a2'), 't')).toBe('t:f1');
    expect(sessionOfPath([], 'tt')).toBe('tt');
  });
  it('цикл в данных не зацикливает путь', () => {
    const bad = [m('x', 'y', 'user', 1), m('y', 'x', 'assistant', 2)];
    expect(activePath(bad, 'x').length).toBeLessThanOrEqual(2);
  });
});
