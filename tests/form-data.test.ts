import { describe, expect, it } from 'vitest';
import { fixFilenameStar, formDataOf } from '@/lib/formData';

const B = '----kxtest';
const part = (disp: string, body: string, type = 'text/plain') => [`--${B}`, `Content-Disposition: ${disp}`, `Content-Type: ${type}`, '', body].join('\r\n');
const form = (...parts: string[]) => Buffer.from([...parts, `--${B}--`, ''].join('\r\n'), 'utf8');
const req = (b: Buffer) => new Request('http://x', { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${B}` }, body: new Uint8Array(b) });
const star = `filename*=UTF-8''${encodeURIComponent('Выписка октябрь.txt')}`;
const EML = `From: bank\r\nContent-Disposition: attachment; ${star}\r\n\r\nтело`;

describe('форма с filename*', () => {
  it('undici такую форму не берёт; после правки — берёт: имя в UTF-8, поля и содержимое целы', async () => {
    const b = form(part('form-data; name="tag"', 'abc'), part(`form-data; name="file"; ${star}`, 'выписка 1C'), part(`form-data; name="eml"; filename="m.eml"; ${star}`, EML, 'message/rfc822'));
    await expect(new Response(new Uint8Array(b), { headers: { 'content-type': `multipart/form-data; boundary=${B}` } }).formData()).rejects.toThrow();
    const f = await formDataOf(req(b));
    expect(f?.get('tag')).toBe('abc');
    const file = f?.get('file') as File;
    expect(file.name).toBe('Выписка октябрь.txt');
    expect(await file.text()).toBe('выписка 1C');
    const eml = f?.get('eml') as File;
    expect(eml.name).toBe('m.eml');
    expect(await eml.text()).toBe(EML);
  });
  it('обычная форма — как есть; не форма — null; правка без filename* — нечего править', async () => {
    const f = await formDataOf(req(form(part('form-data; name="file"; filename="a.txt"', 'x'))));
    expect((f?.get('file') as File).name).toBe('a.txt');
    expect(await formDataOf(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))).toBeNull();
    expect(fixFilenameStar(form(part('form-data; name="file"; filename="a.txt"', 'x')), B)).toBeNull();
  });
});

describe('предел тела формы (ревью безопасности 13.11, п.8)', () => {
  it('тело больше предела — tooBig, ничего не разбирается; в пределе — форма', async () => {
    const { readForm } = await import('@/lib/formData');
    const big = form(part('form-data; name="file"; filename="a.txt"', 'x'.repeat(5000)));
    expect(await readForm(req(big), 1000)).toEqual({ form: null, tooBig: true });
    const r = await readForm(req(big), 10_000);
    expect(r.tooBig).toBe(false);
    expect(((r.form?.get('file')) as File).size).toBe(5000);
  });
});
