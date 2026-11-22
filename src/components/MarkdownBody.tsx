'use client';
import { Children, cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { KATEX_BASE, prepMath } from '@/lib/mathprep';
import { useT } from '@/lib/i18n/react';
import type { Key } from '@/lib/i18n/core';
import { Icon } from './Icon';
import { OutImage } from './OutImage';
import { FileCard } from './FileCard';
import { provideMarkdown } from './Markdown';
import { SrcChip, WebChips } from './SrcChip';
import { SRC_MARKER, parseMarker } from '@/lib/srcmark';
import { WEB_MARKER, outsideCode, webTargets } from '@/lib/webmark';
import { OUT_PREFIX } from '@/ext/client';
import { copyText } from '@/lib/clipboard';
import { KxFence, KxFile } from './blocks/KxEmbed';
import { isKxbHref } from '@/lib/blocks/text';
import '@/styles/user-memory.css';

const DL_RE = /📎\s*\[([^\]]+)\]\(([^)\s]+)\)(?:\s*\(([^)]+)\))?/g;
const IMG_MD_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const IMG_EXT_RE = /\.(png|jpe?g|gif|webp)$/i;
const OPEN_TAIL = /\[\[(?:s(?:r(?:c(?::[^\]]*)?)?)?)?\]?$|\[\[(?:https?:\/\/)?[\p{L}\p{N}][\p{L}\p{N}.-]*(?:[/?#][^\s\[\]]*)?\]?$/u;

export function srcLinks(s: string): string {
  if (!s.includes('[[')) return s;
  return outsideCode(s, (p) => {
    const hits = [...p.matchAll(SRC_MARKER)].map((m) => ({ at: m.index!, end: m.index! + m[0].length, raw: m[0].replace(/\s+/g, ' '), file: parseMarker(m[1]).file }));
    let out = '', pos = 0;
    for (let k = 0; k < hits.length;) {
      let e = k;
      while (e + 1 < hits.length && hits[e + 1].file === hits[k].file && /^[\s,;]*(?:и|and|i)?[\s,;]*$/i.test(p.slice(hits[e].end, hits[e + 1].at))) e++;
      out += p.slice(pos, hits[k].at) + `[↗](#kxsrc "${encodeURIComponent(hits.slice(k, e + 1).map((h) => h.raw).join('\u0001'))}")`;
      pos = hits[e].end; k = e + 1;
    }
    out += p.slice(pos);
    out = out.replace(WEB_MARKER, (m0, inner: string) => (webTargets(inner) ? `[↗](#kxweb "${encodeURIComponent(inner)}")` : m0));
    return out.replace(OPEN_TAIL, () => '[…](#kxsrc "pending")');
  });
}

const DL_MARK = 'kx-dl';
export function pre(s0: string): string {
  const s = srcLinks(s0);
  const imgs = new Map<string, string | null>();
  for (const m of s.matchAll(IMG_MD_RE)) if (!imgs.has(m[2])) imgs.set(m[2], null);
  const seenDl = new Set<string>();
  let out = s.replace(DL_RE, (_m, name: string, url: string, size?: string) => {
    if (imgs.has(url) && (IMG_EXT_RE.test(name) || IMG_EXT_RE.test(url))) { if (size && !imgs.get(url)) imgs.set(url, size); return ''; }
    if (seenDl.has(url)) return '';
    seenDl.add(url);
    return `[${name}](${url}${size ? ` "${size}"` : ''})`;
  });
  const shown = new Set<string>();
  out = out.replace(IMG_MD_RE, (m0, alt: string, url: string) => {
    if (!imgs.has(url)) return m0;
    if (shown.has(url)) return '';
    shown.add(url);
    const hadDl = s.includes(`](${url})`) && [...s.matchAll(DL_RE)].some((d) => d[2] === url);
    if (!hadDl) return m0;
    const size = imgs.get(url);
    return `![${alt}](${url} "${DL_MARK}${size ? '|' + size.replace(/"/g, '') : ''}")`;
  });
  return out;
}

const safeDecode = (t: unknown) => { try { return decodeURIComponent(String(t ?? '')); } catch { return String(t ?? ''); } };
const NUM_RE = /^[\s\d.,  %+\-−–₽$€:/]+$/;
type H = { type?: string; tagName?: string; value?: string; children?: H[] };
const textOf = (n: H): string => (n.value ?? '') + (n.children ?? []).map(textOf).join('');
function numericCols(table: H): boolean[] {
  const rows: H[][] = [];
  const walk = (n: H) => {
    if (n.tagName === 'tr') rows.push((n.children ?? []).filter((c) => c.tagName === 'td' || c.tagName === 'th'));
    else (n.children ?? []).forEach(walk);
  };
  walk(table);
  const body = rows.slice(1);
  const width = Math.max(0, ...rows.map((r) => r.length));
  return Array.from({ length: width }, (_, i) => {
    const cells = body.map((r) => textOf(r[i] ?? {}).trim()).filter(Boolean);
    return i > 0 && cells.length > 0 && cells.filter((c) => NUM_RE.test(c)).length / cells.length >= 0.7;
  });
}

export function MdTable({ children }: { children?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setEdge((e) => {
      const l = el.scrollLeft > 1, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      return e.l === l && e.r === r ? e : { l, r };
    });
    read();
    el.addEventListener('scroll', read, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => { el.removeEventListener('scroll', read); ro?.disconnect(); };
  }, []);
  return (
    <figure className="tbl md-tbl">
      <div ref={box} className="md-tbl-scroll" data-testid="md-tbl-scroll" data-l={edge.l || undefined} data-r={edge.r || undefined}><table>{children}</table></div>
    </figure>
  );
}

const L = ({ k, p }: { k: Key; p?: Record<string, string> }) => <>{useT()(k, p)}</>;
const FileWord = () => <>{useT()('md.file').toUpperCase()}</>;
function ExtImg({ alt }: { alt?: string }) {
  const tx = useT();
  return <span className="t-cap">{tx('md.image', { alt: alt || tx('md.imageExternal') })}</span>;
}

function CopyBtn({ text }: { text: string }) {
  const tx = useT();
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="icon-btn" aria-label={tx('md.copyCode')} onClick={() => { copyText(text).then((ok) => { if (ok) setOk(true); setTimeout(() => setOk(false), 1200); }); }}>
      <Icon n={ok ? 'check' : 'copy'} sm />
    </button>
  );
}

function Letter({ text }: { text: string }) {
  const tx = useT();
  const [ok, setOk] = useState(false);
  const body = text.replace(/\n+$/, '');
  return (
    <div className="letter" data-testid="letter">
      <div className="letter-body">{body.split(/\n{2,}/).map((p, i) => <p key={i}>{p.split('\n').map((l, k) => <span key={k}>{k > 0 && <br />}{l}</span>)}</p>)}</div>
      <button type="button" className="ans-link" onClick={() => { void copyText(body).then((r) => { if (r) { setOk(true); setTimeout(() => setOk(false), 1600); } }); }} data-testid="letter-copy">
        {tx(ok ? 'md.letterCopied' : 'md.letterCopy')}
      </button>
    </div>
  );
}

let currentNum: boolean[] = [];
const components: Components = {
  pre({ node, children }) {
    const code = (node as unknown as { children?: (H & { properties?: { className?: string[] } })[] })?.children?.[0];
    const lang = code?.properties?.className?.find((c) => c.startsWith('language-'))?.slice(9) ?? '';
    if (lang === 'korvex') return <KxFence raw={code ? textOf(code) : ''} />;
    if (lang === 'letter') return <Letter text={code ? textOf(code) : ''} />;
    return (
      <div className="code" data-testid="code-block">
        <div className="code-head"><span>{lang || <L k="md.code" />}</span><CopyBtn text={code ? textOf(code) : ''} /></div>
        <pre>{children}</pre>
      </div>
    );
  },
  a({ href, title, children }) {
    if (href === '#kxsrc') return <SrcChip raw={safeDecode(title)} />;
    if (href === '#kxweb') return <WebChips raw={safeDecode(title)} />;
    if (href?.startsWith(OUT_PREFIX)) {
      const name = typeof children === 'string' ? children : Array.isArray(children) ? children.join('') : '';
      const ext = (name.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] ?? '').toUpperCase();
      if (/^(PNG|JPE?G|GIF|WEBP)$/.test(ext)) return <OutImage src={href} name={name} size={title} />;
      if (isKxbHref(href)) return <KxFile href={href} name={name} />;
      const table = /^(XLSX|XLSM|XLS|ODS|CSV|TSV)$/.test(ext);
      return <FileCard href={href} name={name} table={table} meta={<>{ext || <FileWord />}{title ? ` · ${title}` : ''}</>}>{children}</FileCard>;
    }
    if (href === '/settings/memory#intro') return <a href={href} className="lnk-act" data-testid="intro-link">{children}<Icon n="chev-right" sm /></a>;
    if (href && /^\/(?!\/)/.test(href)) return <a href={href} className="lnk">{children}</a>;
    return <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="lnk">{children}</a>;
  },
  p({ node, children }) {
    const kids = (node as unknown as { children?: { tagName?: string; properties?: { href?: string } }[] })?.children ?? [];
    if (kids.some((k) => k.tagName === 'a' && isKxbHref(k.properties?.href))) return <div className="md-p">{children}</div>;
    return <p>{children}</p>;
  },
  img({ src, alt, title }) {
    const s = typeof src === 'string' ? src : '';
    if (typeof title === 'string' && title.startsWith(DL_MARK)) return <OutImage src={s} name={alt ?? ''} size={title.split('|')[1] || null} />;
    if (s.startsWith(OUT_PREFIX) || s.startsWith('data:image/')) return <OutImage src={s} name={alt ?? ''} bare />;
    return <ExtImg alt={alt} />;
  },
  table({ node, children }) {
    currentNum = numericCols(node as unknown as H);
    return <MdTable>{children}</MdTable>;
  },
  tr({ children }) {
    const cells = Children.toArray(children).map((c, i) =>
      isValidElement(c) && currentNum[i] ? cloneElement(c as ReactElement<{ className?: string }>, { className: 'n' }) : c,
    );
    return <tr>{cells as ReactNode}</tr>;
  },
};


const KATEX = { ...KATEX_BASE, throwOnError: false, errorColor: 'inherit' } as const;

const REMARK = [remarkGfm, remarkMath];
const REHYPE = [[rehypeKatex, KATEX], [rehypeHighlight, { detect: false }]] as NonNullable<Parameters<typeof ReactMarkdown>[0]['rehypePlugins']>;

const LRU = new Map<string, ReactElement>();
const LRU_MAX = 400;
export function renderMarkdown(text: string): ReactElement {
  const hit = LRU.get(text);
  if (hit) { LRU.delete(text); LRU.set(text, hit); return hit; }
  const el = ReactMarkdown({ remarkPlugins: REMARK, rehypePlugins: REHYPE, components, children: pre(prepMath(text)) });
  LRU.set(text, el);
  if (LRU.size > LRU_MAX) LRU.delete(LRU.keys().next().value as string);
  return el;
}

export function MarkdownBody({ text, live }: { text: string; live?: boolean }): ReactElement {
  return live ? ReactMarkdown({ remarkPlugins: REMARK, rehypePlugins: REHYPE, components, children: pre(prepMath(text)) }) : renderMarkdown(text);
}

provideMarkdown(MarkdownBody);

export default function MarkdownAssets() { return null; }
