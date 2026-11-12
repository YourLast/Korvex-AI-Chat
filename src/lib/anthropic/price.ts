
export type ClaudePrice = { input: number; output: number; cacheRead: number; write5m: number; write1h: number };

export const CLAUDE_PRICES: Record<string, ClaudePrice> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, write5m: 2.5, write1h: 4 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, write5m: 5, write1h: 8 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, write5m: 2.5, write1h: 4 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, write5m: 6.25, write1h: 10 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, write5m: 6.25, write1h: 10 },
};

export const priceOf = (model: string): ClaudePrice => CLAUDE_PRICES[model] ?? CLAUDE_PRICES['claude-sonnet-5-5'];

export type ClaudeTokens = { input: number; cacheRead: number; write5m: number; write1h: number; output: number; thinking: number; requests: number };
export const emptyTokens = (): ClaudeTokens => ({ input: 0, cacheRead: 0, write5m: 0, write1h: 0, output: 0, thinking: 0, requests: 0 });

export function costUsd(model: string, t: Pick<ClaudeTokens, 'input' | 'cacheRead' | 'write5m' | 'write1h' | 'output'>): number {
  const p = priceOf(model);
  return (t.input * p.input + t.cacheRead * p.cacheRead + t.write5m * p.write5m + t.write1h * p.write1h + t.output * p.output) / 1e6;
}

type U = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null; output_tokens_details?: { thinking_tokens?: number | null } | null };
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export function tokensOf(u: U | null | undefined): Omit<ClaudeTokens, 'requests'> {
  const w = n(u?.cache_creation_input_tokens);
  const w1h = n(u?.cache_creation?.ephemeral_1h_input_tokens);
  const w5m = u?.cache_creation ? n(u.cache_creation.ephemeral_5m_input_tokens) : Math.max(0, w - w1h);
  return { input: n(u?.input_tokens), cacheRead: n(u?.cache_read_input_tokens), write5m: w5m, write1h: w1h, output: n(u?.output_tokens), thinking: n(u?.output_tokens_details?.thinking_tokens) };
}

export function billOf(model: string, usage: (U & { iterations?: (U & { type?: string; model?: string | null })[] | null }) | null | undefined): { tokens: Omit<ClaudeTokens, 'requests'>; usd: number } {
  const its = Array.isArray(usage?.iterations) && usage!.iterations!.length ? usage!.iterations! : null;
  const parts = its ? its.map((x) => ({ m: x.model || model, t: tokensOf(x) })) : [{ m: model, t: tokensOf(usage) }];
  const tokens = { input: 0, cacheRead: 0, write5m: 0, write1h: 0, output: 0, thinking: 0 };
  let usd = 0;
  for (const p of parts) {
    for (const k of Object.keys(tokens) as (keyof typeof tokens)[]) tokens[k] += p.t[k];
    usd += costUsd(p.m, p.t);
  }
  return { tokens, usd };
}

export function addTokens(a: ClaudeTokens, b: Omit<ClaudeTokens, 'requests'>): ClaudeTokens {
  return { input: a.input + b.input, cacheRead: a.cacheRead + b.cacheRead, write5m: a.write5m + b.write5m, write1h: a.write1h + b.write1h, output: a.output + b.output, thinking: a.thinking + b.thinking, requests: a.requests + 1 };
}

export function usageRecord(model: string, t: ClaudeTokens, usd: number, byKey: Record<string, number> = {}) {
  const prompt = t.input + t.cacheRead + t.write5m + t.write1h;
  return {
    prompt_tokens: prompt,
    completion_tokens: t.output,
    prompt_tokens_details: { cached_tokens: t.cacheRead },
    completion_tokens_details: { reasoning_tokens: t.thinking },
    cache_write_tokens: t.write5m + t.write1h,
    cost_usd: Math.round(usd * 1e6) / 1e6,
    claude: { model, input: t.input, cache_read: t.cacheRead, cache_write_5m: t.write5m, cache_write_1h: t.write1h, output: t.output, thinking: t.thinking, requests: t.requests,
      usd_by_key: Object.fromEntries(Object.entries(byKey).map(([k, v]) => [k, Math.round(v * 1e6) / 1e6])) },
  };
}

type Usage = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function isClaudeUsage(u: Usage | null | undefined): boolean {
  return !!u && typeof u === 'object' && !!u.claude && typeof u.claude === 'object' && typeof u.cost_usd === 'number';
}

function addMap(a: unknown, b: unknown, f: (x: unknown, y: unknown) => unknown = (x, y) => num(x) + num(y)): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj(a) };
  for (const [k, v] of Object.entries(obj(b))) out[k] = k in out ? f(out[k], v) : v;
  return out;
}

export function sumClaudeUsage(a: Usage, b: Usage): Usage {
  const ca = obj(a.claude), cb = obj(b.claude);
  const claude: Record<string, unknown> = { ...ca, ...cb };
  for (const k of ['input', 'cache_read', 'cache_write_5m', 'cache_write_1h', 'output', 'thinking', 'requests']) claude[k] = num(ca[k]) + num(cb[k]);
  claude.turn_usd = Math.round((num(ca.turn_usd) + num(cb.turn_usd)) * 1e6) / 1e6;
  claude.usd_by_key = Object.fromEntries(Object.entries(addMap(ca.usd_by_key, cb.usd_by_key)).map(([k, v]) => [k, Math.round(num(v) * 1e6) / 1e6]));
  if (ca.by_kind || cb.by_kind) claude.by_kind = addMap(ca.by_kind, cb.by_kind, (x, y) => ({ calls: num(obj(x).calls) + num(obj(y).calls), usd: Math.round((num(obj(x).usd) + num(obj(y).usd)) * 1e6) / 1e6 }));
  if (ca.background || cb.background) {
    const ba = obj(ca.background), bb = obj(cb.background);
    claude.background = { requests: num(ba.requests) + num(bb.requests), usd: Math.round((num(ba.usd) + num(bb.usd)) * 1e6) / 1e6 };
  }
  const pa = obj(a.prompt_tokens_details), pb = obj(b.prompt_tokens_details);
  const ra = obj(a.completion_tokens_details), rb = obj(b.completion_tokens_details);
  return {
    ...a, ...b,
    prompt_tokens: num(a.prompt_tokens) + num(b.prompt_tokens),
    completion_tokens: num(a.completion_tokens) + num(b.completion_tokens),
    prompt_tokens_details: { ...pa, ...pb, cached_tokens: num(pa.cached_tokens) + num(pb.cached_tokens) },
    completion_tokens_details: { ...ra, ...rb, reasoning_tokens: num(ra.reasoning_tokens) + num(rb.reasoning_tokens) },
    cache_write_tokens: num(a.cache_write_tokens) + num(b.cache_write_tokens),
    cost_usd: Math.round((num(a.cost_usd) + num(b.cost_usd)) * 1e6) / 1e6,
    claude,
  };
}
