import { describe, expect, it } from 'vitest';
import { shouldDismiss } from '@/lib/pageSwipe';

describe('жест вбок у полноэкранной страницы', () => {
  const W = 390;
  it('малый сдвиг без скорости — вернуть', () => { expect(shouldDismiss(40, W, 0)).toBe(false); expect(shouldDismiss(-40, W, 0)).toBe(false); });
  it('дальше 30 % ширины — закрыть, в любую сторону', () => { expect(shouldDismiss(140, W, 0)).toBe(true); expect(shouldDismiss(-140, W, 0)).toBe(true); });
  it('быстрый короткий взмах в сторону сдвига — закрыть', () => { expect(shouldDismiss(30, W, 0.9)).toBe(true); expect(shouldDismiss(-30, W, -0.9)).toBe(true); });
  it('далеко, но брошено назад — вернуть', () => { expect(shouldDismiss(160, W, -0.9)).toBe(false); });
  it('без сдвига — ничего', () => { expect(shouldDismiss(0, W, 2)).toBe(false); });
});
