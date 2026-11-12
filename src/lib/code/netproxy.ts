import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dataDir } from '../db';

export type NetMode = 'off' | 'packages' | 'open';
export const netMode = (): NetMode => {
  const v = (process.env.KORVEX_CODE_NET || 'packages').toLowerCase();
  return v === 'off' || v === 'open' ? v : 'packages';
};

export const PACKAGE_HOSTS = [
  'pypi.org', 'files.pythonhosted.org', 'registry.npmjs.org', 'registry.yarnpkg.com', 'nodejs.org',
  'codeload.github.com', 'raw.githubusercontent.com',
  'proxy.golang.org', 'sum.golang.org', 'static.crates.io', 'index.crates.io', 'crates.io', 'static.rust-lang.org',
  'rubygems.org', 'index.rubygems.org', 'repo.maven.apache.org', 'repo1.maven.org', 'plugins.gradle.org', 'services.gradle.org',
  'download.pytorch.org',
];

export const MAX_PATH = 400;
export const MAX_QUERY = 200;

const NPM_NAME = String.raw`(?:@[a-z0-9][a-z0-9._~-]{0,100}(?:/|%2[fF]))?[a-z0-9][a-z0-9._~-]{0,113}`;
const PY_NAME = String.raw`[A-Za-z0-9][A-Za-z0-9._-]{0,99}`;
const VER = String.raw`[A-Za-z0-9._+!-]{1,64}`;
const GO_MOD = String.raw`(?:github\.com/[A-Za-z0-9_.!-]{1,39}/[A-Za-z0-9_.!-]{1,100}|golang\.org/x/[a-z0-9]{1,30}|google\.golang\.org/[a-z0-9]{1,30}|gopkg\.in/(?:[A-Za-z0-9_.!-]{1,39}/)?[A-Za-z0-9_.!-]{1,60}\.v\d{1,3}|(?:go\.uber\.org|k8s\.io|sigs\.k8s\.io|go\.opentelemetry\.io|go\.etcd\.io|cloud\.google\.com/go|gotest\.tools|gonum\.org/v1|honnef\.co/go|mvdan\.cc|modernc\.org)/[a-z0-9._!-]{1,60})(?:/[A-Za-z0-9._!~-]{1,60}){0,4}`;

export const PATH_RULES: Record<string, RegExp[]> = {
  'pypi.org': [new RegExp(`^/simple/(?:${PY_NAME}/)?$`), new RegExp(`^/pypi/${PY_NAME}/(?:${VER}/)?json$`)],
  'files.pythonhosted.org': [/^\/packages\/[A-Za-z0-9._\/-]{1,300}$/],
  'registry.npmjs.org': [new RegExp(`^/${NPM_NAME}/?$`), new RegExp(`^/${NPM_NAME}/-/[a-z0-9._~-]{1,180}\\.tgz$`), new RegExp(`^/${NPM_NAME}/${VER}$`)],
  'registry.yarnpkg.com': [new RegExp(`^/${NPM_NAME}/?$`), new RegExp(`^/${NPM_NAME}/-/[a-z0-9._~-]{1,180}\\.tgz$`)],
  'nodejs.org': [/^\/(?:dist|download\/release)\/v?\d{1,3}\.\d{1,3}\.\d{1,3}\/[A-Za-z0-9._\/-]{1,120}$/, /^\/dist\/index\.json$/],
  'codeload.github.com': [/^\/[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}\/(?:tar\.gz|zip|legacy\.tar\.gz)\/[A-Za-z0-9_.\/-]{1,100}$/],
  'raw.githubusercontent.com': [/^\/[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.\/-]{1,200}$/],
  'proxy.golang.org': [new RegExp(`^/${GO_MOD}/@(?:v/(?:list|${VER}\\.(?:info|mod|zip))|latest)$`)],
  'sum.golang.org': [new RegExp(`^/lookup/${GO_MOD}@${VER}$`), /^\/tile\/\d{1,2}\/(?:data\/)?[0-9x\/.p]{1,80}$/, /^\/latest$/],
  'static.crates.io': [/^\/crates\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_.+-]{1,100}\.crate$/],
  'index.crates.io': [/^\/(?:config\.json|[0-9]\/[A-Za-z0-9_-]{1,64}|[a-z0-9_-]{2}\/[a-z0-9_-]{2}\/[A-Za-z0-9_-]{1,64}|3\/[a-z0-9_-]\/[A-Za-z0-9_-]{1,64})$/],
  'crates.io': [/^\/api\/v1\/crates\/[A-Za-z0-9_-]{1,64}(?:\/[A-Za-z0-9_.+-]{1,64}\/download)?$/],
  'static.rust-lang.org': [/^\/(?:dist|rustup)\/[A-Za-z0-9._\/-]{1,160}$/],
  'rubygems.org': [/^\/(?:gems|quick\/Marshal\.4\.8)\/[A-Za-z0-9._-]{1,120}\.(?:gem|gemspec\.rz)$/, /^\/info\/[A-Za-z0-9._-]{1,80}$/, /^\/versions$/, /^\/api\/v1\/dependencies$/],
  'index.rubygems.org': [/^\/info\/[A-Za-z0-9._-]{1,80}$/, /^\/versions$/],
  'repo.maven.apache.org': [/^\/maven2\/[A-Za-z0-9._\/-]{1,250}$/],
  'repo1.maven.org': [/^\/maven2\/[A-Za-z0-9._\/-]{1,250}$/],
  'plugins.gradle.org': [/^\/m2\/[A-Za-z0-9._\/-]{1,250}$/],
  'services.gradle.org': [/^\/distributions\/gradle-[0-9.]{1,20}(?:-rc-\d+)?-(?:bin|all)\.zip(?:\.sha256)?$/],
  'download.pytorch.org': [/^\/whl\/[A-Za-z0-9._\/%+-]{1,200}$/],
};

export function pathAllowed(host: string, url: string): { ok: true } | { ok: false; why: string } {
  const q = url.indexOf('?');
  const path = q >= 0 ? url.slice(0, q) : url;
  const query = q >= 0 ? url.slice(q + 1) : '';
  if (path.length > MAX_PATH) return { ok: false, why: `путь длиннее ${MAX_PATH}` };
  if (query.length > MAX_QUERY) return { ok: false, why: `запрос длиннее ${MAX_QUERY}` };
  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]*$/.test(path)) return { ok: false, why: 'символы в пути' };
  if (/%(?![0-9A-Fa-f]{2})/.test(path) || /\/\.\.?(\/|$)/.test(path)) return { ok: false, why: 'путь' };
  const rules = PATH_RULES[host];
  if (!rules) return netMode() === 'open' ? { ok: true } : { ok: false, why: 'хост без правил' };
  return rules.some((r) => r.test(path)) ? { ok: true } : { ok: false, why: 'путь не похож на пакет' };
}

export const UPLOAD_HOSTS = ['upload.pypi.org', 'test.pypi.org', 'test-files.pythonhosted.org', 'uploads.github.com', 'api.github.com', 'github.com',
  'npm.pkg.github.com', 'maven.pkg.github.com', 'rubygems.pkg.github.com', 'nuget.pkg.github.com', 'upload.crates.io', 'oss.sonatype.org', 's01.oss.sonatype.org',
  'anaconda.org', 'api.anaconda.org'];
export const ALLOWED_METHODS = ['GET', 'HEAD'];

const block = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) block.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]] as const) block.addSubnet(a, p, 'ipv6');

export function privateAddr(ip: string): boolean {
  const v = net.isIP(ip);
  if (!v) return true;
  if (v === 6) {
    const m = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return block.check(m[1], 'ipv4');
    return block.check(ip, 'ipv6');
  }
  return block.check(ip, 'ipv4');
}

export function hostAllowed(host: string, mode: NetMode = netMode()): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (mode === 'off' || !/^[a-z0-9.-]{1,253}$/.test(h) || net.isIP(h)) return false;
  if (UPLOAD_HOSTS.includes(h)) return false;
  if (mode === 'open') return h.includes('.') && !h.endsWith('.local') && !h.endsWith('.internal') && h !== 'localhost';
  return PACKAGE_HOSTS.includes(h);
}

type Stat = { host: string; n: number; denied: number };
export type NetEvent = { at: number; host: string; method: string; path: string; verdict: 'denied-host' | 'denied-method' | 'denied-address' | 'denied-path'; why?: string };
type State = { srv: net.Server | null; sock: string; log: Map<string, Stat>; events: NetEvent[]; mitm: http.Server | null };
const g = globalThis as unknown as { __kxNet?: State };
export const sockDir = () => path.join(dataDir(), 'code', 'net');
const caDir = () => path.join(dataDir(), 'code', 'ca');
export const netLog = () => [...(g.__kxNet?.log.values() ?? [])];
export const netEvents = () => [...(g.__kxNet?.events ?? [])];

function stat(host: string): Stat {
  const st = g.__kxNet!.log.get(host) ?? { host, n: 0, denied: 0 };
  g.__kxNet!.log.set(host, st);
  return st;
}
function denyEvent(e: Omit<NetEvent, 'at'>) {
  const s = g.__kxNet!;
  s.events.push({ ...e, at: Date.now() });
  if (s.events.length > 500) s.events.splice(0, s.events.length - 500);
  stat(e.host).denied++;
  console.log(`[code-net] запрет (${e.verdict}${e.why ? `: ${e.why}` : ''}): ${e.method} ${e.host}${e.path}`.slice(0, 300));
}

type Ca = { crtPath: string; keyPath: string; leafKey: string; ctx: Map<string, tls.SecureContext> };
let ca: Ca | null = null;

export function ensureCa(): Ca {
  if (ca && fs.existsSync(/*turbopackIgnore: true*/ ca.crtPath)) return ca;
  const d = caDir();
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const keyPath = path.join(d, 'ca.key'), crtPath = path.join(d, 'ca.crt'), leafPath = path.join(d, 'leaf.key');
  if (!fs.existsSync(keyPath) || !fs.existsSync(crtPath)) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', keyPath, '-out', crtPath, '-days', '3650',
      '-subj', '/CN=Korvex Sandbox Proxy CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'], { stdio: 'ignore' });
    fs.chmodSync(keyPath, 0o600);
  }
  if (!fs.existsSync(leafPath)) { execFileSync('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', leafPath], { stdio: 'ignore' }); fs.chmodSync(leafPath, 0o600); }
  fs.mkdirSync(sockDir(), { recursive: true, mode: 0o755 });
  fs.copyFileSync(crtPath, path.join(sockDir(), 'ca.crt'));
  fs.chmodSync(path.join(sockDir(), 'ca.crt'), 0o644);
  ca = { crtPath, keyPath, leafKey: fs.readFileSync(leafPath, 'utf8'), ctx: new Map() };
  return ca;
}

function contextFor(host: string): tls.SecureContext {
  const c = ensureCa();
  const hit = c.ctx.get(host);
  if (hit) return hit;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kxleaf-'));
  try {
    const out = path.join(tmp, 'leaf.crt');
    execFileSync('openssl', ['req', '-x509', '-new', '-key', path.join(caDir(), 'leaf.key'), '-CA', c.crtPath, '-CAkey', c.keyPath, '-subj', `/CN=${host}`,
      '-addext', `subjectAltName=DNS:${host}`, '-addext', 'extendedKeyUsage=serverAuth', '-addext', 'basicConstraints=critical,CA:FALSE',
      '-addext', 'keyUsage=critical,digitalSignature', '-set_serial', '0x' + randomBytes(12).toString('hex'), '-days', '397', '-out', out], { stdio: 'ignore' });
    const ctx = tls.createSecureContext({ key: c.leafKey, cert: fs.readFileSync(out, 'utf8') });
    c.ctx.set(host, ctx);
    return ctx;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function resolvePublic(host: string): Promise<{ address: string; family: number } | null> {
  const all = await dns.lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!all.length || all.some((a) => privateAddr(a.address))) return null;
  return all[0];
}

const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

function mitmServer(): http.Server {
  const st = g.__kxNet!;
  if (st.mitm) return st.mitm;
  const srv = http.createServer((req, res) => {
    const sock = req.socket as tls.TLSSocket & { kxHost?: string; kxAddr?: { address: string; family: number } };
    const host = sock.kxHost!, addr = sock.kxAddr!;
    const method = (req.method ?? '').toUpperCase();
    const p = (req.url ?? '/').startsWith('/') ? req.url ?? '/' : '/';
    if (!ALLOWED_METHODS.includes(method) || req.headers.upgrade) {
      denyEvent({ host, method, path: p.slice(0, 160), verdict: 'denied-method' });
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
      res.end(`Korvex sandbox: only downloads (GET, HEAD) are allowed; ${method} ${host} is blocked.\n`);
      req.resume();
      return;
    }
    const pa = pathAllowed(host, p);
    if (!pa.ok) {
      denyEvent({ host, method, path: p.slice(0, 200), verdict: 'denied-path', why: pa.why });
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
      res.end(`Korvex sandbox: this path is not a package download (${pa.why}).\n`);
      req.resume();
      return;
    }
    stat(host).n++;
    const headers: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !HOP.has(k.toLowerCase())) headers[k] = v;
    headers.host = host;
    const up = https.request({
      hostname: host, port: 443, method, path: p, headers, servername: host, timeout: 60_000,
      lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) => (o?.all ? cb(null, [addr]) : cb(null, addr.address, addr.family))) as never,
    }, (ur) => {
      const h: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(ur.headers)) if (v !== undefined && !HOP.has(k.toLowerCase())) h[k] = v;
      res.writeHead(ur.statusCode ?? 502, h);
      ur.pipe(res);
    });
    up.on('timeout', () => up.destroy(new Error('timeout')));
    up.on('error', () => { if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('Bad Gateway\n'); } else res.destroy(); });
    req.pipe(up);
  });
  srv.keepAliveTimeout = 15_000;
  srv.on('clientError', (_e, s) => { try { s.destroy(); } catch {  } });
  st.mitm = srv;
  return srv;
}

function handle(c: net.Socket) {
  let buf = Buffer.alloc(0);
  const deny = (code: number, why: string) => { try { c.end(`HTTP/1.1 ${code} ${why}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`); } catch {  } };
  c.setTimeout(30_000, () => c.destroy());
  c.on('error', () => c.destroy());
  const onData = async (b: Buffer) => {
    buf = Buffer.concat([buf, b]);
    const end = buf.indexOf('\r\n\r\n');
    if (end < 0) { if (buf.length > 8192) { c.off('data', onData); deny(431, 'Too Large'); } return; }
    c.off('data', onData);
    c.pause();
    const line = buf.subarray(0, buf.indexOf('\r\n')).toString('latin1');
    const rest = buf.subarray(end + 4);
    const m = line.match(/^CONNECT ([A-Za-z0-9.-]{1,253}):(\d{1,5}) HTTP\/1\.[01]$/);
    if (!m) {
      const hm = line.match(/^([A-Z]+) (\S{0,200})/);
      denyEvent({ host: '(http)', method: hm?.[1] ?? '?', path: hm?.[2] ?? '', verdict: 'denied-method' });
      deny(405, 'Only HTTPS downloads');
      return;
    }
    const [host, port] = [m[1].toLowerCase(), Number(m[2])];
    if (port !== 443 || !hostAllowed(host)) { denyEvent({ host, method: 'CONNECT', path: `:${port}`, verdict: 'denied-host' }); deny(403, 'Forbidden by Korvex sandbox policy'); return; }
    const addr = await resolvePublic(host);
    if (!addr) { denyEvent({ host, method: 'CONNECT', path: ':443', verdict: 'denied-address' }); deny(403, 'Forbidden address'); return; }
    let ctx: tls.SecureContext;
    try { ctx = contextFor(host); } catch (e) { console.error('[code-net] сертификат', (e as Error).message); deny(502, 'Proxy TLS error'); return; }
    c.setTimeout(0);
    c.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (rest.length) c.unshift(rest);
    const t = new tls.TLSSocket(c, { isServer: true, secureContext: ctx, ALPNProtocols: ['http/1.1'] }) as tls.TLSSocket & { kxHost?: string; kxAddr?: { address: string; family: number } };
    t.kxHost = host; t.kxAddr = addr;
    t.on('error', () => { t.destroy(); c.destroy(); });
    t.setTimeout(120_000, () => t.destroy());
    c.resume();
    mitmServer().emit('connection', t);
  };
  c.on('data', onData);
}

export function ensureNetProxy(): string | null {
  if (netMode() === 'off') return null;
  const sock = path.join(sockDir(), 'proxy.sock');
  if (g.__kxNet?.srv && g.__kxNet.sock === sock && fs.existsSync(sock)) return sock;
  fs.mkdirSync(sockDir(), { recursive: true, mode: 0o755 });
  ensureCa();
  try { fs.unlinkSync(sock); } catch {  }
  const srv = net.createServer({ pauseOnConnect: false }, handle);
  srv.maxConnections = 256;
  srv.listen(sock);
  srv.on('error', (e) => console.error('[code-net]', e.message));
  srv.on('listening', () => { try { fs.chmodSync(sock, 0o600); } catch {  } });
  g.__kxNet = { srv, sock, log: g.__kxNet?.log ?? new Map(), events: g.__kxNet?.events ?? [], mitm: null };
  return sock;
}

export const SANDBOX_CA = '/run/kx/ca.crt';
