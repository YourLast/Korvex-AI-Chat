import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ADM } from '@/lib/i18n/admDict';
import { adm, admAny, admCount, admErr, admf, setAdmLang } from '@/lib/i18n/adm';
import { W } from '@/lib/plural';
import type { PersonRow } from '@/lib/adminTypes';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => '/admin' }));
vi.mock('@/components/Shell', () => ({ Topbar: () => null, useShell: () => ({ openDrawer: () => {} }) }));
afterEach(() => setAdmLang('ru'));

const CYR = /[А-Яа-яЁё]/;
const DIR = path.join(__dirname, '..', 'src', 'components');

function admStrings(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const n of fs.readdirSync(DIR).filter((f) => f.endsWith('.tsx'))) {
    const src = fs.readFileSync(path.join(DIR, n), 'utf8');
    if (!src.includes("@/lib/i18n/adm'")) continue;
    const sf = ts.createSourceFile(n, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (x: ts.Node) => {
      if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && (x.expression.text === 'adm' || x.expression.text === 'admf')) {
        const a = x.arguments[0];
        if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) out.push({ file: n, text: a.text });
      }
      ts.forEachChild(x, visit);
    };
    visit(sf);
  }
  return out;
}

describe('перевод админки', () => {
  it('каждая строка adm()/admf() есть в таблице', () => {
    const all = admStrings();
    expect(all.length).toBeGreaterThan(500);
    const missing = all.filter((s) => !ADM[s.text]).map((s) => `${s.file}: ${s.text}`);
    expect(missing).toEqual([]);
  });
  it('в таблице: английский без кириллицы, подстановки совпадают', () => {
    for (const [ru, [en]] of Object.entries(ADM)) {
      expect(en, ru).not.toMatch(CYR);
      expect((en.match(/\{\d+\}/g) ?? []).sort(), ru).toEqual((ru.match(/\{\d+\}/g) ?? []).sort());
    }
  });
  it('функции: русский — как есть, английский — по таблице, числа и шаблоны с сервера', () => {
    expect(adm('Сохранить')).toBe('Сохранить');
    setAdmLang('en');
    expect(adm('Сохранить')).toBe('Save');
    expect(admf('{0} из {1}', 3, 10)).toBe('3 of 10');
    expect(admCount(1, W.user)).toBe('1 user');
    expect(admCount(1200, W.chat)).toBe('1,200 chats');
    expect(admAny('Кэш входа движок сообщил не для всех ответов (3 из 10, в том числе запросы API без разбивки): остальные учтены как «посчитанный» вход, поэтому стоимость может быть чуть завышена.'))
      .toContain('(3 of 10,');
    expect(admErr('Нет связи с сервером')).not.toMatch(CYR);
    setAdmLang('sr');
    expect(adm('Сохранить')).toBe('Save');
  });
  it('список людей на английском — без русских букв (кроме имён людей)', async () => {
    const { AdminPeople } = await import('@/components/AdminPeople');
    const T0 = 1_760_000_000_000;
    const p = (o: Partial<PersonRow>): PersonRow => ({ id: 'u1', email: 'anna@test.local', name: 'Anna Test', role: 'user', disabled: false, createdAt: T0, chats: 12, messages: 340, files: 5, up: 4, down: 3,
      lastAt: T0, source: { key: 'admin', kind: 'admin', label: 'создан админом' }, ...o } as PersonRow);
    setAdmLang('en');
    const h = renderToStaticMarkup(createElement(AdminPeople, { users: [p({}), p({ id: 'u2', name: 'Bob Test', chats: 1, messages: 2, files: 0, up: 0, down: 0, lastAt: null, disabled: true })], meId: 'me', tz: 'UTC', onSettings: () => {} }));
    expect(h.match(/[А-Яа-яЁё][^<"]*/g) ?? []).toEqual([]);
    expect(h).toContain('12 chats · 340 messages · 5 files');
  });
});
