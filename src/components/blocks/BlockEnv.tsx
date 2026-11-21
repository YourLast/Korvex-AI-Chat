'use client';
import { createContext, useContext } from 'react';
import type { Snapshots } from '@/lib/blocks/text';

export type BlockEnv = { live: boolean; snap?: Snapshots | null; folderId?: string | null; msgId?: string };
export const BlockEnvCtx = createContext<BlockEnv>({ live: false });
export const useBlockEnv = () => useContext(BlockEnvCtx);
