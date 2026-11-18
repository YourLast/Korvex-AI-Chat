'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { COUNTDOWN_S, INSTALL_KEY, canInstall, countdownLeft, guideOf, installEnv, installWay, markDismissed, markInstalled, markShown, readInstall, shouldOffer, systemLang, type InstallEnv, type InstallState, type Way } from '@/lib/install';
import { dropBip, getBip } from '@/lib/installPrompt';
import { Icon } from './Icon';
import { InstallGuide } from './InstallGuide';
import { toast } from './Kit';
import '@/styles/install.css';
import { copyText } from '@/lib/clipboard';

const load = (): InstallState => { try { return readInstall(localStorage.getItem(INSTALL_KEY)); } catch { return readInstall(null); } };
const save = (st: InstallState) => { try { localStorage.setItem(INSTALL_KEY, JSON.stringify(st)); } catch {  } };

export function readEnv(): InstallEnv {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return installEnv(navigator.userAgent, navigator.maxTouchPoints || 0, standalone, !!getBip());
}

function blocked(): boolean {
  const h = document.documentElement;
  return !!h.dataset.voice || h.classList.contains('drawer-open') || !!document.querySelector('.sheet, .scrim, .pop, .np, [role=dialog][aria-modal=true]');
}

type View = 'offer' | 'guide' | 'later';

export function InstallPrompt() {
  const t = useT();
  const [view, setView] = useState<View | null>(null);
  const [env, setEnv] = useState<InstallEnv | null>(null);
  const auto = useRef(false);
  const waiting = useRef(0);
  const [started, setStarted] = useState(0);
  const [left, setLeft] = useState(COUNTDOWN_S);
  const box = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => setEnv(readEnv()), []);

  useEffect(() => {
    refresh();
    const onBip = () => refresh();
    const onInstalled = () => { save(markInstalled(load())); setView(null); refresh(); toast(t('install.installed')); };
    window.addEventListener('kx:bip', onBip);
    window.addEventListener('kx:installed', onInstalled);
    const open = () => { auto.current = false; const e = readEnv(); setEnv(e); setView(installWay(e) === 'native' && e.platform === 'desktop' ? 'offer' : 'guide'); };
    window.addEventListener('kx:install-open', open);
    let tm = 0;
    const offer = () => {
      waiting.current = 0;
      if (document.documentElement.dataset.kxInstall === 'off') return;
      const e = readEnv(), st = load();
      if (!shouldOffer(st, e, Date.now())) return;
      if (blocked()) { waiting.current = window.setTimeout(offer, 1000); return; }
      save(markShown(st));
      auto.current = true; setEnv(e); setView('offer');
    };
    tm = window.setTimeout(offer, 1400);
    return () => {
      window.clearTimeout(tm); window.clearTimeout(waiting.current);
      window.removeEventListener('kx:bip', onBip); window.removeEventListener('kx:installed', onInstalled); window.removeEventListener('kx:install-open', open);
    };
  }, [refresh, t]);

  useEffect(() => {
    if (view !== 'later') return;
    setLeft(COUNTDOWN_S);
    const id = window.setInterval(() => setLeft(countdownLeft(started, Date.now())), 200);
    return () => window.clearInterval(id);
  }, [view, started]);

  const way: Way | null = env ? installWay(env) : null;
  const close = useCallback((remember = true) => {
    setView(null);
    if (remember) save(markDismissed(load(), Date.now()));
  }, []);
  const notNow = () => { if (auto.current) { setStarted(Date.now()); setLeft(COUNTDOWN_S); setView('later'); } else close(); };
  const doInstall = async () => {
    const bip = getBip();
    if (way === 'native' && bip) {
      try {
        await bip.prompt();
        const r = await bip.userChoice;
        dropBip(); refresh();
        if (r.outcome === 'accepted') { save(markInstalled(load())); setView(null); toast(t('install.installed')); }
        else close();
      } catch { close(); }
      return;
    }
    setView('guide');
  };

  useEffect(() => {
    if (!view) return;
    const back = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => box.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true }));
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (view === 'offer') notNow(); else if (view === 'guide' || left === 0) close();
    };
    document.addEventListener('keydown', key);
    return () => { cancelAnimationFrame(id); document.removeEventListener('keydown', key); back?.focus?.({ preventScroll: true }); };
  }, [view, left]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view || !env) return null;
  const waitOn = left > 0;
  const copyLink = async () => {
    if (await copyText(window.location.origin + '/')) toast(t('install.copiedLink'));
  };

  return (
    <div className="ins-scrim" data-testid="install-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget && (view === 'offer' ? true : view === 'guide' || left === 0)) { if (view === 'offer') notNow(); else close(); } }}>
      <div className="ins" role="dialog" aria-modal="true" aria-labelledby="ins-t" ref={box} data-view={view} data-testid="install-sheet">
        <i className="ins-grab" aria-hidden="true" />
        {view === 'offer' && (
          <div className="ins-pane" key="offer">
            <span className="ins-icon" aria-hidden="true"><img src="/icon-512.png" alt="" width={72} height={72} /></span>
            <h2 id="ins-t">{t('install.title')}</h2>
            <p className="ins-lead">{t('install.lead')}</p>
            <ul className="ins-list">
              <li><span className="ins-bi"><Icon n="hand" sm /></span><span>{t('install.b1')}</span></li>
              <li><span className="ins-bi"><Icon n="expand" sm /></span><span>{t('install.b2')}</span></li>
              <li><span className="ins-bi"><Icon n="bell" sm /></span><span>{t('install.b3')}</span></li>
            </ul>
            <div className="ins-acts">
              <button type="button" className="ins-primary" data-autofocus="" data-testid="install-go" onClick={() => void doInstall()}>{t('install.install')}</button>
              <button type="button" className="ins-plain" data-testid="install-later" onClick={notNow}>{t('install.later')}</button>
            </div>
            <p className="ins-find" data-testid="install-find">{t('install.findLater')}</p>
          </div>
        )}

        {view === 'later' && (
          <div className="ins-pane ins-pane--later" key="later" data-testid="install-gentle">
            <span className="ins-icon ins-icon--sm" aria-hidden="true"><img src="/icon-512.png" alt="" width={56} height={56} /></span>
            <h2 id="ins-t">{t('install.gentleTitle')}</h2>
            <p className="ins-lead">{t('install.gentleText')}</p>
            <div className="ins-acts">
              <button type="button" className="ins-primary ins-wait" data-wait={waitOn || undefined} aria-disabled={waitOn} data-autofocus="" data-testid="install-ok"
                onClick={() => { if (!waitOn) close(); }}>
                {waitOn && <i className="ins-fill" style={{ ['--d' as string]: `${COUNTDOWN_S}s` }} aria-hidden="true" />}
                <span>{waitOn ? t('install.okWait', { n: left }) : t('install.ok')}</span>
              </button>
              <button type="button" className="ins-link" data-testid="install-anyway" onClick={() => void doInstall()}>{t('install.anyway')}</button>
            </div>
          </div>
        )}

        {view === 'guide' && (
          <InstallGuide env={env} sys={systemLang(navigator.languages?.length ? navigator.languages : [navigator.language])} hasPrompt={!!getBip()}
            onNative={() => void doInstall()} onCopy={() => void copyLink()} onDone={() => close()} />
        )}
      </div>
    </div>
  );
}

export function useCanInstall(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const f = () => { try { setOk(canInstall(readEnv(), load())); } catch { setOk(false); } };
    f();
    window.addEventListener('kx:bip', f); window.addEventListener('kx:installed', f);
    return () => { window.removeEventListener('kx:bip', f); window.removeEventListener('kx:installed', f); };
  }, []);
  return ok;
}
