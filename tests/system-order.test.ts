import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';

const dir = tmpData();
process.env.MODELS_CONFIG = path.join(dir, 'models.json');
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let A: typeof import('@/lib/agentHistory'), L: typeof import('@/lib/agentLoop'), R: typeof import('@/lib/tools/registry'), T: typeof import('@/lib/turn'), M: typeof import('@/lib/models'), Mem: typeof import('@/lib/memory');
const T0 = 1_790_000_000_000;

beforeAll(async () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8').replace(/,\s*"hidden": true/g, ''));
  fs.writeFileSync(path.join(dir, 'sys.txt'), 'ОБЩИЙ ПРОМПТ МОДЕЛИ для всех людей.');
  for (const m of cfg.models) { m.systemPromptFile = path.join(dir, 'sys.txt'); }
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  const d = await import('@/lib/db'); db = d.getDb(); schema = d.schema;
  for (const [id, lang] of [['ua', 'ru'], ['ub', 'ru'], ['us', 'sr'], ['ue', 'en']] as const) db.insert(schema.users).values({ id, email: `${id}@t`, name: id, passwordHash: 'x', role: 'user', lang, createdAt: T0 }).run();
  A = await import('@/lib/agentHistory'); L = await import('@/lib/agentLoop'); R = await import('@/lib/tools/registry'); T = await import('@/lib/turn'); M = await import('@/lib/models'); Mem = await import('@/lib/memory');
  await import('@/lib/tools/all');
  Mem.addMemory('ua', { section: 'who', text: 'Анна, бухгалтер в Казани', origin: 'manual' });
  Mem.addMemory('ub', { section: 'who', text: 'Игорь, геофизик из Казаньа', origin: 'manual' });
});

const ctx = (userId: string) => ({ userId, threadId: 'thr', folderId: null as string | null, kind: 'chat' as const, modelId: 'alpha', depth: 0 });
const sysFor = (userId: string, folderSys: string | null = null) => A.composeSystem({ model: M.getModel('alpha')!, tz: 'UTC', rules: L.agentRules(false), folderSys, pctx: ctx(userId) });

describe('системное сообщение: общее — первым, человека — последним', () => {
  it('порядок: промпт модели -> правила инструментов -> инструкция папки -> память о человеке', () => {
    const s = sysFor('ua', 'Инструкция папки «Отчёты»: коротко.');
    const i = (x: string) => s.indexOf(x);
    expect(i('ОБЩИЙ ПРОМПТ МОДЕЛИ')).toBe(0);
    expect(i('Инструменты Korvex')).toBeGreaterThan(i('ОБЩИЙ ПРОМПТ'));
    expect(i('Инструкция папки')).toBeGreaterThan(i('Инструменты Korvex'));
    expect(i('Анна, бухгалтер')).toBeGreaterThan(i('Инструкция папки'));
    expect(s.trimEnd().endsWith('Казани') || s.indexOf('Анна') > s.length * 0.4).toBe(true);
  });
  it('у двух людей с разной памятью общий префикс — всё до блока памяти; различается только хвост', () => {
    const a = sysFor('ua'), b = sysFor('ub');
    let k = 0; while (k < a.length && a[k] === b[k]) k++;
    expect(a).not.toBe(b);
    expect(k).toBeGreaterThan(a.indexOf('Инструменты Korvex') + 200);
    expect(a.slice(0, k)).not.toContain('Анна'); expect(b.slice(0, k)).not.toContain('Игорь');
    expect(k / Math.max(a.length, b.length)).toBeGreaterThan(0.7);
  });
  it('блоки со своей областью: shared — до папки, chat — после неё, user — последним, при любом порядке регистрации', () => {
    const offs = [
      R.registerPromptPart(() => 'БЛОК-ЧЕЛОВЕКА', 'user'), R.registerPromptPart(() => 'БЛОК-ЧАТА', 'chat'), R.registerPromptPart(() => 'БЛОК-ОБЩИЙ', 'shared'),
    ];
    const s = sysFor('ub', 'ПАПКА');
    const i = (x: string) => s.indexOf(x);
    expect(i('БЛОК-ОБЩИЙ')).toBeLessThan(i('ПАПКА')); expect(i('ПАПКА')).toBeLessThan(i('БЛОК-ЧАТА')); expect(i('БЛОК-ЧАТА')).toBeLessThan(i('БЛОК-ЧЕЛОВЕКА'));
    expect(i('БЛОК-ЧАТА')).toBeLessThan(i('Игорь')); expect(i('Игорь')).toBeLessThan(i('БЛОК-ЧЕЛОВЕКА'));
    offs.forEach((f) => f());
  });
  it('chatToOai пересобирает системное сообщение в том же порядке (память не посреди правил)', () => {
    const model = M.getModel('alpha')!;
    const msgs = T.buildMessages([{ id: 'm', threadId: 'thr', seq: 1, parentId: null, session: null, role: 'user', content: 'привет', reasoning: null, reasoningMs: null, meta: null, createdAt: T0 }], model, 'ua', 'UTC', 'Инструкция папки: коротко.', Mem.memoryBlockFor('ua', null));
    const oai = A.chatToOai(msgs, ctx('ua'), { model, tz: 'UTC', folderSys: 'Инструкция папки: коротко.' });
    const s = oai[0].content as string;
    expect(s).toBe(sysFor('ua', 'Инструкция папки: коротко.'));
    expect(s.indexOf('Инструменты Korvex')).toBeLessThan(s.indexOf('Анна'));
  });
});

describe('ссылки на источник в истории', () => {
  it('маркеры [[src:…]] из прошлых ответов уходят серву обычным текстом; последний вопрос и вопросы человека — как есть', () => {
    const model = M.getModel('alpha')!;
    const row = (id: string, seq: number, role: 'user' | 'assistant', content: string) => ({ id, threadId: 'thr', seq, parentId: null, session: null, role, content, reasoning: null, reasoningMs: null, meta: null, createdAt: T0 });
    const msgs = T.buildMessages([
      row('a', 1, 'user', 'Где неустойка?'),
      row('b', 2, 'assistant', 'В договоре [[src:Договоры/д.docx|стр. 3|"0,17 %"]] и в акте [[src:Акты/а.pdf|стр. 1]].'),
      row('c', 3, 'user', 'А срок? [[src:вставил сам|стр. 1]]'),
    ] as never, model, 'ua', 'UTC');
    const as = msgs.find((m) => m.role === 'assistant')!.content as string;
    expect(as).toBe('В договоре (д.docx, стр. 3) и в акте (а.pdf, стр. 1).');
    expect((msgs.find((m) => m.role === 'user')!.content as string)).toBe('Где неустойка?');
    expect(JSON.stringify(msgs.at(-1))).toContain('[[src:вставил сам');
  });
});

describe('инструменты: общие первыми', () => {
  it('набор не зависит от человека: у двух разных людей одинаковый список', () => {
    const a = L.toolSet(ctx('ua'), 'chat').schemas.map((t) => (t as { function: { name: string } }).function.name);
    const b = L.toolSet(ctx('ub'), 'chat').schemas.map((t) => (t as { function: { name: string } }).function.name);
    expect(a).toEqual(b);
  });
});

describe('вопрос к приложенному без текста — на языке человека', () => {
  const hist = (userId: string, fileId: string, fid: string) => ([{ id: 'm1', threadId: 't', seq: 1, parentId: null, session: null, role: 'user' as const, content: '', reasoning: null, reasoningMs: null, meta: { fileIds: [fid] }, createdAt: T0 }]);
  const mk = (id: string, userId: string, mime: string) => {
    db.insert(schema.files).values({ id, userId, threadId: null, name: mime.startsWith('image/') ? 'p.png' : 'a.txt', mime, size: 4, sha256: 'x', text: 'содержимое', createdAt: T0 }).run();
    const d = path.join(dir, 'files', id); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'original.png'), Buffer.from([137, 80, 78, 71]));
  };
  it('картинка: RU / EN / SR', () => {
    const model = M.getModel('alpha')!;
    for (const [uid, want] of [['ua', 'Что на картинке?'], ['ue', 'What’s in the picture?'], ['us', 'Šta je na slici?']] as const) {
      mk(`img-${uid}`, uid, 'image/png');
      const out = T.buildMessages(hist(uid, '', `img-${uid}`) as never, model, uid, null);
      const u = out.find((m) => m.role === 'user')!;
      const text = typeof u.content === 'string' ? u.content : (u.content[0] as { text: string }).text;
      expect(text).toBe(want);
    }
  });
  it('документ без вопроса: RU / SR', () => {
    const model = M.getModel('alpha')!;
    mk('doc-ua', 'ua', 'text/plain'); mk('doc-us', 'us', 'text/plain');
    const ru = T.buildMessages(hist('ua', '', 'doc-ua') as never, model, 'ua', null).find((m) => m.role === 'user')!.content as string;
    const sr = T.buildMessages(hist('us', '', 'doc-us') as never, model, 'us', null).find((m) => m.role === 'user')!.content as string;
    expect(ru).toContain('Прочитай файл и кратко опиши'); expect(sr).toContain('Pročitaj fajl i ukratko opiši');
  });
});
