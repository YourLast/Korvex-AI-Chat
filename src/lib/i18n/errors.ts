import { DICT, type Key } from './dict';
import { tr, type Lang } from './core';

type Rule = { key: Key; exact?: string; re?: RegExp; names: string[]; lit: number };
let RULES: Rule[] | null = null;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function rules(): Rule[] {
  if (RULES) return RULES;
  RULES = [];
  for (const key of Object.keys(DICT) as Key[]) {
    if (!key.startsWith('e.')) continue;
    const ru = DICT[key][0];
    const src = typeof ru === 'string' ? ru : ru[0];
    const names: string[] = [];
    if (!/\{\w+\}/.test(src)) { RULES.push({ key, exact: src, names, lit: src.length }); continue; }
    const re = new RegExp('^' + esc(src).replace(/\\\{(\w+)\\\}/g, (_, n: string) => { names.push(n); return '([\\s\\S]+?)'; }) + '$');
    RULES.push({ key, re, names, lit: src.replace(/\{\w+\}/g, '').length });
  }
  RULES.sort((a, b) => Number(!!a.re) - Number(!!b.re) || b.lit - a.lit);
  return RULES;
}

export function errText(lang: Lang, msg: string | null | undefined): string {
  const m = String(msg ?? '');
  if (!m || lang === 'ru') return m;
  for (const r of rules()) {
    if (r.exact !== undefined) { if (r.exact === m) return tr(lang, r.key); continue; }
    const x = r.re!.exec(m);
    if (x) return tr(lang, r.key, Object.fromEntries(r.names.map((n, i) => [n, n === 'n' && /^\d+$/.test(x[i + 1]) ? Number(x[i + 1]) : x[i + 1]])));
  }
  return m;
}
