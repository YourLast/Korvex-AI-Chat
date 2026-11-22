'use client';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLive } from '@/lib/live';
import { localeOf, tr, type Lang } from '@/lib/i18n/core';
import { errText } from '@/lib/i18n/errors';
import { useT } from '@/lib/i18n/react';
import { Icon } from '../Icon';
import { Button, Field, toast, useConfirm } from '../Kit';
import { useIsMobile } from '../Popover';
import { GhMark } from './GhMark';
import { DiffView, StatBar, type DFile } from './DiffView';
import '@/styles/code.css';

export type CodeFile = { path: string; added: number; removed: number; status: string; binary: boolean };
export type CodeEditRow = { id: string; path: string; source: string; added: number; removed: number; revertedAt: number | null; createdAt: number; callId: string | null; messageId: string | null };
export type CodeRunRow = { id: string; cmd: string; exitCode: number | null; test: { ok: boolean; passed: number; failed: number; framework: string } | null; durationMs: number | null; createdAt: number; callId: string | null };
export type CodeState = {
  repo: string; repoUrl: string; baseBranch: string; workBranch: string | null; status: string; error: string | null; origin: string;
  prUrl: string | null; prNumber: number | null; tests: { cmd: string; ok: boolean; passed: number; failed: number; at: number } | null; unpushed: number; dirty: boolean;
  files: CodeFile[]; edits: CodeEditRow[]; runs: CodeRunRow[];
};

const jfetch = async <T,>(url: string, init?: RequestInit): Promise<{ ok: boolean; data: T & { error?: string } }> => {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } }).catch(() => null);
  if (!r) return { ok: false, data: { error: 'Нет связи с сервером' } as T & { error?: string } };
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  return { ok: r.ok, data };
};

export function useCode(threadId: string | null) {
  const [st, setSt] = useState<CodeState | null>(null);
  const [rev, setRev] = useState(0);
  const t = useRef<number | null>(null);
  const load = useCallback(async () => {
    if (!threadId) { setSt(null); return; }
    const r = await fetch(`/api/code/${threadId}`).catch(() => null);
    if (!r) return;
    if (r.status === 404) { setSt(null); return; }
    if (r.ok) { setSt((await r.json()) as CodeState); setRev((x) => x + 1); }
  }, [threadId]);
  useEffect(() => { void load(); }, [load]);
  useLive((e) => {
    if (e.t !== 'code' || e.th !== threadId) return;
    if (t.current) window.clearTimeout(t.current);
    t.current = window.setTimeout(() => void load(), 150);
  });
  return { st, reload: load, rev };
}

const ago = (t: number, lang: Lang) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? tr(lang, 'work.code.justNow') : s < 3600 ? tr(lang, 'work.code.minAgo', { n: Math.round(s / 60) }) : new Date(t).toLocaleString(localeOf(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

export function TestPill({ t, onClick }: { t: CodeState['tests']; onClick?: () => void }) {
  const tl = useT();
  if (!t) return null;
  return (
    <button type="button" className={`cb-pill ${t.ok ? 'cb-pill--ok' : 'cb-pill--bad'}`} onClick={onClick} title={t.cmd} data-testid="code-tests">
      <span className="cb-dot" />{t.ok ? tl('work.code.testsOk', { passed: t.passed }) : tl('work.code.testsBad', { failed: t.failed, total: t.passed + t.failed })}
    </button>
  );
}

export function CodeBar({ st, onOpen }: { st: CodeState; onOpen: (tab?: Tab) => void }) {
  const t = useT();
  const add = st.files.reduce((s, f) => s + f.added, 0), rem = st.files.reduce((s, f) => s + f.removed, 0);
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const f = () => setOver(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    f();
    el.addEventListener('scroll', f, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(f) : null;
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', f); ro?.disconnect(); };
  }, [st]);
  return (
    <div className={`cb${over ? ' is-over' : ''}`} ref={ref} data-testid="code-bar">
      <a className="cb-repo" href={st.repoUrl} target="_blank" rel="noreferrer" title={st.repo}><GhMark size={15} /><span>{st.repo}</span></a>
      <span className="cb-branch" title={t('work.code.branch')}><BranchIcon />{st.workBranch ?? st.baseBranch}</span>
      {st.status === 'cloning' && <span className="cb-pill"><span className="k-spin" aria-hidden="true" />{t('work.code.cloning')}</span>}
      {st.status === 'error' && <span className="cb-pill cb-pill--bad" title={st.error ? errText(t.lang, st.error) : ''}>{t('work.code.cloneFail')}</span>}
      {st.status === 'ready' && (
        <button type="button" className="cb-pill cb-changes" onClick={() => onOpen('changes')} data-testid="code-changes" disabled={!st.files.length && !st.edits.length}>
          {st.files.length ? <><Icon n="file-text" sm />{t('work.files', { n: st.files.length })} <span className="dv-plus">+{add}</span><span className="dv-minus">−{rem}</span><StatBar a={add} r={rem} /></> : t('work.code.noChanges')}
        </button>
      )}
      <TestPill t={st.tests} onClick={() => onOpen('tests')} />
      {st.prUrl && <a className="cb-pill cb-pill--pr" href={st.prUrl} target="_blank" rel="noreferrer" data-testid="code-pr-link"><PrIcon />PR #{st.prNumber}{st.unpushed ? ` · ${t('work.code.unpushedN', { n: st.unpushed })}` : ''}</a>}
      <button type="button" className="cb-open" onClick={() => onOpen()} aria-label={t('work.code.panel')} data-testid="code-open-panel"><Icon n="columns" sm /></button>
    </div>
  );
}

export const BranchIcon = () => <svg className="cb-ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" /></svg>;
export const PrIcon = () => <svg className="cb-ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" /></svg>;

export type Tab = 'changes' | 'history' | 'tests';

export function CodePanel({ threadId, st, open, tab: tab0, onClose, reload, rev }: { threadId: string; st: CodeState; open: boolean; tab?: Tab; onClose: () => void; reload: () => void; rev: number }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>(tab0 ?? 'changes');
  useEffect(() => { if (open && tab0) setTab(tab0); }, [open, tab0]);
  const [diff, setDiff] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [dlg, confirm] = useConfirm();
  const mobile = useIsMobile();
  useEffect(() => {
    if (!open || mobile) return;
    document.documentElement.classList.add('cp-open');
    return () => document.documentElement.classList.remove('cp-open');
  }, [open, mobile]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open, onClose, editing]);
  useEffect(() => {
    if (!open || st.status !== 'ready') return;
    let live = true;
    void jfetch<{ diff: string }>(`/api/code/${threadId}/diff`).then((r) => { if (live && r.ok) setDiff(r.data.diff); });
    return () => { live = false; };
  }, [open, threadId, rev, st.status]);

  const revertFile = async (p: string) => {
    if (!(await confirm({ title: t('work.code.revertTitle', { path: p }), message: t('work.code.revertMsg'), action: t('work.code.revert') }))) return;
    const r = await jfetch(`/api/code/${threadId}/revert`, { method: 'POST', body: JSON.stringify({ path: p }) });
    if (!r.ok) toast(r.data.error ? errText(t.lang, r.data.error) : t('common.retryLater'), 'error'); else { toast(t('work.code.reverted', { path: p })); reload(); }
  };
  const head = (f: DFile) => (
    <>
      {f.status !== 'D' && !f.binary && <button type="button" className="dv-act" onClick={() => setEditing(f.path)} data-testid={`code-edit-${f.path}`}><Icon n="edit" sm /><span>{t('work.code.edit')}</span></button>}
      <button type="button" className="dv-act" onClick={() => void revertFile(f.path)} data-testid={`code-revert-${f.path}`}><Icon n="retry" sm /><span>{t('work.code.revert')}</span></button>
    </>
  );

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className={mobile ? 'cp-scrim' : 'cp-dock'} onMouseDown={(e) => { if (mobile && e.target === e.currentTarget) onClose(); }}>
      <aside className={`cp${mobile ? '' : ' cp--side'}`} role={mobile ? 'dialog' : 'complementary'} aria-modal={mobile || undefined} aria-label={t('work.code.tabChanges')} data-testid="code-panel">
        <header className="cp-h">
          <div className="cp-h-t">
            <b><GhMark size={16} /> {st.repo}</b>
            <small><BranchIcon />{st.baseBranch} ← {st.workBranch ?? t('work.code.newBranch')}</small>
          </div>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose} data-testid="code-panel-close"><Icon n="x" /></button>
        </header>
        <div className="cp-tabs" role="tablist">
          {([['changes', `${t('work.code.tabChanges')}${st.files.length ? ` · ${st.files.length}` : ''}`], ['history', `${t('work.code.tabEdits')}${st.edits.length ? ` · ${st.edits.length}` : ''}`], ['tests', `${t('work.code.tabRuns')}${st.runs.length ? ` · ${st.runs.length}` : ''}`]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`code-tab-${k}`}>{l}</button>
          ))}
        </div>
        <div className="cp-b">
          {tab === 'changes' && (diff === null ? <div className="dv-empty">{t('work.loadingDots')}</div> : <DiffView diff={diff} head={head} empty={t('work.code.noDiff')} testId="code-diff" />)}
          {tab === 'history' && <History threadId={threadId} st={st} reload={reload} />}
          {tab === 'tests' && <Runs threadId={threadId} st={st} />}
        </div>
        <Ship threadId={threadId} st={st} reload={reload} />
      </aside>
      {editing && <FileEditor threadId={threadId} path={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {dlg}
    </div>,
    document.body,
  );
}

function History({ threadId, st, reload }: { threadId: string; st: CodeState; reload: () => void }) {
  const t = useT();
  const SRC: Record<string, string> = { agent: t('work.code.srcAgent'), user: t('work.code.srcUser'), revert: t('work.code.srcRevert') };
  const [open, setOpen] = useState<Record<string, string>>({});
  const show = async (id: string) => {
    if (open[id] !== undefined) { setOpen((o) => { const n = { ...o }; delete n[id]; return n; }); return; }
    const r = await jfetch<{ diff: string }>(`/api/code/${threadId}/edits/${id}`);
    if (r.ok) setOpen((o) => ({ ...o, [id]: r.data.diff }));
  };
  const revert = async (id: string) => {
    const r = await jfetch(`/api/code/${threadId}/edits/${id}`, { method: 'POST', body: JSON.stringify({ action: 'revert' }) });
    if (!r.ok) toast(r.data.error ? errText(t.lang, r.data.error) : t('common.retryLater'), 'error'); else { toast(t('work.code.editReverted')); reload(); }
  };
  if (!st.edits.length) return <div className="dv-empty">{t('work.code.noEdits')}</div>;
  return (
    <ul className="cp-list" data-testid="code-history">
      {st.edits.map((e) => (
        <li key={e.id} className={e.revertedAt ? 'is-reverted' : ''} data-testid="code-edit-row">
          <div className="cp-row">
            <button type="button" className="cp-row-m" onClick={() => void show(e.id)} aria-expanded={open[e.id] !== undefined}>
              <span className="cp-row-t">{e.path}</span>
              <span className="cp-row-s">{SRC[e.source] ?? e.source} · {ago(e.createdAt, t.lang)}{e.revertedAt ? ` · ${t('work.code.wasReverted')}` : ''}</span>
            </button>
            <span className="dv-stat"><span className="dv-plus">+{e.added}</span> <span className="dv-minus">−{e.removed}</span></span>
            {!e.revertedAt && e.source !== 'revert' && <button type="button" className="dv-act" onClick={() => void revert(e.id)} data-testid="code-edit-revert"><Icon n="retry" sm /><span>{t('work.code.revert')}</span></button>}
          </div>
          {open[e.id] !== undefined && <DiffView diff={open[e.id]} />}
        </li>
      ))}
    </ul>
  );
}

function Runs({ threadId, st }: { threadId: string; st: CodeState }) {
  const t = useT();
  const [out, setOut] = useState<Record<string, string>>({});
  const show = async (id: string) => {
    if (out[id] !== undefined) { setOut((o) => { const n = { ...o }; delete n[id]; return n; }); return; }
    const r = await jfetch<{ output: string }>(`/api/code/${threadId}/runs/${id}`);
    if (r.ok) setOut((o) => ({ ...o, [id]: r.data.output }));
  };
  if (!st.runs.length) return <div className="dv-empty">{t('work.code.noRuns')}</div>;
  return (
    <ul className="cp-list" data-testid="code-runs">
      {st.runs.map((r) => (
        <li key={r.id}>
          <div className="cp-row">
            <button type="button" className="cp-row-m" onClick={() => void show(r.id)} aria-expanded={out[r.id] !== undefined}>
              <span className="cp-row-t cp-mono">$ {r.cmd.split('\n')[0]}</span>
              <span className="cp-row-s">{t('work.code.runMeta', { ago: ago(r.createdAt, t.lang), sec: ((r.durationMs ?? 0) / 1000).toFixed(1), code: String(r.exitCode) })}</span>
            </button>
            {r.test ? <span className={`cb-pill ${r.test.ok ? 'cb-pill--ok' : 'cb-pill--bad'}`}><span className="cb-dot" />{r.test.ok ? t('work.code.passedN', { n: r.test.passed }) : t('work.code.failedN', { n: r.test.failed })}</span>
              : <span className={`cb-pill ${r.exitCode === 0 ? 'cb-pill--ok' : 'cb-pill--bad'}`}><span className="cb-dot" />{r.exitCode === 0 ? t('work.st.done') : t('work.st.err')}</span>}
          </div>
          {out[r.id] !== undefined && <pre className="cp-out">{out[r.id] || t('work.out.noOutput')}</pre>}
        </li>
      ))}
    </ul>
  );
}

function Ship({ threadId, st, reload }: { threadId: string; st: CodeState; reload: () => void }) {
  const t = useT();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState<'c' | 'p' | null>(null);
  const [pr, setPr] = useState<{ title: string; body: string } | null>(null);
  if (st.status !== 'ready') return null;
  const commit = async () => {
    setBusy('c');
    const r = await jfetch<{ sha: string; branch: string }>(`/api/code/${threadId}/commit`, { method: 'POST', body: JSON.stringify({ message: msg.trim() }) });
    setBusy(null);
    if (!r.ok) { toast(r.data.error ? errText(t.lang, r.data.error) : t('work.code.commitFail'), 'error'); return; }
    setMsg(''); toast(t('work.code.committed', { sha: r.data.sha.slice(0, 7), branch: r.data.branch })); reload();
  };
  const send = async () => {
    if (!pr) return;
    setBusy('p');
    const r = await jfetch<{ url: string; number: number; created: boolean }>(`/api/code/${threadId}/pr`, { method: 'POST', body: JSON.stringify({ title: pr.title.trim(), body: pr.body }) });
    setBusy(null);
    if (!r.ok) { toast(r.data.error ? errText(t.lang, r.data.error) : t('work.code.pushFail'), 'error'); return; }
    setPr(null); toast(t(r.data.created ? 'work.code.prOpened' : 'work.code.prUpdated', { num: String(r.data.number) })); reload();
  };
  const can = st.files.length > 0;
  return (
    <footer className="cp-f">
      {st.dirty && (
        <div className="cp-commit">
          <input className="cp-in" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t('work.code.commitMsg')} maxLength={300} data-testid="code-commit-msg" onKeyDown={(e) => { if (e.key === 'Enter' && msg.trim()) void commit(); }} />
          <Button onClick={commit} busy={busy === 'c'} disabled={!msg.trim()} testId="code-commit">{t('work.code.commit')}</Button>
        </div>
      )}
      <div className="cp-ship">
        <span className="cp-ship-s">{st.prUrl ? <a href={st.prUrl} target="_blank" rel="noreferrer" className="k-link"><PrIcon /> PR #{st.prNumber}</a> : st.workBranch ? t('work.code.branchIs', { name: st.workBranch }) : t('work.code.commitsGo')}{st.unpushed ? ` · ${t('work.code.unpushedLbl', { n: st.unpushed })}` : ''}</span>
        <Button kind="primary" onClick={() => setPr({ title: st.edits.length ? `Korvex: ${st.files.map((f) => f.path.split('/').pop()).slice(0, 3).join(', ')}` : '', body: '' })} disabled={!can || (!!st.prUrl && !st.unpushed && !st.dirty)} testId="code-ship">
          <GhMark size={14} /> {st.prUrl ? t('work.code.updatePr') : t('work.code.toGithub')}
        </Button>
      </div>
      {pr && (
        <div className="cp-pr" data-testid="code-pr-form">
          <p className="cp-pr-note">{t('work.code.prNote1')}<b>{st.repo}</b>{t('work.code.prNote2')}<b>{st.baseBranch}</b>{t('work.code.prNote3')}</p>
          <Field label={t('work.code.prTitle')} value={pr.title} onChange={(v) => setPr({ ...pr, title: v })} maxLength={250} testId="code-pr-title" />
          <Field label={t('work.code.prBody')} value={pr.body} onChange={(v) => setPr({ ...pr, body: v })} multiline rows={3} testId="code-pr-body" />
          <div className="k-acts k-acts--end"><Button kind="plain" onClick={() => setPr(null)}>{t('common.cancel')}</Button><Button kind="primary" onClick={send} busy={busy === 'p'} disabled={!pr.title.trim()} testId="code-pr-send">{t('work.code.toGithub')}</Button></div>
        </div>
      )}
    </footer>
  );
}

function FileEditor({ threadId, path, onClose, onSaved }: { threadId: string; path: string; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [orig, setOrig] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void jfetch<{ content: string | null }>(`/api/code/${threadId}/file?path=${encodeURIComponent(path)}`).then((r) => {
      if (r.ok) { setOrig(r.data.content ?? ''); setText(r.data.content ?? ''); } else toast(r.data.error ? errText(t.lang, r.data.error) : t('work.code.openFail'), 'error');
    });
  }, [threadId, path]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = orig !== null && text !== orig;
  const lines = useMemo(() => text.split('\n').length, [text]);
  const save = async () => {
    setBusy(true);
    const r = await jfetch(`/api/code/${threadId}/file`, { method: 'PUT', body: JSON.stringify({ path, content: text, expect: orig }) });
    setBusy(false);
    if (!r.ok) { toast(r.data.error ? errText(t.lang, r.data.error) : t('work.saveFail'), 'error'); return; }
    toast(t('work.code.saved', { path })); onSaved();
  };
  return (
    <div className="fe-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fe" role="dialog" aria-modal="true" aria-label={t('work.code.editAria', { path })} data-testid="code-editor">
        <header className="cp-h"><div className="cp-h-t"><b>{path}</b><small>{t('work.code.fileMeta', { n: lines })}</small></div>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}><Icon n="x" /></button></header>
        {orig === null ? <div className="dv-empty">{t('work.loadingDots')}</div> : (
          <textarea className="fe-text" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} data-testid="code-editor-text"
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (changed) void save(); } if (e.key === 'Tab') { e.preventDefault(); const t = e.currentTarget; const s = t.selectionStart; setText(text.slice(0, s) + '    ' + text.slice(t.selectionEnd)); requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 4; }); } }} />
        )}
        <footer className="cp-f"><div className="cp-ship"><span className="cp-ship-s">{t(changed ? 'work.code.unsaved' : 'work.code.noChanges')} · Ctrl/⌘ S</span>
          <div className="k-acts"><Button kind="plain" onClick={onClose}>{t('common.cancel')}</Button><Button kind="primary" onClick={save} busy={busy} disabled={!changed} testId="code-editor-save">{t('common.save')}</Button></div></div></footer>
      </div>
    </div>
  );
}

type Repo = { fullName: string; private: boolean; defaultBranch: string; description: string | null; push: boolean; updatedAt: string | null };
export type CodePick = { repo: string; branch: string };
type GhState = { connected: boolean; login?: string };

type GhCache = { gh: GhState | null; repos: Repo[] | null; err: string | null; at: number; inflight: Promise<void> | null };
const ghc: GhCache = { gh: null, repos: null, err: null, at: 0, inflight: null };
const ghSubs = new Set<() => void>();
const ghEmit = () => ghSubs.forEach((f) => f());
export function prefetchGithub(force = false): Promise<void> {
  if (ghc.inflight) return ghc.inflight;
  if (!force && ghc.at && Date.now() - ghc.at < 60_000) return Promise.resolve();
  ghc.inflight = (async () => {
    const st = await jfetch<GhState>('/api/github');
    ghc.gh = st.ok ? { connected: !!st.data.connected, login: st.data.login } : (ghc.gh ?? { connected: false });
    if (ghc.gh.connected) {
      const r = await jfetch<{ repos: Repo[] }>('/api/github/repos');
      if (r.ok) { ghc.repos = r.data.repos; ghc.err = null; } else ghc.err = r.data.error ?? 'Список репозиториев не загрузился';
    } else ghc.repos = null;
    ghc.at = Date.now();
  })().finally(() => { ghc.inflight = null; ghEmit(); });
  return ghc.inflight;
}
function useGhCache(): GhCache {
  const [, setN] = useState(0);
  useEffect(() => { const f = () => setN((n) => n + 1); ghSubs.add(f); return () => { ghSubs.delete(f); }; }, []);
  return ghc;
}

const SKELETON_ROWS = 6;

export function CodeStart({ value, onChange, active }: { value: CodePick | null; onChange: (v: CodePick | null) => void; active: boolean }) {
  const t = useT();
  const c = useGhCache();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ q: string; repos: Repo[] } | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const search = useRef<HTMLInputElement>(null);
  const mobile = useIsMobile();
  useEffect(() => { void prefetchGithub(); }, []);
  useEffect(() => {
    if (!active || mobile || value) return;
    const t = window.setTimeout(() => search.current?.focus({ preventScroll: true }), 200);
    return () => window.clearTimeout(t);
  }, [active, mobile, value]);
  useEffect(() => {
    const qq = q.trim();
    if (!qq || !c.gh?.connected) { setFound(null); return; }
    let live = true;
    const t = window.setTimeout(() => void jfetch<{ repos: Repo[] }>(`/api/github/repos?q=${encodeURIComponent(qq)}`).then((r) => { if (live && r.ok) setFound({ q: qq, repos: r.data.repos }); }), 200);
    return () => { live = false; window.clearTimeout(t); };
  }, [q, c.gh?.connected]);
  useEffect(() => {
    if (!value?.repo) { setBranches([]); return; }
    void jfetch<{ branches: { name: string }[] }>(`/api/github/branches?repo=${encodeURIComponent(value.repo)}`).then((r) => { if (r.ok) setBranches(r.data.branches.map((b) => b.name)); });
  }, [value?.repo]);
  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const base = c.repos ?? [];
    if (!qq) return base;
    const local = base.filter((r) => r.fullName.toLowerCase().includes(qq));
    const more = found && found.q.toLowerCase() === qq ? found.repos.filter((r) => !local.some((x) => x.fullName === r.fullName)) : [];
    return [...local, ...more];
  }, [q, c.repos, found]);

  if (c.gh && !c.gh.connected) return (
    <div className="cs" data-testid="code-start">
      <div className="cs-empty"><GhMark size={28} /><p>{t('work.code.startLead')}</p>
        <Button kind="primary" href="/settings#github" testId="code-connect">{t('work.gh.connectTitle')}</Button></div>
    </div>
  );
  const loading = !c.gh || (c.gh.connected && !c.repos && !c.err);
  return (
    <div className="cs" data-testid="code-start" aria-busy={loading || undefined}>
      {value ? (
        <div className="cs-sel" data-testid="code-picked">
          <GhMark size={18} />
          <span className="cs-sel-m"><b>{value.repo}</b>
            <label className="cs-branch"><BranchIcon />
              <select value={value.branch} onChange={(e) => onChange({ ...value, branch: e.target.value })} data-testid="code-branch">
                {[value.branch, ...branches.filter((b) => b !== value.branch)].map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
          </span>
          <button type="button" className="k-link" onClick={() => onChange(null)} data-testid="code-repick">{t('work.code.another')}</button>
        </div>
      ) : (
        <>
          <label className="cs-search"><Icon n="search" sm /><input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={c.gh?.login ? t('work.code.repoOf', { login: c.gh.login }) : t('work.code.repo')} data-testid="code-repo-q" /></label>
          {c.err && <div className="dv-empty">{errText(t.lang, c.err)}</div>}
          {}
          <ul className="cs-list" data-testid="code-repos">
            {loading
              ? Array.from({ length: SKELETON_ROWS }, (_, i) => <li key={i} className="cs-skel" aria-hidden="true"><span /><span /></li>)
              : list.slice(0, SKELETON_ROWS).map((r) => (
                <li key={r.fullName}><button type="button" onClick={() => onChange({ repo: r.fullName, branch: r.defaultBranch })} data-testid={`code-repo-${r.fullName}`}>
                  <span className="cs-r-t">{r.fullName}{r.private && <Icon n="lock" sm />}</span>
                  <span className="cs-r-s">{r.description ?? t(r.push ? 'work.code.canWrite' : 'work.gh.readOnlyFull')}</span>
                </button></li>
              ))}
            {!loading && !list.length && <li className="dv-empty cs-none">{q ? t('work.code.noneFor', { q }) : t('work.code.noneGrant')}</li>}
          </ul>
        </>
      )}
    </div>
  );
}

export function ModeSwitch({ code, onChange }: { code: boolean; onChange: (code: boolean) => void }) {
  const t = useT();
  const opts = [{ v: false, label: t('work.code.modeChat'), id: 'mode-chat' }, { v: true, label: t('work.code.modeCode'), id: 'mode-code' }];
  const [on, setOn] = useState(code);
  useEffect(() => setOn(code), [code]);
  const pick = (v: boolean) => { if (on === v) return; setOn(v); startTransition(() => onChange(v)); };
  return (
    <div className="hm-tabs" role="radiogroup" aria-label={t('work.code.modeAria')} data-testid="home-mode">
      {opts.map((o) => <button key={o.id} type="button" role="radio" aria-checked={on === o.v} data-testid={o.id} onClick={() => pick(o.v)}>{o.label}</button>)}
    </div>
  );
}
