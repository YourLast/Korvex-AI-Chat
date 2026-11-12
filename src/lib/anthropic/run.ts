import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlockParam, BetaMessage, BetaMessageParam, BetaToolUnion, MessageCreateParamsStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { execCall, MAX_ROUNDS, memTexts, retryPause, SAME_STOP, SAME_WARN, agentRules, type LoopHost } from '../agentLoop';
import '../tools/all';
import { allTools, getTool, toolRules } from '../tools/registry';
import type { KorvexTool, StepEvent } from '../tools/types';
import { newTaint } from '../tools/taint';
import type { Message } from '../db/schema';
import type { Level, ModelCfg } from '../models';
import type { Lang } from '../i18n/core';
import { claudeClient, providerClaudeClient, isNoFunds, keyNoFunds, keyOk, NoKeyError } from './client';
import { addTokens, billOf, emptyTokens, usageRecord, type ClaudeTokens } from './price';
import { buildHistory, claudeSystem, echoContent, levelToClaude, nowLine, recordOf, sealRecord, type Built, type ClaudeRecord, type Effort, type ThinkMode } from './history';
import { strictSchema, validate } from './schema';

export const MAX_TOKENS = 64_000;
const CLEAR_TOOLS_AT = 120_000;
const COMPACT_AT = 700_000;

type Flags = { noFallback: boolean; noStrict: boolean; noCtxMgmt: boolean };
const gf = globalThis as unknown as { __kxClaudeFlags?: Flags };
export const claudeFlags = (): Flags => (gf.__kxClaudeFlags ??= { noFallback: process.env.KX_CLAUDE_FALLBACK === '0', noStrict: process.env.KX_CLAUDE_STRICT === '0', noCtxMgmt: process.env.KX_CLAUDE_CTX_MGMT === '0' });

const group = (n: string) => (/^(chat|agent|files)_/.test(n) ? 0 : n.startsWith('web_') ? 1 : n.startsWith('browser_') ? 2 : n.startsWith('memory_') ? 3 : 4);

export function claudeTools(ctx: Pick<LoopHost, 'userId' | 'threadId' | 'folderId' | 'kind' | 'modelId' | 'depth'>): KorvexTool<Record<string, unknown>>[] {
  const c = { userId: ctx.userId, threadId: ctx.threadId, folderId: ctx.folderId, kind: ctx.kind, modelId: ctx.modelId, depth: ctx.depth };
  const on = (t: KorvexTool<unknown> | undefined) => { try { return !!t && t.enabled(c); } catch { return false; } };
  const code = on(getTool('code_open'));
  return allTools().filter((t) => {
    if (t.claudeEnabled) return t.claudeEnabled();
    if (t.name.startsWith('code_') || t.name.startsWith('github_')) return code;
    return on(t);
  }).sort((a, b) => group(a.name) - group(b.name) || a.name.localeCompare(b.name)) as KorvexTool<Record<string, unknown>>[];
}

export const STRICT_MAX = 20;
export const STRICT_OPTIONAL_MAX = 24;
export function optionalCount(s: unknown): number {
  if (!s || typeof s !== 'object') return 0;
  const o = s as { properties?: Record<string, unknown>; required?: string[]; items?: unknown; anyOf?: unknown[] };
  let n = 0;
  if (o.properties) for (const [k, v] of Object.entries(o.properties)) { if (!(o.required ?? []).includes(k)) n++; n += optionalCount(v); }
  if (o.items) n += optionalCount(o.items);
  for (const x of o.anyOf ?? []) n += optionalCount(x);
  return n;
}
const strictRank = (n: string) => [0, 1, 4, 2, 3][group(n)];
export function strictNames(tools: KorvexTool<Record<string, unknown>>[]): Set<string> {
  const out = new Set<string>();
  let opt = 0;
  for (const t of [...tools].sort((a, b) => strictRank(a.name) - strictRank(b.name) || a.name.localeCompare(b.name))) {
    if (out.size >= STRICT_MAX) break;
    const n = optionalCount(t.parameters);
    if (opt + n > STRICT_OPTIONAL_MAX) continue;
    opt += n; out.add(t.name);
  }
  return out;
}

export function toolDefs(tools: KorvexTool<Record<string, unknown>>[], strict: boolean): BetaToolUnion[] {
  const on = strict ? strictNames(tools) : new Set<string>();
  return tools.map((t) => {
    const s = on.has(t.name);
    return {
      name: t.name,
      description: t.description,
      input_schema: (s ? strictSchema(t.parameters) : t.parameters) as { type: 'object'; properties?: Record<string, unknown> },
      ...(s ? { strict: true } : {}),
      eager_input_streaming: true,
    };
  });
}

export type ClaudeHost = LoopHost & {
  hist: Message[];
  lang: Lang;
  continuing: boolean;
  ctx: { folder: string | null; chat: string | null; mem: string | null };
};
export type ClaudeResult = { record: ClaudeRecord | null; usage: ReturnType<typeof usageRecord> | null; finish: string; error: string | null; errorUser: string | null; rounds: number; transcript: Record<string, unknown>[];
  ctxTokens: number };

const ERR = {
  refusal: (name: string) => `${name} не может с этим помочь.`,
  busy: (name: string) => `${name} сейчас перегружена — попробуйте через минуту.`,
  down: (name: string) => `${name} временно не отвечает — попробуйте чуть позже.`,
  long: (name: string) => `Чат стал слишком длинным для ${name} — начните новый чат.`,
};

type ErrKind = { kind: 'nofunds' | 'binding' | 'fallback' | 'strict' | 'ctxmgmt' | 'long' | 'busy' | 'down' | 'auth' | 'bad'; msg: string; status?: number };
export function classify(e: unknown): ErrKind {
  if (e instanceof NoKeyError) return { kind: 'auth', msg: e.message };
  if (isNoFunds(e)) return { kind: 'nofunds', msg: `${(e as InstanceType<typeof Anthropic.APIError>).status ?? ''} billing_error`.trim(), status: (e as InstanceType<typeof Anthropic.APIError>).status };
  if (e instanceof Anthropic.APIError) {
    const st = e.status;
    const m = (e.message || '').slice(0, 500);
    if (st === 400) {
      if (/signature|bound to a different conversation|block_binding|thinking block/i.test(m)) return { kind: 'binding', msg: m, status: st };
      if (/fallback/i.test(m)) return { kind: 'fallback', msg: m, status: st };
      if (/strict|grammar|schema/i.test(m)) return { kind: 'strict', msg: m, status: st };
      if (/context_management|clear_tool_uses|compact/i.test(m)) return { kind: 'ctxmgmt', msg: m, status: st };
      if (/prompt is too long|too many tokens|context window|exceed/i.test(m)) return { kind: 'long', msg: m, status: st };
      return { kind: 'bad', msg: m, status: st };
    }
    if (st === 401 || st === 403) return { kind: 'auth', msg: `${st}: ${m}`, status: st };
    if (st === 413) return { kind: 'long', msg: m, status: st };
    if (st === 429 || st === 529 || /overloaded|rate.?limit/i.test(m)) return { kind: 'busy', msg: `${st ?? ''} ${m}`.trim(), status: st };
    return { kind: 'down', msg: `${st ?? ''} ${m}`.trim(), status: st };
  }
  const m = (e as Error)?.message || String(e);
  return { kind: 'down', msg: m.slice(0, 500) };
}

export function requestParams(o: { model: ModelCfg; system: string; tools: BetaToolUnion[]; messages: BetaMessageParam[]; mode: ThinkMode; top: Effort; effortMsgs: boolean; flags: Flags }): MessageCreateParamsStreaming {
  const betas: string[] = [];
  const adaptive = o.mode === 'adaptive';
  if (adaptive) betas.push('thinking-binding-controls-2026-08-01', 'mid-conversation-output-config-2026-07-01');
  if (!o.flags.noCtxMgmt) betas.push('context-management-2025-06-27', 'compact-2026-01-12');
  if (!o.flags.noFallback) betas.push('server-side-fallback-2026-07-01');
  return {
    model: o.model.upstreamModel,
    max_tokens: MAX_TOKENS,
    stream: true,
    tools: o.tools,
    system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages: o.messages,
    cache_control: { type: 'ephemeral' },
    thinking: adaptive ? { type: 'adaptive', display: 'summarized', block_binding: { prefix_mismatch_behavior: 'drop_block' } } : { type: 'between_tools' },
    output_config: { effort: o.top },
    ...(o.flags.noCtxMgmt ? {} : { context_management: { edits: [
      { type: 'clear_tool_uses_20250919', trigger: { type: 'input_tokens', value: CLEAR_TOOLS_AT }, keep: { type: 'tool_uses', value: 6 }, clear_at_least: { type: 'input_tokens', value: 20_000 } },
      { type: 'compact_20260112', trigger: { type: 'input_tokens', value: COMPACT_AT } },
    ] } }),
    ...(o.flags.noFallback ? {} : { fallbacks: 'default' as const }),
    betas,
  } as MessageCreateParamsStreaming;
}

const canon = (v: unknown): string => JSON.stringify(sortKeys(v));
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}
const dropNulls = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));

export async function runClaude(h: ClaudeHost): Promise<ClaudeResult> {
  const model = h.model;
  const { mode, effort } = levelToClaude(model, h.level.id, h.level.effort);
  const flags = claudeFlags();
  const tools = claudeTools(h);
  const names = new Set(tools.map((t) => t.name));
  const system = claudeSystem(model, { rules: agentRules(false), browser: toolRules(names), web: names.has('web_search') });
  const ctxParts = { now: nowLine(h.tz, h.lang), folder: h.ctx.folder, chat: h.ctx.chat, mem: h.ctx.mem };
  const prev = h.continuing ? recordOf(h.hist.at(-1)) : null;
  let built: Built = await buildHistory({ hist: h.hist, userId: h.userId, lang: h.lang, mode, effort, continuing: h.continuing, ctxParts });
  const added: BetaMessageParam[] = [];
  if (h.continuing) added.push({ role: 'user', content: [{ type: 'text', text: 'Продолжи ответ с того места, где он оборвался, без повторов.' }] });
  const transcript: Record<string, unknown>[] = [];
  const steps = new Map<string, StepEvent>();
  const put = (s: StepEvent) => { steps.set(s.id, s); h.step(s); };
  const allowed = new Set<string>();
  const taint = newTaint({ human: h.taint?.human ?? [], ask: h.taint?.ask ?? '', on: !!h.taint?.on || h.depth >= 1, strict: h.depth >= 1, priv: memTexts(h.userId) });
  let total: ClaudeTokens = emptyTokens();
  let usd = 0;
  let ctxTokens = 0;
  let finish = 'stop';
  let error: string | null = null, errorUser: string | null = null;
  let lastSig = '', same = 0, round = 0;
  const byKey: Record<string, number> = {};

  const deliverSteers = (results: BetaContentBlockParam[] | null) => {
    const ss = h.takeSteers();
    if (!ss.length) return null;
    const text = ss.map((s) => `[Пользователь пишет по ходу работы] ${s.text}`).join('\n\n');
    for (const s of ss) {
      put({ id: 'steer-' + s.id, kind: 'steer', title: s.text, status: 'ok', at: h.len(), round, t0: s.at, t1: Date.now(), detail: results ? undefined : 'прервал работу' });
      taint.human.push(s.text); taint.ask = `${taint.ask}\n${s.text}`;
    }
    transcript.push({ role: 'user', content: text });
    return { type: 'text' as const, text };
  };

  for (;; round++) {
    if (h.signal.aborted) break;
    if (round >= MAX_ROUNDS) { error = `Агент остановлен: больше ${MAX_ROUNDS} шагов модели в одном ходе (похоже на зацикливание)`; break; }
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    h.signal.addEventListener('abort', onAbort, { once: true });
    let interrupted = false;
    h.onInterrupt(() => { interrupted = true; ac.abort(); });
    h.round();
    const mark = h.len();
    let msg: BetaMessage | null = null;
    let text = '';
    let rTotal = 0;
    for (let attempt = 0; ; attempt++) {
      let got = false;
      let key = -1;
      text = ''; rTotal = 0;
      try {
        const cl = model.providerId ? { client: providerClaudeClient(model.providerId, model.baseUrl || undefined), key: -1 } : claudeClient();
        key = cl.key;
        const client = cl.client;
        const params = requestParams({ model, system, tools: toolDefs(tools, !flags.noStrict), messages: [...built.messages, ...added], mode, top: built.top, effortMsgs: built.effortMsgs, flags });
        const stream = client.beta.messages.stream(params, { signal: ac.signal });
        let rOpen = 0;
        for await (const ev of stream) {
          if (ev.type === 'content_block_start') {
            if (ev.content_block.type === 'thinking' || ev.content_block.type === 'redacted_thinking') rOpen = Date.now();
          } else if (ev.type === 'content_block_delta') {
            const d = ev.delta as { type: string; thinking?: string; text?: string };
            if (d.type === 'thinking_delta' && d.thinking) { got = true; h.feed({ t: 'r', d: d.thinking }); }
            else if (d.type === 'text_delta' && d.text) { got = true; text += d.text; h.feed({ t: 'c', d: d.text }); }
          } else if (ev.type === 'content_block_stop' && rOpen) {
            rTotal += Date.now() - rOpen; rOpen = 0;
            h.feed({ t: 'rend', ms: rTotal });
          }
        }
        msg = await stream.finalMessage();
        (msg as { _kxKey?: number })._kxKey = key;
        if (key >= 0) keyOk(key);
        break;
      } catch (e) {
        if (ac.signal.aborted) break;
        const k = classify(e);
        console.error(`[claude] ${model.id} round=${round} attempt=${attempt}${key >= 0 ? ` ключ ${key + 1}` : ''} ${k.kind}: ${k.msg}`);
        if (got) h.rollback(mark);
        if (k.kind === 'nofunds' && key >= 0 && attempt < 4 && keyNoFunds(key)) continue;
        if (k.kind === 'binding' && !built.stripped) { built = await buildHistory({ hist: h.hist, userId: h.userId, lang: h.lang, mode, effort, continuing: h.continuing, forceStrip: true, ctxParts }); continue; }
        if (k.kind === 'fallback' && !flags.noFallback) { flags.noFallback = true; console.error('[claude] серверный фолбэк отключён: API отверг fallbacks'); continue; }
        if (k.kind === 'strict' && !flags.noStrict) { flags.noStrict = true; console.error('[claude] strict у инструментов отключён: API отверг схему'); continue; }
        if (k.kind === 'ctxmgmt' && !flags.noCtxMgmt) { flags.noCtxMgmt = true; console.error('[claude] context editing / компакция отключены: API отверг'); continue; }
        if ((k.kind === 'busy' || k.kind === 'down') && attempt < 2) {
          if (await retryPause(h.step, h.len(), round, attempt + 1, ac.signal, 'retry', got)) { h.round(); continue; }
          break;
        }
        error = `${k.kind}: ${k.msg}`;
        errorUser = k.kind === 'busy' ? ERR.busy(model.name) : k.kind === 'long' ? ERR.long(model.name) : ERR.down(model.name);
        if (k.kind === 'nofunds') error = 'nofunds: на всех ключах Anthropic кончились деньги';
        break;
      }
    }
    h.signal.removeEventListener('abort', onAbort);
    h.onInterrupt(null);
    if (msg) {
      const b = billOf(model.upstreamModel, msg.usage as never);
      total = addTokens(total, b.tokens); usd += b.usd;
      ctxTokens = b.tokens.input + b.tokens.cacheRead + b.tokens.write5m + b.tokens.write1h;
      const kk = String(((msg as { _kxKey?: number })._kxKey ?? 0) + 1);
      byKey[kk] = (byKey[kk] ?? 0) + b.usd;
    }
    if (h.signal.aborted || (interrupted && !msg)) {
      if (text.trim()) added.push({ role: 'assistant', content: [{ type: 'text', text }] });
      if (h.signal.aborted) break;
      const note = deliverSteers(null);
      if (note) added.push({ role: 'user', content: [note] });
      continue;
    }
    if (error || !msg) break;
    if (msg.stop_reason === 'refusal') {
      h.rollback(mark);
      const cat = (msg as { stop_details?: { category?: string | null } | null }).stop_details?.category ?? null;
      error = `refusal${cat ? `: ${cat}` : ''}`;
      errorUser = ERR.refusal(model.name);
      finish = 'refusal';
      break;
    }
    const content = echoContent(msg.content as unknown[]);
    added.push({ role: 'assistant', content });
    if (msg.stop_reason === 'pause_turn') continue;
    const uses = content.filter((b) => b.type === 'tool_use') as { type: 'tool_use'; id: string; name: string; input: unknown }[];
    if (!uses.length) { finish = msg.stop_reason === 'max_tokens' ? 'length' : 'stop'; break; }
    transcript.push({ role: 'assistant', content: text, tool_calls: uses.map((u) => ({ id: u.id, type: 'function', function: { name: u.name, arguments: JSON.stringify(u.input ?? {}) } })) });
    if (msg.stop_reason === 'max_tokens') { error = 'вход инструмента обрезан (max_tokens)'; errorUser = ERR.down(model.name); break; }
    const results: BetaContentBlockParam[] = [];
    let stop: string | null = null;
    const lh: LoopHost = h;
    for (const u of uses) {
      const tool = tools.find((t) => t.name === u.name) ?? tools.find((t) => t.name.toLowerCase() === String(u.name).toLowerCase()) ?? null;
      const input = u.input && typeof u.input === 'object' && !Array.isArray(u.input) ? dropNulls(u.input as Record<string, unknown>) : null;
      let out: string;
      let isErr = false;
      const bad = tool ? (input ? validate(tool.parameters, input) : 'input: ожидался объект') : null;
      if (!tool) { out = `Ошибка: инструмента «${u.name}» нет. Доступны: ${tools.map((t) => t.name).join(', ')}.`; isErr = true; }
      else if (bad) { out = JSON.stringify({ INVALID_INPUT: bad, input: JSON.stringify(u.input).slice(0, 2000) }); isErr = true; }
      else {
        const sig = tool.name + ':' + canon(input);
        same = sig === lastSig ? same + 1 : 1;
        lastSig = sig;
        if (same >= SAME_STOP) { stop = `Агент остановлен: один и тот же вызов ${tool.name} ${same} раз подряд`; out = 'Остановлено: повтор.'; isErr = true; }
        else if (same >= SAME_WARN) out = `Этот вызов (${tool.name} с теми же аргументами) повторяется ${same}-й раз подряд и даёт тот же результат. Смени подход или ответь пользователю тем, что уже есть.`;
        else out = await execCall(lh, { id: u.id, name: tool.name, args: JSON.stringify(input) }, round, tools, steps, put, allowed, taint);
      }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: out, ...(isErr ? { is_error: true } : {}) });
      transcript.push({ role: 'tool', tool_call_id: u.id, content: out });
      if (h.signal.aborted || stop) break;
    }
    const note = h.signal.aborted ? null : deliverSteers(results);
    added.push({ role: 'user', content: note ? [...results, note] : results });
    if (stop) { error = stop; break; }
    if (h.signal.aborted) break;
  }

  const msgs = sealRecord(added);
  const record: ClaudeRecord | null = prev
    ? { ...prev, msgs: [...prev.msgs, ...msgs] }
    : msgs.length ? { v: 1, model: model.upstreamModel, mode, top: built.top, effort, ...(built.pre.length ? { pre: built.pre } : {}), ctx: built.ctx, keys: built.keys, msgs } : null;
  const usage = total.requests ? usageRecord(model.upstreamModel, total, usd, byKey) : null;
  if (usage) console.log(`[claude] ${model.id} level=${h.level.id} job=${h.jobId} requests=${total.requests} in=${total.input} cache_read=${total.cacheRead} cache_write=${total.write5m + total.write1h} out=${total.output} usd=${usd.toFixed(4)}${error ? ` error=${error.slice(0, 120)}` : ''}`);
  return { record, usage, finish, error, errorUser, rounds: round + 1, transcript, ctxTokens };
}

export type { Level };
