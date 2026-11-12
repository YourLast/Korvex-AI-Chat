import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { BetaContentBlockParam, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { getDb, schema } from '../db';
import type { Message } from '../db/schema';
import { MARKER } from '../turn';
import { systemPrompt, type ModelCfg } from '../models';
import { tr, type Lang } from '../i18n/core';
import { claudeImage, claudePdf, DOC_TEXT_MAX } from './media';
import { ext } from '@/ext';
import { brandText } from '../brandCore';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ThinkMode = 'adaptive' | 'between_tools';
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const isEffort = (v: unknown): v is Effort => typeof v === 'string' && (EFFORTS as readonly string[]).includes(v);

export type ClaudeRecord = {
  v: 1;
  model: string;
  mode: ThinkMode;
  top: Effort;
  effort: Effort;
  pre?: BetaMessageParam[];
  ctx?: string;
  keys?: { folder?: string; chat?: string; mem?: string };
  msgs: BetaMessageParam[];
};

export function recordOf(m: Pick<Message, 'meta'> | null | undefined): ClaudeRecord | null {
  const r = (m?.meta as { claude?: ClaudeRecord } | null)?.claude;
  return r && r.v === 1 && Array.isArray(r.msgs) && isEffort(r.top) ? r : null;
}

export function levelToClaude(model: ModelCfg, levelId: string, effort: string | null | undefined): { mode: ThinkMode; effort: Effort } {
  if (levelId === 'off' && betweenToolsOk(model)) return { mode: 'between_tools', effort: 'medium' };
  return { mode: 'adaptive', effort: isEffort(effort) ? effort : isEffort(levelId) ? levelId : 'medium' };
}
export const betweenToolsOk = (model: ModelCfg) => model.upstreamModel === 'claude-sonnet-5-5';

const hash = (s: string | null | undefined) => (s && s.trim() ? createHash('sha256').update(s).digest('hex').slice(0, 16) : '');

export function claudeSystem(model: ModelCfg, parts: { rules: string; browser: string | null; web: boolean }): string {
  const name = model.name;
  return brandText([
    ext.claudeIdentity?.(name) ?? `Ты — ${name}, модель Korvex.`,
    `Поставщика и базовую модель не называй. Если прямо спрашивают, на чём ты сделан, чья ты модель или какая нейросеть внутри, отвечай: «Это ${name} от Korvex, детали технологии не раскрываю». При этом не утверждай ложно, что ты не Claude и не модель Anthropic, — просто не раскрывай детали.`,
    'Отвечай и размышляй на языке пользователя. Пиши по делу, Markdown — когда он помогает (списки, таблицы, код).',
    'В конце сообщения пользователя может стоять блок «Контекст Korvex» — это сведения от приложения (время, инструкция папки, репозиторий, память о человеке), а не слова пользователя.',
    systemPrompt(model, null) ?? '',
    parts.rules,
    parts.web ? 'Интернет: инструмент web_search (поиск), страницу целиком — browser_open. Про то, что могло измениться после твоего обучения (новости, цены, версии, люди, законы), сначала ищи, даже если уверен; в ответе указывай источники.' : '',
    parts.browser ?? '',
    'Когда ответил на вопрос, считай ответ законченным: на следующих ходах думай о новом вопросе и не пересматривай прежние ответы, если человек сам не просит или не указывает на ошибку.',
  ].filter((x) => x && x.trim()).join('\n\n'));
}

export function nowLine(tz: string, lang: Lang, now = Date.now()): string {
  let s: string;
  try {
    s = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : lang === 'sr' ? 'sr-Latn' : 'ru-RU', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(now);
  } catch { s = new Date(now).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; tz = 'UTC'; }
  return `Сейчас: ${s} (${tz}).`;
}

type FileRow = { id: string; userId: string; name: string; mime: string; text: string | null; sha256: string | null; size: number | null };

async function userContent(m: Message, files: Map<string, FileRow>, lang: Lang, ctx: string | null | undefined): Promise<BetaContentBlockParam[]> {
  const ids = (m.meta as { fileIds?: string[] } | null)?.fileIds ?? [];
  const fs = ids.map((id) => files.get(id)).filter((f): f is FileRow => !!f);
  const out: BetaContentBlockParam[] = [];
  const notes: string[] = [];
  for (const f of fs) {
    if (f.mime.startsWith('image/')) {
      const img = await claudeImage(f);
      if (img) out.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } });
      else notes.push(`картинка «${f.name}» не найдена`);
      continue;
    }
    const text = (f.text ?? '').trim();
    if (text) {
      out.push({ type: 'document', title: f.name.slice(0, 200), source: { type: 'text', media_type: 'text/plain', data: text.length > DOC_TEXT_MAX ? text.slice(0, DOC_TEXT_MAX) + `\n…[обрезано: ещё ${text.length - DOC_TEXT_MAX} символов]` : text } });
      continue;
    }
    const pdf = claudePdf(f);
    if (pdf) out.push({ type: 'document', title: f.name.slice(0, 200), source: { type: 'base64', media_type: 'application/pdf', data: pdf } });
    else notes.push(`файл «${f.name}» без текста`);
  }
  let t = m.content.split(MARKER).join('').trim();
  if (!t) t = tr(lang, fs.length && fs.every((f) => f.mime.startsWith('image/')) ? 'srv.whatPic' : 'srv.readFile');
  if (notes.length) t += `\n\n[${notes.join('; ')}]`;
  out.push({ type: 'text', text: t });
  if (ctx && ctx.trim()) out.push({ type: 'text', text: ctx });
  return out;
}

function stripThinking(msgs: BetaMessageParam[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const m of msgs) {
    if (m.role === 'system') continue;
    if (m.role !== 'assistant' || typeof m.content === 'string') { out.push(m); continue; }
    const c = m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
    if (c.length) out.push({ ...m, content: c });
  }
  return out;
}

export type Built = {
  messages: BetaMessageParam[];
  top: Effort;
  pre: BetaMessageParam[];
  ctx: string;
  keys: NonNullable<ClaudeRecord['keys']>;
  stripped: boolean;
  effortMsgs: boolean;
};

export async function buildHistory(o: {
  hist: Message[]; userId: string; lang: Lang; mode: ThinkMode; effort: Effort; continuing: boolean; forceStrip?: boolean;
  ctxParts: { now: string; folder: string | null; chat: string | null; mem: string | null };
}): Promise<Built> {
  const db = getDb();
  const fileIds = o.hist.flatMap((m) => ((m.meta as { fileIds?: string[] } | null)?.fileIds ?? []));
  const rows = fileIds.length ? db.select({ id: schema.files.id, userId: schema.files.userId, name: schema.files.name, mime: schema.files.mime, text: schema.files.text, sha256: schema.files.sha256, size: schema.files.size })
    .from(schema.files).where(and(inArray(schema.files.id, fileIds), eq(schema.files.userId, o.userId))).all() : [];
  const files = new Map(rows.map((f) => [f.id, f as FileRow]));

  type Pair = { u: Message | null; a: Message | null; rec: ClaudeRecord | null };
  const pairs: Pair[] = [];
  for (const m of o.hist) {
    if (m.role === 'user') pairs.push({ u: m, a: null, rec: null });
    else if (m.role === 'assistant') {
      const last = pairs[pairs.length - 1];
      if (last && last.u && !last.a) { last.a = m; last.rec = recordOf(m); } else pairs.push({ u: null, a: m, rec: recordOf(m) });
    }
  }
  const recs = pairs.map((p) => p.rec).filter((r): r is ClaudeRecord => !!r && r.msgs.length > 0);
  const hadThinking = recs.some((r) => r.mode === 'adaptive' || (r.pre?.length ?? 0) > 0);
  const stripped = !!o.forceStrip || (o.mode === 'between_tools' && hadThinking);

  const top: Effort = o.mode === 'adaptive' ? (recs.find((r) => r.mode === 'adaptive')?.top ?? 'medium') : 'medium';
  let inEffect: Effort = top;
  if (!stripped) for (const r of recs) for (const p of r.pre ?? []) { const e = (p as { output_config?: { effort?: unknown } }).output_config?.effort; if (isEffort(e)) inEffect = e; }
  const pre: BetaMessageParam[] = !o.continuing && o.mode === 'adaptive' && o.effort !== inEffect ? [{ role: 'system', content: [], output_config: { effort: o.effort } }] : [];

  const seen: NonNullable<ClaudeRecord['keys']> = {};
  for (const r of recs) Object.assign(seen, r.keys ?? {});
  const keys = { folder: hash(o.ctxParts.folder), chat: hash(o.ctxParts.chat), mem: hash(o.ctxParts.mem) };
  const lines = ['[Контекст Korvex — сведения от приложения, не слова пользователя]', o.ctxParts.now];
  const changed = (k: keyof typeof keys, text: string | null, gone: string) => {
    if (keys[k] === (seen[k] ?? '')) return;
    lines.push(text && text.trim() ? text.trim() : gone);
  };
  changed('folder', o.ctxParts.folder, 'Инструкции папки у этого чата больше нет.');
  changed('chat', o.ctxParts.chat, 'Репозиторий в этом чате больше не открыт.');
  changed('mem', o.ctxParts.mem, 'Памяти о пользователе сейчас нет (выключена или пуста) — не опирайся на прежние сведения из памяти.');
  const ctx = lines.join('\n');

  const out: BetaMessageParam[] = [];
  let effortMsgs = false;
  const curUser = !o.continuing ? pairs.at(-1)?.u ?? null : null;
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const isCur = !o.continuing && i === pairs.length - 1 && !p.a;
    if (p.rec && p.rec.msgs.length) {
      const pr = stripped ? [] : p.rec.pre ?? [];
      if (pr.length) effortMsgs = true;
      out.push(...pr);
      if (p.u) out.push({ role: 'user', content: await userContent(p.u, files, o.lang, p.rec.ctx) });
      out.push(...(stripped ? stripThinking(p.rec.msgs) : p.rec.msgs));
      continue;
    }
    if (isCur && p.u === curUser && curUser) {
      if (pre.length) effortMsgs = true;
      out.push(...pre, { role: 'user', content: await userContent(curUser, files, o.lang, ctx) });
      continue;
    }
    if (p.u) out.push({ role: 'user', content: await userContent(p.u, files, o.lang, null) });
    if (p.a && p.a.content.trim()) out.push({ role: 'assistant', content: [{ type: 'text', text: p.a.content }] });
  }
  const firstUser = out.findIndex((m) => m.role === 'user');
  const lead = out.slice(0, Math.max(0, firstUser)).filter((m) => m.role === 'system' && Array.isArray(m.content) && !m.content.length);
  const messages = firstUser > 0 ? [...lead, ...out.slice(firstUser)] : firstUser < 0 ? [] : out;
  return { messages, top, pre, ctx, keys, stripped, effortMsgs };
}

export function echoContent(content: unknown[]): BetaContentBlockParam[] {
  const c = JSON.parse(JSON.stringify(content)) as { type: string }[];
  const lastFb = c.map((b) => b.type).lastIndexOf('fallback');
  const kept = lastFb < 0 ? c : c.filter((b, i) => i > lastFb || !['thinking', 'redacted_thinking', 'tool_use'].includes(b.type) || false);
  return kept as unknown as BetaContentBlockParam[];
}

export function sealRecord(msgs: BetaMessageParam[], why = 'Остановлено: ход прервался до результата инструмента.'): BetaMessageParam[] {
  const out = msgs.slice();
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    if (m.role !== 'assistant' || typeof m.content === 'string') continue;
    const uses = m.content.filter((b) => b.type === 'tool_use') as { id: string }[];
    if (!uses.length) continue;
    const next = out[i + 1];
    const have = new Set(next && next.role === 'user' && Array.isArray(next.content) ? next.content.filter((b) => b.type === 'tool_result').map((b) => (b as { tool_use_id: string }).tool_use_id) : []);
    const miss = uses.filter((u) => !have.has(u.id)).map((u) => ({ type: 'tool_result' as const, tool_use_id: u.id, is_error: true, content: why }));
    if (!miss.length) continue;
    if (next && next.role === 'user' && Array.isArray(next.content)) {
      const results = [...next.content.filter((b) => b.type === 'tool_result'), ...miss];
      const rest = next.content.filter((b) => b.type !== 'tool_result');
      out[i + 1] = { role: 'user', content: [...results, ...rest] };
    } else out.splice(i + 1, 0, { role: 'user', content: miss });
  }
  return out;
}
