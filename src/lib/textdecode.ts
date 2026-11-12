import { nameScore } from './upload/zipnames';

const FREQ = 'оеаинтсрвлкмдпуяыьгзбчйхжшюцщэфё';
const dec = (label: string) => { try { return new TextDecoder(label); } catch { return null; } };
const strict = new TextDecoder('utf-8', { fatal: true });

function ruScore(s: string): number {
  let good = 0;
  for (const ch of s.toLowerCase()) if (FREQ.includes(ch)) good++;
  return good - nameScore(s) * 3;
}

export type Decoded = { text: string; enc: 'utf8' | 'utf8-bom' | 'utf16le' | 'utf16be' | 'cp1251' | 'cp866' | 'latin1' };
export function decodeText(buf: Uint8Array): Decoded {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(buf.subarray(3)), enc: 'utf8-bom' };
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), enc: 'utf16le' };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), enc: 'utf16be' };
  try { return { text: strict.decode(buf), enc: 'utf8' }; } catch {  }
  if (buf.length > 4) { try { return { text: strict.decode(buf.subarray(0, buf.length - 3)), enc: 'utf8' }; } catch {  } }
  const sample = buf.subarray(0, 64 * 1024);
  const w = dec('windows-1251'), d = dec('ibm866');
  if (w && d) {
    const a = ruScore(w.decode(sample)), b = ruScore(d.decode(sample));
    return b > a ? { text: d.decode(buf), enc: 'cp866' } : { text: w.decode(buf), enc: 'cp1251' };
  }
  return { text: Buffer.from(buf).toString('latin1'), enc: 'latin1' };
}

export function looksBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8192);
  let z = 0;
  for (let i = 0; i < n; i++) if (buf[i] === 0) z++;
  return z > 0 && !(buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)));
}
