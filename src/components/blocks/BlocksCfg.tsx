'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { BlockType } from '@/lib/blocks/schema';

export type BlocksCfg = { on: boolean; types: Record<BlockType, boolean>; orgs: Record<string, Partial<Record<BlockType, boolean>>>; region: 'ru' | 'world' };
export const DEFAULT_CFG: BlocksCfg = {
  on: true, region: 'world', orgs: {},
  types: { table: true, kpi: true, rate: true, deadlines: true, chart: false, map: false, party: false, html: false },
};
const Ctx = createContext<BlocksCfg>(DEFAULT_CFG);
export function BlocksCfgProvider({ value, children }: { value?: BlocksCfg | null; children: ReactNode }) {
  return <Ctx.Provider value={value ?? DEFAULT_CFG}>{children}</Ctx.Provider>;
}
export const useBlocksCfg = (): BlocksCfg => useContext(Ctx);

export function blockOn(c: BlocksCfg, t: BlockType, folderId?: string | null): boolean {
  if (!c.on || !c.types[t]) return false;
  return !folderId || c.orgs[folderId]?.[t] !== false;
}
