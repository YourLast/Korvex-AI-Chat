import { beforeAll, describe, expect, it } from 'vitest';
import { tmpData } from './helpers';

tmpData();
beforeAll(async () => {
  const { getDb, schema } = await import('@/lib/db');
  getDb().insert(schema.users).values({ id: 'dg1', email: 'dg1@t', name: 'Т', passwordHash: 'x', role: 'user', createdAt: 1 }).run();
});

const OSV = 'ООО «Ромашка»\nОборотно-сальдовая ведомость за 3 квартал 2026 г.\nВыводимые данные: БУ (данные бухгалтерского учета)\nСчет 51 … 1 240 000,00\n1С:Бухгалтерия предприятия, редакция 3.0';
const KUDIR = 'КНИГА учета доходов и расходов организаций и индивидуальных предпринимателей, применяющих упрощенную систему налогообложения\nОбъект налогообложения: доходы, уменьшенные на величину расходов\nИНН 7701234567';

describe('догадки по шапке', () => {
  it('программа, режим, вид документов; в тексте записи — ни названий, ни чисел документа', async () => {
    const G = await import('@/lib/docGuess');
    expect(G.docGuesses([OSV])).toEqual([
      { section: 'work', text: 'Ведёт учёт в 1С:Бухгалтерия 3.0' },
      { section: 'work', text: 'Работает с документами: оборотно-сальдовые ведомости' },
    ]);
    expect(G.docGuesses([KUDIR]).map((g) => g.text)).toEqual(['Организация на УСН «доходы минус расходы»', 'Работает с документами: книга учёта доходов и расходов']);
    for (const g of G.docGuesses([OSV, KUDIR])) expect(g.text).not.toMatch(/Ромашка|7701234567|1 240/);
    expect(G.docGuesses(['Привет, вот фото кота'])).toEqual([]);
    expect(G.docGuesses(['x'.repeat(2000) + ' УСН'])).toEqual([]);
  });
  it('запись — догадкой; повтор не подтверждает; чужой файл не читаем', async () => {
    const G = await import('@/lib/docGuess');
    const M = await import('@/lib/memory');
    const { getDb, schema } = await import('@/lib/db');
    getDb().insert(schema.users).values({ id: 'dg2', email: 'dg2@t', name: 'Т', passwordHash: 'x', role: 'user', createdAt: 1 }).run();
    getDb().insert(schema.files).values([
      { id: 'f1', userId: 'dg1', name: 'osv.xlsx', size: 1, sha256: 'a', text: OSV, createdAt: 1 },
      { id: 'f2', userId: 'dg2', name: 'kudir.pdf', size: 1, sha256: 'b', text: KUDIR, createdAt: 1 },
    ] as never).run();
    getDb().insert(schema.threads).values(['t1', 't2'].map((id) => ({ id, userId: 'dg1', title: 'Ч', modelId: 'alpha', createdAt: 1, updatedAt: 1 }))).run();
    const a = G.writeDocGuesses('dg1', ['f1', 'f2'], { threadId: 't1', messageId: 'm1' });
    expect(a.map((x) => x.text)).toEqual(['Ведёт учёт в 1С:Бухгалтерия 3.0', 'Работает с документами: оборотно-сальдовые ведомости']);
    expect(M.listMemory('dg1').every((r) => r.sure === 0 && r.origin === 'auto')).toBe(true);
    expect(G.writeDocGuesses('dg1', ['f1'], { threadId: 't2', messageId: 'm2' })).toEqual([]);
    expect(M.listMemory('dg1').every((r) => r.sure === 0)).toBe(true);
  });
});
