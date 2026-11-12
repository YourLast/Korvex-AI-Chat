import { and, asc, gt, ne, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { publish, setRelayOut } from './bus';
import { instanceId, onDrain } from './instance';

const POLL_MS = 250;
type St = { timer: NodeJS.Timeout | null; cursor: number };
const g = globalThis as unknown as { __kxRelay?: St };

export function relayPull(): number {
  const st = (g.__kxRelay ??= { timer: null, cursor: 0 });
  const rows = getDb().select().from(schema.busRelay).where(and(gt(schema.busRelay.seq, st.cursor), ne(schema.busRelay.origin, instanceId())))
    .orderBy(asc(schema.busRelay.seq)).limit(2000).all();
  for (const r of rows) {
    st.cursor = Math.max(st.cursor, r.seq);
    const ev = { ...(r.event as Record<string, unknown>) };
    delete ev.id; delete ev.at;
    if (typeof ev.t === 'string') publish(r.userId, ev as { t: string; [k: string]: unknown });
  }
  return rows.length;
}

export function startRelay() {
  const st = (g.__kxRelay ??= { timer: null, cursor: 0 });
  if (st.timer) return;
  st.cursor = Number(getDb().select({ m: sql<number>`coalesce(max(${schema.busRelay.seq}), 0)` }).from(schema.busRelay).get()?.m ?? 0);
  onDrain(() => {
    const me = instanceId();
    setRelayOut((userId, ev) => {
      try { getDb().insert(schema.busRelay).values({ origin: me, userId, event: ev, at: Date.now() }).run(); } catch (e) { console.error('[relay] out', (e as Error).message); }
    });
  });
  st.timer = setInterval(() => { try { relayPull(); } catch (e) { console.error('[relay] in', (e as Error).message); } }, POLL_MS);
  st.timer.unref?.();
}
