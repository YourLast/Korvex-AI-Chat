import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tmpData(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kx-test-'));
  process.env.DATA_DIR = dir;
  delete process.env.DATABASE_PATH;
  return dir;
}
