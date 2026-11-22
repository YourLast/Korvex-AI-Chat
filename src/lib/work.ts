import { parseReasoning, type Seg, type ToolStep } from './reasoningSteps';
import type { Attachment, StepEvent, StepKind } from './tools/types';
import { LANGS, tr, type Key, type Lang } from './i18n/core';
import { DICT } from './i18n/dict';
import { errText } from './i18n/errors';

export type { StepEvent, Attachment };
export type WKind = 'bash' | 'python' | 'web' | 'memory' | 'table' | 'browser' | 'chat' | 'usermem' | 'file' | 'github' | 'code' | 'agent' | 'work' | 'steer' | 'other';
export type WStatus = 'run' | 'ok' | 'err' | 'timeout' | 'wait' | 'denied' | 'stopped';

export type DiffLine = { t: ' ' | '+' | '-'; s: string; a?: number; b?: number; hl?: [number, number]; ws?: boolean };
export type DiffFile = { path: string; add: number; del: number; status?: 'added' | 'modified' | 'deleted' | 'renamed'; from?: string; hunks: { head: string; lines: DiffLine[] }[] };

export type WStep = {
  id: string;
  kind: WKind;
  title: string;
  sub?: string;
  status: WStatus;
  recovered?: boolean;
  result?: string;
  thumb?: Attachment;
  shots?: Attachment[];
  live?: string;
  host?: string;
  term?: { lang: 'bash' | 'python'; cmd?: string; out: string[]; more: boolean; code: boolean };
  text?: string;
  diff?: DiffFile[];
  diffRaw?: string;
  search?: SearchInfo;
  wide?: { queries: number; raw?: number; read?: number };
  ask?: { text: string; allow?: string; deny?: string };
  check?: { host: string; until: number; open?: boolean };
  agent?: StepEvent['agent'];
  kids?: WStep[];
  icon?: string;
  http?: number;
  t0?: number;
  t1?: number;
  src: 'serve' | 'event';
};

export type WItem =
  | { t: 'think'; id: string; text: string; live: boolean }
  | { t: 'step'; step: WStep }
  | { t: 'group'; id: string; kind: WKind; host?: string; steps: WStep[] }
  | { t: 'note'; id: string; kind: 'check' | 'notes'; text: string };

export const KIND_ICON: Record<WKind, string> = {
  bash: 'terminal', python: 'code', web: 'globe', memory: 'doc', table: 'table', browser: 'browser', chat: 'chat', usermem: 'memory',
  file: 'doc', github: 'branch', code: 'branch', agent: 'agents', work: 'work', steer: 'steer', other: 'tool',
};
export const kindName = (k: WKind, lang: Lang = 'ru'): string => tr(lang, `work.kind.${k}` as const);
const serveTitle = (k: ToolStep['kind'], lang: Lang): [string, string] => { const [a, b] = tr(lang, `work.sv.${k}` as const).split('|'); return [a, b]; };

export function fmtDur(ms: number, lang: Lang = 'ru'): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? tr(lang, 'work.dur.s', { s: s || 1 }) : tr(lang, 'work.dur.ms', { m: Math.floor(s / 60), s: s % 60 });
}
const EV_KIND: Record<StepKind, WKind> = {
  browser: 'browser', chat: 'chat', memory: 'usermem', file: 'file', github: 'github', agent: 'agent', code: 'code', web: 'web', work: 'work', steer: 'steer', other: 'other',
};
const EV_STATUS: Record<StepEvent['status'], WStatus> = { run: 'run', ok: 'ok', err: 'err', wait_user: 'wait', denied: 'denied', stopped: 'stopped' };
const SERVE_STATUS: Record<ToolStep['status'], WStatus> = { running: 'run', done: 'ok', error: 'err', timeout: 'timeout' };

type VForm = { form: string; id: string; past: boolean; ru: boolean };
const lc = (w: string) => w.toLowerCase().replace(/ё/g, 'е');
let VFORMS: VForm[] | null = null;
function vforms(): VForm[] {
  if (VFORMS) return VFORMS;
  const out: VForm[] = [];
  for (const k of Object.keys(DICT)) {
    if (!k.startsWith('work.v.')) continue;
    for (const l of LANGS) tr(l, k as Key).split('|').forEach((f, i) => { if (f) out.push({ form: lc(f), id: k.slice(7), past: i === 1, ru: l === 'ru' }); });
  }
  return (VFORMS = out.sort((x, y) => y.form.length - x.form.length));
}
export function verbAt(title: string): { id: string; len: number; past: boolean; ru: boolean } | null {
  const low = lc(title);
  for (const v of vforms()) if (low.startsWith(v.form) && !/^\p{L}/u.test(low.slice(v.form.length))) return { id: v.id, len: v.form.length, past: v.past, ru: v.ru };
  return null;
}
const tail = (n: string, v: { len: number; ru: boolean }, lang: Lang): string => {
  const rest = n.slice(v.len);
  return v.ru && lang !== 'ru' ? rest.replace(/(^|\s)на\s+(?=(?:[\p{L}\p{N}-]+\.)+\p{L}{2,})/gu, `$1${tr(lang, 'work.onSite')} `) : rest;
};
const verbForm = (lang: Lang, id: string, past: boolean): string => tr(lang, `work.v.${id}` as Key).split('|')[past ? 1 : 0];
const hasVerb = (title: string, ...ids: string[]) => { const v = verbAt(title); return !!v && ids.includes(v.id); };

export function pastTitle(t: string, lang: Lang = 'ru'): string {
  const n = normTitle(t, lang);
  if (/^Не \S/.test(n) && lang === 'ru') { const r = pastTitle(n.slice(3), lang); return 'Не ' + r.charAt(0).toLowerCase() + r.slice(1); }
  if (/^Спрашивает чат /.test(n)) return tr(lang, 'work.askedChat', { name: n.slice('Спрашивает чат '.length) });
  const v = verbAt(n);
  return v ? verbForm(lang, v.id, true) + tail(n, v, lang) : n;
}
export function normTitle(t: string, lang: Lang = 'ru'): string {
  if (lang !== 'ru') return t;
  return t.replace(/^(\S+ текст) в ([«„"])/u, '$1 в поле $2')
    .replace(/^(Открывает|Открыл|Переходит на|Перешёл на) ((?:[\p{L}\p{N}-]+\.)+\p{L}{2,})(?=$|\s)/u, '$1 сайт $2');
}

export function askTitle(t: string, denied = false, lang: Lang = 'ru'): string {
  const n = normTitle(t, lang);
  const v = verbAt(n);
  const key = v && !v.past ? (`work.va.${v.id}` as Key) : null;
  if (!v || !key || !(key in DICT)) return denied ? tr(lang, 'work.cancelled', { text: n }) : n;
  const [q, no] = tr(lang, key).split('|');
  const rest = tail(n, v, lang);
  return denied ? `${no}${rest}` : `${q}${rest.replace(/[.!]?$/, '')}?`;
}

const FIRST: Record<string, [string, string]> = {
  'сравниваю': ['Сравнивает', 'Сравнил'], 'считаю': ['Считает', 'Посчитал'], 'подсчитываю': ['Подсчитывает', 'Подсчитал'], 'проверяю': ['Проверяет', 'Проверил'],
  'строю': ['Строит', 'Построил'], 'рисую': ['Рисует', 'Нарисовал'], 'читаю': ['Читает', 'Прочитал'], 'сохраняю': ['Сохраняет', 'Сохранил'], 'создаю': ['Создаёт', 'Создал'],
  'собираю': ['Собирает', 'Собрал'], 'анализирую': ['Анализирует', 'Проанализировал'], 'ищу': ['Ищет', 'Искал'], 'группирую': ['Группирует', 'Сгруппировал'],
  'сортирую': ['Сортирует', 'Отсортировал'], 'фильтрую': ['Фильтрует', 'Отфильтровал'], 'вычисляю': ['Вычисляет', 'Вычислил'], 'генерирую': ['Генерирует', 'Сгенерировал'],
  'готовлю': ['Готовит', 'Подготовил'], 'загружаю': ['Загружает', 'Загрузил'], 'пишу': ['Пишет', 'Написал'], 'делаю': ['Делает', 'Сделал'], 'нахожу': ['Находит', 'Нашёл'],
  'считываю': ['Считывает', 'Считал'], 'объединяю': ['Объединяет', 'Объединил'], 'складываю': ['Складывает', 'Сложил'], 'оцениваю': ['Оценивает', 'Оценил'],
  'извлекаю': ['Извлекает', 'Извлёк'], 'парсю': ['Разбирает', 'Разобрал'], 'разбираю': ['Разбирает', 'Разобрал'], 'конвертирую': ['Конвертирует', 'Сконвертировал'],
};
function codeTitle(label: string, done: boolean): string | null {
  const m = /^([\p{L}-]+)([\s\S]*)$/u.exec(label.trim());
  const f = m && FIRST[m[1].toLowerCase()];
  return f ? f[done ? 1 : 0] + m![2] : null;
}

export const quote = (s: string, lang: Lang = 'ru'): string => (lang === 'en' ? `“${s}”` : lang === 'sr' ? `„${s}“` : `«${s}»`);
const quoted = (q: string, lang: Lang) => (q && !/^[«"„“]/.test(q) ? quote(q, lang) : q);

export type SearchInfo = { groups: { name: string; items: string[] }[]; pages?: { host: string; label?: string }[]; more?: boolean; total: number };

const COMMUNITY_RE = /\bsite:|reddit|\bforum|форум|t\.me\b|telegram|телеграм|vk\.com|habr|pikabu|отзыв/i;
const SR_CYR_RE = /[ђћџљњјЂЋЏЉЊЈ]/;
const SR_LAT_RE = /[šđčćžŠĐČĆŽ]/;
const script = (q: string) => (/[А-Яа-яЁё]/.test(q) ? 'cyr' : /[A-Za-z]/.test(q) ? 'lat' : 'other');
export function searchGroups(qs: string[], own?: { name: string; items: string[] }[], lang: Lang = 'ru'): SearchInfo['groups'] {
  if (own?.length) return lang === 'ru' ? own : own.map((g) => ({ ...g, name: groupName(g.name, lang) }));
  const main = script(qs[0] ?? '');
  const g: Record<'main' | 'local' | 'comm', string[]> = { main: [], local: [], comm: [] };
  for (const q of qs) {
    if (COMMUNITY_RE.test(q)) g.comm.push(q);
    else if (SR_CYR_RE.test(q) || SR_LAT_RE.test(q) || (script(q) !== main && script(q) !== 'other')) g.local.push(q);
    else g.main.push(q);
  }
  return (['main', 'local', 'comm'] as const).filter((k) => g[k].length).map((k) => ({ name: tr(lang, `work.sq.${k}` as const), items: g[k] }));
}
function groupName(name: string, lang: Lang): string {
  const n = name.trim().toLowerCase();
  const k = /^(основн|main|glavn|osnovn)/.test(n) ? 'main' : /(местн|local|lokaln|domaći)/.test(n) ? 'local' : /(сообществ|communit|zajednic)/.test(n) ? 'comm' : null;
  return k ? tr(lang, `work.sq.${k}` as const) : name;
}

export function fromServe(s: ToolStep, id: string, lang: Lang = 'ru'): WStep {
  const status = SERVE_STATUS[s.status];
  const [now, past] = serveTitle(s.kind, lang);
  const term = s.kind === 'bash' || s.kind === 'python';
  const own = lang !== 'ru' || (s.kind === 'python' && !s.code) ? null : s.kind === 'python' ? codeTitle(s.query, status !== 'run') : null;
  if (s.kind === 'web' && s.wide) {
    const w = s.wide, qs = s.qlist ?? [];
    const parts = [`${verbForm(lang, 'search', status !== 'run')} ${tr(lang, 'work.queries', { n: String(w.queries) })}`];
    if (w.raw !== undefined) parts.push(tr(lang, 'work.results', { n: String(w.raw) }));
    if (w.read !== undefined) parts.push(tr(lang, 'work.pages', { n: String(w.read) }));
    return {
      id, kind: 'web', src: 'serve', status, title: parts.join(' · '), wide: w,
      ...(qs.length || s.pages?.length ? { search: { groups: searchGroups(qs, s.qgroups, lang), pages: s.pages, more: !!s.qmore, total: w.queries } } : {}),
    };
  }
  return {
    id, kind: s.kind, src: 'serve', status,
    title: own ?? (status === 'run' ? now : past),
    sub: own ? undefined : (s.kind === 'web' || s.kind === 'memory' ? quoted(s.query, lang) : s.query) || undefined,
    result: s.result,
    ...(term && (s.code || s.query) ? { term: { lang: s.kind as 'bash' | 'python', cmd: s.query || undefined, out: s.out, more: s.more, code: !!s.code } } : {}),
    ...(!term && s.out.length ? { text: s.out.join('\n') } : {}),
  };
}

export function hostOf(u: string | undefined): string | undefined {
  if (!u) return undefined;
  const m = /(?:^|[\s/«"„(])((?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,})(?=$|[\s/:?#»"“),.])/u.exec(u);
  if (!m || /\.(pdf|docx?|xlsx?|pptx?|csv|txt|md|png|jpe?g|gif|webp|zip|json|html?|tsx?|jsx?|py|sh|log)$/i.test(m[1])) return undefined;
  return m[1].replace(/^www\./, '').toLowerCase();
}

export function diffText(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  const fence = /```(?:diff|patch)\n([\s\S]*?)```/.exec(detail);
  const src = fence ? fence[1] : /^(diff --git |--- a\/|--- \/dev\/null)/m.test(detail) && /^@@ /m.test(detail) ? detail : '';
  return src || undefined;
}
export function diffOf(detail: string | undefined): DiffFile[] | undefined {
  const src = diffText(detail);
  if (!src) return undefined;
  const files = parseDiff(src);
  return files.length ? files : undefined;
}

export function toolIcon(tool: string | undefined): string | undefined {
  if (!tool) return undefined;
  if (/(^|_)(run|test|tests|exec|shell|bash|cmd)$/.test(tool)) return 'terminal';
  if (/(^|_)(read|files?_get|open_file)$/.test(tool)) return 'doc';
  if (/_(search|grep|find)$/.test(tool) && tool !== 'web_search') return 'search';
  if (/^(code|github)_(commit|push|pr|branch|clone|status|diff)$/.test(tool)) return 'branch';
  if (/^code_edit$/.test(tool)) return 'edit';
  if (/^browser_(click|type|scroll|press|hover|select)$/.test(tool)) return 'cursor';
  if (tool === 'browser_snapshot') return 'doc';
  if (tool === 'browser_screenshot') return 'image';
  return undefined;
}

export function shortUrl(u: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:www\.)?([^/?#\s]+)([^?#\s]*)/i.exec(u);
  if (!m) return u;
  const path = m[2].replace(/\/+$/, '');
  return m[1].toLowerCase() + (path.length > 32 ? path.slice(0, 31) + '…' : path);
}
export function pageOf(detail: string | undefined): { url?: string; http?: number } {
  const first = (detail ?? '').split('\n')[0];
  const url = /^(https?:\/\/\S+)/.exec(first)?.[1];
  const http = Number(/HTTP\s+(\d{3})/.exec(first)?.[1]) || undefined;
  return { url, http };
}

export function fromEvent(e: StepEvent, lang: Lang = 'ru'): WStep {
  const kind = EV_KIND[e.kind] ?? 'other';
  const status = EV_STATUS[e.status] ?? 'run';
  const diffRaw = kind === 'github' || kind === 'code' || kind === 'file' ? diffText(e.detail) : undefined;
  const diff = diffRaw ? diffOf(e.detail) : undefined;
  const text = diff ? (e.detail ?? '').replace(/```(?:diff|patch)\n[\s\S]*?```/, '').trim() || undefined : e.detail || undefined;
  const shots = (e.attachments ?? []).filter((a) => a.kind === 'image');
  const st = diff ? diffStat(diff) : null;
  const page = kind === 'browser' ? pageOf(e.detail) : {};
  const rest = page.url ? (text ?? '').split('\n').slice(1).join('\n').trim() || undefined : text;
  const short = !diff && rest && !rest.includes('\n') && rest.length <= 48 ? rest : undefined;
  const many = diff && diff.length > 1 ? diff.length : 0;
  const raw = errText(lang, e.title);
  let title = kind === 'steer' ? tr(lang, 'work.you') : status === 'ok' ? pastTitle(raw, lang) : status === 'wait' && !e.check ? askTitle(raw, false, lang) : status === 'denied' ? askTitle(raw, true, lang) : normTitle(raw, lang);
  if (page.url) {
    const su = shortUrl(page.url), host = su.split('/')[0];
    if (su !== host && title.includes(su)) title = title.replace(`сайт ${su}`, su);
    else if (su !== host && title.includes(host)) title = title.replace(`сайт ${host}`, host).replace(host, su);
  }
  if (many && hasVerb(title, 'change', 'change2', 'fix')) title = tr(lang, status === 'ok' ? 'work.filesChanged' : 'work.filesChanging', { n: many });
  return {
    id: e.id, kind, src: 'event', status,
    title,
    sub: kind === 'steer' ? e.title : short,
    icon: toolIcon(e.tool),
    result: st ? `+${st.add} −${st.del}` : page.http && page.http >= 400 ? String(page.http) : undefined,
    http: page.http,
    thumb: e.thumb ?? shots[shots.length - 1],
    shots: shots.length ? shots : e.thumb ? [e.thumb] : undefined,
    live: e.live?.session,
    host: kind === 'browser' ? (page.url ? shortUrl(page.url).split('/')[0] : undefined) ?? hostOf(e.title) ?? hostOf(e.detail) : undefined,
    text: kind === 'steer' || short ? undefined : rest,
    diff,
    diffRaw: diff ? diffRaw : undefined,
    ask: e.ask && { text: errText(lang, e.ask.text), allow: e.ask.allow && errText(lang, e.ask.allow), deny: e.ask.deny && errText(lang, e.ask.deny) },
    check: status === 'wait' && e.check ? e.check : undefined,
    agent: e.agent,
    t0: e.t0, t1: e.t1,
  };
}

export function pendingCheck(evs: StepEvent[] | null | undefined): (StepEvent & { check: NonNullable<StepEvent['check']> }) | null {
  const e = latestSteps(evs ?? []).find((x) => x.status === 'wait_user' && x.check);
  return e ? (e as StepEvent & { check: NonNullable<StepEvent['check']> }) : null;
}

export function latestSteps(evs: StepEvent[]): StepEvent[] {
  const by = new Map<string, StepEvent>();
  for (const e of evs) if (e && e.id) by.set(e.id, e);
  return [...by.values()].sort((a, b) => (a.at?.r ?? 0) - (b.at?.r ?? 0) || (a.t0 ?? 0) - (b.t0 ?? 0));
}

function segItems(segs: Seg[], base: string, live: boolean, lang: Lang): WItem[] {
  return segs.map((g, i): WItem => {
    const id = `${base}.${i}`;
    if (g.t === 'step') return { t: 'step', step: fromServe(g.step, id, lang) };
    if (g.t === 'note') return { t: 'note', id, kind: g.kind, text: g.text };
    return { t: 'think', id, text: g.text, live: live && i === segs.length - 1 };
  });
}

export function buildFeed(reasoning: string, events: StepEvent[] = [], live = false, done = false, lang: Lang = 'ru', calm = false): WItem[] {
  const text = String(reasoning ?? '');
  const evs = latestSteps(events).map((e) => (done && e.status === 'run' ? { ...e, status: 'ok' as const } : e));
  const ids = new Set(evs.map((e) => e.id));
  const kids = new Map<string, WStep[]>();
  const top: StepEvent[] = [];
  for (const e of evs) {
    if (e.parent && ids.has(e.parent)) { const k = kids.get(e.parent) ?? []; k.push(fromEvent(e, lang)); kids.set(e.parent, k); } else top.push(e);
  }
  const atOf = (e: StepEvent) => snapCut(text, Math.max(0, Math.min(text.length, e.at?.r ?? text.length)));
  const cuts = [...new Set(top.map(atOf))].sort((a, b) => a - b);
  const items: WItem[] = [];
  let from = 0;
  const flushText = (to: number, last: boolean) => {
    const s = text.slice(from, to);
    if (s) items.push(...segItems(parseReasoning(s, live && last, lang), `r${from}`, live && last, lang));
    from = to;
  };
  for (const c of cuts) {
    flushText(c, false);
    for (const e of top) if (atOf(e) === c) {
      const w = fromEvent(e, lang);
      const k = kids.get(e.id);
      if (k?.length) {
        w.kids = k;
        w.host ??= k.map((x) => x.host).filter(Boolean).pop();
        w.thumb ??= [...k].reverse().find((x) => x.thumb)?.thumb;
        if (w.kind === 'browser') w.live ??= k.map((x) => x.live).filter(Boolean).pop();
      }
      items.push({ t: 'step', step: w });
    }
  }
  flushText(text.length, true);
  let host: string | undefined;
  for (const it of items) {
    if (it.t !== 'step' || it.step.kind !== 'browser') continue;
    if (it.step.host) host = it.step.host; else it.step.host = host;
  }
  const out = group(items);
  if (calm) markRecovered(out);
  return out;
}

export function markRecovered(items: WItem[]): void {
  const seq: WStep[] = [];
  const walk = (s: WStep) => { (s.kids ?? []).forEach(walk); seq.push(s); };
  for (const it of items) { if (it.t === 'step') walk(it.step); else if (it.t === 'group') it.steps.forEach(walk); }
  let later = false;
  for (let i = seq.length - 1; i >= 0; i--) {
    const s = seq[i];
    if (s.status === 'ok' && s.kind !== 'steer') later = true;
    else if (s.status === 'err' && later) s.recovered = true;
  }
}

export function turnSettled(m: { streaming?: boolean; content?: string | null; meta?: { error?: string | null; errorUser?: string | null; stopped?: boolean } | null }): boolean {
  return !m.streaming && !!m.content?.trim() && !m.meta?.error && !m.meta?.errorUser && !m.meta?.stopped;
}

const STEP_LINE = /^(\[поиск: |\[поиск в памяти: |\[python → |\[расчёт по таблице: |▸ (bash|python|память):)/;
const RESULT_LINE = /^(\[найдено: |\[в памяти: |\[python: |\[выписки: | {4})/;
export function snapCut(text: string, c: number): number {
  let pos = c;
  if (pos > 0 && pos < text.length && text[pos - 1] !== '\n') { const nl = text.indexOf('\n', pos); pos = nl < 0 ? text.length : nl + 1; }
  const lines = text.slice(0, pos).replace(/\n$/, '').split('\n');
  let i = lines.length - 1;
  while (i > 0 && RESULT_LINE.test(lines[i])) i--;
  const last = lines[i] ?? '';
  if (!STEP_LINE.test(last)) return pos;
  const table = last.startsWith('[расчёт по таблице: ') && i === lines.length - 1;
  for (let k = 0; pos < text.length; k++) {
    const nl = text.indexOf('\n', pos);
    const line = text.slice(pos, nl < 0 ? text.length : nl);
    if (!(RESULT_LINE.test(line) || (table && k === 0 && line.trim() && !STEP_LINE.test(line)))) break;
    pos = nl < 0 ? text.length : nl + 1;
  }
  return pos;
}

const groupKey = (s: WStep): string | null => {
  if (s.status === 'wait' || s.status === 'err' || s.kind === 'steer' || s.kind === 'agent' || s.diff || s.kind === 'usermem' || s.kids?.length) return null;
  if (s.kind === 'browser') return `browser:${s.host ?? ''}`;
  return s.kind === 'bash' || s.kind === 'web' || s.kind === 'memory' ? s.kind : null;
};

export function group(items: WItem[], min = 3): WItem[] {
  const out: WItem[] = [];
  let run: WItem[] = [];
  let key: string | null = null;
  const need = (k: string | null) => (k?.startsWith('browser:') ? Math.min(min, 2) : min);
  const flush = () => {
    let last = run.length - 1;
    while (last >= 0 && run[last].t !== 'step') last--;
    const body = run.slice(0, last + 1), tail = run.slice(last + 1);
    const steps = body.flatMap((x) => (x.t === 'step' ? [x.step] : []));
    if (steps.length >= need(key)) out.push({ t: 'group', id: `g.${steps[0].id}`, kind: steps[0].kind, host: steps[0].host, steps });
    else out.push(...body);
    out.push(...tail);
    run = []; key = null;
  };
  for (const it of items) {
    if (it.t === 'step') {
      const k = groupKey(it.step);
      if (k && k === key) { run.push(it); continue; }
      flush();
      if (k) { run = [it]; key = k; } else out.push(it);
      continue;
    }
    if (it.t === 'think' && key && !it.live && (key.startsWith('browser:') || (it.text.length <= 90 && !it.text.includes('\n')))) { run.push(it); continue; }
    flush();
    out.push(it);
  }
  flush();
  return out;
}

export function allSteps(items: WItem[]): WStep[] {
  return items.flatMap((it) => (it.t === 'step' ? [it.step, ...(it.step.kids ?? [])] : it.t === 'group' ? it.steps : []));
}
export function countSteps(items: WItem[]): number {
  return items.reduce((n, it) => n + (it.t === 'step' ? (it.step.kind === 'steer' ? 0 : 1) : it.t === 'group' ? it.steps.length : 0), 0);
}

export type Now = { kind: 'step'; step: WStep } | { kind: 'think'; text: string };
export function nowOf(items: WItem[]): Now | null {
  const steps = allSteps(items);
  const wait = steps.find((s) => s.status === 'wait');
  if (wait) return { kind: 'step', step: wait };
  const run = [...steps].reverse().find((s) => s.status === 'run' && s.kind !== 'steer');
  if (run) return { kind: 'step', step: run };
  const last = items[items.length - 1];
  if (last?.t === 'think' && last.live) { const t = lastSentence(last.text); return t ? { kind: 'think', text: t } : null; }
  return null;
}

export function lastSentence(t: string): string {
  const plain = t.replace(/```[\s\S]*?```/g, ' ').replace(/\[\[t:\s*/g, '').replace(/\]\]/g, '. ').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
  const parts = plain.split(/(?<=[.!?…])\s+/).filter((x) => x.trim().length > 2);
  const s = (parts.length > 1 && !/[.!?…]$/.test(parts[parts.length - 1]) ? parts[parts.length - 2] : parts[parts.length - 1]) ?? plain;
  return s.length > 90 ? s.slice(0, 89).trimEnd() + '…' : s;
}

export function summaryTail(items: WItem[], lang: Lang = 'ru'): string {
  const steps = allSteps(items);
  if (steps.some((s) => s.status === 'wait')) return tr(lang, 'work.st.wait');
  const err = steps.filter((s) => s.status === 'err' && !s.recovered).length;
  if (err) return tr(lang, 'work.errors', { n: err });
  const files = new Set(steps.flatMap((s) => (s.diff ?? []).map((f) => f.path))).size;
  if (files) return tr(lang, 'work.files', { n: files });
  const sent = steps.filter((s) => s.status === 'ok' && (s.kind === 'chat' || s.kind === 'agent') && hasVerb(s.title, 'send', 'write', 'ask')).length;
  if (sent) return tr(lang, 'work.sentN', { n: sent });
  return '';
}

export function summaryLine(items: WItem[], ms: number | null, fmt: (ms: number) => string, lang: Lang = 'ru', simple = false): string {
  const n = simple ? 0 : countSteps(items);
  const time = ms && ms > 0 ? ` ${fmt(ms)}` : '';
  if (!n) return `${tr(lang, 'work.sum.think')}${time}`;
  const tail = summaryTail(items, lang);
  return `${tr(lang, 'work.sum.work')}${time} · ${tr(lang, 'work.steps', { n })}${tail ? ' · ' + tail : ''}`;
}

export function historyOf(items: WItem[], max = 6): WStep[] {
  const s = items.flatMap((it) => (it.t === 'step' ? [it.step] : it.t === 'group' ? it.steps : []));
  return s.slice(Math.max(0, s.length - max));
}

const FAIL_IN_TITLE = /упал|ошибк|не удалось|не пройден|\bfail(?:ed|ure)?\b|\berror\b|couldn['’]t|not passed|greš|nije uspe|nisu prošl|nije prođen|pali\b/i;
export function statusText(s: WStep, lang: Lang = 'ru'): string {
  if (s.status === 'run') return '';
  if (s.status === 'wait') return tr(lang, 'work.st.wait');
  if (s.status === 'err') return s.recovered || FAIL_IN_TITLE.test(s.title) ? '' : tr(lang, 'work.st.err');
  if (s.status === 'timeout') return tr(lang, 'work.st.timeout');
  if (s.status === 'denied') return tr(lang, 'work.st.denied');
  if (s.status === 'stopped') return tr(lang, 'work.st.stopped');
  return s.result ?? '';
}
export function statusSpoken(s: WStep, lang: Lang = 'ru'): string {
  if (s.status === 'err' && s.recovered) return tr(lang, 'work.st.retried');
  return s.status === 'run' ? tr(lang, 'work.st.running') : statusText(s, lang) || tr(lang, 'work.st.done');
}

export function diffStat(files: DiffFile[]): { add: number; del: number } {
  return files.reduce((a, f) => ({ add: a.add + (f.add || 0), del: a.del + (f.del || 0) }), { add: 0, del: 0 });
}

export function parseDiff(src: string): DiffFile[] {
  const files: DiffFile[] = [];
  let f: DiffFile | null = null;
  let cur: { head: string; lines: DiffLine[] } | null = null;
  let a = 0, b = 0;
  const open = (path: string): DiffFile => { const x: DiffFile = { path, add: 0, del: 0, hunks: [] }; files.push(x); f = x; cur = null; return x; };
  for (const raw of src.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')) {
    let m: RegExpExecArray | null;
    if ((m = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw))) { const x = open(m[2]); if (m[1] !== m[2]) { x.status = 'renamed'; x.from = m[1]; } continue; }
    if (/^(index |similarity |rename (from|to) |old mode|new mode)/.test(raw)) continue;
    if (/^new file mode/.test(raw)) { if (f) (f as DiffFile).status = 'added'; continue; }
    if (/^deleted file mode/.test(raw)) { if (f) (f as DiffFile).status = 'deleted'; continue; }
    if ((m = /^--- (?:a\/(.+)|\/dev\/null)$/.exec(raw))) {
      const x: DiffFile = !f || (f as DiffFile).hunks.length ? open(m[1] ?? '') : (f as DiffFile);
      if (!m[1]) x.status = 'added';
      continue;
    }
    if ((m = /^\+\+\+ (?:b\/(.+)|\/dev\/null)$/.exec(raw))) { const x = (f ?? open('')) as DiffFile; if (m[1]) x.path = m[1]; else x.status = 'deleted'; continue; }
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (h) { const x = (f ?? open('')) as DiffFile; const c = { head: h[3].trim(), lines: [] as DiffLine[] }; x.hunks.push(c); cur = c; a = Number(h[1]); b = Number(h[2]); continue; }
    if (!cur || raw.startsWith('\\')) continue;
    const c = cur as { head: string; lines: DiffLine[] };
    const x = f as unknown as DiffFile;
    if (raw[0] === '+') { c.lines.push({ t: '+', s: raw.slice(1), b: b++ }); x.add++; }
    else if (raw[0] === '-') { c.lines.push({ t: '-', s: raw.slice(1), a: a++ }); x.del++; }
    else { c.lines.push({ t: ' ', s: raw.slice(1), a: a++, b: b++ }); }
  }
  for (const x of files) for (const h of x.hunks) pairLines(h.lines, x);
  return files.filter((x) => x.path || x.hunks.length);
}

function pairLines(lines: DiffLine[], f: DiffFile) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t !== '-') continue;
    let j = i; while (j < lines.length && lines[j].t === '-') j++;
    let k = j; while (k < lines.length && lines[k].t === '+') k++;
    let from = j;
    for (let p = i; p < j; p++) {
      const a = lines[p];
      let best = -1, bs = 0.5;
      for (let q = from; q < k; q++) { const v = likeness(a.s, lines[q].s); if (v > bs) { bs = v; best = q; } if (v === 1) break; }
      if (best < 0) continue;
      const b = lines[best];
      from = best + 1;
      if (a.s === b.s) { b.t = ' '; b.a = a.a; a.t = ' '; a.s = '\u0000'; f.add--; f.del--; continue; }
      let s0 = 0; while (s0 < a.s.length && s0 < b.s.length && a.s[s0] === b.s[s0]) s0++;
      let e = 0; while (e < a.s.length - s0 && e < b.s.length - s0 && a.s[a.s.length - 1 - e] === b.s[b.s.length - 1 - e]) e++;
      if (a.s.length - e > s0) a.hl = [s0, a.s.length - e];
      if (b.s.length - e > s0) b.hl = [s0, b.s.length - e];
      if (a.s.replace(/\s+/g, '') === b.s.replace(/\s+/g, '')) { a.ws = true; b.ws = true; }
    }
    i = k - 1;
  }
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].s === '\u0000') lines.splice(i, 1);
}

export function likeness(a: string, b: string): number {
  if (a === b || a.replace(/\s+/g, '') === b.replace(/\s+/g, '')) return 1;
  const n = Math.max(a.length, b.length);
  if (!n) return 1;
  let s0 = 0; while (s0 < a.length && s0 < b.length && a[s0] === b[s0]) s0++;
  let e = 0; while (e < a.length - s0 && e < b.length - s0 && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return (s0 + e) / n;
}
