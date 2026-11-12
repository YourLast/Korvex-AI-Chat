'use client';
import { memo, useState } from 'react';
import { stepShort, stepTitle, type Seg, type StepKind, type ToolStep, type ToolSummary } from '@/lib/reasoningSteps';
import { useT } from '@/lib/i18n/react';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import '@/styles/tool-steps.css';

const ICON: Record<StepKind, string> = { bash: 'terminal', python: 'code', web: 'globe', memory: 'file-search', table: 'table' };

function Status({ s }: { s: ToolStep }) {
  const t = useT();
  if (s.status === 'running') return <span className="tstep-st is-run" data-testid="tool-status"><i className="tstep-dot" aria-hidden="true" />{t('work.st.running')}</span>;
  if (s.status === 'error') return <span className="tstep-st is-err" data-testid="tool-status">{t('work.st.err')}</span>;
  if (s.status === 'timeout') return <span className="tstep-st is-warn" data-testid="tool-status">{t('work.st.timeout')}</span>;
  return <span className="tstep-st" data-testid="tool-status">{s.result ?? t('work.st.done')}</span>;
}

export function ToolCard({ s }: { s: ToolStep }) {
  const { lang } = useT();
  const [open, setOpen] = useState(false);
  const can = !!s.query || s.out.length > 0;
  const cmd = s.kind === 'bash';
  return (
    <div className={`tstep is-${s.status}${open ? ' is-open' : ''}`} data-testid="tool-step" data-kind={s.kind} data-status={s.status}>
      <button type="button" className="tstep-head" aria-expanded={can ? open : undefined} disabled={!can} onClick={() => setOpen(!open)}
        aria-label={`${stepTitle(s.kind, lang)}${s.query ? ': ' + s.query : ''}`} title={stepTitle(s.kind, lang)}>
        <Icon n={ICON[s.kind]} sm className="tstep-ic" />
        <b className="tstep-title">{stepShort(s.kind, lang)}</b>
        {s.query ? <span className="tstep-q" data-testid="tool-query">{s.query}</span> : <span className="tstep-q" />}
        <Status s={s} />
        {can && <Icon n="chev-right" sm className="tstep-chev" />}
      </button>
      {open && (
        <div className="tstep-body">
          {s.query && (cmd ? <pre className="tstep-code" data-testid="tool-cmd"><code>{s.query}</code></pre> : <p className="tstep-full">{s.query}</p>)}
          {s.out.length > 0 && (s.code
            ? <pre className="tstep-code tstep-code--out" data-testid="tool-out">{s.out.join('\n')}{s.more ? '\n…' : ''}</pre>
            : <p className="tstep-full tstep-full--out" data-testid="tool-out">{s.out.join('\n')}{s.more ? '\n…' : ''}</p>)}
        </div>
      )}
    </div>
  );
}

export function closeOpen(s: string): string {
  const fences = (s.match(/^\s*```/gm) ?? []).length;
  if (fences % 2) return s.replace(/\s*$/, '') + '\n```';
  let t = s;
  const lastPara = () => t.slice(t.lastIndexOf('\n\n') + 1);
  const p = lastPara();
  if ((p.match(/\*\*/g) ?? []).length % 2) {
    const at = t.lastIndexOf('**');
    t = t.slice(at + 2).trim() ? t + '**' : t.slice(0, at);
  }
  if ((lastPara().replace(/```/g, '').match(/`/g) ?? []).length % 2) t += '`';
  return t;
}

const ThinkText = memo(function ThinkText({ text, live }: { text: string; live: boolean }) {
  return <div className="think-md"><Markdown text={live ? closeOpen(text) : text} live={live} /></div>;
});

export function ThinkBody({ segs, live = false }: { segs: Seg[]; live?: boolean }) {
  if (!segs.length) return <p className="t-cap">…</p>;
  return (
    <>
      {segs.map((g, i) => {
        if (g.t === 'step') return <ToolCard key={i} s={g.step} />;
        if (g.t === 'note') return <p key={i} className="tnote" data-testid="tool-note"><Icon n={g.kind === 'check' ? 'retry' : 'file-text'} sm /><span>{g.text}</span></p>;
        return <ThinkText key={i} text={g.text} live={live && i === segs.length - 1} />;
      })}
    </>
  );
}

export function ToolIcons({ s, label }: { s: ToolSummary; label: string }) {
  const items: [string, number][] = [['terminal', s.bash], ['code', s.calc], ['search', s.search]];
  return (
    <span className="think-ticons" role="img" aria-label={label} data-testid="think-ticons">
      {items.filter(([, n]) => n > 0).map(([ic, n]) => <span key={ic}><Icon n={ic} sm /><span className="tnum">{n}</span></span>)}
    </span>
  );
}
