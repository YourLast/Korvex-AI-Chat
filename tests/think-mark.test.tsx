import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { AssistantMsg } from '@/components/Message';
import { HeadMark } from '@/components/HeadMark';
import { MARK_ASPECT, MARK_FULL, MARK_SMALL, MARK_VIEWBOX } from '@/lib/thinkMark';
import type { MsgView } from '@/lib/types';
import type { PublicModel } from '@/lib/models';

const models = [{ id: 'alpha', name: 'Alpha', fullName: 'Alpha', defaultLevel: 'low', levels: [{ id: 'low', label: 'low' }] }] as unknown as PublicModel[];
const msg = (extra: Partial<MsgView>): MsgView => ({ id: 'm1', role: 'assistant', content: '', reasoning: 'Думаю над задачей.', reasoningMs: 27000, meta: { modelId: 'alpha', levelId: 'low' }, ...extra });
const html = (m: MsgView) => renderToStaticMarkup(createElement(AssistantMsg, { m, models }));
const pub = (f: string) => fs.readFileSync(path.join(process.cwd(), 'public', f), 'utf8');

describe('знак Korvex в шапке ответа', () => {
  it('думает: знак live, подпись «Думает» с бликом, точки нет', () => {
    const h = html(msg({ streaming: true, rStartedAt: Date.now(), phase: 'think' }));
    expect(h).toContain('class="tm hm is-live"');
    expect(h).toMatch(/<b class="wk-shim">Думает<\/b>/);
    expect(h).not.toContain('class="wk-dot"');
  });
  it('мысли кончились, идёт ответ / ответ готов: знак не live, блика нет; удачный ход — без позы, просто блик (и со шагами тоже: знак тот же, без отдельной иконки)', () => {
    const answering = html(msg({ streaming: true, content: 'Вот', phase: 'answer' }));
    expect(answering).toContain('class="tm hm"');
    expect(answering).not.toContain('is-live');
    expect(answering).not.toContain('wk-shim');
    expect(answering).not.toContain('data-end=');
    const done = html(msg({ content: 'Готово.' }));
    expect(done).toContain('class="tm hm"');
    expect(done).not.toContain('is-live');
    const steps = html(msg({ content: 'Готово.', reasoning: 'Сделаю файл.\n\n▸ bash: ls -la\n    итого\n[найдено: 3 источника]\n' }));
    expect(steps).toContain('class="tm hm"');
    expect(steps).not.toContain('data-end=');
    expect(steps).not.toContain('#i-check');
  });
  it('ошибка и «остановлено» — свои позы (знак тот же; разметка с сервера — искра, позу проигрывает клиент на конце хода)', () => {
    const err = html(msg({ content: '', meta: { modelId: 'alpha', levelId: 'low', error: 'x' } }));
    const head = (h: string) => /<button[^>]*class="wk-sum"[\s\S]*?<\/button>/.exec(h)?.[0] ?? '';
    expect(head(err)).toContain('data-end="error"'); expect(head(err)).toContain('class="tm hm"'); expect(head(err)).not.toContain('#i-alert"');
    const stop = html(msg({ content: '', meta: { modelId: 'alpha', levelId: 'low', stopped: true } }));
    expect(head(stop)).toContain('data-end="stop"'); expect(head(stop)).not.toContain('#i-stop"');
  });
  it('«Думаю…» до первой мысли: слева живая искра', () => {
    const h = html(msg({ streaming: true, reasoning: '', content: '', phase: 'think' }));
    expect(h).toMatch(/class="t-cap ans-wait"><span class="ans-wait-ic" aria-hidden="true"><svg[^>]*class="tm hm is-live"/);
  });
  it('разметка: малый контур, плотный viewBox, currentColor; пути позы пустые; старых «квадратов» нет', () => {
    const h = renderToStaticMarkup(createElement(HeadMark, { live: false }));
    expect(h).toContain(`viewBox="${MARK_VIEWBOX}"`);
    expect(h).toContain(`d="${MARK_SMALL}"`);
    expect(h).toContain('fill="currentColor"');
    expect(h).toContain('fill-rule="evenodd"');
    expect(h).toContain('<path class="hm-p" fill="currentColor"></path>');
    expect(h).not.toMatch(/<rect|tm--|tm-p|tm-glow/);
    expect(h).not.toContain('data-live');
    expect(renderToStaticMarkup(createElement(HeadMark, { live: true }))).toContain('data-live');
    expect(renderToStaticMarkup(createElement(HeadMark, { live: false, size: 20 }))).toMatch(/style="height:20px;width:11\.8\d*px"/);
  });
  it('контуры в коде и в public/*.svg — одни и те же; плотный viewBox со знаком по границам', () => {
    expect(pub('korvex-mark.svg')).toContain(`d="${MARK_FULL}"`);
    expect(pub('korvex-mark-small.svg')).toContain(`d="${MARK_SMALL}"`);
    expect(pub('korvex-mark-tight.svg')).toContain(`viewBox="${MARK_VIEWBOX}"`);
    expect(pub('korvex-mark-small-tight.svg')).toContain(`d="${MARK_SMALL}"`);
    const [x, y, w, h] = MARK_VIEWBOX.split(' ').map(Number);
    expect(x).toBeLessThan(292); expect(x + w).toBeGreaterThan(708.9); expect(y).toBeLessThan(148.2); expect(y + h).toBeGreaterThan(864.9);
    expect(w / h).toBeCloseTo(MARK_ASPECT, 4);
  });
  it('CSS: без анимаций знака (кадры рисует компонент), только переход цвета позы; высота 1,35em; reduced-motion — блик и переход выключены', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'src/styles/thinkmark.css'), 'utf8');
    expect(css).toContain('height: 1.35em');
    expect(css.replace(/\.wk--live \.wk-sum-t > b\.wk-shim[^\n]*\n/g, '')).not.toMatch(/@keyframes|animation:\s*(?!none)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{[^}]*\.hm \{ transition: none; \}[\s\S]*animation: none/);
    expect(css).toMatch(/\.hm\[data-pose="error"\] \{ color: var\(--neg\); \}/);
  });
});
