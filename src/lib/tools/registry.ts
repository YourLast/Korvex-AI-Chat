import type { KorvexTool, ToolCtx } from './types';

type AnyTool = KorvexTool<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const g = globalThis as unknown as { __kxTools?: Map<string, AnyTool> };
const reg = () => (g.__kxTools ??= new Map());

const NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;

export function registerTool<A>(t: KorvexTool<A>): KorvexTool<A> {
  if (!NAME_RE.test(t.name)) throw new Error(`tool name «${t.name}»: только a-z, 0-9, _ (до 64)`);
  if (t.parameters?.type !== 'object') throw new Error(`tool ${t.name}: parameters.type must be "object"`);
  reg().set(t.name, t as AnyTool);
  return t;
}

export function unregisterTool(name: string) { reg().delete(name); }

export function getTool(name: string): AnyTool | undefined { return reg().get(name); }
export function allTools(): AnyTool[] { return [...reg().values()]; }

export function toolsFor(ctx: Pick<ToolCtx, 'userId' | 'threadId' | 'folderId' | 'kind' | 'modelId' | 'depth'>): AnyTool[] {
  return allTools().filter((t) => { try { return t.enabled(ctx); } catch (e) { console.error(`[tools] ${t.name}.enabled`, (e as Error).message); return false; } })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function openaiTools(tools: AnyTool[]) {
  return tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

type PromptCtx = Pick<ToolCtx, 'userId' | 'threadId' | 'folderId' | 'kind' | 'modelId' | 'depth'>;
type PromptPart = (ctx: PromptCtx) => string | null;
export type PartScope = 'shared' | 'chat' | 'user';
const gp = globalThis as unknown as { __kxPromptPartsV2?: Map<PromptPart, PartScope> };
const parts = () => (gp.__kxPromptPartsV2 ??= new Map<PromptPart, PartScope>());

export function registerPromptPart(fn: PromptPart, scope: PartScope = 'shared'): () => void { parts().set(fn, scope); return () => { parts().delete(fn); }; }

export function promptPartsScoped(ctx: PromptCtx): Record<PartScope, string[]> {
  const out: Record<PartScope, string[]> = { shared: [], chat: [], user: [] };
  const seen = new Set<string>();
  for (const [fn, scope] of parts()) {
    try { const s = fn(ctx); const t = s?.trim(); if (t && !seen.has(t)) { seen.add(t); out[scope].push(t); } } catch (e) { console.error('[tools] prompt part', (e as Error).message); }
  }
  return out;
}

export function promptParts(ctx: PromptCtx): string[] {
  const o = promptPartsScoped(ctx);
  return [...o.shared, ...o.chat, ...o.user];
}

type RuleSet = { prefix: string; rules: () => string | null };
const g2 = globalThis as unknown as { __kxToolRules?: RuleSet[] };
const ruleSets = () => (g2.__kxToolRules ??= []);
export function registerToolRules(prefix: string, rules: () => string | null) { ruleSets().push({ prefix, rules }); }
export function toolRules(names: Set<string>): string | null {
  const out = ruleSets().filter((r) => [...names].some((n) => n.startsWith(r.prefix))).map((r) => r.rules()).filter((x): x is string => !!x);
  return out.length ? out.join('\n') : null;
}
