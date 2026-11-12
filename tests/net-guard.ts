import net from 'node:net';

type Target = { host: string; port: number };
const DEAD = new Set([0, 1, 9]);
const own = new Set<number>();
export const blocked: string[] = [];

const isLoopback = (h: string) => h === 'localhost' || h === '::1' || h === '[::1]' || /^127\./.test(h) || h === '::ffff:127.0.0.1';

function target(args: unknown[]): Target | null {
  let a: unknown = args[0];
  if (Array.isArray(a)) a = a[0];
  if (a && typeof a === 'object') {
    const o = a as { path?: string; port?: number | string; host?: string };
    if (o.path) return null;
    return { host: String(o.host ?? 'localhost'), port: Number(o.port) };
  }
  if (typeof a === 'number' || (typeof a === 'string' && /^\d+$/.test(a))) return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: Number(a) };
  return null;
}

export function allowed({ host, port }: Target): boolean {
  if (!isLoopback(host)) return false;
  return own.has(port) || port >= 32768;
}

if (process.env.KX_TEST_NET !== 'live') {
  process.env.KX_BROWSER_URL ??= 'http://127.0.0.1:9';
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (this: net.Server, ...args: unknown[]) {
    this.once('listening', () => { const ad = this.address(); if (ad && typeof ad === 'object') own.add(ad.port); });
    return (listen as (...a: unknown[]) => net.Server).apply(this, args);
  } as typeof listen;

  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    const t = target(args);
    if (t && !allowed(t)) {
      if (!DEAD.has(t.port) || !isLoopback(t.host)) blocked.push(`${t.host}:${t.port}`);
      const err = Object.assign(new Error(`connect ECONNREFUSED ${t.host}:${t.port} (tests/net-guard: сеть в тестах закрыта)`), { code: 'ECONNREFUSED', errno: -111, syscall: 'connect', address: t.host, port: t.port });
      process.nextTick(() => this.destroy(err));
      return this;
    }
    return (connect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof connect;
}
