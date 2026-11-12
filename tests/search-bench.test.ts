import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';

const SRC = process.env.KX_BENCH_DB;

describe.skipIf(!SRC)('замер поиска на копии БД', () => {
  it('точность топ-3 и время: наш индекс против trigram', async () => {
    const dir = tmpData();
    fs.copyFileSync(SRC!, path.join(dir, 'korvex.db'));
    const D = await import('@/lib/db');
    const t0 = performance.now();
    const db = D.getDb();
    const tMig = performance.now() - t0;
    const S = await import('@/lib/search');
    const X = await import('@/lib/textsearch');
    const { activePath, allMessages } = await import('@/lib/tree');
    const t1 = performance.now();
    S.syncIndex();
    const tIdx = performance.now() - t1;
    const raw = (db as unknown as { $client: import('better-sqlite3').Database }).$client;

    type Doc = { key: string; th: string; uid: string; kind: 't' | 'u' | 'a' | 'f'; text: string; updatedAt: number };
    const threads = raw.prepare('SELECT id, user_id AS uid, title, group_id AS gid, side, leaf_id AS leaf, updated_at AS up FROM threads').all() as
      { id: string; uid: string; title: string; gid: string | null; side: string | null; leaf: string | null; up: number }[];
    const docs: Doc[] = [];
    for (const t of threads) {
      const key = t.gid ?? t.id;
      if (t.title !== 'Новый чат') docs.push({ key, th: t.id, uid: t.uid, kind: 't', text: t.title, updatedAt: t.up });
      for (const m of activePath(allMessages(t.id), t.leaf)) {
        if (t.side === 'b' && m.role === 'user') continue;
        docs.push({ key, th: t.id, uid: t.uid, kind: m.role === 'user' ? 'u' : 'a', text: m.content, updatedAt: t.up });
      }
      for (const f of raw.prepare('SELECT name FROM files WHERE thread_id = ?').all(t.id) as { name: string }[]) docs.push({ key, th: t.id, uid: t.uid, kind: 'f', text: f.name, updatedAt: t.up });
    }
    const df = new Map<string, Set<string>>();
    for (const d of docs) for (const w of X.words(X.fold(X.plainText(d.text)))) { const k = `${d.uid}\u0000${w.w}`; let s = df.get(k); if (!s) df.set(k, (s = new Set())); s.add(d.key); }
    const famCache = new Map<string, number>();
    const rare = (uid: string, w: string) => {
      const ck = `${uid}\u0000${w}`;
      let n = famCache.get(ck);
      if (n === undefined) {
        const st = /^[а-я]+$/.test(w) ? X.stemRu(w) : w;
        const sk = X.skel(st.length >= 4 ? st : w), ks = new Set<string>();
        for (const [k, v] of df) { const [u, x] = k.split('\u0000'); if (u === uid && (x.startsWith(st) || X.skel(x).startsWith(sk))) v.forEach((y) => ks.add(y)); }
        famCache.set(ck, (n = ks.size));
      }
      return n <= 2;
    };
    const dfSk = new Map<string, Set<string>>();
    for (const [k, v] of df) { const [u, w] = k.split('\u0000'); const kk = `${u}\u0000${X.skel(w)}`; const s0 = dfSk.get(kk) ?? new Set<string>(); v.forEach((x) => s0.add(x)); dfSk.set(kk, s0); }
    const cyrStems = new Set([...df.keys()].map((k) => k.split('\u0000')[1]).filter((w) => /^[а-я]+$/.test(w)).map((w) => X.stemRu(w)));
    const rareSk = (uid: string, w: string) => {
      const st = X.stemRu(X.cyr(w));
      if (st.length < 4 || !cyrStems.has(st)) return false;
      const pre = X.skel(st), ks = new Set<string>();
      for (const [k, v] of dfSk) if (k.startsWith(`${uid}\u0000${pre}`)) v.forEach((x) => ks.add(x));
      return ks.size <= 2;
    };

    let seed = Number(process.env.KX_BENCH_SEED) || 20261030;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
    const shuffle = <T,>(a: T[]): T[] => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
    const STOP = new Set('который которая которые чтобы потому можно нужно сейчас будет было была были этого этот этом какой какая какие через после только тоже также очень просто давай пожалуйста спасибо привет здравствуйте сделай напиши скажи покажи about there their which would could should please thanks hello'.split(' '));
    const ok = (w: string, min = 5) => w.length >= min && !/\d/.test(w) && !STOP.has(w);
    const LAT: Record<string, string[]> = {
      а: ['a'], б: ['b'], в: ['v'], г: ['g'], д: ['d'], е: ['e'], ж: ['zh'], з: ['z'], и: ['i'], й: ['y', 'j', 'i'], к: ['k'], л: ['l'], м: ['m'], н: ['n'], о: ['o'], п: ['p'],
      р: ['r'], с: ['s'], т: ['t'], у: ['u'], ф: ['f'], х: ['h', 'kh'], ц: ['ts', 'c'], ч: ['ch', 'c'], ш: ['sh'], щ: ['sch', 'shch'], ъ: [''], ы: ['y', 'i'], ь: ['', "'"], э: ['e'], ю: ['yu', 'ju'], я: ['ya', 'ja'],
    };
    const toLat = (w: string) => [...w].map((c) => pick(LAT[c] ?? [c])).join('');
    const PARA: string[][] = [
      ['ться', 'лся', 'лась', 'лись', 'ется', 'ются'], ['ть', 'л', 'ла', 'ли', 'ло'], ['ет', 'ешь', 'ем', 'ете', 'ют'], ['ит', 'ишь', 'им', 'ите', 'ят'],
      ['ый', 'ая', 'ое', 'ые', 'ого', 'ому', 'ую', 'ым', 'ых'], ['ий', 'яя', 'ее', 'ие', 'его', 'ему', 'юю', 'им', 'их'],
      ['ия', 'ии', 'ию', 'ией', 'ий'], ['ие', 'ия', 'ию', 'ием', 'ии'], ['ость', 'ости', 'остью', 'остей'],
      ['а', 'ы', 'е', 'у', 'ой', 'ам', 'ами', 'ах'], ['я', 'и', 'е', 'ю', 'ей', 'ям', 'ями'], ['о', 'а', 'у', 'ом', 'е'],
    ];
    const reform = (w: string): string | null => {
      let best: { e: string; row: string[] } | null = null;
      for (const row of PARA) for (const e of row) if (w.endsWith(e) && w.length - e.length >= 4 && (!best || e.length > best.e.length)) best = { e, row };
      if (best) { const opts = best.row.filter((e) => e !== best!.e).map((e) => w.slice(0, -best!.e.length) + e); return pick(opts); }
      if (/[бвгджзклмнпрстфхцчшщ]$/.test(w) && w.length >= 5) return w + pick(['а', 'у', 'ом', 'е', 'ы', 'ами']);
      return null;
    };
    const ALPHA_RU = 'абвгдежзиклмнопрстуфхцчшщыэюя', ALPHA_EN = 'abcdefghiklmnoprstuvwyz';
    const typo = (w: string): string => {
      const ab = X.isCyr(w) ? ALPHA_RU : ALPHA_EN;
      const i = 1 + Math.floor(rnd() * (w.length - 2));
      const op = Math.floor(rnd() * 4);
      if (op === 0) return w.slice(0, i) + w.slice(i + 1);
      if (op === 1) return w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);
      if (op === 2) { let c = pick([...ab]); while (c === w[i]) c = pick([...ab]); return w.slice(0, i) + c + w.slice(i + 1); }
      return w.slice(0, i) + pick([...ab]) + w.slice(i);
    };
    type Q = { cat: string; q: string; uid: string; key: string };
    const qs: Q[] = [];
    const used = new Set<string>();
    const wordsOf = (d: Doc) => X.words(X.fold(X.plainText(d.text))).map((t) => t.w);
    const keys = shuffle([...new Set(docs.map((d) => `${d.uid}\u0000${d.key}`))]);
    const docsOf = (uk: string) => docs.filter((d) => `${d.uid}\u0000${d.key}` === uk);
    const add = (cat: string, quota: number, gen: (ds: Doc[], uid: string) => string | null) => {
      let n = 0;
      for (const uk of shuffle(keys)) {
        if (n >= quota) break;
        const [uid, key] = uk.split('\u0000');
        const q = gen(docsOf(uk), uid);
        if (!q || used.has(`${uid}\u0000${q}`)) continue;
        used.add(`${uid}\u0000${q}`);
        qs.push({ cat, q, uid, key }); n++;
      }
    };
    const rareWords = (ds: Doc[], uid: string, kinds: Doc['kind'][], f: (w: string) => boolean) =>
      [...new Set(ds.filter((d) => kinds.includes(d.kind)).flatMap(wordsOf))].filter((w) => f(w) && rare(uid, w));
    add('слово из названия', 8, (ds, uid) => { const ws = rareWords(ds, uid, ['t'], (w) => ok(w)); return ws.length ? pick(ws) : null; });
    add('другая форма слова', 10, (ds, uid) => { const ws = rareWords(ds, uid, ['u', 'a', 't'], (w) => ok(w, 6) && /^[а-я]+$/.test(w)); for (const w of shuffle(ws)) { const f = reform(w); if (f) return f; } return null; });
    add('транслит: кириллица -> латиница', 10, (ds, uid) => { const ws = rareWords(ds, uid, ['u', 'a', 't'], (w) => ok(w, 6) && /^[а-я]+$/.test(w)); return ws.length ? toLat(pick(ws)) : null; });
    add('транслит: латиница -> кириллица', 6, (ds, uid) => { const ws = rareWords(ds, uid, ['u', 't'], (w) => ok(w, 5) && /^[a-z]+$/.test(w) && rareSk(uid, w)); return ws.length ? X.cyr(pick(ws)) : null; });
    add('опечатка в одну букву', 10, (ds, uid) => { const ws = rareWords(ds, uid, ['u', 'a', 't'], (w) => ok(w, 6)); return ws.length ? typo(pick(ws)) : null; });
    add('фраза в кавычках', 6, (ds, uid) => {
      for (const d of shuffle(ds.filter((x) => x.kind === 'u' || x.kind === 'a'))) {
        const ws = wordsOf(d);
        for (const i of shuffle([...ws.keys()]).slice(0, 30)) {
          if (i + 1 >= ws.length || !ok(ws[i], 4) || !ok(ws[i + 1], 4)) continue;
          if (!rare(uid, ws[i]) && !rare(uid, ws[i + 1])) continue;
          return `"${ws[i]} ${ws[i + 1]}"`;
        }
      }
      return null;
    });
    add('имя файла', 5, (ds, uid) => { const ws = rareWords(ds, uid, ['f'], (w) => ok(w, 4) && !['docx', 'xlsx', 'jpeg', 'image', 'file'].includes(w)); return ws.length ? pick(ws) : null; });
    add('два слова из разных мест', 6, (ds, uid) => {
      const ws = shuffle(rareWords(ds, uid, ['u', 'a', 't'], (w) => ok(w, 5)));
      return ws.length >= 2 ? `${ws[0]} ${ws[1]}` : null;
    });

    raw.exec("DROP TABLE IF EXISTS temp.tri; CREATE VIRTUAL TABLE temp.tri USING fts5(body, uid UNINDEXED, key UNINDEXED, kind UNINDEXED, tokenize='trigram remove_diacritics 1')");
    const ins = raw.prepare('INSERT INTO temp.tri(body, uid, key, kind) VALUES (?, ?, ?, ?)');
    raw.transaction(() => { for (const d of docs) ins.run(X.fold(X.plainText(d.text)), d.uid, d.key, d.kind); })();
    const KW: Record<string, number> = { t: 2.6, f: 1.6, u: 1.25, a: 1 };
    const upd = new Map(docs.map((d) => [d.key, d.updatedAt]));
    const triQ = raw.prepare('SELECT key, kind, -bm25(tri) AS s FROM tri WHERE tri MATCH ? AND uid = ?');
    const trigram = (q: string, uid: string): string[] => {
      const p = X.parseQuery(q);
      const units = [
        ...p.terms.map((t) => (X.isCyr(t.raw) ? X.stemRu(t.raw) : t.raw)).filter((w) => w.length >= 3).map((w) => `"${w}"`),
        ...p.phrases.map((ph) => `"${ph.body.join(' ')}"`),
      ];
      if (!units.length) return [];
      const per = new Map<string, number[]>();
      units.forEach((u, i) => { for (const r of triQ.all(u, uid) as { key: string; kind: string; s: number }[]) { let a = per.get(r.key); if (!a) per.set(r.key, (a = new Array(units.length).fill(0))); a[i] = Math.max(a[i], r.s * KW[r.kind]); } });
      return [...per].filter(([, a]) => a.every((x) => x > 0)).map(([k, a]) => ({ k, s: a.reduce((x, y) => x + y, 0) })).sort((x, y) => y.s - x.s || (upd.get(y.k)! - upd.get(x.k)!)).map((x) => x.k);
    };

    const ownKeys = new Map<string, Set<string>>();
    for (const d of docs) { let s = ownKeys.get(d.uid); if (!s) ownKeys.set(d.uid, (s = new Set())); s.add(d.key); }
    type R = { cat: string; rA: number; rB: number; ms: number; msB: number };
    const res: R[] = [];
    let foreign = 0;
    for (const x of qs) {
      const a0 = performance.now();
      const hA = S.searchChats(x.uid, x.q, 20).hits.map((h) => h.key);
      const ms = performance.now() - a0;
      foreign += hA.filter((k) => !ownKeys.get(x.uid)!.has(k)).length;
      const b0 = performance.now();
      const hB = trigram(x.q, x.uid);
      const msB = performance.now() - b0;
      res.push({ cat: x.cat, rA: hA.indexOf(x.key) + 1, rB: hB.indexOf(x.key) + 1, ms, msB });
      if (process.env.KX_BENCH_DEBUG === '1' && !(hA.indexOf(x.key) >= 0 && hA.indexOf(x.key) < 3)) console.log('DEBUG', x.cat, JSON.stringify(x.q), 'место', hA.indexOf(x.key) + 1, 'всего', hA.length);
    }
    const pct = (a: R[], f: (r: R) => boolean) => (a.length ? Math.round((100 * a.filter(f).length) / a.length) : 0);
    const mrr = (a: R[], k: 'rA' | 'rB') => (a.reduce((s, r) => s + (r[k] ? 1 / r[k] : 0), 0) / a.length).toFixed(2);
    const q = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
    const rows: string[] = [];
    for (const cat of [...new Set(res.map((r) => r.cat))]) {
      const a = res.filter((r) => r.cat === cat);
      rows.push(`${cat.padEnd(34)} n=${String(a.length).padStart(2)}  A: топ-3 ${String(pct(a, (r) => r.rA > 0 && r.rA <= 3)).padStart(3)}%  топ-1 ${String(pct(a, (r) => r.rA === 1)).padStart(3)}%   B(trigram): топ-3 ${String(pct(a, (r) => r.rB > 0 && r.rB <= 3)).padStart(3)}%  топ-1 ${String(pct(a, (r) => r.rB === 1)).padStart(3)}%`);
    }
    const n = res.length;
    console.log([
      `чатов ${new Set(docs.map((d) => d.key)).size}, документов ${docs.length}, пользователей ${ownKeys.size}; миграция ${tMig.toFixed(0)} мс, индекс с нуля ${tIdx.toFixed(0)} мс`,
      ...rows,
      `ВСЕГО n=${n}: A топ-3 ${pct(res, (r) => r.rA > 0 && r.rA <= 3)}%, топ-1 ${pct(res, (r) => r.rA === 1)}%, MRR ${mrr(res, 'rA')}; B топ-3 ${pct(res, (r) => r.rB > 0 && r.rB <= 3)}%, топ-1 ${pct(res, (r) => r.rB === 1)}%, MRR ${mrr(res, 'rB')}`,
      `время A: p50 ${q(res.map((r) => r.ms), 0.5).toFixed(1)} мс, p95 ${q(res.map((r) => r.ms), 0.95).toFixed(1)} мс, макс ${Math.max(...res.map((r) => r.ms)).toFixed(1)} мс; B: p50 ${q(res.map((r) => r.msB), 0.5).toFixed(1)} мс`,
      `чужих чатов в выдаче: ${foreign}`,
      `промахи A (вид: место): ${res.filter((r) => !(r.rA > 0 && r.rA <= 3)).map((r) => `${r.cat}: ${r.rA || '—'}`).join('; ') || 'нет'}`,
    ].join('\n'));
    expect(n).toBeGreaterThanOrEqual(30);
    expect(foreign).toBe(0);

    if (process.env.KX_BENCH_HAND) {
      const hand = JSON.parse(fs.readFileSync(process.env.KX_BENCH_HAND, 'utf8')) as [string, string, string][];
      const titleOf = new Map(threads.map((t) => [t.gid ?? t.id, t.title]));
      let ok3 = 0, ok1 = 0;
      const ms: number[] = [], miss: string[] = [];
      for (const [qq0, up, re] of hand) {
        const uid = threads.find((t) => t.uid.startsWith(up))!.uid;
        const want = new Set(threads.filter((t) => t.uid === uid && new RegExp(re).test(t.title)).map((t) => t.gid ?? t.id));
        const a0 = performance.now();
        const h = S.searchChats(uid, qq0, 20).hits.map((x) => x.key);
        ms.push(performance.now() - a0);
        const r = h.findIndex((k) => want.has(k)) + 1;
        if (r >= 1 && r <= 3) ok3++; else miss.push(`#${hand.findIndex((x) => x[0] === qq0) + 1}: ${r || '—'}`);
        if (r === 1) ok1++;
        if (process.env.KX_BENCH_DEBUG === '1' && !(r >= 1 && r <= 3)) console.log('DEBUG ручной', JSON.stringify(qq0), 'место', r, 'первые', h.slice(0, 3).map((k) => titleOf.get(k)?.slice(0, 30)));
      }
      console.log(`ручные запросы n=${hand.length}: топ-3 ${Math.round((100 * ok3) / hand.length)}%, топ-1 ${Math.round((100 * ok1) / hand.length)}%; время p50 ${q(ms, 0.5).toFixed(1)} мс, макс ${Math.max(...ms).toFixed(1)} мс; промахи (№: место): ${miss.join(', ') || 'нет'}`);
    }

    const N = Number(process.env.KX_BENCH_SCALE) || 0;
    if (N > 0) {
      const ths0 = raw.prepare('SELECT * FROM threads').all() as Record<string, unknown>[];
      const msgs0 = raw.prepare('SELECT * FROM messages').all() as Record<string, unknown>[];
      const insT = raw.prepare(`INSERT INTO threads (${Object.keys(ths0[0]).join(',')}) VALUES (${Object.keys(ths0[0]).map((k) => '@' + k).join(',')})`);
      const insM = raw.prepare(`INSERT INTO messages (${Object.keys(msgs0[0]).join(',')}) VALUES (${Object.keys(msgs0[0]).map((k) => '@' + k).join(',')})`);
      raw.pragma('foreign_keys = OFF');
      raw.transaction(() => {
        for (let i = 1; i <= N; i++) {
          for (const t of ths0) insT.run({ ...t, id: `${t.id}~${i}`, group_id: t.group_id ? `${t.group_id}~${i}` : null, leaf_id: t.leaf_id ? `${t.leaf_id}~${i}` : null, updated_at: Number(t.updated_at) - i * 3600_000 });
          for (const m of msgs0) insM.run({ ...m, id: `${m.id}~${i}`, thread_id: `${m.thread_id}~${i}`, parent_id: m.parent_id ? `${m.parent_id}~${i}` : null });
        }
      })();
      const c0 = performance.now();
      S.syncIndex();
      const tBig = performance.now() - c0;
      const ms: number[] = [];
      for (const x of qs) { const a0 = performance.now(); S.searchChats(x.uid, x.q, 20); ms.push(performance.now() - a0); }
      const nT = (raw.prepare('SELECT count(*) n FROM threads').get() as { n: number }).n, nM = (raw.prepare('SELECT count(*) n FROM messages').get() as { n: number }).n;
      console.log(`архив ×${N + 1}: чатов ${nT}, сообщений ${nM}; догнать индекс ${tBig.toFixed(0)} мс; поиск p50 ${q(ms, 0.5).toFixed(1)} мс, p95 ${q(ms, 0.95).toFixed(1)} мс, макс ${Math.max(...ms).toFixed(1)} мс`);
    }
  }, 120_000);
});
