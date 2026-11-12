'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n/react';
import '@/styles/code.css';

export type DLine = { t: '+' | '-' | ' ' | '@' | '\\'; text: string; a: number | null; b: number | null; hl?: [number, number]; ws?: boolean };
export type DFile = { path: string; oldPath: string | null; status: 'A' | 'M' | 'D' | 'R'; added: number; removed: number; lines: DLine[]; binary: boolean };

export function parseDiff(diff: string): DFile[] {
  const out: DFile[] = [];
  let f: DFile | null = null;
  let a = 0, b = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const m = raw.match(/^diff --git a\/(.*) b\/(.*)$/);
      f = { path: m?.[2] ?? raw.slice(11), oldPath: null, status: 'M', added: 0, removed: 0, lines: [], binary: false };
      out.push(f);
      continue;
    }
    if (!f) continue;
    if (raw.startsWith('new file mode')) { f.status = 'A'; continue; }
    if (raw.startsWith('deleted file mode')) { f.status = 'D'; continue; }
    if (raw.startsWith('rename from ')) { f.status = 'R'; f.oldPath = raw.slice(12); continue; }
    if (raw.startsWith('Binary files')) { f.binary = true; continue; }
    if (raw.startsWith('--- ') || raw.startsWith('+++ ') || raw.startsWith('index ') || raw.startsWith('similarity ') || raw.startsWith('rename to ') || raw.startsWith('old mode') || raw.startsWith('new mode')) continue;
    const h = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (h) { a = Number(h[1]); b = Number(h[2]); f.lines.push({ t: '@', text: h[3].trim(), a: null, b: null }); continue; }
    if (raw.startsWith('+')) { f.lines.push({ t: '+', text: raw.slice(1), a: null, b: b++ }); f.added++; }
    else if (raw.startsWith('-')) { f.lines.push({ t: '-', text: raw.slice(1), a: a++, b: null }); f.removed++; }
    else if (raw.startsWith(' ')) { f.lines.push({ t: ' ', text: raw.slice(1), a: a++, b: b++ }); }
    else if (raw.startsWith('\\')) f.lines.push({ t: '\\', text: raw, a: null, b: null });
  }
  for (const x of out) pairLines(x);
  return out;
}

export function pairLines(f: DFile) {
  const L = f.lines;
  const drop = new Set<DLine>();
  for (let i = 0; i < L.length; i++) {
    if (L[i].t !== '-') continue;
    let j = i; while (j < L.length && L[j].t === '-') j++;
    let k = j; while (k < L.length && L[k].t === '+') k++;
    let from = j;
    for (let p = i; p < j; p++) {
      const a = L[p];
      let best = -1, bs = 0.5;
      for (let q = from; q < k; q++) { const v = likeness(a.text, L[q].text); if (v > bs) { bs = v; best = q; } if (v === 1) break; }
      if (best < 0) continue;
      const b = L[best];
      from = best + 1;
      if (a.text === b.text) { b.t = ' '; b.a = a.a; drop.add(a); f.added--; f.removed--; continue; }
      let s0 = 0; while (s0 < a.text.length && s0 < b.text.length && a.text[s0] === b.text[s0]) s0++;
      let e = 0; while (e < a.text.length - s0 && e < b.text.length - s0 && a.text[a.text.length - 1 - e] === b.text[b.text.length - 1 - e]) e++;
      if (a.text.length - e > s0) a.hl = [s0, a.text.length - e];
      if (b.text.length - e > s0) b.hl = [s0, b.text.length - e];
      if (a.text.replace(/\s+/g, '') === b.text.replace(/\s+/g, '')) { a.ws = true; b.ws = true; }
    }
    i = k - 1;
  }
  if (drop.size) f.lines = L.filter((l) => !drop.has(l));
}

export function likeness(a: string, b: string): number {
  if (a === b || a.replace(/\s+/g, '') === b.replace(/\s+/g, '')) return 1;
  const n = Math.max(a.length, b.length);
  if (!n) return 1;
  let s0 = 0; while (s0 < a.length && s0 < b.length && a[s0] === b[s0]) s0++;
  let e = 0; while (e < a.length - s0 && e < b.length - s0 && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return (s0 + e) / n;
}

function marked(l: DLine): ReactNode {
  if (!l.hl) return l.text || '\u200b';
  const [a, b] = l.hl, mid = l.text.slice(a, b);
  return <>{l.text.slice(0, a)}<mark className={`dv-hl${l.ws ? ' is-ws' : ''}`}>{l.ws ? mid.replace(/ /g, '·').replace(/\t/g, '→') || '¶' : mid}</mark>{l.text.slice(b)}</>;
}

const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
  yml: 'yaml', yaml: 'yaml', json: 'json', toml: 'ini', ini: 'ini', md: 'markdown', css: 'css', scss: 'scss', html: 'xml', xml: 'xml', svg: 'xml', sql: 'sql',
  dockerfile: 'dockerfile', makefile: 'makefile', lua: 'lua', r: 'r', vue: 'xml',
};
export function langOf(p: string): string | null {
  const base = p.split('/').pop()!.toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  return LANG[base.split('.').pop() ?? ''] ?? null;
}

type Hl = { highlight: (code: string, o: { language: string; ignoreIllegals: boolean }) => { value: string }; getLanguage: (l: string) => unknown };
let hljsP: Promise<Hl> | null = null;
const loadHl = () => (hljsP ??= import('highlight.js/lib/common').then((m) => (m.default ?? m) as unknown as Hl));

function useHl(lines: DLine[], lang: string | null): string[] | null {
  const [html, setHtml] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    if (!lang || lines.length > 4000) { setHtml(null); return; }
    void loadHl().then((h) => {
      if (!live || !h.getLanguage(lang)) return;
      setHtml(lines.map((l) => (l.t === '+' || l.t === '-' || l.t === ' ' ? h.highlight(l.text, { language: lang, ignoreIllegals: true }).value : '')));
    }).catch(() => null);
    return () => { live = false; };
  }, [lines, lang]);
  return html;
}

export function FileDiff({ f, head, collapsed, maxLines = 1500, testId }: { f: DFile; head?: ReactNode; collapsed?: boolean; maxLines?: number; testId?: string }) {
  const t = useT();
  const [open, setOpen] = useState(!collapsed);
  const [all, setAll] = useState(false);
  const lines = useMemo(() => (all ? f.lines : f.lines.slice(0, maxLines)), [f.lines, all, maxLines]);
  const html = useHl(lines, langOf(f.path));
  const st = f.status === 'A' ? t('work.diff.new') : f.status === 'D' ? t('work.diff.deleted') : f.status === 'R' ? t('work.diff.renamed') : '';
  return (
    <div className="dv-file" data-testid={testId} data-status={f.status}>
      <div className="dv-head">
        <button type="button" className="dv-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <svg className="dv-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="dv-path" title={f.path}>{f.oldPath ? <>{f.oldPath} → </> : null}{f.path}</span>
          {st && <span className={`dv-tag dv-tag--${f.status}`}>{st}</span>}
          <span className="dv-stat"><span className="dv-plus">+{f.added}</span> <span className="dv-minus">−{f.removed}</span></span>
          <StatBar a={f.added} r={f.removed} />
        </button>
        {head && <span className="dv-acts">{head}</span>}
      </div>
      {open && (f.binary ? <div className="dv-note">{t('work.diff.binary')}</div> : (
        <div className="dv-body" role="table" aria-label={t('work.diff.aria', { path: f.path })}>
          {lines.map((l, i) => l.t === '@'
            ? <div key={i} className="dv-hunk" role="row"><span className="dv-n" /><span className="dv-n" /><span className="dv-c">{l.text ? `@@ ${l.text}` : '⋯'}</span></div>
            : l.t === '\\' ? <div key={i} className="dv-ln dv-meta" role="row"><span className="dv-n" /><span className="dv-n" /><span className="dv-c">{l.text}</span></div>
            : (
              <div key={i} className={`dv-ln${l.t === '+' ? ' dv-add' : l.t === '-' ? ' dv-del' : ''}`} role="row">
                <span className="dv-n">{l.a ?? ''}</span><span className="dv-n">{l.b ?? ''}</span>
                <span className="dv-s" aria-hidden="true">{l.t === ' ' ? '' : l.t === '-' ? '−' : '+'}</span>
                {l.hl ? <code className="dv-c">{marked(l)}</code>
                  : html?.[i] !== undefined && html[i] !== '' ? <code className="dv-c hljs" dangerouslySetInnerHTML={{ __html: html[i] || '&#8203;' }} /> : <code className="dv-c">{l.text || '​'}</code>}
              </div>
            ))}
          {!all && f.lines.length > maxLines && <button type="button" className="dv-more" onClick={() => setAll(true)}>{t('work.diff.more', { n: f.lines.length - maxLines })}</button>}
        </div>
      ))}
    </div>
  );
}

export function StatBar({ a, r }: { a: number; r: number }) {
  const t = a + r;
  const g = t ? Math.round((a / t) * 5) : 0;
  const red = t ? Math.min(5 - g, Math.round((r / t) * 5)) : 0;
  return <span className="dv-bar" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < g ? 'g' : i < g + red ? 'r' : ''} />)}</span>;
}

export function DiffView({ diff, collapsed, head, empty, testId }: { diff: string; collapsed?: boolean; head?: (f: DFile) => ReactNode; empty?: string; testId?: string }) {
  const t = useT();
  const files = useMemo(() => parseDiff(diff), [diff]);
  if (!files.length) return <div className="dv-empty">{empty ?? t('work.diff.none')}</div>;
  return <div className="dv" data-testid={testId}>{files.map((f) => <FileDiff key={f.path} f={f} head={head?.(f)} collapsed={collapsed && files.length > 3} testId={`dv-${f.path}`} />)}</div>;
}

export function StepDetail({ text }: { text: string }) {
  const parts: { k: 'text' | 'diff' | 'code'; v: string }[] = [];
  const re = /```(\w*)\n([\s\S]*?)\n```/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ k: 'text', v: text.slice(last, m.index) });
    parts.push({ k: m[1] === 'diff' ? 'diff' : 'code', v: m[2].replace(/``\u200b`/g, '```') });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ k: 'text', v: text.slice(last) });
  return (
    <div className="dv-step" data-testid="agent-step-detail">
      {parts.map((p, i) => p.k === 'diff' ? <DiffView key={i} diff={p.v + '\n'} />
        : p.k === 'code' ? <pre key={i} className="cp-out dv-step-out">{p.v}</pre>
        : p.v.trim() ? <p key={i} className="tstep-full tstep-full--out">{p.v.trim()}</p> : null)}
    </div>
  );
}
