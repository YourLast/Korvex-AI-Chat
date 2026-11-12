import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isValidElement, type ReactElement } from 'react';
import { eq } from 'drizzle-orm';
import { tmpData } from './helpers';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (n: string) => { jar.delete(n); },
  }),
  headers: async () => new Headers(),
}));
const redirect = vi.fn((to: string) => { throw new Error(`redirect:${to}`); });
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), redirect: (to: string) => redirect(to), useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => '/' }));

tmpData();
process.env.KX_BROWSER = '0';
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const tok: Record<string, string> = {};
const T0 = Date.now();

beforeAll(async () => {
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  const mk = (id: string, role: 'user' | 'alpha' | 'admin') => {
    db.insert(schema.users).values({ id, email: `${id}@t.rs`, name: `Имя ${id}`, passwordHash: 'x', role, createdAt: T0 }).run();
    tok[id] = randomBytes(32).toString('base64url');
    db.insert(schema.sessions).values({ id: sha(tok[id]), userId: id, createdAt: T0, expiresAt: T0 + 864e5 }).run();
  };
  mk('adm', 'admin'); mk('adm2', 'admin'); mk('al', 'alpha'); mk('us', 'user'); mk('us2', 'user'); mk('us3', 'user');
  for (const u of ['al', 'us']) {
    db.insert(schema.threads).values({ id: `t-${u}`, userId: u, title: 'Чат', modelId: 'alpha', effort: 'low', createdAt: T0, updatedAt: T0 }).run();
    db.insert(schema.githubAccounts).values({ userId: u, login: `gh-${u}`, tokenEnc: 'x', createdAt: T0, checkedAt: T0 }).run();
    db.insert(schema.codeSessions).values({ threadId: `t-${u}`, userId: u, repo: `o/${u}`, baseBranch: 'main', status: 'ready', origin: 'code', createdAt: T0, updatedAt: T0 }).run();
  }
});
afterAll(() => { jar.clear(); });

const as = (id: string | null) => { jar.clear(); if (id) jar.set('kx_session', tok[id]); };
const rq = (url: string, method = 'GET', body?: unknown) => new Request(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json', Host: 'localhost' }, body: body === undefined ? undefined : JSON.stringify(body) });

type Mod = Record<string, unknown>;
const ROUTES: [string, () => Promise<Mod>, Record<string, string>, string][] = [
  ['code', () => import('@/app/api/code/[threadId]/route'), { threadId: 't-us' }, '/api/code/t-us'],
  ['code/diff', () => import('@/app/api/code/[threadId]/diff/route'), { threadId: 't-us' }, '/api/code/t-us/diff'],
  ['code/file', () => import('@/app/api/code/[threadId]/file/route'), { threadId: 't-us' }, '/api/code/t-us/file?path=a.py'],
  ['code/edits', () => import('@/app/api/code/[threadId]/edits/[editId]/route'), { threadId: 't-us', editId: 'e1' }, '/api/code/t-us/edits/e1'],
  ['code/commit', () => import('@/app/api/code/[threadId]/commit/route'), { threadId: 't-us' }, '/api/code/t-us/commit'],
  ['code/pr', () => import('@/app/api/code/[threadId]/pr/route'), { threadId: 't-us' }, '/api/code/t-us/pr'],
  ['code/revert', () => import('@/app/api/code/[threadId]/revert/route'), { threadId: 't-us' }, '/api/code/t-us/revert'],
  ['code/runs', () => import('@/app/api/code/[threadId]/runs/[runId]/route'), { threadId: 't-us', runId: 'r1' }, '/api/code/t-us/runs/r1'],
  ['github', () => import('@/app/api/github/route'), {}, '/api/github'],
  ['github/repos', () => import('@/app/api/github/repos/route'), {}, '/api/github/repos'],
  ['github/branches', () => import('@/app/api/github/branches/route'), {}, '/api/github/branches?repo=o/r'],
  ['github/oauth/start', () => import('@/app/api/github/oauth/start/route'), {}, '/api/github/oauth/start'],
  ['github/oauth/callback', () => import('@/app/api/github/oauth/callback/route'), {}, '/api/github/oauth/callback?state=x&code=y'],
  ['automations', () => import('@/app/api/automations/route'), {}, '/api/automations'],
  ['automations/id', () => import('@/app/api/automations/[id]/route'), { id: 'a1' }, '/api/automations/a1'],
  ['automations/run', () => import('@/app/api/automations/[id]/run/route'), { id: 'a1' }, '/api/automations/a1/run'],
  ['automations/runs', () => import('@/app/api/automations/[id]/runs/route'), { id: 'a1' }, '/api/automations/a1/runs'],
  ['automations/preview', () => import('@/app/api/automations/preview/route'), {}, '/api/automations/preview'],
];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type H = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function each(fn: (name: string, method: string, call: () => Promise<Response>) => Promise<void>) {
  for (const [name, load, params, url] of ROUTES) {
    const m = await load();
    const hs = METHODS.filter((x) => typeof m[x] === 'function');
    expect(hs.length, name).toBeGreaterThan(0);
    for (const method of hs) await fn(name, method, () => (m[method] as H)(rq(url, method, method === 'GET' ? undefined : {}), { params: Promise.resolve(params) }));
  }
}

describe('API облачных агентов по ролям', () => {
  it('«Пользователь»: каждый маршрут code, github, automations — 403 (кроме «отключить GitHub»); без входа — 401', async () => {
    let n = 0;
    await each(async (name, method, call) => {
      as('us');
      const r = await call();
      if (name === 'github' && method === 'DELETE') { expect(r.status, `${method} ${name}`).toBe(200); return; }
      expect(r.status, `${method} ${name}`).toBe(403);
      expect(((await r.json()) as { error?: string }).error).toBe('Облачные агенты, GitHub и автоматизации — в роли «Альфа»');
      as(null);
      expect((await call()).status, `без входа ${method} ${name}`).toBe(401);
      n++;
    });
    expect(n).toBeGreaterThanOrEqual(25);
    expect(db.select().from(schema.githubAccounts).where(eq(schema.githubAccounts.userId, 'us')).get()).toBeUndefined();
    db.insert(schema.githubAccounts).values({ userId: 'us', login: 'gh-us', tokenEnc: 'x', createdAt: T0, checkedAt: T0 }).run();
  });

  it('«Альфа» и «Админ»: проходят проверку роли (ответы — по делу, не 403)', async () => {
    for (const who of ['al', 'adm']) {
      as(who);
      const auto = await import('@/app/api/automations/route');
      const list = await auto.GET(rq('/api/automations'));
      expect(list.status, who).toBe(200);
      const mk = await auto.POST(rq('/api/automations', 'POST', { name: 'Сводка', prompt: 'сводка', modelId: 'alpha', levelId: 'low', cron: '0 9 * * *', timezone: 'Europe/Moscow' }));
      expect(mk.status, who).toBe(200);
      const pv = await (await import('@/app/api/automations/preview/route')).POST(rq('/api/automations/preview', 'POST', { cron: '0 9 * * *', timezone: 'Europe/Moscow' }));
      expect(pv.status, who).toBe(200);
      const code = await import('@/app/api/code/[threadId]/route');
      expect((await code.GET(rq('/api/code/nope'), { params: Promise.resolve({ threadId: 'nope' }) })).status, who).toBe(404);
      const repos = await (await import('@/app/api/github/repos/route')).GET(rq('/api/github/repos'));
      expect(repos.status, who).not.toBe(403);
    }
    as('al');
    const st = await (await import('@/app/api/code/[threadId]/route')).GET(rq('/api/code/t-al'), { params: Promise.resolve({ threadId: 't-al' }) });
    expect(st.status).not.toBe(403);
  });
});

describe('страницы по ролям', () => {
  const typeName = (el: unknown) => { const t = (el as ReactElement).type as { name?: string } | string; return typeof t === 'string' ? t : t?.name; };
  it('/automations: «Пользователю» — заглушка «Доступно в роли «Альфа»», альфе и админу — список; без входа — на вход', async () => {
    const { default: Page } = await import('@/app/(app)/automations/page');
    as('us'); expect(typeName(await Page())).toBe('AlphaOnly');
    as('al'); expect(typeName(await Page())).toBe('AutomationsClient');
    as('adm'); expect(typeName(await Page())).toBe('AutomationsClient');
    as(null); await expect(Page()).rejects.toThrow('redirect:/login');
  });
  it('/?mode=code: «Пользователю» — обычный чат, альфе — «Облачный агент · код»', async () => {
    const { default: Home } = await import('@/app/(app)/page');
    const sp = Promise.resolve({ mode: 'code' });
    as('us'); expect(((await Home({ searchParams: sp })) as ReactElement<{ startCode: boolean }>).props.startCode).toBe(false);
    as('al'); expect(((await Home({ searchParams: sp })) as ReactElement<{ startCode: boolean }>).props.startCode).toBe(true);
  });
  it('Настройки: GitHub — только альфе и админу', async () => {
    const { default: Settings } = await import('@/app/(app)/settings/page');
    const kids = async () => { const el = (await Settings()) as ReactElement<{ children: unknown[] }>; return ([] as unknown[]).concat(el.props.children).filter(isValidElement).map(typeName); };
    as('us'); expect(await kids()).not.toContain('GithubSettings');
    as('al'); expect(await kids()).toContain('GithubSettings');
    as('adm'); expect(await kids()).toContain('GithubSettings');
  });
  it('меню профиля: GitHub не виден «Пользователю» (боковое меню — tests/e2e/roles.py)', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { AccountMenu } = await import('@/components/Shell');
    const menu = (agents: boolean) => renderToStaticMarkup(createElement(AccountMenu, { name: 'Анна', admin: false, agents, initials: 'А', onLogout: async () => {}, initialOpen: true }));
    expect(menu(false)).not.toContain('github-link');
    expect(menu(true)).toContain('github-link');
    const { canAgents } = await import('@/lib/roles');
    expect([canAgents('user'), canAgents('alpha'), canAgents('admin'), canAgents(undefined), canAgents('root')]).toEqual([false, true, true, false, false]);
  });
});

describe('инструменты модели и планировщик', () => {
  it('code_*/github_* и блок «Облачный агент-программист» — только альфе (у «Пользователя» GitHub и репозиторий в БД есть)', async () => {
    await import('@/lib/tools/all');
    const { toolsFor, promptParts } = await import('@/lib/tools/registry');
    const names = (u: string) => toolsFor({ userId: u, threadId: `t-${u}`, folderId: null, kind: 'chat', modelId: 'alpha', depth: 0 }).map((t) => t.name);
    const us = names('us'), al = names('al');
    expect(us.filter((n) => /^(code|github)_/.test(n))).toEqual([]);
    expect(al).toEqual(expect.arrayContaining(['code_open', 'code_read', 'code_edit', 'code_run', 'code_commit', 'code_pr', 'github_repos']));
    expect(us).toEqual(expect.arrayContaining(['chat_list', 'files_list', 'memory_list']));
    const parts = (u: string) => promptParts({ userId: u, threadId: `t-${u}`, folderId: null, kind: 'chat', modelId: 'alpha', depth: 0 }).join('\n');
    expect(parts('us')).not.toMatch(/Облачный агент-программист|GitHub/);
    expect(parts('al')).toMatch(/Облачный агент-программист/);
  });

  it('планировщик не запускает автоматизации «Пользователя» (понизили — стоят, пока роль не вернут)', async () => {
    const { tick } = await import('@/lib/scheduler');
    db.delete(schema.automations).run();
    const now = T0 + 1000;
    for (const u of ['us', 'al', 'adm']) {
      const tid = `ta-${u}`;
      db.insert(schema.threads).values({ id: tid, userId: u, title: 'Авто', modelId: `m-${u}`, effort: 'off', createdAt: T0, updatedAt: T0 }).run();
      db.insert(schema.automations).values({ id: `auto-${u}`, userId: u, name: u, prompt: 'p', modelId: `m-${u}`, levelId: 'off', cron: '0 9 * * *', timezone: 'UTC', targetThreadId: tid, enabled: 1, nextRunAt: now - 1, createdAt: T0 }).run();
    }
    const run = (async () => ({ runId: 'r', status: 'ok' as const })) as never;
    expect(tick(now, { run }).sort()).toEqual(['auto-adm', 'auto-al']);
    db.update(schema.users).set({ role: 'alpha' }).where(eq(schema.users.id, 'us')).run();
    expect(tick(now, { run })).toEqual(['auto-us']);
    db.update(schema.users).set({ role: 'user' }).where(eq(schema.users.id, 'us')).run();
    db.delete(schema.automations).run();
  });

  it('уровень max — альфе и администратору, пользователь получает xhigh', async () => {
    const { restrictedFor } = await import('@/lib/levelPolicy');
    expect([restrictedFor('user'), restrictedFor('alpha'), restrictedFor('admin')]).toEqual([true, false, false]);
  });
});

describe('администратор меняет роль', () => {
  const patch = async (id: string, body: unknown) => (await import('@/app/api/admin/users/[id]/route')).PATCH(rq(`/api/admin/users/${id}`, 'PATCH', body), { params: Promise.resolve({ id }) });
  const role = (id: string) => db.select({ r: schema.users.role }).from(schema.users).where(eq(schema.users.id, id)).get()!.r;
  const lastAudit = () => db.select().from(schema.adminAudit).all().sort((a, b) => b.at - a.at).at(0);

  it('Пользователь → Альфа → Пользователь, в журнале «Сменил роль» с подписями; чужая роль — 400; не админ — 403', async () => {
    as('adm');
    expect((await patch('us2', { role: 'alpha' })).status).toBe(200);
    expect(role('us2')).toBe('alpha');
    expect(lastAudit()).toMatchObject({ action: 'role', adminId: 'adm', targetId: 'us2', detail: 'Пользователь → Альфа' });
    expect((await patch('us2', { role: 'user' })).status).toBe(200);
    expect(lastAudit()).toMatchObject({ detail: 'Альфа → Пользователь' });
    expect((await patch('us2', { role: 'root' })).status).toBe(400);
    as('al'); expect((await patch('us2', { role: 'alpha' })).status).toBe(403);
    as('us'); expect((await patch('us2', { role: 'alpha' })).status).toBe(403);
    expect(role('us2')).toBe('user');
  });

  it('себя понизить — только с подтверждением; последнего администратора — нельзя', async () => {
    as('adm');
    const r1 = await patch('adm', { role: 'alpha' });
    expect(r1.status).toBe(409);
    expect(((await r1.json()) as { error: string }).error).toBe('Свою роль можно понизить только с подтверждением');
    expect(role('adm')).toBe('admin');
    expect((await patch('adm', { role: 'alpha', confirmSelf: true })).status).toBe(200);
    expect(role('adm')).toBe('alpha');
    expect(lastAudit()).toMatchObject({ adminId: 'adm', targetId: 'adm', detail: 'Админ → Альфа' });
    as('adm2');
    const r2 = await patch('adm2', { role: 'user', confirmSelf: true });
    expect(r2.status).toBe(409);
    expect(((await r2.json()) as { error: string }).error).toBe('Должен остаться хотя бы один администратор');
    expect(role('adm2')).toBe('admin');
    expect((await patch('adm', { role: 'admin' })).status).toBe(200);
    expect(role('adm')).toBe('admin');
  });

  it('«Альфа» всем по ссылке-приглашению: только «Пользователям» без блокировки; журнал', async () => {
    db.insert(schema.invites).values({ id: 'inv', tokenHash: 'h', role: 'user', note: 'Класс', createdBy: 'adm', expiresAt: T0 + 9e9, maxUses: 30, uses: 4, createdAt: T0 }).run();
    db.update(schema.users).set({ disabled: 1, blockKind: 'ban' }).where(eq(schema.users.id, 'us3')).run();
    for (const [i, uid] of [['1', 'us'], ['2', 'us2'], ['3', 'us3'], ['4', 'adm2']] as const) db.insert(schema.inviteUses).values({ id: `iu${i}`, inviteId: 'inv', userId: uid, name: uid, createdAt: T0 }).run();
    const bulk = (await import('@/app/api/admin/invites/[id]/bulk/route')).POST;
    as('al'); expect((await bulk(rq('/api/admin/invites/inv/bulk', 'POST', { action: 'alpha' }), { params: Promise.resolve({ id: 'inv' }) })).status).toBe(403);
    as('adm');
    const r = await bulk(rq('/api/admin/invites/inv/bulk', 'POST', { action: 'alpha' }), { params: Promise.resolve({ id: 'inv' }) });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, granted: 2, skipped: 2 });
    expect([role('us'), role('us2'), role('us3'), role('adm2')]).toEqual(['alpha', 'alpha', 'user', 'admin']);
    const acts = db.select().from(schema.adminAudit).where(eq(schema.adminAudit.inviteId, 'inv')).all();
    expect(acts.filter((a) => a.action === 'role').map((a) => a.targetId).sort()).toEqual(['us', 'us2']);
    expect(acts.filter((a) => a.action === 'bulk_alpha')).toHaveLength(1);
    const inv = (await import('@/app/api/admin/invites/route')).POST;
    const ri = await inv(rq('/api/admin/invites', 'POST', { role: 'alpha', note: 'альфа-тестеры', days: 7, maxUses: 5 }));
    expect(ri.status).toBe(200);
    expect(db.select().from(schema.invites).all().find((i) => i.note === 'альфа-тестеры')?.role).toBe('alpha');
    void randomUUID;
  });
});
