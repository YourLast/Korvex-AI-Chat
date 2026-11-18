// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '@/lib/clipboard';

afterEach(() => { vi.unstubAllGlobals(); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }); });

describe('copyText', () => {
  it('https: navigator.clipboard', async () => {
    const w = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: w } });
    expect(await copyText('abc')).toBe(true);
    expect(w).toHaveBeenCalledWith('abc');
  });
  it('http: буфера нет — выделенный textarea и execCommand, textarea убирается', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    let got = '';
    document.execCommand = vi.fn(() => { got = (document.activeElement as HTMLTextAreaElement | null)?.value ?? document.querySelector('textarea')?.value ?? ''; return true; }) as typeof document.execCommand;
    expect(await copyText('строка')).toBe(true);
    expect(got).toBe('строка');
    expect(document.querySelector('textarea')).toBeNull();
  });
  it('отказ буфера — тот же запасной путь; не вышло — false', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
    document.execCommand = vi.fn(() => false) as typeof document.execCommand;
    expect(await copyText('x')).toBe(false);
  });
});
