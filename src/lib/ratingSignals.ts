import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { publish } from './bus';
import { addMemory, memoryAllowed, memoryMeta, memoryPrefs, onlyByWord, setMemoryMeta } from './memory';
import { considerSignal, type MemUpdItem } from './curator';
import { reasonLabel, type RatingView } from './rating';

export const MANNER_NOW = new Set(['long']);
export const TO_CURATOR = new Set(['format']);
export const RECHECK = new Set(['wrong', 'misread']);
export const SHORTER = 'Просит отвечать короче';

function annotate(userId: string, threadId: string, messageId: string, item: MemUpdItem) {
  const db = getDb();
  const m = db.select({ meta: schema.messages.meta }).from(schema.messages).where(eq(schema.messages.id, messageId)).get();
  if (!m) return;
  const items = [...((m.meta as { memUpd?: MemUpdItem[] } | null)?.memUpd ?? []), item];
  db.update(schema.messages).set({ meta: { ...(m.meta ?? {}), memUpd: items } }).where(eq(schema.messages.id, messageId)).run();
  publish(userId, { t: 'memupd', th: threadId, m: messageId, items });
}

export function onRating(userId: string, messageId: string, r: RatingView | null, now = Date.now()): string[] {
  const db = getDb();
  const msg = db.select({ th: schema.messages.threadId, role: schema.messages.role, meta: schema.messages.meta }).from(schema.messages).where(eq(schema.messages.id, messageId)).get();
  if (!msg || msg.role !== 'assistant' || !r) return [];
  console.log(`[rating] v=${r.value} reasons=${r.reasons.join(',') || '-'} comment=${r.comment.trim() ? 1 : 0}`);
  const th = db.select({ id: schema.threads.id, temporary: schema.threads.temporary }).from(schema.threads).where(eq(schema.threads.id, msg.th)).get();
  if (!th || th.temporary || !memoryAllowed(userId, th) || !memoryPrefs(userId).auto) return [];
  const did: string[] = [];
  if (r.value === -1) {
    if (r.reasons.some((x) => MANNER_NOW.has(x))) {
      const w = addMemory(userId, { section: 'style', text: SHORTER, origin: 'auto', sure: false, threadId: msg.th, messageId });
      if (w.ok && w.action !== 'same') { annotate(userId, msg.th, messageId, { op: 'add', text: w.row.text, id: w.row.id, maybe: w.row.sure === 0, section: w.row.section }); did.push('shorter'); }
    }
    if (r.reasons.some((x) => TO_CURATOR.has(x)) || (r.comment.trim() && !r.reasons.some((x) => RECHECK.has(x)))) {
      const want = [r.reasons.length ? `отметки: ${r.reasons.map(reasonLabel).join(', ')}` : '', r.comment.trim()].filter(Boolean).join('; ');
      if (considerSignal(userId, msg.th, messageId, 'thumbsdown', { want, delayMs: 0 })) did.push('signal');
    }
    const re = r.reasons.find((x) => RECHECK.has(x));
    if (re) { db.run(sql`update messages set meta = json_set(coalesce(meta, '{}'), '$.recheck', ${re}) where id = ${messageId}`); did.push('recheck'); }
  }
  if (r.value === 1) {
    const ids = ((msg.meta as { guesses?: { id: string }[] } | null)?.guesses ?? []).map((g) => g.id);
    if (ids.length) {
      const likes = { ...(memoryMeta(userId).likes ?? {}) };
      for (const id of ids) {
        const row = db.select().from(schema.userMemory).where(eq(schema.userMemory.id, id)).get();
        if (!row || row.userId !== userId || row.sure !== 0) continue;
        likes[id] = (likes[id] ?? 0) + 1;
        const sure = likes[id] >= 2 && !onlyByWord(row.text) ? 1 : 0;
        db.update(schema.userMemory).set({ updatedAt: now, sure }).where(eq(schema.userMemory.id, id)).run();
        did.push(sure ? 'confirmed' : 'liked');
      }
      setMemoryMeta(userId, { likes: Object.fromEntries(Object.entries(likes).slice(-200)) });
    }
  }
  return did;
}
