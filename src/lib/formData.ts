
export async function formDataOf(req: Request): Promise<FormData | null> {
  const ct = req.headers.get('content-type') ?? '';
  let buf: Buffer;
  try { buf = Buffer.from(await req.arrayBuffer()); } catch { return null; }
  const parse = (b: Buffer) => new Response(new Uint8Array(b), { headers: { 'content-type': ct } }).formData();
  try { return await parse(buf); } catch {  }
  if (!/multipart\/form-data/i.test(ct)) return null;
  const bnd = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(ct);
  const fixed = fixFilenameStar(buf, bnd?.[1] ?? bnd?.[2] ?? '');
  if (!fixed) return null;
  try { return await parse(fixed); } catch { return null; }
}

export function fixFilenameStar(buf: Buffer, boundary: string): Buffer | null {
  if (!boundary) return null;
  const delim = `--${boundary}`;
  const parts = buf.toString('latin1').split(delim);
  let changed = false;
  for (let i = 1; i < parts.length; i++) {
    const end = parts[i].indexOf('\r\n\r\n');
    if (end < 0) continue;
    const head = parts[i].slice(0, end);
    const fixed = head.replace(/^(Content-Disposition:[^\r\n]*)$/gim, fixLine);
    if (fixed !== head) { parts[i] = fixed + parts[i].slice(end); changed = true; }
  }
  return changed ? Buffer.from(parts.join(delim), 'latin1') : null;
}

function fixLine(line: string): string {
  const star = /;\s*filename\*\s*=\s*("?)([^;\r\n"]*)\1/i.exec(line);
  if (!star) return line;
  const rest = line.slice(0, star.index) + line.slice(star.index + star[0].length);
  if (/;\s*filename\s*=/i.test(rest)) return rest;
  const m = /^([A-Za-z0-9_-]+)'[^']*'(.*)$/.exec(star[2]);
  let name = star[2];
  if (m) {
    const bytes = Buffer.from(m[2].replace(/%([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1');
    name = /^utf-?8$/i.test(m[1]) ? bytes.toString('utf8') : bytes.toString('latin1');
  }
  return `${rest}; filename="${Buffer.from(name.replace(/["\r\n]/g, '_'), 'utf8').toString('latin1')}"`;
}
