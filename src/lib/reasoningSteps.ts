
import { tr, type Lang } from './i18n/core';
import { errText } from './i18n/errors';

export type StepKind = 'bash' | 'python' | 'memory' | 'web' | 'table';
export type StepStatus = 'running' | 'done' | 'error' | 'timeout';
export type ToolStep = {
  kind: StepKind;
  query: string;
  out: string[];
  more: boolean;
  result?: string;
  status: StepStatus;
  code?: boolean;
  wide?: { queries: number; raw?: number; read?: number };
  qlist?: string[];
  qmore?: boolean;
  qgroups?: { name: string; items: string[] }[];
  pages?: { host: string; label?: string }[];
};
export type Seg = { t: 'text'; text: string } | { t: 'step'; step: ToolStep } | { t: 'note'; kind: 'check' | 'notes'; text: string };

export const stepTitle = (k: StepKind, lang: Lang = 'ru'): string => tr(lang, `work.step.${k}` as const);

export const stepShort = (k: StepKind, lang: Lang = 'ru'): string => tr(lang, `work.stepShort.${k}` as const);

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

const WS_RE = /^▸ (bash|python|память):(?: (.*))?$/;
const WS_KIND: Record<string, StepKind> = { bash: 'bash', python: 'python', 'память': 'memory' };
const WEB_RE = /^\[поиск: (.*)\]$/;
const MEM_RE = /^\[поиск в памяти: (.*)\]$/;
const TABLE_RE = /^\[расчёт по таблице: (.*)\]$/;
const PY_RE = /^\[python → (.*)\]$/;
const FOUND_RE = /^\[найдено: (\d+) источник[а-я]*\]$/;
const FOUND_LEAD_RE = /^\[найдено: (\d+) источник[а-я]*\]\s*(.+)$/;
const SERVICE_MARK_RE = /\[(?:найдено: \d+ источник[а-я]*|в памяти: (?:есть записи|ничего нового))\]\s*/g;
const WIDE_RE = /^ {4}Искал (\d+) запрос[а-я]* · (\d+) результат[а-я]* · (\d+) страниц[а-я]* прочитано$/;
const WIDE_HEAD_RE = /^(\d+) запрос[а-я]*: (.*)$/;
const WIDE_GROUP_RE = /^ {4}Запросы \(([^)]+)\): (.+)$/;
const WIDE_PAGES_RE = /^ {4}Прочитано: (.+)$/;
const MEMRES_RE = /^\[в памяти: (есть записи|ничего нового)\]$/;
const PYRES_RE = /^\[python: (?:готово, (\d+) симв\. вывода|(время вышло)|(ошибка))\]$/;
const NOTES_RE = /^\[выписки: \+(\d+)\]$/;
const CHECK_RE = /^\[((?:проверка|checking) [^:\]]{1,40}): (.+)\]$/;
const PREVIEW_RE = /^ {4}(.*)$/;
const PREVIEW_MAX = 4;

const HEADS = ['▸ bash: ', '▸ python: ', '▸ память: ', '[поиск: ', '[поиск в памяти: ', '[расчёт по таблице: ', '[python → ', '[выписки: +', '[проверка ', '[checking ', '[найдено: ', '[в памяти: ', '[python: '];
const STEP_HEADS: [string, StepKind][] = [['[поиск: ', 'web'], ['[поиск в памяти: ', 'memory'], ['[расчёт по таблице: ', 'table'], ['[python → ', 'python']];

const FAIL_RE = /^\[(?:python|bash) failed/;
const STOP_RE = /^\[(?:python|bash) stopped/;
const OUT_MAP: [RegExp, (m: RegExpMatchArray, l: Lang) => string][] = [
  [/^\[(?:python|bash) failed, exit code (-?\d+)\]$/, (m, l) => tr(l, 'work.out.failCode', { code: m[1] })],
  [/^\[(?:python|bash) failed: the sandbox returned no result\]$/, (_, l) => tr(l, 'work.out.noResult')],
  [/^\[(?:python|bash) failed: the workspace could not start/, (_, l) => tr(l, 'work.out.noStart')],
  [/^\[(?:python|bash) failed/, (_, l) => tr(l, 'work.out.error')],
  [/^\[(?:python|bash) stopped/, (_, l) => tr(l, 'work.out.timeout')],
  [/^\(no output\)$/, (_, l) => tr(l, 'work.out.noOutput')],
  [/^\(the code printed nothing/, (_, l) => tr(l, 'work.out.noOutput')],
  [/^\[files saved to [^:\]]*: (.+?)\]?$/, (m, l) => tr(l, 'work.out.saved', { files: m[1] })],
  [/^stdout before it stopped:$/, (_, l) => tr(l, 'work.out.untilStop')],
  [/^\[output cut:/, () => '…'],
  [/^Nothing in your memory matches this query\.?$/, (_, l) => tr(l, 'work.out.nothing')],
];
const NOTHING_RE = /^Nothing in your memory matches this query\.?$/;
const outLine = (s: string, lang: Lang) => { for (const [re, f] of OUT_MAP) { const m = s.match(re); if (m) return f(m, lang); } return s; };

type Pending = { step: ToolStep; ws: boolean; want: 'found' | 'mem' | 'py' | 'line' | null; outEnded: boolean };

export function parseReasoning(src: string, live = false, lang: Lang = 'ru'): Seg[] {
  const text = String(src ?? '').replace(/\r\n?/g, '\n');
  const complete = text.endsWith('\n');
  const lines = text.split('\n');
  if (complete) lines.pop();
  const partialAt = live && !complete ? lines.length - 1 : -1;
  const segs: Seg[] = [];
  let buf: string[] = [];
  const st: { cur: Pending | null } = { cur: null };
  const flushText = () => {
    const s = buf.join('\n').replace(SERVICE_MARK_RE, '').replace(/^\n+|\s+$/g, '');
    if (s.trim()) segs.push({ t: 'text', text: s });
    buf = [];
  };
  const close = () => {
    if (!st.cur) return;
    const { step, ws } = st.cur;
    if (ws && step.out.length) {
      if (FAIL_RE.test(step.out[0])) step.status = 'error';
      else if (STOP_RE.test(step.out[0])) step.status = 'timeout';
      const raw = step.out;
      step.out = raw.map((l) => outLine(l, lang));
      if (raw.length === 1 && NOTHING_RE.test(raw[0])) { step.out = []; step.result = tr(lang, 'work.nothingFound'); }
      if (step.status !== 'error' && step.status !== 'timeout') step.status = 'done';
    }
    st.cur = null;
  };
  const start = (kind: StepKind, query: string, ws: boolean, want: Pending['want']) => {
    flushText();
    const step: ToolStep = { kind, query: query.trim(), out: [], more: false, status: 'running', ...(ws && (kind === 'bash' || kind === 'python') ? { code: true } : {}) };
    const wh = kind === 'web' ? WIDE_HEAD_RE.exec(step.query) : null;
    if (wh) {
      const items = wh[2].split(' · ').map((x) => x.trim()).filter(Boolean);
      const cut = step.query.length >= 158;
      if (cut && items.length > 1) items.pop();
      step.wide = { queries: Number(wh[1]) };
      step.qlist = items; step.qmore = items.length < Number(wh[1]) || cut;
    }
    segs.push({ t: 'step', step });
    st.cur = { step, ws, want, outEnded: false };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const partial = i === partialAt;
    const c = st.cur;
    if (c) {
      if (c.ws) {
        const m = PREVIEW_RE.exec(line);
        if (m && !c.outEnded && c.step.out.length < PREVIEW_MAX) {
          const v = m[1].trim();
          if (v === '…') { c.step.more = true; c.outEnded = true; } else if (v) c.step.out.push(v);
          continue;
        }
      } else if (c.want) {
        if (partial && c.want !== 'line' && HEADS.some((h) => h.startsWith(line) || line.startsWith(h))) continue;
        let m: RegExpExecArray | null;
        if (c.want === 'found' && c.step.kind === 'web') {
          if (partial && line.startsWith('    ')) continue;
          if ((m = WIDE_RE.exec(line))) { c.step.wide = { queries: Number(m[1]), raw: Number(m[2]), read: Number(m[3]) }; continue; }
          if (c.step.wide && (m = WIDE_GROUP_RE.exec(line))) { (c.step.qgroups ??= []).push({ name: m[1], items: m[2].replace(/…$/, '').split('; ').map((x) => x.trim()).filter(Boolean) }); continue; }
          if (c.step.wide && (m = WIDE_PAGES_RE.exec(line))) {
            c.step.pages = m[1].split('; ').map((x) => { const p = /^(\S+)(?: \(([^)]+)\))?$/.exec(x.trim()); return p ? { host: p[1], label: p[2] } : { host: x.trim() }; }).filter((x) => x.host);
            continue;
          }
          if (c.step.wide && /^ {4}\S/.test(line)) {
            const raw = line.trim(), cut = raw.endsWith('…');
            const items = raw.replace(/…$/, '').split('; ').map((x) => x.trim()).filter(Boolean);
            if (cut && items.length > 1) items.pop();
            if (items.length >= (c.step.qlist?.length ?? 0)) { c.step.qlist = items; c.step.qmore = cut || items.length < c.step.wide.queries; }
            continue;
          }
        }
        if (c.want === 'found' && !partial && (m = FOUND_LEAD_RE.exec(line)) && !FOUND_RE.test(line)) {
          const n = Number(m[1]);
          c.step.result = c.step.wide?.raw !== undefined ? undefined : n > 0 ? tr(lang, 'work.sources', { n: String(n) }) : tr(lang, 'work.nothingFound');
          c.step.status = 'done'; c.want = null; close(); buf.push(m[2]); continue;
        }
        if (c.want === 'found' && (m = FOUND_RE.exec(line))) {
          const n = Number(m[1]);
          c.step.result = c.step.wide?.raw !== undefined ? undefined : n > 0 ? tr(lang, 'work.sources', { n: String(n) }) : tr(lang, 'work.nothingFound');
          c.step.status = 'done'; c.want = null; continue;
        }
        if (c.want === 'mem' && (m = MEMRES_RE.exec(line))) {
          c.step.result = m[1] === 'есть записи' ? tr(lang, 'work.memFound') : tr(lang, 'work.memNothing');
          c.step.status = 'done'; c.want = null; continue;
        }
        if (c.want === 'py' && (m = PYRES_RE.exec(line))) {
          if (m[1] !== undefined) { const n = Number(m[1]); c.step.status = 'done'; c.step.out = [tr(lang, 'work.pyChars', { n: String(n) })]; }
          else c.step.status = m[2] ? 'timeout' : 'error';
          c.want = null; continue;
        }
        if (c.want === 'line' && !WS_RE.test(line) && !STEP_HEADS.some(([h]) => line.startsWith(h))) {
          if (partial) { if (line.trim()) c.step.out = [line.trim()]; continue; }
          if (line.trim()) c.step.out = [line.trim()];
          c.step.status = 'done'; c.want = null; continue;
        }
      }
      close();
    }
    let m: RegExpExecArray | null;
    if (!partial && (WIDE_RE.test(line) || WIDE_GROUP_RE.test(line) || WIDE_PAGES_RE.test(line))) {
      const w = WIDE_RE.exec(line);
      if (w) {
        start('web', '', false, 'found');
        st.cur!.step.wide = { queries: Number(w[1]), raw: Number(w[2]), read: Number(w[3]) };
      }
      continue;
    }
    if ((m = WS_RE.exec(line))) { start(WS_KIND[m[1]], m[2] ?? '', true, null); continue; }
    if (!partial) {
      if ((m = MEM_RE.exec(line))) { start('memory', m[1], false, 'mem'); continue; }
      if ((m = WEB_RE.exec(line))) { start('web', m[1], false, 'found'); continue; }
      if ((m = TABLE_RE.exec(line))) { start('table', m[1], false, 'line'); continue; }
      if ((m = PY_RE.exec(line))) { start('python', m[1], false, 'py'); continue; }
      if ((m = NOTES_RE.exec(line))) {
        flushText();
        const n = Number(m[1]);
        segs.push({ t: 'note', kind: 'notes', text: n > 0 ? tr(lang, 'work.notes', { n }) : tr(lang, 'work.noNotes') });
        continue;
      }
      if ((m = CHECK_RE.exec(line))) {
        flushText();
        const nums = m[1] === 'проверка чисел' ? /^нет в расчётах — (.+); пересчитываю$/.exec(m[2]) : null;
        segs.push({ t: 'note', kind: 'check', text: nums ? tr(lang, 'work.chkNumbers', { list: nums[1] }) : errText(lang, m[1].charAt(0).toUpperCase() + m[1].slice(1) + ': ' + m[2]) });
        continue;
      }
    } else {
      const head = STEP_HEADS.find(([h]) => line.startsWith(h) && !(h === '[поиск: ' && line.startsWith('[поиск в')));
      if (head && !line.endsWith(']')) { start(head[1], line.slice(head[0].length), false, null); continue; }
      if (HEADS.some((h) => h.startsWith(line) || line.startsWith(h))) continue;
    }
    buf.push(line);
  }
  close();
  flushText();
  segs.forEach((s, k) => {
    if (s.t !== 'step' || s.step.status !== 'running') return;
    if (k < segs.length - 1 || !live) s.step.status = 'done';
  });
  return segs.filter((s) => !(s.t === 'step' && s.step.kind === 'memory'));
}

export type ToolSummary = { bash: number; calc: number; search: number };
export function toolSummary(segs: Seg[]): ToolSummary {
  const s: ToolSummary = { bash: 0, calc: 0, search: 0 };
  for (const g of segs) {
    if (g.t !== 'step') continue;
    const k = g.step.kind;
    if (k === 'bash') s.bash++;
    else if (k === 'python' || k === 'table') s.calc++;
    else s.search++;
  }
  return s;
}

export function summaryText(s: ToolSummary, lang: Lang = 'ru'): string {
  const parts: string[] = [];
  if (s.bash) parts.push(tr(lang, 'work.sum.cmd', { n: s.bash }));
  if (s.calc) parts.push(tr(lang, 'work.sum.calc', { n: s.calc }));
  if (s.search) parts.push(tr(lang, 'work.sum.search', { n: s.search }));
  return parts.join(' · ');
}
