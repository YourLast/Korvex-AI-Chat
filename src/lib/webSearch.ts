import { cfg } from './cfg';
import { deleteSetting, getSetting, setSetting } from './settings';
import { open, seal } from './github/secret';

export const SEARCH_KINDS = ['searxng', 'brave', 'tavily'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
export const SEARCH_LABEL: Record<SearchKind, string> = { searxng: 'SearXNG', brave: 'Brave Search API', tavily: 'Tavily' };
export type Hit = { url?: unknown; title?: unknown; content?: unknown; publishedDate?: unknown };
export type SearchOpts = { time_range?: 'day' | 'week' | 'month' | 'year'; language?: string; signal?: AbortSignal };
type Backend = { kind: SearchKind; url: string };
type Conf = { kind: SearchKind; url: string; key: string | null; from: 'admin' | 'env' };

const KEY_ENV: Record<Exclude<SearchKind, 'searxng'>, string> = { brave: 'KX_BRAVE_API_KEY', tavily: 'KX_TAVILY_API_KEY' };
const keyName = (k: SearchKind) => `webSearch.key.${k}`;
const clean = (u: string) => u.trim().replace(/\/+$/, '');

function storedKey(kind: SearchKind): string | null {
  const enc = getSetting<string | null>(keyName(kind), null);
  if (!enc) return null;
  try { return open(enc, `websearch:${kind}`); } catch { return null; }
}
const keyOf = (kind: SearchKind): string | null => (kind === 'searxng' ? null : storedKey(kind) || cfg(KEY_ENV[kind]).trim() || null);

export function searchConf(): Conf | null {
  const b = getSetting<Backend | null>('webSearch.backend', null);
  if (b && SEARCH_KINDS.includes(b.kind)) {
    const key = keyOf(b.kind);
    if (b.kind === 'searxng' ? !!clean(b.url ?? '') : !!key) return { kind: b.kind, url: clean(b.url ?? ''), key, from: 'admin' };
  }
  const searx = clean(cfg('KX_SEARX_URL'));
  if (searx) return { kind: 'searxng', url: searx, key: null, from: 'env' };
  for (const kind of ['brave', 'tavily'] as const) { const key = keyOf(kind); if (key) return { kind, url: '', key, from: 'env' }; }
  return null;
}

export function searchView() {
  const c = searchConf();
  const b = getSetting<Backend | null>('webSearch.backend', null);
  return {
    kind: (c?.kind ?? b?.kind ?? 'searxng') as SearchKind, url: b?.kind === 'searxng' ? clean(b.url) : c?.kind === 'searxng' ? c.url : '',
    active: !!c, from: c?.from ?? null,
    keys: { brave: !!keyOf('brave'), tavily: !!keyOf('tavily') },
    labels: SEARCH_LABEL,
  };
}

export function saveSearch(p: { kind: SearchKind; url?: string; key?: string | null }, by: string | null) {
  setSetting('webSearch.backend', { kind: p.kind, url: p.kind === 'searxng' ? clean(p.url ?? '') : '' }, by);
  if (p.kind !== 'searxng' && p.key !== undefined) {
    if (p.key === null || !p.key.trim()) deleteSetting(keyName(p.kind));
    else setSetting(keyName(p.kind), seal(p.key.trim(), `websearch:${p.kind}`), by);
  }
}

const FRESH_BRAVE = { day: 'pd', week: 'pw', month: 'pm', year: 'py' } as const;
const strip = (s: unknown) => (typeof s === 'string' ? s.replace(/<[^>]+>/g, '') : s);

export async function runSearch(c: Pick<Conf, 'kind' | 'url' | 'key'>, q: string, o: SearchOpts = {}, doFetch: typeof fetch = fetch): Promise<Hit[]> {
  const signal = AbortSignal.any([o.signal ?? new AbortController().signal, AbortSignal.timeout(20_000)]);
  if (c.kind === 'searxng') {
    const u = new URL(c.url);
    if (!/\/search$/.test(u.pathname)) u.pathname = u.pathname.replace(/\/*$/, '/search');
    u.searchParams.set('q', q);
    u.searchParams.set('format', 'json');
    if (o.time_range) u.searchParams.set('time_range', o.time_range);
    if (o.language) u.searchParams.set('language', o.language);
    const r = await doFetch(u, { signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { results?: Hit[] };
    return Array.isArray(j.results) ? j.results : [];
  }
  if (c.kind === 'brave') {
    const u = new URL('https://api.search.brave.com/res/v1/web/search');
    u.searchParams.set('q', q);
    u.searchParams.set('count', '8');
    if (o.time_range) u.searchParams.set('freshness', FRESH_BRAVE[o.time_range]);
    if (o.language) u.searchParams.set('search_lang', o.language.slice(0, 2));
    const r = await doFetch(u, { signal, headers: { Accept: 'application/json', 'X-Subscription-Token': c.key ?? '' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { web?: { results?: { url?: string; title?: string; description?: string; page_age?: string }[] } };
    return (j.web?.results ?? []).map((x) => ({ url: x.url, title: strip(x.title), content: strip(x.description), publishedDate: x.page_age }));
  }
  const r = await doFetch('https://api.tavily.com/search', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key ?? ''}` },
    body: JSON.stringify({ query: q, max_results: 8, ...(o.time_range ? { time_range: o.time_range } : {}) }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { results?: { url?: string; title?: string; content?: string; published_date?: string }[] };
  return (j.results ?? []).map((x) => ({ url: x.url, title: x.title, content: x.content, publishedDate: x.published_date }));
}
