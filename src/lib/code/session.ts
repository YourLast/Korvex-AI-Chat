import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataDir, getDb, schema } from '../db';
import type { CodeEdit, CodeRun, CodeSession } from '../db/schema';
import { publish } from '../bus';
import { cloneUrl, createPull, findPull, getRepo, GhError, validBranch, validRepo, webBase } from '../github/api';
import { accountOf, coauthorTrailers, tokenOf } from '../github/account';
import { git, gitOk, type Auth, type Dirs } from './git';
import { FsError, readText, resolveIn, treeBytes, udiff, writeText } from './fsx';
import { runInBox, stopBox, listBoxes } from './sandbox';
import { parseTests, type TestSummary } from './tests';
import { cfg } from '../cfg';

export const BOT = () => {
  const id = process.env.KORVEX_BOT_GH_ID?.trim();
  const email = process.env.KORVEX_BOT_EMAIL?.trim() || (id && /^\d+$/.test(id) ? `${id}+${process.env.KORVEX_BOT_GH_LOGIN?.trim() || 'korvex-ai'}@users.noreply.github.com` : cfg('KORVEX_BOT_FALLBACK_EMAIL', 'noreply@localhost'));
  return { name: process.env.KORVEX_BOT_NAME || 'Korvex AI', email };
};
const CLONE_DEPTH = 50;
const MAX_REPO_MB = () => Number(process.env.KORVEX_CODE_MAX_REPO_MB || 1024);

export class CodeError extends Error { constructor(public status: number, message: string) { super(message); } }

export function codeRoot(): string { return path.join(dataDir(), 'code'); }
export function dirsOf(threadId: string): Dirs & { root: string } {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(threadId)) throw new CodeError(400, 'bad thread');
  const root = path.join(codeRoot(), threadId);
  return { root, gitDir: path.join(root, 'git'), workTree: path.join(root, 'wt') };
}

const g = globalThis as unknown as { __kxCodeLock?: Map<string, Promise<unknown>> };
export function serial<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
  const m = (g.__kxCodeLock ??= new Map());
  const prev = m.get(threadId) ?? Promise.resolve();
  const p = prev.catch(() => null).then(fn);
  m.set(threadId, p);
  void p.finally(() => { if (m.get(threadId) === p) m.delete(threadId); }).catch(() => null);
  return p;
}

export function sessionOf(threadId: string): CodeSession | undefined {
  return getDb().select().from(schema.codeSessions).where(eq(schema.codeSessions.threadId, threadId)).get();
}
export function ownSession(userId: string, threadId: string): CodeSession | undefined {
  const s = sessionOf(threadId);
  return s && s.userId === userId ? s : undefined;
}
function patch(threadId: string, p: Partial<CodeSession>) {
  getDb().update(schema.codeSessions).set({ ...p, updatedAt: Date.now() }).where(eq(schema.codeSessions.threadId, threadId)).run();
}
export function notify(userId: string, threadId: string, what: string) { publish(userId, { t: 'code', th: threadId, what }); }

async function authOf(userId: string): Promise<Auth> {
  const token = await tokenOf(userId);
  const a = accountOf(userId);
  if (!token || !a) throw new CodeError(409, 'GitHub не подключён: Настройки → GitHub');
  return { login: a.login, token };
}

export async function openRepo(p: { userId: string; threadId: string; repo: string; branch?: string | null; origin: 'code' | 'tool'; wait?: boolean; signal?: AbortSignal }): Promise<CodeSession> {
  if (!validRepo(p.repo)) throw new CodeError(400, 'Неверное имя репозитория: нужно владелец/имя');
  if (p.branch && !validBranch(p.branch)) throw new CodeError(400, 'Неверное имя ветки');
  const cur = sessionOf(p.threadId);
  if (cur && cur.status !== 'error') {
    if (cur.repo.toLowerCase() === p.repo.toLowerCase()) return cur;
    throw new CodeError(409, `В этом чате уже открыт ${cur.repo}: для другого репозитория начните новый чат`);
  }
  const auth = await authOf(p.userId);
  const info = await getRepo(auth.token, p.repo).catch((e) => { throw new CodeError(e instanceof GhError ? (e.status === 404 ? 404 : 502) : 502, (e as Error).message); });
  const branch = p.branch || info.defaultBranch;
  const now = Date.now();
  const row = { threadId: p.threadId, userId: p.userId, repo: info.fullName, baseBranch: branch, baseSha: null, workBranch: null, status: 'cloning', error: null, origin: p.origin,
    prUrl: null, prNumber: null, pushedSha: null, tests: null, createdAt: now, updatedAt: now };
  getDb().insert(schema.codeSessions).values(row).onConflictDoUpdate({ target: schema.codeSessions.threadId, set: { ...row, createdAt: cur?.createdAt ?? now } }).run();
  notify(p.userId, p.threadId, 'cloning');
  const job = serial(p.threadId, () => clone(p.userId, p.threadId, info.fullName, branch, auth, p.signal));
  if (p.wait) await job; else void job.catch(() => null);
  return sessionOf(p.threadId)!;
}

async function clone(userId: string, threadId: string, repo: string, branch: string, auth: Auth, signal?: AbortSignal) {
  const d = dirsOf(threadId);
  try {
    fs.rmSync(d.root, { recursive: true, force: true });
    fs.mkdirSync(d.workTree, { recursive: true, mode: 0o755 });
    fs.mkdirSync(d.gitDir, { recursive: true, mode: 0o700 });
    await gitOk(null, ['init', '-q', '--bare', d.gitDir]);
    await gitOk(d, ['config', 'core.bare', 'false']);
    await gitOk(d, ['remote', 'add', 'origin', cloneUrl(repo)]);
    await gitOk(d, ['fetch', '-q', '--no-tags', `--depth=${CLONE_DEPTH}`, 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { auth, timeoutMs: 5 * 60_000, signal });
    const mb = dirBytes(d.gitDir) / 1024 / 1024;
    if (mb > MAX_REPO_MB()) throw new Error(`репозиторий слишком большой (${Math.round(mb)} МБ, предел ${MAX_REPO_MB()} МБ)`);
    await gitOk(d, ['checkout', '-q', '-f', '-B', branch, `refs/remotes/origin/${branch}`], { timeoutMs: 5 * 60_000 });
    const sha = (await gitOk(d, ['rev-parse', 'HEAD'])).trim();
    patch(threadId, { status: 'ready', baseSha: sha, error: null });
  } catch (e) {
    const msg = (e as Error).message.includes("couldn't find remote ref") ? `нет ветки ${branch}` : (e as Error).message;
    patch(threadId, { status: 'error', error: `Не удалось склонировать: ${msg}`.slice(0, 500) });
    throw new CodeError(502, `Не удалось склонировать ${repo}: ${msg}`);
  } finally {
    notify(userId, threadId, 'clone');
  }
}

function dirBytes(p: string): number { return treeBytes(p); }

async function merge3(current: string, base: string, other: string, rel: string): Promise<string> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kxmerge-'));
  try {
    const [c, b, o] = ['cur', 'base', 'other'].map((n) => path.join(/*turbopackIgnore: true*/ tmp, n));
    fs.writeFileSync(c, current); fs.writeFileSync(b, base); fs.writeFileSync(o, other);
    const r = await git(null, ['merge-file', '-p', c, b, o], { cwd: tmp });
    if (r.code !== 0) throw new CodeError(409, `После этой правки файл ${rel} меняли так, что откат не ложится — сначала откатите более поздние правки`);
    return r.out;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

export function ready(userId: string, threadId: string): CodeSession & { dirs: Dirs; wt: string } {
  const s = ownSession(userId, threadId);
  if (!s) throw new CodeError(404, 'В этом чате нет репозитория: откройте его (code_open) или создайте чат «Облачный агент · код»');
  if (s.status === 'cloning') throw new CodeError(409, `Репозиторий ${s.repo} ещё клонируется — подождите`);
  if (s.status !== 'ready') throw new CodeError(409, s.error || 'Клон не готов');
  const d = dirsOf(threadId);
  return { ...s, dirs: d, wt: fs.realpathSync(/*turbopackIgnore: true*/ d.workTree) };
}

export async function readyWait(userId: string, threadId: string, signal?: AbortSignal): Promise<CodeSession & { dirs: Dirs; wt: string }> {
  const s = ownSession(userId, threadId);
  if (s?.status === 'cloning') {
    const busy = (g.__kxCodeLock ?? new Map()).has(threadId);
    if (!busy) {
      const auth = await authOf(userId);
      await serial(threadId, () => clone(userId, threadId, s.repo, s.baseBranch, auth, signal)).catch(() => null);
    } else {
      await Promise.race([serial(threadId, async () => null), new Promise((r) => signal?.addEventListener('abort', r, { once: true }))]);
    }
  }
  return ready(userId, threadId);
}

export type EditOut = { edit: CodeEdit; diff: string };

export async function applyEdit(p: { userId: string; threadId: string; path: string; after: string | null; source: 'agent' | 'user' | 'revert'; messageId?: string | null; callId?: string | null; expectBefore?: string | null }): Promise<EditOut | null> {
  return serial(p.threadId, async () => {
    const s = ready(p.userId, p.threadId);
    const { rel } = resolveIn(s.wt, p.path);
    const before = readText(s.wt, rel);
    if (p.expectBefore !== undefined && before !== p.expectBefore) throw new CodeError(409, `Файл ${rel} изменился — обновите и повторите`);
    if (before === p.after) return null;
    if (before === null && p.after === null) throw new CodeError(404, `Нет файла ${rel}`);
    writeText(s.wt, rel, p.after);
    const d = await udiff(rel, before, p.after);
    const edit: CodeEdit = { id: randomUUID(), threadId: p.threadId, userId: p.userId, messageId: p.messageId ?? null, callId: p.callId ?? null, path: rel, source: p.source,
      before, after: p.after, added: d.added, removed: d.removed, revertedAt: null, createdAt: Date.now() };
    getDb().insert(schema.codeEdits).values(edit).run();
    patch(p.threadId, {});
    notify(p.userId, p.threadId, 'edit');
    return { edit, diff: d.diff };
  });
}

export async function revertEdit(userId: string, threadId: string, editId: string): Promise<EditOut | null> {
  const e = getDb().select().from(schema.codeEdits).where(and(eq(schema.codeEdits.id, editId), eq(schema.codeEdits.threadId, threadId), eq(schema.codeEdits.userId, userId))).get();
  if (!e) throw new CodeError(404, 'Правка не найдена');
  if (e.revertedAt) throw new CodeError(409, 'Эта правка уже откачена');
  const s = ready(userId, threadId);
  const cur = readText(s.wt, e.path);
  let target: string | null;
  if (cur === e.after) target = e.before;
  else if (e.before === null || e.after === null || cur === null) throw new CodeError(409, `После этой правки файл ${e.path} меняли — сначала откатите более поздние правки`);
  else target = await merge3(cur, e.after, e.before, e.path);
  const out = await applyEdit({ userId, threadId, path: e.path, after: target, source: 'revert' });
  getDb().update(schema.codeEdits).set({ revertedAt: Date.now() }).where(eq(schema.codeEdits.id, e.id)).run();
  notify(userId, threadId, 'revert');
  return out;
}

export async function revertFile(userId: string, threadId: string, rel: string): Promise<EditOut | null> {
  const s = ready(userId, threadId);
  const { rel: r } = resolveIn(s.wt, rel);
  const base = await git(s.dirs, ['show', `${s.baseSha}:${r}`], { maxOut: 4 * 1024 * 1024 });
  const target = base.code === 0 ? base.out : null;
  const out = await applyEdit({ userId, threadId, path: r, after: target, source: 'revert' });
  getDb().update(schema.codeEdits).set({ revertedAt: Date.now() }).where(and(eq(schema.codeEdits.threadId, threadId), eq(schema.codeEdits.path, r))).run();
  return out;
}

export type FileChange = { path: string; added: number; removed: number; status: 'A' | 'M' | 'D' | 'R'; binary: boolean };

export async function branchDiff(userId: string, threadId: string, o: { path?: string; cap?: number } = {}): Promise<{ files: FileChange[]; diff: string; truncated: boolean; base: string; sha: string | null }> {
  const s = ready(userId, threadId);
  const spec = o.path ? ['--', resolveIn(s.wt, o.path).rel || '.'] : [];
  const tree = await snapshotTree(s);
  const num = await gitOk(s.dirs, ['diff', '--numstat', '-M', '--no-color', s.baseSha!, tree, ...spec]);
  const names = await gitOk(s.dirs, ['diff', '--name-status', '-M', '--no-color', s.baseSha!, tree, ...spec]);
  const st = new Map<string, FileChange['status']>();
  for (const l of names.split('\n').filter(Boolean)) { const [c, ...ps] = l.split('\t'); st.set(ps.at(-1)!, (c[0] as FileChange['status']) ?? 'M'); }
  const files: FileChange[] = num.split('\n').filter(Boolean).map((l) => {
    const [a, r, ...ps] = l.split('\t');
    const p = ps.join('\t');
    const real = p.includes(' => ') ? p.replace(/\{([^}]*) => ([^}]*)\}/, '$2').replace(/^.* => /, '') : p;
    return { path: real, added: a === '-' ? 0 : Number(a), removed: r === '-' ? 0 : Number(r), status: st.get(real) ?? 'M', binary: a === '-' };
  });
  const cap = o.cap ?? 200_000;
  const d = await git(s.dirs, ['diff', '-M', '--no-color', '-U3', s.baseSha!, tree, ...spec], { maxOut: cap + 1 });
  return { files, diff: d.out.slice(0, cap), truncated: d.out.length > cap, base: s.baseBranch, sha: s.baseSha };
}

export async function snapshotTree(s: { dirs: Dirs }): Promise<string> {
  const idx = path.join(path.dirname(s.dirs.gitDir), `index-${randomUUID()}`);
  try {
    const real = path.join(s.dirs.gitDir, 'index');
    if (fs.existsSync(real)) fs.copyFileSync(real, idx);
    const env = { GIT_INDEX_FILE: idx };
    await gitOk(s.dirs, ['add', '-A', '--', '.'], { env, timeoutMs: 120_000 });
    return (await gitOk(s.dirs, ['write-tree'], { env })).trim();
  } finally { fs.rmSync(idx, { force: true }); }
}

export type RunOut = { run: CodeRun; test: TestSummary | null; timedOut: boolean };

export async function runCommand(p: { userId: string; threadId: string; cmd: string; timeoutS?: number; messageId?: string | null; callId?: string | null; signal?: AbortSignal }): Promise<RunOut> {
  const s = ready(p.userId, p.threadId);
  const cmd = p.cmd.trim();
  if (!cmd) throw new CodeError(400, 'Пустая команда');
  if (cmd.length > 8000) throw new CodeError(400, 'Слишком длинная команда');
  notify(p.userId, p.threadId, 'run');
  const r = await runInBox(p.threadId, s.wt, cmd, { timeoutS: p.timeoutS, signal: p.signal, diskBytes: () => treeBytes(s.wt) });
  const test = parseTests(cmd, r.out, r.code);
  const run: CodeRun = { id: randomUUID(), threadId: p.threadId, userId: p.userId, messageId: p.messageId ?? null, callId: p.callId ?? null, cmd, exitCode: r.code,
    output: r.out.slice(-64_000), test, durationMs: r.ms, createdAt: Date.now() };
  getDb().insert(schema.codeRuns).values(run).run();
  if (test) patch(p.threadId, { tests: { cmd, ok: test.ok, passed: test.passed, failed: test.failed, framework: test.framework, at: run.createdAt, runId: run.id } });
  else patch(p.threadId, {});
  notify(p.userId, p.threadId, 'ran');
  return { run, test, timedOut: r.timedOut };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/[а-яё]/g, (c) => TR[c] ?? '').replace(/[^a-z0-9-]+/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'changes';
const TR: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
export const branchFor = (topic: string) => `korvex/${slug(topic)}`;

export type CommitOut = { sha: string; branch: string; files: number; added: number; removed: number; message: string };

export async function commit(p: { userId: string; threadId: string; message: string; topic?: string }): Promise<CommitOut> {
  return serial(p.threadId, async () => {
    const s = ready(p.userId, p.threadId);
    const msg = p.message.trim().replace(/\r/g, '');
    if (!msg) throw new CodeError(400, 'Нужно сообщение коммита');
    let branch = s.workBranch;
    if (!branch) {
      branch = branchFor(p.topic || msg.split('\n')[0]);
      const auth = await authOf(p.userId).catch(() => null);
      if (auth) {
        const ls = await git(s.dirs, ['ls-remote', '--heads', 'origin', `${branch}*`], { auth, timeoutMs: 30_000 });
        const taken = new Set(ls.out.split('\n').map((l) => l.split('\t')[1]?.replace('refs/heads/', '')).filter(Boolean));
        for (let i = 2; taken.has(branch!) && i < 100; i++) branch = `${branchFor(p.topic || msg.split('\n')[0])}-${i}`;
      }
      if (!validBranch(branch)) throw new CodeError(400, 'Неверное имя ветки');
      await gitOk(s.dirs, ['checkout', '-q', '-b', branch]);
      patch(p.threadId, { workBranch: branch });
    }
    await gitOk(s.dirs, ['add', '-A', '--', '.']);
    const staged = await git(s.dirs, ['diff', '--cached', '--quiet']);
    if (staged.code === 0) throw new CodeError(409, 'Нечего коммитить: изменений нет');
    const stat = await gitOk(s.dirs, ['diff', '--cached', '--numstat']);
    const trailers = coauthorTrailers(p.userId);
    const full = `${msg}${trailers.length ? `\n\n${trailers.join('\n')}` : ''}\n`;
    const bot = BOT();
    const env = { GIT_AUTHOR_NAME: bot.name, GIT_AUTHOR_EMAIL: bot.email, GIT_COMMITTER_NAME: bot.name, GIT_COMMITTER_EMAIL: bot.email };
    const r = await git(s.dirs, ['commit', '-q', '--no-verify', '-F', '-'], { env, input: full });
    if (r.code !== 0) throw new CodeError(500, `Коммит не удался: ${r.err.trim().slice(0, 300)}`);
    const sha = (await gitOk(s.dirs, ['rev-parse', 'HEAD'])).trim();
    let added = 0, removed = 0, files = 0;
    for (const l of stat.split('\n').filter(Boolean)) { const [a, d] = l.split('\t'); files++; added += Number(a) || 0; removed += Number(d) || 0; }
    patch(p.threadId, {});
    notify(p.userId, p.threadId, 'commit');
    return { sha, branch, files, added, removed, message: msg };
  });
}

export async function unpushed(userId: string, threadId: string): Promise<{ sha: string; subject: string }[]> {
  const s = ready(userId, threadId);
  if (!s.workBranch) return [];
  const from = s.pushedSha || s.baseSha;
  const out = await gitOk(s.dirs, ['log', '--format=%H%x09%s', `${from}..HEAD`]);
  return out.split('\n').filter(Boolean).map((l) => { const [sha, ...r] = l.split('\t'); return { sha, subject: r.join('\t') }; });
}

export async function dirty(userId: string, threadId: string): Promise<boolean> {
  const s = ready(userId, threadId);
  const r = await git(s.dirs, ['status', '--porcelain', '--untracked-files=normal']);
  return r.out.trim().length > 0;
}

export type PrOut = { url: string; number: number; branch: string; created: boolean; pushed: number };

export async function pushAndPr(p: { userId: string; threadId: string; title: string; body?: string; draft?: boolean; signal?: AbortSignal }): Promise<PrOut> {
  if (await dirty(p.userId, p.threadId)) await commit({ userId: p.userId, threadId: p.threadId, message: p.title });
  return serial(p.threadId, async () => {
    const s = ready(p.userId, p.threadId);
    if (!s.workBranch) throw new CodeError(409, 'Нет коммитов: сначала сделайте коммит');
    const auth = await authOf(p.userId);
    const list = await unpushed(p.userId, p.threadId);
    const r = await git(s.dirs, ['push', '--porcelain', 'origin', `HEAD:refs/heads/${s.workBranch}`], { auth, timeoutMs: 5 * 60_000, signal: p.signal });
    if (r.code !== 0) {
      const why = /non-fast-forward|fetch first|rejected/.test(r.err) ? 'в GitHub в этой ветке есть чужие коммиты' : /403|denied|permission/i.test(r.err) ? 'у токена нет права на запись (Contents: write)' : r.err.trim().split('\n').slice(-2).join(' ').slice(0, 300);
      throw new CodeError(502, `Push не удался: ${why}`);
    }
    const sha = (await gitOk(s.dirs, ['rev-parse', 'HEAD'])).trim();
    patch(p.threadId, { pushedSha: sha });
    let pr = await findPull(auth.token, s.repo, s.workBranch).catch(() => null);
    let created = false;
    if (!pr) {
      const trailers = coauthorTrailers(p.userId);
      const body = `${(p.body ?? '').trim()}\n\n---\nСделано облачным агентом Korvex AI по просьбе @${accountOf(p.userId)?.login ?? ''}.${trailers.length ? '' : ''}`.trim();
      let last: unknown = null;
      for (let i = 0; i < 5 && !pr; i++) {
        try { pr = await createPull(auth.token, s.repo, { title: p.title.trim().slice(0, 250), body, head: s.workBranch, base: s.baseBranch, draft: p.draft }); }
        catch (e) {
          last = e;
          const st = e instanceof GhError ? e.status : 0;
          if (st !== 404 && st !== 422 && st !== 409 && st < 500) break;
          await new Promise((r) => setTimeout(r, 800 * (i + 1)));
          pr = await findPull(auth.token, s.repo, s.workBranch).catch(() => null);
        }
      }
      if (!pr) throw new CodeError(502, `Ветка отправлена, но PR не создан: ${(last as Error | null)?.message ?? 'нет ответа'}`);
      created = true;
    }
    patch(p.threadId, { prUrl: pr.htmlUrl, prNumber: pr.number });
    notify(p.userId, p.threadId, 'pr');
    return { url: pr.htmlUrl, number: pr.number, branch: s.workBranch, created, pushed: list.length };
  });
}

export type CodeState = {
  repo: string; repoUrl: string; baseBranch: string; workBranch: string | null; status: string; error: string | null; origin: string;
  prUrl: string | null; prNumber: number | null; tests: Record<string, unknown> | null; unpushed: number; dirty: boolean;
  files: FileChange[]; edits: Omit<CodeEdit, 'before' | 'after'>[]; runs: Omit<CodeRun, 'output'>[];
};

export async function stateOf(userId: string, threadId: string): Promise<CodeState | null> {
  const s = ownSession(userId, threadId);
  if (!s) return null;
  const db = getDb();
  const edits = db.select({ id: schema.codeEdits.id, threadId: schema.codeEdits.threadId, userId: schema.codeEdits.userId, messageId: schema.codeEdits.messageId, callId: schema.codeEdits.callId,
    path: schema.codeEdits.path, source: schema.codeEdits.source, added: schema.codeEdits.added, removed: schema.codeEdits.removed, revertedAt: schema.codeEdits.revertedAt, createdAt: schema.codeEdits.createdAt })
    .from(schema.codeEdits).where(eq(schema.codeEdits.threadId, threadId)).orderBy(desc(schema.codeEdits.createdAt)).limit(300).all();
  const runs = db.select({ id: schema.codeRuns.id, threadId: schema.codeRuns.threadId, userId: schema.codeRuns.userId, messageId: schema.codeRuns.messageId, callId: schema.codeRuns.callId,
    cmd: schema.codeRuns.cmd, exitCode: schema.codeRuns.exitCode, test: schema.codeRuns.test, durationMs: schema.codeRuns.durationMs, createdAt: schema.codeRuns.createdAt })
    .from(schema.codeRuns).where(eq(schema.codeRuns.threadId, threadId)).orderBy(desc(schema.codeRuns.createdAt)).limit(100).all();
  let files: FileChange[] = [], up = 0, dt = false;
  if (s.status === 'ready') {
    try { files = (await branchDiff(userId, threadId, { cap: 1 })).files; up = (await unpushed(userId, threadId)).length; dt = await dirty(userId, threadId); } catch (e) { console.error('[code] state', (e as Error).message); }
  }
  return { repo: s.repo, repoUrl: `${webBase()}/${s.repo}`, baseBranch: s.baseBranch, workBranch: s.workBranch, status: s.status, error: s.error, origin: s.origin, prUrl: s.prUrl,
    prNumber: s.prNumber, tests: s.tests ?? null, unpushed: up, dirty: dt, files, edits, runs };
}

export function editOf(userId: string, threadId: string, id: string): CodeEdit | undefined {
  return getDb().select().from(schema.codeEdits).where(and(eq(schema.codeEdits.id, id), eq(schema.codeEdits.threadId, threadId), eq(schema.codeEdits.userId, userId))).get();
}
export function runOf(userId: string, threadId: string, id: string): CodeRun | undefined {
  return getDb().select().from(schema.codeRuns).where(and(eq(schema.codeRuns.id, id), eq(schema.codeRuns.threadId, threadId), eq(schema.codeRuns.userId, userId))).get();
}

export async function sweepOrphans(): Promise<{ dirs: number; boxes: number }> {
  const db = getDb();
  const alive = new Set(db.select({ id: schema.codeSessions.threadId }).from(schema.codeSessions).all().map((r) => r.id));
  let dirs = 0, boxes = 0;
  try {
    for (const name of fs.readdirSync(codeRoot())) {
      if (name === 'net' || alive.has(name)) continue;
      fs.rmSync(path.join(codeRoot(), name), { recursive: true, force: true });
      dirs++;
    }
  } catch {  }
  for (const b of await listBoxes()) if (!alive.has(b.threadId)) { await stopBox(b.threadId); boxes++; }
  return { dirs, boxes };
}

export async function dropSession(threadId: string): Promise<void> {
  await stopBox(threadId).catch(() => null);
  try { fs.rmSync(dirsOf(threadId).root, { recursive: true, force: true }); } catch {  }
}

export { FsError };
