import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { ensureNetProxy, netMode, SANDBOX_CA, sockDir } from './netproxy';
import { dataDir } from '../db';

export const IMAGE = () => process.env.KORVEX_CODE_IMAGE || 'korvex-code:1';
const MEM = () => process.env.KORVEX_CODE_MEM || '2g';
const CPUS = () => process.env.KORVEX_CODE_CPUS || '2';
export const DISK_MB = () => Number(process.env.KORVEX_CODE_DISK_MB || 2048);
const IDLE_MS = () => Number(process.env.KORVEX_CODE_IDLE_MIN || 20) * 60_000;
const OUT_MAX = 400_000;

export const instanceId = () => createHash('sha256').update(safeReal(dataDir())).digest('hex').slice(0, 12);
function safeReal(p: string): string { try { return fs.realpathSync(p); } catch { return p; } }

export const containerName = (threadId: string) => `kxcode-${createHash('sha256').update(threadId).digest('hex').slice(0, 16)}`;

type DRes = { code: number; out: string; err: string; timedOut: boolean; ms: number };

function docker(args: string[], o: { timeoutMs?: number; signal?: AbortSignal; onKill?: () => void; maxOut?: number } = {}): Promise<DRes> {
  const t0 = Date.now();
  const maxOut = o.maxOut ?? OUT_MAX;
  return new Promise((resolve) => {
    const p = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' } as unknown as NodeJS.ProcessEnv });
    let head = '', tail = '', total = 0, err = '';
    const take = (s: string) => {
      total += s.length;
      if (head.length < maxOut / 2) { const k = maxOut / 2 - head.length; head += s.slice(0, k); s = s.slice(k); }
      if (s) tail = (tail + s).slice(-maxOut / 2);
    };
    p.stdout.on('data', (b: Buffer) => take(b.toString('utf8')));
    p.stderr.on('data', (b: Buffer) => { if (err.length < 20_000) err += b.toString('utf8'); });
    let timedOut = false;
    const kill = () => { o.onKill?.(); try { p.kill('SIGKILL'); } catch {  } };
    const t = setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs ?? 60_000);
    o.signal?.addEventListener('abort', kill, { once: true });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: '', err: e.message, timedOut, ms: Date.now() - t0 }); });
    p.on('close', (code) => {
      clearTimeout(t);
      o.signal?.removeEventListener('abort', kill);
      const out = total > head.length + tail.length ? `${head}\n… [пропущено ${total - head.length - tail.length} симв.] …\n${tail}` : head + tail;
      resolve({ code: code ?? -1, out, err, timedOut, ms: Date.now() - t0 });
    });
  });
}

type Box = { lastUse: number; starting?: Promise<void> };
const g = globalThis as unknown as { __kxBoxes?: Map<string, Box>; __kxBoxSweep?: NodeJS.Timeout };
const boxes = () => (g.__kxBoxes ??= new Map());

let imageOk: { at: number; ok: boolean } | null = null;
export async function sandboxAvailable(): Promise<boolean> {
  if (imageOk && Date.now() - imageOk.at < 60_000) return imageOk.ok;
  const r = await docker(['image', 'inspect', IMAGE(), '--format', '{{.Id}}'], { timeoutMs: 15_000 });
  imageOk = { at: Date.now(), ok: r.code === 0 };
  return imageOk.ok;
}

async function running(name: string): Promise<boolean> {
  const r = await docker(['inspect', '-f', '{{.State.Running}}', name], { timeoutMs: 15_000 });
  return r.code === 0 && r.out.trim() === 'true';
}

export async function ensureBox(threadId: string, workTree: string): Promise<void> {
  const name = containerName(threadId);
  const b = boxes().get(name) ?? { lastUse: Date.now() };
  boxes().set(name, b);
  b.lastUse = Date.now();
  if (b.starting) return b.starting;
  b.starting = (async () => {
    if (await running(name)) return;
    if (!(await sandboxAvailable())) throw new Error(`песочница недоступна: нет образа ${IMAGE()} или docker`);
    await docker(['rm', '-f', name], { timeoutMs: 30_000 });
    const real = fs.realpathSync(workTree);
    const uid = process.getuid?.() ?? 1000, gid = process.getgid?.() ?? 1000;
    const args = ['run', '-d', '--rm', '--name', name, '--label', 'korvex.code=1', '--label', `korvex.thread=${threadId}`, '--label', `korvex.instance=${instanceId()}`,
      '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,exec,size=1g,mode=1777', '--memory', MEM(), '--memory-swap', MEM(), '--cpus', CPUS(),
      '--pids-limit', '512', '--user', `${uid}:${gid}`, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--log-driver', 'none',
      '--mount', `type=bind,src=${real},dst=/work/repo`, '-w', '/work/repo', '-e', 'HOME=/tmp', '-e', 'CI=1', '-e', 'TERM=dumb', '-e', 'PYTHONDONTWRITEBYTECODE=1', '-e', 'PYTEST_ADDOPTS=-p no:cacheprovider'];
    if (netMode() !== 'off' && ensureNetProxy()) {
      args.push('--mount', `type=bind,src=${sockDir()},dst=/run/kx,readonly`,
        '-e', 'HTTPS_PROXY=http://127.0.0.1:3128', '-e', 'https_proxy=http://127.0.0.1:3128', '-e', 'HTTP_PROXY=http://127.0.0.1:3128', '-e', 'http_proxy=http://127.0.0.1:3128',
        '-e', 'NO_PROXY=', '-e', 'npm_config_proxy=http://127.0.0.1:3128', '-e', 'npm_config_https_proxy=http://127.0.0.1:3128',
        '-e', `SSL_CERT_FILE=${SANDBOX_CA}`, '-e', `REQUESTS_CA_BUNDLE=${SANDBOX_CA}`, '-e', `PIP_CERT=${SANDBOX_CA}`, '-e', `CURL_CA_BUNDLE=${SANDBOX_CA}`,
        '-e', `NODE_EXTRA_CA_CERTS=${SANDBOX_CA}`, '-e', `npm_config_cafile=${SANDBOX_CA}`, '-e', `GIT_SSL_CAINFO=${SANDBOX_CA}`,
        '-e', 'npm_config_audit=false', '-e', 'npm_config_fund=false', '-e', 'npm_config_update_notifier=false');
    }
    args.push(IMAGE());
    const r = await docker(args, { timeoutMs: 90_000 });
    if (r.code !== 0) throw new Error(`песочница не запустилась: ${(r.err.trim().split('\n').at(-1) ?? '').slice(0, 300)}`);
    sweepLater();
  })().finally(() => { b.starting = undefined; });
  return b.starting;
}

export type RunRes = { code: number; out: string; ms: number; timedOut: boolean; diskFull: boolean };

export async function runInBox(threadId: string, workTree: string, cmd: string, o: { timeoutS?: number; signal?: AbortSignal; diskBytes?: () => number } = {}): Promise<RunRes> {
  await ensureBox(threadId, workTree);
  const name = containerName(threadId);
  const timeoutS = Math.max(5, Math.min(o.timeoutS ?? 300, 1800));
  const killAll = () => { void docker(['exec', name, 'sh', '-c', 'kill -9 -1 2>/dev/null; true'], { timeoutMs: 20_000 }); };
  let diskFull = false;
  const limit = DISK_MB() * 1024 * 1024;
  const watch = o.diskBytes ? setInterval(() => { try { if (o.diskBytes!() > limit) { diskFull = true; killAll(); } } catch {  } }, 2000) : null;
  const r = await docker(['exec', '-w', '/work/repo', name, 'timeout', '-s', 'KILL', String(timeoutS), 'bash', '-c', `exec 2>&1; ${cmd}`],
    { timeoutMs: (timeoutS + 20) * 1000, signal: o.signal, onKill: killAll });
  if (watch) clearInterval(watch);
  const b = boxes().get(name);
  if (b) b.lastUse = Date.now();
  const timedOut = r.timedOut || r.code === 137 && r.ms >= timeoutS * 1000 - 500;
  let out = r.out + (r.err && r.code !== 0 && !r.out ? r.err : '');
  if (timedOut) out += `\n[остановлено: прошло ${timeoutS} с]`;
  if (diskFull) out += `\n[остановлено: рабочее дерево больше ${DISK_MB()} МБ — удалите лишнее]`;
  return { code: r.code, out, ms: r.ms, timedOut, diskFull };
}

export async function stopBox(threadId: string): Promise<void> {
  const name = containerName(threadId);
  boxes().delete(name);
  await docker(['rm', '-f', name], { timeoutMs: 40_000 });
}

export async function listBoxes(): Promise<{ name: string; threadId: string }[]> {
  const r = await docker(['ps', '-a', '--filter', 'label=korvex.code=1', '--filter', `label=korvex.instance=${instanceId()}`, '--format', '{{.Names}}\t{{.Label "korvex.thread"}}'], { timeoutMs: 30_000 });
  if (r.code !== 0) return [];
  return r.out.split('\n').filter(Boolean).map((l) => { const [name, threadId] = l.split('\t'); return { name, threadId: threadId ?? '' }; });
}

function sweepLater() {
  if (g.__kxBoxSweep) return;
  g.__kxBoxSweep = setInterval(() => {
    const now = Date.now();
    for (const [name, b] of boxes()) {
      if (b.starting || now - b.lastUse < IDLE_MS()) continue;
      boxes().delete(name);
      void docker(['rm', '-f', name], { timeoutMs: 40_000 });
    }
    if (!boxes().size && g.__kxBoxSweep) { clearInterval(g.__kxBoxSweep); g.__kxBoxSweep = undefined; }
  }, 5 * 60_000);
  g.__kxBoxSweep.unref?.();
}
