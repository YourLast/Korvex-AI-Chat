import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { loadThread, TAIL_TURNS } from '@/lib/load';
import { modelsFor } from '@/lib/levelPolicy';
import { pageLang } from '@/lib/i18n/server';
import { ChatClient } from '@/components/ChatClient';
import { NoModels } from '@/components/NoModels';

export const dynamic = 'force-dynamic';

export default async function ThreadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ m?: string }> }) {
  const { id } = await params;
  const { m } = await searchParams;
  const user = await currentUser();
  if (!user) redirect('/login');
  const d = loadThread(user.id, id, { turns: m ? 0 : TAIL_TURNS });
  if (!d) notFound();
  if (d.thread.groupId) redirect(`/g/${d.thread.groupId}${m ? `?m=${encodeURIComponent(m)}` : ''}`);
  const ms = modelsFor(user.role, await pageLang(user), user.id);
  if (!ms.length) return <NoModels admin={user.role === 'admin'} />;
  return <ChatClient key={id} models={ms} thread={{ id, title: d.thread.title, modelId: d.thread.modelId, effort: d.thread.effort, compare: d.compare, temporary: !!d.thread.temporary }} initial={d.messages} hasMore={d.hasMore} fileNames={d.fileNames} focus={m ?? null} />;
}
