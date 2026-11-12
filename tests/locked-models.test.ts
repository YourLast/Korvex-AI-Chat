import { describe, expect, it } from 'vitest';
import { getModels, lockedFor, modelAllowed } from '@/lib/models';
import { modelsFor } from '@/lib/levelPolicy';

describe('закрытые по роли модели', () => {
  const roleBound = getModels().filter((m) => !m.hidden && !m.variantOf && m.roles && !m.roles.includes('user')).map((m) => m.id);
  it('у пользователя: закрытые — ровно модели с полем roles без user; в его списке для выбора их нет', () => {
    expect(roleBound.length).toBeGreaterThan(0);
    expect(lockedFor('user').map((m) => m.id)).toEqual(roleBound);
    const pick = modelsFor('user').map((m) => m.id);
    for (const id of roleBound) expect(pick).not.toContain(id);
    for (const m of getModels().filter((x) => roleBound.includes(x.id))) expect(modelAllowed(m, 'user')).toBe(false);
  });
  it('у администратора закрытых нет; у альфы — только те, где альфы нет в roles', () => {
    expect(lockedFor('admin')).toEqual([]);
    const alphaLocked = getModels().filter((m) => !m.hidden && !m.variantOf && m.roles && !m.roles.includes('alpha')).map((m) => m.id);
    expect(lockedFor('alpha').map((m) => m.id)).toEqual(alphaLocked);
  });
  it('наружу — только id и имя', () => {
    for (const m of lockedFor('user')) expect(Object.keys(m).sort()).toEqual(['id', 'name']);
  });
});
