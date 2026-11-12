import { hash, verify } from '@node-rs/argon2';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cookies } from 'next/headers';
import { and, eq, gt } from 'drizzle-orm';
import { dataDir, getDb, schema } from './db';
import type { User } from './db/schema';
import type { Role } from './roles';

export const COOKIE = 'kx_session';
const SESSION_DAYS = 30;
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function hashPassword(pw: string) {
  return hash(pw, ARGON);
}
let dummy: Promise<string> | null = null;
export async function verifyPassword(stored: string | null, pw: string) {
  if (!stored) {
    dummy ??= hash('korvex-dummy', ARGON);
    await verify(await dummy, pw).catch(() => false);
    return false;
  }
  return verify(stored, pw).catch(() => false);
}

export class SignupClosed extends Error {}
export class EmailTaken extends Error {}

export async function createUser(email: string, name: string, password: string, role?: Role, opts: { onlyFirst?: boolean; lang?: string; source?: 'admin' } = {}): Promise<User> {
  const db = getDb();
  const passwordHash = await hashPassword(password);
  return db.transaction((tx) => {
    const first = tx.select({ id: schema.users.id }).from(schema.users).limit(1).all().length === 0;
    if (opts.onlyFirst && !first) throw new SignupClosed('signup closed');
    const mail = email.trim().toLowerCase();
    if (tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, mail)).get()) throw new EmailTaken('email taken');
    const u = {
      id: randomUUID(),
      email: mail,
      name: name.trim() || email.split('@')[0],
      passwordHash,
      role: first ? ('admin' as const) : role ?? ('user' as const),
      disabled: 0,
      timezone: 'Europe/Moscow',
      notifyQuiet: '23:00-08:00' as string | null,
      lastTz: null as string | null,
      memoryOn: 1,
      memoryAuto: 1,
      memoryMeta: null,
      lang: opts.lang ?? '',
      blockKind: '', blockReason: '', blockedAt: null as number | null, blockedBy: null as string | null,
      weekMult: 1, weekResetAt: null as number | null, seatResetAt: null as number | null,
      source: opts.source ?? '',
      createdAt: Date.now(),
    };
    tx.insert(schema.users).values(u).run();
    return u;
  }, { behavior: 'immediate' });
}

export async function startSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  getDb().insert(schema.sessions).values({ id: sha256(token), userId, createdAt: now, expiresAt: now + SESSION_DAYS * 864e5 }).run();
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function endSession() {
  const jar = await cookies();
  const t = jar.get(COOKIE)?.value;
  if (t) getDb().delete(schema.sessions).where(eq(schema.sessions.id, sha256(t))).run();
  jar.delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const t = jar.get(COOKIE)?.value;
  if (!t) return null;
  const db = getDb();
  const row = db
    .select({ u: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha256(t)), gt(schema.sessions.expiresAt, Date.now()), eq(schema.users.disabled, 0)))
    .get();
  return row?.u ?? null;
}

export function sameOrigin(req: Request): boolean {
  const o = req.headers.get('origin');
  if (!o) return true;
  try {
    return new URL(o).host === (req.headers.get('x-forwarded-host') || req.headers.get('host'));
  } catch {
    return false;
  }
}

const fails = new Map<string, number[]>();
const WIN = 600_000, PER_PAIR = 6, WIN_IP = 900_000, PER_IP = 30, WIN_MAIL = 900_000, SOFT_MAIL = 6, MAX_DELAY = 8_000, MAX_KEYS = 20_000;
const delayStep = () => Number(process.env.KX_LOGIN_DELAY_MS) || 500;
export function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf.trim().slice(0, 64);
  const xff = (req.headers.get('x-forwarded-for') || '').split(',').map((x) => x.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1].slice(0, 64) : 'local';
}
const recent = (k: string, win: number, now: number) => (fails.get(k) ?? []).filter((t) => now - t < win);
export type LoginKeys = { pair: string; ip: string; mail: string };
export const loginKeys = (req: Request, email: string): LoginKeys => { const ip = clientIp(req); return { pair: `${ip}|${email}`, ip: `ip|${ip}`, mail: `@|${email}` }; };
export function loginBlocked(k: LoginKeys): boolean {
  const now = Date.now();
  return recent(k.pair, WIN, now).length >= PER_PAIR || recent(k.ip, WIN_IP, now).length >= PER_IP;
}
export function loginDelayMs(k: LoginKeys): number {
  const n = recent(k.mail, WIN_MAIL, Date.now()).length;
  return n < SOFT_MAIL ? 0 : Math.min(MAX_DELAY, delayStep() * (n - SOFT_MAIL + 1));
}
export function loginFailed(k: LoginKeys) {
  const now = Date.now();
  if (fails.size > MAX_KEYS) { for (const [key, v] of fails) if (!v.some((t) => now - t < WIN_MAIL)) fails.delete(key); }
  while (fails.size > MAX_KEYS) fails.delete(fails.keys().next().value as string);
  fails.set(k.pair, [...recent(k.pair, WIN, now), now]);
  fails.set(k.ip, [...recent(k.ip, WIN_IP, now), now]);
  fails.set(k.mail, [...recent(k.mail, WIN_MAIL, now), now]);
}
export function loginOk(k: LoginKeys) {
  fails.delete(k.pair);
}
export const _loginTest = { reset: () => fails.clear() };

export const DEVICE_COOKIE = 'kx_dev';
const DEVICE_DAYS = 365;
let devKey: Buffer | null = null;
export function deviceKey(): Buffer {
  if (devKey) return devKey;
  const file = path.join(dataDir(), 'device.key');
  try { devKey = fs.readFileSync(file); if (devKey.length >= 32) return devKey; } catch {  }
  fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  const k = randomBytes(32);
  try { fs.writeFileSync(file, k, { mode: 0o600, flag: 'wx' }); devKey = k; } catch { devKey = fs.readFileSync(file); }
  return devKey!;
}
const devSig = (uid: string, at: string) => createHmac('sha256', deviceKey()).update(`${uid}.${at}`).digest('base64url');
export async function deviceUser(): Promise<string | null> {
  const v = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!v) return null;
  const [uid, at, sig] = v.split('.');
  if (!uid || !at || !sig || !/^\d+$/.test(at) || Date.now() - Number(at) > DEVICE_DAYS * 864e5) return null;
  const want = Buffer.from(devSig(uid, at)), got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? uid : null;
}
export async function setDeviceCookie(userId: string) {
  const at = String(Date.now());
  (await cookies()).set(DEVICE_COOKIE, `${userId}.${at}.${devSig(userId, at)}`, {
    httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', path: '/', maxAge: DEVICE_DAYS * 86400,
  });
}

export function sessionAlive(sessionHash: string): boolean {
  const row = getDb().select({ id: schema.sessions.id }).from(schema.sessions).innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sessionHash), gt(schema.sessions.expiresAt, Date.now()), eq(schema.users.disabled, 0))).get();
  return !!row;
}
export async function currentSessionHash(): Promise<string | null> {
  const t = (await cookies()).get(COOKIE)?.value;
  return t ? sha256(t) : null;
}
