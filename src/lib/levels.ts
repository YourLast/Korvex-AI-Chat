
export type LevelLite = { id: string; label: string; hint?: string };
export type ModelLite = { id: string; name: string; defaultLevel: string; levels: LevelLite[]; variantOf?: string; variantName?: string };
export type Sel = { modelId: string; levelId: string };

const RANK: Record<string, number> = { off: 0, none: 0, minimal: 0, low: 1, medium: 2, on: 3, high: 3, xhigh: 3, max: 4 };
const MAX_RANK = 4;

export function rankOf(model: ModelLite | undefined, levelId: string): number {
  if (levelId in RANK) return RANK[levelId];
  const lv = model?.levels ?? [];
  const i = lv.findIndex((l) => l.id === levelId);
  return i < 0 || lv.length < 2 ? 0 : (i / (lv.length - 1)) * MAX_RANK;
}

export function intensityOf(model: ModelLite | undefined, levelId: string): number {
  return Math.max(0, Math.min(1, rankOf(model, levelId) / MAX_RANK));
}

export const RESTRICTED_LEVELS: readonly string[] = ['max'];
export const isRestrictedLevel = (levelId: string | null | undefined) => !!levelId && RESTRICTED_LEVELS.includes(levelId);

export function withoutRestricted<M extends ModelLite>(model: M): M {
  const levels = model.levels.filter((l) => !isRestrictedLevel(l.id));
  if (levels.length === model.levels.length || !levels.length) return model;
  return { ...model, levels, defaultLevel: levels.some((l) => l.id === model.defaultLevel) ? model.defaultLevel : capLevelId(model, model.defaultLevel) };
}

export function capLevelId(model: ModelLite, levelId: string): string {
  if (!isRestrictedLevel(levelId)) return levelId;
  const open = model.levels.filter((l) => !isRestrictedLevel(l.id));
  if (!open.length) return levelId;
  const x = open.find((l) => l.id === 'xhigh');
  if (x) return x.id;
  return open.reduce((best, l) => (rankOf(model, l.id) > rankOf(model, best.id) ? l : best)).id;
}

export const hasLevel = (model: ModelLite | undefined, levelId: string | null | undefined) =>
  !!model && !!levelId && model.levels.some((l) => l.id === levelId);

export function nearestLevel(model: ModelLite, levelId: string, fromModel?: ModelLite): string {
  if (hasLevel(model, levelId)) return levelId;
  if (!model.levels.length) return model.defaultLevel;
  const r = rankOf(fromModel ?? model, levelId);
  const n = model.levels.length;
  let best = model.levels[0].id, bestScore = Infinity;
  model.levels.forEach((l, i) => {
    const rl = rankOf(model, l.id);
    const extreme = i === 0 || i === n - 1 ? 1 : 0;
    const score = Math.abs(rl - r) * 2 + extreme + rl * 1e-3;
    if (score < bestScore) { bestScore = score; best = l.id; }
  });
  return best;
}

export function levelOnSwitch(models: ModelLite[], toModelId: string, current: Sel | null, remembered: Record<string, string>): string {
  const to = models.find((m) => m.id === toModelId);
  if (!to) return current?.levelId ?? '';
  const mem = remembered[to.id];
  if (hasLevel(to, mem)) return mem!;
  if (current && current.levelId) {
    const from = models.find((m) => m.id === current.modelId);
    return nearestLevel(to, current.levelId, from);
  }
  return hasLevel(to, to.defaultLevel) ? to.defaultLevel : to.levels[0]?.id ?? to.defaultLevel;
}

export function normalizeSel(models: ModelLite[], s: Partial<Sel> | null | undefined): Sel {
  const known = models.find((x) => x.id === s?.modelId);
  const m = known ?? models[0];
  const lv = s?.levelId;
  if (known && hasLevel(m, lv)) return { modelId: m.id, levelId: lv! };
  if (known && lv) return { modelId: m.id, levelId: nearestLevel(m, lv) };
  return { modelId: m.id, levelId: hasLevel(m, m.defaultLevel) ? m.defaultLevel : m.levels[0]?.id ?? m.defaultLevel };
}


export const familyOf = (models: ModelLite[], id: string): string => {
  const m = models.find((x) => x.id === id);
  return m?.variantOf && models.some((x) => x.id === m.variantOf) ? m.variantOf : id;
};
export type Family<M extends ModelLite = ModelLite> = { id: string; base: M; variants: M[] };
export function families<M extends ModelLite>(models: M[]): Family<M>[] {
  const out: Family<M>[] = [];
  for (const m of models) {
    const f = familyOf(models, m.id);
    let fam = out.find((x) => x.id === f);
    if (!fam) { fam = { id: f, base: (models.find((x) => x.id === f) ?? m), variants: [] }; out.push(fam); }
    if (m.id === f) fam.variants.unshift(m); else fam.variants.push(m);
  }
  return out;
}
export function modelLabel(models: ModelLite[], id: string): string {
  const m = models.find((x) => x.id === id);
  if (!m) return id;
  const fam = families(models).find((f) => f.id === familyOf(models, id));
  return fam && fam.variants.length > 1 && m.variantName ? `${fam.base.name} · ${m.variantName}` : m.name;
}
export function variantsOf<M extends ModelLite>(models: M[], familyId: string): M[] {
  return families(models).find((f) => f.id === familyId)?.variants ?? [];
}
export const sameFamily = (models: ModelLite[], a: string, b: string) => familyOf(models, a) === familyOf(models, b);
export type PairChoice = { id: string; label: string; familyId: string; variant: string | null; isBase: boolean };
export function pairChoices(models: ModelLite[]): PairChoice[] {
  return families(models).flatMap((f) => f.variants.map((m) => ({
    id: m.id, label: modelLabel(models, m.id), familyId: f.id, variant: f.variants.length > 1 ? m.variantName ?? m.name : null, isBase: m.id === f.id,
  })));
}

export function variantFor(models: ModelLite[], familyId: string, p?: Prefs | null): string {
  const want = p?.fam?.[familyId];
  return want && familyOf(models, want) === familyId && models.some((m) => m.id === want) ? want : familyId;
}


export const PREF_KEY = 'kx.pick';
const OLD_KEY = 'kx.sel';
export type Prefs = { model: string; levels: Record<string, string>; fam?: Record<string, string> };
type Store = Pick<Storage, 'getItem' | 'setItem'>;

function store(): Store | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export function readPrefs(models: ModelLite[], st: Store | null = store()): Prefs {
  const out: Prefs = { model: models[0]?.id ?? '', levels: {} };
  let raw: unknown = null, old: unknown = null;
  try { raw = JSON.parse(st?.getItem(PREF_KEY) || 'null'); } catch { raw = null; }
  try { old = raw ? null : JSON.parse(st?.getItem(OLD_KEY) || 'null'); } catch { old = null; }
  if (raw && typeof raw === 'object') {
    const r = raw as { model?: unknown; levels?: unknown };
    if (typeof r.model === 'string' && models.some((m) => m.id === r.model)) out.model = r.model;
    if (r.levels && typeof r.levels === 'object') {
      for (const [k, v] of Object.entries(r.levels as Record<string, unknown>)) {
        const m = models.find((x) => x.id === k);
        if (m && typeof v === 'string') out.levels[k] = hasLevel(m, v) ? v : nearestLevel(m, v);
      }
    }
    const fm = (raw as { fam?: unknown }).fam;
    if (fm && typeof fm === 'object') {
      for (const [k, v] of Object.entries(fm as Record<string, unknown>)) if (typeof v === 'string' && familyOf(models, v) === k) (out.fam ??= {})[k] = v;
    }
  } else if (old && typeof old === 'object') {
    const o = old as { modelId?: unknown; levelId?: unknown };
    const m = models.find((x) => x.id === o.modelId);
    if (m && typeof o.levelId === 'string') { out.model = m.id; out.levels[m.id] = hasLevel(m, o.levelId) ? o.levelId : nearestLevel(m, o.levelId); }
  }
  return out;
}

export function writePrefs(p: Prefs, st: Store | null = store()) {
  try { st?.setItem(PREF_KEY, JSON.stringify(p)); } catch {  }
}

export function rememberLevel(models: ModelLite[], s: Sel, asCurrent: boolean, st: Store | null = store()): Prefs {
  const p = readPrefs(models, st);
  const next: Prefs = { model: asCurrent ? s.modelId : p.model, levels: { ...p.levels, [s.modelId]: s.levelId } };
  const f = familyOf(models, s.modelId);
  if (p.fam || families(models).find((x) => x.id === f)!.variants.length > 1) next.fam = { ...p.fam, [f]: s.modelId };
  writePrefs(next, st);
  return next;
}

export function selFromPrefs(models: ModelLite[], p: Prefs): Sel {
  const m = models.find((x) => x.id === p.model) ?? models[0];
  return normalizeSel(models, { modelId: m.id, levelId: p.levels[m.id] ?? m.defaultLevel });
}

export function pairFromPrefs(models: ModelLite[], p: Prefs): { a: Sel; b: Sel } {
  const fs = families(models);
  const ida = fs.length > 1 ? variantFor(models, fs[0].id, p) : fs[0].variants[0].id;
  const idb = fs.length > 1 ? variantFor(models, fs[1].id, p) : fs[0].variants[Math.min(1, fs[0].variants.length - 1)].id;
  const ma = models.find((m) => m.id === ida)!, mb = models.find((m) => m.id === idb)!;
  const a = normalizeSel(models, { modelId: ma.id, levelId: p.levels[ma.id] ?? ma.defaultLevel });
  const b = normalizeSel(models, { modelId: mb.id, levelId: p.levels[mb.id] ?? mb.defaultLevel });
  return { a, b: same(a, b) ? { modelId: mb.id, levelId: contrastLevel(mb, a.levelId) } : b };
}


export const PAIR_KEY = 'kx.pair';
export type PairSel = { a: Sel; b: Sel };
export type Side = 'a' | 'b';

export function readPair(models: ModelLite[], st: Store | null = store()): PairSel | null {
  let raw: unknown = null;
  try { raw = JSON.parse(st?.getItem(PAIR_KEY) || 'null'); } catch { raw = null; }
  const r = raw as { a?: Partial<Sel>; b?: Partial<Sel> } | null;
  if (!r || typeof r !== 'object' || !models.some((m) => m.id === r.a?.modelId) || !models.some((m) => m.id === r.b?.modelId)) return null;
  return { a: normalizeSel(models, r.a), b: normalizeSel(models, r.b) };
}
export function rememberPair(models: ModelLite[], p: PairSel, st: Store | null = store()) {
  try { st?.setItem(PAIR_KEY, JSON.stringify({ a: normalizeSel(models, p.a), b: normalizeSel(models, p.b) })); } catch {  }
}
const same = (x: Sel, y: Sel) => x.modelId === y.modelId && x.levelId === y.levelId;

export function contrastLevel(model: ModelLite, levelId: string): string {
  const lv = model.levels.filter((l) => l.id !== levelId);
  if (!lv.length) return levelId;
  if (rankOf(model, levelId) < 3) return (lv.find((l) => rankOf(model, l.id) === 3) ?? lv[lv.length - 1]).id;
  if (lv.some((l) => l.id === model.defaultLevel)) return model.defaultLevel;
  return (lv.find((l) => rankOf(model, l.id) > 0) ?? lv[0]).id;
}

export function counterpart(models: ModelLite[], p: Prefs, s: Sel): Sel {
  const fs = families(models);
  const mine = familyOf(models, s.modelId);
  const pick = (id: string) => normalizeSel(models, { modelId: id, levelId: p.levels[id] ?? models.find((m) => m.id === id)?.defaultLevel });
  const of = fs.find((f) => f.id !== mine);
  if (of) return pick(variantFor(models, of.id, p));
  const alt = (fs.find((f) => f.id === mine)?.variants ?? []).find((v) => v.id !== s.modelId);
  if (alt) return pick(alt.id);
  const m = models.find((x) => x.id === s.modelId);
  return m ? { modelId: m.id, levelId: contrastLevel(m, s.levelId) } : s;
}

export function sideOf(pair: PairSel, s: Sel): Side | null {
  if (same(pair.a, s)) return 'a';
  if (same(pair.b, s)) return 'b';
  if (pair.a.modelId === s.modelId && pair.b.modelId !== s.modelId) return 'a';
  if (pair.b.modelId === s.modelId && pair.a.modelId !== s.modelId) return 'b';
  return null;
}

export function pairFor(models: ModelLite[], p: Prefs, sel: Sel, threadPair?: PairSel | null, remembered?: PairSel | null): { pair: PairSel; tab: Side } {
  const s = normalizeSel(models, sel);
  const known = (x: PairSel | null | undefined): PairSel | null => (x && models.some((m) => m.id === x.a.modelId) && models.some((m) => m.id === x.b.modelId)
    ? { a: normalizeSel(models, x.a), b: normalizeSel(models, x.b) } : null);
  const tp = known(threadPair);
  if (tp) return { pair: tp, tab: sideOf(tp, s) ?? 'a' };
  const rp = known(remembered);
  if (rp) {
    if (rp.a.modelId === rp.b.modelId && !same(rp.a, rp.b)) return { pair: rp, tab: sideOf(rp, s) ?? 'a' };
    const side: Side | null = rp.a.modelId === s.modelId ? 'a' : rp.b.modelId === s.modelId ? 'b' : null;
    if (side) {
      const pair = { ...rp, [side]: s } as PairSel;
      const o: Side = side === 'a' ? 'b' : 'a';
      if (!same(pair[o], s)) return { pair, tab: side };
    }
    const otherSide = rp.b.modelId !== s.modelId ? rp.b : rp.a;
    if (otherSide.modelId !== s.modelId) return { pair: { a: s, b: otherSide }, tab: 'a' };
  }
  return { pair: { a: s, b: counterpart(models, p, s) }, tab: 'a' };
}

export function fixPair(models: ModelLite[], p: Prefs, c: PairSel): PairSel | null {
  const ka = models.some((m) => m.id === c.a.modelId), kb = models.some((m) => m.id === c.b.modelId);
  if (ka && kb) return { a: normalizeSel(models, c.a), b: normalizeSel(models, c.b) };
  if (!ka && !kb) return null;
  const a = ka ? normalizeSel(models, c.a) : null, b = kb ? normalizeSel(models, c.b) : null;
  return { a: a ?? counterpart(models, p, b!), b: b ?? counterpart(models, p, a!) };
}


export function upstreamEffort(level: { effort?: string | null }): string | undefined {
  return typeof level.effort === 'string' && level.effort.trim() ? level.effort.trim() : undefined;
}
