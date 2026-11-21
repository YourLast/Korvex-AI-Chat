import { tr, type Lang } from '../i18n/core';
import { parseBlock } from './parse';
import { LIMITS, type Block } from './schema';
import { fmtDate, fmtMoney, fmtNum, fromKop, sumKop } from './money';
import type { RateView } from './rateTypes';

export const FENCE_RE = /```korvex[^\n]*\n([\s\S]*?)(?:\n```[ \t]*(?=\n|$)|$)/g;
export const KXB_LINK_RE = /(?:📎\s*)?\[([^\]\n]+?\.kxb\.json)\]\(([^)\s]+?\.kxb\.json)\)(?:\s*\([^)\n]{1,20}\))?/g;
export const isKxbHref = (href: string | undefined | null) => !!href && /\.kxb\.json$/i.test(decodeURIComponent(href.split('?')[0]));

export type Snapshots = { files?: Record<string, Block>; rates?: Record<string, RateView> };
export const rateKey = (code: string, date?: string) => `${code}:${date ?? ''}`;

function plural(n: number, lang: Lang): string {
  if (lang === 'en') return tr(lang, n === 1 ? 'blk.rows1' : 'blk.rows', { n: String(n) });
  const a = n % 100, b = n % 10;
  const k = a > 10 && a < 20 ? 'blk.rows' : b === 1 ? 'blk.rows1' : b >= 2 && b <= 4 ? 'blk.rows2' : 'blk.rows';
  return tr(lang, k, { n: String(n) });
}

const KINDS = new Set(['table', 'kpi', 'rate', 'deadlines', 'chart', 'map', 'party', 'html']);
export const kindWord = (t: string, lang: Lang) => tr(lang, (KINDS.has(t) ? `blk.kind.${t}` : 'blk.kind.block') as Parameters<typeof tr>[1]);

export function blockLabel(b: Block | null, lang: Lang, fallbackName?: string): string {
  if (!b) return `[${kindWord('block', lang)}${fallbackName ? `: ${fallbackName.replace(/\.kxb\.json$/i, '')}` : ''}]`;
  const extra = b.type === 'table' ? `, ${plural(b.data.more ?? b.data.rows.length, lang)}` : b.type === 'rate' ? ` ${b.data.code}` : '';
  return `[${kindWord(b.type, lang)}: ${b.title}${extra}]`;
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

function valueText(kind: string, v: unknown, lang: Lang): string {
  if (v == null || v === '') return '—';
  const s = String(v);
  if (kind === 'money') return fmtMoney(s, lang);
  if (kind === 'number') return fmtNum(s, lang);
  if (kind === 'percent') return `${fmtNum(s, lang)} %`;
  if (kind === 'date') return fmtDate(s, lang);
  if (kind === 'status') return s ? tr(lang, `blk.tbl.status.${s}` as Parameters<typeof tr>[1]) : '';
  return s;
}

export function blockText(b: Block, lang: Lang, snap?: Snapshots): string {
  const head = `**${b.title}**`;
  const foot = (b.unverified ?? 0) > 0 ? `\n\n${tr(lang, 'blk.unverified', { n: String(b.unverified) })}` : '';
  if (b.type === 'table') {
    const d = b.data, cols = d.columns;
    const rows = d.rows.slice(0, LIMITS.showRows);
    const lines = [
      `| ${cols.map((c) => cell(c.title)).join(' | ')} |${d.rows.some((r) => r.note) ? ' |' : ''}`,
      `|${cols.map((c) => (c.kind === 'money' || c.kind === 'number' || c.kind === 'percent' ? ' ---: ' : ' --- ')).join('|')}|${d.rows.some((r) => r.note) ? ' --- |' : ''}`,
      ...rows.map((r) => `| ${cols.map((c) => cell(valueText(c.kind, r[c.key], lang))).join(' | ')} |${d.rows.some((x) => x.note) ? ` ${cell(String(r.note ?? ''))}${r.verified === false ? ` (${tr(lang, 'blk.notVerified')})` : ''} |` : ''}`),
    ];
    const tot = cols.filter((c) => c.total && c.kind === 'money');
    if (tot.length) lines.push(`| ${cols.map((c, i) => (i === 0 ? `**${tr(lang, 'blk.tbl.total')}**` : c.total && c.kind === 'money' ? `**${fmtMoney(fromKop(sumKop(rows.map((r) => r[c.key] as string))), lang)}**` : '')).join(' | ')} |${d.rows.some((r) => r.note) ? ' |' : ''}`);
    const more = (d.more ?? d.rows.length) > rows.length ? `\n\n${tr(lang, 'blk.shown', { n: String(rows.length), all: String(d.more ?? d.rows.length) })}` : '';
    return `${head}\n\n${lines.join('\n')}${more}${foot}`;
  }
  if (b.type === 'kpi') {
    return `${head}\n\n${b.data.items.map((k) => `- ${k.label}: ${k.kind === 'money' ? fmtMoney(k.value, lang) : fmtNum(k.value, lang)}${k.unit ? ` ${k.unit}` : k.kind === 'percent' ? ' %' : ''}${k.verified === false ? ` (${tr(lang, 'blk.notVerified')})` : ''}${k.basis ? ` — ${k.basis}` : ''}`).join('\n')}${foot}`;
  }
  if (b.type === 'rate') {
    const r = snap?.rates?.[rateKey(b.data.code, b.data.date)];
    if (r?.value) return `${head}\n\n${tr(lang, 'blk.rate.per', { code: r.code, date: fmtDate(r.date, lang) })}: ${fmtNum(r.value, lang)} ₽ (cbr.ru)`;
    return `${head}\n\n${b.data.code}${b.data.date ? `, ${fmtDate(b.data.date, lang)}` : ''} — cbr.ru`;
  }
  if (b.type === 'deadlines') {
    return `${head}\n\n${b.data.items.map((x) => `- ${fmtDate(x.date, lang)} — ${x.what}${x.basis ? ` (${x.basis})` : ''}${x.orig ? `; ${x.reason ? tr(lang, 'blk.dl.moved', { orig: fmtDate(x.orig, lang), reason: x.reason, date: fmtDate(x.date, lang) }) : tr(lang, 'blk.dl.movedPlain', { orig: fmtDate(x.orig, lang), date: fmtDate(x.date, lang) })}` : ''}`).join('\n')}${b.data.calendar ? `\n\n${b.data.calendar}` : ''}${foot}`;
  }
  return blockLabel(b, lang);
}

export function replaceBlocks(md: string, fn: (b: Block | null, name?: string) => string, snap?: Snapshots): string {
  if (!md.includes('```korvex') && !md.includes('.kxb.json')) return md;
  let out = md.replace(FENCE_RE, (_m, body: string) => { const p = parseBlock(body.trim(), 'fence'); return fn(p.ok ? p.block : null); });
  out = out.replace(KXB_LINK_RE, (_m, name: string, href: string) => fn(snap?.files?.[href] ?? null, name));
  return out;
}

export const blocksAsLabels = (md: string, lang: Lang, snap?: Snapshots) => replaceBlocks(md, (b, name) => blockLabel(b, lang, name), snap);
export const blocksAsText = (md: string, lang: Lang, snap?: Snapshots) => replaceBlocks(md, (b, name) => (b ? blockText(b, lang, snap) : blockLabel(null, lang, name)), snap);
