'use client';
import type { Key } from '@/lib/i18n/dict';
import { useT } from '@/lib/i18n/react';
import { Button, KPage, Notice } from './Kit';

export function AlphaOnly({ titleKey }: { titleKey: Key }) {
  const t = useT();
  return (
    <KPage title={t(titleKey)} heading={t('role.alphaTitle')} testId="alpha-only">
      <Notice tone="info" testId="alpha-only-text">{t('role.alphaText')}</Notice>
      <div className="k-acts k-acts--stack"><Button kind="primary" href="/" testId="alpha-only-back">{t('role.toChat')}</Button></div>
    </KPage>
  );
}
