import { currentUser } from '@/lib/auth';
import { modelsFor } from '@/lib/levelPolicy';
import { pageLang } from '@/lib/i18n/server';
import { ChatClient } from '@/components/ChatClient';
import { NoModels } from '@/components/NoModels';

export const dynamic = 'force-dynamic';

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const ms = modelsFor(user?.role, await pageLang(user), user?.id);
  if (!ms.length) return <NoModels admin={user?.role === 'admin'} />;
  return <ChatClient key={sp.new ?? 'cmp'} models={ms} thread={null} initial={[]} fileNames={[]} startCompare />;
}
