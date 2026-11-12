import { useEffect, useRef, useState } from 'react';
import { setServerNow } from './clock';

export type LiveEv = { t: string; id?: number; th?: string | null; gid?: string | null; m?: string | null; [k: string]: unknown };
type Handler = (e: LiveEv) => void;

const SILENT_MS = 45_000;
const BACKOFF = [1000, 2000, 4000, 8000, 15000];
export const IDLE_MS = 3 * 60_000;
export const activeNow = (lastInput: number, now: number) => now - lastInput < IDLE_MS;

class LiveClient {
  private es: EventSource | null = null;
  private handlers = new Set<Handler>();
  private lastId = '';
  private lastAt = 0;
  private tries = 0;
  private timer = 0;
  private started = false;
  conn = '';
  device = '';
  threads: string[] = [];
  connected = false;
  private lastInput = Date.now();
  private activeSent: boolean | null = null;
  private setConn(on: boolean) {
    if (this.connected === on) return;
    this.connected = on;
    this.handlers.forEach((h) => { try { h({ t: 'conn', on }); } catch {  } });
  }

  start() {
    if (this.started || typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    this.started = true;
    try {
      this.device = localStorage.getItem('kx.device') || '';
      if (!this.device) { this.device = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('kx.device', this.device); }
    } catch { this.device = Math.random().toString(36).slice(2); }
    this.connect();
    document.addEventListener('visibilitychange', () => {
      this.presence();
      if (document.visibilityState === 'visible' && (!this.es || this.es.readyState === EventSource.CLOSED || Date.now() - this.lastAt > 20_000)) this.connect();
    });
    window.addEventListener('online', () => this.connect());
    window.addEventListener('offline', () => this.setConn(false));
    window.addEventListener('pageshow', (e) => { if ((e as PageTransitionEvent).persisted) this.connect(); });
    window.setInterval(() => { if (this.es && document.visibilityState === 'visible' && Date.now() - this.lastAt > SILENT_MS) this.connect(); }, 10_000);
    const touch = () => { this.lastInput = Date.now(); if (this.activeSent === false) this.presence(); };
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'] as const) window.addEventListener(ev, touch, { passive: true, capture: true });
    window.setInterval(() => { if (this.activeSent !== null && activeNow(this.lastInput, Date.now()) !== this.activeSent) this.presence(); }, 20_000);
  }

  private connect() {
    window.clearTimeout(this.timer);
    this.es?.close();
    const q = new URLSearchParams({ device: this.device, v: document.visibilityState === 'visible' ? '1' : '0', th: this.threads.join(',') });
    if (this.lastId) q.set('since', this.lastId);
    const es = new EventSource(`/api/events?${q}`);
    this.es = es;
    this.lastAt = Date.now();
    es.onmessage = (m) => {
      this.lastAt = Date.now();
      if (m.lastEventId) this.lastId = m.lastEventId;
      let e: LiveEv;
      try { e = JSON.parse(m.data) as LiveEv; } catch { return; }
      if (e.t === 'ping') return;
      if (e.t === 'logout') {
        const q = e.seat && typeof e.seat === 'object' ? `?seat=${Number((e.seat as { until?: number }).until) || 0}&tz=${encodeURIComponent(String((e.seat as { tz?: string }).tz ?? ''))}` : '';
        this.close(); window.location.assign('/login' + q); return;
      }
      if (e.t === 'hello') {
        this.conn = String(e.conn ?? ''); this.tries = 0; this.setConn(true);
        setServerNow(Number(e.now)); this.presence();
      }
      this.handlers.forEach((h) => { try { h(e); } catch (err) { console.error('[live]', err); } });
    };
    es.onerror = () => {
      this.setConn(false);
      if (es.readyState !== EventSource.CLOSED) return;
      if (this.es !== es) return;
      const d = BACKOFF[Math.min(this.tries++, BACKOFF.length - 1)];
      this.timer = window.setTimeout(() => this.connect(), d);
    };
  }

  reconnect() { this.connect(); }
  setThreads(ids: string[]) { this.threads = ids; this.presence(); }
  private presence() {
    if (!this.conn) return;
    const active = activeNow(this.lastInput, Date.now());
    this.activeSent = active;
    void fetch('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ conn: this.conn, visible: document.visibilityState === 'visible', active, threads: this.threads }) }).catch(() => {});
  }
  on(h: Handler): () => void { this.handlers.add(h); return () => { this.handlers.delete(h); }; }
  close() { this.es?.close(); this.es = null; this.started = false; }
}

export function deviceId(): string {
  if (live?.device) return live.device;
  try {
    let d = localStorage.getItem('kx.device') || '';
    if (!d) { d = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('kx.device', d); }
    return d;
  } catch { return 'nodevice'; }
}

const w = (typeof window !== 'undefined' ? window : undefined) as (Window & { __kxLive?: LiveClient }) | undefined;
export const live: LiveClient | null = w ? (w.__kxLive ??= new LiveClient()) : null;

export function useLive(handler: Handler) {
  const h = useRef(handler);
  h.current = handler;
  useEffect(() => live?.on((e) => h.current(e)), []);
}

export function useOnline(): boolean {
  const [on, setOn] = useState(true);
  useLive((e) => { if (e.t === 'conn') setOn(!!e.on); });
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) setOn(false);
  }, []);
  return on;
}
