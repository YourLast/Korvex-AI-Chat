import { describe, expect, it } from 'vitest';
import { CLOSE_AT, FAST, closeAt, closePlan, releaseVelocity, rubber, shouldClose, springAt } from '@/lib/sheetDrag';

describe('шторка: когда закрывать', () => {
  const h = 600;
  it('опущена больше 30 % — закрыть, меньше — вернуть', () => {
    expect(shouldClose(h * CLOSE_AT + 1, h, 0)).toBe(true);
    expect(shouldClose(h * CLOSE_AT - 1, h, 0)).toBe(false);
  });
  it('быстрый взмах вниз закрывает даже с малого сдвига; брошена вверх — возвращается даже с большого', () => {
    expect(shouldClose(40, h, FAST + 0.1)).toBe(true);
    expect(shouldClose(40, h, FAST - 0.1)).toBe(false);
    expect(shouldClose(h * 0.6, h, -FAST - 0.1)).toBe(false);
  });
});

describe('шторка: скорость отпускания', () => {
  it('по последним 100 мс; палец остановился — ноль', () => {
    expect(releaseVelocity([{ t: 0, y: 0 }, { t: 50, y: 40 }, { t: 100, y: 100 }], 110)).toBeCloseTo(60 / 50);
    expect(releaseVelocity([{ t: 0, y: 0 }, { t: 20, y: 100 }], 400)).toBe(0);
    expect(releaseVelocity([{ t: 0, y: 0 }], 5)).toBe(0);
  });
});

describe('шторка: движение', () => {
  it('резина вверх: растёт всё медленнее, не больше высоты', () => {
    expect(rubber(0, 600)).toBe(0);
    expect(rubber(50, 600)).toBeLessThan(50);
    expect(rubber(100, 600) - rubber(50, 600)).toBeLessThan(rubber(50, 600));
    expect(rubber(1e6, 600)).toBeLessThan(600);
    expect(rubber(100, 600)).toBeGreaterThan(40);
  });
  it('закрытие продолжает скорость пальца, доезжает до низа и не откатывается назад', () => {
    for (const [x0, v0] of [[120, 0], [120, 0.3], [60, 1.2], [300, 3], [580, 4], [10, 0.6]] as const) {
      const p = closePlan(x0, v0, 600);
      const eps = 0.01;
      expect((closeAt(x0, p, eps) - x0) / eps).toBeCloseTo(Math.max(0, v0), 1);
      expect(closeAt(x0, p, p.T)).toBeCloseTo(600, 3);
      expect(p.T).toBeLessThanOrEqual(260);
      let prev: number = x0;
      for (let t = 0; t <= p.T; t += p.T / 20) { const x = closeAt(x0, p, t); expect(x).toBeGreaterThanOrEqual(prev - 1e-6); prev = x; }
    }
  });
  it('пружина возврата: начинает с места и скорости отпускания, приходит в ноль без раскачки', () => {
    const s0 = springAt(150, 0.4, 0);
    expect(s0.x).toBeCloseTo(150);
    expect(s0.v).toBeCloseTo(0.4);
    expect(Math.abs(springAt(150, 0.4, 900).x)).toBeLessThan(0.5);
    for (let t = 0; t < 900; t += 10) expect(springAt(150, 0, t).x).toBeGreaterThanOrEqual(-1e-6);
  });
});
