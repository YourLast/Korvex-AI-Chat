'use client';
import { createContext, useContext, type ReactNode } from 'react';

export type Features = Record<'voice' | 'files' | 'memory' | 'automations' | 'webSearch' | 'compare' | 'push' | 'code' | 'signup' | 'blocks', boolean>;
const ALL_ON: Features = { voice: true, files: true, memory: true, automations: true, webSearch: true, compare: true, push: true, code: true, signup: true, blocks: true };
const Ctx = createContext<Features>(ALL_ON);

export function FeaturesProvider({ value, children }: { value?: Features | null; children: ReactNode }) {
  return <Ctx.Provider value={value ?? ALL_ON}>{children}</Ctx.Provider>;
}
export const useFeatures = (): Features => useContext(Ctx);
