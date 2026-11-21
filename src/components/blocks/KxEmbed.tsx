'use client';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { parseBlock, type ParseErr } from '@/lib/blocks/parse';
import { kindWord } from '@/lib/blocks/text';
import type { Block } from '@/lib/blocks/schema';
import { useBlockEnv } from './BlockEnv';

const BlockView = lazy(() => import('./BlockView'));

const sniffType = (raw: string) => /"type"\s*:\s*"([a-z]+)"/.exec(raw)?.[1] ?? 'block';

export function BlockHold({ type }: { type: string }) {
  const tx = useT();
  return (
    <div className={`kxb kxb-hold kxb-hold--${type}`} data-testid="kxb-hold" aria-busy="true">
      <div className="kxb-head"><span className="kxb-title kxb-sk" /></div>
      <div className="kxb-hold-in"><span className="t-cap">{tx('blk.loading', { kind: kindWord(type, tx.lang) })}</span></div>
    </div>
  );
}

export function BlockError({ err, raw, href }: { err: ParseErr | 'file' | 'later'; raw?: string; href?: string }) {
  const tx = useT();
  const [open, setOpen] = useState(false);
  const why = err === 'file' ? tx('blk.err.file') : err === 'later' ? tx('blk.err.later')
    : err.code === 'size' ? tx('blk.err.size', { kb: err.detail ?? '' })
    : err.code === 'version' ? tx('blk.err.version', { v: err.detail ?? '' })
    : err.code === 'type' ? tx('blk.err.type', { v: err.detail ?? '' })
    : err.code === 'schema' ? tx('blk.err.schema', { v: err.detail ?? '' })
    : tx(`blk.err.${err.code}` as 'blk.err.json');
  return (
    <div className="kxb kxb-err" role="note" data-testid="kxb-err">
      <p className="kxb-err-t">{err === 'later' ? why : tx('blk.err.title', { why })}</p>
      {(raw || href) && (
        <div className="kxb-err-acts">
          {raw && <button type="button" className="k-link" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="kxb-err-data">{tx(open ? 'blk.hideData' : 'blk.showData')}</button>}
          {href && <a className="k-link" href={href} target="_blank" rel="noopener noreferrer">{href.split('/').pop() && decodeURIComponent(href.split('/').pop()!)}</a>}
        </div>
      )}
      {open && raw && <pre className="kxb-raw">{raw}</pre>}
    </div>
  );
}

function View({ block, raw, href }: { block: Block; raw?: string; href?: string }) {
  return <Suspense fallback={<BlockHold type={block.type} />}><BlockView block={block} raw={raw} href={href} /></Suspense>;
}

export function KxFence({ raw }: { raw: string }) {
  const { live } = useBlockEnv();
  const text = raw.trim();
  const p = useMemo(() => (text ? parseBlock(text, 'fence') : null), [text]);
  if (!p || !p.ok) {
    if (live) return <BlockHold type={sniffType(text)} />;
    return <BlockError err={p ? p.err : { code: 'json' }} raw={text} />;
  }
  return <View block={p.block} raw={text} />;
}

export function KxFile({ href, name }: { href: string; name: string }) {
  const { snap } = useBlockEnv();
  const saved = snap?.files?.[href];
  const [st, setSt] = useState<{ block?: Block; err?: ParseErr | 'file'; raw?: string } | null>(saved ? { block: saved } : null);
  useEffect(() => {
    if (saved) { setSt({ block: saved }); return; }
    let dead = false;
    void fetch(href, { credentials: 'same-origin' }).then(async (r) => {
      if (!r.ok) throw new Error(String(r.status));
      const raw = await r.text();
      const p = parseBlock(raw, 'file');
      if (!dead) setSt(p.ok ? { block: p.block } : { err: p.err, raw: raw.slice(0, 20000) });
    }).catch(() => { if (!dead) setSt({ err: 'file' }); });
    return () => { dead = true; };
  }, [href, saved]);
  if (!st) return <BlockHold type="table" />;
  if (st.err) return <BlockError err={st.err} raw={st.raw} href={href} />;
  return <View block={st.block!} href={href} raw={undefined} key={name} />;
}
