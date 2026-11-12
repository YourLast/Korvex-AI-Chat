import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import type { MemUpdItem } from './curator';
import { deleteMemory, listMemory, reinstateMemory, restoreMemory } from './memory';

export const undoable = (it: MemUpdItem) => !it.undone && ((it.op === 'add' && !!it.id) || (it.op === 'update' && !!it.id && !!it.prev) || (it.op === 'delete' && !!it.prev?.text));

export function undoMemUpd(userId: string, messageId: string, index?: number): { items: MemUpdItem[]; undone: number } | null {
  const db = getDb();
  const msg = db.select({ meta: schema.messages.meta }).from(schema.messages).where(eq(schema.messages.id, messageId)).get();
  const items = [...(((msg?.meta as { memUpd?: MemUpdItem[] } | null)?.memUpd) ?? [])];
  if (!items.length) return null;
  const rows = new Map(listMemory(userId).map((r) => [r.id, r]));
  let undone = 0;
  items.forEach((it, i) => {
    if (!undoable(it) || (index !== undefined && i !== index)) return;
    if (it.op === 'add' && it.id) { if (rows.has(it.id)) deleteMemory(userId, [it.id]); }
    else if (it.op === 'update' && it.id && it.prev) { if (rows.has(it.id)) restoreMemory(userId, it.id, it.prev); }
    else if (it.op === 'delete' && it.prev?.text) reinstateMemory(userId, it.prev);
    else return;
    items[i] = { ...it, undone: true };
    undone++;
  });
  if (!undone) return null;
  db.update(schema.messages).set({ meta: { ...(msg?.meta ?? {}), memUpd: items } }).where(eq(schema.messages.id, messageId)).run();
  return { items, undone };
}
