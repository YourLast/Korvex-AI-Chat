
export const MCP_PROTOCOL = '2025-06-18';
const KNOWN = new Set(['2025-06-18', '2025-03-26']);
const MAX_BODY = 8 << 20;

export type McpTool = {
  name: string; title?: string; description?: string; inputSchema?: Record<string, unknown>;
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
};
export type McpContent = {
  type: string; text?: string; data?: string; mimeType?: string; uri?: string; name?: string;
  resource?: { uri?: string; text?: string; blob?: string; mimeType?: string };
};
export type McpCallResult = { content: McpContent[]; isError?: boolean; structuredContent?: unknown };
export type McpServerInfo = { name?: string; version?: string; protocol: string };

export class McpError extends Error {
  constructor(message: string, readonly code?: number, readonly status?: number) { super(message); this.name = 'McpError'; }
}

type RpcMsg = { jsonrpc?: string; id?: unknown; method?: string; result?: unknown; error?: { code?: number; message?: string } };
export type McpClientOpts = { url: string; headers?: Record<string, string>; timeoutMs?: number; fetch?: typeof fetch; clientVersion?: string };

export function validMcpUrl(url: string): boolean {
  try { const u = new URL(url); return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password; } catch { return false; }
}

export class McpClient {
  private sid: string | null = null;
  private version: string | null = null;
  private seq = 0;
  private ready: Promise<McpServerInfo> | null = null;
  constructor(private readonly o: McpClientOpts) {}

  init(signal?: AbortSignal): Promise<McpServerInfo> {
    this.ready ??= (async () => {
      const r = await this.call('initialize', { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: 'korvex-ai-chat', version: this.o.clientVersion ?? '0' } }, signal) as
        { protocolVersion?: unknown; serverInfo?: { name?: unknown; version?: unknown } } | null;
      const v = typeof r?.protocolVersion === 'string' ? r.protocolVersion : '';
      if (!KNOWN.has(v)) throw new McpError(`unsupported MCP protocol version ${v || '(none)'}`);
      this.version = v;
      const res = await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, signal);
      await res.body?.cancel().catch(() => undefined);
      return { protocol: v, name: typeof r?.serverInfo?.name === 'string' ? r.serverInfo.name : undefined, version: typeof r?.serverInfo?.version === 'string' ? r.serverInfo.version : undefined };
    })().catch((e) => { this.reset(); throw e; });
    return this.ready;
  }

  async listTools(signal?: AbortSignal): Promise<McpTool[]> {
    const out: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const r = await this.request('tools/list', cursor ? { cursor } : {}, signal) as { tools?: unknown; nextCursor?: unknown } | null;
      for (const t of Array.isArray(r?.tools) ? r.tools : []) if (t && typeof t === 'object' && typeof (t as McpTool).name === 'string' && (t as McpTool).name) out.push(t as McpTool);
      cursor = typeof r?.nextCursor === 'string' && r.nextCursor ? r.nextCursor : undefined;
      if (!cursor) break;
    }
    return out;
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal, timeoutMs?: number): Promise<McpCallResult> {
    const r = await this.request('tools/call', { name, arguments: args }, signal, false, timeoutMs) as { content?: unknown; isError?: unknown; structuredContent?: unknown } | null;
    return { content: Array.isArray(r?.content) ? (r.content as McpContent[]) : [], ...(r?.isError === true ? { isError: true } : {}), ...(r && 'structuredContent' in r ? { structuredContent: r.structuredContent } : {}) };
  }

  async close(): Promise<void> {
    const sid = this.sid;
    this.reset();
    if (!sid) return;
    try { await (this.o.fetch ?? fetch)(this.o.url, { method: 'DELETE', headers: { ...(this.o.headers ?? {}), 'Mcp-Session-Id': sid }, signal: AbortSignal.timeout(5000) }); } catch {  }
  }

  private reset() { this.sid = null; this.version = null; this.ready = null; }

  private async request(method: string, params: unknown, signal?: AbortSignal, retried = false, timeoutMs?: number): Promise<unknown> {
    await this.init(signal);
    try { return await this.call(method, params, signal, timeoutMs); }
    catch (e) {
      if (!retried && e instanceof McpError && e.status === 404) { this.reset(); return this.request(method, params, signal, true, timeoutMs); }
      throw e;
    }
  }

  private async call(method: string, params: unknown, signal?: AbortSignal, timeoutMs?: number): Promise<unknown> {
    const id = ++this.seq;
    const hadSession = !!this.sid;
    const res = await this.post({ jsonrpc: '2.0', id, method, params }, signal, timeoutMs);
    if (!res.ok) {
      const t = (await res.text().catch(() => '')).trim();
      throw new McpError(`HTTP ${res.status}${t ? `: ${t.slice(0, 200)}` : ''}`, undefined, res.status === 404 && !hadSession ? 0 : res.status);
    }
    if (method === 'initialize') { const s = res.headers.get('mcp-session-id'); if (s) this.sid = s; }
    const msg = await this.read(res, id);
    if (msg.error) throw new McpError(String(msg.error.message ?? 'MCP error').slice(0, 500), msg.error.code);
    return msg.result ?? null;
  }

  private post(msg: object, signal?: AbortSignal, timeoutMs?: number): Promise<Response> {
    const h: Record<string, string> = { ...(this.o.headers ?? {}), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (this.sid) h['Mcp-Session-Id'] = this.sid;
    if (this.version) h['MCP-Protocol-Version'] = this.version;
    const timeout = AbortSignal.timeout(timeoutMs ?? this.o.timeoutMs ?? 60_000);
    return (this.o.fetch ?? fetch)(this.o.url, { method: 'POST', headers: h, body: JSON.stringify(msg), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  }

  private async read(res: Response, id: number): Promise<RpcMsg> {
    const ct = res.headers.get('content-type') ?? '';
    if (!res.body) throw new McpError('empty response');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let size = 0;
    try {
      if (!ct.includes('text/event-stream')) {
        let text = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BODY) throw new McpError('response too large');
          text += dec.decode(value, { stream: true });
        }
        text += dec.decode();
        const m = pick(text, id);
        if (!m) throw new McpError('no response to the request');
        return m;
      }
      let buf = '';
      let data: string[] = [];
      const flush = () => { const m = data.length ? pick(data.join('\n'), id) : null; data = []; return m; };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY) throw new McpError('response too large');
        buf += dec.decode(value, { stream: true });
        for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
          const line = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          if (line === '') { const m = flush(); if (m) return m; continue; }
          if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
      }
      if (buf.startsWith('data:')) data.push(buf.slice(5).replace(/^ /, ''));
      const m = flush();
      if (m) return m;
      throw new McpError('the stream ended without a response');
    } finally {
      reader.cancel().catch(() => undefined);
    }
  }
}

function pick(text: string, id: number): RpcMsg | null {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return null; }
  for (const x of Array.isArray(j) ? j : [j]) {
    const m = x as RpcMsg | null;
    if (m && typeof m === 'object' && m.id === id && ('result' in m || 'error' in m)) return m;
  }
  return null;
}
