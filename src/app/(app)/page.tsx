import { featureOn } from '@/lib/features';
import { currentUser } from '@/lib/auth';
import { modelsFor } from '@/lib/levelPolicy';
import { pageLang } from '@/lib/i18n/server';
import { canAgents } from '@/lib/roles';
import { ChatClient } from '@/components/ChatClient';
import { NoModels } from '@/components/NoModels';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<{ new?: string; temp?: string; mode?: string }> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const ms = modelsFor(user?.role, await pageLang(user), user?.id);
  if (!ms.length) return <NoModels admin={user?.role === 'admin'} />;
  return <ChatClient key={(sp.new ?? 'home') + (sp.temp ? ':t' : '') + (sp.mode ? `:${sp.mode}` : '')} models={ms} thread={null} initial={[]} fileNames={[]} startTemp={sp.temp === '1'} startCode={sp.mode === 'code' && canAgents(user?.role) && featureOn('code')} />;
}
