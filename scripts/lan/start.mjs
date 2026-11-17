#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const dir = process.cwd();
const rsf = JSON.parse(fs.readFileSync(path.join(dir, '.next', 'required-server-files.json'), 'utf8'));
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(rsf.config);
await import(new URL('./scripts/next-server.mjs', import.meta.url).href);
