import { getSetting, setSetting, deleteSetting } from '../settings';
import { cfg } from '../cfg';
import { featureFor } from '../features';
import { BLOCK_TYPES, STAGE1_TYPES, type BlockType } from './schema';

export type Types = Record<BlockType, boolean>;
export type Region = 'ru' | 'world';
export type BlocksView = { on: boolean; types: Types; orgs: Record<string, Partial<Types>>; region: Region };

export const region = (): Region => (cfg('KX_REGION') === 'ru' ? 'ru' : 'world');
export const DEFAULT_TYPES: Types = Object.fromEntries(BLOCK_TYPES.map((t) => [t, (STAGE1_TYPES as readonly string[]).includes(t)])) as Types;

function clean(v: unknown): Partial<Types> {
  const out: Partial<Types> = {};
  if (v && typeof v === 'object') for (const t of BLOCK_TYPES) { const x = (v as Record<string, unknown>)[t]; if (typeof x === 'boolean') out[t] = x; }
  return out;
}
export const blockTypes = (): Types => ({ ...DEFAULT_TYPES, ...clean(getSetting<unknown>('blocks.types', null)) });
export function setBlockTypes(v: Partial<Types> | null, by: string | null) {
  if (!v) { deleteSetting('blocks.types'); return; }
  setSetting('blocks.types', { ...blockTypes(), ...clean(v) }, by);
}

export const orgTypes = (folderId: string): Partial<Types> => clean(getSetting<unknown>(`org.blocks.${folderId}`, null));
export function setOrgTypes(folderId: string, v: Partial<Types> | null, by: string | null) {
  if (!v || !Object.keys(clean(v)).length) { deleteSetting(`org.blocks.${folderId}`); return; }
  setSetting(`org.blocks.${folderId}`, clean(v), by);
}

export function typeOn(t: BlockType, folderId?: string | null, types = blockTypes()): boolean {
  if (!types[t]) return false;
  return !folderId || orgTypes(folderId)[t] !== false;
}

export function blocksFor(userId: string, folderId?: string | null): string[] | null {
  try {
    if (!featureFor('blocks', userId)) return null;
    const types = blockTypes();
    const on = (STAGE1_TYPES as readonly BlockType[]).filter((t) => typeOn(t, folderId, types));
    return on.length ? on : null;
  } catch { return null; }
}

export function blocksView(userId: string, folderIds: string[] = []): BlocksView {
  const orgs: Record<string, Partial<Types>> = {};
  for (const f of folderIds) { const o = orgTypes(f); if (Object.keys(o).length) orgs[f] = o; }
  return { on: featureFor('blocks', userId), types: blockTypes(), orgs, region: region() };
}
