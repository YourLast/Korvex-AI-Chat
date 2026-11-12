import type { Mark } from './adminTypes';

export type MarkFilter = 'all' | 'down' | 'up';

export type Placed = Mark & { y: number; pos: number };

export function navMarks(marks: Mark[], order: Map<string, number>, filter: MarkFilter): Mark[] {
  return marks
    .filter((m) => m.onPath && order.has(m.messageId) && (filter === 'all' || (filter === 'down' ? m.value < 0 : m.value > 0)))
    .sort((a, b) => (order.get(a.messageId) ?? 0) - (order.get(b.messageId) ?? 0) || a.at - b.at);
}

export function posOf(y: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, y / total));
}

export function posByIndex(index: number, count: number): number {
  return count <= 1 ? 0 : Math.min(1, Math.max(0, (index + 0.5) / count));
}

export function stepMark(list: { id: string; y: number }[], dir: 1 | -1, o: { cur: string | null; scrolled: boolean; anchor: number }): string | null {
  if (!list.length) return null;
  const i = o.cur && !o.scrolled ? list.findIndex((m) => m.id === o.cur) : -1;
  if (i >= 0) return list[(i + dir + list.length) % list.length].id;
  const eps = 6;
  if (dir === 1) return (list.find((m) => m.y > o.anchor + eps) ?? list[0]).id;
  const above = list.filter((m) => m.y < o.anchor - eps);
  return (above.length ? above[above.length - 1] : list[list.length - 1]).id;
}

export function currentIndex(list: { id: string; y: number }[], o: { cur: string | null; scrolled: boolean; anchor: number }): number {
  if (!list.length) return 0;
  const i = o.cur && !o.scrolled ? list.findIndex((m) => m.id === o.cur) : -1;
  if (i >= 0) return i + 1;
  let best = 0;
  for (let k = 1; k < list.length; k++) if (Math.abs(list[k].y - o.anchor) < Math.abs(list[best].y - o.anchor)) best = k;
  return best + 1;
}

export function summarize(marks: Mark[]): { up: number; down: number; other: number } {
  let up = 0, down = 0, other = 0;
  for (const m of marks) { if (m.value > 0) up++; else down++; if (!m.onPath) other++; }
  return { up, down, other };
}

export function viewport(scrollTop: number, clientH: number, scrollH: number): { top: number; h: number } {
  if (!(scrollH > 0)) return { top: 0, h: 1 };
  const top = Math.min(1, Math.max(0, scrollTop / scrollH));
  return { top, h: Math.min(1 - top, Math.max(0.02, clientH / scrollH)) };
}
