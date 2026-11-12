import { describe, expect, it } from 'vitest';
import { cyr, dl, fold, fuzzyPrefix, indexText, matcherOf, parseQuery, plainText, segments, skel, skelVariants, snippet, stemRu, stemShort, termOf, wordHit, words } from '@/lib/textsearch';

describe('fold и слова', () => {
  it('нижний регистр, ё = е, без диакритики, й остаётся й, без невидимых символов', () => {
    expect(fold('Ёлка ЁЖИК')).toBe('елка ежик');
    expect(fold('Café Zürich')).toBe('cafe zurich');
    expect(fold('Настройка')).toBe('настройка');
    expect(fold('a⁠‌b')).toBe('ab');
  });
  it('слова как у unicode61: дефис и точка делят', () => {
    expect(words('ZX-90417 и top3.csv').map((t) => t.w)).toEqual(['ZX', '90417', 'и', 'top3', 'csv']);
  });
  it('Markdown -> текст: ссылки подписью, без звёздочек и решёток', () => {
    expect(plainText('## Итог\n**Жирный** и [отчёт.xlsx](/out/abc/отчёт.xlsx)\n- пункт')).toBe('Итог Жирный и отчёт.xlsx пункт');
  });
});

describe('стеммер (Snowball, русский)', () => {
  it.each([
    ['настроил', 'настро'], ['настроила', 'настро'], ['настройка', 'настройк'], ['настройки', 'настройк'],
    ['уравнения', 'уравнен'], ['уравнение', 'уравнен'], ['перепиши', 'перепиш'], ['томске', 'томск'], ['счёта', 'счет'],
    ['красивые', 'красив'], ['работала', 'работа'], ['быстрее', 'быстр'], ['кот', 'кот'],
  ])('%s -> %s', (w, s) => expect(stemRu(fold(w))).toBe(s));
  it('словообразовательный хвост: настройк -> настро', () => {
    expect(stemShort('настройк')).toBe('настро');
    expect(stemShort('кот')).toBeNull();
  });
});

describe('скелет: кириллица и транслит сходятся', () => {
  it.each([
    ['настроил', 'nastroil'], ['короче', 'koroce'], ['короче', 'koroche'], ['чтобы', 'chtoby'], ['чтобы', 'ctobi'], ['гугли', 'gugli'],
    ['модель', 'model'], ['кверти', 'qwerty'], ['настройка', 'nastroyka'], ['настройка', 'nastrojka'], ['счёт', 'schet'], ['борщ', 'borshch'],
    ['жизнь', 'zhizn'], ['яндекс', 'yandex'], ['привет', 'privet'], ['цвет', 'tsvet'], ['хорошо', 'khorosho'],
  ])('%s = %s', (c, l) => expect(skel(fold(c))).toBe(skel(l)));
  it('варианты латиницы: c как к, x как х', () => {
    expect(skelVariants('cola')).toContain(skel('кола'));
    expect(skelVariants('xorosho')).toContain(skel('хорошо'));
  });
  it('русское прочтение транслита', () => {
    expect(cyr('nastroil')).toBe('настроил');
    expect(cyr('koroche')).toBe('короче');
    expect(cyr('privet')).toBe('привет');
    expect(cyr('ya')).toBe('я');
  });
});

describe('опечатки', () => {
  it('Дамерау–Левенштейн: замена, пропуск, перестановка = 1', () => {
    expect(dl('настроил', 'настроил')).toBe(0);
    expect(dl('настроил', 'насроил')).toBe(1);
    expect(dl('настроил', 'настриол')).toBe(1);
    expect(dl('настроил', 'нестроил')).toBe(1);
    expect(dl('настроил', 'нестриол')).toBe(2);
  });
  it('по префиксу слова словаря', () => {
    expect(fuzzyPrefix('nastor', 'nastroika')).toBe(true);
    expect(fuzzyPrefix('tomks', 'tomsk')).toBe(true);
    expect(fuzzyPrefix('depozti', 'depozit')).toBe(true);
    expect(fuzzyPrefix('kvadrat', 'privet')).toBe(false);
    expect(fuzzyPrefix('порящк', 'порядке')).toBe(true);
    expect(fuzzyPrefix('единц', 'единый')).toBe(false);
    expect(fuzzyPrefix('зада', 'задача')).toBe(false);
    expect(fuzzyPrefix('sobaka', 'kobaka')).toBe(false);
  });
});

describe('разбор запроса', () => {
  it('русское слово: слово, слово без последней буквы и основа — префиксами (длиннее совпало — выше), и их скелеты', () => {
    const t = termOf('настроил');
    expect(t.body.sort()).toEqual(['настро', 'настрои', 'настроил']);
    expect(t.alt).toContain('nastro');
    expect(termOf('заданы').body).toContain('задан');
  });
  it('транслит: скелет основы русского прочтения', () => {
    const t = termOf('nastroil');
    expect(t.body).toEqual(['nastroil']);
    expect(t.alt.sort()).toEqual(['nastro', 'nastroil']);
  });
  it('апостроф внутри латинского слова — мягкий знак транслита', () => {
    expect(words("ispol'zuja don't").map((x) => x.w)).toEqual(["ispol'zuja", "don't"]);
    expect(fold("Ispol'zuja")).toBe('ispolzuja');
    expect(skel(fold("ispol'zuja"))).toBe(skel(fold('используя')));
    expect(indexText("ispol'zuja").body).toBe('ispolzuja');
  });
  it('скелет: тс как латинское ts', () => {
    expect(skel(fold('хранится'))).toBe(skel('khranitsja'));
    expect(skel(fold('детский'))).toBe(skel('detskiy'));
    expect(skel(fold('стрелочку'))).toBe(skel('strelocku'));
    expect(skel(fold('стрелочку'))).toBe(skel('strelochku'));
    for (const l of ['postavshchiku', 'postavschiku']) expect(skel(fold('поставщику'))).toBe(skel(l));
    expect(skelVariants('postavshiku')).toContain(skel(fold('поставщику')));
    expect(skelVariants('поставщику')).toContain(skel('postavshiku'));
    expect(skelVariants('схему')).toContain(skel('shemu'));
  });
  it('фраза в кавычках — отдельно, одиночная буква — точно', () => {
    const p = parseQuery('"номер счёта" и Q');
    expect(p.phrases).toEqual([{ body: ['номер', 'счета'], alt: ['nomer', 'sceta'] }]);
    expect(p.terms.map((t) => [t.raw, !!t.exact])).toEqual([['и', true], ['q', true]]);
  });
  it('повторы слов убираются, не больше 8 слов', () => {
    expect(parseQuery('кот кот Кот').terms).toHaveLength(1);
    expect(parseQuery('a1 b2 c3 d4 e5 f6 g7 h8 i9 j10').terms).toHaveLength(8);
  });
});

describe('подсветка и фрагмент', () => {
  const m = matcherOf(parseQuery('настроил'));
  it('слово текста совпадает так же, как в индексе', () => {
    expect(wordHit(m, 'Настройка')).toBe(true);
    expect(wordHit(m, 'nastroil')).toBe(true);
    expect(wordHit(m, 'настроение')).toBe(true);
    expect(wordHit(m, 'строил')).toBe(false);
  });
  it('название с подсветкой', () => {
    expect(segments('Настройка Zed Code', m)).toEqual([['Настройка', 1], [' Zed Code', 0]]);
  });
  it('фрагмент — окно вокруг совпадения с многоточием', () => {
    const long = 'Начало текста. '.repeat(30) + 'Вот здесь я настроил редактор Zed под проект. ' + 'Хвост текста. '.repeat(30);
    const s = snippet(long, m, 120);
    expect(s.count).toBe(1);
    expect(s.hits).toEqual(['настроил']);
    expect(s.segs[0]).toEqual(['…', 0]);
    expect(s.segs.at(-1)).toEqual(['…', 0]);
    expect(s.segs.some(([t, h]) => h === 1 && t === 'настроил')).toBe(true);
    expect(s.segs.map(([t]) => t).join('').length).toBeLessThanOrEqual(124);
  });
  it('текст индекса: свёрнутые слова и скелеты', () => {
    expect(indexText('Ёлка **и** Nastroil')).toEqual({ body: 'елка и nastroil', alt: 'elka i nastroil' });
  });
});
