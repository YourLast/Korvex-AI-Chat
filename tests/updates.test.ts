import { afterEach, describe, expect, it } from 'vitest';
import { checkUpdate, newerThan } from '@/lib/updates';

const gh = (tag: string, status = 200) => (async () => new Response(JSON.stringify({ tag_name: tag, html_url: `https://github.com/x/y/releases/tag/${tag}`, body: 'notes' }), { status })) as unknown as typeof fetch;
afterEach(() => { delete process.env.KX_UPDATE_REPO; });

describe('обновления', () => {
  it('сравнение версий', () => {
    expect(newerThan('0.2.0', '0.1.9')).toBe(true);
    expect(newerThan('v1.0.0', '0.9.9')).toBe(true);
    expect(newerThan('0.1.0', '0.1.0')).toBe(false);
    expect(newerThan('0.1.0', '0.10.0')).toBe(false);
  });
  it('новее — баннер; кэш 12 часов; force — сейчас; ошибка GitHub — без баннера', async () => {
    process.env.KX_UPDATE_REPO = 'x/y';
    const a = await checkUpdate({ force: true, now: 1_000, doFetch: gh('v99.0.0') });
    expect(a).toMatchObject({ latest: '99.0.0', newer: true, url: 'https://github.com/x/y/releases/tag/v99.0.0' });
    expect((await checkUpdate({ now: 2_000, doFetch: gh('v100.0.0') })).latest).toBe('99.0.0');
    expect((await checkUpdate({ force: true, now: 3_000, doFetch: gh('v0.0.1') })).newer).toBe(false);
    const e = await checkUpdate({ force: true, now: 4_000, doFetch: gh('x', 503) });
    expect(e).toMatchObject({ newer: false, latest: null, error: 'GitHub: HTTP 503' });
  });
  it('пустой репозиторий — проверка выключена', async () => {
    process.env.KX_UPDATE_REPO = '';
    expect(await checkUpdate({ force: true, doFetch: gh('v99.0.0') })).toMatchObject({ latest: null, newer: false, checkedAt: null });
  });
});
