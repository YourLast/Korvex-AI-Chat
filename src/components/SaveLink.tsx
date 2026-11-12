'use client';
import type { ReactNode } from 'react';
import { needsShare, prefetchFile, saveFile } from '@/lib/fileSave';
import { useT } from '@/lib/i18n/react';

export function SaveLink({ href, name, className, onNote, children, testid, label }: {
  href: string; name: string; className?: string; onNote?: (s: string) => void; children: ReactNode; testid?: string; label?: string;
}) {
  const t = useT();
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!needsShare()) return;
    e.preventDefault();
    void saveFile(href, name, t.lang).then((o) => { if (o.note) onNote?.(o.note); });
  };
  return (
    <a className={className} href={href} download onPointerDown={() => prefetchFile(href, name)} onClick={onClick} data-testid={testid} aria-label={label}>
      {children}
    </a>
  );
}
