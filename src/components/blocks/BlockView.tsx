'use client';
import { lazy, Suspense, useState } from 'react';
import type { Block } from '@/lib/blocks/schema';
import { blockOn, useBlocksCfg } from './BlocksCfg';
import { useBlockEnv } from './BlockEnv';
import { BlockError, BlockHold } from './KxEmbed';
import { Plain } from './Plain';

const TableBlock = lazy(() => import('./TableBlock'));
const KpiBlock = lazy(() => import('./KpiBlock'));
const RateBlock = lazy(() => import('./RateBlock'));
const DeadlinesBlock = lazy(() => import('./DeadlinesBlock'));

export default function BlockView({ block, raw, href }: { block: Block; raw?: string; href?: string }) {
  const cfg = useBlocksCfg();
  const { folderId } = useBlockEnv();
  const [plain, setPlain] = useState(false);
  const on = blockOn(cfg, block.type, folderId);
  if (block.type === 'chart' || block.type === 'map' || block.type === 'party' || block.type === 'html') return <BlockError err="later" raw={raw ?? JSON.stringify(block.data, null, 2)} />;
  if (!on || plain) return <Plain block={block} onBlock={on ? () => setPlain(false) : undefined} />;
  const toPlain = () => setPlain(true);
  return (
    <Suspense fallback={<BlockHold type={block.type} />}>
      {block.type === 'table' && <TableBlock block={block} href={href} onPlain={block.data.preset || block.data.filters?.length ? toPlain : undefined} />}
      {block.type === 'kpi' && <KpiBlock block={block} onPlain={toPlain} />}
      {block.type === 'rate' && <RateBlock block={block} onPlain={toPlain} />}
      {block.type === 'deadlines' && <DeadlinesBlock block={block} onPlain={toPlain} />}
    </Suspense>
  );
}
