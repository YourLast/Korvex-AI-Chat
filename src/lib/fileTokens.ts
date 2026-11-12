import { useSyncExternalStore } from 'react';
import { fmtTokLang } from './format';
import { tr, type Lang } from './i18n/core';
import type { MemoryInfo } from './types';
import { markerName } from './upload/paths';

export type FileTok = { n: number; exact: boolean };
export type ExactTok = { byName: Map<string, number | null>; exact: boolean };
const EMPTY: ExactTok = { byName: new Map(), exact: false };

const key = (name: string) => markerName(name).normalize('NFC').toLowerCase();

export function exactTokens(msgs: readonly { role: string; meta?: { memory?: MemoryInfo | null } | null }[]): ExactTok {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const mem = m.role === 'assistant' ? m.meta?.memory : null;
    if (!mem?.file_list?.length) continue;
    const byName = new Map<string, number | null>();
    for (const f of mem.file_list) {
      if (!f.name || f.kind === 'image' || typeof f.tokens !== 'number' || !(f.tokens > 0)) continue;
      const k = key(f.name);
      byName.set(k, byName.has(k) ? null : Math.round(f.tokens));
    }
    return { byName, exact: mem.exact !== false };
  }
  return EMPTY;
}

type Fileish = { name: string; tokens?: number; mime?: string; info?: Record<string, unknown> | null };

export function fileTok(f: Fileish, ex: ExactTok = EMPTY): FileTok | null {
  if (f.mime?.startsWith('image/') || f.info?.format === 'image' || f.info?.unparsed) return null;
  const v = ex.byName.get(key(f.name));
  if (typeof v === 'number') return { n: v, exact: ex.exact };
  return f.tokens && f.tokens > 0 ? { n: Math.round(f.tokens), exact: false } : null;
}

export function sumTok(files: readonly Fileish[], ex: ExactTok = EMPTY): FileTok | null {
  let n = 0, any = false, exact = true;
  for (const f of files) {
    const t = fileTok(f, ex);
    if (!t) continue;
    any = true; n += t.n; if (!t.exact) exact = false;
  }
  return any ? { n, exact } : null;
}

export const tokText = (lang: Lang, t: FileTok): string => tr(lang, t.exact ? 'files.tokExact' : 'files.tokEst', { n: fmtTokLang(lang, t.n) });

let cur: ExactTok = EMPTY;
const subs = new Set<() => void>();
const same = (a: ExactTok, b: ExactTok) => a === b || (a.exact === b.exact && a.byName.size === b.byName.size && [...a.byName].every(([k, v]) => b.byName.get(k) === v));
export const setExactTokens = (e: ExactTok) => { if (same(cur, e)) return; cur = e; subs.forEach((f) => f()); };
export const getExactTokens = () => cur;
export const useExactTokens = (): ExactTok => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, getExactTokens, getExactTokens);
export const useFileTok = (f: Fileish): FileTok | null => fileTok(f, useExactTokens());
