'use client';
import { useFT } from './orgMode';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { Button, Sheet, toast } from './Kit';
import { colorClass } from './Folders';
import { useT } from '@/lib/i18n/react';
import { errText } from '@/lib/i18n/errors';
import type { Key } from '@/lib/i18n/core';
import type { FileChip, FolderView } from '@/lib/types';
import { DOC_TYPES, type DocType } from '@/lib/docType';
import { archiveKind } from '@/lib/upload/paths';
import '@/styles/org.css';

const KEY = 'kx.org';
const read = (): string | null => { try { return localStorage.getItem(KEY) || null; } catch { return null; } };

export function useOrg(folders: FolderView[], loaded: boolean): [string | null, (id: string | null) => void] {
  const [org, set] = useState<string | null>(null);
  useEffect(() => { set(read()); }, []);
  useEffect(() => { if (loaded && org && !folders.some((f) => f.id === org)) { set(null); try { localStorage.removeItem(KEY); } catch {  } } }, [folders, loaded, org]);
  const setOrg = useCallback((id: string | null) => {
    set(id);
    try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch {  }
  }, []);
  return [org, setOrg];
}

export function OrgSwitch({ folders, org, setOrg, onNew }: { folders: FolderView[]; org: string | null; setOrg: (id: string | null) => void; onNew: () => void }) {
  const t = useFT();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const cur = folders.find((f) => f.id === org) ?? null;
  const pick = (id: string | null) => { setOpen(false); setOrg(id); };
  return (
    <>
      <button ref={btn} type="button" className={`nav sb-quiet org-sw${cur ? ' is-on' : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} data-testid="org-switch" title={t('org.hint')}>
        <Icon n="folder" sm className={cur ? `fld-ic ${colorClass(cur.color)}` : undefined} />
        <span className="nav-t"><small>{t('org.label')}</small>{cur ? cur.name : t('org.all')}</span>
        <Icon n="chev-down" sm />
      </button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} side="bottom" align="left" title={t('org.pick')} sub={t('org.hint')} className="fld-pop" testId="org-pop">
        <div className="fld-menu">
          <button type="button" className="fld-mi" aria-pressed={!org} onClick={() => pick(null)} data-testid="org-all"><Icon n="layers" sm /><span>{t('org.all')}</span>{!org && <Icon n="check" sm className="fld-mi-on" />}</button>
          {folders.map((f) => (
            <button key={f.id} type="button" className="fld-mi" aria-pressed={org === f.id} onClick={() => pick(f.id)} data-testid="org-item">
              <Icon n="folder" sm className={`fld-ic ${colorClass(f.color)}`} /><span>{f.name}</span>{org === f.id && <Icon n="check" sm className="fld-mi-on" />}
            </button>
          ))}
          <button type="button" className="fld-mi" onClick={() => { setOpen(false); onNew(); }} data-testid="org-new"><Icon n="plus" sm /><span>{t('org.new')}</span></button>
        </div>
      </Popover>
    </>
  );
}

type Doc = { id: string; name: string; size: number; mime: string; type: DocType; date: string | null; from: string | null; to: string | null; number: string | null; sum: number | null; library: boolean };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function quickPeriod(kind: 'this' | 'last' | 'quarter', now = new Date()): [string, string] {
  const y = now.getFullYear(), m = now.getMonth();
  if (kind === 'this') return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
  if (kind === 'last') return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
  const q = Math.floor(m / 3) * 3;
  return [iso(new Date(y, q, 1)), iso(new Date(y, q + 3, 0))];
}
const ru = (d: string | null) => (d ? d.split('-').reverse().join('.') : '');

export function DocsButton({ org, orgName, onAdd }: { org: string | null; orgName: string | null; onAdd: (chips: FileChip[]) => void }) {
  const t = useFT();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={btn} type="button" className="icon-btn org-docs-btn" aria-label={t('org.docs')} title={orgName ? t('org.docsOf', { name: orgName }) : t('org.docs')} onClick={() => setOpen(true)} data-testid="org-docs"><Icon n="layers" /></button>
      <DocsPanel open={open} onClose={() => setOpen(false)} org={org} orgName={orgName} anchor={btn.current} onAdd={(c) => { onAdd(c); setOpen(false); toast(t('org.added', { n: c.length })); }} />
    </>
  );
}

async function upJson(r: Response | null): Promise<Record<string, unknown> & { error?: string; status?: number }> {
  if (!r) return { error: 'network' };
  const txt = await r.text().catch(() => '');
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(txt.trim() || '{}'); } catch { j = { error: txt.slice(0, 200) }; }
  if (!r.ok && !j.error) j.error = `HTTP ${r.status}`;
  return j as Record<string, unknown> & { error?: string };
}

export function DocsPanel({ open, onClose, org, orgName, anchor, onAdd }: { open: boolean; onClose: () => void; org: string | null; orgName: string | null; anchor?: HTMLElement | null; onAdd: (chips: FileChip[]) => void }) {
  const t = useFT();
  const [type, setType] = useState<DocType | ''>('');
  const [[from, to], setPeriod] = useState<[string, string]>(() => quickPeriod('last'));
  const [q, setQ] = useState('');
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [err, setErr] = useState('');
  const [up, setUp] = useState<{ k: number; n: number; bad: number } | null>(null);
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const u = new URLSearchParams();
    if (org) u.set('folder', org);
    if (type) u.set('type', type);
    if (from) u.set('from', from);
    if (to) u.set('to', to);
    if (q.trim()) u.set('q', q.trim());
    const r = await fetch(`/api/docs?${u}`, { cache: 'no-store' }).catch(() => null);
    if (!r?.ok) { setErr(t('org.loadErr')); return; }
    const j = await r.json() as { docs: Doc[]; counts: Record<string, number> };
    setErr(''); setDocs(j.docs); setCounts(j.counts);
    setSel((s) => new Set([...s].filter((id) => j.docs.some((d) => d.id === id))));
  }, [org, type, from, to, q, t]);
  useEffect(() => { if (!open) return; const id = window.setTimeout(() => void load(), q ? 250 : 0); return () => window.clearTimeout(id); }, [open, load, q]);
  useEffect(() => { if (!open) { setSel(new Set()); setUp(null); } }, [open]);

  const total = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts]);
  const all = docs ?? [];
  const allOn = all.length > 0 && all.every((d) => sel.has(d.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const add = () => onAdd(all.filter((d) => sel.has(d.id)).map((d) => ({ id: d.id, name: d.name, size: d.size, mime: d.mime })));
  const remove = async (d: Doc) => { const r = await fetch(`/api/docs/${d.id}`, { method: 'DELETE' }).catch(() => null); if (r?.ok) void load(); };

  const upload = async (list: FileList) => {
    if (!org) { toast(t('org.pickOrgFirst'), 'error'); return; }
    type Job = () => Promise<boolean>;
    const jobs: Job[] = [];
    const one = (form: FormData): Job => async () => { form.set('folder', org); const j = await upJson(await fetch('/api/files', { method: 'POST', body: form }).catch(() => null)); return !j.error && !(Number(j.status) >= 400); };
    const arch: File[] = [];
    for (const f of Array.from(list)) {
      if (archiveKind(f.name)) { arch.push(f); continue; }
      const form = new FormData(); form.set('file', f); const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath; if (rel) form.set('path', rel);
      jobs.push(one(form));
    }
    setUp({ k: 0, n: jobs.length + arch.length, bad: 0 });
    for (const a of arch) {
      const j = await upJson(await fetch('/api/files/archive', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(a.name) }, body: a }).catch(() => null));
      const entries = (j.entries as { n: number }[] | undefined) ?? [];
      if (j.error || !j.sid) { setUp((u) => u && { ...u, k: u.k + 1, bad: u.bad + 1 }); toast(errText(t.lang, String(j.error ?? '')), 'error'); continue; }
      setUp((u) => u && { ...u, k: u.k + 1, n: u.n + entries.length });
      for (const e of entries) { const form = new FormData(); form.set('staged', String(j.sid)); form.set('n', String(e.n)); jobs.push(one(form)); }
    }
    let i = 0;
    const worker = async () => { while (i < jobs.length) { const job = jobs[i++]; const ok = await job(); setUp((u) => u && { ...u, k: u.k + 1, bad: u.bad + (ok ? 0 : 1) }); } };
    await Promise.all([worker(), worker(), worker()]);
    void load();
  };

  const tl = (x: DocType | '') => t((x ? `org.t.${x}` : 'org.t.all') as Key);
  const when = (d: Doc) => (d.from && d.to ? `${ru(d.from)} – ${ru(d.to)}` : d.date ? ru(d.date) : t('org.noDate'));
  const title = org ? t('org.docsOf', { name: orgName ?? '' }) : t('org.docsAll');
  return (
    <Sheet open={open} onClose={onClose} title={title} anchor={anchor} testId="org-docs-panel" focusFirst="[data-testid=org-from]"
      foot={<div className="od-foot">
        <span className="od-up">
          <input ref={files} type="file" hidden multiple onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ''; }} data-testid="org-up-files" />
          <input ref={folder} type="file" hidden multiple {...({ webkitdirectory: '', directory: '' } as object)} onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ''; }} data-testid="org-up-folder" />
          <Button onClick={() => files.current?.click()} disabled={!org} icon="clip" testId="org-up">{t('org.uploadFiles')}</Button>
          <Button onClick={() => folder.current?.click()} disabled={!org} icon="folder" testId="org-up-dir">{t('org.uploadFolder')}</Button>
        </span>
        <Button kind="primary" onClick={add} disabled={!sel.size} testId="org-add">{t('org.add', { n: sel.size })}</Button>
      </div>}>
      <div className="od">
        <div className="od-period" role="group" aria-label={t('org.period')}>
          <label><span>{t('org.from')}</span><input type="date" value={from} onChange={(e) => setPeriod([e.target.value, to])} data-testid="org-from" /></label>
          <label><span>{t('org.to')}</span><input type="date" value={to} onChange={(e) => setPeriod([from, e.target.value])} data-testid="org-to" /></label>
          <span className="od-quick">
            <button type="button" onClick={() => setPeriod(quickPeriod('this'))}>{t('org.thisMonth')}</button>
            <button type="button" onClick={() => setPeriod(quickPeriod('last'))} data-testid="org-last-month">{t('org.lastMonth')}</button>
            <button type="button" onClick={() => setPeriod(quickPeriod('quarter'))}>{t('org.quarter')}</button>
            <button type="button" onClick={() => setPeriod(['', ''])} data-testid="org-any">{t('org.anyTime')}</button>
          </span>
        </div>
        <div className="od-types" role="radiogroup" aria-label={t('org.docs')}>
          {(['', ...DOC_TYPES] as (DocType | '')[]).filter((x) => !x || counts[x] || type === x).map((x) => (
            <button key={x || 'all'} type="button" role="radio" aria-checked={type === x} className={type === x ? 'is-on' : ''} onClick={() => setType(x)} data-testid={`org-type-${x || 'all'}`}>
              {tl(x)}<span className="tnum">{x ? counts[x] ?? 0 : total}</span>
            </button>
          ))}
        </div>
        <input className="od-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('org.search')} aria-label={t('org.search')} data-testid="org-q" />
        {err && <p className="od-err">{err}</p>}
        {up && <p className="od-prog" data-testid="org-progress">{up.k < up.n ? t('org.uploading', { k: up.k, n: up.n }) : t('org.uploaded', { n: up.n - up.bad })}{up.bad ? ` · ${t('org.uploadErr', { n: up.bad })}` : ''}</p>}
        {all.length > 0 && (
          <div className="od-sel">
            <button type="button" onClick={() => setSel(allOn ? new Set() : new Set(all.map((d) => d.id)))} data-testid="org-select-all">{allOn ? t('org.clear') : t('org.selectAll', { n: all.length })}</button>
          </div>
        )}
        <ul className="od-list" data-testid="org-docs-list">
          {docs && !all.length && <li className="od-empty">{total || from || to || type || q ? t('org.empty') : t('org.emptyAll')}</li>}
          {all.map((d) => (
            <li key={d.id} className={sel.has(d.id) ? 'is-sel' : ''}>
              <label>
                <input type="checkbox" checked={sel.has(d.id)} onChange={() => toggle(d.id)} data-testid="org-doc" />
                <span className="od-m"><b>{d.name.split('/').pop()}</b>
                  <small>{tl(d.type)} · {when(d)}{d.number ? ` · № ${d.number}` : ''}{d.sum != null ? ` · ${t('org.sum', { sum: d.sum.toLocaleString(t.lang === 'en' ? 'en-US' : 'ru-RU', { minimumFractionDigits: 2 }) })}` : ''} · {d.library ? t('org.library') : t('org.inChat')}</small>
                </span>
              </label>
              {d.library && <button type="button" className="icon-btn" aria-label={t('org.remove')} title={t('org.remove')} onClick={() => void remove(d)} data-testid="org-doc-remove"><Icon n="trash" sm /></button>}
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
