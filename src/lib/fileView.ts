import { useSyncExternalStore } from 'react';
import type { Source } from './srcmark';
import { markerName } from './upload/paths';

export type Place = Pick<Source, 'kind' | 'sheet' | 'page' | 'page_to' | 'row' | 'row_to' | 'col' | 'slide' | 'line' | 'line_to' | 'quote' | 'attachment' | 'snippet'>;
export type FileTarget = {
  id: string; name: string;
  at?: Place;
  marks?: Place[];
};
export type FileView = { target: FileTarget | null; compare: { a: FileTarget; b: FileTarget } | null; seq: number };

let state: FileView = { target: null, compare: null, seq: 0 };
const subs = new Set<() => void>();
const emit = () => { subs.forEach((f) => f()); };
const set = (s: Partial<FileView>) => { state = { ...state, ...s, seq: state.seq + 1 }; emit(); if (typeof document !== 'undefined') document.documentElement.classList.toggle('fv-open', !!(state.target || state.compare)); };

export const openFile = (t: FileTarget) => set({ target: t, compare: null });
export const openCompare = (a: FileTarget, b: FileTarget) => set({ target: null, compare: { a, b } });
export const closeFile = () => set({ target: null, compare: null });
export const getFileView = () => state;
export const subscribeFileView = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useFileView = (): FileView => useSyncExternalStore(subscribeFileView, getFileView, getFileView);
export const _resetFileView = () => { state = { target: null, compare: null, seq: 0 }; subs.clear(); };

import type { FileChip } from './types';
let chatFiles: FileChip[] = [];
const fsubs = new Set<() => void>();
export const setChatFiles = (files: FileChip[]) => {
  if (files.length === chatFiles.length && files.every((f, i) => f.id === chatFiles[i].id)) return;
  chatFiles = files; fsubs.forEach((f) => f());
};
export const getChatFiles = () => chatFiles;
export const useChatFiles = (): FileChip[] => useSyncExternalStore((f) => { fsubs.add(f); return () => { fsubs.delete(f); }; }, getChatFiles, getChatFiles);

export function resolveFile(files: readonly FileChip[], ref: { file: string; file_ref?: string }): FileChip | null {
  if (ref.file_ref) { const h = files.find((f) => f.id === ref.file_ref); if (h) return h; }
  const p = ref.file.trim();
  const nm = (f: FileChip) => markerName(f.name).toLowerCase().normalize('NFC');
  const exact = files.find((f) => f.name === p || markerName(f.name) === p);
  if (exact) return exact;
  const low = p.toLowerCase().normalize('NFC');
  const ci = files.find((f) => nm(f) === low);
  if (ci) return ci;
  const base = low.slice(low.lastIndexOf('/') + 1);
  const same = files.filter((f) => nm(f).endsWith('/' + base) || nm(f) === base);
  return same.length === 1 ? same[0] : null;
}

const lev = (a: string, b: string): number => {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
};
export function nearFile(files: readonly FileChip[], name: string): boolean {
  const base = (x: string) => markerName(x).slice(markerName(x).lastIndexOf('/') + 1).toLowerCase().normalize('NFC');
  const a = base(name);
  return !!a && files.some((f) => { const b = base(f.name); return b !== '' && lev(a, b) <= Math.max(3, Math.round(0.3 * Math.max(a.length, b.length))); });
}
