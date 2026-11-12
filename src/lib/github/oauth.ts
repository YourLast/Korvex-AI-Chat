import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { webBase } from './api';

type Pending = { userId: string; exp: number; back: string };
const g = globalThis as unknown as { __kxOauth?: Map<string, Pending> };
const pending = () => (g.__kxOauth ??= new Map());
const h = (s: string) => createHash('sha256').update(s).digest('hex');

function secret(): string | null {
  const f = process.env.GITHUB_OAUTH_CLIENT_SECRET_FILE;
  if (f) { try { return fs.readFileSync(f, 'utf8').trim() || null; } catch { return null; } }
  return process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim() || null;
}

export function oauthConfig(): { clientId: string; kind: 'oauth_app' | 'app' } | null {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
  if (!clientId || !secret()) return null;
  return { clientId, kind: process.env.GITHUB_OAUTH_KIND === 'app' ? 'app' : 'oauth_app' };
}

export function redirectUri(origin: string): string {
  return `${(process.env.KORVEX_PUBLIC_URL || origin).replace(/\/+$/, '')}/api/github/oauth/callback`;
}

export function authorizeUrl(userId: string, origin: string, back = '/settings#github'): string | null {
  const c = oauthConfig();
  if (!c) return null;
  const now = Date.now();
  for (const [k, v] of pending()) if (v.exp < now) pending().delete(k);
  const state = randomBytes(24).toString('base64url');
  pending().set(h(state), { userId, exp: now + 10 * 60_000, back: back.startsWith('/') && !back.startsWith('//') ? back : '/settings#github' });
  const q = new URLSearchParams({ client_id: c.clientId, redirect_uri: redirectUri(origin), state, allow_signup: 'false' });
  if (c.kind === 'oauth_app') q.set('scope', 'repo read:user');
  return `${webBase()}/login/oauth/authorize?${q}`;
}

export function takeState(state: string, userId: string): { back: string } | null {
  const k = h(state);
  const p = pending().get(k);
  pending().delete(k);
  if (!p || p.userId !== userId || p.exp < Date.now()) return null;
  return { back: p.back };
}

type TokenRes = { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; error?: string; error_description?: string };

async function tokenCall(body: Record<string, string>): Promise<{ t: string; r?: string; exp: number | null; rexp: number | null }> {
  const c = oauthConfig();
  const s = secret();
  if (!c || !s) throw new Error('Вход через GitHub не настроен');
  const r = await fetch(`${webBase()}/login/oauth/access_token`, {
    method: 'POST', signal: AbortSignal.timeout(20_000),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Korvex-AI' },
    body: JSON.stringify({ client_id: c.clientId, client_secret: s, ...body }),
  });
  const j = (await r.json().catch(() => ({}))) as TokenRes;
  if (!r.ok || !j.access_token) throw new Error(`GitHub не выдал токен: ${(j.error_description || j.error || r.status).toString().slice(0, 200)}`);
  const now = Date.now();
  return { t: j.access_token, r: j.refresh_token, exp: j.expires_in ? now + j.expires_in * 1000 : null, rexp: j.refresh_token_expires_in ? now + j.refresh_token_expires_in * 1000 : null };
}

export function exchangeCode(code: string, origin: string) {
  return tokenCall({ code, redirect_uri: redirectUri(origin) });
}

export async function refreshUserToken(refresh: string): Promise<{ t: string; r?: string; exp: number | null; rexp: number | null }> {
  return tokenCall({ grant_type: 'refresh_token', refresh_token: refresh });
}
