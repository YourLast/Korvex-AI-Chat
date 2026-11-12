import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Dirs = { gitDir: string; workTree: string };
export type Auth = { login: string; token: string };
export type GitRes = { code: number; out: string; err: string };

const BASE_CFG: [string, string][] = [
  ['core.hooksPath', '/dev/null'], ['core.fsmonitor', 'false'], ['core.pager', 'cat'], ['core.editor', 'true'], ['core.quotePath', 'false'],
  ['core.autocrlf', 'false'], ['credential.helper', ''], ['gc.auto', '0'], ['maintenance.auto', 'false'], ['advice.detachedHead', 'false'],
  ['init.defaultBranch', 'main'], ['protocol.file.allow', 'never'], ['protocol.ext.allow', 'never'], ['submodule.recurse', 'false'],
  ['diff.renames', 'true'], ['safe.directory', '*'], ['color.ui', 'false'],
];

const JUNK = ['__pycache__/', '*.py[cod]', '.pytest_cache/', '.mypy_cache/', '.ruff_cache/', '.tox/', '.nox/', '.venv/', 'venv/', '.coverage', 'htmlcov/',
  'node_modules/', '.npm/', '.yarn/cache/', '.pnpm-store/', '.next/', '.turbo/', '.cache/', '.gradle/', 'target/debug/', '.DS_Store'];
let excludes: string | null = null;
function excludesFile(): string {
  if (excludes && fs.existsSync(excludes)) return excludes;
  const f = path.join(os.tmpdir(), 'korvex-code-excludes');
  try { fs.writeFileSync(f, JUNK.join('\n') + '\n', { mode: 0o644 }); } catch {  }
  return (excludes = f);
}

function env(dirs: Dirs | null, auth?: Auth, extra?: Record<string, string>): NodeJS.ProcessEnv {
  const cfg = [...BASE_CFG, ['core.excludesFile', excludesFile()] as [string, string]];
  if (auth) cfg.push(['http.extraHeader', `Authorization: Basic ${Buffer.from(`${auth.login}:${auth.token}`).toString('base64')}`]);
  const e: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: os.tmpdir(), LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/false', SSH_ASKPASS: '/bin/false',
    GIT_NO_REPLACE_OBJECTS: '1', GIT_PROTOCOL_FROM_USER: '0', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_COUNT: String(cfg.length),
  };
  cfg.forEach(([k, v], i) => { e[`GIT_CONFIG_KEY_${i}`] = k; e[`GIT_CONFIG_VALUE_${i}`] = v; });
  if (dirs) { e.GIT_DIR = dirs.gitDir; e.GIT_WORK_TREE = dirs.workTree; }
  else e.GIT_CEILING_DIRECTORIES = '/';
  return { ...e, ...(extra ?? {}) } as unknown as NodeJS.ProcessEnv;
}

export function redact(s: string, auth?: Auth): string {
  let out = s.replace(/Authorization: (?:Basic|Bearer|token) [A-Za-z0-9+/=._-]+/gi, 'Authorization: ***');
  if (auth?.token) out = out.split(auth.token).join('***');
  return out.replace(/(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '***');
}

export function git(dirs: Dirs | null, args: string[], o: { auth?: Auth; timeoutMs?: number; input?: string | Buffer; cwd?: string; maxOut?: number; signal?: AbortSignal; env?: Record<string, string> } = {}): Promise<GitRes> {
  const maxOut = o.maxOut ?? 8 * 1024 * 1024;
  return new Promise((resolve) => {
    const p = spawn('git', args, { cwd: o.cwd ?? dirs?.workTree ?? os.tmpdir(), env: env(dirs, o.auth, o.env), stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [], err: Buffer[] = [];
    let n = 0, cut = false;
    p.stdout.on('data', (b: Buffer) => { if (n < maxOut) { out.push(b); n += b.length; } else cut = true; });
    p.stderr.on('data', (b: Buffer) => { if (err.length < 200) err.push(b); });
    const kill = () => { try { p.kill('SIGKILL'); } catch {  } };
    const t = setTimeout(kill, o.timeoutMs ?? 60_000);
    o.signal?.addEventListener('abort', kill, { once: true });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: '', err: redact(e.message, o.auth) }); });
    p.on('close', (code, sig) => {
      clearTimeout(t);
      o.signal?.removeEventListener('abort', kill);
      const so = Buffer.concat(out).toString('utf8');
      resolve({ code: code ?? (sig ? 137 : -1), out: cut ? so.slice(0, maxOut) : so, err: redact(Buffer.concat(err).toString('utf8'), o.auth) + (sig ? `\n[git остановлен: ${sig}]` : '') });
    });
    if (o.input !== undefined) p.stdin.end(o.input); else p.stdin.end();
  });
}

export async function gitOk(dirs: Dirs | null, args: string[], o: Parameters<typeof git>[2] = {}): Promise<string> {
  const r = await git(dirs, args, o);
  if (r.code !== 0) throw new Error(`git ${args[0]}: ${(r.err.trim().split('\n').filter((l) => !/^hint:/.test(l)).slice(-3).join(' ') || `код ${r.code}`).slice(0, 400)}`);
  return r.out;
}
