import { useSyncExternalStore } from 'react';
import { getFileView, subscribeFileView } from './fileView';

import { DESKTOP_FROM, SB_KEY } from './sbSnippet';
export { DESKTOP_FROM, SB_KEY, SB_SNIPPET } from './sbSnippet';
export const AUTO_BELOW = 1600;

export type SbState = { pref: 'open' | 'closed'; auto: boolean; viewer: boolean; locked: boolean };
export type SbAction = { t: 'viewer'; open: boolean; width: number } | { t: 'toggle' } | { t: 'resize'; width: number };

export const isCollapsed = (s: SbState): boolean => s.pref === 'closed' || s.auto;

export function sbReduce(s: SbState, a: SbAction): SbState {
  switch (a.t) {
    case 'viewer': {
      if (s.viewer === a.open) return s;
      if (a.open) return { ...s, viewer: true, locked: false, auto: a.width >= DESKTOP_FROM && a.width < AUTO_BELOW && !isCollapsed(s) ? true : s.auto };
      return { ...s, viewer: false, locked: false, auto: false };
    }
    case 'toggle': {
      const next = isCollapsed(s) ? 'open' : 'closed';
      return { pref: next, auto: false, viewer: s.viewer, locked: s.viewer };
    }
    case 'resize': {
      if (!s.viewer || s.locked || a.width < DESKTOP_FROM) return s;
      if (a.width < AUTO_BELOW) return isCollapsed(s) ? s : { ...s, auto: true };
      return s.auto ? { ...s, auto: false } : s;
    }
  }
}

let state: SbState = { pref: 'open', auto: false, viewer: false, locked: false };
const subs = new Set<() => void>();
const apply = () => {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('sb-collapsed', isCollapsed(state));
};
const dispatch = (a: SbAction) => {
  const n = sbReduce(state, a);
  if (n === state) return;
  const was = state.pref;
  state = n; apply();
  if (n.pref !== was) { try { localStorage.setItem(SB_KEY, n.pref); } catch {  } }
  subs.forEach((f) => f());
};

export const getSidebar = () => state;
export const subscribeSidebar = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const toggleSidebar = () => dispatch({ t: 'toggle' });
export const useSidebarCollapsed = (): boolean => useSyncExternalStore(subscribeSidebar, () => isCollapsed(state), () => false);
export const sidebarWidth = (): number => {
  if (typeof document === 'undefined' || window.innerWidth < DESKTOP_FROM || isCollapsed(state)) return 0;
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 264;
};

export function initSidebar(): () => void {
  let pref: SbState['pref'] = 'open';
  try { if (localStorage.getItem(SB_KEY) === 'closed') pref = 'closed'; } catch {  }
  const open = () => { const v = getFileView(); return !!(v.target || v.compare); };
  state = { pref, auto: false, viewer: false, locked: false };
  apply(); subs.forEach((f) => f());
  const onView = () => dispatch({ t: 'viewer', open: open(), width: window.innerWidth });
  const onResize = () => dispatch({ t: 'resize', width: window.innerWidth });
  const off = subscribeFileView(onView);
  window.addEventListener('resize', onResize);
  onView();
  return () => { off(); window.removeEventListener('resize', onResize); };
}
export const _resetSidebar = (s: Partial<SbState> = {}) => { state = { pref: 'open', auto: false, viewer: false, locked: false, ...s }; subs.clear(); if (typeof document !== 'undefined') document.documentElement.classList.remove('sb-collapsed'); };
