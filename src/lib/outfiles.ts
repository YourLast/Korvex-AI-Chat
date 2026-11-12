import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { dataDir, getDb, schema } from './db';
import { OUT_PREFIX } from '@/ext/client';
import { cfg } from './cfg';

export { OUT_PREFIX };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const TOKEN_RE = new RegExp(esc(OUT_PREFIX) + '([0-9a-f]{32})/', 'g');
export const CLAIM_SLACK_MS = 10_000;

export const outRoot = () => cfg('KX_OUT_DIR') || path.join(dataDir(), 'out');
export const isToken = (t: string) => /^[0-9a-f]{32}$/.test(t);

export function tokensIn(...texts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const s of texts) if (s && s.includes(OUT_PREFIX)) for (const m of s.matchAll(TOKEN_RE)) out.add(m[1]);
  return [...out];
}

export function tokenBorn(token: string, root = outRoot()): number | null {
  if (!isToken(token)) return null;
  try {
    const st = fs.lstatSync(path.join(/*turbopackIgnore: true*/ root, token));
    if (!st.isDirectory()) return null;
    return st.birthtimeMs > 0 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs;
  } catch { return null; }
}

export type ClaimOutcome = 'claimed' | 'mine' | 'taken' | 'old' | 'missing';

export function claimTokens(p: { userId: string; threadId: string | null; messageId: string | null; since: number; tokens: string[]; now?: number; root?: string }): Record<string, ClaimOutcome> {
  const db = getDb();
  const res: Record<string, ClaimOutcome> = {};
  for (const token of p.tokens) {
    if (!isToken(token)) continue;
    const row = db.select({ userId: schema.outFiles.userId }).from(schema.outFiles).where(eq(schema.outFiles.token, token)).get();
    if (row) { res[token] = row.userId === p.userId ? 'mine' : 'taken'; continue; }
    const born = tokenBorn(token, p.root);
    if (born === null) { res[token] = 'missing'; continue; }
    if (born < p.since - CLAIM_SLACK_MS) { res[token] = 'old'; continue; }
    const r = db.insert(schema.outFiles).values({ token, userId: p.userId, threadId: p.threadId, messageId: p.messageId, source: 'job', createdAt: p.now ?? Date.now() })
      .onConflictDoNothing().run();
    res[token] = r.changes ? 'claimed' : 'taken';
    if (!r.changes) {
      const again = db.select({ userId: schema.outFiles.userId }).from(schema.outFiles).where(eq(schema.outFiles.token, token)).get();
      if (again?.userId === p.userId) res[token] = 'mine';
    }
  }
  return res;
}

export function ownsToken(userId: string, token: string): boolean {
  if (!isToken(token)) return false;
  return !!getDb().select({ t: schema.outFiles.token }).from(schema.outFiles).where(and(eq(schema.outFiles.token, token), eq(schema.outFiles.userId, userId))).get();
}

export class OutClaimer {
  private done = new Set<string>();
  constructor(private p: { userId: string; threadId: string | null; messageId: string | null; since: () => number }) {}
  private claim(tokens: string[]) {
    const fresh = tokens.filter((t) => !this.done.has(t));
    if (!fresh.length) return;
    try {
      const r = claimTokens({ ...this.p, since: this.p.since(), tokens: fresh });
      for (const [t, o] of Object.entries(r)) if (o !== 'missing') this.done.add(t);
    } catch (e) { console.error('[outfiles] claim', (e as Error).message); }
  }
  chunk(text: string, from: number) {
    const tail = text.slice(Math.max(0, from - 64));
    if (tail.includes(OUT_PREFIX)) this.claim(tokensIn(tail));
  }
  finish(...texts: (string | null | undefined)[]) { this.claim(tokensIn(...texts)); }
}
