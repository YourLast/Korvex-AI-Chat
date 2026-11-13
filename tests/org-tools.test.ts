import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { tmpData } from './helpers';
import { SCENARIOS, filesText, periodText, scenarioText } from '@/lib/orgScenarios';
import { OUT_PREFIX } from '@/ext/client';

tmpData();
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let C: typeof import('@/lib/orgCard');

beforeAll(async () => {
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  db.insert(schema.users).values([{ id: 'u', email: 'u@t', name: 'U', passwordHash: 'x', role: 'user', createdAt: 1 }, { id: 'v', email: 'v@t', name: 'V', passwordHash: 'x', role: 'user', createdAt: 1 }]).run();
  db.insert(schema.folders).values([{ id: 'org', userId: 'u', name: 'Ромашка', instruction: '', createdAt: 1, updatedAt: 1 }, { id: 'org2', userId: 'u', name: 'Лютик', instruction: 'Отвечай кратко', createdAt: 1, updatedAt: 1 }]).run();
  db.insert(schema.files).values([
    { id: 'pol', userId: 'u', threadId: null, folderId: 'org', name: 'Учётная политика 2026.txt', mime: 'text/plain', size: 30, sha256: 'p1', text: 'Метод начисления', createdAt: 1 },
    { id: 'other', userId: 'u', threadId: null, folderId: 'org2', name: 'чужая.txt', mime: 'text/plain', size: 5, sha256: 'p2', text: 'x', createdAt: 1 },
  ] as never).run();
  db.insert(schema.threads).values({ id: 't1', userId: 'u', title: 'T', modelId: 'alpha', effort: 'medium', folderId: 'org', createdAt: 1, updatedAt: 1 } as never).run();
  C = await import('@/lib/orgCard');
});

describe('сценарии бухгалтера', () => {
  it('готовый запрос: организация с ИНН, период, файлы; все пять без незаполненных подстановок', () => {
    expect(SCENARIOS).toHaveLength(5);
    for (const id of SCENARIOS) {
      const s = scenarioText(id, { org: 'Ромашка', inn: '7701234567', from: '2026-10-01', to: '2026-10-31', files: ['Акты/акт_1.pdf', 'выписка.txt'] });
      expect(s, id).not.toMatch(/[{}]/);
      expect(s, id).toContain('«Ромашка» (ИНН 7701234567)');
      expect(s, id).toContain('за период с 01.10.2026 по 31.10.2026');
      expect(s, id).not.toContain('за с ');
    }
    expect(scenarioText('bank', { org: 'Ромашка', from: '', to: '', files: [] })).toContain('за весь период (файлы: документы этого чата)');
    expect(periodText('2026-10-01', '')).toBe('период с 01.10.2026');
    expect(filesText(Array.from({ length: 12 }, (_, i) => `f${i}.pdf`))).toMatch(/^«f0\.pdf», .*«f9\.pdf» и ещё 2$/);
  });
});

describe('карточка организации', () => {
  it('проверка полей; модель получает карточку вместе с инструкцией папки; чужая организация и чужой файл — нет', async () => {
    expect(C.setOrgCard('u', 'org', { inn: '123' })).toBe('inn');
    expect(C.setOrgCard('u', 'org', { kpp: '12' })).toBe('kpp');
    expect(C.setOrgCard('u', 'org', { tax: 'xxx' as never })).toBe('tax');
    expect(C.setOrgCard('u', 'org', { policyFileId: 'other' })).toBe('policy');
    expect(C.setOrgCard('v', 'org', { inn: '7701234567' })).toBe('folder');
    expect(C.setOrgCard('u', 'org', { inn: '7701 234567', kpp: '770101001', tax: 'usn_income_expense', vat: '5', policyFileId: 'pol' })).toMatchObject({ inn: '7701234567', kpp: '770101001' });
    const { folderInstruction } = await import('@/lib/agentHistory');
    expect(folderInstruction('org', 'u')).toBe('Карточка организации «Ромашка»: ИНН 7701234567; КПП 770101001; система налогообложения: УСН «Доходы минус расходы»; ставка НДС: 5%; учётная политика — файл «Учётная политика 2026.txt» (приложен к чату). Учитывай её во всех расчётах этой организации.');
    C.setOrgCard('u', 'org2', { vat: '22' });
    expect(folderInstruction('org2', 'u')).toMatch(/^Инструкция папки «Лютик»[\s\S]*Отвечай кратко\n\nКарточка организации «Лютик»: ставка НДС: 22%\./);
    expect(folderInstruction('org', 'v')).toBeNull();
  });
  it('файл учётной политики — к первому сообщению чата организации, копией; дальше не повторяется', async () => {
    const T = await import('@/lib/turn');
    const { eq } = await import('drizzle-orm');
    const thread = () => db.select().from(schema.threads).where(eq(schema.threads.id, 't1')).get()!;
    const p1 = T.prepare({ thread: thread(), userId: 'u', mode: 'send', text: 'Посчитай НДС', modelId: 'alpha', levelId: 'medium' });
    const ids = (p1.userMsg?.meta as { fileIds?: string[] } | null)?.fileIds ?? [];
    expect(ids).toHaveLength(1);
    expect(db.select().from(schema.files).where(eq(schema.files.id, ids[0])).get()).toMatchObject({ name: 'Учётная политика 2026.txt', threadId: 't1', folderId: null });
    expect(db.select().from(schema.files).where(eq(schema.files.id, 'pol')).get()?.threadId).toBeNull();
    const p2 = T.prepare({ thread: thread(), userId: 'u', mode: 'send', text: 'И ещё', modelId: 'alpha', levelId: 'medium' });
    expect((p2.userMsg?.meta as { fileIds?: string[] } | null)?.fileIds ?? []).toEqual([]);
  });
});

describe('«Скачать» файлы ответа', () => {
  it('ссылки на файлы модели в тексте (кроме картинок), по разу; только в режиме «Организации» и когда ответ готов', async () => {
    const { resultFiles, AssistantMsg } = await import('@/components/Message');
    const { OrgModeCtx } = await import('@/components/orgMode');
    const tok = 'a'.repeat(32);
    const text = `Реестр: [реестр.xlsx](${OUT_PREFIX}${tok}/%D1%80%D0%B5%D0%B5%D1%81%D1%82%D1%80.xlsx). Для 1С — ${OUT_PREFIX}${tok}/kl_to_1c.txt. График ![g](${OUT_PREFIX}${tok}/g.png) и ещё раз [реестр](${OUT_PREFIX}${tok}/%D1%80%D0%B5%D0%B5%D1%81%D1%82%D1%80.xlsx)`;
    expect(resultFiles(text).map((x) => x.name)).toEqual(['реестр.xlsx', 'kl_to_1c.txt']);
    const m = { id: 'a1', role: 'assistant' as const, content: text, reasoning: '', meta: { modelId: 'alpha', levelId: 'medium' } };
    const html = (org: boolean, streaming = false) => renderToStaticMarkup(createElement(OrgModeCtx.Provider, { value: org, children: createElement(AssistantMsg, { m: { ...m, streaming }, models: [] }) }));
    expect(html(true)).toContain('data-testid="results"');
    expect((html(true).match(/data-testid="result-file"/g) ?? []).length).toBe(2);
    expect(html(false)).not.toContain('data-testid="results"');
    expect(html(true, true)).not.toContain('data-testid="results"');
  });
});

describe('карточка для заголовка запроса', () => {
  it('заполненные поля и название; пустая карточка и чужая организация — null', () => {
    expect(C.orgHeader('u', 'org')).toEqual({ name: 'Ромашка', inn: '7701234567', kpp: '770101001', tax: 'usn_income_expense', vat: '5' });
    expect(C.orgHeader('u', 'org2')).toEqual({ name: 'Лютик', vat: '22' });
    expect(C.orgHeader('v', 'org')).toBeNull();
    expect(C.orgHeader('u', null)).toBeNull();
    expect(C.orgHeader('u', 'nope')).toBeNull();
  });
});
