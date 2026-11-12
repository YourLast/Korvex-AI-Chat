const W = { digit: 1.13, lat: 0.16, latHard: 0.34, cyr: 0.2, cyrHard: 0.36, punct: 1.48, nl: 2, other: 0.5 };
const CYR_HARD = new Set([0x406, 0x407, 0x404, 0x490, 0x491, 0x456, 0x457, 0x454, 0x408, 0x409, 0x40a, 0x40b, 0x402, 0x40f, 0x458, 0x459, 0x45a, 0x45b, 0x452, 0x45f, 0x45e, 0x40e]);
const LETTER = /\p{L}/u;

export function estTokens(text: string): number {
  if (!text) return 0;
  const n = text.length;
  const step = n > 200_000 ? Math.floor(n / 200_000) : 1;
  let digits = 0, lat = 0, ext = 0, cyr = 0, cyrX = 0, nl = 0, punct = 0, other = 0, seen = 0;
  for (let i = 0; i < n; i += step) {
    const c = text.charCodeAt(i);
    seen++;
    if (c >= 48 && c <= 57) digits++;
    else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) lat++;
    else if (c === 10) nl++;
    else if (c <= 32 || c === 0xa0 || (c >= 0x2000 && c <= 0x200b) || c === 0x202f || c === 0x3000) continue;
    else if (c < 128) punct++;
    else if (c >= 0x400 && c <= 0x4ff) { cyr++; if (CYR_HARD.has(c)) cyrX++; }
    else if (c >= 0xc0 && c <= 0x24f) ext++;
    else if (LETTER.test(String.fromCharCode(c))) other++;
    else punct++;
  }
  const latHard = lat + ext > 0 && ext / (lat + ext) >= 0.015;
  const cyrHard = cyr > 0 && cyrX / cyr >= 0.01;
  const sum = digits * W.digit + lat * (latHard ? W.latHard : W.lat) + ext * W.other + cyr * (cyrHard ? W.cyrHard : W.cyr) + nl * W.nl + punct * W.punct + other * W.other;
  return Math.max(1, Math.ceil(sum * (n / Math.max(1, seen))));
}
