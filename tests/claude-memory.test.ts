import { beforeAll, describe, expect, it } from 'vitest';
import { tmpData } from './helpers';

let claudeMemory: typeof import('@/lib/jobs').claudeMemory;
beforeAll(async () => {
  tmpData();
  ({ claudeMemory } = await import('@/lib/jobs'));
});

describe('claudeMemory', () => {
  it('нет шагов — строки нет', () => {
    expect(claudeMemory(0, { contextTokens: 1_000_000 })).toBeNull();
  });
  it('вход последнего шага из окна модели', () => {
    const m = claudeMemory(42_000, { contextTokens: 1_000_000 })!;
    expect(m.total_tokens).toBe(42_000);
    expect(m.limit_tokens).toBe(1_000_000);
    expect(m.remaining_tokens).toBe(958_000);
    expect(m.chat_tokens).toBe(42_000);
  });
  it('окно не задано — 1M', () => {
    expect(claudeMemory(10, {})!.limit_tokens).toBe(1_000_000);
  });
});
