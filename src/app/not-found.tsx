'use client';
import { useT } from '@/lib/i18n/react';
import { Button, EmptyState, KSolo } from '@/components/Kit';

export default function NotFound() {
  const t = useT();
  return (
    <KSolo testId="not-found">
      <EmptyState icon="search" title={t('nf.title')} text={t('nf.text')}>
        <Button kind="primary" size="lg" href="/">{t('nf.toChats')}</Button>
      </EmptyState>
    </KSolo>
  );
}
