'use client';
import { useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n/react';
import { previewKind } from '@/lib/previewKind';
import { Icon } from './Icon';
import { openDoc } from './iv';
import { SaveLink } from './SaveLink';

const warmed = new Set<string>();
function prewarm(href: string) {
  if (warmed.has(href) || typeof fetch === 'undefined') return;
  warmed.add(href);
  void fetch(`${href}?preview=1&wait=0`, { credentials: 'same-origin', cache: 'no-store' }).catch(() => warmed.delete(href));
}

export function FileCard({ href, name, table, meta, children }: { href: string; name: string; table: boolean; meta: ReactNode; children: ReactNode }) {
  const t = useT();
  const [note, setNote] = useState<string | null>(null);
  const say = (s: string) => { setNote(s); setTimeout(() => setNote(null), 2600); };
  const kind = table ? null : previewKind(name);
  if (!kind) {
    return (
      <SaveLink className="dl" href={href} name={name} onNote={say} testid="file-card">
        <span className="ficon"><Icon n={table ? 'table' : 'file-text'} /></span>
        <span className="fmeta"><b>{children}</b><small>{note ?? meta}</small></span>
        <span className="btn"><Icon n="download" />{t('md.download')}</span>
      </SaveLink>
    );
  }
  return (
    <span className="dl dl-pv" data-testid="file-card" data-kind={kind}>
      <button type="button" className="dl-open" onClick={(e) => openDoc({ href, name, kind }, e.currentTarget)} aria-label={t('doc.open', { name })} data-testid="file-open"
        onPointerEnter={() => prewarm(href)} onPointerDown={() => prewarm(href)}>
        <span className="ficon"><Icon n={kind === 'slides' ? 'slides' : 'file-text'} /></span>
        <span className="fmeta"><b>{children}</b><small>{note ?? meta}</small></span>
      </button>
      <SaveLink className="btn" href={href} name={name} onNote={say} testid="file-dl"><Icon n="download" />{t('md.download')}</SaveLink>
    </span>
  );
}
