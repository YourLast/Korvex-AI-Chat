import { describe, expect, it } from 'vitest';
import { parseOps, parseOpsEx } from '@/lib/curator';
import { stampConsole } from '@/lib/logTime';

describe('parseOpsEx', () => {
  it('пустой ops — разобран, это «нечего запоминать»', () => {
    expect(parseOpsEx('{"ops":[]}')).toEqual({ ops: [], fail: null });
    expect(parseOpsEx('<think>…</think>\n{"ops": []}').fail).toBeNull();
  });
  it('изменения разобраны', () => {
    const r = parseOpsEx('{"ops":[{"op":"add","section":"style","key":"length","text":"Отвечать коротко","sensitive":"no","asked":false,"sure":true}]}');
    expect(r.fail).toBeNull();
    expect(r.ops).toHaveLength(1);
    expect(parseOps('{"ops":[{"op":"add","text":"x"}]}')).toHaveLength(1);
  });
  it('битые ответы — своя причина', () => {
    expect(parseOpsEx('').fail).toBe('empty');
    expect(parseOpsEx('<think>долго думал').fail).toBe('empty');
    expect(parseOpsEx('Запоминать нечего.').fail).toBe('no_json');
    expect(parseOpsEx('{"ops":[{"op":"add","text":"обрыв').fail).toBe('no_json');
    expect(parseOpsEx('{"ops":[{"op":"add",}]}').fail).toBe('bad_json');
    expect(parseOpsEx('{"changes":[]}').fail).toBe('no_ops');
    expect(parseOps('{"ops":[{"op":"add",}]}')).toEqual([]);
  });
});

describe('stampConsole', () => {
  it('время UTC в начале строки; формат первого аргумента не ломается; не-строка — время отдельным аргументом; второй вызов не удваивает', () => {
    const got: unknown[][] = [];
    const c = { log: (...a: unknown[]) => got.push(a), info: (...a: unknown[]) => got.push(a), warn: (...a: unknown[]) => got.push(a), error: (...a: unknown[]) => got.push(a) } as unknown as Console;
    const at = () => new Date('2026-11-18T08:51:23.123Z');
    stampConsole(c, at); stampConsole(c, at);
    c.log('[memory] chat=x ops=0');
    c.error('%s упал', 'jobs');
    c.warn({ a: 1 });
    expect(got[0]).toEqual(['2026-11-18T08:51:23.123Z [memory] chat=x ops=0']);
    expect(got[1]).toEqual(['2026-11-18T08:51:23.123Z %s упал', 'jobs']);
    expect(got[2]).toEqual(['2026-11-18T08:51:23.123Z', { a: 1 }]);
  });
  it('KX_LOG_TS=0 — без времени', () => {
    const got: unknown[][] = [];
    const c = { log: (...a: unknown[]) => got.push(a), info: () => {}, warn: () => {}, error: () => {} } as unknown as Console;
    process.env.KX_LOG_TS = '0';
    try { stampConsole(c); c.log('x'); } finally { delete process.env.KX_LOG_TS; }
    expect(got[0]).toEqual(['x']);
  });
});
