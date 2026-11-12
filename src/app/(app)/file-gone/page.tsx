import { currentUser } from '@/lib/auth';
import { tr } from '@/lib/i18n/core';
import { pageLang } from '@/lib/i18n/server';
import { Button, EmptyState, KPage } from '@/components/Kit';

export const dynamic = 'force-dynamic';

export default async function FileGone({ searchParams }: { searchParams: Promise<{ name?: string }> }) {
  const { name } = await searchParams;
  const lang = await pageLang(await currentUser());
  return (
    <KPage title={tr(lang, 'gone.title')} heading={tr(lang, 'gone.title')} testId="file-gone">
      <EmptyState icon="file" title={name ? tr(lang, 'gone.named', { name: name.slice(0, 120) }) : tr(lang, 'gone.unnamed')}
        text={tr(lang, 'gone.text')}>
        <Button kind="primary" size="lg" href="/">{tr(lang, 'gone.toChats')}</Button>
      </EmptyState>
    </KPage>
  );
}
