// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';

vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: unknown }) => createElement('a', { href, ...p }, children as never) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => '/' }));
afterEach(cleanup);

describe('«Запомнил: …» под ответом', () => {
  it('текст: что запомнено, со строчной, до ~40 знаков; забыто; личное', async () => {
    const { memUpdText } = await import('@/components/Message');
    expect(memUpdText([{ op: 'add', text: 'Зовут Иван' }, { op: 'add', text: 'Технический директор' }, { op: 'add', text: 'Обращаться на «ты»' }])).toBe('Запомнил: зовут Иван, технический…');
    expect(memUpdText([{ op: 'delete', text: 'Работает в «Ромашке»' }])).toBe('Забыл: работает в «Ромашке»');
    expect(memUpdText([{ op: 'add', text: '' }])).toBe('Запомнил: личное');
    expect(memUpdText([{ op: 'update', text: 'Python и PostgreSQL' }])).toBe('Запомнил: Python и PostgreSQL');
    expect(memUpdText([{ op: 'add', text: 'Зовут Иван' }, { op: 'delete', text: 'Работает в «Ромашке»' }])).toBe('Запомнил: зовут Иван; забыл: работает в…');
    for (const s of [memUpdText([{ op: 'add', text: 'А'.repeat(200) }])]) expect(s.length).toBeLessThanOrEqual(44);
  });
});
