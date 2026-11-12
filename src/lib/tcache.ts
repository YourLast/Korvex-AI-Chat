import { useSyncExternalStore } from 'react';
import type { CompareState, MsgView } from './types';

export type ChatEntry = { kind: 'c'; id: string; title: string; modelId: string; effort: string; compare?: CompareState | null; messages: MsgView[]; hasMore: boolean; fileNames: string[]; at: number };
export type GroupData = {
  groupId: string;
  a: { id: string; modelId: string; effort: string; title: string };
  b: { id: string; modelId: string; effort: string };
  msgsA: MsgView[]; msgsB: MsgView[]; fileNames: string[]; hasMore: boolean; votes?: Record<string, string>;
};
export type GroupEntry = { kind: 'g'; init: GroupData; at: number };
export type Entry = ChatEntry | GroupEntry;

const MAX = 40;
const FRESH_MS = 20_000;
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry | null>>();
const subs = new Set<() => void>();
let version = 0;
const emit = () => { version++; subs.forEach((f) => f()); };

function put(href: string, e: Entry) {
  store.delete(href);
  store.set(href, e);
  while (store.size > MAX) store.delete(store.keys().next().value as string);
  emit();
}
const settled = (ms: MsgView[]) => ms.filter((m) => !m.id.startsWith('a-') && !m.id.startsWith('u-')).map((m) => (m.streaming ? { ...m, streaming: false } : m));

export function putChat(e: Omit<ChatEntry, 'kind' | 'at'>) { put(`/c/${e.id}`, { ...e, messages: settled(e.messages), kind: 'c', at: Date.now() }); }
export function putGroup(init: GroupData) { put(`/g/${init.groupId}`, { kind: 'g', init: { ...init, msgsA: settled(init.msgsA), msgsB: settled(init.msgsB) }, at: Date.now() }); }
export function getEntry(href: string): Entry | undefined { return store.get(href); }
export function dropEntry(href: string) { if (store.delete(href)) emit(); }
export function staleEntry(href: string) { const e = store.get(href); if (e) e.at = 0; }

export function useEntry(href: string | null): Entry | undefined {
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => version, () => 0);
  return href ? store.get(href) : undefined;
}

export function isThreadHref(href: string) { return /^\/(c|g)\/[^/?#]+$/.test(href); }

export function prefetchThread(href: string, force = false): Promise<Entry | null> {
  if (!isThreadHref(href)) return Promise.resolve(null);
  const have = store.get(href);
  if (have && !force && Date.now() - have.at < FRESH_MS) return Promise.resolve(have);
  const fly = inflight.get(href);
  if (fly) return fly;
  const [, kind, id] = href.split('/');
  const p = (async (): Promise<Entry | null> => {
    try {
      if (kind === 'g') {
        const r = await fetch(`/api/groups/${id}`, { cache: 'no-store' });
        if (!r.ok) return null;
        putGroup((await r.json()) as GroupData);
      } else {
        const r = await fetch(`/api/threads/${id}/path?turns=8`, { cache: 'no-store' });
        if (!r.ok) return null;
        const j = (await r.json()) as { messages: MsgView[]; hasMore: boolean; fileNames: string[]; title: string; modelId: string; effort: string; groupId: string | null; compare?: CompareState | null };
        if (j.groupId) return null;
        putChat({ id, title: j.title, modelId: j.modelId, effort: j.effort, compare: j.compare ?? null, messages: j.messages, hasMore: j.hasMore, fileNames: j.fileNames });
      }
      return store.get(href) ?? null;
    } catch { return null; } finally { inflight.delete(href); }
  })();
  inflight.set(href, p);
  return p;
}

export function prefetchIdle(hrefs: string[]) {
  const q = hrefs.filter((h) => isThreadHref(h) && !store.has(h));
  const idle = (f: () => void) => ((window as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback ?? ((g: () => void) => window.setTimeout(g, 200)))(f, { timeout: 2000 });
  const next = () => { const h = q.shift(); if (!h) return; idle(() => { void prefetchThread(h).finally(next); }); };
  next();
}
