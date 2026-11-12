'use client';
import { useT } from '@/lib/i18n/react';
import { PageSkeleton } from '@/components/Kit';

export default function Loading() {
  const t = useT();
  return <PageSkeleton title={t('set.title')} />;
}
