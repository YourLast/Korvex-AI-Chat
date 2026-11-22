'use client';
import { useEffect, useRef } from 'react';
import type { PublicModel } from '@/lib/models';
import type { Sel } from '@/lib/levels';
import { mountElastic, type ElasticHandle } from '@/lib/elastic';
import { useLang, useT } from '@/lib/i18n/react';
import { MULT_VIEW } from '@/lib/pickerVariant';
import '@/styles/elastic.css';

export const multFmt = (x: number, lang: string) => new Intl.NumberFormat(lang === 'en' ? 'en-US' : lang === 'sr' ? 'sr-Latn' : 'ru-RU', { maximumFractionDigits: 2 }).format(x);

const times = (n: number) => (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'few' : 'many');
export function multNote(tx: ReturnType<typeof useT>, lang: string, x: number, uniform: boolean): string {
  if (x === 1) return tx('picker.multSame');
  const n = x > 1 ? x : Math.round(1 / x);
  const v = { n: multFmt(n, lang), w: tx(times(n) === 'few' ? 'picker.timesFew' : 'picker.timesMany') };
  return x > 1 ? tx(uniform ? 'picker.multFaster' : 'picker.multFasterWeek', v) : tx('picker.multSlower', v);
}

export function LevelElastic({ model, value, onChange }: { model: PublicModel; value: string; onChange: (levelId: string) => void }) {
  const tx = useT();
  const lang = useLang();
  const host = useRef<HTMLDivElement>(null);
  const h = useRef<ElasticHandle | null>(null);
  const live = useRef(onChange);
  live.current = onChange;
  const opts = { levels: model.levels, value, caption: tx('picker.thinkLevel'), label: tx('picker.thinkLevelOf', { model: model.name }), testId: `levels-${model.id}`,
    ...(MULT_VIEW ? { mult: { view: MULT_VIEW, fmt: (x: number) => tx('picker.mult', { n: multFmt(x, lang) }), note: (x: number, uniform: boolean) => (MULT_VIEW === 'warm' ? '' : multNote(tx, lang, x, uniform)),
      tip: (x: number) => tx('picker.maxTip', { model: model.name, n: multFmt(x, lang), w: tx(x % 10 >= 2 && x % 10 <= 4 && (x % 100 < 12 || x % 100 > 14) ? 'picker.timesFew' : 'picker.timesMany') }) } } : {}) };
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
