export function haptic(ms: number | number[] = 8): void {
  try { if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && window.matchMedia?.('(hover: none)').matches) navigator.vibrate(ms); } catch {  }
}
