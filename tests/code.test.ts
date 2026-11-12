import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpData } from './helpers';

const dir = tmpData();
const GITEA = 'http://127.0.0.1:3300';
const TEST_DIR = '/tmp/korvex-test';
const SEED = path.join(TEST_DIR, 'seed', 'korvex-demo-shop');

describe('secret', () => {
  it('seal/open, привязка к владельцу, ключ 0600 вне БД', async () => {
    const s = await import('@/lib/github/secret');
    const sealed = s.seal('ghp_example_token_value_1234567890', 'gh:user-1');
    expect(sealed).not.toContain('ghp_example');
    expect(s.open(sealed, 'gh:user-1')).toBe('ghp_example_token_value_1234567890');
    expect(() => s.open(sealed, 'gh:user-2')).toThrow();
    const st = fs.statSync(s.keyFile());
    expect(st.mode & 0o777).toBe(0o600);
    expect(s.keyFile().startsWith(dir)).toBe(true);
  });
});

describe('fsx: рабочее дерево и ссылки песочницы', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kxwt-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'kxout-'));
  beforeAll(() => {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'a.py'), 'print(1)\n');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'leak.txt'));
    fs.symlinkSync(outside, path.join(root, 'outdir'));
  });
  it('путь вне дерева, .git, ссылки — отказ', async () => {
    const f = await import('@/lib/code/fsx');
    expect(() => f.resolveIn(root, '../x')).toThrow();
    expect(() => f.resolveIn(root, 'src/../../x')).toThrow();
    expect(() => f.resolveIn(root, '.git/config')).toThrow();
    expect(f.resolveIn(root, '/etc/passwd').abs).toBe(path.join(root, 'etc/passwd'));
    expect(() => f.readText(root, 'leak.txt')).toThrow(/ссылк/);
    expect(() => f.readText(root, 'outdir/secret.txt')).toThrow(/ссылк/);
    expect(() => f.writeText(root, 'outdir/secret.txt', 'x')).toThrow();
    expect(() => f.writeText(root, 'leak.txt', 'x')).toThrow();
    expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe('SECRET');
    expect(f.readText(root, 'src/a.py')).toBe('print(1)\n');
    execFileSync('mkfifo', [path.join(root, 'pipe')]);
    expect(() => f.readText(root, 'pipe')).toThrow(/не обычный/);
    expect(() => f.writeText(root, 'pipe', 'x')).toThrow();
    f.writeText(root, 'src/new/b.py', 'x = 2\n');
    expect(f.readText(root, 'src/new/b.py')).toBe('x = 2\n');
    f.writeText(root, 'src/new/b.py', null);
    expect(f.readText(root, 'src/new/b.py')).toBeNull();
  });
  it('дифф правки', async () => {
    const f = await import('@/lib/code/fsx');
    const d = await f.udiff('src/a.py', 'a\nb\nc\n', 'a\nB\nc\nd\n');
    expect(d.diff).toContain('--- a/src/a.py');
    expect(d.diff).toContain('+B');
    expect([d.added, d.removed]).toEqual([2, 1]);
    const n = await f.udiff('new.txt', null, 'x\n');
    expect(n.diff).toContain('new file mode');
    expect(n.diff).toContain('--- /dev/null');
  });
});

describe('прокси песочницы', () => {
  it('локальные и частные адреса, разрешённые имена', async () => {
    const n = await import('@/lib/code/netproxy');
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.17.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0'])
      expect(n.privateAddr(ip), ip).toBe(true);
    for (const ip of ['151.101.0.223', '140.82.112.3', '2606:4700::1111']) expect(n.privateAddr(ip), ip).toBe(false);
    expect(n.hostAllowed('pypi.org', 'packages')).toBe(true);
    expect(n.hostAllowed('files.pythonhosted.org', 'packages')).toBe(true);
    expect(n.hostAllowed('evil.example.com', 'packages')).toBe(false);
    expect(n.hostAllowed('upload.pypi.org', 'packages')).toBe(false);
    expect(n.hostAllowed('github.com', 'packages')).toBe(false);
    expect(n.hostAllowed('localhost', 'open')).toBe(false);
    expect(n.hostAllowed('127.0.0.1', 'open')).toBe(false);
    expect(n.hostAllowed('example.com', 'open')).toBe(true);
    expect(n.hostAllowed('pypi.org', 'off')).toBe(false);
  });
  it('CONNECT к локальному — 403, не CONNECT — 405', async () => {
    const n = await import('@/lib/code/netproxy');
    const sock = n.ensureNetProxy()!;
    await new Promise((r) => setTimeout(r, 50));
    const ask = (line: string) => new Promise<string>((resolve) => {
      const c = net.connect(sock);
      let b = '';
      c.on('data', (d) => { b += d.toString(); });
      c.on('close', () => resolve(b));
      c.on('error', () => resolve(b));
      c.write(line);
    });
    expect(await ask('CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: x\r\n\r\n')).toMatch(/^HTTP\/1\.1 405|^HTTP\/1\.1 403/);
    expect(await ask('CONNECT localhost:443 HTTP/1.1\r\n\r\n')).toMatch(/^HTTP\/1\.1 403/);
    expect(await ask('CONNECT pypi.org:22 HTTP/1.1\r\n\r\n')).toMatch(/^HTTP\/1\.1 403/);
    expect(await ask('GET http://pypi.org/ HTTP/1.1\r\n\r\n')).toMatch(/^HTTP\/1\.1 405/);
  });
});

describe('разбор тестов', () => {
  it('pytest, jest, unittest', async () => {
    const { parseTests } = await import('@/lib/code/tests');
    expect(parseTests('pytest -q', 'F.....\nFAILED tests/x.py::t - assert\n1 failed, 5 passed in 0.03s\n', 1)).toEqual({ ok: false, passed: 5, failed: 1, framework: 'pytest' });
    expect(parseTests('python -m pytest', '======= 6 passed in 0.02s =======\n', 0)).toEqual({ ok: true, passed: 6, failed: 0, framework: 'pytest' });
    expect(parseTests('npx jest', 'Tests:       1 failed, 4 passed, 5 total\n', 1)).toMatchObject({ ok: false, passed: 4, failed: 1 });
    expect(parseTests('python -m unittest', 'Ran 3 tests in 0.001s\n\nOK\n', 0)).toMatchObject({ ok: true, passed: 3, failed: 0 });
    expect(parseTests('ls -la', 'total 0', 0)).toBeNull();
  });
});

const tokenFile = path.join(TEST_DIR, 'token_full.txt');
async function giteaUp(): Promise<boolean> {
  if (process.env.KX_TEST_NET !== 'live') return false;
  try { return (await fetch(`${GITEA}/api/v1/version`, { signal: AbortSignal.timeout(2000) })).ok && fs.existsSync(tokenFile) && fs.existsSync(SEED); } catch { return false; }
}
const UP = await giteaUp();
let DOCKER = false;
try { execFileSync('docker', ['image', 'inspect', 'korvex-code:1'], { stdio: 'ignore' }); DOCKER = true; } catch {  }

describe.skipIf(!UP)('облачный агент на тестовом Gitea', () => {
  const TOKEN = UP ? fs.readFileSync(tokenFile, 'utf8').trim() : '';
  const repoName = `kx-test-${randomBytes(3).toString('hex')}`;
  const repo = `korvex-test/${repoName}`;
  const user = { id: 'user-code', email: 'code@korvex.local' };
  const other = { id: 'user-other', email: 'other@korvex.local' };
  const threadId = randomUUID();
  const steps: unknown[] = [];
  const outputs: string[] = [];
  let answer: 'allow' | 'deny' = 'deny';
  let asked: string[] = [];
  const api = (m: string, p: string, body?: unknown) => fetch(`${GITEA}/api/v1${p}`, { method: m, headers: { Authorization: `token ${TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

  beforeAll(async () => {
    process.env.GITHUB_API_URL = `${GITEA}/api/v1`;
    process.env.GITHUB_WEB_URL = GITEA;
    process.env.KORVEX_CODE_NET = 'packages';
    expect((await api('POST', '/user/repos', { name: repoName, private: true, default_branch: 'main' })).status).toBe(201);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kxseed-'));
    fs.cpSync(SEED, tmp, { recursive: true, filter: (src) => !src.split(path.sep).includes('.git') });
    const g = (args: string[]) => execFileSync('git', args, { cwd: tmp, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Owner', GIT_AUTHOR_EMAIL: 'f@korvex.local', GIT_COMMITTER_NAME: 'Owner', GIT_COMMITTER_EMAIL: 'f@korvex.local' }, stdio: 'pipe' });
    g(['init', '-q', '-b', 'main']); g(['add', '-A']); g(['commit', '-qm', 'init']);
    g(['-c', `http.extraHeader=Authorization: Basic ${Buffer.from(`korvex-test:${TOKEN}`).toString('base64')}`, 'push', '-q', `${GITEA}/${repo}.git`, 'main']);
    fs.rmSync(tmp, { recursive: true, force: true });
    const { getDb, schema } = await import('@/lib/db');
    const db = getDb();
    const now = Date.now();
    for (const u of [user, other]) db.insert(schema.users).values({ id: u.id, email: u.email, name: u.id === user.id ? 'Иван' : 'Other', passwordHash: 'x', role: 'alpha', createdAt: now }).run();
    db.insert(schema.threads).values({ id: threadId, userId: user.id, title: 'код', modelId: 'alpha', effort: 'low', createdAt: now, updatedAt: now }).run();
    await import('@/lib/tools/code');
  }, 60_000);

  afterAll(async () => {
    if (UP) await api('DELETE', `/repos/${repo}`);
    const { stopBox } = await import('@/lib/code/sandbox');
    await stopBox(threadId).catch(() => null);
  }, 60_000);

  async function call(name: string, args: Record<string, unknown>) {
    const { getTool } = await import('@/lib/tools/registry');
    const t = getTool(name)!;
    expect(t, name).toBeTruthy();
    const ctx = {
      userId: user.id, threadId, folderId: null, jobId: 'job-1', messageId: 'msg-1', callId: `call-${randomUUID().slice(0, 8)}`, kind: 'chat' as const, modelId: 'alpha',
      signal: new AbortController().signal, depth: 0,
      emit: (p: unknown) => { steps.push(p); },
      confirm: async (text: string) => { asked.push(text); return answer === 'allow'; },
      attach: async (f: { name: string; mime: string; data: Buffer }) => ({ kind: 'file' as const, fileId: 'f', url: '/api/files/f', name: f.name, mime: f.mime, size: f.data.length }),
    };
    const title = t.title(args);
    const r = await t.run(args, ctx);
    outputs.push(title, r.content);
    return r;
  }

  it('подключение: плохой токен — отказ без записи; свой — аккаунт и репозитории', async () => {
    const acc = await import('@/lib/github/account');
    await expect(acc.connect(user.id, 'not a token')).rejects.toThrow(/не похоже/);
    await expect(acc.connect(user.id, 'abcdefabcdefabcdefabcdefabcdefabcdefabcd')).rejects.toThrow(/не принял/);
    expect(acc.status(user.id).connected).toBe(false);
    const r = await acc.connect(user.id, TOKEN);
    expect(r.status.login).toBe('korvex-test');
    expect(r.repos.some((x) => x.fullName === repo)).toBe(true);
    const { getDb, schema } = await import('@/lib/db');
    const row = getDb().select().from(schema.githubAccounts).all()[0];
    expect(row.tokenEnc).not.toContain(TOKEN);
    expect(JSON.stringify(acc.status(user.id))).not.toContain(TOKEN);
    acc.setCoAuthors(user.id, ['Owner Two <owner2@korvex.local>']);
    expect(() => acc.setCoAuthors(user.id, ['плохо'])).toThrow();
  }, 30_000);

  it('чужой пользователь не видит сессию', async () => {
    const s = await import('@/lib/code/session');
    await expect(s.openRepo({ userId: other.id, threadId, repo, origin: 'tool', wait: true })).rejects.toThrow(/GitHub не подключён/);
  });

  it('code_open: клон без токена в дереве, обзор с README', async () => {
    const r = await call('code_open', { repo });
    expect(r.error).toBeFalsy();
    expect(r.content).toContain('korvex-demo-shop');
    expect(r.content).toContain('pytest');
    const s = await import('@/lib/code/session');
    const d = s.dirsOf(threadId);
    expect(fs.existsSync(path.join(d.workTree, '.git'))).toBe(false);
    const grep = (p: string): boolean => fs.readdirSync(p, { withFileTypes: true }).some((e) => e.isDirectory() ? grep(path.join(p, e.name)) : fs.readFileSync(path.join(p, e.name), 'utf8').includes(TOKEN));
    expect(grep(d.workTree)).toBe(false);
    expect(grep(d.gitDir)).toBe(false);
  }, 60_000);

  it('новый чат: клон в фоне, первый инструмент ждёт его, а не падает', async () => {
    const { getDb, schema } = await import('@/lib/db');
    const t2 = randomUUID();
    getDb().insert(schema.threads).values({ id: t2, userId: user.id, title: 'код 2', modelId: 'alpha', effort: 'low', createdAt: Date.now(), updatedAt: Date.now() }).run();
    const s = await import('@/lib/code/session');
    const row = await s.openRepo({ userId: user.id, threadId: t2, repo, origin: 'code' });
    expect(row.status).toBe('cloning');
    const { getTool } = await import('@/lib/tools/registry');
    const r = await getTool('code_read')!.run({ path: 'README.md' }, { userId: user.id, threadId: t2, folderId: null, jobId: 'j', messageId: null, callId: 'c', kind: 'chat', modelId: 'alpha',
      signal: new AbortController().signal, depth: 0, emit: () => {}, confirm: async () => false, attach: async () => { throw new Error('no'); } });
    expect(r.error).toBeFalsy();
    expect(r.content).toContain('korvex-demo-shop');
    await s.dropSession(t2);
  }, 60_000);

  it('чтение и поиск: «где считается налог»', async () => {
    const r = await call('code_search', { query: 'НДС' });
    expect(r.content).toMatch(/shop\/tax\.py:\d+:/);
    const f = await call('code_read', { path: 'shop/tax.py' });
    expect(f.content).toContain('def vat_included');
    const ls = await call('code_read', { path: '' });
    expect(ls.content).toContain('shop/');
    const no = await call('code_read', { path: '../../etc/passwd' });
    expect(no.error).toBe(true);
  });

  it('правка README, откат, правка пользователем', async () => {
    const r = await call('code_edit', { path: 'README.md', old_text: '## Тесты', new_text: '## Установка\n\n```\npip install -r requirements.txt\n```\n\n## Тесты' });
    expect(r.error).toBeFalsy();
    expect(r.content).toContain('+## Установка');
    const s = await import('@/lib/code/session');
    let st = (await s.stateOf(user.id, threadId))!;
    expect(st.files.map((f) => f.path)).toEqual(['README.md']);
    const e = st.edits[0];
    expect(e.callId).toMatch(/^call-/);
    await s.revertEdit(user.id, threadId, e.id);
    st = (await s.stateOf(user.id, threadId))!;
    expect(st.files).toEqual([]);
    await expect(s.revertEdit(user.id, threadId, e.id)).rejects.toThrow(/уже откачена/);
    await call('code_edit', { path: 'README.md', old_text: '## Тесты', new_text: '## Установка\n\npip install -r requirements.txt\n\n## Тесты' });
    const cur = (await import('@/lib/code/fsx')).readText(s.dirsOf(threadId).workTree, 'README.md')!;
    const u = await s.applyEdit({ userId: user.id, threadId, path: 'README.md', after: cur.replace('pip install -r requirements.txt', 'python -m pip install -r requirements.txt'), source: 'user', expectBefore: cur });
    expect(u!.diff).toContain('+python -m pip install');
    await expect(s.applyEdit({ userId: user.id, threadId, path: 'README.md', after: 'x', source: 'user', expectBefore: cur })).rejects.toThrow(/изменился/);
  });

  it.skipIf(!DOCKER)('песочница: тесты падают -> починка -> проходят; сети к серверу нет', async () => {
    const r1 = await call('code_run', { command: 'pytest -q' });
    expect(r1.content).toMatch(/упали — прошло 5, упало 1/);
    const fix = await call('code_edit', { path: 'shop/pricing.py', old_text: 'return round(price * (1 - percent / 100), 1)', new_text: 'return round(price * (1 - percent / 100), 2)' });
    expect(fix.error).toBeFalsy();
    const r2 = await call('code_run', { command: 'pytest -q' });
    expect(r2.content).toMatch(/прошли — прошло 6, упало 0/);
    const s = await import('@/lib/code/session');
    expect((await s.stateOf(user.id, threadId))!.tests).toMatchObject({ ok: true, passed: 6, failed: 0 });
    const iso = await call('code_run', { command: `python3 - <<'EOF'
import socket, os
for h, p in [('172.17.0.1', 3000), ('127.0.0.1', 3101), ('192.168.122.1', 53), ('1.1.1.1', 443)]:
    s = socket.socket(); s.settimeout(2)
    try: s.connect((h, p)); print('OPEN', h, p)
    except Exception as e: print('closed', h, p)
print('gitdir', os.path.exists('/work/repo/.git'))
EOF
curl -s -o /dev/null -w 'proxy-local %{http_code}\\n' --proxy http://127.0.0.1:3128 https://127.0.0.1/ ; curl -s -o /dev/null -w 'proxy-evil %{http_code}\\n' https://example.com/ ; echo done` });
    expect(iso.content).not.toMatch(/^OPEN \d/m);
    expect(iso.content).toMatch(/^closed 127\.0\.0\.1 3101$/m);
    const { containerName } = await import('@/lib/code/sandbox');
    const env = execFileSync('docker', ['exec', containerName(threadId), 'sh', '-c', 'env; cat /proc/1/environ'], { encoding: 'utf8' });
    expect(env.includes(TOKEN)).toBe(false);
    expect(iso.content).toContain('gitdir False');
    expect(iso.content).not.toMatch(/proxy-local 2\d\d/);
    expect(iso.content).not.toMatch(/proxy-evil 2\d\d/);
  }, 180_000);

  it('коммит от Korvex AI с соавторами; отказ от push — ничего не ушло; разрешение — PR', async () => {
    const c = await call('code_commit', { message: 'README: раздел «Установка»; скидка округляется до копеек', topic: 'install-docs' });
    expect(c.content).toContain('korvex/install-docs');
    const s = await import('@/lib/code/session');
    const d = s.dirsOf(threadId);
    const { gitOk } = await import('@/lib/code/git');
    const log = await gitOk(d, ['log', '-1', '--format=%an <%ae>%n%cn%n%B']);
    expect(log).toContain('Korvex AI <noreply@localhost>');
    expect(log).toContain('Co-authored-by: korvex-test <korvex-test@noreply.127.0.0.1>');
    expect(log).toContain('Co-authored-by: Owner Two <owner2@korvex.local>');
    answer = 'deny'; asked = [];
    const no = await call('code_pr', { title: 'Документация: установка', body: 'Добавлен раздел установки.' });
    expect(asked.length).toBe(1);
    expect(asked[0]).toContain(repo);
    expect(no.content).toMatch(/не разрешил/);
    const heads = () => execFileSync('git', ['-c', `http.extraHeader=Authorization: Basic ${Buffer.from(`korvex-test:${TOKEN}`).toString('base64')}`, 'ls-remote', '--heads', `${GITEA}/${repo}.git`], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
    expect(heads()).not.toContain('korvex/');
    answer = 'allow'; asked = [];
    const yes = await call('code_pr', { title: 'Документация: установка', body: 'Добавлен раздел установки.\n\nТесты: pytest -q — 6 passed.' });
    expect(yes.error, yes.content).toBeFalsy();
    expect(yes.content).toMatch(/Открыт pull request #\d+/);
    expect(heads()).toContain('refs/heads/korvex/install-docs');
    const pulls = await (await api('GET', `/repos/${repo}/pulls?state=open`)).json() as { head: { ref: string }; base: { ref: string } }[];
    expect(pulls[0].head.ref).toBe('korvex/install-docs');
    expect(pulls[0].base.ref).toBe('main');
    const st = (await s.stateOf(user.id, threadId))!;
    expect(st.prUrl).toMatch(/\/pulls\/\d+$/);
    expect(st.unpushed).toBe(0);
  }, 120_000);

  it('токен нигде в ответах и шагах', () => {
    expect(JSON.stringify(steps)).not.toContain(TOKEN);
    expect(outputs.join('\n')).not.toContain(TOKEN);
  });

  it('уборка: клон и песочница удалённого чата убираются', async () => {
    const s = await import('@/lib/code/session');
    const { getDb, schema } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    const gone = randomUUID();
    fs.mkdirSync(path.join(s.codeRoot(), gone, 'wt'), { recursive: true });
    expect(fs.existsSync(s.dirsOf(threadId).root)).toBe(true);
    const r = await s.sweepOrphans();
    expect(r.dirs).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(s.codeRoot(), gone))).toBe(false);
    expect(fs.existsSync(s.dirsOf(threadId).root)).toBe(true);
    getDb().delete(schema.threads).where(eq(schema.threads.id, threadId)).run();
    expect(s.sessionOf(threadId)).toBeUndefined();
    const r2 = await s.sweepOrphans();
    expect(r2.dirs).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(s.dirsOf(threadId).root)).toBe(false);
    if (DOCKER) {
      const { containerName } = await import('@/lib/code/sandbox');
      let alive = true;
      try { execFileSync('docker', ['inspect', containerName(threadId)], { stdio: 'ignore' }); } catch { alive = false; }
      expect(alive).toBe(false);
    }
  }, 60_000);

  it('отключение удаляет токен', async () => {
    const acc = await import('@/lib/github/account');
    expect(acc.disconnect(user.id)).toBe(true);
    expect(acc.status(user.id).connected).toBe(false);
    expect(await acc.tokenOf(user.id)).toBeNull();
  });
});
