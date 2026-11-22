import { tr, type Lang } from './i18n/core';
import type { WItem, WKind, WStep } from './work';

const LINE = /^[ \t]*(?:\[\[t:[ \t]*([^\]\n]{1,160}?)[ \t]*\]\]|#{2,3}[ \t]+([^\n]{2,79}?)[ \t#]*)[ \t]*$/gm;
const clean = (s: string) => s.replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim().replace(/[.:;,]+$/, '');

const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);
export type Thought = { title: string; note?: string };
export function thoughtsIn(text: string): Thought[] {
  const out: Thought[] = [];
  for (const m of String(text ?? '').matchAll(LINE)) {
    const [a, ...rest] = (m[1] ?? m[2] ?? '').split('|');
    const title = clean(a).replace(/^\d{1,2}\s*[.)](?!\d)\s*/, ''), note = clean(rest.join('|'));
    if (title.length >= 2) out.push({ title: cut(title, 90), ...(m[1] && note.length >= 2 ? { note: cut(note, 120) } : {}) });
  }
  return out;
}
export const titlesIn = (text: string): string[] => thoughtsIn(text).map((t) => t.title);

export function titleMarkdown(text: string): string {
  return String(text ?? '')
    .replace(/^[ \t]*\[\[t:[ \t]*([^\]\n]{1,160}?)[ \t]*\]\][ \t]*$/gm, (_a, x: string) => { const [a, ...r] = x.split('|'); const n = clean(r.join('|')); return `\n**${clean(a)}**${n ? ` — ${n}` : ''}\n`; })
    .replace(/^[ \t]*\[\[t:[^\]\n]*$/m, '');
}

export type BriefLine = { id: string; text: string; live: boolean; step?: WStep; model?: boolean; note?: string };

const KIND_KEY: Partial<Record<WKind, string>> = {
  python: 'think.k.calc', table: 'think.k.table', bash: 'think.k.files', web: 'think.k.web', memory: 'think.k.memory', usermem: 'think.k.memory',
  file: 'think.k.file', browser: 'think.k.browser',
};
export const stepLabel = (kind: WKind, lang: Lang = 'ru'): string => tr(lang, (KIND_KEY[kind] ?? 'think.k.other') as never);

export function briefOf(items: WItem[], live: boolean, lang: Lang = 'ru'): BriefLine[] {
  const out: BriefLine[] = [];
  const push = (l: BriefLine) => {
    const last = out[out.length - 1];
    if (last && !last.step && !l.step && last.text === l.text) { out[out.length - 1] = { ...last, live: l.live }; return; }
    out.push(l);
  };
  items.forEach((it, i) => {
    const tail = i === items.length - 1;
    if (it.t === 'think') {
      const ts = thoughtsIn(it.text);
      ts.forEach((t, k) => push({ id: `${it.id}:${k}`, text: t.title, ...(t.note ? { note: t.note } : {}), live: false, model: true }));
      if (!ts.length && tail && it.live && !out.length) push({ id: `${it.id}:p`, text: tr(lang, 'think.pondering'), live: true });
      return;
    }
    if (it.t === 'note') return;
    const steps = it.t === 'step' ? [it.step] : it.steps;
    for (const s of steps) {
      if (s.kind === 'steer') continue;
      if (s.status === 'wait') { out.push({ id: s.id, text: s.ask?.text ?? s.title, live: false, step: s }); continue; }
      if (out[out.length - 1]?.model) continue;
      push({ id: s.id, text: stepLabel(s.kind, lang), live: false });
    }
  });
  if (live && out.length && !out[out.length - 1].step) out[out.length - 1] = { ...out[out.length - 1], live: true };
  return out;
}

export const liveTitle = (lines: BriefLine[]): string | null => (lines.length ? lines[lines.length - 1].text : null);
