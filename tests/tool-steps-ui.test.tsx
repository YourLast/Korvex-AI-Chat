import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AssistantMsg, speedText } from '@/components/Message';
import { closeOpen } from '@/components/ToolSteps';
import type { MsgView } from '@/lib/types';
import type { PublicModel } from '@/lib/models';
import { THINK_DEFAULT } from '@/lib/thinkPref';
THINK_DEFAULT.on = true;

const models = [{ id: 'alpha', name: 'Alpha', fullName: 'Alpha', defaultLevel: 'low', levels: [{ id: 'low', label: 'low' }] }] as unknown as PublicModel[];
const msg = (reasoning: string, extra: Partial<MsgView> = {}): MsgView => ({
  id: 'm1', role: 'assistant', content: 'Готово.', reasoning, reasoningMs: 8000, meta: { modelId: 'alpha', levelId: 'low' }, ...extra,
});
const html = (m: MsgView) => renderToStaticMarkup(createElement(AssistantMsg, { m, models }));
const R = `Сделаю файл.

▸ bash: mkdir -p отчёты && for i in $(seq 1 100); do echo "Я собака"; done > ya_sobaka.txt
    100 ya_sobaka.txt
    Я собака
    …
[поиск: курс рубля сегодня]
[найдено: 3 источника]
Готово.
`;

const live = (reasoning: string, extra: Partial<MsgView> = {}) => msg(reasoning, { streaming: true, rStartedAt: Date.now(), content: '', phase: 'think', ...extra });

describe('лента «работает» в ответе', () => {
  it('готовый ответ: лента свёрнута в сводку «Работал 8 с · 2 шага», служебных строк серва нет', () => {
    const h = html(msg(R));
    expect(h).toContain('data-testid="reasoning"');
    expect(h).toMatch(/data-testid="work-done"><b>Работал 8 с · 2 шага<\/b>/);
    expect(h).not.toContain('data-testid="work-list"');
    expect(h).not.toContain('▸ bash');
    expect(h).not.toContain('[найдено');
  });
  it('во время работы — раскрыта: «Выполнил» + команда, «Искал «курс рубля сегодня»» + «3 источника», успех без слова «готово»', () => {
    const h = html(live(R));
    expect(h.match(/data-testid="work-step"/g)).toHaveLength(2);
    expect(h).toContain('<b class="wk-title">Выполнил</b><span class="wk-sub" data-testid="work-sub">mkdir -p отчёты');
    expect(h).toContain('<b class="wk-title">Искал</b><span class="wk-sub" data-testid="work-sub">«курс рубля сегодня»</span>');
    expect(h).toContain('3 источника');
    expect(h).not.toMatch(/data-testid="work-status">готово/);
    expect(h).not.toMatch(/<pre/);
    expect(h).toContain('Сделаю файл.');
  });
  it('шаг идёт — живой значок шага (08.11: вместо точки «сейчас») и глагол в настоящем; в шапке — только «Работает» (что делается — в строке и в баре, не трижды)', () => {
    const h = html(live('Думаю.\n▸ bash: ls -la\n'));
    expect(h).toContain('data-status="run"');
    expect(h).toContain('<b class="wk-title">Выполняет</b>');
    expect(h).toMatch(/data-ai="terminal" data-st="run"/);
    expect(h).not.toContain('class="wk-dot"');
    expect(h).toMatch(/<b class="wk-shim">Работает<\/b>/);
    expect(h).toMatch(/data-testid="work-now"><b class="wk-shim">Работает<\/b>/);
    expect(h.match(/>Выполняет</g)).toHaveLength(1);
  });
  it('тексты — без устройства системы', () => {
    const h = html(live(R + '▸ память: договор\n    Nothing in your memory matches this query.\n[python → Итоги]\n[python: готово, 12 симв. вывода]\n[расчёт по таблице: a.xlsx — сумма]\nИтого 5\n'));
    const ui = h.replace(/<span class="wk-sub"[^>]*>[^<]*<\/span>/g, '').replace(/<div class="wk-think-in think-md">.*?<\/div><\/div>/g, '');
    for (const w of ['Korvex', 'окно', 'фрагмент', 'токен', 'рабочая область', '/work', 'Nothing in your memory', 'tool_call']) expect(ui).not.toContain(w);
    expect(h).not.toContain('Искал в файлах');
    expect(h).not.toContain('договор');
    expect(h).toContain('Запустил код');
    expect(h).toContain('Посчитал по таблице');
  });
  it('шаг Korvex с миниатюрой: снимок справа — кнопка просмотрщика картинок (data-iv), подпись с действием', () => {
    const shot = { kind: 'image' as const, fileId: 'f1', url: '/api/files/f1', name: 'Снимок.png', mime: 'image/png', size: 1, w: 1280, h: 800 };
    const h = html(live('Открою сайт.\n', { steps: [{ id: 's1', kind: 'browser', title: 'Открывает ozon.ru', status: 'ok', at: { r: 12, c: 0 }, round: 0, t0: 1, thumb: shot }] }));
    expect(h).toContain('<b class="wk-title">Открыл сайт ozon.ru</b>');
    expect(h).toMatch(/data-iv="" data-iv-src="\/api\/files\/f1"/);
    expect(h).toContain('aria-label="Снимок экрана: Открыл сайт ozon.ru — открыть на весь экран"');
  });
  it('ждёт решения — в ленте вопрос и «Отменить / Разрешить» (подпись — действие), лента раскрыта даже после ответа', () => {
    const h = html(msg('Спрошу.\n', { steps: [{ id: 'w', kind: 'chat', title: 'Пишет в чат «Склад»', status: 'wait_user', ask: { text: 'Отправить «Привет» в чат «Склад»?', allow: 'Отправить' }, at: { r: 8, c: 0 }, round: 0, t0: 1 }] }));
    expect(h).toContain('data-testid="work-ask"');
    expect(h).toContain('Отправить «Привет» в чат «Склад»?');
    expect(h).toMatch(/data-testid="ask-allow">Отправить</);
    expect(h).toMatch(/data-testid="ask-deny">Отменить</);
    expect(h).toContain('ждёт вас');
  });
});

describe('Markdown в мыслях', () => {
  it('жирный, списки, инлайн-код и заголовок — разметкой, а не сырым текстом; шаг — строкой', () => {
    const h = html(live('## План\n\n**Главное:** посчитать итог.\n\n* первый шаг\n* второй шаг\n\nПроверю `wc -l`.\n▸ bash: wc -l a.txt\n    3 a.txt\nДальше.\n'));
    expect(h).toContain('<h2>План</h2>');
    expect(h).toContain('<strong>Главное:</strong>');
    expect(h).toMatch(/<ul>\s*<li>первый шаг<\/li>/);
    expect(h).toContain('<code>wc -l</code>');
    expect(h).not.toContain('**');
    expect(h.match(/data-testid="work-step"/g)).toHaveLength(1);
  });
  it('поток: незакрытый ** закрывается (жирный сразу), одинокий ** в конце убирается, открытый ``` закрывается', () => {
    expect(closeOpen('Сначала **важн')).toBe('Сначала **важн**');
    expect(closeOpen('Сначала **')).toBe('Сначала ');
    expect(closeOpen('Готово **да** и `код')).toBe('Готово **да** и `код`');
    expect(closeOpen('Код:\n```python\nprint(1)')).toBe('Код:\n```python\nprint(1)\n```');
    expect(closeOpen('**а** и **б**')).toBe('**а** и **б**');
    expect(html(live('Думаю. **Важно: проверить'))).toContain('<strong>Важно: проверить</strong>');
  });
});

describe('скорость генерации в шапке ответа', () => {
  it('итог — из usage: токены вместе с размышлением / время от первого куска до последнего', () => {
    expect(speedText({ meta: { gen: { ms: 12_000, n: 300, tokens: 504 } } })).toBe('42 ток/с');
    expect(speedText({ meta: { gen: { ms: 4000, n: 30, tokens: 30 } } })).toBe('7,5 ток/с');
  });
  it('без usage и во время потока — приблизительно, по кускам, со знаком ≈', () => {
    expect(speedText({ meta: { gen: { ms: 10_000, n: 200, tokens: null } } })).toBe('≈ 20 ток/с');
    expect(speedText({ streaming: true, liveGen: { n: 90, ms: 3000 }, meta: {} })).toBe('≈ 30 ток/с');
  });
  it('старые сообщения без данных и слишком короткие замеры — не показываем', () => {
    expect(speedText({ meta: {} })).toBeNull();
    expect(speedText({ meta: { gen: { ms: 300, n: 40, tokens: 40 } } })).toBeNull();
    expect(speedText({ streaming: true, meta: {} })).toBeNull();
    const h = html(msg('Мысль.', { meta: { modelId: 'alpha', levelId: 'low', durationMs: 13_000, gen: { ms: 12_000, n: 300, tokens: 504 } } }));
    expect(h).toMatch(/13 с<\/span><span class="sep"><\/span><span class="tnum ans-speed" data-testid="speed"[^>]*>42 ток\/с/);
  });
});

describe('ход, кончившийся ошибкой (QA 31.10)', () => {
  it('сводка ленты — «Ошибка · работал …» со значком ошибки, а не «✓ Работал …»', () => {
    const R = '▸ bash: ls\n    a\n    b\nДальше.\n';
    const m = msg(R, { content: '', meta: { modelId: 'alpha', levelId: 'low', durationMs: 720000, error: 'upstream 502', errorUser: 'Не удалось получить ответ' } } as Partial<MsgView>);
    const h = html(m);
    expect(h).toMatch(/data-testid="work-done"><b>Ошибка · работал 12 мин/);
    expect(h).not.toMatch(/data-testid="work-done"><b>Работал/);
  });
  it('остановленный — «Остановлено · …»', () => {
    const m = msg('▸ bash: ls\n    a\n', { meta: { modelId: 'alpha', levelId: 'low', durationMs: 5000, stopped: true } } as Partial<MsgView>);
    expect(html(m)).toMatch(/data-testid="work-done"><b>Остановлено · работал/);
  });
});
