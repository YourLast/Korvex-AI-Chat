import { createHash } from 'node:crypto';
import { registerToolSource } from './registry';
import { m, mLang, qt } from './say';
import type { Attachment, JSONSchema, KorvexTool, ToolCtx, ToolResult } from './types';
import { clientOf, mcpServers, type McpServer } from '../mcp/servers';
import type { McpCallResult, McpTool } from '../mcp/client';
import { allowedBy, ruleOf, whoOf } from '../access';

const CALL_TIMEOUT_MS = () => Number(process.env.KX_MCP_TIMEOUT_MS) || 120_000;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function mcpToolName(slug: string, tool: string): string {
  const clean = tool.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'tool';
  const full = `mcp_${slug}_${clean}`;
  if (full.length <= 64) return full;
  return `${full.slice(0, 57)}_${createHash('sha256').update(tool).digest('hex').slice(0, 6)}`;
}

export function mcpAllowed(serverId: string, who: ReturnType<typeof whoOf>): boolean {
  const rule = ruleOf('mcp', serverId);
  return rule ? allowedBy(rule, who) : who.role === 'admin';
}

const schemaOf = (s: unknown): JSONSchema => (s && typeof s === 'object' && (s as { type?: unknown }).type === 'object'
  ? { ...(s as JSONSchema), properties: ((s as JSONSchema).properties ?? {}) } : { type: 'object', properties: {} });
const titleOf = (t: McpTool) => t.annotations?.title || t.title || t.name;
const needAsk = (s: McpServer, t: McpTool) => (s.ask === 'always' ? true : s.ask === 'never' ? false : t.annotations?.readOnlyHint !== true);
const argsLine = (args: Record<string, unknown>) => clip(Object.entries(args).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', '), 300);

export async function mcpResult(r: McpCallResult, ctx: Pick<ToolCtx, 'attach'>, server: string): Promise<ToolResult> {
  const parts: string[] = [];
  const attachments: Attachment[] = [];
  let n = 0;
  for (const c of r.content ?? []) {
    if (!c || typeof c !== 'object') continue;
    if (c.type === 'text' && typeof c.text === 'string') parts.push(c.text);
    else if (c.type === 'image' && typeof c.data === 'string') {
      const mime = typeof c.mimeType === 'string' && /^image\/[a-z0-9.+-]+$/.test(c.mimeType) ? c.mimeType : 'image/png';
      try { attachments.push(await ctx.attach({ name: `${server}-${++n}.${mime.split('/')[1].replace('jpeg', 'jpg').replace(/\+.*/, '')}`, mime, data: Buffer.from(c.data, 'base64') })); parts.push(`[image ${n}]`); }
      catch { parts.push('[image]'); }
    } else if (c.type === 'resource' && c.resource) parts.push(typeof c.resource.text === 'string' ? c.resource.text : `[${c.resource.uri ?? 'resource'}]`);
    else if (c.type === 'resource_link' && typeof c.uri === 'string') parts.push(`${c.name ? `${c.name}: ` : ''}${c.uri}`);
    else if (c.type === 'audio') parts.push('[audio]');
  }
  if (!parts.length && r.structuredContent !== undefined) parts.push(JSON.stringify(r.structuredContent));
  return { content: parts.join('\n\n') || '(empty result)', ...(attachments.length ? { attachments } : {}), ...(r.isError ? { error: true } : {}) };
}

function toolOf(s: McpServer, t: McpTool): KorvexTool<Record<string, unknown>> {
  return {
    name: mcpToolName(s.slug, t.name),
    description: clip(`${t.description?.trim() || titleOf(t)} [MCP server: ${s.name}]`, 1024),
    parameters: schemaOf(t.inputSchema),
    kind: 'other',
    enabled: () => true,
    title: () => `${s.name}: ${titleOf(t)}`,
    confirm: (args, ctx) => {
      if (!needAsk(s, t)) return null;
      const l = mLang(ctx.userId), a = argsLine(args);
      return m(l, `Запустить ${qt(titleOf(t), 'ru')} на сервере ${qt(s.name, 'ru')}?`, `Run ${qt(titleOf(t), 'en')} on ${qt(s.name, 'en')}?`) + (a ? `\n${a}` : '');
    },
    run: async (args, ctx) => {
      try {
        const r = await clientOf(s).callTool(t.name, args ?? {}, ctx.signal, CALL_TIMEOUT_MS());
        return await mcpResult(r, ctx, s.slug);
      } catch (e) {
        if (ctx.signal.aborted) throw e;
        const l = mLang(ctx.userId);
        return { content: m(l, `Ошибка сервера MCP ${qt(s.name, 'ru')}: `, `MCP server ${qt(s.name, 'en')} error: `) + clip((e as Error).message || 'error', 500), error: true };
      }
    },
  };
}

registerToolSource('mcp', (ctx) => {
  const list = mcpServers().filter((s) => s.on && s.tools.length);
  if (!list.length) return [];
  const who = whoOf(ctx.userId);
  return list.filter((s) => mcpAllowed(s.id, who)).flatMap((s) => s.tools.filter((t) => !s.off.includes(t.name)).map((t) => toolOf(s, t)));
});
