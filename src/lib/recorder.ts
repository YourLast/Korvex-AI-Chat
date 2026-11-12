import { Leveler, pickMime, rmsDb } from './voiceLogic';

export type Levels = { raw: number; out: number; gain: number };
export type Take = { blob: Blob; mime: string; ms: number; rawMax: number; processed: boolean };
export type Recorder = {
  mime: string;
  processed: boolean;
  levels: () => Levels | null;
  stop: (tailMs?: number) => Promise<Take | null>;
  cancel: () => void;
};

type Ctor = typeof AudioContext;
const AC = (): Ctor | null => (typeof window === 'undefined' ? null : ((window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext) ?? null));

export function prepareAudio(): AudioContext | null {
  const C = AC();
  if (!C) return null;
  try {
    const ctx = new C({ latencyHint: 'interactive' });
    void ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}

function rawOnly(): boolean {
  try { return localStorage.getItem('kx.voice.raw') === '1'; } catch { return false; }
}

async function getMic(): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) throw Object.assign(new Error('no mediaDevices'), { name: window.isSecureContext ? 'TypeError' : 'SecurityError' });
  try {
    return await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } } });
  } catch (e) {
    if ((e as { name?: string }).name === 'OverconstrainedError') return md.getUserMedia({ audio: true });
    throw e;
  }
}

function recorderFor(stream: MediaStream, mime: string): { mr: MediaRecorder; chunks: Blob[]; done: Promise<void> } {
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 });
  const chunks: Blob[] = [];
  mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((res) => { mr.onstop = () => res(); mr.onerror = () => res(); });
  return { mr, chunks, done };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startRecorder(ctx: AudioContext | null, onEnded?: () => void): Promise<Recorder> {
  if (typeof MediaRecorder === 'undefined') throw Object.assign(new Error('no MediaRecorder'), { name: 'NoMediaRecorder' });
  let stream: MediaStream;
  try { stream = await getMic(); } catch (e) { void ctx?.close().catch(() => {}); throw e; }
  const mime = pickMime((m) => MediaRecorder.isTypeSupported(m), navigator.userAgent);
  const t0 = performance.now();

  let chain: null | { raw: AnalyserNode; out: AnalyserNode; gain: GainNode; dest: MediaStreamAudioDestinationNode; buf: Float32Array<ArrayBuffer> } = null;
  if (ctx && !rawOnly()) {
    if (ctx.state !== 'running') await Promise.race([ctx.resume().catch(() => {}), wait(400)]);
    if (ctx.state === 'running') {
      try {
        const src = ctx.createMediaStreamSource(stream);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70; hp.Q.value = 0.7;
        const gain = ctx.createGain(); gain.gain.value = 1;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -24; comp.knee.value = 10; comp.ratio.value = 2.5; comp.attack.value = 0.005; comp.release.value = 0.25;
        const lim = ctx.createDynamicsCompressor();
        lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
        const raw = ctx.createAnalyser(); raw.fftSize = 1024;
        const out = ctx.createAnalyser(); out.fftSize = 1024;
        const dest = ctx.createMediaStreamDestination();
        try { dest.channelCount = 1; dest.channelCountMode = 'explicit'; } catch {  }
        src.connect(hp); hp.connect(raw); hp.connect(gain); gain.connect(comp); comp.connect(lim); lim.connect(out); lim.connect(dest);
        chain = { raw, out, gain, dest, buf: new Float32Array(new ArrayBuffer(raw.fftSize * 4)) };
      } catch { chain = null; }
    }
  }

  const backup = recorderFor(stream, mime);
  const main = chain ? (() => { try { return recorderFor(chain.dest.stream, mime); } catch { return null; } })() : null;
  backup.mr.start();
  if (main) { try { main.mr.start(); } catch {  } }

  const lev = new Leveler(-24, 24);
  let rawNow = -120, outNow = -120, rawMax = -120, outMaxWhenLoud = -120, chainBroken = false;
  const read = (an: AnalyserNode) => { an.getFloatTimeDomainData(chain!.buf); return rmsDb(chain!.buf); };
  const tick = chain ? window.setInterval(() => {
    if (!chain) return;
    if (ctx!.state !== 'running') { chainBroken = true; return; }
    rawNow = read(chain.raw); outNow = read(chain.out);
    rawMax = Math.max(rawMax, rawNow);
    if (rawNow > -45) outMaxWhenLoud = Math.max(outMaxWhenLoud, outNow);
    const g = lev.feed(rawNow);
    chain.gain.gain.setTargetAtTime(Math.pow(10, g / 20), ctx!.currentTime, 0.25);
  }, 50) : 0;
  if (ctx) ctx.onstatechange = () => { if (ctx.state !== 'running') chainBroken = true; };

  const track = stream.getAudioTracks()[0];
  let finished = false;
  if (track) track.onended = () => { if (!finished) onEnded?.(); };

  const teardown = () => {
    finished = true;
    window.clearInterval(tick);
    stream.getTracks().forEach((t) => t.stop());
    if (ctx) { ctx.onstatechange = null; void ctx.close().catch(() => {}); }
  };
  const stopAll = async () => {
    for (const r of [main, backup]) { if (r && r.mr.state !== 'inactive') { try { r.mr.stop(); } catch {  } } }
    await Promise.race([Promise.all([main?.done, backup.done]), wait(2500)]);
  };

  return {
    mime,
    processed: !!main,
    levels: () => (chain && !chainBroken ? { raw: rawNow, out: outNow, gain: lev.gain() } : null),
    async stop(tailMs = 0) {
      if (finished) return null;
      if (tailMs) await wait(tailMs);
      await stopAll();
      teardown();
      const ms = performance.now() - t0;
      const mainOk = !!main && !chainBroken && main.chunks.length > 0 && !(rawMax > -45 && outMaxWhenLoud < -70);
      const use = mainOk ? main! : backup;
      const type = use.mr.mimeType || mime || 'audio/webm';
      const blob = new Blob(use.chunks, { type });
      if (!blob.size) return null;
      return { blob, mime: type, ms, rawMax: chain ? rawMax : 0, processed: mainOk };
    },
    cancel() {
      if (finished) return;
      for (const r of [main, backup]) { if (r && r.mr.state !== 'inactive') { try { r.mr.stop(); } catch {  } } }
      teardown();
    },
  };
}

export function buzz(p: number | number[]) {
  try { (navigator as { vibrate?: (p: number | number[]) => boolean }).vibrate?.(p); } catch {  }
}
