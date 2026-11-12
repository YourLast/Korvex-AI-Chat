'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, DestructiveButton, Group, Sheet, toast } from './Kit';
import { Icon } from './Icon';
import { useLive } from '@/lib/live';
import { localeOf, type Lang } from '@/lib/i18n/core';
import { errText } from '@/lib/i18n/errors';
import { useT } from '@/lib/i18n/react';
import { prefetchGithub } from './code/Code';
import { GhMark } from './code/GhMark';
import '@/styles/code.css';

type St = {
  connected: boolean; kind?: string; login?: string; name?: string | null; avatarUrl?: string | null; htmlUrl?: string; expiresAt?: number | null;
  coAuthors?: string[]; coauthorSelf?: string; oauth: boolean; tokenUrl: string; web: string; sandbox: boolean; net: string;
};
type RepoRow = { fullName: string; private: boolean; push: boolean };

export { GhMark };

const fmtDate = (t: number, lang: Lang) => new Date(t).toLocaleDateString(localeOf(lang), { day: 'numeric', month: 'long' });

export function GithubSettings() {
  const t = useT();
  const [st, setSt] = useState<St | null>(null);
  const [repos, setRepos] = useState<{ list: RepoRow[]; total: number } | null>(null);
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLButtonElement>(null);
  const load = useCallback(async () => {
    const r = await fetch('/api/github').catch(() => null);
    if (!r?.ok) return;
    const j = (await r.json()) as St;
    setSt(j);
    if (j.connected) {
      const rr = await fetch('/api/github/repos').catch(() => null);
      if (rr?.ok) { const x = (await rr.json()) as { repos: RepoRow[]; total: number }; setRepos({ list: x.repos, total: x.total }); }
    } else setRepos(null);
  }, []);
  useEffect(() => {
    void load();
    const q = new URLSearchParams(window.location.search).get('github');
    if (q === 'ok') toast(t('work.gh.connectedToast'));
    else if (q) toast(t(q === 'denied' ? 'work.gh.denied' : 'work.gh.loginFail'), 'error');
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (st && !st.connected && window.location.hash === '#github') setOpen(true); }, [st]);
  useLive((e) => { if (e.t === 'github') void load(); });

  const sub = !st ? ' ' : !st.connected ? t('work.gh.notConnected')
    : [`@${st.login}`, repos ? t('work.gh.repoCount', { n: repos.total }) : null, st.expiresAt ? t('work.gh.until', { date: fmtDate(st.expiresAt, t.lang) }) : null].filter(Boolean).join(' · ');

  return (
    <Group id="github" testId="gh-settings" foot={t('work.gh.foot')}>
      <button type="button" className="k-row gh-row" ref={row} onClick={() => setOpen(true)} disabled={!st} data-testid="gh-row">
        <span className="k-row-i gh-row-i">{st?.connected && st.avatarUrl ? <img src={st.avatarUrl} alt="" className="gh-ava gh-ava--row" /> : <GhMark size={20} />}</span>
        <span className="k-row-m">
          <span className="k-row-t">GitHub</span>
          <span className="k-row-s" data-testid="gh-row-sub">{sub}</span>
        </span>
        {st && !st.connected && <span className="k-row-v">{t('work.gh.connect')}</span>}
        <Icon n="chev-right" sm className="k-chev" />
      </button>
      {st && (st.connected
        ? <Connected st={st} repos={repos} open={open} anchor={row.current} onClose={() => setOpen(false)} onChanged={load} />
        : <Connect st={st} open={open} anchor={row.current} onClose={() => setOpen(false)} onConnected={() => { setOpen(false); void load(); void prefetchGithub(true); }} />)}
    </Group>
  );
}

function Connect({ st, open, anchor, onClose, onConnected }: { st: St; open: boolean; anchor: HTMLElement | null; onClose: () => void; onConnected: () => void }) {
  const t = useT();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!open) { setToken(''); setErr(null); } }, [open]);
  const paste = async () => {
    try {
      const txt = (await navigator.clipboard.readText()).trim();
      if (!txt) { toast(t('work.gh.clipEmpty'), 'error'); return; }
      setToken(txt); setErr(null);
    } catch { toast(t('work.gh.clipDenied'), 'error'); }
  };
  const connect = async () => {
    if (!token.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/github', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token.trim() }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; repos?: number; login?: string };
      if (!r.ok) { setErr(/не принял/.test(j.error ?? '') ? t('work.gh.badToken') : j.error ? errText(t.lang, j.error) : t('work.gh.connectFail')); return; }
      toast(t('work.gh.connectedToast'));
      setToken('');
      onConnected();
    } catch { setErr(t('e.work.noConn')); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('work.gh.connectTitle')} anchor={anchor} testId="gh-sheet" focusFirst="[data-testid=gh-token]">
      {st.oauth ? (
        <div className="gh-sheet">
          <a className="k-btn k-btn--primary k-btn--lg k-btn--block" href="/api/github/oauth/start" data-testid="gh-oauth"><GhMark size={18} /><span>{t('work.gh.oauth')}</span></a>
        </div>
      ) : (
        <ol className="gh-steps" data-testid="gh-steps">
          <li>
            <span className="gh-n" aria-hidden="true">1</span>
            <div className="gh-step">
              <b>{t('work.gh.step1')}</b>
              <span>{t('work.gh.step1Sub')}</span>
              <a className="k-btn k-btn--secondary gh-open" href={st.tokenUrl} target="_blank" rel="noreferrer" data-testid="gh-token-link"><GhMark size={16} /><span>{t('work.gh.openGh')}</span></a>
            </div>
          </li>
          <li>
            <span className="gh-n" aria-hidden="true">2</span>
            <div className="gh-step">
              <b>{t('work.gh.step2')}</b>
              <label className="gh-token" data-invalid={err ? true : undefined}>
                <input type="password" value={token} onChange={(e) => { setToken(e.target.value); setErr(null); }} placeholder="github_pat_…" autoComplete="off" spellCheck={false}
                  onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }} data-testid="gh-token" aria-label={t('work.gh.tokenAria')} aria-invalid={!!err} aria-describedby={err ? 'gh-err' : undefined} />
                <button type="button" className="gh-paste" onClick={paste} data-testid="gh-paste">{t('work.gh.paste')}</button>
              </label>
              {err && <span className="gh-err" id="gh-err" role="alert" data-testid="gh-err">{err}</span>}
            </div>
          </li>
          <li className="gh-step3">
            <span className="gh-n" aria-hidden="true">3</span>
            <div className="gh-step">
              <Button kind="primary" size="lg" block onClick={connect} busy={busy} disabled={!token.trim()} testId="gh-connect">{t('work.gh.connect')}</Button>
            </div>
          </li>
        </ol>
      )}
    </Sheet>
  );
}

function Connected({ st, repos, open, anchor, onClose, onChanged }: { st: St; repos: { list: RepoRow[]; total: number } | null; open: boolean; anchor: HTMLElement | null; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const init = (st.coAuthors ?? []).join('\n');
  const [co, setCo] = useState(init);
  const [saved, setSaved] = useState(init);
  useEffect(() => { setCo(init); setSaved(init); }, [init]);
  const saveCo = async () => {
    const r = await fetch('/api/github', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coAuthors: co.split('\n').map((s) => s.trim()).filter(Boolean) }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string; coAuthors?: string[] };
    if (!r.ok) { toast(j.error ? errText(t.lang, j.error) : t('work.saveFail'), 'error'); return; }
    const c = (j.coAuthors ?? []).join('\n'); setCo(c); setSaved(c); toast(t('work.gh.coSaved'));
  };
  const disconnect = async () => {
    const r = await fetch('/api/github', { method: 'DELETE' });
    if (!r.ok) { toast(t('work.gh.disconnectFail'), 'error'); return; }
    toast(t('work.gh.disconnected'));
    onClose(); onChanged(); void prefetchGithub(true);
  };
  return (
    <Sheet open={open} onClose={onClose} title="GitHub" anchor={anchor} testId="gh-sheet" focusFirst="[data-gh-nofocus]">
      <div className="gh-sheet">
        <a className="gh-acc" href={st.htmlUrl} target="_blank" rel="noreferrer" data-testid="gh-account">
          {st.avatarUrl ? <img src={st.avatarUrl} alt="" className="gh-ava" /> : <span className="gh-ava gh-ava--empty"><GhMark size={20} /></span>}
          <span className="gh-acc-m"><b>@{st.login}</b><small className="gh-ok">{t(st.kind === 'oauth' ? 'work.gh.viaOauth' : 'work.gh.viaToken')}{st.expiresAt ? ` · ${t('work.gh.until', { date: fmtDate(st.expiresAt, t.lang) })}` : ''}</small></span>
        </a>
        <section className="gh-sec">
          <h3>{t('work.gh.repos')}{repos ? ` · ${repos.total}` : ''}</h3>
          <ul className="gh-repos" data-testid="gh-found">
            {repos === null && <li className="gh-muted">{t('work.loadingDots')}</li>}
            {repos?.list.slice(0, 30).map((r) => (
              <li key={r.fullName}><span className="gh-repo-n">{r.fullName}</span>{r.private && <Icon n="lock" sm />}{!r.push && <span className="gh-muted">{t('work.gh.readOnly')}</span>}</li>
            ))}
            {repos && !repos.list.length && <li className="gh-muted">{t('work.gh.noRepos')}</li>}
            {repos && repos.total > 30 && <li className="gh-muted">{t('work.gh.andMore', { n: repos.total - 30 })}</li>}
          </ul>
        </section>
        <section className="gh-sec">
          <h3>{t('work.gh.co')}</h3>
          <p className="gh-muted">{t('work.gh.coLead')}{st.coauthorSelf ? <> (<span className="gh-nw">{st.coauthorSelf.replace(/ <.*$/, '')}</span>)</> : ''}{t('work.gh.coTail')}</p>
          <textarea className="gh-co" value={co} onChange={(e) => setCo(e.target.value)} rows={2} placeholder={t('work.gh.coPh')} spellCheck={false} aria-label={t('work.gh.co')} data-testid="gh-coauthors" />
          {co !== saved && <div className="k-acts k-acts--end gh-co-acts"><Button kind="plain" onClick={() => setCo(saved)}>{t('work.deny')}</Button><Button kind="primary" onClick={saveCo} testId="gh-co-save">{t('common.save')}</Button></div>}
        </section>
        <div className="k-list gh-danger">
          <DestructiveButton asRow confirm={{ title: t('work.gh.discTitle'), message: t('work.gh.discMsg'), action: t('work.gh.discAction') }} onConfirm={disconnect} testId="gh-disconnect">{t('work.gh.discBtn')}</DestructiveButton>
        </div>
      </div>
    </Sheet>
  );
}
