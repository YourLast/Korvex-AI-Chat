import { describe, expect, it } from 'vitest';
import { cites, diffTexts, jaccard, toBlocks, wordDiff } from '@/lib/textdiff';

const doc = (...ps: string[]) => ps.join('\n\n');

describe('блоки', () => {
  it('абзацы по пустым строкам, метки места подписывают блоки и не входят в текст', () => {
    const b = toBlocks('[page 1]\n\nПервый абзац.\n\nВторой.\n\n[page 2]\n\nТретий.');
    expect(b.map((x) => [x.text, x.loc])).toEqual([['Первый абзац.', 'стр. 1'], ['Второй.', 'стр. 1'], ['Третий.', 'стр. 2']]);
  });
  it('метки серва «[lines a-b]» и «[section «x»]» подписывают блоки и в дифф не входят', () => {
    const b = toBlocks('[lines 1-3]\nпервая\nвторая\nтретья\n[section «Условия»]\nчетвёртая');
    expect(b.map((x) => [x.text, x.loc])).toEqual([['первая', 'строки 1–3'], ['вторая', 'строки 1–3'], ['третья', 'строки 1–3'], ['четвёртая', 'раздел Условия']]);
  });
  it('без пустых строк каждая строка — свой блок; слайды и листы тоже подписи', () => {
    const b = toBlocks('[slide 3]\nзаголовок\nпункт один\n[sheet «Лист1» rows 1-50]\nстрока');
    expect(b.map((x) => x.loc)).toEqual(['слайд 3', 'слайд 3', 'лист Лист1, 1–50']);
  });
});

describe('дифф', () => {
  it('одинаковые документы — ни одного изменения', () => {
    const a = doc('Раз.', 'Два.', 'Три.');
    expect(diffTexts(a, a)).toMatchObject({ changes: 0, truncated: false });
  });
  it('пагинация другая, текст тот же — различий нет', () => {
    const d = diffTexts('[page 1]\n\nА.\n\nБ.\n\n[page 2]\n\nВ.', '[page 1]\n\nА.\n\n[page 2]\n\nБ.\n\nВ.');
    expect(d.changes).toBe(0);
  });
  it('изменён абзац: пара «chg» с подсвеченными словами; добавлен и удалён — отдельные строки', () => {
    const a = doc('Заголовок', 'Неустойка составляет 0,1% в день.', 'Старый пункт про аренду.', 'Конец.');
    const b = doc('Заголовок', 'Неустойка составляет 0,5% в день.', 'Конец.', 'Новый раздел о конфиденциальности.');
    const d = diffTexts(a, b);
    const kinds = d.rows.map((r) => r.kind);
    expect(kinds).toEqual(['eq', 'chg', 'del', 'eq', 'add']);
    const chg = d.rows[1];
    if (chg.kind !== 'chg') throw new Error('x');
    expect(chg.sa.filter((s) => s.mark).map((s) => s.t.trim()).join(' ')).toContain('0,1');
    expect(chg.sb.filter((s) => s.mark).map((s) => s.t.trim()).join(' ')).toContain('0,5');
    expect(d.changes).toBe(3);
  });
  it('пять отличий между редакциями находятся детерминированно (два прогона дают одно и то же)', () => {
    const base = Array.from({ length: 40 }, (_, i) => `Пункт ${i + 1}. Стороны обязуются соблюдать условия номер ${i + 1}.`);
    const nw = [...base];
    nw[3] = nw[3].replace('соблюдать', 'исполнять');
    nw[10] = 'Пункт 11. Стороны обязуются соблюдать условия номер 11 в срок 10 дней.';
    nw.splice(20, 1);
    nw.splice(30, 0, 'Пункт 31а. Новое условие о штрафе.');
    nw[39] = nw[39].replace('номер 40', 'номер сорок');
    const a = doc(...base), b = doc(...nw);
    const d1 = diffTexts(a, b), d2 = diffTexts(a, b);
    expect(JSON.stringify(d1)).toBe(JSON.stringify(d2));
    expect(d1.changes).toBe(5);
  });
  it('цитата из ответа помечает строку', () => {
    const d = diffTexts(doc('А.', 'Штраф 0,1% в день без потолка.'), doc('А.', 'Штраф 0,5% в день с потолком.'));
    const chg = d.rows.find((r) => r.kind === 'chg')!;
    expect(cites(chg, [{ quote: 'штраф 0,5% в день с потолком' }])).toBe(true);
    expect(cites(chg, [{ quote: 'совсем другое' }])).toBe(false);
  });
  it('слова и похожесть', () => {
    expect(jaccard('а б в', 'а б г')).toBeCloseTo(0.5);
    const w = wordDiff('срок 10 дней', 'срок 30 дней');
    expect(w.sa.some((s) => s.mark && s.t.includes('10'))).toBe(true);
    expect(w.sb.some((s) => s.mark && s.t.includes('30'))).toBe(true);
  });
  it('очень разные большие документы не зависают (предел правок), документ длиннее предела — признак truncated', () => {
    const a = doc(...Array.from({ length: 4000 }, (_, i) => `левый абзац ${i} ` + 'а'.repeat(i % 7)));
    const b = doc(...Array.from({ length: 4000 }, (_, i) => `правый текст ${i} ` + 'б'.repeat(i % 5)));
    const t0 = Date.now();
    const d = diffTexts(a, b);
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(d.changes).toBeGreaterThan(3000);
    expect(diffTexts(a, b, { maxBlocks: 100 }).truncated).toBe(true);
  });
});
