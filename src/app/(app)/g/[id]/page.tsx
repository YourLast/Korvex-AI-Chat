import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { loadGroup } from '@/lib/load';
import { modelsFor } from '@/lib/levelPolicy';
import { pageLang } from '@/lib/i18n/server';
import { CompareClient } from '@/components/CompareClient';
import { NoModels } from '@/components/NoModels';

export const dynamic = 'force-dynamic';

export default async function GroupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ m?: string }> }) {
  const { id } = await params;
  const { m } = await searchParams;
  const user = await currentUser();
  if (!user) redirect('/login');
  const g = m ? loadGroup(user.id, id, { turns: 0 }) : loadGroup(user.id, id);
  if (!g) notFound();
  const ms = modelsFor(user.role, await pageLang(user), user.id);
  if (!ms.length) return <NoModels admin={user.role === 'admin'} />;
  return <CompareClient key={id} models={ms} init={g} />;
}
