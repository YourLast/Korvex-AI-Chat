
export type GhUser = { id: number; login: string; name: string | null; avatarUrl: string | null; htmlUrl: string };
export type GhRepo = { fullName: string; private: boolean; defaultBranch: string; description: string | null; htmlUrl: string; push: boolean; updatedAt: string | null; fork: boolean; archived: boolean };
export type GhBranch = { name: string; sha: string; protected: boolean };
export type GhPull = { number: number; htmlUrl: string; state: string; head: string; base: string; title: string; draft: boolean };

export const apiBase = () => (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
export const webBase = () => (process.env.GITHUB_WEB_URL || 'https://github.com').replace(/\/+$/, '');
export const cloneUrl = (repo: string) => `${process.env.GITHUB_GIT_URL?.replace(/\/+$/, '') || webBase()}/${repo}.git`;
export const isGitHubCom = () => apiBase() === 'https://api.github.com';

export function newTokenUrl(): string {
  if (!isGitHubCom()) return `${webBase()}/user/settings/applications`;
  const q = new URLSearchParams({ name: 'Korvex AI', description: 'Облачный агент-программист Korvex: клон, ветка, коммит, pull request', expires_in: '90', contents: 'write', pull_requests: 'write', metadata: 'read' });
  return `${webBase()}/settings/personal-access-tokens/new?${q}`;
}

export class GhError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
export const validRepo = (s: string) => REPO_RE.test(s) && !s.includes('..');
const BRANCH_RE = /^(?!\/|.*\/\/|.*\.\.|.*@\{|.*\.lock$|.*\/$|-)[A-Za-z0-9._\/-]{1,200}$/;
export const validBranch = (s: string) => BRANCH_RE.test(s);

type Res<T> = { data: T; headers: Headers };

export async function gh<T = unknown>(token: string, method: string, p: string, body?: unknown, signal?: AbortSignal): Promise<Res<T>> {
  let r: Response;
  try {
    r = await fetch(apiBase() + p, {
      method,
      signal: signal ?? AbortSignal.timeout(30_000),
      headers: {
        Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Korvex-AI',
        Authorization: `token ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new GhError(0, `GitHub не отвечает: ${(e as Error).name === 'TimeoutError' ? 'таймаут' : 'нет соединения'}`);
  }
  const text = await r.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!r.ok) {
    const msg = (data as { message?: string; errors?: { message?: string }[] } | null);
    const detail = [msg?.message, ...(msg?.errors ?? []).map((e) => e?.message)].filter(Boolean).join('; ').slice(0, 300);
    const human = r.status === 401 ? 'GitHub не принял токен (неверный, отозван или истёк)'
      : r.status === 403 ? `GitHub отказал в доступе${detail ? `: ${detail}` : ''} — проверьте права токена`
      : r.status === 404 ? 'Не найдено (или у токена нет доступа к этому репозиторию)'
      : `GitHub: ${r.status}${detail ? ` — ${detail}` : ''}`;
    throw new GhError(r.status, human);
  }
  return { data: data as T, headers: r.headers };
}

type RawUser = { id: number; login: string; name?: string | null; full_name?: string | null; avatar_url?: string | null; html_url?: string };
export async function getUser(token: string): Promise<{ user: GhUser; scopes: string | null; expiresAt: number | null }> {
  const { data, headers } = await gh<RawUser>(token, 'GET', '/user');
  const exp = headers.get('github-authentication-token-expiration');
  const t = exp ? Date.parse(exp.replace(' UTC', 'Z').replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2')) : NaN;
  return {
    user: { id: data.id, login: data.login, name: data.name || data.full_name || null, avatarUrl: data.avatar_url ?? null, htmlUrl: data.html_url || `${webBase()}/${data.login}` },
    scopes: headers.get('x-oauth-scopes'),
    expiresAt: Number.isFinite(t) ? t : null,
  };
}

type RawRepo = { full_name: string; private: boolean; default_branch?: string; description?: string | null; html_url: string; permissions?: { push?: boolean }; updated_at?: string; pushed_at?: string; fork?: boolean; archived?: boolean };
const toRepo = (r: RawRepo): GhRepo => ({ fullName: r.full_name, private: !!r.private, defaultBranch: r.default_branch || 'main', description: r.description ?? null, htmlUrl: r.html_url,
  push: r.permissions?.push !== false, updatedAt: r.pushed_at ?? r.updated_at ?? null, fork: !!r.fork, archived: !!r.archived });

export async function listRepos(token: string, max = 300): Promise<GhRepo[]> {
  const out: GhRepo[] = [];
  for (let page = 1; out.length < max && page <= 10; page++) {
    const { data } = await gh<RawRepo[]>(token, 'GET', `/user/repos?per_page=100&limit=50&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`);
    if (!Array.isArray(data) || !data.length) break;
    out.push(...data.map(toRepo));
    if (data.length < 50) break;
  }
  return out.slice(0, max);
}

export async function getRepo(token: string, repo: string): Promise<GhRepo> {
  if (!validRepo(repo)) throw new GhError(400, 'Неверное имя репозитория (нужно владелец/имя)');
  return toRepo((await gh<RawRepo>(token, 'GET', `/repos/${repo}`)).data);
}

type RawBranch = { name: string; commit?: { sha?: string; id?: string }; protected?: boolean };
export async function listBranches(token: string, repo: string): Promise<GhBranch[]> {
  if (!validRepo(repo)) throw new GhError(400, 'Неверное имя репозитория');
  const out: GhBranch[] = [];
  for (let page = 1; page <= 5; page++) {
    const { data } = await gh<RawBranch[]>(token, 'GET', `/repos/${repo}/branches?per_page=100&limit=50&page=${page}`);
    if (!Array.isArray(data) || !data.length) break;
    out.push(...data.map((b) => ({ name: b.name, sha: b.commit?.sha ?? b.commit?.id ?? '', protected: !!b.protected })));
    if (data.length < 50) break;
  }
  return out;
}

type RawPull = { number: number; html_url: string; state: string; title: string; draft?: boolean; head?: { ref?: string; label?: string }; base?: { ref?: string } };
const toPull = (p: RawPull): GhPull => ({ number: p.number, htmlUrl: p.html_url, state: p.state, title: p.title, draft: !!p.draft, head: p.head?.ref ?? '', base: p.base?.ref ?? '' });

export async function findPull(token: string, repo: string, head: string): Promise<GhPull | null> {
  const owner = repo.split('/')[0];
  const { data } = await gh<RawPull[]>(token, 'GET', `/repos/${repo}/pulls?state=open&per_page=100&limit=50&head=${encodeURIComponent(`${owner}:${head}`)}`);
  const hit = (Array.isArray(data) ? data : []).find((p) => p.head?.ref === head);
  return hit ? toPull(hit) : null;
}

export async function createPull(token: string, repo: string, p: { title: string; body: string; head: string; base: string; draft?: boolean }): Promise<GhPull> {
  const { data } = await gh<RawPull>(token, 'POST', `/repos/${repo}/pulls`, { title: p.title, body: p.body, head: p.head, base: p.base, draft: !!p.draft });
  return toPull(data);
}
