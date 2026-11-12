'use client';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { LAND_MS, MAX_REC_S, SilenceWatch, barLevel, fmtDur } from '@/lib/voiceLogic';
import type { Voice } from './useVoice';

const PITCH = 4;
const BAR = 2;
const SAMPLE_MS = 60;
const SPEED = PITCH / SAMPLE_MS;
const ATTACK_MS = 60, RELEASE_MS = 250;
const GROW_MS = 120;
const FADE_PX = 28;
const GLOW_PX = 30;
type Bar = { t: number; v: number };
const MORPH_MS = 700;
const BAR_H = 24;
const RIB = [
  { a: 0.34, k: 1.1, s: 0.85, p: 0.0, w: 1.6, tok: '--text-strong', fb: [255, 255, 255] },
  { a: 0.28, k: 1.7, s: -0.6, p: 2.2, w: 1.4, tok: '--max-via', fb: [147, 197, 253] },
  { a: 0.21, k: 2.4, s: 0.45, p: 4.1, w: 1.2, tok: '--max-to', fb: [96, 165, 250] },
];
const ease = (x: number) => x * x * (3 - 2 * x);
function rgbOf(g: CanvasRenderingContext2D | null, css: string, fb: number[]): number[] {
  if (!g || !css) return fb;
  g.fillStyle = '#000'; g.fillStyle = css;
  const v = String(g.fillStyle), m = v.match(/^#([0-9a-f]{6})$/i) ?? null;
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const r = v.match(/[\d.]+/g);
  return r && r.length >= 3 ? r.slice(0, 3).map(Number) : fb;
}

export function VoiceStrip({ v }: { v: Voice }) {
  const t = useT();
  const cv = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const hist = useRef<Bar[]>([]);
  const clock = useRef(0);
  const curLv = useRef(0);
  const [secs, setSecs] = useState(0);
  const [quiet, setQuiet] = useState(false);
  const landR = useRef(false);
  landR.current = v.landing;
  const { phase, startedAt, rec } = v;
  const live = phase === 'rec';

  useEffect(() => {
    if (!live) return;
    const tick = () => {
      const s = (performance.now() - startedAt) / 1000;
      setSecs(s);
      if (s >= MAX_REC_S) void v.finish();
    };
    tick();
    const i = window.setInterval(tick, 250);
    return () => window.clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, startedAt]);

  useEffect(() => {
    const c = cv.current, b = box.current;
    if (!c || !b) return;
    const g = c.getContext('2d');
    let raf = 0, lastAttr = 0, w = 0, h = 0, quietNow = false, frames = 0;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const watch = new SilenceWatch();
    let draw = () => {};
    let maskG: CanvasGradient | null = null, glowG: CanvasGradient | null = null;
    const cs = getComputedStyle(c);
    const on = cs.color || '#ededed', off = cs.getPropertyValue('--vx-dim').trim() || 'rgba(255,255,255,.16)';
    const glowRgb = rgbOf(g, cs.getPropertyValue('--max-via').trim(), [147, 197, 253]);
    const size = () => {
      const r = c.getBoundingClientRect(), dpr = Math.min(3, window.devicePixelRatio || 1);
      w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
      c.width = w * dpr; c.height = h * dpr; g?.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (g) {
        maskG = g.createLinearGradient(0, 0, w, 0);
        maskG.addColorStop(0, 'rgba(0,0,0,0)'); maskG.addColorStop(Math.min(1, FADE_PX * 0.45 / w), 'rgba(0,0,0,.22)'); maskG.addColorStop(Math.min(1, FADE_PX / w), 'rgba(0,0,0,1)'); maskG.addColorStop(1, 'rgba(0,0,0,1)');
        glowG = g.createRadialGradient(0, 0, 0, 0, 0, GLOW_PX);
        glowG.addColorStop(0, `rgba(${glowRgb[0]},${glowRgb[1]},${glowRgb[2]},1)`); glowG.addColorStop(1, `rgba(${glowRgb[0]},${glowRgb[1]},${glowRgb[2]},0)`);
      }
      draw();
    };
    size();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(size) : null;
    ro?.observe(c);

    const act: number[] = [], dim: number[] = [], br: number[][] = [[], [], []];
    const stroke = (arr: number[], color: string, alpha: number) => {
      if (!arr.length || !g) return;
      g.beginPath();
      for (let i = 0; i < arr.length; i += 2) { g.moveTo(arr[i], h / 2 - arr[i + 1]); g.lineTo(arr[i], h / 2 + arr[i + 1] + 0.01); }
      g.strokeStyle = color; g.globalAlpha = alpha; g.stroke();
    };
    const drawBars = (now: number, k = 1, live = false, glow = 0) => {
      if (!g) return;
      g.clearRect(0, 0, w, h);
      const maxH = Math.min(h, BAR_H), hs = hist.current;
      act.length = dim.length = br[0].length = br[1].length = br[2].length = 0;
      const xOf = (t: number) => {
        const age = reduce ? Math.floor((now - t) / SAMPLE_MS) * SAMPLE_MS : now - t;
        return w - age * SPEED - BAR / 2;
      };
      for (const bar of hs) {
        const x = xOf(bar.t), age = now - bar.t;
        const grow = live && !reduce ? 1 - Math.pow(1 - Math.min(1, age / GROW_MS), 3) : 1;
        const bh = BAR + Math.max(0, bar.v * maxH * k - BAR) * grow;
        if (bh > BAR + 0.4) { act.push(x, bh / 2 - BAR / 2); continue; }
        const bk = reduce ? 1 : Math.min(2, Math.floor((0.5 + 0.5 * Math.sin(now * 0.0023 + bar.t * 0.0075)) * 3));
        br[bk].push(x, 0);
      }
      const oldest = hs.length ? hs[0].t : now;
      for (let m = 1; ; m++) {
        const x = xOf(oldest - m * SAMPLE_MS);
        if (x < -PITCH) break;
        dim.push(x, 0);
      }
      g.lineWidth = BAR; g.lineCap = 'round';
      stroke(dim, off, k);
      for (let i = 0; i < 3; i++) stroke(br[i], on, (0.30 + 0.07 * i) * k);
      stroke(act, on, k);
      if (live && !reduce) {
        g.save(); g.translate(w, h / 2); g.scale(1, h / 2 / GLOW_PX); g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.07 + 0.30 * glow; g.fillStyle = glowG ?? '#000'; g.fillRect(-GLOW_PX, -GLOW_PX, GLOW_PX * 2, GLOW_PX * 2);
        g.restore();
      }
      g.globalAlpha = 1;
      if (maskG) { g.globalCompositeOperation = 'destination-in'; g.fillStyle = maskG; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over'; }
    };
    draw = () => drawBars(clock.current || performance.now(), 1, phase === 'rec', curLv.current);
    if (phase === 'starting') { hist.current = []; clock.current = 0; curLv.current = 0; }

    let onVis = () => {};
    let prevT = 0, nextSlot = 0, cur = curLv.current, born = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = prevT ? Math.min(100, t - prevT) : 16; prevT = t; frames++;
      const lv = rec.current?.levels() ?? null;
      let tgt: number;
      if (lv) {
        tgt = barLevel(lv.out);
        const q = watch.feed(t, lv.raw);
        if (q !== quietNow) { quietNow = q; setQuiet(q); }
        if (t - lastAttr > 200) {
          lastAttr = t;
          b.dataset.recFrames = String(frames);
          b.dataset.raw = lv.raw.toFixed(0); b.dataset.out = lv.out.toFixed(0); b.dataset.gain = lv.gain.toFixed(1);
        }
      } else {
        tgt = 0.12 + 0.18 * Math.abs(Math.sin(t / 260)) * Math.abs(Math.sin(t / 97));
        b.dataset.nolevel = '1';
      }
      cur += (tgt - cur) * (1 - Math.exp(-dt / (tgt > cur ? ATTACK_MS : RELEASE_MS)));
      const hs = hist.current;
      if (!nextSlot) nextSlot = t;
      for (let n = 0; nextSlot <= t && n < 200; n++, nextSlot += SAMPLE_MS) { hs.push({ t: nextSlot, v: t - nextSlot > 120 ? 0 : cur }); born++; }
      if (nextSlot <= t) nextSlot = t;
      while (hs.length && xOfT(hs[0].t, t) < -PITCH) hs.shift();
      if (born) { born = 0; b.dataset.bars = String(hs.filter((x) => x.v * Math.min(h, BAR_H) > BAR + 0.5).length); }
      clock.current = t; curLv.current = cur;
      drawBars(t, 1, true, cur);
    };
    const xOfT = (bt: number, now: number) => w - (now - bt) * SPEED - BAR / 2;
    draw();
    if (phase === 'rec') {
      raf = requestAnimationFrame(frame);
      onVis = () => {
        if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
        else if (!raf) { prevT = 0; raf = requestAnimationFrame(frame); }
      };
      document.addEventListener('visibilitychange', onVis);
    }

    if (phase === 'stt' && g) {
      const ink = RIB.map((r) => rgbOf(g, cs.getPropertyValue(r.tok).trim(), r.fb));
      const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const freeze = clock.current || performance.now();
      let tt = still ? 1800 : 0, prev = 0, land0 = 0, morph = still ? 1 : 0, fade = 0, frames = 0, lastN = 0;
      const paint = () => {
        g.clearRect(0, 0, w, h);
        if (morph < 1) drawBars(freeze, 1 - morph);
        const mid = h / 2;
        g.globalCompositeOperation = 'lighter';
        g.lineCap = 'round'; g.lineJoin = 'round';
        for (let i = 0; i < RIB.length; i++) {
          const r = RIB[i], [cr, cg, cb] = ink[i];
          const gr = g.createLinearGradient(0, 0, w, 0), pk = 0.5 + 0.38 * Math.sin(tt * 0.00055 * (1 + i * 0.35) + r.p);
          gr.addColorStop(0, `rgba(${cr},${cg},${cb},.25)`); gr.addColorStop(pk, `rgb(${cr},${cg},${cb})`); gr.addColorStop(1, `rgba(${cr},${cg},${cb},.25)`);
          const amp = r.a * h * morph * (1 - fade) * (0.82 + 0.18 * Math.sin(tt * 0.0009 + r.p));
          g.beginPath();
          for (let x = 0; x <= w + 2; x += 3) {
            const u = Math.min(1, x / w), env = Math.pow(Math.abs(Math.sin(Math.PI * u)), 0.75);
            const y = mid + amp * env * (0.65 * Math.sin(u * 6.2832 * r.k + tt * 0.0021 * r.s + r.p) + 0.35 * Math.sin(u * 6.2832 * r.k * 1.9 - tt * 0.0014 * r.s + r.p * 1.7));
            if (x) g.lineTo(x, y); else g.moveTo(x, y);
          }
          g.strokeStyle = gr;
          const a = morph * (1 - fade);
          g.lineWidth = r.w * 3.6; g.globalAlpha = 0.16 * a; g.stroke();
          g.lineWidth = r.w; g.globalAlpha = a; g.stroke();
        }
        g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      };
      draw = paint;
      const stt = (t: number) => {
        raf = requestAnimationFrame(stt);
        tt += prev ? Math.min(50, t - prev) : 0; prev = t;
        if (landR.current && !land0) land0 = t;
        morph = ease(Math.min(1, tt / MORPH_MS));
        fade = land0 ? ease(Math.min(1, (t - land0) / LAND_MS)) : 0;
        paint(); frames++;
        if (t - lastN > 250) { lastN = t; b.dataset.sttFrames = String(frames); }
      };
      paint();
      if (!still) {
        raf = requestAnimationFrame(stt);
        onVis = () => {
          if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
          else if (!raf) { prev = 0; raf = requestAnimationFrame(stt); }
        };
        document.addEventListener('visibilitychange', onVis);
      }
    }
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); document.removeEventListener('visibilitychange', onVis); };
  }, [phase, rec]);

  useEffect(() => { if (phase !== 'rec') setQuiet(false); }, [phase]);

  const label = phase === 'starting' ? t('tools.voice.starting') : phase === 'stt' ? t('tools.voice.stt') : null;
  return (
    <div className={`vx vx--${phase}${quiet ? ' is-quiet' : ''}${v.landing ? ' is-land' : ''}`} ref={box} data-testid="rec" data-phase={phase} data-mode={v.mode}>
      <span className="vx-dot" aria-hidden="true" />
      <span className="vx-time" data-testid="rec-time">{fmtDur(secs)}</span>
      <div className="vx-wave">
        <canvas ref={cv} aria-hidden="true" />
        <span className="vx-say" role="status" aria-live="polite" data-testid={quiet ? 'rec-quiet' : phase === 'stt' ? 'rec-stt' : undefined}>
          {label ? <span>{phase === 'stt' ? <span className="vx-shimmer">{label}</span> : label}</span> : quiet ? <span>{t('tools.voice.quiet')}</span> : null}
        </span>
      </div>
    </div>
  );
}
