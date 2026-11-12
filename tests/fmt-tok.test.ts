import { describe, expect, it } from 'vitest';
import { fmtTok, fmtTokLang } from '@/lib/format';

describe('fmtTok', () => {
  it('малые и K как раньше', () => {
    expect(fmtTok(512)).toBe('512');
    expect(fmtTok(13 * 1024)).toBe('13K');
    expect(fmtTok(2.5 * 1024)).toBe('2,5K');
    expect(fmtTok(999 * 1024)).toBe('999K');
  });
  it('1000K и выше — уже M, без «1005K»', () => {
    expect(fmtTok(999.6 * 1024)).toBe('1M');
    expect(fmtTok(1005 * 1024)).toBe('1M');
    expect(fmtTok(1048576)).toBe('1M');
    expect(fmtTok(1.01 * 1048576)).toBe('1,01M');
    expect(fmtTok(5.5 * 1048576)).toBe('5,5M');
    expect(fmtTokLang('en', 1005 * 1024)).toBe('1M');
    expect(fmtTokLang('en', 1.25 * 1048576)).toBe('1.25M');
  });
  it('растёт без шага назад', () => {
    let prev = 0;
    for (let n = 990 * 1024; n < 1.1 * 1048576; n += 337) {
      const s = fmtTok(n);
      const v = s.endsWith('M') ? parseFloat(s.replace(',', '.')) * 1048576 : parseFloat(s) * 1024;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
