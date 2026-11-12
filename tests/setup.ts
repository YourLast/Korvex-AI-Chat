import { afterAll } from 'vitest';
import { blocked } from './net-guard';
import '@/components/MarkdownBody';

afterAll(() => {
  if (blocked.length) throw new Error(`Тест пытался выйти в сеть: ${[...new Set(blocked)].join(', ')} — замокайте адрес (tests/net-guard.ts)`);
});
