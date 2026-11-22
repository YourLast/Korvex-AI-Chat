'use client';
import { useEffect, useState } from 'react';
import type { MemoryState } from '@/lib/memoryView';
import type { ImportItem } from '@/lib/memoryImport';
import { useT } from '@/lib/i18n/react';
import { Button, CopyButton, toast } from './Kit';
import { Icon } from './Icon';
import '@/styles/user-memory.css';

const SKIP_KEY = { secret: 'tools.memset.imp.skipSecret', rules: 'tools.memset.imp.skipRules', client: 'tools.memset.imp.skipClient', sensitive: 'tools.memset.imp.skipSensitive', dup: 'tools.memset.imp.skipDup' } as const;

function useImport(onSaved: (s: MemoryState) => void) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [text, setText] = useState('');
  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [on, setOn] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || prompt) return;
    void fetch('/api/memory/import', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j: { prompt?: string } | null) => setPrompt(j?.prompt ?? '')).catch(() => {});
  }, [open, prompt]);
  const post = async (body: unknown) => {
    const r = await fetch('/api/memory/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    return r?.ok ? r.json() : null;
  };
  const parse = async () => {
    setBusy(true);
    try { const j = (await post({ action: 'parse', text })) as { items: ImportItem[] } | null; if (j) { setItems(j.items); setOn(j.items.map((x) => !x.skip && !x.unsure)); } }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!items) return;
    setBusy(true);
    try {
      const pick = items.filter((x, i) => !x.skip && on[i]).map((x) => ({ text: x.text, section: x.section }));
      const j = (await post({ action: 'save', items: pick })) as (MemoryState & { added: number; same: number }) | null;
      if (j) { toast(t('tools.memset.imp.saved', { n: j.added + j.same })); setItems(null); setText(''); setOpen(false); onSaved(j); }
    } finally { setBusy(false); }
  };
  const close = () => { setOpen(false); setItems(null); setText(''); };
  const toggle = (i: number) => setOn((v) => v.map((b, k) => (k === i ? !b : b)));
  const n = items ? items.filter((x, i) => !x.skip && on[i]).length : 0;
  return { t, open, setOpen, prompt, text, setText, items, setItems, on, toggle, busy, parse, save, close, n };
}
type Flow = ReturnType<typeof useImport>;

const Tick = ({ on }: { on: boolean }) => (on ? <Icon n="check" sm className="mim-tick is-on" /> : <span className="mim-tick" aria-hidden="true" />);

export function MemoryImportBlock({ onSaved }: { onSaved: (s: MemoryState) => void }) {
  return <VariantB f={useImport(onSaved)} />;
}

function VariantB({ f }: { f: Flow }) {
  const { t } = f;
  if (!f.open) return (
    <section className="mimb" data-testid="mem-import-group">
      <button type="button" className="mimb-open" onClick={() => f.setOpen(true)} data-testid="mem-import">
        <span className="mimb-t">{t('tools.memset.imp.row')}</span><span className="mimb-s">{t('tools.memset.imp.rowSub')}</span>
      </button>
    </section>
  );
  const take = f.items?.map((x, i) => ({ x, i })).filter(({ x }) => !x.skip) ?? [], skip = f.items?.filter((x) => x.skip) ?? [];
  return (
    <section className="mimb is-open" data-testid="mem-import-b">
      <div className="mimb-h"><h2>{t('tools.memset.imp.title')}</h2>
        <button type="button" className="mim-x" onClick={f.close} aria-label={t('common.close')} data-testid="mem-import-close"><Icon n="x" sm /></button></div>
      {!f.items ? (
        <>
          <ol className="mimb-steps">
            <li><span className="mim-n">1</span><span>{t('tools.memset.imp.step1')}</span> <CopyButton text={f.prompt} label={t('tools.memset.imp.copy')} kind="plain" testId="mem-import-copy" /></li>
            <li><span className="mim-n">2</span><span>{t('tools.memset.imp.step2')}</span></li>
          </ol>
          <textarea className="mimb-area" rows={6} maxLength={20000} value={f.text} onChange={(e) => f.setText(e.target.value)} placeholder={t('tools.memset.imp.pastePh')} aria-label={t('tools.memset.imp.paste')} data-testid="mem-import-text" />
          <div className="mim-acts mim-acts--b">
            <Button kind="primary" onClick={() => void f.parse()} busy={f.busy} disabled={!f.text.trim()} testId="mem-import-parse">{t('tools.memset.imp.parse')}</Button>
            <p className="mim-note">{t('tools.memset.imp.note')}</p>
          </div>
        </>
      ) : (
        <>
          <p className="mimb-lead">{take.length ? t('tools.memset.imp.pick') : t('tools.memset.imp.none')}</p>
          <ul className="mimb-list" data-testid="mem-import-list">
            {take.map(({ x, i }) => (
              <li key={i}><button type="button" className={`mimb-it${f.on[i] ? ' is-on' : ''}`} aria-pressed={!!f.on[i]} onClick={() => f.toggle(i)} data-testid="mem-import-check">
                <Tick on={!!f.on[i]} /><span className="mimb-tx">{x.text}<small>{x.unsure ? `${t('tools.memset.imp.unsure')} · ` : ''}{t(`tools.memset.s.${x.section}` as never)}</small></span>
              </button></li>
            ))}
          </ul>
          {skip.length > 0 && (
            <>
              <p className="mimb-lead mimb-lead--quiet">{t('tools.memset.imp.skipped')}</p>
              <ul className="mimb-list mimb-list--skip" data-testid="mem-import-skipped">
                {skip.map((x, i) => <li key={i}><span className="mimb-it"><span className="mim-tick mim-tick--none" aria-hidden="true" /><span className="mimb-tx">{x.text || '•••'}<small>{t(SKIP_KEY[x.skip!])}</small></span></span></li>)}
              </ul>
            </>
          )}
          <div className="mim-acts mim-acts--b">
            <Button kind="primary" onClick={() => void f.save()} busy={f.busy} disabled={!f.n} testId="mem-import-save">{t('tools.memset.imp.save', { n: f.n })}</Button>
            <Button onClick={() => f.setItems(null)} testId="mem-import-back">{t('tools.memset.imp.back')}</Button>
          </div>
        </>
      )}
    </section>
  );
}
