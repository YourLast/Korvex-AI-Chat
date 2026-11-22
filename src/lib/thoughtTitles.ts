import { tr, type Lang } from './i18n/core';
import type { WItem, WKind, WStep } from './work';

const LINE = /^[ \t]*(?:\[\[t:[ \t]*([^\]\n]{1,160}?)[ \t]*\]\]|#{2,3}[ \t]+([^\n]{2,79}?)[ \t#]*)[ \t]*$/gm;
const clean = (s: string) => s.replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim().replace(/[.:;,]+$/, '');

export function titlesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? '').matchAll(LINE)) {
    const t = clean(m[1] ?? m[2] ?? '');
    if (t.length >= 2) out.push(t.length > 90 ? t.slice(0, 89).trimEnd() + '…' : t);
  }
  return out;
}

export function titleMarkdown(text: string): string {
  return String(text ?? '')
    .replace(/^[ \t]*\[\[t:[ \t]*([^\]\n]{1,160}?)[ \t]*\]\][ \t]*$/gm, (_a, x: string) => `\n**${clean(x)}**\n`)
    .replace(/^[ \t]*\[\[t:[^\]\n]*$/m, '');
}

export type BriefLine = { id: string; text: string; live: boolean; step?: WStep; model?: boolean };

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
      const ts = titlesIn(it.text);
      ts.forEach((t, k) => push({ id: `${it.id}:${k}`, text: t, live: false, model: true }));
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
