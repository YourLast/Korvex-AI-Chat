'use client';
import { POWERED_BY } from '@/ext/client';
import { DEFAULT_NAME } from '@/lib/brandCore';
import { useT } from '@/lib/i18n/react';
import { useBrand } from './BrandCtx';

export function FootNote({ text }: { text: string }) {
  const t = useT();
  const b = useBrand();
  if (!POWERED_BY) return <div className="foot-note">{text}</div>;
  const first = b.name && b.name !== DEFAULT_NAME ? t('chat.footBrand', { name: b.name }) : t('chat.footAssistant');
  return (
    <div className="foot-note" data-testid="powered-by">
      {first} · <a href={POWERED_BY.href} target="_blank" rel="noopener">{POWERED_BY.text}</a>
    </div>
  );
}
