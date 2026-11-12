import { stripMarkers } from './srcmark';
import type Database from 'better-sqlite3';
import { getDb } from './db';
import type { Message } from './db/schema';
import { activePath, messageSkeleton, messagesById } from './tree';
import { expandPairs } from './pairs';
import { getModel } from './models';
import {
  dl, fold, ftsFuzzy, ftsPhrase, ftsTier, fuzzyPrefix, indexText, matcherOf, parseQuery, plainText, segments, snippet, type Seg, type Term,
} from './textsearch';

export const INDEX_VERSION = '3';

type Kind = 't' | 'u' | 'a' | 'f';
const KIND_W: Record<Kind, number> = { t: 2.6, f: 1.6, u: 1.25, a: 1 };
const FUZZY_W = 0.6, FUZZY_PREFIX_W = 0.4;
const COL_W = '1.0, 0.55';

type G = { ready: boolean; gen: number; vocab: { gen: number; at: number; terms: Record<'body' | 'alt', { term: string; doc: number }[]> } | null; st: Record<string, Database.Statement> };
const g = globalThis as unknown as { __kxSearch?: G };
const S = (): G => (g.__kxSearch ??= { ready: false, gen: 0, vocab: null, st: {} });

const raw = () => (getDb() as unknown as { $client: Database.Database }).$client;
function st(sql: string): Database.Statement {
  const s = S();
  return (s.st[sql] ??= raw().prepare(sql));
}

function removeDoc(kinds: Kind[], ref: string) {
  for (const k of kinds) {
    const ex = st('SELECT id FROM search_docs WHERE kind = ? AND ref = ?').get(k, ref) as { id: number } | undefined;
    if (!ex) continue;
    st('DELETE FROM search_fts WHERE rowid = ?').run(ex.id);
    st('DELETE FROM search_docs WHERE id = ?').run(ex.id);
  }
}

function upsertDoc(kind: Kind, ref: string, threadId: string, userId: string, at: number, text: string) {
  const { body, alt } = indexText(text);
  const ex = st('SELECT id FROM search_docs WHERE kind = ? AND ref = ?').get(kind, ref) as { id: number } | undefined;
  if (!body) { if (ex) removeDoc([kind], ref); return; }
  if (ex) {
    st('DELETE FROM search_fts WHERE rowid = ?').run(ex.id);
    st('UPDATE search_docs SET thread_id = ?, user_id = ?, at = ? WHERE id = ?').run(threadId, userId, at, ex.id);
    st('INSERT INTO search_fts(rowid, body, alt) VALUES (?, ?, ?)').run(ex.id, body, alt);
  } else {
    const r = st('INSERT INTO search_docs(kind, ref, thread_id, user_id, at) VALUES (?, ?, ?, ?, ?)').run(kind, ref, threadId, userId, at);
    st('INSERT INTO search_fts(rowid, body, alt) VALUES (?, ?, ?)').run(r.lastInsertRowid, body, alt);
  }
}

function indexOne(kind: string, ref: string) {
  if (kind === 'm') {
    const r = st(`SELECT m.thread_id AS th, m.role, m.content, m.created_at AS at, t.user_id AS uid FROM messages m JOIN threads t ON t.id = m.thread_id WHERE m.id = ?`).get(ref) as
      { th: string; role: string; content: string; at: number; uid: string } | undefined;
    if (!r) return removeDoc(['u', 'a'], ref);
    const k: Kind = r.role === 'user' ? 'u' : 'a';
    removeDoc([k === 'u' ? 'a' : 'u'], ref);
    upsertDoc(k, ref, r.th, r.uid, r.at, r.role === 'assistant' ? stripMarkers(r.content) : r.content);
  } else if (kind === 't') {
    const r = st('SELECT user_id AS uid, title, updated_at AS at FROM threads WHERE id = ?').get(ref) as { uid: string; title: string; at: number } | undefined;
    if (!r) {
      for (const d of st('SELECT id FROM search_docs WHERE thread_id = ?').all(ref) as { id: number }[]) { st('DELETE FROM search_fts WHERE rowid = ?').run(d.id); st('DELETE FROM search_docs WHERE id = ?').run(d.id); }
      return;
    }
    upsertDoc('t', ref, ref, r.uid, r.at, r.title === 'Новый чат' ? '' : r.title);
  } else if (kind === 'f') {
    const r = st('SELECT thread_id AS th, user_id AS uid, name, created_at AS at FROM files WHERE id = ?').get(ref) as { th: string | null; uid: string; name: string; at: number } | undefined;
    if (!r || !r.th) return removeDoc(['f'], ref);
    upsertDoc('f', ref, r.th, r.uid, r.at, r.name);
  }
}

function ensure() {
  const s = S();
  if (s.ready) return;
  const db = raw();
  getDb();
  const v = (db.prepare("SELECT v FROM search_meta WHERE k = 'version'").get() as { v: string } | undefined)?.v;
  if (v !== INDEX_VERSION) {
    db.transaction(() => {
      db.prepare("INSERT INTO search_fts(search_fts) VALUES ('delete-all')").run();
      db.prepare('DELETE FROM search_docs').run();
      db.prepare("INSERT OR IGNORE INTO search_dirty SELECT 't', id FROM threads").run();
      db.prepare("INSERT OR IGNORE INTO search_dirty SELECT 'm', id FROM messages").run();
      db.prepare("INSERT OR IGNORE INTO search_dirty SELECT 'f', id FROM files WHERE thread_id IS NOT NULL").run();
      db.prepare("INSERT INTO search_meta(k, v) VALUES ('version', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(INDEX_VERSION);
    })();
    if (v) console.log(`[search] правила индекса ${v} -> ${INDEX_VERSION}: пересборка`);
  }
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.search_vocab USING fts5vocab(main, search_fts, 'col')");
  s.ready = true;
}

export function syncIndex(max = Infinity, batch = 400): number {
  ensure();
  const db = raw();
  let n = 0;
  const take = st('SELECT kind, ref FROM search_dirty LIMIT ?');
  const del = st('DELETE FROM search_dirty WHERE kind = ? AND ref = ?');
  while (n < max) {
    const rows = take.all(Math.min(batch, max - n)) as { kind: string; ref: string }[];
    if (!rows.length) break;
    db.transaction(() => { for (const r of rows) { indexOne(r.kind, r.ref); del.run(r.kind, r.ref); } })();
    n += rows.length;
  }
  if (n) S().gen++;
  return n;
}

export function startIndexer() {
  const tick = () => {
    try { if (syncIndex(2000) >= 2000) { setImmediate(tick); return; } } catch (e) { console.error('[search] индекс', (e as Error).message); }
  };
  setTimeout(tick, 500).unref?.();
  setInterval(() => { try { syncIndex(2000); } catch {  } }, 5000).unref?.();
}

type Vocab = Record<'body' | 'alt', { term: string; doc: number }[]>;
function vocab(): Vocab {
  const s = S();
  const now = Date.now();
  if (s.vocab && (s.vocab.gen === s.gen || now - s.vocab.at < 30_000)) return s.vocab.terms;
  const terms: Vocab = { body: [], alt: [] };
  for (const r of st('SELECT term, col, doc FROM temp.search_vocab').all() as { term: string; col: 'body' | 'alt'; doc: number }[]) terms[r.col]?.push({ term: r.term, doc: r.doc });
  s.vocab = { gen: s.gen, at: now, terms };
  return terms;
}

export function fuzzyTerms(t: Term, cap = 10): { col: 'body' | 'alt'; whole: string[]; prefix: string[] } | null {
  const f = t.fuzzy;
  if (!f) return null;
  const own = f.col === 'body' ? t.body : t.alt;
  const out: { term: string; doc: number; w: boolean }[] = [];
  for (const v of vocab()[f.col]) {
    if (v.term.length < f.q.length - 1 || own.some((a) => v.term.startsWith(a))) continue;
    if (v.term[0] !== f.q[0] && v.term[1] !== f.q[1]) continue;
    const whole = dl(f.whole, v.term, 1) <= 1;
    if (whole || fuzzyPrefix(f.q, v.term)) out.push({ ...v, w: whole });
  }
  const top = out.sort((a, b) => Number(b.w) - Number(a.w) || b.doc - a.doc).slice(0, cap);
  return top.length ? { col: f.col, whole: top.filter((x) => x.w).map((x) => x.term), prefix: top.filter((x) => !x.w).map((x) => x.term) } : null;
}

export type SearchHit = {
  key: string;
  href: string;
  title: Seg[];
  model: string;
  at: number;
  where: 'title' | 'user' | 'answer' | 'file';
  snippet: Seg[] | null;
  marks: string[];
  msgId: string | null;
  more: number;
};
export type SearchResult = { hits: SearchHit[]; ms: number; total: number };

type DocHit = { id: number; kind: Kind; ref: string; th: string; at: number; s: number };
type Unit = { exprs: { expr: string; w: number }[]; term?: Term };
const FUZZY_WHEN_BELOW = 3;

function matchUnit(userId: string, u: Unit): { docs: Map<number, DocHit>; fuzzy: string[] } {
  const out = new Map<number, DocHit>();
  const q = st(`SELECT d.id, d.kind, d.ref, d.thread_id AS th, d.at, -bm25(search_fts, ${COL_W}) AS s FROM search_fts JOIN search_docs d ON d.id = search_fts.rowid
    WHERE search_fts MATCH ? AND d.user_id = ? LIMIT 5000`);
  for (const e of u.exprs) for (const r of q.all(e.expr, userId) as DocHit[]) {
    const s = r.s * e.w;
    const ex = out.get(r.id);
    if (!ex) out.set(r.id, { ...r, s }); else if (ex.s < s) ex.s = s;
  }
  const ft = u.term && new Set([...out.values()].map((d) => d.th)).size < FUZZY_WHEN_BELOW ? fuzzyTerms(u.term) : null;
  if (ft) for (const [terms, k] of [[ft.whole, FUZZY_W], [ft.prefix, FUZZY_PREFIX_W]] as const) {
    if (!terms.length) continue;
    for (const r of q.all(ftsFuzzy(terms, ft.col), userId) as DocHit[]) {
      const ex = out.get(r.id);
      const s = r.s * k;
      if (!ex) out.set(r.id, { ...r, s }); else if (ex.s < s) ex.s = s;
    }
  }
  return { docs: out, fuzzy: ft ? [...ft.whole, ...ft.prefix] : [] };
}

type Agg = { key: string; per: number[]; docs: Map<number, { d: DocHit; units: Set<number>; w: number }> };

function aggregate(units: Map<number, DocHit>[], keyOf: (d: DocHit) => string | null): Map<string, Agg> {
  const by = new Map<string, Agg>();
  units.forEach((m, ui) => {
    for (const d of m.values()) {
      const key = keyOf(d);
      if (key === null) continue;
      let a = by.get(key);
      if (!a) by.set(key, (a = { key, per: new Array(units.length).fill(0), docs: new Map() }));
      const w = d.s * KIND_W[d.kind];
      a.per[ui] = Math.max(a.per[ui], w);
      let x = a.docs.get(d.id);
      if (!x) a.docs.set(d.id, (x = { d, units: new Set(), w: 0 }));
      x.units.add(ui); x.w += w;
    }
  });
  return by;
}

function scoreOf(a: Agg, n: number, updatedAt: number, now: number): number {
  if (a.per.some((p) => p <= 0)) return 0;
  let s = a.per.reduce((x, y) => x + y, 0);
  if (n > 1 && [...a.docs.values()].some((x) => x.units.size === n)) s *= 1.25;
  const days = Math.max(0, (now - updatedAt) / 864e5);
  return s * (1 + 0.12 * Math.exp(-days / 10));
}

type ThreadRow = { id: string; title: string; modelId: string; groupId: string | null; side: string | null; leafId: string | null; updatedAt: number };

export function searchChats(userId: string, q: string, limit = 20): SearchResult {
  const t0 = performance.now();
  syncIndex();
  const p = parseQuery(q.slice(0, 200));
  const units: Unit[] = [
    ...p.terms.map((t) => ({ exprs: t.tiers.map((x) => ({ expr: ftsTier(x, t.exact), w: x.w })), term: t })),
    ...p.phrases.map((ph) => ({ exprs: [{ expr: ftsPhrase(ph), w: 1 }] })),
  ];
  if (!units.length) return { hits: [], ms: 0, total: 0 };
  const mu = units.map((u) => matchUnit(userId, u));
  const matched = mu.map((x) => x.docs);
  const fuzzy = mu.flatMap((x) => x.fuzzy);

  const ths = new Set<string>();
  for (const m of matched) for (const d of m.values()) ths.add(d.th);
  if (!ths.size) return { hits: [], ms: Math.round(performance.now() - t0), total: 0 };
  const rows = new Map<string, ThreadRow>();
  const byKey = new Map<string, ThreadRow[]>();
  const sel = (where: string, args: string[]) => st(`SELECT id, title, model_id AS modelId, group_id AS groupId, side, leaf_id AS leafId, updated_at AS updatedAt FROM threads WHERE user_id = ? AND temporary = 0 AND ${where}`).all(userId, ...args) as ThreadRow[];
  const ids = [...ths];
  for (let i = 0; i < ids.length; i += 400) for (const r of sel(`id IN (${ids.slice(i, i + 400).map(() => '?').join(',')})`, ids.slice(i, i + 400))) rows.set(r.id, r);
  const gids = [...new Set([...rows.values()].map((r) => r.groupId).filter((x): x is string => !!x))];
  for (let i = 0; i < gids.length; i += 400) for (const r of sel(`group_id IN (${gids.slice(i, i + 400).map(() => '?').join(',')})`, gids.slice(i, i + 400))) rows.set(r.id, r);
  for (const r of rows.values()) { const k = r.groupId ?? r.id; const a = byKey.get(k); if (a) a.push(r); else byKey.set(k, [r]); }
  for (const a of byKey.values()) a.sort((x, y) => (x.side === 'b' ? 1 : 0) - (y.side === 'b' ? 1 : 0));
  const keyOf = (d: DocHit) => { const r = rows.get(d.th); return r ? r.groupId ?? r.id : null; };
  const updOf = (k: string) => Math.max(...(byKey.get(k) ?? []).map((r) => r.updatedAt));
  const now = Date.now();
  const ranked = [...aggregate(matched, keyOf).values()].map((a) => ({ a, s: scoreOf(a, units.length, updOf(a.key), now) })).filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || updOf(y.a.key) - updOf(x.a.key));

  const m = matcherOf(p, fuzzy);
  const out: { s: number; hit: SearchHit }[] = [];
  const perKey = matched.map((mm) => { const by = new Map<string, Map<number, DocHit>>(); for (const [id, d] of mm) { const k = keyOf(d); if (k === null) continue; let x = by.get(k); if (!x) by.set(k, (x = new Map())); x.set(id, d); } return by; });
  const texts = new Map<string, Message>();
  const full = (id: string): Message | undefined => { if (!texts.has(id)) for (const x of messagesById([id])) texts.set(x.id, x); return texts.get(id); };
  for (const { a } of ranked.slice(0, Math.max(limit * 3, 60))) {
    const side = byKey.get(a.key)!;
    const paths = new Map(side.map((th) => { const all = messageSkeleton(th.id); return [th.id, expandPairs(all, activePath(all, th.leafId))]; }));
    const onPath = new Map([...paths].map(([id, pa]) => [id, new Set(pa.map((x) => x.id))]));
    const keep = (d: DocHit) => ((d.kind !== 'u' && d.kind !== 'a') || !!onPath.get(d.th)?.has(d.ref)) && !(rows.get(d.th)?.side === 'b' && d.kind === 'u');
    const a2 = aggregate(perKey.map((by) => by.get(a.key) ?? new Map<number, DocHit>()), (d) => (keep(d) ? a.key : null)).get(a.key);
    const s = a2 ? scoreOf(a2, units.length, updOf(a.key), now) : 0;
    if (!a2 || s <= 0) continue;
    out.push({ s, hit: buildHit(side, a2, paths, m, full) });
  }
  out.sort((x, y) => y.s - x.s || y.hit.at - x.hit.at);
  const hits = out.slice(0, limit).map((x) => x.hit);
  return { hits, ms: Math.round((performance.now() - t0) * 10) / 10, total: out.length };
}

function modelLabel(side: ThreadRow[]): string {
  return side.map((x) => getModel(x.modelId)?.name ?? x.modelId).join(' и ');
}

function buildHit(side: ThreadRow[], a: Agg, paths: Map<string, Message[]>, m: ReturnType<typeof matcherOf>, full: (id: string) => Message | undefined): SearchHit {
  const th = side[0];
  const docs = [...a.docs.values()];
  const path = paths.get(th.id) ?? [];
  const head = th.title.replace(/…$/, '').trim();
  const dup = (d: DocHit) => head.length >= 8 && d.kind === 'u' && path.some((x) => x.id === d.ref) && plainText(full(d.ref)?.content ?? '').startsWith(head);
  const body = docs.filter((x) => x.d.kind !== 't').sort((x, y) => y.units.size - x.units.size || Number(dup(x.d)) - Number(dup(y.d)) || y.w - x.w);
  const best = body[0];
  const base = th.groupId ? `/g/${th.groupId}` : `/c/${th.id}`;
  const title = segments(th.title, m);
  const model = modelLabel(side);
  const at = Math.max(...side.map((x) => x.updatedAt));
  if (!best) {
    let first: Message | undefined;
    for (const x of path) { if (x.role !== 'user') continue; const f = full(x.id); if (f && plainText(f.content).trim()) { first = f; break; } }
    return { key: a.key, href: base, title, model, at, where: 'title', snippet: first ? [[cut(plainText(first.content), 160), 0]] : null, marks: [], msgId: null, more: 0 };
  }
  const more = Math.max(0, body.length - 1);
  if (best.d.kind === 'f') {
    const f = st('SELECT name FROM files WHERE id = ?').get(best.d.ref) as { name: string } | undefined;
    const owner = [...paths.values()].flat().find((x) => x.role === 'user' && ((x.meta as { fileIds?: string[] } | null)?.fileIds ?? []).includes(best.d.ref));
    const name = f?.name ?? '';
    const segs = segments(name, m);
    return { key: a.key, href: owner ? `${base}?m=${owner.id}#m-${owner.id}` : base, title, model, at: best.d.at, where: 'file', snippet: segs,
      marks: segs.filter(([, h]) => h).map(([t]) => t), msgId: owner?.id ?? null, more };
  }
  const msg = paths.get(best.d.th)?.some((x) => x.id === best.d.ref) ? full(best.d.ref) : undefined;
  const sn = snippet(msg?.content ?? '', m);
  const by = !th.groupId && best.d.kind === 'a' ? (msg?.meta as { modelId?: string } | null)?.modelId : undefined;
  return { key: a.key, href: `${base}?m=${best.d.ref}#m-${best.d.ref}`, title, model: by ? getModel(by)?.name ?? model : model, at: best.d.at, where: best.d.kind === 'u' ? 'user' : 'answer',
    snippet: sn.segs, marks: sn.hits, msgId: best.d.ref, more };
}

function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const sp = s.lastIndexOf(' ', max);
  return s.slice(0, sp > max * 0.6 ? sp : max).trimEnd() + '…';
}

export const _test = { S, fold };
