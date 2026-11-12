import fs from 'node:fs';
import path from 'node:path';
import { brand, logoDir, LOGO_TYPES } from '@/lib/brand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const b = brand();
  const ext = b.logo?.split(':')[0];
  if (!ext || !LOGO_TYPES[ext]) return Response.redirect(new URL('/mark.png', req.url), 302);
  let data: Buffer;
  try { data = fs.readFileSync(path.join(logoDir(), `logo.${ext}`)); } catch { return Response.redirect(new URL('/mark.png', req.url), 302); }
  return new Response(new Uint8Array(data), { headers: { 'Content-Type': LOGO_TYPES[ext], 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', ...(ext === 'svg' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}) } });
}
