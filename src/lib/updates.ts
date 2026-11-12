import fs from 'node:fs';
import path from 'node:path';
import { standDefault } from './cfg';

export type UpdateInfo = { current: string; latest: string | null; newer: boolean; url: string | null; notes: string | null; checkedAt: number | null; error?: string };

const TTL_MS = 12 * 3600_000;
const g = globalThis as unknown as { __kxUpd?: { at: number; info: UpdateInfo } };
export const updateRepo = (): string => (process.env.KX_UPDATE_REPO ?? standDefault('KX_UPDATE_REPO', 'YourLast/Korvex-AI-Chat')).trim();

export function currentVersion(): string {
  try { return (JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0'; } catch { return '0.0.0'; }
}

export function newerThan(a: string, b: string): boolean {
  const p = (v: string) => v.replace(/^v/, '').split(/[.-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

export async function checkUpdate(o: { force?: boolean; now?: number; doFetch?: typeof fetch } = {}): Promise<UpdateInfo> {
  const now = o.now ?? Date.now();
  const current = currentVersion();
  const repo = updateRepo();
  if (!repo) return { current, latest: null, newer: false, url: null, notes: null, checkedAt: null };
  const c = g.__kxUpd;
  if (!o.force && c && now - c.at < TTL_MS && c.info.current === current) return c.info;
  let info: UpdateInfo;
  try {
    const r = await (o.doFetch ?? fetch)(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'korvex-ai-chat' }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`GitHub: HTTP ${r.status}`);
    const j = (await r.json()) as { tag_name?: string; html_url?: string; body?: string };
    const latest = (j.tag_name ?? '').replace(/^v/, '') || null;
    info = { current, latest, newer: !!latest && newerThan(latest, current), url: j.html_url ?? null, notes: j.body ? j.body.slice(0, 4000) : null, checkedAt: now };
  } catch (e) {
    info = { current, latest: null, newer: false, url: null, notes: null, checkedAt: now, error: (e as Error).message };
  }
  g.__kxUpd = { at: now, info };
  return info;
}
