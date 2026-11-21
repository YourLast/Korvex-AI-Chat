'use client';
import { adm as admText } from '@/lib/i18n/adm';
import { OrgModeCtx } from './orgMode';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PublicModel } from '@/lib/models';
import type { FolderView, ThreadLite } from '@/lib/types';
import { dayGroup } from '@/lib/format';
import { tr } from '@/lib/i18n/core';
import { docLang, useT } from '@/lib/i18n/react';
import { setRetired, type RetiredModel } from '@/lib/retired';
import type { LockedModel } from '@/lib/locked';
import { trackViewport } from '@/lib/viewport';
import { attachDrawerSwipe } from '@/lib/swipe';
import { dropEntry, prefetchIdle, prefetchThread, staleEntry } from '@/lib/tcache';
import { live, useLive } from '@/lib/live';
import { Icon } from './Icon';
import { Confirm } from './Kit';
import { GhMark } from './code/GhMark';
import { canAgents } from '@/lib/roles';
import { POWERED_BY } from '@/ext/client';
import { OrgSwitch, useOrg } from './OrgDocs';
import { MainCtx, useIsMobile } from './Popover';
import { initSidebar, toggleSidebar, useSidebarCollapsed } from '@/lib/sidebar';
import { attachSheetDrag } from '@/lib/sheetDrag';
import { ThreadPreview } from './ThreadPreview';
import { Toasts, toastBody, toastParts, type Toast } from './Toasts';
import { NotifyPrompt } from './NotifyPrompt';
import { SeatNotices } from './SeatNotices';
import { LangSuggest } from './LangSuggest';
import { InstallPrompt, useCanInstall } from './InstallPrompt';
import { deviceId } from '@/lib/live';
import { disablePush, hasLocalSub } from '@/lib/pushClient';
import type { StatusView } from '@/lib/announce';
import { Announce, StatusCtx, useStatusPoll } from './Announce';
import { FadeText, SearchPalette, SidebarSearch, dropSearchCache, type Hit } from './ChatSearch';
import { jumpTo, setPendingFind, takePendingFind } from '@/lib/findMark';
import { FolderSection, MoveButton, ProjectDialog, dragThread } from './Folders';
import { ChatSheet, type ChatRef, type ChatView } from './ChatSheet';
import { haptic } from '@/lib/haptic';
import { FeaturesProvider, type Features } from './FeaturesCtx';
import { BlocksCfgProvider, type BlocksCfg } from './blocks/BlocksCfg';
import { useBrand } from './BrandCtx';
import { prepareModel as warmServe, prepareOnReturn as warmOnReturn } from '@/ext/client';

const FIRST_ROWS = 40;

type Ctx = { models: PublicModel[]; refresh: () => Promise<void>; openDrawer: () => void; threads: ThreadLite[]; role: string; chatMenu?: (c: ChatRef, view?: ChatView) => void; locked?: LockedModel[];
  org?: string | null; folders?: FolderView[]; orgMode?: boolean };
export const ShellCtx = createContext<Ctx | null>(null);
export const useShell = () => useContext(ShellCtx)!;
export const useIsAdmin = () => useContext(ShellCtx)?.role === 'admin';
export const useCanAgents = () => canAgents(useContext(ShellCtx)?.role);
export const useLockedModels = (): LockedModel[] => useContext(ShellCtx)?.locked ?? [];

async function takePending(): Promise<string | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const c = await caches.open('kx-pending');
    const r = await c.match('/__kx_pending');
    if (!r) return null;
    await c.delete('/__kx_pending');
    const j = (await r.json()) as { url?: string; t?: number };
    return j.url && j.url.startsWith('/') && Date.now() - (j.t ?? 0) < 120_000 ? j.url : null;
  } catch { return null; }
}

export function Shell({ user, models, retired, locked, initialThreads, initialFolders = [], initialStatus = null, apiOn = true, features = null, blocks = null, children }: { user: { name: string; email?: string; role?: string; orgs?: boolean }; models: PublicModel[]; retired?: RetiredModel[]; locked?: LockedModel[]; initialThreads: ThreadLite[]; initialFolders?: FolderView[]; initialStatus?: StatusView | null; apiOn?: boolean; features?: Features | null; blocks?: BlocksCfg | null; children: ReactNode }) {
  const brandName = useBrand().name;
  setRetired(retired);
  const tx = useT();
  const [threads, setThreads] = useState(initialThreads);
  const [folders, setFolders] = useState<FolderView[]>(initialFolders);
  const orgMode = !!user.orgs;
  const [orgPick, setOrg] = useOrg(folders, true);
  const org = orgMode ? orgPick : null;
  const [newOrg, setNewOrg] = useState(false);
  const status = useStatusPoll(initialStatus);
  const [palette, setPalette] = useState(false);
  const [pq, setPq] = useState('');
  const [chatSheet, setChatSheet] = useState<{ c: ChatRef; view: ChatView } | null>(null);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const chatMenu = useCallback((c: ChatRef, view: ChatView = 'menu') => {
    const f = threadsRef.current.find((t) => t.id === c.id || (!!c.groupId && t.groupId === c.groupId));
    setChatSheet({ c: f ? { id: f.id, groupId: f.groupId, title: f.title, muted: f.muted, folderId: f.folderId, temporary: c.temporary } : c, view });
  }, []);
  const [main, setMain] = useState<HTMLElement | null>(null);
  const sbCollapsed = useSidebarCollapsed();
  const mobileView = useIsMobile();
  useEffect(() => initSidebar(), []);
  const path = usePathname();
  const router = useRouter();

  const refresh = useCallback(async () => {
    const r = await fetch('/api/threads', { cache: 'no-cache' });
    if (r.ok) setThreads(((await r.json()) as { threads: ThreadLite[] }).threads);
  }, []);
  const refreshFolders = useCallback(async () => {
    const [f] = await Promise.all([fetch('/api/folders', { cache: 'no-cache' }).catch(() => null), refresh()]);
    if (f?.ok) setFolders(((await f.json()) as { folders: FolderView[] }).folders);
  }, [refresh]);
  useEffect(() => { live?.start(); }, []);
  useEffect(() => { const f = () => { if (document.visibilityState === 'visible') setBadge(0); }; f(); document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f); }, []);
  const refreshSoon = useRef(0);
  const pathRef = useRef(path);
  pathRef.current = path;
  useLive((e) => {
    if (e.t === 'cmp') setThreads((ts) => ts.map((t) => (t.id === e.th ? { ...t, cmp: !!e.on } : t)));
    if (e.t === 'folders' || e.t === 'sync') void refreshFolders();
    if (e.t === 'thread' || e.t === 'thread-del' || e.t === 'sync' || (e.t === 'job' && ['done', 'error', 'cancelled'].includes(String(e.status)))) {
      window.clearTimeout(refreshSoon.current);
      refreshSoon.current = window.setTimeout(() => { void refresh(); }, 150);
    }
    if (e.t === 'msg' || e.t === 'job') { if (e.th) staleEntry(`/c/${e.th}`); if (e.gid) staleEntry(`/g/${e.gid}`); }
    if (e.t === 'thread' || e.t === 'thread-del' || e.t === 'msg' || e.t === 'sync') dropSearchCache();
    if (e.t === 'thread' && typeof e.title === 'string' && (e.th || e.gid)) {
      const title = e.title;
      setThreads((ts) => ts.map((t) => (t.id === e.th || (e.gid && t.groupId === e.gid) ? { ...t, title } : t)));
    }
    if (e.t === 'job' && e.th && e.kind !== 'api') {
      const on = e.status === 'queued' || e.status === 'running' || e.waiting === true;
      setThreads((ts) => ts.map((t) => ((t.id === e.th || (e.gid && t.groupId === e.gid)) && !!t.busy !== on ? { ...t, busy: on } : t)));
    }
    if (e.t === 'job' && (e.status === 'done' || e.status === 'error') && e.kind !== 'api' && e.th) {
      const href = e.gid ? `/g/${e.gid}` : `/c/${e.th}`;
      const at = (e.status === 'done' && e.m ? `#m-${e.m}` : '');
      if (pathRef.current !== href) {
        const both = Array.isArray(e.both) ? (e.both as { model: string; status: string; lane?: string; m?: string }[]) : undefined;
        const bm = both?.find((x) => x.status === 'done' && x.lane === 'a') ?? both?.find((x) => x.status === 'done');
        const t: Toast = { id: String(e.job), href: href + (both ? (bm?.m ? `#m-${bm.m}` : '') : at), model: String(e.modelName ?? e.model ?? ''), title: String(e.title ?? tr(docLang(), 'shell.newChat')), preview: String(e.preview ?? ''),
          error: both ? !bm : e.status === 'error', auto: (e.autoName as string | null) ?? null, both };
        if (e.notice === 'toast' && document.visibilityState === 'visible') setToasts((x) => [...x.filter((y) => !y.href.startsWith(href)), t].slice(-3));
        else if (e.notice === 'push' && document.visibilityState !== 'visible') void systemNotify(t);
      }
    }
    if (e.t === 'check' && e.th && e.notice === 'toast' && document.visibilityState === 'visible') {
      const href = e.gid ? `/g/${e.gid}` : `/c/${e.th}`;
      if (pathRef.current !== href) {
        const t: Toast = { id: `check-${String(e.th)}`, href: href + (e.m ? `#m-${e.m}` : ''), model: '', title: String(e.title ?? tr(docLang(), 'shell.newChat')), preview: String(e.host ?? ''), check: String(e.host ?? '') };
        setToasts((x) => [...x.filter((y) => !y.href.startsWith(href)), t].slice(-3));
      }
    }
    if (e.t === 'read') {
      const ids = new Set((e.ids as string[] | undefined) ?? [e.th as string]);
      setThreads((ts) => ts.map((t) => (ids.has(t.id) || (e.gid && t.groupId === e.gid) ? { ...t, unread: false } : t)));
      const tag = (e.gid as string | null) ?? (e.th as string);
      setToasts((x) => x.filter((y) => !y.href.startsWith(e.gid ? `/g/${e.gid}` : `/c/${e.th}`)));
      void navigator.serviceWorker?.getRegistration().then((r) => r?.getNotifications({ tag })).then((ns) => ns?.forEach((n) => n.close())).catch(() => {});
      setBadge(Number(e.badge) || 0);
    }
    if (e.t === 'mute') setThreads((ts) => ts.map((t) => (t.id === e.th ? { ...t, muted: !!e.muted } : t)));
    if (e.t === 'thread-del') {
      const ids = (e.ids as string[] | undefined) ?? [];
      ids.forEach((id) => dropEntry(`/c/${id}`)); if (e.gid) dropEntry(`/g/${e.gid}`);
      const p = pathRef.current;
      if (ids.some((id) => p === `/c/${id}`) || p === `/g/${e.gid}`) router.push('/');
    }
  });
  const hrefOf = (t: ThreadLite) => (t.groupId ? `/g/${t.groupId}` : `/c/${t.id}`);
  const refOf = (t: ThreadLite): ChatRef => ({ id: t.id, groupId: t.groupId, title: t.title, muted: t.muted, folderId: t.folderId });
  const listRef = useRef<HTMLElement>(null);
  const warmVisible = useCallback((n: number) => {
    const box = listRef.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const hrefs = [...box.querySelectorAll<HTMLAnchorElement>('a.nav')].filter((a) => { const b = a.getBoundingClientRect(); return b.bottom > r.top && b.top < r.bottom; })
      .slice(0, n).map((a) => a.getAttribute('href') ?? '');
    prefetchIdle(hrefs);
  }, []);
  const openDrawer = useCallback(() => { document.documentElement.classList.add('drawer-open'); warmVisible(8); }, [warmVisible]);
  const closeDrawer = useCallback(() => document.documentElement.classList.remove('drawer-open', 'drawer-nofade'), []);
  const [pending, setPending] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const closeToast = useCallback((id: string) => setToasts((x) => x.filter((t) => t.id !== id)), []);
  useEffect(() => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (!sw) return;
    const on = (ev: MessageEvent) => { const d = ev.data as { type?: string; url?: string } | null; if (d?.type === 'kx-open' && d.url?.startsWith('/')) { void takePending(); router.push(d.url); } };
    sw.addEventListener('message', on);
    return () => sw.removeEventListener('message', on);
  }, [router]);
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      void takePending().then((u) => { if (u && u !== window.location.pathname + window.location.hash) router.push(u); });
    };
    check();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('pageshow', check);
    window.addEventListener('focus', check);
    return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('pageshow', check); window.removeEventListener('focus', check); };
  }, [router]);
  useEffect(() => { closeDrawer(); setPending(null); }, [path, closeDrawer]);
  useEffect(() => { if (!pending) return; const t = window.setTimeout(() => setPending(null), 15_000); return () => window.clearTimeout(t); }, [pending]);
  useEffect(() => { document.documentElement.classList.remove('drawer-open'); }, []);
  useEffect(() => trackViewport(), []);
  useEffect(() => { warmServe('open'); return warmOnReturn(); }, []);
  useEffect(() => {
    const el = listRef.current;
    if (!el || !window.matchMedia('(hover: none)').matches) return;
    let row: HTMLElement | null = null, x0 = 0, y0 = 0, timer = 0, suppress = false;
    const close = (except?: Element | null) => el.querySelectorAll('.nav-row.is-acts').forEach((r) => { if (r !== except) r.classList.remove('is-acts'); });
    const start = (e: TouchEvent) => {
      const tg = e.target as Element;
      if (tg.closest('.nav-acts')) return;
      const r = tg.closest<HTMLElement>('.nav-row');
      close(r);
      row = r;
      if (!r) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!row) return;
        close(row); suppress = true; haptic();
        const id = row.dataset.tid, gid = row.dataset.gid;
        const th = id ? threadsRef.current.find((x) => x.id === id) : null;
        if (th) chatMenu({ id: th.id, groupId: th.groupId || (gid || null), title: th.title, muted: th.muted, folderId: th.folderId });
        else row.classList.add('is-acts');
      }, 480);
    };
    const move = (e: TouchEvent) => { if (row && Math.hypot(e.touches[0].clientX - x0, e.touches[0].clientY - y0) > 10) { window.clearTimeout(timer); row = null; } };
    const end = () => { window.clearTimeout(timer); row = null; };
    const click = (e: MouseEvent) => { if (suppress) { suppress = false; e.preventDefault(); e.stopPropagation(); } };
    const outside = (e: TouchEvent) => { if (!el.contains(e.target as Node)) close(); };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
    el.addEventListener('click', click, true);
    el.addEventListener('contextmenu', (e) => { if ((e.target as Element).closest('.nav-row')) e.preventDefault(); });
    document.addEventListener('touchstart', outside, { passive: true });
    return () => {
      el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end);
      el.removeEventListener('click', click, true); document.removeEventListener('touchstart', outside); window.clearTimeout(timer);
    };
  }, [chatMenu]);
  useEffect(() => attachDrawerSwipe(() => { document.documentElement.classList.add('drawer-open', 'drawer-nofade'); warmVisible(8); }, closeDrawer), [closeDrawer, warmVisible]);
  useEffect(() => { const t = window.setTimeout(() => { if (window.innerWidth > 760) warmVisible(3); }, 1500); return () => window.clearTimeout(t); }, [warmVisible]);
  const onNav = (e: React.MouseEvent, href: string) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    closeDrawer();
    if (href !== path) { setPending(href); void prefetchThread(href); }
  };
  const warm = (href: string) => { void prefetchThread(href); };
  const openHit = useCallback((h: Hit) => {
    setPalette(false);
    closeDrawer();
    if (h.msgId) setPendingFind({ m: h.msgId, marks: h.marks });
    const base = h.href.split(/[?#]/)[0];
    if (base === pathRef.current) {
      if (!h.msgId) return;
      const p = takePendingFind(h.msgId);
      if (document.getElementById(`m-${h.msgId}`)) {
        window.history.replaceState(window.history.state, '', `${base}#m-${h.msgId}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        if (p) jumpTo(p);
        return;
      }
      if (p) setPendingFind(p);
      window.location.assign(h.href);
      return;
    }
    setPending(base); void prefetchThread(base);
    router.push(h.href);
  }, [closeDrawer, router]);
  const openPalette = useCallback(() => { setPalette(true); }, []);
  const closePalette = useCallback(() => setPalette(false), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || (e.code !== 'KeyK' && e.key.toLowerCase() !== 'k')) return;
      e.preventDefault();
      setPalette((o) => !o);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  const loadFolders = refreshFolders;
  const inFolder = useCallback((t: ThreadLite) => !!t.folderId && folders.some((f) => f.id === t.folderId), [folders]);
  const [allRows, setAllRows] = useState(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    const go = () => setAllRows(true);
    if (w.requestIdleCallback) { const h = w.requestIdleCallback(go, { timeout: 1500 }); return () => w.cancelIdleCallback?.(h); }
    const t = window.setTimeout(go, 300); return () => window.clearTimeout(t);
  }, []);
  const groups = useMemo(() => {
    const out: { name: string; items: ThreadLite[] }[] = [];
    let n = 0;
    for (const t of threads) {
      if (org ? t.folderId !== org : inFolder(t)) continue;
      if (!allRows && ++n > FIRST_ROWS) break;
      const g = dayGroup(t.updatedAt, Date.now(), tx.lang);
      let grp = out.find((x) => x.name === g);
      if (!grp) out.push((grp = { name: g, items: [] }));
      grp.items.push(t);
    }
    return out;
  }, [threads, inFolder, allRows, tx.lang, org]);

  const logout = async () => {
    await Promise.race([disablePush(), new Promise((r) => setTimeout(r, 1500))]);
    const r = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: deviceId() }) }).catch(() => null);
    if (r && !r.ok && r.status !== 401) return;
    window.location.href = '/login';
  };
  const row = (t: ThreadLite) => (
                  <div className="nav-row" key={t.id} data-tid={t.id} data-gid={t.groupId ?? undefined}>
                    <Link href={hrefOf(t)} className="nav" prefetch={false} draggable={!t.groupId} onDragStart={(e) => { if (!t.groupId) dragThread(e, t.id); }} aria-current={(pending ?? path) === hrefOf(t) ? 'page' : undefined} data-unread={t.unread && (pending ?? path) !== hrefOf(t) ? '' : undefined}
                      onClick={(e) => onNav(e, hrefOf(t))} onMouseEnter={() => warm(hrefOf(t))} onFocus={() => warm(hrefOf(t))} onTouchStart={() => warm(hrefOf(t))}>
                      {(t.groupId || t.cmp) && <Icon n="columns" sm />}<span className="nav-t"><FadeText text={t.title} /></span>
                      {t.muted && <Icon n="bell-off" sm className="nav-muted" />}
                      {t.busy ? <i className="nav-busy" aria-label={tx('shell.busy')} data-testid="busy" />
                        : t.unread && (pending ?? path) !== hrefOf(t) && <i className="nav-dot" aria-label={tx('shell.unread')} data-testid="unread" />}
                    </Link>
                    <span className="nav-acts">
                      {!t.groupId && <MoveButton t={t} folders={folders} onMoved={() => { void refresh(); void loadFolders(); }} />}
                      <button type="button" className="icon-btn" aria-label={tx('shell.rename')} onClick={() => chatMenu(refOf(t), 'rename')} data-testid="row-rename"><Icon n="edit" sm /></button>
                      <button type="button" className="icon-btn" aria-label={tx('common.delete')} onClick={() => chatMenu(refOf(t), 'delete')} data-testid="row-delete"><Icon n="trash" sm /></button>
                    </span>
                    {}
                    <button type="button" className="icon-btn nav-more" aria-label={tx('shell.chatActionsNamed', { title: t.title })} aria-haspopup="dialog" onClick={() => { haptic(); chatMenu(refOf(t)); }} data-testid="row-more"><Icon n="more" /></button>
                  </div>
  );
  const initials = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';

  return (
    <ShellCtx.Provider value={{ models, refresh, openDrawer, threads, role: user.role ?? 'user', chatMenu, locked, org, folders, orgMode }}>
     <OrgModeCtx.Provider value={orgMode}>
     <StatusCtx.Provider value={status}>
      <div className="app">
        {}
        <div className="drawer-scrim" onClick={closeDrawer} />
        <aside className="sidebar" aria-label={tx('shell.chats')} inert={sbCollapsed && !mobileView ? true : undefined}>
          <div className="sb-head">
            <Link href="/" className="brand"><span className="mark" aria-hidden="true" />{brandName}</Link>
            <button type="button" className="icon-btn only-m" aria-label={tx('shell.closeMenu')} onClick={closeDrawer}><Icon n="x" /></button>
            <button type="button" className="icon-btn only-d sb-toggle" aria-label={tx('shell.sidebarClose')} title={tx('shell.sidebarClose')} aria-expanded={!sbCollapsed} onClick={toggleSidebar} data-testid="sb-toggle"><Icon n="sidebar" /></button>
          </div>
          <div className="sb-actions">
            <button type="button" className="btn btn--block" onClick={() => router.push('/?new=' + Date.now())} data-testid="new-chat"><Icon n="compose" />{tx('shell.newChat')}</button>
            <SidebarSearch onOpenPalette={openPalette} />
            {orgMode && <OrgSwitch folders={folders} org={org} setOrg={setOrg} onNew={() => setNewOrg(true)} />}
            {
}
            {canAgents(user.role) && features?.automations !== false && <Link href="/automations" className={`nav sb-quiet${path.startsWith('/automations') ? ' is-on' : ''}`} aria-current={path.startsWith('/automations') ? 'page' : undefined} data-testid="automations-link"><Icon n="repeat" sm /><span className="nav-t">{tx('shell.automations')}</span></Link>}
          </div>
          {}
          <MainCtx.Provider value={main}>
          <nav className="sb-scroll" data-testid="thread-list" ref={listRef}>
            {!org && <FolderSection folders={folders} setFolders={setFolders} threads={threads.filter(inFolder)} row={row} onChanged={() => { void refresh(); void loadFolders(); }} />}
            {org && groups.length === 0 && <p className="t-cap" style={{ padding: 'var(--s-5) var(--s-3)' }} data-testid="org-no-chats">{tx(orgMode ? 'org.org.noChats' : 'org.noChats')}</p>}
            <ProjectDialog edit={newOrg ? 'new' : null} onClose={() => setNewOrg(false)} onSaved={() => { setNewOrg(false); void loadFolders(); }} onCreated={(f) => setOrg(f.id)} />
            {groups.length === 0 && !folders.length && <p className="t-cap" style={{ padding: 'var(--s-5) var(--s-3)' }}>{tx('shell.noChats')}</p>}
            {groups.map((g) => (
              <div key={g.name}>
                <div className="grp">{g.name}</div>
                {g.items.map((t) => row(t))}
              </div>
            ))}
          </nav>
          </MainCtx.Provider>
          {}
          {POWERED_BY && <a className="sb-powered only-m" href={POWERED_BY.href} target="_blank" rel="noopener" data-testid="sb-powered">{POWERED_BY.long}</a>}
          <AccountMenu name={user.name} email={user.email} admin={user.role === 'admin'} agents={canAgents(user.role)} api={apiOn} memory={features?.memory !== false} code={features?.code !== false} initials={initials} onLogout={logout} />
        </aside>
        <SearchPalette open={palette} onClose={closePalette} q={pq} setQ={setPq} onPick={openHit} threads={threads} models={models} />
        <Toasts items={toasts} onClose={closeToast} onOpen={(t) => { closeToast(t.id); router.push(t.href); }} />
        {features?.push !== false && <NotifyPrompt />}
        <InstallPrompt />
        <LangSuggest />
        <SeatNotices />
        <ChatSheet target={chatSheet?.c ?? null} view={chatSheet?.view ?? 'menu'} onView={(v) => setChatSheet((x) => (x ? { ...x, view: v } : x))} onClose={() => setChatSheet(null)}
          folders={folders} refresh={refresh} reloadFolders={loadFolders} />
        <div className="main" ref={setMain}>
          <MainCtx.Provider value={main}><FeaturesProvider value={features}><BlocksCfgProvider value={blocks}>{pending && pending !== path ? <ThreadPreview href={pending} /> : children}</BlocksCfgProvider></FeaturesProvider></MainCtx.Provider>
        </div>
      </div>
     </StatusCtx.Provider>
     </OrgModeCtx.Provider>
    </ShellCtx.Provider>
  );
}

export function Topbar({ title, sub, home, mode, compareOn, onCompare, chat, children }: { title?: string; sub?: ReactNode; home?: boolean; mode?: 'single' | 'compare'; compareOn?: boolean; onCompare?: () => void; chat?: ChatRef; children?: ReactNode }) {
  const brandName = useBrand().name;
  const tx = useT();
  const { openDrawer, chatMenu } = useShell();
  const router = useRouter();
  const on = onCompare ? !!compareOn : mode === 'compare';
  return (
    <>
    <header className={`topbar${home ? ' topbar--home' : ''}`}>
      <button type="button" className="icon-btn menu-btn" aria-label={tx('shell.menu')} onClick={openDrawer} data-testid="menu"><Icon n="menu" /></button>
      <button type="button" className="icon-btn only-d sb-open" aria-label={tx('shell.sidebarOpen')} title={tx('shell.sidebarOpen')} onClick={toggleSidebar} data-testid="sb-open"><Icon n="sidebar" /></button>
      <span className="brand top-brand"><span className="mark" aria-hidden="true" />{brandName}</span>
      {chat && chatMenu ? (
        <button type="button" className="top-title top-title--btn" onClick={() => chatMenu(chat)} aria-label={tx('shell.chatActions')} aria-haspopup="dialog" data-testid="top-title">
          <b>{title !== undefined && <FadeText text={title} />}</b>{sub && <small>{sub}</small>}
        </button>
      ) : <div className="top-title"><b>{title !== undefined && <FadeText text={title} />}</b>{sub && <small>{sub}</small>}</div>}
      <div className="top-tools">
        {children}
        {}
        {chat && chatMenu && <button type="button" className="icon-btn only-m" aria-label={tx('shell.newChat')} onClick={() => router.push('/?new=' + Date.now())} data-testid="top-new"><Icon n="compose" /></button>}
        {chat && chatMenu && <button type="button" className="icon-btn only-m" aria-label={tx('shell.chatActions')} aria-haspopup="dialog" onClick={() => chatMenu(chat)} data-testid="top-more"><Icon n="more" /></button>}
      </div>
    </header>
    <Announce />
    </>
  );
}

type AcctItem = { href: string; icon: string; label: string; testId: string; on: (p: string, h: string) => boolean };
export function AccountMenu({ name, email, admin, agents = admin, api = true, memory = true, code = true, initials, onLogout, initialOpen = false }: { name: string; email?: string; admin: boolean; agents?: boolean; api?: boolean; memory?: boolean; code?: boolean; initials: string; onLogout: () => Promise<void>; initialOpen?: boolean }) {
  const tx = useT();
  const [open, setOpen] = useState(initialOpen);
  const [leaving, setLeaving] = useState(false);
  const [ask, setAsk] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const mobile = useIsMobile();
  const byKey = useRef(false);
  const router = useRouter();
  const path = usePathname();
  const [hash, setHash] = useState('');
  const canInstall = useCanInstall();
  useEffect(() => { if (open) setHash(window.location.hash); }, [open]);
  const main: AcctItem[] = [
    { href: '/settings', icon: 'sliders', label: tx('shell.settings'), testId: 'settings-link', on: (p, h) => p === '/settings' && h !== '#github' },
    ...(memory ? [{ href: '/settings/memory', icon: 'layers', label: tx('shell.memory'), testId: 'memory-link', on: (p: string) => p.startsWith('/settings/memory') }] : []),
    { href: '/settings/limits', icon: 'gauge', label: tx('shell.limits'), testId: 'limits-link', on: (p) => p.startsWith('/settings/limits') },
    ...(agents && code ? [{ href: '/settings#github', icon: 'github', label: 'GitHub', testId: 'github-link', on: (p: string, h: string) => p === '/settings' && h === '#github' }] : []),
    ...(api ? [{ href: '/api-keys', icon: 'key', label: 'API', testId: 'api-link', on: (p: string) => p.startsWith('/api-keys') }] : []),
  ];
  const adm: AcctItem[] = admin ? [
    { href: '/admin', icon: 'user', label: admText('Администрирование'), testId: 'admin-link', on: (p) => p.startsWith('/admin') },
    { href: '/admin?tour=1', icon: 'play', label: admText('Тур по админке'), testId: 'tour-link', on: () => false },
    { href: '/vp', icon: 'eye', label: 'Диагностика экрана', testId: 'vp-link', on: (p) => p.startsWith('/vp') },
  ] : [];
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(box.current?.querySelectorAll<HTMLElement>('.acct-item') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    if (byKey.current) requestAnimationFrame(() => box.current?.querySelector<HTMLElement>('.acct-item')?.focus({ preventScroll: true }));
    const out = (e: FocusEvent) => { const to = e.relatedTarget as Node | null; if (to && !box.current?.contains(to)) setOpen(false); };
    const el = box.current; el?.addEventListener('focusout', out);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); el?.removeEventListener('focusout', out); };
  }, [open]);
  useEffect(() => {
    const el = menu.current;
    if (!open || !mobile || !el) return;
    return attachSheetDrag(el, scrim.current, () => setOpen(false));
  }, [open, mobile]);
  const item = (it: AcctItem) => {
    const on = it.on(path, hash);
    return (
      <Link key={it.href} href={it.href} className={`acct-item${on ? ' is-on' : ''}`} aria-current={on ? 'page' : undefined} data-testid={it.testId}
        onClick={() => setOpen(false)}>{it.icon === 'github' ? <GhMark size={16} /> : <Icon n={it.icon} sm />}<span>{it.label}</span></Link>
    );
  };
  return (
    <div className="sb-foot acct" ref={box}>
      {open && <div className="acct-scrim only-m" ref={scrim} aria-hidden="true" onPointerDown={() => setOpen(false)} />}
      {open && (
        <nav className="acct-menu" ref={menu} id="acct-menu" aria-label={tx('shell.profile')} data-testid="account-menu">
          <i className="acct-grab only-m" aria-hidden="true" />
          <div className="acct-who"><span className="avatar">{initials}</span><span><b>{name}</b>{email && <small>{email}</small>}</span></div>
          <div className="acct-sep" role="separator" />
          {main.map(item)}
          {canInstall && (
            <button type="button" className="acct-item" data-testid="install-link" onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent('kx:install-open')); }}>
              <Icon n="download" sm /><span>{tx('install.menu')}</span>
            </button>
          )}
          {adm.length > 0 && <><div className="acct-sep" role="separator" />{adm.map(item)}</>}
          <div className="acct-sep" role="separator" />
          <button type="button" className="acct-item" disabled={leaving} data-testid="logout"
            onClick={() => { setOpen(false); setAsk(true); }}>
            <Icon n="lock" sm /><span>{tx('shell.logout')}</span>
          </button>
        </nav>
      )}
      <button type="button" className="acct-btn" ref={btn} aria-expanded={open} aria-controls="acct-menu" aria-label={tx('shell.profileOf', { name })} onClick={(e) => { byKey.current = e.detail === 0; setOpen((o) => !o); }} data-testid="account">
        <span className="avatar">{initials}</span>
        <span className="who"><b>{name}</b></span>
        <Icon n="chev-ud" sm />
      </button>
      <Confirm open={ask} title={tx('shell.logoutTitle')} message={tx('shell.logoutText')} action={tx('shell.logout')} busy={leaving}
        onCancel={() => setAsk(false)} onConfirm={async () => { setLeaving(true); try { await onLogout(); } finally { setLeaving(false); setAsk(false); } }} />
    </div>
  );
}

function setBadge(n: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try { if (n > 0) void nav.setAppBadge?.(n).catch(() => {}); else void nav.clearAppBadge?.().catch(() => {}); } catch {  }
}

async function systemNotify(t: Toast) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || (await hasLocalSub())) return;
    const reg = await navigator.serviceWorker?.getRegistration();
    const lang = docLang(), p = toastParts(t, lang);
    const title = p.b + p.rest;
    const opts = { body: toastBody(t, lang), tag: t.href.split('#')[0].split('/').pop(), data: { url: t.href }, icon: '/icon-192.png' };
    if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  } catch {  }
}
