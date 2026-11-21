'use client';
import type { KpiBlock as KB } from '@/lib/blocks/schema';
import { Frame } from './Frame';
import { KpiCards } from './KpiCards';

export default function KpiBlock({ block, onPlain }: { block: KB; onPlain?: () => void }) {
  return <Frame block={block} onPlain={onPlain}><KpiCards items={block.data.items} /></Frame>;
}
