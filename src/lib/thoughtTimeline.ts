import { tr, type Lang } from './i18n/core';
import { thoughtsIn } from './thoughtTitles';
import { hostOf, type WItem, type WStep } from './work';

export type TLKind = 'title' | 'search' | 'file' | 'calc' | 'tool' | 'wait' | 'done';
export type TLRow = {
  id: string; kind: TLKind; text: string; note?: string; live?: boolean; step?: WStep; err?: boolean;
  hosts?: string[]; links?: string[];
  calc?: string[];
};

const ru = (lang: Lang, k: string, v?: Record<string, string>) => tr(lang, k as never, v as never);
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

function toolRow(s: WStep, lang: Lang, urls: string[], after = ''): TLRow {
  const run = s.status === 'run', err = s.status === 'err' && !s.recovered;
  if (s.kind === 'web') {
    const near = after.split('\n').filter((l) => /^\s{2,}\S/.test(l) && /https?:\/\//.test(l));
    const hosts = uniq([...(s.search?.pages ?? []).map((p) => p.host.replace(/^www\./, '')), ...[...(s.text ?? '').split('\n'), ...near].map((l) => hostOf(l)).filter((h): h is string => !!h)]).slice(0, 6);
    const links = urls.filter((u) => hosts.some((h) => (hostOf(u) ?? '') === h || (hostOf(u) ?? '').endsWith('.' + h))).slice(0, 12);
    const n = s.wide?.read ?? null;
    const text = run ? ru(lang, 'think.k.web')
      : s.result && /^\d/.test(s.result) ? ru(lang, 'think.tl.found', { r: s.result })
      : n ? ru(lang, 'think.tl.foundPages', { n: String(n) })
      : s.result ? `${ru(lang, 'think.tl.searched')} · ${s.result}` : ru(lang, 'think.tl.searched');
    return { id: s.id, kind: 'search', text, note: s.sub?.replace(/^«|»$/g, ''), hosts, links, err };
  }
  if (s.kind === 'python' || s.kind === 'table') {
    const cmd = s.term?.cmd ?? '';
    const words = /^[^\n=(){}\[\];<>]{2,90}$/.test(cmd) && /\p{L}{3}/u.test(cmd) && !/^(import|from|print|def|for|with|python)\b/.test(cmd);
    const label = s.kind === 'table' ? s.sub : words ? cmd : undefined;
    const calc = (s.term?.out ?? (s.text ? s.text.split('\n') : [])).map((l) => l.trimEnd()).filter((l) => l.trim()).slice(0, 12);
    return { id: s.id, kind: 'calc', text: run ? ru(lang, 'think.k.calc') : ru(lang, 'think.tl.calc'), note: label, calc: calc.length ? calc : undefined, err };
  }
  if (s.kind === 'file') return { id: s.id, kind: 'file', text: run ? ru(lang, 'think.k.file') : ru(lang, 'think.tl.read'), note: s.sub, err };
  const key = s.kind === 'memory' || s.kind === 'usermem' ? 'memory' : s.kind === 'browser' ? 'browser' : s.kind === 'bash' ? 'files' : 'other';
  return { id: s.id, kind: 'tool', text: run ? ru(lang, `think.k.${key}`) : ru(lang, `think.tl.${key}`), err };
}

export function timelineOf(items: WItem[], live: boolean, lang: Lang = 'ru', urls: string[] = []): TLRow[] {
  const out: TLRow[] = [];
  items.forEach((it, i) => {
    if (it.t === 'think') {
      const ts = thoughtsIn(it.text);
      ts.forEach((t, k) => {
        const last = out[out.length - 1];
        if (last?.kind === 'title' && last.text === t.title) return;
        out.push({ id: `${it.id}:${k}`, kind: 'title', text: t.title, ...(t.note ? { note: t.note } : {}) });
      });
      if (!ts.length && live && i === items.length - 1 && !out.length) out.push({ id: `${it.id}:p`, kind: 'title', text: ru(lang, 'think.pondering') });
      return;
    }
    if (it.t === 'note') return;
    for (const s of it.t === 'step' ? [it.step] : it.steps) {
      if (s.kind === 'steer') continue;
      if (s.status === 'wait') { out.push({ id: s.id, kind: 'wait', text: s.ask?.text ?? s.title, step: s }); continue; }
      const nx = items[i + 1];
      out.push(toolRow(s, lang, urls, nx?.t === 'think' ? nx.text : ''));
    }
  });
  if (live && out.length) out[out.length - 1] = { ...out[out.length - 1], live: true };
  if (!live && out.length) out.push({ id: 'done', kind: 'done', text: ru(lang, 'think.tl.done') });
  return out;
}
