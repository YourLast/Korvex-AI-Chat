import { describe, expect, it } from 'vitest';
import { parseReasoning, summaryText, toolSummary, type Seg, type ToolStep } from '@/lib/reasoningSteps';

const steps = (segs: Seg[]): ToolStep[] => segs.flatMap((s) => (s.t === 'step' ? [s.step] : []));
const kinds = (segs: Seg[]) => segs.map((s) => (s.t === 'step' ? `step:${s.step.kind}` : s.t));

const BASH = `User's request: Create a text file where "Я собака" is written 100 times.

Let's do it with bash or python.

▸ bash: mkdir -p отчёты && for i in $(seq 1 100); do echo "Я собака"; done > ya_sobaka.txt && wc -l ya_sobaka.txt && head -3 ya_sobaka.
    100 ya_sobaka.txt
    Я собака
    Я собака
    …
Done. File with 100 lines of "Я собака" saved to отчёты.
`;

const MEM_BASH = `Let me do a memory search and list files.

▸ память: текст-файл, txt, записать, выгрузить
    Nothing in your memory matches this query.
▸ bash: ls -la файлы чата отчёты 2>/dev/null; ls skills 2>/dev/null
    файлы чата:
    total 116
    drwxr-xr-x 2 1000 1000   4096 Oct 29 09:55 .
    …
The user's voice message is garbled.
`;

const PY_FAIL = `Let me write the code.

▸ python: Считаю суммарную добычу за июль–сентябрь и сохраняю топ-3 в CSV
    [python failed, exit code 1]
    stderr:
    Traceback (most recent call last):
    …
The file does not exist in файлы чата. Let me check files().

▸ python: Проверяю, какие файлы есть в рабочем месте
    []
There are no files in файлы чата.

[проверка чисел: нет в расчётах — 2 639, 1 193; пересчитываю]
The server is pointing out that 2,639 and 1,193 are not included in my code output.
`;

const WEB = `Let me try searching the web for this.

[поиск: Qwerty3.6-35B-A3B release RL training coding agents]
[найдено: 8 источников]
[поиск: huggingface Qwerty3.6-35B-A3B RL agent fine-tune GGUF SFT]
[найдено: 0 источников]
[выписки: +10]
The user is asking for a list of Hugging Face links.
`;

describe('разбор размышления: настоящие образцы', () => {
  it('bash: команда, превью вывода, «…», статус «готово», текст вокруг — абзацами как был', () => {
    const segs = parseReasoning(BASH);
    expect(kinds(segs)).toEqual(['text', 'step:bash', 'text']);
    const [s] = steps(segs);
    expect(s.query).toBe('mkdir -p отчёты && for i in $(seq 1 100); do echo "Я собака"; done > ya_sobaka.txt && wc -l ya_sobaka.txt && head -3 ya_sobaka.');
    expect(s.out).toEqual(['100 ya_sobaka.txt', 'Я собака', 'Я собака']);
    expect(s.more).toBe(true);
    expect(s.status).toBe('done');
    expect(segs[0]).toEqual({ t: 'text', text: `User's request: Create a text file where "Я собака" is written 100 times.\n\nLet's do it with bash or python.` });
    expect(segs[2]).toEqual({ t: 'text', text: 'Done. File with 100 lines of "Я собака" saved to отчёты.' });
  });

  it('обращение к памяти не показывается — ни запрос, ни найденное; следом bash', () => {
    const segs = parseReasoning(MEM_BASH);
    expect(kinds(segs)).toEqual(['text', 'step:bash', 'text']);
    expect(JSON.stringify(segs)).not.toMatch(/текст-файл|Nothing in your memory|память/);
    const [b] = steps(segs);
    expect(b.out[0]).toBe('файлы чата:');
    expect(b.out).toHaveLength(3);
  });

  it('python: ошибка видна по превью (код выхода по-русски), пустой список — готово; проверка сервера — служебная строка', () => {
    const segs = parseReasoning(PY_FAIL);
    expect(kinds(segs)).toEqual(['text', 'step:python', 'text', 'step:python', 'text', 'note', 'text']);
    const [a, b] = steps(segs);
    expect(a.query).toBe('Считаю суммарную добычу за июль–сентябрь и сохраняю топ-3 в CSV');
    expect(a.status).toBe('error');
    expect(a.out[0]).toBe('Завершилось с ошибкой (код 1)');
    expect(b.status).toBe('done');
    expect(b.out).toEqual(['[]']);
    expect(segs[5]).toEqual({ t: 'note', kind: 'check', text: 'Проверка чисел: нет в расчётах — 2 639, 1 193; пересчитываю' });
  });

  it('веб-поиск: запрос, число источников (склонение), ноль — «ничего не найдено»; «главное из найденного» — служебная строка', () => {
    const segs = parseReasoning(WEB);
    expect(kinds(segs)).toEqual(['text', 'step:web', 'step:web', 'note', 'text']);
    const [a, b] = steps(segs);
    expect(a.query).toBe('Qwerty3.6-35B-A3B release RL training coding agents');
    expect(a.result).toBe('8 источников');
    expect(b.result).toBe('ничего не найдено');
    expect(a.status).toBe('done');
    expect(segs[3]).toEqual({ t: 'note', kind: 'notes', text: 'Главное из найденного: 10 пунктов' });
  });

  it('сводка для шапки', () => {
    expect(summaryText(toolSummary(parseReasoning(MEM_BASH)))).toBe('1 команда');
    expect(summaryText(toolSummary(parseReasoning(PY_FAIL)))).toBe('2 расчёта');
    expect(summaryText(toolSummary(parseReasoning(WEB)))).toBe('2 поиска');
    expect(summaryText(toolSummary(parseReasoning('просто мысль')))).toBe('');
    expect(summaryText({ bash: 5, calc: 1, search: 21 })).toBe('5 команд · 1 расчёт · 21 поиск');
  });
});

const LIVE = `Let me do both. First, create the file using bash, and search for the CBR USD rate.

▸ bash: for i in $(seq 1 20); do echo "Я собака"; done > y_sobaka.txt; echo "--- Проверка ---"; cat -n y_sobaka.txt; echo "--- Кол-во строк: $(wc -l
    --- Проверка ---
    1\tЯ собака
    2\tЯ собака
    …
[поиск: официальный курс доллара ЦБ РФ на 29 октября 2026]
[найдено: 8 источников]
[выписки: +1]
Both tasks done. File created with 20 lines, and the exchange rate found. Let me answer.
`;

describe('разбор размышления: живой образец со стенда', () => {
  it('bash (вывод с табуляцией), поиск в интернете, выписки, текст', () => {
    const segs = parseReasoning(LIVE);
    expect(kinds(segs)).toEqual(['text', 'step:bash', 'step:web', 'note', 'text']);
    const [b, w] = steps(segs);
    expect(b.out).toEqual(['--- Проверка ---', '1\tЯ собака', '2\tЯ собака']);
    expect(b.more).toBe(true);
    expect(w).toMatchObject({ result: '8 источников', status: 'done' });
    expect(summaryText(toolSummary(segs))).toBe('1 команда · 1 поиск');
  });
});

describe('разбор размышления: форматы без рабочей области', () => {
  it('python → подпись и итоги «готово, N симв.», «время вышло», «ошибка»', () => {
    const segs = parseReasoning('[python → Считаю итоги]\n[python: готово, 1234 симв. вывода]\n[python → Долгий расчёт]\n[python: время вышло]\n[python → Сломанный]\n[python: ошибка]\n');
    const [a, b, c] = steps(segs);
    expect(a).toMatchObject({ kind: 'python', query: 'Считаю итоги', status: 'done', out: ['Вывод: 1234 символа'] });
    expect(b.status).toBe('timeout');
    expect(c.status).toBe('error');
  });
  it('поиск в памяти и его итог не показываются; расчёт по таблице и первая строка результата', () => {
    const segs = parseReasoning('[поиск в памяти: договор поставки]\n[в памяти: есть записи]\n[расчёт по таблице: wells.xlsx — сумма по месторождениям]\nИтого: 3 строки\nДальше думаю.\n');
    expect(kinds(segs)).toEqual(['step:table', 'text']);
    expect(JSON.stringify(segs)).not.toMatch(/договор поставки|в памяти/);
    const [t] = steps(segs);
    expect(t).toMatchObject({ query: 'wells.xlsx — сумма по месторождениям', out: ['Итого: 3 строки'], status: 'done' });
  });
  it('время вышло у bash в рабочей области, «нет вывода», сохранённые файлы', () => {
    const segs = parseReasoning('▸ bash: sleep 999\n    [bash stopped: the time limit of 120 s was exceeded — read only the sheet / columns you need, filter early, avoid loops ov…\n▸ bash: touch a\n    (no output)\n▸ python: save\n    ok\n    [files saved to отчёты: top3.csv]\n');
    const [a, b, c] = steps(segs);
    expect(a.status).toBe('timeout');
    expect(a.out).toEqual(['Остановлено: время вышло']);
    expect(b.out).toEqual(['(нет вывода)']);
    expect(c.out).toEqual(['ok', 'Сохранено: top3.csv']);
  });
  it('обычный текст с квадратными скобками и отступами не становится шагом', () => {
    const t = 'Список [1, 2, 3] и [поиск] без двоеточия.\n    код с отступом\n[поиск: без закрывающей скобки\nконец';
    const segs = parseReasoning(t);
    expect(kinds(segs)).toEqual(['text']);
    expect((segs[0] as { text: string }).text).toBe(t);
  });
});

describe('разбор размышления: поток', () => {
  it('шаг пришёл, превью ещё нет: последний и поток идёт — «выполняется»; поток закончился — «готово»', () => {
    const t = 'Думаю.\n\n▸ bash: ls -la\n';
    expect(steps(parseReasoning(t, true))[0].status).toBe('running');
    expect(steps(parseReasoning(t, false))[0].status).toBe('done');
  });
  it('после шага пошёл текст — «готово», даже без превью', () => {
    expect(steps(parseReasoning('▸ bash: ls\nДальше.\n', true))[0].status).toBe('done');
  });
  it('превью пришло — шаг выполнен, даже если он последний', () => {
    expect(steps(parseReasoning('▸ bash: ls\n    a.txt\n', true))[0].status).toBe('done');
  });
  it('поиск ждёт «найдено»: до него — «выполняется», половинка строки итога не показывается текстом', () => {
    const a = parseReasoning('[поиск: курс рубля]\n', true);
    expect(steps(a)[0].status).toBe('running');
    const b = parseReasoning('[поиск: курс рубля]\n[найдено: 3 ист', true);
    expect(kinds(b)).toEqual(['step:web']);
    expect(steps(b)[0].status).toBe('running');
    const c = parseReasoning('[поиск: курс рубля]\n[найдено: 3 источника]\n', true);
    expect(steps(c)[0]).toMatchObject({ status: 'done', result: '3 источника' });
  });
  it('строка шага приходит не целиком: начало маркера прячется, начало команды — уже карточка', () => {
    expect(kinds(parseReasoning('Думаю.\n▸', true))).toEqual(['text']);
    expect(kinds(parseReasoning('Думаю.\n▸ ba', true))).toEqual(['text']);
    const s = parseReasoning('Думаю.\n▸ bash: for i in $(seq', true);
    expect(kinds(s)).toEqual(['text', 'step:bash']);
    expect(steps(s)[0]).toMatchObject({ query: 'for i in $(seq', status: 'running' });
    const w = parseReasoning('Думаю.\n[поиск: курс ру', true);
    expect(steps(w)[0]).toMatchObject({ kind: 'web', query: 'курс ру', status: 'running' });
    expect(kinds(parseReasoning('Думаю.\n[пои', true))).toEqual(['text']);
    expect(kinds(parseReasoning('Думаю.\n[проверка чисел: нет', true))).toEqual(['text']);
  });
  it('незаконченная строка обычного текста видна сразу', () => {
    const s = parseReasoning('Думаю над [1, 2', true);
    expect(s).toEqual([{ t: 'text', text: 'Думаю над [1, 2' }]);
  });
  it('поток растёт — индексы уже показанных шагов не сдвигаются', () => {
    const full = BASH + MEM_BASH;
    let prev: Seg[] = [];
    for (let n = 1; n <= full.length; n += 7) {
      const cur = parseReasoning(full.slice(0, n), true);
      prev.forEach((s, i) => { if (s.t === 'step') expect(cur[i]?.t).toBe('step'); });
      prev = cur;
    }
    expect(kinds(parseReasoning(full))).toEqual(['text', 'step:bash', 'text', 'step:bash', 'text']);
  });
});
