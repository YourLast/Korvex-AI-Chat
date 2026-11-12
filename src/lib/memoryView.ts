import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from './db';
import { listMemory, memoryPrefs, profileName, ruleConflict, sweepMaybe, type Prefs } from './memory';

export type MemoryItem = { id: string; section: string; key: string | null; text: string; origin: string; sure: boolean; createdAt: number; updatedAt: number;
  chat: { id: string; title: string; href: string } | null; blocked: string | null };
export type MemoryState = { prefs: Prefs; items: MemoryItem[]; callName: { value: string; fromProfile: boolean; id: string | null } };

export const nameOf = (text: string) => text.replace(/^(зовут|имя|обращаться|называть|my name is|name|call me|zovem se|ime)\s*[:—-]?\s*/iu, '').replace(/^[«"]|[»"]$/g, '').trim();

export function memoryState(userId: string): MemoryState {
  sweepMaybe(userId);
  const rows = listMemory(userId);
  const ids = [...new Set(rows.map((r) => r.threadId).filter((x): x is string => !!x))];
  const ths = ids.length ? getDb().select({ id: schema.threads.id, title: schema.threads.title, groupId: schema.threads.groupId, temporary: schema.threads.temporary }).from(schema.threads)
    .where(and(inArray(schema.threads.id, ids), eq(schema.threads.userId, userId))).all() : [];
  const byId = new Map(ths.map((t) => [t.id, t]));
  const nameRow = rows.find((r) => r.key === 'name');
  const prof = nameRow ? null : profileName(userId);
  return {
    prefs: memoryPrefs(userId),
    callName: nameRow ? { value: nameOf(nameRow.text), fromProfile: false, id: nameRow.id } : { value: prof ?? '', fromProfile: !!prof, id: null },
    items: rows.map((r) => {
      const t = r.threadId ? byId.get(r.threadId) : undefined;
      const chat = t ? (t.temporary === 2 ? { id: t.id, title: t.title, href: '/settings/memory' } : { id: t.id, title: t.title, href: t.groupId ? `/g/${t.groupId}` : `/c/${t.id}${r.messageId ? `#m-${r.messageId}` : ''}` }) : null;
      return { id: r.id, section: r.section, key: r.key, text: r.text, origin: r.origin, sure: r.sure !== 0, createdAt: r.createdAt, updatedAt: r.updatedAt, chat, blocked: ruleConflict(r.text) };
    }),
  };
}
