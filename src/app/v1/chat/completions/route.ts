import { randomUUID } from 'node:crypto';
import { count, W } from '@/lib/plural';
import { authKey, rateLimit, resolveApiModel, touchKey } from '@/lib/apikeys';
import { cancelJob, jobListen, submitInline, waitJob, type JobResult } from '@/lib/jobs';
import { apiNameOf, getModels } from '@/lib/models';
import { maintenance } from '@/lib/status';
import { isRestrictedLevel, nearestLevel } from '@/lib/levels';
import { cleanTz } from '@/lib/tz';
import { resolveUserTz } from '@/lib/usertz';
import { oaiError, oaiJson } from '@/lib/oai';
import { apiOffResponse } from '@/lib/apiGate';
import { sha256 } from '@/lib/auth';
import { TurnError } from '@/lib/turn';
import type { AgentReq, ChatMsg, ChatPart, OaiMsg, ToolCallDelta } from '@/lib/upstream';
import { ext } from '@/ext';
import { EXTRA_KEY } from '@/ext/client';

const OAI_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

const MAX_UNAVAILABLE = 'Уровень max через API временно недоступен: для наших серверов он слишком дорогой. Используйте xhigh. / The max level is temporarily unavailable via the API: it is too expensive for our servers. Use xhigh.';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY = 64 * 1024 * 1024;
const MAX_IMAGE = 12 * 1024 * 1024;

type InPart = { type?: string; text?: string; image_url?: string | { url?: string } };
type InToolCall = { id?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } | null };
type InMsg = { role?: string; content?: string | InPart[] | null; name?: string; tool_calls?: InToolCall[] | null; tool_call_id?: unknown; reasoning_content?: unknown };
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

const MAX_TOOLS = 128;
const textOf = (c: InMsg['content']) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p?.type === 'text').map((p) => p.text ?? '').join('\n') : '');
const isAgent = (b: { tools?: unknown }, msgs: InMsg[]) =>
  (Array.isArray(b.tools) && b.tools.length > 0) || msgs.some((m) => m?.role === 'tool' || (m?.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0));

function userParts(m: InMsg, i: number): { parts: ChatPart[]; urls: string[] } | { error: Response } {
  if (!Array.isArray(m.content)) return { error: oaiError(400, `messages[${i}].content: строка или массив частей`, 'invalid_content', { param: `messages[${i}].content` }) };
  const parts: ChatPart[] = [];
  const urls: string[] = [];
  for (const [j, p] of m.content.entries()) {
    if (p?.type === 'text') { parts.push({ type: 'text', text: p.text ?? '' }); urls.push(''); continue; }
    if (p?.type === 'image_url') {
      const url = typeof p.image_url === 'string' ? p.image_url : p.image_url?.url ?? '';
      const d = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
      if (!d) return { error: oaiError(400, 'Картинка — только data:image/png|jpeg|webp|gif;base64,… (внешние адреса не загружаются)', 'invalid_image_url', { param: `messages[${i}].content[${j}]` }) };
      const buf = Buffer.from(d[2], 'base64');
      if (buf.length > MAX_IMAGE) return { error: oaiError(413, 'Картинка больше 12 МБ', 'image_too_large', { param: `messages[${i}].content[${j}]` }) };
      parts.push({ type: 'image', image: buf, mediaType: d[1] });
      urls.push(url);
      continue;
    }
    return { error: oaiError(400, `Часть «${p?.type}» не поддерживается (text, image_url)`, 'unsupported_content_part', { param: `messages[${i}].content[${j}]` }) };
  }
  return { parts, urls };
}

function toChat(msgs: InMsg[]): { system: string[]; out: ChatMsg[] } | { error: Response } {
  const system: string[] = [];
  const out: ChatMsg[] = [];
  for (const [i, m] of msgs.entries()) {
    const role = m?.role;
    if (role === 'system' || role === 'developer') { system.push(textOf(m.content)); continue; }
    if (role === 'assistant') { out.push({ role: 'assistant', content: textOf(m.content) }); continue; }
    if (role !== 'user') return { error: oaiError(400, `messages[${i}].role «${role}» не поддерживается (system, developer, user, assistant, tool)`, 'unsupported_role', { param: `messages[${i}].role` }) };
    if (typeof m.content === 'string') { out.push({ role: 'user', content: m.content }); continue; }
    const u = userParts(m, i);
    if ('error' in u) return u;
    out.push({ role: 'user', content: u.parts });
  }
  if (!out.some((m) => m.role === 'user')) return { error: oaiError(400, 'Нужно хотя бы одно сообщение user', 'invalid_messages', { param: 'messages' }) };
  return { system, out };
}

function toAgent(msgs: InMsg[]): { system: string[]; out: OaiMsg[] } | { error: Response } {
  const system: string[] = [];
  const out: OaiMsg[] = [];
  const bad = (i: number, msg: string, param = `messages[${i}]`) => ({ error: oaiError(400, msg, 'invalid_messages', { param }) });
  for (const [i, m] of msgs.entries()) {
    const role = m?.role;
    if (role === 'system' || role === 'developer') { system.push(textOf(m.content)); continue; }
    if (role === 'user') {
      if (typeof m.content === 'string') { out.push({ role: 'user', content: m.content }); continue; }
      const u = userParts(m, i);
      if ('error' in u) return u;
      out.push({ role: 'user', content: u.parts.map((p, j) => (p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: u.urls[j] } })) });
      continue;
    }
    if (role === 'assistant') {
      const calls: ToolCall[] = [];
      if (m.tool_calls != null && !Array.isArray(m.tool_calls)) return bad(i, `messages[${i}].tool_calls: массив вызовов`, `messages[${i}].tool_calls`);
      for (const [j, c] of (m.tool_calls ?? []).entries()) {
        const fn = c?.function;
        if (!fn || typeof fn.name !== 'string' || !fn.name) return bad(i, `messages[${i}].tool_calls[${j}]: нужен function.name`, `messages[${i}].tool_calls[${j}]`);
        if (typeof c.id !== 'string' || !c.id) return bad(i, `messages[${i}].tool_calls[${j}]: нужен id`, `messages[${i}].tool_calls[${j}]`);
        const args = typeof fn.arguments === 'string' ? fn.arguments : fn.arguments == null ? '{}' : JSON.stringify(fn.arguments);
        calls.push({ id: c.id, type: 'function', function: { name: fn.name, arguments: args } });
      }
      const text = textOf(m.content);
      out.push({ role: 'assistant', content: text || (calls.length ? null : ''), ...(calls.length ? { tool_calls: calls } : {}),
        ...(typeof m.reasoning_content === 'string' && m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}) });
      continue;
    }
    if (role === 'tool') {
      if (typeof m.tool_call_id !== 'string' || !m.tool_call_id) return bad(i, `messages[${i}].tool_call_id: нужен id вызова, на который это ответ`, `messages[${i}].tool_call_id`);
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: textOf(m.content) });
      continue;
    }
    return { error: oaiError(400, `messages[${i}].role «${role}» не поддерживается (system, developer, user, assistant, tool)`, 'unsupported_role', { param: `messages[${i}].role` }) };
  }
  if (!out.some((m) => m.role === 'user' || m.role === 'tool')) return { error: oaiError(400, 'Нужно хотя бы одно сообщение user', 'invalid_messages', { param: 'messages' }) };
  return { system, out };
}

function agentParams(b: { tools?: unknown; tool_choice?: unknown; parallel_tool_calls?: unknown; max_tokens?: unknown; max_completion_tokens?: unknown }):
  Omit<AgentReq, 'messages'> | { error: Response } {
  const err = (msg: string, code: string, param: string) => ({ error: oaiError(400, msg, code, { param }) });
  let tools: unknown[] | undefined;
  if (b.tools != null) {
    if (!Array.isArray(b.tools)) return err('tools: массив инструментов', 'invalid_tools', 'tools');
    if (b.tools.length > MAX_TOOLS) return err(`Слишком много инструментов (${b.tools.length}; не больше ${MAX_TOOLS})`, 'too_many_tools', 'tools');
    tools = [];
    for (const [i, t] of b.tools.entries()) {
      const x = t as { type?: unknown; function?: { name?: unknown; description?: unknown; parameters?: unknown } | null };
      if (x?.type !== 'function') return err(`tools[${i}]: поддерживаются только инструменты type "function"`, 'invalid_tools', `tools[${i}]`);
      const fn = x.function;
      if (!fn || typeof fn.name !== 'string' || !fn.name.trim()) return err(`tools[${i}]: нужен function.name`, 'invalid_tools', `tools[${i}].function.name`);
      if (fn.parameters != null && (typeof fn.parameters !== 'object' || Array.isArray(fn.parameters))) return err(`tools[${i}].function.parameters: JSON Schema (объект)`, 'invalid_tools', `tools[${i}].function.parameters`);
      tools.push({ type: 'function', function: { name: fn.name, ...(typeof fn.description === 'string' ? { description: fn.description } : {}), ...(fn.parameters ? { parameters: fn.parameters } : {}) } });
    }
    if (!tools.length) tools = undefined;
  }
  let toolChoice: unknown;
  const tc = b.tool_choice as { type?: unknown; function?: { name?: unknown } } | string | undefined | null;
  if (tc != null && tools) {
    if (typeof tc === 'string') {
      if (!['auto', 'none', 'required'].includes(tc)) return err('tool_choice: auto, none, required или {"type": "function", "function": {"name": …}}', 'invalid_tool_choice', 'tool_choice');
      toolChoice = tc;
    } else if (tc && typeof tc === 'object' && tc.type === 'function' && typeof tc.function?.name === 'string') {
      if (!tools.some((t) => (t as { function: { name: string } }).function.name === tc.function!.name)) return err(`tool_choice: инструмента «${tc.function.name}» нет в tools`, 'invalid_tool_choice', 'tool_choice');
      toolChoice = { type: 'function', function: { name: tc.function.name } };
    } else return err('tool_choice: auto, none, required или {"type": "function", "function": {"name": …}}', 'invalid_tool_choice', 'tool_choice');
  }
  const mt = b.max_completion_tokens ?? b.max_tokens;
  let maxTokens: number | undefined;
  if (mt != null) {
    if (typeof mt !== 'number' || !Number.isInteger(mt) || mt < 1) return err('max_tokens / max_completion_tokens: целое число больше 0', 'invalid_max_tokens', b.max_completion_tokens != null ? 'max_completion_tokens' : 'max_tokens');
    maxTokens = mt;
  }
  const parallelToolCalls = typeof b.parallel_tool_calls === 'boolean' ? b.parallel_tool_calls : undefined;
  return { tools, toolChoice, parallelToolCalls, maxTokens };
}

function autoConversation(msgs: InMsg[], session = ''): string {
  const sys = msgs.filter((m) => m?.role === 'system' || m?.role === 'developer').map((m) => textOf(m.content)).join('\n\n');
  const first = msgs.find((m) => m?.role === 'user');
  return 'auto-' + sha256(`${sys}\u0000${first ? textOf(first.content) : ''}${session ? `\u0000${session}` : ''}`).slice(0, 16);
}

const finishOf = (f: string | null | undefined) => (f === 'length' ? 'length' : f === 'content-filter' || f === 'content_filter' ? 'content_filter' : f === 'tool-calls' || f === 'tool_calls' ? 'tool_calls' : 'stop');
function usageOf(r: Pick<JobResult, 'usage' | 'memory'>) {
  const u = { ...(r.usage ?? {}) } as Record<string, unknown>;
  for (const k of Object.keys(u)) if (k.startsWith('session_')) delete u[k];
  const pt = Number(u.prompt_tokens) || 0, ct = Number(u.completion_tokens) || 0;
  return { ...u, prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct, ...(r.memory ? { [ext.dialect?.memoryKey ?? 'memory']: r.memory } : {}) };
}
const maintText = (n: number) => `Модель на обслуживании, повторите через ${n} с`;
const UNREACH = /\b50[234]\b|stream was cut|upstream_cut|Failed to process successful response|ECONNREFUSED|ECONNRESET|fetch failed|socket|terminated|оборвался|failed to generate|yielded|retry later|gateway|without a terminal frame|timed? ?out|недоступн/i;
function upstreamError(msg: string, modelId?: string): { status: number; code: string; message: string; retryAfter?: number } {
  const mm = /\[maint retry_after=(\d+)\]/.exec(msg);
  if (mm) { const n = Math.min(600, Math.max(5, Number(mm[1]) || 30)); return { status: 503, code: ext.dialect?.maintCode ?? 'maintenance', message: maintText(n), retryAfter: n }; }
  if (/\b413\b|context_length|too long|maximum context|окно|слишком длин/i.test(msg)) return { status: 413, code: 'context_length_exceeded', message: 'Запрос слишком большой для модели: сократите историю или файлы' };
  if (/\b429\b/.test(msg)) return { status: 429, code: 'engine_busy', message: 'Движок занят, повторите позже', retryAfter: 30 };
  const m = maintenance(modelId);
  if (m || UNREACH.test(msg)) { const n = m?.retryAfter ?? 60; return { status: 503, code: 'service_unavailable', message: maintText(n), retryAfter: n }; }
  return { status: 502, code: 'upstream_error', message: 'Модель не ответила' + (/^\d{3}:/.test(msg) ? ` (${msg.slice(0, 3)})` : '') };
}

export async function POST(req: Request) {
  const apiOff = apiOffResponse();
  if (apiOff) return apiOff;
  const a = authKey(req);
  if ('status' in a) return oaiError(a.status, a.message, a.code);
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) return oaiError(413, 'Тело запроса больше 64 МБ', 'request_too_large');
  const raw = await req.text();
  if (raw.length > MAX_BODY) return oaiError(413, 'Тело запроса больше 64 МБ', 'request_too_large');
  let b: { model?: string; messages?: InMsg[]; stream?: boolean; stream_options?: { include_usage?: boolean }; reasoning_effort?: string; user?: string; metadata?: { conversation_id?: string; session_id?: string };
    tools?: unknown; tool_choice?: unknown; parallel_tool_calls?: unknown; max_tokens?: unknown; max_completion_tokens?: unknown; prompt_cache_key?: unknown };
  try { b = JSON.parse(raw); } catch { return oaiError(400, 'Тело — не JSON', 'invalid_json'); }
  if (!b?.model) return oaiError(400, 'Не указана модель (model)', 'missing_model', { param: 'model' });
  const model = resolveApiModel(b.model);
  if (!model) return oaiError(404, `Модель «${b.model}» не найдена; список — GET /v1/models`, 'model_not_found', { param: 'model' });
  const reqSlug = String(b.model).trim().toLowerCase().replace(/[\s_]+/g, '-');
  const outName = (model.apiNames ?? []).find((x) => x === reqSlug) ?? apiNameOf(model);
  if (!a.key.models.includes(model.id)) return oaiError(403, `Ключу не разрешена модель «${outName}»`, 'model_not_allowed', { param: 'model' });
  if (!Array.isArray(b.messages) || !b.messages.length) return oaiError(400, 'Нужен непустой массив messages', 'invalid_messages', { param: 'messages' });
  let levelId = a.key.levels[model.id] ?? model.defaultLevel;
  if (b.reasoning_effort != null) {
    const raw = String(b.reasoning_effort).toLowerCase();
    let want = raw === 'none' ? 'off' : raw;
    if (!model.levels.some((l) => l.id === want) && OAI_EFFORTS.has(raw)) want = nearestLevel(model, want);
    if (!model.levels.some((l) => l.id === want)) {
      return oaiError(400, `reasoning_effort «${b.reasoning_effort}» нет у ${model.name}: ${model.levels.map((l) => (l.id === 'off' ? 'none' : l.id)).join(', ')}`, 'invalid_reasoning_effort', { param: 'reasoning_effort' });
    }
    if (isRestrictedLevel(want)) return oaiError(400, MAX_UNAVAILABLE, 'reasoning_effort_unavailable', { param: 'reasoning_effort' });
    levelId = want;
  }
  if (isRestrictedLevel(levelId)) levelId = nearestLevel(model, 'xhigh');
  if (b.tools != null && !Array.isArray(b.tools)) return oaiError(400, 'tools: массив инструментов', 'invalid_tools', { param: 'tools' });
  const agent = isAgent(b, b.messages);
  if (agent && model.tools !== true) {
    const alt = getModels().find((m) => m.tools === true);
    return oaiError(400, `${model.name} пока не поддерживает инструменты${alt ? `, выберите ${alt.id}` : ''}`, 'tools_not_supported', { param: 'tools' });
  }
  const ap = agent ? agentParams(b) : null;
  if (ap && 'error' in ap) return ap.error;
  const pck = typeof b.prompt_cache_key === 'string' ? b.prompt_cache_key : '';
  const named = (req.headers.get('x-korvex-conversation') || (ext.dialect?.conversationHeader ? req.headers.get(ext.dialect.conversationHeader) : null) || b.metadata?.conversation_id || pck || '').slice(0, 200);
  const clientSession = (req.headers.get('x-session-id') || req.headers.get('x-conversation-id') || (typeof b.metadata?.session_id === 'string' ? b.metadata.session_id : '') || '').slice(0, 200);
  const conv = named || (agent ? autoConversation(b.messages, clientSession) : '');
  const parsed = agent ? toAgent(b.messages) : toChat(b.messages);
  if ('error' in parsed) return parsed.error;
  const retry = rateLimit(a.key.id, a.key.rpm);
  if (retry !== null) return oaiError(429, `Лимит ключа: ${count(a.key.rpm, W.request)} в минуту`, 'rate_limit_exceeded', { headers: { 'Retry-After': String(retry) } });
  touchKey(a.key.id);
  const tz = cleanTz(req.headers.get('x-user-timezone')) ?? resolveUserTz(a.user.id);
  const sys = parsed.system.filter((x): x is string => !!x && !!x.trim()).join('\n\n');
  const session = conv ? `api-${a.key.id.slice(0, 8)}-${sha256(`${b.user ?? ''}\u0000${conv}`).slice(0, 16)}` : `api-${a.key.id.slice(0, 8)}-${randomUUID()}`;
  let input: { messages: ChatMsg[]; session: string; agent?: AgentReq };
  if (agent && ap) {
    const out = parsed.out as OaiMsg[];
    input = { messages: [], session, agent: { ...ap, messages: sys ? [{ role: 'system', content: sys }, ...out] : out } };
    console.log(`[api] agent model=${model.id} tools=${ap.tools?.length ?? 0} msgs=${out.length} conv=${named ? 'named' : 'auto'}`);
  } else {
    const out = parsed.out as ChatMsg[];
    input = { messages: sys ? [{ role: 'system', content: sys }, ...out] : out, session };
  }
  const maint = maintenance(model.id);
  if (maint && maint.reason !== 'down') return oaiError(503, maintText(maint.retryAfter), 'service_unavailable', { type: 'server_error', headers: { 'Retry-After': String(maint.retryAfter) } });
  let jobId: string;
  try {
    jobId = submitInline({ userId: a.user.id, modelId: model.id, levelId, input, apiKeyId: a.key.id, timezone: tz }).jobId;
  } catch (e) {
    if (e instanceof TurnError) {
      if (e.code === 'model_down') return oaiError(503, e.message, 'model_unavailable', { type: 'server_error', headers: { 'Retry-After': String(maint?.retryAfter ?? 60) } });
      return oaiError(e.status === 429 ? 429 : e.status === 403 ? 403 : 400, e.message, e.status === 429 ? 'too_many_concurrent' : e.status === 403 ? 'model_forbidden' : 'invalid_request');
    }
    throw e;
  }
  const id = 'chatcmpl-' + jobId.replace(/-/g, '').slice(0, 24);
  const created = Math.floor(Date.now() / 1000);
  const convInfo = conv ? { conversation: conv, ...(named ? {} : { auto: true }) } : undefined;
  req.signal.addEventListener('abort', () => cancelJob(jobId, a.user.id), { once: true });
  const done = waitJob(jobId)!;
  const calls = new Map<number, ToolCall>();
  const addCalls = (ds: ToolCallDelta[]): Record<string, unknown>[] => ds.map((d) => {
    let c = calls.get(d.index);
    const piece = d.function?.arguments ?? '';
    if (!c) {
      c = { id: d.id || `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`, type: 'function', function: { name: d.function?.name ?? '', arguments: piece } };
      calls.set(d.index, c);
      return { index: d.index, id: c.id, type: 'function', function: { name: c.function.name, arguments: piece } };
    }
    if (d.function?.name && !c.function.name) c.function.name = d.function.name;
    c.function.arguments += piece;
    return { index: d.index, function: { ...(d.function?.name ? { name: d.function.name } : {}), arguments: piece } };
  });
  const toolCalls = () => [...calls.entries()].sort((x, y) => x[0] - y[0]).map(([, c]) => c);
  const finishFor = (r: JobResult) => (r.status === 'cancelled' ? 'stop' : calls.size && finishOf(r.finish) !== 'length' ? 'tool_calls' : finishOf(r.finish));

  if (!b.stream) {
    const offTc = agent ? jobListen(jobId, (e) => { if (e.t === 'tc') addCalls(e.d); }) : null;
    void done.then(() => offTc?.());
    const first = await Promise.race([done, new Promise<null>((r) => setTimeout(() => r(null), 60_000))]);
    const body = (r: JobResult) => {
      if (r.status === 'error') { const e = upstreamError(r.error ?? '', model.id); return { status: e.status, retryAfter: e.retryAfter, json: { error: { message: e.message, type: e.status === 503 ? 'server_error' : 'api_error', code: e.code, param: null } } }; }
      const tcs = toolCalls();
      const message = { role: 'assistant', content: tcs.length && !r.content ? null : r.content, ...(r.reasoning ? { reasoning_content: r.reasoning } : {}), ...(tcs.length ? { tool_calls: tcs } : {}) };
      return { status: 200, json: { id, object: 'chat.completion', created, model: outName, choices: [{ index: 0, message, finish_reason: finishFor(r) }], usage: usageOf(r), ...(convInfo ? { [EXTRA_KEY]: convInfo } : {}) } };
    };
    if (first) { const x = body(first) as { status: number; json: unknown; retryAfter?: number }; const res = oaiJson(x.json, x.status); if (x.retryAfter) res.headers.set('Retry-After', String(x.retryAfter)); return res; }
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(ctl) {
        const t = setInterval(() => { try { ctl.enqueue(enc.encode(' ')); } catch {  } }, 15_000);
        try { const r = await done; ctl.enqueue(enc.encode(JSON.stringify(body(r).json))); } finally { clearInterval(t); try { ctl.close(); } catch {  } }
      },
      cancel() { cancelJob(jobId, a.user.id); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
  }

  const enc = new TextEncoder();
  const includeUsage = !!b.stream_options?.include_usage;
  let off: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(ctl) {
      let closed = false;
      const write = (s: string) => { if (closed) return; try { ctl.enqueue(enc.encode(s)); } catch { closed = true; } };
      const chunk = (delta: Record<string, unknown>, finish: string | null = null, extra: Record<string, unknown> = {}) =>
        write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: outName, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
      chunk({ role: 'assistant', content: '' });
      const ka = setInterval(() => write(': keepalive\n\n'), 15_000);
      off = jobListen(jobId, (e) => {
        if (e.t === 'c') chunk({ content: e.d });
        else if (e.t === 'r') chunk({ reasoning_content: e.d });
        else if (e.t === 'tc') chunk({ tool_calls: addCalls(e.d) });
        else if (e.t === 'state' && e.status === 'queued') write(`: queued ahead=${e.ahead ?? 0}\n\n`);
        else if (e.t === 'q' && e.state === 'queued') write(`: queued ahead=${e.ahead}\n\n`);
      });
      void done.then((r) => {
        clearInterval(ka);
        off?.();
        if (r.status === 'error') {
          const e = upstreamError(r.error ?? '', model.id);
          write(`data: ${JSON.stringify({ error: { message: e.message, type: e.status === 503 ? 'server_error' : 'api_error', code: e.code, param: null, ...(e.retryAfter ? { retry_after: e.retryAfter } : {}) } })}\n\n`);
        } else {
          chunk({}, finishFor(r), convInfo ? { [EXTRA_KEY]: convInfo } : {});
          if (includeUsage) write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: outName, choices: [], usage: usageOf(r) })}\n\n`);
        }
        write('data: [DONE]\n\n');
        closed = true;
        try { ctl.close(); } catch {  }
      });
    },
    cancel() { off?.(); cancelJob(jobId, a.user.id); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' } });
}
