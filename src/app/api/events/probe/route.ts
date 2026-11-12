export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const enc = new TextEncoder();
  let n = 0, t: NodeJS.Timeout | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(ctl) {
      const tick = () => {
        ctl.enqueue(enc.encode(`id: ${n}\ndata: {"t":"probe","n":${n},"at":${Date.now()}}\n\n`));
        if (++n >= 4) { ctl.close(); return; }
        t = setTimeout(tick, 700);
      };
      tick();
    },
    cancel() { if (t) clearTimeout(t); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store, no-transform', 'X-Accel-Buffering': 'no' } });
}
