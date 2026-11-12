import type { ReactNode } from 'react';
import { retiredModel } from '@/lib/retired';
import { EXT_MARKS } from '@/ext/marks';

const GLYPHS: Record<string, ReactNode> = {
  ...EXT_MARKS,
  neutral: <circle className="mk-l" cx="10" cy="10" r="4" />,
};
export const MARK_IDS = Object.keys(GLYPHS);

type ModelRef = { id: string; variantOf?: string };

export function markOf(id: string, models?: ModelRef[]): string {
  let fam = id;
  if (models) {
    const m = models.find((x) => x.id === id);
    if (m) fam = m.variantOf && models.some((x) => x.id === m.variantOf) ? m.variantOf : id;
    else {
      const r = retiredModel(id);
      fam = r ? r.variantOf ?? r.id : '';
    }
  }
  return Object.hasOwn(GLYPHS, fam) ? fam : 'neutral';
}

export function ModelMark({ id, models, className, state }: { id: string; models?: ModelRef[]; className?: string; state?: string }) {
  const k = markOf(id, models);
  return (
    <svg className={`mk${className ? ' ' + className : ''}`} viewBox="0 0 20 20" aria-hidden="true" focusable="false" data-mark={k} data-state={state}>
      {GLYPHS[k]}
    </svg>
  );
}
