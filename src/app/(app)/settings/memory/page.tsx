import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { memoryState } from '@/lib/memoryView';
import { MemorySettings } from '@/components/MemorySettings';
import { featureFor } from '@/lib/features';

export const dynamic = 'force-dynamic';

export default async function MemoryPage() {
  const me = await currentUser();
  if (!me) redirect('/login');
  if (!featureFor('memory', me.id)) redirect('/settings');
  return <MemorySettings initial={memoryState(me.id)} />;
}
