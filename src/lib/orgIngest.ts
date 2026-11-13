import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { cfg } from './cfg';
import { storeUpload, type StoreOut } from './storeUpload';

export const ORG_DAY_LIMIT = 500;
export const ingestOn = () => process.env.KX_ORG_INGEST !== '0';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
const rnd = (n: number, abc = ALNUM) => { const b = randomBytes(n); return [...b].map((x) => abc[x % abc.length]).join(''); };

type Inbox = typeof schema.orgInbox.$inferSelect;

export function inboxOf(userId: string, folderId: string): Inbox {
  const db = getDb();
  const cur = db.select().from(schema.orgInbox).where(eq(schema.orgInbox.folderId, folderId)).get();
  if (cur) return cur;
  const now = Date.now();
  const row: Inbox = { folderId, userId, tag: rnd(12), senders: [], keyHash: null, keyHint: null, createdAt: now, updatedAt: now };
  db.insert(schema.orgInbox).values(row).run();
  return row;
}

export function mailAddress(tag: string): string | null {
  const base = cfg('KX_ORG_MAIL').trim();
  const m = /^([^@\s+]+)@([^@\s]+)$/.exec(base);
  return m ? `${m[1]}+${tag}@${m[2]}` : null;
}

export function inboxView(userId: string, folderId: string) {
  const r = inboxOf(userId, folderId);
  return { address: mailAddress(r.tag), tag: r.tag, senders: r.senders, hasKey: !!r.keyHash, keyHint: r.keyHint, on: ingestOn() };
}

const LOCAL_RE = /^[a-z0-9_%+=-]+(?:\.[a-z0-9_%+=-]+)*$/;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/;
export const domainOk = (d: string): boolean => d.length <= 253 && DOMAIN_RE.test(d);
export function bareAddress(v: string): { addr: string; local: string; domain: string } | null {
  const s = v.trim().toLowerCase();
  const at = s.indexOf('@');
  if (at <= 0 || at !== s.lastIndexOf('@') || s.length > 254) return null;
  const local = s.slice(0, at), domain = s.slice(at + 1);
  if (local.length > 64 || !LOCAL_RE.test(local) || !domainOk(domain)) return null;
  return { addr: `${local}@${domain}`, local, domain };
}

export function cleanSenders(list: string[]): string[] {
  const out = new Set<string>();
  for (const x of list) {
    const s = x.trim().toLowerCase();
    if (s.startsWith('@') ? domainOk(s.slice(1)) : !!bareAddress(s)) out.add(s);
  }
  return [...out].slice(0, 50);
}
export function senderAllowed(senders: string[], sender: string): boolean {
  const a = bareAddress(sender);
  if (!a) return false;
  return senders.some((x) => x === a.addr || x === `@${a.domain}`);
}

export function setSenders(userId: string, folderId: string, list: string[]) {
  inboxOf(userId, folderId);
  getDb().update(schema.orgInbox).set({ senders: cleanSenders(list), updatedAt: Date.now() }).where(eq(schema.orgInbox.folderId, folderId)).run();
}
export function reissueTag(userId: string, folderId: string) {
  inboxOf(userId, folderId);
  getDb().update(schema.orgInbox).set({ tag: rnd(12), updatedAt: Date.now() }).where(eq(schema.orgInbox.folderId, folderId)).run();
}
export function issueKey(userId: string, folderId: string): string {
  inboxOf(userId, folderId);
  const key = `kxo_${rnd(32, ALNUM + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')}`;
  getDb().update(schema.orgInbox).set({ keyHash: sha(key), keyHint: key.slice(-4), updatedAt: Date.now() }).where(eq(schema.orgInbox.folderId, folderId)).run();
  return key;
}
export function revokeKey(userId: string, folderId: string) {
  inboxOf(userId, folderId);
  getDb().update(schema.orgInbox).set({ keyHash: null, keyHint: null, updatedAt: Date.now() }).where(eq(schema.orgInbox.folderId, folderId)).run();
}

export const inboxByKey = (key: string): Inbox | null => (key.startsWith('kxo_') ? getDb().select().from(schema.orgInbox).where(eq(schema.orgInbox.keyHash, sha(key))).get() ?? null : null);
export const inboxByTag = (tag: string): Inbox | null => (/^[a-z0-9]{12}$/i.test(tag) ? getDb().select().from(schema.orgInbox).where(eq(schema.orgInbox.tag, tag.toLowerCase())).get() ?? null : null);

export function collectorOk(key: string | null): boolean {
  const want = (process.env.KX_COLLECTOR_KEY_SHA256 ?? '').trim().toLowerCase();
  if (!want || !key) return false;
  const a = Buffer.from(sha(key)), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

const LOOP = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;
export function viaProxy(h: Headers): boolean {
  if (h.get('cf-connecting-ip') || h.get('cf-ray')) return true;
  const ips = [...(h.get('x-forwarded-for') ?? '').split(','), h.get('x-real-ip') ?? ''].map((x) => x.trim()).filter(Boolean);
  return ips.some((ip) => !LOOP.test(ip));
}

export function acceptedToday(folderId: string, now = Date.now()): number {
  const day = now - (now % 864e5);
  return getDb().select({ n: sql<number>`count(*)` }).from(schema.files)
    .where(and(eq(schema.files.folderId, folderId), gte(schema.files.createdAt, day), sql`json_extract(${schema.files.info}, '$.ingest.via') is not null`)).get()?.n ?? 0;
}

export function mailDuplicate(folderId: string, messageId: string, name: string) {
  return getDb().select({ id: schema.files.id, docType: schema.files.docType }).from(schema.files)
    .where(and(eq(schema.files.folderId, folderId), eq(schema.files.name, name), sql`json_extract(${schema.files.info}, '$.mail.messageId') = ${messageId}`)).get() ?? null;
}

export function ingestToOrg(p: { userId: string; folderId: string; name: string; buf: Buffer; mime?: string; via: 'key' | 'mail'; mail?: { messageId: string; sender: string } }): Promise<StoreOut> {
  const name = (p.name.split(/[\\/]/).pop() || 'document').slice(0, 200);
  return storeUpload({ userId: p.userId, folderId: p.folderId, name, buf: p.buf, mime: p.mime, extraInfo: { ingest: { via: p.via, at: Date.now() }, ...(p.mail ? { mail: p.mail } : {}) } });
}
