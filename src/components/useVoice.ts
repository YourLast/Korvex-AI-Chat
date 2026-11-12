'use client';
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent } from 'react';
import { useT } from '@/lib/i18n/react';
import { buzz, prepareAudio, startRecorder, type Recorder, type Take } from '@/lib/recorder';
import { CANCEL_PX, HOLD_MS, LAND_MS, MIN_REC_MS, TAIL_MS, envOf, holdState, micError, recError, sttError, type VoiceErr } from '@/lib/voiceLogic';

export type Phase = 'idle' | 'starting' | 'rec' | 'stt';
export type Mode = 'pending' | 'tap' | 'hold';

const ext = (mime: string) => (mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm');
function env() {
  const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return envOf(navigator.userAgent, standalone, window.isSecureContext, touchMac);
}

export function useVoice({ onHeard, getHeight }: { onHeard: (text: string) => void; getHeight: () => number }) {
  const lang = useT().lang;
  const langR = useRef(lang); langR.current = lang;
  const [phase, setPhaseS] = useState<Phase>('idle');
  const [mode, setModeS] = useState<Mode>('tap');
  const [dx, setDx] = useState(0);
  const [err, setErr] = useState<VoiceErr | null>(null);
  const [lockH, setLockH] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [landing, setLanding] = useState(false);
  const phaseR = useRef<Phase>('idle');
  const modeR = useRef<Mode>('tap');
  const setPhase = (p: Phase) => { phaseR.current = p; setPhaseS(p); };
  const setMode = (m: Mode) => { modeR.current = m; setModeS(m); };
  const rec = useRef<Recorder | null>(null);
  const gen = useRef(0);
  const take = useRef<Take | null>(null);
  const abort = useRef<AbortController | null>(null);
  const press = useRef<{ id: number; x: number; timer: number } | null>(null);
  const lastUp = useRef(-1e9);
  const [byKey, setByKey] = useState(false);
  const heard = useRef(onHeard); heard.current = onHeard;

  useEffect(() => {
    const h = document.documentElement;
    if (phase === 'idle') delete h.dataset.voice; else h.dataset.voice = phase;
    return () => { delete h.dataset.voice; };
  }, [phase]);

  const reset = useCallback(() => { setPhase('idle'); setDx(0); setLockH(0); setLanding(false); }, []);

  const cancel = useCallback((quiet = false) => {
    gen.current++;
    rec.current?.cancel(); rec.current = null;
    abort.current?.abort(); abort.current = null;
    if (!quiet && phaseR.current !== 'idle') buzz([6, 40, 6]);
    reset();
  }, [reset]);

  const send = useCallback(async (t: Take, g: number) => {
    const ac = new AbortController();
    abort.current = ac;
    setPhase('stt');
    let status = 0, code: string | undefined, text = '';
    try {
      const fd = new FormData();
      fd.append('audio', t.blob, `voice.${ext(t.mime)}`);
      const r = await fetch('/api/transcribe', { method: 'POST', body: fd, signal: ac.signal });
      status = r.status;
      const j = (await r.json().catch(() => ({}))) as { text?: string; code?: string };
      code = j.code; text = j.text ?? '';
    } catch {
      if (ac.signal.aborted) return;
      status = 0;
    }
    if (g !== gen.current) return;
    abort.current = null;
    const e = sttError(status, code, text, langR.current);
    if (e) { reset(); setErr(e); buzz([20, 60, 20]); return; }
    take.current = null;
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setLanding(true);
      await new Promise((r) => window.setTimeout(r, LAND_MS));
      if (g !== gen.current) return;
    }
    reset();
    heard.current(text);
  }, [reset]);

  const finish = useCallback(async () => {
    if (phaseR.current === 'starting') { cancel(true); return; }
    const r = rec.current;
    if (!r || phaseR.current !== 'rec') return;
    rec.current = null;
    const g = gen.current;
    setPhase('stt'); buzz(8);
    const t = await r.stop(TAIL_MS);
    if (g !== gen.current) return;
    if (!t) { reset(); setErr(sttError(200, undefined, '', langR.current)); return; }
    if (t.ms < MIN_REC_MS + TAIL_MS) { reset(); setErr(recError('too-short', langR.current)); return; }
    if (t.rawMax !== 0 && t.rawMax < -75) {
      reset();
      setErr(recError('no-audio', langR.current));
      return;
    }
    take.current = t;
    await send(t, g);
  }, [cancel, reset, send]);
  const finishR = useRef(finish); finishR.current = finish;

  const start = useCallback((m: Mode) => {
    if (phaseR.current !== 'idle') return;
    setErr(null); setDx(0); setLockH(getHeight());
    const ctx = prepareAudio();
    const g = ++gen.current;
    setMode(m); setPhase('starting');
    startRecorder(ctx, () => { if (g === gen.current) void finishR.current(); }).then((r) => {
      if (g !== gen.current) { r.cancel(); return; }
      rec.current = r;
      setStartedAt(performance.now());
      setPhase('rec');
      buzz(12);
    }).catch((e) => {
      if (g !== gen.current) return;
      reset();
      setErr(micError(e, env(), langR.current));
      buzz([20, 60, 20]);
    });
  }, [getHeight, reset]);

  const retry = useCallback((a: 'record' | 'resend') => {
    if (a === 'resend' && take.current) { setErr(null); setLockH(getHeight()); const g = ++gen.current; void send(take.current, g); return; }
    start('tap');
  }, [getHeight, send, start]);

  const cancelR = useRef(cancel); cancelR.current = cancel;
  const ptr = useRef<null | { move: (e: PointerEvent) => void; up: (e: PointerEvent) => void; pc: (e: PointerEvent) => void; end: () => void }>(null);
  if (!ptr.current) {
    const swallowClick = () => {
      const sw = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); window.removeEventListener('click', sw, true); };
      window.addEventListener('click', sw, true);
      window.setTimeout(() => window.removeEventListener('click', sw, true), 450);
    };
    const end = () => {
      const p = press.current;
      if (!p) return;
      window.clearTimeout(p.timer);
      press.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', pc);
    };
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.id) return;
      const d = Math.min(0, e.clientX - p.x);
      if (modeR.current === 'pending' && d < -16) setMode('hold');
      if (modeR.current !== 'hold') return;
      setDx(d);
      if (holdState(d) === 'cancel') { end(); cancelR.current(); }
    };
    const up = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.id) return;
      end();
      lastUp.current = performance.now();
      swallowClick();
      setDx(0);
      if (modeR.current === 'hold' && phaseR.current === 'rec') { void finishR.current(); return; }
      if (phaseR.current !== 'idle') setMode('tap');
    };
    const pc = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.id) return;
      end();
      setDx(0);
      if (phaseR.current !== 'idle') setMode('tap');
    };
    ptr.current = { move, up, pc, end };
  }
  useEffect(() => () => { ptr.current?.end(); gen.current++; rec.current?.cancel(); abort.current?.abort(); }, []);

  const micProps = {
    onPointerDown: (e: RPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || phaseR.current !== 'idle' || e.currentTarget.disabled) return;
      e.preventDefault();
      press.current = { id: e.pointerId, x: e.clientX, timer: window.setTimeout(() => { if (press.current && modeR.current === 'pending') { setMode('hold'); buzz(10); } }, HOLD_MS) };
      const h = ptr.current!;
      window.addEventListener('pointermove', h.move);
      window.addEventListener('pointerup', h.up);
      window.addEventListener('pointercancel', h.pc);
      setByKey(false);
      start('pending');
    },
    onClick: (e: RMouseEvent<HTMLButtonElement>) => {
      if (performance.now() - lastUp.current < 700 || press.current) return;
      if (phaseR.current === 'idle' && !e.currentTarget.disabled) { setByKey(e.detail === 0); start('tap'); }
    },
    onContextMenu: (e: RMouseEvent) => e.preventDefault(),
  };

  useEffect(() => {
    if (phase === 'idle') return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      else if (e.key === 'Enter' && !e.isComposing && phaseR.current === 'rec' && modeR.current === 'tap') {
        const a = document.activeElement;
        if (a && a.closest('button') && !a.closest('[data-testid=rec-done]')) return;
        e.preventDefault(); void finishR.current();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [phase, cancel]);

  return { phase, mode, dx, err, setErr, lockH, startedAt, landing, rec, start, finish, cancel, retry, micProps, byKey, cancelPx: CANCEL_PX };
}
export type Voice = ReturnType<typeof useVoice>;
