import zlib from 'node:zlib';

export type ZipItem = {
  name: string | Buffer;
  data?: Buffer | string;
  utf8Flag?: boolean;
  mode?: number;
  encrypted?: boolean;
  store?: boolean;
  declaredSize?: number;
  dir?: boolean;
};

const crc = (b: Buffer) => zlib.crc32(b) >>> 0;

export function makeZip(items: ZipItem[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let off = 0;
  for (const it of items) {
    const nameB = Buffer.isBuffer(it.name) ? it.name : Buffer.from(it.name + (it.dir && !String(it.name).endsWith('/') ? '/' : ''), 'utf8');
    const raw = Buffer.from(it.data ?? '');
    const comp = it.store ? raw : zlib.deflateRawSync(raw, { level: 9 });
    const flags = (it.encrypted ? 1 : 0) | ((it.utf8Flag ?? (!Buffer.isBuffer(it.name) && /[^\x00-\x7f]/.test(it.name))) ? 0x800 : 0);
    const method = it.store ? 0 : 8;
    const usize = it.declaredSize ?? raw.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc(raw), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(usize, 22);
    lh.writeUInt16LE(nameB.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, nameB, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(it.mode !== undefined ? (3 << 8) | 20 : 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc(raw), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(usize, 24);
    ch.writeUInt16LE(nameB.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(it.mode !== undefined ? ((it.mode & 0xffff) << 16) >>> 0 : (it.dir ? 0x10 : 0), 38); ch.writeUInt32LE(off, 42);
    central.push(ch, nameB);
    off += lh.length + nameB.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

export type TarItem = { name: string; data?: Buffer | string; type?: string; pax?: boolean; gnuLong?: boolean; link?: string };

function tarHeader(name: Buffer, size: number, type: string, prefix = '', link = ''): Buffer {
  const h = Buffer.alloc(512);
  name.copy(h, 0, 0, Math.min(100, name.length));
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  if (link) h.write(link, 157);
  h.write('ustar\0', 257); h.write('00', 263);
  if (prefix) h.write(prefix, 345);
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}
const padTo = (b: Buffer) => (b.length % 512 ? Buffer.concat([b, Buffer.alloc(512 - (b.length % 512))]) : b);
const paxRec = (k: string, v: string) => {
  const body = ` ${k}=${v}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return Buffer.from(`${len}${body}`);
};

export function makeTar(items: TarItem[]): Buffer {
  const out: Buffer[] = [];
  for (const it of items) {
    const data = Buffer.from(it.data ?? '');
    const type = it.type ?? '0';
    if (it.pax) {
      const px = paxRec('path', it.name);
      out.push(tarHeader(Buffer.from('PaxHeader'), px.length, 'x'), padTo(px));
      out.push(tarHeader(Buffer.from('short'), data.length, type), padTo(data));
    } else if (it.gnuLong) {
      const nm = Buffer.concat([Buffer.from(it.name), Buffer.from([0])]);
      out.push(tarHeader(Buffer.from('././@LongLink'), nm.length, 'L'), padTo(nm));
      out.push(tarHeader(Buffer.from('short'), data.length, type), padTo(data));
    } else {
      const nb = Buffer.from(it.name);
      if (nb.length > 100) {
        const cut = it.name.lastIndexOf('/', 155);
        out.push(tarHeader(Buffer.from(it.name.slice(cut + 1)), data.length, type, it.name.slice(0, cut)), padTo(data));
      } else out.push(tarHeader(nb, data.length, type, '', it.link), padTo(type === '0' || type === '\0' ? data : Buffer.alloc(0)));
    }
  }
  out.push(Buffer.alloc(1024));
  return Buffer.concat(out);
}

export function encodeCp(name: string, cp: '866' | '1251'): Buffer {
  const b: number[] = [];
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) b.push(c);
    else if (c >= 0x410 && c <= 0x43f) b.push(cp === '866' ? 0x80 + (c - 0x410) : 0xc0 + (c - 0x410));
    else if (c >= 0x440 && c <= 0x44f) b.push(cp === '866' ? 0xe0 + (c - 0x440) : 0xf0 + (c - 0x440));
    else if (c === 0x401) b.push(cp === '866' ? 0xf0 : 0xa8);
    else if (c === 0x451) b.push(cp === '866' ? 0xf1 : 0xb8);
    else if (c === 0x2116) b.push(cp === '866' ? 0xfc : 0xb9);
    else b.push(0x3f);
  }
  return Buffer.from(b);
}
