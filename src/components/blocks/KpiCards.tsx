'use client';
import { useT } from '@/lib/i18n/react';
import type { KpiItem } from '@/lib/blocks/schema';
import { fmtMoney, fmtNum } from '@/lib/blocks/money';
import { SrcChip } from '../SrcChip';

export function KpiCards({ items, strip }: { items: KpiItem[]; strip?: boolean }) {
  const tx = useT();
  const val = (k: KpiItem, v: string, sign = false) => (k.kind === 'money' ? fmtMoney(v, tx.lang, sign) : fmtNum(v, tx.lang, { sign }));
  return (
    <div className={`kxk${strip ? ' kxk--strip' : ''}`} data-n={items.length} data-testid="kxb-kpi-cards">
      {items.map((k, i) => {
        const neg = k.delta?.startsWith('-');
        return (
          <div className={`kxk-c${k.verified === false ? ' is-unv' : ''}`} key={i} data-testid="kxb-kpi-card">
            <span className="kxk-l">{k.label}</span>
            <span className="kxk-v" data-testid="kxb-kpi-value">
              {val(k, k.value)}{k.unit ? <small>{' '}{k.unit}</small> : k.kind === 'percent' ? <small>{' '}%</small> : null}
            </span>
            {k.delta && <span className={`kxk-d ${k.tone === 'neg' || (!k.tone && neg) ? 'is-neg' : k.tone === 'warn' ? 'is-warn' : 'is-pos'}`}>{val(k, k.delta, true)}{k.deltaLabel ? ` ${k.deltaLabel}` : ''}</span>}
            {k.note && <span className={`kxk-n${k.tone === 'neg' ? ' is-neg' : k.tone === 'warn' ? ' is-warn' : ''}`}>{k.note}</span>}
            {k.verified === false && <span className="kxk-unv" data-testid="kxb-kpi-unverified"><i aria-hidden="true" />{tx('blk.notVerified')}</span>}
            {(k.basis || k.src) && <span className="kxk-b">{k.basis}{k.src ? <> <SrcChip raw={k.src} /></> : null}</span>}
          </div>
        );
      })}
    </div>
  );
}
