import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {
  families, familyOf, hasLevel, intensityOf, levelOnSwitch, modelLabel, nearestLevel, normalizeSel, pairChoices, pairFromPrefs, readPrefs, rememberLevel, sameFamily, selFromPrefs, upstreamEffort, variantFor, variantsOf,
  PREF_KEY, type ModelLite,
} from '@/lib/levels';

type CfgLevel = { id: string; label: string; effort: string | null; hint?: string };
type CfgModel = Omit<ModelLite, 'levels'> & { levels: CfgLevel[]; upstreamModel: string; baseUrl: string; maxConcurrent: number; fullName: string };
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests/fixtures/models.json'), 'utf8').replace(/,\s*"hidden": true/g, '')) as { models: CfgModel[] };
const models = cfg.models.filter((m) => !(m as { provider?: string }).provider);
const alpha = models.find((m) => m.id === 'alpha')!;
const beta = models.find((m) => m.id === 'beta')!;

function mem(broken = false) {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => { if (broken) throw new Error('SecurityError'); return m.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (broken) throw new Error('QuotaExceededError'); m.set(k, v); },
    raw: m,
  };
}

describe('конфигурация уровней', () => {
  it('Alpha: off, low, medium, xhigh, max; Beta: off, on (max убран 28.10)', () => {
    expect(alpha.levels.map((l) => l.id)).toEqual(['off', 'low', 'medium', 'xhigh', 'max']);
    expect(beta.levels.map((l) => l.id)).toEqual(['off', 'on']);
    expect(beta.levels.find((l) => l.id === 'on')!.hint).toBe('Размышлять');
    expect(alpha.levels.find((l) => l.id === 'max')!.hint).toBe('Максимально глубоко');
  });
  it('уровни по умолчанию есть в списках', () => {
    for (const m of models) expect(hasLevel(m, m.defaultLevel)).toBe(true);
  });
});

describe('reasoning_effort: off -> "none", остальные — строкой', () => {
  it('у обеих моделей off шлёт "none"', () => {
    expect(upstreamEffort(alpha.levels[0])).toBe('none');
    expect(upstreamEffort(beta.levels[0])).toBe('none');
  });
  it('остальные уровни — их id строкой', () => {
    for (const m of models) for (const l of m.levels.slice(1)) expect(upstreamEffort(l)).toBe(l.id);
  });
  it('effort null или пустая строка — поле не шлётся', () => {
    expect(upstreamEffort({ effort: null })).toBeUndefined();
    expect(upstreamEffort({ effort: '  ' })).toBeUndefined();
  });
});

describe('ближайший уровень при смене модели', () => {
  it('тот же уровень, если он есть', () => {
    expect(nearestLevel(beta, 'off', alpha)).toBe('off');
    expect(nearestLevel(alpha, 'max', beta)).toBe('max');
  });
  it('у Beta нет low/medium/xhigh/max: low -> off (быстро), medium/xhigh/max -> on', () => {
    expect(nearestLevel(beta, 'low', alpha)).toBe('off');
    expect(nearestLevel(beta, 'medium', alpha)).toBe('on');
    expect(nearestLevel(beta, 'xhigh', alpha)).toBe('on');
    expect(nearestLevel(beta, 'max', alpha)).toBe('on');
  });
  it('Beta on -> Alpha xhigh (серв Beta понимает on как xhigh)', () => {
    expect(nearestLevel(alpha, 'on', beta)).toBe('xhigh');
  });
  it('неизвестный id — по положению, без исключений', () => {
    expect(alpha.levels.map((l) => l.id)).toContain(nearestLevel(alpha, 'weird', beta));
  });
});

describe('уровень при переключении модели', () => {
  it('запомненный уровень модели важнее текущего', () => {
    expect(levelOnSwitch(models, 'beta', { modelId: 'alpha', levelId: 'xhigh' }, { beta: 'off' })).toBe('off');
    expect(levelOnSwitch(models, 'alpha', { modelId: 'beta', levelId: 'on' }, { alpha: 'low' })).toBe('low');
  });
  it('запомненного нет — ближайший к текущему', () => {
    expect(levelOnSwitch(models, 'beta', { modelId: 'alpha', levelId: 'low' }, {})).toBe('off');
    expect(levelOnSwitch(models, 'beta', { modelId: 'alpha', levelId: 'max' }, {})).toBe('on');
  });
  it('запомненный уровень, которого больше нет в списке (Beta max), не используется', () => {
    expect(levelOnSwitch(models, 'beta', { modelId: 'alpha', levelId: 'low' }, { beta: 'max' })).toBe('off');
  });
});

describe('нормализация выбора', () => {
  it('известная пара — как есть', () => {
    expect(normalizeSel(models, { modelId: 'beta', levelId: 'on' })).toEqual({ modelId: 'beta', levelId: 'on' });
  });
  it('уровня нет у модели (старый тред Beta max) -> ближайший', () => {
    expect(normalizeSel(models, { modelId: 'beta', levelId: 'max' })).toEqual({ modelId: 'beta', levelId: 'on' });
  });
  it('неизвестная модель -> первая модель с её уровнем по умолчанию', () => {
    expect(normalizeSel(models, { modelId: 'gone', levelId: 'max' })).toEqual({ modelId: 'alpha', levelId: alpha.defaultLevel });
    expect(normalizeSel(models, null)).toEqual({ modelId: 'alpha', levelId: alpha.defaultLevel });
  });
});

describe('запоминание по моделям (localStorage в try/catch)', () => {
  it('уровень каждой модели хранится отдельно, последняя модель — выбранная', () => {
    const st = mem();
    rememberLevel(models, { modelId: 'alpha', levelId: 'xhigh' }, true, st);
    rememberLevel(models, { modelId: 'beta', levelId: 'on' }, true, st);
    const p = readPrefs(models, st);
    expect(p).toMatchObject({ model: 'beta', levels: { alpha: 'xhigh', beta: 'on' } });
    expect(selFromPrefs(models, p)).toEqual({ modelId: 'beta', levelId: 'on' });
    expect(pairFromPrefs(models, p)).toEqual({ a: { modelId: 'alpha', levelId: 'xhigh' }, b: { modelId: 'beta', levelId: 'on' } });
  });
  it('уровень в сравнении запоминается, но выбранную модель не меняет', () => {
    const st = mem();
    rememberLevel(models, { modelId: 'alpha', levelId: 'medium' }, true, st);
    rememberLevel(models, { modelId: 'beta', levelId: 'on' }, false, st);
    expect(readPrefs(models, st)).toMatchObject({ model: 'alpha', levels: { alpha: 'medium', beta: 'on' } });
  });
  it('хранилище бросает исключения — значения по умолчанию, без падения', () => {
    const st = mem(true);
    expect(() => rememberLevel(models, { modelId: 'beta', levelId: 'on' }, true, st)).not.toThrow();
    expect(readPrefs(models, st)).toEqual({ model: 'alpha', levels: {} });
    expect(selFromPrefs(models, readPrefs(models, st))).toEqual({ modelId: 'alpha', levelId: alpha.defaultLevel });
  });
  it('битый JSON и чужие значения игнорируются; уровень вне списка -> ближайший', () => {
    const st = mem();
    st.raw.set(PREF_KEY, '{oops');
    expect(readPrefs(models, st)).toEqual({ model: 'alpha', levels: {} });
    st.raw.set(PREF_KEY, JSON.stringify({ model: 'nope', levels: { beta: 'max', alpha: 7, ghost: 'on' } }));
    expect(readPrefs(models, st)).toEqual({ model: 'alpha', levels: { beta: 'on' } });
  });
  it('сброс 19.11: запомненный medium у Alpha (старое значение по умолчанию) убирается один раз, берется xhigh', () => {
    expect(alpha.defaultLevel).toBe('xhigh');
    const st = mem();
    st.raw.set(PREF_KEY, JSON.stringify({ model: 'alpha', levels: { alpha: 'medium', beta: 'on' } }));
    const p = readPrefs(models, st);
    expect(p.levels).toEqual({ beta: 'on' });
    expect(selFromPrefs(models, p)).toEqual({ modelId: 'alpha', levelId: 'xhigh' });
    expect(JSON.parse(st.raw.get(PREF_KEY)!).reset).toBe(1);
    rememberLevel(models, { modelId: 'alpha', levelId: 'medium' }, true, st);
    expect(selFromPrefs(models, readPrefs(models, st))).toEqual({ modelId: 'alpha', levelId: 'medium' });
    expect(selFromPrefs(models, readPrefs(models, st))).toEqual({ modelId: 'alpha', levelId: 'medium' });
  });
  it('сброс 19.11 не трогает выбранные человеком low/off/max и другие модели', () => {
    for (const lv of ['low', 'off', 'max']) {
      const st = mem();
      st.raw.set(PREF_KEY, JSON.stringify({ model: 'alpha', levels: { alpha: lv } }));
      expect(selFromPrefs(models, readPrefs(models, st))).toEqual({ modelId: 'alpha', levelId: lv });
    }
    const st = mem();
    st.raw.set(PREF_KEY, JSON.stringify({ model: 'alpha', levels: { alpha: 'medium' }, reset: 1 }));
    expect(readPrefs(models, st).levels).toEqual({ alpha: 'medium' });
    rememberLevel(models.map(({ levelReset, ...m }) => (void levelReset, m)), { modelId: 'beta', levelId: 'on' }, false, st);
    expect(readPrefs(models, st).levels).toEqual({ alpha: 'medium', beta: 'on' });
  });
  it('старый ключ kx.sel переносится', () => {
    const st = mem();
    st.raw.set('kx.sel', JSON.stringify({ modelId: 'beta', levelId: 'on' }));
    expect(readPrefs(models, st)).toEqual({ model: 'beta', levels: { beta: 'on' } });
  });
});

describe('насыщенность строки уровней', () => {
  it('растёт к max; Beta on светит как xhigh, а не как max', () => {
    const t = alpha.levels.map((l) => intensityOf(alpha, l.id));
    expect(t).toEqual([...t].sort((a, b) => a - b));
    expect(t[0]).toBe(0); expect(t[4]).toBe(1);
    expect(intensityOf(beta, 'on')).toBe(intensityOf(alpha, 'xhigh'));
    expect(intensityOf(beta, 'on')).toBeLessThan(1);
  });
});

describe('streamChat: тело запроса к шлюзу', () => {
  const bodies: Record<string, unknown>[] = [];
  let srv: http.Server, base = '';
  beforeAll(async () => {
    srv = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        bodies.push(JSON.parse(b));
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const ch = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
        ch({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'ок' }, finish_reason: null }] });
        ch({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  });
  afterAll(() => new Promise<void>((r) => srv.close(() => r())));

  it('каждый уровень Alpha и Beta: off -> "none", остальные -> id; модель — upstreamModel', async () => {
    const { streamChat } = await import('@/lib/upstream');
    const seen: { model: string; level: string; effort: unknown; upstream: unknown }[] = [];
    for (const m of models) {
      for (const l of m.levels) {
        bodies.length = 0;
        const ev = [];
        for await (const e of streamChat({ model: { ...m, baseUrl: base } as never, level: l as never, chatId: 't-1', messages: [{ role: 'user', content: 'привет' }], signal: new AbortController().signal })) ev.push(e);
        expect(ev.at(-1)).toMatchObject({ t: 'done' });
        seen.push({ model: m.id, level: l.id, effort: bodies[0].reasoning_effort, upstream: bodies[0].model });
      }
    }
    expect(seen).toEqual([
      { model: 'alpha', level: 'off', effort: 'none', upstream: 'up-alpha-35b' },
      { model: 'alpha', level: 'low', effort: 'low', upstream: 'up-alpha-35b' },
      { model: 'alpha', level: 'medium', effort: 'medium', upstream: 'up-alpha-35b' },
      { model: 'alpha', level: 'xhigh', effort: 'xhigh', upstream: 'up-alpha-35b' },
      { model: 'alpha', level: 'max', effort: 'max', upstream: 'up-alpha-35b' },
      { model: 'beta', level: 'off', effort: 'none', upstream: 'up-beta-0-4b' },
      { model: 'beta', level: 'on', effort: 'on', upstream: 'up-beta-0-4b' },
      ...(models.some((m) => m.id === 'beta-plain') ? [
        { model: 'beta-plain', level: 'off', effort: 'none', upstream: 'up-beta-0-4b-plain' },
        { model: 'beta-plain', level: 'on', effort: 'on', upstream: 'up-beta-0-4b-plain' },
      ] : []),
    ]);
  });
});

describe('варианты модели (variantOf): одна карточка на семейство', () => {
  const lv = (ids: string[]) => ids.map((id) => ({ id, label: id }));
  const vm = [
    { id: 'alpha', name: 'Alpha', defaultLevel: 'low', levels: lv(['off', 'low', 'medium', 'xhigh', 'max']) },
    { id: 'beta', name: 'Beta', defaultLevel: 'on', levels: lv(['on']), variantName: 'С ускорителем' },
    { id: 'beta-plain', name: 'Beta', defaultLevel: 'off', levels: lv(['off', 'on']), variantOf: 'beta', variantName: 'Без ускорителя' },
  ];
  it('семейства в порядке конфигурации, основная модель первой', () => {
    const f = families(vm);
    expect(f.map((x) => x.id)).toEqual(['alpha', 'beta']);
    expect(f[1].variants.map((m) => m.id)).toEqual(['beta', 'beta-plain']);
    expect(familyOf(vm, 'beta-plain')).toBe('beta');
    expect(familyOf(vm, 'alpha')).toBe('alpha');
    expect(modelLabel(vm, 'beta-plain')).toBe('Beta · Без ускорителя');
    expect(modelLabel(vm, 'alpha')).toBe('Alpha');
  });
  it('вариант с неизвестной основной моделью — сам себе семейство', () => {
    expect(familyOf([...vm, { id: 'x', name: 'X', defaultLevel: 'on', levels: lv(['on']), variantOf: 'ghost' }], 'x')).toBe('x');
  });
  it('выбранный вариант запоминается; сравнение берёт его, а не основную модель', () => {
    const st = mem();
    rememberLevel(vm, { modelId: 'beta-plain', levelId: 'off' }, true, st);
    const p = readPrefs(vm, st);
    expect(p.fam).toEqual({ beta: 'beta-plain' });
    expect(variantFor(vm, 'beta', p)).toBe('beta-plain');
    expect(pairFromPrefs(vm, p)).toEqual({ a: { modelId: 'alpha', levelId: 'low' }, b: { modelId: 'beta-plain', levelId: 'off' } });
    rememberLevel(vm, { modelId: 'beta', levelId: 'on' }, false, st);
    expect(pairFromPrefs(vm, readPrefs(vm, st)).b).toEqual({ modelId: 'beta', levelId: 'on' });
  });
  it('у модели без вариантов fam не пишется (старые настройки не меняются)', () => {
    const st = mem();
    rememberLevel(vm, { modelId: 'alpha', levelId: 'xhigh' }, true, st);
    expect(readPrefs(vm, st).fam).toBeUndefined();
  });
  it('одно семейство с двумя вариантами — сравнение вариантов друг с другом', () => {
    const one = vm.slice(1);
    expect(pairFromPrefs(one, readPrefs(one, mem()))).toEqual({ a: { modelId: 'beta', levelId: 'on' }, b: { modelId: 'beta-plain', levelId: 'off' } });
  });
});

describe('варианты для выбора пары в сравнении', () => {
  const lv = (ids: string[]) => ids.map((id) => ({ id, label: id }));
  const vm = [
    { id: 'alpha', name: 'Alpha', defaultLevel: 'low', levels: lv(['low']) },
    { id: 'beta', name: 'Beta', defaultLevel: 'on', levels: lv(['on']), variantName: 'С ускорителем' },
    { id: 'beta-plain', name: 'Beta', defaultLevel: 'off', levels: lv(['off', 'on']), variantOf: 'beta', variantName: 'Без ускорителя' },
  ];
  it('все модели семейство за семейством, с подписями; пара из одного семейства — сравнение вариантов', () => {
    expect(pairChoices(vm)).toEqual([
      { id: 'alpha', label: 'Alpha', familyId: 'alpha', variant: null, isBase: true },
      { id: 'beta', label: 'Beta · С ускорителем', familyId: 'beta', variant: 'С ускорителем', isBase: true },
      { id: 'beta-plain', label: 'Beta · Без ускорителя', familyId: 'beta', variant: 'Без ускорителя', isBase: false },
    ]);
    expect(sameFamily(vm, 'beta', 'beta-plain')).toBe(true);
    expect(sameFamily(vm, 'alpha', 'beta')).toBe(false);
    expect(variantsOf(vm, 'beta').map((m) => m.id)).toEqual(['beta', 'beta-plain']);
    expect(variantsOf(vm, 'ghost')).toEqual([]);
  });
});
