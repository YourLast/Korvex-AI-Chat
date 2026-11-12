import { describe, expect, it } from 'vitest';
import { IDLE_MS, activeNow } from '@/lib/live';
import { decide } from '@/lib/notify';

const now = 1_790_000_000_000;
const j = { threadId: 't1', kind: 'chat', status: 'done', createdAt: now - 600_000 } as const;
const dev = (device: string, visible: boolean, active: boolean | undefined, threads: string[]) => ({ userId: 'u', device, visible, active, threads, since: now, seen: now });
const run = (presence: ReturnType<typeof dev>[]) => decide(j as never, { presence, chat: [], muted: false, quiet: false, now });

describe('простой вкладки и push', () => {
  it('трогали за 3 мин — активна; дольше — простой', () => {
    expect(activeNow(now - 60_000, now)).toBe(true);
    expect(activeNow(now - IDLE_MS - 1, now)).toBe(false);
  });
  it('компьютер открыт на другом чате и простаивает, телефон в фоне — push', () => {
    expect(run([dev('mac', true, false, ['t9']), dev('iphone', false, true, [])])).toBe('push');
  });
  it('компьютер открыт на другом чате и его трогают — тост в приложении, без push', () => {
    expect(run([dev('mac', true, true, ['t9']), dev('iphone', false, true, [])])).toBe('toast');
  });
  it('чат на экране, человек ждёт не трогая — ни push, ни тоста', () => {
    expect(run([dev('iphone', true, false, ['t1'])])).toBe('none');
  });
  it('старый клиент без признака active — как раньше (видимая вкладка = приложение открыто)', () => {
    expect(run([dev('mac', true, undefined, ['t9'])])).toBe('toast');
  });
});
