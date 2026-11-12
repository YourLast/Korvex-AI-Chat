import fs from 'node:fs';
import path from 'node:path';

export const KEEP_MS = 30 * 24 * 3_600_000;
const last = new Map<string, number>();

export function sweepOld(root: string, now = Date.now(), force = false, keepMs = KEEP_MS): void {
  if (!force && now - (last.get(root) ?? 0) < 3_600_000) return;
  last.set(root, now);
  try {
    for (const d of fs.readdirSync(root)) {
      const f = path.join(root, d);
      try {
        const age = now - fs.lstatSync(f).mtimeMs;
        if ((d.startsWith('.tmp-') && age > 3_600_000) || (!d.startsWith('.tmp-') && age > keepMs)) fs.rmSync(f, { recursive: true, force: true });
      } catch {  }
    }
  } catch {  }
}
