import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { FENCE_RE, KXB_LINK_RE, rateKey, type Snapshots } from './text';
import { parseBlock } from './parse';
import { LIMITS, type Block } from './schema';
import { blockFilePath, readBlockFile } from './server';
import { rateFor } from './cbr';
import type { RateView } from './rateTypes';

export const hasBlocks = (md: string) => md.includes('```korvex') || md.includes('.kxb.json');

export function fileSnapshots(userId: string, content: string): Record<string, Block> {
  const out: Record<string, Block> = {};
  if (!content.includes('.kxb.json')) return out;
  for (const m of content.matchAll(KXB_LINK_RE)) {
    const href = m[2];
    if (out[href]) continue;
    const file = blockFilePath(userId, href);
    const p = file ? readBlockFile(file) : null;
    if (p?.ok && JSON.stringify(p.block).length <= LIMITS.snapshotBytes) out[href] = p.block;
  }
  return out;
}

export function rateParams(content: string): { code: string; date?: string }[] {
  const out: { code: string; date?: string }[] = [];
  if (!content.includes('```korvex')) return out;
  for (const m of content.matchAll(FENCE_RE)) {
    const p = parseBlock(m[1].trim(), 'fence');
    if (!p.ok || p.block.type !== 'rate') continue;
    const d = p.block.data;
    if (!out.some((x) => x.code === d.code && x.date === d.date)) out.push({ code: d.code, date: d.date });
  }
  return out.slice(0, 8);
}

export async function snapshotRates(messageId: string, content: string): Promise<void> {
  const ps = rateParams(content);
  if (!ps.length) return;
  const rates: Record<string, RateView> = {};
  for (const x of ps) {
    try {
      const v = await rateFor(x.code, x.date ?? null);
      if (v.value && v.state !== 'fail') rates[rateKey(x.code, x.date)] = v;
    } catch {  }
  }
  if (!Object.keys(rates).length) return;
  const db = getDb();
  const row = db.select({ meta: schema.messages.meta }).from(schema.messages).where(eq(schema.messages.id, messageId)).get();
  if (!row) return;
  const meta = (row.meta ?? {}) as { blocks?: Snapshots | null };
  db.update(schema.messages).set({ meta: { ...meta, blocks: { ...(meta.blocks ?? {}), rates: { ...(meta.blocks?.rates ?? {}), ...rates } } } }).where(eq(schema.messages.id, messageId)).run();
}
