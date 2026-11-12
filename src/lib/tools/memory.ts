import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db';
import type { MemoryRow } from '../db/schema';
import { publish } from '../bus';
import { addMemory, askedToForget, askedToRemember, deleteMemory, isSection, listMemory, matchForget, memoryAllowed, memoryBlockFor, ruleConflict, SECTIONS, sensitiveTopic, type Section } from '../memory';
import { registerPromptPart, registerTool } from './registry';
import type { ToolCtx } from './types';

const short = (id: string) => id.slice(0, 8);
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function threadOf(id: string) {
  return getDb().select({ id: schema.threads.id, temporary: schema.threads.temporary, title: schema.threads.title }).from(schema.threads).where(eq(schema.threads.id, id)).get();
}
const allowed = (ctx: { userId: string; threadId: string }) => memoryAllowed(ctx.userId, threadOf(ctx.threadId));

function userText(ctx: ToolCtx): string {
  const db = getDb();
  const ans = ctx.messageId ? db.select({ parentId: schema.messages.parentId }).from(schema.messages).where(eq(schema.messages.id, ctx.messageId)).get() : null;
  const u = ans?.parentId ? db.select({ content: schema.messages.content, role: schema.messages.role, meta: schema.messages.meta }).from(schema.messages).where(eq(schema.messages.id, ans.parentId)).get() : null;
  if (u?.role !== 'user' || (u.meta as { from?: unknown } | null)?.from || ctx.depth >= 1) return '';
  return u.content;
}

const titles = new Map(SECTIONS.map((s) => [s.id, s.title]));
function listText(rows: MemoryRow[]): string {
  if (!rows.length) return 'Memory about the user is empty.';
  const out: string[] = [];
  for (const s of SECTIONS) {
    const items = rows.filter((r) => r.section === s.id);
    if (!items.length) continue;
    out.push(`${s.title}:`);
    for (const r of items) out.push(`- [${short(r.id)}] ${r.text}${ruleConflict(r.text) ? ' (not applied: contradicts system rules)' : ''} — ${r.origin === 'manual' ? 'added by the user in settings' : r.origin === 'asked' ? 'saved at the user\'s request' : 'learned from a chat'}, ${day(r.updatedAt)}`);
  }
  return out.join('\n');
}

registerTool<Record<string, never>>({
  name: 'memory_list',
  kind: 'memory',
  description: 'Show what Korvex remembers about the user, with ids.',
  parameters: { type: 'object', properties: {} },
  enabled: allowed,
  title: () => 'Смотрит, что помнит о тебе',
  run: async (_a, ctx) => {
    const rows = listMemory(ctx.userId);
    const shown = rows.filter((r) => !sensitiveTopic(r.text));
    ctx.emit({ title: rows.length ? `Смотрит, что помнит о тебе · ${rows.length}` : 'Смотрит, что помнит о тебе · пусто',
      detail: shown.map((r) => `${titles.get(r.section as Section)}: ${r.text}`).join('\n') + (shown.length < rows.length ? `\n…и ещё ${rows.length - shown.length} личн.` : '') || undefined });
    return { content: listText(rows) + '\nUser can view and edit memory in Settings → Memory («Настройки → Память»).' };
  },
});

registerTool<{ text: string; section?: string }>({
  name: 'memory_remember',
  kind: 'memory',
  description: 'Save a short note about the user themself for all future chats — only when they ask to remember something about themselves. Not for work data (numbers, stock, sums). One sentence; no secrets.',
  parameters: { type: 'object', properties: { text: { type: 'string' }, section: { type: 'string', enum: SECTIONS.map((s) => s.id) } }, required: ['text'] },
  enabled: allowed,
  title: (a) => (sensitiveTopic(String(a.text ?? '')) ? 'Запоминает личное' : `Запоминает: ${clip(String(a.text ?? ''), 60)}`),
  confirm: (a, ctx) => (askedToRemember(userText(ctx)) ? null : `Запомнить о вас для всех будущих чатов: «${clip(String(a.text ?? ''), 200)}»?`),
  run: async (a, ctx) => {
    const text = String(a.text ?? '');
    const section: Section = isSection(a.section) ? a.section : 'facts';
    const asked = askedToRemember(userText(ctx));
    const topic = sensitiveTopic(text);
    if (topic && !asked) {
      ctx.emit({ title: 'Не запоминает личное без прямой просьбы' });
      return { content: `Not saved: this is sensitive (${topic}); save such things only when the user explicitly asks to remember them.`, error: true };
    }
    const r = addMemory(ctx.userId, { section, text, origin: 'asked', threadId: ctx.threadId, messageId: ctx.messageId }, { allowSensitive: true });
    if (!r.ok) {
      ctx.emit({ title: r.error === 'workdata' ? 'Не запоминает рабочие данные — они в чате' : r.error === 'rules' ? 'Не запоминает: правила системы не меняются' : r.error === 'secret' ? 'Не запоминает пароли и ключи' : `Не запоминает: ${r.message.toLowerCase()}` });
      const why = r.error === 'workdata' ? 'this is work data (numbers, stock, sums, item lists) — it is already in the chat; memory is only about the user themself. Tell the user it stays in the chat; do not say «запомнил»'
        : r.error === 'rules' ? 'it contradicts the system rules (memory cannot change rules or the reply language); tell the user it will not be applied'
        : r.error === 'secret' ? 'passwords, keys and card numbers are never stored; tell the user' : r.message;
      return { content: `Not saved: ${why}.`, error: true };
    }
    publish(ctx.userId, { t: 'memory', action: r.action });
    const priv = !!sensitiveTopic(r.row.text);
    ctx.emit(priv ? { title: 'Запоминает личное' }
      : { title: `${r.action === 'updated' ? 'Обновляет память' : 'Запоминает'}: ${clip(r.row.text, 60)}`, detail: `${titles.get(r.row.section as Section)}: ${r.row.text}` });
    return { content: `${r.action === 'same' ? 'Already in memory' : r.action === 'updated' ? 'Updated memory record' : 'Saved'} [${short(r.row.id)}] (${r.row.section}): ${r.row.text}` };
  },
});

registerTool<{ ids?: string[]; about?: string }>({
  name: 'memory_forget',
  kind: 'memory',
  description: 'Delete notes about the user: ids from memory_list or about (what to forget).',
  parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, about: { type: 'string' } } },
  enabled: allowed,
  title: (a) => (a.about && !sensitiveTopic(String(a.about)) ? `Забывает: ${clip(String(a.about), 60)}` : 'Забывает записи памяти'),
  confirm: (a, ctx) => (askedToForget(userText(ctx)) ? null : `Удалить из памяти${a.about ? ` «${clip(String(a.about), 80)}»` : ' выбранные записи'}?`),
  run: async (a, ctx) => {
    const rows = listMemory(ctx.userId);
    const want = (a.ids ?? []).map((x) => String(x).replace(/[[\]\s]/g, '').toLowerCase()).filter(Boolean);
    let hit = want.length ? rows.filter((r) => want.some((w) => r.id.toLowerCase().startsWith(w))) : [];
    if (!hit.length && a.about) hit = matchForget(rows, String(a.about));
    if (!hit.length) {
      ctx.emit({ title: 'Ищет, что забыть, — не находит' });
      return { content: `Nothing matched. Current memory:\n${listText(rows)}\nCall memory_forget again with ids.`, error: true };
    }
    deleteMemory(ctx.userId, hit.map((r) => r.id));
    publish(ctx.userId, { t: 'memory', action: 'deleted' });
    const pub = hit.filter((r) => !sensitiveTopic(r.text));
    ctx.emit({ title: pub.length ? `Забывает: ${clip(pub.map((r) => r.text).join('; '), 70)}` : 'Забывает личное', detail: pub.map((r) => r.text).join('\n') || undefined });
    return { content: `Deleted ${hit.length}: ${hit.map((r) => `[${short(r.id)}] ${r.text}`).join('; ')}` };
  },
});

registerPromptPart((ctx) => (ctx.kind === 'chat' || ctx.kind === 'automation' ? memoryBlockFor(ctx.userId, threadOf(ctx.threadId)) : null), 'user');

export {};
