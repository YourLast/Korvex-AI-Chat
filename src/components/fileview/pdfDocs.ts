import type { PDFDocumentProxy } from 'pdfjs-dist';
import { docParams, docUrlParams, loadPdfjs, type PdfjsLib } from './pdfjs';

export type Size = [number, number];
type Item = { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean };
export type PdfDoc = { id: string; lib: PdfjsLib; doc: PDFDocumentProxy; sizes: Record<number, Size>; text: (num: number) => Promise<Item[]> };
type Base = PdfDoc;
export type PdfHandle = PdfDoc & { release: () => void };
type Entry = { id: string; p: Promise<Base>; base?: Base; refs: number; used: number; abort: AbortController; task?: { destroy: () => Promise<void> } };

export const KEEP = 3;
const TEXTS = 24;
const entries = new Map<string, Entry>();
let tick = 0;

class PrepError extends Error { code: string; constructor(code: string) { super(code); this.code = code; } }
export const pdfErrorCode = (e: unknown): string => (e instanceof PrepError ? e.code : String((e as Error)?.message || 'pdf').slice(0, 80));

async function fetchBytes(id: string, e: Entry, onPrep: () => void): Promise<ArrayBuffer> {
  for (let i = 0; i < 60 && !e.abort.signal.aborted; i++) {
    const r = await fetch(`/api/files/${id}/pdf?wait=12000`, { credentials: 'same-origin', signal: e.abort.signal });
    if (r.status === 202) { onPrep(); continue; }
    if (!r.ok) { const j = await r.json().catch(() => ({} as { code?: string })); throw new PrepError(String((j as { code?: string }).code ?? r.status)); }
    return r.arrayBuffer();
  }
  throw new PrepError('pending');
}

function start(id: string, onPrep: () => void, ranged: boolean): Entry {
  const e: Entry = { id, p: null as never, refs: 0, used: ++tick, abort: new AbortController() };
  e.abort.signal.addEventListener('abort', () => { void e.task?.destroy().catch(() => {}); });
  e.p = (async () => {
    const lib = await loadPdfjs();
    let doc: PDFDocumentProxy | null = null;
    if (ranged) {
      try { const t = lib.getDocument(docUrlParams(`/api/files/${id}/pdf`)); e.task = t; doc = await t.promise; }
      catch { void e.task?.destroy().catch(() => {}); e.task = undefined; if (e.abort.signal.aborted) throw new PrepError('aborted'); }
    }
    if (!doc) {
      const buf = await fetchBytes(id, e, onPrep);
      const task = lib.getDocument(docParams(new Uint8Array(buf)));
      e.task = task;
      doc = await task.promise;
    }
    const p1 = await doc.getPage(1);
    const v = p1.getViewport({ scale: 1 });
    const texts = new Map<number, Promise<Item[]>>();
    const base: Base = {
      id, lib, doc, sizes: { 1: [v.width, v.height] },
      text: (num) => {
        const t = texts.get(num);
        if (t) { texts.delete(num); texts.set(num, t); return t; }
        const p = doc.getPage(num).then((pg) => pg.getTextContent()).then((c) => c.items as unknown as Item[]);
        texts.set(num, p);
        p.catch(() => texts.delete(num));
        while (texts.size > TEXTS) texts.delete(texts.keys().next().value as number);
        return p;
      },
    };
    e.base = base;
    return base;
  })();
  e.p.catch(() => { if (entries.get(id) === e) entries.delete(id); });
  entries.set(id, e);
  return e;
}

function trim() {
  if (entries.size <= KEEP) return;
  const idle = [...entries.values()].filter((e) => e.refs === 0 && e.base).sort((a, b) => a.used - b.used);
  for (const e of idle) {
    if (entries.size <= KEEP) break;
    entries.delete(e.id);
    void e.task?.destroy().catch(() => {});
  }
}

function handle(e: Entry, b: Base): PdfHandle {
  e.refs++; e.used = ++tick;
  let done = false;
  return {
    ...b,
    release: () => { if (done) return; done = true; e.refs--; e.used = ++tick; trim(); },
  };
}

export function peekPdf(id: string): PdfDoc | null { return entries.get(id)?.base ?? null; }

export async function acquirePdf(id: string, onPrep: () => void = () => {}, signal?: AbortSignal, ranged = false): Promise<PdfHandle> {
  const e = entries.get(id) ?? start(id, onPrep, ranged);
  e.refs++;
  let gone = false, onAbort: (() => void) | undefined;
  const aborted = signal ? new Promise<never>((_, rej) => { onAbort = () => { gone = true; rej(new DOMException('aborted', 'AbortError')); }; if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }) : null;
  aborted?.catch(() => {});
  try {
    const b = await (aborted ? Promise.race([e.p, aborted]) : e.p);
    if (gone) throw new DOMException('aborted', 'AbortError');
    e.refs--;
    return handle(e, b);
  } catch (err) {
    e.refs--;
    if (e.refs === 0 && !e.base) { e.abort.abort(); if (entries.get(id) === e) entries.delete(id); }
    throw err;
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

export function prefetchPdf(id: string): void {
  if (entries.has(id)) { const e = entries.get(id)!; e.used = ++tick; return; }
  void acquirePdf(id, undefined, undefined, true).then((h) => h.release()).catch(() => {});
}

export const _resetPdfDocs = () => { for (const e of entries.values()) { e.abort.abort(); void e.task?.destroy().catch(() => {}); } entries.clear(); tick = 0; };
export const _pdfDocsState = () => ({ ids: [...entries.keys()], refs: [...entries.values()].map((e) => e.refs) });
