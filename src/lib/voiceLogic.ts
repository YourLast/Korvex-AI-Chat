import { tr, type Key, type Lang } from './i18n/core';

const dk = (s: string) => s as Key;

export const VOICE_MARKER = '⁠‌⁠';

export const HINT_AFTER_MS = 2000;
export const QUIET_DB = -50;
export const HOLD_MS = 300;
export const CANCEL_PX = 96;
export const TAIL_MS = 250;
export const MIN_REC_MS = 600;
export const MAX_REC_S = 600;

export function rmsDb(buf: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  const rms = buf.length ? Math.sqrt(s / buf.length) : 0;
  return rms > 1e-6 ? 20 * Math.log10(rms) : -120;
}

export function barLevel(db: number): number {
  const t = (db + 60) / 48;
  return Math.max(0, Math.min(1, t));
}

export class SilenceWatch {
  private quietSince: number | null = null;
  constructor(private afterMs = HINT_AFTER_MS, private quietDb = QUIET_DB) {}
  feed(tMs: number, db: number): boolean {
    if (db >= this.quietDb) { this.quietSince = null; return false; }
    if (this.quietSince === null) this.quietSince = tMs;
    return tMs - this.quietSince >= this.afterMs;
  }
  reset() { this.quietSince = null; }
}

export class Leveler {
  level: number | null = null;
  constructor(public target = -20, public maxDb = 24, public gateDb = -58) {}
  feed(db: number): number {
    if (db > this.gateDb) {
      if (this.level === null) this.level = db;
      else this.level += (db > this.level ? 0.35 : 0.04) * (db - this.level);
    }
    return this.gain();
  }
  gain(): number {
    if (this.level === null) return 0;
    return Math.max(0, Math.min(this.maxDb, this.target - this.level));
  }
}

export function pickMime(isSupported: (m: string) => boolean, ua: string): string {
  const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS\/|FxiOS\/|Edg\//.test(ua);
  const ios = /iPhone|iPad|iPod/.test(ua);
  const order = safari || ios
    ? ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return order.find((m) => { try { return isSupported(m); } catch { return false; } }) ?? '';
}

export function fmtDur(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function joinText(prev: string, heard: string): string {
  const had = prev.includes(VOICE_MARKER) || heard.includes(VOICE_MARKER);
  const a = prev.split(VOICE_MARKER).join('').replace(/\s+$/, '');
  const b = heard.split(VOICE_MARKER).join('').trim();
  const body = a && b ? `${a} ${b}` : a || b;
  return (had && body ? VOICE_MARKER : '') + body;
}

export const LAND_MS = 240;

export const REVEAL_STEP_MS = 32;
export const REVEAL_MIN_STEP_MS = 10;
export const REVEAL_FADE_MS = 420;
export const REVEAL_RISE_MS = 480;
export const REVEAL_BLUR_PX = 9;
export const REVEAL_RISE_PX = 5;
export const REVEAL_TOTAL_MS = 1500;
export const REVEAL_MAX_WORDS = 60;
export const REVEAL_MAX_WORDS_TOUCH = 40;
export const REVEAL_REDUCED_MS = 220;

export type RevealPart = { t: string; w: boolean };
export type RevealPlan = {
  head: string;
  parts: RevealPart[];
  count: number;
  skipped: number;
  step: number;
  fade: number;
  rise: number;
  total: number;
};

export function revealPlan(full: string, from: number, reduced = false, max = REVEAL_MAX_WORDS): RevealPlan {
  const head0 = full.slice(0, Math.max(0, from));
  let parts: RevealPart[] = full.slice(head0.length).split(/(\s+)/).filter(Boolean).map((t) => ({ t, w: !/^\s/.test(t) }));
  const all = parts.filter((p) => p.w).length;
  const skipped = reduced ? 0 : Math.max(0, all - max);
  let head = head0;
  if (skipped) {
    let i = 0, seen = 0;
    while (i < parts.length && seen < skipped) { if (parts[i].w) seen++; i++; }
    head += parts.slice(0, i).map((p) => p.t).join('');
    parts = parts.slice(i);
  }
  const count = all - skipped;
  const fade = reduced ? REVEAL_REDUCED_MS : REVEAL_FADE_MS;
  const rise = reduced ? REVEAL_REDUCED_MS : REVEAL_RISE_MS;
  const step = reduced || count < 2 ? 0 : Math.max(REVEAL_MIN_STEP_MS, Math.min(REVEAL_STEP_MS, (REVEAL_TOTAL_MS - rise) / (count - 1)));
  return { head, parts, count, skipped, step, fade, rise, total: count ? Math.round((count - 1) * step + rise) : 0 };
}

export function revealFrom(full: string, prev: string): number {
  const lead = full.startsWith(VOICE_MARKER) ? VOICE_MARKER.length : 0;
  const a = prev.split(VOICE_MARKER).join('').replace(/\s+$/, '');
  if (!a) return lead;
  const body = full.slice(lead);
  if (body.startsWith(a) && (body.length === a.length || /\s/.test(body[a.length]))) return lead + a.length;
  const had = a.match(/\S+/g) ?? [];
  const re = /\S+/g;
  let end = 0, i = 0, m: RegExpExecArray | null;
  while (i < had.length && (m = re.exec(body)) && m[0] === had[i]) { end = m.index + m[0].length; i++; }
  return lead + end;
}

export function holdState(dx: number, cancelPx = CANCEL_PX): 'hold' | 'cancel' {
  return dx <= -cancelPx ? 'cancel' : 'hold';
}
export function holdProgress(dx: number, cancelPx = CANCEL_PX): number {
  return Math.max(0, Math.min(1, -dx / cancelPx));
}

export type VoiceErrKind = 'mic-denied' | 'mic-missing' | 'mic-busy' | 'insecure' | 'unsupported' | 'stt-down' | 'stt-bad' | 'empty' | 'too-short' | 'too-big' | 'no-audio';
export type VoiceErr = { kind: VoiceErrKind; title: string; hint?: string; action?: 'record' | 'resend' };
export type Env = { ios: boolean; standalone: boolean; secure: boolean; mac?: boolean };

export function envOf(ua: string, standalone: boolean, secure: boolean, touchMac = false): Env {
  return { ios: /iPhone|iPad|iPod/.test(ua) || touchMac, standalone, secure, mac: /Macintosh/.test(ua) && !touchMac };
}

export function micError(e: unknown, env: Env, lang: Lang = 'ru'): VoiceErr {
  const name = (e as { name?: string } | null)?.name ?? '';
  const t = (k: string) => tr(lang, dk(`tools.voice.${k}`));
  if (!env.secure) return { kind: 'insecure', title: t('insecure') };
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    const hint = env.ios
      ? env.standalone ? t('deniedIosApp') : t('deniedIosTab')
      : env.mac ? t('deniedMac') : t('deniedOther');
    return { kind: 'mic-denied', title: t('denied'), hint, action: 'record' };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError')
    return { kind: 'mic-missing', title: t('missing'), hint: t('missingHint'), action: 'record' };
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError')
    return { kind: 'mic-busy', title: t('busy'), hint: t('busyHint'), action: 'record' };
  if (name === 'NoMediaRecorder' || name === 'TypeError')
    return { kind: 'unsupported', title: t('unsupported'), hint: t('unsupportedHint') };
  return { kind: 'mic-busy', title: t('micFail'), hint: t('tryAgain'), action: 'record' };
}

export function sttError(status: number, code: string | undefined, text: string, lang: Lang = 'ru'): VoiceErr | null {
  const t = (k: string) => tr(lang, dk(`tools.voice.${k}`));
  if (status === 200) {
    if (text.split(VOICE_MARKER).join('').trim()) return null;
    return { kind: 'empty', title: t('empty'), hint: t('emptyHint'), action: 'record' };
  }
  if (status === 413) return { kind: 'too-big', title: t('tooBig'), hint: t('tooBigHint'), action: 'record' };
  if (status === 401) return { kind: 'stt-bad', title: t('session'), hint: t('sessionHint') };
  if (code === 'stt_bad_audio' || status === 400) return { kind: 'stt-bad', title: t('badAudio'), hint: t('badAudioHint'), action: 'record' };
  return { kind: 'stt-down', title: t('sttDown'), hint: t('sttDownHint'), action: 'resend' };
}

export function recError(kind: 'too-short' | 'no-audio', lang: Lang = 'ru'): VoiceErr {
  return kind === 'too-short'
    ? { kind, title: tr(lang, 'tools.voice.tooShort'), hint: tr(lang, 'tools.voice.tooShortHint'), action: 'record' }
    : { kind, title: tr(lang, 'tools.voice.noAudio'), hint: tr(lang, 'tools.voice.noAudioHint'), action: 'record' };
}

export const AUTOSEND_KEY = 'kx.voice.send';
export function readAutoSend(get: (k: string) => string | null): boolean {
  try { return get(AUTOSEND_KEY) === '1'; } catch { return false; }
}
