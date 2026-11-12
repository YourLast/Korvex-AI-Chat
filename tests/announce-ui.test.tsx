import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Announce, StatusCtx } from '@/components/Announce';
import { PickerButton, PickerPanel } from '@/components/ModelPicker';
import { AssistantMsg } from '@/components/Message';
import type { StatusView } from '@/lib/announce';
import type { PublicModel } from '@/lib/models';
import type { MsgView } from '@/lib/types';

const models = [
  { id: 'alpha', name: 'Alpha', fullName: 'Alpha', blurb: 'умная', defaultLevel: 'low', levels: [{ id: 'low', label: 'low', hint: 'Быстро' }] },
  { id: 'beta', name: 'Beta', fullName: 'Beta', blurb: 'лёгкая', defaultLevel: 'off', levels: [{ id: 'off', label: 'off', hint: 'Без размышления' }] },
] as unknown as PublicModel[];
const st = (over: Partial<StatusView> = {}): StatusView => ({ now: 1, banners: [], models: { alpha: { state: 'ok', until: null }, beta: { state: 'ok', until: null } }, ...over });
const wrap = (s: StatusView | null, el: React.ReactElement) => renderToStaticMarkup(createElement(StatusCtx.Provider, { value: s }, el));

describe('полоса объявлений', () => {
  it('нет объявлений — ничего не рисуется', () => {
    expect(wrap(st(), createElement(Announce))).toBe('');
    expect(wrap(null, createElement(Announce))).toBe('');
  });
  it('объявление и сообщение о нагрузке — две полосы с уровнем и кнопкой «Скрыть»', () => {
    const h = wrap(st({ banners: [{ id: 'manual', sig: 'm1', level: 'info', text: 'Плановые работы' }, { id: 'load', sig: 'l2', level: 'warn', text: 'Alpha временно недоступна (обучение)' }] }), createElement(Announce));
    expect(h).toContain('data-testid="ann-manual"');
    expect(h).toContain('ann--info');
    expect(h).toContain('Плановые работы');
    expect(h).toContain('ann--warn');
    expect(h).toContain('role="alert"');
    expect(h.match(/aria-label="Скрыть объявление"/g)).toHaveLength(2);
  });
});

describe('метки моделей', () => {
  const s = st({ models: { alpha: { state: 'down', until: null }, beta: { state: 'slow', until: null } } });
  it('в меню: «временно недоступна» и «медленно — идёт обучение»; «работает» не пишем', () => {
    const panel = (x: StatusView | null) => wrap(x, createElement(PickerPanel, { models, compare: false, sel: { modelId: 'alpha', levelId: 'low' }, onModel: () => {}, onLevel: () => {} }));
    const h = panel(s);
    expect(h).toContain('временно недоступна');
    expect(h).toContain('медленно — идёт обучение');
    expect(panel(st())).not.toContain('работает');
    expect(panel(null)).not.toContain('st-dot');
  });
  it('на чипе: недоступная модель — слово «недоступна» и в подписи кнопки; рабочая — без метки (статус — только когда важен)', () => {
    const chip = (x: StatusView, id: string) => wrap(x, createElement(PickerButton, { models, compare: false, sel: { modelId: id, levelId: id === 'alpha' ? 'low' : 'off' }, onModel: () => {}, onLevel: () => {} }));
    const down = chip(s, 'alpha');
    expect(down).toContain('недоступна');
    expect(down).toContain('aria-label="Модель и уровень: Alpha low, временно недоступна"');
    const ok = chip(st(), 'beta');
    expect(ok).not.toContain('st-dot');
    expect(ok).not.toContain('недоступна');
  });
});

describe('отказ «модель недоступна» под сообщением', () => {
  const m: MsgView = { id: 'a-1', role: 'assistant', content: '', meta: { modelId: 'alpha', levelId: 'low', error: 'x', errorUser: 'Alpha временно недоступна до ~14:30. Попробуйте Beta.', altModel: { id: 'beta', name: 'Beta' } } };
  it('фраза и кнопка переключения — если есть обработчик', () => {
    const h = renderToStaticMarkup(createElement(AssistantMsg, { m, models, onAlt: () => {} }));
    expect(h).toContain('Попробуйте Beta.');
    expect(h).toContain('Переключить на Beta и отправить');
    expect(renderToStaticMarkup(createElement(AssistantMsg, { m, models }))).not.toContain('Переключить');
  });
});
