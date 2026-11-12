'use client';
import { PageSkeleton } from '@/components/Kit';
import { useT } from '@/lib/i18n/react';

export default function Loading() {
  const t = useT();
  return <PageSkeleton title={t('shell.limits')} />;
}
