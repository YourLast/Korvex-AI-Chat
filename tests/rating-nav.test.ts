import { describe, expect, it } from 'vitest';
import { currentIndex, navMarks, posByIndex, posOf, stepMark, summarize, viewport } from '@/lib/ratingNav';
import type { Mark } from '@/lib/adminTypes';

const mk = (id: string, messageId: string, value: 1 | -1, onPath = true, at = 0): Mark => ({ id, messageId, value, reasons: [], comment: '', at, onPath, model: null });
const marks = [mk('r3', 'a3', -1, true, 4), mk('r1', 'a1', -1, true, 1), mk('r1b', 'a1b', -1, false, 2), mk('r2', 'a2', 1, true, 3)];
const order = new Map([['u1', 0], ['a1', 1], ['u2', 2], ['a2', 3], ['u3', 4], ['a3', 5]]);

describe('карта и навигация по оценкам', () => {
  it('в навигации — оценки показанной ветки сверху вниз; фильтр по знаку; другая версия не мешает', () => {
    expect(navMarks(marks, order, 'all').map((m) => m.id)).toEqual(['r1', 'r2', 'r3']);
    expect(navMarks(marks, order, 'down').map((m) => m.id)).toEqual(['r1', 'r3']);
    expect(navMarks(marks, order, 'up').map((m) => m.id)).toEqual(['r2']);
    expect(navMarks([], order, 'all')).toEqual([]);
  });

  it('сводка: сколько плохих и хороших, сколько на других версиях', () => {
    expect(summarize(marks)).toEqual({ up: 1, down: 3, other: 1 });
    expect(summarize([])).toEqual({ up: 0, down: 0, other: 0 });
  });

  const list = [{ id: 'r1', y: 100 }, { id: 'r2', y: 900 }, { id: 'r3', y: 1700 }];
  it('«След.» от положения ленты: ближайшая ниже линии; после последней — первая', () => {
    expect(stepMark(list, 1, { cur: null, scrolled: true, anchor: 0 })).toBe('r1');
    expect(stepMark(list, 1, { cur: null, scrolled: true, anchor: 500 })).toBe('r2');
    expect(stepMark(list, 1, { cur: null, scrolled: true, anchor: 1700 })).toBe('r1');
    expect(stepMark(list, 1, { cur: null, scrolled: true, anchor: 5000 })).toBe('r1');
  });
  it('«Пред.»: ближайшая выше линии; перед первой — последняя', () => {
    expect(stepMark(list, -1, { cur: null, scrolled: true, anchor: 1000 })).toBe('r2');
    expect(stepMark(list, -1, { cur: null, scrolled: true, anchor: 900 })).toBe('r1');
    expect(stepMark(list, -1, { cur: null, scrolled: true, anchor: 50 })).toBe('r3');
  });
  it('только что прыгнули и ленту не двигали — шаг от этой оценки (даже если её нельзя поставить под шапку у конца чата)', () => {
    const o = { cur: 'r3', scrolled: false, anchor: 1500 };
    expect(stepMark(list, 1, o)).toBe('r1');
    expect(stepMark(list, -1, o)).toBe('r2');
    expect(stepMark(list, 1, { cur: 'r1', scrolled: false, anchor: 0 })).toBe('r2');
    expect(stepMark(list, 1, { cur: 'r1', scrolled: true, anchor: 1000 })).toBe('r3');
    expect(stepMark([], 1, { cur: null, scrolled: true, anchor: 0 })).toBeNull();
    expect(stepMark([{ id: 'x', y: 10 }], -1, { cur: 'x', scrolled: false, anchor: 0 })).toBe('x');
  });
  it('«N из M»: номер оценки, на которой стоим, или ближайшей к линии', () => {
    expect(currentIndex(list, { cur: 'r2', scrolled: false, anchor: 0 })).toBe(2);
    expect(currentIndex(list, { cur: null, scrolled: true, anchor: 1600 })).toBe(3);
    expect(currentIndex(list, { cur: null, scrolled: true, anchor: 0 })).toBe(1);
    expect(currentIndex([], { cur: null, scrolled: true, anchor: 0 })).toBe(0);
  });

  it('положение на полосе: доля длины чата, в пределах 0…1; до замера — по номеру сообщения', () => {
    expect(posOf(500, 2000)).toBe(0.25);
    expect(posOf(-5, 2000)).toBe(0);
    expect(posOf(5000, 2000)).toBe(1);
    expect(posOf(10, 0)).toBe(0);
    expect(posByIndex(0, 6)).toBeCloseTo(1 / 12);
    expect(posByIndex(5, 6)).toBeCloseTo(11 / 12);
    expect(posByIndex(0, 1)).toBe(0);
  });
  it('окно просмотра на полосе: где мы сейчас', () => {
    expect(viewport(0, 500, 2000)).toEqual({ top: 0, h: 0.25 });
    expect(viewport(1500, 500, 2000)).toEqual({ top: 0.75, h: 0.25 });
    expect(viewport(2000, 500, 2000)).toEqual({ top: 1, h: 0 });
    expect(viewport(0, 500, 0)).toEqual({ top: 0, h: 1 });
  });
});
