import webpush from 'web-push';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { dataDir, getDb, schema } from './db';
import { cfg } from './cfg';

type Vapid = { publicKey: string; privateKey: string; subject: string };
const g = globalThis as unknown as { __kxVapid?: Vapid };

export function vapid(): Vapid {
  if (g.__kxVapid) return g.__kxVapid;
  const file = path.join(dataDir(), 'vapid.json');
  try {
    g.__kxVapid = JSON.parse(fs.readFileSync(file, 'utf8')) as Vapid;
  } catch {
    const k = webpush.generateVAPIDKeys();
    const v: Vapid = { publicKey: k.publicKey, privateKey: k.privateKey, subject: cfg('VAPID_SUBJECT', 'mailto:admin@localhost') };
    fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    try { fs.writeFileSync(file, JSON.stringify(v), { mode: 0o600, flag: 'wx' }); } catch {  }
    g.__kxVapid = JSON.parse(fs.readFileSync(file, 'utf8')) as Vapid;
    console.log('[push] ключи VAPID созданы в data/vapid.json');
  }
  return g.__kxVapid!;
}

const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export function endpointOk(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    const extra = (process.env.KX_PUSH_ALLOW_HOSTS || '').split(',').filter(Boolean);
    if (extra.includes(u.host)) return true;
    return u.protocol === 'https:' && PUSH_HOSTS.some((r) => r.test(u.hostname));
  } catch { return false; }
}

export type SubInput = { endpoint: string; keys: { p256dh: string; auth: string } };

export function saveSub(userId: string, device: string, s: SubInput, ua: string) {
  const db = getDb();
  const old = db.select().from(schema.pushSubs).where(eq(schema.pushSubs.endpoint, s.endpoint)).get();
  const row = { userId, device, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, ua: ua.slice(0, 200), fails: 0 };
  if (old) db.update(schema.pushSubs).set(row).where(eq(schema.pushSubs.id, old.id)).run();
  else db.insert(schema.pushSubs).values({ id: randomUUID(), createdAt: Date.now(), lastOkAt: null, ...row }).run();
}
export function removeSub(userId: string, endpoint: string) {
  getDb().delete(schema.pushSubs).where(and(eq(schema.pushSubs.userId, userId), eq(schema.pushSubs.endpoint, endpoint))).run();
}
export function removeDevice(userId: string, device: string) {
  getDb().delete(schema.pushSubs).where(and(eq(schema.pushSubs.userId, userId), eq(schema.pushSubs.device, device))).run();
}
export function subsOf(userId: string) {
  return getDb().select().from(schema.pushSubs).where(eq(schema.pushSubs.userId, userId)).all();
}

export type PushPayload = { title: string; body: string; url: string; tag?: string };

type Dev = { lastActiveAt?: number | null; lastOkAt?: number | null; createdAt?: number };
export function pickDevice<S extends Dev>(subs: S[]): S | null {
  if (!subs.length) return null;
  return [...subs].sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0) || (b.lastOkAt ?? 0) - (a.lastOkAt ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
}

export async function sendPush(sub: { id: string; endpoint: string; p256dh: string; auth: string; fails: number }, p: PushPayload): Promise<'ok' | 'gone' | 'error'> {
  const v = vapid();
  const db = getDb();
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(p),
      { TTL: 3600, urgency: 'high', timeout: 10_000, vapidDetails: { subject: v.subject, publicKey: v.publicKey, privateKey: v.privateKey } });
    db.update(schema.pushSubs).set({ lastOkAt: Date.now(), fails: 0 }).where(eq(schema.pushSubs.id, sub.id)).run();
    return 'ok';
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410 || sub.fails >= 10) { db.delete(schema.pushSubs).where(eq(schema.pushSubs.id, sub.id)).run(); return 'gone'; }
    db.update(schema.pushSubs).set({ fails: sub.fails + 1 }).where(eq(schema.pushSubs.id, sub.id)).run();
    console.error(`[push] не отправлено (${code ?? (e as Error).message?.slice(0, 80)})`);
    return 'error';
  }
}

const seen = new Map<string, number>();
export function touchDevice(userId: string, device: string) {
  const k = `${userId}|${device}`;
  const now = Date.now();
  if (now - (seen.get(k) ?? 0) < 30_000) return;
  seen.set(k, now);
  try { getDb().update(schema.pushSubs).set({ lastActiveAt: now }).where(and(eq(schema.pushSubs.userId, userId), eq(schema.pushSubs.device, device))).run(); } catch {  }
}
