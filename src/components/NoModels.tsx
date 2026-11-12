'use client';
import { EmptyState, Button } from './Kit';
import { useT } from '@/lib/i18n/react';

export function NoModels({ admin }: { admin: boolean }) {
  const t = useT();
  return (
    <div className="k-solo-in" style={{ margin: '12vh auto 0', maxWidth: 480 }} data-testid="no-models">
      <EmptyState title={t('nomodels.title')} text={admin ? t('nomodels.admin') : t('nomodels.user')}>
        {admin && <Button kind="primary" href="/admin#providers" testId="no-models-admin">{t('nomodels.go')}</Button>}
      </EmptyState>
    </div>
  );
}
