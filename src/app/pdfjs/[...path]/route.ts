import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';

const ROOT = () => path.join(process.cwd(), 'node_modules', 'pdfjs-dist');
const ALLOW = new Set(['legacy', 'build', 'cmaps', 'standard_fonts', 'iccs', 'wasm']);
const TYPES: Record<string, string> = { '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.map': 'application/json', '.json': 'application/json', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.bcmap': 'application/octet-stream', '.icc': 'application/octet-stream' };

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  if (!parts.length || !ALLOW.has(parts[0]) || parts.some((p) => !p || p === '.' || p === '..' || p.includes('\\') || p.includes('\0'))) return new Response(null, { status: 404 });
  if (parts[0] === 'legacy' && parts[1] !== 'build') return new Response(null, { status: 404 });
  const file = path.join(ROOT(), ...parts);
  if (!file.startsWith(ROOT() + path.sep)) return new Response(null, { status: 404 });
  let buf: Buffer;
  try { if (!fs.lstatSync(file).isFile()) return new Response(null, { status: 404 }); buf = fs.readFileSync(file); } catch { return new Response(null, { status: 404 }); }
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Length': String(buf.length) } });
}
