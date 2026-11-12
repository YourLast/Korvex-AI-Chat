import { describe, expect, it } from 'vitest';
import { allSteps, askTitle, buildFeed, countSteps, diffOf, diffStat, fromEvent, historyOf, hostOf, lastSentence, latestSteps, nowOf, parseDiff, pastTitle, statusSpoken, statusText, summaryLine, type StepEvent, type WItem } from '@/lib/work';

const R1 = 'Сделаю файл командой.\n\n▸ bash: mkdir -p отчёты && echo hi > отчёты/a.txt\n    готово\nТеперь открою сайт.\n';
const R2 = 'Сайт открыт. Смотрю цену.\n';
let T = 1000;
const ev = (p: Partial<StepEvent> & { id: string }): StepEvent => ({ kind: 'browser', title: 'Открывает ozon.ru', status: 'ok', at: { r: 0, c: 0 }, round: 0, t0: T++, ...p });
const shot = (id: string) => ({ kind: 'image' as const, fileId: id, url: `/api/files/${id}`, name: `Снимок ${id}.png`, mime: 'image/png', size: 1000, w: 1280, h: 800 });
const kinds = (it: WItem[]) => it.map((x) => (x.t === 'step' ? `step:${x.step.kind}` : x.t === 'group' ? `group:${x.steps.length}` : x.t));

describe('лента: порядок шагов серва и Korvex', () => {
  it('событие с at.r встаёт между кусками текста ровно в своём месте', () => {
    const f = buildFeed(R1 + R2, [ev({ id: 'b1', at: { r: R1.length, c: 0 }, thumb: shot('f1') })]);
    expect(kinds(f)).toEqual(['think', 'step:bash', 'think', 'step:browser', 'think']);
    const b = allSteps(f).find((s) => s.kind === 'browser')!;
    expect(b.title).toBe('Открыл сайт ozon.ru');
    expect(b.host).toBe('ozon.ru');
    expect(b.thumb?.url).toBe('/api/files/f1');
  });
  it('повтор события с тем же id — полное состояние, последнее побеждает; место — по at', () => {
    const l = latestSteps([ev({ id: 'a', status: 'run', title: 'Нажимает «Войти»', at: { r: 5, c: 0 } }), ev({ id: 'a', status: 'ok', title: 'Нажимает «Войти»', at: { r: 5, c: 0 }, thumb: shot('t') })]);
    expect(l).toHaveLength(1);
    expect(fromEvent(l[0])).toMatchObject({ status: 'ok', title: 'Нажал «Войти»' });
  });
  it('шаг серва: делается — «Выполняет», сделано — «Выполнил»; команда — в подписи и в терминале', () => {
    expect(allSteps(buildFeed('▸ bash: ls -la\n', [], true))[0]).toMatchObject({ title: 'Выполняет', status: 'run', sub: 'ls -la' });
    const done = allSteps(buildFeed('▸ bash: ls -la\n    a.txt\n'))[0];
    expect(done).toMatchObject({ title: 'Выполнил', status: 'ok' });
    expect(done.term).toMatchObject({ lang: 'bash', cmd: 'ls -la', out: ['a.txt'], code: true });
  });
  it('поиск серва: «Искал «курс рубля»» и итог «3 источника»; успех без итога — без слова «готово»', () => {
    const s = allSteps(buildFeed('[поиск: курс рубля]\n[найдено: 3 источника]\n'))[0];
    expect(s).toMatchObject({ kind: 'web', title: 'Искал', result: '3 источника', sub: '«курс рубля»' });
    expect(statusText(allSteps(buildFeed('▸ bash: ls\n'))[0])).toBe('');
    expect(statusSpoken(allSteps(buildFeed('▸ bash: ls\n'))[0])).toBe('готово');
  });
  it('подшаги вызова уходят внутрь, миниатюра и живой сеанс — от подшагов', () => {
    const f = buildFeed('', [
      ev({ id: 'call', title: 'Работает в браузере', status: 'run' }),
      ev({ id: 's1', parent: 'call', title: 'Открывает hh.ru', status: 'ok', thumb: shot('1'), live: { kind: 'browser', session: 'S' } }),
      ev({ id: 's2', parent: 'call', title: 'Нажимает «Войти»', status: 'run' }),
    ], true);
    expect(kinds(f)).toEqual(['step:browser']);
    const call = (f[0] as { step: { kids: unknown[]; thumb: { fileId: string }; live: string; host: string } }).step;
    expect(call.kids).toHaveLength(2);
    expect(call.thumb.fileId).toBe('1');
    expect(call.live).toBe('S');
    expect(call.host).toBe('hh.ru');
    expect(nowOf(f)).toMatchObject({ kind: 'step', step: { id: 's2', title: 'Нажимает «Войти»' } });
  });
  it('ваше сообщение на ходу — строка «Вы: …», в счёт шагов не входит', () => {
    const f = buildFeed('', [ev({ id: 'st', kind: 'steer', title: 'сначала проверь цену', status: 'ok' }), ev({ id: 'x', kind: 'chat', title: 'Читает чат «Склад»' })]);
    expect(allSteps(f)[0]).toMatchObject({ title: 'Вы', sub: 'сначала проверь цену' });
    expect(countSteps(f)).toBe(1);
  });
});

describe('браузер: адрес и код страницы, группы с повтора', () => {
  it('«Открыл cbr.ru/currency_base/daily · 404»: путь из первой строки подробностей, код ≥ 400 — в статусе', () => {
    const s = fromEvent(ev({ id: 'o', title: 'Открывает cbr.ru', detail: 'https://www.cbr.ru/currency_base/daily/ · HTTP 404\nСтраница не найдена' }));
    expect(s).toMatchObject({ title: 'Открыл cbr.ru/currency_base/daily', result: '404', http: 404, host: 'cbr.ru', sub: 'Страница не найдена', text: undefined });
    expect(fromEvent(ev({ id: 'o2', title: 'Открывает cbr.ru', detail: 'https://cbr.ru/ · HTTP 200' }))).toMatchObject({ title: 'Открыл сайт cbr.ru', result: undefined });
    expect(fromEvent(ev({ id: 'o3', title: 'Открывает cbr.ru/currency_base/daily', detail: 'https://www.cbr.ru/currency_base/daily/ · HTTP 404' }))).toMatchObject({ title: 'Открыл cbr.ru/currency_base/daily', result: '404' });
  });
  it('два шага одного сайта с мыслями между — уже группа; мысль после последнего шага — снаружи', () => {
    const f = buildFeed('', [
      ev({ id: '1', title: 'Открывает cbr.ru', detail: 'https://cbr.ru/ · HTTP 200', at: { r: 0, c: 0 } }),
      ev({ id: '2', title: 'Открывает cbr.ru', detail: 'https://cbr.ru/x · HTTP 404', at: { r: 0, c: 0 } }),
    ]);
    expect(kinds(f)).toEqual(['group:2']);
    const R = 'Открою сайт.\nОткрыл главную, но курса нет, попробую другой адрес.\nНашёл курс.\n';
    const a = R.indexOf('Открыл главную'), b = R.indexOf('Нашёл');
    const g = buildFeed(R, [ev({ id: '1', title: 'Открывает cbr.ru', at: { r: a, c: 0 } }), ev({ id: '2', title: 'Открывает cbr.ru', at: { r: b, c: 0 } })]);
    expect(kinds(g)).toEqual(['think', 'group:2', 'think']);
  });
});

describe('место шага Korvex в тексте (живой прогон 30.10)', () => {
  it('сообщение на ходу пришло между «[поиск: …]» и «[найдено: N]» — результат остаётся у поиска, не уходит в текст', () => {
    const R = 'Ищу курс.\n[поиск: курс доллара]\n[найдено: 32 источника]\nВсё готово.\n';
    const at = R.indexOf('[найдено');
    const f = buildFeed(R, [ev({ id: 'st', kind: 'steer', title: 'покороче', status: 'ok', at: { r: at, c: 0 } })]);
    const web = allSteps(f).find((x) => x.kind === 'web')!;
    expect(web.result).toBe('32 источника');
    expect(f.some((x) => x.t === 'think' && x.text.includes('[найдено'))).toBe(false);
    expect(kinds(f)).toEqual(['think', 'step:web', 'step:steer', 'think']);
  });
  it('событие посреди строки — после её конца; превью терминала не отрывается от команды', () => {
    const R = '▸ bash: ls\n    a.txt\n    b.txt\nДальше думаю.\n';
    const f = buildFeed(R, [ev({ id: 'x', kind: 'chat', title: 'Читает чат «А»', at: { r: R.indexOf('a.txt'), c: 0 } })]);
    expect(allSteps(f)[0].term?.out).toEqual(['a.txt', 'b.txt']);
    expect(kinds(f)).toEqual(['step:bash', 'step:chat', 'think']);
  });
});

describe('группы, «сейчас», сводка, история', () => {
  it('подряд действия браузера на одном сайте — группа уже с двух; смена сайта — новая; ожидание и ошибка не прячутся', () => {
    const b = (id: string, title = 'Нажимает «Далее» на hh.ru', status: StepEvent['status'] = 'ok') => ev({ id, title, status });
    expect(kinds(buildFeed('', [b('1'), b('2'), b('3')]))).toEqual(['group:3']);
    expect(kinds(buildFeed('', [b('1'), b('2')]))).toEqual(['group:2']);
    expect(kinds(buildFeed('', [b('1')]))).toEqual(['step:browser']);
    expect(kinds(buildFeed('', [b('1'), b('2'), b('3'), b('4', 'Открывает ozon.ru'), b('5', 'Открывает ozon.ru'), b('6', 'Открывает ozon.ru')]))).toEqual(['group:3', 'group:3']);
    expect(kinds(buildFeed('', [b('1'), b('2'), b('3'), b('4', 'Оплачивает на hh.ru', 'wait_user')]))).toEqual(['group:3', 'step:browser']);
  });
  it('три команды серва подряд с короткими мыслями между ними — одна группа', () => {
    const f = buildFeed('▸ bash: ls\n    a\nДальше.\n▸ bash: pwd\n    /\n▸ bash: whoami\n    me\n');
    expect(kinds(f)).toEqual(['group:3']);
  });
  it('сейчас: ждущий человека главнее выполняющегося; иначе последний выполняющийся; иначе живая мысль', () => {
    expect(nowOf(buildFeed('', [ev({ id: '1', status: 'run' }), ev({ id: '2', status: 'wait_user', ask: { text: 'Оплатить 1 290 ₽?' } })]))).toMatchObject({ kind: 'step', step: { id: '2', status: 'wait' } });
    expect(nowOf(buildFeed('', [ev({ id: '1' }), ev({ id: '2', status: 'run' })]))).toMatchObject({ kind: 'step', step: { id: '2' } });
    expect(nowOf(buildFeed('Думаю, как лучше. Открою сайт магазина', [], true))).toEqual({ kind: 'think', text: 'Думаю, как лучше.' });
    expect(nowOf(buildFeed('Готово.', [], false))).toBeNull();
  });
  it('сводка: «Работал 42 с · 4 шага · 1 ошибка», без шагов — «Думал 12 с»; история — последние шаги', () => {
    const f = buildFeed('▸ bash: ls\n[поиск: a]\n[найдено: 1 источник]\n', [ev({ id: 'x', status: 'err', at: { r: 999, c: 0 } }), ev({ id: 'y', kind: 'chat', title: 'Читает чат «Склад»', at: { r: 999, c: 0 } })]);
    const fmt = (ms: number) => `${Math.round(ms / 1000)} с`;
    expect(summaryLine(f, 42000, fmt)).toBe('Работал 42 с · 4 шага · 1 ошибка');
    expect(summaryLine(buildFeed('Подумал.'), 12000, fmt)).toBe('Думал 12 с');
    expect(historyOf(f, 2).map((s) => s.id)).toEqual(['x', 'y']);
  });
  it('мысль для строки «думает»: последняя законченная фраза без разметки', () => {
    expect(lastSentence('**План:** открыть сайт. Найти `цену`. Сравни')).toBe('Найти цену.');
    expect(lastSentence('x'.repeat(200)).length).toBe(90);
  });
  it('прошедшее время и сайт из заголовка', () => {
    expect(pastTitle('Вводит текст в «Почта»')).toBe('Ввёл текст в поле «Почта»');
    expect(pastTitle('Спрашивает чат «Календарь»')).toBe('Спросил в чате «Календарь»');
    expect(askTitle('Отправляет отклик на hh.ru')).toBe('Отправить отклик на hh.ru?');
    expect(askTitle('Отправляет отклик на hh.ru', true)).toBe('Не стал отправлять отклик на hh.ru');
    expect(pastTitle('Нечто странное')).toBe('Нечто странное');
    expect(hostOf('Открывает https://www.ozon.ru/cart')).toBe('ozon.ru');
    expect(hostOf('Нажимает «Войти» на hh.ru')).toBe('hh.ru');
    expect(hostOf('Нажимает «Войти»')).toBeUndefined();
  });
});

describe('словарь: код, подробности, конец хода', () => {
  it('подпись кода от модели в 1-м лице — сама глагол: «Сравнивает …» -> «Сравнил …»', () => {
    expect(allSteps(buildFeed('▸ python: Сравниваю три вакансии\n', [], true))[0]).toMatchObject({ title: 'Сравнивает три вакансии', sub: undefined });
    expect(allSteps(buildFeed('▸ python: Сравниваю три вакансии\n    ok\n'))[0]).toMatchObject({ title: 'Сравнил три вакансии' });
    expect(allSteps(buildFeed('▸ python: Таблица итогов\n    ok\n'))[0]).toMatchObject({ title: 'Запустил код', sub: 'Таблица итогов' });
  });
  it('короткие подробности — итогом в строке; тесты — значок терминала; после конца хода «идёт» не висит', () => {
    const s = fromEvent(ev({ id: 't', kind: 'code', tool: 'code_run', title: 'Запускает тесты', detail: '24 из 24 прошли' }));
    expect(s).toMatchObject({ title: 'Запустил тесты', sub: '24 из 24 прошли', icon: 'terminal', text: undefined });
    expect(allSteps(buildFeed('', [ev({ id: 'm', kind: 'memory', title: 'Запоминает: кратко', status: 'run' })], false, true))[0]).toMatchObject({ status: 'ok', title: 'Запомнил: кратко' });
  });
});

describe('изменения файлов (агент 5)', () => {
  const D = 'Поправил вход.\n```diff\ndiff --git a/src/login.ts b/src/login.ts\nindex 1..2 100644\n--- a/src/login.ts\n+++ b/src/login.ts\n@@ -1,3 +1,3 @@ export function login\n line1\n-old\n+new\n line3\ndiff --git a/src/new.ts b/src/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,2 @@\n+a\n+b\n```';
  it('блок ```diff в подробностях -> карточка файлов, итог «+3 −1», текст без блока', () => {
    const s = fromEvent(ev({ id: 'g', kind: 'github', title: 'Меняет src/login.ts', detail: D }));
    expect(s.diff!.map((f) => [f.path, f.add, f.del, f.status ?? ''])).toEqual([['src/login.ts', 1, 1, ''], ['src/new.ts', 2, 0, 'added']]);
    expect(s.result).toBe('+3 −1');
    expect(s.text).toBe('Поправил вход.');
    expect(diffStat(s.diff!)).toEqual({ add: 3, del: 1 });
  });
  it('номера строк в кусках', () => {
    const h = parseDiff('--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@ function a\n line1\n-old\n+new\n line3\n')[0].hunks[0];
    expect(h.head).toBe('function a');
    expect(h.lines.map((l) => l.t + (l.a ?? '') + '/' + (l.b ?? ''))).toEqual([' 1/1', '-2/', '+/2', ' 3/3']);
  });
  it('без диффа — undefined', () => { expect(diffOf('просто текст')).toBeUndefined(); });
  it('одинаковые «−/+» — не правка; отличие в пробелах и середина строки — подсветка', () => {
    const f = parseDiff('--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n-same\n-let a = 1;\n+same\n+let a = 2;\n-x  y\n+x y\n')[0];
    expect([f.add, f.del]).toEqual([2, 2]);
    const L = f.hunks[0].lines;
    expect(L.filter((l) => l.t === ' ').map((l) => l.s)).toEqual(['same']);
    const del = L.find((l) => l.t === '-' && l.s === 'let a = 1;')!, add = L.find((l) => l.t === '+' && l.s === 'let a = 2;')!;
    expect(del.hl).toEqual([8, 9]); expect(add.hl).toEqual([8, 9]);
    expect(L.find((l) => l.t === '+' && l.s === 'x y')!.ws).toBe(true);
  });
  it('пара — самая похожая строка, а не по номеру в блоке (настоящий git diff)', () => {
    const f = parseDiff('--- a/x\n+++ b/x\n@@ -1,2 +1,4 @@\n-  const submit = async () => { await login(value); };\n-  return (\n+  const submit = async () => {\n+    try { await login(value); } catch {}\n+  };\n+  return (  \n')[0];
    const ret = f.hunks[0].lines.find((l) => l.t === '+' && l.s === '  return (  ')!;
    expect(ret.ws).toBe(true);
    expect(ret.hl).toEqual([10, 12]);
  });
  it('несколько файлов — «Изменил 2 файла · +3 −1» из диффа', () => {
    expect(fromEvent(ev({ id: 'g', kind: 'code', title: 'Меняет src/login.ts', detail: D }))).toMatchObject({ title: 'Изменил 2 файла', result: '+3 −1' });
  });
});

describe('служебные метки серва не утекают в мысли', () => {
  it('«[найдено: N источников]» и сразу текст — метка в шаг, текст — мыслью без метки', () => {
    const R = ['[поиск: 4 запроса: a · b · c · d]', '    Искал 17 запросов · 388 результатов · 12 страниц прочитано', '    a; b; c; d',
      '[найдено: 388 источников] The user is asking: who revoked the license?', 'Let me search more.', ''].join('\n');
    const items = buildFeed(R, [], false, true);
    const st = items.flatMap((it) => (it.t === 'step' ? [it.step] : [])).find((x) => x.kind === 'web');
    expect(st?.title).toBe('Искал 17 запросов · 388 результатов · 12 страниц');
    const think = items.filter((it) => it.t === 'think').map((it) => (it as { text: string }).text).join('\n');
    expect(think).toContain('The user is asking');
    expect(think).not.toMatch(/\[найдено|Искал 17|388 результатов/);
  });
  it('метка в середине текста (другой порядок строк) — тоже прячется', () => {
    const items = buildFeed('Думаю.\nТекст [найдено: 12 источников] дальше.\n', [], false, true);
    const think = items.filter((it) => it.t === 'think').map((it) => (it as { text: string }).text).join('\n');
    expect(think).not.toContain('[найдено');
  });
  it('строки широкого поиска без шапки шага — шагом, не блоком кода в мысли', () => {
    const items = buildFeed('Мысль.\n    Искал 3 запроса · 20 результатов · 2 страницы прочитано\n    a; b; c\n[найдено: 20 источников]\nДальше.\n', [], false, true);
    const st = items.flatMap((it) => (it.t === 'step' ? [it.step] : [])).find((x) => x.kind === 'web');
    expect(st?.title).toBe('Искал 3 запроса · 20 результатов · 2 страницы');
    expect(items.some((it) => it.t === 'think' && /Искал 3|a; b; c/.test((it as { text: string }).text))).toBe(false);
  });
});
