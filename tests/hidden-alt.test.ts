import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';
import { unavailableText } from '@/lib/unavailable';

let S: typeof import('@/lib/status');
let M: typeof import('@/lib/models');
beforeAll(async () => {
  const dir = tmpData();
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  process.env.KX_PROBE = '0';
  M = await import('@/lib/models');
  S = await import('@/lib/status');
});

describe('свёрнутая Beta не предлагается взамен Alpha', () => {
  it('в конфигурации Beta свёрнута (иначе тест не о том)', () => {
    expect(M.getModels().find((m) => m.id === 'beta')?.hidden).toBe(true);
    expect(M.publicModels().map((m) => m.id)).toEqual(['alpha']);
  });
  it('Alpha down: отказ без «Попробуйте Beta» и без кнопки другой модели', () => {
    S.setLoad({ state: 'down', model: 'alpha', until: null });
    const u = S.modelUnavailable('alpha', 'UTC')!;
    expect(u.alt).toBeNull();
    expect(u.text).toBe('Alpha временно недоступна. Попробуйте чуть позже.');
    const b = S.statusFor('UTC').banners.map((x) => x.text).join(' ');
    expect(b).not.toMatch(/Beta/);
    S.setLoad({ state: 'normal' });
  });
  it('фраза «не отвечает» у Alpha не зовёт в Beta', () => {
    const shown = M.getModels().filter((m) => !m.hidden && !m.roles);
    const alpha = M.getModels().find((m) => m.id === 'alpha')!;
    expect(unavailableText(alpha, shown)).not.toMatch(/Beta/);
    expect(unavailableText({ ...alpha, unavailableText: undefined }, shown)).toBe(`${alpha.fullName} временно недоступна, попробуйте позже.`);
  });
});
