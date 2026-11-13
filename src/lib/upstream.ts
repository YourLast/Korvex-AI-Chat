import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';
import type { ModelCfg, Level } from './models';
import { upstreamEffort } from './levels';
import { tzOrDefault, TZ_HEADER } from './tz';
import { isUnreachable } from './unavailable';
import { PLAIN_DIALECT, type Dialect, type Memory, type QueueInfo } from './dialect';
import { modelKey } from './providers';
import { brandText } from './brandCore';
import { ext } from '@/ext';
import { EXTRA_KEY } from '@/ext/client';
import { modelFetch, tapFetch, upstreamBytes } from './jobTimeout';

export type ChatPart = { type: 'text'; text: string } | { type: 'image'; image: Buffer; mediaType: string };
export type ChatMsg = { role: 'user' | 'assistant' | 'system'; content: string | ChatPart[] };

export type ToolCallDelta = { index: number; id?: string; type?: 'function'; function?: { name?: string; arguments?: string } };
export type OaiMsg = { role: string } & Record<string, unknown>;
export type AgentReq = { messages: OaiMsg[]; tools?: unknown[]; toolChoice?: unknown; parallelToolCalls?: boolean; maxTokens?: number;
  header?: boolean };

export type { Memory };
const dialect = (): Dialect => ext.dialect ?? PLAIN_DIALECT;
function withSources(usage: Record<string, unknown> | null, sources: unknown[] | null | undefined, sinfo: Record<string, number> | undefined): Record<string, unknown> | null {
  if (!sources) return usage;
  const u = usage ?? {};
  return { ...u, [EXTRA_KEY]: { ...((u[EXTRA_KEY] as Record<string, unknown> | undefined) ?? {}), ...(sinfo ?? {}), sources } };
}
export type UpEvent =
  | { t: 'r'; d: string }
  | { t: 'rend'; ms: number }
  | { t: 'c'; d: string }
  | { t: 'tc'; d: ToolCallDelta[] }
  | { t: 'done'; finish: string; usage: Record<string, unknown> | null; memory: Memory | null; durationMs: number }
  | ({ t: 'q' } & QueueInfo)
  | { t: 'err'; message: string; unreachable?: boolean; maint?: number; maintSoft?: boolean };

export async function* streamChat(opts: {
  model: ModelCfg;
  level: Level;
  chatId: string;
  messages: ChatMsg[];
  signal: AbortSignal;
  timezone?: string | null;
  agent?: AgentReq;
  sources?: boolean;
}): AsyncGenerator<UpEvent> {
  if (opts.agent) { yield* streamAgent({ ...opts, agent: opts.agent }); return; }
  const { model, level, chatId, messages, signal } = opts;
  const t0 = Date.now();
  const effort = upstreamEffort(level);
  const D = dialect();
  let maintRA: number | null = null;
  const provider = createOpenAICompatible({
    name: D.name,
    baseURL: model.baseUrl,
    apiKey: modelKey(model) ?? D.defaultKey,
    includeUsage: true,
    fetch: tapFetch,
    headers: { ...(D.headers?.(chatId, {}) ?? {}), [TZ_HEADER]: tzOrDefault(opts.timezone) },
    metadataExtractor: {
      extractMetadata: async ({ parsedBody }) => {
        const x = D.extras?.(parsedBody);
        return x && (x.memory || x.sources) ? { [D.name]: { ...(x.memory ? { memory: x.memory as never } : {}), ...(x.sources ? { sources: x.sources as never, ...(x.sinfo ?? {}) } : {}) } } : undefined;
      },
      createStreamExtractor: () => {
        let mem: unknown;
        let src: unknown[] | null = null;
        let info: Record<string, number> = {};
        return {
          processChunk(c) {
            const fm = D.maintFrame?.(c) ?? null;
            if (fm !== null) maintRA = fm;
            const x = D.extras?.(c);
            if (x?.memory) mem = x.memory;
            if (x?.sources) { src = x.sources; info = x.sinfo ?? {}; }
          },
          buildMetadata: () => (mem || src ? { [D.name]: { ...(mem ? { memory: mem as never } : {}), ...(src ? { sources: src as never, ...info } : {}) } } : undefined),
        };
      },
    },
  });

  const sys = brandText(messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : '')).filter(Boolean).join('\n\n'));
  const rest = messages.filter((m) => m.role !== 'system');
  const res = streamText({
    model: provider.chatModel(model.upstreamModel),
    ...(sys ? { instructions: sys } : {}),
    messages: rest as never,
    abortSignal: signal,
    maxRetries: 0,
    includeRawChunks: !!D.queueFrame,
    providerOptions: effort || opts.sources ? { [D.name]: { ...(effort ? { reasoningEffort: effort } : {}), ...(opts.sources ? (D.body?.({ sources: true }) ?? {}) : {}) } } : undefined,
  });

  let rStart = 0;
  let rTotal = 0;
  let memory: Memory | null = null;
  let usage: Record<string, unknown> | null = null;
  let sources: unknown[] | null = null;
  let sinfo: Record<string, number> = {};
  let finish = 'stop';
  try {
    for await (const p of res.fullStream) {
      switch (p.type) {
        case 'reasoning-start':
          rStart = Date.now();
          break;
        case 'reasoning-delta':
          yield { t: 'r', d: p.text };
          break;
        case 'reasoning-end':
          if (rStart) rTotal += Date.now() - rStart;
          rStart = 0;
          yield { t: 'rend', ms: rTotal };
          break;
        case 'text-delta':
          yield { t: 'c', d: p.text };
          break;
        case 'raw': {
          const q = D.queueFrame?.((p as { rawValue?: unknown }).rawValue) ?? null;
          if (q) yield { t: 'q', ...q };
          break;
        }
        case 'finish-step': {
          const pmd = ((p as { providerMetadata?: Record<string, { memory?: Memory; sources?: unknown; sources_unverified?: number; sources_total?: number } | undefined> }).providerMetadata ?? {})[D.name];
          const pm = pmd?.memory;
          if (pm) memory = pm;
          if (Array.isArray(pmd?.sources)) { sources = pmd.sources as unknown[]; sinfo = { ...(typeof pmd.sources_unverified === 'number' ? { sources_unverified: pmd.sources_unverified } : {}), ...(typeof pmd.sources_total === 'number' ? { sources_total: pmd.sources_total } : {}) }; }
          finish = String((p as { finishReason?: string }).finishReason ?? finish);
          const u = (p as { usage?: { raw?: Record<string, unknown>; inputTokens?: number; outputTokens?: number } }).usage;
          usage = { prompt_tokens: u?.inputTokens, completion_tokens: u?.outputTokens, ...(u?.raw ?? {}) };
          if (D.memoryKey) {
            const raw = u?.raw as Record<string, unknown> | undefined;
            if (!memory && raw && raw[D.memoryKey]) memory = raw[D.memoryKey] as Memory;
            delete (usage as Record<string, unknown>)[D.memoryKey];
          }
          usage = withSources(usage, sources, sinfo);
          break;
        }
        case 'error': {
          const er = (p as { error: unknown }).error;
          yield withMaint({ t: 'err', message: errMsg(er), unreachable: isUnreachable(er), ...(maintRA === null && D.maintSoft?.(er) ? { maintSoft: true } : {}) }, maintRA ?? D.maintOf?.(er) ?? null);
          return;
        }
        default:
          break;
      }
    }
  } catch (e) {
    if (signal.aborted) return;
    yield withMaint({ t: 'err', message: errMsg(e), unreachable: isUnreachable(e), ...(maintRA === null && D.maintSoft?.(e) ? { maintSoft: true } : {}) }, maintRA ?? D.maintOf?.(e) ?? null);
    return;
  }
  if (rStart) {
    rTotal += Date.now() - rStart;
    yield { t: 'rend', ms: rTotal };
  }
  yield { t: 'done', finish, usage, memory, durationMs: Date.now() - t0 };
}

type AgentState = { rStart: number; rTotal: number; usage: Record<string, unknown> | null; memory: Memory | null; finish: string; sawFinish: boolean; err: string | null; maint?: number | null; cut?: boolean; src?: unknown[]; sinfo?: Record<string, number> };
type RawToolCall = { index?: unknown; id?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } | null };

function cleanToolCall(tc: RawToolCall, i: number): ToolCallDelta {
  const out: ToolCallDelta = { index: typeof tc.index === 'number' && Number.isInteger(tc.index) && tc.index >= 0 ? tc.index : i };
  if (typeof tc.id === 'string' && tc.id) out.id = tc.id;
  if (tc.type === 'function') out.type = 'function';
  const fn = tc.function;
  if (fn && typeof fn === 'object') {
    const f: NonNullable<ToolCallDelta['function']> = {};
    if (typeof fn.name === 'string' && fn.name) f.name = fn.name;
    if (typeof fn.arguments === 'string') f.arguments = fn.arguments;
    else if (fn.arguments != null) f.arguments = JSON.stringify(fn.arguments);
    out.function = f;
  }
  return out;
}

function agentFrame(f: unknown, st: AgentState, D: Dialect): UpEvent[] {
  const out: UpEvent[] = [];
  const fr = f as { error?: unknown; usage?: Record<string, unknown> | null; choices?: { delta?: Record<string, unknown>; message?: Record<string, unknown>; finish_reason?: unknown }[] };
  if (!fr || typeof fr !== 'object') return out;
  const q = D.queueFrame?.(fr) ?? null;
  if (q) out.push({ t: 'q', ...q });
  if (fr.error) {
    const e = fr.error as { message?: unknown } | string;
    st.err = typeof e === 'string' ? e : typeof e?.message === 'string' ? e.message : 'upstream error';
    st.maint = D.maintFrame?.(fr) ?? null;
    st.cut = isUnreachable(fr.error);
    return out;
  }
  if (fr.usage && typeof fr.usage === 'object') {
    const u = { ...fr.usage };
    if (D.memoryKey) {
      if (u[D.memoryKey] && typeof u[D.memoryKey] === 'object') st.memory = u[D.memoryKey] as Memory;
      delete u[D.memoryKey];
    }
    st.usage = u;
  }
  const x = D.extras?.(fr);
  if (x?.sources) { st.src = x.sources; st.sinfo = x.sinfo; }
  const ch = fr.choices?.[0];
  if (!ch) return out;
  const d = (ch.delta ?? ch.message ?? {}) as { content?: unknown; reasoning_content?: unknown; reasoning?: unknown; tool_calls?: unknown };
  const r = typeof d.reasoning_content === 'string' && d.reasoning_content ? d.reasoning_content : typeof d.reasoning === 'string' ? d.reasoning : '';
  if (r) { if (!st.rStart) st.rStart = Date.now(); out.push({ t: 'r', d: r }); }
  const closeR = () => { if (st.rStart) { st.rTotal += Date.now() - st.rStart; st.rStart = 0; out.push({ t: 'rend', ms: st.rTotal }); } };
  if (typeof d.content === 'string' && d.content) { closeR(); out.push({ t: 'c', d: d.content }); }
  if (Array.isArray(d.tool_calls) && d.tool_calls.length) {
    closeR();
    out.push({ t: 'tc', d: (d.tool_calls as RawToolCall[]).filter((x) => x && typeof x === 'object').map(cleanToolCall) });
  }
  if (ch.finish_reason) { st.finish = String(ch.finish_reason); st.sawFinish = true; }
  return out;
}

async function* streamAgent(opts: { model: ModelCfg; level: Level; chatId: string; signal: AbortSignal; timezone?: string | null; agent: AgentReq; sources?: boolean }): AsyncGenerator<UpEvent> {
  const { model, level, chatId, signal, agent } = opts;
  const D = dialect();
  const key = modelKey(model) ?? D.defaultKey;
  const t0 = Date.now();
  const effort = upstreamEffort(level);
  const tools = agent.tools?.length ? agent.tools : null;
  const body: Record<string, unknown> = {
    model: model.upstreamModel,
    messages: agent.messages.map((m) => (m.role === 'system' && typeof m.content === 'string' ? { ...m, content: brandText(m.content) } : m)),
    stream: true,
    stream_options: { include_usage: true },
    ...(effort ? { reasoning_effort: effort } : {}),
    ...(tools ? { tools, ...(agent.toolChoice !== undefined ? { tool_choice: agent.toolChoice } : {}) } : {}),
    ...(tools && typeof agent.parallelToolCalls === 'boolean' ? { parallel_tool_calls: agent.parallelToolCalls } : {}),
    ...(agent.maxTokens ? { max_tokens: agent.maxTokens } : {}),
    ...(opts.sources ? (D.body?.({ sources: true }) ?? {}) : {}),
  };
  let res: Response;
  try {
    res = await modelFetch(model.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json', Accept: 'text/event-stream', ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(D.headers?.(chatId, { agent: agent.header !== false }) ?? {}), [TZ_HEADER]: tzOrDefault(opts.timezone),
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (signal.aborted) return;
    yield withMaint({ t: 'err', message: errMsg(e), unreachable: isUnreachable(e) }, D.maintOf?.(e) ?? null);
    return;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const er = { message: text.slice(0, 300) || res.statusText, statusCode: res.status, responseBody: text, responseHeaders: { 'retry-after': res.headers.get('retry-after') ?? '' } };
    yield withMaint({ t: 'err', message: errMsg(er), unreachable: isUnreachable({ statusCode: res.status }), ...(D.maintSoft?.(er) ? { maintSoft: true } : {}) }, D.maintOf?.(er) ?? null);
    return;
  }
  const st: AgentState = { rStart: 0, rTotal: 0, usage: null, memory: null, finish: 'stop', sawFinish: false, err: null };
  const reader = (res.headers.get('content-type') ?? '').includes('text/event-stream') ? res.body?.getReader() : undefined;
  try {
    if (!reader) {
      for (const ev of agentFrame(await res.json(), st, D)) yield ev;
      st.sawFinish = true;
    } else {
      const dec = new TextDecoder();
      let buf = '';
      let ended = false;
      while (!ended && !st.err) {
        const { value, done } = await reader.read();
        if (done) break;
        upstreamBytes();
        buf += dec.decode(value, { stream: true });
        for (let nl = buf.indexOf('\n'); nl >= 0 && !ended && !st.err; nl = buf.indexOf('\n')) {
          const line = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') { ended = true; break; }
          let frame: unknown;
          try { frame = JSON.parse(payload); } catch { continue; }
          for (const ev of agentFrame(frame, st, D)) yield ev;
        }
      }
    }
  } catch (e) {
    if (signal.aborted) return;
    yield withMaint({ t: 'err', message: errMsg(e), unreachable: isUnreachable(e) }, D.maintOf?.(e) ?? null);
    return;
  } finally {
    reader?.cancel().catch(() => undefined);
  }
  if (st.err) { yield withMaint({ t: 'err', message: st.err.slice(0, 500), ...(st.cut ? { unreachable: true } : {}) }, st.maint ?? null); return; }
  if (!st.sawFinish) { if (signal.aborted) return; yield { t: 'err', message: 'поток оборвался до конца ответа (terminated)', unreachable: true }; return; }
  if (st.rStart) { st.rTotal += Date.now() - st.rStart; yield { t: 'rend', ms: st.rTotal }; }
  const usage = withSources(st.usage, st.src, st.sinfo);
  yield { t: 'done', finish: st.finish, usage, memory: st.memory, durationMs: Date.now() - t0 };
}

function withMaint(ev: Extract<UpEvent, { t: 'err' }>, maint: number | null): UpEvent {
  return maint === null ? ev : { ...ev, maint };
}

function errMsg(e: unknown): string {
  const x = e as { message?: string; statusCode?: number; responseBody?: string };
  let m = x?.message || String(e);
  if (x?.responseBody) {
    try {
      m = (JSON.parse(x.responseBody) as { error?: { message?: string } }).error?.message || m;
    } catch {
    }
  }
  return (x?.statusCode ? `${x.statusCode}: ` : '') + m.slice(0, 500);
}
