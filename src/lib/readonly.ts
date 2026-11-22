import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './db';

export type ReadOnly = { since: number; reason?: string; url?: string };
export const readonlyFile = () => path.join(dataDir(), 'readonly.json');
const c: { key: string; val: ReadOnly | null } = { key: '', val: null };

export function readOnly(): ReadOnly | null {
  try {
    const f = readonlyFile();
    const st = fs.statSync(/*turbopackIgnore: true*/ f);
    const key = `${st.mtimeMs}:${st.size}`;
    if (key !== c.key) {
      const o = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ f, 'utf8')) as Partial<ReadOnly>;
      c.val = { since: typeof o.since === 'number' ? o.since : st.mtimeMs, ...(typeof o.reason === 'string' ? { reason: o.reason } : {}), ...(typeof o.url === 'string' && /^[a-z0-9.-]+$/i.test(o.url) ? { url: o.url } : {}) };
      c.key = key;
    }
    return c.val;
  } catch { c.key = ''; c.val = null; return null; }
}
