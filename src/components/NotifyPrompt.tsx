'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { enablePush, pushEnv, pushOn } from '@/lib/pushClient';
import { NP_KEY, NP_SESSION, SLOW_MS, decide, markDenied, readNP, snooze, visit, type Card, type NPState, type Trigger } from '@/lib/notifyPrompt';
import { Icon } from './Icon';

const load = (): NPState => { try { return readNP(localStorage.getItem(NP_KEY)); } catch { return readNP(null); } };
const save = (st: NPState) => { try { localStorage.setItem(NP_KEY, JSON.stringify(st)); } catch {  } };

function blocked(): boolean {
  const h = document.documentElement;
  return !!h.dataset.voice || h.classList.contains('drawer-open') || !!document.querySelector('.sheet, .scrim, .pop, [role=dialog][aria-modal=true]');
}

type Phase = 'ask' | 'busy' | 'done' | 'error';

export function NotifyPrompt() {
  const t = useT();
  const [card, setCard] = useState<Card | null>(null);
  const [phase, setPhase] = useState<Phase>('ask');
  const [msg, setMsg] = useState('');
  const [bottom, setBottom] = useState<number | null>(null);
  const shown = useRef(false);
  const waiting = useRef(0);

  const place = useCallback(() => {
    const d = document.querySelector('[data-testid=dock]');
    const vv = window.visualViewport;
    const h = vv ? vv.height + vv.offsetTop : window.innerHeight;
    setBottom(d ? Math.max(0, Math.round(h - d.getBoundingClientRect().top)) : null);
  }, []);

  const offer = useCallback(async (t: Trigger) => {
    if (shown.current || waiting.current) return;
    const env = pushEnv();
    let st = load();
    if (env.permission === 'denied' && !st.denied) { st = markDenied(st); save(st); }
    const on = await pushOn();
    const c = decide(st, env, on, t, Date.now());
    if (!c || c === 'install') return;
    const show = () => {
      waiting.current = 0;
      if (shown.current) return;
      if (blocked()) { waiting.current = window.setTimeout(show, 800); return; }
      shown.current = true;
      place(); setPhase('ask'); setMsg(''); setCard(c);
    };
    show();
  }, [place]);

  useEffect(() => {
    let first = false;
    try { if (!sessionStorage.getItem(NP_SESSION)) { sessionStorage.setItem(NP_SESSION, '1'); first = true; } } catch { first = true; }
    if (first) save(visit(load()));
    const tm = window.setTimeout(() => void offer('visit'), 1500);
    const slow = (e: Event) => { const ms = Number((e as CustomEvent<{ ms: number }>).detail?.ms) || 0; if (ms >= SLOW_MS) void offer('slow'); };
    window.addEventListener('kx:answer', slow);
    return () => { window.clearTimeout(tm); window.clearTimeout(waiting.current); window.removeEventListener('kx:answer', slow); };
  }, [offer]);

  useEffect(() => {
    if (!card) return;
    const vv = window.visualViewport;
    window.addEventListener('resize', place); vv?.addEventListener('resize', place);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    const d = document.querySelector('[data-testid=dock]'); if (d && ro) ro.observe(d);
    return () => { window.removeEventListener('resize', place); vv?.removeEventListener('resize', place); ro?.disconnect(); };
  }, [card, place]);

  const close = () => setCard(null);
  const later = () => { save(snooze(load(), Date.now())); close(); };
  const enable = async () => {
    setPhase('busy');
    const r = await enablePush(t.lang);
    if (r.ok) {
      setPhase('done'); setMsg(t('tools.np.done'));
      window.setTimeout(close, 2500);
      return;
    }
    const denied = typeof Notification !== 'undefined' && Notification.permission === 'denied';
    if (denied) save(markDenied(load()));
    setPhase('error');
    setMsg(denied ? t('tools.np.denied') : (r.error ?? t('tools.np.fail')));
  };

  if (!card) return null;
  const style = bottom !== null ? { ['--np-bottom' as string]: `${bottom}px` } : undefined;
  return (
    <div className={`np${bottom !== null ? ' np--dock' : ''}`} style={style} role="dialog" aria-label={card === 'push' ? t('tools.notify.title') : t('tools.np.homeLabel')} data-testid="np" data-card={card} data-phase={phase}>
      {card === 'push' ? (
        <>
          <div className="np-head">
            <span className="np-ic"><Icon n={phase === 'done' ? 'check' : 'bell'} sm /></span>
            <div className="np-t">
              {phase === 'done' ? <b role="status">{msg}</b> : <>
                <b>{t('tools.np.ask')}</b>
                <span>{t('tools.np.askSub')}</span>
              </>}
              {phase === 'error' && <span className="np-err" role="alert" data-testid="np-err">{msg}</span>}
            </div>
          </div>
          {phase !== 'done' && (
            <div className="np-acts">
              {phase === 'error' ? (
                <>
                  <button type="button" className="btn btn--ghost np-btn" onClick={close} data-testid="np-close">{t('tools.np.gotIt')}</button>
                  <a className="btn np-btn" href="/settings" onClick={close} data-testid="np-settings">{t('tools.np.settings')}</a>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn--ghost np-btn" onClick={later} disabled={phase === 'busy'} data-testid="np-later">{t('tools.np.later')}</button>
                  <button type="button" className="btn btn--primary np-btn" onClick={() => void enable()} disabled={phase === 'busy'} data-testid="np-on">{phase === 'busy' ? t('tools.np.enabling') : t('tools.np.enable')}</button>
                </>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="np-head">
            <span className="np-ic"><Icon n="bell" sm /></span>
            <div className="np-t">
              <b>{t('tools.np.homeTitle')}</b>
              <span>{t('tools.np.homeSub')}</span>
            </div>
          </div>
          <div className="np-pic" aria-hidden="true">
            <div className="np-bar"><Icon n="chev-right" sm className="np-flip" /><Icon n="chev-right" sm /><span className="np-share"><Icon n="share" sm /></span><Icon n="file-text" sm /><Icon n="columns" sm /></div>
            <Icon n="arrow-right" sm className="np-arrow" />
            <div className="np-menu"><span>{t('tools.np.copy')}</span><span className="is-on">{t('tools.np.addHome')}<i className="np-plus"><Icon n="plus" sm /></i></span></div>
          </div>
          <ol className="np-steps">
            <li>{t('tools.np.s1a')}<Icon n="share" sm />{t('tools.np.s1b')}</li>
            <li>{t('tools.np.s2')}</li>
          </ol>
          <div className="np-acts">
            <button type="button" className="btn btn--ghost np-btn" onClick={later} data-testid="np-later">{t('tools.np.later')}</button>
            <button type="button" className="btn btn--primary np-btn" onClick={later} data-testid="np-ok">{t('tools.np.gotIt')}</button>
          </div>
        </>
      )}
    </div>
  );
}
