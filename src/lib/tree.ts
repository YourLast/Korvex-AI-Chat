import { eq } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { getDb, schema } from './db';
import type { Message, Thread } from './db/schema';
import { pairChild, sessionMeta } from './pairs';

export function allMessages(threadId: string): Message[] {
  return getDb().select().from(schema.messages).where(eq(schema.messages.threadId, threadId)).orderBy(schema.messages.seq).all();
}

const raw = () => (getDb() as unknown as { $client: Database.Database }).$client;
type St = { skel: Database.Statement; by: Map<number, Database.Statement> };
const g = globalThis as unknown as { __kxTreeSt?: St };
function stmts(): St {
  return (g.__kxTreeSt ??= {
    skel: raw().prepare(`SELECT id, thread_id AS threadId, seq, parent_id AS parentId, session, role, created_at AS createdAt,
      CASE WHEN json_valid(meta) THEN json_object('lane', meta->>'$.lane', 'pair', meta->'$.pair', 'fileIds', meta->'$.fileIds', 'session', meta->>'$.session') END AS meta
      FROM messages WHERE thread_id = ? ORDER BY seq`),
    by: new Map(),
  });
}

export function messageSkeleton(threadId: string): Message[] {
  const rows = stmts().skel.all(threadId) as (Omit<Message, 'meta' | 'content' | 'reasoning' | 'reasoningMs'> & { meta: string | null })[];
  return rows.map((r) => {
    let meta: Record<string, unknown> | null = null;
    if (r.meta) {
      const m = JSON.parse(r.meta) as Record<string, unknown>;
      for (const k of Object.keys(m)) if (m[k] === null) delete m[k];
      meta = m;
    }
    return { ...r, content: '', reasoning: null, reasoningMs: null, meta };
  });
}

export function lastSeq(threadId: string): number {
  const st = stmts() as St & { seq?: Database.Statement };
  st.seq ??= raw().prepare('SELECT MAX(seq) AS s FROM messages WHERE thread_id = ?');
  return ((st.seq.get(threadId) as { s: number | null } | undefined)?.s) ?? 0;
}

export function messagesById(ids: string[]): Message[] {
  if (!ids.length) return [];
  const st = stmts();
  const out = new Map<string, Message>();
  const CH = 200;
  for (let i = 0; i < ids.length; i += CH) {
    const part = ids.slice(i, i + CH);
    let q = st.by.get(part.length);
    if (!q) st.by.set(part.length, (q = raw().prepare(`SELECT * FROM messages WHERE id IN (${part.map(() => '?').join(',')})`)));
    for (const r of q.all(...part) as { id: string; thread_id: string; seq: number; parent_id: string | null; session: string | null; role: 'user' | 'assistant'; content: string; reasoning: string | null; reasoning_ms: number | null; meta: string | null; created_at: number }[]) {
      out.set(r.id, { id: r.id, threadId: r.thread_id, seq: r.seq, parentId: r.parent_id, session: r.session, role: r.role, content: r.content, reasoning: r.reasoning, reasoningMs: r.reasoning_ms,
        meta: r.meta === null ? null : (JSON.parse(r.meta) as Record<string, unknown> | null), createdAt: r.created_at });
    }
  }
  return ids.map((id) => out.get(id)).filter((m): m is Message => !!m);
}

export function activePath(all: Message[], leafId: string | null): Message[] {
  const byId = new Map(all.map((m) => [m.id, m]));
  const out: Message[] = [];
  const seen = new Set<string>();
  for (let cur = leafId ? byId.get(leafId) : undefined; cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    seen.add(cur.id);
    out.push(cur);
  }
  return out.reverse();
}

export function siblingsOf(all: Message[], m: Message): Message[] {
  return all.filter((x) => x.role === m.role && (x.parentId ?? null) === (m.parentId ?? null));
}

export function deepestLatest(all: Message[], id: string): string {
  let cur = id;
  const byId = new Map(all.map((m) => [m.id, m]));
  for (let guard = 0; guard <= all.length; guard++) {
    const kids = all.filter((x) => x.parentId === cur);
    if (!kids.length) return cur;
    cur = pairChild(all, byId.get(cur)!) ?? kids[kids.length - 1].id;
  }
  return cur;
}

export function setLeaf(thread: Thread | { id: string }, leafId: string | null) {
  getDb().update(schema.threads).set({ leafId }).where(eq(schema.threads.id, thread.id)).run();
}

export function sessionOfPath(path: Message[], threadId: string): string {
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].role === 'user' && path[i].session) return path[i].session!;
    const s = path[i].role === 'assistant' ? sessionMeta(path[i]) : null;
    if (s) return s;
  }
  return threadId;
}
