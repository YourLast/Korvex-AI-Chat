import { describe, expect, it } from 'vitest';
import { asLang, cookieValue, detectLang, fmtNum, fromAcceptLanguage, langOfTag, pickLang, pluralIndex, suggestLang, tr } from '@/lib/i18n/core';
import { PARTS } from '@/lib/i18n/dict';
import { errText } from '@/lib/i18n/errors';
import { ordinal, fmtEta } from '@/lib/queueEta';
import { fmtBytes, fmtSec, fmtWhen } from '@/lib/format';

describe('язык по умолчанию — по языку устройства', () => {
  it('сербский: sr, hr, bs, me (и sr-Cyrl тоже — латиницей)', () => {
    for (const t of ['sr', 'sr-RS', 'sr-Latn-RS', 'sr-Cyrl-RS', 'sr-Cyrl', 'hr', 'hr-HR', 'bs', 'bs-BA', 'me', 'cnr-ME', 'sh']) expect(langOfTag(t), t).toBe('sr');
  });
  it('русский: ru, uk, be, kk', () => {
    for (const t of ['ru', 'ru-RU', 'uk', 'uk-UA', 'be', 'be-BY', 'kk', 'kk-KZ']) expect(langOfTag(t), t).toBe('ru');
  });
  it('английский и всё остальное -> English', () => {
    expect(langOfTag('en-US')).toBe('en');
    expect(detectLang(['de-DE', 'de'])).toBe('en');
    expect(detectLang(['ja'])).toBe('en');
    expect(detectLang([])).toBe('en');
    expect(detectLang(null)).toBe('en');
    expect(detectLang(['fr-FR', 'sr-RS'])).toBe('sr');
    expect(detectLang(['uk-UA', 'en'])).toBe('ru');
    expect(detectLang(['sr-Cyrl-RS'])).toBe('sr');
  });
  it('Accept-Language: порядок по q, неузнанное пропускается', () => {
    expect(fromAcceptLanguage('sr-RS,sr;q=0.9,en;q=0.8')).toBe('sr');
    expect(fromAcceptLanguage('hr-HR,hr;q=0.9,en-US;q=0.8')).toBe('sr');
    expect(fromAcceptLanguage('ru-RU,ru;q=0.9,en;q=0.5')).toBe('ru');
    expect(fromAcceptLanguage('de-DE,de;q=0.9,en;q=0.5')).toBe('en');
    expect(fromAcceptLanguage('en;q=0.3,sr;q=0.9')).toBe('sr');
    expect(fromAcceptLanguage('de')).toBe('en');
    expect(fromAcceptLanguage('')).toBe('en');
    expect(fromAcceptLanguage(null)).toBe('en');
    expect(fromAcceptLanguage('*')).toBe('en');
  });
  it('приоритет: сохранённый у человека -> cookie -> устройство', () => {
    expect(pickLang({ user: 'sr', cookie: 'ru', accept: 'en' })).toBe('sr');
    expect(pickLang({ user: '', cookie: 'ru', accept: 'en' })).toBe('ru');
    expect(pickLang({ user: null, cookie: 'xx', accept: 'sr-RS' })).toBe('sr');
    expect(pickLang({})).toBe('en');
    expect(asLang('fr')).toBeNull();
    expect(cookieValue('a=1; kx_lang=sr; b=2', 'kx_lang')).toBe('sr');
    expect(cookieValue('', 'kx_lang')).toBeNull();
  });
  it('предложение «переключить?»: только главный язык устройства и только прямое совпадение', () => {
    expect(suggestLang(['ru-RU', 'en'])).toBe('ru');
    expect(suggestLang(['en-GB'])).toBe('en');
    expect(suggestLang(['sr-RS'])).toBe('sr');
    expect(suggestLang(['hr'])).toBe('sr');
    expect(suggestLang(['uk-UA', 'ru'])).toBeNull();
    expect(suggestLang(['de-DE', 'en'])).toBeNull();
    expect(suggestLang([])).toBeNull();
  });
});

describe('формы числа', () => {
  const ru = (n: number) => pluralIndex('ru', n);
  it('русский и сербский: 1, 2–4, 5+ (11–14 — множественное, 21 — единственное)', () => {
    for (const lang of ['ru', 'sr'] as const) {
      const f = (n: number) => pluralIndex(lang, n);
      expect([1, 21, 101, 1001].map(f), lang).toEqual([0, 0, 0, 0]);
      expect([2, 3, 4, 22, 24, 102].map(f), lang).toEqual([1, 1, 1, 1, 1, 1]);
      expect([0, 5, 9, 10, 11, 12, 13, 14, 15, 20, 25, 100, 111, 112, 114].map(f), lang).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
      expect(f(1.5)).toBe(1);
    }
    expect(ru(1)).toBe(0);
  });
  it('английский: ровно 1 — единственное, остальное (в т. ч. 0 и дробные) — множественное', () => {
    expect([1].map((n) => pluralIndex('en', n))).toEqual([0]);
    expect([0, 2, 5, 11, 21, 1.5].map((n) => pluralIndex('en', n))).toEqual([1, 1, 1, 1, 1, 1]);
  });
  it('tr(): выбор формы по n и подстановка параметров', () => {
    expect(tr('ru', 'shell.moreMatches', { n: 1 })).toBe('ещё 1 совпадение');
    expect(tr('ru', 'shell.moreMatches', { n: 3 })).toBe('ещё 3 совпадения');
    expect(tr('ru', 'shell.moreMatches', { n: 7 })).toBe('ещё 7 совпадений');
    expect(tr('ru', 'shell.moreMatches', { n: 21 })).toBe('ещё 21 совпадение');
    expect(tr('en', 'shell.moreMatches', { n: 1 })).toBe('1 more match');
    expect(tr('en', 'shell.moreMatches', { n: 2 })).toBe('2 more matches');
    expect(tr('sr', 'shell.moreMatches', { n: 1 })).toBe('još 1 poklapanje');
    expect(tr('sr', 'shell.moreMatches', { n: 3 })).toBe('još 3 poklapanja');
    expect(tr('sr', 'shell.moreMatches', { n: 12 })).toBe('još 12 poklapanja');
    expect(tr('en', 'shell.deleteTitle')).toBe('Delete this chat?');
    expect(tr('sr', 'queue.in', { pos: ordinal(3, 'sr') })).toBe('Vi ste u redu — 3. mesto');
    expect(tr('ru', 'shell.shownOf', { shown: 20, n: 1 })).toBe('Показаны 20 из 1 чат');
  });
  it('числа с разрядами по правилам языка; порядковые и время', () => {
    expect(fmtNum('en', 1234567)).toBe('1,234,567');
    expect(fmtNum('ru', 1234)).toBe('1 234');
    expect(ordinal(1, 'en') + ordinal(2, 'en') + ordinal(3, 'en') + ordinal(4, 'en') + ordinal(11, 'en') + ordinal(22, 'en')).toBe('1st2nd3rd4th11th22nd');
    expect(ordinal(3, 'ru')).toBe('3-й');
    expect(fmtEta(35, 'en')).toBe('~35 s');
    expect(fmtEta(90, 'sr')).toBe('~1–2 min');
    expect(fmtEta(200, 'ru')).toBe('больше 2 мин');
    expect(fmtSec(125_000, 'en')).toBe('2 min 5 s');
    expect(fmtSec(125_000)).toBe('2 мин 5 с');
    expect(fmtBytes(1536, 'en')).toBe('2 KB');
    expect(fmtBytes(5 * 1048576 + 300000, 'sr')).toBe('5,3 MB');
    expect(fmtBytes(5 * 1048576 + 300000, 'en')).toBe('5.3 MB');
    const d = new Date(2026, 9, 5, 12, 0).getTime(), now = new Date(2026, 10, 2, 12, 0).getTime();
    expect(fmtWhen(d, now, 'ru')).toBe('5 окт');
    expect(fmtWhen(d, now, 'en')).toBe('5 Oct');
    expect(fmtWhen(d, now, 'sr')).toBe('5. okt');
  });
});

describe('словарь', () => {
  const keys = (d: Record<string, unknown>) => Object.keys(d);
  const forms = (v: string | readonly string[]) => (typeof v === 'string' ? [v] : [...v]);
  const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  it('ключи уникальны во всех областях', () => {
    const seen = new Map<string, string>();
    for (const [part, d] of Object.entries(PARTS)) for (const k of keys(d)) {
      expect(seen.has(k), `${k}: есть и в ${seen.get(k)}, и в ${part}`).toBe(false);
      seen.set(k, part);
    }
    expect(seen.size).toBeGreaterThan(800);
  });
  it('у каждого ключа три непустых текста; формы числа: ru и sr — 1 или 3, en — 1 или 2; одинаковые {параметры} во всех языках', () => {
    for (const [part, d] of Object.entries(PARTS)) for (const [k, e] of Object.entries(d)) {
      const [ru, en, sr] = e;
      for (const [lang, v] of [['ru', ru], ['en', en], ['sr', sr]] as const) {
        const f = forms(v);
        expect(f.length > 0 && f.every((x) => typeof x === 'string'), `${part}/${k}/${lang}`).toBe(true);
        expect(typeof v === 'string' || f.length === (lang === 'en' ? 2 : 3), `${part}/${k}/${lang}: форм ${f.length}`).toBe(true);
        expect(f.every((x) => x.length > 0), `${part}/${k}/${lang}: пустая форма`).toBe(true);
      }
      const base = holes(forms(ru)[0]);
      for (const [lang, v] of [['ru', ru], ['en', en], ['sr', sr]] as const) for (const x of forms(v)) expect(holes(x), `${part}/${k}/${lang}`).toEqual(base);
    }
  });
  it('английский и сербский — без кириллицы (кроме служебных подписей выбора языка), сербский — латиница', () => {
    const cyr = /[А-Яа-яЁё]/;
    for (const [part, d] of Object.entries(PARTS)) for (const [k, e] of Object.entries(d)) {
      if (k === 'lang.setting' || k === 'lang.settingSub') continue;
      for (const [lang, v] of [['en', e[1]], ['sr', e[2]]] as const) for (const x of forms(v)) expect(cyr.test(x), `${part}/${k}/${lang}: ${x}`).toBe(false);
    }
    for (const [part, d] of Object.entries(PARTS)) for (const [k, e] of Object.entries(d)) for (const x of forms(e[0])) {
      if (!/\{|[A-Za-z]{3}/.test(x) && x.trim() && !/[«»]/.test(x) && x !== forms(e[1])[0]) expect(/[А-Яа-яЁё]/.test(x) || /^[\d\s.,%–—-]+$/.test(x), `${part}/${k}/ru: ${x}`).toBe(true);
    }
  });
  it('сербский текст — с буквами č ć š ž đ там, где нужно (латиница, а не транслит без диакритики)', () => {
    expect(tr('sr', 'auth.createAccount')).toBe('Napravi nalog');
    expect(tr('sr', 'shell.noChats')).toBe('Još nema čatova');
    expect(tr('sr', 'common.retryLater')).toContain('Pokušajte');
  });
});

describe('ошибки сервера на языке человека', () => {
  it('точный текст и шаблон с частями; русский и неизвестное — как пришло', () => {
    expect(errText('en', 'Неверная почта или пароль')).toBe('Wrong email or password');
    expect(errText('sr', 'Такая почта уже есть')).toBe('Ova e-pošta je već registrovana');
    expect(errText('ru', 'Такая почта уже есть')).toBe('Такая почта уже есть');
    expect(errText('en', 'Alpha временно недоступна, попробуйте Beta.')).toBe('Alpha is temporarily unavailable, please try Beta.');
    expect(errText('sr', 'Alpha временно недоступна, попробуйте чуть позже.')).toBe('Alpha je privremeno nedostupan, pokušajte malo kasnije.');
    expect(errText('en', 'Тип «rar» не поддерживается')).toBe('The type “rar” isn’t supported');
    expect(errText('en', 'что-то совсем новое')).toBe('что-то совсем новое');
    expect(errText('en', '')).toBe('');
    expect(errText('en', undefined)).toBe('');
  });
});
