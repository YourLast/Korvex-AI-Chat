
export const CHECK_WAIT_MS = () => num(process.env.KX_CHECK_WAIT_MS, 60_000);
export const CHECK_SOLVE_MS = () => num(process.env.KX_CHECK_SOLVE_MS, 5 * 60_000);
function num(v: string | undefined, d: number): number { const n = Number(v); return v && Number.isFinite(n) && n > 0 ? n : d; }

type Pending = { userId: string; open: () => void };
const g = globalThis as unknown as { __kxChecks?: Map<string, Pending> };
const reg = () => (g.__kxChecks ??= new Map());

export function registerCheck(threadId: string, p: Pending): () => void {
  reg().set(threadId, p);
  return () => { if (reg().get(threadId) === p) reg().delete(threadId); };
}
export function openCheck(userId: string, threadId: string): boolean {
  const p = reg().get(threadId);
  if (!p || p.userId !== userId) return false;
  p.open();
  return true;
}
export const checkPending = (threadId: string) => reg().has(threadId);
