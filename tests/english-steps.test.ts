import { describe, expect, it } from 'vitest';
import steps from '@/lib/i18n/dict/steps';
import { tr } from '@/lib/i18n/core';
import { pastTitle } from '@/lib/work';
import { chatsWord, qt } from '@/lib/tools/say';

describe('подписи шагов', () => {
  it('en и sr — без кириллицы', () => {
    for (const [k, [, en, sr]] of Object.entries(steps)) {
      expect(en, k).not.toMatch(/[А-Яа-яЁё]/);
      expect(sr, k).not.toMatch(/[А-Яа-яЁё]/);
    }
  });
  it('готовый шаг — прошедшее время на языке человека', () => {
    expect(pastTitle(tr('en', 'step.web', { q: qt('gold price', 'en') }), 'en')).toBe('Searched the web: “gold price”');
    expect(pastTitle(tr('sr', 'step.web', { q: qt('cena zlata', 'sr') }), 'sr')).toBe('Tražio na internetu: „cena zlata“');
    expect(pastTitle(tr('ru', 'step.web', { q: qt('цена золота', 'ru') }), 'ru')).toBe('Искал в интернете: «цена золота»');
    expect(pastTitle(tr('en', 'step.chatRead', { q: qt('Emails', 'en') }), 'en')).toBe('Read chat “Emails”');
    expect(pastTitle(tr('en', 'step.memSave', { text: 'likes jazz' }), 'en')).toBe('Remembered: likes jazz');
    expect(pastTitle(tr('en', 'step.fileTake', { q: qt('a.pdf', 'en') }), 'en')).toBe('Took file “a.pdf”');
  });
  it('«чат» по числу', () => {
    expect([1, 2, 5, 21].map((n) => chatsWord('ru', n))).toEqual(['чат', 'чата', 'чатов', 'чат']);
    expect([1, 3].map((n) => chatsWord('en', n))).toEqual(['chat', 'chats']);
  });
});
