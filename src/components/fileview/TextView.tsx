'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { fmtNum } from '@/lib/i18n/core';
import type { Place } from '@/lib/fileView';
import { Markdown } from '../Markdown';
import { useVirtual } from './useVirtual';

const BLOCK = 200;
const LH = 20;

type Win = { lines?: string[]; total?: number; binary?: boolean; truncated?: boolean };

export function TextView({ id, total, md, extracted, binary, truncated, at, marks, onPlace }: { id: string; total: number; md: boolean; extracted?: boolean; binary: boolean; truncated: boolean; at?: Place; marks: Place[]; onPlace?: (s: string) => void }) {
  const tx = useT();
  const [source, setSource] = useState(!md);
  const cache = useRef(new Map<number, string>());
  const asked = useRef(new Set<number>());
  const [ver, setVer] = useState(0);
  const [failed, setFailed] = useState(false);
  const v = useVirtual(total, LH, 10);
  const markLines = useMemo(() => { const s = new Set<number>(); for (const m of marks) if (m.kind === 'line' && m.line) for (let l = m.line; l <= Math.min(m.line_to ?? m.line, m.line + 2000); l++) s.add(l); return s; }, [marks]);
  const quote = at?.quote;

  const fetchBlock = useCallback(async (b: number) => {
    if (asked.current.has(b)) return;
    asked.current.add(b);
    try {
      const from = b * BLOCK + 1;
      const r = await fetch(`/api/files/${id}/text?from=${from}&to=${from + BLOCK - 1}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as Win;
      (j.lines ?? []).forEach((t, i) => cache.current.set(from + i, t));
      setVer((x) => x + 1);
    } catch { asked.current.delete(b); setFailed(true); }
  }, [id]);

  useEffect(() => {
    if (!source || binary) return;
    for (let b = Math.floor(v.first / BLOCK); b <= Math.floor(Math.max(0, v.last) / BLOCK); b++) void fetchBlock(b);
  }, [source, binary, v.first, v.last, fetchBlock]);

  const [attLine, setAttLine] = useState<number | null>(null);
  useEffect(() => {
    setAttLine(null);
    if (!extracted || !at?.attachment) return;
    let dead = false;
    const name = at.attachment;
    const tries = [at.kind === 'page' && at.page ? `[вложение «${name}», page ${at.page}]` : at.kind === 'slide' && at.slide ? `[вложение «${name}», slide ${at.slide}]` : '', `[вложение «${name}»`].filter(Boolean);
    (async () => {
      for (const needle of tries) {
        const r = await fetch(`/api/files/${id}/text?find=${encodeURIComponent(needle)}`);
        const j = (await r.json()) as { line?: number | null };
        if (j.line) { if (!dead) setAttLine(j.line); return; }
      }
    })().catch(() => {});
    return () => { dead = true; };
  }, [id, extracted, at?.attachment, at?.kind, at?.page, at?.slide]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = at?.line ?? attLine ?? null;
  const done = useRef('');
  useEffect(() => {
    if (!source || !target) return;
    const k = `${id}|${target}`;
    if (done.current === k) return;
    done.current = k;
    requestAnimationFrame(() => v.scrollTo(target - 1));
    onPlace?.(tx('files.line', { n: String(target) }));
  });

  const [mdText, setMdText] = useState<string | null>(null);
  useEffect(() => {
    if (!md || source || binary) return;
    let dead = false;
    (async () => {
      const parts: string[] = [];
      for (let from = 1; from <= Math.min(total, 40000); from += 5000) {
        const r = await fetch(`/api/files/${id}/text?from=${from}&to=${from + 4999}`);
        if (!r.ok) { setFailed(true); return; }
        parts.push(((await r.json()) as Win).lines?.join('\n') ?? '');
      }
      if (!dead) setMdText(parts.join('\n'));
    })().catch(() => setFailed(true));
    return () => { dead = true; };
  }, [md, source, binary, id, total]);

  if (binary) return <p className="fv-note" data-testid="text-binary">{tx('files.binary')}</p>;
  const out = [];
  const w = String(total).length;
  for (let i = v.first; i <= v.last && i < total; i++) {
    const n = i + 1;
    const t = cache.current.get(n);
    const mark = markLines.has(n) || n === target;
    const hit = !!quote && !!t && t.toLowerCase().includes(quote.toLowerCase().slice(0, 40));
    out.push(
      <div key={n} className={`fv-line${mark ? ' is-mark' : ''}${hit ? ' is-hit' : ''}`} style={{ transform: `translateY(${i * LH}px)`, height: LH }} data-line={n} data-testid="text-line" data-mark={mark || undefined}>
        <span className="fv-ln" style={{ width: `${w + 2}ch` }}>{n}</span>
        <span className="fv-lt">{t ?? ''}</span>
      </div>,
    );
  }
  void ver;
  return (
    <div className="fv-text" data-testid="text-view">
      {extracted && <p className="fv-note" data-testid="text-extracted">{tx('files.extractedNote')}</p>}
      {md && (
        <div className="fv-gbar">
          <div className="seg" role="group">
            <button type="button" className={`btn${!source ? ' btn--primary' : ''}`} aria-pressed={!source} data-testid="md-rendered" onClick={() => setSource(false)}>Markdown</button>
            <button type="button" className={`btn${source ? ' btn--primary' : ''}`} aria-pressed={source} data-testid="md-source" onClick={() => setSource(true)}>{'</>'}</button>
          </div>
          <span className="grow" />
          <small className="fv-pos">{fmtNum(tx.lang, total)}</small>
        </div>
      )}
      {source ? (
        <div className="fv-tscroll" ref={v.ref} data-testid="text-scroll">
          <div className="fv-tinner" style={{ height: v.height, minWidth: '100%' }}>{out}</div>
        </div>
      ) : (
        <div className="fv-md">{mdText === null ? <p className="fv-note">{tx('files.loading')}</p> : <Markdown text={mdText} />}</div>
      )}
      {failed && <p className="fv-note is-err" role="alert">{tx('files.err')}</p>}
      {truncated && <p className="fv-note">{tx('files.truncated')}</p>}
    </div>
  );
}
