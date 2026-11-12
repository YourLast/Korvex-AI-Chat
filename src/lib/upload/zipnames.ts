
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
const looseUtf8 = new TextDecoder('utf-8');
let dec866: TextDecoder | null = null;
let dec1251: TextDecoder | null = null;
function decoder(label: string): TextDecoder | null {
  try { return new TextDecoder(label); } catch { return null; }
}

export function nameScore(s: string): number {
  let bad = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x2500 && c <= 0x259f) bad += 4;
    else if ('ЂЃЌЋЏђѓќћџЎўЈҐЄЇІіґєїјЅѕЉЊљњ'.includes(ch)) bad += 3;
    else if (c >= 0x80 && c < 0xa0) bad += 3;
    else if (c === 0xfffd) bad += 5;
    else if ('‚„…†‡‰‹‘’“”•–—™›¤¦§©«¬®°±µ¶·»'.includes(ch)) bad += 1;
  }
  return bad;
}

export function decodeZipName(raw: Uint8Array, utf8Flag: boolean): { name: string; enc: 'utf8' | 'ascii' | 'cp866' | 'cp1251' | 'latin1' } {
  let ascii = true;
  for (const b of raw) if (b >= 0x80) { ascii = false; break; }
  if (ascii) return { name: Buffer.from(raw).toString('latin1'), enc: 'ascii' };
  if (utf8Flag) return { name: looseUtf8.decode(raw), enc: 'utf8' };
  try { return { name: strictUtf8.decode(raw), enc: 'utf8' }; } catch {  }
  dec866 ??= decoder('ibm866'); dec1251 ??= decoder('windows-1251');
  const a = dec866?.decode(raw), b = dec1251?.decode(raw);
  if (a !== undefined && b !== undefined) return nameScore(a) <= nameScore(b) ? { name: a, enc: 'cp866' } : { name: b, enc: 'cp1251' };
  if (a !== undefined) return { name: a, enc: 'cp866' };
  if (b !== undefined) return { name: b, enc: 'cp1251' };
  return { name: Buffer.from(raw).toString('latin1'), enc: 'latin1' };
}
