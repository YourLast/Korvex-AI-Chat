import { randomUUID } from 'node:crypto';
import { getSetting, setSetting } from '../settings';
import { open, seal } from '../github/secret';
import { McpClient, validMcpUrl, type McpServerInfo, type McpTool } from './client';

export type McpAsk = 'always' | 'write' | 'never';
export type McpServer = {
  id: string; name: string; url: string; slug: string;
  header: { name: string; sealed: string } | null;
  on: boolean; ask: McpAsk;
  off: string[];
  tools: McpTool[]; info: McpServerInfo | null; checkedAt: number | null; error: string | null;
  createdAt: number; updatedAt: number;
};
export type McpServerView = Omit<McpServer, 'header'> & { header: { name: string; set: boolean } | null };

const KEY = 'mcp.servers';
const MAX_SERVERS = 50;
const HEADER_RE = /^[A-Za-z0-9-]{1,64}$/;

export const mcpServers = (): McpServer[] => { const v = getSetting<McpServer[] | null>(KEY, null); return Array.isArray(v) ? v : []; };
export const mcpServer = (id: string): McpServer | undefined => mcpServers().find((s) => s.id === id);
const put = (list: McpServer[], by: string | null) => setSetting(KEY, list, by);

export const viewOf = (s: McpServer): McpServerView => ({ ...s, header: s.header ? { name: s.header.name, set: !!s.header.sealed } : null });

function slugFor(name: string, taken: Set<string>): string {
  const base = (name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 12)) || 'srv';
  let s = base;
  for (let i = 2; taken.has(s); i++) s = `${base.slice(0, 12 - String(i).length)}${i}`;
  return s;
}

export type McpServerIn = { id?: string; name?: string; url?: string; headerName?: string | null; headerValue?: string | null; on?: boolean; ask?: McpAsk; off?: string[] };

export function saveMcpServer(p: McpServerIn, by: string | null): McpServer {
  const list = mcpServers();
  const now = Date.now();
  const cur = p.id ? list.find((s) => s.id === p.id) : undefined;
  if (p.id && !cur) throw new Error('not found');
  if (!cur && list.length >= MAX_SERVERS) throw new Error('too many servers');
  const name = (p.name ?? cur?.name ?? '').trim().slice(0, 60);
  const url = (p.url ?? cur?.url ?? '').trim();
  if (!name) throw new Error('name');
  if (!validMcpUrl(url)) throw new Error('url');
  const id = cur?.id ?? randomUUID();
  let header = cur?.header ?? null;
  if (p.headerName !== undefined || p.headerValue !== undefined) {
    const hn = (p.headerName ?? header?.name ?? 'Authorization').trim();
    if (p.headerValue === null || p.headerValue === '' || p.headerName === null) header = null;
    else {
      if (!HEADER_RE.test(hn)) throw new Error('header');
      header = p.headerValue !== undefined ? { name: hn, sealed: seal(p.headerValue.trim(), `mcp:${id}`) } : header ? { ...header, name: hn } : null;
    }
  }
  const moved = !!cur && (cur.url !== url || JSON.stringify(cur.header) !== JSON.stringify(header));
  const next: McpServer = {
    id, name, url, slug: cur?.slug ?? slugFor(name, new Set(list.map((s) => s.slug))), header,
    on: p.on ?? cur?.on ?? true, ask: p.ask ?? cur?.ask ?? 'write',
    off: Array.isArray(p.off) ? [...new Set(p.off.filter((x) => typeof x === 'string'))].slice(0, 500) : cur?.off ?? [],
    tools: moved ? [] : cur?.tools ?? [], info: moved ? null : cur?.info ?? null, checkedAt: moved ? null : cur?.checkedAt ?? null, error: moved ? null : cur?.error ?? null,
    createdAt: cur?.createdAt ?? now, updatedAt: now,
  };
  put(cur ? list.map((s) => (s.id === id ? next : s)) : [...list, next], by);
  if (moved || !cur) dropClient(id);
  return next;
}

export function deleteMcpServer(id: string, by: string | null): boolean {
  const list = mcpServers();
  if (!list.some((s) => s.id === id)) return false;
  put(list.filter((s) => s.id !== id), by);
  dropClient(id);
  return true;
}

export function headersOf(s: McpServer): Record<string, string> {
  if (!s.header) return {};
  try { return { [s.header.name]: open(s.header.sealed, `mcp:${s.id}`) }; } catch { return {}; }
}

const g = globalThis as unknown as { __kxMcp?: Map<string, { key: string; c: McpClient }>; __kxMcpFetch?: typeof fetch };
const pool = () => (g.__kxMcp ??= new Map());
function dropClient(id: string) { const x = pool().get(id); if (x) { pool().delete(id); void x.c.close(); } }
export function _setMcpFetch(f: typeof fetch | null) { if (f) g.__kxMcpFetch = f; else delete g.__kxMcpFetch; for (const id of [...pool().keys()]) dropClient(id); }

export function clientOf(s: McpServer): McpClient {
  const key = `${s.url}|${s.header?.sealed ?? ''}`;
  const x = pool().get(s.id);
  if (x && x.key === key) return x.c;
  if (x) dropClient(s.id);
  const c = new McpClient({ url: s.url, headers: headersOf(s), timeoutMs: 30_000, fetch: g.__kxMcpFetch, clientVersion: process.env.npm_package_version });
  pool().set(s.id, { key, c });
  return c;
}

export async function checkMcpServer(id: string, by: string | null): Promise<McpServer> {
  const s = mcpServer(id);
  if (!s) throw new Error('not found');
  let tools: McpTool[] = [], info: McpServerInfo | null = null, error: string | null = null;
  try {
    const c = clientOf(s);
    info = await c.init();
    tools = (await c.listTools()).slice(0, 200).map((t) => ({ name: t.name, ...(t.title ? { title: String(t.title).slice(0, 120) } : {}), ...(t.description ? { description: String(t.description).slice(0, 2000) } : {}),
      inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} }, ...(t.annotations ? { annotations: t.annotations } : {}) }));
  } catch (e) {
    dropClient(id);
    error = ((e as Error).message || 'error').slice(0, 300);
  }
  const fresh = mcpServer(id);
  if (!fresh) throw new Error('not found');
  const next: McpServer = { ...fresh, tools: error ? fresh.tools : tools, info: error ? fresh.info : info, error, checkedAt: Date.now(), updatedAt: Date.now() };
  put(mcpServers().map((x) => (x.id === id ? next : x)), by);
  return next;
}
