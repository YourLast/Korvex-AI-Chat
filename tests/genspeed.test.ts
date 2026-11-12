import { describe, expect, it } from 'vitest';
import { genTick, genTokens, genView, newGen } from '@/lib/genspeed';

describe('скорость генерации: время модели и токены серва', () => {
  it('ровный поток: время от первого куска до последнего, до первого куска — не считается', () => {
    const g = newGen();
    genTick(g, 5000, 'При');
    genTick(g, 5100, 'вет');
    genTick(g, 5300, '!');
    expect(genView(g)).toEqual({ n: 3, ms: 300, c: 7 });
  });
  it('пауза сразу после шага инструмента не входит во время, остальные паузы (ответ блоком) — входят', () => {
    const g = newGen();
    genTick(g, 100, 'Сделаю командой.\n');
    genTick(g, 1100, '▸ bash: echo 1\n');
    genTick(g, 6100, '    1\n');
    genTick(g, 6600, 'Готово.');
    genTick(g, 16600, 'Ответ целиком блоком после проверки чисел');
    expect(genView(g)?.ms).toBe(1000 + 500 + 10000);
  });
  it('токены: из usage серва точно, без usage — оценка по символам со знаком «≈»', () => {
    expect(genTokens({ n: 3, c: 360 }, 120)).toEqual({ n: 120, exact: true });
    expect(genTokens({ n: 3, c: 360 }, null)).toEqual({ n: 100, exact: false });
    expect(genTokens({ n: 9 }, undefined)).toEqual({ n: 9, exact: false });
  });
});
