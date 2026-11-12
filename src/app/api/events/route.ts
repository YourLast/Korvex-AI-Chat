import { randomUUID } from 'node:crypto';
import { authed } from '@/lib/api';
import { currentSessionHash, sessionAlive } from '@/lib/auth';
import { bootId, lastSeq, parseSince, presenceDrop, presenceSet, subscribe, wire, type LiveEvent } from '@/lib/bus';
import { touchDevice } from '@/lib/push';
import { isDraining, onDrain } from '@/lib/instance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (isDraining()) return new Response('retry: 300\n\n', { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' } });
  const a = await authed(req);
  if ('res' in a) return a.res;
  const sid = await currentSessionHash();
  const url = new URL(req.url);
  const since = parseSince(req.headers.get('last-event-id') || url.searchParams.get('since'));
  const conn = randomUUID();
  const device = (url.searchParams.get('device') || '').slice(0, 64) || conn;
  const visible = url.searchParams.get('v') === '1';
  const threads = (url.searchParams.get('th') || '').split(',').filter(Boolean).slice(0, 4);
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(ctl) {
      let closed = false;
      const write = (s: string) => { if (closed) return; try { ctl.enqueue(enc.encode(s)); } catch { closed = true; cleanup(); } };
      const send = (e: LiveEvent) => write(wire(e));
      write('retry: 2000\n\n');
      write(`data: ${JSON.stringify({ t: 'hello', boot: bootId(), now: Date.now(), conn })}\n\n`);
      const sub = subscribe(a.user.id, since, send);
      if (sub.replay === null) write(`id: ${bootId()}.${lastSeq()}\ndata: ${JSON.stringify({ t: 'sync', now: Date.now() })}\n\n`);
      else for (const e of sub.replay) send(e);
      presenceSet(conn, { userId: a.user.id, device, visible, threads });
      if (visible) touchDevice(a.user.id, device);
      const ping = setInterval(() => {
        let alive = true;
        try { alive = !!sid && sessionAlive(sid); } catch {  }
        if (!alive) { write(`data: {"t":"logout"}\n\n`); cleanup(); return; }
        write(`data: {"t":"ping"}\n\n`);
      }, Number(process.env.KX_SSE_PING_MS) || 15_000);
      let finished = false;
      const offDrain = onDrain(() => { write('retry: 300\n\n'); cleanup(); });
      cleanup = () => {
        if (finished) return;
        finished = true;
        closed = true;
        offDrain();
        clearInterval(ping);
        sub.unsubscribe();
        presenceDrop(conn);
        try { ctl.close(); } catch {  }
      };
      req.signal.addEventListener('abort', () => cleanup(), { once: true });
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' },
  });
}
