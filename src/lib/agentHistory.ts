import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from './db';
import type { Message } from './db/schema';
import { systemPrompt, type ModelCfg } from './models';
import { agentRules } from './agentLoop';
import { promptPartsScoped } from './tools/registry';
import type { ToolCtx } from './tools/types';

const rulesLang = (userId: string | null | undefined): 'ru' | 'en' => (userLang(userId) === 'ru' ? 'ru' : 'en');
type PCtx = Pick<ToolCtx, 'userId' | 'threadId' | 'folderId' | 'kind' | 'modelId' | 'depth'>;
import { MARKER } from './turn';
import type { ChatMsg, OaiMsg } from './upstream';
import { ext } from '@/ext';
import { PLAIN_DIALECT } from './dialect';
import { userLang } from './userLang';

const REPLAY_TURNS = 2;
const META_TOOL_MAX = 4000;

export function folderInstruction(folderId: string | null, userId: string): string | null {
  if (!folderId) return null;
  const f = getDb().select().from(schema.folders).where(and(eq(schema.folders.id, folderId), eq(schema.folders.userId, userId))).get();
  if (!f || !f.instruction.trim()) return null;
  return `Инструкция папки «${f.name}» (общая для всех чатов этой папки):\n${f.instruction.trim()}`;
}

export function composeSystem(o: { model: ModelCfg; tz: string | null; rules: string | null; folderSys: string | null; pctx?: PCtx }): string {
  const sc = o.pctx ? promptPartsScoped(o.pctx) : { shared: [] as string[], chat: [] as string[], user: [] as string[] };
  return [systemPrompt(o.model, o.tz), o.rules, ...sc.shared, o.folderSys, ...sc.chat, ...sc.user].filter((x): x is string => !!x && !!x.trim()).join('\n\n');
}

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n) + `\n…[обрезано: ещё ${s.length - n} символов]`);

export function transcriptForMeta(t: OaiMsg[]): OaiMsg[] {
  return t.map((m) => (typeof m.content === 'string' && m.content.length > META_TOOL_MAX ? { ...m, content: clip(m.content, META_TOOL_MAX) } : m));
}

export function agentHistory(hist: Message[], model: ModelCfg, userId: string, tz: string | null, folderSys: string | null, work: boolean, pctx?: PCtx): OaiMsg[] {
  const fileIds = hist.flatMap((m) => ((m.meta as { fileIds?: string[] } | null)?.fileIds ?? []));
  const rows = fileIds.length ? getDb().select({ id: schema.files.id, name: schema.files.name, mime: schema.files.mime }).from(schema.files)
    .where(and(inArray(schema.files.id, fileIds), eq(schema.files.userId, userId))).all() : [];
  const byId = new Map(rows.map((f) => [f.id, f]));
  const sys = composeSystem({ model, tz, rules: agentRules(work, rulesLang(userId)), folderSys, pctx });
  const out: OaiMsg[] = sys ? [{ role: 'system', content: sys }] : [];
  const assistants = hist.filter((m) => m.role === 'assistant' && m.content.trim()).map((m) => m.id);
  const replay = new Set(assistants.slice(-REPLAY_TURNS));
  for (const m of hist) {
    if (m.role === 'user') {
      let c = m.content.split(MARKER).join('');
      const ids = (m.meta as { fileIds?: string[] } | null)?.fileIds ?? [];
      const fs = ids.map((id) => byId.get(id)).filter((f): f is NonNullable<typeof f> => !!f);
      const docs = fs.filter((f) => !f.mime.startsWith('image/')).map((f) => f.name);
      const imgs = fs.filter((f) => f.mime.startsWith('image/')).map((f) => f.name);
      const en = rulesLang(userId) === 'en';
      const note = [docs.length ? `${en ? 'files' : 'файлы'}: ${docs.join(', ')}` : '', imgs.length ? `${en ? 'images' : 'картинки'}: ${imgs.join(', ')}` : ''].filter(Boolean).join('; ');
      if (note && en) c = `${c.trim() || 'Look at the attachment.'}\n\n[Attached to the message: ${note}.${work && (ext.dialect ?? PLAIN_DIALECT).workTool ? ` ${(ext.dialect ?? PLAIN_DIALECT).workTool!.name} reads their contents.` : ''}]`;
      else if (note) c = `${c.trim() || 'Посмотри приложенное.'}\n\n[К сообщению приложены ${note}.${work && (ext.dialect ?? PLAIN_DIALECT).workTool ? ` Их содержимое читает ${(ext.dialect ?? PLAIN_DIALECT).workTool!.name}.` : ''}]`;
      out.push({ role: 'user', content: c });
      continue;
    }
    if (!m.content.trim()) continue;
    const ag = (m.meta as { agent?: { transcript?: OaiMsg[] } } | null)?.agent;
    if (ag?.transcript?.length && replay.has(m.id)) {
      for (const x of ag.transcript) {
        if (x.role === 'assistant' && Array.isArray(x.tool_calls)) out.push({ role: 'assistant', content: '', tool_calls: x.tool_calls });
        else if (x.role === 'tool') out.push({ role: 'tool', tool_call_id: x.tool_call_id, content: typeof x.content === 'string' ? clip(x.content, 2000) : '' });
        else if (x.role === 'user') out.push({ role: 'user', content: x.content });
      }
    }
    out.push({ role: 'assistant', content: clip(m.content, 12_000) });
  }
  return out;
}

export function chatToOai(msgs: ChatMsg[], pctx?: PCtx, sys?: { model: ModelCfg; tz: string | null; folderSys: string | null }): OaiMsg[] {
  const sys0 = msgs[0]?.role === 'system' && typeof msgs[0].content === 'string' ? msgs[0].content : '';
  const out: OaiMsg[] = msgs.map((m) => {
    if (typeof m.content === 'string') return { role: m.role, content: m.content };
    return { role: m.role, content: m.content.map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.image.toString('base64')}` } })) };
  });
  if (sys && sys0) {
    out[0] = { role: 'system', content: composeSystem({ model: sys.model, tz: sys.tz, rules: agentRules(false, rulesLang(pctx?.userId)), folderSys: sys.folderSys, pctx }) };
    return out;
  }
  const sc = pctx ? promptPartsScoped(pctx) : null;
  const rules = [agentRules(false, rulesLang(pctx?.userId)), ...(sc ? [...sc.shared, ...sc.chat, ...sc.user].filter((p) => !sys0.includes(p)) : [])].join('\n\n');
  if (out[0]?.role === 'system' && typeof out[0].content === 'string') out[0] = { role: 'system', content: `${out[0].content}\n\n${rules}` };
  else out.unshift({ role: 'system', content: rules });
  return out;
}

export function withExtra(msgs: ChatMsg[], extra: string): ChatMsg[] {
  if (!extra.trim()) return msgs;
  const i = msgs.map((m) => m.role).lastIndexOf('user');
  if (i < 0) return msgs;
  const m = msgs[i];
  const c = typeof m.content === 'string' ? `${m.content}\n\n${extra}`
    : (() => { const parts = [...m.content]; const t = parts.findIndex((p) => p.type === 'text'); if (t >= 0) parts[t] = { type: 'text', text: `${(parts[t] as { text: string }).text}\n\n${extra}` }; else parts.unshift({ type: 'text', text: extra }); return parts; })();
  return [...msgs.slice(0, i), { ...m, content: c }, ...msgs.slice(i + 1)];
}
