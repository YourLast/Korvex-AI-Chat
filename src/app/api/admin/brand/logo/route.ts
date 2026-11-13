import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { brand, logoUrl, setLogo } from '@/lib/brand';
import { readForm } from '@/lib/formData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX = 512 * 1024;

function kindOf(b: Buffer): 'png' | 'webp' | 'svg' | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  const head = b.subarray(0, 2048).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head) && !/<script|on[a-z]+\s*=|javascript:/i.test(b.toString('utf8'))) return 'svg';
  return null;
}

export async function POST(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const { form, tooBig } = await readForm(req, MAX + (64 << 10));
  if (tooBig) return fail(413, 'Логотип больше 512 КБ');
  const f = form?.get('file');
  if (!(f instanceof Blob) || !f.size) return fail(400, 'Нет файла');
  if (f.size > MAX) return fail(413, 'Логотип больше 512 КБ');
  const data = Buffer.from(await f.arrayBuffer());
  const kind = kindOf(data);
  if (!kind) return fail(415, 'Нужен PNG, WebP или SVG без скриптов');
  setLogo(kind, data, a.user.id);
  return json({ ok: true, logoUrl: logoUrl(brand()) });
}

export async function DELETE(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  setLogo(null, null, a.user.id);
  return json({ ok: true, logoUrl: null });
}
