import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';

const dir = tmpData();
describe('только просмотр', () => {
  it('флаг -> полоса «работает резервный сервер»; снят -> полосы нет', async () => {
    const { statusFor } = await import('@/lib/status');
    const { readOnly } = await import('@/lib/readonly');
    expect(readOnly()).toBeNull();
    expect(statusFor('Europe/Moscow').banners.some((b) => b.id === 'readonly')).toBe(false);
    fs.writeFileSync(path.join(dir, 'readonly.json'), JSON.stringify({ since: 123, reason: 'тест', url: 'chat.example.com' }));
    expect(readOnly()).toEqual({ since: 123, reason: 'тест', url: 'chat.example.com' });
    const b = statusFor('Europe/Moscow').banners.find((x) => x.id === 'readonly');
    expect(b).toMatchObject({ level: 'warn', sig: 'ro123' });
    expect(b!.text).toContain('откройте chat.example.com');
    fs.renameSync(path.join(dir, 'readonly.json'), path.join(dir, 'readonly.json.done'));
    expect(readOnly()).toBeNull();
  });
});
