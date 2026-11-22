import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { AssistantMsg } from '@/components/Message';
import { SETTLE_MS, atBottom, easeOut, holdOf, initView, reduceView, userInput, viewOf, type ViewEvent, type ViewState } from '@/lib/workView';
import type { MsgView } from '@/lib/types';
import type { PublicModel } from '@/lib/models';
import { THINK_DEFAULT } from '@/lib/thinkPref';
THINK_DEFAULT.on = true;

const run = (s: ViewState, ...evs: ViewEvent[]) => evs.reduce(reduceView, s);
const tapOn = (s: ViewState): ViewState => reduceView(s, { t: 'tap', view: viewOf(s) });

describe('виды блока: идёт генерация', () => {
  it('ход открыт во время генерации — окошко; старый ход при открытии чата — строка', () => {
    expect(viewOf(initView(true))).toBe('window');
    expect(viewOf(initView(false))).toBe('line');
  });
  it('строка «Работает…»: окошко -> целиком -> строка -> целиком', () => {
    let s = initView(true);
    s = tapOn(s); expect(viewOf(s)).toBe('full');
    s = tapOn(s); expect(viewOf(s)).toBe('line');
    s = tapOn(s); expect(viewOf(s)).toBe('full');
  });
  it('ход начался в уже открытом чате — окошко; человек уже выбирал — не трогаем', () => {
    expect(viewOf(run(initView(false), { t: 'live' }))).toBe('window');
    const closed = run(initView(true), { t: 'tap', view: 'window' }, { t: 'tap', view: 'full' });
    expect(viewOf(run(closed, { t: 'live' }))).toBe('line');
  });
  it('ждёт решения «Разрешить / Отменить» — целиком (кнопки не прячутся в окошке), после — снова окошко', () => {
    const s = initView(true);
    expect(viewOf(s, true)).toBe('full');
    expect(viewOf(s, false)).toBe('window');
  });
  it('«Вся лента» из бара — целиком', () => {
    expect(viewOf(run(initView(true), { t: 'open' }))).toBe('full');
    expect(viewOf(run(initView(false), { t: 'open' }))).toBe('full');
  });
});

describe('виды блока: генерация закончилась', () => {
  it(`через ${SETTLE_MS} мс — свёрнуто до строки, если человек не выбирал`, () => {
    expect(SETTLE_MS).toBe(1500);
    expect(viewOf(run(initView(true), { t: 'settle' }))).toBe('line');
  });
  it('раскрыл целиком сам — остаётся раскрытым; свернул сам — остаётся строкой', () => {
    const full = run(initView(true), { t: 'tap', view: 'window' }, { t: 'settle' });
    expect(viewOf(full)).toBe('full');
    const line = run(initView(true), { t: 'tap', view: 'window' }, { t: 'tap', view: 'full' }, { t: 'settle' });
    expect(viewOf(line)).toBe('line');
  });
  it('человек читает внутри блока (hold) — окошко не сворачивается', () => {
    expect(viewOf(run(initView(true), { t: 'settle', hold: true }))).toBe('window');
  });
  it('свёрнутое само раскрывается нажатием целиком (не обратно окошком)', () => {
    const s = run(initView(true), { t: 'settle' });
    expect(viewOf(tapOn(s))).toBe('full');
  });
  it('ждал решения на конце — пока ждёт, виден целиком, потом строка', () => {
    const s = run(initView(true), { t: 'settle' });
    expect(viewOf(s, true)).toBe('full');
    expect(viewOf(s, false)).toBe('line');
  });
});

describe('когда не сворачивать и как прокручивать', () => {
  it('фокус или выделение внутри — держим; листал окошко вверх — держим, только пока окошко на экране', () => {
    const o = { focus: false, selection: false, paused: false, onScreen: true };
    expect(holdOf(o)).toBe(false);
    expect(holdOf({ ...o, focus: true })).toBe(true);
    expect(holdOf({ ...o, selection: true })).toBe(true);
    expect(holdOf({ ...o, paused: true })).toBe(true);
    expect(holdOf({ ...o, paused: true, onScreen: false })).toBe(false);
  });
  it('окошко у низа (с допуском 12 px) — автопрокрутка идёт; выше — пауза', () => {
    expect(atBottom(1000, 828, 172)).toBe(true);
    expect(atBottom(1000, 820, 172)).toBe(true);
    expect(atBottom(1000, 700, 172)).toBe(false);
  });
  it('паузу ставит только прокрутка человека: был ввод в окошке не раньше 1,2 с назад', () => {
    expect(userInput(0, 10_000)).toBe(false);
    expect(userInput(9_500, 10_000)).toBe(true);
    expect(userInput(8_000, 10_000)).toBe(false);
  });
  it('плавность: от 0 до 1, без выхода за края', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(2)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});

const models = [{ id: 'alpha', name: 'Alpha', fullName: 'Alpha', defaultLevel: 'low', levels: [{ id: 'low', label: 'low' }] }] as unknown as PublicModel[];
const msg = (extra: Partial<MsgView>): MsgView => ({ id: 'm1', role: 'assistant', content: 'Готово.', reasoning: 'Думаю.\n\n▸ bash: ls -la\n    a.txt\nГотово.\n', reasoningMs: 8000, meta: { modelId: 'alpha', levelId: 'low' }, ...extra });
const html = (m: MsgView) => renderToStaticMarkup(createElement(AssistantMsg, { m, models }));

describe('разметка', () => {
  it('идёт генерация — окошко с лентой внутри; строка над ним раскрыта', () => {
    const h = html(msg({ streaming: true, rStartedAt: Date.now(), content: '', phase: 'think' }));
    expect(h).toContain('data-view="window"');
    expect(h).toMatch(/class="wk-body is-win" data-testid="work-body"><ol class="wk-list"/);
    expect(h).toMatch(/data-testid="work-summary"/);
    expect(h).toMatch(/class="wk-sum" aria-expanded="true"/);
  });
  it('идёт ответ (мысли кончились) — окошко остаётся до конца генерации', () => {
    expect(html(msg({ streaming: true, content: 'Вот', phase: 'answer' }))).toContain('data-view="window"');
  });
  it('старый ход — строка, без ленты; без размышления (off) — без блока', () => {
    const h = html(msg({}));
    expect(h).toContain('data-view="line"');
    expect(h).not.toContain('work-body');
    expect(html(msg({ reasoning: '', reasoningMs: null }))).not.toContain('data-testid="reasoning"');
  });
  it('ждёт решения после ответа — целиком, без окошка', () => {
    const h = html(msg({ steps: [{ id: 'w', kind: 'chat', title: 'Пишет в чат «Склад»', status: 'wait_user', ask: { text: 'Отправить?', allow: 'Отправить' }, at: { r: 0, c: 0 }, round: 0, t0: 1 }] }));
    expect(h).toContain('data-view="full"');
    expect(h).not.toContain('is-win');
  });
  it('стили: высота окошка (телефон 172 px, компьютер выше), без размытия и затуханий у краёв; живая мысль без своей обрезки', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'work.css'), 'utf8');
    expect(css).toMatch(/\.wk \{ --wk-win-h: 224px; \}/);
    expect(css).toMatch(/@media \(max-width: 760px\) \{\s*\.wk \{ --wk-win-h: 172px; \}/);
    const win = /\.wk-body\.is-win \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(win).toContain('max-height: var(--wk-win-h)');
    expect(win).toContain('overflow-y: auto');
    expect(win).toContain('overflow-anchor: none');
    expect(css).not.toMatch(/mask-image|backdrop-filter|filter: blur/);
    expect(css).not.toMatch(/\.wk-think\.is-live \.wk-think-in/);
  });
});
