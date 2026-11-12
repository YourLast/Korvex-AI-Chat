export type Bip = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
type W = Window & { __kxBip?: Bip | null; __kxBipOn?: boolean };

export const BIP_SNIPPET = "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__kxBip=e;});";

export function watchInstall() {
  const w = window as W;
  if (w.__kxBipOn) return;
  w.__kxBipOn = true;
  w.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); w.__kxBip = e as Bip; w.dispatchEvent(new Event('kx:bip')); });
  w.addEventListener('appinstalled', () => { w.__kxBip = null; w.dispatchEvent(new Event('kx:installed')); });
  if (w.__kxBip) w.dispatchEvent(new Event('kx:bip'));
}
export const getBip = (): Bip | null => ((typeof window === 'undefined' ? null : (window as W).__kxBip) ?? null);
export const dropBip = () => { (window as W).__kxBip = null; };
