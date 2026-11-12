'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MsgView } from '@/lib/types';
import { useT } from '@/lib/i18n/react';
import { errText } from '@/lib/i18n/errors';
import { useLive, type LiveEv } from '@/lib/live';
import { browserTimeZone } from '@/lib/tz';
import { Icon } from './Icon';
import { Popover, useIsMobile } from './Popover';
import { MemUpdated, type MemUpdItem } from './MemUpd';
import { AssistantMsg, UserTurn } from './Message';
import { ModelMark } from './ModelMark';
import { Composer, type ComposerHandle } from './Composer';
import { useChatStream } from './useChatStream';
import { useShell } from './Shell';
import { useConfirm } from './Kit';
import '@/styles/user-memory.css';
import { INTRO_DRAFT as DRAFT } from '@/ext/client';

type View = { threadId: string | null; messages: MsgView[]; busy: boolean; off?: boolean };

export function MemoryIntro({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const mobile = useIsMobile();
  const models = useShell()?.models ?? [];
  const [threadId, setThreadId] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const [err, setErr] = useState('');
  const { msgs, setMsgs, busy, send, stop } = useChatStream([], false, threadId, { quiet: true });
  const [confirmUi, ask] = useConfirm();
  const [restarting, setRestarting] = useState(false);
  const list = useRef<HTMLDivElement | null>(null);
  const comp = useRef<ComposerHandle>(null);
  const stick = useRef(true);

  const take = useCallback((v: View) => {
    setOff(!!v.off);
    if (v.threadId) setThreadId(v.threadId);
    setMsgs(v.messages ?? []);
    stick.current = true;
  }, [setMsgs]);

  useEffect(() => {
    if (!open) return;
    setErr('');
    stick.current = true;
    let gone = false;
    void (async () => {
      const r = await fetch('/api/memory/intro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'open', timezone: browserTimeZone() }) }).catch(() => null);
      if (gone) return;
      if (r?.ok) take((await r.json()) as View);
      else {
        const j = (await r?.json().catch(() => ({}))) as { error?: string } | undefined;
        setErr(j?.error ? errText(t.lang, j.error) : t('tools.memset.introFail'));
        const g = await fetch('/api/memory/intro', { cache: 'no-store' }).catch(() => null);
        if (!gone && g?.ok) take((await g.json()) as View);
      }
    })();
    return () => { gone = true; };
  }, [open, take]); // eslint-disable-line react-hooks/exhaustive-deps

  useLive((e: LiveEv) => {
    if (!threadId || e.th !== threadId || e.t !== 'memupd') return;
    setMsgs((all) => all.map((m) => (m.id === e.m ? (m.role === 'user' ? { ...m, memUpd: e.items as MemUpdItem[] } : { ...m, meta: { ...(m.meta ?? {}), memUpd: e.items as MemUpdItem[] } }) : m)));
  });

  const toEnd = useCallback(() => { const el = list.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, []);
  const setList = useCallback((el: HTMLDivElement | null) => {
    list.current = el;
    if (el) { stick.current = true; el.scrollTop = el.scrollHeight; requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; }); }
  }, []);
  const last = msgs.at(-1);
  useLayoutEffect(toEnd, [toEnd, msgs.length, last?.content.length, last?.reasoning?.length, last?.memUpd?.length, last?.streaming, open]);
  const onScroll = () => { const el = list.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };

  const onSend = (text: string) => {
    if (!threadId || off) return false;
    stick.current = true;
    return send({ threadId, text, ...DRAFT });
  };
  const restart = async () => {
    if (!(await ask({ title: t('tools.memset.introRestartAsk'), message: t('tools.memset.introRestartMsg'), action: t('tools.memset.introRestart') }))) return;
    setRestarting(true); setErr('');
    try {
      const r = await fetch('/api/memory/intro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restart', timezone: browserTimeZone() }) }).catch(() => null);
      if (r?.ok) take((await r.json()) as View);
      else setErr(t('tools.memset.introRestartFail'));
    } finally { setRestarting(false); }
  };

  const lastA = [...msgs].reverse().find((m) => m.role === 'assistant');
  const answered = msgs.some((m) => m.role === 'user');
  const body = (
    <div className="mi-list" ref={setList} onScroll={onScroll} data-testid="intro-list">
      <div className="mi-feed">
        {off ? <p className="mi-note">{t('tools.memset.introOff')}</p> : null}
        {msgs.map((m) => m.role === 'user' ? (
          <div key={m.id} className="mi-u" data-testid="intro-user">
            <UserTurn m={m} />
            {m.memUpd?.length ? <MemUpdated items={m.memUpd as MemUpdItem[]} messageId={m.id} /> : null}
          </div>
        ) : (
          <div key={m.id} className="mi-a" data-testid="intro-assistant" data-done={!m.streaming && !!m.content.trim() || undefined}>
            <AssistantMsg m={m} models={models} bare headSlot={<ModelMark id={m.meta?.modelId ?? DRAFT.modelId} models={models} />}
              last={m === lastA} canRegen={!busy && !restarting} onRegenerate={() => { if (threadId) { stick.current = true; void send({ threadId, text: '', mode: 'regenerate', ...DRAFT }); } }} />
          </div>
        ))}
        {err && <p className="mi-note mi-note--err" role="alert">{err}</p>}
        {answered && !busy && (
          <div className="mi-restart">
            <button type="button" className="mi-restart-btn" onClick={() => void restart()} disabled={restarting} data-testid="intro-restart">
              <Icon n="retry" sm />{t('tools.memset.introRestart')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
  const composer = off ? null : (
    <div className="mi-comp" data-nodrag>
      <Composer ref={comp} busy={busy || restarting} placeholder={t('tools.memset.introPh')} label={t('tools.memset.introPh')} modelSlot={null} onStop={stop} onSend={(text) => onSend(text)} attach={false} />
    </div>
  );
  return (
    <>
      {mobile ? (
        <Popover anchor={null} open={open} onClose={onClose} title={t('tools.memset.introTitle')} sheetClass="k-sheet mi-sheet" bodyClass="mi-body" foot={composer} testId="intro-sheet">
          {body}
        </Popover>
      ) : (
        <IntroDialog open={open} onClose={onClose} title={t('tools.memset.introTitle')} sub={t('tools.memset.introSheetSub')} foot={composer}>{body}</IntroDialog>
      )}
      {confirmUi}
    </>
  );
}

function IntroDialog({ open, onClose, title, sub, children, foot }: { open: boolean; onClose: () => void; title: string; sub: string; children: React.ReactNode; foot: React.ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !ref.current?.querySelector('[data-testid=rec]')) { e.preventDefault(); closeRef.current(); }
    };
    document.addEventListener('keydown', key);
    const id = requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('textarea')?.focus({ preventScroll: true }));
    return () => { document.removeEventListener('keydown', key); cancelAnimationFrame(id); back?.focus?.({ preventScroll: true }); };
  }, [open]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="k-dlg-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="scrim">
      <div className="k-dlg mi-dlg" role="dialog" aria-modal="true" aria-label={title} ref={ref} data-testid="intro-sheet">
        <div className="k-dlg-h"><div><b>{title}</b><small>{sub}</small></div><button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose} data-x data-testid="pop-close"><Icon n="x" /></button></div>
        <div className="mi-body">{children}</div>
        {foot && <div className="k-dlg-f mi-foot">{foot}</div>}
      </div>
    </div>,
    document.body,
  );
}
