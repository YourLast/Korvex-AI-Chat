import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './db';
import { getSetting, setSetting } from './settings';
import { DEFAULT_NAME, DEFAULT_SHORT, setBrandGetter } from './brandCore';
import { FOOTER_TEXT } from '@/ext/client';

export type Brand = { name: string; short: string; footer: string; accent: string | null; logo: string | null };
type Stored = { name?: string; short?: string; footer?: string | null; accent?: string | null; logo?: string | null };

const HEX = /^#[0-9a-f]{6}$/i;
export const LOGO_TYPES: Record<string, string> = { png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp' };
export const logoDir = () => path.join(dataDir(), 'brand');

export function brand(): Brand {
  const s = getSetting<Stored>('brand', {});
  const name = s.name?.trim() || DEFAULT_NAME;
  return {
    name,
    short: s.short?.trim() || (s.name?.trim() ? name : DEFAULT_SHORT),
    footer: s.footer === undefined || s.footer === null ? FOOTER_TEXT : s.footer,
    accent: s.accent && HEX.test(s.accent) ? s.accent : null,
    logo: s.logo && /^(png|svg|webp):[0-9]+$/.test(s.logo) ? s.logo : null,
  };
}

export function setBrand(p: { name?: string; short?: string; footer?: string | null; accent?: string | null }, by: string | null) {
  const cur = getSetting<Stored>('brand', {});
  const next: Stored = { ...cur };
  if (p.name !== undefined) next.name = p.name.trim().slice(0, 60);
  if (p.short !== undefined) next.short = p.short.trim().slice(0, 30);
  if (p.footer !== undefined) next.footer = p.footer === null ? null : p.footer.slice(0, 200);
  if (p.accent !== undefined) next.accent = p.accent && HEX.test(p.accent) ? p.accent : null;
  setSetting('brand', next, by);
}

export function setLogo(ext: string | null, data: Buffer | null, by: string | null) {
  const cur = getSetting<Stored>('brand', {});
  fs.mkdirSync(logoDir(), { recursive: true, mode: 0o700 });
  for (const e of Object.keys(LOGO_TYPES)) fs.rmSync(path.join(logoDir(), `logo.${e}`), { force: true });
  if (ext && data) fs.writeFileSync(path.join(logoDir(), `logo.${ext}`), data, { mode: 0o600 });
  setSetting('brand', { ...cur, logo: ext && data ? `${ext}:${Date.now()}` : null }, by);
}

export const logoUrl = (b: Brand) => (b.logo ? `/brand/logo?v=${b.logo.split(':')[1]}` : null);

setBrandGetter(() => { const b = brand(); return { name: b.name, short: b.short }; });
