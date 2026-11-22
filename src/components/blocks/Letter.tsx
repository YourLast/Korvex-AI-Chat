'use client';
import { useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { copyText } from '@/lib/clipboard';
import { KX_VERSION } from '@/lib/blocks/schema';
import { Icon } from '../Icon';

export type LetterData = { to: string; subject: string; body: string; short: string };

export function parseLetter(raw: string): LetterData | null {
  try {
    const j = JSON.parse(raw.trim()) as Partial<Record<keyof LetterData, unknown>>;
    if (!j || typeof j !== 'object' || typeof j.body !== 'string' || !j.body.trim()) return null;
    const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    return { to: s(j.to), subject: s(j.subject), body: j.body.trim(), short: s(j.short) };
  } catch { return null; }
}
export function lettersIn(md: string): LetterData[] {
  return [...md.matchAll(/```letter[^\n]*\n([\s\S]*?)```/g)].map((m) => parseLetter(m[1])).filter((x): x is LetterData => !!x);
}
export const withoutLetters = (md: string) => md.replace(/\n?```letter[^\n]*\n([\s\S]*?)```\n?/g, (all, body: string) => (parseLetter(body) ? '\n' : all));

const mailto = (l: LetterData, text: string) => `mailto:?subject=${encodeURIComponent(l.subject)}&body=${encodeURIComponent(text)}`;
const paras = (text: string) => text.split(/\n{2,}/).map((p, i) => <p key={i}>{p.split('\n').map((ln, k) => <span key={k}>{k > 0 && <br />}{ln}</span>)}</p>);

export function LetterView({ l, bare }: { l: LetterData; bare?: boolean }) {
  const t = useT();
  const [mode, setMode] = useState<'body' | 'short'>('body');
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState<{ body: string; short: string }>({ body: l.body, short: l.short });
  const [copied, setCopied] = useState(false);
  const cur = text[mode] || text.body;
  const copy = () => { void copyText(cur).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1600); } }); };
  return (
    <section className={`kxb kxb--letter${bare ? ' kxl-bare' : ''}`} aria-label={t('letter.title')} data-testid="letter">
      <header className="kxb-head">
        <div className="kxb-ht">
          <span className="kxb-title">{l.to ? `${t('letter.title')} · ${l.to}` : t('letter.title')}</span>
          {l.subject && <span className="kxb-sub">{t('letter.subject', { s: l.subject })}</span>}
        </div>
        <div className="kxb-acts">
          <button type="button" className="kxb-btn" onClick={copy} data-testid="letter-copy"><Icon n={copied ? 'check' : 'copy'} sm />{t(copied ? 'letter.copied' : 'letter.copy')}</button>
          <a className="kxb-btn" href={mailto(l, cur)} data-testid="letter-mail"><Icon n="mail" sm />{t('letter.mail')}</a>
          <button type="button" className="kxb-btn" aria-pressed={edit} onClick={() => setEdit((e) => !e)} data-testid="letter-edit"><Icon n={edit ? 'check' : 'edit'} sm />{t(edit ? 'letter.done' : 'letter.edit')}</button>
        </div>
      </header>
      {l.short && (
        <div className="kxl-mode" role="tablist" aria-label={t('letter.kind')}>
          {(['body', 'short'] as const).map((k, i) => (
            <span key={k}>{i > 0 && <span aria-hidden="true"> · </span>}
              <button type="button" role="tab" aria-selected={mode === k} className={`kxl-tab${mode === k ? ' is-on' : ''}`} onClick={() => setMode(k)} data-testid={`letter-${k}`}>{t(k === 'body' ? 'letter.full' : 'letter.short')}</button>
            </span>
          ))}
        </div>
      )}
      {edit
        ? <textarea className="kxl-edit" value={cur} rows={Math.min(16, cur.split('\n').length + 2)} onChange={(e) => setText((x) => ({ ...x, [mode]: e.target.value }))} aria-label={t('letter.edit')} data-testid="letter-text" />
        : <div className="kxl-text" data-testid="letter-body">{paras(cur)}</div>}
    </section>
  );
}

export function LettersList({ list }: { list: LetterData[] }) {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const all = list.map((l) => `${l.to ? `${l.to}\n` : ''}${l.subject ? `${t('letter.subject', { s: l.subject })}\n\n` : ''}${l.body}`).join('\n\n———\n\n');
  const xlsx = async () => {
    const block = { kx: KX_VERSION, type: 'table', title: t('letter.many', { n: String(list.length) }), source: { kind: 'calc', basis: t('letter.basis') },
      data: { columns: [{ key: 'to', title: t('letter.colTo') }, { key: 'subject', title: t('letter.colSubject') }, { key: 'body', title: t('letter.full') }, { key: 'short', title: t('letter.short') }],
        rows: list.map((l) => ({ to: l.to, subject: l.subject, body: l.body.slice(0, 2000), short: l.short.slice(0, 2000) })) } };
    const r = await fetch('/api/blocks/xlsx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ block }) }).catch(() => null);
    if (!r?.ok) return;
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = `${t('letter.many', { n: String(list.length) })}.xlsx`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <section className="kxb kxb--letters" data-testid="letters">
      <header className="kxb-head">
        <div className="kxb-ht"><span className="kxb-title">{t('letter.many', { n: String(list.length) })}</span></div>
        <div className="kxb-acts">
          <button type="button" className="kxb-btn" onClick={() => { void copyText(all).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1600); } }); }} data-testid="letters-copy">
            <Icon n={copied ? 'check' : 'copy'} sm />{t(copied ? 'letter.copied' : 'letter.copyAll')}
          </button>
          <button type="button" className="kxb-btn" onClick={() => void xlsx()} data-testid="letters-xlsx"><Icon n="download" sm />{t('letter.xlsx')}</button>
        </div>
      </header>
      <ul className="kxl-list">
        {list.map((l, i) => (
          <li key={i}>
            <button type="button" className="kxl-row" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} data-testid="letters-row">
              <span className="kxl-to">{l.to || t('letter.title')}</span><span className="kxl-subj">{l.subject}</span><Icon n={open === i ? 'chev-up' : 'chev-down'} sm />
            </button>
            {open === i && <LetterView l={l} bare />}
          </li>
        ))}
      </ul>
    </section>
  );
}
