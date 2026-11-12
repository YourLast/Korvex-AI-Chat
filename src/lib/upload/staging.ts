import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '@/lib/db';
import type { Skipped } from './archive';

export const STAGE_TTL_MS = 3 * 3_600_000;
export const stagingRoot = () => path.join(dataDir(), 'staging');

export type StagedEntry = { n: number; path: string; size: number; sha256: string };
export type Manifest = { sid: string; userId: string; createdAt: number; archive: string; entries: StagedEntry[]; skipped: Skipped[]; left: number[] };

const SID = /^[0-9a-f-]{36}$/;

export function createStage(): { sid: string; dir: string } {
  const sid = randomUUID();
  const dir = path.join(stagingRoot(), sid);
  fs.mkdirSync(path.join(dir, 'f'), { recursive: true, mode: 0o700 });
  return { sid, dir };
}
export const stageDir = (sid: string): string | null => (SID.test(sid) ? path.join(stagingRoot(), sid) : null);

export function writeManifest(m: Manifest): void {
  const d = stageDir(m.sid)!;
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(m), { mode: 0o600 });
}
export function readManifest(sid: string): Manifest | null {
  const d = stageDir(sid);
  if (!d) return null;
  try { return JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')) as Manifest; } catch { return null; }
}

export function stagedFile(userId: string, sid: string, n: number): { file: string; entry: StagedEntry; archive: string } | null {
  const m = readManifest(sid);
  if (!m || m.userId !== userId) return null;
  const e = m.entries.find((x) => x.n === n);
  if (!e) return null;
  const file = path.join(/*turbopackIgnore: true*/ stageDir(sid)!, 'f', String(n).padStart(6, '0'));
  try { if (!fs.lstatSync(file).isFile()) return null; } catch { return null; }
  return { file, entry: e, archive: m.archive };
}

export function consumeStaged(sid: string, n: number): void {
  const d = stageDir(sid);
  const m = readManifest(sid);
  if (!d || !m) return;
  try { fs.rmSync(path.join(/*turbopackIgnore: true*/ d, 'f', String(n).padStart(6, '0')), { force: true }); } catch {  }
  m.left = (m.left ?? m.entries.map((e) => e.n)).filter((x) => x !== n);
  if (!m.left.length) { fs.rmSync(d, { recursive: true, force: true }); return; }
  try { writeManifest(m); } catch {  }
}

export function dropStage(sid: string): void {
  const d = stageDir(sid);
  if (d) fs.rmSync(d, { recursive: true, force: true });
}

let swept = 0;
export function sweepStaging(now = Date.now(), force = false): void {
  if (!force && now - swept < 600_000) return;
  swept = now;
  try {
    for (const d of fs.readdirSync(stagingRoot())) {
      const p = path.join(stagingRoot(), d);
      try { if (now - fs.lstatSync(p).mtimeMs > STAGE_TTL_MS) fs.rmSync(p, { recursive: true, force: true }); } catch {  }
    }
  } catch {  }
}
