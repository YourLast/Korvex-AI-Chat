'use client';
import { useEffect, useState, type ComponentType } from 'react';

type Mod = Pick<typeof import('./ImageViewer'), 'openImage' | 'openDoc' | 'viewerReady' | 'ImageViewerHost'>;
export type DocRef = { href: string; name: string; kind: 'slides' | 'pages' };
let mod: Promise<Mod> | null = null;
let ready: Mod | null = null;
let need: (() => void) | null = null;
export function loadViewer(): Promise<Mod> { return (mod ??= ready ? Promise.resolve(ready) : import('./ImageViewer')); }
export function registerViewer(m: Mod) { ready = m; mod ??= Promise.resolve(m); }

export function openImage(el: HTMLElement) {
  if (ready?.viewerReady()) { ready.openImage(el); return; }
  need?.();
  void loadViewer().then((m) => {
    let n = 0;
    const go = () => { if (m.viewerReady() || n++ > 30) m.openImage(el); else requestAnimationFrame(go); };
    go();
  });
}

export function openDoc(d: DocRef, from?: HTMLElement | null) {
  if (ready?.viewerReady()) { ready.openDoc(d, from); return; }
  need?.();
  void loadViewer().then((m) => {
    let n = 0;
    const go = () => { if (m.viewerReady() || n++ > 30) m.openDoc(d, from); else requestAnimationFrame(go); };
    go();
  });
}

export function ImageViewerSlot() {
  const [Host, setHost] = useState<ComponentType | null>(null);
  useEffect(() => {
    let done = false;
    const go = () => { if (done) return; done = true; void loadViewer().then((m) => setHost(() => m.ImageViewerHost)); };
    need = go;
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
    const h = w.requestIdleCallback ? w.requestIdleCallback(go, { timeout: 4000 }) : window.setTimeout(go, 1500);
    return () => { need = null; if (!w.requestIdleCallback) window.clearTimeout(h); };
  }, []);
  return Host ? <Host /> : null;
}
