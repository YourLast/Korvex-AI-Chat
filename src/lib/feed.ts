import type { MsgView, PairView } from './types';

export type FeedItem = { kind: 'user'; m: MsgView; i: number } | { kind: 'ans'; m: MsgView; i: number } | { kind: 'pair'; u: MsgView & { pair: PairView }; a?: MsgView; b?: MsgView };
export function feedOf(msgs: MsgView[]): FeedItem[] {
  const out: FeedItem[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === 'user') {
      out.push({ kind: 'user', m, i });
      if (!m.pair) continue;
      const it: FeedItem = { kind: 'pair', u: m as MsgView & { pair: PairView } };
      while (msgs[i + 1]?.role === 'assistant' && msgs[i + 1].meta?.lane) {
        const x = msgs[++i];
        if (x.meta!.lane === 'a') it.a = x; else it.b = x;
      }
      out.push(it);
      continue;
    }
    out.push({ kind: 'ans', m, i });
  }
  return out;
}
export const feedKey = (it: FeedItem) => (it.kind === 'pair' ? `p-${it.u.id}` : it.m.id);
export function feedEst(it: FeedItem): number {
  const ans = (m?: MsgView) => (m ? Math.min(6000, 140 + Math.round(m.content.length * 0.45) + (m.steps?.length ? 56 : 0)) : 0);
  if (it.kind === 'user') return Math.min(1200, 64 + Math.ceil(it.m.content.length / 40) * 22 + (it.m.files?.length ? 250 : 0));
  if (it.kind === 'pair') return Math.max(ans(it.a), ans(it.b));
  return ans(it.m);
}
export function deferredKeys(msgs: MsgView[], focus?: string | null): Set<string> {
  const f = feedOf(msgs);
  const out = new Set<string>();
  if (f.length <= 40) return out;
  const fi = focus ? f.findIndex((it) => (it.kind === 'pair' ? [it.u.id, it.a?.id, it.b?.id] : [it.m.id]).includes(focus)) : -1;
  f.forEach((it, i) => { if (i < f.length - 16 && !(fi >= 0 && Math.abs(i - fi) <= 8)) out.add(feedKey(it)); });
  return out;
}


export function deferredKeysFor(feed: FeedItem[], focus?: string | null): Set<string> {
  const out = new Set<string>();
  if (feed.length <= 40) return out;
  const fi = focus ? feed.findIndex((it) => (it.kind === 'pair' ? [it.u.id, it.a?.id, it.b?.id] : [it.m.id]).includes(focus)) : -1;
  feed.forEach((it, i) => { if (i >= 12 && i < feed.length - 12 && !(fi >= 0 && Math.abs(i - fi) <= 8)) out.add(feedKey(it)); });
  return out;
}
