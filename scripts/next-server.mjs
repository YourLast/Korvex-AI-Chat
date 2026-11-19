#!/usr/bin/env node
import http from 'node:http';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dir = process.cwd();
process.env.NODE_ENV = 'production';
require('@next/env').loadEnvConfig(dir, false);
process.title = 'next-server (korvex)';

const port = Number(process.env.PORT || 3101);
const host = process.env.KX_BIND || '127.0.0.1';
const adminPort = Number(process.env.KX_ADMIN_PORT || 0);
const drainMaxS = Number(process.env.KX_DRAIN_MAX_S || 4 * 3600);
const log = (m) => console.log(`[next-server] ${m}`);

const next = require('next');
const app = next({ dev: false, dir, hostname: host, port });
await app.prepare();
const handle = app.getRequestHandler();

let draining = false;
let inflight = 0;
const lc = () => globalThis.__kxLifecycle;

const compression = require('next/dist/compiled/compression');
const gz = compression({ threshold: 1024, filter: (_req, res) => /^application\/json\b/i.test(String(res.getHeader('Content-Type') || '')) });

function serve(req, res) {
  inflight++;
  let done = false;
  const end = () => { if (!done) { done = true; inflight--; } };
  res.on('close', end);
  res.on('finish', end);
  if (draining) res.setHeader('Connection', 'close');
  gz(req, res, () => handle(req, res));
}

const pub = http.createServer(serve);
const bindWaitS = Number(process.env.KX_BIND_WAIT_S || 0);
function listenPublic() {
  return new Promise((ok, fail) => {
    const t0 = Date.now();
    const attempt = () => {
      const onErr = (e) => {
        if (e.code === 'EADDRINUSE' && Date.now() - t0 < bindWaitS * 1000) { setTimeout(attempt, 200); return; }
        fail(e);
      };
      pub.once('error', onErr);
      pub.listen({ port, host, reusePort: true }, () => { pub.off('error', onErr); ok(); });
    };
    attempt();
  });
}

let adm = null;
if (adminPort) {
  adm = http.createServer((req, res) => {
    if ((req.url || '').startsWith('/__kx/health')) {
      const l = lc();
      const busy = l ? l.busy() : {};
      const ok = !!l && !draining;
      res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok, instance: l?.id ?? null, pid: process.pid, draining, inflight, busy, rssMb: Math.round(process.memoryUsage().rss / 1048576), uptimeS: Math.round(process.uptime()) }));
      return;
    }
    if ((req.url || '').startsWith('/__kx/ops/')) {
      const ops = globalThis.__kxOps;
      const u = new URL(req.url, 'http://127.0.0.1');
      const name = u.pathname.slice('/__kx/ops/'.length);
      const out = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
      if (!ops) return out(503, { error: 'приложение еще не готово' });
      if (!ops.ok(req.headers['x-kx-ops'])) return out(401, { error: 'нужен ключ data/ops.key в X-KX-Ops' });
      if (name === 'intro-end' && req.method !== 'POST') return out(405, { error: 'POST' });
      try { const r = ops.run(name, u.searchParams); log(`ops ${name} → ${r.status}`); return out(r.status, r.body); } catch (e) { return out(500, { error: String(e?.message || e).slice(0, 200) }); }
    }
    handle(req, res);
  });
  adm.listen(adminPort, '127.0.0.1', () => log(`служебный порт 127.0.0.1:${adminPort}`));
}

listenPublic().then(() => log(`pid ${process.pid}: ${host}:${port} (reusePort)`), (e) => { console.error(`[next-server] порт ${port}: ${e.message}`); process.exit(1); });

http.get({ host: '127.0.0.1', port: adminPort || port, path: '/login', headers: { 'User-Agent': 'korvex-warmup' } }, (r) => r.resume()).on('error', () => {});

function busyTotal() {
  const l = lc();
  if (!l) return 0;
  return Object.values(l.busy()).reduce((a, b) => a + b, 0);
}

function drain() {
  if (draining) return;
  draining = true;
  const t0 = Date.now();
  log('доводка: приём закрыт, довожу своё');
  try { lc()?.drain(); } catch (e) { console.error('[next-server] drain', e); }
  pub.close(() => log('публичный порт закрыт'));
  let quiet = 0;
  const iv = setInterval(() => {
    pub.closeIdleConnections?.();
    const busy = busyTotal();
    if (inflight === 0 && busy === 0) {
      if (++quiet >= 2) {
        clearInterval(iv);
        log(`доводка закончена за ${Math.round((Date.now() - t0) / 1000)} с — выхожу`);
        adm?.close();
        setTimeout(() => process.exit(0), 200);
      }
      return;
    }
    quiet = 0;
    if (Date.now() - t0 > drainMaxS * 1000) {
      clearInterval(iv);
      log(`потолок доводки ${drainMaxS} с: запросов ${inflight}, занято ${JSON.stringify(lc()?.busy() ?? {})} — завершаю как SIGTERM`);
      process.kill(process.pid, 'SIGTERM');
    }
  }, 500);
}
process.on('SIGUSR2', drain);

let stopping = false;
const stop = (sig) => {
  if (stopping) return;
  stopping = true;
  try { pub.close(); } catch {  }
  try { adm?.close(); } catch {  }
  setTimeout(() => process.exit(sig === 'SIGINT' ? 130 : 143), 300);
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
