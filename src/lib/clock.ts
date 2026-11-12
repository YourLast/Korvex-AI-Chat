let skew = 0;
export function setServerNow(now: number) { if (Number.isFinite(now)) skew = now - Date.now(); }
export const serverNow = () => Date.now() + skew;
