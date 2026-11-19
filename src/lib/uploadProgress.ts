
export type UpState = 'none' | 'unknown' | 'queued' | 'parsing' | 'reading' | 'checking' | 'done' | 'error';
export type UpProgress = { state: UpState; pages?: number | null; done?: number; eyes?: number; waited?: number; eta?: number | null; bg?: boolean };
export type Probe = () => Promise<UpProgress>;

export const PID_RE = /^[A-Za-z0-9_-]{8,80}$/;
export const uploadProgressOn = (): boolean => process.env.KX_UPLOAD_PROGRESS === '1';

const TTL_MS = 30 * 60 * 1000;
type Ent = { userId: string; at: number; probe?: Probe; last?: { at: number; p: Promise<UpProgress> } };
const g = globalThis as unknown as { __kxUpProg?: Map<string, Ent> };
const reg = (g.__kxUpProg ??= new Map());

function sweep(now: number) { for (const [k, e] of reg) if (now - e.at > TTL_MS) reg.delete(k); }

export function openUpload(id: unknown, userId: string, now = Date.now()): string | null {
  if (!uploadProgressOn() || typeof id !== 'string' || !PID_RE.test(id)) return null;
  sweep(now);
  const had = reg.get(id);
  if (had && had.userId !== userId) return null;
  reg.set(id, { userId, at: now });
  return id;
}
export function setProbe(id: string | null | undefined, probe: Probe) { const e = id ? reg.get(id) : undefined; if (e) { e.probe = probe; e.last = undefined; } }
export function closeUpload(id: string | null | undefined) { if (id) reg.delete(id); }

export async function readUpload(id: string, userId: string, now = Date.now()): Promise<UpProgress> {
  if (!uploadProgressOn()) return { state: 'none' };
  const e = reg.get(id);
  if (!e || e.userId !== userId || !e.probe) return { state: 'unknown' };
  if (!e.last || now - e.last.at > 1000) e.last = { at: now, p: e.probe().catch(() => ({ state: 'unknown' as const })) };
  return e.last.p;
}

const STATES = new Set<UpState>(['unknown', 'queued', 'parsing', 'reading', 'checking', 'done', 'error']);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
export function fromServe(j: unknown): UpProgress {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  const state = STATES.has(o.state as UpState) ? (o.state as UpState) : 'unknown';
  const pages = num(o.pages);
  return {
    state, pages: pages === undefined ? null : Math.round(pages), done: Math.round(num(o.pages_done) ?? 0), eyes: Math.round(num(o.eyes_waiting) ?? 0),
    waited: num(o.waited_s) ?? 0, eta: num(o.eta_s) ?? null, bg: o.bg === true,
  };
}
