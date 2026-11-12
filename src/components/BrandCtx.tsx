'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { DEFAULT_NAME, DEFAULT_SHORT, setBrandNames } from '@/lib/brandCore';

export type BrandView = { name: string; short: string; footer: string; logoUrl: string | null };
const Ctx = createContext<BrandView>({ name: DEFAULT_NAME, short: DEFAULT_SHORT, footer: '', logoUrl: null });

export function BrandProvider({ value, children }: { value: BrandView; children: ReactNode }) {
  setBrandNames({ name: value.name, short: value.short });
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useBrand = (): BrandView => useContext(Ctx);
