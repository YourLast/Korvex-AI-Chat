
const url = (id: string) => `/api/threads/${encodeURIComponent(id)}/temp`;

export function tempClose(id: string): void {
  try {
    const body = JSON.stringify({ op: 'close' });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url(id), new Blob([body], { type: 'application/json' }))) return;
    void fetch(url(id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {  }
}

export async function tempOpen(id: string): Promise<boolean> {
  try {
    const r = await fetch(url(id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'open' }), cache: 'no-store' });
    return r.status !== 404;
  } catch { return true; }
}

export const TEMP_BEAT_MS = 120_000;

export function watchTemp(id: string, gone: () => void): () => void {
  let dead = false;
  const open = () => { void tempOpen(id).then((alive) => { if (!alive && !dead) gone(); }); };
  const visible = () => { if (document.visibilityState === 'visible') open(); };
  const hide = () => tempClose(id);
  const show = (e: PageTransitionEvent) => { if (e.persisted) open(); };
  open();
  const beat = window.setInterval(visible, TEMP_BEAT_MS);
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', show);
  return () => {
    dead = true;
    window.clearInterval(beat);
    document.removeEventListener('visibilitychange', visible);
    window.removeEventListener('pagehide', hide);
    window.removeEventListener('pageshow', show);
    tempClose(id);
  };
}
