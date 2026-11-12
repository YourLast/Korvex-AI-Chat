import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db';
import type { GithubAccount } from '../db/schema';
import { open, seal } from './secret';
import { GhError, getUser, listRepos, webBase, type GhRepo } from './api';

type Sealed = { t: string; r?: string; exp?: number | null; rexp?: number | null };

const aad = (userId: string) => `gh:${userId}`;

export type GhStatus = {
  connected: boolean;
  kind?: string; login?: string; name?: string | null; avatarUrl?: string | null; htmlUrl?: string;
  expiresAt?: number | null; scopes?: string | null; checkedAt?: number; coAuthors?: string[]; coauthorSelf?: string;
};

export function accountOf(userId: string): GithubAccount | undefined {
  return getDb().select().from(schema.githubAccounts).where(eq(schema.githubAccounts.userId, userId)).get();
}
export const ghConnected = (userId: string) => !!accountOf(userId);

export function selfCoauthor(a: Pick<GithubAccount, 'login' | 'ghId' | 'name'>): string {
  const host = (() => { try { return new URL(webBase()).hostname; } catch { return 'github.com'; } })();
  const email = host === 'github.com' ? `${a.ghId ? `${a.ghId}+` : ''}${a.login}@users.noreply.github.com` : `${a.login}@noreply.${host}`;
  return `${a.name || a.login} <${email}>`;
}

export function status(userId: string): GhStatus {
  const a = accountOf(userId);
  if (!a) return { connected: false };
  return { connected: true, kind: a.kind, login: a.login, name: a.name, avatarUrl: a.avatarUrl, htmlUrl: `${webBase()}/${a.login}`, expiresAt: a.expiresAt, scopes: a.scopes,
    checkedAt: a.checkedAt, coAuthors: a.coAuthors ?? [], coauthorSelf: selfCoauthor(a) };
}

export async function tokenOf(userId: string): Promise<string | null> {
  const a = accountOf(userId);
  if (!a) return null;
  const s = JSON.parse(open(a.tokenEnc, aad(userId))) as Sealed;
  if (s.r && s.exp && s.exp - Date.now() < 5 * 60_000) {
    const { refreshUserToken } = await import('./oauth');
    const n = await refreshUserToken(s.r).catch(() => null);
    if (n) { store(userId, a.kind, n, a); return n.t; }
  }
  return s.t;
}

function store(userId: string, kind: string, s: Sealed, prev?: GithubAccount, info?: { login: string; ghId: number; name: string | null; avatarUrl: string | null; scopes: string | null; expiresAt: number | null }) {
  const db = getDb();
  const now = Date.now();
  const enc = seal(JSON.stringify(s), aad(userId));
  if (prev && !info) {
    db.update(schema.githubAccounts).set({ tokenEnc: enc, expiresAt: s.exp ?? prev.expiresAt, checkedAt: now }).where(eq(schema.githubAccounts.userId, userId)).run();
    return;
  }
  const row = { userId, kind, login: info!.login, ghId: info!.ghId, name: info!.name, avatarUrl: info!.avatarUrl, tokenEnc: enc, scopes: info!.scopes, expiresAt: s.exp ?? info!.expiresAt, checkedAt: now };
  db.insert(schema.githubAccounts).values({ ...row, coAuthors: prev?.coAuthors ?? [], createdAt: now })
    .onConflictDoUpdate({ target: schema.githubAccounts.userId, set: row }).run();
}

export async function connect(userId: string, token: string, kind: 'pat' | 'oauth' = 'pat', extra?: { refresh?: string; exp?: number | null; rexp?: number | null }): Promise<{ status: GhStatus; repos: GhRepo[] }> {
  const t = token.trim();
  if (!/^[A-Za-z0-9_\-.]{20,255}$/.test(t)) throw new GhError(400, 'Это не похоже на токен GitHub');
  const me = await getUser(t);
  const repos = await listRepos(t, 300);
  store(userId, kind, { t, r: extra?.refresh, exp: extra?.exp ?? me.expiresAt, rexp: extra?.rexp ?? null }, accountOf(userId), {
    login: me.user.login, ghId: me.user.id, name: me.user.name, avatarUrl: me.user.avatarUrl, scopes: me.scopes, expiresAt: extra?.exp ?? me.expiresAt,
  });
  return { status: status(userId), repos };
}

export function disconnect(userId: string): boolean {
  return getDb().delete(schema.githubAccounts).where(eq(schema.githubAccounts.userId, userId)).run().changes > 0;
}

const COAUTHOR_RE = /^[^<>\n]{1,80} <[^<>\s@]{1,64}@[^<>\s@]{1,190}>$/;
export const validCoauthor = (s: string) => COAUTHOR_RE.test(s.trim());

export function setCoAuthors(userId: string, list: string[]): string[] {
  const clean = [...new Set(list.map((s) => s.trim()).filter(Boolean))].slice(0, 10);
  const bad = clean.find((s) => !validCoauthor(s));
  if (bad) throw new GhError(400, `Соавтор пишется так: Имя <почта> (не подошло: ${bad.slice(0, 60)})`);
  getDb().update(schema.githubAccounts).set({ coAuthors: clean }).where(eq(schema.githubAccounts.userId, userId)).run();
  return clean;
}

export function coauthorTrailers(userId: string): string[] {
  const a = accountOf(userId);
  if (!a) return [];
  return [...new Set([selfCoauthor(a), ...(a.coAuthors ?? [])])].map((s) => `Co-authored-by: ${s}`);
}
