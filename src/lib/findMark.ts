
export type Pending = { m: string; marks: string[] };
let timer = 0, clearT = 0;
let pending: (Pending & { at: number }) | null = null;

export function setPendingFind(p: Pending) { pending = { ...p, at: Date.now() }; }
export function takePendingFind(m: string): Pending | null {
  const p = pending;
  if (!p || p.m !== m || Date.now() - p.at > 30_000) return null;
  pending = null;
  return p;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function findRanges(el: HTMLElement, marks: string[], cap = 200): Range[] {
  const words = [...new Set(marks.filter(Boolean))];
  if (!words.length) return [];
  const alts = words.sort((a, b) => b.length - a.length).map((w) => esc(w).replace(/[её]/gi, '[её]'));
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  const ranges: Range[] = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n && ranges.length < cap; n = walk.nextNode()) {
    const t = n.nodeValue ?? '';
    for (const mm of t.matchAll(re)) {
      const r = document.createRange();
      r.setStart(n, mm.index!); r.setEnd(n, mm.index! + mm[0].length);
      ranges.push(r);
    }
  }
  return ranges;
}

export function markWords(el: HTMLElement, marks: string[]): Range[] {
  const H = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  const reg = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights;
  const ranges = findRanges(el, marks);
  if (H && reg && ranges.length) reg.set('kx-find', new H(...ranges));
  return ranges;
}

export function clearMarks() {
  try { (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights?.delete('kx-find'); } catch {  }
}

function reveal(el: HTMLElement, rect: DOMRect) {
  const box = el.closest<HTMLElement>('.thread');
  if (!box) { el.scrollIntoView({ block: 'center' }); return; }
  const b = box.getBoundingClientRect();
  if (rect.top >= b.top + 48 && rect.bottom <= b.bottom - 96) return;
  box.scrollTop += rect.top - b.top - b.height / 3;
}

export function jumpTo(p: Pending, onFound?: () => void) {
  window.clearInterval(timer); window.clearTimeout(clearT); clearMarks();
  const t0 = Date.now();
  const tryOnce = () => {
    const el = document.getElementById(`m-${p.m}`);
    if (!el || !el.textContent?.trim() || !el.getClientRects().length) { if (Date.now() - t0 > 6000) window.clearInterval(timer); return false; }
    window.clearInterval(timer);
    onFound?.();
    const ranges = markWords(el, p.marks);
    const r0 = ranges[0]?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    reveal(el, r0 && r0.height ? r0 : r.height > window.innerHeight * 0.6 ? new DOMRect(r.x, r.y, r.width, 80) : r);
    el.classList.add('ans--hl');
    window.setTimeout(() => el.classList.remove('ans--hl'), 2200);
    clearT = window.setTimeout(clearMarks, 10_000);
    return true;
  };
  if (!tryOnce()) timer = window.setInterval(tryOnce, 120);
}
