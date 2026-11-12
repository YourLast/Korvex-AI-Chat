
export type WorkView = 'line' | 'window' | 'full';

export type ViewState = { user: boolean | null; auto: 'window' | 'line' };

export type ViewEvent =
  | { t: 'live' }
  | { t: 'settle'; hold?: boolean }
  | { t: 'tap'; view: WorkView }
  | { t: 'open' };

export const SETTLE_MS = 1500;
export const COLLAPSE_MS = 260;

export const initView = (live: boolean): ViewState => ({ user: null, auto: live ? 'window' : 'line' });

export function viewOf(s: ViewState, waiting = false): WorkView {
  if (waiting) return 'full';
  if (s.user !== null) return s.user ? 'full' : 'line';
  return s.auto;
}

export function reduceView(s: ViewState, e: ViewEvent): ViewState {
  switch (e.t) {
    case 'live': return s.user === null && s.auto !== 'window' ? { ...s, auto: 'window' } : s;
    case 'settle': return s.user !== null || s.auto === 'line' || e.hold ? s : { ...s, auto: 'line' };
    case 'tap': return { ...s, user: e.view !== 'full' };
    case 'open': return s.user === true ? s : { ...s, user: true };
  }
}

export function holdOf(o: { focus: boolean; selection: boolean; paused: boolean; onScreen: boolean }): boolean {
  return o.focus || o.selection || (o.paused && o.onScreen);
}

export const atBottom = (scrollHeight: number, scrollTop: number, clientHeight: number, slack = 12): boolean => scrollHeight - scrollTop - clientHeight <= slack;

export const userInput = (at: number, now = Date.now(), ms = 1200): boolean => at > 0 && now - at <= ms;

export const easeOut = (k: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
