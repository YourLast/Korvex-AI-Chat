'use client';
import { useEffect, useRef } from 'react';
import type { PublicModel } from '@/lib/models';
import type { Sel } from '@/lib/levels';
import { mountElastic, type ElasticHandle } from '@/lib/elastic';
import { useT } from '@/lib/i18n/react';
import '@/styles/elastic.css';

export function LevelElastic({ model, value, onChange }: { model: PublicModel; value: string; onChange: (levelId: string) => void }) {
  const tx = useT();
  const host = useRef<HTMLDivElement>(null);
  const h = useRef<ElasticHandle | null>(null);
  const live = useRef(onChange);
  live.current = onChange;
  const opts = { levels: model.levels, value, caption: tx('picker.thinkLevel'), label: tx('picker.thinkLevelOf', { model: model.name }), testId: `levels-${model.id}` };
  useEffect(() => {
    if (!host.current) return;
    const handle = mountElastic(host.current, { ...opts, onChange: (id) => live.current(id) });
    h.current = handle;
    return () => { handle.destroy(); h.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { h.current?.update(opts); });
  return <div ref={host} className="kxe-host" />;
}

export function ElasticLevelBlock({ models, sel, onLevel, className = 'pk-level' }: { models: PublicModel[]; sel: Sel; onLevel: (levelId: string) => void; className?: string }) {
  const tx = useT();
  const m = models.find((x) => x.id === sel.modelId) ?? models[0];
  return (
    <section className={className} aria-label={tx('picker.thinkLevel')}>
      <LevelElastic model={m} value={sel.levelId} onChange={onLevel} />
    </section>
  );
}
