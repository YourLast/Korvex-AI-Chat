import { stripMarkers } from './srcmark';
import { stripWebMarks } from './webmark';
import { OUT_PREFIX } from '@/ext/client';
const FILE_RE = new RegExp('📎\\s*\\[([^\\]]+)\\]\\(' + OUT_PREFIX.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '[^)]+\\)');

export function summarize(md0: string, max = 100): string {
  const md = stripWebMarks(stripMarkers(md0, 'drop'), 'drop');
  const f = FILE_RE.exec(md);
  if (f) return `Готов файл «${f[1]}»`;
  let t = md
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/\\\[[\s\S]*?\\\]/g, ' ')
    .split('\n').filter((l) => !/^\s*\|/.test(l) && !/^\s*[-=*_]{3,}\s*$/.test(l)).join('\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, '\u0001$1')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/\$([^$\n]+)\$/g, '$1').replace(/\\\(([^)]*)\\\)/g, '$1')
    .replace(/<[^>]+>/g, ' ');
  const lines = t.split(/\n+/);
  const body = lines.filter((l) => !l.startsWith('\u0001'));
  const pick = (ls: string[]) => ls.flatMap((l) => l.replace('\u0001', '').split(/(?<=[.!?…])\s+/)).map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => /\p{L}{2,}/u.test(s));
  t = pick(body)[0] ?? pick(lines)[0] ?? '';
  if (t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, '').trimEnd() + '…';
  return t;
}
