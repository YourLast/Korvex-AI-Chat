import { afterEach, describe, expect, it } from 'vitest';
import { tmpData } from './helpers';
tmpData();
import { featureMap, featureOn, setFeature, shownFeatures } from '@/lib/features';

afterEach(() => { delete process.env.KX_CODE_GONE; });

describe('облачный агент и git скрыты', () => {
  it('по умолчанию выключен даже с записью администратора; в списке функций админки его нет', () => {
    setFeature('code', true, null);
    expect(featureOn('code')).toBe(false);
    expect(featureMap(null).code).toBe(false);
    expect(shownFeatures()).not.toContain('code');
    expect(shownFeatures()).toContain('voice');
  });
  it('KX_CODE_GONE=0 — как раньше: запись администратора включает', () => {
    process.env.KX_CODE_GONE = '0';
    setFeature('code', true, null);
    expect(featureOn('code')).toBe(true);
    expect(shownFeatures()).toContain('code');
  });
});
