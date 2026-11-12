import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { loadAdminChat, logView } from '@/lib/adminView';
import { AdminChat } from '@/components/AdminChat';

export const dynamic = 'force-dynamic';

export default async function AdminChatPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ m?: string }> }) {
  const { id } = await params;
  const { m } = await searchParams;
  const me = await currentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') redirect('/');
  const data = loadAdminChat(id, m);
  if (!data) notFound();
  logView({ adminId: me.id, ownerId: data.owner.id, kind: 'chat', target: id, threadId: id });
  return <AdminChat key={`${id}:${m ?? ''}`} data={data} tz={me.timezone || 'Europe/Moscow'} focus={m ?? null} />;
}
