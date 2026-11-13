import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/cfg', () => ({ cfg: (k: string, d = '') => process.env[k] || d }));

const KEYS = ['KX_TITLE_ENGINE_URL', 'KX_TITLE_ENGINE_MODEL', 'KX_TITLE_ENGINE_DEFAULT_URL', 'KX_TITLE_STATE_MODEL', 'KX_OLLAMA_URL', 'KX_LOCAL_MODEL', 'KX_MEMORY_ENGINE_URL', 'KX_MEMORY_ENGINE_MODEL'];
let saved: Record<string, string | undefined> = {};
beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); for (const k of KEYS) delete process.env[k]; });
afterEach(() => { for (const k of KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });

describe('адрес и модель названий и памяти', () => {
  it('только Ollama и локальная модель — туда же (OpenAI-совместимый /v1), модель — локальная', async () => {
    process.env.KX_OLLAMA_URL = 'http://ollama:11434/';
    process.env.KX_LOCAL_MODEL = 'granite4:micro';
    const { gateUrl, gateModel } = await import('@/lib/titles');
    const { curatorUrl } = await import('@/lib/curator');
    expect(gateUrl()).toBe('http://ollama:11434/v1');
    expect(gateModel()).toBe('granite4:micro');
    expect(curatorUrl()).toBe('http://ollama:11434/v1');
    process.env.KX_TITLE_ENGINE_MODEL = 'granite4:tiny';
    expect(gateModel()).toBe('granite4:tiny');
  });
  it('свой адрес главнее: и модель тогда своя; пустой — названия выключены, даже с Ollama', async () => {
    process.env.KX_OLLAMA_URL = 'http://ollama:11434';
    process.env.KX_LOCAL_MODEL = 'granite4:micro';
    const { gateUrl, gateModel } = await import('@/lib/titles');
    process.env.KX_TITLE_ENGINE_URL = 'http://gw:18700/v1/';
    process.env.KX_TITLE_ENGINE_MODEL = 'engine';
    expect([gateUrl(), gateModel()]).toEqual(['http://gw:18700/v1', 'engine']);
    process.env.KX_TITLE_ENGINE_URL = '';
    expect(gateUrl()).toBe('');
  });
  it('без Ollama и без адреса — выключено', async () => {
    const { gateUrl } = await import('@/lib/titles');
    expect(gateUrl()).toBe('');
    process.env.KX_OLLAMA_URL = 'http://ollama:11434';
    expect(gateUrl()).toBe('');
  });
});
